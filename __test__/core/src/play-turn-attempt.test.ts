import { describe, expect, it } from 'vitest';

import {
  acceptPlayTurnAttemptStep,
  addPlayTurnAttemptStep,
  assertPlayTurnAttemptFinalizable,
  cancelPlayTurnAttempt,
  createCharacterPerceptionPackage,
  createPlaySceneRehearsalSessionDraft,
  createPlayTurnAttempt,
  preparePlayTurnAttemptRetry,
} from '@oh-awesome-novel/core';
import type {
  CharacterPerceptionPackage,
  CharacterStepDraft,
  CreatePlaySceneRehearsalSessionInput,
  PlayWorldRefereeSettlement,
} from '@oh-awesome-novel/core';

const emptySettlement = (
  stateDelta: Record<string, unknown> = {},
): PlayWorldRefereeSettlement => ({
  events: [],
  pressureChanges: [],
  agendaChanges: [],
  scheduledEventChanges: [],
  knowledgeChanges: [],
  stateDelta,
  observations: [],
  suggestedActions: [],
});

const createInput = (): CreatePlaySceneRehearsalSessionInput => ({
  id: 'play-attempt-fixture',
  title: 'Attempt fixture',
  sceneStart: 'A locked room.',
  characters: [],
  sceneContract: {
    sceneId: 'scene-room',
    worldClock: { turn: 0, revision: 0 },
    clockProvenance: { kind: 'newSessionInitial', sourceRefs: [] },
    participantRefs: ['participant-alice'],
    orderStrategy: 'directorFixed',
  },
  participants: [{
    participantRef: 'participant-alice',
    displayName: 'Alice',
    initialKnowledgeEvidenceRefs: ['knowledge-alice-key'],
  }],
  initialKnowledgeEvidence: [{
    id: 'knowledge-alice-key',
    participantRef: 'participant-alice',
    visibility: 'playerVisible',
    fact: 'Alice has the brass key.',
    provenance: {
      kind: 'authorProvided',
      providedAt: '2026-07-15T00:00:00.000Z',
    },
  }],
});

const createFixture = () => {
  const session = createPlaySceneRehearsalSessionDraft(createInput());
  const perception = createCharacterPerceptionPackage(
    session.sceneRehearsal!,
    'participant-alice',
  );
  const attempt = createPlayTurnAttempt({
    id: 'attempt-one',
    sessionId: session.id,
    baseRevision: 0,
    sceneBeforeRef: 'scene-room',
    actorOrder: ['participant-alice'],
    createdAt: '2026-07-15T00:00:00.000Z',
  });
  return { attempt, perception };
};

const createStep = (
  id: string,
  perception: CharacterPerceptionPackage,
  options: {
    variantOf?: string;
    sourceRefs?: string[];
    decisionBasisRefs?: string[];
  } = {},
): Omit<CharacterStepDraft, 'attemptId' | 'status'> => ({
  id,
  participantRef: 'participant-alice',
  queueIndex: 0,
  perceptionRef: perception.id,
  intentSummary: 'Alice tests the key.',
  narrativeBlocks: [{
    id: `block-${id}`,
    kind: 'characterAction',
    speakerRef: 'participant-alice',
    content: 'Alice turns the brass key once.',
    visibility: 'playerVisible',
    projection: 'transcript',
    eventRefs: [],
    sourceRefs: options.sourceRefs ?? ['knowledge-alice-key'],
  }],
  settlementContribution: emptySettlement({ [`state-${id}`]: true }),
  decisionBasisRefs: options.decisionBasisRefs ?? ['knowledge-alice-key'],
  ...(options.variantOf ? { variantOf: options.variantOf } : {}),
  createdAt: '2026-07-15T00:00:01.000Z',
});

describe('Play rehearsal turn attempt idempotency', () => {
  it('replays Step and Accept receipts before revision/status guards', () => {
    const { attempt, perception } = createFixture();
    const added = addPlayTurnAttemptStep(attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'step-request-1',
      operation: { mode: 'next' },
      step: createStep('step-one', perception),
      perception,
      updatedAt: '2026-07-15T00:00:01.000Z',
    });
    const accepted = acceptPlayTurnAttemptStep(added.attempt, {
      expectedAttemptRevision: 1,
      idempotencyKey: 'accept-request-1',
      stepRef: 'step-one',
      updatedAt: '2026-07-15T00:00:02.000Z',
    });
    expect(accepted.attempt).toMatchObject({
      status: 'prepared',
      attemptRevision: 2,
      selectedHeadRef: 'step-one',
    });

    const stepReplay = addPlayTurnAttemptStep(accepted.attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'step-request-1',
      operation: { mode: 'next' },
    });
    expect(stepReplay.replayed).toBe(true);
    expect(stepReplay.receipt).toEqual(added.receipt);
    expect(stepReplay.attempt).toEqual(accepted.attempt);

    const acceptReplay = acceptPlayTurnAttemptStep(accepted.attempt, {
      expectedAttemptRevision: 1,
      idempotencyKey: 'accept-request-1',
      stepRef: 'step-one',
    });
    expect(acceptReplay.replayed).toBe(true);
    expect(acceptReplay.receipt).toEqual(accepted.receipt);

    expect(() => addPlayTurnAttemptStep(accepted.attempt, {
      expectedAttemptRevision: 2,
      idempotencyKey: 'step-request-1',
      operation: { mode: 'retry', sourceStepRef: 'step-one' },
    })).toThrow('idempotency key was reused with another payload');
  });

  it('replays Cancel after terminal state and rejects same-key payload drift', () => {
    const { attempt } = createFixture();
    const cancelled = cancelPlayTurnAttempt(attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'cancel-request-1',
      reason: 'Director stopped the rehearsal.',
      updatedAt: '2026-07-15T00:00:03.000Z',
    });
    expect(cancelled.attempt).toMatchObject({
      status: 'cancelled',
      attemptRevision: 1,
    });

    const replay = cancelPlayTurnAttempt(cancelled.attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'cancel-request-1',
      reason: 'Director stopped the rehearsal.',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.attempt).toEqual(cancelled.attempt);
    expect(() => cancelPlayTurnAttempt(cancelled.attempt, {
      expectedAttemptRevision: 1,
      idempotencyKey: 'cancel-request-1',
      reason: 'A different reason.',
    })).toThrow('idempotency key was reused with another payload');
  });
});

describe('Play rehearsal provisional step transitions', () => {
  it('requires typed Retry to replace exactly the current draft', () => {
    const { attempt, perception } = createFixture();
    const first = addPlayTurnAttemptStep(attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'step-first',
      operation: { mode: 'next' },
      step: createStep('step-first', perception),
      perception,
    }).attempt;

    expect(() => addPlayTurnAttemptStep(first, {
      expectedAttemptRevision: 1,
      idempotencyKey: 'step-overwrite',
      operation: { mode: 'next' },
      step: createStep('step-overwrite', perception),
      perception,
    })).toThrow('use typed Retry');

    const snapshot = structuredClone(first);
    expect(preparePlayTurnAttemptRetry(first, 'step-first')).toEqual({
      attemptId: 'attempt-one',
      participantRef: 'participant-alice',
      queueIndex: 0,
      variantOf: 'step-first',
    });
    expect(first).toEqual(snapshot);

    const retried = addPlayTurnAttemptStep(first, {
      expectedAttemptRevision: 1,
      idempotencyKey: 'step-retry',
      operation: { mode: 'retry', sourceStepRef: 'step-first' },
      step: createStep('step-second', perception, { variantOf: 'step-first' }),
      perception,
    }).attempt;
    expect(retried).toMatchObject({
      attemptRevision: 2,
      currentStepRef: 'step-second',
      steps: [
        expect.objectContaining({ id: 'step-first', status: 'superseded' }),
        expect.objectContaining({
          id: 'step-second',
          status: 'draft',
          variantOf: 'step-first',
        }),
      ],
    });
    expect(() => addPlayTurnAttemptStep(retried, {
      expectedAttemptRevision: 2,
      idempotencyKey: 'retry-old-variant',
      operation: { mode: 'retry', sourceStepRef: 'step-first' },
      step: createStep('step-third', perception, { variantOf: 'step-first' }),
      perception,
    })).toThrow('current provisional draft');
    expect(() => preparePlayTurnAttemptRetry(retried, 'step-first'))
      .toThrow('not retryable');
  });

  it('rejects forbidden knowledge before mutation and validates Finish guards', () => {
    const { attempt, perception } = createFixture();
    const tamperedNoticeStep = createStep('step-tampered-notice', perception);
    tamperedNoticeStep.settlementContribution.events.push({
      kind: 'environmentChanged',
      origin: 'environment',
      title: 'The lamp turns red',
      summary: 'The gate lamp is visibly red.',
      visibility: 'playerVisible',
      cause: { reason: 'The gate sensor changed the lamp.' },
    });
    tamperedNoticeStep.narrativeBlocks.push({
      id: 'world-notice-step-tampered-notice',
      kind: 'worldNotice',
      content: 'A hidden stationmaster order is exposed.',
      visibility: 'playerVisible',
      projection: 'transcript',
      eventRefs: [],
      sourceRefs: [],
    });
    expect(() => addPlayTurnAttemptStep(attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'tampered-world-notice',
      operation: { mode: 'next' },
      step: tamperedNoticeStep,
      perception,
    })).toThrow('invalid provisional world notice evidence');

    const hardDueStep = createStep('step-hard-due', perception);
    hardDueStep.settlementContribution.events.push({
      kind: 'environmentChanged',
      origin: 'clock',
      title: 'A host-owned deadline arrived',
      summary: 'The deadline became due.',
      visibility: 'playerVisible',
      cause: {
        reason: 'The actor must not settle this.',
        triggerId: 'scheduled-deadline',
      },
    });
    expect(() => addPlayTurnAttemptStep({
      ...attempt,
      dueScheduledEventIds: ['scheduled-deadline'],
    }, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'hard-due-step',
      operation: { mode: 'next' },
      step: hardDueStep,
      perception,
    })).toThrow('cannot settle hard-due event');
    expect(() => addPlayTurnAttemptStep(attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'forbidden-step',
      operation: { mode: 'next' },
      step: createStep('step-forbidden', perception, {
        sourceRefs: ['knowledge-bob-secret'],
        decisionBasisRefs: ['knowledge-bob-secret'],
      }),
      perception,
    })).toThrow('forbidden knowledge evidence');
    expect(attempt).toMatchObject({ attemptRevision: 0, steps: [] });

    const added = addPlayTurnAttemptStep(attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'valid-step',
      operation: { mode: 'next' },
      step: createStep('step-valid', perception),
      perception,
    });
    const prepared = acceptPlayTurnAttemptStep(added.attempt, {
      expectedAttemptRevision: 1,
      idempotencyKey: 'valid-accept',
      stepRef: 'step-valid',
    }).attempt;

    expect(assertPlayTurnAttemptFinalizable(prepared, {
      expectedAttemptRevision: 2,
      selectedHeadRef: 'step-valid',
      currentSessionRevision: 0,
    })).toEqual(prepared);
    expect(() => assertPlayTurnAttemptFinalizable(prepared, {
      expectedAttemptRevision: 1,
      selectedHeadRef: 'step-valid',
      currentSessionRevision: 0,
    })).toThrow('attempt revision conflict');
    expect(() => assertPlayTurnAttemptFinalizable(prepared, {
      expectedAttemptRevision: 2,
      selectedHeadRef: 'step-other',
      currentSessionRevision: 0,
    })).toThrow('selected head conflict');
    expect(() => assertPlayTurnAttemptFinalizable(prepared, {
      expectedAttemptRevision: 2,
      selectedHeadRef: 'step-valid',
      currentSessionRevision: 1,
    })).toThrow('session revision conflict');
  });
});
