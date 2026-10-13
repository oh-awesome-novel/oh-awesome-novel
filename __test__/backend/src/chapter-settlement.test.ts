import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { parse } from 'yaml';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createChapterSettlementSource } from '@oh-awesome-novel/core';
import type { PendingActionView } from '@oh-awesome-novel/tools';

const git = promisify(execFile); const roots: string[] = []; const servers: Array<{ close(): Promise<void> }> = [];
const content = '# 第一章\n\n林安拿起钥匙。\n林安受伤后仍护住同伴。\n翌日清晨，他抵达旧城。\n钥匙打开了秘门。\n'; const chapterPath = 'chapters/0001/0001.md';
const usage = { inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } };
type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;
function response(chunks: ProviderPart[]) { return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) }; }
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function observations(invalidEvidence = false) {
  return { schemaVersion: 1, chapterId: '0001/0001', sourceHash: createChapterSettlementSource('0001/0001', content).sourceHash,
    observations: [{ id: 'key', category: 'item', subject: '林安', observation: '持有钥匙', confidence: 'high', evidence: { startLine: 3, endLine: 3, quote: invalidEvidence ? '未发生的计划' : '林安拿起钥匙。' } }], unresolvedAmbiguities: ['钥匙所有权未说明'] };
}
async function fixture(options: { invalidEvidence?: boolean; proposal?: unknown; files?: Record<string, string> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oan-settlement-backend-')); roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true }); await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: settlement\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, chapterPath), content);
  for (const [path, bytes] of Object.entries(options.files ?? {})) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  await git('git', ['init', '-b', 'main', root]); await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  const proposal = options.proposal ?? observations(options.invalidEvidence);
  let modelStep = 0;
  const model = new MockLanguageModelV4({ doStream: async () => ++modelStep % 2 === 1 ? response([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: `settlement-${modelStep}`, toolName: 'settlement.propose', input: JSON.stringify(proposal) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage },
  ]) : response([
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'report' },
    { type: 'text-delta', id: 'report', delta: '请审阅正文证据；钥匙所有权仍不明确。' }, { type: 'text-end', id: 'report' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ]) });
  const start = () => startNovelHttpBackend({ workspaceRoot: root,
    providerConfig: { id: 'settlement-test', kind: 'custom', model: 'settlement-test' }, resolveModel: () => model });
  const backend = await start(); servers.push(backend);
  return { root, backend, model, async reopen() {
    await backend.close(); servers.splice(servers.indexOf(backend), 1);
    const reopened = await start(); servers.push(reopened); return reopened;
  } };
}
async function chat(url: string, paths = [chapterPath], expectedStatus = 200) {
  const response = await fetch(`${url}/api/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    messages: [{ id: 'request', role: 'user', parts: [{ type: 'text', text: '/整理本章' }] }], editContext: { exactWritablePaths: paths },
  }) });
  expect(response.status).toBe(expectedStatus); return response.text();
}
async function pending(url: string) { return (await (await fetch(`${url}/api/workspace/pending-actions`)).json()) as { pendingActions: PendingActionView[] }; }
async function decide(url: string, id: string, decision: 'accept' | 'reject') {
  return fetch(`${url}/api/workspace/pending-actions/${id}/${decision}`, { method: 'POST' });
}
async function assertFiles(root: string, files: Record<string, string | undefined>) {
  for (const [path, bytes] of Object.entries(files)) {
    if (bytes === undefined) await expect(readFile(join(root, path))).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await readFile(join(root, path), 'utf8'), path).toBe(bytes);
  }
}
const domainFiles = {
  'characters/hero/meta.yaml': 'id: hero\nname: 林安\n',
  'characters/hero/growth.md': '# 林安的成长\n\n作者保留的人物成长笔记。\n',
  'state/characters.yaml': 'characters:\n  hero:\n    hp: normal\n    emotion: 谨慎\n',
  'timeline/events.yaml': 'events:\n  - id: author-event\n    order: 1\n    time: 前一夜\n    title: 作者已有事件\n',
  'foreshadow/active.yaml': 'active:\n  - id: key_door\n    status: active\n    firstChapter: "0001/0001"\n    description: 作者设定钥匙能开启秘门。\n    relatedCharacters: [hero]\n    authorNote: 保留此批注\n  - id: distant_light\n    status: active\n    description: 远处未解释的光\n',
  'foreshadow/resolved.yaml': 'resolved: []\n',
};
const domainPaths = [
  'characters/hero/growth.md', 'foreshadow/active.yaml', 'foreshadow/resolved.yaml',
  'state/chapters/0001/0001.yaml', 'state/characters.yaml', 'summaries/chapter/0001/0001.md', 'timeline/events.yaml',
];
function domainObservations() {
  const base = observations();
  const at = (line: number) => ({ startLine: line, endLine: line, quote: content.split('\n')[line - 1]! });
  return { ...base, observations: [...base.observations,
    { id: 'injury', category: 'injury', subject: '林安', observation: '身体受伤', confidence: 'high', evidence: at(4) },
    { id: 'arrival', category: 'time', subject: '林安', observation: '翌日清晨抵达旧城', confidence: 'high', evidence: at(5) },
    { id: 'door', category: 'foreshadow', subject: '钥匙', observation: '钥匙打开秘门', confidence: 'high', evidence: at(6) },
    { id: 'growth', category: 'character', subject: '林安', observation: '受伤后仍保护同伴', confidence: 'high', evidence: at(4) },
  ], domainChanges: [
    { domain: 'state', observationId: 'injury', characterId: 'hero', field: 'hp', expectedValue: 'normal', value: 'injured' },
    { domain: 'timeline', observationId: 'arrival', title: '抵达旧城', time: '翌日清晨' },
    { domain: 'foreshadow', observationId: 'door', operation: 'resolve', hookId: 'key_door', expectedStatus: 'active' },
    { domain: 'character', observationId: 'growth', characterId: 'hero' },
  ] };
}
const domainBaseline = () => ({ ...domainFiles, [chapterPath]: content,
  'state/chapters/0001/0001.yaml': undefined, 'summaries/chapter/0001/0001.md': undefined });

describe('default model-backed chapter settlement HTTP journey', () => {
  it('approves all settlement domains together, preserves author data and makes replay a no-op', async () => {
    const f = await fixture({ files: domainFiles, proposal: domainObservations() });
    const beforeHead = (await git('git', ['-C', f.root, 'rev-parse', 'HEAD'])).stdout;
    const wire = await chat(f.backend.url);
    expect(wire).toContain('data-pending-action');
    expect(wire).not.toContain('.workspace/change-engine');
    const actions = (await pending(f.backend.url)).pendingActions; expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.changes.map((change) => change.path)).toEqual(domainPaths);
    expect(action.origin).toMatchObject({ kind: 'chapterSettlement', chapterId: '0001/0001' });
    await assertFiles(f.root, domainBaseline());

    const accepted = await decide(f.backend.url, action.id, 'accept');
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ pendingAction: { status: 'accepted' }, appliedFiles: domainPaths,
      receipt: { git: { status: 'not-requested' } } });
    expect(parse(await readFile(join(f.root, 'state/characters.yaml'), 'utf8'))).toMatchObject({
      characters: { hero: { hp: 'injured', emotion: '谨慎' } },
    });
    const timeline = parse(await readFile(join(f.root, 'timeline/events.yaml'), 'utf8'));
    expect(timeline.events).toHaveLength(2);
    expect(timeline.events[0]).toMatchObject({ id: 'author-event', title: '作者已有事件' });
    expect(timeline.events[1]).toMatchObject({ title: '抵达旧城', time: '翌日清晨', chapter: '0001/0001' });
    expect(parse(await readFile(join(f.root, 'foreshadow/active.yaml'), 'utf8')).active).toEqual([
      { id: 'distant_light', status: 'active', description: '远处未解释的光' },
    ]);
    expect(parse(await readFile(join(f.root, 'foreshadow/resolved.yaml'), 'utf8')).resolved).toMatchObject([
      { id: 'key_door', status: 'resolved', description: '作者设定钥匙能开启秘门。', authorNote: '保留此批注', resolvedChapter: '0001/0001' },
    ]);
    const growth = await readFile(join(f.root, 'characters/hero/growth.md'), 'utf8');
    expect(growth.startsWith(domainFiles['characters/hero/growth.md'])).toBe(true);
    expect(growth).toContain('受伤后仍保护同伴');
    await assertFiles(f.root, { [chapterPath]: content, 'characters/hero/meta.yaml': domainFiles['characters/hero/meta.yaml'] });
    expect((await git('git', ['-C', f.root, 'rev-parse', 'HEAD'])).stdout).toBe(beforeHead);

    const acceptedFiles = Object.fromEntries(await Promise.all(domainPaths.map(async (path) => [path, await readFile(join(f.root, path), 'utf8')])));
    const duplicateAccept = await decide(f.backend.url, action.id, 'accept');
    expect(duplicateAccept.status).toBe(409);
    expect(await duplicateAccept.json()).toMatchObject({ code: 'PENDING_ACTION_TERMINAL_CONFLICT' });
    const repeatedWire = await chat(f.backend.url);
    expect(repeatedWire).not.toContain('data-pending-action');
    expect(repeatedWire).not.toContain('tool-output-error');
    expect((await pending(f.backend.url)).pendingActions).toEqual([]);
    await assertFiles(f.root, acceptedFiles);
  });
  it('settles a revised source once without duplicating its accepted domain facts', async () => {
    const proposal = domainObservations();
    const f = await fixture({ files: domainFiles, proposal });
    await chat(f.backend.url); const first = (await pending(f.backend.url)).pendingActions[0]!;
    expect((await decide(f.backend.url, first.id, 'accept')).status).toBe(200);
    const originalHash = proposal.sourceHash;
    const preservedPaths = domainPaths.filter((path) => !path.startsWith('state/chapters/') && !path.startsWith('summaries/'));
    const preserved = Object.fromEntries(await Promise.all(preservedPaths.map(async (path) => [path, await readFile(join(f.root, path), 'utf8')])));
    const revisedContent = `${content}\n作者补充了不改变既有事件的收尾。\n`;
    await writeFile(join(f.root, chapterPath), revisedContent);
    proposal.sourceHash = createChapterSettlementSource('0001/0001', revisedContent).sourceHash;
    const revisedWire = await chat(f.backend.url);
    expect(revisedWire).not.toContain('tool-output-error');
    const revised = (await pending(f.backend.url)).pendingActions; expect(revised).toHaveLength(1);
    expect(revised[0]!.changes.map((change) => change.path)).toEqual(['state/chapters/0001/0001.yaml', 'summaries/chapter/0001/0001.md']);
    expect((await decide(f.backend.url, revised[0]!.id, 'accept')).status).toBe(200);
    await assertFiles(f.root, { ...preserved, [chapterPath]: revisedContent });
    const state = parse(await readFile(join(f.root, 'state/chapters/0001/0001.yaml'), 'utf8'));
    expect(state.sourceHash).toBe(proposal.sourceHash);
    expect(state.settlementRecords).toMatchObject([{ sourceHash: originalHash }]);
    const repeatedWire = await chat(f.backend.url);
    expect(repeatedWire).not.toContain('tool-output-error');
    expect(repeatedWire).not.toContain('data-pending-action');
    expect((await pending(f.backend.url)).pendingActions).toEqual([]);
    await assertFiles(f.root, preserved);
  });
  it.each(['characters/hero/meta.yaml', 'state/characters.yaml'] as const)(
    'rejects a stale domain dependency without partially applying the other files: %s', async (changedPath) => {
      const f = await fixture({ files: domainFiles, proposal: domainObservations() });
      await chat(f.backend.url); const action = (await pending(f.backend.url)).pendingActions[0]!;
      const restarted = await f.reopen();
      expect((await pending(restarted.url)).pendingActions.map((item) => item.id)).toEqual([action.id]);
      const changed = changedPath === 'characters/hero/meta.yaml' ? 'id: hero\nname: 作者改名\n' : 'characters:\n  hero:\n    hp: recovering\n';
      await writeFile(join(f.root, changedPath), changed);
      const accepted = await decide(restarted.url, action.id, 'accept');
      expect(accepted.status).toBe(409);
      expect(await accepted.json()).toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
      await assertFiles(f.root, { ...domainBaseline(), [changedPath]: changed });
      expect((await pending(restarted.url)).pendingActions.map((item) => item.id)).toEqual([action.id]);
    },
  );
  it('refuses Accept when a newly added character makes the proposed name mapping ambiguous', async () => {
    const f = await fixture({ files: domainFiles, proposal: domainObservations() });
    await chat(f.backend.url); const action = (await pending(f.backend.url)).pendingActions[0]!;
    const addedPath = 'characters/rival/meta.yaml'; const added = 'id: rival\nname: 林安\n';
    await mkdir(dirname(join(f.root, addedPath)), { recursive: true });
    await writeFile(join(f.root, addedPath), added);
    const restarted = await f.reopen();
    const response = await decide(restarted.url, action.id, 'accept');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    await assertFiles(f.root, { ...domainBaseline(), [addedPath]: added });
    expect((await pending(restarted.url)).pendingActions.map((item) => item.id)).toEqual([action.id]);
  });
  it('reports an unresolved state conflict without promoting that observation into any truth file', async () => {
    const proposal = domainObservations(); proposal.domainChanges[0]!.expectedValue = 'healthy';
    const f = await fixture({ files: domainFiles, proposal });
    const wire = await chat(f.backend.url);
    expect(wire).not.toContain('tool-output-error');
    const actions = (await pending(f.backend.url)).pendingActions; expect(actions).toHaveLength(1);
    expect(actions[0]!.changes.map((change) => change.path)).not.toContain('state/characters.yaml');
    expect(actions[0]!.diff).not.toContain('身体受伤');
    await assertFiles(f.root, domainBaseline());
    const accepted = await decide(f.backend.url, actions[0]!.id, 'accept');
    expect(accepted.status).toBe(200);
    expect(await readFile(join(f.root, 'state/characters.yaml'), 'utf8')).toBe(domainFiles['state/characters.yaml']);
    const chapterState = parse(await readFile(join(f.root, 'state/chapters/0001/0001.yaml'), 'utf8'));
    expect(chapterState.observations.map((item: { id: string }) => item.id)).not.toContain('injury');
    expect(await readFile(join(f.root, 'summaries/chapter/0001/0001.md'), 'utf8')).not.toContain('身体受伤');
  });
  it('does not assign a supported chapter fact to a different existing character', async () => {
    const files = { 'characters/rival/meta.yaml': 'id: rival\nname: 任野\n', 'state/characters.yaml': 'characters:\n  rival: {}\n' };
    const proposal = { ...observations(), domainChanges: [
      { domain: 'state', observationId: 'key', characterId: 'rival', field: 'inventory', expectedValue: null, value: '钥匙' },
    ] };
    const f = await fixture({ files, proposal }); const wire = await chat(f.backend.url);
    expect(wire).not.toContain('tool-output-error');
    expect(wire).not.toContain('data-pending-action');
    expect(wire).toContain('subject does not match');
    expect((await pending(f.backend.url)).pendingActions).toEqual([]);
    await assertFiles(f.root, { ...files, [chapterPath]: content,
      'state/chapters/0001/0001.yaml': undefined, 'summaries/chapter/0001/0001.md': undefined });
  });
  it('flows through real SDK, capability factory, SSE, persisted approval and canonical Accept', async () => {
    const f = await fixture(); const wire = await chat(f.backend.url);
    expect(wire).toContain('data-pending-action'); expect(wire).toContain('chapterSettlement');
    expect(wire).not.toContain('.workspace/change-engine');
    expect(f.model.doStreamCalls[0]!.tools?.map((tool) => 'name' in tool ? tool.name : '')).toEqual(['readFile', 'settlement.propose']);
    expect(JSON.stringify(f.model.doStreamCalls[0]!.prompt)).toContain('sourceHash:');
    const actions = (await pending(f.backend.url)).pendingActions; expect(actions).toHaveLength(1);
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    const accepted = await fetch(`${f.backend.url}/api/workspace/pending-actions/${actions[0]!.id}/accept`, { method: 'POST' });
    expect(await accepted.json()).toMatchObject({ pendingAction: { status: 'accepted' }, appliedFiles: ['state/chapters/0001/0001.yaml', 'summaries/chapter/0001/0001.md'] });
    expect(accepted.status).toBe(200);
    expect(await readFile(join(f.root, 'state/chapters/0001/0001.yaml'), 'utf8')).toContain('持有钥匙');
    expect(await readFile(join(f.root, chapterPath), 'utf8')).toBe(content);
  });
  it('returns conflict for stale chapter evidence and keeps candidate files absent', async () => {
    const f = await fixture({ files: domainFiles, proposal: domainObservations() });
    await chat(f.backend.url); const action = (await pending(f.backend.url)).pendingActions[0]!;
    await writeFile(join(f.root, chapterPath), `${content}正文修改\n`);
    const response = await fetch(`${f.backend.url}/api/workspace/pending-actions/${action.id}/accept`, { method: 'POST' });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    await assertFiles(f.root, { ...domainBaseline(), [chapterPath]: `${content}正文修改\n` });
  });
  it('preserves an author-created target and leaves every other candidate unapplied on conflict', async () => {
    const f = await fixture(); await chat(f.backend.url);
    const action = (await pending(f.backend.url)).pendingActions[0]!;
    const target = 'summaries/chapter/0001/0001.md'; const authorText = '# 作者补写的摘要\n';
    await mkdir(dirname(join(f.root, target)), { recursive: true });
    await writeFile(join(f.root, target), authorText);
    const response = await decide(f.backend.url, action.id, 'accept');
    expect(response.status).toBe(409);
    await assertFiles(f.root, { [target]: authorText, 'state/chapters/0001/0001.yaml': undefined, [chapterPath]: content });
    expect((await pending(f.backend.url)).pendingActions.map((item) => item.id)).toEqual([action.id]);
  });
  it('rejects the entire candidate and prevents a subsequent Accept from materializing it', async () => {
    const f = await fixture({ files: domainFiles, proposal: domainObservations() }); await chat(f.backend.url);
    const action = (await pending(f.backend.url)).pendingActions[0]!;
    const rejected = await decide(f.backend.url, action.id, 'reject');
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ pendingAction: { status: 'rejected' } });
    const replay = await decide(f.backend.url, action.id, 'accept');
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: 'PENDING_ACTION_TERMINAL_CONFLICT' });
    await assertFiles(f.root, domainBaseline());
    expect((await pending(f.backend.url)).pendingActions).toEqual([]);
  });
  it.each(['low confidence', 'explicit unresolved observation'])(
    'keeps %s report-only across the real streaming workflow', async (kind) => {
      const proposal = { ...observations(), ...(kind === 'explicit unresolved observation' ? { unresolvedObservationIds: ['key'] } : {}) };
      if (kind === 'low confidence') proposal.observations[0]!.confidence = 'low';
      const f = await fixture({ proposal }); const wire = await chat(f.backend.url);
      expect(wire).toContain('钥匙所有权未说明');
      expect(wire).not.toContain('tool-output-error');
      expect(wire).not.toContain('data-pending-action');
      expect((await pending(f.backend.url)).pendingActions).toEqual([]);
      await assertFiles(f.root, { 'summaries/chapter/0001/0001.md': undefined, 'state/chapters/0001/0001.yaml': undefined, [chapterPath]: content });
    },
  );
  it('fails closed on model evidence and an output path mistakenly supplied as the active chapter', async () => {
    const f = await fixture({ invalidEvidence: true }); const wire = await chat(f.backend.url);
    expect(wire).toContain('tool-output-error'); expect((await pending(f.backend.url)).pendingActions).toEqual([]);
    const count = f.model.doStreamCalls.length;
    const invalidSelectionWire = await chat(f.backend.url, ['summaries/chapter/0001/0001.md'], 400);
    expect(invalidSelectionWire).toContain('CHAPTER_SETTLEMENT_SELECTION_REQUIRED');
    expect(invalidSelectionWire).toContain('已编号的正文文件'); expect(f.model.doStreamCalls).toHaveLength(count);
    expect((await pending(f.backend.url)).pendingActions).toEqual([]);
  }, 30_000);
});
