import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createNovelHonoApp, createForgeHandlers, assertForgePreviewFresh, assertForgeActionFresh, forgeCanonicalFiles, forgeCanonicalPaths } from '@oh-awesome-novel/backend';
import { createPendingActionStore, createChangeMaterializer } from '@oh-awesome-novel/tools';
import { createEmptyForgeBrief, forgeChunkKeys, type ForgeDraft, type ForgePlan } from '@oh-awesome-novel/core';
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
  app.delete('/drafts/:id', c => handlers.delete(c, c.req.param('id')));
  app.patch('/drafts/:id', c => handlers.operation(c, c.req.param('id'), 'edit'));
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
    draft = { ...draft, stage: 'written', chunks: Object.fromEntries(forgeChunkKeys(plan()).map(k => [k, `${k}：船靠岸了。`])) };
    await writeFile(join(root, '.workspace/forge/drafts', `${draft.id}.yaml`), JSON.stringify(draft));
  }
  return { root, store, app, op, written, reload: async () => { draft = (await (await app.request(`/drafts/${draft.id}`)).json()).draft; }, getDraft: () => draft, switchWorkspace: () => { currentRoot = '/different-workspace'; }, failGenerate: () => { generateFailure = true; } };
}
describe('Forge approval and persistence boundary', () => {
  it('binds initial intent and selected answers to host evidence across contradictory model replies', async () => {
    let calls = 0;
    const h = await setup(async () => {
      calls++;
      if (calls === 1) return discussion();
      const brief = { title: '渡口', readiness: 100, items: [
        { key: 'tone', label: '语气', value: calls === 2 ? '冷静' : '暴躁', by: 'user' },
        { key: 'stage', label: '舞台', value: '模型捏造的夜城', by: 'user' },
        { key: 'play', label: '初衷', value: '模型偷换初衷', by: 'user' },
      ], openPoints: [] };
      return discussion().replace(/<brief>[\s\S]*?<\/brief>/, `<brief>${JSON.stringify(brief)}</brief>`);
    });
    expect(h.getDraft().brief.items.find(item => item.key === 'play')).toMatchObject({value:'渡口上的两个人',by:'user'});
    expect((await h.op('discuss', {message:'选择冷静',selection:{questionId:'q1',optionIndices:[0]}})).response.status).toBe(200);
    expect(h.getDraft().brief.items.find(item => item.key === 'tone')).toMatchObject({value:'冷静',by:'user'});
    expect(h.getDraft().brief.items.find(item => item.key === 'stage')).toMatchObject({by:'assistant'});
    expect((await h.op('discuss', {message:'继续讨论'})).response.status).toBe(200);
    expect(h.getDraft().brief.items.find(item => item.key === 'tone')).toMatchObject({value:'冷静',by:'user'});
    expect(h.getDraft().brief.items.find(item => item.key === 'play')).toMatchObject({value:'渡口上的两个人',by:'user'});
    const before = h.getDraft();
    expect((await h.op('discuss', {message:'伪造选择',selection:{questionId:'q1',optionIndices:[999]}})).response.status).toBe(422);
    await h.reload(); expect(h.getDraft()).toEqual(before);
  });

  it('adds a section to existing world rules and keeps every other file to its own object', () => {
    const two: ForgePlan = { ...plan(), characters: [plan().characters[0]!, { ...plan().characters[0]!, id: 'yu', name: '渔' }] };
    const chunks = Object.fromEntries(forgeChunkKeys(two).map(key => [key, `${key} 正文`]));
    const files = forgeCanonicalFiles(two, chunks, '# 世界规则\n\n旧的潮汐规则。\n');
    expect(files.map(file => file.path)).toEqual(forgeCanonicalPaths(two));
    const content = (path: string) => files.find(file => file.path === path)!.content;
    expect(content('world/rules.md')).toBe('# 世界规则\n\n旧的潮汐规则。\n\n## 渡口\n\nworld 正文\n');
    expect(content('characters/lin/profile.md')).toContain('characters:lin 正文');
    expect(content('characters/lin/profile.md')).not.toContain('characters:yu');
    expect(content('characters/yu/profile.md')).not.toContain(':lin');
    expect(content('characters/yu/roster-profile.yaml')).toContain('name: 渔');
  });
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
        const ids = [...prompt.matchAll(/<content id="([^"]+)">正文/g)].map(match => match[1]);
        return ids.length ? ids.map(id => `<content id="${id}">${kind} ${id}\n船似乎靠岸了。</content>`).join('') : `<content>${kind}\n船似乎靠岸了。</content>`;
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
    expect(loaded.draft.brief.items.find((item: {key: string}) => item.key === 'stage')).toMatchObject({ value: '渡口', locked: true, by: 'user' });
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
    // Each canonical file is readable Markdown holding only its own object's written blocks.
    const profile = await readFile(join(h.root, 'characters/lin/profile.md'), 'utf8');
    expect(profile).toBe('# 林\n\n## 角色档案\n\ncharacters:lin：船靠岸了。\n\n## 三面性\n\nfacets:lin：船靠岸了。\n\n## 特质边界\n\nclarifications:lin：船靠岸了。\n');
    expect(await readFile(join(h.root, 'world/places/pier.md'), 'utf8')).toBe('# 渡口\n\nplaces:pier：船靠岸了。\n');
    expect(await readFile(join(h.root, 'world/rules.md'), 'utf8')).toContain('world：船靠岸了。');
    const writing = await h.op('handoff', { mode: 'writing' });
    expect(writing.response.status).toBe(200);
    expect(writing.result.sourcePaths).toEqual(['world/rules.md', 'characters/lin/profile.md', 'world/places/pier.md', 'characters/lin/roster-profile.yaml']);
    let received: unknown;
    const chat = createNovelHonoApp({ workspaceRoot: h.root, runAgent: async function* (input) { received = input; } });
    const response = await chat.request('/api/agent/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: '依据工坊设定讨论下一幕', canonicalWritingSourcePaths: writing.result.sourcePaths }) });
    await response.text();
    expect(response.status).toBe(200);
    expect(received).toMatchObject({ exactWritablePaths: [], canonicalWritingContext: { items: expect.arrayContaining([
      expect.objectContaining({ content: await readFile(join(h.root, 'characters/lin/profile.md'), 'utf8') }),
      expect.objectContaining({ content: await readFile(join(h.root, 'world/rules.md'), 'utf8') }),
    ]) } });
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
  it('supports multi-question batching in discuss stage', async () => {
    const h = await setup(async () => {
      const brief = { title: '渡口', readiness: 90, items: [
        { key: 'tone', label: '语气', value: '冷静', by: 'user' },
        { key: 'stage', label: '舞台', value: '渡口', by: 'user' },
      ], openPoints: [] };
      return discussion().replace(/<brief>[\s\S]*?<\/brief>/, `<brief>${JSON.stringify(brief)}</brief>`);
    });
    const res = await h.op('discuss', {
      message: '我们是同伴',
      selections: [{ questionId: 'q1', optionIndices: [0] }],
    });
    expect(res.response.status).toBe(200);
    expect(h.getDraft().brief.items.find(item => item.key === 'tone')).toMatchObject({ value: '冷静', by: 'user' });

    // Also test selection-only submission without freeform message
    const selOnly = await h.op('discuss', {
      selections: [{ questionId: 'q2', optionIndices: [1] }],
    });
    expect(selOnly.response.status).toBe(200);
  });
  it('supports in-place chunk updates via edit and deletes drafts', async () => {
    const h = await setup(); await h.written();
    const updated = await h.op('edit', { chunks: { opening: '新的开场白。' } });
    expect(updated.response.status).toBe(200);
    expect(h.getDraft().chunks?.opening).toBe('新的开场白。');

    const draftId = h.getDraft().id;
    const delRes = await h.app.request(`/drafts/${draftId}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
    const getRes = await h.app.request(`/drafts/${draftId}`);
    expect(getRes.status).toBe(422);
  });
  it('persists T03, T04, and roster profile metadata into canonical files', () => {
    const p = plan();
    p.characters[0]!.name = '少女林';
    p.characters[0]!.choice = { dilemma: '留或走', decision: '留下来', sacrifice: '自由', consequence: '被困渡口' };
    p.characters[0]!.resources = [{ name: '铜钱', initial: '三文', cost: '每晚一文', settlement: '归零即死' }];
    const chunks = Object.fromEntries(forgeChunkKeys(p).map(k => [k, `${k} 正文`]));
    const files = forgeCanonicalFiles(p, chunks);
    const summary = files.find(f => f.path.endsWith('summary.md'))!;
    expect(summary.content).toContain('## 主动抉择 (T03)');
    expect(summary.content).toContain('- 两难：留或走');
    expect(summary.content).toContain('- 决断：留下来');
    expect(summary.content).toContain('## 资源账本 (T04)');
    expect(summary.content).toContain('**铜钱**：初态 三文 | 消耗 每晚一文 | 结算兑现 归零即死');

    const roster = files.find(f => f.path.endsWith('roster-profile.yaml'))!;
    expect(roster.content).toContain('id: lin');
    expect(roster.content).toContain('name: 少女林');
    expect(roster.content).toContain('genderKind: girl');
    expect(roster.content).toContain('fixedBooruTags: 1girl, lin');
  });
  it('recovers from orphaned stale lock leases automatically', async () => {
    const h = await setup();
    const draft = h.getDraft();
    const lockPath = join(h.root, '.workspace/forge/drafts', `${draft.id}.lock`);
    // Create an orphaned lock file with a non-existent PID and old timestamp
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, createdAt: Date.now() - 4 * 60 * 1000 }));
    // Operation should self-heal the orphaned lock and succeed
    const res = await h.op('edit', { edits: [{ key: 'stage', value: '新舞台', locked: true }] });
    expect(res.response.status).toBe(200);
    expect(h.getDraft().brief.items.find(i => i.key === 'stage')?.value).toBe('新舞台');
  });
});
