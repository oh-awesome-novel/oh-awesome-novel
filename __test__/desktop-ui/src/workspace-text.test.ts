// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSearchDialog from '../../../apps/desktop-ui/src/components/workspace/WorkspaceSearchDialog.vue';
import ManuscriptExportDialog from '../../../apps/desktop-ui/src/components/workspace/ManuscriptExportDialog.vue';
import FileViewer from '../../../apps/desktop-ui/src/components/workspace/FileViewer.vue';
const api = vi.hoisted(() => ({ searchWorkspace: vi.fn(), exportManuscript: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/composables/useWorkspaceApi', () => ({ useWorkspaceApi: () => api }));
const response = () => ({ schemaVersion: 1, query: '风雪', scannedAt: '2026-10-01T00:00:00.000Z', scannedFiles: 1, sourceFingerprint: 'a'.repeat(64), truncated: false,
  results: [{ path: 'chapters/0001/0001.md', name: '0001.md', domain: 'chapters', line: 2, snippet: '风雪归来', matchedField: 'content' }] });
const manuscript = () => ({ schemaVersion: 1, format: 'md', fileName: 'manuscript-2026-10-01T00-00-00-000Z.md', content: '# 风雪\n', chapterPaths: ['chapters/0001/0001.md'] });
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); api.searchWorkspace.mockResolvedValue(response()); api.exportManuscript.mockResolvedValue(manuscript()); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function query(wrapper: ReturnType<typeof mount>) { await wrapper.get('input').setValue('风雪'); await vi.advanceTimersByTimeAsync(201); await flushPromises(); }
describe('canonical workspace text UI', () => {
  it('searches body text, displays snippet/line, emits an explicit file open and refreshes after edits/Accept', async () => {
    const wrapper = mount(WorkspaceSearchDialog, { props: { workspacePath: '/novel', refreshVersion: 0 } });
    expect(api.searchWorkspace).not.toHaveBeenCalled(); await query(wrapper);
    expect(api.searchWorkspace).toHaveBeenCalledWith('风雪'); expect(wrapper.text()).toContain('风雪归来'); expect(wrapper.text()).toContain('第 2 行');
    await wrapper.get('.search-result').trigger('click'); expect(wrapper.emitted('openFile')).toEqual([[{ path: 'chapters/0001/0001.md', line: 2 }]]);
    api.searchWorkspace.mockResolvedValue({ ...response(), results: [] });
    await wrapper.get('.search-freshness button').trigger('click'); await flushPromises(); expect(wrapper.text()).toContain('No matches');
    await wrapper.setProps({ refreshVersion: 1 }); await flushPromises(); expect(api.searchWorkspace).toHaveBeenCalledTimes(3); wrapper.unmount();
  });
  it('ignores stale requests and clears results on workspace switches', async () => {
    let resolve!: (value: unknown) => void; api.searchWorkspace.mockReturnValue(new Promise((done) => { resolve = done; }));
    const wrapper = mount(WorkspaceSearchDialog, { props: { workspacePath: '/first', refreshVersion: 0 } });
    await query(wrapper); await wrapper.setProps({ workspacePath: '/second' }); resolve(response()); await flushPromises();
    expect(wrapper.find('.search-result').exists()).toBe(false); expect((wrapper.get('input').element as HTMLInputElement).value).toBe(''); wrapper.unmount();
  });
  it('focuses search, traps keyboard focus, closes on Escape and restores the trigger', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const wrapper = mount(WorkspaceSearchDialog, { attachTo: document.body, props: { workspacePath: '/novel', refreshVersion: 0 } }); await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('input').element);
    await wrapper.get('input').trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Close search"]').element);
    await wrapper.trigger('keydown', { key: 'Escape' }); expect(wrapper.emitted('close')).toHaveLength(1); wrapper.unmount(); expect(document.activeElement).toBe(trigger);
  });
  it('highlights exactly the requested line without interpreting HTML or creating one element per line', () => {
    const content = '# 标题\n风雪<script>bad</script>\n尾声';
    const wrapper = mount(FileViewer, { props: { path: 'chapters/0001/0001.md', content, loading: false, line: 2 } });
    expect(wrapper.get('mark[data-line="2"]').text()).toBe('风雪<script>bad</script>'); expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.get('pre').text()).toBe(content); expect(wrapper.findAll('mark')).toHaveLength(1); wrapper.unmount();
  });
  it('downloads only after an explicit format choice and uses server filename/content', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:manuscript'); const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let downloaded: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = this; });
    const wrapper = mount(ManuscriptExportDialog, { props: { workspacePath: '/novel' } }); expect(api.exportManuscript).not.toHaveBeenCalled();
    await wrapper.get('.primary-button').trigger('click'); await flushPromises();
    expect(api.exportManuscript).toHaveBeenCalledWith('md'); expect(downloaded?.download).toBe(manuscript().fileName); expect(downloaded?.href).toBe('blob:manuscript');
    expect(await (create.mock.calls[0]![0] as Blob).text()).toBe(manuscript().content);
    await vi.advanceTimersByTimeAsync(1000); expect(revoke).toHaveBeenCalledWith('blob:manuscript'); expect(wrapper.text()).toContain('1 章'); wrapper.unmount();
  });
  it('does not download after closing or switching workspace while the export request is pending', async () => {
    let resolve!: (value: unknown) => void; api.exportManuscript.mockReturnValue(new Promise((done) => { resolve = done; }));
    const create = vi.spyOn(URL, 'createObjectURL');
    const wrapper = mount(ManuscriptExportDialog, { props: { workspacePath: '/first' } });
    await wrapper.get('.primary-button').trigger('click'); await wrapper.setProps({ workspacePath: '/second' }); wrapper.unmount(); resolve(manuscript()); await flushPromises(); expect(create).not.toHaveBeenCalled();
  });
  it('shows safe read errors without emitting a result or download', async () => {
    api.searchWorkspace.mockRejectedValue(new Error('Unsafe source')); const wrapper = mount(WorkspaceSearchDialog, { props: { workspacePath: '/novel', refreshVersion: 0 } }); await query(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toBe('Unsafe source'); expect(wrapper.find('.search-result').exists()).toBe(false); wrapper.unmount();
  });
});
