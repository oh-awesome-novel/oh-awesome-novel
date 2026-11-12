// @vitest-environment happy-dom
vi.hoisted(async () => { const http = await import('undici'); for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]); });
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import PlayChapterWritingPanel from '../../../apps/desktop-ui/src/components/play/outcome/PlayChapterWritingPanel.vue';
import PendingActionCard from '../../../apps/desktop-ui/src/components/agent-checkpoint/PendingActionCard.vue';
import { playChapterFixture } from '../../core/src/fixtures/play-chapter';
import { chapterModel } from '../../agent/src/fixtures/play-chapter-model';

it('goes from selected Play evidence through SDK/SSE, Desktop diff and Accept to an explicit chapter/settlement handoff', async () => {
  const f = await playChapterFixture(); const wrappers: VueWrapper[] = []; let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const model = chapterModel(); backend = await startNovelHttpBackend({ workspaceRoot: f.root, globalConfigDir: join(f.root, 'global'),
      providerConfig: { id: 'controlled', kind: 'custom', model: 'controlled', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model });
    const api = createOanClient({ backendBaseUrl: backend.url });
    const panel = mount(PlayChapterWritingPanel, { props: { workspaceRoot: f.root, sessionId: f.session.id, revision: f.session.revision,
      reportFingerprint: f.attachment.reportFingerprint, selectedItemIds: [f.selected.id], lens: 'player', disabled: false, api } }); wrappers.push(panel);
    await panel.get('button').trigger('click');
    await vi.waitFor(() => expect(panel.text()).toContain('chapters/0001/0001.md'));
    expect(panel.text()).toContain(f.selected.summary);
    await panel.findAll('label').find(label => label.text().startsWith('本章目标'))!.get('textarea').setValue('写出建立信任的过程');
    await panel.findAll('button').find(button => button.text() === '生成章节候选')!.trigger('click');
    await vi.waitFor(() => expect(panel.text()).toContain('雨夜送伞'), { timeout: 5000 });
    await expect(readFile(join(f.root, 'chapters/0001/0001.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await panel.findAll('button').find(button => button.text() === '提交本章审批')!.trigger('click');
    await vi.waitFor(() => expect(panel.emitted('review')).toHaveLength(1));
    const id = panel.emitted('review')![0]![0] as string;
    const { pendingAction } = await api.readPendingAction(id);
    const card = mount(PendingActionCard, { props: { action: pendingAction,
      onAccept: async () => { const result = await api.acceptPendingAction(id); await card.setProps({ action: result.pendingAction }); },
    } }); wrappers.push(card);
    await card.findAll('button').find(button => button.text() === 'Accept')!.trigger('click');
    await vi.waitFor(() => expect(card.find('.chapter-handoff-banner').exists()).toBe(true));
    expect(await readFile(join(f.root, 'chapters/0001/0001.md'), 'utf8')).toContain('两个人在雨声中');
    expect(model.doStreamCalls).toHaveLength(1);
    await card.findAll('button').find(button => button.text() === '打开章节')!.trigger('click');
    await card.findAll('button').find(button => button.text() === '整理本章')!.trigger('click');
    expect(card.emitted('chapterHandoff')).toEqual([[{ path: 'chapters/0001/0001.md', mode: 'open' }], [{ path: 'chapters/0001/0001.md', mode: 'settle' }]]);
    expect(model.doStreamCalls).toHaveLength(1);
  } finally { wrappers.forEach(wrapper => wrapper.unmount()); await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 20_000);
