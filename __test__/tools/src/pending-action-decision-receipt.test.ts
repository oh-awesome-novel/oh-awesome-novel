import { describe, expect, it } from 'vitest';

import {
  PendingActionProtocolError,
  createPendingActionDecisionReceipt,
  isAllowedDecisionReceiptTransition,
  parsePendingActionDecisionReceipt,
} from '@oh-awesome-novel/tools';

const decidedAt = '2026-08-12T00:00:00.000Z';

describe('PendingAction decision receipt protocol', () => {
  it('creates and strictly parses a schema-versioned receipt', () => {
    const receipt = createPendingActionDecisionReceipt({
      id: 'receipt-1',
      actionId: 'pa-1',
      decision: 'accepted',
      decidedAt,
      materialization: 'committed',
      git: { status: 'committed', commit: 'abc123', branch: 'main' },
    });

    expect(receipt).toEqual({
      schemaVersion: 1,
      kind: 'pending-action-decision-receipt',
      id: 'receipt-1',
      actionId: 'pa-1',
      decision: 'accepted',
      decidedAt,
      materialization: 'committed',
      git: { status: 'committed', commit: 'abc123', branch: 'main' },
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it.each([
    { id: 'old', actionId: 'pa-1', decision: 'rejected' },
    { schemaVersion: 1, id: 'old', actionId: 'pa-1', decision: 'rejected' },
    {
      schemaVersion: 99,
      kind: 'pending-action-decision-receipt',
      id: 'old',
      actionId: 'pa-1',
      decision: 'rejected',
    },
    {
      schemaVersion: 1,
      kind: 'pending-action-decision-receipt',
      id: 'old',
      actionId: 'pa-1',
      decision: 'rejected',
      patches: [],
    },
  ])('rejects an unsupported/legacy receipt with a stable code', (legacy) => {
    expect(() => parsePendingActionDecisionReceipt(legacy)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_PENDING_ACTION_SCHEMA' }),
    );
  });

  it('rejects missing, additional and semantically contradictory fields', () => {
    const valid = createPendingActionDecisionReceipt({
      id: 'receipt-1',
      actionId: 'pa-1',
      decision: 'rejected',
      decidedAt,
      materialization: 'not-applicable',
      git: { status: 'not-requested' },
    });

    expect(() => parsePendingActionDecisionReceipt({
      ...valid,
      unexpected: true,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_PENDING_ACTION_SCHEMA' }));
    expect(() => parsePendingActionDecisionReceipt({
      ...valid,
      materialization: 'committed',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_PENDING_ACTION_SCHEMA' }));
    expect(() => parsePendingActionDecisionReceipt({
      ...valid,
      git: { status: 'failed', errorCode: 'git_failed', extra: true },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_PENDING_ACTION_SCHEMA' }));
  });

  it('permits only a recovery transition to a committed Git result', () => {
    const failed = createPendingActionDecisionReceipt({
      id: 'receipt-1',
      actionId: 'pa-1',
      decision: 'accepted',
      decidedAt,
      materialization: 'committed',
      git: { status: 'staged-not-committed', branch: 'main', errorCode: 'identity_missing' },
    });
    const committed = createPendingActionDecisionReceipt({
      ...failed,
      git: { status: 'committed', commit: 'def456', branch: 'main' },
    });
    const anotherFailure = createPendingActionDecisionReceipt({
      ...failed,
      git: { status: 'failed', errorCode: 'git_failed' },
    });

    expect(isAllowedDecisionReceiptTransition(failed, committed)).toBe(true);
    expect(isAllowedDecisionReceiptTransition(failed, anotherFailure)).toBe(false);
    expect(PendingActionProtocolError).toBeTypeOf('function');
  });
});
