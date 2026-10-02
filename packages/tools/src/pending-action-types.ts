import {
  normalizeWorkspaceRelativePath,
  sha256Text,
} from './candidate-change-set';
import type {
  ExistingContent,
  RepositoryBaseline,
  WorkspaceEditCapability,
} from './candidate-change-set';

export const PENDING_ACTION_SCHEMA_VERSION = 1 as const;
export const PREPARED_CHANGE_PREVIEW_SCHEMA_VERSION = 1 as const;
export const PENDING_ACTION_TERMINAL_SCHEMA_VERSION = 1 as const;

export const UNSUPPORTED_PENDING_ACTION_SCHEMA =
  'UNSUPPORTED_PENDING_ACTION_SCHEMA' as const;

export type PendingActionProtocolErrorCode =
  | typeof UNSUPPORTED_PENDING_ACTION_SCHEMA
  | 'INVALID_PENDING_ACTION_SCHEMA'
  | 'PENDING_ACTION_NOT_FOUND'
  | 'PENDING_ACTION_ID_CONFLICT'
  | 'PENDING_ACTION_TERMINAL_CONFLICT'
  | 'PENDING_ACTION_CORRUPT'
  | 'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH'
  | 'PENDING_ACTION_DRAFT_INTEGRITY_ERROR'
  | 'STALE_PENDING_ACTION_BASELINE'
  | 'PENDING_ACTION_ORIGIN_VALIDATOR_REQUIRED';

export class PendingActionProtocolError extends Error {
  readonly code: PendingActionProtocolErrorCode;

  constructor(code: PendingActionProtocolErrorCode, message: string) {
    super(message);
    this.name = 'PendingActionProtocolError';
    this.code = code;
  }
}

export interface PendingAction {
  readonly schemaVersion: typeof PENDING_ACTION_SCHEMA_VERSION;
  readonly kind: 'pending-action';
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly createdAt: string;
  readonly source: PendingActionSource;
  readonly repository: RepositoryBaseline;
  readonly allowedTargets: readonly string[];
  readonly changes: readonly PendingFileChange[];
  readonly preview: {
    readonly diff: string;
    readonly diffHash: string;
  };
  readonly origin?: PendingActionOrigin;
}

export type PendingActionSource =
  | {
      readonly kind: 'bash-session';
      readonly sessionId: string;
      readonly capability: WorkspaceEditCapability;
      readonly commandLogHash: string;
      readonly commandCount: number;
      readonly finalization: 'explicit-tool' | 'runtime-fallback';
    }
  | {
      readonly kind: 'deterministic-builder';
      readonly producer: string;
      readonly capability: WorkspaceEditCapability;
    };

export type PendingActionOrigin =
  | {
      readonly kind: 'chapterSettlement';
      readonly chapterId: string;
      readonly sourceHash: string;
    }
  | {
      readonly kind: 'agentTurn';
      readonly sessionId: string;
      readonly turnId: string;
    }
  | {
      readonly kind: 'referenceDeconstructionPublish';
      readonly referenceId: string;
      readonly runId: string;
      readonly runRevision: number;
      readonly candidateFingerprint: string;
    }
  | {
      readonly kind: 'referenceMaterialAdoption';
      readonly referenceId: string;
      readonly manifestRevision: number;
      readonly sourceChecksumSha256: string;
      readonly contextFingerprint: string;
      readonly previewFingerprint: string;
    }
  | {
      readonly kind: 'playAdoption';
      readonly sessionId: string;
      readonly branchId: string;
      readonly sourceRevision: number;
      readonly previewFingerprint: string;
    };

export type PendingFileChange =
  | {
      readonly operation: 'create';
      readonly path: string;
      readonly baseline: { readonly exists: false };
      readonly draft: DraftArtifact;
    }
  | {
      readonly operation: 'update';
      readonly path: string;
      readonly baseline: ExistingContent;
      readonly draft: DraftArtifact;
    }
  | {
      readonly operation: 'delete';
      readonly path: string;
      readonly baseline: ExistingContent;
      readonly draft: null;
    };

export interface DraftArtifact {
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export type PendingActionRecord =
  | {
      readonly action: PendingAction;
      readonly status: 'pending';
    }
  | {
      readonly action: PendingAction;
      readonly status: 'accepted';
      readonly acceptedAt: string;
      readonly decisionReceiptId: string;
    }
  | {
      readonly action: PendingAction;
      readonly status: 'rejected';
      readonly rejectedAt: string;
      readonly decisionReceiptId: string;
    };

export interface PendingActionTerminalRecord {
  readonly schemaVersion: typeof PENDING_ACTION_TERMINAL_SCHEMA_VERSION;
  readonly kind: 'pending-action-terminal';
  readonly actionId: string;
  readonly decision: 'accepted' | 'rejected';
  readonly decidedAt: string;
  readonly decisionReceiptId: string;
}

export interface PreparedChangePreviewV1 {
  readonly schemaVersion: typeof PREPARED_CHANGE_PREVIEW_SCHEMA_VERSION;
  readonly kind: 'prepared-change-preview';
  readonly id: string;
  readonly capability: WorkspaceEditCapability;
  readonly candidateFingerprint: string;
  readonly repository: RepositoryBaseline;
  readonly origin: PendingActionOrigin;
  readonly allowedTargets: readonly string[];
  readonly changes: readonly PendingFileChange[];
  readonly preview: {
    readonly diff: string;
    readonly diffHash: string;
  };
  readonly createdAt: string;
}

export interface PreparedChangePreviewPromotion {
  readonly schemaVersion: 1;
  readonly kind: 'prepared-change-preview-promotion';
  readonly previewId: string;
  readonly actionId: string;
  readonly candidateFingerprint: string;
  readonly promotedAt: string;
}

export type PendingActionGitResult =
  | { readonly status: 'not-requested' }
  | {
      readonly status: 'committed';
      readonly commit: string;
      readonly branch: string;
    }
  | {
      readonly status: 'staged-not-committed';
      readonly branch: string;
      readonly errorCode: string;
    }
  | { readonly status: 'failed'; readonly errorCode: string };

export interface PendingActionView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'pending' | 'accepted' | 'rejected';
  readonly createdAt: string;
  readonly decidedAt?: string;
  readonly changes: ReadonlyArray<{
    readonly operation: 'create' | 'update' | 'delete';
    readonly path: string;
    readonly oldHash?: string;
    readonly newHash?: string;
  }>;
  readonly diff: string;
  readonly origin?: PendingActionOrigin;
  readonly git?: PendingActionGitResult;
}

const CAPABILITIES: readonly WorkspaceEditCapability[] = [
  'read-only',
  'chapter.edit',
  'character.edit',
  'world.edit',
  'state.edit',
  'timeline.edit',
  'foreshadow.edit',
  'summary.edit',
  'outline.edit',
  'novel.multi-file-edit',
  'reference.publish',
  'reference.adopt',
  'play.adopt',
];

export function parsePendingAction(
  value: unknown,
  expectedId?: string,
): PendingAction {
  assertSupportedEnvelope(value, 'pending-action');
  assertExactFields(value, [
    'schemaVersion',
    'kind',
    'id',
    'title',
    'description',
    'createdAt',
    'source',
    'repository',
    'allowedTargets',
    'changes',
    'preview',
  ], ['origin']);
  const id = assertOpaquePendingActionId(value.id, 'PendingAction id');
  if (expectedId !== undefined && id !== assertOpaquePendingActionId(expectedId)) {
    invalidSchema(`PendingAction id does not match its storage key: ${expectedId}`);
  }
  assertNonEmptyText(value.title, 'PendingAction title');
  assertNonEmptyText(value.description, 'PendingAction description');
  assertCanonicalIsoTimestamp(value.createdAt, 'PendingAction createdAt');
  const source = parsePendingActionSource(value.source);
  parseRepositoryBaseline(value.repository);
  const allowedTargets = parseAllowedTargets(value.allowedTargets);
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    invalidSchema('PendingAction changes must be a non-empty array.');
  }
  const changes = parsePendingFileChanges(value.changes, `drafts/${id}`);
  const allowed = new Set(allowedTargets);
  if (changes.some((change) => !allowed.has(change.path))) {
    throw new PendingActionProtocolError(
      'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
      `PendingAction ${id} contains a change outside its allowed targets.`,
    );
  }
  parsePreview(value.preview, 'PendingAction preview');
  const origin = Object.hasOwn(value, 'origin') ? parsePendingActionOrigin(value.origin) : undefined;
  const settlementProducer = source.kind === 'deterministic-builder' && source.producer === 'chapter-settlement';
  if ((settlementProducer || origin?.kind === 'chapterSettlement')
    && (!settlementProducer || origin?.kind !== 'chapterSettlement' || source.capability !== 'novel.multi-file-edit')) {
    invalidSchema('Settlement producer requires its matching chapter evidence origin.');
  }
  return deepFreeze(structuredClone(value)) as unknown as PendingAction;
}

export function parsePreparedChangePreview(
  value: unknown,
  expectedId?: string,
): PreparedChangePreviewV1 {
  assertSupportedEnvelope(value, 'prepared-change-preview');
  assertExactFields(value, [
    'schemaVersion',
    'kind',
    'id',
    'capability',
    'candidateFingerprint',
    'repository',
    'origin',
    'allowedTargets',
    'changes',
    'preview',
    'createdAt',
  ]);
  const id = assertOpaquePendingActionId(value.id, 'Prepared preview id');
  if (expectedId !== undefined && id !== assertOpaquePendingActionId(expectedId)) {
    invalidSchema(`Prepared preview id does not match its storage key: ${expectedId}`);
  }
  assertWorkspaceEditCapability(value.capability);
  assertSha256(value.candidateFingerprint, 'Prepared preview candidate fingerprint');
  parseRepositoryBaseline(value.repository);
  parsePendingActionOrigin(value.origin);
  const allowedTargets = parseAllowedTargets(value.allowedTargets);
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    invalidSchema('Prepared preview changes must be a non-empty array.');
  }
  const changes = parsePendingFileChanges(value.changes, `previews/${id}/drafts`);
  const allowed = new Set(allowedTargets);
  if (changes.some((change) => !allowed.has(change.path))) {
    throw new PendingActionProtocolError(
      'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
      `Prepared preview ${id} contains a change outside its allowed targets.`,
    );
  }
  parsePreview(value.preview, 'Prepared preview diff');
  assertCanonicalIsoTimestamp(value.createdAt, 'Prepared preview createdAt');
  return deepFreeze(structuredClone(value)) as unknown as PreparedChangePreviewV1;
}

export function parsePendingActionTerminal(
  value: unknown,
  expectedActionId?: string,
  expectedDecision?: 'accepted' | 'rejected',
): PendingActionTerminalRecord {
  assertSupportedEnvelope(value, 'pending-action-terminal');
  assertExactFields(value, [
    'schemaVersion',
    'kind',
    'actionId',
    'decision',
    'decidedAt',
    'decisionReceiptId',
  ]);
  const actionId = assertOpaquePendingActionId(value.actionId, 'Terminal action id');
  if (
    expectedActionId !== undefined
    && actionId !== assertOpaquePendingActionId(expectedActionId)
  ) {
    invalidSchema(`PendingAction terminal does not match action ${expectedActionId}.`);
  }
  if (value.decision !== 'accepted' && value.decision !== 'rejected') {
    invalidSchema('PendingAction terminal decision is invalid.');
  }
  if (expectedDecision !== undefined && value.decision !== expectedDecision) {
    invalidSchema(`PendingAction terminal is not ${expectedDecision}.`);
  }
  assertCanonicalIsoTimestamp(value.decidedAt, 'PendingAction terminal decidedAt');
  assertOpaquePendingActionId(value.decisionReceiptId, 'Decision receipt id');
  return deepFreeze(structuredClone(value)) as unknown as PendingActionTerminalRecord;
}

export function parsePreparedChangePreviewPromotion(
  value: unknown,
  expectedPreviewId?: string,
): PreparedChangePreviewPromotion {
  assertSupportedEnvelope(value, 'prepared-change-preview-promotion');
  assertExactFields(value, [
    'schemaVersion',
    'kind',
    'previewId',
    'actionId',
    'candidateFingerprint',
    'promotedAt',
  ]);
  const previewId = assertOpaquePendingActionId(value.previewId, 'Promotion preview id');
  if (
    expectedPreviewId !== undefined
    && previewId !== assertOpaquePendingActionId(expectedPreviewId)
  ) {
    invalidSchema(`Prepared preview promotion does not match ${expectedPreviewId}.`);
  }
  assertOpaquePendingActionId(value.actionId, 'Promotion action id');
  assertSha256(value.candidateFingerprint, 'Promotion candidate fingerprint');
  assertCanonicalIsoTimestamp(value.promotedAt, 'Promotion timestamp');
  return deepFreeze(structuredClone(value)) as unknown as PreparedChangePreviewPromotion;
}

export function parsePendingActionSource(value: unknown): PendingActionSource {
  if (!isRecord(value)) invalidSchema('PendingAction source must be an object.');
  if (value.kind === 'bash-session') {
    assertExactFields(value, [
      'kind',
      'sessionId',
      'capability',
      'commandLogHash',
      'commandCount',
      'finalization',
    ]);
    assertOpaquePendingActionId(value.sessionId, 'PendingAction session id');
    assertWorkspaceEditCapability(value.capability);
    assertSha256(value.commandLogHash, 'PendingAction command log hash');
    assertNonNegativeInteger(value.commandCount, 'PendingAction command count');
    if (value.finalization !== 'explicit-tool' && value.finalization !== 'runtime-fallback') {
      invalidSchema('PendingAction finalization is invalid.');
    }
    return deepFreeze(structuredClone(value)) as unknown as PendingActionSource;
  }
  if (value.kind === 'deterministic-builder') {
    assertExactFields(value, ['kind', 'producer', 'capability']);
    assertOpaquePendingActionId(value.producer, 'PendingAction producer');
    assertWorkspaceEditCapability(value.capability);
    return deepFreeze(structuredClone(value)) as unknown as PendingActionSource;
  }
  invalidSchema('PendingAction source kind is invalid.');
}

export function parsePendingActionOrigin(value: unknown): PendingActionOrigin {
  if (!isRecord(value)) invalidSchema('PendingAction origin must be an object.');
  if (value.kind === 'chapterSettlement') {
    assertExactFields(value, ['kind', 'chapterId', 'sourceHash']);
    if (typeof value.chapterId !== 'string' || !/^(?!0000)\d{4}\/(?!0000)\d{4}$/u.test(value.chapterId)) {
      invalidSchema('Settlement chapter id must be a canonical volume/chapter id.');
    }
    assertSha256(value.sourceHash, 'Origin chapter source hash');
  } else if (value.kind === 'agentTurn') {
    assertExactFields(value, ['kind', 'sessionId', 'turnId']);
    assertOpaquePendingActionId(value.sessionId, 'Origin session id');
    assertOpaquePendingActionId(value.turnId, 'Origin turn id');
  } else if (value.kind === 'referenceDeconstructionPublish') {
    assertExactFields(value, [
      'kind',
      'referenceId',
      'runId',
      'runRevision',
      'candidateFingerprint',
    ]);
    assertOpaquePendingActionId(value.referenceId, 'Origin reference id');
    assertOpaquePendingActionId(value.runId, 'Origin run id');
    assertNonNegativeInteger(value.runRevision, 'Origin run revision');
    assertSha256(value.candidateFingerprint, 'Origin candidate fingerprint');
  } else if (value.kind === 'referenceMaterialAdoption') {
    assertExactFields(value, [
      'kind',
      'referenceId',
      'manifestRevision',
      'sourceChecksumSha256',
      'contextFingerprint',
      'previewFingerprint',
    ]);
    assertOpaquePendingActionId(value.referenceId, 'Origin reference id');
    assertNonNegativeInteger(value.manifestRevision, 'Origin manifest revision');
    assertSha256(value.sourceChecksumSha256, 'Origin source checksum');
    assertSha256(value.contextFingerprint, 'Origin context fingerprint');
    assertSha256(value.previewFingerprint, 'Origin preview fingerprint');
  } else if (value.kind === 'playAdoption') {
    assertExactFields(value, [
      'kind',
      'sessionId',
      'branchId',
      'sourceRevision',
      'previewFingerprint',
    ]);
    assertOpaquePendingActionId(value.sessionId, 'Origin session id');
    assertOpaquePendingActionId(value.branchId, 'Origin branch id');
    assertNonNegativeInteger(value.sourceRevision, 'Origin source revision');
    assertSha256(value.previewFingerprint, 'Origin preview fingerprint');
  } else {
    invalidSchema('PendingAction origin kind is invalid.');
  }
  return deepFreeze(structuredClone(value)) as unknown as PendingActionOrigin;
}

export function parseRepositoryBaseline(value: unknown): RepositoryBaseline {
  if (!isRecord(value)) invalidSchema('Repository baseline must be an object.');
  assertExactFields(value, ['repositoryId', 'branch', 'head']);
  assertNonEmptyText(value.repositoryId, 'Repository id');
  assertNonEmptyText(value.branch, 'Repository branch');
  assertNonEmptyText(value.head, 'Repository HEAD');
  return deepFreeze(structuredClone(value)) as unknown as RepositoryBaseline;
}

export function assertOpaquePendingActionId(value: unknown, label = 'Opaque id'): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value === '.'
    || value === '..'
    || value.includes('..')
  ) {
    throw new PendingActionProtocolError(
      'INVALID_PENDING_ACTION_SCHEMA',
      `${label} is invalid.`,
    );
  }
  return value;
}

export function assertCanonicalTargetPath(value: unknown): string {
  if (typeof value !== 'string') invalidSchema('PendingAction target path must be a string.');
  let path: string;
  try {
    path = normalizeWorkspaceRelativePath(value);
  } catch (error) {
    throw new PendingActionProtocolError(
      'INVALID_PENDING_ACTION_SCHEMA',
      error instanceof Error ? error.message : 'PendingAction target path is invalid.',
    );
  }
  if (path.split('/').some((segment) => segment.startsWith('.'))) {
    invalidSchema(`PendingAction target path is hidden or internal: ${path}`);
  }
  return path;
}

export function assertSha256(value: unknown, label = 'SHA-256'): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    invalidSchema(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

export function assertCanonicalIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    invalidSchema(`${label} must be an ISO timestamp.`);
  }
  const normalized = new Date(value).toISOString();
  if (normalized !== value) invalidSchema(`${label} must be a canonical ISO timestamp.`);
  return value;
}

export function parseAllowedTargets(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalidSchema('Prepared preview allowedTargets must be a non-empty array.');
  }
  const targets = value.map(assertCanonicalTargetPath);
  if (new Set(targets).size !== targets.length) {
    invalidSchema('Prepared preview allowedTargets contains duplicates.');
  }
  const sorted = [...targets].sort(comparePaths);
  if (targets.some((target, index) => target !== sorted[index])) {
    invalidSchema('Prepared preview allowedTargets must be stably sorted.');
  }
  return targets;
}

export function stableProtocolSerialize(value: unknown): string {
  return JSON.stringify(toStableValue(value, new Set<object>()));
}

function parsePendingFileChanges(
  value: unknown[],
  artifactPrefix: string,
): PendingFileChange[] {
  const changes = value.map((entry, index) => parsePendingFileChange(
    entry,
    `${artifactPrefix}/${index}.txt`,
  ));
  const paths = changes.map((change) => change.path);
  if (new Set(paths).size !== paths.length) {
    invalidSchema('PendingAction changes contain duplicate paths.');
  }
  const sorted = [...paths].sort(comparePaths);
  if (paths.some((path, index) => path !== sorted[index])) {
    invalidSchema('PendingAction changes must be stably sorted by path.');
  }
  return changes;
}

function parsePendingFileChange(value: unknown, artifactPath: string): PendingFileChange {
  if (!isRecord(value)) invalidSchema('PendingAction change must be an object.');
  assertExactFields(value, ['operation', 'path', 'baseline', 'draft']);
  assertCanonicalTargetPath(value.path);
  if (value.operation === 'create') {
    parseMissingBaseline(value.baseline);
    parseDraftArtifact(value.draft, artifactPath);
  } else if (value.operation === 'update') {
    parseExistingContent(value.baseline);
    parseDraftArtifact(value.draft, artifactPath);
  } else if (value.operation === 'delete') {
    parseExistingContent(value.baseline);
    if (value.draft !== null) invalidSchema('Delete changes must not have a draft artifact.');
  } else {
    invalidSchema('PendingAction change operation is invalid.');
  }
  return deepFreeze(structuredClone(value)) as unknown as PendingFileChange;
}

function parseMissingBaseline(value: unknown): void {
  if (!isRecord(value)) invalidSchema('Create baseline must be an object.');
  assertExactFields(value, ['exists']);
  if (value.exists !== false) invalidSchema('Create baseline must declare exists: false.');
}

function parseExistingContent(value: unknown): ExistingContent {
  if (!isRecord(value)) invalidSchema('Existing baseline must be an object.');
  assertExactFields(value, ['exists', 'sha256', 'byteLength', 'mode']);
  if (value.exists !== true) invalidSchema('Existing baseline must declare exists: true.');
  assertSha256(value.sha256, 'Baseline hash');
  assertNonNegativeInteger(value.byteLength, 'Baseline byteLength');
  if (
    !Number.isSafeInteger(value.mode)
    || (value.mode as number) < 0
    || (value.mode as number) > 0o777
  ) {
    invalidSchema('Baseline mode is invalid.');
  }
  return deepFreeze(structuredClone(value)) as unknown as ExistingContent;
}

function parseDraftArtifact(value: unknown, expectedRelativePath: string): DraftArtifact {
  if (!isRecord(value)) invalidSchema('Draft artifact must be an object.');
  assertExactFields(value, ['relativePath', 'sha256', 'byteLength']);
  if (value.relativePath !== expectedRelativePath) {
    invalidSchema(`Draft artifact path must be ${expectedRelativePath}.`);
  }
  assertSha256(value.sha256, 'Draft artifact hash');
  assertNonNegativeInteger(value.byteLength, 'Draft artifact byteLength');
  return deepFreeze(structuredClone(value)) as unknown as DraftArtifact;
}

function parsePreview(value: unknown, label: string): void {
  if (!isRecord(value)) invalidSchema(`${label} must be an object.`);
  assertExactFields(value, ['diff', 'diffHash']);
  if (typeof value.diff !== 'string' || value.diff.includes('\0')) {
    invalidSchema(`${label} diff must be text without NUL.`);
  }
  assertSha256(value.diffHash, `${label} hash`);
  if (sha256Text(value.diff) !== value.diffHash) {
    invalidSchema(`${label} hash does not match its diff.`);
  }
}

function assertSupportedEnvelope(
  value: unknown,
  expectedKind:
    | 'pending-action'
    | 'prepared-change-preview'
    | 'pending-action-terminal'
    | 'prepared-change-preview-promotion',
): asserts value is Record<string, unknown> {
  if (
    !isRecord(value)
    || Object.hasOwn(value, 'patches')
    || Object.hasOwn(value, 'shadowWrites')
    || !Object.hasOwn(value, 'schemaVersion')
    || value.schemaVersion !== 1
    || !Object.hasOwn(value, 'kind')
    || value.kind !== expectedKind
  ) {
    throw new PendingActionProtocolError(
      UNSUPPORTED_PENDING_ACTION_SCHEMA,
      `Unsupported ${expectedKind} schema. Internal development state must be reset.`,
    );
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
    invalidSchema('Stored protocol object has missing or additional fields.');
  }
}

function assertWorkspaceEditCapability(value: unknown): WorkspaceEditCapability {
  if (!CAPABILITIES.includes(value as WorkspaceEditCapability)) {
    invalidSchema(`Workspace edit capability is invalid: ${String(value)}`);
  }
  return value as WorkspaceEditCapability;
}

function assertNonEmptyText(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.includes('\0')
    || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    invalidSchema(`${label} is invalid.`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalidSchema(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidSchema(message: string): never {
  throw new PendingActionProtocolError('INVALID_PENDING_ACTION_SCHEMA', message);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function toStableValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidSchema('Protocol values must contain finite numbers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') invalidSchema('Protocol values must be JSON-compatible.');
  if (ancestors.has(value)) invalidSchema('Protocol values cannot contain cycles.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => toStableValue(item, ancestors));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalidSchema('Protocol values must contain plain objects.');
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, toStableValue(record[key], ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}
