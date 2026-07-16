// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getWorkspaceTree: vi.fn(),
  getChapters: vi.fn(),
  getWorkspaceStatus: vi.fn(),
  getProjectHealth: vi.fn(),
  listPendingActions: vi.fn(),
  acceptPendingAction: vi.fn(),
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
        refreshWritingReferences: vi.fn(),
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
    reviewPendingAction: (_pendingActionId: string) => true,
  },
  template: `
    <button
      data-test="review-created-adoption"
      @click="$emit('reviewPendingAction', 'pending-action-1')"
    >Review created adoption</button>
  `,
});

const WorkspaceWorkbenchStub = defineComponent({
  name: 'WorkspaceWorkbench',
  props: {
    rightTab: { type: String, required: true },
    rightShown: { type: Boolean, required: true },
    selectedPendingAction: { type: Object, default: undefined },
  },
  template: `
    <output data-test="approval-route">
      {{ rightShown ? rightTab : 'closed' }}:{{ selectedPendingAction?.id ?? 'none' }}
    </output>
  `,
});

describe('Play adoption Review routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getWorkspaceTree.mockResolvedValue({ tree: [] });
    api.getChapters.mockResolvedValue({
      index: { volumes: [] },
      status: { source: 'missing', stale: false },
    });
    api.getWorkspaceStatus.mockResolvedValue({
      pendingActionCount: 1,
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
    api.listPendingActions.mockResolvedValue({
      pendingActions: [{
        id: 'pending-action-1',
        title: 'Adopt Play evidence',
        description: 'Prepare a canonical chapter diff.',
        patches: [],
        touchedFiles: ['chapters/0001.md'],
        diff: '+The public gate is locked.',
        createdAt: '2026-07-16T05:01:00.000Z',
        status: 'pending',
      }],
    });
  });

  it('opens the existing approval surface without accepting inside Play', async () => {
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
          WorkspaceWorkbench: WorkspaceWorkbenchStub,
        },
      },
    });
    await flushPromises();

    await wrapper.get('[data-test="review-created-adoption"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="approval-route"]').text()).toBe(
      'approval:pending-action-1',
    );
    expect(api.listPendingActions).toHaveBeenCalledTimes(2);
    expect(api.acceptPendingAction).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
