import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addPlayTranscriptTurn,
  createLegacyPlayTurnArtifacts,
  createPlaySessionDraft,
  listPlaySessionCheckpoints,
  readPlaySessionFiles,
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
  it('lists only safe implicit checkpoints with branch-relative status', () => {
    const session = createTwoTurnBranch();
    const checkpoints = listPlaySessionCheckpoints(session);

    expect(checkpoints).toEqual([
      expect.objectContaining({
        artifactId: 'turn-artifact-1',
        selectedTurnIds: ['turn-artifact-1'],
        revision: 1,
        worldTurn: 1,
        preview: 'Wait by the gate.',
        status: 'selectedAncestor',
        restorable: true,
        canonical: false,
      }),
      expect.objectContaining({
        artifactId: 'turn-artifact-2',
        parentArtifactId: 'turn-artifact-1',
        selectedTurnIds: ['turn-artifact-1', 'turn-artifact-2'],
        revision: 2,
        worldTurn: 2,
        preview: 'Leave the platform.',
        status: 'current',
        restorable: false,
        canonical: false,
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

    const [checkpoint] = listPlaySessionCheckpoints(session);
    expect(checkpoint?.preview).toBe('Wait quietly.');
    expect(checkpoint?.preview).not.toContain('watcher');
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
          restorable: true,
        }),
      ]),
    );
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
