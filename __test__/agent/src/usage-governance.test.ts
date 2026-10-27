import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import {
  completePlayRehearsalReferee,
  generateReferenceQuickPreview,
  runNovelAgentTurn,
  streamNovelAgentTurn,
  streamPlayRehearsalActorGeneration,
  runtimeEventsToUiMessageStream,
} from '@oh-awesome-novel/agent';
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

  it('records content-free usage and egress across Reference Quick Preview and Play Rehearsal pipelines (G7)', async () => {
    const root = await workspace();
    const previewJson = JSON.stringify({
      sourceOverview: 'Overview',
      chapterPreviews: [{ chapterId: 'ch-1', summary: 'Summary', evidenceRefs: ['ptr-1'], confidence: 'medium', uncertainty: null }],
      findings: [{ kind: 'hook', observation: 'Obs', technique: 'Tech', whenUseful: null, avoid: null, confidence: 'medium', evidenceRefs: ['ptr-1'], generalInference: false, uncertainty: null }],
      borrowablePatterns: [{ title: 'Pattern', technique: 'Tech', whenUseful: null, evidenceRefs: ['ptr-1'], confidence: 'medium' }],
      doNotCopy: ['No copy'],
      differentiationRequirements: ['Diff'],
      differentiationPrompts: ['Prompt'],
      canonContaminationWarnings: ['Warn'],
      confidence: 'medium',
      uncertainties: [],
    });
    const previewModel = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: previewJson }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 },
          outputTokens: { total: 45, text: 40, reasoning: 5 },
          raw: { secret: 'PREVIEW_RAW_SECRET' },
        },
        warnings: [],
      },
    });
    const previewResult = await generateReferenceQuickPreview({
      runId: 'ref-run-1',
      workspaceRoot: root,
      providerConfig: provider,
      resolveModel: () => previewModel,
      selection: {
        referenceId: 'ref-1',
        sourceChecksumSha256: 'a'.repeat(64),
        structureFingerprint: 'b'.repeat(64),
        maxChapters: 3,
        maxChars: 10_000,
        selectedChapterIds: ['ch-1'],
        omittedChapterIds: [],
        totalChars: 24,
        windows: [{
          pointerId: 'ptr-1',
          content: 'PRIVATE_REFERENCE_SOURCE',
          charLength: 24,
          pointer: {
            referenceId: 'ref-1',
            sourceChecksumSha256: 'a'.repeat(64),
            chapterId: 'ch-1',
            chunkId: 'chunk-1',
            lineStart: 1,
            lineEnd: 1,
          },
        }],
      },
    });
    expect(previewResult.status).toBe('completed');
    const refHistory = await readAgentGovernanceHistory(root, 'ref-run-1');
    expect(refHistory.diagnostics).toEqual([]);
    expect(refHistory.records).toEqual([
      expect.objectContaining({
        recordType: 'request',
        egress: { providerId: 'test', providerKind: 'custom', modelId: 'test', endpointOrigin: 'https://example.test', status: 'prepared' },
      }),
      expect.objectContaining({
        recordType: 'step',
        outcome: 'completed',
        actualUsage: { availability: 'actual', inputTokens: 120, outputTokens: 45, totalTokens: 165, cacheReadTokens: 20, cacheWriteTokens: 0, reasoningTokens: 5 },
      }),
      expect.objectContaining({
        recordType: 'turn',
        outcome: 'completed',
        actualCoverage: 'complete',
      }),
    ]);

    const actorEvents = [];
    for await (const event of streamPlayRehearsalActorGeneration({
      workspaceRoot: root,
      usageSessionId: 'play-rehearsal-1',
      providerConfig: provider,
      resolveModel: () => model(),
      sceneContract: {
        sceneId: 'scene-1',
        sceneRevision: 0,
        participantRefs: ['hero'],
        worldClock: { turn: 0, revision: 0 },
      },
      perception: {
        snapshotId: 'snap-1',
        participantRef: 'hero',
        displayName: 'Hero',
        sceneRevision: 0,
        visibleFacts: [{ ref: 'fact-1', fact: 'PRIVATE_PLAY_FACT' }],
        visibleEvents: [],
        behaviorAnchors: [],
        observedNarrativeBlockRefs: [],
      },
      selectedPriorVisibleBlocks: [],
    })) {
      actorEvents.push(event);
    }
    expect(actorEvents.at(-1)).toMatchObject({ type: 'finish' });

    const refereeResult = await completePlayRehearsalReferee({
      workspaceRoot: root,
      usageSessionId: 'play-rehearsal-1',
      providerConfig: provider,
      resolveModel: () => model(),
      prompt: 'PRIVATE_REFEREE_PROMPT',
    });
    expect(refereeResult.status).toBe('completed');

    const playHistory = await readAgentGovernanceHistory(root, 'play-rehearsal-1');
    expect(playHistory.diagnostics).toEqual([]);
    expect(playHistory.records.filter((r) => r.recordType === 'turn')).toHaveLength(2);
    const rawPlayAudit = await readFile(join(root, '.workspace/sessions/play-rehearsal-1/usage-stats.jsonl'), 'utf8');
    const rawRefAudit = await readFile(join(root, '.workspace/sessions/ref-run-1/usage-stats.jsonl'), 'utf8');
    for (const secret of ['PRIVATE_REFERENCE_SOURCE', 'PRIVATE_PLAY_FACT', 'PRIVATE_REFEREE_PROMPT', 'API_SECRET', 'QUERY_SECRET', 'PREVIEW_RAW_SECRET']) {
      expect(rawPlayAudit).not.toContain(secret);
      expect(rawRefAudit).not.toContain(secret);
    }
  });
});
