// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getGitStatus: vi.fn(), getGitLog: vi.fn(), getGitDiff: vi.fn(), quickCommit: vi.fn(), syncGit: vi.fn(), getGitCommit: vi.fn(),
}));
vi.mock('../../../apps/desktop-ui/src/composables/useWorkspaceApi', () => ({ useWorkspaceApi: () => api }));
import GitReviewTab from '../../../apps/desktop-ui/src/components/workspace/GitReviewTab.vue';

beforeEach(() => {
  vi.resetAllMocks();
  api.getGitStatus.mockResolvedValue({
    available: true, source: 'global', repository: true, head: 'a'.repeat(40), status: 'dirty', dirty: true,
    files: [{ path: '新 名.md', originalPath: '旧 名.md', indexStatus: 'R', worktreeStatus: ' ', raw: 'R  rename' }],
  });
  api.getGitLog.mockResolvedValue({ commits: [] });
});

const preview = { id: 'git_00000000-0000-4000-8000-000000000000', fingerprint: 'a'.repeat(64), files: ['旧 名.md', '新 名.md'], head: 'a'.repeat(40), expiresAt: '2030-01-01T00:00:00.000Z' };

describe('Git review preview gate', () => {
  it('uses both rename paths for visible preview and explicit commit', async () => {
    api.getGitDiff.mockResolvedValue({ diff: 'rename from 旧 名.md\nrename to 新 名.md', preview });
    api.quickCommit.mockResolvedValue({ status: 'committed' });
    const wrapper = mount(GitReviewTab);
    await flushPromises();
    expect(api.getGitDiff).toHaveBeenCalledWith(['旧 名.md', '新 名.md']);
    await wrapper.get('.primary-button').trigger('click');
    expect(api.quickCommit).toHaveBeenCalledWith(expect.objectContaining({ files: ['旧 名.md', '新 名.md'], previewId: preview.id, previewFingerprint: preview.fingerprint }));
    await flushPromises();
    wrapper.unmount();
  });

  it('disables committing when preview fails instead of presenting an empty successful diff', async () => {
    api.getGitDiff.mockRejectedValue(new Error('Unsupported workspace path'));
    const wrapper = mount(GitReviewTab);
    await flushPromises();
    expect(wrapper.text()).toContain('Unsupported workspace path');
    expect(wrapper.get('.primary-button').attributes('disabled')).toBeDefined();
    await wrapper.get('.primary-button').trigger('click');
    expect(api.quickCommit).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('invalidates a rejected preview and requires a new review, while preventing duplicate clicks', async () => {
    api.getGitDiff.mockResolvedValue({ diff: 'reviewed', preview });
    let resolve!: (value: unknown) => void;
    api.quickCommit.mockReturnValue(new Promise((done) => { resolve = done; }));
    const wrapper = mount(GitReviewTab); await flushPromises();
    await wrapper.get('.primary-button').trigger('click'); await wrapper.get('.primary-button').trigger('click');
    expect(api.quickCommit).toHaveBeenCalledTimes(1); expect(wrapper.get('.primary-button').attributes('disabled')).toBeDefined();
    resolve({ status: 'failed', error: { code: 'stale_preview', message: 'Files changed' } }); await flushPromises();
    expect(wrapper.text()).toContain('Refresh and review again'); expect(wrapper.get('.primary-button').attributes('disabled')).toBeDefined(); wrapper.unmount();
  });
  it('keeps committed warnings visible and retries the same credential only for index finalization', async () => {
    api.getGitDiff.mockResolvedValue({ diff: 'reviewed', preview });
    api.quickCommit.mockResolvedValue({ status: 'committed', hash: 'b'.repeat(40), message: 'saved', warning: { code: 'index_recovery_required', message: 'Commit saved; index needs repair' } });
    const wrapper = mount(GitReviewTab); await flushPromises(); await wrapper.get('.primary-button').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Commit saved; index needs repair'); expect(wrapper.get('.primary-button').text()).toContain('Retry Git index finalization');
    await wrapper.get('.primary-button').trigger('click'); await flushPromises(); expect(api.quickCommit.mock.calls[1]?.[0]).toEqual(api.quickCommit.mock.calls[0]?.[0]); wrapper.unmount();
  });
  it('ignores a late preview after the workspace prop changes', async () => {
    let resolve!: (value: unknown) => void;
    api.getGitDiff.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue({ diff: 'new workspace diff', preview: { ...preview, id: 'git_11111111-1111-4111-8111-111111111111' } });
    const wrapper = mount(GitReviewTab, { props: { workspacePath: '/workspace/a' } }); await flushPromises();
    await wrapper.setProps({ workspacePath: '/workspace/b' }); await flushPromises();
    resolve({ diff: 'old workspace diff', preview }); await flushPromises();
    expect(wrapper.text()).toContain('new workspace diff'); expect(wrapper.text()).not.toContain('old workspace diff');
    await wrapper.get('.primary-button').trigger('click'); expect(api.quickCommit).toHaveBeenCalledWith(expect.objectContaining({ previewId: 'git_11111111-1111-4111-8111-111111111111' })); wrapper.unmount();
  });
});
