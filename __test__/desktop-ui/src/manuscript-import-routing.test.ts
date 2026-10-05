// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
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
  getWorkspaceFile: vi.fn(),
  searchWorkspace: vi.fn(),
  previewManuscriptImport: vi.fn(),
  proposeManuscriptImport: vi.fn(),
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
import WorkspaceToolbar from '../../../apps/desktop-ui/src/components/workspace/WorkspaceToolbar.vue';
import WorkspaceWorkbench from '../../../apps/desktop-ui/src/components/workspace/WorkspaceWorkbench.vue';
import ManuscriptImportDialog from '../../../apps/desktop-ui/src/components/workspace/ManuscriptImportDialog.vue';

const source = '# 旧稿\n风雪。';
const workspace = { name: 'alpha', novelName: 'Alpha', path: '/novels/alpha', valid: true };
const pendingAction = { id: 'pending-manuscript-import', title: '导入旧稿', description: 'Import chapters', status: 'pending', createdAt: '2026-10-05T00:00:00.000Z',
  changes: [{ operation: 'create', path: 'chapters/0001/0001.md', newHash: 'a'.repeat(64) }], diff: '+风雪。' };
function createShell() {
  return mount(WorkspaceShell, { props: { workspace, providerConfigured: false, theme: 'dark', startGuide: false, mode: 'writing' },
    global: { stubs: { PlayWorkspace: true, WorkspaceWorkbench: true } } });
}
async function propose(wrapper: ReturnType<typeof createShell>) {
  await wrapper.get('[aria-label="导入旧稿 Markdown"]').trigger('click');
  await wrapper.get('#manuscript-text').setValue(source); await wrapper.get('form').trigger('submit'); await flushPromises();
  await wrapper.get('footer .primary-button').trigger('click'); await flushPromises();
}
describe('Writing manuscript import approval handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear();
    conversationHarness.refreshWritingReferences.mockResolvedValue(undefined);
    api.getWorkspaceTree.mockResolvedValue({ tree: [] });
    api.getChapters.mockResolvedValue({ index: { volumes: [] }, status: { source: 'missing', stale: false } });
    api.getWorkspaceStatus.mockResolvedValue({ pendingActionCount: 0 });
    api.getProjectHealth.mockResolvedValue({ health: undefined });
    api.getWritingProfiles.mockResolvedValue({ state: undefined });
    api.listPendingActions.mockResolvedValue({ pendingActions: [] });
    api.previewManuscriptImport.mockResolvedValue({ preview: { id: 'pa_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', fingerprint: 'a'.repeat(64), sourceName: '旧稿.md', sourceHash: 'a'.repeat(64), sourceBytes: 18,
      chapters: [{ index: 0, title: '旧稿', volume: 1, chapter: 1, path: 'chapters/0001/0001.md', sourceStartLine: 1, sourceEndLine: 2, sourceBytes: 18 }], conflicts: [], warnings: [], canPropose: true, diff: '+风雪。' } });
    api.proposeManuscriptImport.mockImplementation(async () => { api.listPendingActions.mockResolvedValue({ pendingActions: [pendingAction] }); return { pendingAction }; });
  });
  it('uses the real toolbar and import form then opens the refreshed approval, without requiring a provider', async () => {
    const wrapper = createShell(); await flushPromises();
    expect(wrapper.findComponent(WorkspaceToolbar).exists()).toBe(true);
    await propose(wrapper);
    expect(wrapper.findComponent(ManuscriptImportDialog).exists()).toBe(false);
    expect(wrapper.getComponent(WorkspaceWorkbench).props()).toMatchObject({ rightShown: true, rightTab: 'approval', selectedPendingAction: { id: pendingAction.id } });
    expect(api.proposeManuscriptImport).toHaveBeenCalledTimes(1); expect(wrapper.emitted('configureProvider')).toBeUndefined(); wrapper.unmount();
  });
  it('does not show an old-workspace action if the workspace switches during approval refresh', async () => {
    let resolve!: (value: unknown) => void;
    api.proposeManuscriptImport.mockImplementation(async () => {
      api.listPendingActions.mockReturnValue(new Promise((done) => { resolve = done; }));
      return { pendingAction };
    });
    const wrapper = createShell(); await flushPromises(); await propose(wrapper);
    await wrapper.setProps({ workspace: { ...workspace, path: '/novels/beta' } }); resolve({ pendingActions: [pendingAction] }); await flushPromises();
    expect(wrapper.getComponent(WorkspaceWorkbench).props('pendingActions')).toEqual([]);
    expect(wrapper.getComponent(WorkspaceWorkbench).props('selectedPendingAction')).toBeUndefined();
    expect(wrapper.getComponent(WorkspaceWorkbench).props('rightShown')).toBe(false); wrapper.unmount();
  });
});
