import {
  PendingActionProtocolError,
  UNSUPPORTED_PENDING_ACTION_SCHEMA,
  assertCanonicalIsoTimestamp,
  assertOpaquePendingActionId,
} from './pending-action-types';
import type { PendingActionGitResult } from './pending-action-types';

export const PENDING_ACTION_DECISION_RECEIPT_SCHEMA_VERSION = 1 as const;

export interface PendingActionDecisionReceipt {
  readonly schemaVersion: typeof PENDING_ACTION_DECISION_RECEIPT_SCHEMA_VERSION;
  readonly kind: 'pending-action-decision-receipt';
  readonly id: string;
  readonly actionId: string;
  readonly decision: 'accepted' | 'rejected';
  readonly decidedAt: string;
  readonly materialization: 'not-applicable' | 'committed';
  readonly git: PendingActionGitResult;
}

export interface CreatePendingActionDecisionReceiptInput {
  id: string;
  actionId: string;
  decision: 'accepted' | 'rejected';
  decidedAt: string;
  materialization: 'not-applicable' | 'committed';
  git: PendingActionGitResult;
}

export function createPendingActionDecisionReceipt(
  input: CreatePendingActionDecisionReceiptInput,
): PendingActionDecisionReceipt {
  return parsePendingActionDecisionReceipt({
    schemaVersion: PENDING_ACTION_DECISION_RECEIPT_SCHEMA_VERSION,
    kind: 'pending-action-decision-receipt',
    ...structuredClone(input),
  });
}

export function parsePendingActionDecisionReceipt(
  value: unknown,
  expectedActionId?: string,
): PendingActionDecisionReceipt {
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
  assertOpaquePendingActionId(value.id, 'Decision receipt id');
  const actionId = assertOpaquePendingActionId(value.actionId, 'Decision receipt action id');
  if (
    expectedActionId !== undefined
    && actionId !== assertOpaquePendingActionId(expectedActionId)
  ) {
    invalidReceipt(`Decision receipt does not match action ${expectedActionId}.`);
  }
  if (value.decision !== 'accepted' && value.decision !== 'rejected') {
    invalidReceipt('Decision receipt decision is invalid.');
  }
  assertCanonicalIsoTimestamp(value.decidedAt, 'Decision receipt decidedAt');
  if (value.materialization !== 'not-applicable' && value.materialization !== 'committed') {
    invalidReceipt('Decision receipt materialization is invalid.');
  }
  const git = parsePendingActionGitResult(value.git);

  if (value.decision === 'rejected') {
    if (value.materialization !== 'not-applicable' || git.status !== 'not-requested') {
      invalidReceipt('Rejected decisions cannot materialize files or request Git.');
    }
  } else if (value.materialization !== 'committed') {
    invalidReceipt('Accepted decisions require committed materialization.');
  }

  return deepFreeze(structuredClone(value)) as unknown as PendingActionDecisionReceipt;
}

export function parsePendingActionGitResult(value: unknown): PendingActionGitResult {
  if (!isRecord(value)) invalidReceipt('Decision receipt Git result must be an object.');
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
    invalidReceipt('Decision receipt Git status is invalid.');
  }
  return deepFreeze(structuredClone(value)) as unknown as PendingActionGitResult;
}

export function isAllowedDecisionReceiptTransition(
  previous: PendingActionDecisionReceipt,
  next: PendingActionDecisionReceipt,
): boolean {
  const sameIdentity = previous.id === next.id
    && previous.actionId === next.actionId
    && previous.decision === next.decision
    && previous.decidedAt === next.decidedAt
    && previous.materialization === next.materialization;
  if (
    !sameIdentity
  ) {
    return false;
  }
  if (JSON.stringify(previous.git) === JSON.stringify(next.git)) return true;
  if (previous.decision !== 'accepted' || previous.git.status === 'committed') return false;
  // An explicit retry can fail differently (for example add failure followed
  // by a commit hook failure). Preserve decision identity while recording the
  // latest attempt; successful commit identity remains terminal and immutable.
  return next.git.status !== 'not-requested';
}

function assertSupportedReceiptEnvelope(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    !isRecord(value)
    || Object.hasOwn(value, 'patches')
    || Object.hasOwn(value, 'shadowWrites')
    || value.schemaVersion !== PENDING_ACTION_DECISION_RECEIPT_SCHEMA_VERSION
    || value.kind !== 'pending-action-decision-receipt'
  ) {
    throw new PendingActionProtocolError(
      UNSUPPORTED_PENDING_ACTION_SCHEMA,
      'Unsupported pending-action-decision-receipt schema. Internal development state must be reset.',
    );
  }
}

function assertExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const expected = new Set(fields);
  if (
    fields.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !expected.has(field))
  ) {
    invalidReceipt('Decision receipt has missing or additional fields.');
  }
}

function assertSafeText(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalidReceipt(`${label} is invalid.`);
  }
  return value;
}

function assertErrorCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    invalidReceipt('Git errorCode is invalid.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidReceipt(message: string): never {
  throw new PendingActionProtocolError('INVALID_PENDING_ACTION_SCHEMA', message);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
