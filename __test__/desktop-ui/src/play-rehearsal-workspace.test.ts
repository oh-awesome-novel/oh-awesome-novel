// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayRehearsalWorkspace from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayRehearsalWorkspace.vue';
import type {
  PlayRehearsalActorQueueItem,
  PlayRehearsalControlCapabilities,
  PlayRehearsalResultView,
  PlayRehearsalStepView,
} from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

describe('PlayRehearsalWorkspace', () => {
  it('composes queue, safe perception and provisional/selected/committed steps', async () => {
    const wrapper = mountWorkspace();

    expect(wrapper.get('[aria-label="Scene rehearsal workspace"]').attributes('aria-busy')).toBe('false');
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Ivo');
    expect(wrapper.get('.play-rehearsal-step[data-status="provisional"]').text()).toContain(
      'provisional · not committed',
    );
    expect(wrapper.get('.play-rehearsal-step[data-status="selected"]').text()).toContain(
      'selected · attempt-local',
    );
    expect(wrapper.get('.play-rehearsal-step[data-status="committed"]').text()).toContain('committed');
    expect(wrapper.get('.play-rehearsal-inspector').text()).toContain('The train leaves at midnight.');
    expect(wrapper.text()).not.toContain('Hidden command from the mayor');
    expect(wrapper.get('[role="status"]').text()).toBe('Draft prepared for Ivo.');

    await button(wrapper, 'Stop step').trigger('click');
    await button(wrapper, 'Accept').trigger('click');
    await button(wrapper, 'Retry').trigger('click');
    expect(wrapper.emitted('stopStep')).toHaveLength(1);
    expect(wrapper.emitted('accept')).toEqual([['step-ivo-draft']]);
    expect(wrapper.emitted('retry')).toEqual([['step-ivo-draft']]);

    await button(wrapper, 'Finish').trigger('click');
    await flushPromises();
    await button(wrapper, 'Confirm Finish').trigger('click');
    expect(wrapper.emitted('finish')).toHaveLength(1);
    wrapper.unmount();
  });

  it('starts an attempt explicitly and presents only committed result truth', async () => {
    const wrapper = mountWorkspace({
      attempt: undefined,
      steps: [],
      stepRun: undefined,
      capabilities: {
        ...fullCapabilities(),
        canStartAttempt: true,
        canGenerateStep: false,
        canStopStep: false,
        canAccept: false,
        canRetry: false,
        canFinish: false,
        canCancel: false,
      },
    });

    await button(wrapper, 'Begin rehearsal attempt').trigger('click');
    expect(wrapper.emitted('startAttempt')).toHaveLength(1);

    await wrapper.setProps({
      attempt: {
        id: 'attempt-1',
        revision: 4,
        status: 'committed',
        selectedStepRefs: ['step-mara-selected'],
        selectedHeadRef: 'step-mara-selected',
      },
      steps: committedSteps(),
      result: committedResult(),
      capabilities: {
        ...fullCapabilities(),
        canAccept: false,
        canRetry: false,
        canFinish: false,
        canCancel: false,
      },
      announcement: 'Rehearsal committed once.',
    });

    expect(wrapper.get('[data-status="committed"].play-rehearsal-result').text()).toContain(
      'Rehearsal Result',
    );
    expect(wrapper.text()).toContain('Revision 4 · turn-rehearsal-1');
    expect(wrapper.text()).toContain('Mara keeps the letter hidden.');
    expect(wrapper.find('.play-director-controls').exists()).toBe(false);
    wrapper.unmount();
  });
});

function mountWorkspace(
  overrides: Record<string, unknown> = {},
) {
  return mount(PlayRehearsalWorkspace, {
    attachTo: document.body,
    props: {
      scene: {
        title: 'Last train',
        opening: 'The doors begin to close.',
        location: 'Platform nine',
        atmosphere: 'Tense',
        objective: 'Test whether Mara tells the truth.',
        risk: 'The witness leaves.',
      },
      clock: { turn: 3, revision: 3, anchor: '23:50' },
      attempt: {
        id: 'attempt-1',
        revision: 3,
        status: 'running',
        currentParticipantRef: 'ivo',
        selectedStepRefs: ['step-mara-selected'],
        selectedHeadRef: 'step-mara-selected',
      },
      queue: actorQueue(),
      steps: activeSteps(),
      stepRun: {
        id: 'run-step-ivo',
        phase: 'prepared',
        statusMessage: 'Actor step prepared · not selected',
      },
      perception: {
        participantRef: 'ivo',
        visibleFacts: ['The train leaves at midnight.'],
        behaviorAnchors: ['Ivo never abandons an unfinished promise.'],
        observedBlockLabels: ['Mara looked toward the signal box.'],
      },
      visibleEvents: [{
        id: 'event-visible',
        title: 'Final boarding call',
        summary: 'The platform bell rings.',
      }],
      capabilities: fullCapabilities(),
      providerConfigured: true,
      busy: false,
      announcement: 'Draft prepared for Ivo.',
      ...overrides,
    },
  });
}

function actorQueue(): PlayRehearsalActorQueueItem[] {
  return [
    { participantRef: 'mara', displayName: 'Mara', status: 'selected' },
    { participantRef: 'ivo', displayName: 'Ivo', status: 'current', currentGoal: 'Recover the letter' },
    { participantRef: 'guard', displayName: 'Guard', status: 'waiting' },
  ];
}

function activeSteps(): PlayRehearsalStepView[] {
  return [
    step('step-old', 'Guard', 'committed', 'The guard checks the clock.'),
    step('step-mara-selected', 'Mara', 'selected', 'Mara hides the letter.'),
    step('step-ivo-draft', 'Ivo', 'provisional', 'Ivo reaches for the door.'),
  ];
}

function committedSteps(): PlayRehearsalStepView[] {
  return [step('step-mara-selected', 'Mara', 'committed', 'Mara hides the letter.')];
}

function step(
  id: string,
  participantName: string,
  status: PlayRehearsalStepView['status'],
  content: string,
): PlayRehearsalStepView {
  return {
    id,
    participantRef: participantName.toLowerCase(),
    participantName,
    status,
    blocks: [{
      id: `${id}-block`,
      kind: 'characterAction',
      speakerName: participantName,
      content,
      projection: 'transcript',
    }],
  };
}

function fullCapabilities(): PlayRehearsalControlCapabilities {
  return {
    canStartAttempt: false,
    canGenerateStep: false,
    canStopStep: true,
    canAccept: true,
    canRetry: true,
    canFinish: true,
    canCancel: true,
  };
}

function committedResult(): PlayRehearsalResultView {
  return {
    artifactRef: 'turn-rehearsal-1',
    revision: 4,
    summary: 'Mara keeps the letter hidden.',
    blocks: [{
      id: 'result-block',
      kind: 'characterAction',
      speakerName: 'Mara',
      content: 'Mara keeps the letter hidden.',
      projection: 'transcript',
    }],
    eventSummaries: ['The final boarding bell rings.'],
    stateChanges: [{ label: 'letter.owner', before: 'Ivo', after: 'Mara' }],
  };
}

function button(
  wrapper: ReturnType<typeof mountWorkspace>,
  label: string,
) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
