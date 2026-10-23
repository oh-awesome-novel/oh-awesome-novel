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
  rejectPendingAction: vi.fn(),
  quickCommitPendingAction: vi.fn(),
  previewTavernImport: vi.fn(),
  proposeTavernImport: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
vi.mock('../../../apps/desktop-ui/src/composables/useAgentConversationSessions', async () => {
  const { shallowRef } = await import('vue');
  return {
    MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST: 8,
    useAgentConversationSessions: () => ({
      activeConversationId: shallowRef('chat-1'),
      activeInput: shallowRef(''), activeMessages: shallowRef([]),
      activePendingActions: shallowRef([]), activeFollowUps: shallowRef([]), activeFollowUpNotice: shallowRef(''), activeFollowUpsPaused: shallowRef(false), activeStatus: shallowRef('ready'),
      conversationSummaries: shallowRef([]),
        canonicalWritingSourcePaths: shallowRef([]),
        selectCanonicalWritingSources: vi.fn(),
        refreshCanonicalWritingSources: vi.fn().mockResolvedValue(undefined),
        removeCanonicalWritingSource: vi.fn(), writingReferenceAttachments: shallowRef([]),
      writingReferencesLoading: shallowRef(false), writingReferencesError: shallowRef(''),
      selectedWritingReferenceAttachmentIds: shallowRef([]),
      createConversation: vi.fn(), refreshWritingReferences: vi.fn(),
      selectConversation: vi.fn(), sendCurrentInput: vi.fn(), stop: vi.fn(),
      toggleWritingReferenceAttachment: vi.fn(),
    }),
  };
});

import WorkspaceShell from '../../../apps/desktop-ui/src/components/workspace/WorkspaceShell.vue';
import WorkspaceRightPanel from '../../../apps/desktop-ui/src/components/workspace/WorkspaceRightPanel.vue';
import TavernImportPanel from '../../../apps/desktop-ui/src/components/play/TavernImportPanel.vue';

const actionId = 'pa_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const hash = 'a'.repeat(64);
const PlayWorkspaceStub = defineComponent({
  name: 'PlayWorkspace',
  components: { TavernImportPanel },
  props: ['workspace', 'files'],
  emits: ['reviewPendingAction', 'pendingActionCreated'],
  template: `
    <section aria-label="Play workspace">
      <button data-test="review-created-adoption"
        @click="$emit('reviewPendingAction', '${actionId}')">Review created adoption</button>
      <TavernImportPanel :workspace-root="workspace.path"
        @pending-action-created="$emit('pendingActionCreated')"
        @review-pending-action="$emit('reviewPendingAction', $event)" />
      <output data-test="play-source-files">{{ JSON.stringify(files) }}</output>
    </section>
  `,
});

function pendingAction(status = 'pending') {
  return {
    id: actionId, title: 'Import Lin character', description: 'Review the character files.',
    changes: [{ operation: 'create', path: 'characters/lin/interaction.md', newHash: hash }],
    diff: '+Lin greets the visitor.', createdAt: '2026-10-07T05:01:00.000Z', status,
  };
}

function createWrapper() {
  return mount(WorkspaceShell, {
    attachTo: document.body,
    props: {
      workspace: { name: 'alpha', novelName: 'Alpha', path: '/novels/alpha', valid: true },
      providerConfigured: true, theme: 'dark', startGuide: false, mode: 'play',
    },
    global: {
      // Keep the actual Shell, Workbench, toolbar, approval cards and diff mounted.
      stubs: {
        PlayWorkspace: PlayWorkspaceStub, CopilotPanel: true,
        WorkspaceLeftPanel: true, WorkspaceLeftHoverRail: true,
      },
    },
  });
}

function button(wrapper: ReturnType<typeof createWrapper>, text: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === text);
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}

async function reviewAdoption(wrapper: ReturnType<typeof createWrapper>) {
  await flushPromises();
  const trigger = wrapper.get<HTMLButtonElement>('[data-test="review-created-adoption"]');
  trigger.element.focus();
  await trigger.trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  api.getWorkspaceTree.mockResolvedValue({ tree: [] });
  api.getChapters.mockResolvedValue({ index: { volumes: [] }, status: { source: 'missing', stale: false } });
  api.getWorkspaceStatus.mockResolvedValue({
    pendingActionCount: 1,
    git: { available: false, source: 'global', repository: false, status: 'unknown', dirty: null, files: [] },
    gitConfig: { autoCommitOnAccept: true },
  });
  api.getProjectHealth.mockResolvedValue({ health: undefined });
  api.listPendingActions.mockResolvedValue({ pendingActions: [pendingAction()] });
});

describe('Play review surface', () => {
  it('opens visible approval and diff, restores focus on Escape, and reopens from the Play toolbar', async () => {
    const wrapper = createWrapper();
    await reviewAdoption(wrapper);
    expect(wrapper.get('[aria-label="PendingAction approval"]').isVisible()).toBe(true);
    expect(wrapper.findAllComponents(WorkspaceRightPanel)).toHaveLength(1);
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Play review"]').element);
    expect(api.acceptPendingAction).not.toHaveBeenCalled();
    expect(wrapper.emitted('selectMode')).toBeUndefined();

    await button(wrapper, 'Diff').trigger('click');
    expect(wrapper.get('[aria-label="Diff review"]').isVisible()).toBe(true);
    expect(wrapper.get('[aria-label="PendingAction diff text"]').text()).toContain('+Lin greets');
    await wrapper.get('[aria-label="Play review"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[aria-label="Play review"]').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('[data-test="review-created-adoption"]').element);
    await wrapper.get('[aria-label="Pending actions"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="PendingAction approval"]').isVisible()).toBe(true);

    await wrapper.setProps({ mode: 'writing' });
    expect(wrapper.find('[aria-label="Play review"]').exists()).toBe(false);
    expect(wrapper.findAllComponents(WorkspaceRightPanel)).toHaveLength(1);
    expect(wrapper.get('[aria-label="PendingAction approval"]').isVisible()).toBe(true);
    wrapper.unmount();
  });

  it('hands a real Tavern preview into visible approval and refreshes Play source files after Accept', async () => {
    const wrapper = createWrapper();
    api.previewTavernImport.mockResolvedValue({ preview: {
      id: actionId, fingerprint: hash, sourceName: 'lin.json', sourceHash: hash,
      displayName: 'Lin', characterId: 'lin', mode: 'create',
      files: [{ path: 'characters/lin/interaction.md', operation: 'create' }],
      warnings: [], conflicts: [], diff: '+Lin greets the visitor.', canPropose: true,
    } });
    api.proposeTavernImport.mockResolvedValue({ pendingAction: pendingAction() });
    api.acceptPendingAction.mockImplementation(async () => {
      api.listPendingActions.mockResolvedValue({ pendingActions: [pendingAction('accepted')] });
      api.getWorkspaceTree.mockResolvedValue({ tree: [{
        name: 'interaction.md', path: 'characters/lin/interaction.md', type: 'file',
      }] });
    });
    await flushPromises();
    const file = wrapper.get('input[type="file"]');
    Object.defineProperty(file.element, 'files', { configurable: true,
      value: [new File(['{"name":"Lin"}'], 'lin.json', { type: 'application/json' })] });
    await file.trigger('change');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Selected: lin.json'));
    await wrapper.get('select').setValue('create');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await button(wrapper, 'Create changes for approval').trigger('click');
    await flushPromises();
    await button(wrapper, 'Review changes').trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="PendingAction approval"]').isVisible()).toBe(true);
    expect(api.acceptPendingAction).not.toHaveBeenCalled();
    await button(wrapper, 'Accept').trigger('click');
    await flushPromises();
    expect(api.acceptPendingAction).toHaveBeenCalledExactlyOnceWith(actionId);
    expect(wrapper.get('[data-test="play-source-files"]').text()).toContain('characters/lin/interaction.md');
    expect(wrapper.get('[aria-label="PendingAction approval"]').text()).toContain('accepted');
    expect(wrapper.emitted('selectMode')).toBeUndefined();
    wrapper.unmount();
  });

  it('routes Reject through the shared API and keeps the refreshed source tree unchanged', async () => {
    const wrapper = createWrapper();
    api.rejectPendingAction.mockImplementation(async () => {
      api.listPendingActions.mockResolvedValue({ pendingActions: [pendingAction('rejected')] });
    });
    await reviewAdoption(wrapper);
    await button(wrapper, 'Reject').trigger('click');
    await flushPromises();
    expect(api.rejectPendingAction).toHaveBeenCalledExactlyOnceWith(actionId);
    expect(api.acceptPendingAction).not.toHaveBeenCalled();
    expect(api.getWorkspaceTree).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="play-source-files"]').text()).toBe('[]');
    expect(wrapper.get('[aria-label="PendingAction approval"]').text()).toContain('rejected');
    wrapper.unmount();
  });

  it('exposes the existing explicit Quick commit action for accepted Play changes', async () => {
    api.listPendingActions.mockResolvedValue({ pendingActions: [{
      ...pendingAction('accepted'), git: { status: 'staged-not-committed' },
    }] });
    const wrapper = createWrapper();
    await reviewAdoption(wrapper);
    await button(wrapper, 'Quick commit').trigger('click');
    await flushPromises();
    expect(api.quickCommitPendingAction).toHaveBeenCalledExactlyOnceWith(actionId);
    expect(api.getWorkspaceTree).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
