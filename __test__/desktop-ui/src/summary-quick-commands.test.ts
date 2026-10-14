// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: {
  getComposerSubmitShortcutPreference: vi.fn().mockResolvedValue('ctrl-enter'),
  setComposerSubmitShortcutPreference: vi.fn().mockResolvedValue(undefined),
} }));
import CopilotPanel from '../../../apps/desktop-ui/src/components/workspace/CopilotPanel.vue';

describe('summary workflow entry in the existing Copilot composer', () => {
  it('queues volume/book requests for explicit sending and disables them during generation', async () => {
    const wrapper = mount(CopilotPanel, { props: {
      activeFilePath: 'chapters/0001/0001.md', providerConfigured: true, queuedPrompt: '', chatStatus: 'ready', chatInput: '', chatMessages: [], chatPendingActions: [],
      pendingActions: [], pendingActionsLoading: false, pendingActionsError: '', rightPanelShown: true,
      writingReferenceAttachments: [], selectedWritingReferenceAttachmentIds: [], writingReferencesLoading: false,
      writingReferencesError: '', writingProfilesError: '',
    }, global: { stubs: { AgentTimeline: true, AgentUsageInspector: true, CompactApprovalTray: true, PendingActionPanel: true, WritingReferenceSelector: true, WritingProfileSummary: true } } });
    try {
      for (const label of ['整理本卷', '整理全书']) {
        const button = wrapper.findAll('button').find((button) => button.text() === label)!;
        await button.trigger('click'); expect(wrapper.emitted('updateChatInput')?.at(-1)).toEqual([`/${label}`]);
      }
      expect(wrapper.emitted('sendChatInput')).toBeUndefined();
      const emittedCount = wrapper.emitted('updateChatInput')!.length;
      for (const activeFilePath of ['', 'outline/volumes/0001.md']) {
        await wrapper.setProps({ activeFilePath });
        const volumeButton = wrapper.findAll<HTMLButtonElement>('button').find((button) => button.text() === '整理本卷')!;
        expect(volumeButton.element.disabled).toBe(true);
        expect(wrapper.text()).toContain('整理本卷需要先打开一个已编号的章节、卷信息或卷摘要文件。');
        expect(volumeButton.attributes('aria-describedby')).toBeTruthy();
        await volumeButton.trigger('click'); expect(wrapper.emitted('updateChatInput')).toHaveLength(emittedCount);
        expect(wrapper.findAll<HTMLButtonElement>('button').find((button) => button.text() === '整理全书')!.element.disabled).toBe(false);
      }
      await wrapper.setProps({ activeFilePath: 'chapters/0001/0000.md' });
      expect(wrapper.findAll<HTMLButtonElement>('button').find((button) => button.text() === '整理本卷')!.element.disabled).toBe(false);
      expect(wrapper.text()).not.toContain('需要先打开');
      await wrapper.setProps({ chatStatus: 'streaming' });
      for (const button of wrapper.findAll<HTMLButtonElement>('.composer-command-chip')) expect(button.element.disabled).toBe(true);
    } finally { wrapper.unmount(); }
  });
});
