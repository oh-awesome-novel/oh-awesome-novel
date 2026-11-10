// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';

import PlayRehearsalSetup from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayRehearsalSetup.vue';
import PlaySessionPurposePicker from '../../../apps/desktop-ui/src/components/play/rehearsal/PlaySessionPurposePicker.vue';
import { buildPlayRehearsalSessionInput } from '../../../apps/desktop-ui/src/composables/playRehearsalPresentation';
import type { PlayRehearsalSetupSubmission } from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

describe('Play rehearsal setup', () => {
  it('offers both Play purposes as keyboard-compatible buttons', async () => {
    const wrapper = mount(PlaySessionPurposePicker);
    const rehearsal = wrapper.findAll('button').find((button) =>
      button.text().includes('场景试演'),
    );

    await rehearsal!.trigger('click');

    expect(wrapper.emitted('choose')).toEqual([['sceneRehearsal']]);
    expect(wrapper.text()).toContain('沉浸推演');
    expect(wrapper.text()).toContain('场景试演');
  });

  it('keeps compact Quick setup local until the Review confirmation', async () => {
    const wrapper = mount(PlayRehearsalSetup, {
      attachTo: document.body,
    });

    await wrapper.get('.play-rehearsal-step-form').trigger('submit');
    expect(wrapper.text()).toContain('请填写场景标题。');
    expect(wrapper.emitted('create')).toBeUndefined();

    await wrapper.get('[name="scene-title"]').setValue('  Last train  ');
    await wrapper.get('[name="scene-location"]').setValue('  Platform nine  ');
    await wrapper.get('[name="scene-opening"]').setValue('  The doors begin to close.  ');
    await wrapper.get('[name="scene-objective"]').setValue('  Test whether Mara tells the truth.  ');
    await wrapper.get('[name="scene-risk"]').setValue('The witness leaves.');
    await wrapper.get('[name="play-allow-hidden"]').setValue(false);
    await wrapper.get('[name="play-event-limit"]').setValue('7');
    await wrapper.get('.play-rehearsal-step-form').trigger('submit');
    expect(wrapper.get('[aria-current="step"]').text()).toContain('场景');
    expect(wrapper.text()).toContain('请输入 0 到 6 的整数。');
    await wrapper.get('[name="play-event-limit"]').setValue('0');
    await wrapper.get('.play-rehearsal-step-form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[aria-current="step"]').text()).toContain('人物');
    expect(document.activeElement).toBe(wrapper.get('.play-rehearsal-setup-panel').element);

    await wrapper.get('[name="actor-1-name"]').setValue('  Mara  ');
    await wrapper.get('[name="actor-1-goal"]').setValue('  Hide the letter  ');
    await wrapper.get('[name="actor-1-knowledge"]').setValue('  The train leaves at midnight.  ');
    await wrapper.get('.play-rehearsal-add-actor').trigger('click');
    await wrapper.get('[name="actor-2-name"]').setValue('Ivo');
    await wrapper.get('[name="actor-2-goal"]').setValue('Recover the letter');
    await wrapper.get('[aria-label="把第 2 个角色上移"]').trigger('click');
    await wrapper.get('.play-rehearsal-cast').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[aria-current="step"]').text()).toContain('确认');
    expect(wrapper.text()).toContain('固定的角色顺序');
    expect(wrapper.text()).toContain('Ivo');
    expect(wrapper.text()).toContain('Mara');
    expect(wrapper.text()).toContain('还没有创建任何内容');
    expect(wrapper.emitted('create')).toBeUndefined();

    const confirm = wrapper.findAll('button').find((button) =>
      button.text().includes('开始场景试演'),
    );
    await confirm!.trigger('click');

    expect(wrapper.emitted('create')).toHaveLength(1);
    expect(wrapper.emitted('create')?.[0]?.[0]).toEqual({
      purpose: 'sceneRehearsal',
      startMode: 'quick',
      scene: {
        title: 'Last train',
        opening: 'The doors begin to close.',
        location: 'Platform nine',
        atmosphere: '',
        objective: 'Test whether Mara tells the truth.',
        risk: 'The witness leaves.',
        simulationMode: 'reactiveWorld',
        density: 'balanced',
        eventSettings: { allowOffscreen: true, allowHidden: false, maxExternalEventsPerTurn: '0' },
      },
      participants: [
        {
          participantRef: 'participant-2',
          displayName: 'Ivo',
          position: '',
          currentGoal: 'Recover the letter',
          initialKnowledge: '',
        },
        {
          participantRef: 'participant-1',
          displayName: 'Mara',
          position: '',
          currentGoal: 'Hide the letter',
          initialKnowledge: 'The train leaves at midnight.',
        },
      ],
      actorOrder: ['participant-2', 'participant-1'],
    });
    const submission = wrapper.emitted('create')?.[0]?.[0] as PlayRehearsalSetupSubmission;
    expect(buildPlayRehearsalSessionInput(submission).eventPolicy).toEqual({
      simulationMode: 'reactiveWorld', density: 'balanced',
      allowOffscreen: true, allowHidden: false, maxExternalEventsPerTurn: 0,
    });
    wrapper.unmount();
  });
});
