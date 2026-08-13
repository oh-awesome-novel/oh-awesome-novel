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

const WorkspaceWorkbenchStub = defineComponent({
  name: 'WorkspaceWorkbench',
  props: {
    rightTab: { type: String, required: true },
    rightShown: { type: Boolean, required: true },
    selectedPendingAction: { type: Object, default: undefined },
  },
  emits: {
    reviewPendingActionId: (_pendingActionId: string) => true,
  },
  template: `
    <button
      data-test="review-reference-publish"
      @click="$emit('reviewPendingActionId', 'pending-reference-publish-1')"
    >
      Review reference publish
    </button>
  `,
});

describe('WorkspaceShell reference publish handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    conversationHarness.refreshWritingReferences.mockResolvedValue(undefined);
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
  });

  it('awaits the refreshed PendingAction list before selecting and opening approval', async () => {
    const refreshed = deferred<{ pendingActions: ReturnType<typeof pendingAction>[] }>();
    api.listPendingActions
      .mockResolvedValueOnce({ pendingActions: [] })
      .mockImplementationOnce(() => refreshed.promise);

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
        mode: 'writing',
      },
      global: {
        stubs: {
          PlayWorkspace: true,
          WorkspaceToolbar: true,
          WorkspaceWorkbench: WorkspaceWorkbenchStub,
        },
      },
    });
    await flushPromises();

    await wrapper.get('[data-test="review-reference-publish"]').trigger('click');
    await flushPromises();
    expect(api.listPendingActions).toHaveBeenCalledTimes(2);
    expect(
      wrapper.findComponent(WorkspaceWorkbenchStub).props('rightShown'),
    ).toBe(false);

    refreshed.resolve({ pendingActions: [pendingAction()] });
    await flushPromises();

    const workbench = wrapper.findComponent(WorkspaceWorkbenchStub);
    expect(workbench.props('rightShown')).toBe(true);
    expect(workbench.props('rightTab')).toBe('approval');
    expect(workbench.props('selectedPendingAction')).toMatchObject({
      id: 'pending-reference-publish-1',
    });
    wrapper.unmount();
  });
});

function pendingAction() {
  return {
    id: 'pending-reference-publish-1',
    title: 'Publish Reference One deconstruction',
    description: 'Publish the complete accepted candidate.',
    changes: [{
      operation: 'update',
      path: 'examples/references/reference-1/context/index.yaml',
      oldHash: 'a'.repeat(64),
      newHash: 'b'.repeat(64),
    }],
    diff: 'diff --git a/examples/references/reference-1/context/index.yaml ' +
      'b/examples/references/reference-1/context/index.yaml',
    createdAt: '2026-07-22T00:09:00.000Z',
    status: 'pending' as const,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
