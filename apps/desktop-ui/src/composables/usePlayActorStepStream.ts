import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
} from 'vue';

export type PlayActorStepStatus = 'draft' | 'selected' | 'superseded' | 'discarded';

export interface PlayActorNarrativeBlockRecord {
  id: string;
  kind: 'narrator' | 'characterSpeech' | 'characterAction' | 'worldNotice';
  speakerRef?: string;
  content: string;
  visibility?: 'playerVisible' | 'rumor' | 'playerUnknown';
  projection: 'transcript' | 'directorOnly';
  eventRefs?: string[];
  sourceRefs?: string[];
}

export interface PlayActorStepRecord {
  id: string;
  attemptId?: string;
  participantRef: string;
  intentSummary?: string;
  perceptionRef?: string;
  narrativeBlocks?: PlayActorNarrativeBlockRecord[];
  queueIndex?: number;
  effectFingerprint?: string;
  materialEffect?:
    | { kind: 'materialEffect' }
    | { kind: 'noMaterialEffect'; reason: string };
  status: PlayActorStepStatus;
  variantOf?: string;
}

export type PlayRehearsalAttemptRuntimeStatus =
  | 'running'
  | 'prepared'
  | 'committed'
  | 'cancelled'
  | 'failed';

export interface PlayRehearsalAttemptRecord {
  id: string;
  sessionId: string;
  baseRevision: number;
  attemptRevision: number;
  status: PlayRehearsalAttemptRuntimeStatus;
  actorOrder: string[];
  participantRefs?: string[];
  orderStrategy?: 'directorFixed' | 'refereeDynamic' | 'hybrid';
  selectedStepRefs: string[];
  selectedHeadRef?: string;
  currentStepRef?: string;
  steps: PlayActorStepRecord[];
  interventions?: Array<{
    id: string;
    kind: 'reviseProjection' | 'redirectStep' | 'insertActor' | 'grantKnowledge';
    supersededStepRefs: string[];
    participantRef?: string;
    effectiveFromStepRef?: string;
    effectiveFromQueueIndex?: number;
    selectedPrefixRefs?: string[];
    grant?:
      | { kind: 'existingFact'; factRefs: string[] }
      | {
          kind: 'authorProvidedPlayFact';
          summary: string;
          visibility: 'playerVisible' | 'rumor' | 'playerUnknown';
          providedAt: string;
        };
  }>;
  stagnation?: {
    consecutiveNoMaterialSteps: number;
    threshold: number;
    warning: boolean;
  };
  mutationReceipts?: PlayRehearsalAttemptMutationReceipt[];
}

export interface PlayRehearsalAttemptSnapshot {
  attempt: PlayRehearsalAttemptRecord;
}

export interface PlayActorStepStreamOptions {
  signal?: AbortSignal;
  onStepRunId?(runId: string): void;
}

export interface PlayActorStepRequest {
  expectedAttemptRevision: number;
  idempotencyKey: string;
  mode: 'next' | 'retry';
  sourceStepRef?: string;
}

export interface PlayActorStepStreamEventBase {
  eventId: string;
  sequence: number;
  sessionId: string;
  attemptId: string;
  stepRunId: string;
}

export interface PlayRehearsalAttemptMutationReceipt {
  idempotencyKey: string;
  requestFingerprint?: string;
  resultingAttemptRevision: number;
  resultRef: string;
  responseDigest?: string;
}

export interface PlayActorStepStreamError {
  code: string;
  message: string;
  retryable: boolean;
}

export type PlayActorStepStreamEvent =
  | (PlayActorStepStreamEventBase & {
      type: 'play.actor.step.started';
      baseAttemptRevision: number;
      participantRef: string;
      mode: 'next' | 'retry';
      sourceStepRef?: string;
    })
  | (PlayActorStepStreamEventBase & {
      type: 'play.actor.step.delta';
      delta: string;
      provisional: true;
    })
  | (PlayActorStepStreamEventBase & {
      type: 'play.actor.step.reset';
      reason: string;
      provisional: true;
    })
  | (PlayActorStepStreamEventBase & {
      type: 'play.actor.step.prepared';
      attempt: PlayRehearsalAttemptRecord;
      step: PlayActorStepRecord;
      receipt: PlayRehearsalAttemptMutationReceipt;
    })
  | (PlayActorStepStreamEventBase & {
      type: 'play.actor.step.stream-aborted';
      attemptRevision: number;
      committed: false;
      reason: string;
    })
  | (PlayActorStepStreamEventBase & {
      type: 'play.actor.step.failed';
      error: PlayActorStepStreamError;
    });

export type PlayActorStepCancelResult =
  | { status: 'cancelling'; runId: string }
  | { status: 'committing'; runId: string; tooLateToStop: true }
  | { status: 'aborted'; runId: string }
  | { status: 'prepared'; runId: string; stepRef: string }
  | { status: 'failed'; runId: string; error: string };

export interface PlayActorStepStreamClient {
  streamNextPlayActorStep(
    sessionId: string,
    attemptId: string,
    input: PlayActorStepRequest,
    options?: PlayActorStepStreamOptions,
  ): AsyncIterable<PlayActorStepStreamEvent>;
  cancelPlayActorStep(
    sessionId: string,
    attemptId: string,
    runId: string,
  ): Promise<PlayActorStepCancelResult>;
  getPlayRehearsalAttempt(
    sessionId: string,
    attemptId: string,
  ): Promise<PlayRehearsalAttemptSnapshot>;
}

export type PlayActorStepRunPhase =
  | 'starting'
  | 'streaming'
  | 'prepared'
  | 'stopping'
  | 'aborted'
  | 'failed'
  | 'indeterminate';

export interface PlayActorStepRun {
  localId: string;
  runId?: string;
  sessionId: string;
  attemptId: string;
  expectedAttemptRevision: number;
  idempotencyKey: string;
  mode: 'next' | 'retry';
  sourceStepRef?: string;
  participantRef?: string;
  preparedStepRef?: string;
  phase: PlayActorStepRunPhase;
  provisionalText: string;
  statusMessage: string;
  error?: string;
}

export type PlayActorStepOutcome =
  | 'prepared'
  | 'aborted'
  | 'failed'
  | 'unknown'
  | 'ignored';

export interface PlayActorStepInvocation extends PlayActorStepRequest {
  sessionId: string;
  attemptId: string;
}

export interface UsePlayActorStepStreamOptions {
  client: PlayActorStepStreamClient;
  onSnapshot(snapshot: PlayRehearsalAttemptSnapshot): void;
}

const busyPhases: ReadonlySet<PlayActorStepRunPhase> = new Set([
  'starting',
  'streaming',
  'stopping',
]);

export function usePlayActorStepStream(
  options: UsePlayActorStepStreamOptions,
) {
  const currentRun = shallowRef<PlayActorStepRun>();
  const announcement = shallowRef('');
  const activeConnection = shallowRef<{
    localId: string;
    controller: AbortController;
  }>();
  const seenEvents = new Map<string, string>();
  const terminalOutcomes = new Map<string, PlayActorStepOutcome>();
  let disposed = false;

  const busy = computed(() => Boolean(activeConnection.value));
  const canStop = computed(() => {
    const run = currentRun.value;
    return Boolean(
      run?.runId &&
      activeConnection.value?.localId === run.localId &&
      (run.phase === 'starting' || run.phase === 'streaming'),
    );
  });

  async function start(
    input: PlayActorStepInvocation,
  ): Promise<PlayActorStepOutcome> {
    if (busy.value || disposed || !isValidInvocation(input)) {
      return 'ignored';
    }

    clearTerminalRun();
    seenEvents.clear();
    const localId = createLocalRunId();
    currentRun.value = {
      localId,
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      expectedAttemptRevision: input.expectedAttemptRevision,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      ...(input.sourceStepRef ? { sourceStepRef: input.sourceStepRef } : {}),
      phase: 'starting',
      provisionalText: '',
      statusMessage: input.mode === 'retry'
        ? 'Starting attempt-local Retry…'
        : 'Starting actor step…',
    };
    announcement.value = currentRun.value.statusMessage;
    const controller = new AbortController();
    activeConnection.value = { localId, controller };
    let knownRunId: string | undefined;
    let lastSequence = 0;
    let receivedStarted = false;
    let outcome: PlayActorStepOutcome | undefined;

    try {
      for await (const event of options.client.streamNextPlayActorStep(
        input.sessionId,
        input.attemptId,
        {
          expectedAttemptRevision: input.expectedAttemptRevision,
          idempotencyKey: input.idempotencyKey,
          mode: input.mode,
          ...(input.sourceStepRef ? { sourceStepRef: input.sourceStepRef } : {}),
        },
        {
          signal: controller.signal,
          onStepRunId(runId) {
            if (!isNonEmptyString(runId)) {
              throw new Error('Actor-step response returned an invalid run id.');
            }
            if (knownRunId && knownRunId !== runId) {
              throw new Error('Actor-step response changed run identity.');
            }
            knownRunId = runId;
            updateRun(localId, { runId });
          },
        },
      )) {
        if (!knownRunId) {
          throw new Error('Actor-step stream emitted before exposing its run id.');
        }
        assertEventIdentity(event, input, knownRunId);
        const eventFingerprint = stableJson(event);
        const seenFingerprint = seenEvents.get(event.eventId);
        if (seenFingerprint) {
          if (seenFingerprint !== eventFingerprint) {
            throw new Error('Actor-step stream reused an event id with another payload.');
          }
          continue;
        }
        if (
          !Number.isSafeInteger(event.sequence) ||
          event.sequence !== lastSequence + 1 ||
          event.eventId !== `${knownRunId}:${event.sequence}`
        ) {
          throw new Error('Actor-step stream sequence or event identity is not contiguous.');
        }
        seenEvents.set(event.eventId, eventFingerprint);
        lastSequence = event.sequence;

        const externalOutcome = terminalOutcomes.get(event.stepRunId);
        if (externalOutcome) {
          outcome = externalOutcome;
          continue;
        }
        if (outcome || currentRun.value?.localId !== localId) {
          continue;
        }

        if (!receivedStarted && event.type !== 'play.actor.step.started') {
          throw new Error('Actor-step stream did not start with play.actor.step.started.');
        }
        if (event.type === 'play.actor.step.started') {
          if (
            receivedStarted ||
            event.baseAttemptRevision !== input.expectedAttemptRevision ||
            event.mode !== input.mode ||
            event.sourceStepRef !== input.sourceStepRef
          ) {
            throw new Error('Actor-step start event conflicts with the requested attempt revision.');
          }
          receivedStarted = true;
        }

        outcome = applyEvent(event, input, localId, controller) ?? outcome;
      }

      outcome = (knownRunId ? terminalOutcomes.get(knownRunId) : undefined) ?? outcome;
      if (!outcome) {
        throw new Error('Actor-step stream ended without a terminal event.');
      }
    } catch (caught) {
      outcome = knownRunId ? terminalOutcomes.get(knownRunId) : undefined;
      if (!outcome && !disposed) {
        outcome = await reconcileLostStream(input, localId, knownRunId, caught);
      }
      if (!outcome && disposed) {
        outcome = 'aborted';
      }
      if (!outcome) {
        updateRun(localId, {
          phase: 'failed',
          provisionalText: '',
          statusMessage: 'Actor step not prepared',
          error: toErrorMessage(caught),
        });
        outcome = 'failed';
      }
    } finally {
      if (activeConnection.value?.localId === localId) {
        activeConnection.value = undefined;
      }
    }

    return outcome;
  }

  async function stop(): Promise<void> {
    const run = currentRun.value;
    const connection = activeConnection.value;
    if (!run?.runId || !connection || connection.localId !== run.localId || !canStop.value) {
      return;
    }

    updateRun(run.localId, {
      phase: 'stopping',
      statusMessage: 'Stopping actor step; attempt remains active…',
      error: undefined,
    });

    let result: PlayActorStepCancelResult | undefined;
    let cancelError: unknown;
    try {
      result = await options.client.cancelPlayActorStep(
        run.sessionId,
        run.attemptId,
        run.runId,
      );
      if (result.runId !== run.runId) {
        throw new Error('Actor-step cancel response changed run identity.');
      }
    } catch (caught) {
      cancelError = caught;
    }

    let snapshot: PlayRehearsalAttemptSnapshot | undefined;
    try {
      snapshot = await options.client.getPlayRehearsalAttempt(
        run.sessionId,
        run.attemptId,
      );
      assertSnapshot(snapshot, run.sessionId, run.attemptId);
      options.onSnapshot(cloneSnapshot(snapshot));
    } catch (caught) {
      cancelError = cancelError
        ? new Error(`${toErrorMessage(cancelError)}; reconciliation failed: ${toErrorMessage(caught)}`)
        : caught;
    }

    const reconciledStep = snapshot
      ? preparedStep(
          snapshot,
          run.expectedAttemptRevision,
          undefined,
          run.idempotencyKey,
          run.sourceStepRef,
        )
      : undefined;
    if (reconciledStep) {
      setExternalTerminal(run, 'prepared', connection.controller, reconciledStep.id);
      return;
    }
    if (result?.status === 'aborted' && snapshot) {
      if (snapshot.attempt.attemptRevision !== run.expectedAttemptRevision) {
        markIndeterminate(run.localId, cancelError ?? new Error(
          'Abort response conflicts with the reconciled attempt revision.',
        ));
        return;
      }
      setExternalTerminal(run, 'aborted', connection.controller);
      return;
    }
    if (result?.status === 'prepared') {
      markIndeterminate(run.localId, cancelError ?? new Error(
        `Prepared response cannot be resolved in attempt truth: ${result.stepRef}.`,
      ));
      return;
    }
    if (result?.status === 'failed') {
      terminalOutcomes.set(run.runId, 'failed');
      updateRun(run.localId, {
        phase: 'failed',
        provisionalText: '',
        statusMessage: 'Actor step failed before preparation',
        error: result.error,
      });
      abortConnection(run.localId, connection.controller, 'actor-step-failed');
      return;
    }
    if (result?.status === 'cancelling' && !cancelError) {
      updateRun(run.localId, {
        phase: 'stopping',
        statusMessage: 'Server is cancelling the actor step…',
      });
      return;
    }
    if (result?.status === 'committing') {
      updateRun(run.localId, {
        phase: 'stopping',
        statusMessage: 'Stop arrived after commit began · waiting for authoritative actor-step truth…',
        error: undefined,
      });
      return;
    }

    markIndeterminate(run.localId, cancelError ?? new Error(
      'Actor-step stop did not return a provable terminal state.',
    ));
  }

  async function reconcile(): Promise<PlayActorStepOutcome> {
    const run = currentRun.value;
    if (!run || run.phase !== 'indeterminate' || disposed) {
      return 'ignored';
    }
    const invocation: PlayActorStepInvocation = {
      sessionId: run.sessionId,
      attemptId: run.attemptId,
      expectedAttemptRevision: run.expectedAttemptRevision,
      idempotencyKey: run.idempotencyKey,
      mode: run.mode,
      ...(run.sourceStepRef ? { sourceStepRef: run.sourceStepRef } : {}),
    };

    if (!run.runId) {
      const snapshotOutcome = await reconcileLostStream(
        invocation,
        run.localId,
        undefined,
        new Error('Manual actor-step reconciliation before run identity was received.'),
      );
      if (snapshotOutcome === 'prepared') return snapshotOutcome;
      // The request may have reached the server before its response headers were
      // lost. Replaying the same mutation key is the only safe way to recover a
      // run identity without creating a second logical step.
      return start(invocation);
    }

    let terminalProof: PlayActorStepCancelResult | undefined;
    let proofError: unknown;
    try {
      terminalProof = await options.client.cancelPlayActorStep(
        run.sessionId,
        run.attemptId,
        run.runId,
      );
      if (terminalProof.runId !== run.runId) {
        throw new Error('Actor-step recovery response changed run identity.');
      }
    } catch (caught) {
      proofError = caught;
      terminalProof = undefined;
    }

    const outcome = await reconcileLostStream(
      invocation,
      run.localId,
      run.runId,
      proofError ?? new Error('Manual actor-step reconciliation.'),
      terminalProof,
    );
    const connection = activeConnection.value;
    if (
      (outcome === 'prepared' || outcome === 'aborted' || outcome === 'failed') &&
      connection?.localId === run.localId
    ) {
      abortConnection(run.localId, connection.controller, 'actor-step-reconciled');
    }
    return outcome;
  }

  function applyEvent(
    event: PlayActorStepStreamEvent,
    input: PlayActorStepInvocation,
    localId: string,
    controller: AbortController,
  ): PlayActorStepOutcome | undefined {
    switch (event.type) {
      case 'play.actor.step.started':
        updateRun(localId, {
          participantRef: event.participantRef,
          phase: 'streaming',
          statusMessage: input.mode === 'retry'
            ? 'Streaming Retry variant · attempt-local'
            : 'Streaming actor step · provisional',
        });
        return undefined;
      case 'play.actor.step.delta':
        updateRun(localId, (run) => ({
          provisionalText: `${run.provisionalText}${event.delta}`,
          phase: 'streaming',
          statusMessage: 'Streaming actor step · provisional',
        }));
        return undefined;
      case 'play.actor.step.reset':
        updateRun(localId, {
          provisionalText: '',
          phase: 'streaming',
          statusMessage: `Actor-step context reset · ${event.reason}`,
        });
        return undefined;
      case 'play.actor.step.prepared': {
        const snapshot = { attempt: event.attempt };
        assertSnapshot(snapshot, input.sessionId, input.attemptId);
        if (
          event.receipt.idempotencyKey !== input.idempotencyKey ||
          event.receipt.resultingAttemptRevision !== input.expectedAttemptRevision + 1 ||
          event.attempt.attemptRevision < event.receipt.resultingAttemptRevision ||
          event.receipt.resultRef !== event.step.id ||
          event.step.variantOf !== input.sourceStepRef
        ) {
          throw new Error('Prepared actor-step receipt conflicts with the requested mutation.');
        }
        const authoritativeStep = event.attempt.steps.find((candidate) =>
          candidate.id === event.step.id);
        const freshPrepared = event.attempt.attemptRevision ===
          event.receipt.resultingAttemptRevision;
        const step = freshPrepared
          ? preparedStep(
              snapshot,
              input.expectedAttemptRevision,
              event.step.id,
              undefined,
              input.sourceStepRef,
            )
          : authoritativeStep;
        const storedReceipt = event.attempt.mutationReceipts?.find((receipt) =>
          receipt.idempotencyKey === event.receipt.idempotencyKey);
        if (
          !step ||
          !sameStepIdentity(step, event.step) ||
          step.variantOf !== input.sourceStepRef ||
          (event.attempt.mutationReceipts !== undefined &&
            (!storedReceipt || !sameReceipt(storedReceipt, event.receipt)))
        ) {
          throw new Error('Prepared actor step is missing from its attempt snapshot.');
        }
        options.onSnapshot(cloneSnapshot(snapshot));
        updateRun(localId, {
          preparedStepRef: step.id,
          phase: 'prepared',
          provisionalText: '',
          statusMessage: freshPrepared
            ? 'Actor step prepared · still not committed'
            : 'Actor-step receipt reconciled against newer attempt truth',
        });
        terminalOutcomes.set(event.stepRunId, 'prepared');
        abortConnection(localId, controller, 'actor-step-prepared');
        return 'prepared';
      }
      case 'play.actor.step.stream-aborted':
        if (event.attemptRevision !== input.expectedAttemptRevision) {
          throw new Error('Aborted actor step unexpectedly changed attempt revision.');
        }
        updateRun(localId, {
          phase: 'aborted',
          provisionalText: '',
          statusMessage: `Actor step aborted · ${event.reason}`,
        });
        terminalOutcomes.set(event.stepRunId, 'aborted');
        abortConnection(localId, controller, 'actor-step-aborted');
        return 'aborted';
      case 'play.actor.step.failed':
        updateRun(localId, {
          phase: 'failed',
          provisionalText: '',
          statusMessage: 'Actor step failed before preparation',
          error: event.error.message,
        });
        terminalOutcomes.set(event.stepRunId, 'failed');
        abortConnection(localId, controller, 'actor-step-failed');
        return 'failed';
    }
  }

  async function reconcileLostStream(
    input: PlayActorStepInvocation,
    localId: string,
    runId: string | undefined,
    cause: unknown,
    terminalProof?: PlayActorStepCancelResult,
  ): Promise<PlayActorStepOutcome> {
    try {
      const snapshot = await options.client.getPlayRehearsalAttempt(
        input.sessionId,
        input.attemptId,
      );
      assertSnapshot(snapshot, input.sessionId, input.attemptId);
      options.onSnapshot(cloneSnapshot(snapshot));
      const step = preparedStep(
        snapshot,
        input.expectedAttemptRevision,
        undefined,
        input.idempotencyKey,
        input.sourceStepRef,
      );
      if (step) {
        if (runId) terminalOutcomes.set(runId, 'prepared');
        updateRun(localId, {
          preparedStepRef: step.id,
          phase: 'prepared',
          statusMessage: 'Actor step prepared · recovered from attempt truth',
          error: undefined,
        });
        return 'prepared';
      }
      if (terminalProof?.status === 'aborted') {
        if (snapshot.attempt.attemptRevision !== input.expectedAttemptRevision) {
          markIndeterminate(localId, new Error(
            'Aborted run proof conflicts with the reconciled attempt revision.',
          ));
          return 'unknown';
        }
        if (runId) terminalOutcomes.set(runId, 'aborted');
        updateRun(localId, {
          phase: 'aborted',
          provisionalText: '',
          statusMessage: 'Actor step aborted · recovered from run truth',
          error: undefined,
        });
        return 'aborted';
      }
      if (terminalProof?.status === 'failed') {
        if (runId) terminalOutcomes.set(runId, 'failed');
        updateRun(localId, {
          phase: 'failed',
          provisionalText: '',
          statusMessage: 'Actor step failed before preparation',
          error: terminalProof.error,
        });
        return 'failed';
      }
      const unresolved = terminalProof?.status === 'prepared'
        ? new Error(
            `Prepared run truth cannot be resolved in attempt truth: ${terminalProof.stepRef}.`,
          )
        : terminalProof?.status === 'cancelling' || terminalProof?.status === 'committing'
          ? new Error(`Actor-step run is still ${terminalProof.status}; recover again after it settles.`)
          : cause;
      markIndeterminate(localId, unresolved);
      return 'unknown';
    } catch (caught) {
      if (terminalProof?.status === 'failed') {
        if (runId) terminalOutcomes.set(runId, 'failed');
        updateRun(localId, {
          phase: 'failed',
          provisionalText: '',
          statusMessage: 'Actor step failed before preparation',
          error: terminalProof.error,
        });
        return 'failed';
      }
      markIndeterminate(localId, new Error(
        `${toErrorMessage(cause)}; attempt reconciliation failed: ${toErrorMessage(caught)}`,
      ));
      return 'unknown';
    }
  }

  function setExternalTerminal(
    run: PlayActorStepRun,
    outcome: 'prepared' | 'aborted',
    controller: AbortController,
    preparedStepRef?: string,
  ): void {
    if (!run.runId) return;
    terminalOutcomes.set(run.runId, outcome);
    updateRun(run.localId, outcome === 'prepared'
      ? {
          preparedStepRef,
          phase: 'prepared',
          statusMessage: 'Actor step prepared before Stop completed · still not committed',
          error: undefined,
        }
      : {
          phase: 'aborted',
          provisionalText: '',
          statusMessage: 'Actor step aborted · rehearsal attempt remains active',
          error: undefined,
        });
    abortConnection(run.localId, controller, `actor-step-${outcome}`);
  }

  function markIndeterminate(localId: string, cause: unknown): void {
    updateRun(localId, {
      phase: 'indeterminate',
      provisionalText: '',
      statusMessage: 'Actor-step terminal state unknown · reconcile before continuing',
      error: toErrorMessage(cause),
    });
  }

  function updateRun(
    localId: string,
    patch:
      | Partial<PlayActorStepRun>
      | ((run: PlayActorStepRun) => Partial<PlayActorStepRun>),
  ): void {
    const run = currentRun.value;
    if (!run || run.localId !== localId) return;
    const next = {
      ...run,
      ...(typeof patch === 'function' ? patch(run) : patch),
    };
    currentRun.value = next;
    if (next.statusMessage !== run.statusMessage) {
      announcement.value = next.statusMessage;
    }
  }

  function abortConnection(
    localId: string,
    controller: AbortController,
    reason: string,
  ): void {
    if (
      activeConnection.value?.localId === localId &&
      !controller.signal.aborted
    ) {
      controller.abort(reason);
    }
  }

  function clearTerminalRun(): void {
    if (currentRun.value && !busyPhases.has(currentRun.value.phase)) {
      currentRun.value = undefined;
      announcement.value = '';
    }
  }

  function dispose(): void {
    disposed = true;
    activeConnection.value?.controller.abort('actor-step-composable-disposed');
    activeConnection.value = undefined;
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose);
  }

  return {
    run: readonly(currentRun),
    announcement: readonly(announcement),
    busy,
    canStop,
    start,
    stop,
    reconcile,
    clearTerminalRun,
    dispose,
  };
}

function preparedStep(
  snapshot: PlayRehearsalAttemptSnapshot,
  expectedAttemptRevision: number,
  stepRef = snapshot.attempt.currentStepRef,
  idempotencyKey?: string,
  sourceStepRef?: string,
): PlayActorStepRecord | undefined {
  if (idempotencyKey) {
    const receipt = snapshot.attempt.mutationReceipts?.find((candidate) =>
      candidate.idempotencyKey === idempotencyKey);
    if (
      !receipt ||
      receipt.resultingAttemptRevision !== expectedAttemptRevision + 1 ||
      snapshot.attempt.attemptRevision < receipt.resultingAttemptRevision ||
      (stepRef !== undefined && receipt.resultRef !== stepRef)
    ) {
      return undefined;
    }
    const step = snapshot.attempt.steps.find((candidate) =>
      candidate.id === receipt.resultRef);
    if (!step || step.variantOf !== sourceStepRef) return undefined;
    if (
      snapshot.attempt.attemptRevision === receipt.resultingAttemptRevision &&
      (snapshot.attempt.currentStepRef !== step.id || step.status !== 'draft')
    ) {
      return undefined;
    }
    return step;
  }
  if (
    snapshot.attempt.attemptRevision !== expectedAttemptRevision + 1 ||
    !stepRef ||
    snapshot.attempt.currentStepRef !== stepRef
  ) {
    return undefined;
  }
  const step = snapshot.attempt.steps.find((candidate) => candidate.id === stepRef);
  return step?.status === 'draft' && step.variantOf === sourceStepRef
    ? step
    : undefined;
}

function assertEventIdentity(
  event: PlayActorStepStreamEvent,
  input: PlayActorStepInvocation,
  runId: string,
): void {
  if (
    event.sessionId !== input.sessionId ||
    event.attemptId !== input.attemptId ||
    event.stepRunId !== runId ||
    !isNonEmptyString(event.eventId)
  ) {
    throw new Error('Actor-step stream changed session, attempt, run or event identity.');
  }
}

export function assertPlayRehearsalAttemptSnapshot(
  snapshot: PlayRehearsalAttemptSnapshot,
  sessionId: string,
  attemptId: string,
): void {
  assertSnapshot(snapshot, sessionId, attemptId);
}

function assertSnapshot(
  snapshot: PlayRehearsalAttemptSnapshot,
  sessionId: string,
  attemptId: string,
): void {
  const attempt = snapshot?.attempt;
  if (
    !attempt ||
    attempt.sessionId !== sessionId ||
    attempt.id !== attemptId ||
    !Number.isSafeInteger(attempt.baseRevision) ||
    attempt.baseRevision < 0 ||
    !Number.isSafeInteger(attempt.attemptRevision) ||
    attempt.attemptRevision < 0 ||
    !Array.isArray(attempt.actorOrder) ||
    !attempt.actorOrder.every(isNonEmptyString) ||
    new Set(attempt.actorOrder).size !== attempt.actorOrder.length ||
    !Array.isArray(attempt.selectedStepRefs) ||
    !attempt.selectedStepRefs.every(isNonEmptyString) ||
    new Set(attempt.selectedStepRefs).size !== attempt.selectedStepRefs.length ||
    !['running', 'prepared', 'committed', 'cancelled', 'failed'].includes(attempt.status) ||
    !Array.isArray(attempt.steps) ||
    (attempt.mutationReceipts !== undefined && !Array.isArray(attempt.mutationReceipts))
  ) {
    throw new Error('Invalid rehearsal attempt snapshot.');
  }
  const stepIds = new Set<string>();
  const stepsById = new Map<string, PlayActorStepRecord>();
  for (const step of attempt.steps) {
    if (
      !isNonEmptyString(step.id) ||
      stepIds.has(step.id) ||
      !isNonEmptyString(step.participantRef) ||
      (step.attemptId !== undefined && step.attemptId !== attemptId) ||
      !attempt.actorOrder.includes(step.participantRef) ||
      !['draft', 'selected', 'superseded', 'discarded'].includes(step.status)
    ) {
      throw new Error('Invalid or duplicate actor step in attempt snapshot.');
    }
    stepIds.add(step.id);
    stepsById.set(step.id, step);
  }
  const selectedRefs = new Set(attempt.selectedStepRefs);
  const currentStep = attempt.currentStepRef
    ? stepsById.get(attempt.currentStepRef)
    : undefined;
  if (
    attempt.selectedStepRefs.some((stepRef) => !stepIds.has(stepRef)) ||
    attempt.selectedStepRefs.some((stepRef) => stepsById.get(stepRef)?.status !== 'selected') ||
    attempt.steps.some((step) => step.status === 'selected' && !selectedRefs.has(step.id)) ||
    (attempt.selectedHeadRef !== undefined &&
      attempt.selectedHeadRef !== attempt.selectedStepRefs.at(-1)) ||
    (attempt.currentStepRef !== undefined && currentStep?.status !== 'draft') ||
    (attempt.status !== 'running' && attempt.currentStepRef !== undefined)
  ) {
    throw new Error('Attempt snapshot contains a dangling step reference.');
  }
  const receiptKeys = new Set<string>();
  for (const receipt of attempt.mutationReceipts ?? []) {
    if (
      !isNonEmptyString(receipt.idempotencyKey) ||
      receiptKeys.has(receipt.idempotencyKey) ||
      !Number.isSafeInteger(receipt.resultingAttemptRevision) ||
      receipt.resultingAttemptRevision < 1 ||
      receipt.resultingAttemptRevision > attempt.attemptRevision ||
      !isNonEmptyString(receipt.resultRef)
    ) {
      throw new Error('Invalid or duplicate attempt mutation receipt.');
    }
    receiptKeys.add(receipt.idempotencyKey);
  }
}

export function clonePlayRehearsalAttemptSnapshot(
  snapshot: PlayRehearsalAttemptSnapshot,
): PlayRehearsalAttemptSnapshot {
  return cloneSnapshot(snapshot);
}

function cloneSnapshot(
  snapshot: PlayRehearsalAttemptSnapshot,
): PlayRehearsalAttemptSnapshot {
  return clonePlainData(snapshot);
}

function sameStepIdentity(
  left: PlayActorStepRecord,
  right: PlayActorStepRecord,
): boolean {
  return stableJson(left) === stableJson(right);
}

function sameReceipt(
  left: PlayRehearsalAttemptMutationReceipt,
  right: PlayRehearsalAttemptMutationReceipt,
): boolean {
  return left.idempotencyKey === right.idempotencyKey &&
    left.resultingAttemptRevision === right.resultingAttemptRevision &&
    left.resultRef === right.resultRef &&
    left.requestFingerprint === right.requestFingerprint &&
    left.responseDigest === right.responseDigest;
}

function isValidInvocation(input: PlayActorStepInvocation): boolean {
  return isNonEmptyString(input.sessionId) &&
    isNonEmptyString(input.attemptId) &&
    Number.isSafeInteger(input.expectedAttemptRevision) &&
    input.expectedAttemptRevision >= 0 &&
    isNonEmptyString(input.idempotencyKey) &&
    (input.mode === 'next' || input.mode === 'retry') &&
    (
      (input.mode === 'next' && input.sourceStepRef === undefined) ||
      (input.mode === 'retry' && isNonEmptyString(input.sourceStepRef))
    );
}

function createLocalRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `actor-step-${Date.now()}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }
  return value;
}

function clonePlainData<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
