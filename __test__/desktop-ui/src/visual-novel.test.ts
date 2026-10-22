// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VisualNovelStage from '../../../apps/desktop-ui/src/components/play/VisualNovelStage.vue';
import VisualNovelTextBox from '../../../apps/desktop-ui/src/components/play/VisualNovelTextBox.vue';
const turn = { id: 'turn-a', speaker: 'world-referee', content: '雨停。', createdAt: '2026-01-01', stageSnapshot: { sceneId: '客栈', activeCharacters: [], beats: [{ text: '雨停。', speaker: '', isDialogue: false }] } };
afterEach(() => vi.useRealTimers());
describe('visual novel stage', () => {
  it('reveals text, advances by keyboard and dispatches numbered choices', async () => {
    vi.useFakeTimers();
    const wrapper = mount(VisualNovelStage, { props: { sessionId: 'a', scene: 'changed scene', turns: [turn], choices: ['走进门'], disabled: false } });
    expect(wrapper.text()).toContain('客栈');
    await wrapper.trigger('keydown', { key: ' ' });
    expect(wrapper.findComponent(VisualNovelTextBox).text()).toContain('雨停。');
    await wrapper.trigger('keydown', { key: '1' });
    expect(wrapper.emitted('choose')).toEqual([['走进门']]);
    wrapper.unmount();
  });
  it('renders frozen scene media and clears it on a sibling without a background', async () => {
    const image = 'data:image/png;base64,aGVsbG8=';
    const wrapper = mount(VisualNovelStage, { props: { sessionId: 'a', scene: 'current', turns: [{ ...turn, stageSnapshot: { ...turn.stageSnapshot, backgroundDataUrl: image } }], choices: [], disabled: false } });
    expect(wrapper.find('.vn-background').attributes('src')).toBe(image);
    await wrapper.setProps({ draft: '新草稿。' });
    expect(wrapper.find('.vn-background').attributes('src')).toBe(image);
    await wrapper.setProps({ draft: undefined, turns: [{ ...turn, id: 'sibling', stageSnapshot: { ...turn.stageSnapshot, sceneId: 'mountain' } }] });
    expect(wrapper.find('.vn-background').exists()).toBe(false);
    wrapper.unmount();
  });
  it('retains already revealed streaming prefix while appending text', async () => {
    vi.useFakeTimers();
    const wrapper = mount(VisualNovelTextBox, { props: { beat: { text: '风', speaker: '', isDialogue: false } } });
    await vi.advanceTimersByTimeAsync(30);
    expect(wrapper.text()).toContain('风');
    await wrapper.setProps({ beat: { text: '风来了。', speaker: '', isDialogue: false } });
    expect(wrapper.text()).toContain('风');
    await wrapper.trigger('click');
    expect(wrapper.text()).toContain('风来了。');
    await wrapper.trigger('click');
    expect(wrapper.emitted('next')).toHaveLength(1);
    wrapper.unmount();
  });
  it('keeps draft and history separate, clears on branch/session switch and blocks draft actions', async () => {
    const wrapper = mount(VisualNovelStage, { props: { sessionId: 'a', scene: '客栈', turns: [turn], choices: ['走进门'], draft: '草稿。', disabled: true } });
    await wrapper.trigger('keydown', { key: '1' });
    expect(wrapper.emitted('choose')).toBeUndefined();
    await wrapper.findAll('button').find(b => b.text().includes('Log'))!.trigger('click');
    await wrapper.findAll('button').find(b => b.text().includes('回看'))!.trigger('click');
    await wrapper.trigger('keydown', { key: ' ' });
    expect(wrapper.findComponent(VisualNovelTextBox).text()).toContain('雨停。');
    await wrapper.setProps({ sessionId: 'b', draft: undefined, turns: [{ ...turn, id: 'turn-b', stageSnapshot: { ...turn.stageSnapshot, sceneId: '山顶' } }] });
    expect(wrapper.text()).toContain('山顶');
    expect(wrapper.find('[aria-label="历史文本"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
