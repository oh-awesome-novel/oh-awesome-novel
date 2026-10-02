import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { createChapterSettlementSource } from '@oh-awesome-novel/core';
import type { ChapterSettlementDomainChange, ChapterSettlementObservationLog } from '@oh-awesome-novel/core';
import { createChapterSettlementChangeProposal, createChangeMaterializer, createPendingActionStore,
  createWorkspaceProjection, readRepositoryBaseline, parsePendingAction } from '@oh-awesome-novel/tools';

const git = promisify(execFile);
const roots: string[] = [];
const content = '---\nchapterId: "0001"\n---\n林安拿起钥匙。\n';
const source = createChapterSettlementSource('0001/0001', content);
const observations = { schemaVersion: 1, chapterId: source.chapterId, sourceHash: source.sourceHash,
  observations: [{ id: 'key', category: 'item', subject: '林安', observation: '持有钥匙', confidence: 'high',
    evidence: { startLine: 4, endLine: 4, quote: '林安拿起钥匙。' } },
  { id: 'owner', category: 'item', subject: '钥匙', observation: '可能属于林安', confidence: 'low',
    evidence: { startLine: 4, endLine: 4, quote: '林安拿起钥匙。' } }], unresolvedAmbiguities: ['钥匙所有权未说明'] };
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-settlement-')); roots.push(root);
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(join(root, 'chapters/0001/0001.md'), content);
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  const projection = await createWorkspaceProjection({ workspaceRoot: root, rules: [{ kind: 'prefix', path: 'chapters' }, { kind: 'prefix', path: 'summaries' }, { kind: 'prefix', path: 'state' }] });
  const input = { source, observations, sessionId: 'settlement-test', repository: await readRepositoryBaseline(root),
    projectionFingerprint: projection.fingerprint, baselineFiles: projection.baselineFiles };
  const store = await createPendingActionStore({ workspaceRoot: root });
  return { root, input, store, materializer: createChangeMaterializer({ store, assertOriginFresh: async () => {} }) };
}

describe('chapter settlement approval', () => {
  it('creates one two-file candidate, persists no canonical bytes until Accept and validates its final references', async () => {
    const f = await fixture(); const result = createChapterSettlementChangeProposal(f.input);
    expect(result.report).toContain('钥匙所有权未说明');
    expect(result.report).toContain('可能属于林安');
    expect(result.proposal!.candidate.changes.map((c) => c.path)).toEqual(['state/chapters/0001/0001.yaml', 'summaries/chapter/0001/0001.md']);
    const action = await f.store.proposeCandidate({ ...result.proposal!, title: 'Settlement', description: 'Review evidence' });
    expect(action.diff).not.toContain('可能属于林安');
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    const accepted = await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false });
    expect(accepted.appliedFiles).toHaveLength(2);
    const state = parse(await readFile(join(f.root, 'state/chapters/0001/0001.yaml'), 'utf8'));
    expect(state.chapterRef).toBe('0001/0001'); expect(state.sourceHash).toBe(source.sourceHash);
    expect(state.observations).toHaveLength(1);
    expect(await readFile(join(f.root, 'chapters/0001/0001.md'), 'utf8')).toBe(content);
  });
  it('keeps low-confidence and ambiguity-only settlement report-only', async () => {
    const f = await fixture();
    const result = createChapterSettlementChangeProposal({ ...f.input, observations: { ...observations,
      observations: observations.observations.filter((item) => item.confidence === 'low') } });
    expect(result.proposal).toBeUndefined(); expect(await f.store.listViews()).toEqual([]);
  });
  it('refuses a stale source at Accept even when the host origin callback is permissive', async () => {
    const f = await fixture();
    const proposal = createChapterSettlementChangeProposal(f.input).proposal!;
    const action = await f.store.proposeCandidate({ ...proposal, title: 'Settlement', description: 'Review evidence' });
    await writeFile(join(f.root, 'chapters/0001/0001.md'), `${content}后续正文\n`);
    await expect(f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.store.readRecord(action.id)).status).toBe('pending');
  });
  it('rejects unknown origin fields, stripped origin and source/producer mismatch', async () => {
    const f = await fixture(); const proposal = createChapterSettlementChangeProposal(f.input).proposal!;
    const action = await f.store.proposeCandidate({ ...proposal, title: 'Settlement', description: 'Review evidence' });
    const stored = await f.store.readAction(action.id);
    expect(() => parsePendingAction({ ...stored, origin: { ...stored.origin, extra: true } })).toThrow();
    const { origin, ...stripped } = stored;
    expect(() => parsePendingAction(stripped)).toThrow();
    expect(() => parsePendingAction({ ...stored, source: { ...stored.source, producer: 'unrelated' } })).toThrow();
    await f.materializer.reject({ actionId: action.id });
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

const body = '林安手臂受伤。\n清晨林安到达学院。\n铜铃发出异声。\n林安决定承担责任。\n';
const domainSource = createChapterSettlementSource('0001/0001', body);
const domainLog = (): ChapterSettlementObservationLog => ({ schemaVersion: 1, chapterId: domainSource.chapterId, sourceHash: domainSource.sourceHash,
  observations: [
    { id: 'injury', category: 'injury', subject: '林安', observation: '手臂受伤', confidence: 'high', evidence: { startLine: 1, endLine: 1, quote: '林安手臂受伤。' } },
    { id: 'arrival', category: 'time', subject: '林安', observation: '到达学院', confidence: 'high', evidence: { startLine: 2, endLine: 2, quote: '清晨林安到达学院。' } },
    { id: 'bell', category: 'foreshadow', subject: '铜铃', observation: '发出异声', confidence: 'high', evidence: { startLine: 3, endLine: 3, quote: '铜铃发出异声。' } },
    { id: 'growth', category: 'character', subject: '林安', observation: '决定承担责任', confidence: 'high', evidence: { startLine: 4, endLine: 4, quote: '林安决定承担责任。' } },
  ], unresolvedAmbiguities: [], domainChanges: [
    { domain: 'state', observationId: 'injury', characterId: 'hero', field: 'hp', expectedValue: 'normal', value: 'injured' },
    { domain: 'timeline', observationId: 'arrival', title: '抵达学院', time: '清晨' },
    { domain: 'foreshadow', observationId: 'bell', operation: 'create', hookId: 'bell', description: '铜铃发出异声', relatedCharacters: ['hero'] },
    { domain: 'character', observationId: 'growth', characterId: 'hero' },
  ],
});
async function domainFixture(overrides: Record<string, string> = {}) {
  const f = await fixture();
  const files = { 'chapters/0001/0001.md': body, 'characters/hero/meta.yaml': 'id: hero\ndisplayName: 林安\naliases: [小林]\n',
    'characters/hero/growth.md': '# 作者成长线\n\n保留作者的原文。\n',
    'state/characters.yaml': '# 作者备注\ncharacters:\n  hero:\n    hp: normal # 作者健康注释\n    inventory: [匕首, 指南针]\nnotes: 作者全局注释\n',
    'timeline/events.yaml': 'events: []\nnotes: 作者时间线备注\n', 'foreshadow/active.yaml': 'active: []\nnotes: 作者伏笔备注\n',
    'foreshadow/resolved.yaml': 'resolved: []\n',
    'summaries/chapter/0001/0001.md': '# 作者摘要\n\n保留作者自己的摘要。\n', ...overrides };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(f.root, path, '..'), { recursive: true }); await writeFile(join(f.root, path), text);
  }
  const projection = await createWorkspaceProjection({ workspaceRoot: f.root, rules: ['chapters', 'summaries', 'state', 'characters', 'timeline', 'foreshadow'].map((path) => ({ kind: 'prefix' as const, path })) });
  return { ...f, files, input: { ...f.input, source: domainSource, observations: domainLog(), projectionFingerprint: projection.fingerprint, baselineFiles: projection.baselineFiles } };
}
function finalFiles(input: Awaited<ReturnType<typeof domainFixture>>['input'], proposal: NonNullable<ReturnType<typeof createChapterSettlementChangeProposal>['proposal']>) {
  const files = new Map(input.baselineFiles.map((file) => [file.path, file]));
  for (const change of proposal.candidate.changes) {
    if (change.operation !== 'delete') files.set(change.path, { path: change.path, content: change.draft.content, mode: 0o644 });
  }
  return [...files.values()];
}
function draft(proposal: NonNullable<ReturnType<typeof createChapterSettlementChangeProposal>['proposal']>, path: string): string {
  return proposal.candidate.changes.find((change) => change.path === path)?.draft?.content ?? '';
}

describe('multi-domain settlement compiler', () => {
  it('merges author-owned content, keeps exact read dependencies and is byte-idempotent after Accept', async () => {
    const f = await domainFixture(); const result = createChapterSettlementChangeProposal(f.input); const proposal = result.proposal!;
    expect(proposal.candidate.changes).toHaveLength(6);
    const state = draft(proposal, 'state/characters.yaml');
    expect(state).toContain('# 作者备注'); expect(state).toContain('# 作者健康注释');
    expect(parse(state)).toMatchObject({ characters: { hero: { hp: 'injured', inventory: ['匕首', '指南针'] } }, notes: '作者全局注释', settlementSources: { hero: { hp: { chapterRef: '0001/0001', value: 'injured' } } } });
    expect(draft(proposal, 'characters/hero/growth.md')).toMatch(/^# 作者成长线\n\n保留作者的原文。\n/u);
    expect(draft(proposal, 'summaries/chapter/0001/0001.md')).toMatch(/^# 作者摘要\n\n保留作者自己的摘要。\n/u);
    expect(proposal.origin.inputFiles).toContainEqual({ path: 'state/chapters/0001/0001.yaml', sha256: null });
    expect(proposal.origin.inputFiles.some((file) => file.path === 'characters/hero/meta.yaml')).toBe(true);
    const action = await f.store.proposeCandidate({ ...proposal, title: 'Multi-domain settlement', description: 'Evidence review' });
    expect(await readFile(join(f.root, 'state/characters.yaml'), 'utf8')).toBe(f.files['state/characters.yaml']);
    await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false });
    const repeat = createChapterSettlementChangeProposal({ ...f.input, baselineFiles: finalFiles(f.input, proposal) });
    expect(repeat.proposal).toBeUndefined();
    expect(repeat.report).not.toContain('Merge conflicts');
  });
  it.each(['mention', 'advance', 'defer', 'resolve'] as const)('applies %s while preserving the hook record and avoiding duplicate history', async (operation) => {
    const f = await domainFixture({ 'foreshadow/active.yaml': '# 作者伏笔\nactive:\n  - id: bell\n    status: active\n    description: 原始埋设\n    firstChapter: "0001/0001"\n    authorNote: 必须保留\n    relatedCharacters: [hero]\n' });
    const observations = domainLog(); observations.domainChanges = [{ domain: 'foreshadow', observationId: 'bell', operation, hookId: 'bell', expectedStatus: 'active' }];
    const proposal = createChapterSettlementChangeProposal({ ...f.input, observations }).proposal!;
    const hookFile = operation === 'resolve' ? 'foreshadow/resolved.yaml' : 'foreshadow/active.yaml';
    const entries = parse(draft(proposal, hookFile))[operation === 'resolve' ? 'resolved' : 'active'];
    expect(entries[0]).toMatchObject({ id: 'bell', authorNote: '必须保留', description: '原始埋设', status: ({ mention: 'active', advance: 'developing', defer: 'dormant', resolve: 'resolved' })[operation] });
    expect(entries[0].settlementHistory).toHaveLength(1);
    if (operation === 'resolve') expect(parse(draft(proposal, 'foreshadow/active.yaml')).active).toEqual([]);
    expect(createChapterSettlementChangeProposal({ ...f.input, observations, baselineFiles: finalFiles(f.input, proposal) }).proposal).toBeUndefined();
  });
  it('excludes conflicting and ambiguous observations from every truth target, while settling independent facts', async () => {
    const f = await domainFixture(); const observations = domainLog();
    (observations.domainChanges![0] as Extract<ChapterSettlementDomainChange, { domain: 'state' }>).expectedValue = 'healthy';
    observations.unresolvedObservationIds = ['bell']; observations.observations[3]!.confidence = 'medium';
    const result = createChapterSettlementChangeProposal({ ...f.input, observations });
    expect(result.report).toContain('Expected value');
    const all = result.proposal!.candidate.changes.map((change) => change.draft?.content).join('\n');
    expect(all).toContain('到达学院'); expect(all).not.toContain('手臂受伤'); expect(all).not.toContain('发出异声'); expect(all).not.toContain('决定承担责任');
    expect(result.proposal!.candidate.changes.map((change) => change.path)).toEqual(['state/chapters/0001/0001.yaml', 'summaries/chapter/0001/0001.md', 'timeline/events.yaml']);
  });
  it.each(['null', '[normal]', '123'])('does not treat an authored %s value as an absent field', async (value) => {
    const f = await domainFixture({ 'state/characters.yaml': `characters:\n  hero:\n    hp: ${value}\n` });
    const observations = domainLog(); observations.domainChanges = [{ domain: 'state', observationId: 'injury', characterId: 'hero', field: 'hp', expectedValue: null, value: 'injured' }];
    const result = createChapterSettlementChangeProposal({ ...f.input, observations });
    expect(result.report).toContain('Expected value');
    expect(result.proposal!.candidate.changes.some((change) => change.path === 'state/characters.yaml')).toBe(false);
  });
  it('rejects a different state layout, ambiguous character names and category-compatible wrong identities', async () => {
    const f = await domainFixture({ 'state/characters.yaml': 'hero:\n  hp: normal\n', 'characters/other/meta.yaml': 'id: other\ndisplayName: 林安\n' });
    let result = createChapterSettlementChangeProposal(f.input);
    expect(result.report).toContain('more than one character');
    const observations = domainLog(); observations.observations[0]!.subject = 'hero'; observations.observations[3]!.subject = 'other person';
    result = createChapterSettlementChangeProposal({ ...f.input, observations });
    expect(result.report).toContain('no characters mapping'); expect(result.report).toContain('does not match character');
  });
  it('does not roll newer state, timeline ordering or hook lifecycle back to an earlier chapter', async () => {
    const f = await domainFixture({
      'state/characters.yaml': stringify({ characters: { hero: { hp: 'normal' } }, settlementSources: { hero: { hp: { id: 'later', chapterRef: '0001/0002', sourceHash: 'a'.repeat(64), value: 'normal' } } } }),
      'timeline/events.yaml': stringify({ events: [{ id: 'later', order: 1, chapter: '0001/0002', title: '后续事件' }] }),
      'foreshadow/active.yaml': stringify({ active: [{ id: 'bell', status: 'active', firstChapter: '0001/0002', description: '后章埋设' }] }),
    });
    const observations = domainLog(); observations.domainChanges![2] = { domain: 'foreshadow', observationId: 'bell', hookId: 'bell', operation: 'advance', expectedStatus: 'active' };
    const result = createChapterSettlementChangeProposal({ ...f.input, observations });
    expect(result.report.match(/later chapter/gu)).toHaveLength(3);
    expect(result.proposal!.candidate.changes.some((change) => /^(?:state\/characters|timeline|foreshadow)/u.test(change.path))).toBe(false);
  });
  it('rolls back all domains for one observation when its later intent conflicts', async () => {
    const f = await domainFixture(); const observations = domainLog();
    observations.observations[3]!.category = 'relationship';
    observations.domainChanges = [
      { domain: 'state', observationId: 'growth', characterId: 'hero', field: 'relationships', expectedValue: null, value: '信任同伴' },
      { domain: 'character', observationId: 'growth', characterId: 'absent' },
    ];
    const result = createChapterSettlementChangeProposal({ ...f.input, observations });
    expect(result.report).toContain('Unknown character');
    expect(result.proposal!.candidate.changes.map((change) => change.path)).not.toContain('state/characters.yaml');
    expect(result.proposal!.candidate.changes.map((change) => change.draft?.content).join('\n')).not.toContain('决定承担责任');
  });
  it('keeps relocated evidence idempotent and marks old chapter snapshots as historical', async () => {
    const f = await domainFixture(); const first = createChapterSettlementChangeProposal(f.input).proposal!;
    const source = createChapterSettlementSource('0001/0001', `新的开头。\n${body}`);
    const observations = domainLog(); observations.sourceHash = source.sourceHash;
    for (const observation of observations.observations) { observation.evidence.startLine++; observation.evidence.endLine++; }
    const second = createChapterSettlementChangeProposal({ ...f.input, source, observations, baselineFiles: finalFiles(f.input, first) });
    expect(second.report).not.toContain('Merge conflicts');
    expect(second.proposal!.candidate.changes.map((change) => change.path)).toEqual(['state/chapters/0001/0001.yaml', 'summaries/chapter/0001/0001.md']);
    const state = parse(draft(second.proposal!, 'state/chapters/0001/0001.yaml'));
    expect(state.sourceHash).toBe(source.sourceHash); expect(state.settlementRecords[0].sourceHash).toBe(domainSource.sourceHash);
    const summary = draft(second.proposal!, 'summaries/chapter/0001/0001.md');
    expect(summary).toContain(`Current evidence source SHA-256: ${source.sourceHash}`); expect(summary).toContain('other snapshots are historical');
  });
  it('preserves author-owned chapter state fields, and reports changed managed evidence instead of overwriting it', async () => {
    const f = await domainFixture({ 'state/chapters/0001/0001.yaml': '# 作者的章状态\nnotes: 自己记录\nobservations: [作者内容]\n' });
    const first = createChapterSettlementChangeProposal(f.input).proposal!;
    expect(draft(first, 'state/chapters/0001/0001.yaml')).toContain('# 作者的章状态');
    expect(parse(draft(first, 'state/chapters/0001/0001.yaml'))).toMatchObject({ notes: '自己记录', observations: ['作者内容'], settlementCurrent: { sourceHash: domainSource.sourceHash } });
    const baselines = finalFiles(f.input, first).map((file) => file.path === 'characters/hero/growth.md' ? { ...file, content: file.content.replace('决定承担责任', '作者改写的人物成长') } : file);
    const repeat = createChapterSettlementChangeProposal({ ...f.input, baselineFiles: baselines });
    expect(repeat.report).toContain('managed evidence was edited');
    expect(repeat.proposal).toBeUndefined();
  });
  it.each(['characters/hero/meta.yaml', 'foreshadow/resolved.yaml', 'state/characters.yaml'])('refuses read dependency drift in %s before Accept', async (path) => {
    const f = await domainFixture(); const proposal = createChapterSettlementChangeProposal(f.input).proposal!;
    const action = await f.store.proposeCandidate({ ...proposal, title: 'Settlement', description: 'Evidence' });
    await writeFile(join(f.root, path), `${await readFile(join(f.root, path), 'utf8')}# external change\n`);
    await expect(f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    expect((await f.store.readRecord(action.id)).status).toBe('pending');
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
