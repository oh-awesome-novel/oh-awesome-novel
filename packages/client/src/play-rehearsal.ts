import type {
  PlayAgendaStatus,
  PlayEventOrigin,
  PlayEventTrigger,
  PlayEventVisibility,
  PlayKnowledgeChange,
  PlayKnowledgeState,
  PlayOutcomeItem,
  PlayOutcomeProjection,
  PlayPressureStatus,
  PlayScheduledEventTemplate,
  PlaySessionV4,
  PlayTurnArtifact,
  PlayWorldClock,
  PlayWorldEventKind,
  PlayWorldMomentum,
} from './index.js';

export type PlaySessionPurpose = 'immersiveJourney' | 'sceneRehearsal';
export type PlayStartMode = 'quick' | 'guided';

export interface PlaySceneValue {
  value: string;
  provenance:
    | { kind: 'sourceBacked'; sourceRefs: string[] }
    | { kind: 'authorProvided'; providedAt: string };
}

export interface PlaySceneContract {
  sceneId: string;
  worldClock: PlayWorldClock;
  clockProvenance:
    | {
        kind: 'sessionRevision';
        sessionId: string;
        revision: number;
        owningTurnRef?: string;
      }
    | {
        kind: 'newSessionInitial';
        sourceRefs: string[];
        authorProvidedAt?: string;
      };
  location?: PlaySceneValue;
  atmosphere?: PlaySceneValue;
  trigger?: PlaySceneValue;
  objective?: PlaySceneValue;
  risk?: PlaySceneValue;
  participantRefs: string[];
  orderStrategy: 'directorFixed' | 'refereeDynamic' | 'hybrid';
}

export interface PlayRehearsalParticipant {
  participantRef: string;
  canonicalCharacterRef?: string;
  displayName: string;
  position?: string;
  emotion?: string;
  currentGoal?: string;
  initialKnowledgeEvidenceRefs: string[];
}

export interface PlaySceneKnowledgeEvidence {
  id: string;
  participantRef: string;
  visibility: PlayEventVisibility;
  fact: string;
  provenance:
    | {
        kind: 'sourceBacked';
        sourceId: string;
        sourcePath: string;
        contentHash: string;
        sourceFactRef?: string;
      }
    | { kind: 'authorProvided'; providedAt: string };
}

export interface PlaySceneRehearsalSidecar {
  schemaVersion: 1;
  sessionId: string;
  purpose: 'sceneRehearsal';
  startMode: PlayStartMode;
  activeSceneRef: string;
  sceneContract: PlaySceneContract;
  participants: PlayRehearsalParticipant[];
  initialKnowledgeEvidence: PlaySceneKnowledgeEvidence[];
}

export type NarrativeBlockKind =
  | 'narrator'
  | 'characterSpeech'
  | 'characterAction'
  | 'worldNotice';

export interface NarrativeBlock {
  id: string;
  kind: NarrativeBlockKind;
  speakerRef?: string;
  content: string;
  visibility: PlayEventVisibility;
  projection: 'transcript' | 'directorOnly';
  eventRefs: string[];
  sourceRefs: string[];
}

export interface PlayCommittedCharacterStepEvidence {
  stepRef: string;
  participantRef: string;
  perceptionRef: string;
  intentSummary: string;
  narrativeBlocks: NarrativeBlock[];
  settlementEventRefs: string[];
  decisionBasisRefs: string[];
  variantOf?: string;
}

export interface PlayRehearsalTurnEvidence {
  id: string;
  owningTurnArtifactId: string;
  attemptId: string;
  selectedStepRefs: string[];
  steps: PlayCommittedCharacterStepEvidence[];
  hostNarrativeBlocks: NarrativeBlock[];
  narrativeBlocks: NarrativeBlock[];
  finalizeReceipt: PlayRehearsalFinalizeReceipt;
  committedAt: string;
  canonical: false;
}

export interface PlayRehearsalFinalizeReceipt {
  idempotencyKey: string;
  requestFingerprint: string;
  attemptRevision: number;
}

export interface PlayCommittedSceneEvidence {
  schemaVersion: 1;
  sessionId: string;
  sceneId: string;
  turns: PlayRehearsalTurnEvidence[];
}

export type PlayRehearsalSessionV5 = Omit<PlaySessionV4, 'schemaVersion'> & {
  schemaVersion: 5;
  sceneRehearsal: PlaySceneRehearsalSidecar;
  rehearsalScenes: PlayCommittedSceneEvidence[];
};

export interface CreatePlaySceneRehearsalSessionInput {
  id?: string;
  title: string;
  sceneStart: string;
  userPersona?: string;
  characters?: string[];
  activatedSources?: PlaySessionV4['activatedSources'];
  eventPolicy?: Partial<PlaySessionV4['eventPolicy']>;
  purpose: 'sceneRehearsal';
  startMode?: PlayStartMode;
  sceneContract: PlaySceneContract;
  participants: PlayRehearsalParticipant[];
  initialKnowledgeEvidence: PlaySceneKnowledgeEvidence[];
  worldMomentum?: PlayWorldMomentum;
}

export interface PlayPressureChange {
  pressureId: string;
  reason: string;
  status?: PlayPressureStatus;
  level?: number;
  nextConsequence?: string | null;
}

export interface PlayAgendaChange {
  agendaId: string;
  reason: string;
  status?: PlayAgendaStatus;
  nextMove?: string | null;
  blockers?: string[];
}

export interface PlayWorldRefereeSettlementEvent {
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
  cause: {
    reason: string;
    sourceTurnIds?: string[];
    sourceEventIds?: string[];
    triggerId?: string;
    pressureId?: string;
    agendaId?: string;
  };
}

export type PlayWorldRefereeScheduledEventChange =
  | {
      type: 'schedule';
      label: string;
      trigger: PlayEventTrigger;
      template: PlayScheduledEventTemplate;
      reason: string;
      priority?: number;
    }
  | { type: 'cancel'; scheduledEventId: string; reason: string }
  | {
      type: 'reschedule';
      scheduledEventId: string;
      trigger: PlayEventTrigger;
      reason: string;
      priority?: number;
    };

export interface PlayWorldRefereeSettlement {
  elapsed?: string;
  worldTimeAnchor?: string;
  events: PlayWorldRefereeSettlementEvent[];
  knowledgeChanges: PlayKnowledgeChange[];
  pressureChanges: PlayPressureChange[];
  agendaChanges: PlayAgendaChange[];
  scheduledEventChanges: PlayWorldRefereeScheduledEventChange[];
  stateDelta: Record<string, unknown>;
  observations: Array<{ summary: string; evidence: string }>;
  suggestedActions: string[];
}

export type PlayTurnAttemptStatus =
  | 'running'
  | 'prepared'
  | 'committed'
  | 'cancelled'
  | 'failed';

export type CharacterStepDraftStatus =
  | 'draft'
  | 'selected'
  | 'superseded'
  | 'discarded';

export interface CharacterStepDraft {
  id: string;
  attemptId: string;
  participantRef: string;
  queueIndex: number;
  beforeStepRef?: string;
  perceptionRef: string;
  intentSummary: string;
  narrativeBlocks: NarrativeBlock[];
  settlementContribution: PlayWorldRefereeSettlement;
  effectFingerprint: string;
  decisionBasisRefs: string[];
  variantOf?: string;
  materialEffect: PlayStepMaterialEffect;
  status: CharacterStepDraftStatus;
  createdAt: string;
}

export type PlayStepMaterialEffect =
  | { kind: 'materialEffect' }
  | { kind: 'noMaterialEffect'; reason: string };

export type PlayDirectorKnowledgeGrant =
  | { kind: 'existingFact'; factRefs: string[] }
  | {
      kind: 'authorProvidedPlayFact';
      summary: string;
      visibility: PlayEventVisibility;
      providedAt: string;
    };

export interface PlayDirectorInterventionBase {
  schemaVersion: 1;
  id: string;
  attemptId: string;
  attemptRevision: number;
  createdAt: string;
  provenance: { actor: 'user'; source: 'directorControl' };
  supersededStepRefs: string[];
}

export type PlayDirectorIntervention = PlayDirectorInterventionBase & (
  | {
      kind: 'reviseProjection';
      stepRef: string;
      replacementStepRef: string;
      replacementBlocks: NarrativeBlock[];
      expectedEffectFingerprint: string;
    }
  | {
      kind: 'redirectStep';
      stepRef: string;
      replacementStepRef: string;
      directorIntent: string;
      authorConstraintRefs: string[];
    }
  | {
      kind: 'insertActor';
      participantRef: string;
      insertionIndex: number;
      beforeStepRef?: string;
      afterStepRef?: string;
    }
  | {
      kind: 'grantKnowledge';
      participantRef: string;
      effectiveFromStepRef: string;
      effectiveFromQueueIndex: number;
      selectedPrefixRefs: string[];
      grant: PlayDirectorKnowledgeGrant;
    }
);

export interface PlayAttemptStagnation {
  consecutiveNoMaterialSteps: number;
  threshold: number;
  warning: boolean;
}

export interface PlayAttemptMutationReceipt {
  idempotencyKey: string;
  requestFingerprint: string;
  resultingAttemptRevision: number;
  resultRef: string;
  responseDigest: string;
}

export interface PlayTurnAttempt {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  baseRevision: number;
  attemptRevision: number;
  sceneBeforeRef: string;
  status: PlayTurnAttemptStatus;
  actorOrder: string[];
  participantRefs: string[];
  orderStrategy: 'directorFixed' | 'refereeDynamic' | 'hybrid';
  selectedStepRefs: string[];
  selectedHeadRef?: string;
  currentStepRef?: string;
  dueScheduledEventIds: string[];
  steps: CharacterStepDraft[];
  interventions: PlayDirectorIntervention[];
  stagnation: PlayAttemptStagnation;
  mutationReceipts: PlayAttemptMutationReceipt[];
  committedArtifactRef?: string;
  committedEvidenceRef?: string;
  createdAt: string;
  updatedAt: string;
}

export type PlayDirectorInterventionInput = PlayAttemptMutationInput & (
  | { kind: 'accept'; stepRef: string }
  | {
      kind: 'reviseProjection';
      stepRef: string;
      replacementBlocks: NarrativeBlock[];
      expectedEffectFingerprint: string;
    }
  | {
      kind: 'redirectStep';
      stepRef: string;
      directorIntent: string;
      authorConstraintRefs: string[];
    }
  | {
      kind: 'insertActor';
      participantRef: string;
      beforeStepRef?: string;
      afterStepRef?: string;
    }
  | {
      kind: 'grantKnowledge';
      participantRef: string;
      effectiveFromStepRef: string;
      grant: PlayDirectorKnowledgeGrant;
    }
);

export interface PlaySceneMemoryArtifact {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  sceneId?: string;
  lens: PlayOutcomeProjection;
  throughRevision: number;
  selectedTurnRefs: string[];
  sourceHashes: Record<string, string>;
  items: PlayOutcomeItem[];
  status: 'current' | 'stale' | 'superseded';
  builtAt: string;
  staleReasons?: Array<
    'sessionRevisionChanged' | 'selectedBranchChanged' | 'sourceHashesChanged'
  >;
}

export type PlayRehearsalAttempt = PlayTurnAttempt;

export interface PlayAttemptMutationInput {
  expectedAttemptRevision: number;
  idempotencyKey: string;
}

export interface PlayAttemptMutationResult {
  attempt: PlayTurnAttempt;
  receipt: PlayAttemptMutationReceipt;
  replayed: boolean;
}

export type PlayRehearsalStepStreamEventBase = {
  eventId: string;
  sequence: number;
  sessionId: string;
  attemptId: string;
  stepRunId: string;
};

export interface PlayRehearsalStepStreamError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type PlayRehearsalStepStreamEvent =
  | (PlayRehearsalStepStreamEventBase & {
      type: 'play.actor.step.started';
      baseAttemptRevision: number;
      participantRef: string;
      mode: 'next' | 'retry';
      sourceStepRef?: string;
    })
  | (PlayRehearsalStepStreamEventBase & {
      type: 'play.actor.step.delta';
      delta: string;
      provisional: true;
    })
  | (PlayRehearsalStepStreamEventBase & {
      type: 'play.actor.step.reset';
      reason: string;
      provisional: true;
    })
  | (PlayRehearsalStepStreamEventBase & {
      type: 'play.actor.step.prepared';
      attempt: PlayTurnAttempt;
      step: CharacterStepDraft;
      receipt: PlayAttemptMutationReceipt;
    })
  | (PlayRehearsalStepStreamEventBase & {
      type: 'play.actor.step.stream-aborted';
      attemptRevision: number;
      committed: false;
      reason: string;
    })
  | (PlayRehearsalStepStreamEventBase & {
      type: 'play.actor.step.failed';
      error: PlayRehearsalStepStreamError;
    });

export interface PlayRehearsalStepStreamInput extends PlayAttemptMutationInput {
  mode: 'next' | 'retry';
  sourceStepRef?: string;
}

export interface PlayRehearsalStepStreamOptions {
  signal?: AbortSignal;
  onStepRunId?(stepRunId: string): void;
}

export type PlayActorStepStreamEvent = PlayRehearsalStepStreamEvent;
export type PlayActorStepStreamInput = PlayRehearsalStepStreamInput;
export type PlayActorStepStreamOptions = PlayRehearsalStepStreamOptions;

export type PlayActorStepCancelResult =
  | { status: 'cancelling'; runId: string }
  | { status: 'aborted'; runId: string }
  | { status: 'committing'; runId: string; tooLateToStop: true }
  | { status: 'prepared'; runId: string; stepRef: string }
  | { status: 'failed'; runId: string; error: string };

export type PlayRehearsalStepStopResult = PlayActorStepCancelResult;

export type PlayRehearsalTurnArtifactV3 = PlayTurnArtifact & {
  schemaVersion: 3;
  artifactKind: 'worldSettlement';
  branchSnapshotVersion: 1;
  rehearsalEvidenceRefs: string[];
};

export interface PlayRehearsalFinalizeResult {
  session: PlayRehearsalSessionV5;
  attempt?: PlayTurnAttempt;
  artifact: PlayRehearsalTurnArtifactV3;
  evidence: PlayRehearsalTurnEvidence;
  receipt: PlayRehearsalFinalizeReceipt;
  replayed: boolean;
}

export interface PlayRehearsalClientMethods {
  createPlayTurnAttempt(
    sessionId: string,
    input: { baseRevision: number },
  ): Promise<{ attempt: PlayTurnAttempt }>;
  getActivePlayTurnAttempt(
    sessionId: string,
  ): Promise<{ attempt: PlayTurnAttempt | null }>;
  getPlayTurnAttempt(
    sessionId: string,
    attemptId: string,
  ): Promise<{ attempt: PlayTurnAttempt }>;
  streamPlayTurnAttemptStep(
    sessionId: string,
    attemptId: string,
    input: PlayRehearsalStepStreamInput,
    options?: PlayRehearsalStepStreamOptions,
  ): AsyncIterable<PlayRehearsalStepStreamEvent>;
  stopPlayTurnAttemptStep(
    sessionId: string,
    attemptId: string,
    stepRunId: string,
  ): Promise<PlayRehearsalStepStopResult>;
  intervenePlayTurnAttempt(
    sessionId: string,
    attemptId: string,
    input: PlayDirectorInterventionInput,
  ): Promise<PlayAttemptMutationResult>;
  finalizePlayTurnAttempt(
    sessionId: string,
    attemptId: string,
    input: PlayAttemptMutationInput & {
      baseRevision: number;
      selectedHeadRef: string;
    },
  ): Promise<PlayRehearsalFinalizeResult>;
  cancelPlayTurnAttempt(
    sessionId: string,
    attemptId: string,
    input: PlayAttemptMutationInput,
  ): Promise<PlayAttemptMutationResult>;
  getPlaySceneMemory(
    sessionId: string,
    lens: PlayOutcomeProjection,
  ): Promise<{ memory: PlaySceneMemoryArtifact | null }>;
  rebuildPlaySceneMemory(
    sessionId: string,
    lens: PlayOutcomeProjection,
  ): Promise<{ memory: PlaySceneMemoryArtifact }>;
  getActivePlayRehearsalAttempt(
    sessionId: string,
  ): Promise<{ attempt: PlayTurnAttempt | null }>;
  createPlayRehearsalAttempt(
    sessionId: string,
    input: { baseRevision: number },
  ): Promise<{ attempt: PlayTurnAttempt }>;
  getPlayRehearsalAttempt(
    sessionId: string,
    attemptId: string,
  ): Promise<{ attempt: PlayTurnAttempt }>;
  streamNextPlayActorStep(
    sessionId: string,
    attemptId: string,
    input: PlayRehearsalStepStreamInput,
    options?: PlayRehearsalStepStreamOptions,
  ): AsyncIterable<PlayRehearsalStepStreamEvent>;
  cancelPlayActorStep(
    sessionId: string,
    attemptId: string,
    stepRunId: string,
  ): Promise<PlayRehearsalStepStopResult>;
  acceptPlayRehearsalStep(
    sessionId: string,
    attemptId: string,
    input: PlayDirectorInterventionInput,
  ): Promise<PlayAttemptMutationResult>;
  finishPlayRehearsalAttempt(
    sessionId: string,
    attemptId: string,
    input: PlayAttemptMutationInput & {
      baseRevision: number;
      selectedHeadRef: string;
    },
  ): Promise<PlayRehearsalFinalizeResult>;
  cancelPlayRehearsalAttempt(
    sessionId: string,
    attemptId: string,
    input: PlayAttemptMutationInput,
  ): Promise<PlayAttemptMutationResult>;
}

export interface PlayRehearsalRequestJson {
  <T>(
    path: string,
    options?: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<T>;
}

export class OanRequestError extends Error {
  override readonly name = 'OanRequestError';
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
  }) {
    super(input.message);
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

export function createOanRequestError(
  response: Pick<Response, 'status'>,
  value: unknown,
  fallbackMessage = 'Request failed.',
): OanRequestError {
  const legacyMessage = isRecord(value) && typeof value.error === 'string'
    ? value.error
    : undefined;
  const structured = isRecord(value) && isRecord(value.error)
    ? value.error
    : isRecord(value) && (
      typeof value.message === 'string' ||
      typeof value.code === 'string' ||
      Object.hasOwn(value, 'details')
    )
      ? value
      : undefined;
  const message = structured && typeof structured.message === 'string'
    ? structured.message
    : legacyMessage ?? fallbackMessage;
  const code = structured && typeof structured.code === 'string'
    ? structured.code
    : undefined;
  const details = structured && Object.hasOwn(structured, 'details')
    ? structured.details
    : undefined;

  return new OanRequestError({
    message,
    status: response.status,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  });
}

interface PlayRehearsalClientFactoryOptions {
  fetcher: typeof fetch;
  backendBaseUrl: string;
  requestJson: PlayRehearsalRequestJson;
  isRehearsalSession(
    value: unknown,
    sessionId: string,
    revision?: number,
  ): value is PlayRehearsalSessionV5;
}

type PlayRehearsalCanonicalClientMethods = Pick<
  PlayRehearsalClientMethods,
  | 'createPlayTurnAttempt'
  | 'getActivePlayTurnAttempt'
  | 'getPlayTurnAttempt'
  | 'streamPlayTurnAttemptStep'
  | 'stopPlayTurnAttemptStep'
  | 'intervenePlayTurnAttempt'
  | 'finalizePlayTurnAttempt'
  | 'cancelPlayTurnAttempt'
  | 'getPlaySceneMemory'
  | 'rebuildPlaySceneMemory'
>;

export function createPlayRehearsalClientMethods(
  options: PlayRehearsalClientFactoryOptions,
): PlayRehearsalClientMethods {
  const attemptPath = (sessionId: string, suffix = '') =>
    `/api/workspace/play-sessions/${encodeURIComponent(assertSafeId(sessionId))}/attempts${suffix}`;

  const methods: PlayRehearsalCanonicalClientMethods = {
    createPlayTurnAttempt: (sessionId, input) =>
      options.requestJson<unknown>(attemptPath(sessionId), {
        method: 'POST',
        body: input,
      }).then((value) => parseAttemptEnvelope(value, sessionId)),
    getActivePlayTurnAttempt: (sessionId) =>
      options.requestJson<unknown>(attemptPath(sessionId, '/active'))
        .then((value) => parseActiveAttemptEnvelope(value, sessionId)),
    getPlayTurnAttempt: (sessionId, attemptId) =>
      options.requestJson<unknown>(attemptPath(
        sessionId,
        `/${encodeURIComponent(assertSafeId(attemptId))}`,
      )).then((value) => parseAttemptEnvelope(value, sessionId, attemptId)),
    streamPlayTurnAttemptStep: (sessionId, attemptId, input, streamOptions) =>
      streamPlayTurnAttemptStepWith(options, sessionId, attemptId, input, streamOptions),
    stopPlayTurnAttemptStep: (sessionId, attemptId, stepRunId) =>
      options.requestJson<unknown>(attemptPath(
        sessionId,
        `/${encodeURIComponent(assertSafeId(attemptId))}/steps/${encodeURIComponent(assertSafeId(stepRunId))}/stop`,
      ), { method: 'POST' }).then((value) => parseStepStopResult(value, stepRunId)),
    intervenePlayTurnAttempt: (sessionId, attemptId, input) =>
      options.requestJson<unknown>(attemptPath(
        sessionId,
        `/${encodeURIComponent(assertSafeId(attemptId))}/interventions`,
      ), { method: 'POST', body: input })
        .then((value) => parseAttemptMutationResult(
          value,
          sessionId,
          attemptId,
          input,
        )),
    getPlaySceneMemory: (sessionId, lens) =>
      options.requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(assertSafeId(sessionId))}` +
        `/memories/${encodeURIComponent(assertMemoryLens(lens))}`,
      ).then((value) => parseSceneMemoryEnvelope(value, sessionId, lens, true)),
    rebuildPlaySceneMemory: (sessionId, lens) =>
      options.requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(assertSafeId(sessionId))}` +
        '/memories/rebuild',
        { method: 'POST', body: { lens: assertMemoryLens(lens) } },
      ).then((value) => parseSceneMemoryEnvelope(value, sessionId, lens, false)),
    finalizePlayTurnAttempt: (sessionId, attemptId, input) =>
      options.requestJson<unknown>(attemptPath(
        sessionId,
        `/${encodeURIComponent(assertSafeId(attemptId))}/finalize`,
      ), { method: 'POST', body: input })
        .then((value) => parseFinalizeResult(
          value,
          sessionId,
          attemptId,
          input,
          options.isRehearsalSession,
        )),
    cancelPlayTurnAttempt: (sessionId, attemptId, input) =>
      options.requestJson<unknown>(attemptPath(
        sessionId,
        `/${encodeURIComponent(assertSafeId(attemptId))}/cancel`,
      ), { method: 'POST', body: input })
        .then((value) => parseAttemptMutationResult(
          value,
          sessionId,
          attemptId,
          input,
        )),
  };
  return {
    ...methods,
    getActivePlayRehearsalAttempt: methods.getActivePlayTurnAttempt,
    createPlayRehearsalAttempt: methods.createPlayTurnAttempt,
    getPlayRehearsalAttempt: methods.getPlayTurnAttempt,
    streamNextPlayActorStep: methods.streamPlayTurnAttemptStep,
    cancelPlayActorStep: methods.stopPlayTurnAttemptStep,
    acceptPlayRehearsalStep: methods.intervenePlayTurnAttempt,
    finishPlayRehearsalAttempt: methods.finalizePlayTurnAttempt,
    cancelPlayRehearsalAttempt: methods.cancelPlayTurnAttempt,
  };
}

async function* streamPlayTurnAttemptStepWith(
  options: PlayRehearsalClientFactoryOptions,
  sessionIdValue: string,
  attemptIdValue: string,
  input: PlayRehearsalStepStreamInput,
  streamOptions: PlayRehearsalStepStreamOptions = {},
): AsyncIterable<PlayRehearsalStepStreamEvent> {
  const sessionId = assertSafeId(sessionIdValue);
  const attemptId = assertSafeId(attemptIdValue);
  assertStepStreamInput(input);
  const response = await options.fetcher(
    `${options.backendBaseUrl}/api/workspace/play-sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/steps/next/stream`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: streamOptions.signal,
    },
  );

  if (!response.ok) {
    throw createOanRequestError(
      response,
      await readJsonResponse(response),
      'Play rehearsal step stream request failed.',
    );
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    throw new Error('Play rehearsal step stream returned an invalid content type.');
  }
  const responseStepRunId = response.headers.get('X-OAN-Play-Step-Run-Id');
  if (!isSafeId(responseStepRunId) || !response.body) {
    throw new Error('Play rehearsal step stream returned no valid step-run identity or body.');
  }
  streamOptions.onStepRunId?.(responseStepRunId);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let started: Extract<
    PlayRehearsalStepStreamEvent,
    { type: 'play.actor.step.started' }
  > | undefined;
  let retryResetSeen = false;
  let terminal = false;
  let expectedSequence = 1;

  const validate = (event: PlayRehearsalStepStreamEvent): void => {
    if (
      event.sessionId !== sessionId ||
      event.attemptId !== attemptId ||
      event.stepRunId !== responseStepRunId ||
      event.sequence !== expectedSequence ||
      event.eventId !== `${responseStepRunId}:${event.sequence}` ||
      terminal
    ) {
      throw new Error('Play rehearsal step stream changed identity, sequence, or terminal state.');
    }
    expectedSequence += 1;
    if (!started) {
      if (
        event.type !== 'play.actor.step.started' ||
        event.baseAttemptRevision !== input.expectedAttemptRevision ||
        event.mode !== input.mode ||
        event.sourceStepRef !== input.sourceStepRef
      ) {
        throw new Error('Play rehearsal step stream returned inconsistent start metadata.');
      }
      started = event;
      return;
    }
    if (event.type === 'play.actor.step.started') {
      throw new Error('Play rehearsal step stream emitted more than one start event.');
    }
    if (event.type === 'play.actor.step.reset') {
      if (started.mode !== 'retry' || retryResetSeen) {
        throw new Error('Play rehearsal step stream returned an inconsistent reset sequence.');
      }
      retryResetSeen = true;
      return;
    }
    if (started.mode === 'retry' && !retryResetSeen) {
      throw new Error('Play rehearsal retry stream did not reset before producing output.');
    }
    if (event.type === 'play.actor.step.prepared') {
      const isFreshPreparedSnapshot =
        event.attempt.attemptRevision === event.receipt.resultingAttemptRevision &&
        event.attempt.currentStepRef === event.step.id &&
        event.step.status === 'draft';
      if (
        event.attempt.id !== attemptId ||
        event.attempt.sessionId !== sessionId ||
        event.step.attemptId !== attemptId ||
        event.step.participantRef !== started.participantRef ||
        event.step.variantOf !== input.sourceStepRef ||
        !event.attempt.steps.some((step) =>
          step.id === event.step.id && isDeepEqualJson(step, event.step)) ||
        event.receipt.idempotencyKey !== input.idempotencyKey ||
        event.receipt.resultingAttemptRevision > event.attempt.attemptRevision ||
        (
          event.receipt.resultingAttemptRevision === event.attempt.attemptRevision &&
          !isFreshPreparedSnapshot
        ) ||
        (
          isFreshPreparedSnapshot &&
          event.receipt.resultingAttemptRevision !== started.baseAttemptRevision + 1
        ) ||
        event.receipt.resultRef !== event.step.id ||
        !event.attempt.mutationReceipts.some((receipt) =>
          receipt.idempotencyKey === event.receipt.idempotencyKey
          && isDeepEqualJson(receipt, event.receipt))
      ) {
        throw new Error('Play rehearsal step stream prepared an inconsistent step.');
      }
      terminal = true;
    } else if (event.type === 'play.actor.step.stream-aborted') {
      if (
        event.attemptRevision !== started.baseAttemptRevision ||
        event.committed !== false
      ) {
        throw new Error('Play rehearsal step stream returned an inconsistent abort.');
      }
      terminal = true;
    } else if (event.type === 'play.actor.step.failed') {
      terminal = true;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      while (true) {
        const boundary = /\r?\n\r?\n/u.exec(buffer);
        if (!boundary || boundary.index === undefined) break;
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const parsed = parseStepSseBlock(block);
        if (parsed.done) {
          if (!started || !terminal) {
            throw new Error('Play rehearsal step stream ended before a terminal event.');
          }
          completed = true;
          return;
        }
        if (parsed.event) {
          validate(parsed.event);
          yield parsed.event;
        }
      }

      if (done) {
        if (buffer.trim()) {
          const parsed = parseStepSseBlock(buffer);
          if (parsed.done) {
            if (!started || !terminal) {
              throw new Error('Play rehearsal step stream ended before a terminal event.');
            }
            completed = true;
            return;
          }
          if (parsed.event) {
            validate(parsed.event);
            yield parsed.event;
          }
        }
        throw new Error('Play rehearsal step stream ended without [DONE].');
      }
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseStepSseBlock(block: string): {
  done: boolean;
  event?: PlayRehearsalStepStreamEvent;
} {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return { done: false };
  if (data === '[DONE]') return { done: true };

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new Error('Play rehearsal step stream returned invalid JSON.');
  }
  if (!isStepStreamEvent(value)) {
    throw new Error('Play rehearsal step stream returned an invalid event.');
  }
  return { done: false, event: value };
}

function isStepStreamEvent(value: unknown): value is PlayRehearsalStepStreamEvent {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.eventId) ||
    !isPositiveInteger(value.sequence) ||
    !isSafeId(value.sessionId) ||
    !isSafeId(value.attemptId) ||
    !isSafeId(value.stepRunId) ||
    typeof value.type !== 'string'
  ) return false;

  const baseFields = ['type', 'eventId', 'sequence', 'sessionId', 'attemptId', 'stepRunId'];
  switch (value.type) {
    case 'play.actor.step.started':
      return hasOnlyKnownFields(value, [
        ...baseFields,
        'baseAttemptRevision',
        'participantRef',
        'mode',
        'sourceStepRef',
      ]) && isNonNegativeInteger(value.baseAttemptRevision)
        && isSafeId(value.participantRef)
        && (value.mode === 'next' || value.mode === 'retry')
        && (value.sourceStepRef === undefined || isSafeId(value.sourceStepRef))
        && ((value.mode === 'next' && value.sourceStepRef === undefined)
          || (value.mode === 'retry' && isSafeId(value.sourceStepRef)));
    case 'play.actor.step.delta':
      return hasOnlyKnownFields(value, [...baseFields, 'delta', 'provisional'])
        && typeof value.delta === 'string'
        && value.provisional === true;
    case 'play.actor.step.reset':
      return hasOnlyKnownFields(value, [...baseFields, 'reason', 'provisional'])
        && isNonEmptyString(value.reason)
        && value.provisional === true;
    case 'play.actor.step.prepared':
      return hasOnlyKnownFields(value, [...baseFields, 'attempt', 'step', 'receipt'])
        && isPlayTurnAttempt(value.attempt)
        && isCharacterStepDraft(value.step)
        && isAttemptReceipt(value.receipt);
    case 'play.actor.step.stream-aborted':
      return hasOnlyKnownFields(value, [
        ...baseFields,
        'attemptRevision',
        'committed',
        'reason',
      ]) && isNonNegativeInteger(value.attemptRevision)
        && value.committed === false
        && isNonEmptyString(value.reason);
    case 'play.actor.step.failed':
      return hasOnlyKnownFields(value, [...baseFields, 'error'])
        && isStreamError(value.error);
    default:
      return false;
  }
}

export function isPlayRehearsalSessionEnvelope(
  value: unknown,
  sessionId: unknown,
  revision: number | undefined,
  isLegacySession: (
    value: unknown,
    sessionId: unknown,
    revision?: number,
  ) => boolean,
): value is PlayRehearsalSessionV5 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 5 ||
    !hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'title',
      'createdAt',
      'revision',
      'userPersona',
      'sceneStart',
      'characters',
      'transcript',
      'turnArtifacts',
      'selectedTurnIds',
      'branchSnapshotRequiredFromRevision',
      'branchBaseSnapshot',
      'metadataExtensions',
      'playLocalState',
      'playLocalStateVisibility',
      'worldClock',
      'eventPolicy',
      'events',
      'scheduledEvents',
      'suggestedActions',
      'activatedSources',
      'observations',
      'adoptionCandidates',
      'sceneRehearsal',
      'rehearsalScenes',
    ]) ||
    !Array.isArray(value.turnArtifacts) ||
    !isSceneRehearsalSidecar(value.sceneRehearsal, value.id) ||
    !isCommittedSceneEvidenceList(value.rehearsalScenes, value.id)
  ) return false;

  const projection = createLegacySessionProjection(value);
  if (!isLegacySession(projection, sessionId, revision)) return false;

  const session = value as unknown as PlayRehearsalSessionV5;
  const sidecar = session.sceneRehearsal;
  const scenes = session.rehearsalScenes;
  if (
    scenes.length !== 1 ||
    scenes[0]?.sceneId !== sidecar.activeSceneRef ||
    sidecar.sceneContract.worldClock.turn !== session.branchBaseSnapshot.worldClock.turn ||
    sidecar.sceneContract.worldClock.revision !== session.branchBaseSnapshot.worldClock.revision ||
    (
      sidecar.sceneContract.clockProvenance.kind === 'sessionRevision' &&
      (
        sidecar.sceneContract.clockProvenance.sessionId !== session.id ||
        sidecar.sceneContract.clockProvenance.revision !==
          sidecar.sceneContract.worldClock.revision
      )
    )
  ) return false;

  const allEvidence = scenes.flatMap((scene) => scene.turns);
  const evidenceById = new Map(allEvidence.map((turn) => [turn.id, turn]));
  if (evidenceById.size !== allEvidence.length) return false;
  const referencedEvidence = new Set<string>();
  const artifactsById = new Map(session.turnArtifacts.map((artifact) => [artifact.id, artifact]));
  const eventsById = new Map(session.events.map((event) => [event.id, event]));
  const knowledgeState = Object.hasOwn(session.playLocalState, 'playKnowledge')
    ? session.playLocalState.playKnowledge as PlayKnowledgeState
    : { schemaVersion: 1 as const, records: [] };
  if (knowledgeState.records.some((record) =>
    record.kind === 'participantGrant' &&
    !sidecar.participants.some((participant) =>
      participant.participantRef === record.participantRef))) return false;
  for (const artifact of session.turnArtifacts) {
    if (!isRehearsalArtifactV3(artifact)) return false;
    const owningEventRefs = new Set(artifact.eventIds);
    const allowedEventRefs = new Set<string>();
    const allowedTurnRefs = new Set<string>();
    const visitedAncestors = new Set<string>();
    let ancestor: PlayTurnArtifact | undefined = artifact;
    while (ancestor) {
      if (visitedAncestors.has(ancestor.id)) return false;
      visitedAncestors.add(ancestor.id);
      for (const eventRef of ancestor.eventIds) allowedEventRefs.add(eventRef);
      for (const message of ancestor.messages) {
        if (message.id) allowedTurnRefs.add(message.id);
      }
      ancestor = ancestor.parentTurnId
        ? artifactsById.get(ancestor.parentTurnId)
        : undefined;
    }
    for (const evidenceRef of artifact.rehearsalEvidenceRefs) {
      const evidence = evidenceById.get(evidenceRef);
      if (
        !evidence ||
        evidence.owningTurnArtifactId !== artifact.id ||
        referencedEvidence.has(evidenceRef) ||
        evidence.steps.length !== sidecar.participants.length
      ) return false;
      const evidenceParticipantRefs = evidence.steps.map((step) => step.participantRef);
      if (
        new Set(evidenceParticipantRefs).size !== evidenceParticipantRefs.length ||
        sidecar.participants.some((participant) =>
          !evidenceParticipantRefs.includes(participant.participantRef))
      ) return false;
      const stepSettlementEventRefs: string[] = [];
      for (const step of evidence.steps) {
        const participant = sidecar.participants.find((candidate) =>
          candidate.participantRef === step.participantRef);
        if (!participant) return false;
        const allowedKnowledgeRefs = new Set(participant.initialKnowledgeEvidenceRefs);
        for (const record of knowledgeState.records) {
          if (
            record.kind !== 'participantGrant' ||
            record.participantRef !== participant.participantRef ||
            !allowedTurnRefs.has(record.grantedAtTurnId)
          ) continue;
          allowedKnowledgeRefs.add(deriveParticipantKnowledgeEvidenceId(
            record.interventionRef,
          ));
          if (record.grant.kind === 'existingFact') {
            for (const factRef of record.grant.factRefs) {
              allowedKnowledgeRefs.add(factRef);
            }
          }
        }
        if (step.decisionBasisRefs.some((ref) => !allowedKnowledgeRefs.has(ref))) return false;
        if (step.settlementEventRefs.some((ref) => {
          const event = eventsById.get(ref);
          return !owningEventRefs.has(ref) ||
            !event ||
            event.cause.triggerId !== undefined;
        })) return false;
        stepSettlementEventRefs.push(...step.settlementEventRefs);
        const expectedStepWorldNoticeEventRefs = step.settlementEventRefs.filter(
          (ref) => eventsById.get(ref)!.visibility === 'playerVisible',
        );
        const worldNotices = step.narrativeBlocks.filter((block) =>
          block.kind === 'worldNotice');
        if (
          worldNotices.length !== (expectedStepWorldNoticeEventRefs.length ? 1 : 0) ||
          worldNotices.some((block) =>
            block.id !== `world-notice-${step.stepRef}` ||
            block.speakerRef !== undefined ||
            block.visibility !== 'playerVisible' ||
            block.projection !== 'transcript' ||
            block.sourceRefs.length !== 0 ||
            block.eventRefs.length === 0 ||
            block.eventRefs.some((ref) => !owningEventRefs.has(ref)))
        ) return false;
        for (const block of step.narrativeBlocks) {
          if (
            (
              (block.kind === 'characterSpeech' || block.kind === 'characterAction') &&
              block.speakerRef !== participant.participantRef
            ) ||
            block.sourceRefs.some((ref) => !allowedKnowledgeRefs.has(ref)) ||
            block.eventRefs.some((ref) => {
              const event = eventsById.get(ref);
              return !allowedEventRefs.has(ref) ||
                !event ||
                !doesPlayVisibilityCover(block.visibility, event.visibility);
            })
          ) return false;
          if (block.kind === 'worldNotice') {
            const events = block.eventRefs.map((ref) => eventsById.get(ref)!);
            if (
              !arraysEqual(block.eventRefs, expectedStepWorldNoticeEventRefs) ||
              block.content !== events.map((event) =>
                `${event.title}: ${event.summary}`).join('\n')
            ) return false;
          }
        }
      }
      const expectedStepSettlementEventRefs = artifact.eventIds.filter((ref) => {
        const event = eventsById.get(ref);
        return event && !event.cause.triggerId;
      });
      if (!arraysEqual(
        stepSettlementEventRefs,
        expectedStepSettlementEventRefs,
      )) return false;
      const hostNarrativeBlocks = evidence.hostNarrativeBlocks;
      const expectedHostEventRefs = artifact.eventIds.filter((ref) => {
        const event = eventsById.get(ref);
        return event?.visibility === 'playerVisible' && Boolean(event.cause.triggerId);
      });
      if (hostNarrativeBlocks.length !== (expectedHostEventRefs.length ? 1 : 0)) {
        return false;
      }
      if (hostNarrativeBlocks.some((block) => {
        const expectedContent = expectedHostEventRefs.map((ref) => {
          const event = eventsById.get(ref)!;
          return `${event.title}: ${event.summary}`;
        }).join('\n');
        return block.id !== `world-notice-host-${artifact.id}` ||
          block.kind !== 'worldNotice' ||
          block.speakerRef !== undefined ||
          block.visibility !== 'playerVisible' ||
          block.projection !== 'transcript' ||
          block.sourceRefs.length !== 0 ||
          !arraysEqual(block.eventRefs, expectedHostEventRefs) ||
          block.content !== expectedContent;
      })) return false;
      referencedEvidence.add(evidenceRef);
    }
  }
  return referencedEvidence.size === evidenceById.size;
}

function createLegacySessionProjection(value: Record<string, unknown>): Record<string, unknown> {
  const projection: Record<string, unknown> = { ...value, schemaVersion: 4 };
  delete projection.sceneRehearsal;
  delete projection.rehearsalScenes;
  projection.turnArtifacts = (value.turnArtifacts as unknown[]).map((artifact) => {
    if (!isRecord(artifact) || artifact.schemaVersion !== 3) return artifact;
    const downgraded: Record<string, unknown> = { ...artifact, schemaVersion: 2 };
    delete downgraded.rehearsalEvidenceRefs;
    return downgraded;
  });
  return projection;
}

function isSceneRehearsalSidecar(
  value: unknown,
  sessionId: unknown,
): value is PlaySceneRehearsalSidecar {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'schemaVersion',
      'sessionId',
      'purpose',
      'startMode',
      'activeSceneRef',
      'sceneContract',
      'participants',
      'initialKnowledgeEvidence',
    ]) ||
    value.schemaVersion !== 1 ||
    value.sessionId !== sessionId ||
    value.purpose !== 'sceneRehearsal' ||
    (value.startMode !== 'quick' && value.startMode !== 'guided') ||
    !isSafeId(value.activeSceneRef) ||
    !isSceneContract(value.sceneContract) ||
    value.sceneContract.sceneId !== value.activeSceneRef ||
    !Array.isArray(value.participants) ||
    value.participants.length === 0 ||
    value.participants.length > 24 ||
    !value.participants.every(isRehearsalParticipant) ||
    !hasUniqueIds(value.participants, 'participantRef') ||
    !Array.isArray(value.initialKnowledgeEvidence) ||
    value.initialKnowledgeEvidence.length > 128 ||
    !value.initialKnowledgeEvidence.every(isKnowledgeEvidence) ||
    !hasUniqueIds(value.initialKnowledgeEvidence, 'id')
  ) return false;

  const participantRefs = value.participants.map((item) => item.participantRef);
  if (!arraysEqual(participantRefs, value.sceneContract.participantRefs)) return false;
  const participantsByRef = new Map(value.participants.map((item) => [item.participantRef, item]));
  const evidenceById = new Map(value.initialKnowledgeEvidence.map((item) => [item.id, item]));
  const assigned = new Set<string>();
  for (const evidence of value.initialKnowledgeEvidence) {
    if (!participantsByRef.has(evidence.participantRef)) return false;
  }
  for (const participant of value.participants) {
    for (const evidenceRef of participant.initialKnowledgeEvidenceRefs) {
      const evidence = evidenceById.get(evidenceRef);
      if (!evidence || evidence.participantRef !== participant.participantRef || assigned.has(evidenceRef)) {
        return false;
      }
      assigned.add(evidenceRef);
    }
  }
  return assigned.size === evidenceById.size;
}

function isSceneContract(value: unknown): value is PlaySceneContract {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'sceneId',
      'worldClock',
      'clockProvenance',
      'location',
      'atmosphere',
      'trigger',
      'objective',
      'risk',
      'participantRefs',
      'orderStrategy',
    ]) ||
    !isSafeId(value.sceneId) ||
    !isWorldClock(value.worldClock) ||
    !isClockProvenance(value.clockProvenance) ||
    !isUniqueSafeIdArray(value.participantRefs) ||
    value.participantRefs.length === 0 ||
    value.participantRefs.length > 24 ||
    (
      value.orderStrategy !== 'directorFixed' &&
      value.orderStrategy !== 'refereeDynamic' &&
      value.orderStrategy !== 'hybrid'
    )
  ) return false;
  return ['location', 'atmosphere', 'trigger', 'objective', 'risk'].every((field) =>
    value[field] === undefined || isSceneValue(value[field]));
}

function isClockProvenance(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'sessionRevision') {
    return hasOnlyKnownFields(value, ['kind', 'sessionId', 'revision', 'owningTurnRef'])
      && isSafeId(value.sessionId)
      && isNonNegativeInteger(value.revision)
      && (value.owningTurnRef === undefined || isSafeId(value.owningTurnRef));
  }
  return value.kind === 'newSessionInitial'
    && hasOnlyKnownFields(value, ['kind', 'sourceRefs', 'authorProvidedAt'])
    && isUniqueSafeIdArray(value.sourceRefs)
    && (value.authorProvidedAt === undefined || isNonEmptyString(value.authorProvidedAt));
}

function isSceneValue(value: unknown): value is PlaySceneValue {
  if (!isRecord(value) || !hasOnlyKnownFields(value, ['value', 'provenance']) || !isNonEmptyString(value.value)) {
    return false;
  }
  const provenance = value.provenance;
  if (!isRecord(provenance)) return false;
  if (provenance.kind === 'sourceBacked') {
    return hasOnlyKnownFields(provenance, ['kind', 'sourceRefs'])
      && isUniqueSafeIdArray(provenance.sourceRefs);
  }
  return provenance.kind === 'authorProvided'
    && hasOnlyKnownFields(provenance, ['kind', 'providedAt'])
    && isNonEmptyString(provenance.providedAt);
}

function isRehearsalParticipant(value: unknown): value is PlayRehearsalParticipant {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'participantRef',
      'canonicalCharacterRef',
      'displayName',
      'position',
      'emotion',
      'currentGoal',
      'initialKnowledgeEvidenceRefs',
    ])
    && isSafeId(value.participantRef)
    && (value.canonicalCharacterRef === undefined || isSafeId(value.canonicalCharacterRef))
    && isNonEmptyString(value.displayName)
    && ['position', 'emotion', 'currentGoal'].every((field) =>
      value[field] === undefined || isNonEmptyString(value[field]))
    && isUniqueSafeIdArray(value.initialKnowledgeEvidenceRefs);
}

function isKnowledgeEvidence(value: unknown): value is PlaySceneKnowledgeEvidence {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['id', 'participantRef', 'visibility', 'fact', 'provenance']) ||
    !isSafeId(value.id) ||
    !isSafeId(value.participantRef) ||
    !isVisibility(value.visibility) ||
    !isNonEmptyString(value.fact) ||
    !isRecord(value.provenance)
  ) return false;
  if (value.provenance.kind === 'sourceBacked') {
    return hasOnlyKnownFields(value.provenance, [
      'kind',
      'sourceId',
      'sourcePath',
      'contentHash',
      'sourceFactRef',
    ]) && isSafeId(value.provenance.sourceId)
      && isSafeRelativePath(value.provenance.sourcePath)
      && isNonEmptyString(value.provenance.contentHash)
      && (value.provenance.sourceFactRef === undefined
        || isSafeId(value.provenance.sourceFactRef));
  }
  return value.provenance.kind === 'authorProvided'
    && hasOnlyKnownFields(value.provenance, ['kind', 'providedAt'])
    && isNonEmptyString(value.provenance.providedAt);
}

function isCommittedSceneEvidenceList(
  value: unknown,
  sessionId: unknown,
): value is PlayCommittedSceneEvidence[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 128
    && value.every((scene) => isCommittedSceneEvidence(scene, sessionId))
    && hasUniqueIds(value, 'sceneId');
}

function isCommittedSceneEvidence(
  value: unknown,
  sessionId: unknown,
): value is PlayCommittedSceneEvidence {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['schemaVersion', 'sessionId', 'sceneId', 'turns'])
    && value.schemaVersion === 1
    && value.sessionId === sessionId
    && isSafeId(value.sceneId)
    && Array.isArray(value.turns)
    && value.turns.length <= 512
    && value.turns.every(isTurnEvidence)
    && hasUniqueIds(value.turns, 'id')
    && hasUniqueIds(value.turns, 'owningTurnArtifactId');
}

function isTurnEvidence(value: unknown): value is PlayRehearsalTurnEvidence {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'owningTurnArtifactId',
      'attemptId',
      'selectedStepRefs',
      'steps',
      'hostNarrativeBlocks',
      'narrativeBlocks',
      'finalizeReceipt',
      'committedAt',
      'canonical',
    ]) ||
    !isSafeId(value.id) ||
    !isSafeId(value.owningTurnArtifactId) ||
    !isSafeId(value.attemptId) ||
    !isUniqueSafeIdArray(value.selectedStepRefs) ||
    !Array.isArray(value.steps) ||
    value.steps.length > 48 ||
    !value.steps.every(isCommittedStepEvidence) ||
    !Array.isArray(value.hostNarrativeBlocks) ||
    value.hostNarrativeBlocks.length > 96 ||
    !value.hostNarrativeBlocks.every(isNarrativeBlock) ||
    !hasUniqueIds(value.hostNarrativeBlocks, 'id') ||
    !Array.isArray(value.narrativeBlocks) ||
    value.narrativeBlocks.length > 96 ||
    !value.narrativeBlocks.every(isNarrativeBlock) ||
    !hasUniqueIds(value.narrativeBlocks, 'id') ||
    !isFinalizeReceipt(value.finalizeReceipt) ||
    !isNonEmptyString(value.committedAt) ||
    value.canonical !== false
  ) return false;
  const stepRefs = value.steps.map((step) => step.stepRef);
  const stepBlocks = [
    ...value.steps.flatMap((step) => step.narrativeBlocks),
    ...value.hostNarrativeBlocks,
  ];
  return arraysEqual(value.selectedStepRefs, stepRefs)
    && value.narrativeBlocks.length === stepBlocks.length
    && value.narrativeBlocks.every((block, index) =>
      isDeepEqualJson(block, stepBlocks[index]));
}

function isCommittedStepEvidence(value: unknown): value is PlayCommittedCharacterStepEvidence {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'stepRef',
      'participantRef',
      'perceptionRef',
      'intentSummary',
      'narrativeBlocks',
      'settlementEventRefs',
      'decisionBasisRefs',
      'variantOf',
    ])
    && isSafeId(value.stepRef)
    && isSafeId(value.participantRef)
    && isSafeId(value.perceptionRef)
    && isNonEmptyString(value.intentSummary)
    && Array.isArray(value.narrativeBlocks)
    && value.narrativeBlocks.length <= 96
    && value.narrativeBlocks.every(isNarrativeBlock)
    && hasUniqueIds(value.narrativeBlocks, 'id')
    && isUniqueSafeIdArray(value.settlementEventRefs)
    && isUniqueSafeIdArray(value.decisionBasisRefs)
    && (value.variantOf === undefined || isSafeId(value.variantOf));
}

function isFinalizeReceipt(value: unknown): value is PlayRehearsalFinalizeReceipt {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['idempotencyKey', 'requestFingerprint', 'attemptRevision'])
    && isSafeId(value.idempotencyKey)
    && isNonEmptyString(value.requestFingerprint)
    && isNonNegativeInteger(value.attemptRevision);
}

function isRehearsalArtifactV3(
  value: unknown,
): value is PlayRehearsalTurnArtifactV3 {
  return isRecord(value)
    && value.schemaVersion === 3
    && value.artifactKind === 'worldSettlement'
    && value.branchSnapshotVersion === 1
    && isUniqueSafeIdArray(value.rehearsalEvidenceRefs)
    && value.rehearsalEvidenceRefs.length > 0;
}

export function isPlayTurnAttempt(value: unknown): value is PlayTurnAttempt {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'sessionId',
      'baseRevision',
      'attemptRevision',
      'sceneBeforeRef',
      'status',
      'actorOrder',
      'participantRefs',
      'orderStrategy',
      'selectedStepRefs',
      'selectedHeadRef',
      'currentStepRef',
      'dueScheduledEventIds',
      'steps',
      'interventions',
      'stagnation',
      'mutationReceipts',
      'committedArtifactRef',
      'committedEvidenceRef',
      'createdAt',
      'updatedAt',
    ]) ||
    value.schemaVersion !== 1 ||
    !isSafeId(value.id) ||
    !isSafeId(value.sessionId) ||
    !isNonNegativeInteger(value.baseRevision) ||
    !isNonNegativeInteger(value.attemptRevision) ||
    !isSafeId(value.sceneBeforeRef) ||
    !isAttemptStatus(value.status) ||
    !isUniqueSafeIdArray(value.actorOrder) ||
    value.actorOrder.length === 0 ||
    value.actorOrder.length > 24 ||
    !isUniqueSafeIdArray(value.participantRefs) ||
    value.participantRefs.length === 0 ||
    value.participantRefs.length > 24 ||
    value.actorOrder.some((participantRef) =>
      !(value.participantRefs as string[]).includes(participantRef)) ||
    (
      value.orderStrategy !== 'directorFixed' &&
      value.orderStrategy !== 'refereeDynamic' &&
      value.orderStrategy !== 'hybrid'
    ) ||
    !isUniqueSafeIdArray(value.selectedStepRefs) ||
    value.selectedStepRefs.length > value.actorOrder.length ||
    (value.selectedHeadRef === undefined
      ? value.selectedStepRefs.length !== 0
      : value.selectedHeadRef !== value.selectedStepRefs.at(-1)) ||
    (value.currentStepRef !== undefined && !isSafeId(value.currentStepRef)) ||
    !isUniqueSafeIdArray(value.dueScheduledEventIds) ||
    !Array.isArray(value.steps) ||
    value.steps.length > 96 ||
    !value.steps.every((step) => isCharacterStepDraft(step, value.id as string)) ||
    !hasUniqueIds(value.steps, 'id') ||
    !Array.isArray(value.interventions) ||
    value.interventions.length > 256 ||
    !value.interventions.every((intervention) =>
      isPlayDirectorIntervention(intervention, value.id as string)) ||
    !hasUniqueIds(value.interventions, 'id') ||
    !isPlayAttemptStagnation(value.stagnation) ||
    !Array.isArray(value.mutationReceipts) ||
    value.mutationReceipts.length > 256 ||
    !value.mutationReceipts.every(isAttemptReceipt) ||
    !hasUniqueIds(value.mutationReceipts, 'idempotencyKey') ||
    value.mutationReceipts.length !== value.attemptRevision ||
    value.mutationReceipts.some((receipt, index) =>
      receipt.resultingAttemptRevision !== index + 1) ||
    (value.committedArtifactRef !== undefined && !isSafeId(value.committedArtifactRef)) ||
    (value.committedEvidenceRef !== undefined && !isSafeId(value.committedEvidenceRef)) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt)
  ) return false;

  const attempt = value as unknown as PlayTurnAttempt;
  if (value.status === 'committed') {
    if (!value.committedArtifactRef || !value.committedEvidenceRef) return false;
  } else if (value.committedArtifactRef || value.committedEvidenceRef) {
    return false;
  }

  const stepsById = new Map(attempt.steps.map((step) => [step.id, step]));
  const selectedStepSet = new Set(attempt.selectedStepRefs);
  for (const [index, stepRef] of attempt.selectedStepRefs.entries()) {
    const step = stepsById.get(stepRef);
    if (
      !step ||
      step.status !== 'selected' ||
      step.queueIndex !== index ||
      step.participantRef !== attempt.actorOrder[index] ||
      step.beforeStepRef !== (index === 0 ? undefined : attempt.selectedStepRefs[index - 1])
    ) return false;
  }
  const current = attempt.currentStepRef ? stepsById.get(attempt.currentStepRef) : undefined;
  if (attempt.currentStepRef && (
    !current ||
    current.status !== 'draft' ||
    current.queueIndex !== attempt.selectedStepRefs.length ||
    current.participantRef !== attempt.actorOrder[attempt.selectedStepRefs.length]
  )) return false;
  for (const step of attempt.steps) {
    const live = step.status === 'selected' || step.status === 'draft';
    const expectedBeforeRef = step.queueIndex === 0
      ? undefined
      : attempt.selectedStepRefs[step.queueIndex - 1];
    if (
      step.queueIndex >= attempt.participantRefs.length ||
      !attempt.participantRefs.includes(step.participantRef) ||
      (live && step.beforeStepRef !== expectedBeforeRef) ||
      ((step.status === 'selected') !== selectedStepSet.has(step.id)) ||
      ((step.status === 'draft') !== (step.id === attempt.currentStepRef)) ||
      !hasCompatibleStepVariant(step, stepsById)
    ) return false;
  }

  let previousInterventionRevision = 0;
  for (const intervention of attempt.interventions) {
    if (
      intervention.attemptRevision <= previousInterventionRevision ||
      intervention.attemptRevision > attempt.attemptRevision ||
      intervention.supersededStepRefs.some((stepRef) => {
        const step = stepsById.get(stepRef);
        return !step || (step.status !== 'superseded' && step.status !== 'discarded');
      }) ||
      !hasConsistentInterventionSteps(intervention, stepsById)
    ) return false;
    previousInterventionRevision = intervention.attemptRevision;
  }

  let consecutiveNoMaterialSteps = 0;
  for (const stepRef of [...attempt.selectedStepRefs].reverse()) {
    if (stepsById.get(stepRef)?.materialEffect.kind !== 'noMaterialEffect') break;
    consecutiveNoMaterialSteps += 1;
  }
  if (
    attempt.stagnation.consecutiveNoMaterialSteps !== consecutiveNoMaterialSteps ||
    attempt.stagnation.warning !==
      (consecutiveNoMaterialSteps >= attempt.stagnation.threshold)
  ) return false;

  return !(
    (attempt.status === 'prepared' &&
      attempt.selectedStepRefs.length !== attempt.actorOrder.length) ||
    (attempt.status === 'running' &&
      attempt.selectedStepRefs.length >= attempt.actorOrder.length) ||
    ((attempt.status === 'prepared' || attempt.status === 'committed') &&
      (
        attempt.selectedStepRefs.length !== attempt.actorOrder.length ||
        attempt.currentStepRef !== undefined
      )) ||
    (attempt.status !== 'running' && attempt.status !== 'prepared' &&
      attempt.currentStepRef !== undefined)
  );
}

function isCharacterStepDraft(
  value: unknown,
  expectedAttemptId?: string,
): value is CharacterStepDraft {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'id',
      'attemptId',
      'participantRef',
      'queueIndex',
      'beforeStepRef',
      'perceptionRef',
      'intentSummary',
      'narrativeBlocks',
      'settlementContribution',
      'effectFingerprint',
      'decisionBasisRefs',
      'variantOf',
      'materialEffect',
      'status',
      'createdAt',
    ])
    && isSafeId(value.id)
    && isSafeId(value.attemptId)
    && (expectedAttemptId === undefined || value.attemptId === expectedAttemptId)
    && isSafeId(value.participantRef)
    && isNonNegativeInteger(value.queueIndex)
    && (value.beforeStepRef === undefined || isSafeId(value.beforeStepRef))
    && isSafeId(value.perceptionRef)
    && isNonEmptyString(value.intentSummary)
    && Array.isArray(value.narrativeBlocks)
    && value.narrativeBlocks.length <= 96
    && value.narrativeBlocks.every(isNarrativeBlock)
    && hasUniqueIds(value.narrativeBlocks, 'id')
    && isSettlement(value.settlementContribution)
    && isSha256Hex(value.effectFingerprint)
    && isUniqueSafeIdArray(value.decisionBasisRefs)
    && (value.variantOf === undefined || isSafeId(value.variantOf))
    && isPlayStepMaterialEffect(value.materialEffect)
    && isStepStatus(value.status)
    && isNonEmptyString(value.createdAt)
    && hasValidProvisionalWorldNoticeEvidence(value);
}

function hasCompatibleStepVariant(
  step: CharacterStepDraft,
  stepsById: Map<string, CharacterStepDraft>,
): boolean {
  const visited = new Set([step.id]);
  let current = step;
  while (current.variantOf) {
    if (visited.has(current.variantOf)) return false;
    visited.add(current.variantOf);
    const source = stepsById.get(current.variantOf);
    if (
      !source ||
      source.queueIndex !== step.queueIndex ||
      source.participantRef !== step.participantRef ||
      source.beforeStepRef !== step.beforeStepRef
    ) return false;
    current = source;
  }
  return true;
}

function isPlayStepMaterialEffect(value: unknown): value is PlayStepMaterialEffect {
  if (!isRecord(value)) return false;
  if (value.kind === 'materialEffect') {
    return hasOnlyKnownFields(value, ['kind']);
  }
  return value.kind === 'noMaterialEffect'
    && hasOnlyKnownFields(value, ['kind', 'reason'])
    && isNonEmptyString(value.reason);
}

function isPlayAttemptStagnation(value: unknown): value is PlayAttemptStagnation {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'consecutiveNoMaterialSteps',
      'threshold',
      'warning',
    ])
    && isNonNegativeInteger(value.consecutiveNoMaterialSteps)
    && isPositiveInteger(value.threshold)
    && value.warning ===
      (value.consecutiveNoMaterialSteps >= value.threshold);
}

function isPlayDirectorIntervention(
  value: unknown,
  expectedAttemptId: string,
): value is PlayDirectorIntervention {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isSafeId(value.id) ||
    value.attemptId !== expectedAttemptId ||
    !isPositiveInteger(value.attemptRevision) ||
    !isNonEmptyString(value.createdAt) ||
    !isRecord(value.provenance) ||
    !hasOnlyKnownFields(value.provenance, ['actor', 'source']) ||
    value.provenance.actor !== 'user' ||
    value.provenance.source !== 'directorControl' ||
    !isUniqueSafeIdArray(value.supersededStepRefs)
  ) return false;
  const baseFields = [
    'schemaVersion',
    'id',
    'attemptId',
    'attemptRevision',
    'createdAt',
    'provenance',
    'supersededStepRefs',
    'kind',
  ];
  if (value.kind === 'reviseProjection') {
    return hasOnlyKnownFields(value, [
      ...baseFields,
      'stepRef',
      'replacementStepRef',
      'replacementBlocks',
      'expectedEffectFingerprint',
    ])
      && isSafeId(value.stepRef)
      && isSafeId(value.replacementStepRef)
      && Array.isArray(value.replacementBlocks)
      && value.replacementBlocks.length <= 96
      && value.replacementBlocks.every(isNarrativeBlock)
      && hasUniqueIds(value.replacementBlocks, 'id')
      && isSha256Hex(value.expectedEffectFingerprint);
  }
  if (value.kind === 'redirectStep') {
    return hasOnlyKnownFields(value, [
      ...baseFields,
      'stepRef',
      'replacementStepRef',
      'directorIntent',
      'authorConstraintRefs',
    ])
      && isSafeId(value.stepRef)
      && isSafeId(value.replacementStepRef)
      && isNonEmptyString(value.directorIntent)
      && Array.isArray(value.authorConstraintRefs)
      && value.authorConstraintRefs.length <= 64
      && isUniqueSafeIdArray(value.authorConstraintRefs);
  }
  if (value.kind === 'insertActor') {
    return hasOnlyKnownFields(value, [
      ...baseFields,
      'participantRef',
      'insertionIndex',
      'beforeStepRef',
      'afterStepRef',
    ])
      && isSafeId(value.participantRef)
      && isNonNegativeInteger(value.insertionIndex)
      && (value.beforeStepRef === undefined || isSafeId(value.beforeStepRef))
      && (value.afterStepRef === undefined || isSafeId(value.afterStepRef))
      && !(value.beforeStepRef !== undefined && value.afterStepRef !== undefined);
  }
  return value.kind === 'grantKnowledge'
    && hasOnlyKnownFields(value, [
      ...baseFields,
      'participantRef',
      'effectiveFromStepRef',
      'effectiveFromQueueIndex',
      'selectedPrefixRefs',
      'grant',
    ])
    && isSafeId(value.participantRef)
    && isSafeId(value.effectiveFromStepRef)
    && isNonNegativeInteger(value.effectiveFromQueueIndex)
    && isUniqueSafeIdArray(value.selectedPrefixRefs)
    && isPlayDirectorKnowledgeGrant(value.grant);
}

function isPlayDirectorKnowledgeGrant(
  value: unknown,
): value is PlayDirectorKnowledgeGrant {
  if (!isRecord(value)) return false;
  if (value.kind === 'existingFact') {
    return hasOnlyKnownFields(value, ['kind', 'factRefs'])
      && isUniqueSafeIdArray(value.factRefs)
      && value.factRefs.length > 0
      && value.factRefs.length <= 64;
  }
  return value.kind === 'authorProvidedPlayFact'
    && hasOnlyKnownFields(value, ['kind', 'summary', 'visibility', 'providedAt'])
    && isNonEmptyString(value.summary)
    && isVisibility(value.visibility)
    && isNonEmptyString(value.providedAt);
}

function hasConsistentInterventionSteps(
  intervention: PlayDirectorIntervention,
  stepsById: Map<string, CharacterStepDraft>,
): boolean {
  if (intervention.kind === 'reviseProjection' || intervention.kind === 'redirectStep') {
    const source = stepsById.get(intervention.stepRef);
    const replacement = stepsById.get(intervention.replacementStepRef);
    if (
      !source ||
      !replacement ||
      replacement.variantOf !== source.id ||
      replacement.queueIndex !== source.queueIndex ||
      replacement.participantRef !== source.participantRef ||
      replacement.beforeStepRef !== source.beforeStepRef
    ) return false;
    return intervention.kind !== 'reviseProjection' || (
      source.effectFingerprint === intervention.expectedEffectFingerprint &&
      replacement.effectFingerprint === source.effectFingerprint &&
      isDeepEqualJson(replacement.narrativeBlocks, intervention.replacementBlocks)
    );
  }
  if (intervention.kind === 'insertActor') {
    return (intervention.beforeStepRef === undefined ||
      stepsById.has(intervention.beforeStepRef)) &&
      (intervention.afterStepRef === undefined || stepsById.has(intervention.afterStepRef));
  }
  const target = stepsById.get(intervention.effectiveFromStepRef);
  return Boolean(target) &&
    target!.queueIndex === intervention.effectiveFromQueueIndex &&
    intervention.selectedPrefixRefs.length === intervention.effectiveFromQueueIndex &&
    intervention.selectedPrefixRefs.every((stepRef, index) =>
      stepsById.get(stepRef)?.queueIndex === index);
}

function hasValidProvisionalWorldNoticeEvidence(
  value: Record<string, unknown>,
): boolean {
  if (
    !isSafeId(value.id) ||
    !Array.isArray(value.narrativeBlocks) ||
    !value.narrativeBlocks.every(isNarrativeBlock) ||
    !isSettlement(value.settlementContribution)
  ) return false;
  const notices = value.narrativeBlocks.filter((block) =>
    block.kind === 'worldNotice');
  const visibleEvents = value.settlementContribution.events.filter((event) =>
    event.visibility === 'playerVisible' && event.cause.triggerId === undefined);
  const expectedContent = visibleEvents.map((event) =>
    `${event.title}: ${event.summary}`).join('\n');
  return notices.length === (visibleEvents.length ? 1 : 0) && notices.every((block) =>
    visibleEvents.length > 0 &&
    block.id === `world-notice-${value.id}` &&
    block.speakerRef === undefined &&
    block.content === expectedContent &&
    block.visibility === 'playerVisible' &&
    block.projection === 'transcript' &&
    block.eventRefs.length === 0 &&
    block.sourceRefs.length === 0);
}

function isNarrativeBlock(value: unknown): value is NarrativeBlock {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'id',
      'kind',
      'speakerRef',
      'content',
      'visibility',
      'projection',
      'eventRefs',
      'sourceRefs',
    ])
    && isSafeId(value.id)
    && isNarrativeBlockKind(value.kind)
    && (value.speakerRef === undefined || isSafeId(value.speakerRef))
    && ((value.kind !== 'characterSpeech' && value.kind !== 'characterAction')
      || isSafeId(value.speakerRef))
    && isNonEmptyString(value.content)
    && isVisibility(value.visibility)
    && (value.projection === 'transcript' || value.projection === 'directorOnly')
    && (value.visibility !== 'playerUnknown' || value.projection === 'directorOnly')
    && isUniqueSafeIdArray(value.eventRefs)
    && isUniqueSafeIdArray(value.sourceRefs);
}

function isSettlement(value: unknown): value is PlayWorldRefereeSettlement {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'elapsed',
      'worldTimeAnchor',
      'events',
      'knowledgeChanges',
      'pressureChanges',
      'agendaChanges',
      'scheduledEventChanges',
      'stateDelta',
      'observations',
      'suggestedActions',
    ])
    && (value.elapsed === undefined || isNonEmptyString(value.elapsed))
    && (value.worldTimeAnchor === undefined || isNonEmptyString(value.worldTimeAnchor))
    && Array.isArray(value.events)
    && value.events.every(isSettlementEvent)
    && Array.isArray(value.knowledgeChanges)
    && value.knowledgeChanges.length <= 8
    && value.knowledgeChanges.every(isKnowledgeChange)
    && value.knowledgeChanges.every((change) => change.type === 'revealEvent')
    && hasUniqueKnowledgeChanges(value.knowledgeChanges)
    && Array.isArray(value.pressureChanges)
    && value.pressureChanges.every(isPressureChange)
    && Array.isArray(value.agendaChanges)
    && value.agendaChanges.every(isAgendaChange)
    && Array.isArray(value.scheduledEventChanges)
    && value.scheduledEventChanges.length <= 8
    && value.scheduledEventChanges.every(isScheduledEventChange)
    && isRecord(value.stateDelta)
    && !Object.hasOwn(value.stateDelta, 'worldMomentum')
    && !Object.hasOwn(value.stateDelta, 'playKnowledge')
    && Array.isArray(value.observations)
    && value.observations.every((item) => isRecord(item)
      && hasOnlyKnownFields(item, ['summary', 'evidence'])
      && isNonEmptyString(item.summary)
      && isNonEmptyString(item.evidence))
    && Array.isArray(value.suggestedActions)
    && value.suggestedActions.length <= 6
    && value.suggestedActions.every(isNonEmptyString);
}

function isKnowledgeChange(value: unknown): value is PlayKnowledgeChange {
  if (!isRecord(value)) return false;
  if (value.type === 'grantParticipantKnowledge') {
    return hasOnlyKnownFields(value, [
      'type',
      'participantRef',
      'effectiveFromStepRef',
      'interventionRef',
      'grant',
    ])
      && isSafeId(value.participantRef)
      && isSafeId(value.effectiveFromStepRef)
      && isSafeId(value.interventionRef)
      && isPlayDirectorKnowledgeGrant(value.grant);
  }
  return hasOnlyKnownFields(value, [
    'type',
    'subjectEventId',
    'playerProjection',
  ])
    && value.type === 'revealEvent'
    && isSafeId(value.subjectEventId)
    && (value.playerProjection === 'rumor'
      || value.playerProjection === 'playerVisible');
}

function hasUniqueKnowledgeChanges(
  changes: readonly PlayKnowledgeChange[],
): boolean {
  const subjectEventIds = new Set<string>();
  const interventionRefs = new Set<string>();
  for (const change of changes) {
    if (change.type === 'grantParticipantKnowledge') {
      if (interventionRefs.has(change.interventionRef)) return false;
      interventionRefs.add(change.interventionRef);
    } else {
      if (subjectEventIds.has(change.subjectEventId)) return false;
      subjectEventIds.add(change.subjectEventId);
    }
  }
  return true;
}

function isSettlementEvent(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['kind', 'origin', 'title', 'summary', 'visibility', 'cause']) ||
    !isWorldEventKind(value.kind) ||
    !isEventOrigin(value.origin) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.summary) ||
    !isVisibility(value.visibility) ||
    !isRecord(value.cause)
  ) return false;
  const cause = value.cause;
  return hasOnlyKnownFields(cause, [
      'reason',
      'sourceTurnIds',
      'sourceEventIds',
      'triggerId',
      'pressureId',
      'agendaId',
    ])
    && isNonEmptyString(cause.reason)
    && (cause.sourceTurnIds === undefined || isUniqueSafeIdArray(cause.sourceTurnIds))
    && (cause.sourceEventIds === undefined || isUniqueSafeIdArray(cause.sourceEventIds))
    && ['triggerId', 'pressureId', 'agendaId'].every((field) =>
      cause[field] === undefined || isSafeId(cause[field]));
}

function isPressureChange(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['pressureId', 'reason', 'status', 'level', 'nextConsequence'])
    && isSafeId(value.pressureId)
    && isNonEmptyString(value.reason)
    && (value.status === undefined || ['latent', 'active', 'resolved'].includes(String(value.status)))
    && (value.level === undefined || isNonNegativeInteger(value.level))
    && (value.nextConsequence === undefined || value.nextConsequence === null
      || isNonEmptyString(value.nextConsequence))
    && (value.status !== undefined || value.level !== undefined || value.nextConsequence !== undefined);
}

function isAgendaChange(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['agendaId', 'reason', 'status', 'nextMove', 'blockers'])
    && isSafeId(value.agendaId)
    && isNonEmptyString(value.reason)
    && (value.status === undefined
      || ['active', 'blocked', 'completed', 'abandoned'].includes(String(value.status)))
    && (value.nextMove === undefined || value.nextMove === null || isNonEmptyString(value.nextMove))
    && (value.blockers === undefined || isStringArray(value.blockers))
    && (value.status !== undefined || value.nextMove !== undefined || value.blockers !== undefined);
}

function isScheduledEventChange(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.reason)) return false;
  if (value.type === 'schedule') {
    return hasOnlyKnownFields(value, ['type', 'label', 'trigger', 'template', 'reason', 'priority'])
      && isNonEmptyString(value.label)
      && isEventTrigger(value.trigger)
      && isScheduledEventTemplate(value.template)
      && (value.priority === undefined || Number.isSafeInteger(value.priority));
  }
  if (value.type === 'cancel') {
    return hasOnlyKnownFields(value, ['type', 'scheduledEventId', 'reason'])
      && isSafeId(value.scheduledEventId);
  }
  return value.type === 'reschedule'
    && hasOnlyKnownFields(value, ['type', 'scheduledEventId', 'trigger', 'reason', 'priority'])
    && isSafeId(value.scheduledEventId)
    && isEventTrigger(value.trigger)
    && (value.priority === undefined || Number.isSafeInteger(value.priority));
}

function isEventTrigger(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'nextTurn') return hasOnlyKnownFields(value, ['type']);
  if (value.type === 'afterTurns') {
    return hasOnlyKnownFields(value, ['type', 'turns']) && isPositiveInteger(value.turns);
  }
  if (value.type === 'flagEquals') {
    return hasOnlyKnownFields(value, ['type', 'path', 'value'])
      && isSafeStatePath(value.path)
      && (typeof value.value === 'string'
        || (typeof value.value === 'number' && Number.isFinite(value.value))
        || typeof value.value === 'boolean');
  }
  return (value.type === 'atWorldTime' || value.type === 'manual')
    && (value.type === 'manual'
      ? hasOnlyKnownFields(value, ['type'])
      : hasOnlyKnownFields(value, ['type', 'value']) && isNonEmptyString(value.value));
}

function isScheduledEventTemplate(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['kind', 'origin', 'title', 'summary', 'visibility'])
    && isWorldEventKind(value.kind)
    && isEventOrigin(value.origin)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.summary)
    && isVisibility(value.visibility);
}

function isAttemptReceipt(value: unknown): value is PlayAttemptMutationReceipt {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'idempotencyKey',
      'requestFingerprint',
      'resultingAttemptRevision',
      'resultRef',
      'responseDigest',
    ])
    && isSafeId(value.idempotencyKey)
    && isNonEmptyString(value.requestFingerprint)
    && isNonNegativeInteger(value.resultingAttemptRevision)
    && isSafeId(value.resultRef)
    && isNonEmptyString(value.responseDigest);
}

function assertMemoryLens(value: unknown): PlayOutcomeProjection {
  if (value !== 'player' && value !== 'director') {
    throw new Error('Invalid Play Scene Memory lens.');
  }
  return value;
}

function parseSceneMemoryEnvelope(
  value: unknown,
  sessionId: string,
  lens: PlayOutcomeProjection,
  allowNull: true,
): { memory: PlaySceneMemoryArtifact | null };
function parseSceneMemoryEnvelope(
  value: unknown,
  sessionId: string,
  lens: PlayOutcomeProjection,
  allowNull: false,
): { memory: PlaySceneMemoryArtifact };
function parseSceneMemoryEnvelope(
  value: unknown,
  sessionId: string,
  lens: PlayOutcomeProjection,
  allowNull: boolean,
): { memory: PlaySceneMemoryArtifact | null } {
  if (!isRecord(value) || !hasOnlyKnownFields(value, ['memory'])) {
    throw new Error('Play Scene Memory request returned an invalid payload.');
  }
  if (allowNull && value.memory === null) return { memory: null };
  if (
    !isPlaySceneMemoryArtifact(value.memory, lens) ||
    value.memory.sessionId !== sessionId
  ) {
    throw new Error('Play Scene Memory request returned an invalid payload.');
  }
  return { memory: value.memory };
}

function isPlaySceneMemoryArtifact(
  value: unknown,
  expectedLens?: PlayOutcomeProjection,
): value is PlaySceneMemoryArtifact {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'sessionId',
      'sceneId',
      'lens',
      'throughRevision',
      'selectedTurnRefs',
      'sourceHashes',
      'items',
      'status',
      'builtAt',
      'staleReasons',
    ]) ||
    value.schemaVersion !== 1 ||
    !isSafeId(value.id) ||
    !isSafeId(value.sessionId) ||
    (value.sceneId !== undefined && !isSafeId(value.sceneId)) ||
    (value.lens !== 'player' && value.lens !== 'director') ||
    (expectedLens !== undefined && value.lens !== expectedLens) ||
    !isNonNegativeInteger(value.throughRevision) ||
    !isUniqueSafeIdArray(value.selectedTurnRefs) ||
    !isMemorySourceHashes(value.sourceHashes) ||
    !Array.isArray(value.items) ||
    value.items.length > 4096 ||
    !value.items.every((item) => isMemoryOutcomeItem(item, value.lens as PlayOutcomeProjection)) ||
    !hasUniqueIds(value.items, 'id') ||
    (
      value.status !== 'current' &&
      value.status !== 'stale' &&
      value.status !== 'superseded'
    ) ||
    !isNonEmptyString(value.builtAt) ||
    !Number.isFinite(Date.parse(value.builtAt)) ||
    (
      value.staleReasons !== undefined &&
      !isMemoryStaleReasons(value.staleReasons)
    ) ||
    ((value.status === 'stale') !==
      (Array.isArray(value.staleReasons) && value.staleReasons.length > 0))
  ) return false;
  if (value.id !== `scene-memory-${value.lens}-${value.throughRevision}`) return false;
  if (value.lens === 'player') {
    return value.selectedTurnRefs.length === 0 &&
      Object.keys(value.sourceHashes).length === 0;
  }
  return true;
}

function isMemorySourceHashes(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.entries(value).every(([sourceId, hash]) =>
    isSafeId(sourceId) && isSha256Hex(hash));
}

function isMemoryStaleReasons(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((reason) =>
    reason === 'sessionRevisionChanged' ||
    reason === 'selectedBranchChanged' ||
    reason === 'sourceHashesChanged') && new Set(value).size === value.length;
}

function isMemoryOutcomeItem(
  value: unknown,
  lens: PlayOutcomeProjection,
): value is PlayOutcomeItem {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'kind',
      'summary',
      'visibility',
      'confidence',
      'goalStatus',
      'tags',
      'artifactTurnRefs',
      'messageRefs',
      'eventRefs',
      'observationRefs',
      'evidenceRefs',
      'sourceRefs',
      'participantRefs',
    ]) ||
    !isSafeId(value.id) ||
    ![
      'sceneSummary',
      'goalAssessment',
      'participantFootprint',
      'worldChange',
      'writingMaterial',
    ].includes(String(value.kind)) ||
    !isNonEmptyString(value.summary) ||
    !isVisibility(value.visibility) ||
    !['confirmed', 'inferred', 'authorProvided'].includes(String(value.confidence)) ||
    !Array.isArray(value.tags) ||
    value.tags.length === 0 ||
    !value.tags.every((tag) => [
      'goal',
      'divergence',
      'consistency',
      'worldChange',
      'participantFootprint',
      'writingMaterial',
    ].includes(String(tag))) ||
    new Set(value.tags).size !== value.tags.length
  ) return false;
  const refFields = [
    'artifactTurnRefs',
    'messageRefs',
    'eventRefs',
    'observationRefs',
    'evidenceRefs',
    'sourceRefs',
    'participantRefs',
  ] as const;
  if (refFields.some((field) => !isUniqueSafeIdArray(value[field]))) return false;
  if (value.kind === 'goalAssessment') {
    if (!['reached', 'partial', 'missed', 'changed'].includes(String(value.goalStatus))) {
      return false;
    }
  } else if (value.goalStatus !== undefined) {
    return false;
  }
  return lens === 'director'
    ? (value.artifactTurnRefs as string[]).length > 0
    : value.visibility !== 'playerUnknown' &&
      refFields.every((field) => (value[field] as string[]).length === 0);
}

function parseAttemptEnvelope(
  value: unknown,
  sessionId: string,
  attemptId?: string,
): { attempt: PlayTurnAttempt } {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['attempt']) ||
    !isPlayTurnAttempt(value.attempt) ||
    value.attempt.sessionId !== sessionId ||
    (attemptId !== undefined && value.attempt.id !== attemptId)
  ) throw new Error('Play rehearsal attempt request returned an invalid payload.');
  return { attempt: value.attempt };
}

function parseActiveAttemptEnvelope(
  value: unknown,
  sessionId: string,
): { attempt: PlayTurnAttempt | null } {
  if (!isRecord(value) || !hasOnlyKnownFields(value, ['attempt'])) {
    throw new Error('Active Play rehearsal attempt request returned an invalid payload.');
  }
  if (value.attempt === null) return { attempt: null };
  if (!isPlayTurnAttempt(value.attempt) || value.attempt.sessionId !== sessionId) {
    throw new Error('Active Play rehearsal attempt request returned an invalid payload.');
  }
  return { attempt: value.attempt };
}

function parseAttemptMutationResult(
  value: unknown,
  sessionId: string,
  attemptId: string,
  input: PlayAttemptMutationInput,
): PlayAttemptMutationResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['attempt', 'receipt', 'replayed'])
  ) throw new Error('Play rehearsal attempt mutation returned an invalid payload.');
  const attempt = value.attempt;
  const receipt = value.receipt;
  const replayed = value.replayed;
  if (
    !isPlayTurnAttempt(attempt) ||
    attempt.sessionId !== sessionId ||
    attempt.id !== attemptId ||
    !isAttemptReceipt(receipt) ||
    receipt.idempotencyKey !== input.idempotencyKey ||
    typeof replayed !== 'boolean' ||
    (
      replayed
        ? receipt.resultingAttemptRevision > attempt.attemptRevision
        : receipt.resultingAttemptRevision !== attempt.attemptRevision ||
          attempt.attemptRevision !== input.expectedAttemptRevision + 1
    ) ||
    !attempt.mutationReceipts.some((storedReceipt) =>
      storedReceipt.idempotencyKey === receipt.idempotencyKey
      && isDeepEqualJson(storedReceipt, receipt))
  ) throw new Error('Play rehearsal attempt mutation returned an invalid payload.');
  return value as unknown as PlayAttemptMutationResult;
}

function parseFinalizeResult(
  value: unknown,
  sessionId: string,
  attemptId: string,
  input: PlayAttemptMutationInput & {
    baseRevision: number;
    selectedHeadRef: string;
  },
  isSession: PlayRehearsalClientFactoryOptions['isRehearsalSession'],
): PlayRehearsalFinalizeResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'session',
      'attempt',
      'artifact',
      'evidence',
      'receipt',
      'replayed',
    ])
  ) throw new Error('Play rehearsal finalize returned an invalid payload.');
  const attempt = value.attempt;
  const receipt = value.receipt;
  const evidence = value.evidence;
  const session = value.session;
  const responseArtifact = value.artifact;
  const replayed = value.replayed;
  if (
    (attempt !== undefined && (
      !isPlayTurnAttempt(attempt) ||
      attempt.id !== attemptId ||
      attempt.sessionId !== sessionId ||
      attempt.status !== 'committed'
    )) ||
    !isFinalizeReceipt(receipt) ||
    receipt.idempotencyKey !== input.idempotencyKey ||
    receipt.attemptRevision !== input.expectedAttemptRevision ||
    !isTurnEvidence(evidence) ||
    typeof replayed !== 'boolean' ||
    (!replayed && attempt === undefined) ||
    !isSession(session, sessionId) ||
    !isRehearsalArtifactV3(responseArtifact)
  ) throw new Error('Play rehearsal finalize returned an invalid payload.');

  const artifact = session.turnArtifacts.find((item) =>
    item.id === responseArtifact.id);
  const committedRevision = input.baseRevision + 1;
  const hasConsistentRevision = replayed
    ? artifact?.revision === committedRevision && session.revision >= committedRevision
    : artifact?.revision === session.revision && session.revision === committedRevision;
  if (
    !artifact ||
    artifact.schemaVersion !== 3 ||
    !hasConsistentRevision ||
    !artifact.rehearsalEvidenceRefs?.includes(evidence.id) ||
    !isDeepEqualJson(responseArtifact, artifact) ||
    evidence.owningTurnArtifactId !== artifact.id ||
    evidence.attemptId !== attemptId ||
    evidence.selectedStepRefs.at(-1) !== input.selectedHeadRef ||
    !isDeepEqualJson(evidence.finalizeReceipt, receipt) ||
    !session.rehearsalScenes.some((scene) =>
      scene.turns.some((storedEvidence) =>
        storedEvidence.id === evidence.id && isDeepEqualJson(storedEvidence, evidence))) ||
    (attempt !== undefined && (
      attempt.committedArtifactRef !== artifact.id ||
      attempt.committedEvidenceRef !== evidence.id ||
      attempt.selectedHeadRef !== input.selectedHeadRef ||
      attempt.attemptRevision !== receipt.attemptRevision
    ))
  ) throw new Error('Play rehearsal finalize returned inconsistent committed evidence.');
  return value as unknown as PlayRehearsalFinalizeResult;
}

function parseStepStopResult(
  value: unknown,
  stepRunId: string,
): PlayRehearsalStepStopResult {
  if (!isRecord(value) || value.runId !== stepRunId) {
    throw new Error('Play rehearsal step stop returned an invalid payload.');
  }
  if (
    (value.status === 'cancelling' || value.status === 'aborted') &&
    hasOnlyKnownFields(value, ['status', 'runId'])
  ) return value as PlayRehearsalStepStopResult;
  if (
    value.status === 'committing' &&
    value.tooLateToStop === true &&
    hasOnlyKnownFields(value, ['status', 'runId', 'tooLateToStop'])
  ) return value as PlayRehearsalStepStopResult;
  if (
    value.status === 'prepared' &&
    isSafeId(value.stepRef) &&
    hasOnlyKnownFields(value, ['status', 'runId', 'stepRef'])
  ) return value as PlayRehearsalStepStopResult;
  if (
    value.status === 'failed' &&
    isNonEmptyString(value.error) &&
    hasOnlyKnownFields(value, ['status', 'runId', 'error'])
  ) return value as PlayRehearsalStepStopResult;
  throw new Error('Play rehearsal step stop returned an invalid payload.');
}

function assertStepStreamInput(value: PlayRehearsalStepStreamInput): void {
  if (
    !isNonNegativeInteger(value.expectedAttemptRevision) ||
    !isSafeId(value.idempotencyKey) ||
    (value.mode !== 'next' && value.mode !== 'retry') ||
    (value.mode === 'next' && value.sourceStepRef !== undefined) ||
    (value.mode === 'retry' && !isSafeId(value.sourceStepRef))
  ) throw new Error('Play rehearsal step stream input is invalid.');
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isStreamError(value: unknown): value is PlayRehearsalStepStreamError {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['code', 'message', 'retryable', 'details'])
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.message)
    && typeof value.retryable === 'boolean'
    && (value.details === undefined || isRecord(value.details));
}

function isAttemptStatus(value: unknown): value is PlayTurnAttemptStatus {
  return value === 'running' || value === 'prepared' || value === 'committed'
    || value === 'cancelled' || value === 'failed';
}

function isStepStatus(value: unknown): value is CharacterStepDraftStatus {
  return value === 'draft' || value === 'selected' || value === 'superseded'
    || value === 'discarded';
}

function isNarrativeBlockKind(value: unknown): value is NarrativeBlockKind {
  return value === 'narrator' || value === 'characterSpeech'
    || value === 'characterAction' || value === 'worldNotice';
}

function isVisibility(value: unknown): value is PlayEventVisibility {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

function isWorldEventKind(value: unknown): value is PlayWorldEventKind {
  return typeof value === 'string' && [
    'environmentChanged',
    'locationChanged',
    'npcActed',
    'factionActed',
    'arrival',
    'departure',
    'deadlineAdvanced',
    'resourceChanged',
    'itemMoved',
    'evidenceChanged',
    'relationshipChanged',
    'informationSpread',
    'ruleConsequence',
    'manual',
  ].includes(value);
}

function isEventOrigin(value: unknown): value is PlayEventOrigin {
  return typeof value === 'string'
    && ['player', 'npc', 'faction', 'clock', 'environment', 'worldRule', 'manual']
      .includes(value);
}

function isWorldClock(value: unknown): value is PlayWorldClock {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['turn', 'revision', 'anchor', 'elapsed'])
    && isNonNegativeInteger(value.turn)
    && isNonNegativeInteger(value.revision)
    && (value.anchor === undefined || isNonEmptyString(value.anchor))
    && (value.elapsed === undefined || isNonEmptyString(value.elapsed));
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

function isSafeStatePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value
  ) return false;
  return value.split('.').every((segment) =>
    /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(segment)
    && segment !== '__proto__'
    && segment !== 'prototype'
    && segment !== 'constructor');
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 180
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    && !value.includes('..')
    && !value.includes('/')
    && !value.includes('\\');
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function assertSafeId(value: unknown): string {
  if (!isSafeId(value)) throw new Error('Invalid Play rehearsal identifier.');
  return value;
}

function isUniqueSafeIdArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isSafeId)
    && new Set(value).size === value.length;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function hasUniqueIds(
  value: readonly unknown[],
  field: string,
): boolean {
  const ids = value.map((item) => isRecord(item) && typeof item[field] === 'string'
    ? item[field]
    : undefined);
  return ids.every((id): id is string => id !== undefined)
    && new Set(ids).size === ids.length;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function deriveParticipantKnowledgeEvidenceId(interventionRef: string): string {
  const candidate = `participant-knowledge-${interventionRef}`;
  return candidate.length <= 180
    ? candidate
    : `participant-knowledge-${interventionRef.slice(-150)}`;
}

function doesPlayVisibilityCover(
  blockVisibility: PlayEventVisibility,
  eventVisibility: PlayEventVisibility,
): boolean {
  const restriction: Record<PlayEventVisibility, number> = {
    playerVisible: 0,
    rumor: 1,
    playerUnknown: 2,
  };
  return restriction[blockVisibility] >= restriction[eventVisibility];
}

function isDeepEqualJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => isDeepEqualJson(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && isDeepEqualJson(left[key], right[key]));
}

function hasOnlyKnownFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const known = new Set(fields);
  return Object.keys(value).every((field) => known.has(field));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
