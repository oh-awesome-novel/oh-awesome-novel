import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  PENDING_ACTION_RESET_REQUIRED_CODE,
  PendingActionResetRequiredError,
  createPendingActionViewHandlers,
  parsePendingActionViewDto,
  serializePendingActionView,
} from '@oh-awesome-novel/backend';
import type {
  ChangeMaterializer,
  PendingActionDecisionReceipt,
  PendingActionRecord,
  PendingActionStore,
} from '@oh-awesome-novel/tools';

const CREATED_AT = '2026-08-12T00:00:00.000Z';
const DECIDED_AT = '2026-08-12T00:01:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

describe('new PendingAction backend public boundary', () => {
  it('serializes only public create/update/delete review data', () => {
    const view = serializePendingActionView({ record: createPendingRecord() });

    expect(view).toEqual({
      id: 'action-1',
      title: 'Review changes',
      description: 'Three deterministic changes.',
      status: 'pending',
      createdAt: CREATED_AT,
      changes: [
        { operation: 'create', path: 'chapters/new.md', newHash: HASH_A },
        {
          operation: 'update',
          path: 'chapters/old.md',
          oldHash: HASH_B,
          newHash: HASH_C,
        },
        { operation: 'delete', path: 'outline/old.md', oldHash: HASH_D },
      ],
      diff: 'diff --git a/chapters/new.md b/chapters/new.md\n',
      origin: { kind: 'agentTurn', sessionId: 'session-1', turnId: 'turn-1' },
    });
    const wire = JSON.stringify(view);
    expect(wire).not.toContain('relativePath');
    expect(wire).not.toContain('drafts/');
    expect(wire).not.toContain('.workspace');
    expect(wire).not.toContain('patches');
    expect(wire).not.toContain('shadowWrites');
    expect(wire).not.toContain('touchedFiles');
  });

  it('combines a terminal record and receipt without exposing storage', () => {
    const pending = createPendingRecord();
    const receipt = createAcceptedReceipt();
    const record: PendingActionRecord = {
      action: pending.action,
      status: 'accepted',
      acceptedAt: DECIDED_AT,
      decisionReceiptId: receipt.id,
    };

    expect(serializePendingActionView({ record, receipt })).toMatchObject({
      id: 'action-1',
      status: 'accepted',
      decidedAt: DECIDED_AT,
      git: { status: 'committed', commit: 'abc123', branch: 'main' },
    });
  });

  it('fails closed on old/reset-required and unknown public shapes', () => {
    expect(() => serializePendingActionView({
      record: {
        status: 'pending',
        action: { id: 'old', patches: [], shadowWrites: [] },
      } as unknown as PendingActionRecord,
    })).toThrow(PendingActionResetRequiredError);

    try {
      parsePendingActionViewDto({
        ...serializePendingActionView({ record: createPendingRecord() }),
        touchedFiles: ['chapters/new.md'],
      });
      throw new Error('Expected parser failure.');
    } catch (error) {
      expect(error).toMatchObject({
        code: PENDING_ACTION_RESET_REQUIRED_CODE,
        status: 409,
      });
    }

    expect(() => parsePendingActionViewDto({
      ...serializePendingActionView({ record: createPendingRecord() }),
      unexpected: true,
    })).toThrow('missing or additional fields');
  });

  it('provides list/read/decision/action-scoped-commit handlers over the new store', async () => {
    const pendingRecord = createPendingRecord();
    const acceptedReceipt = createAcceptedReceipt();
    const acceptedRecord: PendingActionRecord = {
      action: pendingRecord.action,
      status: 'accepted',
      acceptedAt: DECIDED_AT,
      decisionReceiptId: acceptedReceipt.id,
    };
    let current: PendingActionRecord = pendingRecord;
    let receipt: PendingActionDecisionReceipt | undefined;
    const store = {
      listRecords: vi.fn(async () => [current]),
      readRecord: vi.fn(async () => current),
      readDecisionReceipt: vi.fn(async () => receipt),
    } as unknown as PendingActionStore;
    const materializer = {
      accept: vi.fn(async () => {
        current = acceptedRecord;
        receipt = acceptedReceipt;
        return {
          action: {},
          receipt: acceptedReceipt,
          appliedFiles: pendingRecord.action.changes.map((change) => change.path),
        };
      }),
      reject: vi.fn(),
      quickCommit: vi.fn(async () => acceptedReceipt),
    } as unknown as ChangeMaterializer;
    const handlers = createPendingActionViewHandlers({ store, materializer });

    await expect(handlers.list()).resolves.toMatchObject({
      pendingActions: [{ id: 'action-1', status: 'pending' }],
    });
    await expect(handlers.read('action-1')).resolves.toMatchObject({
      pendingAction: { id: 'action-1', status: 'pending' },
    });
    await expect(handlers.accept('action-1', {
      autoCommitOnAccept: false,
    })).resolves.toMatchObject({
      pendingAction: { status: 'accepted' },
      receipt: { decision: 'accepted' },
      appliedFiles: ['chapters/new.md', 'chapters/old.md', 'outline/old.md'],
    });
    expect(materializer.accept).toHaveBeenCalledWith({
      actionId: 'action-1',
      autoCommitOnAccept: false,
    });
    await expect(handlers.quickCommit('action-1')).resolves.toMatchObject({
      pendingAction: { id: 'action-1', status: 'accepted' },
      receipt: { actionId: 'action-1', git: { status: 'committed' } },
    });
    expect(materializer.quickCommit).toHaveBeenCalledWith('action-1');
  });
});

function createPendingRecord(): PendingActionRecord {
  const diff = 'diff --git a/chapters/new.md b/chapters/new.md\n';
  return {
    status: 'pending',
    action: {
      schemaVersion: 1,
      kind: 'pending-action',
      id: 'action-1',
      title: 'Review changes',
      description: 'Three deterministic changes.',
      createdAt: CREATED_AT,
      source: {
        kind: 'deterministic-builder',
        producer: 'test-producer',
        capability: 'novel.multi-file-edit',
      },
      repository: { repositoryId: 'repository-1', branch: 'main', head: 'head-1' },
      allowedTargets: [
        'chapters/new.md',
        'chapters/old.md',
        'outline/old.md',
      ],
      changes: [
        {
          operation: 'create',
          path: 'chapters/new.md',
          baseline: { exists: false },
          draft: {
            relativePath: 'drafts/action-1/0.txt',
            sha256: HASH_A,
            byteLength: 1,
          },
        },
        {
          operation: 'update',
          path: 'chapters/old.md',
          baseline: { exists: true, sha256: HASH_B, byteLength: 1, mode: 0o644 },
          draft: {
            relativePath: 'drafts/action-1/1.txt',
            sha256: HASH_C,
            byteLength: 1,
          },
        },
        {
          operation: 'delete',
          path: 'outline/old.md',
          baseline: { exists: true, sha256: HASH_D, byteLength: 1, mode: 0o644 },
          draft: null,
        },
      ],
      preview: { diff, diffHash: sha256(diff) },
      origin: { kind: 'agentTurn', sessionId: 'session-1', turnId: 'turn-1' },
    },
  };
}

function createAcceptedReceipt(): PendingActionDecisionReceipt {
  return {
    schemaVersion: 1,
    kind: 'pending-action-decision-receipt',
    id: 'receipt-1',
    actionId: 'action-1',
    decision: 'accepted',
    decidedAt: DECIDED_AT,
    materialization: 'committed',
    git: { status: 'committed', commit: 'abc123', branch: 'main' },
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
