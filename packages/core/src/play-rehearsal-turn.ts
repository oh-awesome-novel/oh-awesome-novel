import {
  createPlayTurnAttemptRecovery,
  withPlayTurnAttemptRecoveryTransaction,
} from './play-attempt-recovery.js';
import type {
  PlayTurnAttemptRecoveryTransaction,
} from './play-attempt-recovery.js';
import {
  evaluatePlaySessionDueEvents,
  PlaySessionWriteConflictError,
  readPlaySessionFiles,
  settlePlayWorldRefereeSettlement,
  withPlaySessionFileTransaction,
} from './play-session.js';
import type {
  PlaySession,
  PlaySessionFileTransaction,
  PlayWorldRefereeSettlement,
} from './play-session.js';
import {
  materializePlayTurnFacts,
  resolvePlaySessionRevision,
} from './play-session-facts.js';
import {
  PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION,
} from './play-turn-artifact.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import {
  PLAY_REHEARSAL_SESSION_SCHEMA_VERSION,
  assertSafePlayRehearsalId,
  normalizePlayCommittedSceneEvidence,
  normalizePlaySceneRehearsalSidecar,
} from './play-rehearsal.js';
import type {
  NarrativeBlock,
  PlayCommittedCharacterStepEvidence,
  PlayRehearsalTurnEvidence,
} from './play-rehearsal.js';
import {
  PlayTurnAttemptError,
  assertPlayTurnAttemptFinalizable,
  createPlayTurnAttempt,
  fingerprintPlayAttemptRequest,
  markPlayTurnAttemptCommitted,
  normalizePlayTurnAttempt,
} from './play-turn-attempt.js';
import type {
  CharacterStepDraft,
  PlayTurnAttempt,
} from './play-turn-attempt.js';

export interface StartPlaySceneRehearsalAttemptInput {
  sessionId: string;
  attemptId: string;
  baseRevision: number;
  createdAt?: string;
}

export interface FinalizePlaySceneRehearsalAttemptInput {
  sessionId: string;
  attemptId: string;
  baseRevision: number;
  expectedAttemptRevision: number;
  selectedHeadRef: string;
  idempotencyKey: string;
  userText: string;
  createdAt?: string;
}

export interface FinalizedPlaySceneRehearsalAttempt {
  session: PlaySession;
  attempt?: PlayTurnAttempt;
  artifact: PlayTurnArtifact;
  evidence: PlayRehearsalTurnEvidence;
  receipt: PlayRehearsalTurnEvidence['finalizeReceipt'];
  replayed: boolean;
}

export async function startPlaySceneRehearsalAttempt(
  workspaceRoot: string,
  input: StartPlaySceneRehearsalAttemptInput,
): Promise<PlayTurnAttempt> {
  const sessionId = assertSafePlayRehearsalId(input.sessionId, 'sessionId');
  const session = await readPlaySessionFiles(workspaceRoot, sessionId);
  const sidecar = requireRehearsalSession(session);
  const currentRevision = resolvePlaySessionRevision(
    session,
    session.turnArtifacts,
  );
  if (
    !Number.isSafeInteger(input.baseRevision) ||
    input.baseRevision < 0 ||
    input.baseRevision !== currentRevision
  ) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      `Play rehearsal revision conflict: expected ${input.baseRevision}, current ${currentRevision}.`,
    );
  }
  const dueScheduledEventIds = evaluatePlaySessionDueEvents(session)
    .dueEvents.map((event) => event.id);
  const attempt = createPlayTurnAttempt({
    id: input.attemptId,
    sessionId,
    baseRevision: currentRevision,
    sceneBeforeRef: sidecar.activeSceneRef,
    actorOrder: [...sidecar.sceneContract.participantRefs],
    dueScheduledEventIds,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
  await createPlayTurnAttemptRecovery(workspaceRoot, attempt);
  return attempt;
}

export function aggregatePlayTurnAttemptSettlement(
  session: PlaySession,
  attemptValue: PlayTurnAttempt,
): PlayWorldRefereeSettlement {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  if (attempt.status !== 'prepared') {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Only a prepared Play rehearsal attempt can be aggregated.',
    );
  }
  const selectedSteps = resolveSelectedSteps(attempt);
  const dueEvents = evaluatePlaySessionDueEvents(session).dueEvents;
  const dueIds = dueEvents.map((event) => event.id);
  if (
    dueIds.length !== attempt.dueScheduledEventIds.length ||
    dueIds.some((dueId, index) => dueId !== attempt.dueScheduledEventIds[index])
  ) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      'Play rehearsal hard-due skeleton changed after the attempt started.',
    );
  }

  const elapsedValues = new Set<string>();
  const anchorValues = new Set<string>();
  const events: PlayWorldRefereeSettlement['events'] = [];
  const pressureChanges: PlayWorldRefereeSettlement['pressureChanges'] = [];
  const agendaChanges: PlayWorldRefereeSettlement['agendaChanges'] = [];
  const scheduledEventChanges:
    PlayWorldRefereeSettlement['scheduledEventChanges'] = [];
  const stateDelta: Record<string, unknown> = {};
  const observations: PlayWorldRefereeSettlement['observations'] = [];
  let suggestedActions: string[] = [];

  for (const step of selectedSteps) {
    const contribution = step.settlementContribution;
    if (contribution.elapsed) elapsedValues.add(contribution.elapsed);
    if (contribution.worldTimeAnchor) anchorValues.add(contribution.worldTimeAnchor);
    const attemptedHardDue = contribution.events.find((event) =>
      event.cause.triggerId !== undefined);
    if (attemptedHardDue) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        `Actor step ${step.id} cannot settle hard-due event ${attemptedHardDue.cause.triggerId}.`,
      );
    }
    events.push(...structuredClone(contribution.events));
    pressureChanges.push(...structuredClone(contribution.pressureChanges));
    agendaChanges.push(...structuredClone(contribution.agendaChanges));
    scheduledEventChanges.push(...structuredClone(contribution.scheduledEventChanges));
    for (const [key, value] of Object.entries(contribution.stateDelta)) {
      if (Object.hasOwn(stateDelta, key)) {
        throw new PlayTurnAttemptError(
          'invalidTransition',
          `Selected Play steps propose the same state key more than once: ${key}.`,
        );
      }
      stateDelta[key] = structuredClone(value);
    }
    observations.push(...structuredClone(contribution.observations));
    if (contribution.suggestedActions.length) {
      suggestedActions = [...contribution.suggestedActions];
    }
  }
  if (elapsedValues.size > 1 || anchorValues.size > 1) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Selected Play steps contain conflicting world-time contributions.',
    );
  }

  events.push(...dueEvents.map((dueEvent) => ({
    kind: dueEvent.template.kind,
    origin: dueEvent.template.origin,
    title: dueEvent.template.title,
    summary: dueEvent.template.summary,
    visibility: dueEvent.template.visibility,
    cause: {
      reason: `Scheduled consequence became due: ${dueEvent.label}.`,
      triggerId: dueEvent.id,
    },
  })));

  const elapsed = [...elapsedValues][0];
  const worldTimeAnchor = [...anchorValues][0];
  return {
    ...(elapsed ? { elapsed } : {}),
    ...(worldTimeAnchor ? { worldTimeAnchor } : {}),
    events,
    pressureChanges,
    agendaChanges,
    scheduledEventChanges,
    stateDelta,
    observations,
    suggestedActions,
  };
}

export async function finalizePlaySceneRehearsalAttempt(
  workspaceRoot: string,
  input: FinalizePlaySceneRehearsalAttemptInput,
): Promise<FinalizedPlaySceneRehearsalAttempt> {
  const sessionId = assertSafePlayRehearsalId(input.sessionId, 'sessionId');
  const attemptId = assertSafePlayRehearsalId(input.attemptId, 'attemptId');
  const selectedHeadRef = assertSafePlayRehearsalId(
    input.selectedHeadRef,
    'selectedHeadRef',
  );
  const idempotencyKey = assertSafePlayRehearsalId(
    input.idempotencyKey,
    'finalize idempotencyKey',
  );
  const userText = input.userText.trim();
  const requestFingerprint = fingerprintPlayAttemptRequest({
    kind: 'finish',
    attemptId,
    baseRevision: input.baseRevision,
    expectedAttemptRevision: input.expectedAttemptRevision,
    selectedHeadRef,
    userText,
  });
  return withPlayTurnAttemptRecoveryTransaction(
    workspaceRoot,
    sessionId,
    (recovery) => withPlaySessionFileTransaction(
      workspaceRoot,
      sessionId,
      (sessionFiles) => finalizePlaySceneRehearsalAttemptWithTransactions({
        input,
        sessionId,
        attemptId,
        selectedHeadRef,
        idempotencyKey,
        userText,
        requestFingerprint,
        recovery,
        sessionFiles,
      }),
    ),
  );
}

async function finalizePlaySceneRehearsalAttemptWithTransactions(context: {
  input: FinalizePlaySceneRehearsalAttemptInput;
  sessionId: string;
  attemptId: string;
  selectedHeadRef: string;
  idempotencyKey: string;
  userText: string;
  requestFingerprint: string;
  recovery: PlayTurnAttemptRecoveryTransaction;
  sessionFiles: PlaySessionFileTransaction;
}): Promise<FinalizedPlaySceneRehearsalAttempt> {
  const {
    input,
    sessionId,
    attemptId,
    selectedHeadRef,
    idempotencyKey,
    userText,
    requestFingerprint,
    recovery,
    sessionFiles,
  } = context;
  const session = await sessionFiles.read();
  const commitBaseSession = structuredClone(session);
  const sidecar = requireRehearsalSession(session);
  const existingEvidence = session.rehearsalScenes
    ?.flatMap((scene) => scene.turns)
    .find((evidence) => evidence.attemptId === attemptId);
  if (existingEvidence) {
    if (
      existingEvidence.finalizeReceipt.idempotencyKey !== idempotencyKey ||
      existingEvidence.finalizeReceipt.requestFingerprint !== requestFingerprint
    ) {
      throw new PlayTurnAttemptError(
        'idempotencyConflict',
        `Play attempt ${attemptId} was already finalized with another request.`,
      );
    }
    const artifact = session.turnArtifacts.find((candidate) =>
      candidate.id === existingEvidence.owningTurnArtifactId);
    if (!artifact) {
      throw new Error('Committed Play rehearsal evidence has no owning artifact.');
    }
    await recovery.remove(attemptId);
    return {
      session,
      artifact,
      evidence: existingEvidence,
      receipt: existingEvidence.finalizeReceipt,
      replayed: true,
    };
  }

  if (!userText || userText.length > 12_000) {
    throw new Error('Play rehearsal Finish requires user text.');
  }
  if (
    !Number.isSafeInteger(input.baseRevision) ||
    input.baseRevision < 0
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play Finish baseRevision must be a non-negative integer.',
    );
  }
  if (
    !Number.isSafeInteger(input.expectedAttemptRevision) ||
    input.expectedAttemptRevision < 0
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play Finish expectedAttemptRevision must be a non-negative integer.',
    );
  }

  const attempt = await recovery.read(attemptId);
  if (attempt.baseRevision !== input.baseRevision) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      `Play Finish base revision conflict: expected ${attempt.baseRevision}, received ${input.baseRevision}.`,
    );
  }
  if (attempt.sceneBeforeRef !== sidecar.activeSceneRef) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      'Play rehearsal active scene changed after the attempt started.',
    );
  }
  const currentRevision = resolvePlaySessionRevision(
    session,
    session.turnArtifacts,
  );
  const finalizable = assertPlayTurnAttemptFinalizable(attempt, {
    expectedAttemptRevision: input.expectedAttemptRevision,
    selectedHeadRef,
    currentSessionRevision: currentRevision,
  });
  const selectedSteps = resolveSelectedSteps(finalizable);
  const settlement = aggregatePlayTurnAttemptSettlement(session, finalizable);
  const provisionalNarrativeBlocks = selectedSteps.flatMap((step) =>
    step.narrativeBlocks.map((block) => structuredClone(block)));
  const provisionalHostNarrativeBlocks = createProvisionalHostNarrativeBlocks(
    selectedSteps,
    settlement,
  );
  const narrative = formatRehearsalNarrative([
    ...provisionalNarrativeBlocks,
    ...provisionalHostNarrativeBlocks,
  ], sidecar);
  const settled = settlePlayWorldRefereeSettlement({
    session,
    userText,
    actionKind: 'do',
    narrative,
    settlement,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
  const artifactId = settled.selectedTurnIds.at(-1);
  const owningArtifact = artifactId
    ? settled.turnArtifacts.find((artifact) => artifact.id === artifactId)
    : undefined;
  if (!owningArtifact || owningArtifact.artifactKind !== 'worldSettlement') {
    throw new Error('Play rehearsal Finish did not produce a world settlement artifact.');
  }
  const evidenceId = `rehearsal-${owningArtifact.id}`;
  const committedAt = input.createdAt ?? owningArtifact.committedAt;
  const committedProjection = createCommittedNarrativeEvidence(
    selectedSteps,
    owningArtifact,
    settled.events,
    settlement.events.length,
  );
  const narrativeBlocks = [
    ...committedProjection.steps.flatMap((step) =>
      step.narrativeBlocks.map((block) => structuredClone(block))),
    ...committedProjection.hostNarrativeBlocks.map((block) =>
      structuredClone(block)),
  ];
  const evidence: PlayRehearsalTurnEvidence = {
    id: evidenceId,
    owningTurnArtifactId: owningArtifact.id,
    attemptId: finalizable.id,
    selectedStepRefs: [...finalizable.selectedStepRefs],
    steps: committedProjection.steps,
    hostNarrativeBlocks: committedProjection.hostNarrativeBlocks,
    narrativeBlocks,
    finalizeReceipt: {
      idempotencyKey,
      requestFingerprint,
      attemptRevision: finalizable.attemptRevision,
    },
    committedAt,
    canonical: false,
  };
  const rehearsalArtifact: PlayTurnArtifact = {
    ...owningArtifact,
    schemaVersion: PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION,
    rehearsalEvidenceRefs: [evidence.id],
  };
  const scenes = settled.rehearsalScenes?.map((scene) =>
    scene.sceneId === sidecar.activeSceneRef
      ? normalizePlayCommittedSceneEvidence({
          ...scene,
          turns: [...scene.turns, evidence],
        })
      : scene);
  if (!scenes?.some((scene) => scene.sceneId === sidecar.activeSceneRef)) {
    throw new Error('Play rehearsal Finish cannot find its active scene evidence file.');
  }
  const finalizedSession: PlaySession = {
    ...settled,
    schemaVersion: PLAY_REHEARSAL_SESSION_SCHEMA_VERSION,
    sceneRehearsal: sidecar,
    rehearsalScenes: scenes,
    turnArtifacts: settled.turnArtifacts.map((artifact) =>
      artifact.id === rehearsalArtifact.id ? rehearsalArtifact : artifact),
  };
  materializePlayTurnFacts(finalizedSession);
  try {
    await sessionFiles.write(finalizedSession, {
      expectedCurrentSession: commitBaseSession,
    });
  } catch (error) {
    if (error instanceof PlaySessionWriteConflictError) {
      throw new PlayTurnAttemptError(
        'revisionConflict',
        'Play rehearsal session changed at the Finish commit barrier.',
      );
    }
    throw error;
  }
  await recovery.remove(attemptId);
  return {
    session: finalizedSession,
    attempt: markPlayTurnAttemptCommitted(finalizable, {
      artifactRef: rehearsalArtifact.id,
      evidenceRef: evidence.id,
      updatedAt: committedAt,
    }),
    artifact: rehearsalArtifact,
    evidence,
    receipt: evidence.finalizeReceipt,
    replayed: false,
  };
}

function requireRehearsalSession(session: PlaySession) {
  if (
    session.schemaVersion !== PLAY_REHEARSAL_SESSION_SCHEMA_VERSION ||
    !session.sceneRehearsal ||
    !session.rehearsalScenes
  ) {
    throw new Error('Play Scene Rehearsal requires a v5 rehearsal session.');
  }
  return normalizePlaySceneRehearsalSidecar(session.sceneRehearsal);
}

function resolveSelectedSteps(attempt: PlayTurnAttempt): CharacterStepDraft[] {
  const stepsById = new Map(attempt.steps.map((step) => [step.id, step]));
  return attempt.selectedStepRefs.map((stepRef) => {
    const step = stepsById.get(stepRef);
    if (!step || step.status !== 'selected') {
      throw new PlayTurnAttemptError(
        'stepNotFound',
        `Play selected step is unavailable: ${stepRef}.`,
      );
    }
    return step;
  });
}

function createCommittedNarrativeEvidence(
  selectedSteps: CharacterStepDraft[],
  owningArtifact: PlayTurnArtifact,
  sessionEvents: PlaySession['events'],
  expectedEventCount: number,
): {
  steps: PlayCommittedCharacterStepEvidence[];
  hostNarrativeBlocks: NarrativeBlock[];
} {
  const committedEventIds = owningArtifact.eventIds;
  if (committedEventIds.length !== expectedEventCount) {
    throw new Error(
      'Play rehearsal committed event count does not match its aggregated settlement.',
    );
  }
  const eventsById = new Map(sessionEvents.map((event) => [event.id, event]));
  const committedEvents = committedEventIds.map((eventId) => {
    const event = eventsById.get(eventId);
    if (!event) {
      throw new Error(
        `Play rehearsal committed event is missing from the session: ${eventId}.`,
      );
    }
    return event;
  });
  const selectedContributionEventCount = selectedSteps.reduce(
    (count, step) => count + step.settlementContribution.events.length,
    0,
  );
  if (selectedContributionEventCount > committedEvents.length) {
    throw new Error(
      'Play rehearsal selected contributions exceed the committed event sequence.',
    );
  }

  let eventCursor = 0;
  const steps = selectedSteps.map((step) => {
    const contributionEventCount = step.settlementContribution.events.length;
    const stepEvents = committedEvents.slice(
      eventCursor,
      eventCursor + contributionEventCount,
    );
    eventCursor += contributionEventCount;
    const visibleEvents = stepEvents.filter((event) =>
      event.visibility === 'playerVisible');
    return toCommittedStepEvidence(
      step,
      stepEvents.map((event) => event.id),
      visibleEvents,
    );
  });
  const hostEvents = committedEvents.slice(eventCursor);
  if (hostEvents.some((event) => !event.cause.triggerId)) {
    throw new Error(
      'Play rehearsal host event evidence contains a non-hard-due event.',
    );
  }
  const visibleHostEvents = hostEvents.filter((event) =>
    event.visibility === 'playerVisible');
  const hostNarrativeBlocks: NarrativeBlock[] = visibleHostEvents.length
    ? [{
        id: `world-notice-host-${owningArtifact.id}`,
        kind: 'worldNotice',
        content: visibleHostEvents.map((event) =>
          `${event.title}: ${event.summary}`).join('\n'),
        visibility: 'playerVisible',
        projection: 'transcript',
        eventRefs: visibleHostEvents.map((event) => event.id),
        sourceRefs: [],
      }]
    : [];
  return { steps, hostNarrativeBlocks };
}

function createProvisionalHostNarrativeBlocks(
  selectedSteps: CharacterStepDraft[],
  settlement: PlayWorldRefereeSettlement,
): NarrativeBlock[] {
  const selectedContributionEventCount = selectedSteps.reduce(
    (count, step) => count + step.settlementContribution.events.length,
    0,
  );
  const visibleHostEvents = settlement.events
    .slice(selectedContributionEventCount)
    .filter((event) => event.visibility === 'playerVisible');
  return visibleHostEvents.length
    ? [{
        id: 'world-notice-host-pending',
        kind: 'worldNotice',
        content: visibleHostEvents.map((event) =>
          `${event.title}: ${event.summary}`).join('\n'),
        visibility: 'playerVisible',
        projection: 'transcript',
        eventRefs: [],
        sourceRefs: [],
      }]
    : [];
}

function toCommittedStepEvidence(
  step: CharacterStepDraft,
  settlementEventRefs: string[],
  visibleEvents: PlaySession['events'],
): PlayCommittedCharacterStepEvidence {
  const noticeId = `world-notice-${step.id}`;
  const narrativeBlocks = step.narrativeBlocks
    .filter((block) => block.id !== noticeId)
    .map((block) => structuredClone(block));
  if (visibleEvents.length) {
    narrativeBlocks.push({
      id: noticeId,
      kind: 'worldNotice',
      content: visibleEvents.map((event) =>
        `${event.title}: ${event.summary}`).join('\n'),
      visibility: 'playerVisible',
      projection: 'transcript',
      eventRefs: visibleEvents.map((event) => event.id),
      sourceRefs: [],
    });
  }
  return {
    stepRef: step.id,
    participantRef: step.participantRef,
    perceptionRef: step.perceptionRef,
    intentSummary: step.intentSummary,
    narrativeBlocks,
    settlementEventRefs,
    decisionBasisRefs: [...step.decisionBasisRefs],
    ...(step.variantOf ? { variantOf: step.variantOf } : {}),
  };
}

function formatRehearsalNarrative(
  blocks: NarrativeBlock[],
  sidecar: ReturnType<typeof normalizePlaySceneRehearsalSidecar>,
): string {
  const names = new Map(sidecar.participants.map((participant) => [
    participant.participantRef,
    participant.displayName,
  ]));
  const projected = blocks.filter((block) =>
    block.projection === 'transcript' && block.visibility !== 'playerUnknown');
  if (!projected.length) {
    return 'The scene holds for a moment without a player-visible change.';
  }
  return projected.map((block) => {
    const speaker = block.speakerRef ? names.get(block.speakerRef) : undefined;
    return speaker ? `${speaker}: ${block.content}` : block.content;
  }).join('\n\n');
}
