import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { MockLanguageModelV3 } from 'ai/test';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import type { NovelBackendOptions } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import { appendAgentUsageRecord, importReferenceWork } from '@oh-awesome-novel/core';
import type { ModelRequestUsageRecord, ModelStepUsageRecord, UsageOperation } from '@oh-awesome-novel/core';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const provider = { id: 'synthetic-provider', kind: 'custom' as const, model: 'synthetic-model', baseUrl: 'https://example.com/v1/private?secret=DO_NOT_SHOW', apiKey: 'PRIVATE_API_KEY' };
const sessionId = 'usage-session';
const sessionPath = `/api/workspace/play-sessions/${sessionId}`;
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function fixture(options: Partial<NovelBackendOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oan-domain-usage-')); roots.push(root);
  const app = createNovelHonoApp({ workspaceRoot: root, providerConfig: provider, ...options });
  const created = await app.request('/api/workspace/play-sessions', post({ id: sessionId, title: 'A private story title', sceneStart: 'At the gate' }));
  expect(created.status, await created.clone().text()).toBe(200);
  const client = createOanClient({ backendBaseUrl: 'http://127.0.0.1', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch });
  return { root, app, client };
}

async function seed(root: string, usageSessionId: string, turnId: string, operation: UsageOperation, offset = 0) {
  const createdAt = new Date(Date.UTC(2026, 10, 6, 0, 0, offset)).toISOString();
  const source = { sourceId: 'SecretVillain', kind: 'character', path: 'characters/hidden-villain/profile.md', sourceHash: 'b'.repeat(64), payloadHash: 'c'.repeat(64), budgetLayer: 'L1' as const, semanticBoundary: 'protected' as const, outcome: 'selected' as const, reason: 'selected' as const, modelVisibleChars: 3, estimatedTokens: 1, estimator: 'utf8-bytes-div-3-v1' as const };
  const request: ModelRequestUsageRecord = {
    schemaVersion: 1, recordType: 'request', sessionId: usageSessionId, turnId, stepIndex: 0, createdAt, operation,
    fingerprint: { prefixHash: 'a'.repeat(64), prefixKind: 'frozen-system', toolSchemaHash: 'd'.repeat(64) },
    request: { messageCount: 1, messages: [{ index: 0, role: 'user', chars: 3, estimatedTokens: 1, sourceRefs: [`${source.sourceId}:${source.path}`] }], estimatedMessageTokens: 1, estimatedRequestTokens: 2, toolCount: 0, estimator: 'utf8-bytes-div-3-v1', estimationScope: 'messages-tools-json-with-20-percent-margin' },
    budget: { status: 'within', inputTokens: 100, estimatedRequestTokens: 2 }, sources: [source],
  };
  const step: ModelStepUsageRecord = { schemaVersion: 1, recordType: 'step', sessionId: usageSessionId, turnId, stepIndex: 0, createdAt,
    actualUsage: { availability: 'actual', inputTokens: 10, outputTokens: 5, totalTokens: 15 }, outcome: 'completed',
    timing: { startedAt: createdAt, completedAt: createdAt },
  };
  await appendAgentUsageRecord(root, usageSessionId, request);
  await appendAgentUsageRecord(root, usageSessionId, step);
  return { request, step };
}

function modelResult() {
  return {
    content: [{ type: 'text' as const, text: 'OK' }], finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: { inputTokens: { total: 2000, noCache: 1900, cacheRead: 100, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } }, warnings: [],
  };
}

describe('Play and Reference usage inspector transport', () => {
  it('filters physical calls, keeps comparison history, and sanitizes both Player payload branches', async () => {
    const h = await fixture();
    const op = { domain: 'play' as const, sessionId, operationId: 'turn-one', runId: 'turn-one', stage: 'world', contextTraceId: 'turn-artifact-one' };
    await seed(h.root, `play-${sessionId}`, 'call-one', op);
    const second = await seed(h.root, `play-${sessionId}`, 'call-two', { ...op, operationId: 'turn-two', runId: 'turn-two' }, 1);
    await appendAgentUsageRecord(h.root, `play-${sessionId}`, second.step);
    await seed(h.root, `play-${sessionId}`, 'call-other', { ...op, sessionId: 'other-session' }, 2);
    const result = await h.client.getPlayUsageInspector(sessionId, { lens: 'director', operationId: 'turn-two' });
    expect(result.projection.calls).toHaveLength(1);
    expect(result.projection.calls[0]!.fingerprintChange).toMatchObject({ status: 'unchanged', comparedWith: 'call-one.0' });
    expect(result.projection.totals.actualUsage.totalTokens).toBe(15);
    expect(result.projection.diagnostics).toContain('duplicate-records');
    expect(result.projection.calls[0]!.request!.sources[0]!.path).toContain('hidden-villain');
    const player = await h.client.getPlayUsageInspector(sessionId);
    const serialized = JSON.stringify(player);
    expect(serialized).not.toContain('SecretVillain'); expect(serialized).not.toContain('hidden-villain');
    expect(serialized).not.toContain('b'.repeat(64)); expect(serialized).not.toContain('c'.repeat(64));
    expect(serialized).not.toContain('turn-artifact-one'); expect(serialized).not.toContain('other-session');
    expect(player.projection.totals.actualUsage.totalTokens).toBe(30);
    expect(player.projection.calls[0]!.step!.actualUsage).not.toHaveProperty('cacheReadTokens');
    const restarted = createNovelHonoApp({ workspaceRoot: h.root });
    expect((await (await restarted.request(`${sessionPath}/usage?lens=director`)).json()).projection.calls).toHaveLength(2);
  });

  it('removes internal draft paths for Director and preserves honest truncated/unassociated coverage', async () => {
    const h = await fixture();
    const records = await seed(h.root, `play-${sessionId}`, 'private-call', { domain: 'play', sessionId, operationId: 'private-op', stage: 'world' });
    const request = { ...records.request, turnId: 'internal-call', sources: [{ ...records.request.sources[0]!, path: '.workspace/change-engine/v1/drafts/private.txt' }] };
    request.request = { ...request.request, messages: [{ ...request.request.messages[0]!, sourceRefs: ['SecretVillain:.workspace/change-engine/v1/drafts/private.txt'] }] };
    await appendAgentUsageRecord(h.root, `play-${sessionId}`, request);
    await appendAgentUsageRecord(h.root, `play-${sessionId}`, { ...records.step, turnId: 'internal-call' });
    const director = await h.client.getPlayUsageInspector(sessionId, { lens: 'director' });
    expect(JSON.stringify(director)).not.toContain('.workspace');
    const partial = await h.client.getPlayUsageInspector(sessionId, { lens: 'director', limit: 1 });
    expect(partial.history.truncated).toBe(true);
    expect(partial.projection.calls).toEqual([]);
    expect(partial.projection.diagnostics).toContain('unmatched-records');
    expect(partial.projection.totals.actualUsage.availability).toBe('unavailable');
  });

  it('stores client-visible duration separately and idempotently after a known operation', async () => {
    const h = await fixture();
    await seed(h.root, `play-${sessionId}`, 'call-one', { domain: 'play', sessionId, operationId: 'visible-operation', stage: 'world' });
    const path = join(h.root, '.workspace/sessions', `play-${sessionId}`, 'usage-stats.jsonl');
    const before = await readFile(path, 'utf8');
    const first = await h.client.recordPlayUsagePresentation(sessionId, { operationId: 'visible-operation', elapsedMs: 120 });
    const replay = await h.client.recordPlayUsagePresentation(sessionId, { operationId: 'visible-operation', elapsedMs: 999 });
    expect(replay).toEqual(first); expect(first.observation.source).toBe('client-observed');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await h.client.getPlayUsageInspector(sessionId)).presentation).toEqual([first.observation]);
    expect((await h.app.request(`${sessionPath}/usage/presentation`, post({ operationId: 'visible-operation', elapsedMs: 10, source: 'provider' }))).status).toBe(400);
    expect((await h.app.request(`${sessionPath}/usage/presentation`, post({ operationId: 'unknown-operation', elapsedMs: 10 }))).status).toBe(409);
    expect((await h.app.request(`${sessionPath}/usage?limit=101`)).status).toBe(400);
    expect((await h.app.request(`${sessionPath}/usage?lens=director&lens=player`)).status).toBe(400);
    expect((await h.app.request(`${sessionPath}/usage?path=/private/secret`)).status).toBe(400);
  });

  it('retains current presentation receipts after a thousand older observations', async () => {
    const h = await fixture();
    const dir = join(h.root, '.workspace/sessions', 'play-' + sessionId, 'presentation');
    await mkdir(dir, { recursive: true });
    for (let group = 0; group < 20; group++) {
      await Promise.all(Array.from({ length: 50 }, (_, i) => writeFile(join(dir, (group * 50 + i).toString(16).padStart(64, '0') + '.json'), '{}')));
    }
    await seed(h.root, 'play-' + sessionId, 'current-call', { domain: 'play', sessionId, operationId: 'current-op', stage: 'world' });
    const receipt = await h.client.recordPlayUsagePresentation(sessionId, { operationId: 'current-op', elapsedMs: 25 });
    expect(receipt.observation.elapsedMs).toBe(25);
    expect((await readdir(dir)).length).toBeLessThan(1000);
    expect((await h.client.getPlayUsageInspector(sessionId)).presentation).toEqual([receipt.observation]);
  });

  it('binds Reference unit/retry operations to their real run without requiring a model call', async () => {
    const h = await fixture();
    const imported = await importReferenceWork({ workspaceRoot: h.root, title: 'Reference', sourceText: '第一章\n雨夜里有人敲门。', rights: 'owned' });
    const created = await h.app.request(`/api/workspace/references/${imported.reference.id}/deconstruction-runs`, post({ mode: 'quickPreview', baseRunRevision: 0, idempotencyKey: 'create-usage-run' }));
    expect(created.status, await created.clone().text()).toBe(200);
    const runId = (await created.json()).run.id as string;
    const op = { domain: 'reference' as const, referenceId: imported.reference.id, runId, operationId: 'advance-attempt-one', stage: 'chapterAnalysis', unitId: 'chapter-unit', attemptId: 'attempt-one' };
    await seed(h.root, runId, 'reference-call-one', op);
    await seed(h.root, runId, 'reference-call-two', { ...op, operationId: 'advance-attempt-two', attemptId: 'attempt-two' }, 1);
    const result = await h.client.getReferenceUsageInspector(imported.reference.id, runId, { operationId: 'advance-attempt-two', unitId: 'chapter-unit' });
    expect(result.projection.calls).toHaveLength(1);
    expect(result.projection.calls[0]!.request!.operation).toMatchObject({ attemptId: 'attempt-two' });
    expect(result.projection.totals.actualUsage.totalTokens).toBe(15);
    const restarted = createNovelHonoApp({ workspaceRoot: h.root });
    expect((await restarted.request(`/api/workspace/references/${imported.reference.id}/deconstruction-runs/${runId}/usage`)).status).toBe(200);
  });

  it('runs exactly two explicit synthetic samples and reopens them without replay or novel data', async () => {
    const doGenerate = vi.fn(async () => modelResult());
    const model = new MockLanguageModelV3({ doGenerate });
    const h = await fixture({ resolveModel: async () => model });
    await mkdir(join(h.root, '.oan/constitution'), { recursive: true });
    await writeFile(join(h.root, '.oan/constitution/private.md'), 'PRIVATE_NOVEL_SOURCE_DO_NOT_SEND');
    const options = await h.client.getUsageProbeOptions();
    expect(JSON.stringify(options)).not.toContain('PRIVATE_API_KEY');
    expect(JSON.stringify(options)).not.toContain('/v1/private');
    expect(doGenerate).not.toHaveBeenCalled();
    const probe = await h.client.createUsageProbe({ domain: 'play', sessionId }, { expectedProviderId: provider.id, expectedModelId: provider.model });
    expect(doGenerate).not.toHaveBeenCalled();
    const result = await h.client.runUsageProbe(probe.id);
    expect(result.status).toBe('completed'); expect(result.probe.completedCalls).toBe(2);
    expect(result.projection.totals.callCount).toBe(2);
    expect(doGenerate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(doGenerate.mock.calls)).not.toContain('PRIVATE_NOVEL_SOURCE_DO_NOT_SEND');
    expect(JSON.stringify(doGenerate.mock.calls)).not.toContain('A private story title');
    expect(JSON.stringify(doGenerate.mock.calls[0])).toBe(JSON.stringify(doGenerate.mock.calls[1]));
    expect((await h.client.runUsageProbe(probe.id)).status).toBe('completed');
    expect(doGenerate).toHaveBeenCalledTimes(2);
    expect((await h.client.getPlayUsageInspector(sessionId)).projection.calls).toEqual([]);
    const restarted = createNovelHonoApp({ workspaceRoot: h.root, providerConfig: provider, resolveModel: async () => model });
    expect((await (await restarted.request(`/api/workspace/usage-probes/${probe.id}`)).json()).status).toBe('completed');
  });

  it('cancels a comparison without starting its second sample', async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const doGenerate = vi.fn(async () => { entered(); await gate; return modelResult(); });
    const h = await fixture({ resolveModel: async () => new MockLanguageModelV3({ doGenerate }) });
    const probe = await h.client.createUsageProbe({ domain: 'play', sessionId });
    const running = h.client.runUsageProbe(probe.id);
    try {
      await started;
      await h.client.cancelUsageProbe(probe.id);
    } finally { release(); }
    const result = await running;
    expect(result.status).toBe('aborted');
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('does not replay a claimed probe after restart when its terminal state is unknown', async () => {
    const doGenerate = vi.fn(async () => modelResult());
    const h = await fixture({ resolveModel: async () => new MockLanguageModelV3({ doGenerate }) });
    const probe = await h.client.createUsageProbe({ domain: 'play', sessionId });
    await writeFile(join(h.root, '.workspace/usage-probes', `${probe.id}.claim.json`), JSON.stringify({ pid: 99_999_999, startedAt: '2026-11-06T00:00:00.000Z' }));
    const restarted = createNovelHonoApp({ workspaceRoot: h.root, providerConfig: provider, resolveModel: async () => new MockLanguageModelV3({ doGenerate }) });
    expect((await (await restarted.request(`/api/workspace/usage-probes/${probe.id}`)).json()).status).toBe('unknown');
    expect((await restarted.request(`/api/workspace/usage-probes/${probe.id}/run`, { method: 'POST' })).status).toBe(409);
    expect(doGenerate).not.toHaveBeenCalled();
  });
});
