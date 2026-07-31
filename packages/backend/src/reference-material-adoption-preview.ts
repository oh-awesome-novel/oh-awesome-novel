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
import type {
  PreparedWriteIntentPreview,
  WriteIntentPendingAction,
} from '@oh-awesome-novel/tools';

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
  touchedFiles: string[];
  diff: string;
  fingerprint: string;
  createdAt: string;
  canonicalUnchanged: true;
}

export interface StoredReferenceMaterialAdoptionPreview {
  schemaVersion: typeof REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION;
  id: string;
  context: ReferenceMaterialAdoptionContext;
  plan: ReferenceMaterialAdoptionPlan;
  preparedWriteIntent: PreparedWriteIntentPreview;
  contextFingerprint: string;
  previewFingerprint: string;
  createdAt: string;
  status: 'prepared' | 'promoted';
  pendingAction?: WriteIntentPendingAction;
}

export function createStoredReferenceMaterialAdoptionPreview(input: {
  context: ReferenceMaterialAdoptionContext;
  plan: ReferenceMaterialAdoptionPlan;
  preparedWriteIntent: PreparedWriteIntentPreview;
  createdAt?: string;
}): StoredReferenceMaterialAdoptionPreview {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const context = structuredClone(input.context);
  const plan = normalizePlan(input.plan, context);
  const preparedWriteIntent = structuredClone(input.preparedWriteIntent);
  if (
    preparedWriteIntent.toolName !== 'reference.adoptMaterials'
    || preparedWriteIntent.id !== assertPendingActionId(preparedWriteIntent.id)
  ) {
    throw new Error('Reference Material adoption prepared preview is invalid.');
  }
  const contextFingerprint = fingerprintReferenceMaterialAdoptionContext(context);
  const core = {
    schemaVersion: REFERENCE_MATERIAL_ADOPTION_PREVIEW_SCHEMA_VERSION,
    id: preparedWriteIntent.id,
    context,
    plan,
    preparedWriteIntent,
    contextFingerprint,
    createdAt: assertTimestamp(createdAt),
  };
  return {
    ...core,
    previewFingerprint: sha256(stableSerialize({
      schemaVersion: core.schemaVersion,
      id: core.id,
      contextFingerprint,
      plan,
      preparedWriteIntentFingerprint: preparedWriteIntent.fingerprint,
      createdAt: core.createdAt,
    })),
    status: 'prepared',
  };
}

export function projectReferenceMaterialAdoptionPreview(
  stored: StoredReferenceMaterialAdoptionPreview,
): ReferenceMaterialAdoptionPreviewEnvelope {
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
    touchedFiles: [...stored.preparedWriteIntent.touchedFiles],
    diff: stored.preparedWriteIntent.diff,
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
  const target = await resolveRecordPath(workspaceRealpath, value.id);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STORED_ADOPTION_PREVIEW_BYTES) {
    throw new Error('Stored Reference Material adoption preview exceeds the size limit.');
  }
  if (options.create) {
    await writeFile(target, serialized, { encoding: 'utf8', flag: 'wx' });
    return;
  }
  const temporary = join(dirname(target), `.${value.id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
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
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_STORED_ADOPTION_PREVIEW_BYTES) {
    throw new Error(`Reference Material adoption preview record is invalid: ${id}.`);
  }
  const targetRealpath = await realpath(target);
  assertPathInside(await resolveRecordRoot(workspaceRealpath), targetRealpath);
  return normalizeStoredPreview(JSON.parse(await readFile(targetRealpath, 'utf8')) as unknown);
}

export function promoteStoredReferenceMaterialAdoptionPreview(
  stored: StoredReferenceMaterialAdoptionPreview,
  pendingAction: WriteIntentPendingAction,
): StoredReferenceMaterialAdoptionPreview {
  if (
    stored.status !== 'prepared'
    || stored.id !== pendingAction.id
    || pendingAction.status !== 'pending'
    || stableSerialize(pendingAction.patches) !== stableSerialize(stored.preparedWriteIntent.patches)
    || stableSerialize(pendingAction.touchedFiles)
      !== stableSerialize(stored.preparedWriteIntent.touchedFiles)
    || pendingAction.diff !== stored.preparedWriteIntent.diff
  ) {
    throw new Error('Reference Material adoption PendingAction does not match its preview.');
  }
  return {
    ...structuredClone(stored),
    status: 'promoted',
    pendingAction: structuredClone(pendingAction),
  };
}

function normalizeStoredPreview(value: unknown): StoredReferenceMaterialAdoptionPreview {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Stored Reference Material adoption preview is invalid.');
  }
  const id = assertPendingActionId(value.id);
  const context = structuredClone(value.context) as ReferenceMaterialAdoptionContext;
  const plan = normalizePlan(value.plan as ReferenceMaterialAdoptionPlan, context);
  const prepared = structuredClone(value.preparedWriteIntent) as PreparedWriteIntentPreview;
  const contextFingerprint = fingerprintReferenceMaterialAdoptionContext(context);
  const createdAt = assertTimestamp(value.createdAt);
  const expectedPreviewFingerprint = sha256(stableSerialize({
    schemaVersion: 1,
    id,
    contextFingerprint,
    plan,
    preparedWriteIntentFingerprint: prepared.fingerprint,
    createdAt,
  }));
  if (
    value.contextFingerprint !== contextFingerprint
    || value.previewFingerprint !== expectedPreviewFingerprint
    || prepared.id !== id
    || prepared.toolName !== 'reference.adoptMaterials'
    || (value.status !== 'prepared' && value.status !== 'promoted')
    || (value.status === 'promoted') !== isRecord(value.pendingAction)
  ) {
    throw new Error('Stored Reference Material adoption preview binding is invalid.');
  }
  return {
    schemaVersion: 1,
    id,
    context,
    plan,
    preparedWriteIntent: prepared,
    contextFingerprint,
    previewFingerprint: expectedPreviewFingerprint,
    createdAt,
    status: value.status,
    ...(value.status === 'promoted'
      ? { pendingAction: structuredClone(value.pendingAction) as WriteIntentPendingAction }
      : {}),
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
    'reference-material-adoption-previews',
  );
  await mkdir(root, { recursive: true });
  const rootRealpath = await realpath(root);
  assertPathInside(workspaceRealpath, rootRealpath);
  return rootRealpath;
}

function assertPendingActionId(value: unknown): string {
  if (typeof value !== 'string' || !/^pa_[0-9a-f-]+$/iu.test(value)) {
    throw new Error(`Invalid PendingAction id: ${String(value)}.`);
  }
  return value;
}

function assertTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
