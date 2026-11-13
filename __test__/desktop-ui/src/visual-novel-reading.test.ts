// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import VisualNovelStage from '../../../apps/desktop-ui/src/components/play/VisualNovelStage.vue';
import VisualNovelTextBox from '../../../apps/desktop-ui/src/components/play/VisualNovelTextBox.vue';
import { usePlayStageReadingPrefs } from '../../../apps/desktop-ui/src/composables/usePlayStageReadingPrefs';

const PREFS_KEY = 'oan:play:stage-reading';
const beats = [
  { text: '雨停了。', speaker: '', isDialogue: false },
  { text: '“回来。”', speaker: '念念', isDialogue: true },
  { text: '门后没有回答。', speaker: '', isDialogue: false },
];
const cast = [{ characterId: 'nian', name: '念念', position: 'center' as const }];
function narrative(id: string, items = beats) {
  return {
    id,
    speaker: 'world-referee',
    content: items.map(item => item.text).join(''),
    createdAt: '2026-01-01T08:00:00.000Z',
    stageSnapshot: { sceneId: '客栈', activeCharacters: cast, beats: items },
  };
}
function action(id: string, content: string) {
  return { id, speaker: 'user', content, createdAt: '2026-01-01T07:59:00.000Z' };
}
function mountStage(props: Record<string, unknown> = {}) {
  return mount(VisualNovelStage, {
    attachTo: document.body,
    props: { sessionId: 'a', scene: '客栈', turns: [narrative('turn-a')], choices: ['走进门'], disabled: false, ...props },
  });
}
function beatText(wrapper: ReturnType<typeof mountStage>): string | undefined {
  return wrapper.findComponent(VisualNovelTextBox).props('beat')?.text;
}
function menu(wrapper: ReturnType<typeof mountStage>, label: string) {
  return wrapper.findAll('.vn-menu button').find(button => button.text() === label)!;
}

describe('stage reading controls', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('moves to the next sentence on the second press while the first is still typing', async () => {
    const wrapper = mountStage();
    await vi.advanceTimersByTimeAsync(30);
    // Mid-sentence: only the first character is out.
    expect(wrapper.find('.vn-textbox span').text()).toBe('雨');
    await wrapper.trigger('keydown', { key: ' ' });
    expect(wrapper.find('.vn-textbox span').text()).toBe('雨停了。');
    await wrapper.trigger('keydown', { key: 'Enter' });
    expect(beatText(wrapper)).toBe('“回来。”');
    // The new sentence starts from its first character, not from the old one's length.
    expect(wrapper.find('.vn-textbox span').text()).not.toBe('“回来。”');
    await wrapper.get('.vn-textbox').trigger('click');
    await wrapper.get('.vn-textbox').trigger('click');
    expect(beatText(wrapper)).toBe('门后没有回答。');
    wrapper.unmount();
  });

  it('auto-plays to the end of the turn and stops at the options without choosing', async () => {
    const wrapper = mountStage();
    await wrapper.trigger('keydown', { key: 'a' });
    expect(menu(wrapper, '自动').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.vn-choices').exists()).toBe(false);

    // Typing takes 4 × 25ms; the wait after it is 1200ms + 4 × 45ms.
    await vi.advanceTimersByTimeAsync(1000);
    expect(beatText(wrapper)).toBe('雨停了。');
    await vi.advanceTimersByTimeAsync(600);
    expect(beatText(wrapper)).toBe('“回来。”');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beatText(wrapper)).toBe('门后没有回答。');
    expect(wrapper.find('.vn-choices').exists()).toBe(true);
    expect(wrapper.emitted('choose')).toBeUndefined();
    expect(wrapper.emitted('custom')).toBeUndefined();

    await menu(wrapper, '自动').trigger('click');
    expect(menu(wrapper, '自动').attributes('aria-pressed')).toBe('false');
    wrapper.unmount();
  });

  it('pauses auto while the log is open and continues with the next draft sentence', async () => {
    const wrapper = mountStage({ turns: [], choices: [], draft: '风起。', draftAction: '推开门' });
    await wrapper.trigger('keydown', { key: 'a' });
    await wrapper.trigger('keydown', { key: 'l' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(beatText(wrapper)).toBe('推开门');
    await wrapper.trigger('keydown', { key: 'Escape' });
    await vi.advanceTimersByTimeAsync(10_000);
    // The last draft sentence there is: auto waits here instead of ending anything.
    expect(beatText(wrapper)).toBe('风起。');
    await wrapper.setProps({ draft: '风起。雨也来了。' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(beatText(wrapper)).toBe('雨也来了。');
    expect(wrapper.find('.vn-choices').exists()).toBe(false);
    wrapper.unmount();
  });

  it('skips to the last sentence and leaves the choice to the author', async () => {
    const wrapper = mountStage();
    await wrapper.trigger('keydown', { key: 's' });
    await flushPromises();
    expect(wrapper.find('.vn-textbox span').text()).toBe('门后没有回答。');
    expect(wrapper.find('.vn-choices').exists()).toBe(true);
    expect(wrapper.emitted('choose')).toBeUndefined();

    const drafting = mountStage({ choices: ['走进门'], draft: '风起。雨也来了。', draftAction: '推开门' });
    await menu(drafting, '快进').trigger('click');
    await flushPromises();
    expect(drafting.find('.vn-textbox span').text()).toBe('雨也来了。');
    expect(drafting.find('.vn-choices').exists()).toBe(false);
    wrapper.unmount();
    drafting.unmount();
  });

  it('hides the interface with H or right-click and spends the next input on bringing it back', async () => {
    const wrapper = mountStage();
    await wrapper.trigger('keydown', { key: 's' });
    await flushPromises();
    await wrapper.trigger('keydown', { key: 'h' });
    expect(wrapper.get<HTMLElement>('header').element.style.display).toBe('none');
    expect(wrapper.get<HTMLElement>('.vn-textbox').element.style.display).toBe('none');
    expect(wrapper.find('.vn-choices').exists()).toBe(false);
    expect(wrapper.text()).toContain('界面已隐藏');

    // A digit would pick option 1 on a visible stage; hidden, it only restores the interface.
    await wrapper.trigger('keydown', { key: '1' });
    expect(wrapper.emitted('choose')).toBeUndefined();
    expect(wrapper.get<HTMLElement>('header').element.style.display).toBe('');
    expect(wrapper.find('.vn-choices').exists()).toBe(true);

    await wrapper.trigger('contextmenu');
    expect(wrapper.get<HTMLElement>('header').element.style.display).toBe('none');
    await wrapper.trigger('click');
    expect(wrapper.get<HTMLElement>('header').element.style.display).toBe('');
    expect(beatText(wrapper)).toBe('门后没有回答。');
    wrapper.unmount();
  });

  it('lists the log by sentence with name plates and replays a chosen sentence read-only', async () => {
    const turns = [
      action('user-1', '推开门'),
      narrative('turn-a'),
      action('user-2', '问她在等谁'),
      narrative('turn-b', [{ text: '她没有抬头。', speaker: '', isDialogue: false }]),
    ];
    const wrapper = mountStage({ turns, hasMoreBefore: true });
    await wrapper.trigger('keydown', { key: 'l' });
    const lines = wrapper.findAll('.vn-log-line');
    expect(lines.map(line => line.text())).toEqual([
      '你推开门', '雨停了。', '念念“回来。”', '门后没有回答。', '你问她在等谁', '她没有抬头。',
    ]);
    expect(wrapper.findAll('.vn-log section')).toHaveLength(2);
    await wrapper.findAll('.vn-log header button').find(button => button.text() === '加载更早回合')!.trigger('click');
    expect(wrapper.emitted('loadEarlier')).toHaveLength(1);

    await lines[2]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.vn-log').exists()).toBe(false);
    expect(beatText(wrapper)).toBe('“回来。”');
    expect(wrapper.find('.vn-status').text()).toContain('只读回看');
    // A replay offers no options, also on its last sentence.
    await wrapper.trigger('keydown', { key: 's' });
    await flushPromises();
    expect(beatText(wrapper)).toBe('门后没有回答。');
    expect(wrapper.find('.vn-choices').exists()).toBe(false);
    await wrapper.trigger('keydown', { key: '1' });
    expect(wrapper.emitted('choose')).toBeUndefined();

    await wrapper.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.vn-status').exists()).toBe(false);
    expect(wrapper.findComponent(VisualNovelTextBox).props('beat')).toMatchObject({ speaker: '你', text: '问她在等谁', player: true });
    wrapper.unmount();
  });

  it('reads on with wheel down and opens the log with wheel up', async () => {
    const wrapper = mountStage();
    await wrapper.trigger('wheel', { deltaY: 120 });
    await wrapper.trigger('wheel', { deltaY: 120 });
    // A burst of wheel events counts once.
    expect(beatText(wrapper)).toBe('雨停了。');
    expect(wrapper.find('.vn-textbox span').text()).toBe('雨停了。');
    await vi.advanceTimersByTimeAsync(300);
    wrapper.element.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    await flushPromises();
    expect(beatText(wrapper)).toBe('“回来。”');
    await vi.advanceTimersByTimeAsync(300);
    wrapper.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    await flushPromises();
    expect(wrapper.find('.vn-log').exists()).toBe(true);
    wrapper.unmount();
  });

  it('applies reading settings at once and keeps them as an application preference', async () => {
    const wrapper = mountStage();
    expect(wrapper.findComponent(VisualNovelTextBox).props('charDelayMs')).toBe(25);
    await menu(wrapper, '设置').trigger('click');
    await wrapper.get('input[aria-label="字速"]').setValue('100');
    await wrapper.get('input[aria-label="自动间隔"]').setValue('2500');
    await wrapper.get('input[aria-label="对话框不透明度"]').setValue('60');
    expect(wrapper.findComponent(VisualNovelTextBox).props()).toMatchObject({ charDelayMs: 10, opacity: 0.6 });
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toEqual({ charsPerSecond: 100, autoDelayMs: 2500, boxOpacity: 0.6, typewriter: true });

    await wrapper.get('.vn-settings input[type="checkbox"]').setValue(false);
    expect(wrapper.findComponent(VisualNovelTextBox).props('charDelayMs')).toBe(0);
    expect(wrapper.find('.vn-textbox span').text()).toBe('雨停了。');
    await wrapper.trigger('keydown', { key: ' ' });
    // No typing effect: one press per sentence.
    expect(wrapper.find('.vn-textbox span').text()).toBe('“回来。”');
    await wrapper.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.vn-settings').exists()).toBe(false);
    wrapper.unmount();

    const reopened = mountStage();
    expect(reopened.findComponent(VisualNovelTextBox).props()).toMatchObject({ charDelayMs: 0, opacity: 0.6 });
    reopened.unmount();
  });

  it('clamps stored settings and survives a damaged record', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ charsPerSecond: 9999, autoDelayMs: -5, boxOpacity: 'x', typewriter: 'yes' }));
    expect(usePlayStageReadingPrefs().prefs.value).toEqual({ charsPerSecond: 120, autoDelayMs: 300, boxOpacity: 0.93, typewriter: true });
    localStorage.setItem(PREFS_KEY, '{broken');
    expect(usePlayStageReadingPrefs().prefs.value).toEqual({ charsPerSecond: 40, autoDelayMs: 1200, boxOpacity: 0.93, typewriter: true });
  });

  it("puts the author's action on stage under the player character's name, without a portrait", async () => {
    const turns = [action('user-1', '推开门'), narrative('turn-a')];
    const anonymous = mountStage({ turns });
    expect(anonymous.findComponent(VisualNovelTextBox).props('beat')).toMatchObject({ speaker: '你', text: '推开门', player: true });
    expect(anonymous.find('.vn-name').text()).toBe('你');
    expect(anonymous.find('.vn-cast .speaking').exists()).toBe(false);
    expect(anonymous.findAll('.vn-cast span')).toHaveLength(1);
    anonymous.unmount();

    const roster = [
      { id: 'che', name: '阿澈', aliases: [], isPlayer: true },
      { id: 'nian', name: '念念', aliases: [], isPlayer: false },
    ];
    const named = mountStage({ turns, roster });
    expect(named.find('.vn-name').text()).toBe('阿澈');
    expect(named.findAll('.vn-cast span').map(item => item.text())).toEqual(['念念']);
    // Before any draft text arrives the action is already on stage.
    await named.setProps({ draftAction: '问她在等谁' });
    expect(named.findComponent(VisualNovelTextBox).props('beat')).toMatchObject({ speaker: '阿澈', text: '问她在等谁' });
    expect(named.text()).toContain('正在演出草稿');
    named.unmount();
  });

  it('highlights the speaker, dims the rest and prefers the roster name colour', async () => {
    const twoCast = [...cast, { characterId: 'lu', name: '老陆', position: 'right' as const }];
    const turn = { ...narrative('turn-a'), stageSnapshot: { sceneId: '客栈', activeCharacters: twoCast, beats } };
    const roster = [
      { id: 'nian', name: '念念', aliases: [], isPlayer: false, looks: { nameColor: '#ff8800' } },
      { id: 'lu', name: '老陆', aliases: [], isPlayer: false, looks: { nameColor: 'red' } },
    ];
    const wrapper = mountStage({ turns: [turn], roster });
    expect(wrapper.find('.vn-cast').classes()).not.toContain('focused');
    await wrapper.trigger('keydown', { key: ' ' });
    await wrapper.trigger('keydown', { key: ' ' });
    expect(wrapper.find('.vn-cast').classes()).toContain('focused');
    expect(wrapper.findAll('.vn-cast .speaking').map(item => item.text())).toEqual(['念念']);
    expect(wrapper.findComponent(VisualNovelTextBox).props('nameColor')).toBe('#ff8800');
    expect(wrapper.get<HTMLElement>('.vn-name').element.style.color).toBe('#ff8800');
    wrapper.unmount();

    // Without a valid colour the name plate keeps the colour derived from the name.
    const plain = mountStage({ turns: [turn], roster: [roster[1]!, { id: 'nian', name: '念念', aliases: [], isPlayer: false }] });
    await plain.trigger('keydown', { key: ' ' });
    await plain.trigger('keydown', { key: ' ' });
    expect(plain.findComponent(VisualNovelTextBox).props('nameColor')).toBeUndefined();
    expect(plain.get<HTMLElement>('.vn-name').element.style.color).toMatch(/^hsl\(/);
    plain.unmount();
  });

  it('keeps the reading position when the draft becomes the committed turn', async () => {
    const wrapper = mountStage({ turns: [], choices: [], draft: '雨停了。“回来。”门后', draftAction: '推开门' });
    await wrapper.trigger('keydown', { key: 's' });
    await flushPromises();
    await wrapper.setProps({ draft: undefined, draftAction: undefined, turns: [action('user-1', '推开门'), narrative('turn-a')], choices: ['走进门'] });
    await flushPromises();
    expect(beatText(wrapper)).toBe('门后没有回答。');
    expect(wrapper.find('.vn-choices').exists()).toBe(true);

    // A turn that is not the draft's continuation starts from its first sentence.
    await wrapper.setProps({ turns: [narrative('turn-other', [{ text: '山顶无风。', speaker: '', isDialogue: false }, { text: '云很低。', speaker: '', isDialogue: false }])] });
    expect(beatText(wrapper)).toBe('山顶无风。');
    wrapper.unmount();
  });

  it('shows whole sentences and no motion under prefers-reduced-motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} }));
    const wrapper = mountStage();
    expect(wrapper.classes()).toContain('reduced-motion');
    expect(wrapper.findComponent(VisualNovelTextBox).props('charDelayMs')).toBe(0);
    expect(wrapper.find('.vn-textbox span').text()).toBe('雨停了。');
    await wrapper.trigger('keydown', { key: ' ' });
    expect(wrapper.find('.vn-textbox span').text()).toBe('“回来。”');
    wrapper.unmount();
  });

  it('toggles window fullscreen with F and the menu button', async () => {
    const request = vi.fn(async () => undefined);
    const wrapper = mountStage();
    (wrapper.element as HTMLElement).requestFullscreen = request;
    await wrapper.trigger('keydown', { key: 'f' });
    await menu(wrapper, '全屏').trigger('click');
    expect(request).toHaveBeenCalledTimes(2);
    // Typing in a field never triggers a stage shortcut.
    const field = document.createElement('textarea');
    wrapper.element.appendChild(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(request).toHaveBeenCalledTimes(2);
    expect(wrapper.get<HTMLElement>('header').element.style.display).toBe('');
    wrapper.unmount();
  });
});
