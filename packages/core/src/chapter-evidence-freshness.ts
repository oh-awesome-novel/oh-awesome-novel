import { createHash } from 'node:crypto';
import { parseDocument, stringify } from 'yaml';
import { createChapterSettlementSource, parseChapterSettlementObservationLog } from './chapter-settlement.js';
import type { ChapterSettlementObservation } from './chapter-settlement.js';

export interface FrozenWorkspaceFile { readonly path: string; readonly content: string }
export interface FrozenWorkspaceSnapshot { readonly files: readonly FrozenWorkspaceFile[]; readonly directories?: readonly string[] }
export type ChapterEvidenceFreshness = 'current' | 'stale' | 'missing' | 'unverified';
export interface ChapterEvidenceAssessment {
  readonly path: string;
  readonly status: ChapterEvidenceFreshness;
  readonly reason: string;
  readonly sourceHash?: string;
  /** Explicitly derived context, never canonical bytes or an approval draft. */
  readonly context?: string;
}
export interface ChapterEvidenceCoverage {
  readonly chapterId: string;
  readonly chapterPath: string;
  readonly chapterHash?: string;
  readonly summary: ChapterEvidenceAssessment;
  readonly state: ChapterEvidenceAssessment;
}
const HASH = /^[a-f0-9]{64}$/u;
const ID = '(?!0000)\\d{4}/(?!0000)\\d{4}';
const chapterPattern = new RegExp(`^chapters/(${ID})\\.md$`, 'u');
const summaryPattern = new RegExp(`^summaries/chapter/(${ID})\\.md$`, 'u');
const statePattern = new RegExp(`^state/chapters/(${ID})\\.ya?ml$`, 'u');
interface ValidatedChapterState extends ChapterEvidenceAssessment { readonly currentObservations?: readonly ChapterSettlementObservation[] }

/** One deterministic evaluation of already-frozen, visible inputs; no filesystem reads. */
export function evaluateChapterEvidence(snapshot: FrozenWorkspaceSnapshot): readonly ChapterEvidenceCoverage[] {
  const files = new Map(snapshot.files.map((file) => [file.path, file.content]));
  const ids = new Set(snapshot.files.flatMap(({ path }) => {
    const id = chapterPattern.exec(path)?.[1] ?? summaryPattern.exec(path)?.[1] ?? statePattern.exec(path)?.[1];
    return id ? [id] : [];
  }));
  return Object.freeze([...ids].sort().map((chapterId) => {
    const chapterPath = `chapters/${chapterId}.md`;
    const chapter = files.get(chapterPath);
    const chapterHash = chapter === undefined ? undefined : hash(chapter);
    const statePath = files.has(`state/chapters/${chapterId}.yml`) ? `state/chapters/${chapterId}.yml` : `state/chapters/${chapterId}.yaml`;
    const state = files.has(`state/chapters/${chapterId}.yaml`) && files.has(`state/chapters/${chapterId}.yml`)
      ? result(statePath, 'unverified', 'Both .yaml and .yml chapter evidence files exist; source is ambiguous.')
      : assessState(statePath, files.get(statePath), chapterId, chapter, chapterHash);
    const summaryPath = `summaries/chapter/${chapterId}.md`;
    const summary = assessSummary(summaryPath, files.get(summaryPath), chapterId, chapterHash, state);
    return Object.freeze({ chapterId, chapterPath, ...(chapterHash ? { chapterHash } : {}), summary, state });
  }));
}

function result(path: string, status: ChapterEvidenceFreshness, reason: string, extra: Partial<ChapterEvidenceAssessment> = {}): ChapterEvidenceAssessment {
  return Object.freeze({ path, status, reason, ...extra });
}
function assessState(path: string, content: string | undefined, chapterId: string, chapter: string | undefined, chapterHash: string | undefined): ValidatedChapterState {
  if (content === undefined) return result(path, 'missing', 'No chapter evidence file.');
  try {
    const doc = parseDocument(content, { uniqueKeys: true });
    if (doc.errors.length) throw new Error('Invalid YAML.');
    const value: unknown = doc.toJS({ maxAliasCount: 100 });
    if (!record(value)) throw new Error('Chapter state must be a mapping.');
    const owned = value.version === 1 && typeof value.sourceHash === 'string' && Array.isArray(value.observations);
    if (owned && value.settlementCurrent !== undefined) throw new Error('Conflicting current evidence records.');
    const current = owned ? value : value.settlementCurrent;
    if (!record(current) || current.version !== 1 || current.chapterRef !== chapterId || typeof current.sourceHash !== 'string' || !HASH.test(current.sourceHash) || !Array.isArray(current.observations)) throw new Error('Missing or invalid chapter evidence metadata.');
    if (value.chapterRef !== undefined && value.chapterRef !== chapterId) throw new Error('Chapter identity does not match the path.');
    if (value.settlementRecords !== undefined && (!Array.isArray(value.settlementRecords) || value.settlementRecords.some((entry) => !record(entry) || entry.chapterRef !== chapterId || typeof entry.sourceHash !== 'string' || !HASH.test(entry.sourceHash) || entry.sourceHash === current.sourceHash))) throw new Error('Conflicting chapter evidence history.');
    if (chapter === undefined) return result(path, 'unverified', 'Source chapter is missing from the visible snapshot.', { sourceHash: current.sourceHash });
    if (current.sourceHash !== chapterHash) return result(path, 'stale', 'Source chapter bytes changed since settlement.', { sourceHash: current.sourceHash });
    const source = createChapterSettlementSource(chapterId, chapter);
    const log = parseChapterSettlementObservationLog({ schemaVersion: 1, chapterId, sourceHash: current.sourceHash, observations: current.observations, unresolvedAmbiguities: [] }, source);
    if (log.observations.some((observation) => observation.confidence !== 'high')) throw new Error('Current evidence contains unconfirmed observations.');
    // Preserve every author field; omit only the explicitly historical managed record list.
    const { settlementRecords: _history, ...currentAndAuthorFields } = value;
    return Object.freeze({ ...result(path, 'current', 'Current evidence matches the source chapter hash and exact quotes; author fields are not evidence-verified.', {
      sourceHash: current.sourceHash,
      context: `Freshness: current chapter evidence. Derived view: current evidence and all author fields; settlementRecords history is omitted and available through fixed-projection reads. This is not the complete canonical file.\n\n${stringify(currentAndAuthorFields)}`,
    }), currentObservations: Object.freeze(log.observations) });
  } catch {
    return result(path, 'unverified', 'Missing, edited, contradictory, or unverifiable chapter evidence metadata.');
  }
}

function assessSummary(path: string, content: string | undefined, chapterId: string, chapterHash: string | undefined, state: ValidatedChapterState): ChapterEvidenceAssessment {
  if (content === undefined) return result(path, 'missing', 'No chapter summary file.');
  if (!content.includes('oan:settlement:') && !content.includes('Source SHA-256:')) {
    return result(path, 'unverified', 'Author summary has no verifiable source coverage.', { context: `Freshness: unverified author reference. No source hash proves that this summary matches current chapter text; check the chapter before treating it as current facts.\n\n${content}` });
  }
  try {
    if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n/u.exec(content)?.[1];
      if (frontmatter === undefined) throw new Error('Invalid summary frontmatter.');
      const metadata = parseDocument(frontmatter, { uniqueKeys: true });
      const value: unknown = metadata.toJS({ maxAliasCount: 100 });
      if (metadata.errors.length || !record(value) || value.id !== chapterId) throw new Error('Summary identity does not match its path.');
    }
    const id = `summary-current-${chapterId.replace('/', '-')}`;
    const start = `<!-- oan:settlement:${id} -->`;
    const end = `<!-- /oan:settlement:${id} -->`;
    const block = extractUnique(content, start, end);
    const sourceHash = /^Current evidence source SHA-256: ([a-f0-9]{64})$/mu.exec(block)?.[1];
    if (!sourceHash || block !== `${start}\nCurrent evidence source SHA-256: ${sourceHash}\nEvidence snapshots preserve accepted history. Only the snapshot matching this hash describes the current settled chapter; other snapshots are historical.\n${end}`) throw new Error('Edited source pointer.');
    const snapshotStart = `<!-- oan:settlement:summary-${sourceHash} -->`;
    const snapshotEnd = `<!-- /oan:settlement:summary-${sourceHash} -->`;
    const evidence = extractUnique(content, snapshotStart, snapshotEnd);
    const prefix = `${snapshotStart}\n## Evidence snapshot ${sourceHash.slice(0, 12)}\n\nSource SHA-256: ${sourceHash}\n\n`;
    if (!evidence.startsWith(prefix) || !evidence.endsWith(`\n${snapshotEnd}`)) throw new Error('Edited snapshot metadata.');
    // Every managed block must be well paired; never leak a malformed historical block.
    const blocks = [...content.matchAll(/<!-- oan:settlement:(summary-(?:[a-f0-9]{64}|current-\d{4}-\d{4})) -->[\s\S]*?<!-- \/oan:settlement:\1 -->/gu)];
    let authorContent = content;
    for (const match of blocks) authorContent = authorContent.replace(match[0], '');
    if (authorContent.includes('oan:settlement:') || blocks.filter((match) => match[1].startsWith('summary-current-')).length !== 1) throw new Error('Invalid summary block structure.');
    if (!chapterHash) return result(path, 'unverified', 'Source chapter is missing from the visible snapshot.', { sourceHash });
    if (sourceHash !== chapterHash) return result(path, 'stale', 'Source chapter bytes changed since settlement.', { sourceHash });
    // Current summary and chapter evidence are produced together. Cross-check their exact
    // normalized observations rather than trusting an editable source-hash label alone.
    if (state.status !== 'current' || state.sourceHash !== sourceHash || !state.currentObservations) throw new Error('Current chapter evidence cannot verify the summary.');
    const expected = state.currentObservations.map((item) => `- ${markdownText(item.subject)}: ${markdownText(item.observation)} (lines ${item.evidence.startLine}-${item.evidence.endLine})`).join('\n');
    if (evidence !== `${prefix}${expected}\n${snapshotEnd}`) throw new Error('Summary evidence was edited.');
    return result(path, 'current', 'Current summary evidence matches chapter hash and validated chapter observations.', { sourceHash,
      context: `Freshness: current evidence snapshot; historical snapshots omitted. Source SHA-256: ${sourceHash}\n\n${expected}${authorContent.trim() ? `\n\nAuthor text (unverified reference; not covered by the evidence check):\n${authorContent.trim()}` : ''}`,
    });
  } catch {
    return result(path, 'unverified', 'Missing, edited, contradictory, or unverifiable summary source metadata.');
  }
}

/** Counts and a fixed-size sample, never an unbounded list of chapter/history content. */
export function formatChapterEvidenceCoverage(coverage: readonly ChapterEvidenceCoverage[], selectedChapterIds: readonly string[] = []): string {
  const counts = (kind: 'summary' | 'state') => ['current', 'stale', 'missing', 'unverified'].map((status) => `${status}=${coverage.filter((item) => item[kind].status === status).length}`).join(', ');
  const selected = new Set(selectedChapterIds);
  const ordered = [...coverage].sort((a, b) => Number(selected.has(b.chapterId)) - Number(selected.has(a.chapterId)) || b.chapterId.localeCompare(a.chapterId));
  const fingerprint = hash(JSON.stringify(coverage.map((item) => [item.chapterId, item.chapterHash ?? null, item.summary.status, item.summary.sourceHash ?? null, item.state.status, item.state.sourceHash ?? null])));
  return [
    'Chapter evidence coverage (derived from this fixed projection; hash freshness does not prove literary interpretation).',
    `Chapters: ${coverage.length}. Summary: ${counts('summary')}. Chapter state: ${counts('state')}.`,
    `Coverage fingerprint: ${fingerprint}.`,
    'Current global state is protected. Unselected chapter evidence and all historical settlement records are available through fixed-projection reads; they are not implicitly current facts.',
    ...ordered.slice(0, 12).map((item) => `${item.chapterId}: summary=${item.summary.status}, chapter-state=${item.state.status}${selected.has(item.chapterId) ? ' (selected chapter)' : ''}.`),
    ...(coverage.length > 12 ? [`${coverage.length - 12} other chapter statuses omitted from this bounded report.`] : []),
  ].join('\n');
}
function extractUnique(content: string, start: string, end: string): string {
  const at = content.indexOf(start); const finish = content.indexOf(end);
  if (at < 0 || finish < at || content.indexOf(start, at + start.length) >= 0 || content.indexOf(end, finish + end.length) >= 0) throw new Error('Missing or duplicated evidence block.');
  return content.slice(at, finish + end.length);
}
function markdownText(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function hash(content: string): string { return createHash('sha256').update(content).digest('hex'); }
