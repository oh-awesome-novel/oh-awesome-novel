import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  normalizePlayAdoptionDraft,
} from '@oh-awesome-novel/core';
import type {
  PlayAdoptionDraft,
  PlayAdoptionEvidenceClosure,
  PlayAdoptionSeed,
  PlayAdoptionTarget,
  PlayAdoptionTargetSuggestion,
  PlayEventVisibility,
} from '@oh-awesome-novel/core';
import type {
  PreparedWriteIntentPreview,
  WriteIntentPendingAction,
} from '@oh-awesome-novel/tools';

export const PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION = 1 as const;
const MAX_STORED_PLAY_ADOPTION_PREVIEW_BYTES = 8 * 1024 * 1024;

export type PlayAdoptionProjection = 'player' | 'director';

export interface PlayAdoptionPreviewEnvelope {
  schemaVersion: typeof PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  seed: PlayAdoptionSeed;
  candidateId: string;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  evidenceClosure: PlayAdoptionEvidenceClosure;
  evidenceFingerprint: string;
  suggestions: PlayAdoptionTargetSuggestion[];
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  touchedFiles: string[];
  diff: string;
  fingerprint: string;
  createdAt: string;
  canonicalUnchanged: true;
}

export type StoredPlayAdoptionPreviewStatus =
  | 'prepared'
  | 'candidateStored'
  | 'promoted';

export interface StoredPlayAdoptionPreview {
  schemaVersion: typeof PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  candidateId: string;
  fullDraft: PlayAdoptionDraft;
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  preparedWriteIntent: PreparedWriteIntentPreview;
  previewFingerprint: string;
  createdAt: string;
  status: StoredPlayAdoptionPreviewStatus;
  pendingAction?: WriteIntentPendingAction;
}

export function createStoredPlayAdoptionPreview(input: {
  sessionId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  candidateId: string;
  fullDraft: PlayAdoptionDraft;
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  preparedWriteIntent: PreparedWriteIntentPreview;
  createdAt?: string;
}): StoredPlayAdoptionPreview {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const recordWithoutFingerprint = {
    schemaVersion: PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: assertPendingActionId(input.preparedWriteIntent.id),
    sessionId: assertSafeId(input.sessionId, 'Play adoption preview sessionId'),
    baseRevision: assertNonNegativeInteger(
      input.baseRevision,
      'Play adoption preview baseRevision',
    ),
    projection: normalizeProjection(input.projection),
    candidateId: assertSafeId(
      input.candidateId,
      'Play adoption preview candidateId',
    ),
    fullDraft: normalizePlayAdoptionDraft(input.fullDraft),
    target: normalizeTarget(input.target),
    payload: cloneJsonRecord(input.payload, 'Play adoption preview payload'),
    preparedWriteIntent: structuredClone(input.preparedWriteIntent),
    createdAt: assertTimestamp(createdAt),
  };
  return {
    ...recordWithoutFingerprint,
    previewFingerprint: fingerprintPreviewBinding(recordWithoutFingerprint),
    status: 'prepared',
  };
}

export function projectStoredPlayAdoptionPreview(
  stored: StoredPlayAdoptionPreview,
  projectedDraft: PlayAdoptionDraft,
): PlayAdoptionPreviewEnvelope {
  const normalized = normalizeStoredPlayAdoptionPreview(stored);
  const projected = normalizePlayAdoptionDraft(projectedDraft);
  if (
    JSON.stringify(projected.seed) !== JSON.stringify(normalized.fullDraft.seed) ||
    projected.summary !== normalized.fullDraft.summary ||
    projected.visibility !== normalized.fullDraft.visibility
  ) {
    throw new Error('Projected Play adoption draft does not match its stored preview.');
  }
  return {
    schemaVersion: PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: normalized.id,
    sessionId: normalized.sessionId,
    baseRevision: normalized.baseRevision,
    projection: normalized.projection,
    seed: structuredClone(projected.seed),
    candidateId: normalized.candidateId,
    summary: projected.summary,
    evidence: projected.evidence,
    visibility: projected.visibility,
    evidenceClosure: structuredClone(projected.evidenceClosure),
    evidenceFingerprint: projected.evidenceFingerprint,
    suggestions: structuredClone(projected.targetSuggestions),
    target: normalized.target,
    payload: structuredClone(normalized.payload),
    touchedFiles: [...normalized.preparedWriteIntent.touchedFiles],
    diff: projectStoredPlayAdoptionDiff(normalized),
    fingerprint: normalized.previewFingerprint,
    createdAt: normalized.createdAt,
    canonicalUnchanged: true,
  };
}

export function projectStoredPlayAdoptionDiff(
  stored: StoredPlayAdoptionPreview,
): string {
  const normalized = normalizeStoredPlayAdoptionPreview(stored);
  if (normalized.projection === 'director') {
    return normalized.preparedWriteIntent.diff;
  }
  const proposal = JSON.stringify({
    target: normalized.target,
    payload: normalized.payload,
  }, null, 2).split('\n').map((line) => `+${line}`);
  return normalized.preparedWriteIntent.touchedFiles.map((file) => [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ Player-safe Play adoption proposal; canonical baseline hidden @@',
    ...proposal,
    '',
  ].join('\n')).join('');
}

export async function writeStoredPlayAdoptionPreview(
  workspaceRoot: string,
  value: StoredPlayAdoptionPreview,
  options: { create?: boolean } = {},
): Promise<void> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const record = normalizeStoredPlayAdoptionPreview(value);
  const target = await resolvePreviewRecordPath(workspaceRealpath, record.id);
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STORED_PLAY_ADOPTION_PREVIEW_BYTES) {
    throw new Error('Stored Play adoption preview exceeds the size limit.');
  }
  if (options.create) {
    try {
      await writeFile(target, serialized, { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Play adoption preview already exists: ${record.id}.`);
      }
      throw error;
    }
  }

  const temporary = join(dirname(target), `.${record.id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readStoredPlayAdoptionPreview(
  workspaceRoot: string,
  id: string,
): Promise<StoredPlayAdoptionPreview> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const target = await resolvePreviewRecordPath(workspaceRealpath, id);
  const targetStat = await lstat(target);
  if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
    throw new Error(`Play adoption preview record is not a regular file: ${id}.`);
  }
  if (targetStat.size > MAX_STORED_PLAY_ADOPTION_PREVIEW_BYTES) {
    throw new Error(`Play adoption preview record exceeds the size limit: ${id}.`);
  }
  const targetRealpath = await realpath(target);
  assertPathInside(
    await resolvePreviewRoot(workspaceRealpath),
    targetRealpath,
    'Play adoption preview record escaped its storage directory.',
  );
  return normalizeStoredPlayAdoptionPreview(
    JSON.parse(await readFile(targetRealpath, 'utf8')) as unknown,
  );
}

export function normalizeStoredPlayAdoptionPreview(
  value: unknown,
): StoredPlayAdoptionPreview {
  if (!isRecord(value)) {
    throw new Error('Stored Play adoption preview must be an object.');
  }
  const allowed = new Set([
    'schemaVersion',
    'id',
    'sessionId',
    'baseRevision',
    'projection',
    'candidateId',
    'fullDraft',
    'target',
    'payload',
    'preparedWriteIntent',
    'previewFingerprint',
    'createdAt',
    'status',
    'pendingAction',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('Stored Play adoption preview contains unknown fields.');
  }
  if (value.schemaVersion !== PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION) {
    throw new Error('Stored Play adoption preview has an unsupported schemaVersion.');
  }
  const status = normalizeStatus(value.status);
  const prepared = normalizePreparedWriteIntentPreview(value.preparedWriteIntent);
  const record = {
    schemaVersion: PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: assertPendingActionId(value.id),
    sessionId: assertSafeId(value.sessionId, 'Play adoption preview sessionId'),
    baseRevision: assertNonNegativeInteger(
      value.baseRevision,
      'Play adoption preview baseRevision',
    ),
    projection: normalizeProjection(value.projection),
    candidateId: assertSafeId(value.candidateId, 'Play adoption preview candidateId'),
    fullDraft: normalizePlayAdoptionDraft(value.fullDraft),
    target: normalizeTarget(value.target),
    payload: cloneJsonRecord(value.payload, 'Play adoption preview payload'),
    preparedWriteIntent: prepared,
    createdAt: assertTimestamp(value.createdAt),
  };
  if (
    record.fullDraft.evidenceClosure.sessionId !== record.sessionId ||
    record.fullDraft.evidenceClosure.sessionRevision !== record.baseRevision
  ) {
    throw new Error(
      'Stored Play adoption preview evidence does not match its session revision.',
    );
  }
  if (record.preparedWriteIntent.toolName !== toolNameForTarget(record.target)) {
    throw new Error(
      'Stored Play adoption preview target does not match its write-intent tool.',
    );
  }
  const previewFingerprint = assertSha256(
    value.previewFingerprint,
    'Play adoption preview fingerprint',
  );
  if (
    record.id !== prepared.id ||
    previewFingerprint !== fingerprintPreviewBinding(record)
  ) {
    throw new Error('Stored Play adoption preview fingerprint is invalid.');
  }
  const pendingAction = value.pendingAction === undefined
    ? undefined
    : normalizePendingAction(value.pendingAction, record.preparedWriteIntent);
  if (
    (status === 'promoted') !== Boolean(pendingAction) ||
    (status === 'prepared' && pendingAction)
  ) {
    throw new Error('Stored Play adoption preview status is inconsistent.');
  }
  return {
    ...record,
    previewFingerprint,
    status,
    ...(pendingAction ? { pendingAction } : {}),
  };
}

function fingerprintPreviewBinding(value: {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  candidateId: string;
  fullDraft: PlayAdoptionDraft;
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  preparedWriteIntent: PreparedWriteIntentPreview;
  createdAt: string;
}): string {
  return sha256(stableSerialize({
    schemaVersion: value.schemaVersion,
    id: value.id,
    sessionId: value.sessionId,
    baseRevision: value.baseRevision,
    projection: value.projection,
    candidateId: value.candidateId,
    fullDraft: value.fullDraft,
    target: value.target,
    payload: value.payload,
    preparedWriteIntentFingerprint: value.preparedWriteIntent.fingerprint,
    createdAt: value.createdAt,
  }));
}

function normalizePreparedWriteIntentPreview(
  value: unknown,
): PreparedWriteIntentPreview {
  if (isRecord(value)) assertPendingActionId(value.id);
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => ![
      'schemaVersion',
      'id',
      'toolName',
      'args',
      'title',
      'description',
      'patches',
      'touchedFiles',
      'diff',
      'preparedAt',
      'shadowWrites',
      'fingerprint',
    ].includes(key)) ||
    value.schemaVersion !== 1 ||
    !isPreviewableWriteIntentToolName(value.toolName) ||
    !isRecord(value.args) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    !Array.isArray(value.patches) ||
    value.patches.length === 0 ||
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.fingerprint) ||
    !Array.isArray(value.touchedFiles) ||
    value.touchedFiles.length === 0 ||
    !value.touchedFiles.every((file) => typeof file === 'string') ||
    new Set(value.touchedFiles).size !== value.touchedFiles.length ||
    typeof value.diff !== 'string' ||
    typeof value.preparedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    !Array.isArray(value.shadowWrites) ||
    value.shadowWrites.length !== value.touchedFiles.length
  ) {
    throw new Error('Stored prepared write-intent preview is invalid.');
  }
  const { fingerprint, ...previewCore } = value;
  if (fingerprint !== sha256(stableSerialize(previewCore))) {
    throw new Error('Stored prepared write-intent preview fingerprint is invalid.');
  }
  return structuredClone(value) as unknown as PreparedWriteIntentPreview;
}

function normalizePendingAction(
  value: unknown,
  prepared: PreparedWriteIntentPreview,
): WriteIntentPendingAction {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => ![
      'id',
      'title',
      'description',
      'patches',
      'touchedFiles',
      'diff',
      'createdAt',
      'status',
      'shadowWrites',
    ].includes(key)) ||
    value.id !== prepared.id ||
    value.status !== 'pending' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    !Array.isArray(value.patches) ||
    !Array.isArray(value.touchedFiles) ||
    typeof value.diff !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.shadowWrites) ||
    !sameJson(value.title, prepared.title) ||
    !sameJson(value.description, prepared.description) ||
    !sameJson(value.patches, prepared.patches) ||
    !sameJson(value.touchedFiles, prepared.touchedFiles) ||
    !sameJson(value.diff, prepared.diff) ||
    !sameJson(value.shadowWrites, prepared.shadowWrites)
  ) {
    throw new Error('Stored Play adoption PendingAction result is invalid.');
  }
  return structuredClone(value) as unknown as WriteIntentPendingAction;
}

function toolNameForTarget(
  target: PlayAdoptionTarget,
): PreparedWriteIntentPreview['toolName'] {
  switch (target) {
    case 'chapterDraft': return 'chapter.createDraft';
    case 'state': return 'state.set';
    case 'timeline': return 'timeline.add';
    case 'foreshadow': return 'foreshadow.create';
  }
}

function isPreviewableWriteIntentToolName(
  value: unknown,
): value is PreparedWriteIntentPreview['toolName'] {
  return value === 'chapter.createDraft' ||
    value === 'state.set' ||
    value === 'timeline.add' ||
    value === 'foreshadow.create';
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

async function resolvePreviewRecordPath(
  workspaceRealpath: string,
  id: string,
): Promise<string> {
  const root = await resolvePreviewRoot(workspaceRealpath);
  return join(root, `${assertPendingActionId(id)}.json`);
}

async function resolvePreviewRoot(workspaceRealpath: string): Promise<string> {
  const root = join(workspaceRealpath, '.workspace', 'play-adoption-previews');
  await mkdir(root, { recursive: true });
  const rootRealpath = await realpath(root);
  assertPathInside(workspaceRealpath, rootRealpath, 'Play adoption preview root escaped workspace.');
  return rootRealpath;
}

function assertPathInside(root: string, candidate: string, message: string): void {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.startsWith('/')
  ) {
    throw new Error(message);
  }
}

function normalizeProjection(value: unknown): PlayAdoptionProjection {
  if (value !== 'player' && value !== 'director') {
    throw new Error('Play adoption projection must be player or director.');
  }
  return value;
}

function normalizeTarget(value: unknown): PlayAdoptionTarget {
  if (
    value !== 'chapterDraft' &&
    value !== 'state' &&
    value !== 'timeline' &&
    value !== 'foreshadow'
  ) {
    throw new Error('Play adoption target is invalid.');
  }
  return value;
}

function normalizeStatus(value: unknown): StoredPlayAdoptionPreviewStatus {
  if (value !== 'prepared' && value !== 'candidateStored' && value !== 'promoted') {
    throw new Error('Stored Play adoption preview status is invalid.');
  }
  return value;
}

function assertPendingActionId(value: unknown): string {
  if (typeof value !== 'string' || !/^pa_[a-f0-9-]+$/iu.test(value)) {
    throw new Error('Play adoption preview id is invalid.');
  }
  return value;
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..')
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function assertTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Play adoption preview createdAt is invalid.');
  }
  return value;
}

function assertSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function cloneJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const serialized = stableSerialize(value);
  return JSON.parse(serialized) as Record<string, unknown>;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(toStableJson(value, new Set<object>()));
}

function toStableJson(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON value must be finite.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new Error('Value must be JSON-compatible.');
  if (ancestors.has(value)) throw new Error('JSON value cannot contain cycles.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => toStableJson(entry, ancestors));
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .toSorted()
      .map((key) => [
        key,
        toStableJson((value as Record<string, unknown>)[key], ancestors),
      ]));
  } finally {
    ancestors.delete(value);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
