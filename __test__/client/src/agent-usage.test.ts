import { describe, expect, it, vi } from 'vitest';
import { createOanClient, parseAgentUsageRecord } from '@oh-awesome-novel/client';
const summary = () => ({ schemaVersion: 1, recordType: 'turn', sessionId: 's1', turnId: 't1', createdAt: '2026-10-01T00:00:00.000Z', stepCount: 1, estimatedMessageTokens: 10, estimatedRequestTokens: 20, actualUsage: { availability: 'unavailable' }, actualCoverage: 'unavailable', fieldCoverage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, outcome: 'completed' });
const history = () => ({ schemaVersion: 1, sessionId: 's1', records: [summary()], diagnostics: [], truncated: false });
describe('strict client governance contract', () => {
  it('reads bounded history while preserving unavailable usage', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(history())));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    expect(await client.getAgentGovernanceHistory('s1', 2)).toEqual(history());
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://test/api/workspace/agent-sessions/s1/governance?limit=2');
    await expect(client.getAgentGovernanceHistory('../outside')).rejects.toThrow();
    await expect(client.getAgentGovernanceHistory('s1', 101)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown schema, raw content, invalid coverage and a mismatched session', async () => {
    expect(() => parseAgentUsageRecord({ ...summary(), schemaVersion: 99 })).toThrow();
    expect(() => parseAgentUsageRecord({ ...summary(), raw: 'PROMPT' })).toThrow();
    expect(() => parseAgentUsageRecord({ ...summary(), actualCoverage: 'complete' })).toThrow();
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: async () => new Response(JSON.stringify(history())) });
    await expect(client.getAgentGovernanceHistory('s2')).rejects.toThrow();
  });
});
