import { describe, expect, it } from 'vitest';

import { buildPlayEventCardViews } from '../../../apps/desktop-ui/src/composables/playWorldPresentation';
import type {
  PlayAgenda,
  PlayPressure,
  PlayScheduledEvent,
  PlayTurnArtifact,
  PlayWorldEvent,
} from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';

describe('buildPlayEventCardViews', () => {
  it('uses the owning artifact snapshots for spoiler-safe causes and state changes', () => {
    const sourceEvent = createEvent({
      id: 'event-source',
      turnId: 'turn-1-referee',
      title: 'A warning reaches the station',
      summary: 'The guards receive a public warning.',
      kind: 'informationSpread',
      origin: 'npc',
      worldClock: { turn: 1, revision: 1 },
    });
    const event = createEvent({
      id: 'event-target',
      turnId: 'turn-2-referee',
      title: 'The east gate closes',
      summary: 'Guards seal the station exit.',
      kind: 'factionActed',
      origin: 'faction',
      cause: {
        reason: 'A private command accelerated the lockdown.',
        sourceTurnIds: ['turn-2-player', 'turn-2-referee'],
        sourceEventIds: [sourceEvent.id],
        triggerId: 'schedule-lockdown',
        pressureId: 'pressure-lockdown',
        agendaId: 'agenda-guard',
      },
      worldClock: {
        turn: 2,
        revision: 2,
        anchor: 'Nightfall',
        elapsed: '30 minutes',
      },
    });
    const scheduledEvent = createScheduledEvent({ occurredEventIds: [event.id] });
    const pressure = createPressure({ causeRefs: [event.id] });
    const agenda = createAgenda({ updatedAtTurnId: event.turnId });
    const momentum = { pressures: [pressure], agendas: [agenda] };
    const artifact = createArtifact({
      branchSnapshotVersion: 1,
      eventIds: [event.id],
      messages: [{
        id: 'turn-2-player',
        speaker: 'user',
        content: 'Stay beside the eastern gate.',
        actionKind: 'wait',
        createdAt: '2026-07-15T04:00:00.000Z',
      }, {
        id: 'turn-2-referee',
        speaker: 'referee',
        content: 'Unrevealed referee explanation.',
        createdAt: '2026-07-15T04:00:01.000Z',
      }],
      worldClock: event.worldClock,
      dueScheduledEventIds: [scheduledEvent.id],
      scheduledEventIds: [scheduledEvent.id],
      scheduledEventSnapshots: [scheduledEvent],
      playLocalStateSnapshot: {
        'location.gate': 'closed',
        worldMomentum: momentum,
      },
      playLocalStateVisibilitySnapshot: {
        'location.gate': 'playerVisible',
        worldMomentum: 'playerUnknown',
      },
      stateDelta: {
        'location.gate': 'closed',
        worldMomentum: momentum,
      },
    });
    const cards = buildPlayEventCardViews({
      events: [sourceEvent, event],
      artifacts: [artifact],
      scheduledEvents: [createScheduledEvent({
        label: 'Current-head schedule must be ignored',
      })],
      pressures: [createPressure({
        label: 'Current-head pressure must be ignored',
        causeRefs: [event.id],
      })],
      agendas: [createAgenda({
        ownerEntityId: 'Current-head agenda must be ignored',
      })],
      stateVisibility: { 'location.gate': 'playerUnknown' },
      showSpoilers: false,
    });
    const card = cards.find((candidate) => candidate.id === event.id)!;

    expect(card.impact).toBe('Guards seal the station exit.');
    expect(card.worldTimeLabel).toBe('Nightfall · Turn 2 · + 30 minutes');
    expect(card.originLabel).toBe('Origin · Faction');
    expect(card.causeLabels.map((cause) => cause.kind)).toEqual([
      'action',
      'trigger',
      'sourceEvent',
      'pressure',
      'agenda',
    ]);
    expect(card.causeLabels.map((cause) => cause.label).join(' ')).toContain(
      'Wait · Stay beside the eastern gate.',
    );
    expect(card.causeLabels.map((cause) => cause.label).join(' ')).not.toContain(
      'Unrevealed referee explanation.',
    );
    expect(card.causeLabels.map((cause) => cause.label).join(' ')).not.toContain(
      'Current-head',
    );
    expect(card.stateImpacts).toEqual([
      { path: 'location.gate', value: 'closed' },
    ]);
    expect(card.technicalRefs).toEqual([]);
    expect(card.authorReason).toBeUndefined();

    const authorCard = buildPlayEventCardViews({
      events: [sourceEvent, event],
      artifacts: [artifact],
      showSpoilers: true,
    }).find((candidate) => candidate.id === event.id)!;
    expect(authorCard.technicalRefs).toContainEqual({
      label: 'Artifact',
      value: 'artifact-2',
    });
    expect(authorCard.stateImpacts).toContainEqual({
      path: 'worldMomentum',
      value: 'Pressure / agenda state updated',
    });
  });

  it('omits hidden events and hidden cause objects until Author view is enabled', () => {
    const hiddenSource = createEvent({
      id: 'event-hidden-source',
      title: 'A covert patrol moves',
      summary: 'The patrol takes the north road.',
      visibility: 'playerUnknown',
      cause: { reason: 'A secret order moved the patrol.' },
    });
    const event = createEvent({
      id: 'event-visible',
      title: 'The watch changes',
      summary: 'A new guard takes the visible post.',
      cause: {
        reason: 'The covert patrol forced a rotation.',
        sourceEventIds: [hiddenSource.id],
        triggerId: 'schedule-hidden',
        pressureId: 'pressure-hidden',
        agendaId: 'agenda-hidden',
      },
    });
    const scheduledEvent = createScheduledEvent({
      id: 'schedule-hidden',
      template: {
        kind: 'npcActed',
        origin: 'npc',
        title: 'A hidden schedule fires',
        summary: 'Hidden schedule summary.',
        visibility: 'playerUnknown',
      },
      occurredEventIds: [event.id],
    });
    const pressure = createPressure({
      id: 'pressure-hidden',
      causeRefs: [event.id],
      visibility: 'playerUnknown',
    });
    const agenda = createAgenda({
      id: 'agenda-hidden',
      updatedAtTurnId: event.turnId,
      visibility: 'playerUnknown',
    });
    const momentum = { pressures: [pressure], agendas: [agenda] };
    const artifact = createArtifact({
      branchSnapshotVersion: 1,
      eventIds: [event.id, hiddenSource.id],
      worldClock: event.worldClock,
      dueScheduledEventIds: [scheduledEvent.id],
      scheduledEventIds: [scheduledEvent.id],
      scheduledEventSnapshots: [scheduledEvent],
      playLocalStateSnapshot: {
        'guard.shift': 'night',
        worldMomentum: momentum,
      },
      playLocalStateVisibilitySnapshot: {
        'guard.shift': 'playerUnknown',
        worldMomentum: 'playerUnknown',
      },
      stateDelta: {
        'guard.shift': 'night',
        worldMomentum: momentum,
      },
    });

    const playerCards = buildPlayEventCardViews({
      events: [hiddenSource, event],
      artifacts: [artifact],
      scheduledEvents: [scheduledEvent],
      pressures: [pressure],
      agendas: [agenda],
      stateVisibility: { 'guard.shift': 'playerUnknown' },
      showSpoilers: false,
    });

    expect(playerCards.map((card) => card.id)).toEqual([event.id]);
    expect(playerCards[0]!.causeLabels).toEqual([]);
    expect(playerCards[0]!.stateImpacts).toEqual([]);
    expect(playerCards[0]!.technicalRefs).toEqual([]);
    expect(playerCards[0]!.authorReason).toBeUndefined();

    const authorCards = buildPlayEventCardViews({
      events: [hiddenSource, event],
      artifacts: [artifact],
      scheduledEvents: [scheduledEvent],
      pressures: [pressure],
      agendas: [agenda],
      stateVisibility: { 'guard.shift': 'playerUnknown' },
      showSpoilers: true,
    });
    const authorCard = authorCards.find((card) => card.id === event.id)!;

    expect(authorCards.map((card) => card.id)).toContain(hiddenSource.id);
    expect(authorCard.causeLabels.map((cause) => cause.kind)).toEqual([
      'trigger',
      'sourceEvent',
      'pressure',
      'agenda',
    ]);
    expect(authorCard.stateImpacts).toEqual([
      { path: 'guard.shift', value: 'night' },
      { path: 'worldMomentum', value: 'Pressure / agenda state updated' },
    ]);
    expect(authorCard.technicalRefs.map((reference) => reference.value)).toContain(
      hiddenSource.id,
    );
    expect(authorCard.authorReason).toBe('The covert patrol forced a rotation.');
  });

  it('fails closed when legacy artifacts do not carry at-turn evidence', () => {
    const event = createEvent({
      id: 'event-legacy',
      cause: {
        reason: 'Author-only legacy explanation.',
        triggerId: 'schedule-lockdown',
        pressureId: 'pressure-lockdown',
        agendaId: 'agenda-guard',
      },
    });
    const artifact = createArtifact({
      eventIds: [event.id],
      dueScheduledEventIds: ['schedule-lockdown'],
      stateDelta: { 'secret.route': 'north tunnel' },
    });

    const card = buildPlayEventCardViews({
      events: [event],
      artifacts: [artifact],
      scheduledEvents: [createScheduledEvent({ occurredEventIds: [event.id] })],
      pressures: [createPressure({ causeRefs: [event.id] })],
      agendas: [createAgenda({ updatedAtTurnId: event.turnId })],
      stateVisibility: { 'secret.route': 'playerVisible' },
      showSpoilers: false,
    })[0]!;

    expect(card.causeLabels).toEqual([]);
    expect(card.stateImpacts).toEqual([]);
    expect(card.technicalRefs).toEqual([]);
    expect(card.authorReason).toBeUndefined();
  });

  it('uses a safe flag trigger label and gates its raw condition as an Author detail', () => {
    const event = createEvent({
      id: 'event-flag',
      cause: { reason: 'The private flag matched.', triggerId: 'schedule-flag' },
    });
    const scheduledEvent = createScheduledEvent({
      id: 'schedule-flag',
      label: 'A guarded condition fires',
      trigger: { type: 'flagEquals', path: 'secret.commandCode', value: 47 },
      occurredEventIds: [event.id],
    });
    const artifact = createArtifact({
      eventIds: [event.id],
      dueScheduledEventIds: [scheduledEvent.id],
      scheduledEventIds: [scheduledEvent.id],
      scheduledEventSnapshots: [scheduledEvent],
    });

    const playerCard = buildPlayEventCardViews({
      events: [event],
      artifacts: [artifact],
      showSpoilers: false,
    })[0]!;
    expect(playerCard.causeLabels[0]!.label).toContain('tracked world condition matched');
    expect(playerCard.causeLabels[0]!.label).not.toContain('secret.commandCode');
    expect(playerCard.causeLabels[0]!.label).not.toContain('47');
    expect(playerCard.technicalRefs).toEqual([]);

    const authorCard = buildPlayEventCardViews({
      events: [event],
      artifacts: [artifact],
      showSpoilers: true,
    })[0]!;
    expect(authorCard.causeLabels[0]!.label).toContain('tracked world condition matched');
    expect(authorCard.technicalRefs).toContainEqual({
      label: 'Trigger condition',
      value: 'secret.commandCode = 47',
    });
  });
});

function createEvent(overrides: Partial<PlayWorldEvent> = {}): PlayWorldEvent {
  return {
    id: 'event-1',
    turnId: 'turn-2-referee',
    sequence: 1,
    kind: 'environmentChanged',
    origin: 'environment',
    title: 'The weather changes',
    summary: 'Rain begins over the station.',
    visibility: 'playerVisible',
    cause: { reason: 'The front reaches the station.' },
    worldClock: { turn: 2, revision: 2 },
    createdAt: '2026-07-15T04:00:00.000Z',
    canonical: false,
    ...overrides,
  };
}

function createArtifact(overrides: Partial<PlayTurnArtifact> = {}): PlayTurnArtifact {
  return {
    schemaVersion: 3,
    artifactKind: 'worldSettlement',
    id: 'artifact-2',
    revision: 2,
    messages: [],
    eventIds: [],
    dueScheduledEventIds: [],
    scheduledEventIds: [],
    scheduledEventSnapshots: [],
    observationIds: [],
    stateDelta: {},
    suggestedActions: [],
    committedAt: '2026-07-15T04:00:02.000Z',
    canonical: false,
    ...overrides,
  };
}

function createScheduledEvent(
  overrides: Partial<PlayScheduledEvent> = {},
): PlayScheduledEvent {
  return {
    id: 'schedule-lockdown',
    label: 'Station lockdown',
    trigger: { type: 'afterTurns', turns: 2 },
    template: {
      kind: 'factionActed',
      origin: 'faction',
      title: 'The station locks down',
      summary: 'The guards close the station.',
      visibility: 'playerVisible',
    },
    status: 'occurred',
    scheduledAtTurn: 0,
    scheduledAtRevision: 0,
    ...overrides,
  };
}

function createPressure(overrides: Partial<PlayPressure> = {}): PlayPressure {
  return {
    id: 'pressure-lockdown',
    kind: 'deadline',
    label: 'Station lockdown',
    status: 'active',
    causeRefs: [],
    visibility: 'playerVisible',
    ...overrides,
  };
}

function createAgenda(overrides: Partial<PlayAgenda> = {}): PlayAgenda {
  return {
    id: 'agenda-guard',
    ownerEntityId: 'Guard captain',
    goal: 'Secure the station',
    nextMove: 'lock the east gate',
    blockers: [],
    status: 'active',
    visibility: 'playerVisible',
    updatedAtTurnId: 'turn-2-referee',
    ...overrides,
  };
}
