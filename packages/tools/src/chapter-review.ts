import { isDeepStrictEqual } from 'node:util';
import { applyChapterReviewReplacements, assertChapterReviewCandidate, chapterReviewSource, readChapterReviewDecisions, readChapterReviewReport, reviewHash, selectedChapterReviewAnchors, selectedChapterReviewFindingIds } from '@oh-awesome-novel/core';
import type { ChapterReviewDecisions, ChapterReviewReport } from '@oh-awesome-novel/core';
import { createWorkspaceProjection } from './workspace-projection';
import { CandidateChangeSetBuilder, finalizeDeterministicChangeProposal } from './deterministic-change-producers';
import { createWorkspaceChangePolicy } from './workspace-change-policy';
import type { RepositoryBaseline } from './candidate-change-set';
import type { PendingAction, PreparedChangePreviewV1 } from './pending-action-types';

export function normalizeChapterReviewBasisPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16 || value.some(path => typeof path !== 'string' || path.length > 1000 || !/^(?:chapters|characters|world|outline|state|timeline|foreshadow|summaries)\/.+\.(?:md|ya?ml)$/u.test(path) || path.split('/').some(part => !part || part.startsWith('.')) || path.includes('\\'))) throw new Error('审稿依据只能是最多 16 个小说对象文件。');
  return [...new Set(value as string[])].sort();
}
export async function prepareChapterReviewSnapshot(root: string, path: string, basisValue: unknown = []) {
  chapterReviewSource(path, ''); const basisPaths = normalizeChapterReviewBasisPaths(basisValue);
  const projection = await createWorkspaceProjection({ workspaceRoot: root, maxFileBytes: 128 * 1024, maxTotalBytes: 512 * 1024,
    rules: [{ kind: 'prefix', path: '.oan/constitution' }, ...[path, 'world/rules.md', 'outline/main.md', ...basisPaths].map(path => ({ kind: 'exact' as const, path }))] });
  const chapter = projection.baselineFiles.find(file => file.path === path);
  if (!chapter || projection.baselineFiles.length > 48 || basisPaths.some(path => !projection.baselineFiles.some(file => file.path === path))) throw new Error('章稿或选定依据缺失，或上下文超过上限。');
  const source = chapterReviewSource(path, chapter.content);
  const contextFingerprint = reviewHash(JSON.stringify(projection.baselineFiles.map(file => ({ path: file.path, sourceHash: reviewHash(file.content) }))));
  return { chapter, source, basisPaths, files: projection.baselineFiles, contextFingerprint };
}
export async function assertChapterReviewReportFresh(root: string, report: ChapterReviewReport) {
  const snapshot = await prepareChapterReviewSnapshot(root, report.path, report.basisPaths);
  if (snapshot.source.sourceHash !== report.sourceHash || snapshot.contextFingerprint !== report.contextFingerprint) throw Object.assign(new Error('章稿或依据已变化，请重新审稿。'), { code: 'STALE_PENDING_ACTION_BASELINE' });
  for (const finding of report.findings) {
    const anchor = snapshot.source.anchors.find(anchor => anchor.id === finding.anchor.id);
    if (!anchor || !isDeepStrictEqual(anchor, finding.anchor) || snapshot.chapter.content.slice(finding.quoteStart, finding.quoteStart + finding.quote.length) !== finding.quote) throw new Error('报告中的原文锚点无效，请重新审稿。');
    for (const evidence of finding.evidence) {
      const file = snapshot.files.find(file => file.path === evidence.path);
      if (!file || reviewHash(file.content) !== evidence.sourceHash || file.content.slice(evidence.start, evidence.end) !== evidence.quote) throw new Error('报告依据引文无效，请重新审稿。');
    }
  }
  return snapshot;
}
export function createChapterReviewProposal(input: {
  id: string; report: ChapterReviewReport; decisions: ChapterReviewDecisions; source: Awaited<ReturnType<typeof prepareChapterReviewSnapshot>>;
  replacements: unknown; repository: RepositoryBaseline;
}) {
  const findingIds = selectedChapterReviewFindingIds(input.report, input.decisions);
  const applied = applyChapterReviewReplacements(input.source.chapter.content, input.report, findingIds, input.replacements);
  const builder = new CandidateChangeSetBuilder({ sessionId: input.id, producer: 'chapter-review', capability: 'chapter.edit', repository: input.repository, baselineFiles: [input.source.chapter] });
  builder.write(input.report.path, applied.content);
  const origin = { kind: 'chapterReview' as const, reportId: input.report.id, decisionRevision: input.decisions.revision, targetPath: input.report.path,
    sourceHash: input.report.sourceHash, contextFingerprint: input.report.contextFingerprint, findingIds, edits: applied.edits };
  return finalizeDeterministicChangeProposal({ builder, origin, allowedTargets: [input.report.path], policy: createWorkspaceChangePolicy({ capability: 'chapter.edit', exactWritablePaths: [input.report.path], maxChangedFiles: 1 }) });
}
export async function assertChapterReviewActionFresh(root: string, value: PendingAction | PreparedChangePreviewV1, candidate?: string): Promise<void> {
  try {
    const origin = value.origin;
    if (origin?.kind !== 'chapterReview' || value.allowedTargets.length !== 1 || value.allowedTargets[0] !== origin.targetPath || value.changes.length !== 1 || value.changes[0]!.path !== origin.targetPath || value.changes[0]!.operation !== 'update' || value.changes[0]!.baseline.sha256 !== origin.sourceHash) throw new Error('局部修订范围不一致。');
    const report = await readChapterReviewReport(root, origin.reportId); const decisions = await readChapterReviewDecisions(root, report);
    const selected = selectedChapterReviewFindingIds(report, decisions);
    if (origin.targetPath !== report.path || origin.sourceHash !== report.sourceHash || origin.contextFingerprint !== report.contextFingerprint || decisions.revision !== origin.decisionRevision || !isDeepStrictEqual(origin.findingIds, selected)) throw new Error('报告或作者裁决已变化。');
    const anchors = selectedChapterReviewAnchors(report, selected);
    if (anchors.length !== origin.edits.length || anchors.some((anchor, i) => origin.edits[i]!.anchorId !== anchor.id || origin.edits[i]!.start !== anchor.start || origin.edits[i]!.end !== anchor.end)) throw new Error('候选扩大了修订范围。');
    const snapshot = await assertChapterReviewReportFresh(root, report);
    if (candidate !== undefined) assertChapterReviewCandidate(snapshot.chapter.content, candidate, origin.edits);
  } catch (error) { throw Object.assign(new Error(error instanceof Error ? error.message : '审稿修订已失效。'), { code: 'STALE_PENDING_ACTION_BASELINE' }); }
}
