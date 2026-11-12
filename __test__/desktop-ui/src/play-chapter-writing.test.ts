// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import PlayChapterWritingPanel from '../../../apps/desktop-ui/src/components/play/outcome/PlayChapterWritingPanel.vue';
it('discards a late draft on cancellation, viewpoint changes and workspace switches', async () => {
  let finish!: () => void;
  const api = {
    createPlayWritingReferenceAttachment: vi.fn().mockResolvedValue({ attachment: { id: 'ref', reportFingerprint: 'a'.repeat(64) } }),
    getPlayChapterTarget: vi.fn().mockResolvedValue({ targetPath: 'chapters/0001/0001.md', chapterInventoryHash: 'b'.repeat(64), reportFingerprint: 'a'.repeat(64), items: [{ id: 'item', summary: '送伞', kind: 'event' }], range: { first: 't1', last: 't1', turnCount: 1 } }),
    generatePlayChapter: vi.fn(async function* (input) { await new Promise<void>(resolve => { finish = resolve; }); yield { type: 'preview', preview: { id: 'pa_late', ...input, fingerprint: 'c'.repeat(64), diff: 'LATE_PRIVATE_DRAFT', citedItemIds: ['item'] } }; }),
    proposePlayChapter: vi.fn(),
  };
  const wrapper = mount(PlayChapterWritingPanel, { props: { workspaceRoot: '/novel', sessionId: 'play', revision: 1, reportFingerprint: 'a'.repeat(64), selectedItemIds: ['item'], lens: 'director', disabled: false, api: api as never } });
  try {
    await wrapper.get('button').trigger('click'); await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '生成章节候选')!.trigger('click'); await flushPromises();
    await wrapper.setProps({ lens: 'player' }); finish(); await flushPromises();
    expect(wrapper.text()).not.toContain('LATE_PRIVATE'); expect(wrapper.find('fieldset').exists()).toBe(false);
    await wrapper.get('button').trigger('click'); await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '生成章节候选')!.trigger('click'); await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '取消生成')!.trigger('click'); finish(); await flushPromises();
    expect(wrapper.text()).not.toContain('LATE_PRIVATE');
    await wrapper.setProps({ workspaceRoot: '/other' }); expect(wrapper.find('fieldset').exists()).toBe(false);
    expect(api.proposePlayChapter).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});
