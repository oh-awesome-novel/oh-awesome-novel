// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlaySessionRail from '../../../apps/desktop-ui/src/components/play/PlaySessionRail.vue';
import type { PlaySession } from '@oh-awesome-novel/client';

describe('PlaySessionRail', () => {
  it('exposes the create form as an accessible disclosure', async () => {
    const wrapper = mountRail();
    const trigger = wrapper.get('.play-create-trigger');
    const controlledId = trigger.attributes('aria-controls');

    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(controlledId).toBeTruthy();

    await trigger.trigger('click');

    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.play-create-form').attributes('id')).toBe(controlledId);
  });

  it('announces the current session and emits keyboard-compatible button selection', async () => {
    const wrapper = mountRail();
    const sessionButtons = wrapper.findAll('.play-session-card');

    expect(sessionButtons[0]?.attributes('aria-current')).toBe('true');
    expect(sessionButtons[1]?.attributes('aria-current')).toBeUndefined();

    await sessionButtons[1]?.trigger('click');

    expect(wrapper.emitted('selectSession')).toEqual([['play-2']]);
  });
});

function mountRail() {
  return mount(PlaySessionRail, {
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
