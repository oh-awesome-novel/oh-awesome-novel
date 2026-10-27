import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { evaluateAggregateSummaries, parseSummaryDocument, mergeSummaryDocument, createChapterSettlementSource } from '@oh-awesome-novel/core';
import { createSummaryGenerationChangeProposal, createChangeMaterializer, createPendingActionStore, createWorkspaceProjection,
  readRepositoryBaseline, parsePendingAction, parsePendingActionOrigin, validateFinalDocument, summaryGenerationProjectionRules,
  CandidateChangeSetBuilder, createChapterSettlementChangeProposal } from '@oh-awesome-novel/tools';
import { settledSummaryFiles, summaryDraft, appendSummary, fixtureRepository, fixtureFingerprint } from '../../fixtures/summary-generation';

const git = promisify(execFile); const roots: string[] = [];
const volumePath = 'summaries/volume/0001.md'; const globalPath = 'summaries/global.md';
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(global = false, existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-summary-tools-')); roots.push(root);
  const files = settledSummaryFiles();
  if (global) appendSummary(files, volumePath);
  const targetPath = global ? globalPath : volumePath;
  if (existing) files.push({ path: targetPath, content: '# 作者手工摘要\n保留我的笔记。\n' });
  for (const file of files) { await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), file.content); }
  await git('git', ['init', '-b', 'main', root]); await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  const projection = await createWorkspaceProjection({ workspaceRoot: root, rules: summaryGenerationProjectionRules(targetPath) });
  const input = { targetPath, draft: summaryDraft(files, targetPath), sessionId: 'summary-tools', repository: await readRepositoryBaseline(root),
    projectionFingerprint: projection.fingerprint, baselineFiles: projection.baselineFiles };
  const store = await createPendingActionStore({ workspaceRoot: root });
  const materializer = createChangeMaterializer({ store, assertOriginFresh: async () => {} });
  return { root, files, input, store, materializer, targetPath };
}
async function propose(f: Awaited<ReturnType<typeof fixture>>) {
  const result = createSummaryGenerationChangeProposal(f.input);
  return f.store.proposeCandidate({ ...result.proposal!, title: '摘要审批', description: '审阅全部来源' });
}

describe('aggregate summary approval and immutable origin', () => {
  it.each([false, true])('preserves author content until Accept and supports volume/global %s', async (global) => {
    const f = await fixture(global, true); const before = await readFile(join(f.root, f.targetPath), 'utf8');
    const action = await propose(f);
    expect(await readFile(join(f.root, f.targetPath), 'utf8')).toBe(before);
    expect(action.origin).toEqual({ kind: 'summaryGeneration', targetPath: f.targetPath, sourceFingerprint: f.input.draft.sourceFingerprint });
    const accepted = await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false });
    expect(accepted.appliedFiles).toEqual([f.targetPath]); expect(accepted.receipt.git).toMatchObject({ status: 'not-requested' });
    const content = await readFile(join(f.root, f.targetPath), 'utf8'); expect(content.startsWith(before)).toBe(true);
    const files = [...f.files.filter((file) => file.path !== f.targetPath), { path: f.targetPath, content }];
    expect(evaluateAggregateSummaries({ files }).find((item) => item.path === f.targetPath)?.status).toBe('current');
    const projection = await createWorkspaceProjection({ workspaceRoot: f.root, rules: summaryGenerationProjectionRules(f.targetPath) });
    expect(createSummaryGenerationChangeProposal({ ...f.input, baselineFiles: projection.baselineFiles }).proposal).toBeUndefined();
  });
  it('Reject never creates a canonical summary', async () => {
    const f = await fixture(); const action = await propose(f); await f.materializer.reject({ actionId: action.id });
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['body', 'added chapter', 'deleted chapter', 'chapter evidence', 'volume source', 'symlink', 'duplicate state'])('rejects %s drift for a global proposal even with a permissive origin hook', async (change) => {
    const f = await fixture(true); const action = await propose(f);
    if (change === 'body') await writeFile(join(f.root, 'chapters/0001/0001.md'), '改变正文');
    if (change === 'added chapter') await writeFile(join(f.root, 'chapters/0001/0002.md'), '新增正文');
    if (change === 'deleted chapter') await rm(join(f.root, 'chapters/0001/0001.md'));
    if (change === 'chapter evidence') await writeFile(join(f.root, 'state/chapters/0001/0001.yaml'), '损坏来源');
    if (change === 'volume source') await writeFile(join(f.root, volumePath), '新的手工卷摘要');
    if (change === 'duplicate state') await writeFile(join(f.root, 'state/chapters/0001/0001.yml'), '重复来源');
    if (change === 'symlink') { await rm(join(f.root, 'chapters/0001/0001.md')); await symlink(join(f.root, volumePath), join(f.root, 'chapters/0001/0001.md')); }
    // Recreate the materializer to prove the guard needs no in-memory producer state.
    const materializer = createChangeMaterializer({ store: await createPendingActionStore({ workspaceRoot: f.root }), assertOriginFresh: async () => {} });
    await expect(materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    expect((await f.store.readRecord(action.id)).status).toBe('pending');
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects target changes but accepts mere source touch', async () => {
    const f = await fixture(false, true); const action = await propose(f);
    await writeFile(join(f.root, f.targetPath), '作者新改动');
    await expect(f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    expect(await readFile(join(f.root, f.targetPath), 'utf8')).toBe('作者新改动');
    const clean = await fixture(); const candidate = await propose(clean);
    await utimes(join(clean.root, 'chapters/0001/0001.md'), new Date('2030-01-01'), new Date('2030-01-01'));
    expect((await clean.materializer.accept({ actionId: candidate.id, autoCommitOnAccept: false })).appliedFiles).toEqual([volumePath]);
  });
  it('rejects unknown origin/producer/targets, deletion, malformed metadata and stripped evidence', async () => {
    const f = await fixture(); const view = await propose(f); const action = await f.store.readAction(view.id);
    const { origin, ...stripped } = action;
    for (const value of [stripped, { ...action, origin: { ...origin, extra: true } },
      { ...action, source: { ...action.source, producer: 'other' } },
      { ...action, source: { ...action.source, capability: 'novel.multi-file-edit' } },
      { ...action, allowedTargets: [volumePath, globalPath] },
      { ...action, origin: { ...origin, targetPath: globalPath } },
      { ...action, changes: [{ ...action.changes[0], operation: 'delete', draft: null }] }]) expect(() => parsePendingAction(value)).toThrow();
    for (const targetPath of ['summaries/volume/0000.md', 'chapters/0001/0001.md', '../summaries/global.md']) expect(() => parsePendingActionOrigin({ ...origin, targetPath })).toThrow();
    expect(() => parsePendingActionOrigin({ ...origin, sourceFingerprint: 'bad' })).toThrow();
    expect(() => validateFinalDocument({ path: volumePath, content: '<!-- oan:summary:v2\n{}\n-->' })).toThrow();
    const generated = createSummaryGenerationChangeProposal(f.input).proposal!.candidate.changes[0]!.draft!.content;
    expect(() => validateFinalDocument({ path: globalPath, content: generated })).toThrow();
    expect(() => validateFinalDocument({ path: 'summaries/volume/0000.md', content: generated })).toThrow();
  });
  it('commits only the accepted summary when autoCommitOnAccept is enabled', async () => {
    const f = await fixture(); await git('git', ['-C', f.root, 'config', 'user.name', 'Test']); await git('git', ['-C', f.root, 'config', 'user.email', 'test@example.invalid']);
    const action = await propose(f);
    const result = await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: true });
    expect(result.receipt.git.status).toBe('committed');
    expect((await git('git', ['-C', f.root, 'show', '--format=', '--name-only', 'HEAD'])).stdout.trim()).toBe(volumePath);
  });

  it.each(['', '作者笔记 oan:summary:。\n', '## 作者笔记\n', '---\nid: "0001"\n---\n作者笔记\n', '---\nid: "0001"\n---', 'managed', 'managed-inline'])('adds a reviewable heading without rewriting existing author bytes: %s', async (existing) => {
    const f = await fixture(false, true);
    if (existing.startsWith('managed')) {
      const generated = createSummaryGenerationChangeProposal(f.input).proposal!.candidate.changes[0].draft!.content;
      existing = existing === 'managed-inline' ? `作者笔记${parseSummaryDocument(generated, f.targetPath)!.block}` : generated.replace(/^# .+\n/u, '');
    }
    await writeFile(join(f.root, f.targetPath), existing);
    const baselineFiles = f.input.baselineFiles.map((file) => file.path === f.targetPath ? { ...file, content: existing } : file);
    const proposal = createSummaryGenerationChangeProposal({ ...f.input, baselineFiles, draft: summaryDraft(baselineFiles, f.targetPath, '林安抵达城门。') }).proposal!;
    const action = await f.store.proposeCandidate({ ...proposal, title: '补齐摘要标题', description: '保留作者笔记' });
    expect(await readFile(join(f.root, f.targetPath), 'utf8')).toBe(existing);
    await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false });
    const saved = await readFile(join(f.root, f.targetPath), 'utf8');
    expect(() => validateFinalDocument({ path: f.targetPath, content: saved })).not.toThrow();
    const beforeAuthor = parseSummaryDocument(existing, f.targetPath)?.authorContent ?? existing;
    expect(parseSummaryDocument(saved, f.targetPath)!.authorContent).toContain(beforeAuthor.trim());
  });

  it('allows marker names in chapter observations through the actual settlement producer', () => {
    const chapterId = '0001/0001'; const content = '# 正文\n林安看见 oan:summary: 字样。\n';
    const source = createChapterSettlementSource(chapterId, content);
    const result = createChapterSettlementChangeProposal({ source, observations: { schemaVersion: 1, chapterId, sourceHash: source.sourceHash,
      observations: [{ id: 'marker', category: 'location', subject: '林安', observation: '看见 oan:summary: 字样', confidence: 'high', evidence: { startLine: 2, endLine: 2, quote: '林安看见 oan:summary: 字样。' } }], unresolvedAmbiguities: [] },
      sessionId: 'marker-test', repository: fixtureRepository, projectionFingerprint: fixtureFingerprint, baselineFiles: [{ path: `chapters/${chapterId}.md`, content }] });
    expect(result.proposal!.candidate.changes.find((change) => change.path.startsWith('summaries/'))!.draft!.content).toContain('看见 oan:summary: 字样');
  });

  it.each(['malformed', 'fingerprint', 'payload'])('rejects a checksum-consistent but invalid summary draft after restart: %s', async (kind) => {
    const f = await fixture();
    let content = createSummaryGenerationChangeProposal(f.input).proposal!.candidate.changes[0].draft!.content;
    const document = parseSummaryDocument(content, f.targetPath)!.document;
    if (kind === 'malformed') content = content.replace('\n林安到达城门。\n', '\n篡改正文。\n');
    if (kind === 'fingerprint') content = mergeSummaryDocument(undefined, { ...document, sourceFingerprint: 'c'.repeat(64) });
    if (kind === 'payload') content = mergeSummaryDocument(undefined, { ...document, sources: document.sources.map((source) => ({ ...source, payloadHash: 'c'.repeat(64) })) });
    // Simulate a buggy/older trusted producer: storage hashes match these bytes.
    const builder = new CandidateChangeSetBuilder({ sessionId: 'invalid-summary', producer: 'summary-generation', capability: 'summary.edit', repository: f.input.repository, projectionFingerprint: f.input.projectionFingerprint, baselineFiles: [] });
    builder.write(f.targetPath, content);
    const action = await f.store.proposeCandidate({ candidate: builder.finalize()!, title: '不可接受的摘要', description: '校验来源', origin: { kind: 'summaryGeneration', targetPath: f.targetPath, sourceFingerprint: f.input.draft.sourceFingerprint } });
    const materializer = createChangeMaterializer({ store: await createPendingActionStore({ workspaceRoot: f.root }), assertOriginFresh: async () => {} });
    await expect(materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: kind === 'payload' ? 'STALE_PENDING_ACTION_BASELINE' : 'PENDING_ACTION_DRAFT_INTEGRITY_ERROR' });
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.store.readRecord(action.id)).status).toBe('pending');
  });
});
