// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ManuscriptImportDialog from '../../../apps/desktop-ui/src/components/workspace/ManuscriptImportDialog.vue';
import WorkspaceToolbar from '../../../apps/desktop-ui/src/components/workspace/WorkspaceToolbar.vue';
const api = vi.hoisted(() => ({ previewManuscriptImport: vi.fn(), proposeManuscriptImport: vi.fn(), readPendingAction: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/composables/useWorkspaceApi', () => ({ useWorkspaceApi: () => api }));
const source = '# 第一章 风雪\n归来。\n';
const preview = () => ({ preview: { id: 'pa_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', fingerprint: 'a'.repeat(64), sourceName: '旧稿.md', sourceHash: 'b'.repeat(64), sourceBytes: new TextEncoder().encode(source).byteLength,
  chapters: [{ index: 0, volume: 1, chapter: 1, title: '风雪', path: 'chapters/0001/0001.md', sourceStartLine: 1, sourceEndLine: 2, sourceBytes: new TextEncoder().encode(source).byteLength }], conflicts: [], warnings: [], canPropose: true, diff: '+归来。<script>unsafe</script>' } });
const proposal = () => ({ pendingAction: { id: 'pending-import-1' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.resetAllMocks(); api.previewManuscriptImport.mockResolvedValue(preview()); api.proposeManuscriptImport.mockResolvedValue(proposal()); api.readPendingAction.mockRejectedValue(new Error('Not found')); });
afterEach(() => { document.body.innerHTML = ''; });
async function previewSource(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('#manuscript-text').setValue(source); await wrapper.get('form').trigger('submit'); await flushPromises();
}
async function chooseFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.get('#manuscript-file'); Object.defineProperty(input.element, 'files', { configurable: true, value: [file] }); await input.trigger('change'); await flushPromises();
}
describe('author Markdown import UI', () => {
  it('previews pasted source, displays retained text and routes an explicit proposal to approval without Accept', async () => {
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } });
    expect(api.previewManuscriptImport).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('512 KiB、64 章');
    await previewSource(wrapper);
    expect(api.previewManuscriptImport).toHaveBeenCalledWith({ sourceName: '旧稿.md', text: source, expectedWorkspaceRoot: '/novels/one' });
    expect(wrapper.get('.diff-preview').text()).toContain('<script>unsafe</script>'); expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('chapters/0001/0001.md'); expect(wrapper.text()).toContain('原有标题');
    await wrapper.get('footer .primary-button').trigger('click'); await flushPromises();
    expect(api.proposeManuscriptImport).toHaveBeenCalledWith(preview().preview.id, { fingerprint: 'a'.repeat(64), expectedWorkspaceRoot: '/novels/one' });
    expect(wrapper.emitted('proposed')).toEqual([['pending-import-1']]); wrapper.unmount();
  });
  it('requires remapping conflicts and immediately discards a preview after a mapping or source edit', async () => {
    api.previewManuscriptImport.mockResolvedValueOnce({ preview: { ...preview().preview, id: null, fingerprint: null, canPropose: false,
      conflicts: [{ index: 0, path: 'chapters/0001/0001.md', reason: 'exists' }] } });
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper);
    expect(wrapper.text()).toContain('目标章节已存在'); expect(wrapper.get('footer .primary-button').attributes('disabled')).toBeDefined();
    await wrapper.get('#import-volume-0').setValue('2'); expect(wrapper.find('[aria-label="旧稿导入预览"]').exists()).toBe(false);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.previewManuscriptImport).toHaveBeenLastCalledWith(expect.objectContaining({ mappings: [{ index: 0, volume: 2, chapter: 1, title: '风雪' }] }));
    await wrapper.get('#manuscript-text').setValue('changed'); expect(wrapper.find('[aria-label="卷章映射"]').exists()).toBe(false); expect(wrapper.get('footer .primary-button').attributes('disabled')).toBeDefined(); wrapper.unmount();
  });
  it('blocks invalid mapping ranges and keeps errors visible', async () => {
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper);
    await wrapper.get('#import-chapter-0').setValue('0'); expect(wrapper.get('[type="submit"]').attributes('disabled')).toBeDefined(); expect(wrapper.text()).toContain('请填写 1–9999');
    await wrapper.get('#import-chapter-0').setValue('2'); api.previewManuscriptImport.mockRejectedValue(new Error('目标已变化'));
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(wrapper.text()).toContain('目标已变化'); expect(wrapper.get('footer .primary-button').attributes('disabled')).toBeDefined(); wrapper.unmount();
  });
  it('reads exact UTF-8 bytes including BOM and rejects invalid encoding and oversized files', async () => {
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } });
    await chooseFile(wrapper, new File([new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41])], '原稿.md'));
    expect((wrapper.get('#manuscript-text').element as HTMLTextAreaElement).value).toBe('\ufeff# A');
    await chooseFile(wrapper, new File([new Uint8Array([0xc3, 0x28])], '坏稿.md'));
    expect(wrapper.text()).toContain('不是有效的 UTF-8'); expect(wrapper.get('footer .primary-button').attributes('disabled')).toBeDefined();
    await chooseFile(wrapper, new File(['a'.repeat(512 * 1024 + 1)], '大稿.md')); expect(wrapper.text()).toContain('请拆分原稿');
    expect(api.previewManuscriptImport).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('discards late previews after editing and after workspace changes', async () => {
    const first = deferred<ReturnType<typeof preview>>(); api.previewManuscriptImport.mockReturnValueOnce(first.promise);
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper);
    await wrapper.get('#manuscript-text').setValue('new text'); first.resolve(preview()); await flushPromises();
    expect(wrapper.find('[aria-label="旧稿导入预览"]').exists()).toBe(false);
    const second = deferred<ReturnType<typeof preview>>(); api.previewManuscriptImport.mockReturnValueOnce(second.promise);
    await wrapper.get('form').trigger('submit'); await wrapper.setProps({ workspacePath: '/novels/two' }); second.resolve(preview()); await flushPromises();
    expect((wrapper.get('#manuscript-text').element as HTMLTextAreaElement).value).toBe(''); expect(wrapper.find('[aria-label="旧稿导入预览"]').exists()).toBe(false); wrapper.unmount();
  });
  it('isolates late file reads from pasted text and workspace switches', async () => {
    const bytes = deferred<ArrayBuffer>(); const file = new File([source], '旧稿.md'); Object.defineProperty(file, 'arrayBuffer', { value: () => bytes.promise });
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await chooseFile(wrapper, file);
    await wrapper.get('#manuscript-text').setValue('作者新输入'); bytes.resolve(new TextEncoder().encode(source).buffer); await flushPromises();
    expect((wrapper.get('#manuscript-text').element as HTMLTextAreaElement).value).toBe('作者新输入'); wrapper.unmount();
  });
  it('prevents double proposals and ignores a late proposal after switching workspace or closing', async () => {
    const pending = deferred<ReturnType<typeof proposal>>(); api.proposeManuscriptImport.mockReturnValue(pending.promise);
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper);
    await wrapper.get('footer .primary-button').trigger('click'); await wrapper.get('footer .primary-button').trigger('click');
    expect(api.proposeManuscriptImport).toHaveBeenCalledTimes(1); await wrapper.setProps({ workspacePath: '/novels/two' }); wrapper.unmount(); pending.resolve(proposal()); await flushPromises(); expect(wrapper.emitted('proposed')).toBeUndefined();
  });
  it('requires a fresh preview after a stale proposal and keeps the source', async () => {
    api.proposeManuscriptImport.mockRejectedValue(new Error('Preview is stale'));
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper); await wrapper.get('footer .primary-button').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('请重新预览'); expect(wrapper.text()).toContain('可能已创建'); expect((wrapper.get('#manuscript-text').element as HTMLTextAreaElement).value).toBe(source);
    expect(wrapper.get('footer .primary-button').attributes('disabled')).toBeDefined(); expect(wrapper.emitted('proposed')).toBeUndefined(); wrapper.unmount();
  });
  it('recovers a persisted proposal after a lost response using only the known action read', async () => {
    const reviewed = preview().preview;
    api.proposeManuscriptImport.mockRejectedValue(new Error('Network response lost'));
    api.readPendingAction.mockResolvedValue({ pendingAction: { id: reviewed.id, status: 'pending',
      origin: { kind: 'manuscriptImport', previewId: reviewed.id, sourceHash: reviewed.sourceHash, mappingHash: 'c'.repeat(64) },
      changes: [{ operation: 'create', path: reviewed.chapters[0]!.path, newHash: 'a'.repeat(64) }] } });
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper);
    await wrapper.get('footer .primary-button').trigger('click'); await flushPromises();
    expect(api.readPendingAction).toHaveBeenCalledWith(reviewed.id); expect(api.proposeManuscriptImport).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('proposed')).toEqual([[reviewed.id]]); wrapper.unmount();
  });
  it.each(['origin', 'source', 'paths'])('does not hand off a recovered action with mismatched %s', async (mismatch) => {
    const reviewed = preview().preview;
    api.proposeManuscriptImport.mockRejectedValue(new Error('Network response lost'));
    api.readPendingAction.mockResolvedValue({ pendingAction: { id: reviewed.id, status: 'pending',
      origin: { kind: 'manuscriptImport', previewId: mismatch === 'origin' ? 'other' : reviewed.id, sourceHash: mismatch === 'source' ? 'd'.repeat(64) : reviewed.sourceHash },
      changes: [{ operation: 'create', path: mismatch === 'paths' ? 'chapters/0001/0002.md' : reviewed.chapters[0]!.path }] } });
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper);
    await wrapper.get('footer .primary-button').trigger('click'); await flushPromises();
    expect(wrapper.emitted('proposed')).toBeUndefined(); expect(wrapper.text()).toContain('可能已创建'); wrapper.unmount();
  });
  it('does not start recovery after a workspace switch and ignores a recovery already in flight', async () => {
    let reject!: (error: Error) => void;
    api.proposeManuscriptImport.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const wrapper = mount(ManuscriptImportDialog, { props: { workspacePath: '/novels/one' } }); await previewSource(wrapper);
    await wrapper.get('footer .primary-button').trigger('click'); await wrapper.setProps({ workspacePath: '/novels/two' });
    reject(new Error('Response lost')); await flushPromises(); expect(api.readPendingAction).not.toHaveBeenCalled();
    const recovery = deferred<unknown>(); api.proposeManuscriptImport.mockRejectedValue(new Error('Response lost')); api.readPendingAction.mockReturnValue(recovery.promise);
    await previewSource(wrapper); await wrapper.get('footer .primary-button').trigger('click'); await flushPromises();
    await wrapper.setProps({ workspacePath: '/novels/three' }); recovery.resolve({ pendingAction: { id: preview().preview.id, status: 'pending', origin: { kind: 'manuscriptImport', previewId: preview().preview.id, sourceHash: preview().preview.sourceHash }, changes: [{ operation: 'create', path: 'chapters/0001/0001.md' }] } }); await flushPromises();
    expect(wrapper.emitted('proposed')).toBeUndefined(); expect(wrapper.text()).not.toContain('可能已创建'); wrapper.unmount();
  });
  it('labels inputs, traps focus including the source textarea, closes with Escape and restores the trigger', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const wrapper = mount(ManuscriptImportDialog, { attachTo: document.body, props: { workspacePath: '/novels/one' } }); await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[aria-label="关闭旧稿导入"]').element);
    expect(wrapper.find('label[for="manuscript-text"]').exists()).toBe(true);
    await wrapper.get('[aria-label="关闭旧稿导入"]').trigger('keydown', { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(wrapper.get('footer .ghost-button').element);
    await wrapper.get('#manuscript-text').trigger('keydown', { key: 'Escape' }); expect(wrapper.emitted('close')).toHaveLength(1); wrapper.unmount(); expect(document.activeElement).toBe(trigger);
  });
  it('shows the import entry only in Writing and emits its own action', async () => {
    const wrapper = mount(WorkspaceToolbar, { props: { workspace: { name: 'Novel', novelName: 'Novel', path: '/novels/one', valid: true }, workspaceMode: 'writing', providerConfigured: false, theme: 'dark', leftPinned: false, rightShown: false, rightTab: 'health', pendingActionCount: 0 } });
    await wrapper.get('[aria-label="导入旧稿 Markdown"]').trigger('click'); expect(wrapper.emitted('openManuscriptImport')).toHaveLength(1);
    await wrapper.setProps({ workspaceMode: 'play' }); expect(wrapper.find('[aria-label="导入旧稿 Markdown"]').exists()).toBe(false); wrapper.unmount();
  });
});
