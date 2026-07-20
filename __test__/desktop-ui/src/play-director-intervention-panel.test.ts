// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayDirectorInterventionPanel from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayDirectorInterventionPanel.vue';
import type {
  PlayDirectorPanelMode,
  PlayRehearsalActorQueueItem,
  PlayRehearsalStepView,
} from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

describe('PlayDirectorInterventionPanel', () => {
  it('emits typed projection revision and redirect drafts', async () => {
    const wrapper = mountPanel('modify');

    await wrapper.get('textarea').setValue('Ivo stops beside the closing door.');
    await button(wrapper, 'Apply intervention').trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual([{
      kind: 'reviseProjection',
      stepRef: 'step-ivo-draft',
      replacementProjection: [{
        blockId: 'step-ivo-draft-action',
        content: 'Ivo stops beside the closing door.',
      }],
    }]);

    await button(wrapper, 'Redirect step').trigger('click');
    await flushPromises();
    await wrapper.get('textarea').setValue('Make Ivo question Mara before moving.');
    await wrapper.get('input:not([type="radio"])').setValue(
      'constraint-dialogue, constraint-clock constraint-dialogue',
    );
    await button(wrapper, 'Apply intervention').trigger('click');

    expect(wrapper.emitted('submit')?.[1]).toEqual([{
      kind: 'redirectStep',
      stepRef: 'step-ivo-draft',
      directorIntent: 'Make Ivo question Mara before moving.',
      authorConstraintRefs: ['constraint-dialogue', 'constraint-clock'],
    }]);
    wrapper.unmount();
  });

  it('emits a typed actor insertion anchored to a live step', async () => {
    const wrapper = mountPanel('insertActor');
    const [participant, placement] = wrapper.findAll('select');

    await participant!.setValue('guard');
    await placement!.setValue('before');
    await flushPromises();
    await wrapper.findAll('select')[2]!.setValue('step-mara-selected');
    await button(wrapper, 'Apply intervention').trigger('click');

    expect(wrapper.emitted('submit')).toEqual([[{
      kind: 'insertActor',
      participantRef: 'guard',
      anchor: 'before',
      anchorStepRef: 'step-mara-selected',
    }]]);
    wrapper.unmount();
  });

  it('emits both stable-ref and author-provided participant knowledge drafts', async () => {
    const wrapper = mountPanel('grantKnowledge');
    const [participant, effectiveFrom] = wrapper.findAll('select');

    await participant!.setValue('guard');
    await effectiveFrom!.setValue('step-mara-selected');
    await wrapper.get('input:not([type="radio"])').setValue(
      'fact-platform fact-clock, fact-platform',
    );
    await button(wrapper, 'Apply intervention').trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual([{
      kind: 'grantKnowledge',
      participantRef: 'guard',
      effectiveFromStepRef: 'step-mara-selected',
      grant: {
        kind: 'existingFact',
        factRefs: ['fact-platform', 'fact-clock'],
      },
    }]);

    await wrapper.get('input[type="radio"][value="authorProvidedPlayFact"]').setValue();
    await flushPromises();
    await wrapper.get('textarea').setValue('The signal code changes at midnight.');
    await wrapper.findAll('select').at(-1)!.setValue('playerUnknown');
    await button(wrapper, 'Apply intervention').trigger('click');

    expect(wrapper.emitted('submit')?.[1]).toEqual([{
      kind: 'grantKnowledge',
      participantRef: 'guard',
      effectiveFromStepRef: 'step-mara-selected',
      grant: {
        kind: 'authorProvidedPlayFact',
        summary: 'The signal code changes at midnight.',
        visibility: 'playerUnknown',
      },
    }]);
    wrapper.unmount();
  });
});

function mountPanel(mode: PlayDirectorPanelMode) {
  return mount(PlayDirectorInterventionPanel, {
    attachTo: document.body,
    props: {
      mode,
      steps: liveSteps(),
      participants: participants(),
      activeStepRef: 'step-ivo-draft',
      busy: false,
    },
  });
}

function liveSteps(): PlayRehearsalStepView[] {
  return [
    {
      id: 'step-mara-selected',
      participantRef: 'mara',
      participantName: 'Mara',
      status: 'selected',
      blocks: [{
        id: 'step-mara-selected-action',
        kind: 'characterAction',
        content: 'Mara conceals the letter.',
        projection: 'transcript',
      }],
    },
    {
      id: 'step-ivo-draft',
      participantRef: 'ivo',
      participantName: 'Ivo',
      status: 'provisional',
      blocks: [
        {
          id: 'step-ivo-draft-action',
          kind: 'characterAction',
          content: 'Ivo reaches for the closing door.',
          projection: 'transcript',
        },
        {
          id: 'step-ivo-world-notice',
          kind: 'worldNotice',
          content: 'The boarding bell rings.',
          projection: 'directorOnly',
        },
      ],
    },
  ];
}

function participants(): PlayRehearsalActorQueueItem[] {
  return [
    { participantRef: 'mara', displayName: 'Mara', status: 'selected' },
    { participantRef: 'ivo', displayName: 'Ivo', status: 'current' },
    { participantRef: 'guard', displayName: 'Guard', status: 'waiting' },
  ];
}

function button(
  wrapper: VueWrapper,
  label: string,
) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
