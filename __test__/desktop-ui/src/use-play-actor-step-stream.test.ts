import { describe, expect, it, vi } from 'vitest';

import {
  usePlayActorStepStream,
} from '../../../apps/desktop-ui/src/composables/usePlayActorStepStream';
import type {
  PlayActorStepStreamClient,
  PlayActorStepStreamEvent,
  PlayRehearsalAttemptRecord,
  PlayRehearsalAttemptSnapshot,
} from '../../../apps/desktop-ui/src/composables/usePlayActorStepStream';

describe('usePlayActorStepStream', () => {
  it('reduces delta/reset and applies only the authoritative prepared attempt', async () => {
    const applied: PlayRehearsalAttemptSnapshot[] = [];
    const getAttempt = vi.fn(async () => snapshot(attempt(1)));
    let streamSignal: AbortSignal | undefined;
    const preparedAttempt = attempt(1, {
      currentStepRef: 'step-1',
      steps: [draft('step-1')],
    });
    const client = clientWith({
      getAttempt,
      async *stream(_sessionId, _attemptId, input, options) {
        streamSignal = options?.signal;
        options?.onStepRunId?.('run-1');
        yield event('run-1', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        yield event('run-1', 2, {
          type: 'play.actor.step.delta',
          delta: 'discard me',
          provisional: true,
        });
        yield event('run-1', 3, {
          type: 'play.actor.step.reset',
          reason: 'provider-retry',
          provisional: true,
        });
        yield event('run-1', 4, {
          type: 'play.actor.step.delta',
          delta: 'new projection',
          provisional: true,
        });
        yield event('run-1', 5, {
          type: 'play.actor.step.prepared',
          attempt: preparedAttempt,
          step: preparedAttempt.steps[0]!,
          receipt: {
            idempotencyKey: input.idempotencyKey,
            resultingAttemptRevision: 1,
            resultRef: 'step-1',
          },
        });
      },
    });
    const actorStep = usePlayActorStepStream({
      client,
      onSnapshot(value) {
        applied.push(value);
      },
    });

    await expect(actorStep.start(invocation())).resolves.toBe('prepared');

    expect(actorStep.run.value).toMatchObject({
      runId: 'run-1',
      phase: 'prepared',
      preparedStepRef: 'step-1',
      provisionalText: '',
    });
    expect(applied).toEqual([{ attempt: preparedAttempt }]);
    expect(getAttempt).not.toHaveBeenCalled();
    expect(streamSignal?.aborted).toBe(true);
    expect(actorStep.announcement.value).toContain('still not committed');
  });

  it('reconciles a disconnected stream from GET attempt truth', async () => {
    const recovered = attempt(1, {
      currentStepRef: 'step-recovered',
      steps: [draft('step-recovered')],
      mutationReceipts: [{
        idempotencyKey: 'mutation-1',
        resultingAttemptRevision: 1,
        resultRef: 'step-recovered',
      }],
    });
    const applied: PlayRehearsalAttemptSnapshot[] = [];
    const getAttempt = vi.fn(async () => snapshot(recovered));
    const client = clientWith({
      getAttempt,
      async *stream(_sessionId, _attemptId, _input, options) {
        options?.onStepRunId?.('run-lost');
        yield event('run-lost', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        yield event('run-lost', 2, {
          type: 'play.actor.step.delta',
          delta: 'partial',
          provisional: true,
        });
        throw new Error('connection dropped');
      },
    });
    const actorStep = usePlayActorStepStream({
      client,
      onSnapshot(value) {
        applied.push(value);
      },
    });

    await expect(actorStep.start(invocation())).resolves.toBe('prepared');

    expect(getAttempt).toHaveBeenCalledWith('session-1', 'attempt-1');
    expect(applied).toEqual([{ attempt: recovered }]);
    expect(actorStep.run.value).toMatchObject({
      phase: 'prepared',
      preparedStepRef: 'step-recovered',
      error: undefined,
    });
  });

  it('reconciles a response lost before run identity from the idempotency receipt', async () => {
    const recovered = attempt(1, {
      currentStepRef: 'step-before-header',
      steps: [draft('step-before-header')],
      mutationReceipts: [{
        idempotencyKey: 'mutation-1',
        resultingAttemptRevision: 1,
        resultRef: 'step-before-header',
      }],
    });
    const getAttempt = vi.fn(async () => snapshot(recovered));
    const client = clientWith({
      getAttempt,
      async *stream() {
        throw new Error('response headers lost');
      },
    });
    const actorStep = usePlayActorStepStream({ client, onSnapshot() {} });

    await expect(actorStep.start(invocation())).resolves.toBe('prepared');

    expect(getAttempt).toHaveBeenCalledWith('session-1', 'attempt-1');
    expect(actorStep.run.value).toMatchObject({
      phase: 'prepared',
      preparedStepRef: 'step-before-header',
    });
    expect(actorStep.run.value?.runId).toBeUndefined();
  });

  it('same-key replays a pre-run-id request when recovery still finds no receipt', async () => {
    const recovered = attempt(1, {
      currentStepRef: 'step-replayed',
      steps: [draft('step-replayed')],
      mutationReceipts: [{
        idempotencyKey: 'mutation-1',
        resultingAttemptRevision: 1,
        resultRef: 'step-replayed',
      }],
    });
    const keys: string[] = [];
    let streamCalls = 0;
    const client = clientWith({
      async getAttempt() {
        return snapshot(attempt(0));
      },
      async *stream(_sessionId, _attemptId, input, options) {
        streamCalls += 1;
        keys.push(input.idempotencyKey);
        if (streamCalls === 1) throw new Error('response headers lost');
        options?.onStepRunId?.('run-replayed');
        yield event('run-replayed', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        yield event('run-replayed', 2, {
          type: 'play.actor.step.prepared',
          attempt: recovered,
          step: recovered.steps[0]!,
          receipt: recovered.mutationReceipts![0]!,
        });
      },
    });
    const actorStep = usePlayActorStepStream({ client, onSnapshot() {} });

    await expect(actorStep.start(invocation())).resolves.toBe('unknown');
    expect(actorStep.run.value).toMatchObject({ phase: 'indeterminate' });
    await expect(actorStep.reconcile()).resolves.toBe('prepared');

    expect(keys).toEqual(['mutation-1', 'mutation-1']);
    expect(actorStep.run.value).toMatchObject({
      runId: 'run-replayed',
      phase: 'prepared',
      preparedStepRef: 'step-replayed',
    });
  });

  it('accepts an idempotent prepared replay carrying newer authoritative attempt truth', async () => {
    const receipt = {
      idempotencyKey: 'mutation-1',
      requestFingerprint: 'step-fingerprint',
      resultingAttemptRevision: 1,
      resultRef: 'step-1',
      responseDigest: 'step-response',
    };
    const authoritativeStep = {
      ...draft('step-1'),
      status: 'selected' as const,
    };
    const advancedAttempt = attempt(2, {
      status: 'prepared',
      selectedStepRefs: ['step-1'],
      selectedHeadRef: 'step-1',
      steps: [authoritativeStep],
      mutationReceipts: [receipt],
    });
    const applied: PlayRehearsalAttemptSnapshot[] = [];
    const client = clientWith({
      async *stream(_sessionId, _attemptId, _input, options) {
        options?.onStepRunId?.('run-replay');
        yield event('run-replay', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        yield event('run-replay', 2, {
          type: 'play.actor.step.prepared',
          attempt: advancedAttempt,
          step: authoritativeStep,
          receipt,
        });
      },
    });
    const actorStep = usePlayActorStepStream({
      client,
      onSnapshot(value) {
        applied.push(value);
      },
    });

    await expect(actorStep.start(invocation())).resolves.toBe('prepared');

    expect(applied).toEqual([{ attempt: advancedAttempt }]);
    expect(actorStep.run.value).toMatchObject({
      phase: 'prepared',
      preparedStepRef: 'step-1',
      statusMessage: 'Actor-step receipt reconciled against newer attempt truth',
    });
  });

  it('stops the run, then GET-reconciles before claiming it was aborted', async () => {
    const calls: string[] = [];
    let streamSignal: AbortSignal | undefined;
    const client = clientWith({
      async cancel(_sessionId, _attemptId, runId) {
        calls.push('cancel');
        return { status: 'aborted', runId };
      },
      async getAttempt() {
        calls.push('get');
        return snapshot(attempt(0));
      },
      async *stream(_sessionId, _attemptId, _input, options) {
        streamSignal = options?.signal;
        options?.onStepRunId?.('run-stop');
        yield event('run-stop', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        yield event('run-stop', 2, {
          type: 'play.actor.step.delta',
          delta: 'partial',
          provisional: true,
        });
        await waitForAbort(options?.signal);
      },
    });
    const actorStep = usePlayActorStepStream({ client, onSnapshot() {} });

    const outcome = actorStep.start(invocation());
    await vi.waitFor(() => expect(actorStep.run.value?.phase).toBe('streaming'));
    await actorStep.stop();

    await expect(outcome).resolves.toBe('aborted');
    expect(calls).toEqual(['cancel', 'get']);
    expect(streamSignal?.aborted).toBe(true);
    expect(actorStep.run.value).toMatchObject({
      phase: 'aborted',
      provisionalText: '',
    });
  });

  it.each(['cancelling', 'committing'] as const)(
    'keeps the live stream authoritative when Stop returns %s before a delayed prepare',
    async (stopStatus) => {
      const receipt = {
        idempotencyKey: 'mutation-1',
        resultingAttemptRevision: 1,
        resultRef: 'step-recovered',
      };
      const recovered = attempt(1, {
        currentStepRef: 'step-recovered',
        steps: [draft('step-recovered')],
        mutationReceipts: [receipt],
      });
      const preparedGate = deferred<void>();
      let streamSignal: AbortSignal | undefined;
      const runId = `run-${stopStatus}`;
      const client = clientWith({
        async cancel(_sessionId, _attemptId, runId) {
          return stopStatus === 'cancelling'
            ? { status: 'cancelling', runId }
            : { status: 'committing', runId, tooLateToStop: true };
        },
        async getAttempt() {
          return snapshot(attempt(0));
        },
        async *stream(_sessionId, _attemptId, input, options) {
          streamSignal = options?.signal;
          options?.onStepRunId?.(runId);
          yield event(runId, 1, {
            type: 'play.actor.step.started',
            baseAttemptRevision: 0,
            participantRef: 'mara',
            mode: 'next',
          });
          yield event(runId, 2, {
            type: 'play.actor.step.delta',
            delta: 'partial',
            provisional: true,
          });
          await preparedGate.promise;
          yield event(runId, 3, {
            type: 'play.actor.step.prepared',
            attempt: recovered,
            step: recovered.steps[0]!,
            receipt: {
              ...receipt,
              idempotencyKey: input.idempotencyKey,
            },
          });
        },
      });
      const actorStep = usePlayActorStepStream({ client, onSnapshot() {} });

      const outcome = actorStep.start(invocation());
      await vi.waitFor(() => expect(actorStep.run.value?.phase).toBe('streaming'));
      await actorStep.stop();

      expect(actorStep.run.value).toMatchObject({
        phase: 'stopping',
      });
      expect(streamSignal?.aborted).toBe(false);

      preparedGate.resolve();
      await expect(outcome).resolves.toBe('prepared');
      expect(actorStep.run.value).toMatchObject({
        phase: 'prepared',
        preparedStepRef: 'step-recovered',
        error: undefined,
      });
    },
  );

  it('keeps recovery indeterminate when one GET only shows an unchanged attempt', async () => {
    const client = clientWith({
      async getAttempt() {
        return snapshot(attempt(0));
      },
      async *stream(_sessionId, _attemptId, _input, options) {
        options?.onStepRunId?.('run-unchanged');
        yield event('run-unchanged', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        throw new Error('connection dropped before preparation');
      },
    });
    const actorStep = usePlayActorStepStream({ client, onSnapshot() {} });

    await expect(actorStep.start(invocation())).resolves.toBe('unknown');

    expect(actorStep.run.value).toMatchObject({
      phase: 'indeterminate',
      provisionalText: '',
    });
    expect(actorStep.run.value?.error).toContain('connection dropped before preparation');
  });

  it('uses authoritative run truth to recover a dropped stream that was aborted', async () => {
    const cancel = vi.fn(async (_sessionId: string, _attemptId: string, runId: string) => ({
      status: 'aborted' as const,
      runId,
    }));
    const getAttempt = vi.fn(async () => snapshot(attempt(0)));
    const client = clientWith({
      cancel,
      getAttempt,
      async *stream(_sessionId, _attemptId, _input, options) {
        options?.onStepRunId?.('run-dropped-aborted');
        yield event('run-dropped-aborted', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        throw new Error('stream dropped after server abort');
      },
    });
    const actorStep = usePlayActorStepStream({ client, onSnapshot() {} });

    await expect(actorStep.start(invocation())).resolves.toBe('unknown');
    await expect(actorStep.reconcile()).resolves.toBe('aborted');

    expect(cancel).toHaveBeenCalledWith(
      'session-1',
      'attempt-1',
      'run-dropped-aborted',
    );
    expect(getAttempt).toHaveBeenCalledTimes(2);
    expect(actorStep.run.value).toMatchObject({
      phase: 'aborted',
      provisionalText: '',
      error: undefined,
    });
  });

  it('fails closed when an event id is reused with another payload', async () => {
    const getAttempt = vi.fn(async () => snapshot(attempt(1)));
    const client = clientWith({
      getAttempt,
      async *stream(_sessionId, _attemptId, _input, options) {
        options?.onStepRunId?.('run-conflict');
        yield event('run-conflict', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        yield {
          ...event('run-conflict', 2, {
            type: 'play.actor.step.delta',
            delta: 'conflicting payload',
            provisional: true,
          }),
          eventId: 'run-conflict:1',
        };
      },
    });
    const actorStep = usePlayActorStepStream({ client, onSnapshot() {} });

    await expect(actorStep.start(invocation())).resolves.toBe('unknown');

    expect(getAttempt).toHaveBeenCalledOnce();
    expect(actorStep.run.value).toMatchObject({
      phase: 'indeterminate',
      provisionalText: '',
    });
    expect(actorStep.run.value?.error).toContain('reused an event id');
  });
});

function clientWith(overrides: {
  stream?: PlayActorStepStreamClient['streamNextPlayActorStep'];
  cancel?: PlayActorStepStreamClient['cancelPlayActorStep'];
  getAttempt?: PlayActorStepStreamClient['getPlayRehearsalAttempt'];
}): PlayActorStepStreamClient {
  return {
    streamNextPlayActorStep: overrides.stream ?? emptyStream,
    cancelPlayActorStep: overrides.cancel ?? (async (_sessionId, _attemptId, runId) => ({
      status: 'aborted',
      runId,
    })),
    getPlayRehearsalAttempt: overrides.getAttempt ?? (async () => snapshot(attempt(0))),
  };
}

async function* emptyStream(): AsyncIterable<PlayActorStepStreamEvent> {}

function invocation(): {
  sessionId: string;
  attemptId: string;
  expectedAttemptRevision: number;
  idempotencyKey: string;
  mode: 'next';
} {
  return {
    sessionId: 'session-1',
    attemptId: 'attempt-1',
    expectedAttemptRevision: 0,
    idempotencyKey: 'mutation-1',
    mode: 'next',
  };
}

function event<T extends Omit<PlayActorStepStreamEvent, keyof EventBase>>(
  runId: string,
  sequence: number,
  value: T,
): T & EventBase {
  return {
    ...value,
    eventId: `${runId}:${sequence}`,
    sequence,
    sessionId: 'session-1',
    attemptId: 'attempt-1',
    stepRunId: runId,
  };
}

interface EventBase {
  eventId: string;
  sequence: number;
  sessionId: string;
  attemptId: string;
  stepRunId: string;
}

function snapshot(value: PlayRehearsalAttemptRecord): PlayRehearsalAttemptSnapshot {
  return { attempt: value };
}

function attempt(
  attemptRevision: number,
  overrides: Partial<PlayRehearsalAttemptRecord> = {},
): PlayRehearsalAttemptRecord {
  return {
    id: 'attempt-1',
    sessionId: 'session-1',
    baseRevision: 4,
    attemptRevision,
    status: 'running',
    actorOrder: ['mara'],
    selectedStepRefs: [],
    steps: [],
    ...overrides,
  };
}

function draft(id: string) {
  return {
    id,
    attemptId: 'attempt-1',
    participantRef: 'mara',
    status: 'draft' as const,
  };
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
