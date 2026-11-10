import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { PlaySession } from '@oh-awesome-novel/core';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const settlement = (narrative: string, outcome: string, suggestions: string[] = []) => [
  narrative,
  '```oan-play-settlement',
  JSON.stringify({ events: [], stateDelta: { outcome }, observations: [], suggestedActions: suggestions }),
  '```',
].join('\n');

function parseSse(body: string): Array<Record<string, unknown>> {
  return body.split(/\r?\n\r?\n/u)
    .map((block) => block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    .filter((data) => data && data !== '[DONE]')
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

async function setup(reply: (request: string, call: number) => string) {
  const root = await mkdtemp(join(tmpdir(), 'oan-guided-retry-http-'));
  await mkdir(join(root, '.oan'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
  const requests: string[] = [];
  const backend = await startNovelHttpBackend({
    workspaceRoot: root,
    streamPlayTurn: async function* ({ request }) {
      requests.push(request);
      yield reply(request, requests.length);
    },
  });
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }); });
  const endpoint = `${backend.url}/api/workspace/play-sessions/guided`;
  const post = async (path: string, body: unknown) => fetch(`${endpoint}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const created = await fetch(`${backend.url}/api/workspace/play-sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'guided', title: 'Guided', sceneStart: '雨夜车站' }),
  });
  expect(created.status).toBe(200);
  const read = async () => (await (await fetch(endpoint)).json() as { session: PlaySession }).session;
  return { root, endpoint, post, read, requests, backend };
}

describe('guided Retry over HTTP/SSE', () => {
  it('sends guidance only in the retry request and stores it on the new sibling', async () => {
    const { post, read, requests, endpoint } = await setup((request, call) => request.includes('oan-play-suggestions')
      ? '```oan-play-suggestions\n{"suggestedActions":["[say] 问她要去哪","[look] 看站台"]}\n```'
      : settlement(`第 ${call} 次结果。`, `r${call}`, ['[look] 环顾四周']));
    const first = await post('/turns/stream', { userText: '请她留下', actionKind: 'say', baseRevision: 0 });
    expect(parseSse(await first.text())).toContainEqual(expect.objectContaining({ type: 'play.turn.committed', revision: 1 }));

    const retry = await post('/turns/turn-artifact-1/retry/stream', { baseRevision: 1, guidance: '别让她这么快答应。' });
    const events = parseSse(await retry.text());
    expect(events).toContainEqual(expect.objectContaining({ type: 'play.turn.committed', revision: 2 }));
    expect(requests[1]).toContain('<本次重演要求>');
    expect(requests[1]).toContain('别让她这么快答应。');
    expect(requests[1]).toContain('<玩家输入>请她留下</玩家输入>');

    const session = await read();
    const sibling = session.turnArtifacts.find((artifact) => artifact.id === 'turn-artifact-2')!;
    expect(sibling).toMatchObject({ retryGuidance: { sourceArtifactId: 'turn-artifact-1', text: '别让她这么快答应。' } });
    expect(sibling.parentTurnId).toBeUndefined();
    expect(session.turnArtifacts.find((artifact) => artifact.id === 'turn-artifact-1')).not.toHaveProperty('retryGuidance');

    // The next ordinary turn never sees the guidance again.
    const next = await post('/turns/stream', { userText: '再问一次', actionKind: 'say', baseRevision: 2 });
    expect(parseSse(await next.text())).toContainEqual(expect.objectContaining({ type: 'play.turn.committed', revision: 3 }));
    expect(requests[2]).not.toContain('别让她这么快答应。');
    expect(requests[2]).not.toContain('本次重演要求');

    const checkpoints = await (await fetch(`${endpoint}/checkpoints`)).json() as { checkpoints: Array<{ checkpointId: string; retryGuidance?: string }> };
    expect(checkpoints.checkpoints.find((item) => item.checkpointId === 'turn-artifact-2')?.retryGuidance).toBe('别让她这么快答应。');
  });

  it('rejects bad guidance or unknown fields before any model call or write', async () => {
    const { post, read, requests } = await setup(() => settlement('结果。', 'ok'));
    await (await post('/turns/stream', { userText: '等', actionKind: 'do', baseRevision: 0 })).text();
    const before = await read();
    for (const body of [
      { baseRevision: 1, guidance: '字'.repeat(501) },
      { baseRevision: 1, guidance: 7 },
      { baseRevision: 1, userText: '改写行动' },
    ]) {
      const response = await post('/turns/turn-artifact-1/retry/stream', body);
      expect(response.status).toBe(400);
    }
    expect(requests).toHaveLength(1);
    expect(await read()).toEqual(before);
  });

  it('keeps zero writes when a guided retry fails schema validation', async () => {
    const { post, read, root } = await setup((_request, call) => call === 1 ? settlement('结果。', 'ok') : 'no settlement block');
    await (await post('/turns/stream', { userText: '等', actionKind: 'do', baseRevision: 0 })).text();
    const before = await read();
    const turnsDir = join(root, '.workspace', 'play-sessions', 'guided', 'turns');
    const filesBefore = await readdir(turnsDir);
    const response = await post('/turns/turn-artifact-1/retry/stream', { baseRevision: 1, guidance: '换个结局' });
    expect(parseSse(await response.text()).some((event) => event.type === 'play.turn.committed')).toBe(false);
    expect(await read()).toEqual(before);
    expect(await readdir(turnsDir)).toEqual(filesBefore);
    expect(await readFile(join(turnsDir, 'turn-artifact-1.yaml'), 'utf8')).not.toContain('retryGuidance');
  });
});

describe('extra action suggestions over HTTP', () => {
  it('returns a temporary batch without touching revision, snapshot or selected branch', async () => {
    const { post, read, requests } = await setup((request) => request.includes('oan-play-suggestions')
      ? '```oan-play-suggestions\n{"suggestedActions":["[say] 问她要去哪","[look] 环顾四周","[move] 走向检票口"]}\n```'
      : settlement('她站在雨里。', 'rain', ['[look] 环顾四周']));
    await (await post('/turns/stream', { userText: '走近她', actionKind: 'move', baseRevision: 0 })).text();
    const before = await read();

    const response = await post('/suggestions', { baseRevision: 1, headId: 'turn-artifact-1', existing: ['[look] 环顾四周'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      suggestions: ['[say] 问她要去哪', '[move] 走向检票口'],
      baseRevision: 1,
      headId: 'turn-artifact-1',
    });
    expect(requests.at(-1)).toContain('只读');
    expect(requests.at(-1)).toContain('[look] 环顾四周');
    expect(requests.at(-1)).not.toContain('oan-play-settlement JSON');
    const after = await read();
    expect(after).toEqual(before);
    expect(after.suggestedActions).toEqual(['[look] 环顾四周']);
  });

  it('works at the initial world and refuses a stale head or revision', async () => {
    const { post, requests } = await setup((request) => request.includes('oan-play-suggestions')
      ? '```oan-play-suggestions\n{"suggestedActions":["[look] 看看车站"]}\n```'
      : settlement('结果。', 'ok'));
    const initial = await post('/suggestions', { baseRevision: 0 });
    expect(initial.status).toBe(200);
    expect(requests[0]).toContain('<开场>雨夜车站</开场>');
    expect((await post('/suggestions', { baseRevision: 3 })).status).toBe(409);
    expect((await post('/suggestions', { baseRevision: 0, headId: 'turn-artifact-9' })).status).toBe(409);
    expect((await post('/suggestions', { baseRevision: 0, extra: true })).status).toBe(400);
    expect(requests).toHaveLength(1);
  });

  it('reports a malformed model reply after exactly one call', async () => {
    const { post, read, requests } = await setup(() => 'not json at all');
    const before = await read();
    const response = await post('/suggestions', { baseRevision: 0 });
    expect(response.status).toBe(422);
    expect(requests).toHaveLength(1);
    expect(await read()).toEqual(before);
  });
});
