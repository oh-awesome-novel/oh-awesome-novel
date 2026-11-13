// @vitest-environment happy-dom
// Vue needs a renderer DOM, while the localhost Hono adapter needs Node Fetch classes.
await vi.hoisted(async () => {
  const http = await import('undici');
  for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]);
});
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import type { WorkspaceSummary } from '@oh-awesome-novel/client';

// The Desktop talks to the real HTTP client; nothing about the turn is faked below the model.
const api = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
// Bind every workspace panel to this fixture's real SDK, including shared composables.
vi.mock('../../../apps/desktop-ui/src/composables/useWorkspaceApi', () => ({ useWorkspaceApi: () => api }));
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
const relationship = (title: string, summary: string, visibility: string, reason: string) => ({
  kind: 'relationshipChanged', origin: 'npc', title, summary, visibility, cause: { reason },
});
const settlement = (narrative: string, events: unknown[]) => `${narrative}\n\`\`\`oan-play-settlement\n${JSON.stringify({
  events, stateDelta: {}, observations: [], suggestedActions: [],
})}\n\`\`\``;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-relationship-journey-'));
  roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Relations\ngit:\n  autoCommitOnAccept: false\n');
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'baseline']);
  let worldCalls = 0;
  const reply = () => {
    worldCalls += 1;
    return worldCalls === 1
      ? settlement('林晚接过伞，神色缓和下来。', [
          relationship('林晚放下戒心', '林晚对你露出笑意。', 'playerVisible', '那把伞是她亡兄的旧物。'),
          relationship('苏禾暗中记恨', '苏禾决定找机会报复林晚。', 'playerUnknown', '苏禾看见了递伞的一幕。'),
        ])
      : settlement('林晚后退了半步。', [
          relationship('林晚开始怀疑', '林晚不再回答你的问题。', 'playerVisible', '你说漏了车次。'),
        ]);
  };
  const model = new MockLanguageModelV4({
    doStream: async () => stream(reply()),
    doGenerate: async () => ({
      content: [{ type: 'text', text: reply() }],
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
  const { session } = await client.createPlaySession({
    id: 'relationship-journey', title: '雨夜车站', sceneStart: '雨夜的车站', characters: ['林晚', '苏禾'],
    eventPolicy: { simulationMode: 'activeWorld', density: 'volatile', maxExternalEventsPerTurn: 4 },
  });
  return { root, client, session };
}

async function refreshAfterCommit(wrapper: VueWrapper) {
  await vi.waitFor(async () => {
    await wrapper.get('[aria-label="刷新推演工作区"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[role=alert]').map((node) => node.text()).join('')).not.toContain('being modified');
  }, { timeout: 3000 });
  await vi.waitFor(() => expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined(), { timeout: 3000 });
}

async function submitTurn(wrapper: VueWrapper, f: Awaited<ReturnType<typeof fixture>>, text: string, revision: number) {
  // The composer ignores a submit while background loads hold the workspace, so resubmit until it lands.
  await vi.waitFor(async () => {
    if ((await f.client.getPlaySession(f.session.id)).session.revision === revision - 1 && !wrapper.find('.play-stop-button').exists()) {
      await wrapper.get('.play-composer textarea').setValue(text);
      await wrapper.get('.play-composer').trigger('submit');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(revision);
  }, { timeout: 10_000, interval: 200 });
  await refreshAfterCommit(wrapper);
}

const panelText = (wrapper: VueWrapper) => wrapper.get('.play-relationship-panel').text();

describe('relationship panel through default SDK, HTTP/SSE and Desktop', () => {
  it('lists changes per pair, hides Director-only content from the Player, and follows the selected branch', async () => {
    const f = await fixture();
    const workspace: WorkspaceSummary = { name: 'relations', novelName: 'Relations', path: f.root, valid: true };
    const wrapper = mount(PlayWorkspace, { attachTo: document.body, props: { workspace, providerConfigured: true } });
    wrappers.push(wrapper);
    await vi.waitFor(() => expect(wrapper.find('.play-session-card').exists()).toBe(true));
    await wrapper.get('.play-session-card').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.play-composer textarea').exists()).toBe(true));
    await vi.waitFor(() => expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined(), { timeout: 3000 });
    await vi.waitFor(() => expect(panelText(wrapper)).toContain('当前分支还没有记录到关系变化'));

    await submitTurn(wrapper, f, '递给林晚一把伞。', 1);
    await submitTurn(wrapper, f, '告诉林晚我知道车次。', 2);

    // Player view: both visible changes for the same pair, in turn order; nothing hidden.
    await vi.waitFor(() => expect(panelText(wrapper)).toContain('林晚开始怀疑'));
    const thread = wrapper.get('.play-relationship-thread');
    expect(thread.get('h4').text()).toBe('林晚 · 参与者');
    expect(thread.findAll('li strong').map((node) => node.text())).toEqual(['林晚放下戒心', '林晚开始怀疑']);
    expect(thread.findAll('.play-relationship-meta button').map((node) => node.text())).toEqual(['第 1 回合', '第 2 回合']);
    expect(panelText(wrapper)).not.toContain('苏禾暗中记恨');
    expect(panelText(wrapper)).not.toContain('报复');
    expect(panelText(wrapper)).not.toContain('亡兄');
    expect(panelText(wrapper)).not.toContain('导演视角起因');

    // Each entry links to its event card and to its turn on the worldline.
    await thread.findAll('.play-relationship-event-link')[0]!.trigger('click');
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('play-event-turn-1-event-1'));
    await vi.waitFor(() => expect(wrapper.find('[data-worldline-checkpoint="turn-artifact-2"]').exists()).toBe(true), { timeout: 3000 });
    await vi.waitFor(async () => {
      await wrapper.findAll('.play-relationship-thread .play-relationship-meta button')[1]!.trigger('click');
      expect((document.activeElement as HTMLElement | null)?.dataset.worldlineCheckpoint).toBe('turn-artifact-2');
    }, { timeout: 3000 });

    // Director view shows the hidden change and the referee-side causes.
    await wrapper.get('[aria-label^="开启导演视角"]').trigger('click');
    await vi.waitFor(() => expect(panelText(wrapper)).toContain('苏禾暗中记恨'));
    expect(panelText(wrapper)).toContain('那把伞是她亡兄的旧物。');
    expect(wrapper.findAll('.play-relationship-thread h4').map((node) => node.text())).toContain('苏禾 · 林晚');

    // Back to the Player view, then Restore turn 1: turn 2's change leaves the panel.
    await wrapper.get('[aria-label="关闭导演视角"]').trigger('click');
    await vi.waitFor(() => expect(panelText(wrapper)).not.toContain('苏禾暗中记恨'));
    await vi.waitFor(async () => {
      const before = (await f.client.getPlaySession(f.session.id)).session;
      if (before.selectedTurnIds.length === 2) {
        await f.client.restorePlayCheckpoint(f.session.id, 'turn-artifact-1', { baseRevision: before.revision });
      }
    }, { timeout: 3000 });
    await refreshAfterCommit(wrapper);
    await vi.waitFor(() => expect(panelText(wrapper)).not.toContain('林晚开始怀疑'), { timeout: 5000 });
    expect(panelText(wrapper)).toContain('林晚放下戒心');
    const after = await vi.waitFor(async () => (await f.client.getPlaySession(f.session.id)).session, { timeout: 3000 });
    // The abandoned turn is still in the ledger; the panel only stopped projecting it.
    expect(after.events.map((event) => event.title)).toContain('林晚开始怀疑');
  }, 60_000);
});
