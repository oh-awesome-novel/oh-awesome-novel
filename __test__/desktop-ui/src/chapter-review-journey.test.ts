// @vitest-environment happy-dom
vi.hoisted(async () => { const http = await import('undici'); for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]); });
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import ChapterReviewWorkbench from '../../../apps/desktop-ui/src/components/editor/ChapterReviewWorkbench.vue';
import PendingActionCard from '../../../apps/desktop-ui/src/components/agent-checkpoint/PendingActionCard.vue';
import { chapterReviewFixture, reviewPath, reviewText } from '../../core/src/fixtures/chapter-review';
import { reviewModel } from '../../agent/src/fixtures/chapter-review-model';
it('opens an evidence-backed report, persists choices, reviews a scoped draft and Accepts without losing decisions', async () => {
  const f = await chapterReviewFixture(); const wrappers: VueWrapper[] = []; let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const model = reviewModel(); backend = await startNovelHttpBackend({ workspaceRoot: f.root, globalConfigDir: join(f.root, 'global'), providerConfig: { id: 'test', kind: 'custom', model: 'test', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model });
    const api = createOanClient({ backendBaseUrl: backend.url });
    const panel = mount(ChapterReviewWorkbench, { props: { workspaceRoot: f.root, path: reviewPath, sourceVersion: reviewText, disabled: false, api } }); wrappers.push(panel);
    await vi.waitFor(() => expect(panel.attributes('aria-busy')).toBe('false'));
    await panel.findAll('button').find(button => button.text() === '只读审稿')!.trigger('click');
    await vi.waitFor(() => expect(panel.findAll('.review-finding')).toHaveLength(2));
    expect(panel.text()).toContain('未检查'); expect(panel.text()).toContain('没有可核对的外部依据');
    expect(model.doGenerateCalls).toHaveLength(1);
    await panel.findAll('.review-finding')[0]!.findAll('button').find(button => button.text().includes('事实依据'))!.trigger('click');
    expect(panel.emitted('openEvidence')).toEqual([[{ path: 'world/rules.md', line: 2 }]]);
    await panel.findAll('.review-finding select')[0]!.setValue('keep');
    await vi.waitFor(() => expect(panel.attributes('aria-busy')).toBe('false'));
    await panel.findAll('.review-finding select')[1]!.setValue('process');
    await vi.waitFor(() => expect(panel.attributes('aria-busy')).toBe('false'));
    await panel.findAll('button').find(button => button.text().includes('仅修订选中的 1'))!.trigger('click');
    await vi.waitFor(() => expect(panel.emitted('reviewPendingAction')).toHaveLength(1));
    expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(reviewText);
    const id = panel.emitted('reviewPendingAction')![0]![0] as string;
    const { pendingAction } = await api.readPendingAction(id);
    const card = mount(PendingActionCard, { props: { action: pendingAction, onAccept: async () => { const result = await api.acceptPendingAction(id); await card.setProps({ action: result.pendingAction }); } } }); wrappers.push(card);
    await card.findAll('button').find(button => button.text() === 'Diff')!.trigger('click'); expect(card.text()).toContain('她犹豫片刻');
    await card.findAll('button').find(button => button.text() === 'Accept')!.trigger('click');
    await vi.waitFor(() => expect(card.text()).toContain('accepted'));
    const content = await readFile(join(f.root, reviewPath), 'utf8'); expect(content).toContain('她笑了。\r\n\r\n她犹豫片刻');
    expect(content.endsWith('最后一句必须保留。\r\n')).toBe(true);
    await panel.setProps({ sourceVersion: content });
    await vi.waitFor(() => expect(panel.text()).toContain('报告已过期'));
    expect(panel.findAll('.review-finding select').map(select => (select.element as HTMLSelectElement).value)).toEqual(['keep', 'process']);
    expect(model.doGenerateCalls).toHaveLength(2);
  } finally { wrappers.forEach(wrapper => wrapper.unmount()); await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 20_000);
