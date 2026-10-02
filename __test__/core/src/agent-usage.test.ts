import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { aggregateModelUsage, appendAgentUsageRecord, estimateTextTokens, listAgentUsageSessions, normalizeModelUsage, parseAgentGovernanceHistory, parseAgentUsageRecord, readAgentGovernanceHistory, safeEndpointOrigin } from '@oh-awesome-novel/core';
import type { ModelStepUsageRecord } from '@oh-awesome-novel/core';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });
const step = (index = 0): ModelStepUsageRecord => ({ schemaVersion: 1, recordType: 'step', sessionId: 'session-1', turnId: 'turn-1', stepIndex: index, createdAt: '2026-10-01T00:00:00.000Z', outcome: 'completed', actualUsage: { availability: 'unavailable' } });
async function root() { const r = await mkdtemp(join(tmpdir(), 'oan-usage-')); roots.push(r); return r; }
describe('content-free agent usage', () => {
  it('keeps absent counts unavailable, explicit zeros actual, partial totals partial', () => {
    expect(normalizeModelUsage()).toEqual({ availability: 'unavailable' });
    expect(normalizeModelUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: -1 })).toEqual({ availability: 'actual', inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const aggregate = aggregateModelUsage([normalizeModelUsage({ inputTokens: 12, outputTokens: 3, totalTokens: 15 }), normalizeModelUsage()]);
    expect(aggregate.actualUsage).toEqual({ availability: 'partial', inputTokens: 12, outputTokens: 3, totalTokens: 15 });
    expect(aggregate).toMatchObject({ actualCoverage: 'partial', fieldCoverage: { inputTokens: 1, outputTokens: 1 } });
    expect(estimateTextTokens('中文abc')).toBe(3);
  });
  it('redacts credentials, endpoint path and query and refuses non-HTTP origins', () => {
    expect(safeEndpointOrigin('https://user:secret@example.test:444/v1/private?key=hidden')).toBe('https://example.test:444');
    expect(safeEndpointOrigin('file:///tmp/secret')).toBeUndefined();
    expect(safeEndpointOrigin('not a url')).toBeUndefined();
  });
  it('strictly rejects future versions, arbitrary content and invalid usage', () => {
    expect(() => parseAgentUsageRecord({ ...step(), schemaVersion: 2 })).toThrow();
    expect(() => parseAgentUsageRecord({ ...step(), prompt: 'SECRET' })).toThrow();
    expect(() => parseAgentUsageRecord({ ...step(), actualUsage: { availability: 'actual' } })).toThrow();
    expect(() => parseAgentUsageRecord({ ...step(), sessionId: '../escape' })).toThrow();
    expect(() => parseAgentGovernanceHistory({ schemaVersion: 1, sessionId: 'wrong', records: [step()], diagnostics: [], truncated: false })).toThrow();
  });
  it('persists bounded records, reopens history and diagnoses damaged tail without losing valid records', async () => {
    const r = await root();
    await Promise.all([0, 1, 2].map((i) => appendAgentUsageRecord(r, 'session-1', step(i))));
    const limited = await readAgentGovernanceHistory(r, 'session-1', 2);
    expect(limited.records.map((v) => 'stepIndex' in v ? v.stepIndex : -1)).toEqual([1, 2]);
    expect(limited.truncated).toBe(true);
    expect(parseAgentGovernanceHistory(limited)).toEqual(limited);
    expect(await listAgentUsageSessions(r)).toEqual([{ id: 'session-1', updatedAt: expect.any(String) }]);
    const path = join(r, '.workspace/sessions/session-1/usage-stats.jsonl');
    await writeFile(path, `${await readFile(path, 'utf8')}{"broken":`);
    expect(await readAgentGovernanceHistory(r, 'session-1')).toMatchObject({ records: [step(0), step(1), step(2)], diagnostics: ['truncated-tail'] });
    await expect(appendAgentUsageRecord(r, 'session-1', step(3))).rejects.toThrow('truncated tail');
  });
  it('rejects links and unsafe limits without following an artifact outside the workspace', async () => {
    const r = await root(); const outside = await root();
    await mkdir(join(r, '.workspace')); await symlink(outside, join(r, '.workspace/sessions'));
    await expect(appendAgentUsageRecord(r, 'session-1', step())).rejects.toThrow('Unsafe');
    expect(await readAgentGovernanceHistory(r, 'session-1')).toMatchObject({ records: [], diagnostics: ['read-failed'] });
    await expect(readAgentGovernanceHistory(r, '../outside')).rejects.toThrow();
    await expect(readAgentGovernanceHistory(r, 'session-1', 101)).rejects.toThrow();
  });
  it('rejects contradictory request budgets and fabricated source references', () => {
    const request = { schemaVersion: 1, recordType: 'request', sessionId: 'session-1', turnId: 'turn-1', createdAt: '2026-10-01T00:00:00.000Z', stepIndex: 0,
      request: { messageCount: 1, messages: [{ index: 0, role: 'user', chars: 3, estimatedTokens: 1, sourceRefs: [] }], estimatedMessageTokens: 1, estimatedRequestTokens: 20, toolCount: 0, estimator: 'utf8-bytes-div-3-v1', estimationScope: 'messages-tools-json-with-20-percent-margin' },
      sources: [], budget: { status: 'unknown', estimatedRequestTokens: 20 } };
    expect(parseAgentUsageRecord(request)).toEqual(request);
    expect(() => parseAgentUsageRecord({ ...request, budget: { status: 'unknown', estimatedRequestTokens: 999 } })).toThrow();
    request.request.messages[0]!.sourceRefs = ['fabricated'] as never[];
    expect(() => parseAgentUsageRecord(request)).toThrow();
  });
  it('reads a valid UTF-8 tail even when the bounded byte offset bisects a Chinese character', async () => {
    const r = await root(); await appendAgentUsageRecord(r, 'session-1', step());
    const maxRead = 4 * 1024 * 1024;
    let line = ''; let record = step();
    for (let n = 1; n <= 60; n++) {
      record = { ...step(), finishReason: '完成'.repeat(n) };
      line = JSON.stringify(record) + '\n';
      const bytes = Buffer.from(line); const offset = (bytes.length - maxRead % bytes.length) % bytes.length;
      if ((bytes[offset]! & 0xc0) === 0x80) break;
    }
    const copies = Math.ceil(maxRead / Buffer.byteLength(line)) + 2;
    await writeFile(join(r, '.workspace/sessions/session-1/usage-stats.jsonl'), line.repeat(copies));
    expect(await readAgentGovernanceHistory(r, 'session-1', 2)).toMatchObject({ records: [record, record], truncated: true, diagnostics: [] });
  });

});
