import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { open } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaySessionDraft, readPlaySessionFiles, writePlaySessionFiles } from '@oh-awesome-novel/core';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const roots: string[] = [];
const unsupported = ['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'] as const;
const scenarios = unsupported.flatMap((code) => ['open', 'sync'].map((phase) => ({ code, phase })));
type FailurePhase = 'open' | 'sync' | 'close';

beforeEach(() => { vi.mocked(open).mockReset(); vi.mocked(open).mockImplementation(actualFs.open); });
afterEach(async () => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => actualFs.rm(root, { recursive: true, force: true })));
});

async function fixture(platform: NodeJS.Platform) {
  // Create the real host fixture before changing the platform branch selector.
  const root = await actualFs.mkdtemp(join(tmpdir(), 'oan-play-platform-')); roots.push(root);
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
  const session = createPlaySessionDraft({ id: 'platform-session', title: 'Platform', sceneStart: 'Start', characters: [] });
  return { root, session };
}

function injectFailure(kind: 'directory' | 'file', phase: FailurePhase, code: string) {
  const error = Object.assign(new Error(`${kind} ${phase} ${code}`), { code });
  const calls: Array<{ kind: string; flags: string | number }> = [];
  let closed = 0;
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    const information = await actualFs.lstat(path).catch(() => undefined);
    const isDirectory = information?.isDirectory() ?? false;
    const isTranscript = information?.isFile() && String(path).endsWith('transcript.md');
    const target = kind === 'directory' ? isDirectory : isTranscript;
    if (target) {
      calls.push({ kind, flags });
      if (phase === 'open') throw error;
    }
    const handle = await actualFs.open(path, flags, mode);
    if (target) {
      if (phase === 'sync') vi.spyOn(handle, 'sync').mockRejectedValue(error);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close(); closed++;
        if (phase === 'close') throw error;
      });
    }
    return handle;
  });
  return { error, calls, closed: () => closed };
}

describe('Play snapshot platform durability through the public writer', () => {
  it.each(scenarios)('tolerates only Windows unsupported directory $phase/$code barriers and retains complete session files', async ({ code, phase }) => {
    const { root, session } = await fixture('win32');
    const injected = injectFailure('directory', phase as FailurePhase, code);
    await writePlaySessionFiles(root, session, { expectedAbsent: true });
    expect(injected.calls.length).toBeGreaterThan(0);
    if (phase === 'sync') expect(injected.closed()).toBe(injected.calls.length);
    expect(await readPlaySessionFiles(root, session.id)).toEqual(session);
  });

  it.each(['linux', 'darwin'] as const)('keeps the same unsupported directory errors fatal on %s', async (platform) => {
    const { root, session } = await fixture(platform);
    const injected = injectFailure('directory', 'sync', 'EPERM');
    await expect(writePlaySessionFiles(root, session, { expectedAbsent: true })).rejects.toBe(injected.error);
    expect(injected.closed()).toBeGreaterThan(0);
    await expect(actualFs.readFile(join(root, '.workspace/play-sessions', session.id, 'session.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['EIO', 'EACCES', 'ENOSPC', 'ENOENT'])('does not hide Windows directory I/O error %s', async (code) => {
    const { root, session } = await fixture('win32'); const injected = injectFailure('directory', 'sync', code);
    await expect(writePlaySessionFiles(root, session, { expectedAbsent: true })).rejects.toBe(injected.error);
    expect(injected.closed()).toBeGreaterThan(0);
  });

  it.each(['open', 'sync'] as const)('uses writable Windows file handles and keeps file %s failures fatal', async (phase) => {
    const { root, session } = await fixture('win32'); const injected = injectFailure('file', phase, 'EPERM');
    await expect(writePlaySessionFiles(root, session, { expectedAbsent: true })).rejects.toBe(injected.error);
    expect(injected.calls.length).toBeGreaterThan(0); expect(injected.calls.every((call) => call.flags === 'r+')).toBe(true);
    if (phase === 'sync') expect(injected.closed()).toBe(injected.calls.length);
    await expect(actualFs.readFile(join(root, '.workspace/play-sessions', session.id, 'session.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps POSIX file flush read-only and strict', async () => {
    const { root, session } = await fixture('linux'); const injected = injectFailure('file', 'sync', 'EINVAL');
    await expect(writePlaySessionFiles(root, session, { expectedAbsent: true })).rejects.toBe(injected.error);
    expect(injected.calls.every((call) => call.flags === 'r')).toBe(true); expect(injected.closed()).toBeGreaterThan(0);
  });

  it('does not swallow a Windows directory close failure as an unsupported barrier', async () => {
    const { root, session } = await fixture('win32'); const injected = injectFailure('directory', 'close', 'EPERM');
    await expect(writePlaySessionFiles(root, session, { expectedAbsent: true })).rejects.toBe(injected.error);
    expect(injected.closed()).toBeGreaterThan(0);
  });
});
