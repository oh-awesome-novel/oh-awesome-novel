import { describe, expect, it, vi } from 'vite-plus/test';
import {
  createOanClient, parseUsageInspectorEnvelope, projectUsageCalls,
} from '@oh-awesome-novel/client';
import type { AgentGovernanceHistory, ModelRequestUsageRecord, ModelStepUsageRecord } from '@oh-awesome-novel/client';

function fixture() {
  const request: ModelRequestUsageRecord = {
    schemaVersion: 1, recordType: 'request', sessionId: 'play-session-a', turnId: 'call-a', stepIndex: 0,
    createdAt: '2026-11-06T00:00:00.000Z',
    operation: { domain: 'play', sessionId: 'session-a', operationId: 'operation-a', stage: 'world' },
    request: { messageCount: 1, messages: [{ index: 0, role: 'user', chars: 3, estimatedTokens: 1, sourceRefs: ['context-1'] }], estimatedMessageTokens: 1, estimatedRequestTokens: 2, toolCount: 0, estimator: 'utf8-bytes-div-3-v1', estimationScope: 'messages-tools-json-with-20-percent-margin' },
    budget: { status: 'within', inputTokens: 100, estimatedRequestTokens: 2 },
    sources: [{ sourceId: 'context-1', kind: 'context', budgetLayer: 'L1', semanticBoundary: 'protected', outcome: 'selected', reason: 'selected', modelVisibleChars: 3, estimatedTokens: 1, estimator: 'utf8-bytes-div-3-v1' }],
  };
  const step: ModelStepUsageRecord = {
    schemaVersion: 1, recordType: 'step', sessionId: request.sessionId, turnId: request.turnId, stepIndex: 0,
    createdAt: '2026-11-06T00:00:00.020Z', actualUsage: { availability: 'actual', inputTokens: 10, outputTokens: 5, totalTokens: 15 }, outcome: 'completed',
    timing: { startedAt: request.createdAt, completedAt: '2026-11-06T00:00:00.020Z' },
  };
  const history: AgentGovernanceHistory = { schemaVersion: 1, sessionId: request.sessionId!, records: [request, step], truncated: false, diagnostics: [] };
  return { schemaVersion: 1 as const, scope: { domain: 'play' as const, sessionId: 'session-a' }, lens: 'player' as const, history, projection: projectUsageCalls(history), presentation: [] };
}

describe('domain usage inspector client', () => {
  it('binds the requested scope, filter and lens and preserves missing cache/first-response evidence', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture())));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    const result = await client.getPlayUsageInspector('session-a', { operationId: 'operation-a', limit: 20 });
    expect(fetcher.mock.calls[0]![0]).toBe('http://test/api/workspace/play-sessions/session-a/usage?operationId=operation-a&limit=20');
    expect(result.projection.totals.actualUsage).not.toHaveProperty('cacheReadTokens');
    expect(result.projection.calls[0]!.step!.timing).not.toHaveProperty('firstResponseAt');
    await expect(client.getPlayUsageInspector('../escape')).rejects.toThrow();
    await expect(client.getPlayUsageInspector('session-a', { operationId: '../escape' })).rejects.toThrow();
    await expect(client.getPlayUsageInspector('session-a', { limit: 101 })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a director response to a player request and mismatched usage history identities', async () => {
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: async () => new Response(JSON.stringify({ ...fixture(), lens: 'director' })) });
    await expect(client.getPlayUsageInspector('session-a')).rejects.toThrow(/lens mismatch/u);
    const wrongHistory = fixture(); wrongHistory.history.sessionId = 'play-other';
    expect(() => parseUsageInspectorEnvelope(wrongHistory)).toThrow();
    expect(() => parseUsageInspectorEnvelope(fixture(), { domain: 'play', sessionId: 'other' })).toThrow();
  });

  it('rejects hidden source details in history even if the visible projection is sanitized', () => {
    const value = fixture();
    const request = value.history.records[0] as ModelRequestUsageRecord;
    request.sources[0]!.path = 'characters/hidden-identity/profile.md';
    request.sources[0]!.sourceHash = 'a'.repeat(64);
    request.request.messages[0]!.sourceRefs = ['context-1:characters/hidden-identity/profile.md'];
    expect(() => parseUsageInspectorEnvelope(value)).toThrow(/source details/u);
  });

  it('rejects unassociated, filtered-out and inconsistent projected calls', () => {
    const value = fixture();
    const request = value.history.records[0] as ModelRequestUsageRecord;
    request.operation!.sessionId = 'other';
    expect(() => parseUsageInspectorEnvelope(value)).toThrow(/identity mismatch/u);
    expect(() => parseUsageInspectorEnvelope(fixture(), undefined, { operationId: 'other' })).toThrow(/filter mismatch/u);
    const different = fixture(); different.projection.calls[0]!.request!.budget.inputTokens = 200;
    expect(() => parseUsageInspectorEnvelope(different)).toThrow(/request mismatch/u);
  });

  it('rejects forged presentation fields and a receipt for another operation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ observation: {
      schemaVersion: 1, source: 'client-observed', observedAt: '2026-11-06T00:00:00.000Z', operationId: 'other', elapsedMs: 10,
    } })));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    await expect(client.recordPlayUsagePresentation('session-a', { operationId: 'operation-a', elapsedMs: 10 })).rejects.toThrow(/identity/u);
    await expect(client.recordPlayUsagePresentation('session-a', { operationId: 'operation-a', elapsedMs: -1 })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds explicit probe options and never starts a model call by reading options', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ maxCalls: 2, syntheticOnly: true,
      provider: { providerId: 'p', providerKind: 'custom', modelId: 'm', status: 'prepared', endpointOrigin: 'https://example.com' },
    })));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    expect(await client.getUsageProbeOptions()).toMatchObject({ maxCalls: 2, syntheticOnly: true });
    expect(fetcher.mock.calls[0]![0]).toBe('http://test/api/workspace/usage-probes/options');
    const bad = createOanClient({ backendBaseUrl: 'http://test', fetch: async () => new Response(JSON.stringify({ maxCalls: 3, syntheticOnly: true, provider: {} })) });
    await expect(bad.getUsageProbeOptions()).rejects.toThrow();
  });
});
