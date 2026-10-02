import { stringify } from 'yaml';
import { assertChapterSettlementId, createChapterSettlementSource, parseChapterSettlementObservationLog, formatChapterSettlementObservationLog } from '@oh-awesome-novel/core';
import type { ChapterSettlementSource } from '@oh-awesome-novel/core';
import { CandidateChangeSetBuilder } from './deterministic-change-producers';
import { createWorkspaceChangePolicy, validateCandidateChangeSetAgainstPolicy } from './workspace-change-policy';
import { createWorkspaceProjection } from './workspace-projection';
import type { CandidateFileSnapshot, RepositoryBaseline } from './candidate-change-set';
import type { PendingAction } from './pending-action-types';

export const CHAPTER_SETTLEMENT_PRODUCER = 'chapter-settlement' as const;

export function chapterSettlementTargets(chapterId: string): [string, string] {
  assertChapterSettlementId(chapterId);
  return [`summaries/chapter/${chapterId}.md`, `state/chapters/${chapterId}.yaml`];
}

export function createChapterSettlementChangeProposal(input: {
  source: ChapterSettlementSource; observations: unknown; sessionId: string;
  repository: RepositoryBaseline; projectionFingerprint: string; baselineFiles: readonly CandidateFileSnapshot[];
}) {
  const log = parseChapterSettlementObservationLog(input.observations, input.source);
  const report = formatChapterSettlementObservationLog(log);
  const confirmed = log.observations.filter((observation) => observation.confidence === 'high');
  if (!confirmed.length) return { log, report, proposal: undefined };
  const targets = chapterSettlementTargets(log.chapterId);
  const baselines = input.baselineFiles.filter((file) => targets.includes(file.path));
  const builder = new CandidateChangeSetBuilder({
    sessionId: input.sessionId, producer: CHAPTER_SETTLEMENT_PRODUCER, capability: 'novel.multi-file-edit',
    repository: input.repository, projectionFingerprint: input.projectionFingerprint, baselineFiles: baselines,
  });
  builder.write(targets[0], `---\n${stringify({ id: log.chapterId })}---\n# Chapter ${log.chapterId} summary\n\nSource SHA-256: ${log.sourceHash}\n\n${confirmed.map((item) => `- ${item.subject}: ${item.observation} (lines ${item.evidence.startLine}-${item.evidence.endLine})`).join('\n')}\n`);
  builder.write(targets[1], stringify({ version: 1, chapterRef: log.chapterId, sourceHash: log.sourceHash, observations: confirmed }));
  const candidate = builder.finalize();
  if (!candidate) return { log, report, proposal: undefined };
  const policy = createWorkspaceChangePolicy({ capability: 'novel.multi-file-edit', exactWritablePaths: targets });
  validateCandidateChangeSetAgainstPolicy(candidate, policy);
  return { log, report, proposal: {
    candidate, origin: { kind: 'chapterSettlement' as const, chapterId: log.chapterId, sourceHash: log.sourceHash },
  } };
}

/** Rechecks the immutable chapter evidence when an author accepts the candidate. */
export async function assertChapterSettlementActionFresh(workspaceRoot: string, action: PendingAction): Promise<void> {
  const origin = action.origin;
  if (origin?.kind !== 'chapterSettlement'
    || action.source.kind !== 'deterministic-builder' || action.source.producer !== CHAPTER_SETTLEMENT_PRODUCER
    || action.source.capability !== 'novel.multi-file-edit') throw new Error('Settlement action origin does not match its producer.');
  const targets = chapterSettlementTargets(origin.chapterId);
  if (action.changes.some((change) => change.operation === 'delete' || !targets.includes(change.path))
    || action.allowedTargets.some((path) => !targets.includes(path))) throw new Error('Settlement candidate escaped its chapter targets.');
  const chapterPath = `chapters/${origin.chapterId}.md`;
  const projection = await createWorkspaceProjection({ workspaceRoot, rules: [{ kind: 'exact', path: chapterPath }], maxFileBytes: 256 * 1024 });
  const content = projection.baselineFiles.find((file) => file.path === chapterPath)?.content;
  if (content === undefined || createChapterSettlementSource(origin.chapterId, content).sourceHash !== origin.sourceHash) {
    throw Object.assign(new Error('Settlement chapter evidence changed; generate a new observation log.'), { code: 'STALE_PENDING_ACTION_BASELINE' });
  }
}
