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
const settlement = (narrative: string, suggestions: string[]) => `${narrative}\n\`\`\`oan-play-settlement\n${JSON.stringify({
  events: [], stateDelta: {}, observations: [], suggestedActions: suggestions,
})}\n\`\`\``;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-guided-retry-journey-'));
  roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Guided\ngit:\n  autoCommitOnAccept: false\n');
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'baseline']);
  const prompts: string[] = [];
  let worldCalls = 0;
  const reply = (prompt: string) => {
    prompts.push(prompt);
    if (prompt.includes('oan-play-suggestions')) {
      return '```oan-play-suggestions\n{"suggestedActions":["[say] 问她要去哪里","[look] 看看站台尽头"]}\n```';
    }
    worldCalls += 1;
    return settlement(worldCalls === 2 ? '她没有伸手，只是看着雨。' : `第 ${worldCalls} 次叙述。`, ['[say] 再劝一次']);
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
  const { session } = await client.createPlaySession({ id: 'guided-journey', title: '雨夜车站', sceneStart: '雨夜的车站', characters: ['她'] });
  return { root, client, session, prompts };
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

describe('guided Retry through default SDK, HTTP/SSE and Desktop', () => {
  it('retries with guidance, shows it only in the Director view, and asks for extra options without writing', async () => {
    const f = await fixture();
    const workspace: WorkspaceSummary = { name: 'guided', novelName: 'Guided', path: f.root, valid: true };
    const wrapper = mount(PlayWorkspace, { attachTo: document.body, props: { workspace, providerConfigured: true } });
    wrappers.push(wrapper);
    await vi.waitFor(() => expect(wrapper.find('.play-session-card').exists()).toBe(true));
    await wrapper.get('.play-session-card').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.play-composer textarea').exists()).toBe(true));
    // Wait until the session's loads settle; the composer is locked while they run.
    await vi.waitFor(() => expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined(), { timeout: 3000 });

    // Turn 1, submitted from the Desktop composer.
    // The composer ignores a submit while background loads hold the workspace, so resubmit until it lands.
    await vi.waitFor(async () => {
      if ((await f.client.getPlaySession(f.session.id)).session.revision === 0 && !wrapper.find('.play-stop-button').exists()) {
        await wrapper.get('.play-composer textarea').setValue('递给她一把伞。');
        await wrapper.get('.play-composer').trigger('submit');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(1);
    }, { timeout: 10_000, interval: 200 });
    await refreshAfterCommit(wrapper);
    await vi.waitFor(() => expect(wrapper.find('.play-history-retry:not([disabled])').exists()).toBe(true), { timeout: 3000 });

    // Guided Retry from the worldline. A background read can briefly hold the
    // session lock, so a transient 409 before the stream starts is retried.
    await vi.waitFor(async () => {
      if ((await f.client.getPlaySession(f.session.id)).session.revision < 2) {
        await vi.waitFor(() => expect(wrapper.find('.play-history-retry:not([disabled])').exists()).toBe(true), { timeout: 3000 });
        await wrapper.get('.play-history-retry').trigger('click');
        await flushPromises();
        await wrapper.get('.play-retry-guidance').setValue('别让她这么快接受。');
        await wrapper.get('.play-history-confirm').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(2);
    }, { timeout: 10_000, interval: 200 });
    await refreshAfterCommit(wrapper);
    const afterRetry = await vi.waitFor(async () => (await f.client.getPlaySession(f.session.id)).session);
    const sibling = afterRetry.turnArtifacts.find((artifact) => artifact.id === afterRetry.selectedTurnIds.at(-1))!;
    expect(sibling).toMatchObject({
      input: { raw: '递给她一把伞。' },
      retryGuidance: { sourceArtifactId: 'turn-artifact-1', text: '别让她这么快接受。' },
    });
    expect(f.prompts.at(-1)).toContain('别让她这么快接受。');
    expect(f.prompts.at(-1)).toContain('本次重演要求');
    await vi.waitFor(() => expect(wrapper.text()).toContain('她没有伸手，只是看着雨。'));

    // Player view never renders the note; the Director view does.
    await vi.waitFor(() => expect(wrapper.findAll('.play-worldline-node')).toHaveLength(3));
    expect(wrapper.find('.play-worldline-guidance').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('别让她这么快接受');
    await wrapper.get('[aria-label^="开启导演视角"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('.play-worldline-guidance').text()).toContain('别让她这么快接受。'));

    // Extra options: one read-only call, no revision change, nothing stored.
    const before = await vi.waitFor(async () => (await f.client.getPlaySession(f.session.id)).session);
    const callsBefore = f.prompts.length;
    let clicks = 0;
    await vi.waitFor(async () => {
      if (!wrapper.find('.play-choices-more-note').exists() && !wrapper.find('.play-choice-more[disabled]').exists()) {
        clicks += 1;
        await wrapper.get('.play-choice-more').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(wrapper.findAll('.play-choice-text').map((choice) => choice.text())).toEqual(['问她要去哪里', '看看站台尽头']);
    }, { timeout: 10_000, interval: 200 });
    // Each click is at most one model call; a click refused by a transient lock makes none.
    expect(f.prompts.length).toBe(callsBefore + 1);
    expect(clicks).toBeGreaterThanOrEqual(1);
    expect(f.prompts.at(-1)).not.toContain('别让她这么快接受。');
    const after = await vi.waitFor(async () => (await f.client.getPlaySession(f.session.id)).session);
    expect(after.revision).toBe(before.revision);
    expect(after.suggestedActions).toEqual(before.suggestedActions);
    expect(after.selectedTurnIds).toEqual(before.selectedTurnIds);

    // The next ordinary turn does not carry the guidance.
    await wrapper.findAll('.play-choice-pick')[0]!.trigger('click');
    await vi.waitFor(async () => expect((await f.client.getPlaySession(f.session.id)).session.revision).toBe(3), { timeout: 5000 });
    expect(f.prompts.at(-1)).toContain('问她要去哪里');
    expect(f.prompts.at(-1)).not.toContain('别让她这么快接受。');
  }, 60_000);
});
