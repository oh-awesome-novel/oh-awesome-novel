import { createChapterSettlementSource, prepareSummaryGeneration } from '@oh-awesome-novel/core';
import { createChapterSettlementChangeProposal, createSummaryGenerationChangeProposal } from '@oh-awesome-novel/tools';
import type { CandidateFileSnapshot } from '@oh-awesome-novel/tools';

export const fixtureRepository = { repositoryId: 'summary-fixture', branch: 'main', head: 'a'.repeat(40) };
export const fixtureFingerprint = 'b'.repeat(64);
export function settledSummaryFiles(chapterId = '0001/0001'): CandidateFileSnapshot[] {
  const content = '# 章节\n林安到达城门。\n'; const source = createChapterSettlementSource(chapterId, content);
  const chapter = { path: `chapters/${chapterId}.md`, content };
  const result = createChapterSettlementChangeProposal({ source, observations: { schemaVersion: 1, chapterId, sourceHash: source.sourceHash,
    observations: [{ id: 'arrive', category: 'location', subject: '林安', observation: '到达城门', confidence: 'high',
      evidence: { startLine: 2, endLine: 2, quote: '林安到达城门。' } }], unresolvedAmbiguities: [] },
    sessionId: 'summary-fixture', repository: fixtureRepository, projectionFingerprint: fixtureFingerprint, baselineFiles: [chapter] });
  return [chapter, ...result.proposal!.candidate.changes.map((change) => ({ path: change.path, content: change.draft!.content }))];
}
export function summaryDraft(files: readonly CandidateFileSnapshot[], targetPath: string, text = '林安到达城门。') {
  const source = prepareSummaryGeneration({ files }, targetPath);
  return { schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, paragraphs: [{ text, sourcePaths: source.sources.map((file) => file.path) }] };
}
export function appendSummary(files: CandidateFileSnapshot[], targetPath: string) {
  const proposal = createSummaryGenerationChangeProposal({ targetPath, draft: summaryDraft(files, targetPath), baselineFiles: files,
    sessionId: 'summary-fixture', repository: fixtureRepository, projectionFingerprint: fixtureFingerprint }).proposal;
  if (!proposal) throw new Error('Fixture summary inputs are incomplete.');
  for (const change of proposal.candidate.changes) files.push({ path: change.path, content: change.draft!.content });
}
