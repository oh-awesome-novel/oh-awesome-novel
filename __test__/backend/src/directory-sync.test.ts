import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import type { NovelHonoApp } from '@oh-awesome-novel/backend';

const fault = vi.hoisted(() => ({
  root: '', code: '', target: 'directory' as 'directory' | 'file',
  operation: 'sync' as 'open' | 'sync', hits: 0,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: async (
    path: Parameters<typeof original.open>[0],
    flags: Parameters<typeof original.open>[1],
    mode?: Parameters<typeof original.open>[2],
  ) => {
    const isReceiptPath = fault.root && String(path).startsWith(fault.root);
    const isDirectory = isReceiptPath && await original.lstat(path).then((info) => info.isDirectory(), () => false);
    const inject = isReceiptPath && fault.code && (fault.target === 'directory' ? isDirectory : !isDirectory);
    const fail = () => { fault.hits++; throw Object.assign(new Error(`Injected ${fault.code}`), { code: fault.code }); };
    if (inject && fault.operation === 'open') fail();
    const handle = await original.open(path, flags, mode);
    if (inject && fault.operation === 'sync') handle.sync = async () => fail();
    return handle;
  } };
});

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const roots: string[] = [];
afterEach(async () => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  fault.root = ''; fault.code = ''; fault.hits = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const sessionId = 'directory-sync';
const sessionUrl = `/api/workspace/play-sessions/${sessionId}`;
const settlement = 'The gate closes.\n```oan-play-settlement\n'
  + JSON.stringify({ elapsed: 'PT1M', events: [], stateDelta: {}, observations: [], suggestedActions: [] }) + '\n```';

async function fixture(platform: NodeJS.Platform, code: string, operation: 'open' | 'sync', target: 'directory' | 'file' = 'directory') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'oan-backend-directory-sync-')));
  roots.push(root);
  const provider = vi.fn(async () => settlement);
  const app = createNovelHonoApp({ workspaceRoot: root, runPlayTurn: provider });
  const created = await request(app, '/api/workspace/play-sessions', { id: sessionId, title: 'Directory sync', sceneStart: 'Station' });
  expect(created.status).toBe(200);
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
  Object.assign(fault, { root: join(root, '.workspace', 'play-turn-runs'), code, operation, target, hits: 0 });
  return { root, app, provider };
}

function request(app: NovelHonoApp, url: string, body: unknown) {
  return app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('Backend recovery metadata directory durability', () => {
  it.each(['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].flatMap((code) =>
    (['open', 'sync'] as const).map((operation) => ({ code, operation }))))(
    'continues and recovers a committed Play turn when Windows directory $operation returns $code',
    async ({ code, operation }) => {
      const { root, app, provider } = await fixture('win32', code, operation);
      const response = await request(app, `${sessionUrl}/turns/stream`, { userText: 'Wait', baseRevision: 0 });
      expect(response.status).toBe(200);
      const runId = response.headers.get('x-oan-play-turn-id')!;
      expect(await response.text()).toContain('play.turn.committed');
      expect(provider).toHaveBeenCalledOnce();
      expect(fault.hits).toBeGreaterThan(0);
      const record = JSON.parse(await readFile(join(root, '.workspace', 'play-turn-runs', sessionId, `${runId}.json`), 'utf8'));
      expect(record).toMatchObject({ phase: 'committed', artifactHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
      const recovered = await request(createNovelHonoApp({ workspaceRoot: root }), `${sessionUrl}/turns/${runId}/cancel`, {});
      expect(await recovered.json()).toMatchObject({ status: 'committed', committed: true, session: { revision: 1 } });
    },
  );

  it.each(([
    { platform: 'linux', code: 'EPERM', target: 'directory', operation: 'open' },
    { platform: 'linux', code: 'EINVAL', target: 'directory', operation: 'sync' },
    { platform: 'win32', code: 'EIO', target: 'directory', operation: 'sync' },
    { platform: 'win32', code: 'ENOSPC', target: 'directory', operation: 'open' },
    { platform: 'win32', code: 'EPERM', target: 'file', operation: 'sync' },
    { platform: 'win32', code: 'EIO', target: 'file', operation: 'sync' },
  ] as const).filter((item) => process.platform !== 'win32' || item.platform === 'win32'))(
    'fails before model execution on $platform $target $operation $code', async ({ platform, code, target, operation }) => {
    const { app, provider } = await fixture(platform, code, operation, target);
    const response = await request(app, `${sessionUrl}/turns/stream`, { userText: 'Wait', baseRevision: 0 });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Play turn recovery metadata could not be saved.' });
    expect(provider).not.toHaveBeenCalled();
    expect(fault.hits).toBeGreaterThan(0);
    const current = await app.request(sessionUrl);
    expect(await current.json()).toMatchObject({ session: { revision: 0 } });
  });
});
