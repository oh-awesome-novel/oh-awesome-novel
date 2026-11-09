// @vitest-environment happy-dom
// Vue needs a renderer DOM, while the localhost Hono adapter needs Node Fetch classes.
vi.hoisted(async () => {
  const http = await import('undici');
  for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]);
});
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import type { OanClient, UsageInspectorScope } from '@oh-awesome-novel/client';

// Delegate to the real HTTP client. No Inspector records or model events are fabricated here.
const api = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
import PlayPhaseMemory from '../../../apps/desktop-ui/src/components/play/PlayPhaseMemory.vue';
import type { PlaySession } from '@oh-awesome-novel/client';
import DomainUsageInspector from '../../../apps/desktop-ui/src/components/usage/DomainUsageInspector.vue';
import { useUsagePresentation } from '../../../apps/desktop-ui/src/composables/useUsagePresentation';
import type { UsagePresentationRun } from '../../../apps/desktop-ui/src/composables/useUsagePresentation';

const git = promisify(execFile);
const roots: string[] = [];
const wrappers: VueWrapper[] = [];
const backends = new Set<Awaited<ReturnType<typeof startNovelHttpBackend>>>();
afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  for (const backend of backends) await backend.close();
  backends.clear();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  for (const key of Object.keys(api)) delete api[key];
});

const privateWorld = 'PRIVATE_WORLD_SOURCE_FOR_INSPECTOR_TEST';
const providerUsage = {
  inputTokens: { total: 41, noCache: 28, cacheRead: 13, cacheWrite: undefined },
  outputTokens: { total: 7, text: 7, reasoning: undefined },
};
type Part = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never;
function providerResponse(text = 'The gate closes.\n```oan-play-settlement\n'
    + JSON.stringify({ elapsed: 'PT1M', events: [], stateDelta: {}, observations: [], suggestedActions: [] }) + '\n```') {
  const chunks: Part[] = [
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text.slice(0, 12) },
    { type: 'text-delta', id: 'text', delta: text.slice(12) }, { type: 'text-end', id: 'text' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: providerUsage },
  ];
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
}
async function fixture(options: { phase?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oan-domain-usage-journey-')); roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'world'));
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Usage\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, 'world/rules.md'), `# 世界规则\n\n${privateWorld}\n`);
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'baseline']);
  const model = new MockLanguageModelV4({
    doStream: async input => {
      const prompt = JSON.stringify(input.prompt);
      const turns = /turnsCovered 必须为 (\d+)/u.exec(prompt);
      if (!options.phase || !turns) return providerResponse();
      return providerResponse(JSON.stringify({ version: 1, turnsCovered: Number(turns[1]), characters: [],
        chronicle: [{ fact: '门已关闭', quote: 'The gate closes.' }], unresolvedThreads: [],
        currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' },
        voiceAndStyle: { pov: 'third', rhythm: 'slow', tonePoints: [] }, resourceState: {} }));
    },
    doGenerate: async () => ({ content: [{ type: 'text', text: options.phase ? '[0]' : 'Synthetic comparison complete.' }],
      finishReason: { unified: 'stop', raw: 'stop' }, usage: providerUsage, warnings: [] }),
  });
  const modelConfig = { id: 'usage-model', contextWindow: 100_000, ...(options.phase ? { maxOutputTokens: 1024 } : {}) };
  const start = async () => {
    const backend = await startNovelHttpBackend({
      workspaceRoot: root, globalConfigDir: join(root, 'global-config'),
      providerConfig: { id: 'usage-provider', kind: 'custom', model: 'usage-model',
        baseUrl: 'https://provider.example/v1?token=PRIVATE_QUERY', models: [modelConfig] },
      resolveModel: () => model,
    });
    backends.add(backend);
    const client = createOanClient({ backendBaseUrl: backend.url });
    Object.assign(api, client);
    return { backend, client };
  };
  const { backend, client } = await start();
  const { session } = await client.createPlaySession({ id: 'usage-journey', title: 'Usage', sceneStart: 'At the gate', characters: [] });
  return { root, model, modelConfig, backend, client, start, session };
}

function view(root: string, sessionId: string) {
  const element = shallowRef<HTMLElement>();
  const run = shallowRef<UsagePresentationRun>();
  const narrative = shallowRef('');
  const scope: UsageInspectorScope = { domain: 'play', sessionId };
  const wrapper = mount(defineComponent({ setup() {
    const observation = useUsagePresentation({ identity: () => `${root}:${sessionId}`, run: () => run.value, element: () => element.value });
    return () => h('main', { ref: element }, [
      h('p', { 'data-usage-operation': run.value?.operationId }, narrative.value),
      h(DomainUsageInspector, { workspaceKey: root, scope, lens: 'director', operationId: run.value?.operationId, refreshKey: observation.revision.value }),
    ]);
  } }), { attachTo: document.body });
  wrappers.push(wrapper);
  async function turn(client: OanClient, baseRevision: number) {
    narrative.value = '';
    run.value = { localId: `local-${baseRevision}`, scope, startedAtMs: performance.now(), finished: false, responseIds: [] };
    let committed = false;
    for await (const event of client.streamPlayWorldRefereeTurn(sessionId, { userText: 'Wait at the gate.', actionKind: 'wait', baseRevision }, {
      onTurnId(operationId) { run.value = { ...run.value!, operationId }; },
    })) {
      if (event.type === 'play.narrative.delta') narrative.value += event.delta;
      if (event.type === 'play.turn.committed') { committed = true; run.value = { ...run.value!, finished: true }; }
      await nextTick();
    }
    expect(committed).toBe(true);
    await vi.waitFor(async () => expect((await client.getPlayUsageInspector(sessionId, { operationId: run.value!.operationId, lens: 'director' })).presentation).toHaveLength(1));
    return run.value!.operationId!;
  }
  return { wrapper, turn };
}

describe('default SDK through HTTP/SSE to domain usage Inspector', () => {
  it('shows persisted actual calls and independent rendered timing, then reopens them after Backend restart', async () => {
    const f = await fixture();
    const ui = view(f.root, f.session.id);
    const first = await ui.turn(f.client, 0);
    expect(f.model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(f.model.doStreamCalls[0])).toContain(privateWorld);
    const current = await f.client.getPlayUsageInspector(f.session.id, { operationId: first, lens: 'director' });
    expect(current.projection.calls).toHaveLength(1);
    expect(current.projection.calls[0]).toMatchObject({ status: 'completed', request: { operation: {
      domain: 'play', sessionId: f.session.id, operationId: first, stage: 'world',
    } }, step: { actualUsage: { inputTokens: 41, outputTokens: 7, cacheReadTokens: 13 }, timing: {
      startedAt: expect.any(String), completedAt: expect.any(String), firstResponseAt: expect.any(String),
    } } });
    expect(current.projection.totals.actualUsage.cacheWriteTokens).toBeUndefined();
    expect(current.presentation[0]).toMatchObject({ source: 'client-observed', operationId: first, elapsedMs: expect.any(Number) });
    for (const secret of [privateWorld, 'PRIVATE_QUERY', 'The gate closes.']) expect(JSON.stringify(current)).not.toContain(secret);
    await ui.wrapper.get('[aria-label="打开用量与上下文"]').trigger('click');
    await vi.waitFor(() => expect(ui.wrapper.find('.usage-summary').text()).toContain('1 次调用'));
    expect(ui.wrapper.text()).toContain('usage-model');
    expect(ui.wrapper.text()).toContain('首包');
    expect(ui.wrapper.text()).toContain('客户端观测');
    expect(ui.wrapper.find('.usage-summary').text()).toContain('未提供');
    expect(f.model.doGenerateCalls).toHaveLength(0); // Opening the Inspector cannot start a probe.

    const second = await ui.turn(f.client, 1);
    const secondCall = await f.client.getPlayUsageInspector(f.session.id, { operationId: second, lens: 'director' });
    expect(secondCall.projection.calls[0]?.fingerprintChange.status).toBe('unchanged');
    await ui.wrapper.get('[aria-label="用量查看范围"]').setValue('history');
    await vi.waitFor(() => expect(ui.wrapper.find('.usage-summary').text()).toContain('2 次调用'));
    expect((await f.client.getPlayUsageInspector(f.session.id, { lens: 'director' })).projection.totals.actualUsage.inputTokens).toBe(82);
    ui.wrapper.unmount(); wrappers.splice(wrappers.indexOf(ui.wrapper), 1);
    await f.backend.close(); backends.delete(f.backend);
    const reopened = await f.start();
    const restored = await reopened.client.getPlayUsageInspector(f.session.id, { lens: 'director' });
    expect(restored.projection.calls).toHaveLength(2);
    expect(restored.projection.totals.actualUsage.inputTokens).toBe(82);
    expect(restored.presentation).toHaveLength(2);
    const player = await reopened.client.getPlayUsageInspector(f.session.id, { lens: 'player' });
    expect(JSON.stringify(player)).not.toContain('world/rules.md');
    expect(await readFile(join(f.root, 'world/rules.md'), 'utf8')).toContain(privateWorld);
  });

  it('runs exactly two synthetic requests only after the author starts the comparison', async () => {
    const f = await fixture();
    const ui = view(f.root, f.session.id);
    await ui.wrapper.get('[aria-label="打开用量与上下文"]').trigger('click');
    await flushPromises();
    const probeToggle = ui.wrapper.findAll('button').find(button => button.text() === '打开模型对照')!;
    await probeToggle.trigger('click');
    await vi.waitFor(() => expect(ui.wrapper.text()).toContain('usage-model'));
    expect(f.model.doGenerateCalls).toHaveLength(0);
    const start = ui.wrapper.findAll('button').find(button => button.text() === '运行 2 次合成样例')!;
    await start.trigger('click');
    await vi.waitFor(() => expect(ui.wrapper.text()).toContain('两次调用已完成'));
    expect(f.model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(f.model.doGenerateCalls)).not.toContain(privateWorld);
    expect((await f.client.getPlayUsageInspector(f.session.id)).projection.calls).toHaveLength(0);
    expect((await git('git', ['-C', f.root, 'diff', '--', 'world/rules.md'])).stdout).toBe('');
  });
});


describe('Play phase memory through default SDK, HTTP and Desktop', () => {
  it('reviews pressure, continues twice, then reopens and recalls only selected historical evidence', async () => {
    const f = await fixture({ phase: true });
    const advance = async (session: PlaySession, text: string) => {
      for await (const event of f.client.streamPlayWorldRefereeTurn(session.id, { userText: text, baseRevision: session.revision, actionKind: 'do' })) {
        if (event.type === 'play.turn.failed') throw new Error(JSON.stringify(event));
      }
      const next = (await f.client.getPlaySession(session.id)).session;
      expect(next.revision).toBe(session.revision + 1);
      return next;
    };
    let session = f.session;
    for (const text of ['EARLY_GATE_KEY', 'RECENT_ACTION_ONE', 'RECENT_ACTION_TWO']) session = await advance(session, text);
    const baseline = await f.client.getPlayPhases(session.id);
    expect(baseline.budget.previousRequestTokens).toBeGreaterThan(0);
    // Reconfigure the model's real window to exercise the local threshold with room for the archive request.
    f.modelConfig.contextWindow = Math.ceil(Math.max(baseline.budget.previousRequestTokens!, baseline.budget.estimatedTokens) / 0.86) + 1024;
    const ui = mount(PlayPhaseMemory, { attachTo: document.body, props: { workspaceKey: f.root, session, lens: 'director' } });
    wrappers.push(ui);
    await vi.waitFor(() => expect(ui.text()).toContain('已接近输入预算'));
    expect(f.model.doStreamCalls).toHaveLength(3);
    await ui.findAll('button').find(b => b.text() === '剧情归档')!.trigger('click');
    await vi.waitFor(() => expect(ui.text()).toContain('门已关闭'));
    expect(ui.emitted('continued')).toBeUndefined();
    await ui.findAll('button').find(b => b.text() === '确认存档并开启新阶段')!.trigger('click');
    await vi.waitFor(() => expect(ui.emitted('continued')).toHaveLength(1));
    let child = ui.emitted('continued')![0]![0] as PlaySession;
    f.modelConfig.contextWindow = 100_000;
    for (const input of ['follow-up one', 'follow-up two']) {
      child = await advance(child, input);
      const prompt = JSON.stringify(f.model.doStreamCalls.at(-1)!.prompt);
      expect(prompt).not.toContain('EARLY_GATE_KEY');
      expect(prompt.match(/<前情提要>/gu)).toHaveLength(1);
      expect(prompt).toContain('RECENT_ACTION_ONE');
    }
    expect((await f.client.getPlaySession(session.id)).session.revision).toBe(3);
    await f.backend.close(); backends.delete(f.backend);
    const reopened = await f.start();
    await ui.setProps({ session: (await reopened.client.getPlaySession(child.id)).session, lens: 'player' });
    await vi.waitFor(() => expect(ui.text()).toContain('历史阶段'));
    await ui.get('select').setValue(session.id);
    await ui.get('input[maxlength]').setValue('EARLY_GATE_KEY');
    await ui.get('form').trigger('submit');
    await vi.waitFor(() => expect(ui.get('blockquote').text()).toBe('EARLY_GATE_KEY'));
    expect(ui.text()).toContain('SHA-256');
    expect(f.model.doGenerateCalls).toHaveLength(0);
    await ui.findAll('button').find(b => b.text().includes('让当前模型'))!.trigger('click');
    await vi.waitFor(() => expect(ui.text()).toContain('模型选中 1 条证据'));
    expect(f.model.doGenerateCalls).toHaveLength(1);
    const call = f.model.doGenerateCalls[0]!;
    expect(call.tools ?? []).toHaveLength(0);
    expect(JSON.stringify(call.prompt)).toContain('EARLY_GATE_KEY');
    expect(JSON.stringify(call.prompt)).not.toContain('RECENT_ACTION_ONE');
    expect(JSON.stringify(call.prompt)).not.toContain(privateWorld);
  }, 20_000);
});
