// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';

import PlayDirectorControls from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayDirectorControls.vue';
import type { PlayRehearsalControlCapabilities } from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

describe('PlayDirectorControls', () => {
  it('emits Accept and Retry for the active provisional step', async () => {
    const wrapper = mountControls();
    await button(wrapper, '采用').trigger('click');
    await button(wrapper, '重演').trigger('click');

    expect(wrapper.emitted('accept')).toEqual([['step-draft']]);
    expect(wrapper.emitted('retry')).toEqual([['step-draft']]);
  });

  it('confirms Finish inline and returns focus on Escape', async () => {
    const wrapper = mountControls();
    const finish = button(wrapper, '完成试演');

    await finish.trigger('click');
    await flushPromises();

    const confirm = button(wrapper, '确认完成');
    expect(document.activeElement).toBe(confirm.element);
    expect(wrapper.get('.play-director-confirmation').text()).toContain(
      '一次性提交已选步骤',
    );

    await wrapper.get('.play-director-confirmation').trigger('keydown', { key: 'Escape' });
    await flushPromises();

    expect(wrapper.find('.play-director-confirmation').exists()).toBe(false);
    expect(document.activeElement).toBe(button(wrapper, '完成试演').element);

    await button(wrapper, '完成试演').trigger('click');
    await flushPromises();
    await button(wrapper, '确认完成').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('finish')).toHaveLength(1);
    expect(document.activeElement).toBe(button(wrapper, '完成试演').element);
    wrapper.unmount();
  });

  it('requires a separate zero-commit confirmation for Cancel', async () => {
    const wrapper = mountControls();
    await button(wrapper, '取消').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.get('.play-director-confirmation').text()).toContain(
      '会话、时钟、状态、事件和记录都不会改变',
    );
    await button(wrapper, '确认取消').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(document.activeElement).toBe(button(wrapper, '取消').element);
    wrapper.unmount();
  });

  it.each([
    ['完成试演', '确认完成'],
    ['取消', '确认取消'],
  ] as const)('returns focus to %s after an async mutation failure', async (action, confirmation) => {
    const wrapper = mountControls();
    await button(wrapper, action).trigger('click');
    await flushPromises();

    button(wrapper, confirmation).element.click();
    await wrapper.setProps({ busy: true });
    await wrapper.setProps({ busy: false });
    await flushPromises();

    expect(document.activeElement).toBe(button(wrapper, action).element);
    wrapper.unmount();
  });
});

function mountControls() {
  return mount(PlayDirectorControls, {
    attachTo: document.body,
    props: {
      activeStepRef: 'step-draft',
      attemptStatus: 'running',
      busy: false,
      capabilities: fullCapabilities(),
      announcement: 'Draft prepared.',
    },
  });
}

function fullCapabilities(): PlayRehearsalControlCapabilities {
  return {
    canStartAttempt: false,
    canGenerateStep: false,
    canStopStep: false,
    canAccept: true,
    canRetry: true,
    canFinish: true,
    canCancel: true,
  };
}

function button(
  wrapper: ReturnType<typeof mountControls>,
  label: string,
) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
