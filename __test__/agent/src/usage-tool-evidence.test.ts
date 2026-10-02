import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { runNovelAgentTurn } from '@oh-awesome-novel/agent';
import { readAgentGovernanceHistory } from '@oh-awesome-novel/core';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';

type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;
type ProviderUsage = Extract<ProviderPart, { type: 'finish' }>['usage'];
const git = promisify(execFile);
const roots: string[] = [];
const chapterPath = 'chapters/0001/0001.md';
const visible = 'PRIVATE_TOOL_EXCERPT 林安拿起钥匙。';
const hidden = 'PRIVATE_UNREAD_LINE 不应在工具摘录里出现。';
const body = `# 第一章\n${visible}\n${hidden}\n`;
const provider = { id: 'usage-tools', kind: 'custom' as const, model: 'usage-tools' };
const completeUsage: ProviderUsage = {
  inputTokens: { total: 10, noCache: 9, cacheRead: 1, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
const missingUsage: ProviderUsage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(content = body) {
  const root = await mkdtemp(join(tmpdir(), 'oan-tool-usage-')); roots.push(root);
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(join(root, chapterPath), content);
  await git('git', ['init', '-q', root]);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'baseline']);
  return root;
}

function response(parts: ProviderPart[]) {
  return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...parts], initialDelayInMs: null, chunkDelayInMs: null }) };
}
function readStep(id: string, usage = completeUsage, maxBytes = 1024) {
  return response([
    { type: 'tool-call', toolCallId: id, toolName: 'readFile', input: JSON.stringify({ path: chapterPath, startLine: 2, endLine: 2, maxBytes }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage },
  ]);
}
function finishStep(usage = completeUsage, failed = false) {
  return response([
    { type: 'text-start', id: 'answer' }, { type: 'text-delta', id: 'answer', delta: '阅读完成。' }, { type: 'text-end', id: 'answer' },
    { type: 'finish', finishReason: { unified: failed ? 'error' : 'stop', raw: failed ? 'error' : 'stop' }, usage },
  ]);
}
function run(root: string, model: MockLanguageModelV4, sessionId: string, events: RuntimeEvent[], inputBudget?: number) {
  return runNovelAgentTurn({
    workspaceRoot: root, workspace: { workspaceRoot: root }, request: '/审稿 请先读取当前章的第二行。',
    providerConfig: { ...provider, ...(inputBudget === undefined ? {} : { models: [{ id: provider.model, contextWindow: inputBudget + 1000, maxOutputTokens: 1000 }] }) },
    resolveModel: () => model, session: { id: sessionId }, onEvent: (event) => { events.push(event); },
  });
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

describe('usage from real default sandbox tool reads and installed SDK', () => {
  it('attributes the actual next-request tool excerpt to the full source hash without storing narrative payloads in usage artifacts', async () => {
    const root = await fixture(); const events: RuntimeEvent[] = [];
    const model = new MockLanguageModelV4({ doStream: [readStep('read-one'), finishStep()] });
    const result = await run(root, model, 'tool-evidence', events);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(result.toolLog).toHaveLength(1);
    expect(result.toolLog[0]!.result).toMatchObject({ ok: true, content: { content: visible, startLine: 2, endLine: 2, truncated: true } });
    const sent = JSON.stringify(model.doStreamCalls[1]!.prompt);
    expect(sent).toContain(visible); expect(sent).not.toContain(hidden);
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain(visible);
    const toolMessage = result.messages.find((message) => message.role === 'tool')!;
    const history = await readAgentGovernanceHistory(root, 'tool-evidence');
    expect(history.diagnostics).toEqual([]);
    const requests = history.records.filter((record) => record.recordType === 'request');
    expect(requests.map((record) => record.stepIndex)).toEqual([0, 1]);
    expect(requests[0]!.sources.filter((source) => source.reason === 'tool-result')).toEqual([]);
    const source = requests[1]!.sources.find((source) => source.reason === 'tool-result')!;
    expect(source).toEqual({
      sourceId: `toolRead-${hash('read-one').slice(0, 16)}-0`, kind: 'tool', path: chapterPath,
      sourceHash: hash(body), payloadHash: hash(toolMessage.content), originalChars: body.length,
      budgetLayer: 'L1', semanticBoundary: 'protected', outcome: 'selected', reason: 'tool-result',
      modelVisibleChars: toolMessage.content.length, estimatedTokens: 0,
      estimator: 'utf8-bytes-div-3-v1', attribution: 'derived',
    });
    const toolStats = requests[1]!.request.messages.find((message) => message.role === 'tool')!;
    expect(toolStats).toMatchObject({ chars: toolMessage.content.length, sourceRefs: [`${source.sourceId}:${chapterPath}`] });
    // Derived source attribution adds no extra token count; the serialized tool message is still budgeted.
    expect(toolStats.estimatedTokens).toBeGreaterThan(0);
    expect(requests[1]!.request.estimatedRequestTokens).toBeGreaterThan(requests[0]!.request.estimatedRequestTokens);
    expect(result.usage).toMatchObject({ stepCount: 2, actualCoverage: 'complete', actualUsage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 } });
    const audit = await readFile(join(root, '.workspace/sessions/tool-evidence/usage-stats.jsonl'), 'utf8');
    for (const secret of [visible, hidden, root, '阅读完成。']) expect(audit).not.toContain(secret);
    expect(events.filter((event) => event.type === 'model_request_stats')).toHaveLength(2);
  });

  it('includes a protected tool result in the next-step budget and rejects overflow before another provider call', async () => {
    const content = `# 第一章\n${'PRIVATE_LARGE_TOOL_BODY_'.repeat(2300)}\n`;
    const root = await fixture(content); const events: RuntimeEvent[] = [];
    const model = new MockLanguageModelV4({ doStream: [readStep('read-large', completeUsage, 60_000), finishStep()] });
    await expect(run(root, model, 'tool-overflow', events, 11_000)).rejects.toMatchObject({ code: 'CONTEXT_PROTECTED_OVERFLOW' });
    expect(model.doStreamCalls).toHaveLength(1);
    const history = await readAgentGovernanceHistory(root, 'tool-overflow');
    expect(history.diagnostics).toEqual([]);
    const requests = history.records.filter((record) => record.recordType === 'request');
    expect(requests).toHaveLength(2);
    expect(requests[0]!.budget.status).toBe('within');
    expect(requests[1]!.budget).toMatchObject({ status: 'overflow', inputTokens: 11_000 });
    expect(requests[1]!.sources).toContainEqual(expect.objectContaining({ path: chapterPath, sourceHash: hash(content), reason: 'tool-result', outcome: 'selected', semanticBoundary: 'protected' }));
    expect(requests[1]!.request.messages.find((message) => message.role === 'tool')!.estimatedTokens).toBeGreaterThan(11_000);
    expect(history.records.filter((record) => record.recordType === 'step')).toMatchObject([
      { stepIndex: 0, outcome: 'completed', actualUsage: { availability: 'actual', inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
      { stepIndex: 1, outcome: 'failed', actualUsage: { availability: 'unavailable' } },
    ]);
    const audit = await readFile(join(root, '.workspace/sessions/tool-overflow/usage-stats.jsonl'), 'utf8');
    expect(audit).not.toContain('PRIVATE_LARGE_TOOL_BODY_');
  });

  it('records real usage once for SDK finishReason:error and preserves a failed turn outcome', async () => {
    const root = await fixture(); const events: RuntimeEvent[] = [];
    const usage: ProviderUsage = { inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 }, outputTokens: { total: 8, text: 6, reasoning: 2 }, raw: { secret: 'RAW_PROVIDER_USAGE' } };
    const model = new MockLanguageModelV4({ doStream: finishStep(usage, true) });
    await expect(run(root, model, 'failed-usage', events)).rejects.toThrow('finished with an error');
    const history = await readAgentGovernanceHistory(root, 'failed-usage');
    expect(history.diagnostics).toEqual([]);
    const steps = history.records.filter((record) => record.recordType === 'step');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ stepIndex: 0, outcome: 'failed', finishReason: 'error', actualUsage: {
      availability: 'actual', inputTokens: 100, outputTokens: 8, totalTokens: 108, cacheReadTokens: 20, cacheWriteTokens: 0, reasoningTokens: 2,
    } });
    const turns = history.records.filter((record) => record.recordType === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ outcome: 'failed', stepCount: 1, actualCoverage: 'complete', actualUsage: steps[0]!.actualUsage,
      fieldCoverage: { inputTokens: 1, outputTokens: 1, totalTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1, reasoningTokens: 1 } });
    expect(events.filter((event) => event.type === 'usage_stats' && event.record.recordType === 'step')).toHaveLength(1);
    expect(await readFile(join(root, '.workspace/sessions/failed-usage/usage-stats.jsonl'), 'utf8')).not.toContain('RAW_PROVIDER_USAGE');
  });

  it('aggregates complete, partial and missing provider counts across actual tool steps without substituting zeros or counting twice', async () => {
    const root = await fixture(); const events: RuntimeEvent[] = [];
    const partialUsage: ProviderUsage = { ...missingUsage, inputTokens: { ...missingUsage.inputTokens, total: 3, noCache: 3 } };
    const model = new MockLanguageModelV4({ doStream: [readStep('read-first'), readStep('read-second', partialUsage), finishStep(missingUsage)] });
    const result = await run(root, model, 'mixed-usage', events);
    expect(model.doStreamCalls).toHaveLength(3); expect(result.toolLog).toHaveLength(2);
    const history = await readAgentGovernanceHistory(root, 'mixed-usage');
    expect(history.diagnostics).toEqual([]);
    const steps = history.records.filter((record) => record.recordType === 'step');
    expect(steps.map((step) => step.stepIndex)).toEqual([0, 1, 2]);
    expect(steps.map((step) => step.actualUsage)).toEqual([
      { availability: 'actual', inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 1, cacheWriteTokens: 0, reasoningTokens: 0 },
      // SDK 7 derives totalTokens from its available input count; output remains unknown.
      { availability: 'partial', inputTokens: 3, totalTokens: 3 },
      { availability: 'unavailable' },
    ]);
    const turn = history.records.filter((record) => record.recordType === 'turn');
    expect(turn).toHaveLength(1);
    expect(turn[0]).toMatchObject({ stepCount: 3, outcome: 'completed', actualCoverage: 'partial',
      actualUsage: { availability: 'partial', inputTokens: 13, outputTokens: 2, totalTokens: 15, cacheReadTokens: 1, cacheWriteTokens: 0, reasoningTokens: 0 },
      fieldCoverage: { inputTokens: 2, outputTokens: 1, totalTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 1, reasoningTokens: 1 } });
    expect(result.usage).toEqual(turn[0]);
    expect(events.filter((event) => event.type === 'usage_stats' && event.record.recordType === 'step')).toHaveLength(3);
  });
});
