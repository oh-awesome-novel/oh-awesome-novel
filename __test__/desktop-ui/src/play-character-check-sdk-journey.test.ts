// @vitest-environment happy-dom
// Vue needs a renderer DOM, while the localhost Hono adapter needs Node Fetch classes.
vi.hoisted(async () => {
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
const settlement = (narrative: string, suggestions: string[] = []) => `${narrative}\n\`\`\`oan-play-settlement\n${JSON.stringify({
  events: [], stateDelta: {}, observations: [], suggestedActions: suggestions,
})}\n\`\`\``;

const PROFILE = '# 沈砚\n\n沈砚说话极少，从不解释自己的决定。\n她对陌生人保持戒备，不会主动示好。\n';
const ROSTER = [
  'id: shen-yan', 'name: 沈砚', 'aliases: [阿砚]', 'genderKind: girl', 'isPlayer: false',
  'looks:', '  fixedBooruTags: ""', '  outfitDescription: 黑色斗篷', '  outfitTags: ""', '',
].join('\n');
const OUT_OF_CHARACTER = '我把所有计划都告诉你吧';
const NOTE = '她不会主动向陌生人解释计划。';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-character-check-journey-'));
  roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'characters/shen-yan'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Check\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, 'characters/shen-yan/profile.md'), PROFILE);
  await writeFile(join(root, 'characters/shen-yan/roster-profile.yaml'), ROSTER);
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'baseline']);
  const prompts: string[] = [];
  const checkPrompts: string[] = [];
  let worldCalls = 0;
  const reply = (prompt: string) => {
    if (prompt.includes('oan-play-character-check')) {
      checkPrompts.push(prompt);
      return `\`\`\`oan-play-character-check\n${JSON.stringify({ findings: [
        { character: '沈砚', quote: OUT_OF_CHARACTER, category: 'voice', evidence: '沈砚说话极少，从不解释自己的决定。', note: NOTE },
        { character: '沈砚', quote: OUT_OF_CHARACTER, category: 'motivation', evidence: '沈砚热情开朗，最喜欢交朋友。', note: '伪造的依据。' },
      ] })}\n\`\`\``;
    }
    prompts.push(prompt);
    worldCalls += 1;
    return settlement(worldCalls === 1 ? `沈砚笑着拉住你的手：“${OUT_OF_CHARACTER}，我们是最好的朋友！”` : '沈砚只是看了你一眼，没有说话。');
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
  const { session } = await client.createPlaySession({ id: 'check-journey', title: '雨夜客栈', sceneStart: '雨夜的客栈', characters: ['shen-yan'] });
  return { root, client, session, prompts, checkPrompts };
}

/**
 * The backend emits play.turn.committed before it releases the session lock, so
 * the Desktop's immediate post-commit list refresh can race into a 409 in this
 * in-process setup. Refresh explicitly once the commit is durable.
 */
async function refreshAfterCommit(wrapper: VueWrapper) {
  await vi.waitFor(async () => {
    await wrapper.get('[aria-label="刷新推演工作区"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[role=alert]').map((node) => node.text()).join('')).not.toContain('being modified');
  }, { timeout: 3000 });
  await vi.waitFor(() => expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined(), { timeout: 3000 });
}


describe('in-character check through default SDK, HTTP/SSE and Desktop', () => {
  it('checks a turn, drops the forged opinion, retries with the chosen opinion and marks the old report stale', async () => {
    const f = await fixture();
    const workspace: WorkspaceSummary = { name: 'check', novelName: 'Check', path: f.root, valid: true };
    const wrapper = mount(PlayWorkspace, { attachTo: document.body, props: { workspace, providerConfigured: true } });
    wrappers.push(wrapper);
    // The first session list read can be slow or briefly refused on a loaded runner;
    // refresh like an author would instead of relying on the 1s default wait.
    await vi.waitFor(async () => {
      if (!wrapper.find('.play-session-card').exists() && wrapper.find('[role=alert]').exists()) {
        await wrapper.get('[aria-label="刷新推演工作区"]').trigger('click');
        await flushPromises();
      }
      expect(wrapper.find('.play-session-card').exists()).toBe(true);
    }, { timeout: 15_000, interval: 200 });
    await wrapper.get('.play-session-card').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.play-composer textarea').exists()).toBe(true));
    await vi.waitFor(() => expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined(), { timeout: 3000 });
    expect(wrapper.get('.play-character-check').text()).toContain('还没有检查报告');

    await vi.waitFor(async () => {
      if ((await f.client.getPlaySession(f.session.id)).session.revision === 0 && !wrapper.find('.play-stop-button').exists()) {
        await wrapper.get('.play-composer textarea').setValue('问她接下来打算怎么办。');
        await wrapper.get('.play-composer').trigger('submit');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(1);
    }, { timeout: 10_000, interval: 200 });
    await refreshAfterCommit(wrapper);

    // Check: one explicit click on the committed narrative, one read-only model call.
    await vi.waitFor(() => expect(wrapper.find('[data-check-message]:not([disabled])').exists()).toBe(true), { timeout: 3000 });
    // The author's own action is not narrative and offers no check.
    expect(wrapper.findAll('[data-check-message]')).toHaveLength(1);
    await vi.waitFor(async () => {
      if (!wrapper.find('.play-character-check-report').exists() && !wrapper.find('.play-character-check-running').exists()) {
        await wrapper.get('[data-check-message]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(wrapper.find('.play-character-check-report').exists()).toBe(true);
    }, { timeout: 10_000, interval: 200 });
    expect(f.checkPrompts).toHaveLength(1);
    expect(f.checkPrompts[0]).toContain('沈砚说话极少');
    expect(f.checkPrompts[0]).not.toContain('问她接下来打算怎么办');
    const report = wrapper.get('.play-character-check-report');
    expect(report.findAll('.play-character-check-findings li')).toHaveLength(1);
    expect(report.get('.play-character-check-quote').text()).toContain(OUT_OF_CHARACTER);
    expect(report.get('.play-character-check-evidence').text()).toContain('沈砚说话极少，从不解释自己的决定。');
    expect(report.text()).toContain('声线');
    expect(report.get('.play-character-check-discarded').text()).toContain('已丢弃 1 条意见');
    expect(report.text()).not.toContain('伪造的依据');
    expect(wrapper.get('.play-character-check').text()).not.toMatch(/\d+\s*分|评分/u);
    // Read-only: the session did not move.
    expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(1);

    // Pick the opinion: it lands in the guided Retry box, editable, and nothing is retried yet.
    await vi.waitFor(async () => {
      if (!wrapper.find('.play-retry-guidance').exists()) {
        await vi.waitFor(() => expect(wrapper.find('.play-character-check-actions button:not([disabled])').exists()).toBe(true), { timeout: 3000 });
        await wrapper.get('.play-character-check-actions button').trigger('click');
        await flushPromises();
      }
      expect(wrapper.find('.play-retry-guidance').exists()).toBe(true);
    }, { timeout: 10_000, interval: 200 });
    const box = wrapper.get<HTMLTextAreaElement>('.play-retry-guidance');
    expect(box.element.value).toContain(OUT_OF_CHARACTER);
    expect(box.element.value).toContain(NOTE);
    expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(1);
    const guidance = `${box.element.value} 让她少说话。`;
    await vi.waitFor(async () => {
      if ((await f.client.getPlaySession(f.session.id)).session.revision < 2) {
        if (!wrapper.find('.play-retry-guidance').exists()) {
          await wrapper.get('.play-character-check-actions button').trigger('click');
          await flushPromises();
        }
        await wrapper.get('.play-retry-guidance').setValue(guidance);
        await wrapper.get('.play-history-confirm').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(2);
    }, { timeout: 10_000, interval: 200 });
    await refreshAfterCommit(wrapper);
    // A background read can briefly hold the session; retry the read as the other journeys do.
    const afterRetry = await vi.waitFor(async () => (await f.client.getPlaySession(f.session.id)).session);
    const sibling = afterRetry.turnArtifacts.find((artifact) => artifact.id === afterRetry.selectedTurnIds.at(-1))!;
    expect(sibling.retryGuidance).toEqual({ sourceArtifactId: 'turn-artifact-1', text: guidance });
    expect(f.prompts.at(-1)).toContain('让她少说话。');
    // The report itself never entered the turn artifact.
    expect(JSON.stringify(afterRetry.turnArtifacts)).not.toContain('character-check');

    // The branch no longer runs through the checked turn: the report is history and cannot drive a Retry.
    await vi.waitFor(() => expect(wrapper.find('.play-character-check-stale').exists()).toBe(true), { timeout: 5000 });
    expect(wrapper.get('.play-character-check-actions button').attributes('disabled')).toBeDefined();
    expect(f.checkPrompts).toHaveLength(1);

    // Lens isolation: the Player-lens report is not shown in the Director view, and a
    // Director-lens report never reaches the Player view.
    await wrapper.get('[aria-label^="开启导演视角"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.play-character-check-report').exists()).toBe(false));
    await vi.waitFor(async () => {
      if (!wrapper.find('.play-character-check-report').exists() && !wrapper.find('.play-character-check-running').exists()) {
        await wrapper.get('[data-check-message]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(wrapper.find('.play-character-check-report').exists()).toBe(true);
    }, { timeout: 10_000, interval: 200 });
    expect(wrapper.find('.play-character-check-stale').exists()).toBe(false);
    const directorReports = await f.client.listPlayCharacterChecks(f.session.id, 'director');
    expect(directorReports.map((item) => [item.target, item.stale])).toEqual([[{ kind: 'turn', turnId: afterRetry.selectedTurnIds.at(-1) }, false]]);
    await wrapper.get('[aria-label="关闭导演视角"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.play-character-check-report')).toHaveLength(1));
    await vi.waitFor(() => expect(wrapper.find('.play-character-check-stale').exists()).toBe(true));
    const playerReports = await f.client.listPlayCharacterChecks(f.session.id, 'player');
    expect(playerReports.map((item) => [item.lens, item.stale])).toEqual([['player', true]]);
  }, 60_000);
});
