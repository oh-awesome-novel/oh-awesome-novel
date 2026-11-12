// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const conversationHarness = vi.hoisted(() => ({
  refreshWritingReferences: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getWorkspaceTree: vi.fn(),
  getChapters: vi.fn(),
  getWorkspaceStatus: vi.fn(),
  getProjectHealth: vi.fn(),
  listPendingActions: vi.fn(),
  getWorkspaceFile: vi.fn(),
  searchWorkspace: vi.fn(),
  getWritingProfiles: vi.fn(),
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
        activePendingActions: shallowRef([]), activeFollowUps: shallowRef([]), activeFollowUpNotice: shallowRef(''), activeFollowUpsPaused: shallowRef(false),
        activeStatus: shallowRef('ready'),
        conversationSummaries: shallowRef([]),
        canonicalWritingSourcePaths: shallowRef([]),
        selectCanonicalWritingSources: vi.fn(),
        refreshCanonicalWritingSources: vi.fn().mockResolvedValue(undefined),
        removeCanonicalWritingSource: vi.fn(),
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
import WorkspaceToolbar from '../../../apps/desktop-ui/src/components/workspace/WorkspaceToolbar.vue';
import WorkspaceWorkbench from '../../../apps/desktop-ui/src/components/workspace/WorkspaceWorkbench.vue';
import WorkspaceSearchDialog from '../../../apps/desktop-ui/src/components/workspace/WorkspaceSearchDialog.vue';
import FileTreePanel from '../../../apps/desktop-ui/src/components/workspace/FileTreePanel.vue';

describe('Workspace search to right viewer routing', () => {
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
    api.getWritingProfiles.mockResolvedValue({ state: undefined });
    api.getWorkspaceFile.mockResolvedValue({ path: 'chapters/0001/0001.md', content: '# 章名\n风雪' });
  });

  it('opens the matched file at its line, refreshes the tree and leaves Copilot untouched', async () => {
    const wrapper = mount(WorkspaceShell, {
      props: { workspace: { name: 'alpha', novelName: 'Alpha', path: '/novels/alpha', valid: true }, providerConfigured: true, theme: 'dark', startGuide: false, mode: 'writing' },
      global: { stubs: { PlayWorkspace: true, WorkspaceToolbar: true, WorkspaceWorkbench: true, WorkspaceSearchDialog: true } },
    });
    await flushPromises();
    wrapper.getComponent(WorkspaceToolbar).vm.$emit('openSearch'); await flushPromises();
    wrapper.getComponent(WorkspaceSearchDialog).vm.$emit('openFile', { path: 'chapters/0001/0001.md', line: 2 }); await flushPromises();
    expect(api.getWorkspaceFile).toHaveBeenCalledWith('chapters/0001/0001.md');
    expect(api.getWorkspaceTree).toHaveBeenCalledTimes(2);
    expect(wrapper.getComponent(WorkspaceWorkbench).props()).toMatchObject({ activeFilePath: 'chapters/0001/0001.md', fileLine: 2, fileContent: '# 章名\n风雪', rightShown: true, rightTab: 'file', sidebarTab: 'files', chatInput: '', chatMessages: [] });
    expect(wrapper.findComponent(WorkspaceSearchDialog).exists()).toBe(false);
    wrapper.unmount();
  });
  it('rejects old file reads after switching workspaces', async () => {
    let resolve!: (value: unknown) => void;
    api.getWorkspaceFile.mockReturnValue(new Promise((done) => { resolve = done; }));
    const workspace = { name: 'alpha', novelName: 'Alpha', path: '/novels/alpha', valid: true };
    const wrapper = mount(WorkspaceShell, { props: { workspace, providerConfigured: true, theme: 'dark', startGuide: false, mode: 'writing' }, global: { stubs: { PlayWorkspace: true, WorkspaceToolbar: true, WorkspaceWorkbench: true } } });
    await flushPromises(); wrapper.getComponent(WorkspaceWorkbench).vm.$emit('openFile', 'chapters/0001/0001.md'); await flushPromises();
    await wrapper.setProps({ workspace: { ...workspace, path: '/novels/beta' } });
    resolve({ path: 'chapters/0001/0001.md', content: 'Old workspace content' }); await flushPromises();
    expect(wrapper.getComponent(WorkspaceWorkbench).props()).toMatchObject({ activeFilePath: '', fileContent: '', fileLoading: false }); wrapper.unmount();
  });
  it('expands result ancestors and selects the file while retaining explicit collapse-all', async () => {
    const wrapper = mount(FileTreePanel, { props: { tree: [{ name: 'chapters', path: 'chapters', type: 'directory', children: [{ name: '0001.md', path: 'chapters/0001.md', type: 'file' }] }], loading: false, activePath: 'chapters/0001.md' } });
    expect(wrapper.get('.file-node-button-active').text()).toContain('0001.md');
    await wrapper.get('[aria-label="全部收齐"]').trigger('click'); expect(wrapper.find('.file-node-button-active').exists()).toBe(false); wrapper.unmount();
  });
  it('opens impact review without generation and prefills only the explicitly selected repair workflow', async () => {
    const workspace = { name: 'alpha', novelName: 'Alpha', path: '/novels/alpha', valid: true };
    const wrapper = mount(WorkspaceShell, { props: { workspace, providerConfigured: true, theme: 'dark', startGuide: false, mode: 'writing' }, global: { stubs: { PlayWorkspace: true, WorkspaceToolbar: true, WorkspaceWorkbench: true } } });
    await flushPromises(); const workbench = wrapper.getComponent(WorkspaceWorkbench);
    workbench.vm.$emit('impactRepair', { kind: 'review', path: 'chapters/0001/0001.md' }); await flushPromises();
    expect(workbench.props()).toMatchObject({ activeFilePath: 'chapters/0001/0001.md', rightTab: 'file', queuedPrompt: '' });
    for (const [kind, path, queuedPrompt] of [['settleChapter', 'chapters/0001/0001.md', '/整理本章'], ['summarizeVolume', 'summaries/volume/0001.md', '/整理本卷'], ['summarizeGlobal', 'summaries/global.md', '/整理全书']]) {
      workbench.vm.$emit('impactRepair', { kind, path }); await flushPromises();
      expect(workbench.props()).toMatchObject({ activeFilePath: path, queuedPrompt, chatMessages: [] });
      workbench.vm.$emit('promptConsumed'); await flushPromises();
    }
    api.getWorkspaceFile.mockRejectedValueOnce(new Error('File was removed'));
    workbench.vm.$emit('impactRepair', { kind: 'settleChapter', path: 'chapters/0001/0001.md' }); await flushPromises();
    expect(workbench.props('queuedPrompt')).toBe(''); wrapper.unmount();
  });
  it('does not queue an impact repair into a newly selected workspace', async () => {
    const workspace = { name: 'alpha', novelName: 'Alpha', path: '/novels/alpha', valid: true };
    const wrapper = mount(WorkspaceShell, { props: { workspace, providerConfigured: true, theme: 'dark', startGuide: false, mode: 'writing' }, global: { stubs: { PlayWorkspace: true, WorkspaceToolbar: true, WorkspaceWorkbench: true } } });
    await flushPromises(); let resolve!: (value: unknown) => void;
    api.getWorkspaceFile.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    wrapper.getComponent(WorkspaceWorkbench).vm.$emit('impactRepair', { kind: 'summarizeVolume', path: 'summaries/volume/0001.md' }); await flushPromises();
    await wrapper.setProps({ workspace: { ...workspace, path: '/novels/beta' } });
    resolve({ path: 'summaries/volume/0001.md', content: 'Old summary' }); await flushPromises();
    expect(wrapper.getComponent(WorkspaceWorkbench).props()).toMatchObject({ queuedPrompt: '', activeFilePath: '', fileContent: '' }); wrapper.unmount();
  });
});
