import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runNovelAgentTurn, streamNovelAgentTurn, runtimeEventsToUiMessageStream } from '@oh-awesome-novel/agent';
import { readAgentGovernanceHistory } from '@oh-awesome-novel/core';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
const roots: string[] = [];
const exec = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });
async function workspace(largeProtected = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-governance-')); roots.push(root);
  await mkdir(join(root, '.oan/constitution'), { recursive: true }); await mkdir(join(root, 'summaries/chapter/0001'), { recursive: true });
  await writeFile(join(root, '.oan/constitution/style.md'), largeProtected ? '保护正文'.repeat(15_000) : 'PRIVATE_CONSTITUTION\n\n');
  await writeFile(join(root, 'summaries/chapter/0001/0001.md'), 'PRIVATE_SUMMARY'.repeat(3000));
  await exec('git', ['init', '-q', root]); await exec('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'baseline']);
  return root;
}
function model(usage = true) {
  return new MockLanguageModelV4({ doStream: { stream: simulateReadableStream({ chunks: [
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: '完成。' }, { type: 'text-end', id: 'a' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: usage ? { inputTokens: { total: 30, noCache: 25, cacheRead: 5, cacheWrite: 0 }, outputTokens: { total: 4, text: 3, reasoning: 1 }, raw: { secret: 'PROVIDER_RAW_SECRET' } } : { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } } },
  ] }) } });
}
const provider = { id: 'test', kind: 'custom' as const, model: 'test', apiKey: 'API_SECRET', headers: { Authorization: 'HEADER_SECRET' }, baseUrl: 'https://user:pass@example.test/v1/private?token=QUERY_SECRET', models: [{ id: 'test', contextWindow: 12_000, maxOutputTokens: 1000 }] };
describe('standard Agent usage governance', () => {
  it('omits compressible input deterministically, captures exact protected payload and actual SDK usage, and reopens the audit', async () => {
    const root = await workspace(); const llm = model(); const events: RuntimeEvent[] = [];
    const result = await runNovelAgentTurn({ workspaceRoot: root, workspace: { workspaceRoot: root }, request: '/审稿', providerConfig: provider, resolveModel: () => llm, session: { id: 'usage-session' }, onEvent: (e) => { events.push(e); } });
    expect(result.usage).toMatchObject({ actualCoverage: 'complete', actualUsage: { inputTokens: 30, outputTokens: 4, totalTokens: 34, cacheReadTokens: 5, reasoningTokens: 1 } });
    const history = await readAgentGovernanceHistory(root, 'usage-session');
    expect(history.diagnostics).toEqual([]);
    const request = history.records.find((r) => r.recordType === 'request')!;
    expect(request).toMatchObject({ egress: { endpointOrigin: 'https://example.test' }, budget: { status: 'within' } });
    const summary = request.sources.find((s) => s.path === 'summaries/chapter/0001/0001.md')!;
    expect(summary).toMatchObject({ outcome: 'omitted', reason: 'budget', modelVisibleChars: 0, estimatedTokens: 0 });
    const source = request.sources.find((s) => s.path === '.oan/constitution/style.md')!;
    expect(source.sourceHash).toBe(createHash('sha256').update('PRIVATE_CONSTITUTION\n\n').digest('hex'));
    expect(source.payloadHash).toBe(createHash('sha256').update('# Novel Constitution: Novel Constitution\n\n# style.md\n\nPRIVATE_CONSTITUTION\n\n').digest('hex'));
    const sent = JSON.stringify(llm.doStreamCalls[0]!.prompt);
    expect(llm.doStreamCalls[0]!.prompt.some((message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes('# style.md\n\nPRIVATE_CONSTITUTION\n\n'))).toBe(true);
    expect(sent).toContain('PRIVATE_CONSTITUTION'); expect(sent).not.toContain('PRIVATE_SUMMARY');
    const audit = await readFile(join(root, '.workspace/sessions/usage-session/usage-stats.jsonl'), 'utf8');
    for (const secret of ['PRIVATE_CONSTITUTION', 'PRIVATE_SUMMARY', 'API_SECRET', 'HEADER_SECRET', 'QUERY_SECRET', 'PROVIDER_RAW_SECRET', root]) expect(audit).not.toContain(secret);
  });
  it('reports protected overflow before model resolution and persists unavailable actuals', async () => {
    const root = await workspace(true); let resolved = false;
    await expect(runNovelAgentTurn({ workspaceRoot: root, workspace: { workspaceRoot: root }, request: '/审稿', providerConfig: provider, resolveModel: () => { resolved = true; return model(); }, session: { id: 'overflow' } })).rejects.toMatchObject({ code: 'CONTEXT_PROTECTED_OVERFLOW' });
    expect(resolved).toBe(false);
    expect(await readAgentGovernanceHistory(root, 'overflow')).toMatchObject({ records: [expect.objectContaining({ recordType: 'request', budget: { status: 'overflow', inputTokens: 11000, estimatedRequestTokens: expect.any(Number) } }), expect.objectContaining({ recordType: 'step', actualUsage: { availability: 'unavailable' } }), expect.objectContaining({ recordType: 'turn', outcome: 'failed' })] });
  });
  it('keeps unknown budget and missing provider usage visible over real SDK UI stream', async () => {
    const root = await workspace(); const llm = model(false);
    const stream = runtimeEventsToUiMessageStream(streamNovelAgentTurn({ workspaceRoot: root, workspace: { workspaceRoot: root }, request: '/审稿', providerConfig: { ...provider, models: [] }, resolveModel: () => llm, session: { id: 'unknown' } }));
    const reader = stream.getReader(); const chunks = []; for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
    const records = chunks.filter((c) => c.type === 'data-agent-usage').map((c) => c.data);
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ recordType: 'request', budget: { status: 'unknown', estimatedRequestTokens: expect.any(Number) } }), expect.objectContaining({ recordType: 'turn', actualCoverage: 'unavailable' })]));
    expect(llm.doStreamCalls).toHaveLength(1);
  });
  it('telemetry write failure warns without turning successful generation into failure', async () => {
    const root = await workspace(); const outside = await mkdtemp(join(tmpdir(), 'oan-usage-link-')); roots.push(outside);
    await mkdir(join(root, '.workspace/sessions/usage-failure'), { recursive: true });
    await writeFile(join(outside, 'usage.jsonl'), '');
    await symlink(join(outside, 'usage.jsonl'), join(root, '.workspace/sessions/usage-failure/usage-stats.jsonl'));
    const events: RuntimeEvent[] = [];
    const result = await runNovelAgentTurn({ workspaceRoot: root, workspace: { workspaceRoot: root }, request: 'hello', providerConfig: provider, resolveModel: () => model(), session: { id: 'usage-failure' }, onEvent: (e) => { events.push(e); } });
    expect(result.stoppedReason).toBe('completed'); expect(events).toContainEqual({ type: 'usage_warning', code: 'persistence-unavailable' });
  });
});
