import { TextDecoder } from 'node:util';

import { parseDocument } from 'yaml';
import {
  assertReferenceContextIndex,
  assertReferenceDeconstructionDiagnostics,
  assertReferenceDeconstructionManifest,
  assertReferenceProgress,
} from '@oh-awesome-novel/core';

import {
  assertValidTextContent,
  normalizeWorkspaceRelativePath,
  sha256Text,
} from './candidate-change-set';

export const DEFAULT_MAX_FINAL_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_DOCUMENT_DEPTH = 32;
export const DEFAULT_MAX_DOCUMENT_NODES = 100_000;

export type FinalDocumentValidatorId =
  | 'chapter-markdown'
  | 'character-object'
  | 'world-object'
  | 'state-yaml'
  | 'timeline-yaml'
  | 'foreshadow-yaml'
  | 'summary-markdown'
  | 'outline-markdown'
  | 'reference-publication';

export interface FinalDocumentValidationContext {
  maxFileBytes?: number;
  knownObjectIds?: readonly string[];
  referenceId?: string;
  expectedReferenceRunId?: string;
  expectedSourceChecksumSha256?: string;
  expectedStructureFingerprint?: string;
}

export interface ValidateFinalDocumentInput {
  path: string;
  content: string | Uint8Array;
  validator?: FinalDocumentValidatorId;
  fileType?: 'regular-file' | 'directory' | 'symbolic-link' | 'other';
  context?: FinalDocumentValidationContext;
}

export interface ValidatedFinalDocument {
  path: string;
  validator: FinalDocumentValidatorId;
  content: string;
  byteLength: number;
  sha256: string;
}

interface MarkdownParts {
  frontmatter?: Record<string, unknown>;
  body: string;
}

interface DocumentBudget {
  nodes: number;
}

const SAFE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,179}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/u;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const COMMON_FRONTMATTER_KEYS = [
  'id',
  'title',
  'name',
  'description',
  'tags',
  'status',
  'type',
  'kind',
  'version',
  'createdAt',
  'updatedAt',
  'date',
  'author',
  'notes',
] as const;

const FRONTMATTER_KEYS: Record<
  'chapter' | 'summary' | 'outline' | 'character' | 'world' | 'reference',
  ReadonlySet<string>
> = {
  chapter: new Set([
    ...COMMON_FRONTMATTER_KEYS,
    'chapter',
    'chapterId',
    'chapterNumber',
    'number',
    'volume',
    'volumeId',
    'volumeNumber',
    'pov',
    'characters',
    'locations',
    'sceneIds',
    'scenes',
    'summary',
    'wordCount',
  ]),
  summary: new Set([
    ...COMMON_FRONTMATTER_KEYS,
    'scope',
    'source',
    'sourcePath',
    'chapter',
    'chapterId',
    'chapterNumber',
    'volume',
    'volumeId',
    'volumeNumber',
  ]),
  outline: new Set([
    ...COMMON_FRONTMATTER_KEYS,
    'scope',
    'chapter',
    'chapterId',
    'chapterNumber',
    'volume',
    'volumeId',
    'volumeNumber',
    'beats',
    'sceneIds',
    'scenes',
  ]),
  character: new Set([
    ...COMMON_FRONTMATTER_KEYS,
    'characterId',
    'displayName',
    'aliases',
    'role',
    'age',
    'pronouns',
    'occupation',
    'firstAppearance',
    'importance',
  ]),
  world: new Set([
    ...COMMON_FRONTMATTER_KEYS,
    'objectId',
    'entityId',
    'aliases',
    'category',
    'parentId',
  ]),
  reference: new Set([
    ...COMMON_FRONTMATTER_KEYS,
    'referenceId',
    'runId',
    'sourceChecksumSha256',
    'structureFingerprint',
    'sourceRefs',
    'category',
    'estimatedTokens',
  ]),
};

const TIMELINE_STATUSES = new Set([
  'draft',
  'planned',
  'active',
  'completed',
  'resolved',
  'paused',
  'cancelled',
  'canceled',
  'abandoned',
  'historical',
  'future',
]);

const FORESHADOW_STATUSES = new Set([
  'draft',
  'planned',
  'planted',
  'active',
  'developing',
  'dormant',
  'resolved',
  'paid-off',
  'paid_off',
  'abandoned',
]);

/**
 * Returns the one complete validator registered for a canonical writable file.
 * Unknown extensions and file families deliberately have no fallback validator.
 */
export function getFinalDocumentValidatorIdForPath(
  value: string,
): FinalDocumentValidatorId | undefined {
  let path: string;
  try {
    path = normalizeWorkspaceRelativePath(value);
  } catch {
    return undefined;
  }

  if (/^chapters\/\d{4}\/\d{4}\.md$/u.test(path)) return 'chapter-markdown';
  if (/^characters\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/.+\.(?:md|yaml)$/u.test(path)) {
    return 'character-object';
  }
  if (/^world\/.+\.(?:md|yaml)$/u.test(path)) return 'world-object';
  if (/^state\/.+\.yaml$/u.test(path)) return 'state-yaml';
  if (/^timeline\/.+\.yaml$/u.test(path)) return 'timeline-yaml';
  if (/^foreshadow\/.+\.yaml$/u.test(path)) return 'foreshadow-yaml';
  if (/^summaries\/.+\.md$/u.test(path)) return 'summary-markdown';
  if (/^outline\/.+\.md$/u.test(path)) return 'outline-markdown';
  if (path === 'examples/references.yaml') return 'reference-publication';
  if (/^examples\/references\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/(?:deconstruction-manifest\.yaml|diagnostics\.yaml|progress\.yaml)$/u.test(path)) {
    return 'reference-publication';
  }
  if (/^examples\/references\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/(?:deconstruction|distilled)\/.+\.md$/u.test(path)) {
    return 'reference-publication';
  }
  if (/^examples\/references\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/materials\/(?:world|characters|relationships|outline|timeline)\.yaml$/u.test(path)) {
    return 'reference-publication';
  }
  if (/^examples\/references\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/context\/(?:index\.yaml|reference-summary\.md)$/u.test(path)) {
    return 'reference-publication';
  }
  return undefined;
}

export function validateFinalDocument(
  input: ValidateFinalDocumentInput,
): ValidatedFinalDocument {
  const path = normalizeWorkspaceRelativePath(input.path);
  if (input.fileType !== undefined && input.fileType !== 'regular-file') {
    throw new Error(`Final document must be a regular file: ${path}.`);
  }
  const validator = input.validator ?? getFinalDocumentValidatorIdForPath(path);
  if (!validator) {
    throw new Error(`No complete final-document validator is registered for ${path}.`);
  }
  const inferred = getFinalDocumentValidatorIdForPath(path);
  if (inferred !== validator) {
    throw new Error(`Final-document validator ${validator} cannot validate ${path}.`);
  }

  const content = decodeFinalText(input.content, path);
  const byteLength = Buffer.byteLength(content, 'utf8');
  const maxFileBytes = normalizePositiveLimit(
    input.context?.maxFileBytes ?? DEFAULT_MAX_FINAL_DOCUMENT_BYTES,
    'maxFileBytes',
  );
  if (byteLength > maxFileBytes) {
    throw new Error(
      `Final document exceeds the ${maxFileBytes}-byte limit: ${path} (${byteLength} bytes).`,
    );
  }

  switch (validator) {
    case 'chapter-markdown':
      validateChapterMarkdown(path, content);
      break;
    case 'character-object':
      validateCharacterObject(path, content);
      break;
    case 'world-object':
      validateWorldObject(path, content);
      break;
    case 'state-yaml':
      validateStateYaml(path, content, input.context);
      break;
    case 'timeline-yaml':
      validateTimelineYaml(path, content, input.context);
      break;
    case 'foreshadow-yaml':
      validateForeshadowYaml(path, content, input.context);
      break;
    case 'summary-markdown':
      validateSummaryMarkdown(path, content);
      break;
    case 'outline-markdown':
      validateOutlineMarkdown(path, content);
      break;
    case 'reference-publication':
      validateReferencePublicationDocument(path, content, input.context);
      break;
  }

  return {
    path,
    validator,
    content,
    byteLength,
    sha256: sha256Text(content),
  };
}

export function inspectFinalDocument(
  input: ValidateFinalDocumentInput,
): { ok: true; document: ValidatedFinalDocument } | { ok: false; errors: string[] } {
  try {
    return { ok: true, document: validateFinalDocument(input) };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function validateChapterMarkdown(path: string, content: string): void {
  const match = /^chapters\/(\d{4})\/(\d{4})\.md$/u.exec(path);
  if (!match) throw new Error(`Chapter path is not canonical: ${path}.`);
  const parts = validateMarkdown(path, content, 'chapter');
  const volumeId = match[1];
  const chapterId = match[2];
  if (!parts.frontmatter) return;
  assertOptionalIdentity(parts.frontmatter, ['volume', 'volumeId', 'volumeNumber'], volumeId, path);
  assertOptionalIdentity(
    parts.frontmatter,
    ['chapter', 'chapterId', 'chapterNumber', 'number'],
    chapterId,
    path,
  );
  assertOptionalIdentity(
    parts.frontmatter,
    ['id'],
    `${volumeId}/${chapterId}`,
    path,
    [chapterId],
  );
}

function validateSummaryMarkdown(path: string, content: string): void {
  const parts = validateMarkdown(path, content, 'summary');
  const chapter = /^summaries\/chapter\/(\d{4})\/(\d{4})\.md$/u.exec(path);
  const volume = /^summaries\/volume\/(\d{4})\.md$/u.exec(path);
  if (!parts.frontmatter) return;
  if (chapter) {
    assertOptionalIdentity(parts.frontmatter, ['volume', 'volumeId', 'volumeNumber'], chapter[1], path);
    assertOptionalIdentity(
      parts.frontmatter,
      ['chapter', 'chapterId', 'chapterNumber'],
      chapter[2],
      path,
    );
    assertOptionalIdentity(parts.frontmatter, ['id'], `${chapter[1]}/${chapter[2]}`, path, [chapter[2]]);
  } else if (volume) {
    assertOptionalIdentity(parts.frontmatter, ['volume', 'volumeId', 'volumeNumber', 'id'], volume[1], path);
  } else if (path === 'summaries/global.md') {
    assertOptionalIdentity(parts.frontmatter, ['id', 'scope'], 'global', path);
  }
}

function validateOutlineMarkdown(path: string, content: string): void {
  const parts = validateMarkdown(path, content, 'outline');
  if (!parts.frontmatter) return;
  const volume = /^outline\/volumes\/(\d{4})\.md$/u.exec(path);
  if (volume) {
    assertOptionalIdentity(parts.frontmatter, ['volume', 'volumeId', 'volumeNumber', 'id'], volume[1], path);
  }
}

function validateCharacterObject(path: string, content: string): void {
  const match = /^characters\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/(.+)\.(md|yaml)$/u.exec(path);
  if (!match) throw new Error(`Character object path is not canonical: ${path}.`);
  const characterId = match[1];
  const relativeStem = match[2];
  if (match[3] === 'md') {
    const parts = validateMarkdown(path, content, 'character');
    if (parts.frontmatter) {
      assertOptionalIdentity(parts.frontmatter, ['characterId'], characterId, path);
      if (relativeStem === 'summary') {
        assertOptionalIdentity(parts.frontmatter, ['id'], characterId, path, ['summary']);
      }
    }
    return;
  }

  const data = parseYamlRecord(path, content);
  if (relativeStem === 'meta') {
    const allowed = new Set([
      'id',
      'name',
      'displayName',
      'aliases',
      'role',
      'age',
      'pronouns',
      'occupation',
      'tags',
      'firstAppearance',
      'importance',
      'description',
      'status',
      'createdAt',
      'updatedAt',
    ]);
    assertOnlyAllowedKeys(data, allowed, `${path} root`);
    if (data.id !== characterId) {
      throw new Error(`Character meta id must match path id ${characterId}: ${path}.`);
    }
    assertNonEmptyText(data.name ?? data.displayName, `${path} character name`, 300);
  } else {
    assertOptionalIdentity(data, ['characterId', 'ownerId'], characterId, path);
  }
  validateStructuredValue(data, path);
  assertUniqueCollectionIds(data, path);
}

function validateWorldObject(path: string, content: string): void {
  const match = /^world\/(.+)\.(md|yaml)$/u.exec(path);
  if (!match) throw new Error(`World object path is not canonical: ${path}.`);
  const relativeStem = match[1];
  const segments = relativeStem.split('/');
  const fileId = segments.at(-1) as string;
  const objectId = segments.length > 1 ? segments[0] : fileId;
  if (match[2] === 'md') {
    const parts = validateMarkdown(path, content, 'world');
    if (parts.frontmatter) {
      assertOptionalIdentity(parts.frontmatter, ['id'], fileId, path, [relativeStem]);
      assertOptionalIdentity(parts.frontmatter, ['objectId', 'entityId'], objectId, path);
    }
    return;
  }
  const data = parseYamlRecord(path, content);
  assertOptionalIdentity(data, ['id'], fileId, path, [relativeStem]);
  assertOptionalIdentity(data, ['objectId', 'entityId'], objectId, path);
  validateStructuredValue(data, path);
  assertUniqueCollectionIds(data, path);
}

function validateStateYaml(
  path: string,
  content: string,
  context?: FinalDocumentValidationContext,
): void {
  const data = parseYamlRecord(path, content);
  if (Object.keys(data).length === 0) {
    throw new Error(`State document must not be empty: ${path}.`);
  }
  const fileId = path.slice('state/'.length, -'.yaml'.length);
  assertOptionalIdentity(data, ['documentId', 'stateId'], fileId, path, [fileId.split('/').at(-1) as string]);
  validateStructuredValue(data, path);
  assertUniqueCollectionIds(data, path);
  validateKnownReferences(data, context?.knownObjectIds, path);
}

function validateTimelineYaml(
  path: string,
  content: string,
  context?: FinalDocumentValidationContext,
): void {
  const data = parseYamlRecord(path, content);
  const collectionNames = ['events', 'arcs', 'timeline'];
  const collections = collectionNames
    .filter((key) => Object.hasOwn(data, key))
    .map((key) => ({ key, value: data[key] }));
  if (collections.length !== 1 || !Array.isArray(collections[0]?.value)) {
    throw new Error(`Timeline document must contain exactly one events, arcs, or timeline array: ${path}.`);
  }
  const collection = collections[0];
  const items = collection.value as unknown[];
  const ids = new Set<string>();
  let previousOrder: number | undefined;
  let previousIsoDate: number | undefined;
  let sawIsoDate = false;
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      throw new Error(`Timeline ${collection.key}[${index}] must be an object: ${path}.`);
    }
    const id = requireSafeId(item.id, `Timeline ${collection.key}[${index}].id`);
    if (ids.has(id)) throw new Error(`Timeline contains duplicate id ${id}: ${path}.`);
    ids.add(id);
    assertNonEmptyText(item.title ?? item.name, `Timeline ${id} title`, 1_000);
    if (collection.key === 'events') {
      assertNonEmptyText(item.date ?? item.time ?? item.order, `Timeline event ${id} date/order`, 1_000);
    }
    if (item.status !== undefined && (
      typeof item.status !== 'string' || !TIMELINE_STATUSES.has(item.status)
    )) {
      throw new Error(`Timeline ${id} has an invalid status: ${path}.`);
    }
    const order = item.order ?? item.sequence;
    if (order !== undefined) {
      if (!Number.isSafeInteger(order)) {
        throw new Error(`Timeline ${id} order must be an integer: ${path}.`);
      }
      if (previousOrder !== undefined && (order as number) <= previousOrder) {
        throw new Error(`Timeline order must be strictly increasing: ${path}.`);
      }
      previousOrder = order as number;
    }
    const rawDate = item.date ?? item.at ?? item.timestamp;
    if (typeof rawDate === 'string' && ISO_DATE_PREFIX.test(rawDate)) {
      const parsedDate = Date.parse(rawDate);
      if (!Number.isFinite(parsedDate)) {
        throw new Error(`Timeline ${id} has an invalid ISO date: ${path}.`);
      }
      if (previousIsoDate !== undefined && parsedDate < previousIsoDate) {
        throw new Error(`Timeline ISO dates must be ordered: ${path}.`);
      }
      previousIsoDate = parsedDate;
      sawIsoDate = true;
    } else if (sawIsoDate && rawDate !== undefined) {
      throw new Error(`Timeline cannot mix ordered ISO dates with non-ISO dates: ${path}.`);
    }
    validateStructuredValue(item, `${path}#${id}`);
  }
  validateKnownReferences(data, context?.knownObjectIds, path);
}

function validateForeshadowYaml(
  path: string,
  content: string,
  context?: FinalDocumentValidationContext,
): void {
  const data = parseYamlRecord(path, content);
  const collectionNames = ['foreshadow', 'active', 'resolved', 'entries'];
  const collections = collectionNames
    .filter((key) => Object.hasOwn(data, key))
    .map((key) => ({ key, value: data[key] }));
  if (collections.length !== 1 || !Array.isArray(collections[0]?.value)) {
    throw new Error(`Foreshadow document must contain exactly one foreshadow collection: ${path}.`);
  }
  const collection = collections[0];
  const ids = new Set<string>();
  for (const [index, item] of (collection.value as unknown[]).entries()) {
    if (!isRecord(item)) {
      throw new Error(`Foreshadow ${collection.key}[${index}] must be an object: ${path}.`);
    }
    const id = requireSafeId(item.id, `Foreshadow ${collection.key}[${index}].id`);
    if (ids.has(id)) throw new Error(`Foreshadow contains duplicate id ${id}: ${path}.`);
    ids.add(id);
    assertNonEmptyText(item.setup ?? item.description ?? item.title, `Foreshadow ${id} setup`, 8_000);
    if (typeof item.status !== 'string' || !FORESHADOW_STATUSES.has(item.status)) {
      throw new Error(`Foreshadow ${id} has an invalid status: ${path}.`);
    }
    const isResolvedFile = /(?:^|\/)resolved\.yaml$/u.test(path) || collection.key === 'resolved';
    const resolvedStatus = item.status === 'resolved'
      || item.status === 'paid-off'
      || item.status === 'paid_off'
      || item.status === 'abandoned';
    if (isResolvedFile !== resolvedStatus) {
      throw new Error(`Foreshadow ${id} status does not match its lifecycle file: ${path}.`);
    }
    validateLifecycleDates(item, path, id);
    validateStructuredValue(item, `${path}#${id}`);
  }
  validateKnownReferences(data, context?.knownObjectIds, path);
}

function validateReferencePublicationDocument(
  path: string,
  content: string,
  context?: FinalDocumentValidationContext,
): void {
  if (path === 'examples/references.yaml') {
    const data = parseYamlRecord(path, content);
    assertOnlyAllowedKeys(data, new Set(['version', 'references']), `${path} root`);
    if (data.version !== 1 || !Array.isArray(data.references)) {
      throw new Error('Reference index must have version 1 and a references array.');
    }
    const ids = new Set<string>();
    for (const [index, item] of data.references.entries()) {
      if (!isRecord(item)) throw new Error(`Reference index entry ${index} must be an object.`);
      const id = requireSafeId(item.id, `Reference index entry ${index}.id`);
      if (ids.has(id)) throw new Error(`Reference index contains duplicate id ${id}.`);
      ids.add(id);
      if (item.bundlePath !== undefined && item.bundlePath !== `examples/references/${id}`) {
        throw new Error(`Reference index entry ${id} has a non-canonical bundlePath.`);
      }
      if (
        item.summaryPath !== undefined
        && item.summaryPath !== `examples/references/${id}/context/reference-summary.md`
      ) {
        throw new Error(`Reference index entry ${id} has a non-canonical summaryPath.`);
      }
      if (item.checksumSha256 !== undefined) requireSha256(item.checksumSha256, `${id} checksumSha256`);
      if (item.importedAt !== undefined) requireIsoDate(item.importedAt, `${id} importedAt`);
      validateStructuredValue(item, `${path}#${id}`);
    }
    if (context?.referenceId && !ids.has(requireSafeId(context.referenceId, 'referenceId'))) {
      throw new Error(`Reference index is missing bounded reference ${context.referenceId}.`);
    }
    return;
  }

  const match = /^examples\/references\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/(.+)$/u.exec(path);
  if (!match) throw new Error(`Reference publication path is not canonical: ${path}.`);
  const referenceId = match[1];
  const relativePath = match[2];
  if (context?.referenceId && context.referenceId !== referenceId) {
    throw new Error(`Reference publication escaped bounded reference ${context.referenceId}: ${path}.`);
  }

  if (path.endsWith('.md')) {
    const parts = validateMarkdown(path, content, 'reference');
    if (parts.frontmatter) {
      assertOptionalIdentity(parts.frontmatter, ['referenceId'], referenceId, path);
      validateExpectedReferenceFingerprints(parts.frontmatter, context, path);
    }
    return;
  }

  const data = parseYamlRecord(path, content);
  assertOptionalIdentity(data, ['referenceId'], referenceId, path);
  validateExpectedReferenceFingerprints(data, context, path);
  validateStructuredValue(data, path);
  assertUniqueCollectionIds(data, path);

  if (relativePath === 'deconstruction-manifest.yaml') {
    const manifest = assertReferenceDeconstructionManifest(data);
    if (manifest.referenceId !== referenceId) {
      throw new Error(`Reference manifest identity does not match path: ${path}.`);
    }
    if (
      context?.expectedReferenceRunId !== undefined
      && manifest.publishedRunId !== context.expectedReferenceRunId
    ) {
      throw new Error(`Reference manifest published run identity is stale: ${path}.`);
    }
    if (
      context?.expectedSourceChecksumSha256 !== undefined
      && manifest.sourceChecksumSha256 !== context.expectedSourceChecksumSha256
    ) {
      throw new Error(`Reference manifest source checksum is stale: ${path}.`);
    }
    if (
      context?.expectedStructureFingerprint !== undefined
      && manifest.structureFingerprint !== context.expectedStructureFingerprint
    ) {
      throw new Error(`Reference manifest structure fingerprint is stale: ${path}.`);
    }
    const outputPaths = new Set<string>();
    for (const output of manifest.outputs) {
      const outputPath = normalizeReferenceOutputPath(output.path, referenceId, path);
      if (outputPaths.has(outputPath)) throw new Error(`Reference manifest has duplicate output ${outputPath}.`);
      outputPaths.add(outputPath);
      if (!output.stale && output.sourceChecksumSha256 !== manifest.sourceChecksumSha256) {
        throw new Error(`Reference manifest output source checksum is stale: ${outputPath}.`);
      }
    }
  } else if (relativePath === 'progress.yaml') {
    const progress = assertReferenceProgress(data);
    if (progress.referenceId !== referenceId) {
      throw new Error(`Reference progress identity/version is invalid: ${path}.`);
    }
  } else if (relativePath === 'diagnostics.yaml') {
    const diagnostics = assertReferenceDeconstructionDiagnostics(data);
    if (diagnostics.referenceId !== referenceId) {
      throw new Error(`Reference diagnostics identity/version is invalid: ${path}.`);
    }
    if (
      context?.expectedSourceChecksumSha256 !== undefined
      && diagnostics.sourceChecksumSha256 !== context.expectedSourceChecksumSha256
    ) {
      throw new Error(`Reference diagnostics source checksum is stale: ${path}.`);
    }
  } else if (relativePath === 'context/index.yaml') {
    const normalized = assertReferenceContextIndex(data, {
      referenceId,
      ...(context?.expectedReferenceRunId === undefined
        ? {}
        : { publishedRunId: context.expectedReferenceRunId }),
      ...(context?.expectedSourceChecksumSha256 === undefined
        ? {}
        : { sourceChecksumSha256: context.expectedSourceChecksumSha256 }),
      ...(context?.expectedStructureFingerprint === undefined
        ? {}
        : { structureFingerprint: context.expectedStructureFingerprint }),
    });
    for (const entry of normalized.entries) {
      if (!entry.path.startsWith('distilled/')) {
        throw new Error(`Reference context entry ${entry.id} path is not bounded to distilled/: ${path}.`);
      }
    }
  } else if (relativePath.startsWith('materials/')) {
    const entries = Array.isArray(data.entries)
      ? data.entries
      : Object.values(data).find((value) => Array.isArray(value));
    if (!Array.isArray(entries)) {
      throw new Error(`Reference material document must contain an entry array: ${path}.`);
    }
    const ids = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry)) throw new Error(`Reference material entry ${index} is invalid: ${path}.`);
      const id = requireSafeId(entry.id, `Reference material entry ${index}.id`);
      if (ids.has(id)) throw new Error(`Reference material document contains duplicate id ${id}.`);
      ids.add(id);
      assertNonEmptyText(entry.title, `Reference material ${id} title`, 300);
      assertNonEmptyText(entry.content, `Reference material ${id} content`, 16_000);
      if (!new Set(['fact', 'interpretation', 'uncertain']).has(String(entry.assertionType))) {
        throw new Error(`Reference material ${id} assertionType is invalid: ${path}.`);
      }
      if (!new Set(['low', 'medium', 'high']).has(String(entry.confidence))) {
        throw new Error(`Reference material ${id} confidence is invalid: ${path}.`);
      }
    }
  }
}

function validateMarkdown(
  path: string,
  content: string,
  family: keyof typeof FRONTMATTER_KEYS,
): MarkdownParts {
  if (!content.trim()) throw new Error(`Markdown document must not be empty: ${path}.`);
  const parts = parseStrictFrontmatter(path, content);
  if (parts.frontmatter) {
    assertOnlyAllowedKeys(parts.frontmatter, FRONTMATTER_KEYS[family], `${path} frontmatter`);
    validateStructuredValue(parts.frontmatter, `${path} frontmatter`);
    assertUniqueCollectionIds(parts.frontmatter, `${path} frontmatter`);
  }
  const headings = [...parts.body.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gmu)];
  if (!headings.some((heading) => heading[1] === '#')) {
    throw new Error(`Markdown document requires a level-one heading: ${path}.`);
  }
  if (headings.length > 2_048) throw new Error(`Markdown has too many headings: ${path}.`);
  const explicitHeadingIds = headings
    .map((heading) => /\{#([^}\s]+)\}[ \t]*$/u.exec(heading[2])?.[1])
    .filter((id): id is string => Boolean(id));
  assertUniqueSafeIds(explicitHeadingIds, `${path} heading ids`);
  validateDelimitedMarkdownIds(parts.body, path, 'scene');
  validateDelimitedMarkdownIds(parts.body, path, 'chunk');
  validateDelimitedMarkdownIds(parts.body, path, 'block');
  return parts;
}

function parseStrictFrontmatter(path: string, content: string): MarkdownParts {
  const normalized = content.replace(/\r\n/gu, '\n');
  if (!normalized.startsWith('---\n')) return { body: content };
  const lines = normalized.split('\n');
  const endLine = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  if (endLine < 0) throw new Error(`Markdown frontmatter is not terminated: ${path}.`);
  const yaml = lines.slice(1, endLine).join('\n');
  const frontmatter = parseYamlValue(`${path} frontmatter`, yaml);
  if (!isRecord(frontmatter)) throw new Error(`Markdown frontmatter must be a mapping: ${path}.`);
  return { frontmatter, body: lines.slice(endLine + 1).join('\n') };
}

function parseYamlRecord(path: string, content: string): Record<string, unknown> {
  const parsed = parseYamlValue(path, content);
  if (!isRecord(parsed)) throw new Error(`YAML document root must be a mapping: ${path}.`);
  return parsed;
}

function parseYamlValue(path: string, content: string): unknown {
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(content, {
      prettyErrors: false,
      uniqueKeys: true,
    });
  } catch (error) {
    throw new Error(`Invalid YAML in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML in ${path}: ${document.errors[0]?.message ?? 'parse error'}`);
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new Error(`Unsafe or invalid YAML in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value === undefined || value === null) throw new Error(`YAML document is empty: ${path}.`);
  return value;
}

function decodeFinalText(value: string | Uint8Array, path: string): string {
  let content: string;
  if (typeof value === 'string') {
    content = value;
  } else if (value instanceof Uint8Array) {
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(value);
    } catch {
      throw new Error(`Final document is not valid UTF-8: ${path}.`);
    }
  } else {
    throw new Error(`Final document must be UTF-8 text: ${path}.`);
  }
  assertValidTextContent(content, `Final document ${path}`);
  return content;
}

function validateStructuredValue(
  value: unknown,
  label: string,
  depth = 0,
  budget: DocumentBudget = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (budget.nodes > DEFAULT_MAX_DOCUMENT_NODES) {
    throw new Error(`Document has too many structured values: ${label}.`);
  }
  if (depth > DEFAULT_MAX_DOCUMENT_DEPTH) {
    throw new Error(`Document nesting is too deep: ${label}.`);
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Document contains a non-finite number: ${label}.`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 1_000_000) throw new Error(`Document scalar is too large: ${label}.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > DEFAULT_MAX_DOCUMENT_NODES) throw new Error(`Document array is too large: ${label}.`);
    for (const item of value) validateStructuredValue(item, label, depth + 1, budget);
    return;
  }
  if (!isRecord(value)) throw new Error(`Document contains an unsupported value: ${label}.`);
  for (const [key, item] of Object.entries(value)) {
    if (!key || DANGEROUS_KEYS.has(key) || /[\0\r\n]/u.test(key)) {
      throw new Error(`Document contains a forbidden key ${JSON.stringify(key)}: ${label}.`);
    }
    validateStructuredValue(item, `${label}.${key}`, depth + 1, budget);
  }
}

function assertUniqueCollectionIds(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    if (records.length > 0 && records.every((record) => record.id !== undefined)) {
      const ids = records.map((record, index) => requireSafeId(record.id, `${label}[${index}].id`));
      assertUniqueSafeIds(ids, `${label} ids`);
    }
    for (const item of value) assertUniqueCollectionIds(item, label);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    assertUniqueCollectionIds(item, `${label}.${key}`);
  }
}

function validateDelimitedMarkdownIds(
  body: string,
  path: string,
  kind: 'scene' | 'chunk' | 'block',
): void {
  const opening = [...body.matchAll(new RegExp(`<!--\\s*${kind}:([^\\s>]+)\\s*-->`, 'gu'))]
    .map((match) => match[1]);
  const closing = [...body.matchAll(new RegExp(`<!--\\s*\/${kind}:([^\\s>]+)\\s*-->`, 'gu'))]
    .map((match) => match[1]);
  assertUniqueSafeIds(opening, `${path} ${kind} ids`);
  if (closing.length > 0) {
    assertUniqueSafeIds(closing, `${path} closing ${kind} ids`);
    if (opening.length !== closing.length || opening.some((id, index) => closing[index] !== id)) {
      throw new Error(`Markdown ${kind} markers are not balanced and ordered: ${path}.`);
    }
  }
}

function validateKnownReferences(
  value: unknown,
  knownObjectIds: readonly string[] | undefined,
  path: string,
): void {
  if (!knownObjectIds) return;
  const known = new Set(knownObjectIds.map((id) => requireSafeId(id, 'knownObjectId')));
  const visit = (current: unknown, key?: string): void => {
    if (Array.isArray(current)) {
      if (key?.endsWith('Refs')) {
        for (const ref of current) {
          if (typeof ref !== 'string' || !known.has(ref)) {
            throw new Error(`Document contains unknown reference ${String(ref)}: ${path}.`);
          }
        }
      } else {
        current.forEach((item) => visit(item));
      }
      return;
    }
    if (!isRecord(current)) return;
    for (const [childKey, child] of Object.entries(current)) {
      if (
        typeof child === 'string'
        && (childKey.endsWith('Ref') || childKey.endsWith('Id'))
        && !['id', 'eventId', 'arcId', 'stateId', 'documentId'].includes(childKey)
        && !known.has(child)
      ) {
        throw new Error(`Document contains unknown ${childKey} ${child}: ${path}.`);
      }
      visit(child, childKey);
    }
  };
  visit(value);
}

function validateLifecycleDates(item: Record<string, unknown>, path: string, id: string): void {
  const planted = item.plantedAt ?? item.createdAt;
  const resolved = item.resolvedAt ?? item.paidOffAt;
  if (planted !== undefined) requireIsoDate(planted, `${id} plantedAt`);
  if (resolved !== undefined) requireIsoDate(resolved, `${id} resolvedAt`);
  if (
    typeof planted === 'string'
    && typeof resolved === 'string'
    && Date.parse(resolved) < Date.parse(planted)
  ) {
    throw new Error(`Foreshadow ${id} resolves before it is planted: ${path}.`);
  }
}

function validateExpectedReferenceFingerprints(
  record: Record<string, unknown>,
  context: FinalDocumentValidationContext | undefined,
  path: string,
): void {
  if (!context) return;
  if (
    context.expectedReferenceRunId !== undefined
    && record.runId !== undefined
    && record.runId !== context.expectedReferenceRunId
    && record.publishedRunId !== context.expectedReferenceRunId
    && record.sourceRunId !== context.expectedReferenceRunId
  ) {
    throw new Error(`Reference run fingerprint is stale: ${path}.`);
  }
  if (
    context.expectedSourceChecksumSha256 !== undefined
    && record.sourceChecksumSha256 !== undefined
    && record.sourceChecksumSha256 !== context.expectedSourceChecksumSha256
  ) {
    throw new Error(`Reference source fingerprint is stale: ${path}.`);
  }
  if (
    context.expectedStructureFingerprint !== undefined
    && record.structureFingerprint !== undefined
    && record.structureFingerprint !== context.expectedStructureFingerprint
  ) {
    throw new Error(`Reference structure fingerprint is stale: ${path}.`);
  }
}

function normalizeReferenceOutputPath(value: unknown, referenceId: string, path: string): string {
  if (
    typeof value !== 'string'
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
  ) {
    throw new Error(`Reference manifest output path is invalid: ${path}.`);
  }
  const fullPath = value.startsWith(`examples/references/${referenceId}/`)
    ? value
    : `examples/references/${referenceId}/${value}`;
  if (getFinalDocumentValidatorIdForPath(fullPath) !== 'reference-publication') {
    throw new Error(`Reference manifest output target is not publishable: ${value}.`);
  }
  return fullPath;
}

function assertOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unknown key ${unknown}.`);
}

function assertOptionalIdentity(
  record: Record<string, unknown>,
  keys: readonly string[],
  expected: string,
  path: string,
  alternatives: readonly string[] = [],
): void {
  const valid = new Set([expected, ...alternatives]);
  for (const key of keys) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'string' && typeof record[key] !== 'number') {
      throw new Error(`${path} ${key} identity must be a string or number.`);
    }
    const actual = String(record[key]).padStart(expected.length, '0');
    if (!valid.has(String(record[key])) && !valid.has(actual)) {
      throw new Error(`${path} ${key} identity does not match ${expected}.`);
    }
  }
}

function assertUniqueSafeIds(values: readonly string[], label: string): void {
  const ids = values.map((value) => requireSafeId(value, label));
  if (new Set(ids).size !== ids.length) throw new Error(`${label} must be unique.`);
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || value.includes('..')) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requireIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is not a valid date.`);
  }
  return value;
}

function assertNonEmptyText(value: unknown, label: string, maxLength: number): void {
  if (
    (typeof value !== 'string' && typeof value !== 'number')
    || !String(value).trim()
    || String(value).length > maxLength
  ) {
    throw new Error(`${label} must be non-empty bounded text.`);
  }
}

function normalizePositiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
