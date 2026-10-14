import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { evaluateAggregateSummaries } from '@oh-awesome-novel/core';
import { parsePendingActionViewListEnvelope } from '@oh-awesome-novel/client';
import { settledSummaryFiles, appendSummary, summaryDraft } from '../../fixtures/summary-generation';

const git = promisify(execFile); const roots: string[] = []; const servers: Array<{ close(): Promise<void> }> = [];
const volumePath = 'summaries/volume/0001.md'; const globalPath = 'summaries/global.md'; const chapterPath = 'chapters/0001/0001.md';
const usage = { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } };
type Part = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never;
const response = (chunks: Part[]) => ({ stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) });
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture(options: { global?: boolean; incomplete?: boolean; invalid?: boolean; autoCommit?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oan-summary-http-')); roots.push(root);
  const files = settledSummaryFiles();
  if (options.global) appendSummary(files, volumePath);
  if (options.incomplete) files.push({ path: 'chapters/0001/0002.md', content: '未结算章节' });
  await mkdir(join(root, '.oan'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), `version: 1\nnovelName: Summary test\ngit:\n  autoCommitOnAccept: ${options.autoCommit === true}\n`);
  for (const file of files) { await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), file.content); }
  await git('git', ['init', '-b', 'main', root]); await git('git', ['-C', root, 'config', 'user.name', 'Test']); await git('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  await git('git', ['-C', root, 'add', '.']); await git('git', ['-C', root, 'commit', '-m', 'baseline']);
  const targetPath = options.global ? globalPath : volumePath;
  const draft = summaryDraft(files, targetPath);
  if (options.invalid) draft.paragraphs[0]!.sourcePaths = ['outline/main.md'];
  let step = 0;
  const model = new MockLanguageModelV4({ doStream: async (call) => {
    step++;
    if (options.incomplete) expect(call.tools ?? []).toHaveLength(0);
    else expect(call.tools?.map((item) => item.name)).toEqual(['summary.propose']);
    return !options.incomplete && step % 2 === 1 ? response([
      { type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: `summary-${step}`, toolName: 'summary.propose', input: JSON.stringify(draft) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage },
    ]) : response([
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'report' },
      { type: 'text-delta', id: 'report', delta: options.incomplete ? '缺少章级来源，请先整理本章。' : '请审阅摘要及其来源。' }, { type: 'text-end', id: 'report' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]);
  } });
  const start = () => startNovelHttpBackend({ workspaceRoot: root, providerConfig: { id: 'summary-test', kind: 'custom', model: 'summary-test' }, resolveModel: () => model });
  let backend = await start(); servers.push(backend);
  return { root, files, targetPath, model, get backend() { return backend; }, async reopen() {
    await backend.close(); servers.splice(servers.indexOf(backend), 1); backend = await start(); servers.push(backend);
  } };
}
async function chat(url: string, global = false, paths = global ? [] : [chapterPath]) {
  return fetch(`${url}/api/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    messages: [{ id: 'summary-request', role: 'user', parts: [{ type: 'text', text: global ? '/整理全书' : '/整理本卷' }] }], editContext: { exactWritablePaths: paths },
  }) });
}
async function pending(url: string) { return parsePendingActionViewListEnvelope(await (await fetch(`${url}/api/workspace/pending-actions`)).json()).pendingActions; }
async function decide(url: string, id: string, decision: 'accept' | 'reject') { return fetch(`${url}/api/workspace/pending-actions/${id}/${decision}`, { method: 'POST' }); }

describe('SDK → HTTP/SSE → summary review → Accept', () => {
  it.each([false, true])('persists only after approval, survives restart, and exposes strict public origin: global=%s', async (global) => {
    const f = await fixture({ global }); const head = (await git('git', ['-C', f.root, 'rev-parse', 'HEAD'])).stdout;
    const res = await chat(f.backend.url, global); expect(res.status).toBe(200); const wire = await res.text();
    expect(wire).toContain('data-pending-action'); expect(wire).not.toContain('.workspace/change-engine');
    const actions = await pending(f.backend.url); expect(actions).toHaveLength(1);
    expect(actions[0]!.changes.map((change) => change.path)).toEqual([f.targetPath]);
    expect(actions[0]!.origin).toMatchObject({ kind: 'summaryGeneration', targetPath: f.targetPath });
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
    await f.reopen(); expect(await pending(f.backend.url)).toEqual(actions);
    const accepted = await decide(f.backend.url, actions[0]!.id, 'accept'); expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ pendingAction: { status: 'accepted' }, appliedFiles: [f.targetPath], receipt: { git: { status: 'not-requested' } } });
    const content = await readFile(join(f.root, f.targetPath), 'utf8');
    expect(evaluateAggregateSummaries({ files: [...f.files, { path: f.targetPath, content }] }).find((item) => item.path === f.targetPath)?.status).toBe('current');
    expect((await git('git', ['-C', f.root, 'rev-parse', 'HEAD'])).stdout).toBe(head);
    await f.reopen();
    const detail = await (await fetch(`${f.backend.url}/api/workspace/pending-actions/${actions[0]!.id}`)).json();
    expect(detail).toMatchObject({ pendingAction: { status: 'accepted' } });
    expect(await readFile(join(f.root, f.targetPath), 'utf8')).toBe(content);
  });
  it.each(['body', 'inventory', 'volume'])('rejects stale %s source after Backend restart', async (change) => {
    const f = await fixture({ global: true }); const response = await chat(f.backend.url, true);
    expect(response.status).toBe(200); await response.text();
    const actions = await pending(f.backend.url); const action = actions[0]!;
    if (change === 'body') await writeFile(join(f.root, chapterPath), '正文改动');
    if (change === 'inventory') await writeFile(join(f.root, 'chapters/0001/0002.md'), '新增章');
    if (change === 'volume') await writeFile(join(f.root, volumePath), '手工修改卷摘要');
    await f.reopen(); const accepted = await decide(f.backend.url, action.id, 'accept');
    expect(accepted.status).toBe(409); expect(await accepted.text()).toContain('STALE_PENDING_ACTION_BASELINE');
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('Reject, incomplete input and invalid references leave canonical files untouched', async () => {
    const f = await fixture(); await (await chat(f.backend.url)).text(); const [action] = await pending(f.backend.url);
    expect((await decide(f.backend.url, action!.id, 'reject')).status).toBe(200);
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const options of [{ incomplete: true }, { invalid: true }]) {
      const rejected = await fixture(options); await (await chat(rejected.backend.url)).text();
      expect(await pending(rejected.backend.url)).toEqual([]);
      await expect(readFile(join(rejected.root, rejected.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
  it('rejects an ambiguous volume selection before invoking the provider', async () => {
    const f = await fixture(); const res = await chat(f.backend.url, false, []);
    expect(res.status).toBe(400); expect(await res.text()).toContain('SUMMARY_VOLUME_SELECTION_REQUIRED');
    expect(f.model.doStreamCalls).toHaveLength(0);
  });
  it('uses configured automatic Git commit for the approved summary', async () => {
    const f = await fixture({ autoCommit: true }); await (await chat(f.backend.url)).text(); const [action] = await pending(f.backend.url);
    const res = await decide(f.backend.url, action!.id, 'accept'); expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ receipt: { git: { status: 'committed' } } });
    expect((await git('git', ['-C', f.root, 'show', '--format=', '--name-only', 'HEAD'])).stdout.trim()).toBe(volumePath);
  });
});
