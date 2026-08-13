import type {
  ReferenceDeconstructionConfidence,
  ReferenceDeconstructionDiagnostic,
  ReferenceStoryMaterialAssertionType,
  ReferenceStoryMaterialKind,
} from './reference-deconstruction.js';
import { parsePendingActionView } from './pending-action-view.js';
import type {
  PendingActionViewChange,
  PendingActionViewV1,
} from './pending-action-view.js';

export interface ReferenceMaterialAdoptionEntry {
  id: string;
  materialKind: ReferenceStoryMaterialKind;
  title: string;
  content: string;
  details: string[];
  assertionType: ReferenceStoryMaterialAssertionType;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  sourceFindingRefs: string[];
  uncertainty?: string;
  sourcePath: `materials/${ReferenceStoryMaterialKind}.yaml`;
}

export interface ReferenceMaterialAdoptionCatalog {
  schemaVersion: 1;
  referenceId: string;
  referenceTitle: string;
  manifestRevision: number;
  sourceChecksumSha256: string;
  warningSummary: { count: number; codes: string[] };
  warnings: ReferenceDeconstructionDiagnostic[];
  materialFiles: Array<{
    materialKind: ReferenceStoryMaterialKind;
    path: `materials/${ReferenceStoryMaterialKind}.yaml`;
    checksumSha256: string;
    sourceRunId: string;
  }>;
  entries: ReferenceMaterialAdoptionEntry[];
  fingerprint: string;
}

export interface ReferenceMaterialAdoptionSelection {
  entryId: string;
  targetFile: string;
  targetPath?: string;
}

export interface ReferenceMaterialAdoptionDecision {
  targetId: string;
  materialKind: ReferenceStoryMaterialKind;
  targetFile: string;
  targetPath?: string;
  entryIds: string[];
  decision: 'create' | 'update' | 'skip';
  reason: string;
}

export interface ReferenceMaterialAdoptionPreview {
  schemaVersion: 1;
  id: string;
  referenceId: string;
  referenceTitle: string;
  catalogFingerprint: string;
  contextFingerprint: string;
  manifestRevision: number;
  sourceChecksumSha256: string;
  decisions: ReferenceMaterialAdoptionDecision[];
  warnings: ReferenceDeconstructionDiagnostic[];
  changes: readonly PendingActionViewChange[];
  diff: string;
  fingerprint: string;
  createdAt: string;
  canonicalUnchanged: true;
}

export type ReferenceMaterialAdoptionPreviewResult =
  | { status: 'ready'; preview: ReferenceMaterialAdoptionPreview }
  | {
      status: 'noChanges';
      referenceId: string;
      referenceTitle: string;
      catalogFingerprint: string;
      decisions: ReferenceMaterialAdoptionDecision[];
      warnings: ReferenceDeconstructionDiagnostic[];
      canonicalUnchanged: true;
    };

export interface ReferenceMaterialAdoptionPendingActionResult {
  pendingAction: PendingActionViewV1;
}

const MATERIAL_KINDS: readonly ReferenceStoryMaterialKind[] = [
  'world',
  'characters',
  'relationships',
  'outline',
  'timeline',
];

export function assertReferenceMaterialAdoptionPreviewInput(value: unknown): asserts value is {
  catalogFingerprint: string;
  selections: ReferenceMaterialAdoptionSelection[];
} {
  if (!isRecord(value) || !hasFields(value, ['catalogFingerprint', 'selections'])) {
    throw new Error('Reference Material adoption preview input is invalid.');
  }
  if (
    !isSha256(value.catalogFingerprint)
    || !Array.isArray(value.selections)
    || !value.selections.length
    || !value.selections.every((selection) =>
      isRecord(selection)
      && hasFields(selection, ['entryId', 'targetFile', 'targetPath'])
      && isSafeId(selection.entryId)
      && isSafePath(selection.targetFile)
      && (selection.targetPath === undefined || isBoundedText(selection.targetPath, 300)))
  ) {
    throw new Error('Reference Material adoption preview input is invalid.');
  }
}

export function parseReferenceMaterialAdoptionCatalogEnvelope(
  value: unknown,
  referenceId: string,
): { catalog: ReferenceMaterialAdoptionCatalog } {
  if (!isRecord(value) || !hasFields(value, ['catalog'])) {
    throw new Error('Reference Material catalog response is invalid.');
  }
  return { catalog: parseCatalog(value.catalog, referenceId) };
}

export function parseReferenceMaterialAdoptionPreviewResult(
  value: unknown,
  referenceId: string,
): ReferenceMaterialAdoptionPreviewResult {
  if (!isRecord(value) || (value.status !== 'ready' && value.status !== 'noChanges')) {
    throw new Error('Reference Material adoption preview response is invalid.');
  }
  if (value.status === 'ready') {
    if (!hasFields(value, ['status', 'preview'])) {
      throw new Error('Reference Material adoption preview response is invalid.');
    }
    return { status: 'ready', preview: parsePreview(value.preview, referenceId) };
  }
  if (
    !hasFields(value, [
      'status',
      'referenceId',
      'referenceTitle',
      'catalogFingerprint',
      'decisions',
      'warnings',
      'canonicalUnchanged',
    ])
    || value.referenceId !== referenceId
    || !isBoundedText(value.referenceTitle, 500)
    || !isSha256(value.catalogFingerprint)
    || value.canonicalUnchanged !== true
    || !Array.isArray(value.decisions)
    || !value.decisions.every(isDecision)
    || !Array.isArray(value.warnings)
    || !value.warnings.every(isDiagnostic)
  ) {
    throw new Error('Reference Material adoption no-change response is invalid.');
  }
  return structuredClone(value) as ReferenceMaterialAdoptionPreviewResult;
}

export function parseReferenceMaterialAdoptionPendingActionResult(
  value: unknown,
): ReferenceMaterialAdoptionPendingActionResult {
  if (
    !isRecord(value)
    || !hasFields(value, ['pendingAction'])
    || Object.keys(value).length !== 1
  ) {
    throw new Error('Reference Material adoption PendingAction response is invalid.');
  }
  let pendingAction: PendingActionViewV1;
  try {
    pendingAction = parsePendingActionView(value.pendingAction);
  } catch {
    throw new Error('Reference Material adoption PendingAction response is invalid.');
  }
  if (
    pendingAction.status !== 'pending'
    || pendingAction.origin?.kind !== 'referenceMaterialAdoption'
  ) {
    throw new Error('Reference Material adoption PendingAction response is invalid.');
  }
  return { pendingAction };
}

function parseCatalog(value: unknown, referenceId: string): ReferenceMaterialAdoptionCatalog {
  if (
    !isRecord(value)
    || !hasFields(value, [
      'schemaVersion',
      'referenceId',
      'referenceTitle',
      'manifestRevision',
      'sourceChecksumSha256',
      'warningSummary',
      'warnings',
      'materialFiles',
      'entries',
      'fingerprint',
    ])
    || value.schemaVersion !== 1
    || value.referenceId !== referenceId
    || !isBoundedText(value.referenceTitle, 500)
    || !isNonNegativeInteger(value.manifestRevision)
    || !isSha256(value.sourceChecksumSha256)
    || !isSha256(value.fingerprint)
    || !isWarningSummary(value.warningSummary)
    || !Array.isArray(value.warnings)
    || !value.warnings.every(isDiagnostic)
    || !Array.isArray(value.materialFiles)
    || !value.materialFiles.length
    || !value.materialFiles.every(isMaterialFile)
    || !Array.isArray(value.entries)
    || !value.entries.every(isEntry)
  ) {
    throw new Error('Reference Material catalog response is invalid.');
  }
  return structuredClone(value) as unknown as ReferenceMaterialAdoptionCatalog;
}

function parsePreview(value: unknown, referenceId: string): ReferenceMaterialAdoptionPreview {
  if (
    !isRecord(value)
    || !hasFields(value, [
      'schemaVersion',
      'id',
      'referenceId',
      'referenceTitle',
      'catalogFingerprint',
      'contextFingerprint',
      'manifestRevision',
      'sourceChecksumSha256',
      'decisions',
      'warnings',
      'changes',
      'diff',
      'fingerprint',
      'createdAt',
      'canonicalUnchanged',
    ])
    || value.schemaVersion !== 1
    || !isPendingActionId(value.id)
    || value.referenceId !== referenceId
    || !isBoundedText(value.referenceTitle, 500)
    || !isSha256(value.catalogFingerprint)
    || !isSha256(value.contextFingerprint)
    || !isNonNegativeInteger(value.manifestRevision)
    || !isSha256(value.sourceChecksumSha256)
    || !Array.isArray(value.decisions)
    || !value.decisions.length
    || !value.decisions.every(isDecision)
    || !Array.isArray(value.warnings)
    || !value.warnings.every(isDiagnostic)
    || !isPreviewChanges(value.changes)
    || typeof value.diff !== 'string'
    || !value.diff.trim()
    || !isSha256(value.fingerprint)
    || !isTimestamp(value.createdAt)
    || value.canonicalUnchanged !== true
  ) {
    throw new Error('Reference Material adoption preview response is invalid.');
  }
  return structuredClone(value) as unknown as ReferenceMaterialAdoptionPreview;
}

function isPreviewChanges(value: unknown): value is readonly PendingActionViewChange[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  try {
    parsePendingActionView({
      id: 'preview-shape',
      title: 'Preview',
      description: 'Preview changes',
      status: 'pending',
      createdAt: '2000-01-01T00:00:00.000Z',
      changes: value,
      diff: '',
    });
    return true;
  } catch {
    return false;
  }
}

function isEntry(value: unknown): boolean {
  return isRecord(value)
    && hasFields(value, [
      'id',
      'materialKind',
      'title',
      'content',
      'details',
      'assertionType',
      'confidence',
      'evidenceRefs',
      'sourceFindingRefs',
      'uncertainty',
      'sourcePath',
    ])
    && isSafeId(value.id)
    && isMaterialKind(value.materialKind)
    && isBoundedText(value.title, 500)
    && isBoundedText(value.content, 24_000)
    && isStringArray(value.details)
    && ['fact', 'interpretation', 'uncertain'].includes(String(value.assertionType))
    && ['low', 'medium', 'high'].includes(String(value.confidence))
    && isStringArray(value.evidenceRefs)
    && isStringArray(value.sourceFindingRefs)
    && (value.uncertainty === undefined || isBoundedText(value.uncertainty, 4_000))
    && value.sourcePath === `materials/${value.materialKind}.yaml`;
}

function isMaterialFile(value: unknown): boolean {
  return isRecord(value)
    && hasFields(value, ['materialKind', 'path', 'checksumSha256', 'sourceRunId'])
    && isMaterialKind(value.materialKind)
    && value.path === `materials/${value.materialKind}.yaml`
    && isSha256(value.checksumSha256)
    && isSafeId(value.sourceRunId);
}

function isDecision(value: unknown): boolean {
  return isRecord(value)
    && hasFields(value, [
      'targetId',
      'materialKind',
      'targetFile',
      'targetPath',
      'entryIds',
      'decision',
      'reason',
    ])
    && isSafeId(value.targetId)
    && isMaterialKind(value.materialKind)
    && isSafePath(value.targetFile)
    && (value.targetPath === undefined || isBoundedText(value.targetPath, 300))
    && isStringArray(value.entryIds)
    && value.entryIds.length > 0
    && ['create', 'update', 'skip'].includes(String(value.decision))
    && isBoundedText(value.reason, 2_000);
}

function isDiagnostic(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.code === 'string'
    && ['info', 'warning', 'error'].includes(String(value.severity))
    && typeof value.blocking === 'boolean'
    && typeof value.message === 'string'
    && Array.isArray(value.evidenceRefs);
}

function isWarningSummary(value: unknown): boolean {
  return isRecord(value)
    && hasFields(value, ['count', 'codes'])
    && isNonNegativeInteger(value.count)
    && isStringArray(value.codes);
}

function isMaterialKind(value: unknown): value is ReferenceStoryMaterialKind {
  return typeof value === 'string' && MATERIAL_KINDS.includes(value as ReferenceStoryMaterialKind);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}\p{N}_:.-]{1,180}$/u.test(value);
}

function isSafePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some((segment) => !segment || segment.startsWith('.') || segment === '..');
}

function isPendingActionId(value: unknown): value is string {
  return typeof value === 'string' && /^pa_[0-9a-f-]+$/iu.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function hasFields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
