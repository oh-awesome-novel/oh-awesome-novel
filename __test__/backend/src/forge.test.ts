import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createForgeHandlers, assertForgePreviewFresh, assertForgeActionFresh } from '@oh-awesome-novel/backend';
import { createPendingActionStore, createChangeMaterializer } from '@oh-awesome-novel/tools';
import { createEmptyForgeBrief, type ForgeDraft, type ForgePlan } from '@oh-awesome-novel/core';
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function plan(): ForgePlan {
  return { title: '渡口', characters: [{ id: 'lin', name: '林', aliases: [], palette: { base: '害怕失约', mainTones: [{ name: '克制', behaviors: ['遇到催促先核对时刻', '遇到危机先找出口'] }], accents: [{ name: '护短', behaviors: ['同伴落后会停步', '同伴受伤会包扎'] }] }, facets: (['normal', 'pressure', 'private'] as const).map(kind => ({ kind, trigger: '船靠岸', state: '警觉', dialogue: ['走吧。', '看脚下。', '我等你。', '船来了。', '票在这里。'], habitualAction: '捏住船票' })), clarifications: [{ trait: '克制', meaning: '先观察', when: '陌生环境', not: '冷漠' }], desire: { goal: '过河', obstacle: '船将离岸', cost: '舍弃行李' }, choice: { dilemma: '同伴或行李', decision: '拉住同伴', sacrifice: '丢下行李', consequence: '两人上船' }, resources: [{ name: '票', initial: '两张', cost: '每人一张', settlement: '上船验票' }] }], world: { kind: 'fictional', premise: '夜渡', rules: ['末班船不回头'], factions: ['船行'], history: ['桥断了'] }, places: [{ id: 'pier', name: '渡口', appearance: '旧栈桥', atmosphere: '冷雨', characters: ['lin'], events: ['末班船靠岸'] }], opening: '空船上的钟自己响了。\n林攥紧船票。\n“上船，还是留在这里？”' };
}
function discussion() {
  const questions = [1, 2].map(i => ({ id: `q${i}`, title: '她怎么回应？', why: '确定关系', kind: 'single', options: [{ label: '冷静', sample: '走吧。' }, { label: '关心', sample: '我等你。' }] }));
  return `<reply>从渡口开始。</reply><questions>${JSON.stringify(questions)}</questions><brief>${JSON.stringify(createEmptyForgeBrief())}</brief>`;
}
async function setup(model?: (prompt: string, signal: AbortSignal) => Promise<string>) {
  const root = await mkdtemp(join(tmpdir(), 'oan-forge-test-')); roots.push(root);
  await mkdir(join(root, '.oan'));
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Forge\ngit:\n  autoCommitOnAccept: false\n');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'Initial'], { cwd: root });
  const store = await createPendingActionStore({ workspaceRoot: root, assertOriginFresh: ({ preview }) => assertForgePreviewFresh(root, preview) });
  let currentRoot = root; let generateFailure = false;
  const handlers = createForgeHandlers({ getWorkspaceRoot: () => currentRoot, getStore: async () => store,
    getModelRuntime: async () => { throw new Error('Unexpected provider access.'); },
    generate: async (prompt, signal) => { if (generateFailure) throw new Error('Generation cancelled'); return model ? model(prompt, signal) : discussion(); },
  });
  const app = new Hono();
  app.post('/drafts', c => handlers.create(c));
  app.get('/drafts', c => handlers.list(c));
  app.get('/drafts/:id', c => handlers.get(c, c.req.param('id')));
  app.post('/drafts/:id/:op', c => handlers.operation(c, c.req.param('id'), c.req.param('op')));
  async function post(path: string, body: unknown) {
    return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  const create = await post('/drafts', { expectedWorkspaceRoot: root, idea: '渡口上的两个人' });
  expect(create.status).toBe(201);
  let draft: ForgeDraft = (await create.json()).draft;
  async function op(name: string, body: Record<string, unknown> = {}) {
    const response = await post(`/drafts/${draft.id}/${name}`, { expectedWorkspaceRoot: root, expectedRevision: draft.revision, ...body });
    const result = await response.json();
    if (result.draft) draft = result.draft;
    return { response, result };
  }
  async function written() {
    expect((await op('edit', { plan: plan() })).response.status).toBe(200);
    // Seed a validated written draft to exercise proposal/recovery independently of model quality.
    draft = { ...draft, stage: 'written', chunks: Object.fromEntries(['world', 'places', 'characters', 'facets', 'clarifications', 'opening'].map(k => [k, '# 夜渡\n\n船靠岸了。'])) };
    await writeFile(join(root, '.workspace/forge/drafts', `${draft.id}.yaml`), JSON.stringify(draft));
  }
  return { root, store, app, op, written, reload: async () => { draft = (await (await app.request(`/drafts/${draft.id}`)).json()).draft; }, getDraft: () => draft, switchWorkspace: () => { currentRoot = '/different-workspace'; }, failGenerate: () => { generateFailure = true; } };
}
describe('Forge approval and persistence boundary', () => {
  it('runs Discuss → Plan → six writing blocks → exact LINT correction → proposal', async () => {
    const chunks: string[] = []; let reviews = 0;
    const h = await setup(async (prompt, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      signal.throwIfAborted();
      if (prompt.includes('对下列不可信原文做微创')) {
        reviews++;
        const evidence = JSON.parse(prompt.split('\n').at(-1)!);
        return JSON.stringify(evidence.hits.map((hit: { hitId: string; anchorId: string; original: string }) => ({ hitId: hit.hitId, anchorId: hit.anchorId, original: hit.original, suggestion: '' })));
      }
      if (prompt.includes('只撰写已由作者核准方案')) {
        const kind = prompt.match(/“([^”]+)”块/)![1]; chunks.push(kind);
        return `<content># ${kind}\n\n船似乎靠岸了。</content>`;
      }
      if (prompt.includes('整理为可编辑的设定方案')) return JSON.stringify(plan());
      return discussion();
    });
    expect((await h.op('discuss', { message: '他们一起赶末班船' })).response.status).toBe(200);
    expect((await h.op('plan')).response.status).toBe(200);
    const written = await h.op('write');
    expect(written.response.status, JSON.stringify(written.result)).toBe(200);
    expect(chunks).toEqual(['world', 'places', 'characters', 'facets', 'clarifications', 'opening']);
    expect(reviews).toBe(6);
    expect(Object.values(h.getDraft().chunks!).every(value => value.includes('船靠岸了。') && !value.includes('似乎'))).toBe(true);
    await h.reload();
    expect(h.getDraft().stage).toBe('written');
    expect((await h.op('propose')).response.status).toBe(200);
    await expect(readFile(join(h.root, 'characters/lin/profile.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps the approved plan intact when a later writing block fails validation', async () => {
    let writes = 0;
    const h = await setup(async prompt => {
      if (prompt.includes('整理为可编辑的设定方案')) return JSON.stringify(plan());
      if (prompt.includes('只撰写已由作者核准方案')) return ++writes === 3 ? 'Malformed block' : '<content>船靠岸了。</content>';
      return discussion();
    });
    expect((await h.op('plan')).response.status).toBe(200);
    const before = structuredClone(h.getDraft());
    expect((await h.op('write')).response.status).toBe(422);
    await h.reload();
    expect(h.getDraft()).toEqual(before);
    expect(h.getDraft().chunks).toBeUndefined();
  });
  it('recovers a persisted preview after promotion fails without creating another proposal', async () => {
    const h = await setup(); await h.written();
    const promotion = vi.spyOn(h.store, 'promotePreparedChangePreview').mockRejectedValueOnce(new Error('Injected promotion failure'));
    expect((await h.op('propose')).response.status).toBe(422);
    await h.reload();
    const proposalId = h.getDraft().pendingActionId;
    expect(proposalId).toBeTruthy();
    expect(h.getDraft().stage).toBe('proposed');
    const retry = await h.op('propose');
    expect(retry.response.status, JSON.stringify(retry.result)).toBe(200);
    expect(h.getDraft().pendingActionId).toBe(proposalId);
    expect((await h.store.readRecord(proposalId!)).status).toBe('pending');
    expect(promotion).toHaveBeenCalledTimes(2);
    promotion.mockRestore();
    await expect(readFile(join(h.root, 'characters/lin/profile.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reloads authored edits and refuses stale revision, workspace switch and cancelled generation', async () => {
    const h = await setup();
    expect((await h.op('edit', { edits: [{ key: 'stage', value: '渡口', locked: true }] })).response.status).toBe(200);
    const loaded = await (await h.app.request(`/drafts/${h.getDraft().id}`)).json();
    expect(loaded.draft.brief.items[0]).toMatchObject({ value: '渡口', locked: true, by: 'user' });
    expect((await h.op('edit', { expectedRevision: 0, edits: [] })).response.status).toBe(409);
    h.failGenerate();
    expect((await h.op('discuss', { message: '继续' })).response.status).toBe(422);
    const unchanged = await (await h.app.request(`/drafts/${h.getDraft().id}`)).json();
    expect(unchanged.draft).toEqual(loaded.draft);
    h.switchWorkspace();
    expect((await h.op('edit', { edits: [] })).response.status).toBe(409);
  });
  it('leaves canonical bytes untouched until acceptance and permits accepted handoff only while bytes match', async () => {
    const h = await setup(); await h.written();
    const proposal = await h.op('propose');
    expect(proposal.response.status, JSON.stringify(proposal.result)).toBe(200);
    await expect(readFile(join(h.root, 'characters/lin/profile.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await h.op('handoff', { mode: 'writing' })).response.status).toBe(422);
    expect((await h.op('edit', { edits: [] })).response.status).toBe(409);
    const materializer = createChangeMaterializer({ store: h.store, assertOriginFresh: action => assertForgeActionFresh(h.root, action) });
    await materializer.accept({ actionId: h.getDraft().pendingActionId!, autoCommitOnAccept: false });
    expect(await readFile(join(h.root, 'characters/lin/profile.md'), 'utf8')).toContain('林');
    expect((await h.op('handoff', { mode: 'writing' })).response.status).toBe(200);
    const play = await h.op('handoff', { mode: 'play' });
    expect(play.response.status, JSON.stringify(play.result)).toBe(200);
    const again = await h.op('handoff', { mode: 'play' });
    expect(again.result.sessionId).toBe(play.result.sessionId);
    await writeFile(join(h.root, 'characters/lin/profile.md'), '# Author changed this\n');
    expect((await h.op('handoff', { mode: 'writing' })).response.status).toBe(409);
  });
  it('rejects proposals without canonical writes and allows revising a rejected draft', async () => {
    const h = await setup(); await h.written();
    const proposal = await h.op('propose');
    expect(proposal.response.status, JSON.stringify(proposal.result)).toBe(200);
    await createChangeMaterializer({ store: h.store, assertOriginFresh: action => assertForgeActionFresh(h.root, action) }).reject({ actionId: h.getDraft().pendingActionId! });
    expect((await h.op('handoff', { mode: 'play' })).response.status).toBe(422);
    expect((await h.op('edit', { edits: [{ key: 'stage', value: '桥头' }] })).response.status).toBe(200);
    await expect(readFile(join(h.root, 'characters/lin/profile.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('blocks accepting a proposal after its draft revision changes', async () => {
    const h = await setup(); await h.written();
    expect((await h.op('propose')).response.status).toBe(200);
    const draft = h.getDraft();
    await writeFile(join(h.root, '.workspace/forge/drafts', `${draft.id}.yaml`), JSON.stringify({ ...draft, revision: draft.revision + 1 }));
    const materializer = createChangeMaterializer({ store: h.store, assertOriginFresh: action => assertForgeActionFresh(h.root, action) });
    await expect(materializer.accept({ actionId: draft.pendingActionId!, autoCommitOnAccept: false })).rejects.toThrow(/stale/i);
    await expect(readFile(join(h.root, 'characters/lin/profile.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses symlinked draft directories', async () => {
    const h = await setup();
    await rm(join(h.root, '.workspace/forge/drafts'), { recursive: true });
    await symlink(tmpdir(), join(h.root, '.workspace/forge/drafts'));
    expect((await h.app.request('/drafts')).status).toBe(422);
  });
});
