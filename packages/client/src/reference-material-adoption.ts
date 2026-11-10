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

export type ReferenceMaterialAdoptionTargetSuggestions =
  Record<ReferenceStoryMaterialKind, string[]> & { truncated: boolean };

export type ReferenceMaterialAdoptionPreflightIssueCode =
  | 'catalogChanged'
  | 'entryNotPublished'
  | 'duplicateEntry'
  | 'illegalTargetPath'
  | 'targetKindMismatch'
  | 'mixedTarget'
  | 'targetUnreadable'
  | 'tooManySelections'
  | 'tooManyTargets'
  | 'existingTarget'
  | 'existingCharacter'
  | 'sharedTarget'
  | 'largeBatch';

export interface ReferenceMaterialAdoptionPreflightIssue {
  code: ReferenceMaterialAdoptionPreflightIssueCode;
  severity: 'error' | 'notice';
  message: string;
  entryIds: string[];
  targetFile?: string;
}

export interface ReferenceMaterialAdoptionPreflight {
  schemaVersion: 1;
  referenceId: string;
  catalogFingerprint: string;
  status: 'ready' | 'blocked';
  selectionCount: number;
  targetCount: number;
  materialChars: number;
  limits: { selections: number; targets: number; largeBatchChars: number };
  targets: Array<{
    materialKind: ReferenceStoryMaterialKind;
    targetFile: string;
    targetPath?: string;
    entryIds: string[];
    operation: 'create' | 'update';
  }>;
  issues: ReferenceMaterialAdoptionPreflightIssue[];
}

export interface ReferenceMaterialAdoptionRecord {
  pendingActionId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  commit?: string;
  currentPublication: boolean;
  targets: Array<{ operation: 'create' | 'update' | 'delete'; path: string }>;
  entryEvidence: 'available' | 'missing';
  entries: Array<{
    entryId: string;
    title: string;
    materialKind: ReferenceStoryMaterialKind;
    targetFile: string;
    decision: 'create' | 'update' | 'skip';
  }>;
}

export interface ReferenceMaterialAdoptionRecords {
  referenceId: string;
  records: ReferenceMaterialAdoptionRecord[];
  coverage: 'retainedReviewDataOnly';
}

/** The preflight explains bad targets, so its input is only bounded, not path-validated. */
export interface ReferenceMaterialAdoptionPreflightInput {
  catalogFingerprint: string;
  selections: ReferenceMaterialAdoptionSelection[];
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
): {
  catalog: ReferenceMaterialAdoptionCatalog;
  targetSuggestions: ReferenceMaterialAdoptionTargetSuggestions;
} {
  if (!isRecord(value) || !hasFields(value, ['catalog', 'targetSuggestions'])) {
    throw new Error('Reference Material catalog response is invalid.');
  }
  return {
    catalog: parseCatalog(value.catalog, referenceId),
    targetSuggestions: parseTargetSuggestions(value.targetSuggestions),
  };
}

export function assertReferenceMaterialAdoptionPreflightInput(
  value: unknown,
): asserts value is ReferenceMaterialAdoptionPreflightInput {
  if (
    !isRecord(value)
    || !hasFields(value, ['catalogFingerprint', 'selections'])
    || !isSha256(value.catalogFingerprint)
    || !Array.isArray(value.selections)
    || value.selections.length > 512
    || !value.selections.every((selection) =>
      isRecord(selection)
      && hasFields(selection, ['entryId', 'targetFile', 'targetPath'])
      && typeof selection.entryId === 'string' && selection.entryId.length <= 200
      && typeof selection.targetFile === 'string' && selection.targetFile.length <= 1_000
      && (selection.targetPath === undefined
        || (typeof selection.targetPath === 'string' && selection.targetPath.length <= 300)))
  ) {
    throw new Error('Reference Material adoption preflight input is invalid.');
  }
}

export function parseReferenceMaterialAdoptionPreflightEnvelope(
  value: unknown,
  referenceId: string,
): { preflight: ReferenceMaterialAdoptionPreflight } {
  const preflight = isRecord(value) && hasFields(value, ['preflight']) ? value.preflight : undefined;
  if (
    !isRecord(preflight)
    || !hasFields(preflight, [
      'schemaVersion', 'referenceId', 'catalogFingerprint', 'status', 'selectionCount',
      'targetCount', 'materialChars', 'limits', 'targets', 'issues',
    ])
    || preflight.schemaVersion !== 1
    || preflight.referenceId !== referenceId
    || !isSha256(preflight.catalogFingerprint)
    || (preflight.status !== 'ready' && preflight.status !== 'blocked')
    || !isNonNegativeInteger(preflight.selectionCount)
    || !isNonNegativeInteger(preflight.targetCount)
    || !isNonNegativeInteger(preflight.materialChars)
    || !isRecord(preflight.limits)
    || !hasFields(preflight.limits, ['selections', 'targets', 'largeBatchChars'])
    || !Object.values(preflight.limits).every(isNonNegativeInteger)
    || !Array.isArray(preflight.targets)
    || !preflight.targets.every((target) =>
      isRecord(target)
      && hasFields(target, ['materialKind', 'targetFile', 'targetPath', 'entryIds', 'operation'])
      && isMaterialKind(target.materialKind)
      && isSafePath(target.targetFile)
      && (target.targetPath === undefined || isBoundedText(target.targetPath, 300))
      && isStringArray(target.entryIds)
      && (target.operation === 'create' || target.operation === 'update'))
    || !Array.isArray(preflight.issues)
    || !preflight.issues.every((issue) =>
      isRecord(issue)
      && hasFields(issue, ['code', 'severity', 'message', 'entryIds', 'targetFile'])
      && typeof issue.code === 'string' && PREFLIGHT_ISSUE_CODES.includes(issue.code)
      && (issue.severity === 'error' || issue.severity === 'notice')
      && isBoundedText(issue.message, 2_000)
      && isStringArray(issue.entryIds)
      && (issue.targetFile === undefined
        || (typeof issue.targetFile === 'string' && issue.targetFile.length <= 1_000)))
    // A batch with a blocking issue can never be reported as ready.
    || (preflight.status === 'ready'
      && preflight.issues.some((issue) => isRecord(issue) && issue.severity === 'error'))
  ) {
    throw new Error('Reference Material adoption preflight response is invalid.');
  }
  return { preflight: structuredClone(preflight) as unknown as ReferenceMaterialAdoptionPreflight };
}

export function parseReferenceMaterialAdoptionRecords(
  value: unknown,
  referenceId: string,
): ReferenceMaterialAdoptionRecords {
  if (
    !isRecord(value)
    || !hasFields(value, ['referenceId', 'records', 'coverage'])
    || value.referenceId !== referenceId
    || value.coverage !== 'retainedReviewDataOnly'
    || !Array.isArray(value.records)
    || !value.records.every((record) =>
      isRecord(record)
      && hasFields(record, [
        'pendingActionId', 'status', 'createdAt', 'decidedAt', 'commit', 'currentPublication',
        'targets', 'entryEvidence', 'entries',
      ])
      && isPendingActionId(record.pendingActionId)
      && (record.status === 'pending' || record.status === 'accepted' || record.status === 'rejected')
      && isTimestamp(record.createdAt)
      && (record.decidedAt === undefined || isTimestamp(record.decidedAt))
      && (record.commit === undefined
        || (typeof record.commit === 'string' && /^[a-f0-9]{7,64}$/u.test(record.commit)))
      && typeof record.currentPublication === 'boolean'
      && Array.isArray(record.targets)
      && record.targets.every((target) =>
        isRecord(target)
        && hasFields(target, ['operation', 'path'])
        && (target.operation === 'create' || target.operation === 'update' || target.operation === 'delete')
        && isSafePath(target.path))
      && (record.entryEvidence === 'available' || record.entryEvidence === 'missing')
      && Array.isArray(record.entries)
      // Without the preview record there is nothing to name entries from.
      && (record.entryEvidence === 'available' || record.entries.length === 0)
      && record.entries.every((entry) =>
        isRecord(entry)
        && hasFields(entry, ['entryId', 'title', 'materialKind', 'targetFile', 'decision'])
        && isSafeId(entry.entryId)
        && isBoundedText(entry.title, 500)
        && isMaterialKind(entry.materialKind)
        && isSafePath(entry.targetFile)
        && (entry.decision === 'create' || entry.decision === 'update' || entry.decision === 'skip')))
  ) {
    throw new Error('Reference Material adoption records response is invalid.');
  }
  return structuredClone(value) as unknown as ReferenceMaterialAdoptionRecords;
}

const PREFLIGHT_ISSUE_CODES: readonly string[] = [
  'catalogChanged', 'entryNotPublished', 'duplicateEntry', 'illegalTargetPath',
  'targetKindMismatch', 'mixedTarget', 'targetUnreadable', 'tooManySelections',
  'tooManyTargets', 'existingTarget', 'existingCharacter', 'sharedTarget', 'largeBatch',
];

function parseTargetSuggestions(value: unknown): ReferenceMaterialAdoptionTargetSuggestions {
  if (
    !isRecord(value)
    || !hasFields(value, [...MATERIAL_KINDS, 'truncated'])
    || typeof value.truncated !== 'boolean'
    || !MATERIAL_KINDS.every((kind) => {
      const paths = value[kind];
      return Array.isArray(paths) && paths.length <= 200 && paths.every(isSafePath);
    })
  ) {
    throw new Error('Reference Material target suggestions are invalid.');
  }
  return structuredClone(value) as unknown as ReferenceMaterialAdoptionTargetSuggestions;
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
