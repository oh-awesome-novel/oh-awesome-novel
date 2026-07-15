import { createHash } from 'node:crypto';

import {
  normalizePlayWorldRefereeSettlement,
} from './play-session.js';
import type { PlayWorldRefereeSettlement } from './play-session.js';
import {
  assertSafePlayRehearsalId,
  assertNarrativeBlocksWithinPerception,
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
  decisionBasisRefs: string[];
  variantOf?: string;
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
  selectedStepRefs: string[];
  selectedHeadRef?: string;
  currentStepRef?: string;
  dueScheduledEventIds: string[];
  steps: CharacterStepDraft[];
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
    selectedStepRefs: [],
    dueScheduledEventIds: normalizeSafeIdList(
      input.dueScheduledEventIds ?? [],
      'dueScheduledEventIds',
      128,
    ),
    steps: [],
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
    'selectedStepRefs',
    'selectedHeadRef',
    'currentStepRef',
    'dueScheduledEventIds',
    'steps',
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
      step.queueIndex >= actorOrder.length ||
      step.queueIndex > selectedStepRefs.length ||
      step.participantRef !== actorOrder[step.queueIndex]
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play step ${step.id} is outside the fixed actor queue.`,
      );
    }
    const expectedBeforeRef = step.queueIndex === 0
      ? undefined
      : selectedStepRefs[step.queueIndex - 1];
    if (step.beforeStepRef !== expectedBeforeRef) {
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
    selectedStepRefs,
    ...(selectedHeadRef ? { selectedHeadRef } : {}),
    ...(currentStepRef ? { currentStepRef } : {}),
    dueScheduledEventIds: normalizeSafeIdList(
      record.dueScheduledEventIds,
      'dueScheduledEventIds',
      128,
    ),
    steps,
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
    perception.initialKnowledgeEvidence.map((evidence) => evidence.id),
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
    'decisionBasisRefs',
    'variantOf',
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
    decisionBasisRefs: normalizeSafeIdList(
      record.decisionBasisRefs,
      'step decisionBasisRefs',
      128,
    ),
    ...(variantOf ? { variantOf } : {}),
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
      source.participantRef !== step.participantRef ||
      source.beforeStepRef !== step.beforeStepRef
    ) {
      throw new PlayTurnAttemptError(
        'invalidAttempt',
        `Stored Play step ${step.id} references an incompatible variant source.`,
      );
    }
    current = source;
  }
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
