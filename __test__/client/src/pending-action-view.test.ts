import { describe, expect, it, vi } from 'vitest';

import {
  INVALID_PENDING_ACTION_VIEW_CODE,
  PENDING_ACTION_RESET_REQUIRED_CODE,
  PendingActionViewParseError,
  createOanClient,
  createPendingActionViewApi,
  parsePendingActionDecisionEnvelope,
  parsePendingActionDecisionReceiptV1,
  parsePendingActionQuickCommitEnvelope,
  parsePendingActionView,
  parsePendingActionViewListEnvelope,
} from '@oh-awesome-novel/client';

const CREATED_AT = '2026-08-12T00:00:00.000Z';
const DECIDED_AT = '2026-08-12T00:01:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

describe('strict PendingActionView client boundary', () => {
  it('preserves the chapter settlement identity and rejects unknown or malformed origin fields', () => {
    const origin = { kind: 'chapterSettlement', chapterId: '0001/0002', sourceHash: HASH_A };
    expect(parsePendingActionView({ ...createPendingView(), origin }).origin).toEqual(origin);
    for (const invalid of [
      { ...origin, extra: true }, { ...origin, chapterId: '../0002' },
      { ...origin, chapterId: '0000/0002' }, { ...origin, sourceHash: 'stale' },
    ]) expect(() => parsePendingActionView({ ...createPendingView(), origin: invalid })).toThrow();
  });
  it('parses create/update/delete and preserves diff as inert plain text', () => {
    const value = createPendingView();
    const parsed = parsePendingActionView(value);

    expect(parsed.changes).toEqual([
      { operation: 'create', path: 'chapters/new.md', newHash: HASH_A },
      {
        operation: 'update',
        path: 'chapters/old.md',
        oldHash: HASH_B,
        newHash: HASH_C,
      },
      { operation: 'delete', path: 'outline/old.md', oldHash: HASH_D },
    ]);
    expect(parsed.diff).toContain('<script>alert("never execute")</script>');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('.workspace/change-engine');
  });

  it('rejects old fields with the stable reset-required contract', () => {
    for (const field of ['patches', 'shadowWrites', 'touchedFiles', 'toolName']) {
      try {
        parsePendingActionView({ ...createPendingView(), [field]: [] });
        throw new Error('Expected parser failure.');
      } catch (error) {
        expect(error).toBeInstanceOf(PendingActionViewParseError);
        expect(error).toMatchObject({
          code: PENDING_ACTION_RESET_REQUIRED_CODE,
          resetRequired: true,
        });
      }
    }
    try {
      parsePendingActionDecisionReceiptV1({
        id: 'old-receipt',
        actionId: 'action-1',
      });
      throw new Error('Expected parser failure.');
    } catch (error) {
      expect(error).toMatchObject({ code: PENDING_ACTION_RESET_REQUIRED_CODE });
    }
  });

  it('rejects unknown fields, artifact paths, operations, hashes, origins and Git data', () => {
    const cases: unknown[] = [
      { ...createPendingView(), unexpected: true },
      {
        ...createPendingView(),
        changes: [{
          operation: 'create',
          path: '.workspace/change-engine/v1/drafts/action-1/0.txt',
          newHash: HASH_A,
        }],
      },
      {
        ...createPendingView(),
        changes: [{ operation: 'rename', path: 'chapters/new.md', newHash: HASH_A }],
      },
      {
        ...createPendingView(),
        changes: [{ operation: 'create', path: 'chapters/new.md', oldHash: HASH_B }],
      },
      {
        ...createPendingView(),
        origin: { kind: 'agentTurn', sessionId: 'session-1', turnId: 'turn-1', extra: true },
      },
      {
        ...createAcceptedView(),
        git: { status: 'committed', commit: 'abc123' },
      },
    ];

    for (const value of cases) {
      try {
        parsePendingActionView(value);
        throw new Error('Expected parser failure.');
      } catch (error) {
        expect(error).toMatchObject({ code: INVALID_PENDING_ACTION_VIEW_CODE });
      }
    }
  });

  it('parses exact list and accepted decision envelopes', () => {
    expect(parsePendingActionViewListEnvelope({
      pendingActions: [createPendingView()],
    })).toMatchObject({ pendingActions: [{ id: 'action-1', status: 'pending' }] });

    const accepted = parsePendingActionDecisionEnvelope(createAcceptedEnvelope());
    expect(accepted).toMatchObject({
      pendingAction: { id: 'action-1', status: 'accepted' },
      receipt: {
        actionId: 'action-1',
        decision: 'accepted',
        git: { status: 'committed', commit: 'abc123', branch: 'main' },
      },
      appliedFiles: ['chapters/new.md', 'chapters/old.md', 'outline/old.md'],
    });

    expect(() => parsePendingActionDecisionEnvelope({
      ...createAcceptedEnvelope(),
      receipt: { ...createAcceptedReceipt(), actionId: 'action-2' },
    })).toThrow('does not match');
  });

  it('parses only an accepted action-scoped quick commit envelope', () => {
    const quickCommit = {
      pendingAction: createAcceptedView(),
      receipt: createAcceptedReceipt(),
      refresh: { workspaceStatus: { pendingActionCount: 0 } },
    };

    expect(parsePendingActionQuickCommitEnvelope(quickCommit)).toMatchObject({
      pendingAction: {
        id: 'action-1',
        status: 'accepted',
        git: { status: 'committed', commit: 'abc123', branch: 'main' },
      },
      receipt: {
        actionId: 'action-1',
        decision: 'accepted',
        git: { status: 'committed', commit: 'abc123', branch: 'main' },
      },
    });
    for (const invalid of [
      { ...quickCommit, appliedFiles: ['chapters/new.md'] },
      { ...quickCommit, referencePublish: {} },
      {
        ...quickCommit,
        pendingAction: createRejectedEnvelope().pendingAction,
        receipt: createRejectedEnvelope().receipt,
      },
      { ...quickCommit, artifactPath: '.workspace/change-engine/v1/drafts/action-1' },
    ]) {
      expect(() => parsePendingActionQuickCommitEnvelope(invalid)).toThrow(
        PendingActionViewParseError,
      );
    }
  });

  it('provides strict action-scoped API helpers', async () => {
    const requestJson = vi.fn(async (path: string) => {
      if (path === '/api/workspace/pending-actions') {
        return { pendingActions: [createPendingView()] };
      }
      if (path.endsWith('/accept')) return createAcceptedEnvelope();
      if (path.endsWith('/reject')) return createRejectedEnvelope();
      if (path.endsWith('/quick-commit')) {
        return {
          pendingAction: createAcceptedView(),
          receipt: createAcceptedReceipt(),
        };
      }
      return { pendingAction: createPendingView() };
    });
    const api = createPendingActionViewApi(requestJson);

    await expect(api.listPendingActionViews()).resolves.toMatchObject({
      pendingActions: [{ id: 'action-1' }],
    });
    await expect(api.readPendingActionView('action-1')).resolves.toMatchObject({
      pendingAction: { id: 'action-1' },
    });
    await expect(api.acceptPendingActionV1('action-1')).resolves.toMatchObject({
      pendingAction: { status: 'accepted' },
    });
    await expect(api.rejectPendingActionV1('action-1')).resolves.toMatchObject({
      pendingAction: { status: 'rejected' },
    });
    await expect(api.quickCommitPendingActionV1('action-1')).resolves.toMatchObject({
      pendingAction: { status: 'accepted' },
      receipt: { git: { status: 'committed' } },
    });
    expect(requestJson.mock.calls.map(([path]) => path)).toEqual([
      '/api/workspace/pending-actions',
      '/api/workspace/pending-actions/action-1',
      '/api/workspace/pending-actions/action-1/accept',
      '/api/workspace/pending-actions/action-1/reject',
      '/api/workspace/pending-actions/action-1/quick-commit',
    ]);
  });

  it('wires action-scoped quick commit into the default client', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      pendingAction: createAcceptedView(),
      receipt: createAcceptedReceipt(),
      refresh: { workspaceStatus: { pendingActionCount: 0 } },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
    });

    await expect(client.quickCommitPendingAction('action-1')).resolves.toMatchObject({
      pendingAction: { id: 'action-1', status: 'accepted' },
      receipt: { git: { status: 'committed' } },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://backend.test/api/workspace/pending-actions/action-1/quick-commit',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

function createPendingView(): Record<string, unknown> {
  return {
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
    diff: [
      'diff --git a/chapters/new.md b/chapters/new.md',
      '+<script>alert("never execute")</script>',
      '',
    ].join('\n'),
    origin: { kind: 'agentTurn', sessionId: 'session-1', turnId: 'turn-1' },
  };
}

function createAcceptedView(): Record<string, unknown> {
  return {
    ...createPendingView(),
    status: 'accepted',
    decidedAt: DECIDED_AT,
    git: { status: 'committed', commit: 'abc123', branch: 'main' },
  };
}

function createAcceptedReceipt(): Record<string, unknown> {
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

function createAcceptedEnvelope(): Record<string, unknown> {
  return {
    pendingAction: createAcceptedView(),
    receipt: createAcceptedReceipt(),
    appliedFiles: ['chapters/new.md', 'chapters/old.md', 'outline/old.md'],
  };
}

function createRejectedEnvelope(): Record<string, unknown> {
  return {
    pendingAction: {
      ...createPendingView(),
      status: 'rejected',
      decidedAt: DECIDED_AT,
      git: { status: 'not-requested' },
    },
    receipt: {
      schemaVersion: 1,
      kind: 'pending-action-decision-receipt',
      id: 'receipt-2',
      actionId: 'action-1',
      decision: 'rejected',
      decidedAt: DECIDED_AT,
      materialization: 'not-applicable',
      git: { status: 'not-requested' },
    },
  };
}
