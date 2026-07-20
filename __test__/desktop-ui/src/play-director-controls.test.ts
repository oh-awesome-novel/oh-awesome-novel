// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayDirectorControls from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayDirectorControls.vue';
import type { PlayRehearsalControlCapabilities } from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

describe('PlayDirectorControls', () => {
  it('emits Accept and Retry for the active provisional step', async () => {
    const wrapper = mountControls();
    await button(wrapper, 'Accept').trigger('click');
    await button(wrapper, 'Retry').trigger('click');

    expect(wrapper.emitted('accept')).toEqual([['step-draft']]);
    expect(wrapper.emitted('retry')).toEqual([['step-draft']]);
  });

  it('confirms Finish inline and returns focus on Escape', async () => {
    const wrapper = mountControls();
    const finish = button(wrapper, 'Finish');

    await finish.trigger('click');
    await flushPromises();

    const confirm = button(wrapper, 'Confirm Finish');
    expect(document.activeElement).toBe(confirm.element);
    expect(wrapper.get('.play-director-confirmation').text()).toContain(
      'commit the selected step prefix once',
    );

    await wrapper.get('.play-director-confirmation').trigger('keydown', { key: 'Escape' });
    await flushPromises();

    expect(wrapper.find('.play-director-confirmation').exists()).toBe(false);
    expect(document.activeElement).toBe(button(wrapper, 'Finish').element);

    await button(wrapper, 'Finish').trigger('click');
    await flushPromises();
    await button(wrapper, 'Confirm Finish').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('finish')).toHaveLength(1);
    expect(document.activeElement).toBe(button(wrapper, 'Finish').element);
    wrapper.unmount();
  });

  it('requires a separate zero-commit confirmation for Cancel', async () => {
    const wrapper = mountControls();
    await button(wrapper, 'Cancel').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.get('.play-director-confirmation').text()).toContain(
      'revision, clock, state, events and transcript remain unchanged',
    );
    await button(wrapper, 'Confirm Cancel attempt').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(document.activeElement).toBe(button(wrapper, 'Cancel').element);
    wrapper.unmount();
  });

  it.each([
    ['Finish', 'Confirm Finish'],
    ['Cancel', 'Confirm Cancel attempt'],
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
