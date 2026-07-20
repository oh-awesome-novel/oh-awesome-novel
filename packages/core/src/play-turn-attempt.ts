import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  normalizePlayWorldRefereeSettlement,
} from './play-session.js';
import type { PlayWorldRefereeSettlement } from './play-session.js';
import {
  assertSafePlayRehearsalId,
  assertNarrativeBlocksWithinPerception,
  listPlayRedirectConstraintRefs,
  normalizeCharacterPerceptionPackage,
  normalizeNarrativeBlock,
} from './play-rehearsal.js';
import type {
  CharacterPerceptionPackage,
  NarrativeBlock,
} from './play-rehearsal.js';

const MAX_ATTEMPT_STEPS = 96;
const MAX_ATTEMPT_RECEIPTS = 256;
const MAX_ATTEMPT_TEXT = 12_000;

export type PlayRehearsalOrderStrategy =
  | 'directorFixed'
  | 'refereeDynamic'
  | 'hybrid';

export type PlayStepMaterialEffect =
  | { kind: 'materialEffect' }
  | { kind: 'noMaterialEffect'; reason: string };

export type PlayDirectorKnowledgeGrant =
  | { kind: 'existingFact'; factRefs: string[] }
  | {
      kind: 'authorProvidedPlayFact';
      summary: string;
      visibility: 'playerVisible' | 'rumor' | 'playerUnknown';
      providedAt: string;
    };

export interface PlayDirectorInterventionBase {
  schemaVersion: 1;
  id: string;
  attemptId: string;
  attemptRevision: number;
  createdAt: string;
  provenance: {
    actor: 'user';
    source: 'directorControl';
  };
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
  effectFingerprint?: string;
  decisionBasisRefs: string[];
  variantOf?: string;
  materialEffect?: PlayStepMaterialEffect;
  status: CharacterStepDraftStatus;
  createdAt: string;
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
  orderStrategy: PlayRehearsalOrderStrategy;
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

export interface PlayAttemptMutationInput {
  expectedAttemptRevision: number;
  idempotencyKey: string;
}

export interface PlayAttemptMutationResult {
  attempt: PlayTurnAttempt;
  receipt: PlayAttemptMutationReceipt;
  replayed: boolean;
}

export type PlayDirectorInterventionMutationInput = PlayAttemptMutationInput & {
  interventionId: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PlayTurnAttemptErrorCode =
  | 'invalidAttempt'
  | 'revisionConflict'
  | 'idempotencyConflict'
  | 'invalidTransition'
  | 'stepNotFound'
  | 'selectedHeadConflict';

export class PlayTurnAttemptError extends Error {
  readonly name = 'PlayTurnAttemptError';
  readonly code: PlayTurnAttemptErrorCode;

  constructor(
    code: PlayTurnAttemptErrorCode,
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export function createPlayTurnAttempt(input: {
  id: string;
  sessionId: string;
  baseRevision: number;
  sceneBeforeRef: string;
  actorOrder: string[];
  participantRefs?: string[];
  orderStrategy?: PlayRehearsalOrderStrategy;
  dueScheduledEventIds?: string[];
  createdAt?: string;
}): PlayTurnAttempt {
  const actorOrder = normalizeSafeIdList(
    input.actorOrder,
    'actorOrder',
    24,
  );
  if (!actorOrder.length) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play turn attempt requires a fixed actor order.',
    );
  }
  const participantRefs = normalizeSafeIdList(
    input.participantRefs ?? actorOrder,
    'participantRefs',
    24,
  );
  if (actorOrder.some((participantRef) => !participantRefs.includes(participantRef))) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play turn attempt actor order must stay within its scene participants.',
    );
  }
  const orderStrategy = normalizeOrderStrategy(
    input.orderStrategy ?? 'directorFixed',
  );
  const createdAt = normalizeText(
    input.createdAt ?? new Date().toISOString(),
    'createdAt',
    128,
  );
  return {
    schemaVersion: 1,
    id: assertSafePlayRehearsalId(input.id, 'attempt id'),
    sessionId: assertSafePlayRehearsalId(input.sessionId, 'attempt sessionId'),
    baseRevision: normalizeNonNegativeInteger(input.baseRevision, 'baseRevision'),
    attemptRevision: 0,
    sceneBeforeRef: assertSafePlayRehearsalId(
      input.sceneBeforeRef,
      'attempt sceneBeforeRef',
    ),
    status: 'running',
    actorOrder,
    participantRefs,
    orderStrategy,
    selectedStepRefs: [],
    dueScheduledEventIds: normalizeSafeIdList(
      input.dueScheduledEventIds ?? [],
      'dueScheduledEventIds',
      128,
    ),
    steps: [],
    interventions: [],
    stagnation: createPlayAttemptStagnation(),
    mutationReceipts: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function normalizePlayTurnAttempt(value: unknown): PlayTurnAttempt {
  const record = requireRecord(value, 'Stored Play turn attempt');
  assertOnlyKnownFields(record, [
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
  ], 'Stored Play turn attempt');
  if (record.schemaVersion !== 1) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Unsupported Play turn attempt schemaVersion: ${String(record.schemaVersion)}.`,
    );
  }
  const statuses: PlayTurnAttemptStatus[] = [
    'running',
    'prepared',
    'committed',
    'cancelled',
    'failed',
  ];
  if (!statuses.includes(record.status as PlayTurnAttemptStatus)) {
    throw new PlayTurnAttemptError('invalidAttempt', 'Stored Play turn attempt has invalid status.');
  }
  const id = assertSafePlayRehearsalId(record.id, 'attempt id');
  const actorOrder = normalizeSafeIdList(record.actorOrder, 'actorOrder', 24);
  if (!actorOrder.length) {
    throw new PlayTurnAttemptError('invalidAttempt', 'Stored Play attempt requires actorOrder.');
  }
  const participantRefs = normalizeSafeIdList(
    record.participantRefs ?? actorOrder,
    'participantRefs',
    24,
  );
  if (actorOrder.some((participantRef) => !participantRefs.includes(participantRef))) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Stored Play actor order contains a non-scene participant.',
    );
  }
  const orderStrategy = normalizeOrderStrategy(
    record.orderStrategy ?? 'directorFixed',
  );
  const steps = normalizeBoundedArray(
    record.steps,
    MAX_ATTEMPT_STEPS,
    'Stored Play attempt steps',
  ).map((step) => normalizeCharacterStepDraft(step, id));
  assertUnique(steps.map((step) => step.id), 'step id');
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const selectedStepRefs = normalizeSafeIdList(
    record.selectedStepRefs,
    'selectedStepRefs',
    MAX_ATTEMPT_STEPS,
  );
  if (selectedStepRefs.length > actorOrder.length) {
    throw new PlayTurnAttemptError('invalidAttempt', 'Stored Play attempt selects too many steps.');
  }
  for (const [index, stepRef] of selectedStepRefs.entries()) {
    const step = stepsById.get(stepRef);
    if (
      !step ||
      step.status !== 'selected' ||
      step.queueIndex !== index ||
      step.participantRef !== actorOrder[index]
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play attempt has an invalid selected step: ${stepRef}.`,
      );
    }
    const expectedBeforeRef = index === 0 ? undefined : selectedStepRefs[index - 1];
    if (step.beforeStepRef !== expectedBeforeRef) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play attempt selected chain breaks at: ${stepRef}.`,
      );
    }
  }
  const selectedHeadRef = record.selectedHeadRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.selectedHeadRef, 'selectedHeadRef');
  if (selectedHeadRef !== selectedStepRefs.at(-1)) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Stored Play attempt selectedHeadRef does not match selectedStepRefs.',
    );
  }
  const currentStepRef = record.currentStepRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.currentStepRef, 'currentStepRef');
  const currentStep = currentStepRef ? stepsById.get(currentStepRef) : undefined;
  if (
    currentStepRef &&
    (
      !currentStep ||
      currentStep.status !== 'draft' ||
      currentStep.queueIndex !== selectedStepRefs.length ||
      currentStep.participantRef !== actorOrder[selectedStepRefs.length]
    )
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Stored Play attempt currentStepRef does not reference the current actor draft.',
    );
  }
  const selectedStepSet = new Set(selectedStepRefs);
  for (const step of steps) {
    if (
      step.queueIndex >= participantRefs.length ||
      !participantRefs.includes(step.participantRef)
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play step ${step.id} is outside the scene participants.`,
      );
    }
    const isLiveStep = step.status === 'selected' || step.status === 'draft';
    const expectedBeforeRef = step.queueIndex === 0
      ? undefined
      : selectedStepRefs[step.queueIndex - 1];
    if (isLiveStep && step.beforeStepRef !== expectedBeforeRef) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play step ${step.id} breaks the selected step chain.`,
      );
    }
    if (
      (step.status === 'selected') !== selectedStepSet.has(step.id) ||
      (step.status === 'draft') !== (step.id === currentStepRef)
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play step ${step.id} has an inconsistent lifecycle status.`,
      );
    }
    if (step.variantOf) {
      assertCompatibleStepVariant(step, stepsById);
    }
  }
  const status = record.status as PlayTurnAttemptStatus;
  if (
    (status === 'prepared' && selectedStepRefs.length !== actorOrder.length) ||
    (status === 'running' && selectedStepRefs.length >= actorOrder.length) ||
    (
      (status === 'prepared' || status === 'committed') &&
      (
        selectedStepRefs.length !== actorOrder.length ||
        currentStepRef !== undefined
      )
    ) ||
    (
      status !== 'running' &&
      status !== 'prepared' &&
      currentStepRef !== undefined
    )
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Stored Play attempt status ${status} does not match its selected actor queue.`,
    );
  }
  const mutationReceipts = normalizeBoundedArray(
    record.mutationReceipts,
    MAX_ATTEMPT_RECEIPTS,
    'Stored Play attempt receipts',
  ).map(normalizeAttemptReceipt);
  assertUnique(
    mutationReceipts.map((receipt) => receipt.idempotencyKey),
    'idempotency key',
  );
  const attemptRevision = normalizeNonNegativeInteger(
    record.attemptRevision,
    'attemptRevision',
  );
  if (
    mutationReceipts.length !== attemptRevision ||
    mutationReceipts.some((receipt, index) =>
      receipt.resultingAttemptRevision !== index + 1)
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Stored Play attempt receipts must exactly account for attemptRevision.',
    );
  }
  const interventions = normalizeBoundedArray(
    record.interventions ?? [],
    MAX_ATTEMPT_RECEIPTS,
    'Stored Play attempt interventions',
  ).map((intervention) => normalizePlayDirectorIntervention(intervention, id));
  assertUnique(interventions.map((intervention) => intervention.id), 'intervention id');
  let previousInterventionRevision = 0;
  for (const intervention of interventions) {
    if (
      intervention.attemptRevision <= previousInterventionRevision ||
      intervention.attemptRevision > attemptRevision
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        'Stored Play interventions must be append-only in attempt revision order.',
      );
    }
    previousInterventionRevision = intervention.attemptRevision;
    for (const stepRef of intervention.supersededStepRefs) {
      const step = stepsById.get(stepRef);
      if (!step || (step.status !== 'superseded' && step.status !== 'discarded')) {
        throw new PlayTurnAttemptError(
          'invalidAttempt',
          `Stored Play intervention references a live superseded step: ${stepRef}.`,
        );
      }
    }
  }
  const stagnation = normalizePlayAttemptStagnation(
    record.stagnation ?? derivePlayAttemptStagnation(selectedStepRefs, stepsById),
  );
  const expectedStagnation = derivePlayAttemptStagnation(selectedStepRefs, stepsById, stagnation.threshold);
  if (
    stagnation.consecutiveNoMaterialSteps !== expectedStagnation.consecutiveNoMaterialSteps ||
    stagnation.warning !== expectedStagnation.warning
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Stored Play attempt stagnation does not match its selected branch.',
    );
  }
  const committedArtifactRef = record.committedArtifactRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.committedArtifactRef, 'committedArtifactRef');
  const committedEvidenceRef = record.committedEvidenceRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.committedEvidenceRef, 'committedEvidenceRef');
  if (
    status === 'committed' && (!committedArtifactRef || !committedEvidenceRef)
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Committed Play attempt requires artifact and evidence refs.',
    );
  }
  if (
    status !== 'committed' && (committedArtifactRef || committedEvidenceRef)
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Only a committed Play attempt may carry committed refs.',
    );
  }
  return {
    schemaVersion: 1,
    id,
    sessionId: assertSafePlayRehearsalId(record.sessionId, 'attempt sessionId'),
    baseRevision: normalizeNonNegativeInteger(record.baseRevision, 'baseRevision'),
    attemptRevision,
    sceneBeforeRef: assertSafePlayRehearsalId(record.sceneBeforeRef, 'sceneBeforeRef'),
    status,
    actorOrder,
    participantRefs,
    orderStrategy,
    selectedStepRefs,
    ...(selectedHeadRef ? { selectedHeadRef } : {}),
    ...(currentStepRef ? { currentStepRef } : {}),
    dueScheduledEventIds: normalizeSafeIdList(
      record.dueScheduledEventIds,
      'dueScheduledEventIds',
      128,
    ),
    steps,
    interventions,
    stagnation,
    mutationReceipts,
    ...(committedArtifactRef ? { committedArtifactRef } : {}),
    ...(committedEvidenceRef ? { committedEvidenceRef } : {}),
    createdAt: normalizeText(record.createdAt, 'createdAt', 128),
    updatedAt: normalizeText(record.updatedAt, 'updatedAt', 128),
  };
}

export function addPlayTurnAttemptStep(
  attemptValue: PlayTurnAttempt,
  input: PlayAttemptMutationInput & {
    operation:
      | { mode: 'next' }
      | { mode: 'retry'; sourceStepRef: string };
    step?: Omit<CharacterStepDraft, 'attemptId' | 'status'>;
    perception?: CharacterPerceptionPackage;
    updatedAt?: string;
  },
): PlayAttemptMutationResult {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  const operation = normalizeStepOperation(input.operation);
  const fingerprint = fingerprintPlayTurnAttemptStepOperation(operation);
  const replay = replayAttemptMutation(attempt, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  assertAttemptActive(attempt);
  if (attempt.status !== 'running') {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'A prepared Play attempt cannot receive another actor step.',
    );
  }
  if (operation.mode === 'next' && attempt.currentStepRef !== undefined) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play next cannot replace the current provisional step; use typed Retry.',
    );
  }
  if (operation.mode === 'retry') {
    const source = attempt.steps.find((candidate) =>
      candidate.id === operation.sourceStepRef);
    if (
      attempt.currentStepRef !== operation.sourceStepRef ||
      !source ||
      source.status !== 'draft'
    ) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        'Play Retry must replace the current provisional draft.',
      );
    }
  }
  if (!input.step) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'A new Play step mutation requires prepared provider output.',
    );
  }
  const step = normalizeCharacterStepDraft({
    ...input.step,
    attemptId: attempt.id,
    status: 'draft',
  }, attempt.id);
  const attemptedHardDue = step.settlementContribution.events.find((event) =>
    event.cause.triggerId !== undefined);
  if (attemptedHardDue) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Actor step ${step.id} cannot settle hard-due event ${attemptedHardDue.cause.triggerId}.`,
    );
  }
  const attemptedParticipantGrant = step.settlementContribution.knowledgeChanges.find(
    (change) => change.type === 'grantParticipantKnowledge',
  );
  if (attemptedParticipantGrant) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Actor/referee output cannot forge a Director participant knowledge grant.',
    );
  }
  const changedHardDue = step.settlementContribution.scheduledEventChanges.find(
    (change) =>
      change.type !== 'schedule' &&
      attempt.dueScheduledEventIds.includes(change.scheduledEventId),
  );
  if (changedHardDue && changedHardDue.type !== 'schedule') {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Actor step ${step.id} cannot change hard-due event ${changedHardDue.scheduledEventId}.`,
    );
  }
  if (!input.perception) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'A new Play step mutation requires its participant perception.',
    );
  }
  const perception = normalizeCharacterPerceptionPackage(input.perception);
  if (
    perception.id !== step.perceptionRef ||
    perception.participantRef !== step.participantRef
  ) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play actor step does not match its participant perception.',
    );
  }
  assertNarrativeBlocksWithinPerception(
    step.narrativeBlocks,
    perception,
  );
  const allowedDecisionRefs = new Set(
    [
      ...perception.initialKnowledgeEvidence.map((evidence) => evidence.id),
      ...perception.grantedKnowledgeEvidence.map((evidence) => evidence.id),
      ...perception.grantedKnowledgeEvidence.flatMap((evidence) => evidence.factRefs),
    ],
  );
  const forbiddenDecisionRef = step.decisionBasisRefs.find((decisionRef) =>
    !allowedDecisionRefs.has(decisionRef));
  if (forbiddenDecisionRef) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Play actor step references forbidden knowledge: ${forbiddenDecisionRef}.`,
    );
  }
  const expectedQueueIndex = attempt.selectedStepRefs.length;
  if (
    step.queueIndex !== expectedQueueIndex ||
    step.participantRef !== attempt.actorOrder[expectedQueueIndex]
  ) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play actor step does not match the fixed actor queue.',
    );
  }
  const expectedBeforeRef = attempt.selectedHeadRef;
  if (step.beforeStepRef !== expectedBeforeRef) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play actor step does not start from the selected attempt head.',
    );
  }
  if (attempt.steps.some((candidate) => candidate.id === step.id)) {
    throw new PlayTurnAttemptError('invalidTransition', `Duplicate Play step id: ${step.id}.`);
  }
  if (step.variantOf) {
    const variantSource = attempt.steps.find((candidate) => candidate.id === step.variantOf);
    if (
      !variantSource ||
      variantSource.queueIndex !== step.queueIndex ||
      variantSource.beforeStepRef !== step.beforeStepRef ||
      variantSource.participantRef !== step.participantRef
    ) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        `Play Retry references an incompatible step variant: ${step.variantOf}.`,
      );
    }
  }
  if (
    (operation.mode === 'next' && step.variantOf !== undefined) ||
    (
      operation.mode === 'retry' &&
      step.variantOf !== operation.sourceStepRef
    )
  ) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play step variant does not match its next/retry operation.',
    );
  }
  return mutateAttempt(
    attempt,
    input,
    fingerprint,
    step.id,
    step,
    (draft) => {
      const steps = draft.steps.map((candidate) =>
        candidate.id === draft.currentStepRef && candidate.status === 'draft'
          ? { ...candidate, status: 'superseded' as const }
          : candidate);
      steps.push(step);
      return {
        ...draft,
        steps,
        currentStepRef: step.id,
      };
    },
  );
}

export function acceptPlayTurnAttemptStep(
  attemptValue: PlayTurnAttempt,
  input: PlayAttemptMutationInput & {
    stepRef: string;
    updatedAt?: string;
  },
): PlayAttemptMutationResult {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  const stepRef = assertSafePlayRehearsalId(input.stepRef, 'accepted stepRef');
  const fingerprint = fingerprintPlayAttemptRequest({ kind: 'accept', stepRef });
  const replay = replayAttemptMutation(attempt, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  assertAttemptActive(attempt);
  if (attempt.status !== 'running') {
    throw new PlayTurnAttemptError('invalidTransition', 'Only a running attempt can accept a step.');
  }
  if (attempt.currentStepRef !== stepRef) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Play Accept requires the current provisional step: ${stepRef}.`,
    );
  }
  const step = attempt.steps.find((candidate) => candidate.id === stepRef);
  if (!step || step.status !== 'draft') {
    throw new PlayTurnAttemptError('stepNotFound', `Play step is not selectable: ${stepRef}.`);
  }
  return mutateAttempt(
    attempt,
    input,
    fingerprint,
    stepRef,
    { kind: 'accept', stepRef },
    (draft) => {
      const selectedStepRefs = [...draft.selectedStepRefs, stepRef];
      return {
        ...draft,
        status: selectedStepRefs.length === draft.actorOrder.length
          ? 'prepared'
          : 'running',
        steps: draft.steps.map((candidate) =>
          candidate.id === stepRef
            ? { ...candidate, status: 'selected' as const }
            : candidate),
        selectedStepRefs,
        selectedHeadRef: stepRef,
        currentStepRef: undefined,
      };
    },
  );
}

export function revisePlayTurnAttemptProjection(
  attemptValue: PlayTurnAttempt,
  input: PlayDirectorInterventionMutationInput & {
    stepRef: string;
    replacementBlocks: NarrativeBlock[];
    expectedEffectFingerprint: string;
  },
): PlayAttemptMutationResult {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  assertAttemptActive(attempt);
  const stepRef = assertSafePlayRehearsalId(input.stepRef, 'revised stepRef');
  const interventionId = assertSafePlayRehearsalId(
    input.interventionId,
    'revise interventionId',
  );
  const expectedEffectFingerprint = normalizeSha256(
    input.expectedEffectFingerprint,
    'expectedEffectFingerprint',
  );
  const replacementBlocks = normalizeBoundedArray(
    input.replacementBlocks,
    96,
    'Play reviseProjection replacementBlocks',
  ).map(normalizeNarrativeBlock);
  assertUnique(replacementBlocks.map((block) => block.id), 'replacement NarrativeBlock id');
  if (replacementBlocks.some((block) => block.kind === 'worldNotice')) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play reviseProjection cannot rewrite host-derived world notices.',
    );
  }
  const fingerprint = fingerprintPlayAttemptRequest({
    kind: 'reviseProjection',
    stepRef,
    replacementBlocks,
    expectedEffectFingerprint,
  });
  const replay = replayAttemptMutation(attempt, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  const target = requireLiveAttemptStep(attempt, stepRef);
  if (target.effectFingerprint !== expectedEffectFingerprint) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play reviseProjection effect fingerprint no longer matches its target step.',
    );
  }
  assertProjectionReplacementSafe(target, replacementBlocks);
  const targetIndex = target.queueIndex;
  const selectedTarget = target.status === 'selected';
  const selectedSuffixRefs = selectedTarget
    ? attempt.selectedStepRefs.slice(targetIndex)
    : [];
  const supersededStepRefs = [
    ...selectedSuffixRefs,
    ...(attempt.currentStepRef && !selectedSuffixRefs.includes(attempt.currentStepRef)
      ? [attempt.currentStepRef]
      : []),
  ];
  const nextRevision = attempt.attemptRevision + 1;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const replacementStepRef = deriveInterventionStepId(interventionId, 'step');
  const replacementStep: CharacterStepDraft = normalizeCharacterStepDraft({
    ...target,
    id: replacementStepRef,
    beforeStepRef: target.beforeStepRef,
    narrativeBlocks: [
      ...replacementBlocks,
      ...cloneWorldNoticesForStep(target, replacementStepRef),
    ],
    variantOf: target.id,
    status: selectedTarget ? 'selected' : 'draft',
    createdAt,
  }, attempt.id);
  const carrySteps: CharacterStepDraft[] = [];
  const nextSelectedRefs = selectedTarget
    ? [...attempt.selectedStepRefs.slice(0, targetIndex), replacementStepRef]
    : [...attempt.selectedStepRefs];
  if (selectedTarget) {
    let beforeStepRef = replacementStepRef;
    for (const [offset, oldRef] of selectedSuffixRefs.slice(1).entries()) {
      const source = attempt.steps.find((step) => step.id === oldRef)!;
      const carryRef = deriveInterventionStepId(interventionId, `carry-${offset + 1}`);
      const carry = normalizeCharacterStepDraft({
        ...source,
        id: carryRef,
        beforeStepRef,
        narrativeBlocks: cloneBlocksForStep(source, carryRef),
        variantOf: source.id,
        status: 'selected',
        createdAt,
      }, attempt.id);
      carrySteps.push(carry);
      nextSelectedRefs.push(carry.id);
      beforeStepRef = carry.id;
    }
  }
  const intervention: PlayDirectorIntervention = {
    schemaVersion: 1,
    id: interventionId,
    attemptId: attempt.id,
    attemptRevision: nextRevision,
    createdAt,
    provenance: { actor: 'user', source: 'directorControl' },
    supersededStepRefs,
    kind: 'reviseProjection',
    stepRef,
    replacementStepRef,
    replacementBlocks,
    expectedEffectFingerprint,
  };
  return mutateAttempt(
    attempt,
    input,
    fingerprint,
    intervention.id,
    intervention,
    (draft) => {
      const superseded = new Set(supersededStepRefs);
      const steps = draft.steps.map((step) => superseded.has(step.id)
        ? { ...step, status: 'superseded' as const }
        : step);
      steps.push(replacementStep, ...carrySteps);
      return {
        ...draft,
        status: selectedTarget && nextSelectedRefs.length === draft.actorOrder.length
          ? 'prepared'
          : 'running',
        steps,
        selectedStepRefs: nextSelectedRefs,
        selectedHeadRef: nextSelectedRefs.at(-1),
        currentStepRef: selectedTarget ? undefined : replacementStepRef,
        interventions: [...draft.interventions, intervention],
      };
    },
  );
}

/**
 * Applies a host-adjudicated redirect. Public transports must never accept
 * `replacementStep` or `perception` from the renderer; the Backend prepares
 * both through the existing actor/referee pipeline before calling this seam.
 */
export function applyPlayTurnAttemptRedirect(
  attemptValue: PlayTurnAttempt,
  input: PlayDirectorInterventionMutationInput & {
    stepRef: string;
    directorIntent: string;
    authorConstraintRefs: string[];
    replacementStep: Omit<CharacterStepDraft, 'attemptId' | 'status'>;
    perception: CharacterPerceptionPackage;
  },
): PlayAttemptMutationResult {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  assertAttemptActive(attempt);
  const stepRef = assertSafePlayRehearsalId(input.stepRef, 'redirected stepRef');
  const interventionId = assertSafePlayRehearsalId(
    input.interventionId,
    'redirect interventionId',
  );
  const directorIntent = normalizeText(input.directorIntent, 'directorIntent', MAX_ATTEMPT_TEXT);
  const authorConstraintRefs = normalizeSafeIdList(
    input.authorConstraintRefs,
    'authorConstraintRefs',
    64,
  );
  const fingerprint = fingerprintPlayAttemptRequest({
    kind: 'redirectStep',
    stepRef,
    directorIntent,
    authorConstraintRefs,
  });
  const replay = replayAttemptMutation(attempt, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  const target = requireLiveAttemptStep(attempt, stepRef);
  const selectedTarget = target.status === 'selected';
  const selectedPrefixRefs = attempt.selectedStepRefs.slice(0, target.queueIndex);
  const expectedBeforeRef = selectedPrefixRefs.at(-1);
  const perception = normalizeCharacterPerceptionPackage(input.perception);
  const allowedConstraintRefs = new Set(listPlayRedirectConstraintRefs(perception));
  const forbiddenConstraintRef = authorConstraintRefs.find((constraintRef) =>
    !allowedConstraintRefs.has(constraintRef));
  if (forbiddenConstraintRef) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Play redirect constraint is outside the target participant perception: ${forbiddenConstraintRef}.`,
    );
  }
  const replacementStep = normalizeCharacterStepDraft({
    ...input.replacementStep,
    attemptId: attempt.id,
    status: selectedTarget ? 'selected' : 'draft',
  }, attempt.id);
  if (
    replacementStep.id === target.id ||
    attempt.steps.some((step) => step.id === replacementStep.id) ||
    replacementStep.variantOf !== target.id ||
    replacementStep.queueIndex !== target.queueIndex ||
    replacementStep.participantRef !== target.participantRef ||
    replacementStep.beforeStepRef !== expectedBeforeRef ||
    perception.id !== replacementStep.perceptionRef ||
    perception.participantRef !== replacementStep.participantRef
  ) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Host-adjudicated Play redirect does not fork from the target before-step snapshot.',
    );
  }
  assertStepWithinPerception(replacementStep, perception);
  const selectedSuffixRefs = selectedTarget
    ? attempt.selectedStepRefs.slice(target.queueIndex)
    : [];
  const supersededStepRefs = [
    ...selectedSuffixRefs,
    ...(attempt.currentStepRef && !selectedSuffixRefs.includes(attempt.currentStepRef)
      ? [attempt.currentStepRef]
      : []),
  ];
  const nextSelectedRefs = selectedTarget
    ? [...selectedPrefixRefs, replacementStep.id]
    : [...selectedPrefixRefs];
  const nextRevision = attempt.attemptRevision + 1;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const intervention: PlayDirectorIntervention = {
    schemaVersion: 1,
    id: interventionId,
    attemptId: attempt.id,
    attemptRevision: nextRevision,
    createdAt,
    provenance: { actor: 'user', source: 'directorControl' },
    supersededStepRefs,
    kind: 'redirectStep',
    stepRef,
    replacementStepRef: replacementStep.id,
    directorIntent,
    authorConstraintRefs,
  };
  return mutateAttempt(
    attempt,
    input,
    fingerprint,
    intervention.id,
    intervention,
    (draft) => {
      const superseded = new Set(supersededStepRefs);
      return {
        ...draft,
        status: selectedTarget && nextSelectedRefs.length === draft.actorOrder.length
          ? 'prepared'
          : 'running',
        steps: [
          ...draft.steps.map((step) => superseded.has(step.id)
            ? { ...step, status: 'superseded' as const }
            : step),
          replacementStep,
        ],
        selectedStepRefs: nextSelectedRefs,
        selectedHeadRef: nextSelectedRefs.at(-1),
        currentStepRef: selectedTarget ? undefined : replacementStep.id,
        interventions: [...draft.interventions, intervention],
      };
    },
  );
}

export function insertPlayTurnAttemptActor(
  attemptValue: PlayTurnAttempt,
  input: PlayDirectorInterventionMutationInput & {
    participantRef: string;
    beforeStepRef?: string;
    afterStepRef?: string;
  },
): PlayAttemptMutationResult {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  assertAttemptActive(attempt);
  const interventionId = assertSafePlayRehearsalId(
    input.interventionId,
    'insert interventionId',
  );
  const participantRef = assertSafePlayRehearsalId(
    input.participantRef,
    'insert participantRef',
  );
  if (!attempt.participantRefs.includes(participantRef)) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Play insertActor references a participant outside the Scene Contract: ${participantRef}.`,
    );
  }
  const beforeStepRef = input.beforeStepRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(input.beforeStepRef, 'insert beforeStepRef');
  const afterStepRef = input.afterStepRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(input.afterStepRef, 'insert afterStepRef');
  if (beforeStepRef && afterStepRef) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play insertActor accepts either beforeStepRef or afterStepRef, not both.',
    );
  }
  const anchorRef = beforeStepRef ?? afterStepRef;
  const anchor = anchorRef
    ? attempt.steps.find((step) =>
        step.id === anchorRef && (step.status === 'selected' || step.status === 'draft'))
    : undefined;
  if (anchorRef && !anchor) {
    throw new PlayTurnAttemptError(
      'stepNotFound',
      `Play insertActor anchor is not on the live branch: ${anchorRef}.`,
    );
  }
  const desiredIndex = anchor
    ? anchor.queueIndex + (afterStepRef ? 1 : 0)
    : attempt.selectedStepRefs.length;
  const oldIndex = attempt.actorOrder.indexOf(participantRef);
  const withoutParticipant = attempt.actorOrder.filter((ref) => ref !== participantRef);
  const adjustedIndex = Math.max(
    0,
    Math.min(
      withoutParticipant.length,
      oldIndex >= 0 && oldIndex < desiredIndex ? desiredIndex - 1 : desiredIndex,
    ),
  );
  const actorOrder = [...withoutParticipant];
  actorOrder.splice(adjustedIndex, 0, participantRef);
  const firstChangedIndex = actorOrder.findIndex((ref, index) =>
    ref !== attempt.actorOrder[index]);
  const invalidationIndex = firstChangedIndex < 0
    ? attempt.selectedStepRefs.length
    : firstChangedIndex;
  const supersededStepRefs = [
    ...attempt.selectedStepRefs.slice(invalidationIndex),
    ...(attempt.currentStepRef ? [attempt.currentStepRef] : []),
  ];
  const selectedStepRefs = attempt.selectedStepRefs.slice(0, invalidationIndex);
  const fingerprint = fingerprintPlayAttemptRequest({
    kind: 'insertActor',
    participantRef,
    ...(beforeStepRef ? { beforeStepRef } : {}),
    ...(afterStepRef ? { afterStepRef } : {}),
  });
  const replay = replayAttemptMutation(attempt, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const intervention: PlayDirectorIntervention = {
    schemaVersion: 1,
    id: interventionId,
    attemptId: attempt.id,
    attemptRevision: attempt.attemptRevision + 1,
    createdAt,
    provenance: { actor: 'user', source: 'directorControl' },
    supersededStepRefs,
    kind: 'insertActor',
    participantRef,
    insertionIndex: adjustedIndex,
    ...(beforeStepRef ? { beforeStepRef } : {}),
    ...(afterStepRef ? { afterStepRef } : {}),
  };
  return mutateAttempt(
    attempt,
    input,
    fingerprint,
    intervention.id,
    intervention,
    (draft) => {
      const superseded = new Set(supersededStepRefs);
      return {
        ...draft,
        status: selectedStepRefs.length === actorOrder.length ? 'prepared' : 'running',
        actorOrder,
        steps: draft.steps.map((step) => superseded.has(step.id)
          ? { ...step, status: 'superseded' as const }
          : step),
        selectedStepRefs,
        selectedHeadRef: selectedStepRefs.at(-1),
        currentStepRef: undefined,
        interventions: [...draft.interventions, intervention],
      };
    },
  );
}

export function grantPlayTurnAttemptKnowledge(
  attemptValue: PlayTurnAttempt,
  input: PlayDirectorInterventionMutationInput & {
    participantRef: string;
    effectiveFromStepRef: string;
    grant: PlayDirectorKnowledgeGrant;
    availableFactRefs?: string[];
  },
): PlayAttemptMutationResult {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  assertAttemptActive(attempt);
  const interventionId = assertSafePlayRehearsalId(
    input.interventionId,
    'grant interventionId',
  );
  const participantRef = assertSafePlayRehearsalId(
    input.participantRef,
    'grant participantRef',
  );
  if (!attempt.participantRefs.includes(participantRef)) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Play grantKnowledge references a participant outside the Scene Contract: ${participantRef}.`,
    );
  }
  const effectiveFromStepRef = assertSafePlayRehearsalId(
    input.effectiveFromStepRef,
    'grant effectiveFromStepRef',
  );
  const target = requireLiveAttemptStep(attempt, effectiveFromStepRef);
  const grant = normalizePlayDirectorKnowledgeGrant(input.grant);
  if (grant.kind === 'existingFact') {
    const available = new Set(normalizeSafeIdList(
      input.availableFactRefs ?? [],
      'availableFactRefs',
      512,
    ));
    const unavailable = grant.factRefs.find((factRef) => !available.has(factRef));
    if (unavailable) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        `Play grantKnowledge references an unavailable stable fact: ${unavailable}.`,
      );
    }
  }
  const fingerprint = fingerprintPlayAttemptRequest({
    kind: 'grantKnowledge',
    participantRef,
    effectiveFromStepRef,
    grant,
  });
  const replay = replayAttemptMutation(attempt, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  const selectedPrefixRefs = attempt.selectedStepRefs.slice(0, target.queueIndex);
  const supersededStepRefs = [
    ...attempt.selectedStepRefs.slice(target.queueIndex),
    ...(attempt.currentStepRef && !attempt.selectedStepRefs.includes(attempt.currentStepRef)
      ? [attempt.currentStepRef]
      : []),
  ];
  const createdAt = input.createdAt ?? new Date().toISOString();
  const intervention: PlayDirectorIntervention = {
    schemaVersion: 1,
    id: interventionId,
    attemptId: attempt.id,
    attemptRevision: attempt.attemptRevision + 1,
    createdAt,
    provenance: { actor: 'user', source: 'directorControl' },
    supersededStepRefs,
    kind: 'grantKnowledge',
    participantRef,
    effectiveFromStepRef,
    effectiveFromQueueIndex: target.queueIndex,
    selectedPrefixRefs,
    grant,
  };
  return mutateAttempt(
    attempt,
    input,
    fingerprint,
    intervention.id,
    intervention,
    (draft) => {
      const superseded = new Set(supersededStepRefs);
      return {
        ...draft,
        status: 'running',
        steps: draft.steps.map((step) => superseded.has(step.id)
          ? { ...step, status: 'superseded' as const }
          : step),
        selectedStepRefs: selectedPrefixRefs,
        selectedHeadRef: selectedPrefixRefs.at(-1),
        currentStepRef: undefined,
        interventions: [...draft.interventions, intervention],
      };
    },
  );
}

export function listActivePlayParticipantKnowledgeGrants(
  attemptValue: PlayTurnAttempt,
  participantRefValue: string,
  throughQueueIndex = Number.MAX_SAFE_INTEGER,
): Extract<PlayDirectorIntervention, { kind: 'grantKnowledge' }>[] {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  const participantRef = assertSafePlayRehearsalId(
    participantRefValue,
    'participant knowledge participantRef',
  );
  const queueIndex = normalizeNonNegativeInteger(throughQueueIndex, 'throughQueueIndex');
  return attempt.interventions.filter(
    (intervention): intervention is Extract<PlayDirectorIntervention, { kind: 'grantKnowledge' }> => {
      if (
        intervention.kind !== 'grantKnowledge' ||
        intervention.participantRef !== participantRef ||
        intervention.effectiveFromQueueIndex > queueIndex
      ) return false;
      return intervention.selectedPrefixRefs.every((stepRef, index) =>
        attempt.selectedStepRefs[index] === stepRef);
    },
  ).map((intervention) => structuredClone(intervention));
}

export function preparePlayTurnAttemptRetry(
  attemptValue: PlayTurnAttempt,
  stepRefValue: string,
): {
  attemptId: string;
  participantRef: string;
  queueIndex: number;
  beforeStepRef?: string;
  variantOf: string;
} {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  assertAttemptActive(attempt);
  if (attempt.status !== 'running') {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'F1 Retry requires a running attempt with a provisional step.',
    );
  }
  const stepRef = assertSafePlayRehearsalId(stepRefValue, 'retry stepRef');
  const step = attempt.steps.find((candidate) => candidate.id === stepRef);
  if (!step || step.status !== 'draft' || attempt.currentStepRef !== stepRef) {
    throw new PlayTurnAttemptError('stepNotFound', `Play step is not retryable: ${stepRef}.`);
  }
  return {
    attemptId: attempt.id,
    participantRef: step.participantRef,
    queueIndex: step.queueIndex,
    ...(step.beforeStepRef ? { beforeStepRef: step.beforeStepRef } : {}),
    variantOf: step.id,
  };
}

export function cancelPlayTurnAttempt(
  attemptValue: PlayTurnAttempt,
  input: PlayAttemptMutationInput & {
    reason?: string;
    updatedAt?: string;
  },
): PlayAttemptMutationResult {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  const reason = input.reason?.trim();
  const fingerprint = fingerprintPlayAttemptRequest({
    kind: 'cancel',
    ...(reason ? { reason } : {}),
  });
  const replay = replayAttemptMutation(attempt, input.idempotencyKey, fingerprint);
  if (replay) return replay;
  assertAttemptActive(attempt);
  return mutateAttempt(
    attempt,
    input,
    fingerprint,
    attempt.id,
    { kind: 'cancel', ...(reason ? { reason } : {}) },
    (draft) => ({
      ...draft,
      status: 'cancelled',
      currentStepRef: undefined,
      steps: draft.steps.map((step) =>
        step.status === 'draft'
          ? { ...step, status: 'discarded' as const }
          : step),
    }),
  );
}

export function assertPlayTurnAttemptFinalizable(
  attemptValue: PlayTurnAttempt,
  input: {
    expectedAttemptRevision: number;
    selectedHeadRef: string;
    currentSessionRevision: number;
  },
): PlayTurnAttempt {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  if (attempt.status !== 'prepared') {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play Finish requires a prepared attempt.',
    );
  }
  const expectedRevision = normalizeNonNegativeInteger(
    input.expectedAttemptRevision,
    'expectedAttemptRevision',
  );
  if (expectedRevision !== attempt.attemptRevision) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      `Play attempt revision conflict: expected ${expectedRevision}, current ${attempt.attemptRevision}.`,
    );
  }
  const selectedHeadRef = assertSafePlayRehearsalId(
    input.selectedHeadRef,
    'selectedHeadRef',
  );
  if (selectedHeadRef !== attempt.selectedHeadRef) {
    throw new PlayTurnAttemptError(
      'selectedHeadConflict',
      `Play selected head conflict: expected ${selectedHeadRef}, current ${attempt.selectedHeadRef ?? 'none'}.`,
    );
  }
  const currentSessionRevision = normalizeNonNegativeInteger(
    input.currentSessionRevision,
    'currentSessionRevision',
  );
  if (currentSessionRevision !== attempt.baseRevision) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      `Play rehearsal session revision conflict: expected ${attempt.baseRevision}, current ${currentSessionRevision}.`,
    );
  }
  return attempt;
}

export function markPlayTurnAttemptCommitted(
  attemptValue: PlayTurnAttempt,
  input: {
    artifactRef: string;
    evidenceRef: string;
    updatedAt?: string;
  },
): PlayTurnAttempt {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  if (attempt.status !== 'prepared') {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Only a prepared Play attempt can become committed.',
    );
  }
  return normalizePlayTurnAttempt({
    ...attempt,
    status: 'committed',
    committedArtifactRef: assertSafePlayRehearsalId(
      input.artifactRef,
      'committed artifactRef',
    ),
    committedEvidenceRef: assertSafePlayRehearsalId(
      input.evidenceRef,
      'committed evidenceRef',
    ),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

export function fingerprintPlayAttemptRequest(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

export function fingerprintPlayStepEffects(
  settlementValue: PlayWorldRefereeSettlement,
): string {
  return fingerprintPlayAttemptRequest(
    normalizePlayWorldRefereeSettlement(settlementValue),
  );
}

export function classifyPlayStepMaterialEffect(
  settlementValue: PlayWorldRefereeSettlement,
): PlayStepMaterialEffect {
  const settlement = normalizePlayWorldRefereeSettlement(settlementValue);
  const material = Boolean(
    settlement.elapsed ||
    settlement.worldTimeAnchor ||
    settlement.events.length ||
    settlement.knowledgeChanges.length ||
    settlement.pressureChanges.length ||
    settlement.agendaChanges.length ||
    settlement.scheduledEventChanges.length ||
    Object.keys(settlement.stateDelta).length,
  );
  return material
    ? { kind: 'materialEffect' }
    : {
        kind: 'noMaterialEffect',
        reason: 'No typed event, state, schedule, knowledge, momentum, or time effect.',
      };
}

export function schedulePlayRehearsalActorOrder(input: {
  strategy: PlayRehearsalOrderStrategy;
  participantRefs: string[];
  directorOrder?: string[];
  refereeOrder?: string[];
}): string[] {
  const strategy = normalizeOrderStrategy(input.strategy);
  const participants = normalizeSafeIdList(
    input.participantRefs,
    'scheduler participantRefs',
    24,
  );
  if (!participants.length) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play rehearsal actor scheduler requires participants.',
    );
  }
  const assertPermutation = (value: string[] | undefined, label: string): string[] => {
    const order = normalizeSafeIdList(value ?? [], label, 24);
    if (
      order.length !== participants.length ||
      participants.some((participantRef) => !order.includes(participantRef))
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `${label} must be a permutation of scene participants.`,
      );
    }
    return order;
  };
  if (strategy === 'directorFixed') {
    return input.directorOrder
      ? assertPermutation(input.directorOrder, 'directorOrder')
      : [...participants];
  }
  if (strategy === 'refereeDynamic') {
    return assertPermutation(input.refereeOrder, 'refereeOrder');
  }
  const pinned = normalizeSafeIdList(
    input.directorOrder ?? [],
    'directorOrder',
    24,
  );
  if (pinned.some((participantRef) => !participants.includes(participantRef))) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Hybrid directorOrder contains a non-scene participant.',
    );
  }
  const dynamic = assertPermutation(input.refereeOrder, 'refereeOrder');
  return [...pinned, ...dynamic.filter((participantRef) => !pinned.includes(participantRef))];
}

export function fingerprintPlayTurnAttemptStepOperation(
  operationValue: { mode: 'next' } | { mode: 'retry'; sourceStepRef: string },
): string {
  return fingerprintPlayAttemptRequest({
    kind: 'stepPrepared',
    operation: normalizeStepOperation(operationValue),
  });
}

export function findPlayAttemptMutationReceipt(
  attemptValue: PlayTurnAttempt,
  idempotencyKeyValue: string,
  requestFingerprint: string,
): PlayAttemptMutationReceipt | undefined {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  const idempotencyKey = assertSafePlayRehearsalId(
    idempotencyKeyValue,
    'attempt idempotencyKey',
  );
  const fingerprint = normalizeText(
    requestFingerprint,
    'requestFingerprint',
    512,
  );
  const receipt = attempt.mutationReceipts.find((candidate) =>
    candidate.idempotencyKey === idempotencyKey);
  if (!receipt) return undefined;
  if (receipt.requestFingerprint !== fingerprint) {
    throw new PlayTurnAttemptError(
      'idempotencyConflict',
      `Play attempt idempotency key was reused with another payload: ${idempotencyKey}.`,
    );
  }
  return receipt;
}

function replayAttemptMutation(
  attempt: PlayTurnAttempt,
  idempotencyKey: string,
  requestFingerprint: string,
): PlayAttemptMutationResult | undefined {
  const receipt = findPlayAttemptMutationReceipt(
    attempt,
    idempotencyKey,
    requestFingerprint,
  );
  return receipt
    ? { attempt, receipt, replayed: true }
    : undefined;
}

function mutateAttempt(
  attempt: PlayTurnAttempt,
  input: PlayAttemptMutationInput & { updatedAt?: string },
  requestFingerprint: string,
  resultRef: string,
  responseValue: unknown,
  mutate: (attempt: PlayTurnAttempt) => PlayTurnAttempt,
): PlayAttemptMutationResult {
  const idempotencyKey = assertSafePlayRehearsalId(
    input.idempotencyKey,
    'attempt idempotencyKey',
  );
  const existingReceipt = attempt.mutationReceipts.find((receipt) =>
    receipt.idempotencyKey === idempotencyKey);
  if (existingReceipt) {
    if (existingReceipt.requestFingerprint !== requestFingerprint) {
      throw new PlayTurnAttemptError(
        'idempotencyConflict',
        `Play attempt idempotency key was reused with another payload: ${idempotencyKey}.`,
      );
    }
    return {
      attempt,
      receipt: existingReceipt,
      replayed: true,
    };
  }
  const expectedRevision = normalizeNonNegativeInteger(
    input.expectedAttemptRevision,
    'expectedAttemptRevision',
  );
  if (expectedRevision !== attempt.attemptRevision) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      `Play attempt revision conflict: expected ${expectedRevision}, current ${attempt.attemptRevision}.`,
    );
  }
  if (attempt.mutationReceipts.length >= MAX_ATTEMPT_RECEIPTS) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play attempt receipt limit has been reached.',
    );
  }
  const nextRevision = attempt.attemptRevision + 1;
  const mutated = mutate(structuredClone(attempt));
  const mutatedStepsById = new Map(mutated.steps.map((step) => [step.id, step]));
  mutated.stagnation = derivePlayAttemptStagnation(
    mutated.selectedStepRefs,
    mutatedStepsById,
    mutated.stagnation.threshold,
  );
  const receipt: PlayAttemptMutationReceipt = {
    idempotencyKey,
    requestFingerprint,
    resultingAttemptRevision: nextRevision,
    resultRef,
    responseDigest: fingerprintPlayAttemptRequest(responseValue),
  };
  const next = normalizePlayTurnAttempt({
    ...mutated,
    attemptRevision: nextRevision,
    mutationReceipts: [...attempt.mutationReceipts, receipt],
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
  return { attempt: next, receipt, replayed: false };
}

function normalizeStepOperation(
  value: unknown,
): { mode: 'next' } | { mode: 'retry'; sourceStepRef: string } {
  const record = requireRecord(value, 'Play step operation');
  if (record.mode === 'next') {
    assertOnlyKnownFields(record, ['mode'], 'Play step operation');
    return { mode: 'next' };
  }
  if (record.mode === 'retry') {
    assertOnlyKnownFields(
      record,
      ['mode', 'sourceStepRef'],
      'Play step operation',
    );
    return {
      mode: 'retry',
      sourceStepRef: assertSafePlayRehearsalId(
        record.sourceStepRef,
        'retry sourceStepRef',
      ),
    };
  }
  throw new PlayTurnAttemptError(
    'invalidAttempt',
    'Play step operation must be next or retry.',
  );
}

function normalizeCharacterStepDraft(
  value: unknown,
  expectedAttemptId: string,
): CharacterStepDraft {
  const record = requireRecord(value, 'Stored Play character step');
  assertOnlyKnownFields(record, [
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
  ], 'Stored Play character step');
  const statuses: CharacterStepDraftStatus[] = [
    'draft',
    'selected',
    'superseded',
    'discarded',
  ];
  if (!statuses.includes(record.status as CharacterStepDraftStatus)) {
    throw new PlayTurnAttemptError('invalidAttempt', 'Stored Play step has invalid status.');
  }
  const attemptId = assertSafePlayRehearsalId(record.attemptId, 'step attemptId');
  if (attemptId !== expectedAttemptId) {
    throw new PlayTurnAttemptError('invalidAttempt', 'Stored Play step belongs to another attempt.');
  }
  const beforeStepRef = record.beforeStepRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.beforeStepRef, 'step beforeStepRef');
  const variantOf = record.variantOf === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.variantOf, 'step variantOf');
  const narrativeBlocks = normalizeBoundedArray(
    record.narrativeBlocks,
    96,
    'Stored Play step NarrativeBlocks',
  ).map(normalizeNarrativeBlock);
  assertUnique(narrativeBlocks.map((block) => block.id), 'step NarrativeBlock id');
  const id = assertSafePlayRehearsalId(record.id, 'step id');
  const settlementContribution = normalizePlayWorldRefereeSettlement(
    record.settlementContribution,
  );
  const effectFingerprint = fingerprintPlayStepEffects(settlementContribution);
  if (
    record.effectFingerprint !== undefined &&
    record.effectFingerprint !== effectFingerprint
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Stored Play step ${id} has a stale effect fingerprint.`,
    );
  }
  const worldNotices = narrativeBlocks.filter((block) =>
    block.kind === 'worldNotice');
  const visibleContributionEvents = settlementContribution.events.filter((event) =>
    event.visibility === 'playerVisible' && event.cause.triggerId === undefined);
  const expectedWorldNoticeContent = visibleContributionEvents.map((event) =>
    `${event.title}: ${event.summary}`).join('\n');
  if (
    worldNotices.length !== (visibleContributionEvents.length ? 1 : 0) ||
    worldNotices.some((block) =>
      visibleContributionEvents.length === 0 ||
      block.id !== `world-notice-${id}` ||
      block.speakerRef !== undefined ||
      block.content !== expectedWorldNoticeContent ||
      block.visibility !== 'playerVisible' ||
      block.projection !== 'transcript' ||
      block.eventRefs.length !== 0 ||
      block.sourceRefs.length !== 0)
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Stored Play step ${id} contains invalid provisional world notice evidence.`,
    );
  }
  return {
    id,
    attemptId,
    participantRef: assertSafePlayRehearsalId(record.participantRef, 'step participantRef'),
    queueIndex: normalizeNonNegativeInteger(record.queueIndex, 'step queueIndex'),
    ...(beforeStepRef ? { beforeStepRef } : {}),
    perceptionRef: assertSafePlayRehearsalId(record.perceptionRef, 'step perceptionRef'),
    intentSummary: normalizeText(record.intentSummary, 'step intentSummary', 800),
    narrativeBlocks,
    settlementContribution,
    effectFingerprint,
    decisionBasisRefs: normalizeSafeIdList(
      record.decisionBasisRefs,
      'step decisionBasisRefs',
      128,
    ),
    ...(variantOf ? { variantOf } : {}),
    materialEffect: normalizePlayStepMaterialEffect(
      record.materialEffect ?? classifyPlayStepMaterialEffect(settlementContribution),
    ),
    status: record.status as CharacterStepDraftStatus,
    createdAt: normalizeText(record.createdAt, 'step createdAt', 128),
  };
}

function assertCompatibleStepVariant(
  step: CharacterStepDraft,
  stepsById: Map<string, CharacterStepDraft>,
): void {
  const visited = new Set([step.id]);
  let current = step;
  while (current.variantOf) {
    if (visited.has(current.variantOf)) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play step ${step.id} contains a variant cycle.`,
      );
    }
    visited.add(current.variantOf);
    const source = stepsById.get(current.variantOf);
    if (
      !source ||
      source.queueIndex !== step.queueIndex ||
      source.participantRef !== step.participantRef
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play step ${step.id} references an incompatible variant source.`,
      );
    }
    current = source;
  }
}

function requireLiveAttemptStep(
  attempt: PlayTurnAttempt,
  stepRef: string,
): CharacterStepDraft {
  const step = attempt.steps.find((candidate) => candidate.id === stepRef);
  if (!step || (step.status !== 'selected' && step.status !== 'draft')) {
    throw new PlayTurnAttemptError(
      'stepNotFound',
      `Play Director intervention target is not on the live branch: ${stepRef}.`,
    );
  }
  return step;
}

function assertProjectionReplacementSafe(
  target: CharacterStepDraft,
  replacementBlocks: NarrativeBlock[],
): void {
  const targetProjectionBlocks = target.narrativeBlocks.filter((block) =>
    block.kind !== 'worldNotice');
  if (replacementBlocks.length !== targetProjectionBlocks.length) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play reviseProjection must preserve the narrative projection block cardinality.',
    );
  }
  targetProjectionBlocks.forEach((targetBlock, index) => {
    const replacement = replacementBlocks[index]!;
    const targetIsPlayerEditable = targetBlock.projection === 'transcript' &&
      targetBlock.visibility !== 'playerUnknown';
    if (!targetIsPlayerEditable && !isDeepStrictEqual(targetBlock, replacement)) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        'Play reviseProjection cannot alter or reorder Director-only narrative blocks.',
      );
    }
    if (
      targetIsPlayerEditable &&
      (replacement.projection !== 'transcript' || replacement.visibility === 'playerUnknown')
    ) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        'Play reviseProjection cannot turn a player-visible block into hidden narration.',
      );
    }
    if (
      targetIsPlayerEditable &&
      (
        replacement.kind !== targetBlock.kind ||
        replacement.speakerRef !== targetBlock.speakerRef ||
        replacement.visibility !== targetBlock.visibility ||
        replacement.projection !== targetBlock.projection ||
        !isDeepStrictEqual(replacement.eventRefs, targetBlock.eventRefs) ||
        !isDeepStrictEqual(replacement.sourceRefs, targetBlock.sourceRefs)
      )
    ) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        'Play reviseProjection may change block identity and text, but not its evidence metadata.',
      );
    }
  });
  const allowedSourceRefs = new Set(target.narrativeBlocks.flatMap((block) =>
    block.sourceRefs));
  const allowedEventRefs = new Set(target.narrativeBlocks.flatMap((block) =>
    block.eventRefs));
  for (const block of replacementBlocks) {
    if (
      (block.kind === 'characterSpeech' || block.kind === 'characterAction') &&
      block.speakerRef !== target.participantRef
    ) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        'Play reviseProjection cannot change the acting participant.',
      );
    }
    const widenedSource = block.sourceRefs.find((ref) => !allowedSourceRefs.has(ref));
    const widenedEvent = block.eventRefs.find((ref) => !allowedEventRefs.has(ref));
    if (widenedSource || widenedEvent) {
      throw new PlayTurnAttemptError(
        'invalidTransition',
        'Play reviseProjection cannot widen the target step evidence closure.',
      );
    }
  }
}

function assertStepWithinPerception(
  step: CharacterStepDraft,
  perception: CharacterPerceptionPackage,
): void {
  assertNarrativeBlocksWithinPerception(step.narrativeBlocks, perception);
  const allowedDecisionRefs = new Set([
    ...perception.initialKnowledgeEvidence.map((evidence) => evidence.id),
    ...perception.grantedKnowledgeEvidence.map((evidence) => evidence.id),
    ...perception.grantedKnowledgeEvidence.flatMap((evidence) => evidence.factRefs),
  ]);
  const forbiddenDecisionRef = step.decisionBasisRefs.find((decisionRef) =>
    !allowedDecisionRefs.has(decisionRef));
  if (forbiddenDecisionRef) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Play redirected step references forbidden knowledge: ${forbiddenDecisionRef}.`,
    );
  }
}

function cloneWorldNoticesForStep(
  source: CharacterStepDraft,
  nextStepRef: string,
): NarrativeBlock[] {
  return source.narrativeBlocks
    .filter((block) => block.kind === 'worldNotice')
    .map((block) => ({
      ...structuredClone(block),
      id: `world-notice-${nextStepRef}`,
    }));
}

function cloneBlocksForStep(
  source: CharacterStepDraft,
  nextStepRef: string,
): NarrativeBlock[] {
  return source.narrativeBlocks.map((block) => block.kind === 'worldNotice'
    ? { ...structuredClone(block), id: `world-notice-${nextStepRef}` }
    : structuredClone(block));
}

function deriveInterventionStepId(interventionId: string, suffix: string): string {
  const candidate = `${interventionId}-${suffix}`;
  return candidate.length <= 180
    ? assertSafePlayRehearsalId(candidate, 'intervention result step id')
    : `step-${fingerprintPlayAttemptRequest({ interventionId, suffix }).slice(0, 32)}`;
}

function normalizeAttemptReceipt(value: unknown): PlayAttemptMutationReceipt {
  const record = requireRecord(value, 'Stored Play attempt receipt');
  assertOnlyKnownFields(record, [
    'idempotencyKey',
    'requestFingerprint',
    'resultingAttemptRevision',
    'resultRef',
    'responseDigest',
  ], 'Stored Play attempt receipt');
  return {
    idempotencyKey: assertSafePlayRehearsalId(record.idempotencyKey, 'receipt idempotencyKey'),
    requestFingerprint: normalizeText(record.requestFingerprint, 'requestFingerprint', 512),
    resultingAttemptRevision: normalizeNonNegativeInteger(
      record.resultingAttemptRevision,
      'resultingAttemptRevision',
    ),
    resultRef: assertSafePlayRehearsalId(record.resultRef, 'receipt resultRef'),
    responseDigest: normalizeText(record.responseDigest, 'responseDigest', 512),
  };
}

function normalizePlayDirectorIntervention(
  value: unknown,
  expectedAttemptId: string,
): PlayDirectorIntervention {
  const record = requireRecord(value, 'Stored Play Director intervention');
  const baseFields = [
    'schemaVersion',
    'id',
    'attemptId',
    'attemptRevision',
    'createdAt',
    'provenance',
    'supersededStepRefs',
    'kind',
  ] as const;
  if (record.schemaVersion !== 1) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Unsupported Play Director intervention schemaVersion: ${String(record.schemaVersion)}.`,
    );
  }
  const attemptId = assertSafePlayRehearsalId(
    record.attemptId,
    'intervention attemptId',
  );
  if (attemptId !== expectedAttemptId) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Stored Play Director intervention belongs to another attempt.',
    );
  }
  const provenance = requireRecord(
    record.provenance,
    'Play Director intervention provenance',
  );
  assertOnlyKnownFields(
    provenance,
    ['actor', 'source'],
    'Play Director intervention provenance',
  );
  if (provenance.actor !== 'user' || provenance.source !== 'directorControl') {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play Director intervention requires user/directorControl provenance.',
    );
  }
  const base: PlayDirectorInterventionBase = {
    schemaVersion: 1,
    id: assertSafePlayRehearsalId(record.id, 'intervention id'),
    attemptId,
    attemptRevision: normalizePositiveInteger(
      record.attemptRevision,
      'intervention attemptRevision',
    ),
    createdAt: normalizeText(record.createdAt, 'intervention createdAt', 128),
    provenance: { actor: 'user', source: 'directorControl' },
    supersededStepRefs: normalizeSafeIdList(
      record.supersededStepRefs,
      'intervention supersededStepRefs',
      MAX_ATTEMPT_STEPS,
    ),
  };
  if (record.kind === 'reviseProjection') {
    assertOnlyKnownFields(record, [
      ...baseFields,
      'stepRef',
      'replacementStepRef',
      'replacementBlocks',
      'expectedEffectFingerprint',
    ], 'Play reviseProjection intervention');
    const replacementBlocks = normalizeBoundedArray(
      record.replacementBlocks,
      96,
      'Play reviseProjection replacementBlocks',
    ).map(normalizeNarrativeBlock);
    assertUnique(replacementBlocks.map((block) => block.id), 'replacement NarrativeBlock id');
    return {
      ...base,
      kind: 'reviseProjection',
      stepRef: assertSafePlayRehearsalId(record.stepRef, 'intervention stepRef'),
      replacementStepRef: assertSafePlayRehearsalId(
        record.replacementStepRef,
        'intervention replacementStepRef',
      ),
      replacementBlocks,
      expectedEffectFingerprint: normalizeSha256(
        record.expectedEffectFingerprint,
        'expectedEffectFingerprint',
      ),
    };
  }
  if (record.kind === 'redirectStep') {
    assertOnlyKnownFields(record, [
      ...baseFields,
      'stepRef',
      'replacementStepRef',
      'directorIntent',
      'authorConstraintRefs',
    ], 'Play redirectStep intervention');
    return {
      ...base,
      kind: 'redirectStep',
      stepRef: assertSafePlayRehearsalId(record.stepRef, 'intervention stepRef'),
      replacementStepRef: assertSafePlayRehearsalId(
        record.replacementStepRef,
        'intervention replacementStepRef',
      ),
      directorIntent: normalizeText(record.directorIntent, 'directorIntent', MAX_ATTEMPT_TEXT),
      authorConstraintRefs: normalizeSafeIdList(
        record.authorConstraintRefs,
        'authorConstraintRefs',
        64,
      ),
    };
  }
  if (record.kind === 'insertActor') {
    assertOnlyKnownFields(record, [
      ...baseFields,
      'participantRef',
      'insertionIndex',
      'beforeStepRef',
      'afterStepRef',
    ], 'Play insertActor intervention');
    const beforeStepRef = record.beforeStepRef === undefined
      ? undefined
      : assertSafePlayRehearsalId(record.beforeStepRef, 'insert beforeStepRef');
    const afterStepRef = record.afterStepRef === undefined
      ? undefined
      : assertSafePlayRehearsalId(record.afterStepRef, 'insert afterStepRef');
    if (beforeStepRef && afterStepRef) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        'Play insertActor accepts either beforeStepRef or afterStepRef, not both.',
      );
    }
    return {
      ...base,
      kind: 'insertActor',
      participantRef: assertSafePlayRehearsalId(
        record.participantRef,
        'insert participantRef',
      ),
      insertionIndex: normalizeNonNegativeInteger(record.insertionIndex, 'insertionIndex'),
      ...(beforeStepRef ? { beforeStepRef } : {}),
      ...(afterStepRef ? { afterStepRef } : {}),
    };
  }
  if (record.kind === 'grantKnowledge') {
    assertOnlyKnownFields(record, [
      ...baseFields,
      'participantRef',
      'effectiveFromStepRef',
      'effectiveFromQueueIndex',
      'selectedPrefixRefs',
      'grant',
    ], 'Play grantKnowledge intervention');
    return {
      ...base,
      kind: 'grantKnowledge',
      participantRef: assertSafePlayRehearsalId(
        record.participantRef,
        'grant participantRef',
      ),
      effectiveFromStepRef: assertSafePlayRehearsalId(
        record.effectiveFromStepRef,
        'grant effectiveFromStepRef',
      ),
      effectiveFromQueueIndex: normalizeNonNegativeInteger(
        record.effectiveFromQueueIndex,
        'grant effectiveFromQueueIndex',
      ),
      selectedPrefixRefs: normalizeSafeIdList(
        record.selectedPrefixRefs,
        'grant selectedPrefixRefs',
        MAX_ATTEMPT_STEPS,
      ),
      grant: normalizePlayDirectorKnowledgeGrant(record.grant),
    };
  }
  throw new PlayTurnAttemptError(
    'invalidAttempt',
    `Unsupported Play Director intervention kind: ${String(record.kind)}.`,
  );
}

function normalizePlayDirectorKnowledgeGrant(value: unknown): PlayDirectorKnowledgeGrant {
  const record = requireRecord(value, 'Play Director knowledge grant');
  if (record.kind === 'existingFact') {
    assertOnlyKnownFields(record, ['kind', 'factRefs'], 'Play existing-fact grant');
    const factRefs = normalizeSafeIdList(record.factRefs, 'grant factRefs', 64);
    if (!factRefs.length) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        'Play existing-fact grant requires at least one stable fact ref.',
      );
    }
    return { kind: 'existingFact', factRefs };
  }
  if (record.kind === 'authorProvidedPlayFact') {
    assertOnlyKnownFields(
      record,
      ['kind', 'summary', 'visibility', 'providedAt'],
      'Play author-provided knowledge grant',
    );
    if (
      record.visibility !== 'playerVisible' &&
      record.visibility !== 'rumor' &&
      record.visibility !== 'playerUnknown'
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        'Play author-provided knowledge grant has invalid visibility.',
      );
    }
    return {
      kind: 'authorProvidedPlayFact',
      summary: normalizeText(record.summary, 'grant summary', MAX_ATTEMPT_TEXT),
      visibility: record.visibility,
      providedAt: normalizeText(record.providedAt, 'grant providedAt', 128),
    };
  }
  throw new PlayTurnAttemptError(
    'invalidAttempt',
    `Unsupported Play knowledge grant kind: ${String(record.kind)}.`,
  );
}

function createPlayAttemptStagnation(threshold = 3): PlayAttemptStagnation {
  return {
    consecutiveNoMaterialSteps: 0,
    threshold,
    warning: false,
  };
}

function derivePlayAttemptStagnation(
  selectedStepRefs: readonly string[],
  stepsById: Map<string, CharacterStepDraft>,
  threshold = 3,
): PlayAttemptStagnation {
  const safeThreshold = normalizePositiveInteger(threshold, 'stagnation threshold');
  let consecutiveNoMaterialSteps = 0;
  for (const stepRef of [...selectedStepRefs].reverse()) {
    const step = stepsById.get(stepRef);
    if (!step || step.materialEffect?.kind !== 'noMaterialEffect') break;
    consecutiveNoMaterialSteps += 1;
  }
  return {
    consecutiveNoMaterialSteps,
    threshold: safeThreshold,
    warning: consecutiveNoMaterialSteps >= safeThreshold,
  };
}

function normalizePlayAttemptStagnation(value: unknown): PlayAttemptStagnation {
  const record = requireRecord(value, 'Play attempt stagnation');
  assertOnlyKnownFields(
    record,
    ['consecutiveNoMaterialSteps', 'threshold', 'warning'],
    'Play attempt stagnation',
  );
  const consecutiveNoMaterialSteps = normalizeNonNegativeInteger(
    record.consecutiveNoMaterialSteps,
    'stagnation consecutiveNoMaterialSteps',
  );
  const threshold = normalizePositiveInteger(record.threshold, 'stagnation threshold');
  if (record.warning !== (consecutiveNoMaterialSteps >= threshold)) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play attempt stagnation warning does not match its threshold.',
    );
  }
  return {
    consecutiveNoMaterialSteps,
    threshold,
    warning: record.warning,
  };
}

function normalizePlayStepMaterialEffect(value: unknown): PlayStepMaterialEffect {
  const record = requireRecord(value, 'Play step material effect');
  if (record.kind === 'materialEffect') {
    assertOnlyKnownFields(record, ['kind'], 'Play material effect');
    return { kind: 'materialEffect' };
  }
  if (record.kind === 'noMaterialEffect') {
    assertOnlyKnownFields(record, ['kind', 'reason'], 'Play noMaterialEffect');
    return {
      kind: 'noMaterialEffect',
      reason: normalizeText(record.reason, 'noMaterialEffect reason', 800),
    };
  }
  throw new PlayTurnAttemptError(
    'invalidAttempt',
    `Unsupported Play step material effect: ${String(record.kind)}.`,
  );
}

function assertAttemptActive(attempt: PlayTurnAttempt): void {
  if (attempt.status !== 'running' && attempt.status !== 'prepared') {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      `Play attempt is terminal: ${attempt.status}.`,
    );
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeSafeIdList(value: unknown, label: string, maximum: number): string[] {
  const values = normalizeBoundedArray(value, maximum, label).map((item) =>
    assertSafePlayRehearsalId(item, label));
  assertUnique(values, label);
  return values;
}

function normalizeBoundedArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `${label} must be an array of at most ${maximum} items.`,
    );
  }
  return value;
}

function normalizeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new PlayTurnAttemptError('invalidAttempt', `Play attempt ${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > Math.min(maximum, MAX_ATTEMPT_TEXT)) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Play attempt ${label} has an invalid length.`,
    );
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Play attempt ${label} must be a non-negative safe integer.`,
    );
  }
  return value as number;
}

function normalizePositiveInteger(value: unknown, label: string): number {
  const normalized = normalizeNonNegativeInteger(value, label);
  if (normalized < 1) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Play attempt ${label} must be a positive safe integer.`,
    );
  }
  return normalized;
}

function normalizeOrderStrategy(value: unknown): PlayRehearsalOrderStrategy {
  if (
    value !== 'directorFixed' &&
    value !== 'refereeDynamic' &&
    value !== 'hybrid'
  ) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Unsupported Play rehearsal order strategy: ${String(value)}.`,
    );
  }
  return value;
}

function normalizeSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Play attempt ${label} must be a SHA-256 hex digest.`,
    );
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new PlayTurnAttemptError('invalidAttempt', `Play attempt contains duplicate ${label}.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlayTurnAttemptError('invalidAttempt', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const known = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !known.has(field));
  if (unknown.length) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `${label} contains unknown fields: ${unknown.join(', ')}.`,
    );
  }
}
