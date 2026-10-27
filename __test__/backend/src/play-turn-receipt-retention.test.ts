import { link, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import type { NovelHonoApp } from '@oh-awesome-novel/backend';

const roots: string[] = [];
const sessionId = 'retention';
const api = `/api/workspace/play-sessions/${sessionId}`;
const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function request(app: NovelHonoApp, url: string, body: unknown = {}) {
  return app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function receiptPath(root: string, turnId: string) { return join(root, '.workspace/play-turn-runs', sessionId, `${turnId}.json`); }
async function run(app: NovelHonoApp, baseRevision = 0) {
  const response = await request(app, `${api}/turns/stream`, { userText: 'Wait', baseRevision });
  expect(response.status).toBe(200);
  const text = await response.text();
  return { turnId: response.headers.get('x-oan-play-turn-id')!, text };
}
async function fixture(commit = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-receipt-retention-')); roots.push(root);
  const app = createNovelHonoApp({ workspaceRoot: root, runPlayTurn: async () => {
    if (!commit) throw new Error('provider offline');
    return 'Waited.\n```oan-play-settlement\n' + JSON.stringify({ elapsed: 'PT1M', events: [], stateDelta: {}, observations: [], suggestedActions: [] }) + '\n```';
  } });
  expect((await request(app, '/api/workspace/play-sessions', { id: sessionId, title: 'Retention', sceneStart: 'Station' })).status).toBe(200);
  const first = await run(app);
  const record = JSON.parse(await readFile(receiptPath(root, first.turnId), 'utf8'));
  return { root, app, record };
}
async function store(root: string, record: Record<string, unknown>, aged = true) {
  const path = receiptPath(root, String(record.turnId));
  await writeFile(path, JSON.stringify(record));
  if (aged) await utimes(path, old, old);
  return path;
}

describe('Play terminal receipt retention through the real turn entry point', () => {
  it('expires only verified old terminals, retaining recent and unresolved evidence', async () => {
    const { root, app, record } = await fixture(true);
    const removed = [
      await store(root, { ...record, turnId: 'old-committed' }),
      await store(root, { ...record, turnId: 'old-failed', phase: 'failed', artifactHash: undefined }),
      await store(root, { ...record, turnId: 'old-cancelled', phase: 'cancelled', artifactHash: undefined }),
    ];
    const retained = [
      await store(root, { ...record, turnId: 'recent' }, false),
      await store(root, { ...record, turnId: 'running', phase: 'running', artifactHash: undefined }),
      await store(root, { ...record, turnId: 'committing', phase: 'committing' }),
      await store(root, { ...record, turnId: 'hash-mismatch', artifactHash: '0'.repeat(64) }),
      await store(root, { ...record, turnId: 'unverified-cancel', phase: 'cancelled' }),
      await store(root, { ...record, turnId: 'unverified-failure', phase: 'failed' }),
      await store(root, { ...record, turnId: 'wrong-session', sessionId: 'another-session' }),
    ];
    const damaged = receiptPath(root, 'damaged');
    await writeFile(damaged, '{invalid'); await utimes(damaged, old, old); retained.push(damaged);
    expect((await run(app, 1)).text).toContain('play.turn.committed');
    for (const path of removed) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const path of retained) await expect(readFile(path)).resolves.toBeDefined();
    // Expired recovery metadata must report unknown, never fabricate cancellation.
    const reopened = createNovelHonoApp({ workspaceRoot: root });
    const absent = await request(reopened, `${api}/turns/old-committed/cancel`);
    expect(absent.status).toBe(404);
    expect(await absent.json()).not.toHaveProperty('committed');
  });

  it('advances its bounded batch beyond retained records instead of starving later terminals', async () => {
    const { root, app, record } = await fixture();
    for (let index = 0; index < 128; index++) {
      await store(root, { ...record, turnId: `a-running-${String(index).padStart(3, '0')}`, phase: 'running' });
    }
    const last = await store(root, { ...record, turnId: 'z-old-failed' });
    await run(app);
    await expect(readFile(last)).resolves.toBeDefined();
    await run(app);
    await expect(readFile(last)).rejects.toMatchObject({ code: 'ENOENT' });
    const wrapped = await store(root, { ...record, turnId: 'a-old-failed' });
    await run(app);
    await expect(readFile(wrapped)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(receiptPath(root, 'a-running-000'))).resolves.toBeDefined();
  });

  it('preserves symlinks, hardlinks and oversized metadata without blocking a turn', async () => {
    const { root, app, record } = await fixture();
    const external = join(root, 'outside.json');
    await writeFile(external, JSON.stringify({ ...record, turnId: 'linked' })); await utimes(external, old, old);
    const linked = receiptPath(root, 'linked'); await symlink(external, linked);
    const hard = await store(root, { ...record, turnId: 'hardlinked' }); await link(hard, join(root, 'hardlink.json'));
    const oversized = receiptPath(root, 'oversized');
    await writeFile(oversized, JSON.stringify({ ...record, turnId: 'oversized', extra: 'x'.repeat(8192) })); await utimes(oversized, old, old);
    expect((await run(app)).text).toContain('play.turn.failed');
    for (const path of [external, linked, hard, oversized]) await expect(readFile(path)).resolves.toBeDefined();
  });
});
