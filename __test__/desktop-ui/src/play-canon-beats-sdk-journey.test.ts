// @vitest-environment happy-dom
// Vue needs a renderer DOM, while the localhost Hono adapter needs Node Fetch classes.
vi.hoisted(async () => {
  const http = await import('undici');
  for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]);
});
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient, projectPlayCanonBeatTable } from '@oh-awesome-novel/client';
import type { FileTreeNode, WorkspaceSummary } from '@oh-awesome-novel/client';

// The Desktop talks to the real HTTP client; nothing about the turn is faked below the model.
const api = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';

const git = promisify(execFile);
const roots: string[] = [];
const wrappers: VueWrapper[] = [];
const backends: Array<Awaited<ReturnType<typeof startNovelHttpBackend>>> = [];
afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  for (const backend of backends.splice(0)) await backend.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  for (const key of Object.keys(api)) delete api[key];
  localStorage.clear();
});

const TIMELINE = 'events:\n  - id: e1\n    date: 七月十七日\n    title: 码头仓库暑期读书会\n  - id: e2\n    date: 七月十七日夜\n    title: 仓库深夜起火\n';
const files: FileTreeNode[] = [
  { name: 'chapters', path: 'chapters', type: 'directory', children: [{ name: 'opening.md', path: 'chapters/opening.md', type: 'file' }] },
  { name: 'timeline', path: 'timeline', type: 'directory', children: [{ name: 'events.yaml', path: 'timeline/events.yaml', type: 'file' }] },
];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
type Part = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never;
const stream = (text: string) => {
  const chunks: Part[] = [
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text }, { type: 'text-end', id: 'text' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ];
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-canon-journey-'));
  roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'chapters'), { recursive: true });
  await mkdir(join(root, 'timeline'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Canon\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, 'chapters/opening.md'), '雾港的夏天。\n');
  await writeFile(join(root, 'timeline/events.yaml'), TIMELINE);
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'baseline']);
  const prompts: string[] = [];
  const reply = (prompt: string) => {
    prompts.push(prompt);
    return `铁门上多了一把新锁。\n\`\`\`oan-play-settlement\n${JSON.stringify({
      events: [{ kind: 'npcActed', origin: 'npc', title: '巡查封门', summary: '巡查给铁门上了锁。', visibility: 'playerVisible', cause: { reason: '你报告了隐患。' } }],
      canonBeatChanges: [{ beatId: 'canon-beat-2', status: 'prevented', reason: '那栋楼在夜里之前就被封了。', eventRefs: [1] }],
      stateDelta: {}, observations: [], suggestedActions: ['[look] 看看四周'],
    })}\n\`\`\``;
  };
  const model = new MockLanguageModelV4({
    doStream: async (input) => stream(reply(JSON.stringify(input.prompt))),
    doGenerate: async (input) => ({
      content: [{ type: 'text', text: reply(JSON.stringify(input.prompt)) }],
      finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
    }),
  });
  const backend = await startNovelHttpBackend({
    workspaceRoot: root, globalConfigDir: join(root, 'global-config'),
    providerConfig: { id: 'journey', kind: 'custom', model: 'journey-model', baseUrl: 'https://provider.example/v1', models: [{ id: 'journey-model', contextWindow: 100_000 }] },
    resolveModel: () => model,
  });
  backends.push(backend);
  const client = createOanClient({ backendBaseUrl: backend.url });
  Object.assign(api, client);
  return { root, client, prompts };
}

const button = (wrapper: VueWrapper, label: string) => {
  const target = wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
  if (!target) throw new Error(`Missing button containing: ${label}`);
  return target;
};
const sourceCheckbox = (wrapper: VueWrapper, path: string) => wrapper.findAll('.source-tree li')
  .find((item) => item.text().includes(path))!.get('input[type="checkbox"]');

async function refresh(wrapper: VueWrapper) {
  await vi.waitFor(async () => {
    await wrapper.get('[aria-label="刷新推演工作区"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[role=alert]').map((node) => node.text()).join('')).not.toContain('being modified');
  }, { timeout: 3000 });
  await vi.waitFor(() => expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined(), { timeout: 3000 });
}

describe('canon beats through default SDK, HTTP/SSE and Desktop', () => {
  it('picks beats, plays a turn, shows the divergence to the Director only, and reports it', async () => {
    const f = await fixture();
    const workspace: WorkspaceSummary = { name: 'canon', novelName: 'Canon', path: f.root, valid: true };
    const wrapper = mount(PlayWorkspace, { attachTo: document.body, props: { workspace, providerConfigured: true, files, filesLoading: false } });
    wrappers.push(wrapper);
    await flushPromises();

    // Guided Start: sources, then the canon beat picker inside the Entry step.
    await vi.waitFor(async () => {
      await button(wrapper, '新建会话').trigger('click');
      expect(wrapper.find('.play-launch-flow').exists()).toBe(true);
    }, { timeout: 3000 });
    await button(wrapper, '以参与者身份在世界中行动').trigger('click');
    await flushPromises();
    await button(wrapper, '依次确认来源').trigger('click');
    await flushPromises();
    await sourceCheckbox(wrapper, 'chapters/opening.md').setValue(true);
    await sourceCheckbox(wrapper, 'timeline/events.yaml').setValue(true);
    await wrapper.get('.guided-step').trigger('submit');
    await flushPromises();
    await wrapper.get('[name="guided-title"]').setValue('雾港之夏');
    await wrapper.get('[name="guided-entry-label"]').setValue('七月三日');
    await wrapper.get('[name="guided-opening"]').setValue('信刚刚送到。');

    await wrapper.get('.canon-source summary').trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('[name="guided-canon-candidate"]')).toHaveLength(2), { timeout: 3000 });
    for (const candidate of wrapper.findAll('[name="guided-canon-candidate"]')) await candidate.setValue(true);
    await wrapper.get('[name="guided-canon-manual-label"]').setValue('旧钟楼停摆');
    await button(wrapper, '添加手写节点').trigger('click');
    expect(wrapper.findAll('.canon-selected li').map((item) => item.text())).toEqual([
      expect.stringContaining('码头仓库暑期读书会'),
      expect.stringContaining('仓库深夜起火'),
      expect.stringContaining('作者提供'),
    ]);
    await wrapper.findAll('[name="guided-canon-knows"]')[1]!.setValue(true);

    await wrapper.get('.guided-entry').trigger('submit');
    await flushPromises();
    await wrapper.get('[name="guided-player-persona"]').setValue('一个知道太多的旅人。');
    await wrapper.get('.guided-identity').trigger('submit');
    await flushPromises();
    await wrapper.get('.guided-cast').trigger('submit');
    await vi.waitFor(() => expect(wrapper.get('[aria-current="step"]').text()).toContain('确认'), { timeout: 3000 });
    expect(wrapper.get('.canon-beat-review').text()).toContain('引自 timeline/events.yaml');
    expect(wrapper.text()).toContain('3 条 · 穿越者不知道原作');
    await button(wrapper, '开始沉浸推演').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.play-composer textarea').exists()).toBe(true), { timeout: 5000 });
    const sessionId = await vi.waitFor(async () => (await f.client.listPlaySessionSummaries()).summaries[0]!.id, { timeout: 3000 });
    await vi.waitFor(() => expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined(), { timeout: 3000 });

    // One real turn; the referee settles a beat as prevented.
    await vi.waitFor(async () => {
      if ((await f.client.getPlaySession(sessionId)).session.revision === 0 && !wrapper.find('.play-stop-button').exists()) {
        await wrapper.get('.play-composer textarea').setValue('向巡查报告仓库的隐患。');
        await wrapper.get('.play-composer').trigger('submit');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect((await f.client.getPlaySession(sessionId)).session.revision).toBe(1);
    }, { timeout: 10_000, interval: 200 });
    await refresh(wrapper);
    expect(f.prompts.at(-1)).toContain('canon-beat-2 [pending] 仓库深夜起火');
    expect(f.prompts.at(-1)).toContain('canon beats protocol');

    // Player view: the protagonist does not know canon, so nothing about the beats is rendered.
    await vi.waitFor(() => expect(wrapper.text()).toContain('铁门上多了一把新锁。'));
    expect(wrapper.find('.play-canon-panel').exists()).toBe(false);
    for (const hidden of ['原作走向', '仓库深夜起火', '码头仓库暑期读书会', '旧钟楼停摆', '那栋楼在夜里之前就被封了']) {
      expect(wrapper.text()).not.toContain(hidden);
    }
    expect(wrapper.findAll('.play-choice-text').map((choice) => choice.text()).join('')).not.toContain('仓库');

    // Director view: the beats grouped by status, with the cause linked.
    await wrapper.get('[aria-label^="开启导演视角"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.play-canon-panel').exists()).toBe(true));
    const group = (status: string) => wrapper.get(`.play-canon-group[data-status="${status}"]`);
    expect(group('prevented').text()).toContain('仓库深夜起火');
    expect(group('prevented').text()).toContain('那栋楼在夜里之前就被封了。');
    expect(group('pending').findAll('.play-canon-beat')).toHaveLength(2);
    await group('prevented').get('.play-canon-event-link').trigger('click');
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('play-event-turn-1-event-1'));

    // Director correction: recorded as an author change on the selected branch.
    // A background read can briefly hold the session, so a refused write is retried like any author would.
    const revisionOf = async () => (await f.client.getPlaySession(sessionId)).session.revision;
    await vi.waitFor(async () => {
      if (await revisionOf() < 2 && wrapper.find('.play-canon-correct:not([disabled])').exists()) {
        await group('pending').findAll('.play-canon-correct')[0]!.trigger('click');
        await wrapper.get('[name="canon-correct-status"]').setValue('altered');
        await wrapper.get('[name="canon-correct-reason"]').setValue('读书会改到了图书馆。');
        await wrapper.get('.play-canon-form').trigger('submit');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(await revisionOf()).toBe(2);
    }, { timeout: 10_000, interval: 200 });
    await vi.waitFor(() => expect(wrapper.find('.play-canon-group[data-status="altered"]').exists()).toBe(true), { timeout: 5000 });
    expect(group('altered').text()).toContain('作者更正');

    // A pending beat becomes a scheduled event with an existing trigger type.
    await vi.waitFor(async () => {
      if (await revisionOf() < 3 && wrapper.find('.play-canon-schedule:not([disabled])').exists()) {
        await wrapper.get('.play-canon-schedule').trigger('click');
        await wrapper.get('[name="canon-schedule-trigger"]').setValue('afterTurns');
        await wrapper.get('[name="canon-schedule-turns"]').setValue('3');
        await wrapper.get('.play-canon-form').trigger('submit');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(await revisionOf()).toBe(3);
    }, { timeout: 10_000, interval: 200 });
    const stored = await vi.waitFor(async () => (await f.client.getPlaySession(sessionId)).session, { timeout: 3000 });
    expect(stored.scheduledEvents.at(-1)).toMatchObject({ label: '旧钟楼停摆', status: 'scheduled', trigger: { type: 'afterTurns', turns: 3 } });
    expect(projectPlayCanonBeatTable(stored.playLocalState, 'director')!.beats.map((beat) => beat.status))
      .toEqual(['altered', 'prevented', 'pending']);
    await vi.waitFor(() => expect(group('pending').text()).toContain('已转为计划事件'), { timeout: 5000 });

    // Outcome report: the "与原作的差异" group, Director only.
    await vi.waitFor(async () => {
      if (!wrapper.text().includes('与原作的差异')) await button(wrapper, '生成报告').trigger('click');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(wrapper.text()).toContain('与原作的差异');
    }, { timeout: 10_000, interval: 300 });
    const divergence = wrapper.get('#play-outcome-group-canonDivergence').element.closest('.play-outcome-group')!;
    expect(divergence.textContent).toContain('已阻止「仓库深夜起火」');
    expect(divergence.textContent).toContain('已改写「码头仓库暑期读书会」');

    // The timeline file itself was never touched.
    expect(await readFile(join(f.root, 'timeline/events.yaml'), 'utf-8')).toBe(TIMELINE);
  }, 90_000);
});
