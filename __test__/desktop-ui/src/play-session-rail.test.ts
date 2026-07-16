// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlaySessionRail from '../../../apps/desktop-ui/src/components/play/PlaySessionRail.vue';
import type { PlaySession } from '@oh-awesome-novel/client';

describe('PlaySessionRail', () => {
  it('stays list-focused and delegates New session to the main launch flow', async () => {
    const wrapper = mountRail();

    expect(wrapper.find('.play-purpose-picker').exists()).toBe(false);
    expect(wrapper.find('.play-launch-mode-picker').exists()).toBe(false);
    expect(wrapper.find('.play-create-form').exists()).toBe(false);
    expect(wrapper.find('.play-rehearsal-setup').exists()).toBe(false);
    expect(wrapper.findAll('.play-session-card')).toHaveLength(2);

    await wrapper.get('.play-create-trigger').trigger('click');

    expect(wrapper.emitted('newSession')).toEqual([[]]);
    expect(wrapper.emitted('createSession')).toBeUndefined();
    expect(wrapper.find('.play-create-form').exists()).toBe(false);
    expect(wrapper.find('.play-rehearsal-setup').exists()).toBe(false);
  });

  it('announces the current session and emits button selection', async () => {
    const wrapper = mountRail();
    const sessionButtons = wrapper.findAll('.play-session-card');

    expect(sessionButtons[0]?.attributes('aria-current')).toBe('true');
    expect(sessionButtons[1]?.attributes('aria-current')).toBeUndefined();

    await sessionButtons[1]?.trigger('click');

    expect(wrapper.emitted('selectSession')).toEqual([['play-2']]);
  });

  it('keeps New, selection, and refresh disabled at their existing busy boundaries', async () => {
    const wrapper = mountRail({
      busy: true,
      refreshDisabled: true,
    });

    expect(wrapper.get('.play-create-trigger').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.play-session-card').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="刷新 Play sessions"]').attributes('disabled'))
      .toBeDefined();

    await wrapper.setProps({ busy: false, refreshDisabled: false });
    await wrapper.get('[aria-label="刷新 Play sessions"]').trigger('click');

    expect(wrapper.emitted('refresh')).toEqual([[]]);
  });
});

function mountRail(overrides: Partial<{
  sessions: PlaySession[];
  selectedSessionId: string;
  loading: boolean;
  creating: boolean;
  busy: boolean;
  refreshDisabled: boolean;
}> = {}) {
  return mount(PlaySessionRail, {
    props: {
      sessions: [createSession('play-1'), createSession('play-2')],
      selectedSessionId: 'play-1',
      loading: false,
      creating: false,
      busy: false,
      refreshDisabled: false,
      ...overrides,
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
