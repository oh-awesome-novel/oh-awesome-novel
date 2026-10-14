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
      providerConfigured: true, queuedPrompt: '', chatStatus: 'ready', chatInput: '', chatMessages: [], chatPendingActions: [],
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
      await wrapper.setProps({ chatStatus: 'streaming' });
      for (const button of wrapper.findAll<HTMLButtonElement>('.composer-command-chip')) expect(button.element.disabled).toBe(true);
    } finally { wrapper.unmount(); }
  });
});
