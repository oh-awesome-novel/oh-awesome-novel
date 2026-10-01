// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getGitStatus: vi.fn(), getGitLog: vi.fn(), getGitDiff: vi.fn(), quickCommit: vi.fn(),
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

describe('Git review preview gate', () => {
  it('uses both rename paths for visible preview and explicit commit', async () => {
    api.getGitDiff.mockResolvedValue({ diff: 'rename from 旧 名.md\nrename to 新 名.md' });
    api.quickCommit.mockResolvedValue({ status: 'committed' });
    const wrapper = mount(GitReviewTab);
    await flushPromises();
    expect(api.getGitDiff).toHaveBeenCalledWith(['旧 名.md', '新 名.md']);
    await wrapper.get('.primary-button').trigger('click');
    expect(api.quickCommit).toHaveBeenCalledWith(expect.objectContaining({ files: ['旧 名.md', '新 名.md'] }));
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
});
