import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import type { NovelBackendOptions, NovelHonoApp } from '@oh-awesome-novel/backend';

type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;

const git = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const sessionId = 'play-log';
const path = `/api/workspace/play-sessions/${sessionId}`;
const logFile = (root: string) => join(root, '.oan/sessions/.play-logs', sessionId, 'messages.jsonl');
const usage = { inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 6, text: 2, reasoning: 4 } };
const THINKING = 'PRIVATE_REFEREE_THINKING_FOR_DEBUG_ONLY';

function settlement() {
  return 'The gate closes.\n```oan-play-settlement\n' + JSON.stringify({ elapsed: 'PT1M', events: [], stateDelta: {}, observations: [], suggestedActions: [] }) + '\n```';
}
function response(chunks: ProviderPart[]) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
}
function request(app: NovelHonoApp, url: string, body?: unknown) {
  return app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function fixture(options: Partial<NovelBackendOptions> = {}, gitWorkspace = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-log-'));
  roots.push(root);
  if (gitWorkspace) {
    // Model mode runs the referee through the agent turn, which needs a Git workspace.
    await mkdir(join(root, '.oan'), { recursive: true });
    await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: play-log\ngit:\n  autoCommitOnAccept: false\n');
    await git('git', ['init', '-b', 'main', root]);
    await git('git', ['-C', root, 'add', '.']);
    await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  }
  const app = createNovelHonoApp({ workspaceRoot: root, ...options });
  const created = await request(app, '/api/workspace/play-sessions', { id: sessionId, title: 'Log', sceneStart: 'Station' });
  expect(created.status).toBe(200);
  return { root, app };
}
async function readLog(app: NovelHonoApp, query = '') {
  const response = await app.request(`${path}/message-log${query}`);
  return { status: response.status, body: await response.json() };
}
async function filesContaining(root: string, needle: string, directory = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.name === '.git') continue;
    if (entry.isDirectory()) found.push(...await filesContaining(root, needle, full));
    else if ((await readFile(full, 'utf8')).includes(needle)) found.push(relative(root, full));
  }
  return found;
}

describe('Play message log', () => {
  it('records a world-referee turn with thinking only in the debug log', async () => {
    const model = new MockLanguageModelV4({ doStream: response([
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', delta: THINKING },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: settlement() },
      { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]) });
    const { root, app } = await fixture({
      providerConfig: { id: 'play-log-test', kind: 'custom', model: 'thinker', models: [{ id: 'thinker', reasoningEffort: 'high' }] },
      resolveModel: () => model,
    }, true);

    const turn = await request(app, `${path}/turns/stream`, { userText: 'Wait by the gate', actionKind: 'wait', baseRevision: 0 });
    const wire = await turn.text();
    expect(wire).toContain('play.turn.committed');
    expect(wire).not.toContain(THINKING);
    expect(model.doStreamCalls[0]!.reasoning).toBe('high');

    const { status, body } = await readLog(app);
    expect(status).toBe(200);
    expect(body.skippedLines).toBe(0);
    expect(body.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      'author_action', 'model_request', 'model_reasoning', 'model_output', 'turn_committed',
    ]);
    const turnId = turn.headers.get('x-oan-play-turn-id');
    expect(body.entries.every((entry: { turnId?: string; playSessionId: string }) =>
      entry.turnId === turnId && entry.playSessionId === sessionId)).toBe(true);
    expect(body.entries[0]).toMatchObject({ text: 'Wait by the gate', data: { actionKind: 'wait' } });
    expect(body.entries[1]).toMatchObject({ role: 'world_referee', text: expect.stringContaining('Wait by the gate') });
    expect(body.entries[2]).toMatchObject({ role: 'world_referee', text: THINKING });
    expect(body.entries[3].text).toContain('oan-play-settlement');

    // Thinking never reaches Play session files, receipts, context traces or usage records.
    expect(await filesContaining(root, THINKING)).toEqual([
      join('.oan/sessions/.play-logs', sessionId, 'messages.jsonl'),
    ]);
  });

  it('logs failed turns and skips corrupt lines while paging', async () => {
    const { root, app } = await fixture({ runPlayTurn: async () => 'no settlement block' });
    const turn = await request(app, `${path}/turns/stream`, { userText: 'Look', actionKind: 'look', baseRevision: 0 });
    expect(await turn.text()).toContain('play.turn.failed');

    const before = await readFile(logFile(root), 'utf8');
    await writeFile(logFile(root), `${before}{not json\n${JSON.stringify({ schemaVersion: 1, at: 'x', kind: 'author_action', playSessionId: 'other' })}\n`);

    const first = await readLog(app, '?limit=2');
    expect(first.body.entries.map((entry: { kind: string }) => entry.kind)).toEqual(['author_action', 'model_request']);
    expect(first.body.nextCursor).toBe(2);
    const rest = await readLog(app, `?cursor=${first.body.nextCursor}&limit=1000`);
    expect(rest.body.entries.map((entry: { kind: string }) => entry.kind)).toEqual(['model_output', 'turn_failed']);
    expect(rest.body.skippedLines).toBe(2);
    expect(rest.body).not.toHaveProperty('nextCursor');
  });

  it('returns an empty page before any turn and validates the query', async () => {
    const { app } = await fixture();
    await expect(readLog(app)).resolves.toEqual({ status: 200, body: { entries: [], skippedLines: 0 } });
    expect((await readLog(app, '?limit=0')).status).toBe(400);
    expect((await readLog(app, '?cursor=-1')).status).toBe(400);
    expect((await readLog(app, '?other=1')).status).toBe(400);
    expect((await app.request('/api/workspace/play-sessions/missing/message-log')).status).toBe(404);
  });

  it('refuses a symlinked log directory instead of following it', async () => {
    const { root, app } = await fixture({ runPlayTurn: async () => settlement() });
    const outside = await mkdtemp(join(tmpdir(), 'oan-play-log-outside-'));
    roots.push(outside);
    await mkdir(join(root, '.oan/sessions'), { recursive: true });
    await symlink(outside, join(root, '.oan/sessions/.play-logs'), 'dir');

    const turn = await request(app, `${path}/turns/stream`, { userText: 'Wait', actionKind: 'wait', baseRevision: 0 });
    // Debug logging failure never fails the turn.
    expect(await turn.text()).toContain('play.turn.committed');
    expect(await readdir(outside)).toEqual([]);
    expect((await readLog(app)).status).toBe(422);
  });
});
