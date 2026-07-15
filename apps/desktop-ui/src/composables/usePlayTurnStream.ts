import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
} from 'vue';

import type {
  PlayActionKind,
  PlayRelativeTimeAdvance,
  PlaySession,
  PlayTurnCancelResult,
  PlayTurnStreamEvent,
  PlayTurnStreamOptions,
} from './useWorkspaceApi';

export type PlayTurnRunPhase =
  | 'starting'
  | 'streaming'
  | 'prepared'
  | 'stopping'
  | 'committing'
  | 'cancelled'
  | 'failed'
  | 'conflict'
  | 'indeterminate';

export interface PlayProvisionalTurn {
  localId: string;
  turnId?: string;
  sessionId: string;
  baseRevision: number;
  userText: string;
  actionKind: PlayActionKind;
  timeAdvance?: PlayRelativeTimeAdvance;
  intent: 'submit' | 'retry';
  retrySourceArtifactId?: string;
  retryParentArtifactId?: string;
  phase: PlayTurnRunPhase;
  provisionalText: string;
  statusMessage: string;
  error?: string;
}

export interface PlayTurnStreamClient {
  streamPlayWorldRefereeTurn(
    id: string,
    input: {
      userText: string;
      actionKind?: PlayActionKind;
      timeAdvance?: PlayRelativeTimeAdvance;
      baseRevision?: number;
    },
    options?: PlayTurnStreamOptions,
  ): AsyncIterable<PlayTurnStreamEvent>;
  retryPlayWorldRefereeTurn(
    id: string,
    artifactId: string,
    input: { baseRevision: number },
    options?: PlayTurnStreamOptions,
  ): AsyncIterable<PlayTurnStreamEvent>;
  cancelPlayWorldRefereeTurn(id: string, turnId: string): Promise<PlayTurnCancelResult>;
}

export interface UsePlayTurnStreamOptions {
  client: PlayTurnStreamClient;
  onCommitted(session: PlaySession): void;
}

export type PlayTurnSubmitOutcome =
  | 'committed'
  | 'cancelled'
  | 'failed'
  | 'unknown'
  | 'ignored';

export interface PlayTurnSubmitInput {
  sessionId: string;
  baseRevision: number;
  userText: string;
  actionKind: PlayActionKind;
  timeAdvance?: PlayRelativeTimeAdvance;
}

export interface PlayTurnRetryInput extends PlayTurnSubmitInput {
  artifactId: string;
}

interface PlayTurnInvocation extends PlayTurnSubmitInput {
  intent: 'submit' | 'retry';
  retrySourceArtifactId?: string;
}

const busyPhases: ReadonlySet<PlayTurnRunPhase> = new Set([
  'starting',
  'streaming',
  'prepared',
  'stopping',
  'committing',
]);

export function usePlayTurnStream(options: UsePlayTurnStreamOptions) {
  const currentRun = shallowRef<PlayProvisionalTurn>();
  const announcement = shallowRef('');
  const activeConnection = shallowRef<{
    localId: string;
    controller: AbortController;
  }>();
  const seenEventIds = new Set<string>();
  const appliedCommitTurnIds = new Set<string>();
  const terminalOutcomes = new Map<string, PlayTurnSubmitOutcome>();
  let disposed = false;

  const busy = computed(() => Boolean(activeConnection.value));
  const canStop = computed(() => {
    const run = currentRun.value;
    return Boolean(
      run?.turnId &&
      activeConnection.value?.localId === run.localId &&
      (run.phase === 'starting' || run.phase === 'streaming' || run.phase === 'prepared'),
    );
  });

  function submit(input: PlayTurnSubmitInput): Promise<PlayTurnSubmitOutcome> {
    return runTurn(
      { ...input, intent: 'submit' },
      (streamOptions) => options.client.streamPlayWorldRefereeTurn(
        input.sessionId,
        {
          userText: input.userText,
          actionKind: input.actionKind,
          ...(input.timeAdvance ? { timeAdvance: input.timeAdvance } : {}),
          baseRevision: input.baseRevision,
        },
        streamOptions,
      ),
    );
  }

  function retry(input: PlayTurnRetryInput): Promise<PlayTurnSubmitOutcome> {
    return runTurn(
      {
        ...input,
        intent: 'retry',
        retrySourceArtifactId: input.artifactId,
      },
      (streamOptions) => options.client.retryPlayWorldRefereeTurn(
        input.sessionId,
        input.artifactId,
        { baseRevision: input.baseRevision },
        streamOptions,
      ),
    );
  }

  async function runTurn(
    input: PlayTurnInvocation,
    openStream: (streamOptions: PlayTurnStreamOptions) => AsyncIterable<PlayTurnStreamEvent>,
  ): Promise<PlayTurnSubmitOutcome> {
    if (busy.value || disposed) {
      return 'ignored';
    }

    clearTerminalRun();
    seenEventIds.clear();
    const localId = createLocalRunId();
    currentRun.value = {
      localId,
      sessionId: input.sessionId,
      baseRevision: input.baseRevision,
      userText: input.userText,
      actionKind: input.actionKind,
      ...(input.timeAdvance ? { timeAdvance: input.timeAdvance } : {}),
      intent: input.intent,
      retrySourceArtifactId: input.retrySourceArtifactId,
      phase: 'starting',
      provisionalText: '',
      statusMessage: input.intent === 'retry'
        ? 'Starting Retry from before turn…'
        : 'Starting world referee…',
    };
    announcement.value = input.intent === 'retry'
      ? 'Starting Play retry from before the original turn.'
      : 'Starting Play turn.';
    const controller = new AbortController();
    activeConnection.value = { localId, controller };
    let outcome: PlayTurnSubmitOutcome | undefined;
    let knownTurnId: string | undefined;

    try {
      for await (const event of openStream({
        signal: controller.signal,
        onTurnId(turnId) {
          if (knownTurnId && knownTurnId !== turnId) {
            throw new Error('Play turn response changed turn identity.');
          }
          knownTurnId = turnId;
          updateRun(localId, { turnId });
        },
      })) {
        if (knownTurnId && knownTurnId !== event.turnId) {
          throw new Error('Play turn stream changed turn identity.');
        }
        knownTurnId = event.turnId;
        if (seenEventIds.has(event.eventId)) {
          continue;
        }
        seenEventIds.add(event.eventId);

        const externalOutcome = terminalOutcomes.get(event.turnId);
        if (externalOutcome) {
          outcome = externalOutcome;
          continue;
        }
        if (outcome || currentRun.value?.localId !== localId) {
          continue;
        }
        if (event.sessionId !== input.sessionId) {
          throw new Error('Play turn stream changed session identity.');
        }

        outcome = applyStreamEvent(event, localId, controller) ?? outcome;
      }

      outcome = (knownTurnId ? terminalOutcomes.get(knownTurnId) : undefined) ?? outcome;

      if (!outcome) {
        throw new Error('Play turn stream ended without a terminal event.');
      }
    } catch (caught) {
      outcome = knownTurnId ? terminalOutcomes.get(knownTurnId) : undefined;

      if (!outcome && knownTurnId && !disposed) {
        outcome = await reconcileLostStream(
          localId,
          input.sessionId,
          knownTurnId,
          controller,
        );
      }

      if (!outcome && disposed) {
        outcome = 'cancelled';
      }

      if (!outcome) {
        const message = toErrorMessage(caught);
        if (knownTurnId) {
          updateRun(localId, {
            phase: 'indeterminate',
            statusMessage: 'Server outcome unknown · refresh before continuing',
            error: `The final status of this turn could not be confirmed: ${message}`,
          });
          outcome = 'unknown';
        } else {
          updateRun(localId, {
            phase: /revision conflict/iu.test(message) ? 'conflict' : 'failed',
            provisionalText: '',
            statusMessage: 'Turn not committed',
            error: message,
          });
          outcome = 'failed';
        }
      }
    } finally {
      if (
        activeConnection.value?.localId === localId
        && activeConnection.value.controller === controller
      ) {
        activeConnection.value = undefined;
      }
    }

    return outcome;
  }

  async function stop(): Promise<void> {
    const run = currentRun.value;
    if (!run?.turnId || !canStop.value) {
      return;
    }
    const connection = activeConnection.value;
    if (!connection || connection.localId !== run.localId) {
      return;
    }

    const previousPhase = run.phase;
    updateRun(run.localId, {
      phase: 'stopping',
      statusMessage: 'Stopping before commit…',
      error: undefined,
    });

    try {
      const result = await options.client.cancelPlayWorldRefereeTurn(
        run.sessionId,
        run.turnId,
      );
      const outcome = applyCancelResult(run.localId, result, connection.controller);
      if (!outcome) {
        await reconcileLostStream(
          run.localId,
          run.sessionId,
          run.turnId,
          connection.controller,
        );
      }
    } catch (caught) {
      if (terminalOutcomes.has(run.turnId)) {
        return;
      }
      updateRun(run.localId, {
        phase: previousPhase,
        statusMessage: previousPhase === 'prepared'
          ? run.intent === 'retry'
            ? 'Retry validated · waiting to commit'
            : 'Validated · waiting to commit'
          : run.intent === 'retry'
            ? 'World referee is replaying from before turn…'
            : 'World referee is responding…',
        error: `Stop request failed: ${toErrorMessage(caught)}`,
      });
    }
  }

  async function reconcile(): Promise<PlayTurnSubmitOutcome> {
    const run = currentRun.value;
    if (
      busy.value ||
      disposed ||
      run?.phase !== 'indeterminate' ||
      !run.turnId
    ) {
      return 'ignored';
    }

    const controller = new AbortController();
    activeConnection.value = { localId: run.localId, controller };
    let outcome: PlayTurnSubmitOutcome | undefined;

    try {
      outcome = await reconcileLostStream(
        run.localId,
        run.sessionId,
        run.turnId,
        controller,
      );
      if (!outcome) {
        updateRun(run.localId, {
          phase: 'indeterminate',
          statusMessage: 'Server outcome still unknown · refresh again before continuing',
        });
        outcome = 'unknown';
      }
    } finally {
      if (
        activeConnection.value?.localId === run.localId &&
        activeConnection.value.controller === controller
      ) {
        activeConnection.value = undefined;
      }
    }

    return outcome;
  }

  function updateRun(
    localId: string,
    patch:
      | Partial<PlayProvisionalTurn>
      | ((run: PlayProvisionalTurn) => Partial<PlayProvisionalTurn>),
  ): void {
    const run = currentRun.value;
    if (!run || run.localId !== localId) {
      return;
    }

    const nextRun = {
      ...run,
      ...(typeof patch === 'function' ? patch(run) : patch),
    };
    currentRun.value = nextRun;
    if (nextRun.statusMessage !== run.statusMessage) {
      announcement.value = nextRun.statusMessage;
    }
  }

  function applyStreamEvent(
    event: PlayTurnStreamEvent,
    localId: string,
    controller: AbortController,
  ): PlayTurnSubmitOutcome | undefined {
    switch (event.type) {
      case 'play.turn.started':
        updateRun(localId, (run) => ({
          turnId: event.turnId,
          ...(event.retry
            ? {
                retrySourceArtifactId: event.retry.sourceArtifactId,
                retryParentArtifactId: event.retry.parentArtifactId,
              }
            : {}),
          ...(isWaitingForServerTruth(run.phase)
            ? {}
            : {
                phase: 'streaming' as const,
                statusMessage: run.intent === 'retry'
                  ? 'World referee is replaying from before turn…'
                  : 'World referee is responding…',
              }),
        }));
        return undefined;
      case 'play.context.ready':
        return undefined;
      case 'play.narrative.delta':
        updateRun(localId, (run) => ({
          provisionalText: `${run.provisionalText}${event.delta}`,
          ...(isWaitingForServerTruth(run.phase)
            ? {}
            : {
                phase: 'streaming' as const,
                statusMessage: run.intent === 'retry'
                  ? 'Retry streaming · not committed'
                  : 'Streaming · not committed',
              }),
        }));
        return undefined;
      case 'play.narrative.reset':
        updateRun(localId, (run) => ({
          provisionalText: '',
          ...(isWaitingForServerTruth(run.phase)
            ? {}
            : {
                phase: 'streaming' as const,
                statusMessage: 'Context read complete · restarting provisional response',
              }),
        }));
        return undefined;
      case 'play.turn.prepared':
        updateRun(localId, (run) => isWaitingForServerTruth(run.phase)
          ? {}
          : {
              phase: 'prepared',
              statusMessage: run.intent === 'retry'
                ? 'Retry validated · waiting to commit'
                : 'Validated · waiting to commit',
            });
        return undefined;
      case 'play.event.occurred':
        // The following committed session remains the authoritative UI projection.
        return undefined;
      case 'play.turn.committed':
        applyCommittedSession(event.turnId, event.session);
        terminalOutcomes.set(event.turnId, 'committed');
        currentRun.value = undefined;
        announcement.value = 'Play turn committed.';
        abortConnection(localId, controller, 'server-confirmed-committed');
        return 'committed';
      case 'play.turn.cancelled':
        updateRun(localId, {
          phase: 'cancelled',
          statusMessage: 'Cancelled · provisional text was not committed',
        });
        terminalOutcomes.set(event.turnId, 'cancelled');
        abortConnection(localId, controller, 'server-confirmed-cancelled');
        return 'cancelled';
      case 'play.turn.failed':
        updateRun(localId, {
          phase: event.error.code === 'revision_conflict' ? 'conflict' : 'failed',
          provisionalText: '',
          statusMessage: 'Turn not committed',
          error: event.error.message,
        });
        terminalOutcomes.set(event.turnId, 'failed');
        abortConnection(localId, controller, 'server-confirmed-failure');
        return 'failed';
    }
  }

  function applyCancelResult(
    localId: string,
    result: PlayTurnCancelResult,
    controller: AbortController,
  ): PlayTurnSubmitOutcome | undefined {
    const terminal = terminalOutcomes.get(result.turnId);
    if (terminal) {
      return terminal;
    }
    if (result.status === 'committed') {
      applyCommittedSession(result.turnId, result.session);
      terminalOutcomes.set(result.turnId, 'committed');
      currentRun.value = undefined;
      announcement.value = 'Play turn committed.';
      abortConnection(localId, controller, 'server-already-committed');
      return 'committed';
    }
    if (result.status === 'cancelling') {
      updateRun(localId, {
        phase: 'stopping',
        statusMessage: 'Server is cancelling this turn…',
      });
      return undefined;
    }
    if (result.status === 'committing') {
      updateRun(localId, {
        phase: 'committing',
        statusMessage: 'Commit already started · waiting for server truth',
      });
      return undefined;
    }
    if (result.status === 'cancelled') {
      terminalOutcomes.set(result.turnId, 'cancelled');
      updateRun(localId, {
        phase: 'cancelled',
        statusMessage: 'Cancelled · provisional text was not committed',
      });
      abortConnection(localId, controller, 'server-confirmed-cancelled');
      return 'cancelled';
    }

    terminalOutcomes.set(result.turnId, 'failed');
    updateRun(localId, {
      phase: 'failed',
      provisionalText: '',
      statusMessage: 'Turn not committed',
      error: result.error,
    });
    abortConnection(localId, controller, 'server-confirmed-failure');
    return 'failed';
  }

  async function reconcileLostStream(
    localId: string,
    sessionId: string,
    turnId: string,
    controller: AbortController,
  ): Promise<PlayTurnSubmitOutcome | undefined> {
    let pollCount = 0;
    let consecutiveErrors = 0;

    while (!disposed) {
      const terminal = terminalOutcomes.get(turnId);
      if (terminal) {
        return terminal;
      }

      try {
        const result = await options.client.cancelPlayWorldRefereeTurn(sessionId, turnId);
        consecutiveErrors = 0;
        const outcome = applyCancelResult(localId, result, controller);
        if (outcome) {
          return outcome;
        }
      } catch {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 6) {
          break;
        }
      }

      pollCount += 1;
      await delay(Math.min(30 * pollCount, 250));
    }

    return terminalOutcomes.get(turnId);
  }

  function abortConnection(
    localId: string,
    controller: AbortController,
    reason: string,
  ): void {
    const active = activeConnection.value;
    if (
      active?.localId === localId
      && active.controller === controller
      && !controller.signal.aborted
    ) {
      controller.abort(reason);
    }
  }

  function applyCommittedSession(turnId: string, session: PlaySession): void {
    if (appliedCommitTurnIds.has(turnId)) {
      return;
    }
    appliedCommitTurnIds.add(turnId);
    options.onCommitted(session);
  }

  function clearTerminalRun(): void {
    if (currentRun.value && !busyPhases.has(currentRun.value.phase)) {
      currentRun.value = undefined;
      announcement.value = '';
    }
  }

  function dispose(): void {
    disposed = true;
    activeConnection.value?.controller.abort('play-workspace-disposed');
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
    submit,
    retry,
    stop,
    reconcile,
    clearTerminalRun,
    dispose,
  };
}

function createLocalRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`;
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isWaitingForServerTruth(phase: PlayTurnRunPhase): boolean {
  return phase === 'stopping' || phase === 'committing';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
