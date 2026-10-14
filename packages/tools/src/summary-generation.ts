import { assertSummaryTargetPath, prepareSummaryGeneration, formatSummaryGenerationCoverage, parseSummaryGenerationDraft, mergeSummaryDocument } from '@oh-awesome-novel/core';
import type { SummaryGenerationSource } from '@oh-awesome-novel/core';
import { CandidateChangeSetBuilder } from './deterministic-change-producers';
import { createWorkspaceChangePolicy, validateCandidateChangeSetAgainstPolicy } from './workspace-change-policy';
import { createWorkspaceProjection } from './workspace-projection';
import type { WorkspaceProjectionPathRule } from './workspace-projection';
import type { CandidateFileSnapshot, RepositoryBaseline } from './candidate-change-set';
import type { PendingAction } from './pending-action-types';

export const SUMMARY_GENERATION_PRODUCER = 'summary-generation' as const;

/** Fixed source scope also captures newly added/deleted chapters for freshness. */
export function summaryGenerationProjectionRules(targetPath: string): WorkspaceProjectionPathRule[] {
  assertSummaryTargetPath(targetPath);
  const volume = /^summaries\/volume\/(\d{4})\.md$/u.exec(targetPath)?.[1];
  return [
    ...['chapters', 'summaries/chapter', 'state/chapters'].map((path) => ({ kind: 'prefix' as const, path: volume ? `${path}/${volume}` : path })),
    ...(volume ? [] : [{ kind: 'prefix' as const, path: 'summaries/volume' }]),
    { kind: 'exact', path: targetPath },
  ];
}

export function createSummaryGenerationChangeProposal(input: {
  targetPath: string; draft: unknown; sessionId: string; repository: RepositoryBaseline;
  projectionFingerprint: string; baselineFiles: readonly CandidateFileSnapshot[];
}) {
  const source = prepareSummaryGeneration({ files: input.baselineFiles }, input.targetPath);
  const report = formatSummaryGenerationCoverage(source);
  if (!source.ready) return { report, proposal: undefined };
  const draft = parseSummaryGenerationDraft(input.draft, source.sourceFingerprint, source.sources.map((file) => file.path));
  const baseline = input.baselineFiles.find((file) => file.path === input.targetPath);
  const content = mergeSummaryDocument(baseline?.content, {
    schemaVersion: 1, targetPath: input.targetPath, chapterIds: source.chapterIds,
    sources: source.sources.map(({ path, sourceHash, payloadHash }) => ({ path, sourceHash, payloadHash })),
    sourceFingerprint: source.sourceFingerprint, paragraphs: draft.paragraphs,
  });
  const builder = new CandidateChangeSetBuilder({ sessionId: input.sessionId, producer: SUMMARY_GENERATION_PRODUCER,
    capability: 'summary.edit', repository: input.repository, projectionFingerprint: input.projectionFingerprint,
    baselineFiles: baseline ? [baseline] : [] });
  builder.write(input.targetPath, content);
  const candidate = builder.finalize();
  if (!candidate) return { report: `${report}\n摘要内容相同，无需重复审批。`, proposal: undefined };
  validateCandidateChangeSetAgainstPolicy(candidate, createWorkspaceChangePolicy({ capability: 'summary.edit', exactWritablePaths: [input.targetPath] }));
  return { report, proposal: { candidate, origin: { kind: 'summaryGeneration' as const, targetPath: input.targetPath, sourceFingerprint: source.sourceFingerprint } } };
}

/** Materializer-owned guard; remains effective after restart and with permissive host hooks. */
export async function assertSummaryGenerationActionFresh(workspaceRoot: string, action: PendingAction): Promise<SummaryGenerationSource> {
  const origin = action.origin;
  if (origin?.kind !== 'summaryGeneration' || action.source.kind !== 'deterministic-builder'
    || action.source.producer !== SUMMARY_GENERATION_PRODUCER || action.source.capability !== 'summary.edit'
    || action.allowedTargets.length !== 1 || action.allowedTargets[0] !== origin.targetPath
    || action.changes.length !== 1 || action.changes[0]!.path !== origin.targetPath || action.changes[0]!.operation === 'delete') {
    throw new Error('Summary producer requires its exact target and evidence origin.');
  }
  try {
    const projection = await createWorkspaceProjection({ workspaceRoot, rules: summaryGenerationProjectionRules(origin.targetPath) });
    const source = prepareSummaryGeneration({ files: projection.baselineFiles }, origin.targetPath);
    if (!source.ready || source.sourceFingerprint !== origin.sourceFingerprint) throw new Error('Summary chapter inventory or source evidence changed; regenerate the summary.');
    return source;
  } catch (error) {
    throw Object.assign(new Error(`Summary sources are stale or unreadable: ${error instanceof Error ? error.message : String(error)}`), { code: 'STALE_PENDING_ACTION_BASELINE' });
  }
}
