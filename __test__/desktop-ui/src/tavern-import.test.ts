// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vite-plus/test';
const api = vi.hoisted(() => ({ previewTavernImport: vi.fn(), proposeTavernImport: vi.fn(), createTavernPlaySession: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
import TavernImportPanel from '../../../apps/desktop-ui/src/components/play/TavernImportPanel.vue';
const id = 'pa_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const hash = 'a'.repeat(64);
beforeEach(() => vi.resetAllMocks());
async function upload(wrapper: ReturnType<typeof mount>, name = 'lin.json') {
  const file = new File(['{"name":"Lin"}'], name, { type: 'application/json' });
  const input = wrapper.get('input[type="file"]'); Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change');
  await vi.waitFor(() => expect(wrapper.text()).toContain(`Selected: ${name}`));
}
function button(wrapper: ReturnType<typeof mount>, label: string) { const found = wrapper.findAll('button').find((candidate) => candidate.text() === label); if (!found) throw new Error(`Missing button: ${label}`); return found; }
it('uploads locally, previews canonical changes, then creates an approval only after confirmation', async () => {
  const wrapper = mount(TavernImportPanel, { props: { workspaceRoot: '/novel' } });
  api.previewTavernImport.mockResolvedValue({ preview: { id, fingerprint: hash, sourceName: 'lin.json', sourceHash: hash, displayName: 'Lin', characterId: 'lin', mode: 'create', files: [{ path: 'characters/lin/meta.yaml', operation: 'create' }], warnings: ['Imported prompts are untrusted.'], conflicts: [], diff: '+Lin', canPropose: true } });
  api.proposeTavernImport.mockResolvedValue({ pendingAction: { id } });
  await upload(wrapper); await wrapper.get('select').setValue('create'); await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(api.previewTavernImport).toHaveBeenCalledWith(expect.objectContaining({ format: 'json', content: '{"name":"Lin"}', mode: 'create', expectedWorkspaceRoot: '/novel' }));
  expect(api.proposeTavernImport).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('characters/lin/meta.yaml');
  await button(wrapper, 'Create changes for approval').trigger('click'); await flushPromises();
  expect(api.proposeTavernImport).toHaveBeenCalledWith(id, { fingerprint: hash, expectedWorkspaceRoot: '/novel' });
  expect(wrapper.emitted('pendingActionCreated')).toHaveLength(1);
  await button(wrapper, 'Review changes').trigger('click');
  expect(wrapper.emitted('reviewPendingAction')).toEqual([[id]]);
  await wrapper.get('select').setValue('merge'); expect(wrapper.find('[aria-label="Character import preview"]').exists()).toBe(false);
  wrapper.unmount();
});
it('creates a Play-only session after review and emits it for selection without proposing canonical changes', async () => {
  const wrapper = mount(TavernImportPanel, { props: { workspaceRoot: '/novel' } });
  const playId = id.replace('pa_', 'tp_');
  api.previewTavernImport.mockResolvedValue({ preview: { id: playId, fingerprint: hash, sourceName: 'lin.png', sourceHash: hash, displayName: 'Lin', characterId: 'lin', mode: 'playOnly', files: [], warnings: [], conflicts: [], diff: 'Lin says hello', canPropose: true } });
  api.createTavernPlaySession.mockResolvedValue({ session: { id: 'play-imported' } });
  await upload(wrapper, 'lin.png'); await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(api.previewTavernImport).toHaveBeenCalledWith(expect.objectContaining({ format: 'png', mode: 'playOnly' }));
  expect(api.createTavernPlaySession).not.toHaveBeenCalled();
  await button(wrapper, 'Confirm and create Play session').trigger('click'); await flushPromises();
  expect(wrapper.emitted('created')).toEqual([[{ id: 'play-imported' }]]);
  expect(api.proposeTavernImport).not.toHaveBeenCalled(); wrapper.unmount();
});
