import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNovelHonoApp, startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { NovelBackendOptions, NovelHonoApp } from '@oh-awesome-novel/backend';

const commitFault = vi.hoisted(() => ({ gate: undefined as (() => Promise<void>) | undefined }));
vi.mock('@oh-awesome-novel/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@oh-awesome-novel/core')>();
  return { ...original, writePlaySessionFiles: async (...args: Parameters<typeof original.writePlaySessionFiles>) => {
    if (args[2]?.expectedCurrentSession) await commitFault.gate?.();
    return original.writePlaySessionFiles(...args);
  } };
});

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const sessionId = 'play-restart';
const path = `/api/workspace/play-sessions/${sessionId}`;

async function fixture(options: Partial<NovelBackendOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-reconcile-'));
  roots.push(root);
  const app = createNovelHonoApp({ workspaceRoot: root, runPlayTurn: async () => settlement(), ...options });
  const response = await request(app, '/api/workspace/play-sessions', { id: sessionId, title: 'Restart', sceneStart: 'Station' });
  expect(response.status).toBe(200);
  return { root, app };
}
function request(app: NovelHonoApp, url: string, body?: unknown) {
  return app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function settlement() { return 'The gate closes.\n```oan-play-settlement\n' + JSON.stringify({ elapsed: 'PT1M', events: [], stateDelta: {}, observations: [], suggestedActions: [] }) + '\n```'; }
function receiptPath(root: string, runId: string) { return join(root, '.workspace/play-turn-runs', sessionId, `${runId}.json`); }
async function receipt(root: string, runId: string) { return JSON.parse(await readFile(receiptPath(root, runId), 'utf8')); }
async function committed(app: NovelHonoApp) {
  const response = await request(app, `${path}/turns/stream`, { userText: 'Wait', actionKind: 'wait', baseRevision: 0 });
  const runId = response.headers.get('x-oan-play-turn-id')!;
  expect(await response.text()).toContain('play.turn.committed');
  return runId;
}

async function waitForTerminal(root: string, runId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await receipt(root, runId);
    if (['committed', 'cancelled', 'failed'].includes(value.phase)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Run did not settle.');
}

describe('durable Play stream outcome reconciliation', () => {
  it('recovers committed truth after recreating the backend with no in-memory run registry', async () => {
    const { app, root } = await fixture();
    const runId = await committed(app);
    const restarted = createNovelHonoApp({ workspaceRoot: root });
    const response = await request(restarted, `${path}/turns/${runId}/cancel`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'committed', committed: true, session: { revision: 1 } });
  });

  it('recovers a lost terminal receipt from the exact artifact after the commit barrier', async () => {
    const { app, root } = await fixture();
    const runId = await committed(app);
    const record = await receipt(root, runId);
    await writeFile(receiptPath(root, runId), JSON.stringify({ ...record, phase: 'committing' }));
    const response = await request(createNovelHonoApp({ workspaceRoot: root }), `${path}/turns/${runId}/cancel`);
    expect(await response.json()).toMatchObject({ status: 'committed', committed: true, session: { revision: 1 } });
  });

  it('does not mistake a reused artifact ID or unverified committing receipt for cancellation or commit', async () => {
    const { app, root } = await fixture();
    const runId = await committed(app);
    const record = await receipt(root, runId);
    await writeFile(receiptPath(root, runId), JSON.stringify({ ...record, phase: 'committing', artifactHash: '0'.repeat(64) }));
    const response = await request(createNovelHonoApp({ workspaceRoot: root }), `${path}/turns/${runId}/cancel`);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).not.toHaveProperty('committed');
    expect(body).not.toHaveProperty('status', 'cancelled');
  });

  it('preserves a known failed terminal across backend restart', async () => {
    const { app, root } = await fixture({ runPlayTurn: async () => { throw new Error('provider unavailable'); } });
    const response = await request(app, `${path}/turns/stream`, { userText: 'Wait', baseRevision: 0 });
    const runId = response.headers.get('x-oan-play-turn-id')!;
    expect(await response.text()).toContain('play.turn.failed');
    const recovered = await request(createNovelHonoApp({ workspaceRoot: root }), `${path}/turns/${runId}/cancel`);
    expect(await recovered.json()).toMatchObject({ status: 'failed', committed: false, error: 'provider unavailable' });
  });

  it('treats interrupted running metadata as unknown and cannot search another workspace', async () => {
    const { app, root } = await fixture();
    const runId = await committed(app);
    const record = await receipt(root, runId);
    delete record.artifactHash;
    await writeFile(receiptPath(root, runId), JSON.stringify({ ...record, phase: 'running' }));
    const response = await request(createNovelHonoApp({ workspaceRoot: root }), `${path}/turns/${runId}/cancel`);
    expect(response.status).toBe(409);
    const other = await mkdtemp(join(tmpdir(), 'oan-other-play-')); roots.push(other);
    const wrongWorkspace = await request(createNovelHonoApp({ workspaceRoot: other }), `${path}/turns/${runId}/cancel`);
    expect(wrongWorkspace.status).toBe(404);
  });

  it('aborts a provider deadline and releases the session even when the provider ignores abort', async () => {
    const { app, root } = await fixture({ playTurnDeadlineMs: 30, runPlayTurn: async () => new Promise<string>(() => undefined) });
    const response = await request(app, `${path}/turns/stream`, { userText: 'Wait', baseRevision: 0 });
    const runId = response.headers.get('x-oan-play-turn-id')!;
    expect(await response.text()).toContain('deadline-exceeded');
    expect((await receipt(root, runId)).phase).toBe('cancelled');
    const mutation = await request(app, `${path}/transcript`, { speaker: 'narrator', content: 'Continue safely.', baseRevision: 0 });
    expect(mutation.status).toBe(200);
    const recovered = await request(createNovelHonoApp({ workspaceRoot: root }), `${path}/turns/${runId}/cancel`);
    expect(await recovered.json()).toMatchObject({ status: 'cancelled', committed: false });
  });

  it('gracefully closes an active stream and persists the cancellation before returning', async () => {
    const { root } = await fixture();
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const backend = await startNovelHttpBackend({ workspaceRoot: root,
      runPlayTurn: async () => { providerStarted(); return new Promise<string>(() => undefined); },
    });
    try {
      const response = await fetch(`${backend.url}${path}/turns/stream`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userText: 'Wait', baseRevision: 0 }),
      });
      await started;
      const body = response.text();
      await backend.close();
      expect(await body).toContain('backend-shutdown');
      const runId = response.headers.get('x-oan-play-turn-id')!;
      expect((await receipt(root, runId)).phase).toBe('cancelled');
    } finally {
      if (backend.server.listening) await backend.close();
    }
  });

  it('waits for a started commit barrier during graceful shutdown', async () => {
    const { root } = await fixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    commitFault.gate = async () => { enter(); await blocked; };
    const backend = await startNovelHttpBackend({ workspaceRoot: root, runPlayTurn: async () => settlement() });
    try {
      const response = await fetch(`${backend.url}${path}/turns/stream`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userText: 'Wait', baseRevision: 0 }),
      });
      const body = response.text();
      await entered;
      let closed = false;
      const closing = backend.close().then(() => { closed = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(false);
      release();
      await closing;
      expect(await body).toContain('play.turn.committed');
      const runId = response.headers.get('x-oan-play-turn-id')!;
      expect((await receipt(root, runId)).phase).toBe('committed');
    } finally {
      release(); commitFault.gate = undefined;
      if (backend.server.listening) await backend.close();
    }
  });

  it('ends an unverified commit failure as unknown instead of polling an already-finished commit forever', async () => {
    const { app, root } = await fixture();
    commitFault.gate = async () => { throw new Error('simulated write uncertainty'); };
    try {
      const response = await request(app, `${path}/turns/stream`, { userText: 'Wait', baseRevision: 0 });
      const runId = response.headers.get('x-oan-play-turn-id')!;
      expect(await response.text()).toContain('commit_outcome_unknown');
      expect((await receipt(root, runId)).phase).toBe('committing');
      const live = await request(app, `${path}/turns/${runId}/cancel`);
      expect(live.status).toBe(409);
      expect(await live.json()).not.toHaveProperty('status', 'committing');
      const restarted = await request(createNovelHonoApp({ workspaceRoot: root }), `${path}/turns/${runId}/cancel`);
      expect(restarted.status).toBe(409);
    } finally { commitFault.gate = undefined; }
  });

  it('rejects symlinked recovery metadata instead of using it as turn truth', async () => {
    const { app, root } = await fixture();
    const runId = await committed(app);
    const stored = await readFile(receiptPath(root, runId));
    const outside = join(root, 'outside.json');
    await writeFile(outside, stored);
    await rm(receiptPath(root, runId));
    await symlink(outside, receiptPath(root, runId));
    const response = await request(createNovelHonoApp({ workspaceRoot: root }), `${path}/turns/${runId}/cancel`);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty('committed');
  });

  it('bounds the SSE queue for a stalled reader and releases the pre-commit reservation', async () => {
    const { app, root } = await fixture({ playTurnMaxQueuedBytes: 1024, runPlayTurn: async () => settlement().replace('The gate closes.', 'A'.repeat(2048)) });
    const response = await request(app, `${path}/turns/stream`, { userText: 'Wait', baseRevision: 0 });
    const runId = response.headers.get('x-oan-play-turn-id')!;
    const terminal = await waitForTerminal(root, runId);
    expect(terminal.phase).toBe('cancelled');
    await expect(response.text()).rejects.toThrow(/queued byte limit/u);
    const mutation = await request(app, `${path}/transcript`, { speaker: 'narrator', content: 'Continue safely.', baseRevision: 0 });
    expect(mutation.status).toBe(200);
  });
});
