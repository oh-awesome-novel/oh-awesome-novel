import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { MockLanguageModelV4 } from 'ai/test';
import { generateReferenceQuestionAnswer, runUsageCacheProbeCall } from '@oh-awesome-novel/agent';
import { projectUsageCalls, readAgentGovernanceHistory } from '@oh-awesome-novel/core';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), 'oan-1390-agent-')); roots.push(value); return value; }
const provider = { id: 'mock', kind: 'custom' as const, model: 'mock', apiKey: 'KEY_SECRET', baseUrl: 'https://user:pass@example.test/v1/private?key=QUERY_SECRET' };
const source = { pointerId: 'pointer-1', pointer: { referenceId: 'ref-1', sourceChecksumSha256: 'a'.repeat(64), chapterId: 'chapter-1', chunkId: 'chunk-1', lineStart: 1, lineEnd: 2 }, content: '第一章\n雨夜她把旧信藏进袖口。', charLength: 18 };
const operation = { domain: 'reference' as const, operationId: 'advance-1', referenceId: 'ref-1', runId: 'run-1', unitId: 'unit-1', attemptId: 'attempt-1', stage: 'question' };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };
const toolCall = (toolName: string, input: unknown, toolCallId: string) => ({ type: 'tool-call' as const, toolName, input: JSON.stringify(input), toolCallId });
const answer = { answer: '先藏信，再揭示原因。', findings: [{ observation: '先出现藏信动作。', technique: '延迟揭示', evidenceRefs: ['pointer-1'] }], uncertainties: [] };

describe('specialized usage evidence', () => {
  it('records every real Reference tool-exploration step once with host correlation and unknown non-streaming first response', async () => {
    const workspaceRoot = await root(); let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      const index = calls++;
      return { content: index === 0 ? [toolCall('searchReferenceSource', { query: '旧信' }, 'c1')]
        : index === 1 ? [toolCall('readReferenceSource', { pointerId: 'pointer-1' }, 'c2')]
          : [{ type: 'text', text: JSON.stringify(answer) }],
      finishReason: { unified: index < 2 ? 'tool-calls' : 'stop', raw: index < 2 ? 'tool-calls' : 'stop' }, usage, warnings: [] };
    } });
    const result = await generateReferenceQuestionAnswer({
      referenceId: 'ref-1', title: '样书', question: '怎样设置悬念？', windows: [source],
      workspaceRoot, usageSessionId: 'run-1', usageOperation: operation,
      providerConfig: provider, resolveModel: () => model,
    });
    expect(result.status).toBe('completed');
    const history = await readAgentGovernanceHistory(workspaceRoot, 'run-1');
    expect(history.diagnostics).toEqual([]);
    expect(history.records.filter(record => record.recordType === 'request')).toHaveLength(3);
    expect(history.records.filter(record => record.recordType === 'step')).toHaveLength(3);
    expect(history.records.filter(record => record.recordType === 'turn')).toHaveLength(1);
    const view = projectUsageCalls(history, { operationId: 'advance-1' });
    expect(view.totals).toMatchObject({ callCount: 3, reportedCalls: 3, actualCoverage: 'complete', actualUsage: { totalTokens: 90 } });
    expect(view.calls.every(call => call.request?.operation?.attemptId === 'attempt-1')).toBe(true);
    expect(view.calls.every(call => call.request?.request.toolCount === 2)).toBe(true);
    expect(view.calls[2]!.request!.request.messageCount).toBeGreaterThan(view.calls[0]!.request!.request.messageCount);
    for (const call of view.calls) {
      expect(call.step?.timing).toMatchObject({ startedAt: expect.any(String), completedAt: expect.any(String) });
      expect(call.step?.timing?.firstResponseAt).toBeUndefined();
      expect(call.request?.fingerprint?.prefixHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    const audit = await readFile(join(workspaceRoot, '.workspace/sessions/run-1/usage-stats.jsonl'), 'utf8');
    for (const privateText of ['KEY_SECRET', 'QUERY_SECRET', '雨夜她把旧信藏进袖口。', workspaceRoot]) expect(audit).not.toContain(privateText);
  });

  it('retains completed-step actuals when a subsequent Reference request fails', async () => {
    const workspaceRoot = await root(); let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      if (calls++) throw new Error('provider failed');
      return { content: [toolCall('searchReferenceSource', { query: '旧信' }, 'c1')], finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage, warnings: [] };
    } });
    expect((await generateReferenceQuestionAnswer({ referenceId: 'ref-1', title: '样书', question: '怎样设置悬念？', windows: [source], workspaceRoot, usageSessionId: 'run-1', usageOperation: operation, providerConfig: provider, resolveModel: () => model })).status).toBe('failed');
    const view = projectUsageCalls(await readAgentGovernanceHistory(workspaceRoot, 'run-1'));
    expect(view.calls.map(call => call.status)).toEqual(['completed', 'failed']);
    expect(view.totals).toMatchObject({ callCount: 2, actualCoverage: 'partial', actualUsage: { totalTokens: 30 } });
    expect(view.calls[1]!.step!.actualUsage).toEqual({ availability: 'unavailable' });
  });

  it('uses the same bounded synthetic prefix for explicit probe calls without reading novel text', async () => {
    const workspaceRoot = await root(); await writeFile(join(workspaceRoot, 'private-novel.md'), 'NOVEL_SECRET');
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: 'OK' }],
      finishReason: { unified: 'stop', raw: 'stop' }, warnings: [],
      usage: { inputTokens: { total: 100, noCache: calls++ ? 20 : 100, cacheRead: calls > 1 ? 80 : 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } }) });
    const input = { workspaceRoot, usageSessionId: 'probe-1', usageOperation: { ...operation, operationId: 'probe-1', stage: 'cacheProbe' }, providerConfig: provider, resolveModel: () => model };
    expect(await runUsageCacheProbeCall(input)).toEqual({ outcome: 'completed' });
    expect(await runUsageCacheProbeCall(input)).toEqual({ outcome: 'completed' });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[0]!.prompt).toEqual(model.doGenerateCalls[1]!.prompt);
    expect(model.doGenerateCalls.every(call => call.maxOutputTokens === 32)).toBe(true);
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain('NOVEL_SECRET');
    const view = projectUsageCalls(await readAgentGovernanceHistory(workspaceRoot, 'probe-1'));
    expect(view.calls.map(call => call.request?.fingerprint?.prefixKind)).toEqual(['frozen-system', 'frozen-system']);
    expect(view.calls[1]!.fingerprintChange.status).toBe('unchanged');
    expect(view.totals.actualUsage.cacheReadTokens).toBe(80);
    expect(await readFile(join(workspaceRoot, 'private-novel.md'), 'utf8')).toBe('NOVEL_SECRET');
    const resolveModel = vi.fn(() => model);
    const abort = new AbortController(); abort.abort();
    expect(await runUsageCacheProbeCall({ ...input, resolveModel, abortSignal: abort.signal })).toEqual({ outcome: 'aborted' });
    expect(resolveModel).not.toHaveBeenCalled();
  });
});
