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
  /** Explicitly ambiguous observations are excluded from every truth file. */
  unresolvedObservationIds?: string[];
  domainChanges?: ChapterSettlementDomainChange[];
}

export type ChapterSettlementStateField = 'hp' | 'emotion' | 'location' | 'status' | 'power' | 'inventory' | 'resources' | 'information' | 'relationships';
export type ChapterSettlementDomainChange =
  | { domain: 'state'; observationId: string; characterId: string; field: ChapterSettlementStateField; expectedValue: string | null; value: string }
  | { domain: 'timeline'; observationId: string; title: string; time: string }
  | { domain: 'foreshadow'; observationId: string; operation: 'create'; hookId: string; description: string; relatedCharacters: string[] }
  | { domain: 'foreshadow'; observationId: string; operation: 'mention' | 'advance' | 'resolve' | 'defer'; hookId: string; expectedStatus: string }
  | { domain: 'character'; observationId: string; characterId: string };

const stateCategories: Record<ChapterSettlementStateField, readonly ObservationCategory[]> = {
  hp: ['injury', 'status'], emotion: ['emotionArc'], location: ['location'], status: ['status', 'sceneState'],
  power: ['power'], inventory: ['item'], resources: ['resource'], information: ['informationBoundary'], relationships: ['relationship'],
};
const idSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' } as const;
const characterSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' } as const;
const boundedTextSchema = { type: 'string', minLength: 1, maxLength: 512 } as const;
const hookStatuses = ['draft', 'planned', 'planted', 'active', 'developing', 'dormant', 'resolved', 'paid-off', 'paid_off', 'abandoned'];

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
    unresolvedObservationIds: { type: 'array', maxItems: 32, uniqueItems: true, items: idSchema },
    domainChanges: { type: 'array', maxItems: 32, items: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['domain', 'observationId', 'characterId', 'field', 'expectedValue', 'value'], properties: {
        domain: { const: 'state' }, observationId: idSchema, characterId: characterSchema,
        field: { type: 'string', enum: Object.keys(stateCategories) }, expectedValue: { anyOf: [boundedTextSchema, { type: 'null' }] }, value: boundedTextSchema,
      } },
      { type: 'object', additionalProperties: false, required: ['domain', 'observationId', 'title', 'time'], properties: {
        domain: { const: 'timeline' }, observationId: idSchema, title: boundedTextSchema, time: boundedTextSchema,
      } },
      { type: 'object', additionalProperties: false, required: ['domain', 'observationId', 'operation', 'hookId', 'description', 'relatedCharacters'], properties: {
        domain: { const: 'foreshadow' }, observationId: idSchema, operation: { const: 'create' }, hookId: idSchema,
        description: boundedTextSchema, relatedCharacters: { type: 'array', maxItems: 16, uniqueItems: true, items: characterSchema },
      } },
      { type: 'object', additionalProperties: false, required: ['domain', 'observationId', 'operation', 'hookId', 'expectedStatus'], properties: {
        domain: { const: 'foreshadow' }, observationId: idSchema, operation: { type: 'string', enum: ['mention', 'advance', 'resolve', 'defer'] },
        hookId: idSchema, expectedStatus: { type: 'string', enum: hookStatuses },
      } },
      { type: 'object', additionalProperties: false, required: ['domain', 'observationId', 'characterId'], properties: {
        domain: { const: 'character' }, observationId: idSchema, characterId: characterSchema,
      } },
    ] } },
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
  const record = exact(value, ['schemaVersion', 'chapterId', 'sourceHash', 'observations', 'unresolvedAmbiguities'], ['domainChanges', 'unresolvedObservationIds']);
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
    ...(record.unresolvedObservationIds === undefined ? {} : { unresolvedObservationIds: uniqueStrings(record.unresolvedObservationIds, 32).map((id) => {
      if (!seen.has(id)) throw new Error('Settlement ambiguity references an unknown observation.');
      return id;
    }) }),
    ...(record.domainChanges === undefined ? {} : { domainChanges: parseDomainChanges(record.domainChanges, observations) }),
  };
}

export function formatChapterSettlementObservationLog(log: ChapterSettlementObservationLog): string {
  const compatible: ObservationLog = { chapterId: log.chapterId, unresolvedAmbiguities: log.unresolvedAmbiguities,
    observations: log.observations.map((item) => ({ ...item, evidence: item.evidence.quote, location: `lines ${item.evidence.startLine}-${item.evidence.endLine}` })),
  };
  return `${formatObservationLogMarkdown(compatible)}\n\nSource SHA-256: ${log.sourceHash}\nOnly high-confidence, unambiguous observations enter settlement candidates; all ambiguities and conflicts remain in this report.${log.unresolvedObservationIds?.length ? `\nUnresolved observation IDs: ${log.unresolvedObservationIds.join(', ')}` : ''}`;
}

function exact(value: unknown, fields: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key) && !optional.includes(key)) || fields.some((key) => !Object.hasOwn(value, key))) throw new Error('Settlement observation schema has missing or unknown fields.');
  return value as Record<string, unknown>;
}

function uniqueStrings(value: unknown, max: number): string[] {
  const values = list(value, max).map((item) => text(item, 128));
  if (new Set(values).size !== values.length) throw new Error('Settlement references must be unique.');
  return values;
}
function safeCharacter(value: unknown): string {
  const id = text(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id) || id.includes('..') || ['constructor', 'prototype', '__proto__'].includes(id)) throw new Error('Settlement character identity is invalid.');
  return id;
}
function parseDomainChanges(value: unknown, observations: ChapterSettlementObservation[]): ChapterSettlementDomainChange[] {
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const targets = new Set<string>();
  return list(value, 32).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Settlement domain change must be an object.');
    const item = entry as Record<string, unknown>;
    const observation = byId.get(text(item.observationId, 64));
    if (!observation) throw new Error('Settlement domain change references an unknown observation.');
    let result: ChapterSettlementDomainChange;
    let allowed: readonly ObservationCategory[];
    let key: string;
    if (item.domain === 'state') {
      exact(item, ['domain', 'observationId', 'characterId', 'field', 'expectedValue', 'value']);
      if (typeof item.field !== 'string' || !Object.hasOwn(stateCategories, item.field)) throw new Error('Settlement state field is invalid.');
      const characterId = safeCharacter(item.characterId);
      const field = item.field as ChapterSettlementStateField;
      result = { domain: 'state', observationId: observation.id, characterId, field, expectedValue: item.expectedValue === null ? null : text(item.expectedValue, 512), value: text(item.value, 512) };
      allowed = stateCategories[field]; key = `state:${characterId}:${field}`;
    } else if (item.domain === 'timeline') {
      exact(item, ['domain', 'observationId', 'title', 'time']);
      result = { domain: 'timeline', observationId: observation.id, title: text(item.title, 512), time: text(item.time, 512) };
      allowed = ['time', 'sceneState']; key = `timeline:${observation.id}`;
    } else if (item.domain === 'character') {
      exact(item, ['domain', 'observationId', 'characterId']);
      result = { domain: 'character', observationId: observation.id, characterId: safeCharacter(item.characterId) };
      allowed = ['character', 'relationship']; key = `character:${result.characterId}:${observation.id}`;
    } else if (item.domain === 'foreshadow') {
      const hookId = text(item.hookId, 64);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(hookId)) throw new Error('Settlement hook ID is invalid.');
      if (item.operation === 'create') {
        exact(item, ['domain', 'observationId', 'operation', 'hookId', 'description', 'relatedCharacters']);
        result = { domain: 'foreshadow', observationId: observation.id, operation: 'create', hookId, description: text(item.description, 512), relatedCharacters: uniqueStrings(item.relatedCharacters, 16).map(safeCharacter) };
      } else {
        exact(item, ['domain', 'observationId', 'operation', 'hookId', 'expectedStatus']);
        if (typeof item.operation !== 'string' || !['mention', 'advance', 'resolve', 'defer'].includes(item.operation) || typeof item.expectedStatus !== 'string' || !hookStatuses.includes(item.expectedStatus)) throw new Error('Settlement hook operation or expected status is invalid.');
        result = { domain: 'foreshadow', observationId: observation.id, operation: item.operation as 'mention' | 'advance' | 'resolve' | 'defer', hookId, expectedStatus: item.expectedStatus };
      }
      allowed = ['foreshadow']; key = `foreshadow:${hookId}`;
    } else throw new Error('Settlement domain is invalid.');
    if (!allowed.includes(observation.category)) throw new Error('Settlement domain change category does not match its observation.');
    if (targets.has(key)) throw new Error('Settlement domain changes contain a duplicate target.');
    targets.add(key);
    return result;
  });
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Settlement observation array exceeds its schema limits.');
  return value;
}
function text(value: unknown, max: number, singleLine = true): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value) || (singleLine && /[\n\r]/u.test(value))) throw new Error('Settlement text is invalid or exceeds its schema limits.');
  return value;
}
