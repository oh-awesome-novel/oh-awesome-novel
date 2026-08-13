import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { normalizePlayAdoptionDraft } from '@oh-awesome-novel/core';
import type {
  PlayAdoptionDraft,
  PlayAdoptionEvidenceClosure,
  PlayAdoptionSeed,
  PlayAdoptionTarget,
  PlayAdoptionTargetSuggestion,
  PlayEventVisibility,
} from '@oh-awesome-novel/core';
import { parsePreparedChangePreview } from '@oh-awesome-novel/tools';
import type {
  PendingActionView,
  PreparedChangePreviewV1,
} from '@oh-awesome-novel/tools';

import { serializePreparedChangePreviewSummary } from './pending-action-view.js';

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
  changes: PendingActionView['changes'];
  diff: string;
  fingerprint: string;
  createdAt: string;
  canonicalUnchanged: true;
}

export type StoredPlayAdoptionPreviewStatus =
  | 'prepared'
  | 'candidateStored'
  | 'promoted';

/** Domain binding only; immutable candidate bytes live in the common change-engine store. */
export interface StoredPlayAdoptionPreview {
  schemaVersion: typeof PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  branchId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  candidateId: string;
  fullDraft: PlayAdoptionDraft;
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  preparedChangePreviewId: string;
  candidateFingerprint: string;
  diffHash: string;
  previewFingerprint: string;
  createdAt: string;
  status: StoredPlayAdoptionPreviewStatus;
  pendingActionId?: string;
}

export function fingerprintPlayAdoptionPreviewBinding(input: {
  id: string;
  sessionId: string;
  branchId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  candidateId: string;
  fullDraft: PlayAdoptionDraft;
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  createdAt: string;
}): string {
  return sha256(stableSerialize({
    schemaVersion: PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: assertPendingActionId(input.id),
    sessionId: assertSafeId(input.sessionId, 'Play adoption preview sessionId'),
    branchId: assertSafeId(input.branchId, 'Play adoption preview branchId'),
    baseRevision: assertNonNegativeInteger(input.baseRevision, 'Play adoption preview baseRevision'),
    projection: normalizeProjection(input.projection),
    candidateId: assertSafeId(input.candidateId, 'Play adoption preview candidateId'),
    fullDraft: normalizePlayAdoptionDraft(input.fullDraft),
    target: normalizeTarget(input.target),
    payload: cloneJsonRecord(input.payload, 'Play adoption preview payload'),
    createdAt: assertTimestamp(input.createdAt),
  }));
}

export function createStoredPlayAdoptionPreview(input: {
  sessionId: string;
  branchId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  candidateId: string;
  fullDraft: PlayAdoptionDraft;
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  preparedChangePreview: PreparedChangePreviewV1;
  createdAt?: string;
}): StoredPlayAdoptionPreview {
  const prepared = parsePreparedChangePreview(input.preparedChangePreview);
  const core = {
    schemaVersion: PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: prepared.id,
    sessionId: assertSafeId(input.sessionId, 'Play adoption preview sessionId'),
    branchId: assertSafeId(input.branchId, 'Play adoption preview branchId'),
    baseRevision: assertNonNegativeInteger(input.baseRevision, 'Play adoption preview baseRevision'),
    projection: normalizeProjection(input.projection),
    candidateId: assertSafeId(input.candidateId, 'Play adoption preview candidateId'),
    fullDraft: normalizePlayAdoptionDraft(input.fullDraft),
    target: normalizeTarget(input.target),
    payload: cloneJsonRecord(input.payload, 'Play adoption preview payload'),
    createdAt: assertTimestamp(input.createdAt ?? prepared.createdAt),
  };
  const previewFingerprint = fingerprintPlayAdoptionPreviewBinding(core);
  assertPreparedBinding(prepared, core, previewFingerprint);
  return {
    ...core,
    preparedChangePreviewId: prepared.id,
    candidateFingerprint: prepared.candidateFingerprint,
    diffHash: prepared.preview.diffHash,
    previewFingerprint,
    status: 'prepared',
  };
}

export function projectStoredPlayAdoptionPreview(
  stored: StoredPlayAdoptionPreview,
  projectedDraft: PlayAdoptionDraft,
  preparedChangePreview: PreparedChangePreviewV1,
): PlayAdoptionPreviewEnvelope {
  const normalized = normalizeStoredPlayAdoptionPreview(stored);
  const prepared = assertPreparedMatchesStored(normalized, preparedChangePreview);
  const projected = normalizePlayAdoptionDraft(projectedDraft);
  if (
    JSON.stringify(projected.seed) !== JSON.stringify(normalized.fullDraft.seed)
    || projected.summary !== normalized.fullDraft.summary
    || projected.visibility !== normalized.fullDraft.visibility
  ) throw new Error('Projected Play adoption draft does not match its stored preview.');
  const summary = serializePreparedChangePreviewSummary(prepared);
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
    changes: summary.changes,
    diff: projectStoredPlayAdoptionDiff(normalized, prepared),
    fingerprint: normalized.previewFingerprint,
    createdAt: normalized.createdAt,
    canonicalUnchanged: true,
  };
}

export function projectStoredPlayAdoptionDiff(
  stored: StoredPlayAdoptionPreview,
  preparedChangePreview: PreparedChangePreviewV1,
): string {
  const normalized = normalizeStoredPlayAdoptionPreview(stored);
  const prepared = assertPreparedMatchesStored(normalized, preparedChangePreview);
  const summary = serializePreparedChangePreviewSummary(prepared);
  if (normalized.projection === 'director') return summary.diff;
  const proposal = JSON.stringify({
    target: normalized.target,
    payload: normalized.payload,
  }, null, 2).split('\n').map((line) => `+${line}`);
  return summary.changes.map((change) => [
    `diff --git a/${change.path} b/${change.path}`,
    `--- a/${change.path}`,
    `+++ b/${change.path}`,
    '@@ Player-safe Play adoption proposal; canonical baseline hidden @@',
    ...proposal,
    '',
  ].join('\n')).join('');
}

export function markStoredPlayAdoptionCandidate(
  stored: StoredPlayAdoptionPreview,
): StoredPlayAdoptionPreview {
  const normalized = normalizeStoredPlayAdoptionPreview(stored);
  if (normalized.status !== 'prepared') {
    throw new Error('Play adoption preview is not prepared.');
  }
  return { ...normalized, status: 'candidateStored' };
}

export function promoteStoredPlayAdoptionPreview(
  stored: StoredPlayAdoptionPreview,
  preparedChangePreview: PreparedChangePreviewV1,
  pendingAction: PendingActionView,
): StoredPlayAdoptionPreview {
  const normalized = normalizeStoredPlayAdoptionPreview(stored);
  const prepared = assertPreparedMatchesStored(normalized, preparedChangePreview);
  const summary = serializePreparedChangePreviewSummary(prepared);
  if (
    normalized.status !== 'candidateStored'
    || pendingAction.id !== normalized.id
    || pendingAction.status !== 'pending'
    || pendingAction.origin?.kind !== 'playAdoption'
    || stableSerialize(pendingAction.changes) !== stableSerialize(summary.changes)
    || pendingAction.diff !== summary.diff
  ) throw new Error('Stored Play adoption PendingAction result is invalid.');
  return {
    ...normalized,
    status: 'promoted',
    pendingActionId: pendingAction.id,
  };
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
      await writeFileDurably(target, serialized, 'wx');
      await syncDirectory(dirname(target));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Play adoption preview already exists: ${record.id}.`);
      }
      throw error;
    }
  }
  await assertReplaceTargetIsPrivateFile(target);
  const temporary = join(dirname(target), `.${record.id}.${randomUUID()}.tmp`);
  try {
    await writeFileDurably(temporary, serialized, 'wx');
    await rename(temporary, target);
    await syncDirectory(dirname(target));
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
  if (targetStat.isSymbolicLink() || !targetStat.isFile() || targetStat.nlink > 1) {
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
  if (!isRecord(value)) throw new Error('Stored Play adoption preview must be an object.');
  assertExactFields(value, [
    'schemaVersion',
    'id',
    'sessionId',
    'branchId',
    'baseRevision',
    'projection',
    'candidateId',
    'fullDraft',
    'target',
    'payload',
    'preparedChangePreviewId',
    'candidateFingerprint',
    'diffHash',
    'previewFingerprint',
    'createdAt',
    'status',
  ], ['pendingActionId']);
  if (value.schemaVersion !== PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION) {
    throw new Error('Stored Play adoption preview has an unsupported schemaVersion.');
  }
  const record = {
    schemaVersion: PLAY_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: assertPendingActionId(value.id),
    sessionId: assertSafeId(value.sessionId, 'Play adoption preview sessionId'),
    branchId: assertSafeId(value.branchId, 'Play adoption preview branchId'),
    baseRevision: assertNonNegativeInteger(value.baseRevision, 'Play adoption preview baseRevision'),
    projection: normalizeProjection(value.projection),
    candidateId: assertSafeId(value.candidateId, 'Play adoption preview candidateId'),
    fullDraft: normalizePlayAdoptionDraft(value.fullDraft),
    target: normalizeTarget(value.target),
    payload: cloneJsonRecord(value.payload, 'Play adoption preview payload'),
    preparedChangePreviewId: assertPendingActionId(value.preparedChangePreviewId),
    candidateFingerprint: assertSha256(value.candidateFingerprint, 'candidate fingerprint'),
    diffHash: assertSha256(value.diffHash, 'diff hash'),
    createdAt: assertTimestamp(value.createdAt),
  };
  if (
    record.fullDraft.evidenceClosure.sessionId !== record.sessionId
    || record.fullDraft.evidenceClosure.sessionRevision !== record.baseRevision
    || record.preparedChangePreviewId !== record.id
  ) throw new Error('Stored Play adoption preview evidence or preview id is invalid.');
  const previewFingerprint = assertSha256(value.previewFingerprint, 'Play adoption preview fingerprint');
  if (previewFingerprint !== fingerprintPlayAdoptionPreviewBinding(record)) {
    throw new Error('Stored Play adoption preview fingerprint is invalid.');
  }
  const status = normalizeStatus(value.status);
  if (
    (status === 'promoted') !== Object.hasOwn(value, 'pendingActionId')
    || (status === 'promoted' && value.pendingActionId !== record.id)
  ) throw new Error('Stored Play adoption preview status is inconsistent.');
  return {
    ...record,
    previewFingerprint,
    status,
    ...(status === 'promoted' ? { pendingActionId: record.id } : {}),
  };
}

function assertPreparedMatchesStored(
  stored: StoredPlayAdoptionPreview,
  value: PreparedChangePreviewV1,
): PreparedChangePreviewV1 {
  const prepared = parsePreparedChangePreview(value, stored.id);
  assertPreparedBinding(prepared, stored, stored.previewFingerprint);
  if (
    prepared.id !== stored.preparedChangePreviewId
    || prepared.candidateFingerprint !== stored.candidateFingerprint
    || prepared.preview.diffHash !== stored.diffHash
  ) throw new Error('Stored Play adoption prepared preview binding is invalid.');
  return prepared;
}

function assertPreparedBinding(
  prepared: PreparedChangePreviewV1,
  binding: {
    sessionId: string;
    branchId: string;
    baseRevision: number;
    target: PlayAdoptionTarget;
    payload: Record<string, unknown>;
  },
  previewFingerprint: string,
): void {
  const origin = prepared.origin;
  if (
    prepared.capability !== 'play.adopt'
    || prepared.allowedTargets.length !== 1
    || origin.kind !== 'playAdoption'
    || origin.sessionId !== binding.sessionId
    || origin.branchId !== binding.branchId
    || origin.sourceRevision !== binding.baseRevision
    || origin.previewFingerprint !== previewFingerprint
  ) throw new Error('Stored Play adoption prepared preview is invalid.');
}

async function resolvePreviewRecordPath(
  workspaceRealpath: string,
  id: string,
): Promise<string> {
  const root = await resolvePreviewRoot(workspaceRealpath);
  return join(root, `${assertPendingActionId(id)}.json`);
}

async function resolvePreviewRoot(workspaceRealpath: string): Promise<string> {
  const root = join(
    workspaceRealpath,
    '.workspace',
    'change-engine',
    'v1',
    'domain',
    'play-adoption-previews',
  );
  await ensurePrivateDirectoryChain(workspaceRealpath, [
    '.workspace',
    'change-engine',
    'v1',
    'domain',
    'play-adoption-previews',
  ]);
  const rootRealpath = await realpath(root);
  assertPathInside(workspaceRealpath, rootRealpath, 'Play adoption preview root escaped workspace.');
  return rootRealpath;
}

async function ensurePrivateDirectoryChain(
  workspaceRealpath: string,
  segments: readonly string[],
): Promise<void> {
  let current = workspaceRealpath;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const information = await lstat(current);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error('Play adoption preview root is not a private directory.');
    }
  }
}

async function assertReplaceTargetIsPrivateFile(target: string): Promise<void> {
  const information = await lstat(target);
  if (information.isSymbolicLink() || !information.isFile() || information.nlink > 1) {
    throw new Error('Play adoption preview record is not a private regular file.');
  }
}

async function writeFileDurably(
  path: string,
  content: string,
  flag: 'wx',
): Promise<void> {
  const handle = await open(path, flag, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertPathInside(root: string, candidate: string, message: string): void {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (
    relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || relativePath.startsWith('/')
  ) throw new Error(message);
}

function normalizeProjection(value: unknown): PlayAdoptionProjection {
  if (value !== 'player' && value !== 'director') {
    throw new Error('Play adoption projection must be player or director.');
  }
  return value;
}

function normalizeTarget(value: unknown): PlayAdoptionTarget {
  if (
    value !== 'chapterDraft'
    && value !== 'state'
    && value !== 'timeline'
    && value !== 'foreshadow'
  ) throw new Error('Play adoption target is invalid.');
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
    typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    || value.includes('..')
  ) throw new Error(`${label} is invalid.`);
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function assertTimestamp(value: unknown): string {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) throw new Error('Play adoption preview createdAt is invalid.');
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

function assertExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !allowed.has(field))
  ) throw new Error('Stored Play adoption preview contains invalid fields.');
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(toStableJson(value, new Set<object>()));
}

function toStableJson(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
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
      .sort()
      .map((key) => [key, toStableJson((value as Record<string, unknown>)[key], ancestors)]));
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
