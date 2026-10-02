import { parseDocument, stringify } from 'yaml';
import { assertChapterSettlementId, createChapterSettlementSource, parseChapterSettlementObservationLog, formatChapterSettlementObservationLog } from '@oh-awesome-novel/core';
import type { ChapterSettlementSource } from '@oh-awesome-novel/core';
import { CandidateChangeSetBuilder } from './deterministic-change-producers';
import { createWorkspaceChangePolicy, validateCandidateChangeSetAgainstPolicy } from './workspace-change-policy';
import { createWorkspaceProjection } from './workspace-projection';
import type { CandidateFileSnapshot, RepositoryBaseline } from './candidate-change-set';
import type { PendingAction } from './pending-action-types';
import { sha256Text } from './candidate-change-set';
import { validateFinalDocument } from './final-document-validator';
import { appendManagedBlock, compileChapterSettlementDomains, isSettlementMergeConflict, markdownText } from './chapter-settlement-domains';

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
  const compiled = compileChapterSettlementDomains(log, input.baselineFiles);
  let report = formatChapterSettlementObservationLog(log);
  if (compiled.conflicts.length) report += `\n\n### Merge conflicts (report only)\n${compiled.conflicts.map((conflict) => `- ${conflict}`).join('\n')}`;
  const confirmed = log.observations.filter((observation) => observation.confidence === 'high' && !compiled.excluded.has(observation.id));
  if (!confirmed.length) return { log, report, proposal: undefined };
  const [summaryPath, statePath] = chapterSettlementTargets(log.chapterId);
  const baselineMap = new Map(input.baselineFiles.map((file) => [file.path, file.content]));
  try {
    const id = `summary-${log.sourceHash}`;
    const block = `<!-- oan:settlement:${id} -->\n## Evidence snapshot ${log.sourceHash.slice(0, 12)}\n\nSource SHA-256: ${log.sourceHash}\n\n${confirmed.map((item) => `- ${markdownText(item.subject)}: ${markdownText(item.observation)} (lines ${item.evidence.startLine}-${item.evidence.endLine})`).join('\n')}\n<!-- /oan:settlement:${id} -->`;
    const summary = appendManagedBlock(baselineMap.get(summaryPath) ?? `---\n${stringify({ id: log.chapterId })}---\n# Chapter ${log.chapterId} summary\n`, id, block);
    compiled.files.set(summaryPath, updateSummaryCurrent(summary, log.chapterId, log.sourceHash));
    compiled.files.set(statePath, mergeChapterEvidence(baselineMap.get(statePath), { version: 1, chapterRef: log.chapterId, sourceHash: log.sourceHash, observations: confirmed }));
  } catch (error) {
    if (!isSettlementMergeConflict(error) && !(error instanceof ChapterEvidenceConflict)) throw error;
    report += `\n\n### Merge conflicts (report only)\n- Chapter evidence: ${error.message}`;
    return { log, report, proposal: undefined };
  }
  const targets = [...compiled.files].filter(([path, content]) => baselineMap.get(path) !== content).map(([path]) => path).sort();
  const baselines = input.baselineFiles.filter((file) => targets.includes(file.path));
  const builder = new CandidateChangeSetBuilder({
    sessionId: input.sessionId, producer: CHAPTER_SETTLEMENT_PRODUCER, capability: 'novel.multi-file-edit',
    repository: input.repository, projectionFingerprint: input.projectionFingerprint, baselineFiles: baselines,
  });
  for (const path of targets) builder.write(path, compiled.files.get(path)!);
  const candidate = builder.finalize();
  if (!candidate) return { log, report, proposal: undefined };
  const policy = createWorkspaceChangePolicy({ capability: 'novel.multi-file-edit', exactWritablePaths: targets });
  validateCandidateChangeSetAgainstPolicy(candidate, policy);
  const readPaths = new Set([...compiled.readPaths, ...targets, summaryPath, statePath, `chapters/${log.chapterId}.md`]);
  if (readPaths.size > 128) throw new Error('Settlement merge dependencies exceed the 128-file limit.');
  const inputFiles = [...readPaths].sort().map((path) => ({ path,
    sha256: path === `chapters/${log.chapterId}.md` ? log.sourceHash : baselineMap.has(path) ? sha256Text(baselineMap.get(path)!) : null,
  }));
  return { log, report, proposal: {
    candidate, origin: { kind: 'chapterSettlement' as const, chapterId: log.chapterId, sourceHash: log.sourceHash, inputFiles,
      characterInventoryHash: characterInventoryHash(input.baselineFiles) },
  } };
}

/** Rechecks the immutable chapter evidence when an author accepts the candidate. */
export async function assertChapterSettlementActionFresh(workspaceRoot: string, action: PendingAction): Promise<void> {
  const origin = action.origin;
  if (origin?.kind !== 'chapterSettlement'
    || action.source.kind !== 'deterministic-builder' || action.source.producer !== CHAPTER_SETTLEMENT_PRODUCER
    || action.source.capability !== 'novel.multi-file-edit') throw new Error('Settlement action origin does not match its producer.');
  const targets = new Set([...chapterSettlementTargets(origin.chapterId), 'state/characters.yaml', 'timeline/events.yaml', 'foreshadow/active.yaml', 'foreshadow/resolved.yaml']);
  const allowed = (path: string) => targets.has(path) || /^characters\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/growth\.md$/u.test(path);
  const readPaths = new Set(origin.inputFiles.map((file) => file.path));
  if (action.changes.some((change) => change.operation === 'delete' || !allowed(change.path) || !readPaths.has(change.path))
    || action.allowedTargets.some((path) => !allowed(path) || !readPaths.has(path))) throw new Error('Settlement candidate escaped its derived targets or omitted target baseline evidence.');
  const chapterPath = `chapters/${origin.chapterId}.md`;
  let projection: Awaited<ReturnType<typeof createWorkspaceProjection>>;
  try {
    projection = await createWorkspaceProjection({ workspaceRoot, rules: [
      ...origin.inputFiles.map((file) => ({ kind: 'exact' as const, path: file.path })),
      { kind: 'prefix', path: 'characters' },
    ] });
  } catch (error) {
    throw Object.assign(new Error(`Settlement merge dependencies are no longer readable: ${error instanceof Error ? error.message : String(error)}`), { code: 'STALE_PENDING_ACTION_BASELINE' });
  }
  const current = new Map(projection.baselineFiles.map((file) => [file.path, sha256Text(file.content)]));
  if (characterInventoryHash(projection.baselineFiles) !== origin.characterInventoryHash
    || origin.inputFiles.some((file) => (current.get(file.path) ?? null) !== file.sha256)) {
    throw Object.assign(new Error('Settlement chapter or merge dependencies changed; generate a new observation log.'), { code: 'STALE_PENDING_ACTION_BASELINE' });
  }
  const content = projection.baselineFiles.find((file) => file.path === chapterPath)?.content;
  if (content === undefined || createChapterSettlementSource(origin.chapterId, content).sourceHash !== origin.sourceHash) {
    throw Object.assign(new Error('Settlement chapter evidence changed; generate a new observation log.'), { code: 'STALE_PENDING_ACTION_BASELINE' });
  }
}

function characterInventoryHash(files: readonly CandidateFileSnapshot[]): string {
  return sha256Text(JSON.stringify(files.map((file) => file.path)
    .filter((path) => /^characters\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/(?:[^/.][^/]*\/)*[^/.][^/]*\.(?:md|yaml)$/u.test(path)).sort()));
}

class ChapterEvidenceConflict extends Error {}
function mergeChapterEvidence(content: string | undefined, evidence: { version: number; chapterRef: string; sourceHash: string; observations: unknown[] }): string {
  if (content === undefined) return stringify(evidence);
  const doc = parseDocument(content, { uniqueKeys: true });
  if (doc.errors.length) throw new ChapterEvidenceConflict('Existing chapter state is not valid YAML.');
  const value = doc.toJS({ maxAliasCount: 100 }) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChapterEvidenceConflict('Existing chapter state is not a mapping.');
  if (value.chapterRef !== undefined && value.chapterRef !== evidence.chapterRef) throw new ChapterEvidenceConflict('Existing chapter state belongs to another chapter.');
  const ownedRoot = value.version === 1 && value.chapterRef === evidence.chapterRef && typeof value.sourceHash === 'string' && /^[a-f0-9]{64}$/u.test(value.sourceHash) && Array.isArray(value.observations);
  const current = (ownedRoot ? value : value.settlementCurrent) as Record<string, unknown> | undefined;
  if (current && typeof current === 'object' && !Array.isArray(current) && current.sourceHash === evidence.sourceHash) {
    if (JSON.stringify(current.observations) === JSON.stringify(evidence.observations)) return content;
    throw new ChapterEvidenceConflict('This source already has different chapter observations; preserve the existing record.');
  }
  // Preserve prior evidence and all author fields. Later source revisions are separate records.
  const records = value.settlementRecords ?? [];
  if (!Array.isArray(records)) throw new ChapterEvidenceConflict('Existing chapter settlementRecords must be an array.');
  if (records.some((entry) => entry && typeof entry === 'object' && entry.sourceHash === evidence.sourceHash)) throw new ChapterEvidenceConflict('This source was superseded by a later settlement; review the chapter history before restoring it.');
  if (current !== undefined) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new ChapterEvidenceConflict('Existing settlementCurrent must be a mapping.');
    const previous = ownedRoot ? { version: value.version, chapterRef: value.chapterRef, sourceHash: value.sourceHash, observations: value.observations } : current;
    doc.set('settlementRecords', [...records, previous]);
  }
  if (ownedRoot) {
    doc.set('sourceHash', evidence.sourceHash);
    doc.set('observations', evidence.observations);
  } else doc.set('settlementCurrent', evidence);
  const result = doc.toString();
  validateFinalDocument({ path: `state/chapters/${evidence.chapterRef}.yaml`, content: result });
  return result;
}

function updateSummaryCurrent(content: string, chapterId: string, sourceHash: string): string {
  const id = `summary-current-${chapterId.replace('/', '-')}`;
  const start = `<!-- oan:settlement:${id} -->`;
  const end = `<!-- /oan:settlement:${id} -->`;
  const render = (hash: string) => `${start}\nCurrent evidence source SHA-256: ${hash}\nEvidence snapshots preserve accepted history. Only the snapshot matching this hash describes the current settled chapter; other snapshots are historical.\n${end}`;
  const at = content.indexOf(start);
  if (at < 0) return appendManagedBlock(content, id, render(sourceHash));
  const finish = content.indexOf(end, at);
  const current = content.slice(at, finish + end.length);
  const hash = /^Current evidence source SHA-256: ([a-f0-9]{64})$/mu.exec(current)?.[1];
  if (!hash || finish < 0 || current !== render(hash) || content.indexOf(start, at + start.length) >= 0) throw new ChapterEvidenceConflict('The summary current-source marker was edited; preserve author content.');
  return `${content.slice(0, at)}${render(sourceHash)}${content.slice(finish + end.length)}`;
}
