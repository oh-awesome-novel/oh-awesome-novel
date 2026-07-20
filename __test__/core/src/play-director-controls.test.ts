import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acceptPlayTurnAttemptStep,
  addPlayTurnAttemptStep,
  applyPlayTurnAttemptRedirect,
  createCharacterPerceptionPackage,
  createPlaySessionDraft,
  createPlaySceneRehearsalSessionDraft,
  createPlayTurnAttempt,
  evaluatePlayRehearsalProvisionalOverlay,
  evaluatePlaySceneMemoryStatus,
  fingerprintPlayStepEffects,
  grantPlayTurnAttemptKnowledge,
  insertPlayTurnAttemptActor,
  listActivePlayParticipantKnowledgeGrants,
  normalizePlaySceneMemoryArtifact,
  projectPlaySceneMemory,
  readPlaySceneMemory,
  rebuildPlaySceneMemory,
  revisePlayTurnAttemptProjection,
  schedulePlayRehearsalActorOrder,
  settlePlayWorldRefereeResponse,
  writePlaySceneMemory,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type {
  CharacterPerceptionPackage,
  CharacterStepDraft,
  PlayWorldRefereeSettlement,
} from '@oh-awesome-novel/core';

const settlement = (
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

const fixture = () => {
  const session = createPlaySceneRehearsalSessionDraft({
    id: 'play-f4',
    title: 'F4',
    sceneStart: 'A sealed archive.',
    characters: [],
    scheduledEvents: [{
      id: 'scheduled-gate',
      label: 'Gate opens',
      trigger: { type: 'flagEquals', path: 'gate.open', value: true },
      template: {
        kind: 'environmentChanged',
        origin: 'worldRule',
        title: 'Gate opens',
        summary: 'The archive gate unlocks.',
        visibility: 'playerVisible',
      },
      status: 'scheduled',
      scheduledAtTurn: 0,
      scheduledAtRevision: 0,
    }],
    sceneContract: {
      sceneId: 'scene-archive',
      worldClock: { turn: 0, revision: 0 },
      clockProvenance: { kind: 'newSessionInitial', sourceRefs: [] },
      participantRefs: ['participant-alice', 'participant-bob'],
      orderStrategy: 'hybrid',
    },
    participants: [
      {
        participantRef: 'participant-alice',
        displayName: 'Alice',
        initialKnowledgeEvidenceRefs: ['fact-key'],
      },
      {
        participantRef: 'participant-bob',
        displayName: 'Bob',
        initialKnowledgeEvidenceRefs: [],
      },
    ],
    initialKnowledgeEvidence: [{
      id: 'fact-key',
      participantRef: 'participant-alice',
      visibility: 'playerUnknown',
      fact: 'The brass key opens the archive.',
      provenance: {
        kind: 'authorProvided',
        providedAt: '2026-07-20T00:00:00.000Z',
      },
    }],
  });
  const alice = createCharacterPerceptionPackage(
    session.sceneRehearsal!,
    'participant-alice',
  );
  const bob = createCharacterPerceptionPackage(
    session.sceneRehearsal!,
    'participant-bob',
  );
  const attempt = createPlayTurnAttempt({
    id: 'attempt-f4',
    sessionId: session.id,
    baseRevision: 0,
    sceneBeforeRef: 'scene-archive',
    actorOrder: ['participant-alice', 'participant-bob'],
    participantRefs: ['participant-alice', 'participant-bob'],
    orderStrategy: 'hybrid',
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  return { session, attempt, alice, bob };
};

const step = (
  id: string,
  participantRef: string,
  queueIndex: number,
  perception: CharacterPerceptionPackage,
  beforeStepRef?: string,
  effects = settlement({ [`effect-${id}`]: true }),
): Omit<CharacterStepDraft, 'attemptId' | 'status'> => ({
  id,
  participantRef,
  queueIndex,
  ...(beforeStepRef ? { beforeStepRef } : {}),
  perceptionRef: perception.id,
  intentSummary: `${participantRef} acts.`,
  narrativeBlocks: [{
    id: `block-${id}`,
    kind: 'characterAction',
    speakerRef: participantRef,
    content: `${participantRef} tests the archive.`,
    visibility: 'playerVisible',
    projection: 'transcript',
    eventRefs: [],
    sourceRefs: perception.initialKnowledgeEvidence.map((item) => item.id),
  }],
  settlementContribution: effects,
  decisionBasisRefs: perception.initialKnowledgeEvidence.map((item) => item.id),
  createdAt: '2026-07-20T00:00:01.000Z',
});

const prepareTwoSteps = () => {
  const value = fixture();
  const aliceDraft = addPlayTurnAttemptStep(value.attempt, {
    expectedAttemptRevision: 0,
    idempotencyKey: 'prepare-alice',
    operation: { mode: 'next' },
    step: step('step-alice', 'participant-alice', 0, value.alice),
    perception: value.alice,
  }).attempt;
  const aliceAccepted = acceptPlayTurnAttemptStep(aliceDraft, {
    expectedAttemptRevision: 1,
    idempotencyKey: 'accept-alice',
    stepRef: 'step-alice',
  }).attempt;
  const bobDraft = addPlayTurnAttemptStep(aliceAccepted, {
    expectedAttemptRevision: 2,
    idempotencyKey: 'prepare-bob',
    operation: { mode: 'next' },
    step: step('step-bob', 'participant-bob', 1, value.bob, 'step-alice'),
    perception: value.bob,
  }).attempt;
  const prepared = acceptPlayTurnAttemptStep(bobDraft, {
    expectedAttemptRevision: 3,
    idempotencyKey: 'accept-bob',
    stepRef: 'step-bob',
  }).attempt;
  return { ...value, prepared };
};

describe('F4 Director interventions', () => {
  it('revises projection append-only while preserving effects and selected suffix', () => {
    const { prepared } = prepareTwoSteps();
    const target = prepared.steps.find((candidate) => candidate.id === 'step-alice')!;
    const result = revisePlayTurnAttemptProjection(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'revise-alice',
      interventionId: 'intervention-revise-alice',
      stepRef: target.id,
      expectedEffectFingerprint: target.effectFingerprint!,
      replacementBlocks: [{
        id: 'block-alice-revised',
        kind: 'characterAction',
        speakerRef: 'participant-alice',
        content: 'Alice quietly tests the archive lock.',
        visibility: 'playerVisible',
        projection: 'transcript',
        eventRefs: [],
        sourceRefs: ['fact-key'],
      }],
    });

    expect(result.attempt.status).toBe('prepared');
    expect(result.attempt.selectedStepRefs).toEqual([
      'intervention-revise-alice-step',
      'intervention-revise-alice-carry-1',
    ]);
    expect(result.attempt.interventions[0]).toMatchObject({
      kind: 'reviseProjection',
      supersededStepRefs: ['step-alice', 'step-bob'],
    });
    expect(result.attempt.steps.find((candidate) =>
      candidate.id === 'intervention-revise-alice-step')?.effectFingerprint)
      .toBe(target.effectFingerprint);
    expect(result.attempt.steps.find((candidate) => candidate.id === 'step-bob')?.status)
      .toBe('superseded');
  });

  it('applies only host-adjudicated redirect and invalidates the old suffix', () => {
    const { prepared, alice } = prepareTwoSteps();
    const redirectedSettlement = settlement({ redirected: true });
    const redirected = applyPlayTurnAttemptRedirect(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'redirect-alice',
      interventionId: 'intervention-redirect-alice',
      stepRef: 'step-alice',
      directorIntent: 'Alice leaves the key untouched.',
      authorConstraintRefs: ['fact-key'],
      perception: alice,
      replacementStep: {
        ...step(
          'step-alice-redirected',
          'participant-alice',
          0,
          alice,
          undefined,
          redirectedSettlement,
        ),
        variantOf: 'step-alice',
      },
    });
    expect(redirected.attempt).toMatchObject({
      status: 'running',
      selectedStepRefs: ['step-alice-redirected'],
      selectedHeadRef: 'step-alice-redirected',
    });
    expect(redirected.attempt.interventions[0]).toMatchObject({
      kind: 'redirectStep',
      supersededStepRefs: ['step-alice', 'step-bob'],
    });
    expect(fingerprintPlayStepEffects(redirectedSettlement)).toBe(
      redirected.attempt.steps.at(-1)?.effectFingerprint,
    );

    expect(() => applyPlayTurnAttemptRedirect(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'redirect-alice-opaque-constraint',
      interventionId: 'intervention-redirect-alice-opaque-constraint',
      stepRef: 'step-alice',
      directorIntent: 'Alice leaves the key untouched.',
      authorConstraintRefs: ['unresolved-opaque-constraint'],
      perception: alice,
      replacementStep: {
        ...step(
          'step-alice-invalid-redirect',
          'participant-alice',
          0,
          alice,
          undefined,
          redirectedSettlement,
        ),
        variantOf: 'step-alice',
      },
    })).toThrow(/outside the target participant perception/iu);
  });

  it('rejects revise payloads that alter or drop Director-only narrative blocks', () => {
    const { prepared } = prepareTwoSteps();
    const target = prepared.steps.find((candidate) => candidate.id === 'step-alice')!;
    target.narrativeBlocks.push({
      id: 'block-alice-director-only',
      kind: 'narrator',
      content: 'The archive alarm is silently armed.',
      visibility: 'playerUnknown',
      projection: 'directorOnly',
      eventRefs: [],
      sourceRefs: ['fact-key'],
    });
    const visible = target.narrativeBlocks[0]!;
    const hidden = target.narrativeBlocks[1]!;

    expect(() => revisePlayTurnAttemptProjection(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'revise-hidden-alice',
      interventionId: 'intervention-revise-hidden-alice',
      stepRef: target.id,
      expectedEffectFingerprint: target.effectFingerprint!,
      replacementBlocks: [
        { ...structuredClone(visible), content: 'Alice pauses beside the archive lock.' },
        { ...structuredClone(hidden), content: 'The archive alarm has been disabled.' },
      ],
    })).toThrow(/Director-only narrative blocks/iu);

    expect(() => revisePlayTurnAttemptProjection(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'revise-drop-hidden-alice',
      interventionId: 'intervention-revise-drop-hidden-alice',
      stepRef: target.id,
      expectedEffectFingerprint: target.effectFingerprint!,
      replacementBlocks: [
        { ...structuredClone(visible), content: 'Alice pauses beside the archive lock.' },
      ],
    })).toThrow(/cardinality/iu);

    expect(() => revisePlayTurnAttemptProjection(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'revise-evidence-alice',
      interventionId: 'intervention-revise-evidence-alice',
      stepRef: target.id,
      expectedEffectFingerprint: target.effectFingerprint!,
      replacementBlocks: [
        {
          ...structuredClone(visible),
          content: 'Alice pauses beside the archive lock.',
          sourceRefs: [],
        },
        structuredClone(hidden),
      ],
    })).toThrow(/evidence metadata/iu);
  });

  it('moves actor order and grants participant-only knowledge from a stable fact', () => {
    const { prepared } = prepareTwoSteps();
    const inserted = insertPlayTurnAttemptActor(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'insert-bob',
      interventionId: 'intervention-insert-bob',
      participantRef: 'participant-bob',
      beforeStepRef: 'step-alice',
    }).attempt;
    expect(inserted.actorOrder).toEqual(['participant-bob', 'participant-alice']);
    expect(inserted.selectedStepRefs).toEqual([]);
    expect(inserted.interventions[0]?.supersededStepRefs).toEqual([
      'step-alice',
      'step-bob',
    ]);

    const granted = grantPlayTurnAttemptKnowledge(prepared, {
      expectedAttemptRevision: 4,
      idempotencyKey: 'grant-bob',
      interventionId: 'intervention-grant-bob',
      participantRef: 'participant-bob',
      effectiveFromStepRef: 'step-bob',
      availableFactRefs: ['fact-key'],
      grant: { kind: 'existingFact', factRefs: ['fact-key'] },
    }).attempt;
    expect(granted.selectedStepRefs).toEqual(['step-alice']);
    expect(listActivePlayParticipantKnowledgeGrants(granted, 'participant-bob', 1))
      .toHaveLength(1);
    expect(listActivePlayParticipantKnowledgeGrants(granted, 'participant-alice', 1))
      .toEqual([]);
  });
});

describe('F4 overlay, order, and stagnation', () => {
  it('delegates provisional flag trigger ordering to the committed due evaluator', () => {
    const { session, attempt, alice } = fixture();
    const draft = addPlayTurnAttemptStep(attempt, {
      expectedAttemptRevision: 0,
      idempotencyKey: 'overlay-step',
      operation: { mode: 'next' },
      step: step(
        'step-overlay',
        'participant-alice',
        0,
        alice,
        undefined,
        settlement({ gate: { open: true } }),
      ),
      perception: alice,
    }).attempt;
    const selected = acceptPlayTurnAttemptStep(draft, {
      expectedAttemptRevision: 1,
      idempotencyKey: 'overlay-accept',
      stepRef: 'step-overlay',
    }).attempt;
    const evaluation = evaluatePlayRehearsalProvisionalOverlay(session, selected);
    expect(evaluation.base.dueEvents).toEqual([]);
    expect(evaluation.overlay.dueEvents.map((event) => event.id))
      .toEqual(['scheduled-gate']);
    expect(evaluation.newlyDueEventIds).toEqual(['scheduled-gate']);
  });

  it('supports deterministic dynamic/hybrid order and typed stagnation warnings', () => {
    expect(schedulePlayRehearsalActorOrder({
      strategy: 'refereeDynamic',
      participantRefs: ['participant-alice', 'participant-bob'],
      refereeOrder: ['participant-bob', 'participant-alice'],
    })).toEqual(['participant-bob', 'participant-alice']);
    expect(schedulePlayRehearsalActorOrder({
      strategy: 'hybrid',
      participantRefs: ['participant-alice', 'participant-bob'],
      directorOrder: ['participant-alice'],
      refereeOrder: ['participant-bob', 'participant-alice'],
    })).toEqual(['participant-alice', 'participant-bob']);
  });
});

describe('F4 Scene Memory', () => {
  it('rebuilds from selected committed truth, projects Player safely, and reports stale inputs', () => {
    const base = createPlaySessionDraft({
      id: 'play-f4-memory',
      title: 'F4 memory',
      sceneStart: 'A sealed archive.',
      characters: [],
      activatedSources: [{
        sourceId: 'world.archive',
        path: 'world/archive.md',
        contentHash: 'a'.repeat(64),
        reason: 'Archive truth is active.',
        budgetLayer: 'L1',
        semanticBoundary: 'protected',
        trust: 'canonical',
      }],
    });
    const session = settlePlayWorldRefereeResponse({
      session: base,
      userText: 'Open the archive.',
      actionKind: 'do',
      createdAt: '2026-07-20T01:00:00.000Z',
      refereeResponse: [
        'The archive door opens.',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'environmentChanged',
            origin: 'environment',
            title: 'Archive opened',
            summary: 'The sealed archive is now accessible.',
            visibility: 'playerVisible',
            cause: { reason: 'The lock accepted the key.' },
          }],
        }),
        '```',
      ].join('\n'),
    });
    const director = rebuildPlaySceneMemory(
      session,
      'director',
      '2026-07-20T01:01:00.000Z',
    );
    expect(director.selectedTurnRefs).toEqual(session.selectedTurnIds);
    expect(director.sourceHashes).toEqual({ 'world.archive': 'a'.repeat(64) });
    expect(director.items.length).toBeGreaterThan(0);

    const player = projectPlaySceneMemory(
      rebuildPlaySceneMemory(session, 'player', director.builtAt),
      'player',
    );
    expect(player.selectedTurnRefs).toEqual([]);
    expect(player.sourceHashes).toEqual({});
    expect(player.items.every((item) =>
      item.visibility !== 'playerUnknown' &&
      item.artifactTurnRefs.length === 0 &&
      item.eventRefs.length === 0 &&
      item.sourceRefs.length === 0
    )).toBe(true);

    expect(evaluatePlaySceneMemoryStatus(director, {
      ...session,
      activatedSources: [{
        ...session.activatedSources[0]!,
        contentHash: 'b'.repeat(64),
      }],
    })).toMatchObject({
      status: 'stale',
      staleReasons: ['sourceHashesChanged'],
    });
    const advanced = settlePlayWorldRefereeResponse({
      session,
      userText: 'Enter the archive.',
      actionKind: 'move',
      createdAt: '2026-07-20T01:02:00.000Z',
      refereeResponse: [
        'The threshold is crossed.',
        '```oan-play-settlement',
        '{}',
        '```',
      ].join('\n'),
    });
    expect(evaluatePlaySceneMemoryStatus(director, advanced)).toMatchObject({
      status: 'stale',
      staleReasons: ['sessionRevisionChanged', 'selectedBranchChanged'],
    });
  });

  it('fails closed on invalid memory item enums', () => {
    const memory = {
      schemaVersion: 1,
      id: 'scene-memory-director-0',
      sessionId: 'play-f4-memory-invalid',
      lens: 'director',
      throughRevision: 0,
      selectedTurnRefs: [],
      sourceHashes: {},
      status: 'current',
      builtAt: '2026-07-20T01:01:00.000Z',
      items: [{
        id: 'outcome-1',
        kind: 'hiddenThought',
        summary: 'Not a supported projection.',
        visibility: 'playerUnknown',
        confidence: 'confirmed',
        tags: ['writingMaterial'],
        artifactTurnRefs: [],
        messageRefs: [],
        eventRefs: [],
        observationRefs: [],
        evidenceRefs: [],
        sourceRefs: [],
        participantRefs: [],
      }],
    };
    expect(() => normalizePlaySceneMemoryArtifact(memory)).toThrow(/kind/iu);
  });

  it('preserves a derived memory across a session swap so it becomes stale', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-f4-memory-'));
    try {
      const session = createPlaySessionDraft({
        id: 'play-f4-memory-swap',
        title: 'F4 memory swap',
        sceneStart: 'A sealed archive.',
        characters: [],
      });
      await writePlaySessionFiles(workspaceRoot, session, { expectedAbsent: true });
      await writePlaySceneMemory(
        workspaceRoot,
        session.id,
        'director',
        '2026-07-20T01:01:00.000Z',
      );
      const advanced = settlePlayWorldRefereeResponse({
        session,
        userText: 'Enter the archive.',
        actionKind: 'move',
        createdAt: '2026-07-20T01:02:00.000Z',
        refereeResponse: [
          'The threshold is crossed.',
          '```oan-play-settlement',
          '{}',
          '```',
        ].join('\n'),
      });
      await writePlaySessionFiles(workspaceRoot, advanced, {
        expectedCurrentSession: session,
      });

      expect(await readPlaySceneMemory(workspaceRoot, session.id, 'director'))
        .toMatchObject({
          status: 'stale',
          staleReasons: ['sessionRevisionChanged', 'selectedBranchChanged'],
        });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
