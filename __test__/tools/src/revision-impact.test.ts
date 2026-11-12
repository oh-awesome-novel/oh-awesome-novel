import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { createCandidateChangeSet, createChangeMaterializer, createPendingActionStore, createRevisionImpactReport, listRevisionImpactReports, readRepositoryBaseline, readRevisionImpactReport, readRevisionImpactSnapshot, readGitFileVersion } from '@oh-awesome-novel/tools';
import { revisionImpactFixture, impactPath, impactText, impactAfter, impactHash } from '../../core/src/fixtures/revision-impact';
it('gives identical dependencies for external edits and Accept, persists hash evidence and writes no canonical bytes', async () => {
  const f = await revisionImpactFixture();
  try {
    const repository = await readRepositoryBaseline(f.root); const store = await createPendingActionStore({ workspaceRoot: f.root });
    const candidate = createCandidateChangeSet({ sessionId: 'impact', createdAt: new Date().toISOString(), finalizedAt: new Date().toISOString(), projectionFingerprint: 'a'.repeat(64), repository,
      source: { kind: 'deterministic-builder', producer: 'fixture', capability: 'chapter.edit' }, baselineFiles: [{ path: impactPath, content: impactText, mode: 0o644 }], finalFiles: [{ path: impactPath, content: impactAfter, mode: 0o644 }] })!;
    const action = await store.proposeCandidate({ id: 'pa-impact', candidate, title: '改旧章', description: '替换地点' });
    await createChangeMaterializer({ store }).accept({ actionId: action.id, autoCommitOnAccept: false });
    const before = await readRevisionImpactSnapshot(f.root, []);
    const accepted = await createRevisionImpactReport(f.root, { kind: 'acceptedAction', actionId: action.id });
    const external = await createRevisionImpactReport(f.root, { kind: 'git', ref: 'HEAD', path: impactPath });
    expect(accepted.report.items.filter(i => i.kind === 'derived')).toEqual(external.report.items.filter(i => i.kind === 'derived'));
    expect(accepted.report.items.filter(i => i.kind === 'derived')).toHaveLength(4);
    expect((await readRevisionImpactSnapshot(f.root, [])).fingerprint).toBe(before.fingerprint);
    expect((await readRevisionImpactReport(f.root, external.report.id)).stale).toBe(false);
    expect((await listRevisionImpactReports(f.root)).map(r => r.id)).toContain(accepted.report.id);
    await utimes(join(f.root, impactPath), new Date(), new Date()); expect((await readRevisionImpactReport(f.root, external.report.id)).stale).toBe(false);
    await writeFile(join(f.root, impactPath), `${impactAfter}新段落。`);
    expect((await readRevisionImpactReport(f.root, accepted.report.id)).stale).toBe(true);
    expect((await readRevisionImpactReport(f.root, external.report.id)).stale).toBe(true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 15_000);
it('uses visible selected and compressed request sources, excludes omitted ones, and marks cleaned logs stale', async () => {
  const f = await revisionImpactFixture();
  try {
    const { appendAgentUsageRecord, usageSourceKey } = await import('@oh-awesome-novel/core');
    const target = 'characters/lin-an/profile.md';
    const sources = (['selected', 'compressed', 'omitted'] as const).map((outcome, i) => ({ sourceId: `source-${i}`, kind: 'character', path: target,
      sourceHash: impactHash('# 林安\n谨慎行事。\n'), budgetLayer: 'L1' as const, semanticBoundary: 'compressible' as const, outcome, reason: 'selected' as const,
      modelVisibleChars: outcome === 'omitted' ? 0 : 3, estimatedTokens: outcome === 'omitted' ? 0 : 1, estimator: 'utf8-bytes-div-3-v1' as const }));
    await appendAgentUsageRecord(f.root, 'session-impact', { schemaVersion: 1, recordType: 'request', sessionId: 'session-impact', turnId: 'turn-1', createdAt: '2026-11-12T00:00:00.000Z', stepIndex: 0,
      request: { messageCount: 1, messages: [{ index: 0, role: 'user', chars: 6, estimatedTokens: 2, sourceRefs: sources.slice(0, 2).map(usageSourceKey) }], estimatedMessageTokens: 2, estimatedRequestTokens: 20, toolCount: 0, estimator: 'utf8-bytes-div-3-v1', estimationScope: 'messages-tools-json-with-20-percent-margin' }, sources, budget: { status: 'unknown', estimatedRequestTokens: 20 } });
    await writeFile(join(f.root, target), '# 林安\n现在勇敢冒险。');
    const view = await createRevisionImpactReport(f.root, { kind: 'git', path: target, ref: 'HEAD' });
    const reads = view.report.items.filter(item => item.kind === 'generationRead'); expect(reads).toHaveLength(2);
    expect(reads.map(item => item.location).join('')).toContain('compressed'); expect(reads.every(item => item.targetKnown === false)).toBe(true);
    expect((await readRevisionImpactReport(f.root, view.report.id)).stale).toBe(false);
    await rm(join(f.root, '.workspace/sessions/session-impact'), { recursive: true });
    expect((await readRevisionImpactReport(f.root, view.report.id)).stale).toBe(true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it('distinguishes registered references, actual report source reads and namesakes; cleaned evidence makes saved reports stale', async () => {
  const f = await revisionImpactFixture();
  try {
    await writeFile(join(f.root, 'chapters/0001/0002.md'), f.files.find(file => file.path === 'chapters/0001/0002.md')!.content);
    const target = 'characters/lin-an/profile.md'; await writeFile(join(f.root, target), '# 林安\n开始主动冒险。\n');
    const { buildChapterReviewReport, newChapterReviewId, saveChapterReviewReport } = await import('@oh-awesome-novel/core');
    const { prepareChapterReviewSnapshot } = await import('@oh-awesome-novel/tools');
    const snapshot = await prepareChapterReviewSnapshot(f.root, impactPath, [target]);
    const report = buildChapterReviewReport({ id: newChapterReviewId(), createdAt: new Date().toISOString(), path: impactPath, content: impactText, files: snapshot.files, basisPaths: snapshot.basisPaths, contextFingerprint: snapshot.contextFingerprint, response: { dimensions: [], findings: [] } });
    await saveChapterReviewReport(f.root, report);
    const result = await createRevisionImpactReport(f.root, { kind: 'git', path: target, ref: 'HEAD' });
    expect(result.report.items.find(i => i.path === 'chapters/0001/0002.md')?.kind).toBe('reference');
    expect(result.report.items.find(i => i.kind === 'generationRead')?.generationId).toBe(report.id);
    expect(result.report.items.find(i => i.path === 'world/namesake.md')?.kind).toBe('mention');
    expect(result.report.items.some(i => i.path === 'world/unrelated.md')).toBe(false);
    await rm(join(f.root, '.workspace/chapter-reviews', `${report.id}.json`));
    expect((await readRevisionImpactReport(f.root, result.report.id)).stale).toBe(true);
    await rm(join(f.root, '.workspace/revision-impacts'), { recursive: true });
    expect(await listRevisionImpactReports(f.root)).toEqual([]);
    expect((await createRevisionImpactReport(f.root, { kind: 'git', path: target, ref: 'HEAD' })).report.coverage.gaps.join('')).toContain('日志');
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 15_000);
it('degrades when Git and history are absent and skips oversized trees with an explicit coverage gap', async () => {
  const f = await revisionImpactFixture();
  try {
    await rm(join(f.root, '.git'), { recursive: true });
    const result = await createRevisionImpactReport(f.root, { kind: 'git', path: impactPath, ref: 'HEAD' });
    expect(result.report.comparisons[0]!.change).toBe('unknown'); expect(result.report.coverage.gaps.join('')).toContain('Git');
    const uncompared = result.report.items.filter(item => item.kind === 'derived'); expect(uncompared).toHaveLength(4);
    expect(uncompared.every(item => item.reason.includes('变更前版本无法比较') && item.beforeStatus === undefined)).toBe(true);
    await mkdir(join(f.root, 'world/large')); await Promise.all(Array.from({ length: 1005 }, (_, i) => writeFile(join(f.root, `world/large/${i}.md`), '# 记录\n内容')));
    const snapshot = await readRevisionImpactSnapshot(f.root, [impactPath]); expect(snapshot.files.length).toBe(1000); expect(snapshot.coverage.complete).toBe(false); expect(snapshot.coverage.gaps.join('')).toContain('上限');
    expect(await readFile(join(f.root, impactPath), 'utf8')).toBe(impactText);
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 15_000);
it('preserves BOM and CRLF bytes in Git and workspace snapshots, and reports deletion dependencies', async () => {
  const f = await revisionImpactFixture();
  try {
    const content = '\uFEFF# 世界\r\n保留字节。\r\n'; const path = 'world/bom.md';
    await writeFile(join(f.root, '.gitattributes'), `${path} -text\n`);
    await writeFile(join(f.root, path), content); await f.git('git', ['-C', f.root, 'add', path, '.gitattributes']); await f.git('git', ['-C', f.root, 'commit', '-m', 'BOM']);
    expect((await readGitFileVersion(f.root, path, 'HEAD')).content).toBe(content);
    const snapshot = await readRevisionImpactSnapshot(f.root, [path]); expect(snapshot.files.find(file => file.path === path)?.content).toBe(content);
    expect((await createRevisionImpactReport(f.root, { kind: 'git', path, ref: 'HEAD' })).report.comparisons[0]?.change).toBe('unchanged');
    await rm(join(f.root, impactPath));
    const deleted = await createRevisionImpactReport(f.root, { kind: 'git', path: impactPath, ref: 'HEAD' });
    expect(deleted.report.comparisons[0]!.afterHash).toBe(null);
    expect(deleted.report.items.filter(item => item.kind === 'derived')).toHaveLength(4);
    expect(deleted.report.items.find(item => item.path === 'state/chapters/0001/0001.yaml')?.status).toBe('unverified');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
