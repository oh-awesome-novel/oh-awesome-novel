import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
} from 'vue';
import type { Ref } from 'vue';

import {
  assertPlayRehearsalAttemptSnapshot,
  clonePlayRehearsalAttemptSnapshot,
  usePlayActorStepStream,
} from './usePlayActorStepStream';
import type {
  PlayActorStepOutcome,
  PlayActorStepRecord,
  PlayActorStepStreamClient,
  PlayRehearsalAttemptRecord,
  PlayRehearsalAttemptMutationReceipt,
  PlayRehearsalAttemptSnapshot,
} from './usePlayActorStepStream';

export interface PlayRehearsalAttemptMutationResult {
  attempt: PlayRehearsalAttemptRecord;
  receipt: PlayRehearsalAttemptMutationReceipt;
  replayed: boolean;
}

export interface PlayRehearsalFinishResult<
  TSession,
  TArtifact = unknown,
  TEvidence = unknown,
> {
  session: TSession;
  attempt?: PlayRehearsalAttemptRecord;
  artifact: TArtifact;
  evidence: TEvidence;
  receipt: {
    idempotencyKey: string;
    attemptRevision: number;
  };
  replayed: boolean;
}

export interface PlayRehearsalAttemptClient<
  TSession,
  TArtifact = unknown,
  TEvidence = unknown,
>
  extends PlayActorStepStreamClient {
  getActivePlayRehearsalAttempt(
    sessionId: string,
  ): Promise<{ attempt: PlayRehearsalAttemptRecord | null }>;
  createPlayRehearsalAttempt(
    sessionId: string,
    input: { baseRevision: number },
  ): Promise<PlayRehearsalAttemptSnapshot>;
  acceptPlayRehearsalStep(
    sessionId: string,
    attemptId: string,
    input: {
      expectedAttemptRevision: number;
      idempotencyKey: string;
      kind: 'accept';
      stepRef: string;
    },
  ): Promise<PlayRehearsalAttemptMutationResult>;
  finishPlayRehearsalAttempt(
    sessionId: string,
    attemptId: string,
    input: {
      baseRevision: number;
      expectedAttemptRevision: number;
      idempotencyKey: string;
      selectedHeadRef: string;
    },
  ): Promise<PlayRehearsalFinishResult<TSession, TArtifact, TEvidence>>;
  cancelPlayRehearsalAttempt(
    sessionId: string,
    attemptId: string,
    input: {
      expectedAttemptRevision: number;
      idempotencyKey: string;
    },
  ): Promise<PlayRehearsalAttemptMutationResult>;
}

export interface UsePlayRehearsalAttemptOptions<
  TSession,
  TArtifact = unknown,
  TEvidence = unknown,
> {
  client: PlayRehearsalAttemptClient<TSession, TArtifact, TEvidence>;
  sessionId: Readonly<Ref<string | undefined>>;
  baseRevision: Readonly<Ref<number | undefined>>;
  createIdempotencyKey?(fingerprint: string): string;
  onFinished?(result: PlayRehearsalFinishResult<TSession, TArtifact, TEvidence>): void;
}

export type PlayRehearsalMutationOutcome = 'applied' | 'failed' | 'ignored';

interface PendingMutationRecovery {
  failureAnnouncement: string;
  recover(): Promise<void>;
  abandon(): void;
}

interface SnapshotMutationRecoverySpec {
  expectedAttemptRevision: number;
  expectedResultRef: string;
  validate(attempt: PlayRehearsalAttemptRecord): boolean;
}

export function usePlayRehearsalAttempt<
  TSession,
  TArtifact = unknown,
  TEvidence = unknown,
>(
  options: UsePlayRehearsalAttemptOptions<TSession, TArtifact, TEvidence>,
) {
  const attempt = shallowRef<PlayRehearsalAttemptRecord>();
  const steps = shallowRef<PlayActorStepRecord[]>([]);
  const loading = shallowRef(false);
  const mutating = shallowRef(false);
  const activeLookupIndeterminate = shallowRef(false);
  const pendingMutationRecovery = shallowRef<PendingMutationRecovery>();
  const localAnnouncement = shallowRef('');
  const localError = shallowRef('');
  const committedResult = shallowRef<
    PlayRehearsalFinishResult<TSession, TArtifact, TEvidence>
  >();
  const pendingIdempotencyKeys = new Map<string, string>();
  let loadGeneration = 0;
  let disposed = false;

  const actorStep = usePlayActorStepStream({
    client: options.client,
    onSnapshot(snapshot) {
      applySnapshot(snapshot, snapshot.attempt.sessionId, snapshot.attempt.id);
    },
  });

  const snapshot = computed<PlayRehearsalAttemptSnapshot | undefined>(() => {
    if (!attempt.value) return undefined;
    return clonePlayRehearsalAttemptSnapshot({
      attempt: {
        ...attempt.value,
        steps: steps.value,
      },
    });
  });
  const currentStep = computed(() => {
    const stepRef = attempt.value?.currentStepRef;
    return stepRef
      ? steps.value.find((step) => step.id === stepRef)
      : undefined;
  });
  const selectedSteps = computed(() => {
    const selected = new Set(attempt.value?.selectedStepRefs ?? []);
    return steps.value.filter((step) => selected.has(step.id));
  });
  const busy = computed(() => loading.value || mutating.value || actorStep.busy.value);
  const announcement = computed(() =>
    localAnnouncement.value || (
      actorStep.run.value ? actorStep.announcement.value : ''
    ));
  const error = computed(() =>
    localError.value || actorStep.run.value?.error || '');
  const mutationIndeterminate = computed(() =>
    Boolean(pendingMutationRecovery.value));
  const canStartAttempt = computed(() =>
    Boolean(
      validSessionContext() &&
      !activeLookupIndeterminate.value &&
      !mutationIndeterminate.value &&
      !isActiveAttempt(attempt.value) &&
      !busy.value,
    ));
  const canGenerateStep = computed(() =>
    !mutationIndeterminate.value &&
    attempt.value?.status === 'running' && !currentStep.value && !busy.value);
  const canAcceptStep = computed(() =>
    !mutationIndeterminate.value &&
    attempt.value?.status === 'running' &&
    currentStep.value?.status === 'draft' &&
    !busy.value);
  const canRetryStep = computed(() => canAcceptStep.value);
  const canFinishAttempt = computed(() =>
    !mutationIndeterminate.value &&
    attempt.value?.status === 'prepared' &&
    Boolean(attempt.value.selectedHeadRef) &&
    !busy.value);
  const canCancelAttempt = computed(() =>
    !mutationIndeterminate.value &&
    (attempt.value?.status === 'running' || attempt.value?.status === 'prepared') &&
    !busy.value);

  async function loadActive(): Promise<PlayRehearsalMutationOutcome> {
    const sessionId = options.sessionId.value;
    if (!isNonEmptyString(sessionId) || busy.value || disposed) {
      return 'ignored';
    }

    const generation = ++loadGeneration;
    loading.value = true;
    activeLookupIndeterminate.value = false;
    clearLocalFeedback();
    try {
      const loaded = await options.client.getActivePlayRehearsalAttempt(sessionId);
      if (generation !== loadGeneration || options.sessionId.value !== sessionId || disposed) {
        return 'ignored';
      }
      if (loaded.attempt) {
        if (!isActiveAttempt(loaded.attempt)) {
          throw new Error('Active-attempt lookup returned a terminal attempt.');
        }
        applySnapshot({ attempt: loaded.attempt }, sessionId, loaded.attempt.id, true);
        localAnnouncement.value = 'Active rehearsal attempt restored · not committed';
      } else {
        clearAttemptState();
        localAnnouncement.value = 'No active rehearsal attempt.';
      }
      activeLookupIndeterminate.value = false;
      return 'applied';
    } catch (caught) {
      if (generation === loadGeneration && !disposed) {
        activeLookupIndeterminate.value = true;
        setFailure(caught, 'Could not load the active rehearsal attempt.');
      }
      return 'failed';
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  async function loadAttempt(
    attemptId: string,
  ): Promise<PlayRehearsalMutationOutcome> {
    const sessionId = options.sessionId.value;
    if (
      !isNonEmptyString(sessionId) ||
      !isNonEmptyString(attemptId) ||
      busy.value ||
      disposed
    ) {
      return 'ignored';
    }

    const generation = ++loadGeneration;
    loading.value = true;
    clearLocalFeedback();
    try {
      const loaded = await options.client.getPlayRehearsalAttempt(sessionId, attemptId);
      if (generation !== loadGeneration || options.sessionId.value !== sessionId || disposed) {
        return 'ignored';
      }
      applySnapshot(loaded, sessionId, attemptId, true);
      localAnnouncement.value = 'Rehearsal attempt refreshed from attempt truth.';
      return 'applied';
    } catch (caught) {
      if (generation === loadGeneration && !disposed) {
        setFailure(caught, 'Could not refresh the rehearsal attempt.');
      }
      return 'failed';
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  async function startAttempt(): Promise<PlayRehearsalMutationOutcome> {
    const context = validSessionContext();
    if (
      !context ||
      activeLookupIndeterminate.value ||
      mutationIndeterminate.value ||
      isActiveAttempt(attempt.value) ||
      busy.value ||
      disposed
    ) {
      return 'ignored';
    }
    mutating.value = true;
    clearLocalFeedback();
    try {
      const created = await options.client.createPlayRehearsalAttempt(
        context.sessionId,
        { baseRevision: context.baseRevision },
      );
      if (options.sessionId.value !== context.sessionId || disposed) return 'ignored';
      if (!isActiveAttempt(created.attempt)) {
        throw new Error('Start response did not contain an active rehearsal attempt.');
      }
      applySnapshot(created, context.sessionId, created.attempt.id, true);
      activeLookupIndeterminate.value = false;
      localAnnouncement.value = 'Rehearsal attempt started · no committed turn yet';
      return 'applied';
    } catch (caught) {
      if (options.sessionId.value !== context.sessionId || disposed) return 'ignored';
      try {
        const recovered = await options.client.getActivePlayRehearsalAttempt(
          context.sessionId,
        );
        if (
          recovered.attempt &&
          recovered.attempt.baseRevision === context.baseRevision &&
          isActiveAttempt(recovered.attempt)
        ) {
          applySnapshot(
            { attempt: recovered.attempt },
            context.sessionId,
            recovered.attempt.id,
            true,
          );
          activeLookupIndeterminate.value = false;
          localAnnouncement.value = 'Rehearsal attempt recovered after Start lost its response.';
          return 'applied';
        }
      } catch (reconcileError) {
        activeLookupIndeterminate.value = true;
        setFailure(
          new Error(`${toErrorMessage(caught)}; reconciliation failed: ${toErrorMessage(reconcileError)}`),
          'Rehearsal attempt Start could not be confirmed.',
        );
        return 'failed';
      }
      activeLookupIndeterminate.value = false;
      setFailure(caught, 'Rehearsal attempt was not started.');
      return 'failed';
    } finally {
      mutating.value = false;
    }
  }

  async function generateNextStep(): Promise<PlayActorStepOutcome> {
    const current = activeAttemptForStep();
    if (!current || currentStep.value) return 'ignored';
    return startActorStep(current);
  }

  async function retryStep(stepRef: string): Promise<PlayActorStepOutcome> {
    const current = activeAttemptForStep();
    const draft = currentStep.value;
    if (
      !current ||
      !isNonEmptyString(stepRef) ||
      draft?.id !== stepRef ||
      draft.status !== 'draft'
    ) {
      return 'ignored';
    }
    return startActorStep(current, stepRef);
  }

  async function acceptStep(
    stepRef: string,
  ): Promise<PlayRehearsalMutationOutcome> {
    const current = activeAttemptForMutation('running');
    const draft = currentStep.value;
    if (
      !current ||
      !isNonEmptyString(stepRef) ||
      draft?.id !== stepRef ||
      draft.status !== 'draft'
    ) {
      return 'ignored';
    }
    const fingerprint = `accept:${current.attempt.id}:${current.attempt.attemptRevision}:${stepRef}`;
    const mutationKey = idempotencyKey(fingerprint);
    return runSnapshotMutation(
      fingerprint,
      mutationKey,
      () => options.client.acceptPlayRehearsalStep(
        current.attempt.sessionId,
        current.attempt.id,
        {
          expectedAttemptRevision: current.attempt.attemptRevision,
          idempotencyKey: mutationKey,
          kind: 'accept',
          stepRef,
        },
      ).then((result) => snapshotFromMutation(result, mutationKey)),
      current.attempt.sessionId,
      current.attempt.id,
      'Actor step selected · attempt-local, still not committed',
      {
        expectedAttemptRevision: current.attempt.attemptRevision,
        expectedResultRef: stepRef,
        validate(candidate) {
          return candidate.selectedStepRefs.includes(stepRef);
        },
      },
    );
  }

  async function finishAttempt(): Promise<PlayRehearsalMutationOutcome> {
    const current = activeAttemptForMutation('prepared');
    const sessionRevision = options.baseRevision.value;
    const selectedHeadRef = current?.attempt.selectedHeadRef;
    if (
      !current ||
      typeof sessionRevision !== 'number' ||
      !Number.isSafeInteger(sessionRevision) ||
      sessionRevision !== current.attempt.baseRevision ||
      !isNonEmptyString(selectedHeadRef)
    ) {
      if (current && sessionRevision !== current.attempt.baseRevision) {
        setFailure(
          new Error('Session revision changed while the rehearsal attempt was active.'),
          'Finish requires reconciliation with the current session revision.',
        );
      }
      return 'ignored';
    }

    const fingerprint = [
      'finish',
      current.attempt.id,
      current.attempt.attemptRevision,
      sessionRevision,
      selectedHeadRef,
    ].join(':');
    if (mutating.value || actorStep.busy.value || disposed) return 'ignored';
    const mutationKey = idempotencyKey(fingerprint);
    const requestFinish = () => options.client.finishPlayRehearsalAttempt(
      current.attempt.sessionId,
      current.attempt.id,
      {
        baseRevision: sessionRevision,
        expectedAttemptRevision: current.attempt.attemptRevision,
        idempotencyKey: mutationKey,
        selectedHeadRef,
      },
    );
    const applyFinish = (
      result: PlayRehearsalFinishResult<TSession, TArtifact, TEvidence>,
      recovered: boolean,
    ) => {
      assertFinalizeResult(result, mutationKey);
      if (result.attempt) {
        applySnapshot(
          { attempt: result.attempt },
          current.attempt.sessionId,
          current.attempt.id,
        );
      } else {
        // A replay may outlive recovery. The committed artifact/evidence are truth;
        // the old prepared attempt must not remain visible as an active attempt.
        attempt.value = undefined;
        steps.value = [];
      }
      const committed = cloneFinishResult(result);
      committedResult.value = committed;
      actorStep.clearTerminalRun();
      releaseIdempotencyKey(fingerprint);
      pendingMutationRecovery.value = undefined;
      clearLocalFeedback();
      localAnnouncement.value = recovered
        ? 'Rehearsal committed as one Play turn · recovered by idempotent Finish replay'
        : 'Rehearsal committed as one Play turn.';
      options.onFinished?.(cloneFinishResult(committed));
    };
    mutating.value = true;
    clearLocalFeedback();
    try {
      applyFinish(await requestFinish(), false);
      return 'applied';
    } catch (caught) {
      if (isDefinitiveMutationRejection(caught)) {
        releaseIdempotencyKey(fingerprint);
        pendingMutationRecovery.value = undefined;
        setFailure(caught, 'Finish was rejected; no rehearsal turn was committed.');
        return 'failed';
      }
      const recover = async () => {
        applyFinish(await requestFinish(), true);
      };
      try {
        await recover();
        return 'applied';
      } catch (reconcileError) {
        if (isDefinitiveMutationRejection(reconcileError)) {
          releaseIdempotencyKey(fingerprint);
          pendingMutationRecovery.value = undefined;
          setFailure(reconcileError, 'Finish was rejected; no rehearsal turn was committed.');
          return 'failed';
        }
        const failureAnnouncement =
          'Finish truth could not be confirmed. Recover committed truth before continuing.';
        pendingMutationRecovery.value = {
          failureAnnouncement,
          recover,
          abandon() {
            releaseIdempotencyKey(fingerprint);
            pendingMutationRecovery.value = undefined;
          },
        };
        setFailure(
          new Error(
            `${toErrorMessage(caught)}; idempotent Finish replay failed: ${toErrorMessage(reconcileError)}`,
          ),
          failureAnnouncement,
        );
        return 'failed';
      }
    } finally {
      mutating.value = false;
    }
  }

  async function cancelAttempt(): Promise<PlayRehearsalMutationOutcome> {
    const current = activeAttemptForMutation();
    if (!current) return 'ignored';
    const fingerprint = `cancel:${current.attempt.id}:${current.attempt.attemptRevision}`;
    const mutationKey = idempotencyKey(fingerprint);
    const outcome = await runSnapshotMutation(
      fingerprint,
      mutationKey,
      () => options.client.cancelPlayRehearsalAttempt(
        current.attempt.sessionId,
        current.attempt.id,
        {
          expectedAttemptRevision: current.attempt.attemptRevision,
          idempotencyKey: mutationKey,
        },
      ).then((result) => {
        const next = snapshotFromMutation(result, mutationKey);
        if (next.attempt.status !== 'cancelled') {
          throw new Error('Cancel response did not contain cancelled attempt truth.');
        }
        return next;
      }),
      current.attempt.sessionId,
      current.attempt.id,
      'Rehearsal attempt cancelled · no committed turn was created',
      {
        expectedAttemptRevision: current.attempt.attemptRevision,
        expectedResultRef: current.attempt.id,
        validate(candidate) {
          return candidate.status === 'cancelled';
        },
      },
    );
    return outcome;
  }

  async function stopStep(): Promise<void> {
    await actorStep.stop();
  }

  async function reconcileStep(): Promise<PlayActorStepOutcome> {
    const run = actorStep.run.value;
    const fingerprint = run
      ? actorStepFingerprint(
          run.attemptId,
          run.expectedAttemptRevision,
          run.sourceStepRef,
        )
      : undefined;
    const outcome = await actorStep.reconcile();
    if (
      fingerprint &&
      (outcome === 'prepared' || outcome === 'aborted' || outcome === 'failed')
    ) {
      releaseIdempotencyKey(fingerprint);
    }
    return outcome;
  }

  async function recoverMutation(): Promise<PlayRehearsalMutationOutcome> {
    const pending = pendingMutationRecovery.value;
    if (!pending || busy.value || disposed) return 'ignored';
    mutating.value = true;
    clearLocalFeedback();
    try {
      await pending.recover();
      return 'applied';
    } catch (caught) {
      if (isDefinitiveMutationRejection(caught)) {
        pending.abandon();
        setFailure(caught, 'Recovery replay was rejected; the requested mutation was not applied.');
        return 'failed';
      }
      setFailure(caught, pending.failureAnnouncement);
      return 'failed';
    } finally {
      mutating.value = false;
    }
  }

  function clearTerminalStep(): void {
    actorStep.clearTerminalRun();
  }

  function clear(): void {
    if (busy.value) return;
    loadGeneration += 1;
    activeLookupIndeterminate.value = false;
    pendingMutationRecovery.value = undefined;
    clearAttemptState();
    clearLocalFeedback();
    pendingIdempotencyKeys.clear();
    actorStep.clearTerminalRun();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    loadGeneration += 1;
    pendingIdempotencyKeys.clear();
    pendingMutationRecovery.value = undefined;
    actorStep.dispose();
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    attempt: readonly(attempt),
    steps: readonly(steps),
    snapshot,
    currentStep,
    selectedSteps,
    stepRun: actorStep.run,
    committedResult: readonly(committedResult),
    loading: readonly(loading),
    mutating: readonly(mutating),
    activeLookupIndeterminate: readonly(activeLookupIndeterminate),
    mutationIndeterminate,
    busy,
    announcement,
    error,
    canStartAttempt,
    canGenerateStep,
    canStopStep: actorStep.canStop,
    canAcceptStep,
    canRetryStep,
    canFinishAttempt,
    canCancelAttempt,
    loadActive,
    loadAttempt,
    startAttempt,
    generateNextStep,
    stopStep,
    acceptStep,
    retryStep,
    reconcileStep,
    recoverMutation,
    finishAttempt,
    cancelAttempt,
    clearTerminalStep,
    clear,
    dispose,
  };

  async function startActorStep(
    current: PlayRehearsalAttemptSnapshot,
    retryStepRef?: string,
  ): Promise<PlayActorStepOutcome> {
    clearLocalFeedback();
    const fingerprint = actorStepFingerprint(
      current.attempt.id,
      current.attempt.attemptRevision,
      retryStepRef,
    );
    let outcome: PlayActorStepOutcome;
    try {
      outcome = await actorStep.start({
        sessionId: current.attempt.sessionId,
        attemptId: current.attempt.id,
        expectedAttemptRevision: current.attempt.attemptRevision,
        idempotencyKey: idempotencyKey(fingerprint),
        mode: retryStepRef ? 'retry' : 'next',
        ...(retryStepRef ? { sourceStepRef: retryStepRef } : {}),
      });
    } catch (caught) {
      setFailure(caught, 'Actor step was not started.');
      return 'failed';
    }
    if (outcome === 'prepared' || outcome === 'aborted' || outcome === 'failed') {
      releaseIdempotencyKey(fingerprint);
    }
    return outcome;
  }

  async function runSnapshotMutation(
    fingerprint: string,
    mutationKey: string,
    mutate: () => Promise<PlayRehearsalAttemptSnapshot>,
    sessionId: string,
    attemptId: string,
    successMessage: string,
    recovery: SnapshotMutationRecoverySpec,
    replace = false,
  ): Promise<PlayRehearsalMutationOutcome> {
    if (mutating.value || actorStep.busy.value || disposed) return 'ignored';
    mutating.value = true;
    clearLocalFeedback();
    try {
      const next = await mutate();
      applySnapshot(next, sessionId, attemptId, replace);
      actorStep.clearTerminalRun();
      releaseIdempotencyKey(fingerprint);
      pendingMutationRecovery.value = undefined;
      localAnnouncement.value = successMessage;
      return 'applied';
    } catch (caught) {
      if (isDefinitiveMutationRejection(caught)) {
        releaseIdempotencyKey(fingerprint);
        pendingMutationRecovery.value = undefined;
        setFailure(caught, 'Rehearsal mutation was rejected; attempt truth was not changed.');
        return 'failed';
      }
      const recover = async () => {
        let next: PlayRehearsalAttemptSnapshot;
        try {
          next = await options.client.getPlayRehearsalAttempt(
            sessionId,
            attemptId,
          );
          assertRecoveredSnapshotMutation(
            next,
            sessionId,
            attemptId,
            mutationKey,
            recovery,
          );
        } catch {
          // GET without this receipt is not proof that the request never reached
          // the server. Replay the exact same logical mutation key.
          next = await mutate();
        }
        applySnapshot(next, sessionId, attemptId, replace);
        actorStep.clearTerminalRun();
        releaseIdempotencyKey(fingerprint);
        pendingMutationRecovery.value = undefined;
        clearLocalFeedback();
        localAnnouncement.value = `${successMessage} · recovered from attempt truth`;
      };
      try {
        await recover();
        return 'applied';
      } catch (reconcileError) {
        if (isDefinitiveMutationRejection(reconcileError)) {
          releaseIdempotencyKey(fingerprint);
          pendingMutationRecovery.value = undefined;
          setFailure(
            reconcileError,
            'Rehearsal mutation was rejected; attempt truth was not changed.',
          );
          return 'failed';
        }
        const failureAnnouncement =
          'Rehearsal mutation truth could not be confirmed. Recover attempt truth before continuing.';
        pendingMutationRecovery.value = {
          failureAnnouncement,
          recover,
          abandon() {
            releaseIdempotencyKey(fingerprint);
            pendingMutationRecovery.value = undefined;
          },
        };
        setFailure(
          new Error(
            `${toErrorMessage(caught)}; reconciliation failed: ${toErrorMessage(reconcileError)}`,
          ),
          failureAnnouncement,
        );
        return 'failed';
      }
    } finally {
      mutating.value = false;
    }
  }

  function activeAttemptForStep(): PlayRehearsalAttemptSnapshot | undefined {
    if (
      busy.value ||
      mutationIndeterminate.value ||
      disposed ||
      attempt.value?.status !== 'running'
    ) return undefined;
    return snapshot.value;
  }

  function activeAttemptForMutation(
    requiredStatus?: 'running' | 'prepared',
  ): PlayRehearsalAttemptSnapshot | undefined {
    const current = snapshot.value;
    if (
      !current ||
      busy.value ||
      mutationIndeterminate.value ||
      disposed ||
      !['running', 'prepared'].includes(current.attempt.status) ||
      (requiredStatus && current.attempt.status !== requiredStatus)
    ) {
      return undefined;
    }
    return current;
  }

  function applySnapshot(
    value: PlayRehearsalAttemptSnapshot,
    sessionId: string,
    attemptId: string,
    replace = false,
  ): void {
    assertPlayRehearsalAttemptSnapshot(value, sessionId, attemptId);
    const previous = attempt.value;
    if (
      !replace &&
      previous &&
      (previous.id !== attemptId || previous.sessionId !== sessionId)
    ) {
      throw new Error('Rehearsal mutation changed attempt identity.');
    }
    if (
      !replace &&
      previous?.id === attemptId &&
      value.attempt.attemptRevision < previous.attemptRevision
    ) {
      throw new Error('Rehearsal mutation returned a stale attempt revision.');
    }
    const cloned = clonePlayRehearsalAttemptSnapshot(value);
    if (replace) committedResult.value = undefined;
    attempt.value = cloned.attempt;
    steps.value = cloned.attempt.steps;
  }

  function validSessionContext(): {
    sessionId: string;
    baseRevision: number;
  } | undefined {
    const sessionId = options.sessionId.value;
    const baseRevision = options.baseRevision.value;
    return isNonEmptyString(sessionId) &&
      Number.isSafeInteger(baseRevision) &&
      (baseRevision as number) >= 0
      ? { sessionId, baseRevision: baseRevision as number }
      : undefined;
  }

  function idempotencyKey(fingerprint: string): string {
    const existing = pendingIdempotencyKeys.get(fingerprint);
    if (existing) return existing;
    const generated = options.createIdempotencyKey?.(fingerprint) ?? createMutationId();
    if (!isNonEmptyString(generated)) {
      throw new Error('Rehearsal idempotency key generator returned an invalid key.');
    }
    pendingIdempotencyKeys.set(fingerprint, generated);
    return generated;
  }

  function releaseIdempotencyKey(fingerprint: string): void {
    pendingIdempotencyKeys.delete(fingerprint);
  }

  function actorStepFingerprint(
    attemptId: string,
    attemptRevision: number,
    sourceStepRef?: string,
  ): string {
    return [
      'step',
      sourceStepRef ? 'retry' : 'next',
      attemptId,
      attemptRevision,
      sourceStepRef ?? '',
    ].join(':');
  }

  function clearAttemptState(): void {
    attempt.value = undefined;
    steps.value = [];
    committedResult.value = undefined;
  }

  function clearLocalFeedback(): void {
    localAnnouncement.value = '';
    localError.value = '';
  }

  function setFailure(caught: unknown, announcement: string): void {
    localError.value = toErrorMessage(caught);
    localAnnouncement.value = announcement;
  }
}

function assertRecoveredSnapshotMutation(
  snapshot: PlayRehearsalAttemptSnapshot,
  sessionId: string,
  attemptId: string,
  idempotencyKey: string,
  recovery: SnapshotMutationRecoverySpec,
): void {
  assertPlayRehearsalAttemptSnapshot(snapshot, sessionId, attemptId);
  const receipt = snapshot.attempt.mutationReceipts?.find((candidate) =>
    candidate.idempotencyKey === idempotencyKey);
  if (
    !receipt ||
    receipt.resultingAttemptRevision !== recovery.expectedAttemptRevision + 1 ||
    snapshot.attempt.attemptRevision < receipt.resultingAttemptRevision ||
    receipt.resultRef !== recovery.expectedResultRef ||
    !recovery.validate(snapshot.attempt)
  ) {
    throw new Error('Attempt truth does not contain the expected mutation receipt.');
  }
}

function snapshotFromMutation(
  result: PlayRehearsalAttemptMutationResult,
  idempotencyKey: string,
): PlayRehearsalAttemptSnapshot {
  assertMutationResult(result, idempotencyKey);
  return clonePlayRehearsalAttemptSnapshot({ attempt: result.attempt });
}

function assertMutationResult(
  result: PlayRehearsalAttemptMutationResult,
  idempotencyKey: string,
): void {
  const receipt = result.receipt;
  const freshRevisionMatches = !result.replayed &&
    receipt.resultingAttemptRevision === result.attempt.attemptRevision;
  const replayRevisionIsCovered = result.replayed &&
    receipt.resultingAttemptRevision <= result.attempt.attemptRevision;
  const storedReceipt = result.attempt.mutationReceipts?.find((candidate) =>
    candidate.idempotencyKey === idempotencyKey);
  const storedReplayMatches = !result.replayed ||
    result.attempt.mutationReceipts === undefined ||
    Boolean(storedReceipt && sameMutationReceipt(storedReceipt, receipt));
  if (
    receipt.idempotencyKey !== idempotencyKey ||
    !Number.isSafeInteger(receipt.resultingAttemptRevision) ||
    receipt.resultingAttemptRevision < 1 ||
    typeof result.replayed !== 'boolean' ||
    (!freshRevisionMatches && !replayRevisionIsCovered) ||
    !storedReplayMatches
  ) {
    throw new Error('Rehearsal mutation receipt conflicts with attempt truth.');
  }
}

function sameMutationReceipt(
  left: PlayRehearsalAttemptMutationReceipt,
  right: PlayRehearsalAttemptMutationReceipt,
): boolean {
  return left.idempotencyKey === right.idempotencyKey &&
    left.resultingAttemptRevision === right.resultingAttemptRevision &&
    left.resultRef === right.resultRef &&
    left.requestFingerprint === right.requestFingerprint &&
    left.responseDigest === right.responseDigest;
}

function assertFinalizeResult<TSession, TArtifact, TEvidence>(
  result: PlayRehearsalFinishResult<TSession, TArtifact, TEvidence>,
  idempotencyKey: string,
): void {
  if (
    result.receipt.idempotencyKey !== idempotencyKey ||
    !Number.isSafeInteger(result.receipt.attemptRevision) ||
    result.receipt.attemptRevision < 0 ||
    typeof result.replayed !== 'boolean' ||
    (!result.replayed && !result.attempt) ||
    (result.attempt !== undefined && (
      result.attempt.status !== 'committed' ||
      result.attempt.attemptRevision !== result.receipt.attemptRevision
    ))
  ) {
    throw new Error('Finish response conflicts with committed rehearsal truth.');
  }
}

function cloneFinishResult<TSession, TArtifact, TEvidence>(
  result: PlayRehearsalFinishResult<TSession, TArtifact, TEvidence>,
): PlayRehearsalFinishResult<TSession, TArtifact, TEvidence> {
  return {
    ...result,
    ...(result.attempt
      ? {
          attempt: clonePlayRehearsalAttemptSnapshot({
            attempt: result.attempt,
          }).attempt,
        }
      : {}),
    receipt: { ...result.receipt },
  };
}

function createMutationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `play-rehearsal-${Date.now()}`;
}

function isActiveAttempt(
  attempt: PlayRehearsalAttemptRecord | undefined,
): attempt is PlayRehearsalAttemptRecord {
  return attempt?.status === 'running' || attempt?.status === 'prepared';
}

function isDefinitiveMutationRejection(value: unknown): boolean {
  if (
    !(value instanceof Error) ||
    value.name !== 'OanRequestError' ||
    !('status' in value) ||
    typeof value.status !== 'number'
  ) {
    return false;
  }
  return value.status >= 400 &&
    value.status < 500 &&
    value.status !== 408 &&
    value.status !== 425 &&
    value.status !== 429;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
