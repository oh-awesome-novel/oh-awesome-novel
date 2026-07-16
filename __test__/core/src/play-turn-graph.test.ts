import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLAY_CHECKPOINT_NAMES_METADATA_KEY,
  PLAY_INITIAL_WORLD_CHECKPOINT_ID,
  addPlayTranscriptTurn,
  createLegacyPlayTurnArtifacts,
  createPlaySessionDraft,
  listPlaySessionCheckpoints,
  readPlaySessionFiles,
  renamePlaySessionCheckpoint,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeResponse,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';

const refereeResponse = (input: {
  narrative: string;
  eventTitle: string;
  state: string;
  suggestion: string;
  scheduledEventChanges?: unknown[];
}): string => [
  input.narrative,
  '```oan-play-settlement',
  JSON.stringify({
    events: [{
      kind: 'environmentChanged',
      origin: 'environment',
      title: input.eventTitle,
      summary: input.eventTitle,
      visibility: 'playerVisible',
      cause: { reason: `Cause for ${input.eventTitle}` },
    }],
    stateDelta: { scene: input.state },
    observations: [{
      summary: input.eventTitle,
      evidence: input.narrative,
    }],
    suggestedActions: [input.suggestion],
    scheduledEventChanges: input.scheduledEventChanges ?? [],
  }),
  '```',
].join('\n');

const createTwoTurnBranch = (): PlaySession => {
  const session = createPlaySessionDraft({
    id: 'play-checkpoint-graph',
    title: 'Checkpoint graph',
    createdAt: '2026-07-15T00:00:00.000Z',
    sceneStart: 'A silent station',
    characters: ['traveller'],
  });
  const first = settlePlayWorldRefereeResponse({
    session,
    userText: 'Wait by the gate.',
    actionKind: 'wait',
    createdAt: '2026-07-15T00:01:00.000Z',
    refereeResponse: refereeResponse({
      narrative: 'The gate light turns blue.',
      eventTitle: 'Gate light changed',
      state: 'gate',
      suggestion: 'Inspect the signal',
      scheduledEventChanges: [{
        type: 'schedule',
        label: 'Late train',
        trigger: { type: 'afterTurns', turns: 5 },
        template: {
          kind: 'arrival',
          origin: 'clock',
          title: 'Late train arrives',
          summary: 'The delayed train reaches the station.',
          visibility: 'playerVisible',
        },
        reason: 'The timetable is still active.',
      }],
    }),
  });
  const scheduledEventId = first.scheduledEvents[0]!.id;

  return settlePlayWorldRefereeResponse({
    session: first,
    userText: 'Leave the platform.',
    actionKind: 'move',
    createdAt: '2026-07-15T00:02:00.000Z',
    refereeResponse: refereeResponse({
      narrative: 'The platform falls behind.',
      eventTitle: 'Platform left behind',
      state: 'street',
      suggestion: 'Follow the side road',
      scheduledEventChanges: [{
        type: 'cancel',
        scheduledEventId,
        reason: 'The scene moved away from the station.',
      }],
    }),
  });
};

describe('Play turn graph checkpoints', () => {
  it('exposes the virtual branch base as a real initial-world checkpoint', () => {
    const session = createPlaySessionDraft({
      id: 'play-initial-world',
      title: 'Initial world',
      createdAt: '2026-07-15T00:00:00.000Z',
      sceneStart: 'A silent station',
      characters: [],
    });

    expect(listPlaySessionCheckpoints(session)).toEqual([{
      checkpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
      kind: 'initialWorld',
      selectedTurnIds: [],
      depth: 0,
      revision: 0,
      worldTurn: 0,
      committedAt: '2026-07-15T00:00:00.000Z',
      preview: 'Initial world',
      status: 'current',
      restorable: false,
      retryable: false,
      canonical: false,
    }]);
  });

  it('lists only safe implicit checkpoints with branch-relative status', () => {
    const session = createTwoTurnBranch();
    const checkpoints = listPlaySessionCheckpoints(session);

    expect(checkpoints).toEqual([
      expect.objectContaining({
        checkpointId: 'turn-artifact-1',
        kind: 'turn',
        artifactId: 'turn-artifact-1',
        parentCheckpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
        selectedTurnIds: ['turn-artifact-1'],
        depth: 1,
        revision: 1,
        worldTurn: 1,
        preview: 'Wait by the gate.',
        status: 'selectedAncestor',
        restorable: true,
        canonical: false,
      }),
      expect.objectContaining({
        checkpointId: 'turn-artifact-2',
        kind: 'turn',
        artifactId: 'turn-artifact-2',
        parentCheckpointId: 'turn-artifact-1',
        selectedTurnIds: ['turn-artifact-1', 'turn-artifact-2'],
        depth: 2,
        revision: 2,
        worldTurn: 2,
        preview: 'Leave the platform.',
        status: 'current',
        restorable: false,
        canonical: false,
      }),
      expect.objectContaining({
        checkpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
        kind: 'initialWorld',
        selectedTurnIds: [],
        depth: 0,
        status: 'selectedAncestor',
        restorable: true,
      }),
    ]);
  });

  it('never uses referee or hidden narrative as a checkpoint preview', () => {
    const session = settlePlayWorldRefereeResponse({
      session: createPlaySessionDraft({
        id: 'play-hidden-checkpoint-preview',
        title: 'Hidden checkpoint preview',
        sceneStart: 'A quiet room',
        characters: [],
      }),
      userText: 'Wait quietly.',
      actionKind: 'wait',
      refereeResponse: [
        'A hidden watcher enters the attic.',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'arrival',
            origin: 'npc',
            title: 'Watcher arrived',
            summary: 'The watcher is now overhead.',
            visibility: 'playerUnknown',
            cause: { reason: 'An offscreen plan advanced.' },
          }],
          stateDelta: { watcherLocation: 'attic' },
          observations: [],
          suggestedActions: [],
          scheduledEventChanges: [],
        }),
        '```',
      ].join('\n'),
    });

    const checkpoint = listPlaySessionCheckpoints(session).find(
      (candidate) => candidate.kind === 'turn',
    );
    expect(checkpoint?.preview).toBe('Wait quietly.');
    expect(checkpoint?.preview).not.toContain('watcher');
  });

  it('uses a nontechnical world-turn preview when a checkpoint has no input', () => {
    const session = addPlayTranscriptTurn(createTwoTurnBranch(), {
      speaker: 'narrator',
      content: 'The platform clock continues ticking.',
      createdAt: '2026-07-15T00:03:00.000Z',
    });
    const noInputArtifact = session.turnArtifacts.at(-1)!;
    const checkpoint = listPlaySessionCheckpoints(session).find(
      (candidate) => candidate.checkpointId === noInputArtifact.id,
    );

    expect(checkpoint?.preview).toBe('World turn 2');
    expect(checkpoint?.preview).not.toContain(noInputArtifact.id);
  });

  it('restores the initial world and creates a new root without deleting old roots', () => {
    const original = createTwoTurnBranch();
    const restored = restorePlaySessionCheckpoint(
      original,
      PLAY_INITIAL_WORLD_CHECKPOINT_ID,
    );

    expect(restored).toMatchObject({
      revision: 3,
      selectedTurnIds: [],
      transcript: [],
      playLocalState: {},
      playLocalStateVisibility: {},
      worldClock: { turn: 0, revision: 3 },
      scheduledEvents: [],
      suggestedActions: [],
    });
    expect(restored.turnArtifacts).toHaveLength(2);
    expect(restored.events).toHaveLength(2);
    expect(listPlaySessionCheckpoints(restored)).toEqual([
      expect.objectContaining({
        checkpointId: 'turn-artifact-1',
        status: 'variant',
        restorable: true,
      }),
      expect.objectContaining({
        checkpointId: 'turn-artifact-2',
        status: 'variant',
        restorable: true,
      }),
      expect.objectContaining({
        checkpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
        kind: 'initialWorld',
        status: 'current',
        restorable: false,
      }),
    ]);

    const newRoot = settlePlayWorldRefereeResponse({
      session: restored,
      userText: 'Take the service stairs instead.',
      actionKind: 'move',
      createdAt: '2026-07-15T00:03:00.000Z',
      refereeResponse: refereeResponse({
        narrative: 'The service stairs lead below the tracks.',
        eventTitle: 'Service stairs entered',
        state: 'stairs',
        suggestion: 'Follow the maintenance lights',
      }),
    });

    expect(newRoot.selectedTurnIds).toEqual(['turn-artifact-4']);
    expect(newRoot.turnArtifacts.at(-1)).toMatchObject({
      id: 'turn-artifact-4',
    });
    expect(newRoot.turnArtifacts.at(-1)).not.toHaveProperty('parentTurnId');
    expect(newRoot.turnArtifacts).toHaveLength(3);
    expect(listPlaySessionCheckpoints(newRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkpointId: 'turn-artifact-1',
          parentCheckpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
          status: 'variant',
        }),
        expect.objectContaining({
          checkpointId: 'turn-artifact-4',
          parentCheckpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
          status: 'current',
        }),
      ]),
    );
  });

  it('stores validated checkpoint names as metadata annotations and round-trips them', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-checkpoint-name-'));
    try {
      const original = createTwoTurnBranch();
      const snapshot = structuredClone(original);
      const namedInitial = renamePlaySessionCheckpoint(
        original,
        PLAY_INITIAL_WORLD_CHECKPOINT_ID,
        '  Before the station changed  ',
      );
      const namedTurn = renamePlaySessionCheckpoint(
        namedInitial,
        'turn-artifact-1',
        'Gate still open',
      );

      expect(original).toEqual(snapshot);
      expect(namedTurn).toMatchObject({
        revision: 4,
        worldClock: { turn: 2, revision: 4 },
        metadataExtensions: {
          [PLAY_CHECKPOINT_NAMES_METADATA_KEY]: {
            [PLAY_INITIAL_WORLD_CHECKPOINT_ID]: 'Before the station changed',
            'turn-artifact-1': 'Gate still open',
          },
        },
      });
      expect(listPlaySessionCheckpoints(namedTurn)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            checkpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
            name: 'Before the station changed',
          }),
          expect.objectContaining({
            checkpointId: 'turn-artifact-1',
            name: 'Gate still open',
          }),
        ]),
      );

      await writePlaySessionFiles(workspaceRoot, namedTurn);
      const reread = await readPlaySessionFiles(workspaceRoot, namedTurn.id);
      expect(listPlaySessionCheckpoints(reread)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            checkpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
            name: 'Before the station changed',
          }),
          expect.objectContaining({
            checkpointId: 'turn-artifact-1',
            name: 'Gate still open',
          }),
        ]),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('fails closed for unknown names, unsafe ids, and malformed name metadata', () => {
    const session = createTwoTurnBranch();
    expect(() => renamePlaySessionCheckpoint(session, 'missing-artifact', 'Missing'))
      .toThrow('references an unknown artifact');
    expect(() => renamePlaySessionCheckpoint(session, '../unsafe', 'Unsafe'))
      .toThrow('Invalid Play turn artifact id');
    expect(() => renamePlaySessionCheckpoint(session, 'turn-artifact-1', ''))
      .toThrow('must not be empty');
    expect(() => renamePlaySessionCheckpoint(
      session,
      'turn-artifact-1',
      'line\nbreak',
    )).toThrow('must not contain control characters');
    expect(() => renamePlaySessionCheckpoint(
      session,
      'turn-artifact-1',
      'x'.repeat(81),
    )).toThrow('at most 80 characters');

    const malformedContainer: PlaySession = {
      ...session,
      metadataExtensions: {
        [PLAY_CHECKPOINT_NAMES_METADATA_KEY]: [],
      },
    };
    expect(() => listPlaySessionCheckpoints(malformedContainer))
      .toThrow('names metadata must be an object');

    const unknownTarget: PlaySession = {
      ...session,
      metadataExtensions: {
        [PLAY_CHECKPOINT_NAMES_METADATA_KEY]: {
          'missing-artifact': 'Unknown',
        },
      },
    };
    expect(() => listPlaySessionCheckpoints(unknownTarget))
      .toThrow('references an unknown artifact');

    const nonNormalized: PlaySession = {
      ...session,
      metadataExtensions: {
        [PLAY_CHECKPOINT_NAMES_METADATA_KEY]: {
          'turn-artifact-1': ' Padded ',
        },
      },
    };
    expect(() => restorePlaySessionCheckpoint(nonNormalized, 'turn-artifact-1'))
      .toThrow('name metadata is not normalized');
  });

  it('restores every selected projection, keeps ledgers, and persists the result', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-checkpoint-'));
    try {
      const session = createTwoTurnBranch();
      const firstArtifact = session.turnArtifacts[0]!;
      const restored = restorePlaySessionCheckpoint(session, firstArtifact.id);

      expect(restored).toMatchObject({
        revision: 3,
        selectedTurnIds: [firstArtifact.id],
        worldClock: { turn: 1, revision: 3 },
        playLocalState: { scene: 'gate' },
        suggestedActions: ['Inspect the signal'],
      });
      expect(restored.transcript.map((turn) => turn.content)).toEqual([
        'Wait by the gate.',
        'The gate light turns blue.',
      ]);
      expect(restored.playLocalStateVisibility).toEqual({
        scene: 'playerVisible',
      });
      expect(restored.scheduledEvents).toEqual([
        expect.objectContaining({ status: 'scheduled', label: 'Late train' }),
      ]);
      expect(restored.turnArtifacts).toHaveLength(2);
      expect(restored.events).toHaveLength(2);
      expect(restored.observations).toHaveLength(2);

      await writePlaySessionFiles(workspaceRoot, restored);
      const reread = await readPlaySessionFiles(workspaceRoot, session.id);
      expect(reread).toMatchObject({
        revision: 3,
        selectedTurnIds: [firstArtifact.id],
        worldClock: { turn: 1, revision: 3 },
        playLocalState: { scene: 'gate' },
      });
      expect(reread.turnArtifacts).toHaveLength(2);
      expect(reread.events).toHaveLength(2);
      expect(reread.scheduledEvents[0]).toMatchObject({ status: 'scheduled' });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('creates a sibling settlement from a restored checkpoint without deleting the old branch', () => {
    const original = createTwoTurnBranch();
    const firstArtifactId = original.turnArtifacts[0]!.id;
    const oldHeadId = original.turnArtifacts[1]!.id;
    const restored = restorePlaySessionCheckpoint(original, firstArtifactId);
    const variant = settlePlayWorldRefereeResponse({
      session: restored,
      userText: 'Stay and inspect the signal.',
      actionKind: 'look',
      createdAt: '2026-07-15T00:03:00.000Z',
      refereeResponse: refereeResponse({
        narrative: 'A maintenance code flashes twice.',
        eventTitle: 'Signal code appeared',
        state: 'signal',
        suggestion: 'Record the code',
      }),
    });

    expect(variant.revision).toBe(4);
    expect(variant.turnArtifacts).toHaveLength(3);
    expect(variant.turnArtifacts.map((artifact) => artifact.id)).toContain(oldHeadId);
    expect(variant.turnArtifacts.at(-1)).toMatchObject({
      id: 'turn-artifact-4',
      parentTurnId: firstArtifactId,
    });
    expect(variant.selectedTurnIds).toEqual([
      firstArtifactId,
      'turn-artifact-4',
    ]);
    expect(variant.transcript.map((turn) => turn.content)).not.toContain(
      'The platform falls behind.',
    );
    expect(listPlaySessionCheckpoints(variant)).toContainEqual(
      expect.objectContaining({
        artifactId: oldHeadId,
        status: 'variant',
        restorable: true,
      }),
    );
  });

  it('rejects current, unknown, unsafe, and snapshot-less checkpoint targets', () => {
    const session = createTwoTurnBranch();
    const emptySession = createPlaySessionDraft({
      id: 'play-current-initial',
      title: 'Current initial',
      sceneStart: 'Initial scene',
      characters: [],
    });
    expect(() => restorePlaySessionCheckpoint(
      emptySession,
      PLAY_INITIAL_WORLD_CHECKPOINT_ID,
    )).toThrow('is already current');
    expect(() => restorePlaySessionCheckpoint(
      session,
      session.selectedTurnIds.at(-1)!,
    )).toThrow('is already current');
    expect(() => restorePlaySessionCheckpoint(session, 'missing-artifact'))
      .toThrow('references an unknown artifact');
    expect(() => restorePlaySessionCheckpoint(session, '../unsafe'))
      .toThrow('Invalid Play turn artifact id');

    const legacyArtifacts = createLegacyPlayTurnArtifacts({
      transcript: [{
        id: 'turn-0-user',
        speaker: 'user',
        content: 'Legacy root.',
        createdAt: '2026-07-14T23:58:00.000Z',
      }, {
        id: 'turn-1-user',
        speaker: 'user',
        content: 'Legacy base head.',
        createdAt: '2026-07-14T23:59:00.000Z',
      }],
    });
    const draft = createPlaySessionDraft({
      id: 'play-legacy-checkpoint',
      title: 'Legacy checkpoint',
      sceneStart: 'Legacy scene',
      characters: [],
    });
    const legacySession: PlaySession = {
      ...draft,
      revision: 1,
      transcript: legacyArtifacts.flatMap((artifact) => artifact.messages),
      turnArtifacts: legacyArtifacts,
      selectedTurnIds: legacyArtifacts.map((artifact) => artifact.id),
      branchSnapshotRequiredFromRevision: 1,
      branchBaseSnapshot: {
        parentTurnId: legacyArtifacts.at(-1)!.id,
        worldClock: { turn: 0, revision: 1 },
        playLocalState: {},
        playLocalStateVisibility: {},
        scheduledEvents: [],
        suggestedActions: [],
      },
      worldClock: { turn: 0, revision: 1 },
    };
    const completeHead = addPlayTranscriptTurn(legacySession, {
      speaker: 'narrator',
      content: 'A complete v2 bridge.',
      createdAt: '2026-07-15T00:00:00.000Z',
    });

    expect(listPlaySessionCheckpoints(completeHead)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: legacyArtifacts[0]!.id,
          restorable: false,
        }),
        expect.objectContaining({
          artifactId: legacyArtifacts[1]!.id,
          checkpointId: legacyArtifacts[1]!.id,
          kind: 'turn',
          preview: 'Imported starting point',
          restorable: true,
        }),
      ]),
    );
    expect(() => restorePlaySessionCheckpoint(
      completeHead,
      PLAY_INITIAL_WORLD_CHECKPOINT_ID,
    )).toThrow('initial-world checkpoint is unavailable');
    expect(() => restorePlaySessionCheckpoint(
      completeHead,
      legacyArtifacts[0]!.id,
    )).toThrow('has no restorable branch snapshot');
    expect(restorePlaySessionCheckpoint(
      completeHead,
      legacyArtifacts[1]!.id,
    ).selectedTurnIds).toEqual(legacyArtifacts.map((artifact) => artifact.id));
  });
});
