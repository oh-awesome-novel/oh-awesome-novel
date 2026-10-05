import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareManuscriptImport } from '@oh-awesome-novel/core';
import {
  assertManuscriptImportActionFresh,
  assertManuscriptImportPreview,
  createChangeMaterializer,
  createManuscriptImportChangeProposal,
  createPendingActionStore,
  readRepositoryBaseline,
} from '@oh-awesome-novel/tools';

const faults = vi.hoisted(() => ({
  platform: 'win32' as NodeJS.Platform,
  directory: undefined as { phase: 'open' | 'sync'; code: string } | undefined,
  file: undefined as { phase: 'open' | 'sync' | 'write'; code: string } | undefined,
  requireWritableFileFlush: false,
  directoryOpens: 0,
  directoryCloses: 0,
  fileFlushes: 0,
  writableFileFlushes: 0,
}));

// Isolate platform selection to the durability module; host paths and real Git
// keep their native behavior while the public package exercises Windows I/O.
vi.mock('node:process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:process')>();
  return { ...original, default: new Proxy(original.default, {
    get(target, key) { return key === 'platform' ? faults.platform : Reflect.get(target, key); },
  }) };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  const error = (code: string) => Object.assign(new Error(`Injected filesystem ${code}`), { code });
  return { ...original, open: async (...args: Parameters<typeof original.open>) => {
    const [path, flags] = args;
    const info = await original.lstat(path).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'ENOENT') throw cause;
      return undefined;
    });
    const directory = info?.isDirectory() === true;
    const draft = String(path).endsWith('.tmp');
    if (directory) {
      faults.directoryOpens++;
      if (faults.directory?.phase === 'open') throw error(faults.directory.code);
    }
    if (draft && faults.file?.phase === 'open') throw error(faults.file.code);
    const handle = await original.open(...args);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      if (directory && faults.directory?.phase === 'sync') throw error(faults.directory.code);
      if (!directory) {
        faults.fileFlushes++;
        if (flags === 'r+') faults.writableFileFlushes++;
        if (faults.requireWritableFileFlush && flags === 'r') throw error('EPERM');
        if (draft && faults.file?.phase === 'sync') throw error(faults.file.code);
      }
      await sync();
    };
    if (draft && faults.file?.phase === 'write') handle.writeFile = async () => { throw error(faults.file!.code); };
    const close = handle.close.bind(handle);
    handle.close = async () => {
      await close();
      if (directory) faults.directoryCloses++;
    };
    return handle;
  } };
});

const roots: string[] = [];
const exec = promisify(execFile);
afterEach(async () => {
  faults.directory = undefined;
  faults.file = undefined;
  faults.requireWritableFileFlush = false;
  faults.platform = 'win32';
  faults.directoryOpens = faults.directoryCloses = faults.fileFlushes = faults.writableFileFlushes = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(realGit = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-directory-durability-'));
  roots.push(root);
  if (realGit) {
    for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Durability Test'],
      ['config', 'user.email', 'durability@example.invalid'], ['commit', '--allow-empty', '-m', 'baseline']]) {
      await exec('git', ['-C', root, ...args]);
    }
  }
  const repository = realGit ? await readRepositoryBaseline(root) : { repositoryId: 'test', branch: 'main', head: 'abc123' };
  const store = await createPendingActionStore({ workspaceRoot: root, repositoryValidator: async () => {},
    assertOriginFresh: async ({ preview }) => assertManuscriptImportPreview(preview) });
  const proposal = createManuscriptImportChangeProposal({ previewId: 'pa_directory-test', repository,
    plan: prepareManuscriptImport({ sourceName: 'old.md', text: '# 第一章 旧城\n\n林安停在旧城门前。\n' }) });
  return { root, store, prepare: () => store.prepareChangePreview({ id: 'pa_directory-test', ...proposal }) };
}

describe('durable approval storage across platforms', () => {
  it.each([
    { phase: 'open' as const, code: 'EPERM' },
    { phase: 'sync' as const, code: 'EINVAL' },
  ])('keeps immutable import previews usable when Windows directory $phase rejects $code', async (fault) => {
    const { root, store, prepare } = await fixture();
    faults.directory = fault;
    const preview = await prepare();
    expect(await store.readPreparedChangePreview(preview.id)).toEqual(preview);
    expect(preview.preview.diff).toContain('林安停在旧城门前。');
    expect(faults.directoryOpens).toBe(2);
    expect(faults.directoryCloses).toBe(fault.phase === 'sync' ? 2 : 0);
    expect(faults.fileFlushes).toBeGreaterThanOrEqual(3);
    await expect(readFile(join(root, 'chapters/0001/0001.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { platform: 'linux' as const, phase: 'open' as const, code: 'EPERM' },
    { platform: 'darwin' as const, phase: 'sync' as const, code: 'EINVAL' },
    { platform: 'win32' as const, phase: 'sync' as const, code: 'EIO' },
    { platform: 'win32' as const, phase: 'open' as const, code: 'EACCES' },
  ])('propagates directory $phase $code on $platform', async ({ platform, ...fault }) => {
    const { prepare } = await fixture();
    faults.platform = platform;
    faults.directory = fault;
    await expect(prepare()).rejects.toMatchObject({ code: fault.code });
    expect(faults.directoryOpens).toBe(1);
    expect(faults.directoryCloses).toBe(fault.phase === 'sync' ? 1 : 0);
  });

  it.each([
    { phase: 'open' as const, code: 'EPERM' },
    { phase: 'write' as const, code: 'EIO' },
    { phase: 'sync' as const, code: 'EINVAL' },
  ])('does not waive Windows draft file $phase errors ($code)', async (fault) => {
    const { store, prepare } = await fixture();
    faults.directory = { phase: 'open', code: 'EPERM' };
    faults.file = fault;
    await expect(prepare()).rejects.toMatchObject({ code: fault.code });
    await expect(store.readPreparedChangePreview('pa_directory-test')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(faults.directoryOpens).toBe(0);
  });

  it('accepts the reviewed chapter with strict writable Windows file flushes and unsupported directory flushes', async () => {
    const { root, store, prepare } = await fixture(true);
    faults.directory = { phase: 'sync', code: 'EINVAL' };
    faults.requireWritableFileFlush = true;
    const preview = await prepare();
    const action = await store.promotePreparedChangePreview({ id: preview.id, title: 'Import', description: 'Import chapter',
      source: { kind: 'deterministic-builder', producer: 'manuscript-import', capability: 'chapter.edit' },
      origin: preview.origin, allowedTargets: preview.allowedTargets });
    const accepted = await createChangeMaterializer({ store,
      assertOriginFresh: (pending) => assertManuscriptImportActionFresh(root, pending),
    }).accept({ actionId: action.id, autoCommitOnAccept: false });
    expect(accepted.action.status).toBe('accepted');
    expect(accepted.receipt.git.status).toBe('not-requested');
    expect(await readFile(join(root, 'chapters/0001/0001.md'), 'utf8')).toContain('林安停在旧城门前。');
    expect(faults.writableFileFlushes).toBeGreaterThanOrEqual(2);
    expect(faults.directoryCloses).toBe(faults.directoryOpens);
  });
});
