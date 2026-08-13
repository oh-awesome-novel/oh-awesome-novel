import {
  PendingActionProtocolError,
  UNSUPPORTED_PENDING_ACTION_SCHEMA,
  parsePendingAction,
  parsePendingActionDecisionReceipt,
  parsePendingActionOrigin,
  parsePreparedChangePreview,
} from '@oh-awesome-novel/tools';
import type {
  ChangeMaterializer,
  PendingActionDecisionReceipt,
  PendingActionGitResult,
  PendingActionRecord,
  PendingActionStore,
  PendingActionView,
  PreparedChangePreviewV1,
} from '@oh-awesome-novel/tools';

/** Stable HTTP error contract for disposable pre-change-engine state. */
export const PENDING_ACTION_RESET_REQUIRED_CODE =
  UNSUPPORTED_PENDING_ACTION_SCHEMA;

export class PendingActionResetRequiredError extends Error {
  override readonly name = 'PendingActionResetRequiredError';
  readonly code = PENDING_ACTION_RESET_REQUIRED_CODE;
  readonly status = 409;

  constructor(message = (
    'Unsupported PendingAction state. Internal development state must be reset.'
  )) {
    super(message);
  }
}

export interface PendingActionViewSource {
  readonly record: PendingActionRecord;
  readonly receipt?: PendingActionDecisionReceipt;
}

export interface PendingActionViewListEnvelope {
  readonly pendingActions: PendingActionView[];
}

export interface PendingActionViewEnvelope {
  readonly pendingAction: PendingActionView;
}

export interface PendingActionDecisionViewEnvelope {
  readonly pendingAction: PendingActionView;
  readonly receipt: PendingActionDecisionReceipt;
  readonly appliedFiles?: string[];
  readonly refresh?: unknown;
  readonly referencePublish?: unknown;
}

/** Public response for an action-scoped Git retry after Accept. */
export interface PendingActionQuickCommitViewEnvelope {
  readonly pendingAction: PendingActionView;
  readonly receipt: PendingActionDecisionReceipt;
}

export interface PendingActionViewErrorResponse {
  readonly status: 404 | 409 | 422 | 500;
  readonly body: {
    readonly error: string;
    readonly code: string;
    readonly resetRequired?: true;
  };
}

export interface PendingActionViewHandlers {
  list(): Promise<PendingActionViewListEnvelope>;
  read(id: string): Promise<PendingActionViewEnvelope>;
  accept(
    id: string,
    options?: { autoCommitOnAccept?: boolean },
  ): Promise<PendingActionDecisionViewEnvelope>;
  reject(id: string): Promise<PendingActionDecisionViewEnvelope>;
  quickCommit(id: string): Promise<PendingActionQuickCommitViewEnvelope>;
}

export interface PreparedChangePreviewPublicSummary {
  readonly changes: PendingActionView['changes'];
  readonly diff: string;
}

/**
 * The sole projection from a stored prepared preview to fields that may cross
 * the HTTP boundary. Draft descriptors remain private to the change engine.
 */
export function serializePreparedChangePreviewSummary(
  value: PreparedChangePreviewV1,
): PreparedChangePreviewPublicSummary {
  try {
    const preview = parsePreparedChangePreview(value);
    const changes = preview.changes.map((change) => parsePublicChange({
      operation: change.operation,
      path: change.path,
      ...(change.baseline.exists ? { oldHash: change.baseline.sha256 } : {}),
      ...(change.draft === null ? {} : { newHash: change.draft.sha256 }),
    }));
    const sortedPaths = changes.map((change) => change.path).sort(compareText);
    if (changes.some((change, index) => change.path !== sortedPaths[index])) {
      invalidPublicView('Prepared preview changes must be sorted by path.');
    }
    if (typeof preview.preview.diff !== 'string' || preview.preview.diff.includes('\0')) {
      invalidPublicView('Prepared preview diff must be plain text.');
    }
    return deepFreeze({ changes, diff: preview.preview.diff });
  } catch (error) {
    throw toPendingActionPublicError(error);
  }
}

/**
 * Additive Task 8 service seam. Task 9 may bind these methods to the existing
 * HTTP routes without putting storage records or draft paths in route code.
 */
export function createPendingActionViewHandlers(input: {
  store: PendingActionStore;
  materializer: ChangeMaterializer;
}): PendingActionViewHandlers {
  async function readSource(id: string): Promise<PendingActionViewSource> {
    const record = await input.store.readRecord(id);
    const receipt = record.status === 'pending'
      ? undefined
      : await input.store.readDecisionReceipt(id);
    return { record, ...(receipt === undefined ? {} : { receipt }) };
  }

  return {
    async list() {
      const records = await input.store.listRecords({ status: 'pending' });
      const sources = await Promise.all(records.map(async (record) => {
        const receipt = record.status === 'pending'
          ? undefined
          : await input.store.readDecisionReceipt(record.action.id);
        return { record, ...(receipt === undefined ? {} : { receipt }) };
      }));
      return serializePendingActionViewList(sources);
    },
    async read(id) {
      return { pendingAction: serializePendingActionView(await readSource(id)) };
    },
    async accept(id, options = {}) {
      const accepted = await input.materializer.accept({
        actionId: id,
        ...(options.autoCommitOnAccept === undefined
          ? {}
          : { autoCommitOnAccept: options.autoCommitOnAccept }),
      });
      const pendingAction = serializePendingActionView(await readSource(id));
      return parsePendingActionDecisionViewEnvelope({
        pendingAction,
        receipt: accepted.receipt,
        appliedFiles: accepted.appliedFiles,
      });
    },
    async reject(id) {
      const rejected = await input.materializer.reject({ actionId: id });
      const pendingAction = serializePendingActionView(await readSource(id));
      return parsePendingActionDecisionViewEnvelope({
        pendingAction,
        receipt: rejected.receipt,
      });
    },
    async quickCommit(id) {
      const receipt = await input.materializer.quickCommit(id);
      const pendingAction = serializePendingActionView(await readSource(id));
      const envelope = parsePendingActionDecisionViewEnvelope({
        pendingAction,
        receipt,
      });
      if (
        envelope.pendingAction.status !== 'accepted'
        || envelope.receipt.decision !== 'accepted'
      ) {
        invalidPublicView('Quick commit requires an accepted PendingAction.');
      }
      return {
        pendingAction: envelope.pendingAction,
        receipt: envelope.receipt,
      };
    },
  };
}

/**
 * The sole backend mapping from durable protocol records to the public DTO.
 * It deliberately never serializes a DraftArtifact or any internal path.
 */
export function serializePendingActionView(
  input: PendingActionViewSource,
): PendingActionView {
  try {
    const record = parsePendingActionRecord(input.record);
    const receipt = input.receipt === undefined
      ? undefined
      : parsePendingActionDecisionReceipt(input.receipt, record.action.id);
    assertRecordReceiptAgreement(record, receipt);

    const decidedAt = record.status === 'accepted'
      ? record.acceptedAt
      : record.status === 'rejected'
        ? record.rejectedAt
        : undefined;
    const origin = record.action.origin === undefined
      ? undefined
      : parsePendingActionOrigin(record.action.origin);
    const view: PendingActionView = {
      id: record.action.id,
      title: record.action.title,
      description: record.action.description,
      status: record.status,
      createdAt: record.action.createdAt,
      ...(decidedAt === undefined ? {} : { decidedAt }),
      changes: record.action.changes.map((change) => ({
        operation: change.operation,
        path: change.path,
        ...(change.baseline.exists ? { oldHash: change.baseline.sha256 } : {}),
        ...(change.draft === null ? {} : { newHash: change.draft.sha256 }),
      })),
      diff: record.action.preview.diff,
      ...(origin === undefined ? {} : { origin }),
      ...(receipt === undefined ? {} : { git: receipt.git }),
    };
    return parsePendingActionViewDto(view);
  } catch (error) {
    throw toPendingActionPublicError(error);
  }
}

function parsePendingActionRecord(value: unknown): PendingActionRecord {
  if (!isRecord(value)) invalidPublicView('PendingAction record must be an object.');
  rejectLegacyOrInternalFields(value);
  if (value.status === 'pending') {
    assertExactFields(value, ['action', 'status']);
    return { action: parsePendingAction(value.action), status: 'pending' };
  }
  if (value.status === 'accepted') {
    assertExactFields(value, [
      'action', 'status', 'acceptedAt', 'decisionReceiptId',
    ]);
    return {
      action: parsePendingAction(value.action),
      status: 'accepted',
      acceptedAt: assertIsoTimestamp(value.acceptedAt, 'PendingAction acceptedAt'),
      decisionReceiptId: assertOpaqueId(
        value.decisionReceiptId,
        'PendingAction decision receipt id',
      ),
    };
  }
  if (value.status === 'rejected') {
    assertExactFields(value, [
      'action', 'status', 'rejectedAt', 'decisionReceiptId',
    ]);
    return {
      action: parsePendingAction(value.action),
      status: 'rejected',
      rejectedAt: assertIsoTimestamp(value.rejectedAt, 'PendingAction rejectedAt'),
      decisionReceiptId: assertOpaqueId(
        value.decisionReceiptId,
        'PendingAction decision receipt id',
      ),
    };
  }
  invalidPublicView('PendingAction record status is invalid.');
}

/** Strictly validates the final JSON-safe public shape before it leaves HTTP. */
export function parsePendingActionViewDto(value: unknown): PendingActionView {
  if (!isRecord(value)) invalidPublicView('PendingActionView must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, [
    'id',
    'title',
    'description',
    'status',
    'createdAt',
    'changes',
    'diff',
  ], ['decidedAt', 'origin', 'git']);
  assertOpaqueId(value.id, 'PendingActionView id');
  assertSafeText(value.title, 'PendingActionView title', false);
  assertSafeText(value.description, 'PendingActionView description', false);
  if (value.status !== 'pending' && value.status !== 'accepted' && value.status !== 'rejected') {
    invalidPublicView('PendingActionView status is invalid.');
  }
  assertIsoTimestamp(value.createdAt, 'PendingActionView createdAt');
  if (value.status === 'pending') {
    if (Object.hasOwn(value, 'decidedAt') || Object.hasOwn(value, 'git')) {
      invalidPublicView('A pending PendingActionView cannot contain decision fields.');
    }
  } else {
    if (!Object.hasOwn(value, 'decidedAt')) {
      invalidPublicView('A terminal PendingActionView requires decidedAt.');
    }
    assertIsoTimestamp(value.decidedAt, 'PendingActionView decidedAt');
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    invalidPublicView('PendingActionView changes must be a non-empty array.');
  }
  const changes = value.changes.map(parsePublicChange);
  if (new Set(changes.map((change) => change.path)).size !== changes.length) {
    invalidPublicView('PendingActionView changes contain duplicate paths.');
  }
  const sortedPaths = changes.map((change) => change.path).sort(compareText);
  if (changes.some((change, index) => change.path !== sortedPaths[index])) {
    invalidPublicView('PendingActionView changes must be sorted by path.');
  }
  if (typeof value.diff !== 'string' || value.diff.includes('\0')) {
    invalidPublicView('PendingActionView diff must be plain text.');
  }
  const origin = Object.hasOwn(value, 'origin')
    ? parsePendingActionOrigin(value.origin)
    : undefined;
  const git = Object.hasOwn(value, 'git')
    ? parsePublicGitResult(value.git)
    : undefined;
  const normalized: PendingActionView = {
    id: value.id as string,
    title: value.title as string,
    description: value.description as string,
    status: value.status,
    createdAt: value.createdAt as string,
    ...(Object.hasOwn(value, 'decidedAt')
      ? { decidedAt: value.decidedAt as string }
      : {}),
    changes,
    diff: value.diff,
    ...(origin === undefined ? {} : { origin }),
    ...(git === undefined ? {} : { git }),
  };
  return deepFreeze(normalized);
}

export function serializePendingActionViewList(
  sources: readonly PendingActionViewSource[],
): PendingActionViewListEnvelope {
  return {
    pendingActions: sources.map(serializePendingActionView),
  };
}

export function parsePendingActionDecisionViewEnvelope(
  value: unknown,
): PendingActionDecisionViewEnvelope {
  if (!isRecord(value)) invalidPublicView('PendingAction decision response must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, ['pendingAction', 'receipt'], [
    'appliedFiles',
    'refresh',
    'referencePublish',
  ]);
  const pendingAction = parsePendingActionViewDto(value.pendingAction);
  const receipt = parsePendingActionDecisionReceipt(value.receipt, pendingAction.id);
  if (
    pendingAction.status !== receipt.decision
    || pendingAction.decidedAt !== receipt.decidedAt
    || JSON.stringify(pendingAction.git) !== JSON.stringify(receipt.git)
  ) {
    invalidPublicView('PendingAction decision response is inconsistent.');
  }
  let appliedFiles: string[] | undefined;
  if (Object.hasOwn(value, 'appliedFiles')) {
    if (
      receipt.decision !== 'accepted'
      || !Array.isArray(value.appliedFiles)
      || value.appliedFiles.some((path) => typeof path !== 'string')
    ) {
      invalidPublicView('PendingAction appliedFiles is invalid.');
    }
    appliedFiles = value.appliedFiles as string[];
    const expected = pendingAction.changes.map((change) => change.path);
    if (JSON.stringify(appliedFiles) !== JSON.stringify(expected)) {
      invalidPublicView('PendingAction appliedFiles is inconsistent with changes.');
    }
  }
  return deepFreeze({
    pendingAction,
    receipt,
    ...(appliedFiles === undefined ? {} : { appliedFiles: [...appliedFiles] }),
    ...(Object.hasOwn(value, 'refresh')
      ? { refresh: structuredClone(value.refresh) }
      : {}),
    ...(Object.hasOwn(value, 'referencePublish')
      ? { referencePublish: structuredClone(value.referencePublish) }
      : {}),
  });
}

export function toPendingActionPublicError(error: unknown): Error {
  if (
    (error instanceof PendingActionProtocolError
      && error.code === UNSUPPORTED_PENDING_ACTION_SCHEMA)
    || (isRecord(error) && error.code === UNSUPPORTED_PENDING_ACTION_SCHEMA)
  ) {
    return new PendingActionResetRequiredError();
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function toPendingActionViewErrorResponse(
  error: unknown,
): PendingActionViewErrorResponse {
  const publicError = toPendingActionPublicError(error);
  if (publicError instanceof PendingActionResetRequiredError) {
    return {
      status: 409,
      body: {
        error: publicError.message,
        code: publicError.code,
        resetRequired: true,
      },
    };
  }
  const code = isRecord(publicError) && typeof publicError.code === 'string'
    ? publicError.code
    : 'PENDING_ACTION_OPERATION_FAILED';
  const status = code === 'PENDING_ACTION_NOT_FOUND'
    ? 404
    : code === 'stalePreview'
      || code === 'PENDING_ACTION_ORIGIN_VALIDATOR_REQUIRED'
      || /(?:CONFLICT|STALE|MISMATCH|NOT_ACCEPTED)/u.test(code)
      ? 409
      : code === 'INVALID_PENDING_ACTION_SCHEMA'
        || code === 'PENDING_ACTION_DRAFT_INTEGRITY_ERROR'
        || code === 'PENDING_ACTION_CORRUPT'
        ? 422
        : 500;
  return {
    status,
    body: { error: publicError.message, code },
  };
}

function assertRecordReceiptAgreement(
  record: PendingActionRecord,
  receipt: PendingActionDecisionReceipt | undefined,
): void {
  if (record.status === 'pending') {
    if (receipt !== undefined) invalidPublicView('Pending PendingAction has a decision receipt.');
    return;
  }
  if (
    receipt === undefined
    || receipt.id !== record.decisionReceiptId
    || receipt.decision !== record.status
    || receipt.decidedAt !== (record.status === 'accepted'
      ? record.acceptedAt
      : record.rejectedAt)
  ) {
    invalidPublicView('PendingAction terminal and receipt are inconsistent.');
  }
}

function parsePublicChange(value: unknown): PendingActionView['changes'][number] {
  if (!isRecord(value)) invalidPublicView('PendingActionView change must be an object.');
  rejectLegacyOrInternalFields(value);
  assertExactFields(value, ['operation', 'path'], ['oldHash', 'newHash']);
  if (value.operation !== 'create' && value.operation !== 'update' && value.operation !== 'delete') {
    invalidPublicView('PendingActionView change operation is invalid.');
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
    invalidPublicView('PendingActionView change hashes do not match its operation.');
  }
  return deepFreeze({
    operation: value.operation,
    path,
    ...(oldHash === undefined ? {} : { oldHash }),
    ...(newHash === undefined ? {} : { newHash }),
  });
}

function parsePublicGitResult(value: unknown): PendingActionGitResult {
  if (!isRecord(value)) invalidPublicView('PendingActionView git must be an object.');
  if (value.status === 'not-requested') {
    assertExactFields(value, ['status']);
  } else if (value.status === 'committed') {
    assertExactFields(value, ['status', 'commit', 'branch']);
    assertSafeText(value.commit, 'Git commit');
    assertSafeText(value.branch, 'Git branch');
  } else if (value.status === 'staged-not-committed') {
    assertExactFields(value, ['status', 'branch', 'errorCode']);
    assertSafeText(value.branch, 'Git branch');
    assertErrorCode(value.errorCode);
  } else if (value.status === 'failed') {
    assertExactFields(value, ['status', 'errorCode']);
    assertErrorCode(value.errorCode);
  } else {
    invalidPublicView('PendingActionView git status is invalid.');
  }
  return deepFreeze(structuredClone(value)) as PendingActionGitResult;
}

function rejectLegacyOrInternalFields(value: Record<string, unknown>): void {
  const forbidden = [
    'patches',
    'shadowWrites',
    'touchedFiles',
    'draft',
    'relativePath',
    'artifactPath',
    'artifactPaths',
    'toolName',
  ];
  if (forbidden.some((field) => Object.hasOwn(value, field))) {
    throw new PendingActionResetRequiredError();
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
    invalidPublicView('PendingAction public DTO has missing or additional fields.');
  }
}

function assertOpaqueId(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value.includes('..')
  ) {
    invalidPublicView(`${label} is invalid.`);
  }
  return value;
}

function assertSafeText(value: unknown, label: string, trim = true): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || (trim && value.trim() !== value)
    || value.includes('\0')
    || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    invalidPublicView(`${label} is invalid.`);
  }
  return value;
}

function assertIsoTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    invalidPublicView(`${label} is invalid.`);
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
    invalidPublicView('PendingActionView change path is invalid.');
  }
  return value;
}

function assertHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    invalidPublicView(`PendingActionView ${label} is invalid.`);
  }
  return value;
}

function assertErrorCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    invalidPublicView('PendingActionView Git error code is invalid.');
  }
  return value;
}

function invalidPublicView(message: string): never {
  throw new PendingActionProtocolError('INVALID_PENDING_ACTION_SCHEMA', message);
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
