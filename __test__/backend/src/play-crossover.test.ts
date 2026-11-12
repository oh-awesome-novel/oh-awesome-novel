import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import { crossoverFixture } from '../../core/src/fixtures/crossover';

it('uses the default SDK and HTTP/SSE to freeze a contract, acquire knowledge, trace works and reopen the branch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oan-crossover-http-'));
  let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const git = promisify(execFile);
    await git('git', ['init', '-b', 'main', root]);
    await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'baseline']);
    await mkdir(join(root, '.oan')); await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Crossover\n');
    const input = await crossoverFixture(root);
    const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
    const reply = `b1 讲述自己的来历。\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [{ kind: 'informationSpread', origin: 'npc', title: '介绍来历', summary: 'a1 听完介绍。', visibility: 'playerVisible', cause: { reason: '当面交流' } }],
      stateDelta: {}, observations: [], suggestedActions: [], knowledgeChanges: [{ type: 'learnSource', participantRef: 'a1', sourceId: 'b1', eventRef: 1 }] })}\n\`\`\``;
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: reply }, { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ], initialDelayInMs: null, chunkDelayInMs: null }) }) });
    backend = await startNovelHttpBackend({ workspaceRoot: root, globalConfigDir: join(root, 'global'),
      providerConfig: { id: 'test', kind: 'custom', model: 'controlled', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model });
    let client = createOanClient({ backendBaseUrl: backend.url });
    const { launchPackage } = await client.previewPlayLaunchPackage(input);
    expect(launchPackage.crossover?.works.map(w => w.title)).toEqual(['甲作', '乙作']);
    await client.createPlayLaunchPackage(launchPackage);
    const { session } = await client.startPlaySessionFromLaunchPackage({ launchPackageId: launchPackage.id, id: 'cross' });
    expect(session.activatedSources[0]?.originWork?.title).toBe('甲作');
    const events = [];
    for await (const event of client.streamPlayWorldRefereeTurn('cross', { userText: '请介绍来历', actionKind: 'say', baseRevision: 0 })) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'play.turn.committed' }));
    expect(JSON.stringify(model.doStreamCalls[0])).toContain('learnSource');
    expect(JSON.stringify(model.doStreamCalls[0])).toContain('sourceIds');
    const settled = (await client.getPlaySession('cross')).session;
    expect(settled.playLocalState.playKnowledge).toMatchObject({ records: [expect.objectContaining({ kind: 'sourceGrant', participantRef: 'a1', sourceId: 'b1', learnedAtTurnId: 'turn-1-referee' })] });
    const traces = await client.listPlayContextTraces('cross');
    expect(traces.traces[0]!.sources.filter(s => s.outcome === 'selected').map(s => s.originWork?.title)).toEqual(expect.arrayContaining(['甲作', '乙作']));
    const reuse = await client.getPlayLaunchReuseSeed('cross');
    expect(reuse.seed.kind === 'guided' && reuse.seed.launch.crossover).toEqual(input.crossover);
    await backend.close(); backend = await startNovelHttpBackend({ workspaceRoot: root });
    client = createOanClient({ backendBaseUrl: backend.url });
    expect((await client.getPlaySession('cross')).session.playLocalState).toEqual(settled.playLocalState);
    const restored = await client.restorePlayCheckpoint('cross', 'initial-world', { baseRevision: 1 });
    expect(restored.session.playLocalState.playKnowledge).toBeUndefined();
  } finally { await backend?.close(); await rm(root, { recursive: true, force: true }); }
}, 20_000);
