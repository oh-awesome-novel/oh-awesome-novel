import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAgentGovernanceHistory } from '@oh-awesome-novel/core';
import { describe, expect, it } from 'vite-plus/test';
import { aggregateModelUsage, parseAgentUsageRecord, parseUsageCallsProjection, projectUsageCalls, selectUsageOperation } from '@oh-awesome-novel/core';
import type { AgentGovernanceHistory, ModelRequestUsageRecord, ModelStepUsageRecord } from '@oh-awesome-novel/core';

const at = (index: number) => new Date(Date.UTC(2026, 10, 6, 0, 0, index)).toISOString();
function request(index: number, changes: Partial<ModelRequestUsageRecord> = {}): ModelRequestUsageRecord {
  return { schemaVersion: 1, recordType: 'request', sessionId: 'usage-1', turnId: `turn-${index}`, stepIndex: 0, createdAt: at(index),
    request: { messageCount: 1, messages: [{ index: 0, role: 'user', chars: 3, estimatedTokens: 1, sourceRefs: [] }], estimatedMessageTokens: 1, estimatedRequestTokens: 20, toolCount: 0, estimator: 'utf8-bytes-div-3-v1', estimationScope: 'messages-tools-json-with-20-percent-margin' },
    sources: [], budget: { status: 'unknown', estimatedRequestTokens: 20 },
    operation: { domain: 'reference', operationId: `advance-${index}`, referenceId: 'reference-1', runId: 'run-1', unitId: `unit-${index}`, stage: 'chapter' },
    fingerprint: { prefixHash: 'a'.repeat(64), prefixKind: 'system-messages', toolSchemaHash: 'b'.repeat(64) }, ...changes };
}
function step(index: number, changes: Partial<ModelStepUsageRecord> = {}): ModelStepUsageRecord {
  return { schemaVersion: 1, recordType: 'step', sessionId: 'usage-1', turnId: `turn-${index}`, stepIndex: 0, createdAt: at(index + 1),
    actualUsage: { availability: 'actual', inputTokens: 10, outputTokens: 2, totalTokens: 12 }, outcome: 'completed',
    timing: { startedAt: at(index), completedAt: at(index + 1) }, ...changes };
}
const history = (records: AgentGovernanceHistory['records'], truncated = false): AgentGovernanceHistory => ({ schemaVersion: 1, sessionId: 'usage-1', records, truncated, diagnostics: [] });

describe('usage inspector projection', () => {
  it('sums distinct physical steps once, preserving explicit zero and unavailable fields', () => {
    const unavailable = step(2, { outcome: 'aborted', actualUsage: { availability: 'unavailable' } });
    const zero = step(3, { actualUsage: { availability: 'actual', inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0 } });
    const summary = { schemaVersion: 1 as const, recordType: 'turn' as const, sessionId: 'usage-1', turnId: 'turn-1', createdAt: at(2),
      stepCount: 1, estimatedMessageTokens: 1, estimatedRequestTokens: 20, outcome: 'completed' as const,
      ...aggregateModelUsage([step(1).actualUsage]) };
    const result = projectUsageCalls(history([request(1), step(1), summary, structuredClone(step(1)), request(2), unavailable, request(3), zero]));
    expect(result.calls).toHaveLength(3);
    expect(result.totals).toMatchObject({ callCount: 3, reportedCalls: 3, actualCoverage: 'partial', actualUsage: { availability: 'partial', totalTokens: 12, cacheReadTokens: 0 }, fieldCoverage: { totalTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 } });
    expect(result.diagnostics).toContain('duplicate-records');
    expect(parseUsageCallsProjection(result)).toEqual(result);
  });

  it('excludes contradictory records instead of counting both as separate provider calls', () => {
    const result = projectUsageCalls(history([request(1), step(1), step(1, { actualUsage: { availability: 'actual', inputTokens: 100, outputTokens: 20, totalTokens: 120 } }), request(2), step(2)]));
    expect(result.calls[0]?.status).toBe('conflict');
    expect(result.calls[0]?.step).toBeUndefined();
    expect(result.totals).toMatchObject({ callCount: 2, reportedCalls: 1, actualCoverage: 'partial', actualUsage: { totalTokens: 12 } });
    expect(result.diagnostics).toContain('conflicting-records');
  });

  it('keeps conflicted calls out of current-operation totals even if redaction makes their requests identical', () => {
    const records = history([request(1), request(1, { contextPackageId: 'hidden' }), step(1)]);
    const projection = projectUsageCalls(records);
    const redacted = history([request(1), request(1), step(1)]);
    const current = selectUsageOperation(projection, redacted, 'advance-1');
    expect(current.calls[0]?.status).toBe('conflict');
    expect(current.totals.actualUsage.inputTokens).toBeUndefined();
  });

  it('compares a filtered operation with prior same-scope calls without crossing Reference runs', () => {
    const changed = request(2, { fingerprint: { prefixHash: 'c'.repeat(64), prefixKind: 'system-messages', toolSchemaHash: 'd'.repeat(64) } });
    const otherRun = request(3, { operation: { ...request(3).operation!, runId: 'run-2' } });
    const values = history([request(1), step(1), changed, step(2), otherRun, step(3)]);
    const result = projectUsageCalls(values, { operationId: 'advance-2' });
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.fingerprintChange).toEqual({ status: 'changed', reasons: ['prefix', 'tools'], comparedWith: 'turn-1.0' });
    expect(parseUsageCallsProjection(result)).toEqual(result);
    expect(projectUsageCalls(values, { operationId: 'advance-3' }).calls[0]?.fingerprintChange.status).toBe('first-observed');
  });

  it('never guesses association for old or truncated orphan records and marks partial coverage', () => {
    const old = request(1); delete old.operation;
    const result = projectUsageCalls(history([old, step(1), request(2), step(2), step(3)], true), { domain: 'reference', referenceId: 'reference-1', runId: 'run-1' });
    expect(result.calls.map(call => call.turnId)).toEqual(['turn-2']);
    expect(result.totals.actualCoverage).toBe('partial');
    expect(result.diagnostics).toContain('unmatched-records');
    expect(result.truncated).toBe(true);
  });

  it('reopens a thousand-call log with bounded partial totals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-usage-history-'));
    try {
      const dir = join(root, '.workspace/sessions/usage-1');
      await mkdir(dir, { recursive: true });
      const lines = Array.from({ length: 1000 }, (_, index) => [request(index), step(index)]).flat();
      await writeFile(join(dir, 'usage-stats.jsonl'), lines.map(record => JSON.stringify(record)).join('\n') + '\n');
      const result = projectUsageCalls(await readAgentGovernanceHistory(root, 'usage-1', 100));
      expect(result.truncated).toBe(true);
      expect(result.calls).toHaveLength(50);
      expect(result.totals.actualUsage.inputTokens).toBe(500);
      expect(result.calls.at(-1)?.turnId).toBe('turn-999');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects forged identities, raw metadata, impossible times and altered projection totals', () => {
    expect(() => parseAgentUsageRecord({ ...request(1), operation: { ...request(1).operation, prompt: 'secret' } })).toThrow();
    expect(() => parseAgentUsageRecord({ ...request(1), operation: { domain: 'reference', operationId: 'op', referenceId: 'ref', stage: 'chapter' } })).toThrow();
    expect(() => parseAgentUsageRecord({ ...request(1), operation: { domain: 'play', operationId: 'op', sessionId: '../private', stage: 'world' } })).toThrow();
    expect(() => parseAgentUsageRecord({ ...step(1), timing: { startedAt: at(2), completedAt: at(1) } })).toThrow();
    expect(() => parseAgentUsageRecord({ ...step(1), timing: { startedAt: at(1), completedAt: at(2), firstResponseAt: at(3) } })).toThrow();
    const valid = projectUsageCalls(history([request(1), step(1)]));
    expect(() => parseUsageCallsProjection({ ...valid, totals: { ...valid.totals, callCount: 500 } })).toThrow();
    expect(() => parseUsageCallsProjection({ ...valid, calls: [...valid.calls, ...valid.calls] })).toThrow();
  });
});
