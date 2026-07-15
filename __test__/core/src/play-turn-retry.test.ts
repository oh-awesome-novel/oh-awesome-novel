import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PlayWorldSettlementRetryError,
  addPlayTranscriptTurn,
  createLegacyPlayTurnArtifacts,
  createPlaySessionDraft,
  formatPlayWorldRefereePrompt,
  listPlaySessionCheckpoints,
  preparePlayWorldSettlementRetry,
  readPlaySessionFiles,
  settlePlayWorldRefereeResponse,
  settlePlayWorldSettlementRetry,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type {
  PlaySession,
  PlayWorldSettlementRetryErrorCode,
} from '@oh-awesome-novel/core';

const refereeResponse = (input: {
  narrative: string;
  eventTitle: string;
  state: string;
  suggestion: string;
  elapsed?: string;
  scheduledEventChanges?: unknown[];
}): string => [
  input.narrative,
  '```oan-play-settlement',
  JSON.stringify({
    ...(input.elapsed ? { elapsed: input.elapsed } : {}),
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

const createTwoTurnSession = (): PlaySession => {
  const draft = createPlaySessionDraft({
    id: 'play-atomic-retry',
    title: 'Atomic retry',
    createdAt: '2026-07-15T00:00:00.000Z',
    sceneStart: 'A silent station',
    characters: ['traveller'],
  });
  const first = settlePlayWorldRefereeResponse({
    session: draft,
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
        reason: 'The timetable remains active.',
      }],
    }),
  });

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
        scheduledEventId: first.scheduledEvents[0]!.id,
        reason: 'The scene moved away from the station.',
      }],
    }),
  });
};

describe('Play world-settlement retry', () => {
  it('prepares the current settlement from its exact before-turn projection', () => {
    const session = createTwoTurnSession();
    const source = session.turnArtifacts.at(-1)!;
    const preparation = preparePlayWorldSettlementRetry(session, source.id);

    expect(preparation).toMatchObject({
      sourceArtifactId: source.id,
      sourceRevision: 2,
      expectedSessionRevision: 2,
      parentArtifactId: session.turnArtifacts[0]!.id,
      userText: 'Leave the platform.',
      actionKind: 'move',
    });
    expect(preparation.beforeTurnSession).toMatchObject({
      revision: 2,
      selectedTurnIds: [session.turnArtifacts[0]!.id],
      worldClock: { turn: 1, revision: 2 },
      playLocalState: { scene: 'gate' },
      suggestedActions: ['Inspect the signal'],
    });
    expect(preparation.beforeTurnSession.scheduledEvents[0]).toMatchObject({
      label: 'Late train',
      status: 'scheduled',
    });
    expect(preparation.beforeTurnSession.turnArtifacts).toHaveLength(2);
    expect(preparation.beforeTurnSession.events).toHaveLength(2);
    expect(formatPlayWorldRefereePrompt(preparation.beforeTurnSession))
      .not.toContain('The platform falls behind.');
    expect(formatPlayWorldRefereePrompt(preparation.beforeTurnSession))
      .not.toContain('Platform left behind');
  });

  it('replays the source typed time advance instead of reinterpreting wait text', () => {
    const draft = createPlaySessionDraft({
      id: 'play-retry-typed-wait',
      title: 'Retry typed wait',
      createdAt: '2026-07-15T00:00:00.000Z',
      sceneStart: 'A station clock',
      characters: [],
    });
    const source = settlePlayWorldRefereeResponse({
      session: draft,
      userText: 'Wait until the station quiets down.',
      actionKind: 'wait',
      timeAdvance: { amount: 2, unit: 'hour' },
      createdAt: '2026-07-15T02:00:00.000Z',
      refereeResponse: refereeResponse({
        narrative: 'Two hours pass and the station quiets.',
        eventTitle: 'Station quieted',
        state: 'quiet',
        suggestion: 'Check the timetable',
        elapsed: 'PT2H',
      }),
    });
    const snapshot = structuredClone(source);
    const sourceArtifactId = source.turnArtifacts[0]!.id;
    const preparation = preparePlayWorldSettlementRetry(
      source,
      sourceArtifactId,
    );

    expect(preparation).toMatchObject({
      sourceArtifactId,
      userText: 'Wait until the station quiets down.',
      actionKind: 'wait',
      timeAdvance: { amount: 2, unit: 'hour' },
    });
    expect(() => settlePlayWorldSettlementRetry({
      session: source,
      sourceArtifactId,
      expectedSessionRevision: 1,
      refereeResponse: refereeResponse({
        narrative: 'Only one hour passes.',
        eventTitle: 'Clock drifted',
        state: 'drifted',
        suggestion: 'Recheck the clock',
        elapsed: 'PT1H',
      }),
    })).toThrow('requires settlement.elapsed PT2H');
    expect(source).toEqual(snapshot);

    const retried = settlePlayWorldSettlementRetry({
      session: source,
      sourceArtifactId,
      expectedSessionRevision: 1,
      createdAt: '2026-07-15T02:01:00.000Z',
      refereeResponse: refereeResponse({
        narrative: 'Two hours pass, but a maintenance light remains on.',
        eventTitle: 'Maintenance light remained',
        state: 'maintenance',
        suggestion: 'Inspect the light',
        elapsed: 'PT2H',
      }),
    });

    expect(retried.session).toMatchObject({
      revision: 2,
      worldClock: { turn: 1, revision: 2, elapsed: 'PT2H' },
      selectedTurnIds: ['turn-artifact-2'],
    });
    expect(retried.session.turnArtifacts.at(-1)).toMatchObject({
      input: {
        kind: 'wait',
        raw: 'Wait until the station quiets down.',
        timeAdvance: { amount: 2, unit: 'hour' },
      },
      worldClock: { elapsed: 'PT2H' },
    });
    expect(source).toEqual(snapshot);
  });

  it('settles a current retry once as a sibling while retaining every ledger', () => {
    const session = createTwoTurnSession();
    const snapshot = structuredClone(session);
    const firstArtifactId = session.turnArtifacts[0]!.id;
    const sourceArtifactId = session.turnArtifacts[1]!.id;
    const result = settlePlayWorldSettlementRetry({
      session,
      sourceArtifactId,
      expectedSessionRevision: session.revision,
      createdAt: '2026-07-15T00:03:00.000Z',
      refereeResponse: refereeResponse({
        narrative: 'A maintenance code flashes twice.',
        eventTitle: 'Signal code appeared',
        state: 'signal',
        suggestion: 'Record the code',
      }),
    });

    expect(session).toEqual(snapshot);
    expect(result).toMatchObject({
      sourceArtifactId,
      retryArtifactId: 'turn-artifact-3',
      parentArtifactId: firstArtifactId,
    });
    expect(result.session).toMatchObject({
      revision: 3,
      selectedTurnIds: [firstArtifactId, 'turn-artifact-3'],
      worldClock: { turn: 2, revision: 3 },
      playLocalState: { scene: 'signal' },
      suggestedActions: ['Record the code'],
    });
    expect(result.session.turnArtifacts).toHaveLength(3);
    expect(result.session.events).toHaveLength(3);
    expect(result.session.observations).toHaveLength(3);
    expect(result.session.turnArtifacts.map((artifact) => artifact.id))
      .toContain(sourceArtifactId);
    expect(result.session.turnArtifacts.at(-1)).toMatchObject({
      parentTurnId: firstArtifactId,
      input: { raw: 'Leave the platform.', kind: 'move' },
    });
    expect(result.session.scheduledEvents[0]).toMatchObject({
      label: 'Late train',
      status: 'scheduled',
    });
    expect(result.session.transcript.map((turn) => turn.content))
      .not.toContain('The platform falls behind.');
    expect(listPlaySessionCheckpoints(result.session)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: sourceArtifactId,
          status: 'variant',
          retryable: true,
        }),
        expect.objectContaining({
          artifactId: 'turn-artifact-3',
          status: 'current',
          restorable: false,
          retryable: true,
        }),
      ]),
    );
  });

  it('retries selected ancestors and non-selected variants from their own parent', () => {
    const twoTurns = createTwoTurnSession();
    const third = settlePlayWorldRefereeResponse({
      session: twoTurns,
      userText: 'Enter the alley.',
      actionKind: 'move',
      createdAt: '2026-07-15T00:03:00.000Z',
      refereeResponse: refereeResponse({
        narrative: 'The alley narrows.',
        eventTitle: 'Alley entered',
        state: 'alley',
        suggestion: 'Check the doorway',
      }),
    });
    const firstArtifactId = third.turnArtifacts[0]!.id;
    const ancestorArtifactId = third.turnArtifacts[1]!.id;
    const ancestorRetry = settlePlayWorldSettlementRetry({
      session: third,
      sourceArtifactId: ancestorArtifactId,
      expectedSessionRevision: 3,
      refereeResponse: refereeResponse({
        narrative: 'The traveller remains beside the signal.',
        eventTitle: 'Traveller stayed',
        state: 'signal',
        suggestion: 'Decode the flashes',
      }),
    });

    expect(ancestorRetry.session.selectedTurnIds).toEqual([
      firstArtifactId,
      'turn-artifact-4',
    ]);
    expect(ancestorRetry.session.turnArtifacts).toHaveLength(4);
    expect(ancestorRetry.session.turnArtifacts.map((artifact) => artifact.id))
      .toEqual(expect.arrayContaining([ancestorArtifactId, 'turn-artifact-3']));

    const variantRetry = settlePlayWorldSettlementRetry({
      session: ancestorRetry.session,
      sourceArtifactId: ancestorArtifactId,
      expectedSessionRevision: 4,
      refereeResponse: refereeResponse({
        narrative: 'A side door opens onto the platform.',
        eventTitle: 'Side door opened',
        state: 'door',
        suggestion: 'Enter the service hall',
      }),
    });

    expect(variantRetry.session).toMatchObject({
      revision: 5,
      selectedTurnIds: [firstArtifactId, 'turn-artifact-5'],
    });
    expect(variantRetry.session.turnArtifacts).toHaveLength(5);
    expect(variantRetry.session.turnArtifacts.at(-1)).toMatchObject({
      parentTurnId: firstArtifactId,
      input: { raw: 'Leave the platform.', kind: 'move' },
    });
  });

  it('recomputes hard-due events from the before-turn snapshot and leaves no partial retry', () => {
    const base = createPlaySessionDraft({
      id: 'play-retry-hard-due',
      title: 'Retry hard due',
      sceneStart: 'Station',
      characters: [],
      scheduledEvents: [{
        id: 'due-alarm',
        label: 'Alarm',
        trigger: { type: 'nextTurn' },
        template: {
          kind: 'environmentChanged',
          origin: 'environment',
          title: 'Alarm rings',
          summary: 'The alarm starts on schedule.',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
    });
    const dueEvent = {
      kind: 'environmentChanged',
      origin: 'environment',
      title: 'Alarm rings',
      summary: 'The alarm starts on schedule.',
      visibility: 'playerVisible',
      cause: { reason: 'The deadline arrived.', triggerId: 'due-alarm' },
    };
    const source = settlePlayWorldRefereeResponse({
      session: base,
      userText: 'Wait.',
      actionKind: 'wait',
      refereeResponse: [
        'The alarm sounds.',
        '```oan-play-settlement',
        JSON.stringify({ events: [dueEvent] }),
        '```',
      ].join('\n'),
    });
    const snapshot = structuredClone(source);

    expect(() => settlePlayWorldSettlementRetry({
      session: source,
      sourceArtifactId: source.turnArtifacts[0]!.id,
      expectedSessionRevision: 1,
      refereeResponse: [
        'Nothing happens.',
        '```oan-play-settlement',
        JSON.stringify({ events: [] }),
        '```',
      ].join('\n'),
    })).toThrow('omitted hard-due event: due-alarm');
    expect(source).toEqual(snapshot);
  });

  it('retries the first turn as a second complete root and survives persistence', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-root-retry-'));
    try {
      const base = createPlaySessionDraft({
        id: 'play-root-retry',
        title: 'Root retry',
        sceneStart: 'An empty hall',
        characters: [],
      });
      const original = settlePlayWorldRefereeResponse({
        session: base,
        userText: 'Open the door.',
        actionKind: 'do',
        createdAt: '2026-07-15T01:00:00.000Z',
        refereeResponse: refereeResponse({
          narrative: 'The door opens onto a courtyard.',
          eventTitle: 'Door opened',
          state: 'courtyard',
          suggestion: 'Step outside',
        }),
      });
      const sourceArtifactId = original.turnArtifacts[0]!.id;
      const result = settlePlayWorldSettlementRetry({
        session: original,
        sourceArtifactId,
        expectedSessionRevision: 1,
        createdAt: '2026-07-15T01:01:00.000Z',
        refereeResponse: refereeResponse({
          narrative: 'The lock catches and the door stays shut.',
          eventTitle: 'Lock caught',
          state: 'hall',
          suggestion: 'Inspect the lock',
        }),
      });

      expect(result.session).toMatchObject({
        revision: 2,
        selectedTurnIds: ['turn-artifact-2'],
        worldClock: { turn: 1, revision: 2 },
        playLocalState: { scene: 'hall' },
      });
      expect(result.session.turnArtifacts).toHaveLength(2);
      expect(result.session.turnArtifacts.every((artifact) =>
        artifact.parentTurnId === undefined && artifact.schemaVersion === 2))
        .toBe(true);
      expect(listPlaySessionCheckpoints(result.session)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactId: sourceArtifactId,
            status: 'variant',
            retryable: true,
          }),
          expect.objectContaining({
            artifactId: 'turn-artifact-2',
            status: 'current',
            retryable: true,
          }),
        ]),
      );

      await writePlaySessionFiles(workspaceRoot, result.session);
      const reread = await readPlaySessionFiles(workspaceRoot, base.id);
      expect(reread).toMatchObject({
        revision: 2,
        selectedTurnIds: ['turn-artifact-2'],
        playLocalState: { scene: 'hall' },
      });
      expect(reread.turnArtifacts).toHaveLength(2);
      expect(preparePlayWorldSettlementRetry(
        reread,
        sourceArtifactId,
      ).beforeTurnSession.selectedTurnIds).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects forest roots that do not share a provable complete v2 base', () => {
    const original = settlePlayWorldRefereeResponse({
      session: createPlaySessionDraft({
        id: 'play-invalid-forest',
        title: 'Invalid forest',
        sceneStart: 'A room',
        characters: [],
      }),
      userText: 'Wait.',
      actionKind: 'wait',
      refereeResponse: refereeResponse({
        narrative: 'Dust settles.',
        eventTitle: 'Dust settled',
        state: 'room',
        suggestion: 'Listen',
      }),
    });
    const retried = settlePlayWorldSettlementRetry({
      session: original,
      sourceArtifactId: original.turnArtifacts[0]!.id,
      expectedSessionRevision: 1,
      refereeResponse: refereeResponse({
        narrative: 'A floorboard creaks.',
        eventTitle: 'Floorboard creaked',
        state: 'room',
        suggestion: 'Check the floor',
      }),
    }).session;
    const invalidLegacyRoot = structuredClone(retried);
    invalidLegacyRoot.turnArtifacts.push({
      schemaVersion: 1,
      id: 'legacy-extra-root',
      revision: 0,
      messages: [{
        id: 'legacy-extra-message',
        speaker: 'narrator',
        content: 'Unverified legacy root.',
        createdAt: '2026-07-15T00:00:00.000Z',
      }],
      eventIds: [],
      dueScheduledEventIds: [],
      scheduledEventIds: [],
      scheduledEventSnapshots: [],
      observationIds: [],
      stateDelta: {},
      suggestedActions: [],
      committedAt: '2026-07-15T00:00:00.000Z',
      canonical: false,
    });
    expect(() => preparePlayWorldSettlementRetry(
      invalidLegacyRoot,
      original.turnArtifacts[0]!.id,
    )).toThrow('forest roots must be complete v2 snapshots');

    const mismatchedBase = structuredClone(retried);
    mismatchedBase.branchBaseSnapshot.parentTurnId = 'turn-artifact-1';
    expect(() => preparePlayWorldSettlementRetry(
      mismatchedBase,
      original.turnArtifacts[0]!.id,
    )).toThrow('forest roots must be complete v2 snapshots');
  });

  it('rejects unsafe, unknown, transcript-append, legacy, and stale retry targets', () => {
    const session = createTwoTurnSession();
    expectRetryError(
      () => preparePlayWorldSettlementRetry(session, '../unsafe'),
      'invalidArtifactId',
    );
    expectRetryError(
      () => preparePlayWorldSettlementRetry(session, 'missing-artifact'),
      'artifactNotFound',
    );

    const appendSession = addPlayTranscriptTurn(
      createPlaySessionDraft({
        id: 'play-append-not-retryable',
        title: 'Append is not retryable',
        sceneStart: 'A room',
        characters: [],
      }),
      {
        speaker: 'narrator',
        content: 'A manual note.',
        createdAt: '2026-07-15T02:00:00.000Z',
      },
    );
    expectRetryError(
      () => preparePlayWorldSettlementRetry(
        appendSession,
        appendSession.turnArtifacts[0]!.id,
      ),
      'artifactNotRetryable',
    );
    expect(listPlaySessionCheckpoints(appendSession)[0]).toMatchObject({
      retryable: false,
    });

    const legacyArtifacts = createLegacyPlayTurnArtifacts({
      transcript: [{
        id: 'turn-0-user',
        speaker: 'user',
        content: 'Legacy turn.',
        createdAt: '2026-07-14T23:59:00.000Z',
      }],
    });
    const legacyDraft = createPlaySessionDraft({
      id: 'play-legacy-not-retryable',
      title: 'Legacy is not retryable',
      sceneStart: 'Legacy scene',
      characters: [],
    });
    const legacySession: PlaySession = {
      ...legacyDraft,
      transcript: legacyArtifacts.flatMap((artifact) => artifact.messages),
      turnArtifacts: legacyArtifacts,
      selectedTurnIds: legacyArtifacts.map((artifact) => artifact.id),
      branchBaseSnapshot: {
        parentTurnId: legacyArtifacts[0]!.id,
        worldClock: { turn: 0, revision: 0 },
        playLocalState: {},
        playLocalStateVisibility: {},
        scheduledEvents: [],
        suggestedActions: [],
      },
    };
    expectRetryError(
      () => preparePlayWorldSettlementRetry(
        legacySession,
        legacyArtifacts[0]!.id,
      ),
      'artifactNotRetryable',
    );

    expectRetryError(
      () => settlePlayWorldSettlementRetry({
        session,
        sourceArtifactId: session.turnArtifacts[1]!.id,
        expectedSessionRevision: -1,
        refereeResponse: 'unused',
      }),
      'invalidRevision',
    );
    expectRetryError(
      () => settlePlayWorldSettlementRetry({
        session,
        sourceArtifactId: session.turnArtifacts[1]!.id,
        expectedSessionRevision: 1,
        refereeResponse: 'unused',
      }),
      'revisionConflict',
    );
  });
});

function expectRetryError(
  run: () => unknown,
  code: PlayWorldSettlementRetryErrorCode,
): void {
  try {
    run();
    throw new Error('Expected Play retry to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(PlayWorldSettlementRetryError);
    expect(error).toMatchObject({ code });
  }
}
