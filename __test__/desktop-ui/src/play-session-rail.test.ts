// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlaySessionRail from '../../../apps/desktop-ui/src/components/play/PlaySessionRail.vue';
import type {
  CreatePlaySceneRehearsalSessionInput,
  PlaySession,
} from '@oh-awesome-novel/client';

describe('PlaySessionRail', () => {
  it('opens an accessible purpose choice before either creation form', async () => {
    const wrapper = mountRail();
    const trigger = wrapper.get('.play-create-trigger');
    const controlledId = trigger.attributes('aria-controls');

    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(controlledId).toBeTruthy();

    await trigger.trigger('click');

    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.play-create-flow').attributes('id')).toBe(controlledId);
    expect(wrapper.find('.play-purpose-picker').exists()).toBe(true);
    expect(wrapper.find('.play-create-form').exists()).toBe(false);
    expect(wrapper.find('.play-rehearsal-setup').exists()).toBe(false);
  });

  it('keeps Immersive Journey on the existing Quick creation path', async () => {
    const wrapper = mountRail();

    await wrapper.get('.play-create-trigger').trigger('click');
    await button(wrapper, 'Immersive Journey').trigger('click');

    expect(wrapper.find('.play-purpose-picker').exists()).toBe(false);
    const form = wrapper.get('.play-create-form');
    await form.find('input[placeholder="雨夜码头"]').setValue('Night station');
    await form.find('textarea[placeholder="从一个可行动的瞬间开始"]').setValue(
      'The last train arrives.',
    );
    await form.trigger('submit');

    expect(wrapper.emitted('createSession')).toEqual([[
      expect.objectContaining({
        title: 'Night station',
        sceneStart: 'The last train arrives.',
      }),
    ]]);
    expect(wrapper.emitted('createSession')?.[0]?.[0]).not.toHaveProperty('purpose');
  });

  it('creates schema-v5 input only after the Rehearsal Review confirmation', async () => {
    const wrapper = mountRail();

    await wrapper.get('.play-create-trigger').trigger('click');
    await button(wrapper, 'Scene Rehearsal').trigger('click');
    await wrapper.get('[name="scene-title"]').setValue('Last train');
    await wrapper.get('[name="scene-location"]').setValue('Platform nine');
    await wrapper.get('[name="scene-opening"]').setValue('The doors begin to close.');
    await wrapper.get('[name="scene-objective"]').setValue('Test Mara.');
    await wrapper.get('.play-rehearsal-step-form').trigger('submit');
    await flushPromises();

    await wrapper.get('[name="actor-1-name"]').setValue('Mara');
    await wrapper.get('[name="actor-1-goal"]').setValue('Hide the letter');
    await wrapper.get('[name="actor-1-knowledge"]').setValue('The train leaves at midnight.');
    await wrapper.get('.play-rehearsal-cast').trigger('submit');
    await flushPromises();

    expect(wrapper.emitted('createSession')).toBeUndefined();
    await wrapper.get('.play-rehearsal-review').trigger('submit');
    await flushPromises();

    const emitted = (
      wrapper.emitted('createSession') ?? wrapper.emitted('create-session')
    )?.[0]?.[0] as CreatePlaySceneRehearsalSessionInput;
    expect(emitted).toMatchObject({
      title: 'Last train',
      sceneStart: 'The doors begin to close.',
      purpose: 'sceneRehearsal',
      startMode: 'guided',
      sceneContract: {
        sceneId: 'scene-last-train',
        worldClock: { turn: 0, revision: 0 },
        clockProvenance: { kind: 'newSessionInitial', sourceRefs: [] },
        participantRefs: ['participant-1'],
        orderStrategy: 'directorFixed',
        location: {
          value: 'Platform nine',
          provenance: { kind: 'authorProvided' },
        },
      },
      participants: [{
        participantRef: 'participant-1',
        displayName: 'Mara',
        currentGoal: 'Hide the letter',
        initialKnowledgeEvidenceRefs: ['participant-1-knowledge'],
      }],
      initialKnowledgeEvidence: [{
        id: 'participant-1-knowledge',
        participantRef: 'participant-1',
        visibility: 'playerVisible',
        fact: 'The train leaves at midnight.',
        provenance: { kind: 'authorProvided' },
      }],
    });
    expect(emitted.sceneContract.clockProvenance.authorProvidedAt).toEqual(
      expect.any(String),
    );
    expect(emitted.initialKnowledgeEvidence[0].provenance.providedAt).toEqual(
      expect.any(String),
    );
  });

  it('announces the current session and emits keyboard-compatible button selection', async () => {
    const wrapper = mountRail();
    const sessionButtons = wrapper.findAll('.play-session-card');

    expect(sessionButtons[0]?.attributes('aria-current')).toBe('true');
    expect(sessionButtons[1]?.attributes('aria-current')).toBeUndefined();

    await sessionButtons[1]?.trigger('click');

    expect(wrapper.emitted('selectSession')).toEqual([['play-2']]);
  });

  it('restores focus across outer purpose/setup creation transitions', async () => {
    const wrapper = mountRail(true);
    const trigger = wrapper.get<HTMLButtonElement>('.play-create-trigger');
    trigger.element.focus();
    await trigger.trigger('click');
    await button(wrapper, 'Scene Rehearsal').trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('[name="scene-title"]').element);

    await button(wrapper, 'Cancel').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(button(wrapper, 'Immersive Journey').element);

    await button(wrapper, 'Cancel').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(trigger.element);

    await trigger.trigger('click');
    await button(wrapper, 'Scene Rehearsal').trigger('click');
    await wrapper.setProps({ selectedSessionId: 'play-2' });
    await flushPromises();
    expect(wrapper.find('.play-create-flow').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });
});

function mountRail(attachToDocument = false) {
  return mount(PlaySessionRail, {
    ...(attachToDocument ? { attachTo: document.body } : {}),
    props: {
      sessions: [createSession('play-1'), createSession('play-2')],
      selectedSessionId: 'play-1',
      loading: false,
      creating: false,
      busy: false,
      refreshDisabled: false,
    },
  });
}

function button(wrapper: ReturnType<typeof mountRail>, label: string) {
  const result = wrapper.findAll('button').find((candidate) =>
    candidate.text().includes(label));
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function createSession(id: string): PlaySession {
  return {
    schemaVersion: 4,
    id,
    title: id,
    createdAt: '2026-07-15T00:00:00.000Z',
    revision: 0,
    sceneStart: 'Station',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock: { turn: 0, revision: 0 },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [],
    scheduledEvents: [],
    suggestedActions: [],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}
