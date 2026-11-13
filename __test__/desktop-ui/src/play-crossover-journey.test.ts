// @vitest-environment happy-dom
await vi.hoisted(async () => {
  const http = await import('undici');
  for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]);
});
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient, type PlaySession } from '@oh-awesome-novel/client';
import { crossoverFixture } from '../../core/src/fixtures/crossover';
import PlayGuidedStartWizard from '../../../apps/desktop-ui/src/components/play/launch/PlayGuidedStartWizard.vue';
import PlayContextTraceList from '../../../apps/desktop-ui/src/components/play/context/PlayContextTraceList.vue';
import { projectContextTrace } from '../../../apps/desktop-ui/src/composables/usePlaySessionHistoryWindow';

it('marks works, confirms a contract, starts through HTTP, and renders actual SDK/SSE sources grouped by work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oan-crossover-desktop-'));
  let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  const wrappers: VueWrapper[] = [];
  try {
    const git = promisify(execFile);
    await git('git', ['init', '-b', 'main', root]);
    await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'baseline']);
    await mkdir(join(root, '.oan')); await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Cross\n');
    const fixture = await crossoverFixture(root);
    let session: PlaySession | undefined;
    const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
    const model = new MockLanguageModelV4({ doStream: async () => {
      const sourceId = session!.activatedSources.find(source => source.objectId === 'b1')!.sourceId;
      const reply = `b1 介绍了自己的世界。\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [{ kind: 'informationSpread', origin: 'npc', title: '交谈', summary: 'a1 听到介绍。', visibility: 'playerVisible', cause: { reason: '交流' } }], stateDelta: {}, observations: [], suggestedActions: [], knowledgeChanges: [{ type: 'learnSource', participantRef: 'participant-1', sourceId, eventRef: 1 }] })}\n\`\`\``;
      return { stream: simulateReadableStream({ chunks: [
        { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: reply }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ], initialDelayInMs: null, chunkDelayInMs: null }) };
    } });
    backend = await startNovelHttpBackend({ workspaceRoot: root, globalConfigDir: join(root, 'global'), providerConfig: { id: 'controlled', kind: 'custom', model: 'controlled', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model });
    const api = createOanClient({ backendBaseUrl: backend.url });
    const wizard = mount(PlayGuidedStartWizard, { props: { purpose: 'immersiveJourney', files: fixture.sources.map(source => ({ name: source.sourceId, path: source.path, type: 'file' as const })), api } }); wrappers.push(wizard);
    for (const row of wizard.findAll('.source-tree li')) {
      await row.get('input[type="checkbox"]').setValue(true);
      const path = row.get('small').text();
      const work = fixture.sources.find(source => source.path === path)?.originWork?.title;
      if (work) await row.get('.work-label input').setValue(work);
    }
    expect(wizard.get('.guided-step button[type="submit"]').text()).toContain('融合契约');
    await wizard.get('.guided-step').trigger('submit');
    expect(wizard.get('.crossover-step').text()).toContain('甲作、乙作');
    await wizard.get('.crossover-step select').setValue('visitor');
    await wizard.findAll('.crossover-step button').find(button => button.text() === '添加规则裁定')!.trigger('click');
    await wizard.get('.crossover-step fieldset input').setValue('力量体系');
    await wizard.get('.crossover-step fieldset textarea').setValue('以甲作规则为准，乙作能力保留原有代价。');
    await wizard.get('.crossover-step').trigger('submit');
    await wizard.get('[name="guided-title"]').setValue('交叉的路口');
    await wizard.get('[name="guided-entry-label"]').setValue('初次见面');
    await wizard.get('[name="guided-opening"]').setValue('四人在路口相遇。');
    await wizard.get('.guided-entry input[type="checkbox"]').setValue(true);
    await wizard.get('.guided-entry').trigger('submit');
    await wizard.get('[name="guided-player-persona"]').setValue('路过的人');
    await wizard.get('.guided-identity').trigger('submit');
    for (const [index, id] of ['a1', 'a2', 'b1', 'b2'].entries()) {
      await wizard.findAll('.guided-cast button').find(button => button.text().includes('添加参与者'))!.trigger('click');
      await wizard.get(`[name="guided-participant-${index + 1}-name"]`).setValue(id);
      const select = wizard.get(`[name="guided-participant-${index + 1}-source"]`);
      const option = select.findAll('option').find(option => option.text() === id)!;
      await select.setValue(option.attributes('value'));
      await wizard.get(`[name="guided-participant-${index + 1}-goal"]`).setValue('了解眼前局势');
    }
    await wizard.get('.guided-cast').trigger('submit');
    await vi.waitFor(() => expect(wizard.find('[aria-label="确认融合契约"]').exists()).toBe(true));
    expect(wizard.get('[aria-label="确认融合契约"]').text()).toContain('单向来客');
    expect(wizard.get('[aria-label="确认融合契约"]').text()).toContain('初始认知隔离');
    await wizard.findAll('button').find(button => button.text().includes('开始沉浸推演'))!.trigger('click');
    await vi.waitFor(() => expect(wizard.emitted('created')).toHaveLength(1));
    session = wizard.emitted('created')![0]![0] as PlaySession;
    const events = [];
    for await (const event of api.streamPlayWorldRefereeTurn(session.id, { userText: '互相介绍', actionKind: 'say', baseRevision: 0 })) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'play.turn.committed' }));
    const traces = (await api.listPlayContextTraces(session.id)).traces;
    const panel = mount(PlayContextTraceList, { props: { traces: traces.map(trace => projectContextTrace(trace, true)) } }); wrappers.push(panel);
    expect(panel.findAll('.work-source-group h4').map(heading => heading.text())).toEqual(expect.arrayContaining(['甲作', '乙作']));
    expect(panel.text()).toContain('[已使用]');
    expect(JSON.stringify(model.doStreamCalls[0])).toContain('visitor');
  } finally { wrappers.forEach(wrapper => wrapper.unmount()); await backend?.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
