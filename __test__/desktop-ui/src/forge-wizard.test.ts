// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import ForgeWizardModal from '../../../apps/desktop-ui/src/components/forge/ForgeWizardModal.vue';
const api = vi.hoisted(() => ({ listForgeDrafts: vi.fn(), readForgeDraft: vi.fn(), createForgeDraft: vi.fn(), discussForgeDraft: vi.fn(), updateForgeDraft: vi.fn(), planForgeDraft: vi.fn(), writeForgeDraft: vi.fn(), proposeForgeDraft: vi.fn(), handoffForgeDraft: vi.fn(), readPendingAction: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/composables/useWorkspaceApi', () => ({ useWorkspaceApi: () => api }));
const draft = () => ({ schemaVersion: 1, id: 'forge-one', revision: 2, idea: '夜城', stage: 'discuss', brief: { title: '夜城', readiness: 80, items: [{ key: 'lead', label: '主角', value: '凌雪', by: 'assistant' }], openPoints: ['动机？'] }, reply: '她如何说话？', questions: [{ id: 'q1', title: '语气', why: '决定关系', kind: 'single', options: [{ label: '克制', sample: '跟紧我。' }] }] });
beforeEach(() => { vi.resetAllMocks(); api.listForgeDrafts.mockResolvedValue({ drafts: [draft()] }); api.readForgeDraft.mockResolvedValue({ draft: draft() }); api.createForgeDraft.mockResolvedValue({ draft: draft() }); api.updateForgeDraft.mockImplementation((_id, input) => Promise.resolve({ draft: { ...draft(), brief: { ...draft().brief, items: [{ ...draft().brief.items[0], ...input.edits?.[0] }] } } })); });
async function loaded() { const wrapper = mount(ForgeWizardModal, { props: { workspaceRoot: '/novel', providerConfigured: true } }); await flushPromises(); await wrapper.get('#forge-drafts').setValue('forge-one'); await flushPromises(); return wrapper; }
function button(wrapper: ReturnType<typeof mount>, text: string) { const found = wrapper.findAll('button').find(candidate => candidate.text() === text); if (!found) throw new Error(`Missing ${text}`); return found; }
describe('guided Forge wizard', () => {
  it('sends the selected question and option identity for host verification', async () => {
    const wrapper = await loaded(); api.discussForgeDraft.mockResolvedValue({draft:draft()});
    await wrapper.get('.option').trigger('click'); await flushPromises();
    expect(api.discussForgeDraft).toHaveBeenCalledWith('forge-one', expect.objectContaining({
      selection:{questionId:'q1',optionIndices:[0]}, expectedRevision:2,
    })); wrapper.unmount();
  });

  it('lets the author hand a question back to the guide without claiming an option', async () => {
    const wrapper = await loaded(); api.discussForgeDraft.mockResolvedValue({draft:draft()});
    await button(wrapper, '你来定').trigger('click'); await flushPromises();
    const input = api.discussForgeDraft.mock.calls[0]![1];
    expect(input.message).toMatch(/你来定$/u);
    expect(input.selection).toBeUndefined();
    wrapper.unmount();
  });

  it('restores drafts and sends author edits and locks with the displayed revision', async () => {
    const wrapper = await loaded(); expect(wrapper.text()).toContain('跟紧我。');
    await button(wrapper, '锁定此项').trigger('click'); await flushPromises();
    expect(api.updateForgeDraft).toHaveBeenCalledWith('forge-one', expect.objectContaining({ expectedRevision: 2, expectedWorkspaceRoot: '/novel', edits: [expect.objectContaining({ locked: true })] }));
    await wrapper.get('#forge-brief-lead').setValue('新的主角'); await flushPromises();
    expect(api.updateForgeDraft).toHaveBeenLastCalledWith('forge-one', expect.objectContaining({ edits: [expect.objectContaining({ value: '新的主角' })] })); wrapper.unmount();
  });
  it('surfaces stale revisions without replacing the reviewed draft', async () => {
    const wrapper = await loaded(); api.discussForgeDraft.mockRejectedValue(new Error('Revision conflict'));
    await wrapper.get('#forge-answer').setValue('她想回家'); await wrapper.get('.discuss-panel form').trigger('submit'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Revision conflict'); expect(wrapper.text()).toContain('夜城'); wrapper.unmount();
  });
  it('ignores late draft loads after workspace switch', async () => {
    let resolve!: (value: unknown) => void; api.readForgeDraft.mockReturnValue(new Promise(done => { resolve = done; }));
    const wrapper = mount(ForgeWizardModal, { props: { workspaceRoot: '/one', providerConfigured: true } }); await flushPromises(); await wrapper.get('#forge-drafts').setValue('forge-one');
    await wrapper.setProps({ workspaceRoot: '/two' }); resolve({ draft: draft() }); await flushPromises();
    expect(wrapper.find('[aria-label="实时设定草图"]').exists()).toBe(false); wrapper.unmount();
  });
  it('gates handoff on accepted approval and exposes rejected state', async () => {
    api.readForgeDraft.mockResolvedValue({ draft: { ...draft(), stage: 'proposed', pendingActionId: 'pa-one', chunks: { opening: '夜色。' } } });
    api.readPendingAction.mockResolvedValue({ pendingAction: { status: 'rejected' } }); const wrapper = await loaded();
    expect(button(wrapper, '一键开演').attributes('disabled')).toBeDefined(); expect(wrapper.text()).toContain('已拒绝');
    api.readPendingAction.mockResolvedValue({ pendingAction: { status: 'accepted' } }); await button(wrapper, '刷新审批状态').trigger('click'); await flushPromises();
    api.handoffForgeDraft.mockResolvedValue({ draft: draft(), sessionId: 'play-one' }); await button(wrapper, '一键开演').trigger('click'); await flushPromises();
    expect(wrapper.emitted('playSessionCreated')).toEqual([['play-one']]); wrapper.unmount();
  });
  it('offers recovery when a durable proposal has no readable pending action', async () => {
    api.readForgeDraft.mockResolvedValue({ draft: { ...draft(), stage: 'proposed', pendingActionId: 'pa-one' } });
    api.readPendingAction.mockRejectedValue(new Error('Missing action'));
    const wrapper = await loaded();
    api.proposeForgeDraft.mockResolvedValue({ draft: { ...draft(), pendingActionId: 'pa-one' }, pendingActionId: 'pa-one' });
    await button(wrapper, '恢复审批').trigger('click'); await flushPromises();
    expect(api.proposeForgeDraft).toHaveBeenCalledWith('forge-one', { expectedRevision: 2, expectedWorkspaceRoot: '/novel' });
    expect(wrapper.emitted('reviewPendingAction')).toEqual([['pa-one']]); wrapper.unmount();
  });
  it('supports keyboard closing', async () => { const wrapper = await loaded(); await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' }); expect(wrapper.emitted('close')).toHaveLength(1); wrapper.unmount(); });
});
