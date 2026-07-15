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
