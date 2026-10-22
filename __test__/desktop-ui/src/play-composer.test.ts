// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { defineComponent, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';

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

    await wrapper.get('.play-suggestions button').trigger('click');

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
