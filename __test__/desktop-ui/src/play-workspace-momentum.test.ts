// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlaySession,
  PlayTurnStreamEvent,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  listPlaySessions: vi.fn(),
  listPlayCheckpoints: vi.fn(),
  streamPlayWorldRefereeTurn: vi.fn(),
  cancelPlayWorldRefereeTurn: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';

describe('PlayWorkspace world momentum', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
    api.cancelPlayWorldRefereeTurn.mockResolvedValue({
      status: 'cancelled',
      committed: false,
      turnId: 'run-2',
    });
  });

  it('projects spoiler-safe momentum and causal labels outside generic local state', async () => {
    api.listPlaySessions.mockResolvedValue({ sessions: [createSession()] });
    const wrapper = mountWorkspace();
    await flushPromises();

    expect(wrapper.get('[aria-label="World momentum"]').text()).toContain('Station lockdown');
    expect(wrapper.get('[aria-label="World momentum"]').text()).not.toContain('Hidden command');
    expect(wrapper.get('.play-event-cause').text()).toContain('Pressure · Station lockdown');
    expect(wrapper.text()).toContain('PLAYER-VISIBLE-STATE');
    expect(wrapper.text()).not.toContain('RUMOR-STATE-MUST-NOT-LEAK');
    expect(wrapper.text()).not.toContain('HIDDEN-STATE-MUST-NOT-LEAK');
    expect(wrapper.text()).toContain('tracked world condition = matched');
    expect(wrapper.text()).not.toContain('secrets.commandCode');
    expect(wrapper.text()).not.toContain('AUTHOR-CODE-9417');
    expect(wrapper.text()).not.toContain('worldMomentum');
    expect(wrapper.text()).not.toContain('A commander secretly ordered the guards.');

    await wrapper.get('[role="switch"]').trigger('click');
    expect(wrapper.get('[aria-label="World momentum"]').text()).toContain('Hidden command');
    expect(wrapper.text()).toContain('RUMOR-STATE-MUST-NOT-LEAK');
    expect(wrapper.text()).toContain('HIDDEN-STATE-MUST-NOT-LEAK');
    expect(wrapper.text()).toContain('secrets.commandCode = AUTHOR-CODE-9417');
    expect(wrapper.get('details').text()).toContain('A commander secretly ordered the guards.');
    expect(wrapper.get('details').text()).toContain('event-1');
    wrapper.unmount();
  });

  it('does not offer Author view solely because the reserved momentum root is hidden', async () => {
    const session = createSession();
    session.turnArtifacts = [];
    session.selectedTurnIds = [];
    session.events = [];
    const momentum = session.playLocalState.worldMomentum as {
      agendas: unknown[];
    };
    momentum.agendas = [];
    delete session.playLocalState.rumorSignal;
    delete session.playLocalState.hiddenSignal;
    delete session.playLocalStateVisibility.rumorSignal;
    delete session.playLocalStateVisibility.hiddenSignal;
    session.scheduledEvents = [];
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });

    const wrapper = mountWorkspace();
    await flushPromises();

    expect(wrapper.get('[aria-label="World momentum"]').text()).toContain('Station lockdown');
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps rumor state paths behind Author view even without player-unknown state', async () => {
    const session = createSession();
    session.turnArtifacts = [];
    session.selectedTurnIds = [];
    session.events = [];
    session.scheduledEvents = [];
    delete session.playLocalState.hiddenSignal;
    delete session.playLocalStateVisibility.hiddenSignal;
    const momentum = session.playLocalState.worldMomentum as { agendas: unknown[] };
    momentum.agendas = [];
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });

    const wrapper = mountWorkspace();
    await flushPromises();

    expect(wrapper.text()).not.toContain('RUMOR-STATE-MUST-NOT-LEAK');
    expect(wrapper.find('[role="switch"]').exists()).toBe(true);
    await wrapper.get('[role="switch"]').trigger('click');
    expect(wrapper.text()).toContain('RUMOR-STATE-MUST-NOT-LEAK');
    wrapper.unmount();
  });

  it('submits an explicit typed relative advance and synthesizes readable wait text', async () => {
    api.listPlaySessions.mockResolvedValue({ sessions: [createSession()] });
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* () {
      yield startedEvent();
      yield failedEvent();
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    const wait = wrapper.findAll('.play-action-kinds button').find(
      (button) => button.text().includes('Wait'),
    );
    await wait!.trigger('click');
    const oneHour = wrapper.findAll('.play-time-presets button').find(
      (button) => button.text() === '1 小时',
    );
    await oneHour!.trigger('click');
    await wrapper.get('.play-composer').trigger('submit');
    await flushPromises();

    expect(api.streamPlayWorldRefereeTurn).toHaveBeenCalledWith(
      'play-1',
      {
        userText: '等待 1 小时，观察世界变化。',
        actionKind: 'wait',
        timeAdvance: { amount: 1, unit: 'hour' },
        baseRevision: 1,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    wrapper.unmount();
  });
});

function mountWorkspace() {
  const workspace: WorkspaceSummary = {
    name: 'alpha',
    novelName: 'Alpha',
    path: '/novels/alpha',
    valid: true,
  };
  return mount(PlayWorkspace, {
    attachTo: document.body,
    props: { workspace, providerConfigured: true },
  });
}

function createSession(): PlaySession {
  const pressure = {
    id: 'pressure-1',
    kind: 'deadline' as const,
    label: 'Station lockdown',
    status: 'active' as const,
    causeRefs: ['event-1'],
    nextConsequence: 'The east gate closes.',
    visibility: 'playerVisible' as const,
  };
  const hiddenAgenda = {
    id: 'agenda-hidden',
    ownerEntityId: 'Hidden command',
    goal: 'Trap the witness',
    nextMove: 'Seal the platform',
    blockers: [],
    status: 'active' as const,
    visibility: 'playerUnknown' as const,
    updatedAtTurnId: 'turn-1',
  };
  const momentum = { pressures: [pressure], agendas: [hiddenAgenda] };
  const scheduledEvent = {
    id: 'scheduled-secret-flag',
    label: 'Condition-driven station change',
    trigger: {
      type: 'flagEquals' as const,
      path: 'secrets.commandCode',
      value: 'AUTHOR-CODE-9417',
    },
    template: {
      kind: 'factionActed' as const,
      origin: 'faction' as const,
      title: 'The station changes',
      summary: 'A visible station change is pending.',
      visibility: 'playerVisible' as const,
    },
    status: 'scheduled' as const,
    scheduledAtTurn: 0,
    scheduledAtRevision: 0,
  };
  const localState = {
    location: 'platform',
    visibleSignal: 'PLAYER-VISIBLE-STATE',
    rumorSignal: 'RUMOR-STATE-MUST-NOT-LEAK',
    hiddenSignal: 'HIDDEN-STATE-MUST-NOT-LEAK',
    worldMomentum: momentum,
  };
  const localStateVisibility = {
    location: 'playerVisible' as const,
    visibleSignal: 'playerVisible' as const,
    rumorSignal: 'rumor' as const,
    hiddenSignal: 'playerUnknown' as const,
    worldMomentum: 'playerUnknown' as const,
  };

  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Station',
    createdAt: '2026-07-15T00:00:00.000Z',
    revision: 1,
    sceneStart: 'Rain hits the roof.',
    characters: [],
    transcript: [],
    turnArtifacts: [{
      schemaVersion: 2,
      artifactKind: 'worldSettlement',
      branchSnapshotVersion: 1,
      id: 'turn-1',
      revision: 1,
      input: { kind: 'look', raw: 'Watch the guards.' },
      messages: [],
      worldClock: { turn: 1, revision: 1 },
      eventIds: ['event-1'],
      dueScheduledEventIds: [],
      scheduledEventIds: [scheduledEvent.id],
      scheduledEventSnapshots: [scheduledEvent],
      playLocalStateSnapshot: localState,
      playLocalStateVisibilitySnapshot: localStateVisibility,
      observationIds: [],
      stateDelta: {},
      suggestedActions: [],
      committedAt: '2026-07-15T00:00:00.000Z',
      canonical: false,
    }],
    selectedTurnIds: ['turn-1'],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: localState,
      playLocalStateVisibility: localStateVisibility,
      scheduledEvents: [scheduledEvent],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: localState,
    playLocalStateVisibility: localStateVisibility,
    worldClock: { turn: 1, revision: 1 },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [{
      id: 'event-1',
      turnId: 'turn-1',
      sequence: 1,
      kind: 'factionActed',
      origin: 'faction',
      title: 'The gate closes',
      summary: 'Guards lock the east gate.',
      visibility: 'playerVisible',
      cause: {
        reason: 'A commander secretly ordered the guards.',
        pressureId: 'pressure-1',
      },
      worldClock: { turn: 1, revision: 1 },
      createdAt: '2026-07-15T00:00:00.000Z',
      canonical: false,
    }],
    scheduledEvents: [scheduledEvent],
    suggestedActions: [],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}

function startedEvent(): PlayTurnStreamEvent {
  return {
    type: 'play.turn.started',
    eventId: 'run-2:1',
    sequence: 1,
    sessionId: 'play-1',
    turnId: 'run-2',
    baseRevision: 1,
    expectedArtifactId: 'turn-2',
  };
}

function failedEvent(): PlayTurnStreamEvent {
  return {
    type: 'play.turn.failed',
    eventId: 'run-2:2',
    sequence: 2,
    sessionId: 'play-1',
    turnId: 'run-2',
    error: {
      code: 'invalid_settlement',
      message: 'Test terminal event.',
      retryable: true,
    },
  };
}
