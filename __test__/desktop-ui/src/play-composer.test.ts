// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { PlayRelativeTimeAdvance } from '@oh-awesome-novel/client';
import PlayComposer from '../../../apps/desktop-ui/src/components/play/PlayComposer.vue';

describe('PlayComposer time advance', () => {
  it('makes Wait a first-class relative-time action with presets and validation', async () => {
    const submit = vi.fn();
    const Host = defineComponent({
      components: { PlayComposer },
      setup() {
        const userText = shallowRef('');
        const actionKind = shallowRef<'say' | 'look' | 'move' | 'do' | 'wait'>('do');
        const timeAdvance = shallowRef<PlayRelativeTimeAdvance | undefined>({
          amount: 10,
          unit: 'minute',
        });
        return { actionKind, submit, timeAdvance, userText };
      },
      template: `
        <PlayComposer
          v-model:user-text="userText"
          v-model:action-kind="actionKind"
          v-model:time-advance="timeAdvance"
          :disabled="false"
          :busy="false"
          :can-stop="false"
          :suggestions="[]"
          @submit="submit"
        />
      `,
    });
    const wrapper = mount(Host);

    expect(wrapper.find('[aria-label="推进世界时间"]').exists()).toBe(false);
    const wait = wrapper.findAll('.play-action-kinds button').find(
      (button) => button.text().includes('Wait'),
    );
    await wait!.trigger('click');

    expect(wrapper.get('[aria-label="推进世界时间"]').text()).toContain('推进时间');
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(false);

    const oneHour = wrapper.findAll('.play-time-presets button').find(
      (button) => button.text() === '1 小时',
    );
    await oneHour!.trigger('click');
    expect(oneHour!.attributes('aria-pressed')).toBe('true');

    await wrapper.get('.play-time-custom input').setValue('0');
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);

    await wrapper.get('.play-time-custom input').setValue('2');
    await wrapper.get('.play-time-custom select').setValue('day');
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(submit).toHaveBeenCalledOnce();
  });

  it('does not guess a typed duration from a natural-language wait suggestion', async () => {
    const Host = defineComponent({
      components: { PlayComposer },
      setup() {
        const userText = shallowRef('');
        const actionKind = shallowRef<'say' | 'look' | 'move' | 'do' | 'wait'>('do');
        const timeAdvance = shallowRef<PlayRelativeTimeAdvance | undefined>({
          amount: 10,
          unit: 'minute',
        });
        return { actionKind, timeAdvance, userText };
      },
      template: `
        <PlayComposer
          v-model:user-text="userText"
          v-model:action-kind="actionKind"
          v-model:time-advance="timeAdvance"
          :disabled="false"
          :busy="false"
          :can-stop="false"
          :suggestions="[{ id: 'wait-dawn', label: '等到天亮', userText: '等到天亮', actionKind: 'wait' }]"
        />
      `,
    });
    const wrapper = mount(Host);

    await wrapper.get('.play-choice-pick').trigger('click');

    expect(wrapper.emitted('choose')).toBeUndefined();

    expect(wrapper.get('[aria-label="推进世界时间"]').text()).toContain(
      '实际推进以上方时长为准',
    );
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
  });
});

describe('PlayComposer while a turn runs', () => {
  function mountRunning(canSteer: boolean) {
    const submit = vi.fn();
    const steer = vi.fn();
    const Host = defineComponent({
      components: { PlayComposer },
      setup() {
        const userText = shallowRef('');
        const actionKind = shallowRef<'say' | 'look' | 'move' | 'do' | 'wait'>('do');
        const timeAdvance = shallowRef<PlayRelativeTimeAdvance | undefined>(undefined);
        return { actionKind, canSteer, steer, submit, timeAdvance, userText };
      },
      template: `
        <PlayComposer
          v-model:user-text="userText"
          v-model:action-kind="actionKind"
          v-model:time-advance="timeAdvance"
          :disabled="false"
          :busy="true"
          :running="true"
          :can-steer="canSteer"
          :can-stop="true"
          phase="streaming"
          :suggestions="[]"
          @submit="submit"
          @steer="steer"
        />
      `,
    });
    return { wrapper: mount(Host), submit, steer };
  }

  it('keeps the input usable, queues with the send shortcut and steers with Alt+Enter', async () => {
    const { wrapper, submit, steer } = mountRunning(true);
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea');
    expect(textarea.element.disabled).toBe(false);
    expect(wrapper.find('.play-stop-button').exists()).toBe(true);
    expect(wrapper.get<HTMLButtonElement>('.play-steer-button').element.disabled).toBe(true);

    await textarea.setValue('Look behind the counter');
    await textarea.trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(submit).toHaveBeenCalledOnce();

    await textarea.trigger('keydown', { key: 'Enter', altKey: true });
    expect(steer).toHaveBeenCalledOnce();
    await wrapper.get('.play-steer-button').trigger('click');
    expect(steer).toHaveBeenCalledTimes(2);
  });

  it('disables steer when the running turn cannot be cancelled', async () => {
    const { wrapper, steer } = mountRunning(false);
    await wrapper.get('textarea').setValue('Hurry');
    expect(wrapper.get<HTMLButtonElement>('.play-steer-button').element.disabled).toBe(true);
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', altKey: true });
    expect(steer).not.toHaveBeenCalled();
    expect(wrapper.get<HTMLButtonElement>('.play-queue-button').element.disabled).toBe(false);
  });
});

describe('PlayComposer choice options', () => {
  const suggestions = [
    { id: 'c1', label: '问她昨晚去了哪里', userText: '问她昨晚去了哪里', actionKind: 'say' as const },
    { id: 'c2', label: '守在门外', userText: '守在门外', actionKind: 'wait' as const, timeAdvance: { amount: 2, unit: 'hour' as const } },
    { id: 'c3', label: '等到天亮', userText: '等到天亮', actionKind: 'wait' as const },
  ];

  function mountChoices(overrides: Record<string, unknown> = {}) {
    const choose = vi.fn();
    const Host = defineComponent({
      components: { PlayComposer },
      setup() {
        const userText = shallowRef('我的草稿');
        const actionKind = shallowRef<'say' | 'look' | 'move' | 'do' | 'wait'>('do');
        const timeAdvance = shallowRef<PlayRelativeTimeAdvance | undefined>({ amount: 10, unit: 'minute' });
        return { actionKind, choose, overrides, suggestions, timeAdvance, userText };
      },
      template: `
        <PlayComposer
          v-model:user-text="userText"
          v-model:action-kind="actionKind"
          v-model:time-advance="timeAdvance"
          :disabled="false"
          :busy="false"
          :can-stop="false"
          :suggestions="suggestions"
          v-bind="overrides"
          @choose="choose"
        />
      `,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    return { wrapper, choose };
  }

  it('sends an option directly without touching the draft', async () => {
    const { wrapper, choose } = mountChoices();
    const picks = wrapper.findAll('.play-choice-pick');
    expect(picks.map(pick => pick.text())).toEqual(['1说问她昨晚去了哪里', '2等 2 小时守在门外', '3等等到天亮']);

    await picks[0]!.trigger('click');
    await picks[1]!.trigger('click');

    expect(choose.mock.calls.map(call => call[0].id)).toEqual(['c1', 'c2']);
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('我的草稿');
    wrapper.unmount();
  });

  it('puts an option in the composer to edit, and clears an untouched option for the author\'s own text', async () => {
    const { wrapper, choose } = mountChoices();
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea');

    await wrapper.findAll('.play-choice-edit')[1]!.trigger('click');
    expect(textarea.element.value).toBe('守在门外');
    expect(document.activeElement).toBe(textarea.element);
    expect(wrapper.get('[aria-label="推进世界时间"]').exists()).toBe(true);
    expect(choose).not.toHaveBeenCalled();

    await wrapper.get('.play-choice-own').trigger('click');
    expect(textarea.element.value).toBe('');

    await textarea.setValue('我自己的行动');
    await wrapper.get('.play-choice-own').trigger('click');
    expect(textarea.element.value).toBe('我自己的行动');
    wrapper.unmount();
  });

  it('picks with number keys only outside inputs and dialogs', async () => {
    const { wrapper, choose } = mountChoices();
    const press = (target: EventTarget, init: KeyboardEventInit) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

    press(wrapper.get('textarea').element, { key: '1' });
    press(document.body, { key: '1', ctrlKey: true });
    press(document.body, { key: '9' });
    expect(choose).not.toHaveBeenCalled();

    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    press(document.body, { key: '1' });
    expect(choose).not.toHaveBeenCalled();
    dialog.remove();

    press(document.body, { key: '1' });
    expect(choose.mock.calls.map(call => call[0].id)).toEqual(['c1']);

    // A wait without a stated duration is never sent by a key press.
    press(document.body, { key: '3' });
    expect(choose).toHaveBeenCalledOnce();
    await nextTick();
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('等到天亮');

    wrapper.unmount();
    press(document.body, { key: '1' });
    expect(choose).toHaveBeenCalledOnce();
  });

  it('offers nothing to pick while a turn runs or another surface owns the keys', async () => {
    const running = mountChoices({ busy: true, running: true });
    expect(running.wrapper.findAll<HTMLButtonElement>('.play-choice-pick').every(pick => pick.element.disabled)).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '1' }));
    expect(running.choose).not.toHaveBeenCalled();
    running.wrapper.unmount();

    const suppressed = mountChoices({ suppressChoiceHotkeys: true });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '1' }));
    expect(suppressed.choose).not.toHaveBeenCalled();
    suppressed.wrapper.unmount();
  });

  it('explains a committed turn that came back without options', () => {
    const empty = mountChoices({ suggestions: [], showEmptyChoices: true });
    expect(empty.wrapper.get('.play-choices-empty').text()).toContain('本回合没有候选行动');
    empty.wrapper.unmount();

    const fresh = mountChoices({ suggestions: [] });
    expect(fresh.wrapper.find('.play-choices-empty').exists()).toBe(false);
    fresh.wrapper.unmount();
  });
});
