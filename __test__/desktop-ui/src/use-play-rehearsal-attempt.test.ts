import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import {
  usePlayRehearsalAttempt,
} from '../../../apps/desktop-ui/src/composables/usePlayRehearsalAttempt';
import type {
  PlayRehearsalAttemptClient,
} from '../../../apps/desktop-ui/src/composables/usePlayRehearsalAttempt';
import type {
  PlayActorStepStreamEvent,
  PlayRehearsalAttemptRecord,
} from '../../../apps/desktop-ui/src/composables/usePlayActorStepStream';

interface SessionResult {
  id: string;
  revision: number;
}

interface ArtifactResult {
  id: string;
}

interface EvidenceResult {
  id: string;
}

type TestClient = PlayRehearsalAttemptClient<
  SessionResult,
  ArtifactResult,
  EvidenceResult
>;

describe('usePlayRehearsalAttempt', () => {
  it('runs Start → actor step → Accept → Finish without exposing provisional commit truth', async () => {
    const mutationInputs: Array<Record<string, unknown>> = [];
    const issuedKeys: string[] = [];
    const onFinished = vi.fn();
    const createAttempt = vi.fn(async () => ({ attempt: runningAttempt(0) }));
    const preparedDraft = runningAttempt(1, {
      currentStepRef: 'step-1',
      steps: [step('step-1', 'draft')],
    });
    const selected = preparedAttempt(2, 'step-1');
    const committed = { ...selected, status: 'committed' as const };
    const client = clientWith({
      createPlayRehearsalAttempt: createAttempt,
      async *streamNextPlayActorStep(_sessionId, _attemptId, input, options) {
        mutationInputs.push({ kind: 'step', ...input });
        options?.onStepRunId?.('run-1');
        yield streamEvent('run-1', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        yield streamEvent('run-1', 2, {
          type: 'play.actor.step.delta',
          delta: 'Mara reaches for the letter.',
          provisional: true,
        });
        yield streamEvent('run-1', 3, {
          type: 'play.actor.step.prepared',
          attempt: preparedDraft,
          step: preparedDraft.steps[0]!,
          receipt: mutationReceipt(input.idempotencyKey, 1, 'step-1'),
        });
      },
      async acceptPlayRehearsalStep(_sessionId, _attemptId, input) {
        mutationInputs.push({ ...input });
        return {
          attempt: selected,
          receipt: mutationReceipt(input.idempotencyKey, 2, 'step-1'),
          replayed: false,
        };
      },
      async finishPlayRehearsalAttempt(_sessionId, _attemptId, input) {
        mutationInputs.push({ kind: 'finish', ...input });
        return {
          session: { id: 'session-1', revision: 5 },
          attempt: committed,
          artifact: { id: 'turn-1' },
          evidence: { id: 'evidence-1' },
          receipt: {
            idempotencyKey: input.idempotencyKey,
            attemptRevision: 2,
          },
          replayed: false,
        };
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey() {
        const key = `key-${issuedKeys.length + 1}`;
        issuedKeys.push(key);
        return key;
      },
      onFinished,
    });

    await expect(rehearsal.startAttempt()).resolves.toBe('applied');
    expect(createAttempt).toHaveBeenCalledWith('session-1', { baseRevision: 4 });
    expect(rehearsal.attempt.value?.attemptRevision).toBe(0);
    expect(rehearsal.committedResult.value).toBeUndefined();

    await expect(rehearsal.generateNextStep()).resolves.toBe('prepared');
    expect(rehearsal.currentStep.value?.id).toBe('step-1');
    expect(rehearsal.committedResult.value).toBeUndefined();
    expect(mutationInputs[0]).toMatchObject({
      kind: 'step',
      expectedAttemptRevision: 0,
      idempotencyKey: 'key-1',
      mode: 'next',
    });

    await expect(rehearsal.acceptStep('step-1')).resolves.toBe('applied');
    expect(rehearsal.attempt.value).toMatchObject({
      attemptRevision: 2,
      status: 'prepared',
      selectedHeadRef: 'step-1',
    });
    expect(rehearsal.committedResult.value).toBeUndefined();
    expect(mutationInputs[1]).toMatchObject({
      kind: 'accept',
      expectedAttemptRevision: 1,
      idempotencyKey: 'key-2',
      stepRef: 'step-1',
    });

    await expect(rehearsal.finishAttempt()).resolves.toBe('applied');
    expect(mutationInputs[2]).toMatchObject({
      kind: 'finish',
      baseRevision: 4,
      expectedAttemptRevision: 2,
      selectedHeadRef: 'step-1',
      idempotencyKey: 'key-3',
    });
    expect(rehearsal.attempt.value?.status).toBe('committed');
    expect(rehearsal.committedResult.value).toMatchObject({
      session: { revision: 5 },
      artifact: { id: 'turn-1' },
      evidence: { id: 'evidence-1' },
    });
    expect(onFinished).toHaveBeenCalledOnce();
    expect(rehearsal.announcement.value).toBe('Rehearsal committed as one Play turn.');
  });

  it('reuses the same idempotency key when an unknown Retry is retried', async () => {
    const source = runningAttempt(1, {
      currentStepRef: 'step-original',
      steps: [step('step-original', 'draft')],
    });
    const retried = runningAttempt(2, {
      currentStepRef: 'step-variant',
      steps: [
        step('step-original', 'superseded'),
        { ...step('step-variant', 'draft'), variantOf: 'step-original' },
      ],
    });
    const inputs: Array<{ idempotencyKey: string; mode: string; sourceStepRef?: string }> = [];
    let streamCalls = 0;
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: source };
      },
      async getPlayRehearsalAttempt() {
        throw new Error('GET attempt unavailable');
      },
      async *streamNextPlayActorStep(_sessionId, _attemptId, input, options) {
        streamCalls += 1;
        inputs.push(input);
        if (streamCalls === 1) throw new Error('response headers lost');
        options?.onStepRunId?.('run-retry-2');
        yield streamEvent('run-retry-2', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 1,
          participantRef: 'mara',
          mode: 'retry',
          sourceStepRef: 'step-original',
        });
        yield streamEvent('run-retry-2', 2, {
          type: 'play.actor.step.prepared',
          attempt: retried,
          step: retried.steps[1]!,
          receipt: mutationReceipt(input.idempotencyKey, 2, 'step-variant'),
        });
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: vi.fn(() => 'retry-key'),
    });
    await rehearsal.loadActive();

    await expect(rehearsal.retryStep('step-original')).resolves.toBe('unknown');
    expect(rehearsal.stepRun.value?.phase).toBe('indeterminate');
    await expect(rehearsal.retryStep('step-original')).resolves.toBe('prepared');

    expect(inputs).toEqual([
      {
        expectedAttemptRevision: 1,
        idempotencyKey: 'retry-key',
        mode: 'retry',
        sourceStepRef: 'step-original',
      },
      {
        expectedAttemptRevision: 1,
        idempotencyKey: 'retry-key',
        mode: 'retry',
        sourceStepRef: 'step-original',
      },
    ]);
    expect(rehearsal.currentStep.value).toMatchObject({
      id: 'step-variant',
      variantOf: 'step-original',
      status: 'draft',
    });
    expect(rehearsal.committedResult.value).toBeUndefined();
  });

  it('blocks Start until an indeterminate active-attempt lookup is recovered', async () => {
    const getActive = vi.fn()
      .mockRejectedValueOnce(new Error('active lookup unavailable'))
      .mockResolvedValueOnce({ attempt: null });
    const rehearsal = usePlayRehearsalAttempt({
      client: clientWith({ getActivePlayRehearsalAttempt: getActive }),
      sessionId: ref('session-1'),
      baseRevision: ref(4),
    });

    await expect(rehearsal.loadActive()).resolves.toBe('failed');
    expect(rehearsal.activeLookupIndeterminate.value).toBe(true);
    expect(rehearsal.canStartAttempt.value).toBe(false);
    await expect(rehearsal.startAttempt()).resolves.toBe('ignored');

    await expect(rehearsal.loadActive()).resolves.toBe('applied');
    expect(rehearsal.activeLookupIndeterminate.value).toBe(false);
    expect(rehearsal.canStartAttempt.value).toBe(true);
  });

  it('prefers fresh mutation failure feedback over a stale Retry run error', async () => {
    const source = runningAttempt(1, {
      currentStepRef: 'step-original',
      steps: [step('step-original', 'draft')],
    });
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: source };
      },
      async *streamNextPlayActorStep(_sessionId, _attemptId, _input, options) {
        options?.onStepRunId?.('run-retry-failed');
        yield streamEvent('run-retry-failed', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 1,
          participantRef: 'mara',
          mode: 'retry',
          sourceStepRef: 'step-original',
        });
        yield streamEvent('run-retry-failed', 2, {
          type: 'play.actor.step.failed',
          error: {
            code: 'provider_failed',
            message: 'Retry provider failed.',
            retryable: true,
          },
        });
      },
      async cancelPlayRehearsalAttempt() {
        throw new Error('Cancel endpoint failed.');
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
    });
    await rehearsal.loadActive();

    await expect(rehearsal.retryStep('step-original')).resolves.toBe('failed');
    expect(rehearsal.error.value).toBe('Retry provider failed.');
    await expect(rehearsal.cancelAttempt()).resolves.toBe('failed');

    expect(rehearsal.error.value).toContain('Cancel endpoint failed.');
    expect(rehearsal.error.value).not.toContain('Retry provider failed.');
    expect(rehearsal.announcement.value).toContain('Recover attempt truth');
  });

  it('GET-recovers a Cancel response lost after the terminal attempt was written', async () => {
    const active = runningAttempt(0);
    const receipt = mutationReceipt('cancel-lost-key', 1, active.id);
    const cancelled = runningAttempt(1, {
      status: 'cancelled',
      mutationReceipts: [receipt],
    });
    const cancel = vi.fn(async () => {
      throw new Error('Cancel response lost.');
    });
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: active };
      },
      async getPlayRehearsalAttempt() {
        return { attempt: cancelled };
      },
      cancelPlayRehearsalAttempt: cancel,
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'cancel-lost-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.cancelAttempt()).resolves.toBe('applied');

    expect(cancel).toHaveBeenCalledOnce();
    expect(rehearsal.attempt.value?.status).toBe('cancelled');
    expect(rehearsal.canGenerateStep.value).toBe(false);
    expect(rehearsal.mutationIndeterminate.value).toBe(false);
    expect(rehearsal.announcement.value).toContain('recovered from attempt truth');
  });

  it('GET-recovers an Accept response from its stored receipt', async () => {
    const active = runningAttempt(1, {
      currentStepRef: 'step-1',
      steps: [step('step-1', 'draft')],
    });
    const receipt = mutationReceipt('accept-lost-key', 2, 'step-1');
    const accepted = preparedAttempt(2, 'step-1');
    accepted.mutationReceipts = [receipt];
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: active };
      },
      async getPlayRehearsalAttempt() {
        return { attempt: accepted };
      },
      async acceptPlayRehearsalStep() {
        throw new Error('Accept response lost.');
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'accept-lost-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.acceptStep('step-1')).resolves.toBe('applied');

    expect(rehearsal.attempt.value).toMatchObject({
      status: 'prepared',
      selectedHeadRef: 'step-1',
    });
    expect(rehearsal.mutationIndeterminate.value).toBe(false);
  });

  it('same-key replays Finish when the committed response is lost', async () => {
    const active = preparedAttempt(2, 'step-1');
    const keys: string[] = [];
    let calls = 0;
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: active };
      },
      async finishPlayRehearsalAttempt(_sessionId, _attemptId, input) {
        calls += 1;
        keys.push(input.idempotencyKey);
        if (calls === 1) throw new Error('Finish response lost.');
        return {
          session: { id: 'session-1', revision: 5 },
          artifact: { id: 'turn-finish-recovered' },
          evidence: { id: 'evidence-finish-recovered' },
          receipt: {
            idempotencyKey: input.idempotencyKey,
            attemptRevision: 2,
          },
          replayed: true,
        };
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'finish-lost-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.finishAttempt()).resolves.toBe('applied');

    expect(keys).toEqual(['finish-lost-key', 'finish-lost-key']);
    expect(rehearsal.attempt.value).toBeUndefined();
    expect(rehearsal.committedResult.value).toMatchObject({
      artifact: { id: 'turn-finish-recovered' },
    });
    expect(rehearsal.announcement.value).toContain('recovered');
    expect(rehearsal.announcement.value).not.toContain('not committed');
  });

  it('blocks controls until an unresolved Cancel response is recovered', async () => {
    const active = runningAttempt(0);
    const receipt = mutationReceipt('cancel-recover-key', 1, active.id);
    const cancelled = runningAttempt(1, {
      status: 'cancelled',
      mutationReceipts: [receipt],
    });
    let truthAvailable = false;
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: active };
      },
      async getPlayRehearsalAttempt() {
        if (!truthAvailable) throw new Error('GET attempt unavailable.');
        return { attempt: cancelled };
      },
      async cancelPlayRehearsalAttempt() {
        throw new Error('Cancel response lost.');
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'cancel-recover-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.cancelAttempt()).resolves.toBe('failed');
    expect(rehearsal.mutationIndeterminate.value).toBe(true);
    expect(rehearsal.canGenerateStep.value).toBe(false);
    expect(rehearsal.canCancelAttempt.value).toBe(false);

    truthAvailable = true;
    await expect(rehearsal.recoverMutation()).resolves.toBe('applied');
    expect(rehearsal.mutationIndeterminate.value).toBe(false);
    expect(rehearsal.attempt.value?.status).toBe('cancelled');
  });

  it('does not replay or lock on a definitive Finish conflict', async () => {
    const active = preparedAttempt(2, 'step-1');
    const finish = vi.fn(async () => {
      throw requestError(409, 'Session revision conflict.');
    });
    const rehearsal = usePlayRehearsalAttempt({
      client: clientWith({
        async getActivePlayRehearsalAttempt() {
          return { attempt: active };
        },
        finishPlayRehearsalAttempt: finish,
      }),
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'finish-conflict-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.finishAttempt()).resolves.toBe('failed');

    expect(finish).toHaveBeenCalledOnce();
    expect(rehearsal.mutationIndeterminate.value).toBe(false);
    expect(rehearsal.canCancelAttempt.value).toBe(true);
    expect(rehearsal.announcement.value).toContain('Finish was rejected');
    expect(rehearsal.announcement.value).not.toContain('Recover');
  });

  it('releases an aborted recovered run key before generating again', async () => {
    const keys: string[] = [];
    let streamCalls = 0;
    let issuedKeys = 0;
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: runningAttempt(0) };
      },
      async getPlayRehearsalAttempt() {
        return { attempt: runningAttempt(0) };
      },
      async cancelPlayActorStep(_sessionId, _attemptId, runId) {
        return { status: 'aborted', runId };
      },
      async *streamNextPlayActorStep(_sessionId, _attemptId, input, options) {
        streamCalls += 1;
        keys.push(input.idempotencyKey);
        const runId = `run-${streamCalls}`;
        options?.onStepRunId?.(runId);
        yield streamEvent(runId, 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'mara',
          mode: 'next',
        });
        if (streamCalls === 1) throw new Error('stream dropped');
        yield streamEvent(runId, 2, {
          type: 'play.actor.step.failed',
          error: {
            code: 'provider_failed',
            message: 'Second generation failed.',
            retryable: true,
          },
        });
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => `key-${++issuedKeys}`,
    });
    await rehearsal.loadActive();

    await expect(rehearsal.generateNextStep()).resolves.toBe('unknown');
    await expect(rehearsal.reconcileStep()).resolves.toBe('aborted');
    await expect(rehearsal.generateNextStep()).resolves.toBe('failed');

    expect(keys).toEqual(['key-1', 'key-2']);
  });

  it('accepts an idempotent mutation replay with newer authoritative attempt truth', async () => {
    const original = runningAttempt(1, {
      currentStepRef: 'step-1',
      steps: [step('step-1', 'draft')],
    });
    const replayReceipt = {
      idempotencyKey: 'advanced-key',
      requestFingerprint: 'accept-fingerprint',
      resultingAttemptRevision: 2,
      resultRef: 'step-1',
      responseDigest: 'accept-response',
    };
    const advanced = runningAttempt(3, {
      selectedStepRefs: ['step-1'],
      selectedHeadRef: 'step-1',
      currentStepRef: 'step-2',
      steps: [
        step('step-1', 'selected'),
        step('step-2', 'draft'),
      ],
      mutationReceipts: [replayReceipt],
    });
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: original };
      },
      async acceptPlayRehearsalStep() {
        return {
          attempt: advanced,
          receipt: replayReceipt,
          replayed: true,
        };
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'advanced-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.acceptStep('step-1')).resolves.toBe('applied');

    expect(rehearsal.attempt.value).toMatchObject({
      attemptRevision: 3,
      selectedHeadRef: 'step-1',
      currentStepRef: 'step-2',
    });
    expect(rehearsal.currentStep.value?.id).toBe('step-2');
  });

  it('recovers Start through the single-active-attempt lookup after a lost response', async () => {
    const recovered = runningAttempt(0);
    const getActive = vi.fn(async () => ({ attempt: recovered }));
    const client = clientWith({
      async createPlayRehearsalAttempt() {
        throw new Error('response lost');
      },
      getActivePlayRehearsalAttempt: getActive,
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
    });

    await expect(rehearsal.startAttempt()).resolves.toBe('applied');

    expect(getActive).toHaveBeenCalledWith('session-1');
    expect(rehearsal.attempt.value).toMatchObject({
      id: 'attempt-1',
      status: 'running',
      attemptRevision: 0,
    });
    expect(rehearsal.announcement.value).toContain('recovered');
  });

  it('keeps Cancel attempt-local and never creates committed result truth', async () => {
    const active = runningAttempt(0);
    let cancelInput: Record<string, unknown> | undefined;
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: active };
      },
      async cancelPlayRehearsalAttempt(_sessionId, _attemptId, input) {
        cancelInput = input;
        return {
          attempt: { ...active, attemptRevision: 1, status: 'cancelled' },
          receipt: mutationReceipt(input.idempotencyKey, 1, 'attempt-1'),
          replayed: false,
        };
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'cancel-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.cancelAttempt()).resolves.toBe('applied');

    expect(cancelInput).toEqual({
      expectedAttemptRevision: 0,
      idempotencyKey: 'cancel-key',
    });
    expect(rehearsal.attempt.value?.status).toBe('cancelled');
    expect(rehearsal.committedResult.value).toBeUndefined();
    expect(rehearsal.announcement.value).toContain('no committed turn');
    expect(rehearsal.canStartAttempt.value).toBe(true);
  });

  it('accepts an authoritative Finish replay after attempt recovery was removed', async () => {
    const active = preparedAttempt(2, 'step-1');
    const client = clientWith({
      async getActivePlayRehearsalAttempt() {
        return { attempt: active };
      },
      async finishPlayRehearsalAttempt(_sessionId, _attemptId, input) {
        return {
          session: { id: 'session-1', revision: 5 },
          artifact: { id: 'turn-replayed' },
          evidence: { id: 'evidence-replayed' },
          receipt: {
            idempotencyKey: input.idempotencyKey,
            attemptRevision: 2,
          },
          replayed: true,
        };
      },
    });
    const rehearsal = usePlayRehearsalAttempt({
      client,
      sessionId: ref('session-1'),
      baseRevision: ref(4),
      createIdempotencyKey: () => 'finish-replay-key',
    });
    await rehearsal.loadActive();

    await expect(rehearsal.finishAttempt()).resolves.toBe('applied');

    expect(rehearsal.attempt.value).toBeUndefined();
    expect(rehearsal.committedResult.value).toMatchObject({
      replayed: true,
      artifact: { id: 'turn-replayed' },
      evidence: { id: 'evidence-replayed' },
    });
  });
});

function clientWith(overrides: Partial<TestClient>): TestClient {
  return {
    async getActivePlayRehearsalAttempt() {
      return { attempt: null };
    },
    async createPlayRehearsalAttempt() {
      return { attempt: runningAttempt(0) };
    },
    async getPlayRehearsalAttempt() {
      return { attempt: runningAttempt(0) };
    },
    async *streamNextPlayActorStep() {},
    async cancelPlayActorStep(_sessionId, _attemptId, runId) {
      return { status: 'aborted', runId };
    },
    async acceptPlayRehearsalStep() {
      throw new Error('Unexpected Accept.');
    },
    async finishPlayRehearsalAttempt() {
      throw new Error('Unexpected Finish.');
    },
    async cancelPlayRehearsalAttempt() {
      throw new Error('Unexpected Cancel.');
    },
    ...overrides,
  };
}

function runningAttempt(
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

function preparedAttempt(
  attemptRevision: number,
  selectedHeadRef: string,
): PlayRehearsalAttemptRecord {
  return runningAttempt(attemptRevision, {
    status: 'prepared',
    selectedStepRefs: [selectedHeadRef],
    selectedHeadRef,
    steps: [step(selectedHeadRef, 'selected')],
  });
}

function step(
  id: string,
  status: 'draft' | 'selected' | 'superseded' | 'discarded',
) {
  return {
    id,
    attemptId: 'attempt-1',
    participantRef: 'mara',
    status,
  };
}

function mutationReceipt(
  idempotencyKey: string,
  resultingAttemptRevision: number,
  resultRef: string,
) {
  return { idempotencyKey, resultingAttemptRevision, resultRef };
}

function requestError(status: number, message: string): Error & { status: number } {
  const error = Object.assign(new Error(message), { status });
  error.name = 'OanRequestError';
  return error;
}

type EventBase = Pick<
  PlayActorStepStreamEvent,
  'eventId' | 'sequence' | 'sessionId' | 'attemptId' | 'stepRunId'
>;

type EventPayload<T = PlayActorStepStreamEvent> = T extends EventBase
  ? Omit<T, keyof EventBase>
  : never;

function streamEvent(
  runId: string,
  sequence: number,
  value: EventPayload,
): PlayActorStepStreamEvent {
  return {
    ...value,
    eventId: `${runId}:${sequence}`,
    sequence,
    sessionId: 'session-1',
    attemptId: 'attempt-1',
    stepRunId: runId,
  } as PlayActorStepStreamEvent;
}
