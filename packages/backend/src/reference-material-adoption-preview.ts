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
import { dirname, join, resolve, sep } from 'node:path';

import {
  createReferenceMaterialAdoptionPlan,
  fingerprintReferenceMaterialAdoptionContext,
  prepareReferenceMaterialAdoptionContext,
} from '@oh-awesome-novel/core';
import type {
  ReferenceMaterialAdoptionContext,
  ReferenceMaterialAdoptionDecision,
  ReferenceMaterialAdoptionPlan,
} from '@oh-awesome-novel/core';
import {
  parsePreparedChangePreview,
} from '@oh-awesome-novel/tools';
import type {
  PendingActionView,
  PreparedChangePreviewV1,
} from '@oh-awesome-novel/tools';

import { serializePreparedChangePreviewSummary } from './pending-action-view.js';
import { syncDirectory } from './directory-sync.js';

export const REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION = 1 as const;
const MAX_STORED_ADOPTION_PREVIEW_BYTES = 12 * 1024 * 1024;

export interface ReferenceMaterialAdoptionPreviewEnvelope {
  schemaVersion: typeof REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION;
  id: string;
  referenceId: string;
  referenceTitle: string;
  catalogFingerprint: string;
  contextFingerprint: string;
  manifestRevision: number;
  sourceChecksumSha256: string;
  decisions: Array<Omit<ReferenceMaterialAdoptionDecision, 'draft'>>;
  warnings: ReferenceMaterialAdoptionContext['warnings'];
  changes: PendingActionView['changes'];
  diff: string;
  fingerprint: string;
  createdAt: string;
  canonicalUnchanged: true;
}

/** Domain metadata only. Candidate bytes and diff stay authoritative in the common preview store. */
export interface StoredReferenceMaterialAdoptionPreview {
  schemaVersion: typeof REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION;
  id: string;
  context: ReferenceMaterialAdoptionContext;
  plan: ReferenceMaterialAdoptionPlan;
  preparedChangePreviewId: string;
  candidateFingerprint: string;
  diffHash: string;
  contextFingerprint: string;
  previewFingerprint: string;
  createdAt: string;
  status: 'prepared' | 'promoted';
  pendingActionId?: string;
}

export function fingerprintReferenceMaterialAdoptionPreviewBinding(input: {
  id: string;
  context: ReferenceMaterialAdoptionContext;
  plan: ReferenceMaterialAdoptionPlan;
  createdAt: string;
}): string {
  const context = structuredClone(input.context);
  const plan = normalizePlan(input.plan, context);
  return sha256(stableSerialize({
    schemaVersion: REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: assertPendingActionId(input.id),
    contextFingerprint: fingerprintReferenceMaterialAdoptionContext(context),
    plan,
    createdAt: assertTimestamp(input.createdAt),
  }));
}

export function createStoredReferenceMaterialAdoptionPreview(input: {
  context: ReferenceMaterialAdoptionContext;
  plan: ReferenceMaterialAdoptionPlan;
  preparedChangePreview: PreparedChangePreviewV1;
  createdAt?: string;
}): StoredReferenceMaterialAdoptionPreview {
  const prepared = parsePreparedChangePreview(input.preparedChangePreview);
  const createdAt = assertTimestamp(input.createdAt ?? prepared.createdAt);
  const context = structuredClone(input.context);
  const plan = normalizePlan(input.plan, context);
  const contextFingerprint = fingerprintReferenceMaterialAdoptionContext(context);
  const previewFingerprint = fingerprintReferenceMaterialAdoptionPreviewBinding({
    id: prepared.id,
    context,
    plan,
    createdAt,
  });
  assertPreparedPreviewBinding(prepared, context, plan, contextFingerprint, previewFingerprint);
  return {
    schemaVersion: REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: prepared.id,
    context,
    plan,
    preparedChangePreviewId: prepared.id,
    candidateFingerprint: prepared.candidateFingerprint,
    diffHash: prepared.preview.diffHash,
    contextFingerprint,
    previewFingerprint,
    createdAt,
    status: 'prepared',
  };
}

export function projectReferenceMaterialAdoptionPreview(
  stored: StoredReferenceMaterialAdoptionPreview,
  preparedChangePreview: PreparedChangePreviewV1,
): ReferenceMaterialAdoptionPreviewEnvelope {
  const prepared = assertPreparedMatchesStored(stored, preparedChangePreview);
  const summary = serializePreparedChangePreviewSummary(prepared);
  return {
    schemaVersion: REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: stored.id,
    referenceId: stored.context.referenceId,
    referenceTitle: stored.context.referenceTitle,
    catalogFingerprint: stored.context.catalogFingerprint,
    contextFingerprint: stored.contextFingerprint,
    manifestRevision: stored.context.manifestRevision,
    sourceChecksumSha256: stored.context.sourceChecksumSha256,
    decisions: stored.plan.decisions.map(({ draft: _draft, ...decision }) =>
      structuredClone(decision)),
    warnings: structuredClone(stored.context.warnings),
    changes: summary.changes,
    diff: summary.diff,
    fingerprint: stored.previewFingerprint,
    createdAt: stored.createdAt,
    canonicalUnchanged: true,
  };
}

export async function assertReferenceMaterialAdoptionPreviewCurrent(
  workspaceRoot: string,
  stored: StoredReferenceMaterialAdoptionPreview,
): Promise<void> {
  const selections = stored.context.targets.flatMap((target) =>
    target.entries.map((entry) => ({
      entryId: entry.id,
      targetFile: target.targetFile,
      ...(target.targetPath ? { targetPath: target.targetPath } : {}),
    })));
  const current = await prepareReferenceMaterialAdoptionContext({
    workspaceRoot,
    referenceId: stored.context.referenceId,
    catalogFingerprint: stored.context.catalogFingerprint,
    selections,
  });
  if (
    fingerprintReferenceMaterialAdoptionContext(current) !== stored.contextFingerprint
    || current.manifestRevision !== stored.context.manifestRevision
    || current.sourceChecksumSha256 !== stored.context.sourceChecksumSha256
  ) {
    throw new Error('Reference Material adoption preview is stale.');
  }
}

export async function writeStoredReferenceMaterialAdoptionPreview(
  workspaceRoot: string,
  value: StoredReferenceMaterialAdoptionPreview,
  options: { create?: boolean } = {},
): Promise<void> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const normalized = normalizeStoredPreview(value);
  const target = await resolveRecordPath(workspaceRealpath, normalized.id);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STORED_ADOPTION_PREVIEW_BYTES) {
    throw new Error('Stored Reference Material adoption preview exceeds the size limit.');
  }
  if (options.create) {
    await writeFileDurably(target, serialized, 'wx');
    await syncDirectory(dirname(target));
    return;
  }
  await assertReplaceTargetIsPrivateFile(target);
  const temporary = join(dirname(target), `.${normalized.id}.${randomUUID()}.tmp`);
  try {
    await writeFileDurably(temporary, serialized, 'wx');
    await rename(temporary, target);
    await syncDirectory(dirname(target));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readStoredReferenceMaterialAdoptionPreview(
  workspaceRoot: string,
  id: string,
): Promise<StoredReferenceMaterialAdoptionPreview> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const target = await resolveRecordPath(workspaceRealpath, id);
  const stat = await lstat(target);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || stat.nlink > 1
    || stat.size > MAX_STORED_ADOPTION_PREVIEW_BYTES
  ) {
    throw new Error(`Reference Material adoption preview record is invalid: ${id}.`);
  }
  const targetRealpath = await realpath(target);
  assertPathInside(await resolveRecordRoot(workspaceRealpath), targetRealpath);
  return normalizeStoredPreview(JSON.parse(await readFile(targetRealpath, 'utf8')) as unknown);
}

export function promoteStoredReferenceMaterialAdoptionPreview(
  stored: StoredReferenceMaterialAdoptionPreview,
  preparedChangePreview: PreparedChangePreviewV1,
  pendingAction: PendingActionView,
): StoredReferenceMaterialAdoptionPreview {
  const prepared = assertPreparedMatchesStored(stored, preparedChangePreview);
  const summary = serializePreparedChangePreviewSummary(prepared);
  if (
    stored.status !== 'prepared'
    || pendingAction.id !== stored.id
    || pendingAction.status !== 'pending'
    || pendingAction.origin?.kind !== 'referenceMaterialAdoption'
    || stableSerialize(pendingAction.changes) !== stableSerialize(summary.changes)
    || pendingAction.diff !== summary.diff
  ) {
    throw new Error('Reference Material adoption PendingAction does not match its preview.');
  }
  return {
    ...structuredClone(stored),
    status: 'promoted',
    pendingActionId: pendingAction.id,
  };
}

function assertPreparedMatchesStored(
  stored: StoredReferenceMaterialAdoptionPreview,
  value: PreparedChangePreviewV1,
): PreparedChangePreviewV1 {
  const normalized = normalizeStoredPreview(stored);
  const prepared = parsePreparedChangePreview(value, normalized.id);
  assertPreparedPreviewBinding(
    prepared,
    normalized.context,
    normalized.plan,
    normalized.contextFingerprint,
    normalized.previewFingerprint,
  );
  if (
    prepared.id !== normalized.preparedChangePreviewId
    || prepared.candidateFingerprint !== normalized.candidateFingerprint
    || prepared.preview.diffHash !== normalized.diffHash
  ) {
    throw new Error('Reference Material adoption prepared preview binding is invalid.');
  }
  return prepared;
}

function assertPreparedPreviewBinding(
  prepared: PreparedChangePreviewV1,
  context: ReferenceMaterialAdoptionContext,
  plan: ReferenceMaterialAdoptionPlan,
  contextFingerprint: string,
  previewFingerprint: string,
): void {
  const origin = prepared.origin;
  const allowedTargets = plan.decisions
    .filter((decision) => decision.decision !== 'skip')
    .map((decision) => decision.targetFile)
    .sort(compareText);
  if (
    prepared.capability !== 'reference.adopt'
    || prepared.id !== assertPendingActionId(prepared.id)
    || origin.kind !== 'referenceMaterialAdoption'
    || origin.referenceId !== context.referenceId
    || origin.manifestRevision !== context.manifestRevision
    || origin.sourceChecksumSha256 !== context.sourceChecksumSha256
    || origin.contextFingerprint !== contextFingerprint
    || origin.previewFingerprint !== previewFingerprint
    || stableSerialize(prepared.allowedTargets) !== stableSerialize(allowedTargets)
  ) {
    throw new Error('Reference Material adoption prepared preview is invalid.');
  }
}

function normalizeStoredPreview(value: unknown): StoredReferenceMaterialAdoptionPreview {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Stored Reference Material adoption preview is invalid.');
  }
  assertExactFields(value, [
    'schemaVersion',
    'id',
    'context',
    'plan',
    'preparedChangePreviewId',
    'candidateFingerprint',
    'diffHash',
    'contextFingerprint',
    'previewFingerprint',
    'createdAt',
    'status',
  ], ['pendingActionId']);
  const id = assertPendingActionId(value.id);
  const context = structuredClone(value.context) as ReferenceMaterialAdoptionContext;
  const plan = normalizePlan(value.plan as ReferenceMaterialAdoptionPlan, context);
  const contextFingerprint = fingerprintReferenceMaterialAdoptionContext(context);
  const createdAt = assertTimestamp(value.createdAt);
  const previewFingerprint = fingerprintReferenceMaterialAdoptionPreviewBinding({
    id,
    context,
    plan,
    createdAt,
  });
  const status = value.status;
  if (
    value.preparedChangePreviewId !== id
    || value.contextFingerprint !== contextFingerprint
    || value.previewFingerprint !== previewFingerprint
    || !isSha256(value.candidateFingerprint)
    || !isSha256(value.diffHash)
    || (status !== 'prepared' && status !== 'promoted')
    || (status === 'promoted') !== Object.hasOwn(value, 'pendingActionId')
    || (status === 'promoted' && value.pendingActionId !== id)
  ) {
    throw new Error('Stored Reference Material adoption preview binding is invalid.');
  }
  return {
    schemaVersion: 1,
    id,
    context,
    plan,
    preparedChangePreviewId: id,
    candidateFingerprint: value.candidateFingerprint,
    diffHash: value.diffHash,
    contextFingerprint,
    previewFingerprint,
    createdAt,
    status,
    ...(status === 'promoted' ? { pendingActionId: id } : {}),
  };
}

function normalizePlan(
  value: ReferenceMaterialAdoptionPlan,
  context: ReferenceMaterialAdoptionContext,
): ReferenceMaterialAdoptionPlan {
  if (!isRecord(value) || !Array.isArray(value.decisions)) {
    throw new Error('Reference Material adoption plan is invalid.');
  }
  return createReferenceMaterialAdoptionPlan(context, {
    targets: value.decisions.map((decision) => ({
      targetId: decision.targetId,
      decision: decision.decision,
      reason: decision.reason,
      draft: decision.draft ?? null,
    })),
  });
}

async function resolveRecordPath(workspaceRealpath: string, id: string): Promise<string> {
  return join(await resolveRecordRoot(workspaceRealpath), `${assertPendingActionId(id)}.json`);
}

async function resolveRecordRoot(workspaceRealpath: string): Promise<string> {
  const root = resolve(
    workspaceRealpath,
    '.workspace',
    'change-engine',
    'v1',
    'domain',
    'reference-material-adoption-previews',
  );
  await ensurePrivateDirectoryChain(workspaceRealpath, [
    '.workspace',
    'change-engine',
    'v1',
    'domain',
    'reference-material-adoption-previews',
  ]);
  const rootRealpath = await realpath(root);
  assertPathInside(workspaceRealpath, rootRealpath);
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
      throw new Error('Reference Material adoption preview root is not a private directory.');
    }
  }
}

async function assertReplaceTargetIsPrivateFile(target: string): Promise<void> {
  const information = await lstat(target);
  if (information.isSymbolicLink() || !information.isFile() || information.nlink > 1) {
    throw new Error('Reference Material adoption preview record is not a private regular file.');
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

function assertPendingActionId(value: unknown): string {
  if (typeof value !== 'string' || !/^pa_[0-9a-f-]+$/iu.test(value)) {
    throw new Error(`Invalid PendingAction id: ${String(value)}.`);
  }
  return value;
}

function assertTimestamp(value: unknown): string {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error('Reference Material adoption timestamp is invalid.');
  }
  return value;
}

function assertPathInside(root: string, target: string): void {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(prefix)) {
    throw new Error('Reference Material adoption preview path escaped workspace.');
  }
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
  ) {
    throw new Error('Stored Reference Material adoption preview has invalid fields.');
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
