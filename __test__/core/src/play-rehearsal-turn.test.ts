import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION,
  acceptPlayTurnAttemptStep,
  addPlayTurnAttemptStep,
  aggregatePlayTurnAttemptSettlement,
  cancelPlayTurnAttempt,
  createCharacterPerceptionPackage,
  createPlaySceneRehearsalSessionDraft,
  finalizePlaySceneRehearsalAttempt,
  listPlaySessionCheckpoints,
  listPlayTurnAttemptRecoveries,
  preparePlayWorldSettlementRetry,
  projectSelectedPlayRehearsalEvidence,
  readPlaySessionFiles,
  readPlayTurnAttemptRecovery,
  restorePlaySessionCheckpoint,
  startPlaySceneRehearsalAttempt,
  writePlaySessionFiles,
  writePlayTurnAttemptRecovery,
} from '@oh-awesome-novel/core';
import type {
  CharacterPerceptionPackage,
  CharacterStepDraft,
  CreatePlaySceneRehearsalSessionInput,
  PlayTurnAttempt,
  PlayWorldRefereeSettlement,
} from '@oh-awesome-novel/core';

const createInput = (): CreatePlaySceneRehearsalSessionInput => ({
  id: 'play-rehearsal-finish',
  title: 'Rehearsal Finish',
  createdAt: '2026-07-15T00:00:00.000Z',
  sceneStart: 'The station gates begin to close.',
  characters: [],
  eventPolicy: { maxExternalEventsPerTurn: 3 },
  scheduledEvents: [{
    id: 'scheduled-gate-close',
    label: 'Gate closes',
    trigger: { type: 'nextTurn' },
    template: {
      kind: 'environmentChanged',
      origin: 'clock',
      title: 'Station gate closed',
      summary: 'The station gate locks at the appointed time.',
      visibility: 'playerVisible',
    },
    status: 'scheduled',
    scheduledAtTurn: 0,
    scheduledAtRevision: 0,
  }],
  sceneContract: {
    sceneId: 'scene-gate',
    worldClock: { turn: 0, revision: 0 },
    clockProvenance: { kind: 'newSessionInitial', sourceRefs: ['outline-gate'] },
    participantRefs: ['participant-alice', 'participant-bob'],
    orderStrategy: 'directorFixed',
  },
  participants: [{
    participantRef: 'participant-alice',
    displayName: 'Alice',
    initialKnowledgeEvidenceRefs: ['knowledge-alice-ticket'],
  }, {
    participantRef: 'participant-bob',
    displayName: 'Bob',
    initialKnowledgeEvidenceRefs: ['knowledge-bob-duty'],
  }],
  initialKnowledgeEvidence: [{
    id: 'knowledge-alice-ticket',
    participantRef: 'participant-alice',
    visibility: 'playerVisible',
    fact: 'Alice has a ticket for the final train.',
    provenance: {
      kind: 'authorProvided',
      providedAt: '2026-07-15T00:00:00.000Z',
    },
  }, {
    id: 'knowledge-bob-duty',
    participantRef: 'participant-bob',
    visibility: 'playerVisible',
    fact: 'Bob must close the gate when the bell rings.',
    provenance: {
      kind: 'authorProvided',
      providedAt: '2026-07-15T00:00:00.000Z',
    },
  }],
});

const emptySettlement = (
  stateDelta: Record<string, unknown>,
  events: PlayWorldRefereeSettlement['events'] = [],
): PlayWorldRefereeSettlement => ({
  events,
  pressureChanges: [],
  agendaChanges: [],
  scheduledEventChanges: [],
  stateDelta,
  observations: [],
  suggestedActions: [],
});

const createStep = (input: {
  id: string;
  participantRef: string;
  queueIndex: number;
  perception: CharacterPerceptionPackage;
  beforeStepRef?: string;
  knowledgeRef: string;
  contribution: PlayWorldRefereeSettlement;
}): Omit<CharacterStepDraft, 'attemptId' | 'status'> => {
  const narrativeBlocks: CharacterStepDraft['narrativeBlocks'] = [{
    id: `block-${input.id}`,
    kind: 'characterAction',
    speakerRef: input.participantRef,
    content: input.participantRef === 'participant-alice'
      ? 'Alice raises her ticket and steps toward the gate.'
      : 'Bob checks the bell and reaches for the lock.',
    visibility: 'playerVisible',
    projection: 'transcript',
    eventRefs: [],
    sourceRefs: [input.knowledgeRef],
  }];
  const visibleEvents = input.contribution.events.filter((event) =>
    event.visibility === 'playerVisible' && event.cause.triggerId === undefined);
  if (visibleEvents.length) {
    narrativeBlocks.push({
      id: `world-notice-${input.id}`,
      kind: 'worldNotice',
      content: visibleEvents.map((event) =>
        `${event.title}: ${event.summary}`).join('\n'),
      visibility: 'playerVisible',
      projection: 'transcript',
      eventRefs: [],
      sourceRefs: [],
    });
  }
  return {
    id: input.id,
    participantRef: input.participantRef,
    queueIndex: input.queueIndex,
    ...(input.beforeStepRef ? { beforeStepRef: input.beforeStepRef } : {}),
    perceptionRef: input.perception.id,
    intentSummary: `${input.participantRef} responds to the closing gate.`,
    narrativeBlocks,
    settlementContribution: input.contribution,
    decisionBasisRefs: [input.knowledgeRef],
    createdAt: `2026-07-15T00:00:0${input.queueIndex + 1}.000Z`,
  };
};

async function prepareAttempt(
  workspaceRoot: string,
  attempt: PlayTurnAttempt,
  alice: CharacterPerceptionPackage,
  bob: CharacterPerceptionPackage,
): Promise<PlayTurnAttempt> {
  let current = addPlayTurnAttemptStep(attempt, {
    expectedAttemptRevision: 0,
    idempotencyKey: 'finish-step-alice',
    operation: { mode: 'next' },
    step: createStep({
      id: 'step-alice',
      participantRef: 'participant-alice',
      queueIndex: 0,
      perception: alice,
      knowledgeRef: 'knowledge-alice-ticket',
      contribution: emptySettlement(
        { aliceAtGate: true },
        [{
          kind: 'npcActed',
          origin: 'npc',
          title: 'Alice approached the gate',
          summary: 'Alice stepped toward the station gate.',
          visibility: 'playerVisible',
          cause: { reason: 'Alice wants to catch the final train.' },
        }, {
          kind: 'informationSpread',
          origin: 'npc',
          title: 'A private suspicion spreads',
          summary: 'A porter quietly questions whether the ticket is valid.',
          visibility: 'rumor',
          cause: { reason: 'The porter noticed Alice hesitate.' },
        }],
      ),
    }),
    perception: alice,
  }).attempt;
  await writePlayTurnAttemptRecovery(workspaceRoot, current, {
    expectedAttemptRevision: 0,
  });
  current = acceptPlayTurnAttemptStep(current, {
    expectedAttemptRevision: 1,
    idempotencyKey: 'finish-accept-alice',
    stepRef: 'step-alice',
  }).attempt;
  await writePlayTurnAttemptRecovery(workspaceRoot, current, {
    expectedAttemptRevision: 1,
  });
  current = addPlayTurnAttemptStep(current, {
    expectedAttemptRevision: 2,
    idempotencyKey: 'finish-step-bob',
    operation: { mode: 'next' },
    step: createStep({
      id: 'step-bob',
      participantRef: 'participant-bob',
      queueIndex: 1,
      beforeStepRef: 'step-alice',
      perception: bob,
      knowledgeRef: 'knowledge-bob-duty',
      contribution: emptySettlement(
        { bobAtLock: true },
        [{
          kind: 'npcActed',
          origin: 'npc',
          title: 'Bob reached for the lock',
          summary: 'Bob put one hand on the station gate lock.',
          visibility: 'playerVisible',
          cause: { reason: 'Bob is responsible for closing the gate.' },
        }],
      ),
    }),
    perception: bob,
  }).attempt;
  await writePlayTurnAttemptRecovery(workspaceRoot, current, {
    expectedAttemptRevision: 2,
  });
  current = acceptPlayTurnAttemptStep(current, {
    expectedAttemptRevision: 3,
    idempotencyKey: 'finish-accept-bob',
    stepRef: 'step-bob',
  }).attempt;
  await writePlayTurnAttemptRecovery(workspaceRoot, current, {
    expectedAttemptRevision: 3,
  });
  return current;
}

describe('Play rehearsal recovery and atomic Finish', () => {
  it('atomically admits only one concurrent active attempt', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-attempt-race-'));
    try {
      const session = createPlaySceneRehearsalSessionDraft(createInput());
      await writePlaySessionFiles(workspaceRoot, session);
      const results = await Promise.allSettled([
        startPlaySceneRehearsalAttempt(workspaceRoot, {
          sessionId: session.id,
          attemptId: 'attempt-race-a',
          baseRevision: 0,
        }),
        startPlaySceneRehearsalAttempt(workspaceRoot, {
          sessionId: session.id,
          attemptId: 'attempt-race-b',
          baseRevision: 0,
        }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(listPlayTurnAttemptRecoveries(workspaceRoot, session.id))
        .resolves.toEqual([
          expect.objectContaining({ classification: 'active' }),
        ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('keeps one active recovery and preserves it across staged session writes', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-attempt-recovery-'));
    try {
      const session = createPlaySceneRehearsalSessionDraft(createInput());
      await writePlaySessionFiles(workspaceRoot, session);
      const attempt = await startPlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: session.id,
        attemptId: 'attempt-recovery-one',
        baseRevision: 0,
        createdAt: '2026-07-15T00:00:00.000Z',
      });
      expect(attempt.dueScheduledEventIds).toEqual(['scheduled-gate-close']);
      await expect(startPlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: session.id,
        attemptId: 'attempt-recovery-two',
        baseRevision: 0,
      })).rejects.toThrow('already has an active attempt');

      await writePlaySessionFiles(workspaceRoot, session);
      await expect(readPlayTurnAttemptRecovery(
        workspaceRoot,
        session.id,
        attempt.id,
      )).resolves.toEqual(attempt);
      await expect(listPlayTurnAttemptRecoveries(workspaceRoot, session.id))
        .resolves.toEqual([
          expect.objectContaining({
            attemptId: attempt.id,
            classification: 'active',
          }),
        ]);
      const cancelled = cancelPlayTurnAttempt(attempt, {
        expectedAttemptRevision: 0,
        idempotencyKey: 'cancel-recovery-attempt',
        reason: 'Director cancelled before commit.',
      }).attempt;
      await writePlayTurnAttemptRecovery(workspaceRoot, cancelled, {
        expectedAttemptRevision: 0,
      });
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .resolves.toEqual(session);
      await expect(listPlayTurnAttemptRecoveries(workspaceRoot, session.id))
        .resolves.toEqual([
          expect.objectContaining({
            attemptId: attempt.id,
            status: 'cancelled',
            classification: 'terminal',
          }),
        ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('refuses a staged session swap when committed truth changed at the commit barrier', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-session-cas-'));
    try {
      const base = createPlaySceneRehearsalSessionDraft(createInput());
      await writePlaySessionFiles(workspaceRoot, base);
      const changed = {
        ...base,
        title: 'A concurrent writer changed this session without advancing a turn.',
      };
      await writePlaySessionFiles(workspaceRoot, changed);

      await expect(writePlaySessionFiles(
        workspaceRoot,
        { ...base, sceneStart: 'A stale writer must not replace the concurrent title.' },
        { expectedCurrentSession: base },
      )).rejects.toThrow('changed before the staged write could commit');
      await expect(readPlaySessionFiles(workspaceRoot, base.id)).resolves.toMatchObject({
        revision: 0,
        title: changed.title,
        sceneStart: base.sceneStart,
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('serializes concurrent staged writers so only one compare-and-swap base can commit', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-session-cas-race-'));
    try {
      const base = createPlaySceneRehearsalSessionDraft(createInput());
      await writePlaySessionFiles(workspaceRoot, base);
      const results = await Promise.allSettled([
        writePlaySessionFiles(
          workspaceRoot,
          { ...base, title: 'Concurrent candidate A' },
          { expectedCurrentSession: base },
        ),
        writePlaySessionFiles(
          workspaceRoot,
          { ...base, title: 'Concurrent candidate B' },
          { expectedCurrentSession: base },
        ),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(readPlaySessionFiles(workspaceRoot, base.id)).resolves.toMatchObject({
        revision: 0,
        title: expect.stringMatching(/^Concurrent candidate [AB]$/),
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('aggregates selected contributions, settles hard-due once, and closes evidence atomically', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-rehearsal-finish-'));
    try {
      const draft = createPlaySceneRehearsalSessionDraft(createInput());
      await writePlaySessionFiles(workspaceRoot, draft);
      const attempt = await startPlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: 'attempt-finish-one',
        baseRevision: 0,
        createdAt: '2026-07-15T00:00:00.000Z',
      });
      const alice = createCharacterPerceptionPackage(
        draft.sceneRehearsal!,
        'participant-alice',
      );
      const bob = createCharacterPerceptionPackage(
        draft.sceneRehearsal!,
        'participant-bob',
      );
      const prepared = await prepareAttempt(workspaceRoot, attempt, alice, bob);
      expect(prepared).toMatchObject({ status: 'prepared', attemptRevision: 4 });

      const aggregated = aggregatePlayTurnAttemptSettlement(draft, prepared);
      expect(aggregated.events.filter((event) =>
        event.cause.triggerId === 'scheduled-gate-close')).toHaveLength(1);
      expect(aggregated.stateDelta).toEqual({
        aliceAtGate: true,
        bobAtLock: true,
      });
      const actorTriesToSettleDue = structuredClone(prepared);
      actorTriesToSettleDue.steps[0]!.settlementContribution.events.push({
        kind: 'environmentChanged',
        origin: 'clock',
        title: 'Station gate closed',
        summary: 'The station gate locks at the appointed time.',
        visibility: 'playerVisible',
        cause: {
          reason: 'An actor tried to settle host-owned due work.',
          triggerId: 'scheduled-gate-close',
        },
      });
      expect(() => aggregatePlayTurnAttemptSettlement(
        draft,
        actorTriesToSettleDue,
      )).toThrow('cannot settle hard-due event');

      await expect(finalizePlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: prepared.id,
        baseRevision: 1,
        expectedAttemptRevision: 4,
        selectedHeadRef: 'step-bob',
        idempotencyKey: 'finish-wrong-base',
        userText: 'Run the fixed actor queue.',
      })).rejects.toThrow('base revision conflict');

      const finalized = await finalizePlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: prepared.id,
        baseRevision: 0,
        expectedAttemptRevision: 4,
        selectedHeadRef: 'step-bob',
        idempotencyKey: 'finish-request-one',
        userText: 'Run the fixed actor queue.',
        createdAt: '2026-07-15T00:01:00.000Z',
      });
      expect(finalized).toMatchObject({
        replayed: false,
        session: {
          schemaVersion: 5,
          revision: 1,
          worldClock: { turn: 1, revision: 1 },
        },
        attempt: {
          status: 'committed',
          committedArtifactRef: 'turn-artifact-1',
          committedEvidenceRef: 'rehearsal-turn-artifact-1',
        },
        artifact: {
          schemaVersion: PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION,
          rehearsalEvidenceRefs: ['rehearsal-turn-artifact-1'],
          dueScheduledEventIds: ['scheduled-gate-close'],
        },
        evidence: {
          id: 'rehearsal-turn-artifact-1',
          owningTurnArtifactId: 'turn-artifact-1',
          selectedStepRefs: ['step-alice', 'step-bob'],
        },
      });
      expect(finalized.session.events.filter((event) =>
        event.cause.triggerId === 'scheduled-gate-close')).toHaveLength(1);
      const [aliceVisibleEventId, rumorEventId, bobVisibleEventId, hardDueEventId] =
        finalized.artifact.eventIds;
      expect(finalized.evidence.steps.map((step) => step.settlementEventRefs))
        .toEqual([[aliceVisibleEventId, rumorEventId], [bobVisibleEventId]]);
      expect(finalized.evidence.steps[0]?.narrativeBlocks.at(-1)).toMatchObject({
        id: 'world-notice-step-alice',
        kind: 'worldNotice',
        eventRefs: [aliceVisibleEventId],
      });
      expect(finalized.evidence.steps[1]?.narrativeBlocks.at(-1)).toMatchObject({
        id: 'world-notice-step-bob',
        kind: 'worldNotice',
        eventRefs: [bobVisibleEventId],
      });
      expect(finalized.evidence.hostNarrativeBlocks?.[0]).toMatchObject({
        id: `world-notice-host-${finalized.artifact.id}`,
        kind: 'worldNotice',
        eventRefs: [hardDueEventId],
      });
      expect(finalized.evidence.narrativeBlocks).toEqual(
        [
          ...finalized.evidence.steps.flatMap((step) => step.narrativeBlocks),
          ...(finalized.evidence.hostNarrativeBlocks ?? []),
        ],
      );
      expect(finalized.evidence.narrativeBlocks.flatMap((block) => block.eventRefs))
        .not.toContain(rumorEventId);

      const mismatchedProjection = structuredClone(finalized.session);
      mismatchedProjection.rehearsalScenes![0]!.turns[0]!
        .narrativeBlocks[0]!.content = 'A same-id top-level block leaked hidden text.';
      expect(() => listPlaySessionCheckpoints(mismatchedProjection))
        .toThrow('NarrativeBlocks must match');

      const tamperedNoticeContent = structuredClone(finalized.session);
      const contentEvidence = tamperedNoticeContent.rehearsalScenes![0]!.turns[0]!;
      const contentStepNotice = contentEvidence.steps[0]!.narrativeBlocks
        .find((block) => block.kind === 'worldNotice')!;
      const contentTopNotice = contentEvidence.narrativeBlocks
        .find((block) => block.id === contentStepNotice.id)!;
      contentStepNotice.content = 'A hidden stationmaster order is exposed.';
      contentTopNotice.content = contentStepNotice.content;
      expect(() => listPlaySessionCheckpoints(tamperedNoticeContent))
        .toThrow('does not match its event evidence');

      const widenedVisibility = structuredClone(finalized.session);
      const widenedEvidence = widenedVisibility.rehearsalScenes![0]!.turns[0]!;
      const widenedStepNotice = widenedEvidence.steps[0]!.narrativeBlocks
        .find((block) => block.kind === 'worldNotice')!;
      const widenedTopNotice = widenedEvidence.narrativeBlocks
        .find((block) => block.id === widenedStepNotice.id)!;
      widenedStepNotice.eventRefs = [rumorEventId!];
      widenedTopNotice.eventRefs = [rumorEventId!];
      expect(() => listPlaySessionCheckpoints(widenedVisibility))
        .toThrow('does not match its actor-contribution event partition');

      const attributedHostNotice = structuredClone(finalized.session);
      const attributedEvidence = attributedHostNotice.rehearsalScenes![0]!.turns[0]!;
      const attributedStepNotice = attributedEvidence.steps[0]!.narrativeBlocks
        .find((block) => block.kind === 'worldNotice')!;
      const attributedTopNotice = attributedEvidence.narrativeBlocks
        .find((block) => block.id === attributedStepNotice.id)!;
      attributedStepNotice.speakerRef = 'participant-alice';
      attributedTopNotice.speakerRef = 'participant-alice';
      expect(() => listPlaySessionCheckpoints(attributedHostNotice))
        .toThrow('invalid world notice evidence');

      const omittedHostNotice = structuredClone(finalized.session);
      const omittedEvidence = omittedHostNotice.rehearsalScenes![0]!.turns[0]!;
      omittedEvidence.hostNarrativeBlocks = [];
      omittedEvidence.narrativeBlocks = omittedEvidence.steps
        .flatMap((step) => step.narrativeBlocks.map((block) => structuredClone(block)));
      expect(() => listPlaySessionCheckpoints(omittedHostNotice))
        .toThrow('does not exactly cover player-visible host events');

      const reassignedHardDue = structuredClone(finalized.session);
      const reassignedEvidence = reassignedHardDue.rehearsalScenes![0]!.turns[0]!;
      const hostNotice = reassignedEvidence.hostNarrativeBlocks![0]!;
      const bobNoticeIndex = reassignedEvidence.steps[1]!.narrativeBlocks
        .findIndex((block) => block.kind === 'worldNotice');
      reassignedEvidence.steps[1]!.narrativeBlocks[bobNoticeIndex] = {
        ...structuredClone(hostNotice),
        id: 'world-notice-step-bob',
      };
      reassignedEvidence.hostNarrativeBlocks = [];
      reassignedEvidence.narrativeBlocks = reassignedEvidence.steps
        .flatMap((step) => step.narrativeBlocks.map((block) => structuredClone(block)));
      expect(() => listPlaySessionCheckpoints(reassignedHardDue))
        .toThrow('does not match its actor-contribution event partition');
      expect(finalized.session.scheduledEvents[0]).toMatchObject({
        id: 'scheduled-gate-close',
        status: 'occurred',
        occurredEventIds: [expect.any(String)],
      });
      expect(finalized.session.rehearsalScenes?.[0]?.turns[0]).toMatchObject({
        id: finalized.artifact.rehearsalEvidenceRefs?.[0],
        owningTurnArtifactId: finalized.artifact.id,
      });
      expect(listPlaySessionCheckpoints(finalized.session)[0]).toMatchObject({
        artifactId: finalized.artifact.id,
        retryable: false,
      });
      expect(() => preparePlayWorldSettlementRetry(
        finalized.session,
        finalized.artifact.id,
      )).toThrow('ordinary complete v2');
      await expect(readPlayTurnAttemptRecovery(
        workspaceRoot,
        draft.id,
        prepared.id,
      )).rejects.toMatchObject({ code: 'ENOENT' });

      const stored = await readPlaySessionFiles(workspaceRoot, draft.id);
      expect(stored).toEqual(finalized.session);
      const replay = await finalizePlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: prepared.id,
        baseRevision: 0,
        expectedAttemptRevision: 4,
        selectedHeadRef: 'step-bob',
        idempotencyKey: 'finish-request-one',
        userText: 'Run the fixed actor queue.',
        createdAt: '2026-07-15T00:01:00.000Z',
      });
      expect(replay).toMatchObject({
        replayed: true,
        session: { revision: 1 },
        artifact: { id: finalized.artifact.id },
        evidence: { id: finalized.evidence.id },
      });

      const secondAttempt = await startPlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: 'attempt-finish-two',
        baseRevision: 1,
      });
      const secondPrepared = await prepareAttempt(
        workspaceRoot,
        secondAttempt,
        alice,
        bob,
      );
      const second = await finalizePlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: secondPrepared.id,
        baseRevision: 1,
        expectedAttemptRevision: 4,
        selectedHeadRef: 'step-bob',
        idempotencyKey: 'finish-request-two',
        userText: 'Run the actor queue a second time.',
        createdAt: '2026-07-15T00:02:00.000Z',
      });
      const restored = restorePlaySessionCheckpoint(
        second.session,
        finalized.artifact.id,
      );
      expect(restored.rehearsalScenes?.[0]?.turns).toHaveLength(2);
      expect(projectSelectedPlayRehearsalEvidence(
        restored.turnArtifacts,
        restored.selectedTurnIds,
        restored.rehearsalScenes!,
      ))
        .toEqual([
          expect.objectContaining({ id: finalized.evidence.id }),
        ]);
      const advancedReplay = await finalizePlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: prepared.id,
        baseRevision: 0,
        expectedAttemptRevision: 4,
        selectedHeadRef: 'step-bob',
        idempotencyKey: 'finish-request-one',
        userText: 'Run the fixed actor queue.',
        createdAt: '2026-07-15T00:01:00.000Z',
      });
      expect(advancedReplay).toMatchObject({
        replayed: true,
        session: { revision: 2 },
        evidence: { id: finalized.evidence.id },
      });
      await expect(finalizePlaySceneRehearsalAttempt(workspaceRoot, {
        sessionId: draft.id,
        attemptId: prepared.id,
        baseRevision: 1,
        expectedAttemptRevision: 4,
        selectedHeadRef: 'step-bob',
        idempotencyKey: 'finish-request-one',
        userText: 'Run the fixed actor queue.',
      })).rejects.toThrow('already finalized with another request');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
