export const PENDING_ACTION_RESET_REQUIRED_CODE =
  'UNSUPPORTED_PENDING_ACTION_SCHEMA' as const;
export const INVALID_PENDING_ACTION_VIEW_CODE =
  'INVALID_PENDING_ACTION_VIEW' as const;

export type PendingActionViewErrorCode =
  | typeof PENDING_ACTION_RESET_REQUIRED_CODE
  | typeof INVALID_PENDING_ACTION_VIEW_CODE;

export class PendingActionViewParseError extends Error {
  override readonly name = 'PendingActionViewParseError';
  readonly code: PendingActionViewErrorCode;
  readonly resetRequired: boolean;

  constructor(code: PendingActionViewErrorCode, message: string) {
    super(message);
    this.code = code;
    this.resetRequired = code === PENDING_ACTION_RESET_REQUIRED_CODE;
  }
}

export type PublicPendingActionOrigin =
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

export type PublicPendingActionGitResult =
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

export interface PendingActionViewChange {
  readonly operation: 'create' | 'update' | 'delete';
  readonly path: string;
  readonly oldHash?: string;
  readonly newHash?: string;
}

/** Public review DTO. It intentionally has no schema/storage artifact fields. */
export interface PendingActionViewV1 {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'pending' | 'accepted' | 'rejected';
  readonly createdAt: string;
  readonly decidedAt?: string;
  readonly changes: readonly PendingActionViewChange[];
  readonly diff: string;
  readonly origin?: PublicPendingActionOrigin;
  readonly git?: PublicPendingActionGitResult;
}

export type PendingActionView = PendingActionViewV1;

export interface PendingActionDecisionReceiptV1 {
  readonly schemaVersion: 1;
  readonly kind: 'pending-action-decision-receipt';
  readonly id: string;
  readonly actionId: string;
  readonly decision: 'accepted' | 'rejected';
  readonly decidedAt: string;
  readonly materialization: 'not-applicable' | 'committed';
  readonly git: PublicPendingActionGitResult;
}

export interface PendingActionViewListEnvelopeV1 {
  readonly pendingActions: readonly PendingActionViewV1[];
}

export interface PendingActionViewEnvelopeV1 {
  readonly pendingAction: PendingActionViewV1;
}

export interface PendingActionDecisionEnvelopeV1 {
  readonly pendingAction: PendingActionViewV1;
  readonly receipt: PendingActionDecisionReceiptV1;
  readonly appliedFiles?: readonly string[];
  readonly refresh?: unknown;
  readonly referencePublish?: unknown;
}

/** Strict response for retrying Git on one already-accepted action. */
export interface PendingActionQuickCommitEnvelopeV1 {
  readonly pendingAction: PendingActionViewV1;
  readonly receipt: PendingActionDecisionReceiptV1;
  readonly refresh?: unknown;
}

export function parsePendingActionView(value: unknown): PendingActionViewV1 {
  if (!isRecord(value)) invalid('PendingActionView must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, [
    'id', 'title', 'description', 'status', 'createdAt', 'changes', 'diff',
  ], ['decidedAt', 'origin', 'git']);
  const id = assertOpaqueId(value.id, 'PendingActionView id');
  const title = assertSafeDisplayText(value.title, 'PendingActionView title');
  const description = assertSafeDisplayText(
    value.description,
    'PendingActionView description',
  );
  if (value.status !== 'pending' && value.status !== 'accepted' && value.status !== 'rejected') {
    invalid('PendingActionView status is invalid.');
  }
  const createdAt = assertIsoTimestamp(value.createdAt, 'PendingActionView createdAt');
  let decidedAt: string | undefined;
  if (value.status === 'pending') {
    if (Object.hasOwn(value, 'decidedAt') || Object.hasOwn(value, 'git')) {
      invalid('A pending PendingActionView cannot contain decision fields.');
    }
  } else {
    if (!Object.hasOwn(value, 'decidedAt')) {
      invalid('A terminal PendingActionView requires decidedAt.');
    }
    decidedAt = assertIsoTimestamp(value.decidedAt, 'PendingActionView decidedAt');
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    invalid('PendingActionView changes must be a non-empty array.');
  }
  const changes = value.changes.map(parsePendingActionViewChange);
  if (new Set(changes.map((change) => change.path)).size !== changes.length) {
    invalid('PendingActionView changes contain duplicate paths.');
  }
  const sortedPaths = changes.map((change) => change.path).sort(compareText);
  if (changes.some((change, index) => change.path !== sortedPaths[index])) {
    invalid('PendingActionView changes must be sorted by path.');
  }
  if (typeof value.diff !== 'string' || value.diff.includes('\0')) {
    invalid('PendingActionView diff must be plain text.');
  }
  const origin = Object.hasOwn(value, 'origin')
    ? parsePublicPendingActionOrigin(value.origin)
    : undefined;
  const git = Object.hasOwn(value, 'git')
    ? parsePublicPendingActionGitResult(value.git)
    : undefined;

  return deepFreeze({
    id,
    title,
    description,
    status: value.status,
    createdAt,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    changes,
    diff: value.diff,
    ...(origin === undefined ? {} : { origin }),
    ...(git === undefined ? {} : { git }),
  });
}

export const parsePendingActionViewV1 = parsePendingActionView;

export function parsePendingActionDecisionReceiptV1(
  value: unknown,
  expectedActionId?: string,
): PendingActionDecisionReceiptV1 {
  assertSupportedReceiptEnvelope(value);
  assertExactFields(value, [
    'schemaVersion',
    'kind',
    'id',
    'actionId',
    'decision',
    'decidedAt',
    'materialization',
    'git',
  ]);
  const id = assertOpaqueId(value.id, 'Decision receipt id');
  const actionId = assertOpaqueId(value.actionId, 'Decision receipt action id');
  if (expectedActionId !== undefined && actionId !== assertOpaqueId(expectedActionId)) {
    invalid('Decision receipt action id does not match the request.');
  }
  if (value.decision !== 'accepted' && value.decision !== 'rejected') {
    invalid('Decision receipt decision is invalid.');
  }
  const decidedAt = assertIsoTimestamp(value.decidedAt, 'Decision receipt decidedAt');
  if (value.materialization !== 'not-applicable' && value.materialization !== 'committed') {
    invalid('Decision receipt materialization is invalid.');
  }
  const git = parsePublicPendingActionGitResult(value.git);
  if (
    value.decision === 'rejected'
    && (value.materialization !== 'not-applicable' || git.status !== 'not-requested')
  ) {
    invalid('A rejected decision cannot materialize files or request Git.');
  }
  if (value.decision === 'accepted' && value.materialization !== 'committed') {
    invalid('An accepted decision requires committed materialization.');
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: 'pending-action-decision-receipt',
    id,
    actionId,
    decision: value.decision,
    decidedAt,
    materialization: value.materialization,
    git,
  });
}

export function parsePendingActionViewListEnvelope(
  value: unknown,
): PendingActionViewListEnvelopeV1 {
  if (!isRecord(value)) invalid('PendingAction list response must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, ['pendingActions']);
  if (!Array.isArray(value.pendingActions)) {
    invalid('PendingAction list response is invalid.');
  }
  const pendingActions = value.pendingActions.map(parsePendingActionView);
  if (new Set(pendingActions.map((action) => action.id)).size !== pendingActions.length) {
    invalid('PendingAction list response contains duplicate ids.');
  }
  return deepFreeze({ pendingActions });
}

export function parsePendingActionViewEnvelope(
  value: unknown,
): PendingActionViewEnvelopeV1 {
  if (!isRecord(value)) invalid('PendingAction read response must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, ['pendingAction']);
  return deepFreeze({ pendingAction: parsePendingActionView(value.pendingAction) });
}

export function parsePendingActionDecisionEnvelope(
  value: unknown,
): PendingActionDecisionEnvelopeV1 {
  if (!isRecord(value)) invalid('PendingAction decision response must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, ['pendingAction', 'receipt'], [
    'appliedFiles',
    'refresh',
    'referencePublish',
  ]);
  const pendingAction = parsePendingActionView(value.pendingAction);
  const receipt = parsePendingActionDecisionReceiptV1(
    value.receipt,
    pendingAction.id,
  );
  if (
    pendingAction.status !== receipt.decision
    || pendingAction.decidedAt !== receipt.decidedAt
    || JSON.stringify(pendingAction.git) !== JSON.stringify(receipt.git)
  ) {
    invalid('PendingAction decision response is inconsistent.');
  }
  let appliedFiles: string[] | undefined;
  if (Object.hasOwn(value, 'appliedFiles')) {
    if (
      receipt.decision !== 'accepted'
      || !Array.isArray(value.appliedFiles)
    ) {
      invalid('PendingAction appliedFiles is invalid.');
    }
    appliedFiles = value.appliedFiles.map(assertPublicPath);
    if (
      JSON.stringify(appliedFiles)
      !== JSON.stringify(pendingAction.changes.map((change) => change.path))
    ) {
      invalid('PendingAction appliedFiles is inconsistent with changes.');
    }
  }
  return deepFreeze({
    pendingAction,
    receipt,
    ...(appliedFiles === undefined ? {} : { appliedFiles }),
    ...(Object.hasOwn(value, 'refresh')
      ? { refresh: structuredClone(value.refresh) }
      : {}),
    ...(Object.hasOwn(value, 'referencePublish')
      ? { referencePublish: structuredClone(value.referencePublish) }
      : {}),
  });
}

export function parsePendingActionQuickCommitEnvelope(
  value: unknown,
): PendingActionQuickCommitEnvelopeV1 {
  if (!isRecord(value)) invalid('PendingAction quick commit response must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, ['pendingAction', 'receipt'], ['refresh']);
  const parsed = parsePendingActionDecisionEnvelope(value);
  if (
    parsed.pendingAction.status !== 'accepted'
    || parsed.receipt.decision !== 'accepted'
  ) {
    invalid('PendingAction quick commit requires an accepted action.');
  }
  return deepFreeze({
    pendingAction: parsed.pendingAction,
    receipt: parsed.receipt,
    ...(Object.hasOwn(parsed, 'refresh')
      ? { refresh: structuredClone(parsed.refresh) }
      : {}),
  });
}

export interface PendingActionViewRequestJson {
  <T>(
    path: string,
    options?: { method?: 'GET' | 'POST' },
  ): Promise<T>;
}

export interface PendingActionViewApi {
  listPendingActionViews(): Promise<PendingActionViewListEnvelopeV1>;
  readPendingActionView(id: string): Promise<PendingActionViewEnvelopeV1>;
  acceptPendingActionV1(id: string): Promise<PendingActionDecisionEnvelopeV1>;
  rejectPendingActionV1(id: string): Promise<PendingActionDecisionEnvelopeV1>;
  quickCommitPendingActionV1(id: string): Promise<PendingActionQuickCommitEnvelopeV1>;
}

/** Additive client seam; Task 9 wires it into the default OanClient. */
export function createPendingActionViewApi(
  requestJson: PendingActionViewRequestJson,
): PendingActionViewApi {
  return {
    listPendingActionViews: () => requestJson<unknown>(
      '/api/workspace/pending-actions',
    ).then(parsePendingActionViewListEnvelope),
    readPendingActionView: (id) => requestJson<unknown>(
      `/api/workspace/pending-actions/${encodeURIComponent(assertOpaqueId(id))}`,
    ).then(parsePendingActionViewEnvelope),
    acceptPendingActionV1: (id) => requestJson<unknown>(
      `/api/workspace/pending-actions/${encodeURIComponent(assertOpaqueId(id))}/accept`,
      { method: 'POST' },
    ).then(parsePendingActionDecisionEnvelope),
    rejectPendingActionV1: (id) => requestJson<unknown>(
      `/api/workspace/pending-actions/${encodeURIComponent(assertOpaqueId(id))}/reject`,
      { method: 'POST' },
    ).then(parsePendingActionDecisionEnvelope),
    quickCommitPendingActionV1: (id) => requestJson<unknown>(
      `/api/workspace/pending-actions/${encodeURIComponent(assertOpaqueId(id))}/quick-commit`,
      { method: 'POST' },
    ).then(parsePendingActionQuickCommitEnvelope),
  };
}

function parsePendingActionViewChange(value: unknown): PendingActionViewChange {
  if (!isRecord(value)) invalid('PendingActionView change must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, ['operation', 'path'], ['oldHash', 'newHash']);
  if (value.operation !== 'create' && value.operation !== 'update' && value.operation !== 'delete') {
    invalid('PendingActionView change operation is invalid.');
  }
  const path = assertPublicPath(value.path);
  const oldHash = Object.hasOwn(value, 'oldHash')
    ? assertHash(value.oldHash, 'oldHash')
    : undefined;
  const newHash = Object.hasOwn(value, 'newHash')
    ? assertHash(value.newHash, 'newHash')
    : undefined;
  if (
    (value.operation === 'create' && (oldHash !== undefined || newHash === undefined))
    || (value.operation === 'update' && (oldHash === undefined || newHash === undefined))
    || (value.operation === 'delete' && (oldHash === undefined || newHash !== undefined))
  ) {
    invalid('PendingActionView change hashes do not match its operation.');
  }
  return deepFreeze({
    operation: value.operation,
    path,
    ...(oldHash === undefined ? {} : { oldHash }),
    ...(newHash === undefined ? {} : { newHash }),
  });
}

function parsePublicPendingActionOrigin(value: unknown): PublicPendingActionOrigin {
  if (!isRecord(value)) invalid('PendingActionView origin must be an object.');
  rejectLegacyOrInternalFields(value);
  if (value.kind === 'chapterSettlement') {
    assertExactFields(value, ['kind', 'chapterId', 'sourceHash']);
    if (typeof value.chapterId !== 'string' || !/^(?!0000)\d{4}\/(?!0000)\d{4}$/u.test(value.chapterId)) {
      invalid('Settlement chapter id must be a canonical volume/chapter id.');
    }
    return deepFreeze({ kind: value.kind, chapterId: value.chapterId,
      sourceHash: assertHash(value.sourceHash, 'origin chapter source hash') });
  }
  if (value.kind === 'agentTurn') {
    assertExactFields(value, ['kind', 'sessionId', 'turnId']);
    return deepFreeze({
      kind: value.kind,
      sessionId: assertOpaqueId(value.sessionId, 'Origin session id'),
      turnId: assertOpaqueId(value.turnId, 'Origin turn id'),
    });
  }
  if (value.kind === 'referenceDeconstructionPublish') {
    assertExactFields(value, [
      'kind', 'referenceId', 'runId', 'runRevision', 'candidateFingerprint',
    ]);
    return deepFreeze({
      kind: value.kind,
      referenceId: assertOpaqueId(value.referenceId, 'Origin reference id'),
      runId: assertOpaqueId(value.runId, 'Origin run id'),
      runRevision: assertNonNegativeInteger(value.runRevision, 'Origin run revision'),
      candidateFingerprint: assertHash(
        value.candidateFingerprint,
        'origin candidate fingerprint',
      ),
    });
  }
  if (value.kind === 'referenceMaterialAdoption') {
    assertExactFields(value, [
      'kind',
      'referenceId',
      'manifestRevision',
      'sourceChecksumSha256',
      'contextFingerprint',
      'previewFingerprint',
    ]);
    return deepFreeze({
      kind: value.kind,
      referenceId: assertOpaqueId(value.referenceId, 'Origin reference id'),
      manifestRevision: assertNonNegativeInteger(
        value.manifestRevision,
        'Origin manifest revision',
      ),
      sourceChecksumSha256: assertHash(
        value.sourceChecksumSha256,
        'origin source checksum',
      ),
      contextFingerprint: assertHash(
        value.contextFingerprint,
        'origin context fingerprint',
      ),
      previewFingerprint: assertHash(
        value.previewFingerprint,
        'origin preview fingerprint',
      ),
    });
  }
  if (value.kind === 'playAdoption') {
    assertExactFields(value, [
      'kind', 'sessionId', 'branchId', 'sourceRevision', 'previewFingerprint',
    ]);
    return deepFreeze({
      kind: value.kind,
      sessionId: assertOpaqueId(value.sessionId, 'Origin session id'),
      branchId: assertOpaqueId(value.branchId, 'Origin branch id'),
      sourceRevision: assertNonNegativeInteger(
        value.sourceRevision,
        'Origin source revision',
      ),
      previewFingerprint: assertHash(
        value.previewFingerprint,
        'origin preview fingerprint',
      ),
    });
  }
  invalid('PendingActionView origin kind is invalid.');
}

function parsePublicPendingActionGitResult(
  value: unknown,
): PublicPendingActionGitResult {
  if (!isRecord(value)) invalid('PendingActionView git must be an object.');
  rejectLegacyOrInternalFields(value);
  if (value.status === 'not-requested') {
    assertExactFields(value, ['status']);
    return deepFreeze({ status: value.status });
  }
  if (value.status === 'committed') {
    assertExactFields(value, ['status', 'commit', 'branch']);
    return deepFreeze({
      status: value.status,
      commit: assertSafeToken(value.commit, 'Git commit'),
      branch: assertSafeToken(value.branch, 'Git branch'),
    });
  }
  if (value.status === 'staged-not-committed') {
    assertExactFields(value, ['status', 'branch', 'errorCode']);
    return deepFreeze({
      status: value.status,
      branch: assertSafeToken(value.branch, 'Git branch'),
      errorCode: assertErrorCode(value.errorCode),
    });
  }
  if (value.status === 'failed') {
    assertExactFields(value, ['status', 'errorCode']);
    return deepFreeze({
      status: value.status,
      errorCode: assertErrorCode(value.errorCode),
    });
  }
  invalid('PendingActionView git status is invalid.');
}

function assertSupportedReceiptEnvelope(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    !isRecord(value)
    || hasLegacyOrInternalField(value)
    || value.schemaVersion !== 1
    || value.kind !== 'pending-action-decision-receipt'
  ) {
    resetRequired();
  }
}

function rejectLegacyOrInternalFields(value: Record<string, unknown>): void {
  if (hasLegacyOrInternalField(value)) resetRequired();
}

function hasLegacyOrInternalField(value: Record<string, unknown>): boolean {
  return [
    'patches',
    'shadowWrites',
    'touchedFiles',
    'draft',
    'relativePath',
    'artifactPath',
    'artifactPaths',
    'toolName',
  ].some((field) => Object.hasOwn(value, field));
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
    invalid('PendingAction DTO has missing or additional fields.');
  }
}

function assertOpaqueId(value: unknown, label = 'Opaque id'): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value.includes('..')
  ) {
    invalid(`${label} is invalid.`);
  }
  return value;
}

function assertSafeDisplayText(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.includes('\0')
    || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    invalid(`${label} is invalid.`);
  }
  return value;
}

function assertSafeToken(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid(`${label} is invalid.`);
  }
  return value;
}

function assertIsoTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    invalid(`${label} is invalid.`);
  }
  return value;
}

function assertPublicPath(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || value.normalize('NFC') !== value
    || value.split('/').some((part) => (
      !part || part === '.' || part === '..' || part.startsWith('.')
    ))
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid('PendingActionView change path is invalid.');
  }
  return value;
}

function assertHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    invalid(`PendingActionView ${label} is invalid.`);
  }
  return value;
}

function assertErrorCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    invalid('PendingActionView Git error code is invalid.');
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${label} is invalid.`);
  }
  return value as number;
}

function resetRequired(): never {
  throw new PendingActionViewParseError(
    PENDING_ACTION_RESET_REQUIRED_CODE,
    'Unsupported PendingAction state. Internal development state must be reset.',
  );
}

function invalid(message: string): never {
  throw new PendingActionViewParseError(INVALID_PENDING_ACTION_VIEW_CODE, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
