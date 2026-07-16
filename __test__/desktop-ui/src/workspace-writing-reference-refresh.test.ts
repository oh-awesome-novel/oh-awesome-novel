// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const conversationHarness = vi.hoisted(() => ({
  refreshWritingReferences: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getWorkspaceTree: vi.fn(),
  getChapters: vi.fn(),
  getWorkspaceStatus: vi.fn(),
  getProjectHealth: vi.fn(),
  listPendingActions: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

vi.mock(
  '../../../apps/desktop-ui/src/composables/useAgentConversationSessions',
  async () => {
    const { shallowRef } = await import('vue');
    return {
      MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST: 8,
      useAgentConversationSessions: () => ({
        activeConversationId: shallowRef('chat-1'),
        activeInput: shallowRef(''),
        activeMessages: shallowRef([]),
        activePendingActions: shallowRef([]),
        activeStatus: shallowRef('ready'),
        conversationSummaries: shallowRef([]),
        writingReferenceAttachments: shallowRef([]),
        writingReferencesLoading: shallowRef(false),
        writingReferencesError: shallowRef(''),
        selectedWritingReferenceAttachmentIds: shallowRef([]),
        createConversation: vi.fn(),
        refreshWritingReferences: conversationHarness.refreshWritingReferences,
        selectConversation: vi.fn(),
        sendCurrentInput: vi.fn(),
        stop: vi.fn(),
        toggleWritingReferenceAttachment: vi.fn(),
      }),
    };
  },
);

import WorkspaceShell from '../../../apps/desktop-ui/src/components/workspace/WorkspaceShell.vue';

const PlayWorkspaceStub = defineComponent({
  name: 'PlayWorkspace',
  emits: {
    writingReferencesUpdated: () => true,
  },
  template: `
    <button data-test="publish-writing-reference" @click="$emit('writingReferencesUpdated')">
      Publish Writing Reference
    </button>
  `,
});

describe('WorkspaceShell Play Writing Reference refresh wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    conversationHarness.refreshWritingReferences.mockResolvedValue(undefined);
    api.getWorkspaceTree.mockResolvedValue({ tree: [] });
    api.getChapters.mockResolvedValue({
      index: { volumes: [] },
      status: { source: 'missing', stale: false },
    });
    api.getWorkspaceStatus.mockResolvedValue({
      pendingActionCount: 0,
      git: {
        available: false,
        source: 'global',
        repository: false,
        status: 'unknown',
        dirty: null,
        files: [],
      },
      gitConfig: { autoCommitOnAccept: true },
    });
    api.getProjectHealth.mockResolvedValue({ health: undefined });
    api.listPendingActions.mockResolvedValue({ pendingActions: [] });
  });

  it('refreshes the Writing selector after Play creates or detaches an attachment', async () => {
    const wrapper = mount(WorkspaceShell, {
      props: {
        workspace: {
          name: 'alpha',
          novelName: 'Alpha',
          path: '/novels/alpha',
          valid: true,
        },
        providerConfigured: true,
        theme: 'dark',
        startGuide: false,
        mode: 'play',
      },
      global: {
        stubs: {
          PlayWorkspace: PlayWorkspaceStub,
          WorkspaceToolbar: true,
          WorkspaceWorkbench: true,
        },
      },
    });
    await flushPromises();

    expect(conversationHarness.refreshWritingReferences).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="publish-writing-reference"]').trigger('click');
    await flushPromises();
    expect(conversationHarness.refreshWritingReferences).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
