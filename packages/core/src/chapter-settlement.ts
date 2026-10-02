import { createHash } from 'node:crypto';
import type { ObservationCategory, ObservationLog } from './writing-settlement.js';
import { formatObservationLogMarkdown } from './writing-settlement.js';

const categories: ObservationCategory[] = ['character', 'location', 'item', 'resource', 'injury', 'power', 'status', 'relationship', 'emotionArc', 'informationBoundary', 'time', 'sceneState', 'foreshadow', 'worldFact'];
export interface ChapterSettlementSource { chapterId: string; sourceHash: string; content: string; bodyStartLine: number }
export interface ChapterSettlementObservation {
  id: string; category: ObservationCategory; subject: string; observation: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: { startLine: number; endLine: number; quote: string };
}
export interface ChapterSettlementObservationLog {
  schemaVersion: 1; chapterId: string; sourceHash: string;
  observations: ChapterSettlementObservation[]; unresolvedAmbiguities: string[];
}

export const CHAPTER_SETTLEMENT_OBSERVATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'chapterId', 'sourceHash', 'observations', 'unresolvedAmbiguities'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 }, chapterId: { type: 'string', pattern: '^\\d{4}/\\d{4}$' },
    sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    observations: { type: 'array', maxItems: 32, items: {
      type: 'object', additionalProperties: false, required: ['id', 'category', 'subject', 'observation', 'confidence', 'evidence'],
      properties: {
        id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' }, category: { type: 'string', enum: categories },
        subject: { type: 'string', minLength: 1, maxLength: 128 }, observation: { type: 'string', minLength: 1, maxLength: 512 },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        evidence: { type: 'object', additionalProperties: false, required: ['startLine', 'endLine', 'quote'], properties: {
          startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quote: { type: 'string', minLength: 1, maxLength: 1024 },
        } },
      },
    } },
    unresolvedAmbiguities: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 512 } },
  },
} as const;

export function assertChapterSettlementId(value: string): void {
  if (!/^(?!0000)\d{4}\/(?!0000)\d{4}$/u.test(value)) throw new Error('Settlement requires one numbered narrative chapter.');
}
export function resolveChapterSettlementSelection(paths: readonly string[]): { chapterId: string; chapterPath: string } {
  const chapterPath = paths.length === 1 ? paths[0] : undefined;
  const chapterId = chapterPath && /^chapters\/((?!0000)\d{4}\/(?!0000)\d{4})\.md$/u.exec(chapterPath)?.[1];
  if (!chapterId || !chapterPath) throw new Error('整理本章需要先打开一个已编号的正文文件（chapters/卷号/章号.md）。');
  return { chapterId, chapterPath };
}
export function createChapterSettlementSource(chapterId: string, content: string): ChapterSettlementSource {
  assertChapterSettlementId(chapterId);
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 256 * 1024) throw new Error('Settlement chapter must be non-empty and at most 256 KiB.');
  const lines = content.replace(/\r\n/gu, '\n').split('\n');
  let bodyStartLine = 1;
  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
    if (end < 0) throw new Error('Settlement chapter frontmatter is incomplete.');
    bodyStartLine = end + 2;
  }
  return Object.freeze({ chapterId, content, bodyStartLine, sourceHash: createHash('sha256').update(content).digest('hex') });
}

export function parseChapterSettlementObservationLog(value: unknown, source: ChapterSettlementSource): ChapterSettlementObservationLog {
  const checked = createChapterSettlementSource(source.chapterId, source.content);
  if (checked.sourceHash !== source.sourceHash || checked.bodyStartLine !== source.bodyStartLine) throw new Error('Settlement source identity is invalid.');
  const record = exact(value, ['schemaVersion', 'chapterId', 'sourceHash', 'observations', 'unresolvedAmbiguities']);
  if (record.schemaVersion !== 1 || record.chapterId !== source.chapterId || record.sourceHash !== source.sourceHash) throw new Error('Settlement source hash or chapter identity does not match the fixed chapter.');
  const lines = source.content.replace(/\r\n/gu, '\n').split('\n');
  const seen = new Set<string>();
  const observations = list(record.observations, 32).map((value): ChapterSettlementObservation => {
    const item = exact(value, ['id', 'category', 'subject', 'observation', 'confidence', 'evidence']);
    const id = text(item.id, 64);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id) || seen.has(id)) throw new Error('Settlement observation IDs must be valid and unique.');
    seen.add(id);
    if (!categories.includes(item.category as ObservationCategory) || typeof item.confidence !== 'string' || !['high', 'medium', 'low'].includes(item.confidence)) throw new Error('Settlement observation category or confidence is invalid.');
    const evidence = exact(item.evidence, ['startLine', 'endLine', 'quote']);
    if (!Number.isSafeInteger(evidence.startLine) || !Number.isSafeInteger(evidence.endLine)
      || (evidence.startLine as number) < source.bodyStartLine || (evidence.endLine as number) < (evidence.startLine as number)
      || (evidence.endLine as number) > lines.length) throw new Error('Settlement evidence line range is outside the chapter body.');
    const quote = text(evidence.quote, 1024, false);
    if (quote !== lines.slice((evidence.startLine as number) - 1, evidence.endLine as number).join('\n')) throw new Error('Settlement evidence quote does not match its exact chapter lines.');
    return { id, category: item.category as ObservationCategory, subject: text(item.subject, 128), observation: text(item.observation, 512), confidence: item.confidence as ChapterSettlementObservation['confidence'], evidence: { startLine: evidence.startLine as number, endLine: evidence.endLine as number, quote } };
  });
  return { schemaVersion: 1, chapterId: source.chapterId, sourceHash: source.sourceHash, observations,
    unresolvedAmbiguities: list(record.unresolvedAmbiguities, 16).map((value) => text(value, 512)),
  };
}

export function formatChapterSettlementObservationLog(log: ChapterSettlementObservationLog): string {
  const compatible: ObservationLog = { chapterId: log.chapterId, unresolvedAmbiguities: log.unresolvedAmbiguities,
    observations: log.observations.map((item) => ({ ...item, evidence: item.evidence.quote, location: `lines ${item.evidence.startLine}-${item.evidence.endLine}` })),
  };
  return `${formatObservationLogMarkdown(compatible)}\n\nSource SHA-256: ${log.sourceHash}\nOnly high-confidence observations enter the summary/state candidate; all ambiguities remain in this report.`;
}

function exact(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key))) throw new Error('Settlement observation schema has missing or unknown fields.');
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Settlement observation array exceeds its schema limits.');
  return value;
}
function text(value: unknown, max: number, singleLine = true): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value) || (singleLine && /[\n\r]/u.test(value))) throw new Error('Settlement text is invalid or exceeds its schema limits.');
  return value;
}
