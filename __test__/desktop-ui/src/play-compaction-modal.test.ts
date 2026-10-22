// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaySession } from '@oh-awesome-novel/client';
import PlayCompactionModal from '../../../apps/desktop-ui/src/components/play/PlayCompactionModal.vue';
const api = vi.hoisted(() => ({ compactPlaySession: vi.fn(), continueCompactedPlaySession: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
const session = { id: 'play-one', revision: 2, selectedTurnIds: ['one', 'two'] } as PlaySession;
const preview = { sourceRevision: 2, data: { characters: [], chronicle: ['停在门外。'], unresolvedThreads: [], currentScene: { timeAndPlace: '门外', immediateCrisis: '未记录' }, voiceAndStyle: { pov: '第三人称', rhythm: '慢', tonePoints: [] }, resourceState: { medicine: 0 } } };
beforeEach(() => { vi.resetAllMocks(); api.compactPlaySession.mockResolvedValue({ preview }); api.continueCompactedPlaySession.mockResolvedValue({ session: { ...session, id: 'continued' } }); });
describe('Play archive review', () => {
  it('previews before explicit continuation and sends the reviewed revision', async () => {
    const wrapper = mount(PlayCompactionModal, { props: { session } });
    await wrapper.findAll('button')[0].trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('停在门外。'); expect(api.continueCompactedPlaySession).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(b => b.text() === '确认存档并开启新阶段')!.trigger('click'); await flushPromises();
    expect(api.continueCompactedPlaySession).toHaveBeenCalledWith('play-one', 2); expect(wrapper.emitted('continued')?.[0]?.[0]).toEqual(expect.objectContaining({ id: 'continued' })); wrapper.unmount();
  });
  it('closes with Escape without creating a continuation', async () => {
    const wrapper = mount(PlayCompactionModal, { props: { session } }); await wrapper.findAll('button')[0].trigger('click'); await flushPromises();
    await wrapper.get('dialog').trigger('cancel'); expect(wrapper.get('dialog').attributes('open')).toBeUndefined(); expect(api.continueCompactedPlaySession).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('ignores late responses when session changes and surfaces stale rejections', async () => {
    let complete!: (value: unknown) => void; api.compactPlaySession.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const wrapper = mount(PlayCompactionModal, { props: { session } }); await wrapper.findAll('button')[0].trigger('click');
    await wrapper.setProps({ session: { ...session, id: 'other' } }); complete({ preview }); await flushPromises(); expect(wrapper.text()).not.toContain('停在门外。');
    api.compactPlaySession.mockRejectedValue(new Error('revision changed')); await wrapper.findAll('button')[0].trigger('click'); await flushPromises(); expect(wrapper.get('[role="alert"]').text()).toContain('revision changed'); wrapper.unmount();
  });
});
