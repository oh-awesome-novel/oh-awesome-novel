import { createHash } from 'node:crypto';

import {
  REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
} from './reference-deconstruction.js';
import type {
  ReferenceDistilledCategory,
  ReferenceDistilledEntry,
} from './reference-deconstruction-distill.js';
import {
  REFERENCE_DISTILLED_CATEGORIES,
} from './reference-deconstruction-distill.js';

export type ReferenceDeconstructionPublicationCandidateFileKind =
  | 'index'
  | 'manifest'
  | 'diagnostics'
  | 'progress'
  | 'deconstruction'
  | 'distilled'
  | 'context';

export interface ReferenceDeconstructionPublicationCandidateFile {
  path: string;
  content: string;
  checksumSha256: string;
  kind: ReferenceDeconstructionPublicationCandidateFileKind;
}

export interface ReferenceDeconstructionPublicationEntryInventoryItem {
  id: string;
  category: ReferenceDistilledCategory;
  title: string;
  estimatedTokens: number;
}

export interface ReferenceDeconstructionPublicationCandidate {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  referenceId: string;
  runId: string;
  runRevision: number;
  candidateFingerprint: string;
  files: ReferenceDeconstructionPublicationCandidateFile[];
  entryInventory: ReferenceDeconstructionPublicationEntryInventoryItem[];
  preparedAt: string;
}

export interface CreateReferenceDeconstructionPublicationCandidateInput {
  referenceId: string;
  runId: string;
  runRevision: number;
  files: ReadonlyArray<{
    path: string;
    content: string;
    kind: ReferenceDeconstructionPublicationCandidateFileKind;
  }>;
  entries: readonly ReferenceDistilledEntry[];
  preparedAt: string;
}

export function createReferenceDeconstructionPublicationCandidate(
  input: CreateReferenceDeconstructionPublicationCandidateInput,
): ReferenceDeconstructionPublicationCandidate {
  const referenceId = safeId(input.referenceId, 'referenceId');
  const runId = safeId(input.runId, 'runId');
  if (!Number.isSafeInteger(input.runRevision) || input.runRevision < 0) {
    throw new Error('Reference publication runRevision is invalid.');
  }
  const preparedAt = isoDate(input.preparedAt, 'preparedAt');
  if (!input.files.length || input.files.length > 10_000) {
    throw new Error('Reference publication candidate file count is invalid.');
  }
  const files = input.files.map((file) => {
    const path = candidateTargetPath(file.path, referenceId);
    if (typeof file.content !== 'string' || !file.content.length) {
      throw new Error(`Reference publication candidate file is empty: ${path}.`);
    }
    if (!isCandidateFileKind(file.kind)) {
      throw new Error(`Reference publication candidate file kind is invalid: ${path}.`);
    }
    if (file.kind !== canonicalCandidateFileKind(path, referenceId)) {
      throw new Error(`Reference publication candidate file kind does not match path: ${path}.`);
    }
    return {
      path,
      content: ensureTrailingNewline(file.content),
      checksumSha256: sha256(ensureTrailingNewline(file.content)),
      kind: file.kind,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error('Reference publication candidate paths must be unique.');
  }
  const requiredPaths = [
    'examples/references.yaml',
    `examples/references/${referenceId}/deconstruction-manifest.yaml`,
    `examples/references/${referenceId}/diagnostics.yaml`,
    `examples/references/${referenceId}/progress.yaml`,
    `examples/references/${referenceId}/context/index.yaml`,
    `examples/references/${referenceId}/context/reference-summary.md`,
  ];
  if (requiredPaths.some((path) => !files.some((file) => file.path === path))) {
    throw new Error('Reference publication candidate is missing a required file.');
  }
  const entryInventory = [...input.entries].map((entry) => ({
    id: safeId(entry.id, 'entry id'),
    category: requireEnum(
      entry.category,
      REFERENCE_DISTILLED_CATEGORIES,
      'entry category',
    ),
    title: boundedText(entry.title, 'entry title', 240),
    estimatedTokens: boundedInteger(
      entry.estimatedTokens,
      'entry estimatedTokens',
      1,
      2_048,
    ),
  })).sort((left, right) =>
    left.category.localeCompare(right.category) || left.id.localeCompare(right.id));
  if (
    !entryInventory.length
    || new Set(entryInventory.map((entry) => entry.id)).size !== entryInventory.length
  ) {
    throw new Error('Reference publication entry inventory is invalid.');
  }
  const fingerprintPayload = {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId,
    runId,
    runRevision: input.runRevision,
    files: files.map(({ path, checksumSha256, kind }) => ({
      path,
      checksumSha256,
      kind,
    })),
    entryInventory,
  };
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId,
    runId,
    runRevision: input.runRevision,
    candidateFingerprint: sha256(stableJson(fingerprintPayload)),
    files,
    entryInventory,
    preparedAt,
  };
}

export function assertReferenceDeconstructionPublicationCandidate(
  value: unknown,
): ReferenceDeconstructionPublicationCandidate {
  if (!isRecord(value)) {
    throw new Error('Reference publication candidate must be an object.');
  }
  const allowed = new Set([
    'version',
    'referenceId',
    'runId',
    'runRevision',
    'candidateFingerprint',
    'files',
    'entryInventory',
    'preparedAt',
  ]);
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    throw new Error('Reference publication candidate contains an unknown field.');
  }
  if (
    value.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || !Array.isArray(value.files)
    || !Array.isArray(value.entryInventory)
  ) {
    throw new Error('Reference publication candidate shape is invalid.');
  }
  const reconstructed = createReferenceDeconstructionPublicationCandidate({
    referenceId: safeId(value.referenceId, 'referenceId'),
    runId: safeId(value.runId, 'runId'),
    runRevision: boundedInteger(value.runRevision, 'runRevision', 0, 1_000_000),
    files: value.files.map((file) => {
      if (!isRecord(file)) throw new Error('Reference publication file is invalid.');
      return {
        path: String(file.path),
        content: String(file.content),
        kind: file.kind as ReferenceDeconstructionPublicationCandidateFileKind,
      };
    }),
    entries: value.entryInventory.map((entry) => {
      if (!isRecord(entry)) throw new Error('Reference publication inventory is invalid.');
      return {
        id: entry.id,
        category: entry.category,
        title: entry.title,
        estimatedTokens: entry.estimatedTokens,
      } as ReferenceDistilledEntry;
    }),
    preparedAt: isoDate(value.preparedAt, 'preparedAt'),
  });
  if (
    reconstructed.candidateFingerprint !== value.candidateFingerprint
    || stableJson(reconstructed) !== stableJson(value)
  ) {
    throw new Error('Reference publication candidate fingerprint is stale.');
  }
  return reconstructed;
}

export function candidateTargetPath(path: string, referenceId: string): string {
  const safeReferenceId = safeId(referenceId, 'referenceId');
  if (
    typeof path !== 'string'
    || path.startsWith('/')
    || path.includes('\\')
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Reference publication candidate path is invalid.');
  }
  if (
    path !== 'examples/references.yaml'
    && !path.startsWith(`examples/references/${safeReferenceId}/`)
  ) {
    throw new Error('Reference publication candidate path escapes its reference scope.');
  }
  return path;
}

function canonicalCandidateFileKind(
  path: string,
  referenceId: string,
): ReferenceDeconstructionPublicationCandidateFileKind {
  if (path === 'examples/references.yaml') return 'index';
  const prefix = `examples/references/${referenceId}/`;
  const relativePath = path.slice(prefix.length);
  if (relativePath === 'deconstruction-manifest.yaml') return 'manifest';
  if (relativePath === 'diagnostics.yaml') return 'diagnostics';
  if (relativePath === 'progress.yaml') return 'progress';
  if (relativePath.startsWith('deconstruction/')) return 'deconstruction';
  if (relativePath.startsWith('distilled/')) return 'distilled';
  if (relativePath.startsWith('context/')) return 'context';
  throw new Error(`Reference publication candidate target is not allowed: ${path}.`);
}

function isCandidateFileKind(
  value: unknown,
): value is ReferenceDeconstructionPublicationCandidateFileKind {
  return value === 'index'
    || value === 'manifest'
    || value === 'diagnostics'
    || value === 'progress'
    || value === 'deconstruction'
    || value === 'distilled'
    || value === 'context';
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`Reference publication ${label} is invalid.`);
  }
  return value as T[number];
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_:-]{1,180}$/u.test(value)) {
    throw new Error(`Reference publication ${label} is invalid.`);
  }
  return value;
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Reference publication ${label} is invalid.`);
  }
  return normalized;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    throw new Error(`Reference publication ${label} is invalid.`);
  }
  return value as number;
}

function isoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Reference publication ${label} is invalid.`);
  }
  return value;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
