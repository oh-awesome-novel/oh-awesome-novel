import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createChapterSettlementSource } from '@oh-awesome-novel/core';

const git = promisify(execFile); const roots: string[] = []; const servers: Array<{ close(): Promise<void> }> = [];
const content = '# 第一章\n\n林安拿起钥匙。\n'; const chapterPath = 'chapters/0001/0001.md';
const usage = { inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } };
type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;
function response(chunks: ProviderPart[]) { return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) }; }
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(invalidEvidence = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-settlement-backend-')); roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true }); await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: settlement\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, chapterPath), content);
  await git('git', ['init', '-b', 'main', root]); await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  const observations = { schemaVersion: 1, chapterId: '0001/0001', sourceHash: createChapterSettlementSource('0001/0001', content).sourceHash,
    observations: [{ id: 'key', category: 'item', subject: '林安', observation: '持有钥匙', confidence: 'high', evidence: { startLine: 3, endLine: 3, quote: invalidEvidence ? '未发生的计划' : '林安拿起钥匙。' } }], unresolvedAmbiguities: ['钥匙所有权未说明'] };
  const model = new MockLanguageModelV4({ doStream: [response([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'settlement', toolName: 'settlement.propose', input: JSON.stringify(observations) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage },
  ]), response([
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'report' },
    { type: 'text-delta', id: 'report', delta: '请审阅正文证据；钥匙所有权仍不明确。' }, { type: 'text-end', id: 'report' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ])] });
  const backend = await startNovelHttpBackend({ workspaceRoot: root, providerConfig: { id: 'settlement-test', kind: 'custom', model: 'settlement-test' }, resolveModel: () => model });
  servers.push(backend); return { root, backend, model };
}
async function chat(url: string, paths = [chapterPath], expectedStatus = 200) {
  const response = await fetch(`${url}/api/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    messages: [{ id: 'request', role: 'user', parts: [{ type: 'text', text: '/整理本章' }] }], editContext: { exactWritablePaths: paths },
  }) });
  expect(response.status).toBe(expectedStatus); return response.text();
}
async function pending(url: string) { return (await (await fetch(`${url}/api/workspace/pending-actions`)).json()) as { pendingActions: Array<{ id: string; origin: unknown; diff: string }> }; }

describe('default model-backed chapter settlement HTTP journey', () => {
  it('flows through real SDK, capability factory, SSE, persisted approval and canonical Accept', async () => {
    const f = await fixture(); const wire = await chat(f.backend.url);
    expect(wire).toContain('data-pending-action'); expect(wire).toContain('chapterSettlement');
    expect(wire).not.toContain('.workspace/change-engine');
    expect(f.model.doStreamCalls[0]!.tools?.map((tool) => 'name' in tool ? tool.name : '')).toEqual(['readFile', 'settlement.propose']);
    expect(JSON.stringify(f.model.doStreamCalls[0]!.prompt)).toContain('sourceHash:');
    const actions = (await pending(f.backend.url)).pendingActions; expect(actions).toHaveLength(1);
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    const accepted = await fetch(`${f.backend.url}/api/workspace/pending-actions/${actions[0]!.id}/accept`, { method: 'POST' });
    expect(await accepted.json()).toMatchObject({ pendingAction: { status: 'accepted' }, appliedFiles: ['state/chapters/0001/0001.yaml', 'summaries/chapter/0001/0001.md'] });
    expect(accepted.status).toBe(200);
    expect(await readFile(join(f.root, 'state/chapters/0001/0001.yaml'), 'utf8')).toContain('持有钥匙');
    expect(await readFile(join(f.root, chapterPath), 'utf8')).toBe(content);
  });
  it('returns conflict for stale chapter evidence and keeps candidate files absent', async () => {
    const f = await fixture(); await chat(f.backend.url); const action = (await pending(f.backend.url)).pendingActions[0]!;
    await writeFile(join(f.root, chapterPath), `${content}正文修改\n`);
    const response = await fetch(`${f.backend.url}/api/workspace/pending-actions/${action.id}/accept`, { method: 'POST' });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('fails closed on model evidence and an output path mistakenly supplied as the active chapter', async () => {
    const f = await fixture(true); const wire = await chat(f.backend.url);
    expect(wire).toContain('tool-output-error'); expect((await pending(f.backend.url)).pendingActions).toEqual([]);
    const count = f.model.doStreamCalls.length;
    const invalidSelectionWire = await chat(f.backend.url, ['summaries/chapter/0001/0001.md'], 400);
    expect(invalidSelectionWire).toContain('CHAPTER_SETTLEMENT_SELECTION_REQUIRED');
    expect(invalidSelectionWire).toContain('已编号的正文文件'); expect(f.model.doStreamCalls).toHaveLength(count);
    expect((await pending(f.backend.url)).pendingActions).toEqual([]);
  });
});
