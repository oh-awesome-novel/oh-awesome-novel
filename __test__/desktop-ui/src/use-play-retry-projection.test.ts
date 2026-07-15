import { describe, expect, it } from 'vitest';

import type {
  PlaySession,
  PlayTurnArtifact,
} from '@oh-awesome-novel/client';
import { projectPlaySessionBeforeArtifact } from '../../../apps/desktop-ui/src/composables/usePlayRetryProjection';

describe('projectPlaySessionBeforeArtifact', () => {
  it('uses the branch-base snapshot before a root settlement', () => {
    const source = createArtifact('turn-root', undefined, {
      worldClock: { turn: 4, revision: 4 },
      playLocalStateSnapshot: { location: 'platform-after' },
      playLocalStateVisibilitySnapshot: { location: 'playerVisible' },
      suggestedActions: ['Continue'],
    });
    const session = createSession([source], {
      selectedTurnIds: ['turn-root'],
      transcript: source.messages,
      branchBaseSnapshot: {
        worldClock: { turn: 3, revision: 3, anchor: 'dawn' },
        playLocalState: { location: 'platform' },
        playLocalStateVisibility: { location: 'playerVisible' },
        scheduledEvents: [],
        suggestedActions: ['Listen'],
      },
    });

    expect(projectPlaySessionBeforeArtifact(session, 'turn-root')).toEqual({
      sourceArtifactId: 'turn-root',
      parentArtifactId: undefined,
      selectedTurnIds: [],
      transcript: [],
      playLocalState: { location: 'platform' },
      playLocalStateVisibility: { location: 'playerVisible' },
      worldClock: { turn: 3, revision: 3, anchor: 'dawn' },
      scheduledEvents: [],
      suggestedActions: ['Listen'],
    });

    session.branchBaseSnapshot.parentTurnId = 'legacy-head';
    expect(projectPlaySessionBeforeArtifact(session, 'turn-root')).toBeUndefined();
  });

  it('uses a complete parent artifact snapshot and its root-to-parent transcript', () => {
    const root = createArtifact('turn-root', undefined, {
      worldClock: { turn: 4, revision: 4 },
      playLocalStateSnapshot: {
        door: 'open',
        worldMomentum: {
          pressures: [{
            id: 'pressure-before',
            kind: 'deadline',
            label: 'Before-turn deadline',
            status: 'active',
            causeRefs: ['turn-root'],
            visibility: 'playerVisible',
          }],
          agendas: [],
        },
      },
      playLocalStateVisibilitySnapshot: {
        door: 'playerVisible',
        worldMomentum: 'playerUnknown',
      },
      suggestedActions: ['Enter'],
    });
    const source = createArtifact('turn-source', 'turn-root', {
      worldClock: { turn: 5, revision: 5 },
      playLocalStateSnapshot: { door: 'closed' },
      playLocalStateVisibilitySnapshot: { door: 'playerVisible' },
      suggestedActions: ['Wait'],
    });
    const session = createSession([root, source], {
      selectedTurnIds: ['turn-root', 'turn-source'],
      transcript: [...root.messages, ...source.messages],
    });

    expect(projectPlaySessionBeforeArtifact(session, 'turn-source')).toMatchObject({
      parentArtifactId: 'turn-root',
      selectedTurnIds: ['turn-root'],
      transcript: root.messages,
      playLocalState: {
        door: 'open',
        worldMomentum: {
          pressures: [expect.objectContaining({ id: 'pressure-before' })],
          agendas: [],
        },
      },
      playLocalStateVisibility: {
        door: 'playerVisible',
        worldMomentum: 'playerUnknown',
      },
      worldClock: { turn: 4, revision: 4 },
      suggestedActions: ['Enter'],
    });
  });

  it('falls back to the branch-base snapshot for a legacy parent head', () => {
    const legacyParent = createArtifact('legacy-head', undefined, undefined, false);
    const source = createArtifact('turn-source', 'legacy-head', {
      worldClock: { turn: 10, revision: 10 },
      playLocalStateSnapshot: { alarm: false },
      playLocalStateVisibilitySnapshot: { alarm: 'playerVisible' },
      suggestedActions: ['Run'],
    });
    const session = createSession([legacyParent, source], {
      branchBaseSnapshot: {
        parentTurnId: 'legacy-head',
        worldClock: { turn: 9, revision: 9 },
        playLocalState: { alarm: true },
        playLocalStateVisibility: { alarm: 'rumor' },
        scheduledEvents: [],
        suggestedActions: ['Hide'],
      },
    });

    expect(projectPlaySessionBeforeArtifact(session, 'turn-source')).toMatchObject({
      selectedTurnIds: ['legacy-head'],
      transcript: legacyParent.messages,
      playLocalState: { alarm: true },
      playLocalStateVisibility: { alarm: 'rumor' },
      worldClock: { turn: 9, revision: 9 },
      suggestedActions: ['Hide'],
    });

    session.branchBaseSnapshot.parentTurnId = 'another-head';
    expect(projectPlaySessionBeforeArtifact(session, 'turn-source')).toBeUndefined();
  });
});

function createArtifact(
  id: string,
  parentTurnId?: string,
  snapshot?: Pick<
    PlayTurnArtifact,
    | 'worldClock'
    | 'playLocalStateSnapshot'
    | 'playLocalStateVisibilitySnapshot'
    | 'suggestedActions'
  >,
  retryable = true,
): PlayTurnArtifact {
  return {
    schemaVersion: snapshot ? 2 : 1,
    ...(snapshot ? { artifactKind: 'worldSettlement', branchSnapshotVersion: 1 } : {}),
    id,
    revision: 1,
    parentTurnId,
    ...(retryable ? { input: { kind: 'do', raw: `Action ${id}` } } : {}),
    messages: [
      {
        id: `${id}-user`,
        speaker: 'user',
        content: `Action ${id}`,
        createdAt: '2026-07-15T00:00:00.000Z',
      },
      {
        id: `${id}-assistant`,
        speaker: 'world-referee',
        content: `Result ${id}`,
        createdAt: '2026-07-15T00:00:01.000Z',
      },
    ],
    worldClock: snapshot?.worldClock,
    eventIds: [],
    dueScheduledEventIds: [],
    scheduledEventIds: [],
    scheduledEventSnapshots: [],
    playLocalStateSnapshot: snapshot?.playLocalStateSnapshot,
    playLocalStateVisibilitySnapshot: snapshot?.playLocalStateVisibilitySnapshot,
    observationIds: [],
    stateDelta: {},
    suggestedActions: snapshot?.suggestedActions ?? [],
    committedAt: '2026-07-15T00:00:02.000Z',
    canonical: false,
  };
}

function createSession(
  turnArtifacts: PlayTurnArtifact[],
  overrides: Partial<PlaySession> = {},
): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Play',
    createdAt: '2026-07-15T00:00:00.000Z',
    revision: 10,
    sceneStart: 'Station',
    characters: [],
    transcript: [],
    turnArtifacts,
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
    worldClock: { turn: 10, revision: 10 },
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
    ...overrides,
  };
}
