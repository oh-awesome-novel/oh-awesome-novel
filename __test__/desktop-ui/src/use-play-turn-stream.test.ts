import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type {
  PlaySession,
  PlayTurnCancelResult,
  PlayTurnStreamEvent,
} from '@oh-awesome-novel/client';
import {
  usePlayTurnStream,
  type PlayTurnStreamClient,
} from '../../../apps/desktop-ui/src/composables/usePlayTurnStream';

describe('usePlayTurnStream', () => {
  it('keeps deltas provisional and applies a committed session exactly once', async () => {
    const committedSession = createSession(1);
    const onCommitted = vi.fn();
    const stream = vi.fn(async function* () {
      yield startedEvent();
      yield deltaEvent('雨声靠近。');
      yield deltaEvent('duplicate ignored');
      yield committedEvent(committedSession);
      yield { ...deltaEvent('late delta'), eventId: 'run-1:4', sequence: 4 };
    });
    const client = createClient(stream);
    const flow = usePlayTurnStream({ client, onCommitted });

    const outcome = await flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
      timeAdvance: { amount: 1, unit: 'hour' },
    });

    expect(outcome).toBe('committed');
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledWith(committedSession);
    expect(stream).toHaveBeenCalledWith(
      'play-1',
      {
        userText: '等待',
        actionKind: 'wait',
        timeAdvance: { amount: 1, unit: 'hour' },
        baseRevision: 0,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(flow.run.value).toBeUndefined();
  });

  it('removes provisional text when the server rejects the turn', async () => {
    const client = createClient(async function* () {
      yield startedEvent();
      yield deltaEvent('Provisional text that must not survive validation.');
      yield failedEvent();
    });
    const flow = usePlayTurnStream({ client, onCommitted: vi.fn() });

    await expect(flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    })).resolves.toBe('failed');

    expect(flow.run.value).toMatchObject({
      phase: 'failed',
      provisionalText: '',
      statusMessage: 'Turn not committed',
    });
  });

  it('waits for server cancellation and never promotes provisional text', async () => {
    let releaseCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const onCommitted = vi.fn();
    const client = createClient(
      async function* () {
        yield startedEvent();
        markStarted?.();
        yield deltaEvent('尚未提交的正文');
        await cancellation;
        yield cancelledEvent();
      },
      async () => {
        releaseCancellation?.();
        return { status: 'cancelling', committed: false, turnId: 'run-1' };
      },
    );
    const flow = usePlayTurnStream({ client, onCommitted });
    const submit = flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    });
    await started;

    await flow.stop();
    await expect(submit).resolves.toBe('cancelled');

    expect(onCommitted).not.toHaveBeenCalled();
    expect(flow.run.value).toMatchObject({
      phase: 'cancelled',
      provisionalText: '尚未提交的正文',
      statusMessage: expect.stringContaining('not committed'),
    });
  });

  it('accepts committed server truth when stop loses the commit race', async () => {
    const committedSession = createSession(1);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const onCommitted = vi.fn();
    const client = createClient(
      async function* (_id, _input, options) {
        yield startedEvent();
        markStarted?.();
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      async () => ({
        status: 'committed',
        committed: true,
        turnId: 'run-1',
        session: committedSession,
      }),
    );
    const flow = usePlayTurnStream({ client, onCommitted });
    const submit = flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    });
    await started;

    await flow.stop();
    await expect(submit).resolves.toBe('committed');

    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledWith(committedSession);
  });

  it('polls a half-open stream after Stop reports that commit already started', async () => {
    const committedSession = createSession(1);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let statusCalls = 0;
    const client = createClient(
      async function* (_id, _input, options) {
        yield startedEvent();
        markStarted?.();
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      async () => {
        statusCalls += 1;
        return statusCalls === 1
          ? {
              status: 'committing',
              committed: false,
              tooLateToCancel: true,
              turnId: 'run-1',
            }
          : {
              status: 'committed',
              committed: true,
              turnId: 'run-1',
              session: committedSession,
            };
      },
    );
    const onCommitted = vi.fn();
    const flow = usePlayTurnStream({ client, onCommitted });
    const submit = flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    });
    await started;

    await flow.stop();
    await expect(submit).resolves.toBe('committed');
    expect(statusCalls).toBe(2);
    expect(onCommitted).toHaveBeenCalledWith(committedSession);
  });

  it('keeps a terminal cancellation monotonic when the stop request fails late', async () => {
    let releaseTerminal: (() => void) | undefined;
    const terminalGate = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let markTerminalApplied: (() => void) | undefined;
    const terminalApplied = new Promise<void>((resolve) => {
      markTerminalApplied = resolve;
    });
    let rejectStop: ((error: Error) => void) | undefined;
    const stopResponse = new Promise<PlayTurnCancelResult>((_resolve, reject) => {
      rejectStop = reject;
    });
    const client = createClient(
      async function* () {
        yield startedEvent();
        markStarted?.();
        await terminalGate;
        yield cancelledEvent();
        markTerminalApplied?.();
      },
      async () => stopResponse,
    );
    const flow = usePlayTurnStream({ client, onCommitted: vi.fn() });
    const submit = flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    });
    await started;

    const stop = flow.stop();
    releaseTerminal?.();
    await terminalApplied;
    rejectStop?.(new Error('late stop transport error'));

    await stop;
    await expect(submit).resolves.toBe('cancelled');
    expect(flow.run.value).toMatchObject({ phase: 'cancelled' });
    expect(flow.busy.value).toBe(false);
  });

  it('does not let late stream progress resurrect a stop requested before the first event', async () => {
    let markHeaderReady: (() => void) | undefined;
    const headerReady = new Promise<void>((resolve) => {
      markHeaderReady = resolve;
    });
    let releaseProgress: (() => void) | undefined;
    const progressGate = new Promise<void>((resolve) => {
      releaseProgress = resolve;
    });
    let markProgressApplied: (() => void) | undefined;
    const progressApplied = new Promise<void>((resolve) => {
      markProgressApplied = resolve;
    });
    let releaseCancelResponse: (() => void) | undefined;
    const cancelResponseGate = new Promise<void>((resolve) => {
      releaseCancelResponse = resolve;
    });
    let releaseTerminal: (() => void) | undefined;
    const terminalGate = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    const client = createClient(
      async function* (_id, _input, options) {
        options?.onTurnId?.('run-1');
        markHeaderReady?.();
        await progressGate;
        yield startedEvent();
        yield deltaEvent('取消确认前到达的 provisional');
        markProgressApplied?.();
        await terminalGate;
        yield cancelledEvent();
      },
      async () => {
        await cancelResponseGate;
        return { status: 'cancelling', committed: false, turnId: 'run-1' };
      },
    );
    const flow = usePlayTurnStream({ client, onCommitted: vi.fn() });
    const submit = flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    });
    await headerReady;
    expect(flow.canStop.value).toBe(true);

    const stop = flow.stop();
    releaseProgress?.();
    await progressApplied;

    expect(flow.run.value).toMatchObject({
      phase: 'stopping',
      provisionalText: '取消确认前到达的 provisional',
    });

    releaseCancelResponse?.();
    releaseTerminal?.();
    await stop;
    await expect(submit).resolves.toBe('cancelled');
  });

  it('keeps the active lock until a terminal stream iterator actually closes', async () => {
    const committedSession = createSession(1);
    let releaseFirstStream: (() => void) | undefined;
    const firstStreamGate = new Promise<void>((resolve) => {
      releaseFirstStream = resolve;
    });
    let markCommittedApplied: (() => void) | undefined;
    const committedApplied = new Promise<void>((resolve) => {
      markCommittedApplied = resolve;
    });
    let streamCall = 0;
    const client = createClient(async function* () {
      streamCall += 1;
      const turnId = `run-${streamCall}`;
      yield { ...startedEvent(), turnId, eventId: `${turnId}:1` };
      yield {
        ...committedEvent(createSession(streamCall)),
        turnId,
        eventId: `${turnId}:2`,
        sequence: 2,
      };
      if (streamCall === 1) {
        markCommittedApplied?.();
        await firstStreamGate;
      }
    });
    const onCommitted = vi.fn();
    const flow = usePlayTurnStream({ client, onCommitted });
    const input = {
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait' as const,
    };
    const first = flow.submit(input);
    await committedApplied;

    expect(flow.busy.value).toBe(true);
    await expect(flow.submit(input)).resolves.toBe('ignored');

    releaseFirstStream?.();
    await expect(first).resolves.toBe('committed');
    expect(flow.busy.value).toBe(false);
    await expect(flow.submit({ ...input, baseRevision: 1 })).resolves.toBe('committed');
    expect(onCommitted).toHaveBeenCalledTimes(2);
  });

  it('reconciles server truth when the stream drops during the commit barrier', async () => {
    const committedSession = createSession(1);
    let cancellationCalls = 0;
    const client = createClient(
      async function* () {
        yield startedEvent();
        yield {
          type: 'play.turn.prepared',
          eventId: 'run-1:2',
          sequence: 2,
          sessionId: 'play-1',
          turnId: 'run-1',
          baseRevision: 0,
          targetRevision: 1,
          artifactId: 'turn-artifact-1',
        };
        throw new Error('connection lost after prepare');
      },
      async () => {
        cancellationCalls += 1;
        return cancellationCalls === 1
          ? {
              status: 'committing',
              committed: false,
              tooLateToCancel: true,
              turnId: 'run-1',
            }
          : {
              status: 'committed',
              committed: true,
              turnId: 'run-1',
              session: committedSession,
            };
      },
    );
    const onCommitted = vi.fn();
    const flow = usePlayTurnStream({ client, onCommitted });

    await expect(flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    })).resolves.toBe('committed');

    expect(cancellationCalls).toBe(2);
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(flow.announcement.value).toBe('Play turn committed.');
    expect(flow.run.value).toBeUndefined();
  });

  it('uses the response turn id to reconcile a disconnect before the first SSE event', async () => {
    const committedSession = createSession(1);
    const onCommitted = vi.fn();
    const client = createClient(
      async function* (_id, _input, options) {
        options?.onTurnId?.('run-1');
        throw new Error('connection lost before started event');
      },
      async () => ({
        status: 'committed',
        committed: true,
        turnId: 'run-1',
        session: committedSession,
      }),
    );
    const flow = usePlayTurnStream({ client, onCommitted });

    await expect(flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    })).resolves.toBe('committed');

    expect(onCommitted).toHaveBeenCalledWith(committedSession);
    expect(flow.announcement.value).toBe('Play turn committed.');
  });

  it('keeps reconciling while the reachable server remains inside the commit barrier', async () => {
    vi.useFakeTimers();
    try {
      const committedSession = createSession(1);
      let cancellationCalls = 0;
      const client = createClient(
        async function* (_id, _input, options) {
          options?.onTurnId?.('run-1');
          throw new Error('stream disconnected');
        },
        async () => {
          cancellationCalls += 1;
          return cancellationCalls <= 8
            ? {
                status: 'committing',
                committed: false,
                tooLateToCancel: true,
                turnId: 'run-1',
              }
            : {
                status: 'committed',
                committed: true,
                turnId: 'run-1',
                session: committedSession,
              };
        },
      );
      const onCommitted = vi.fn();
      const flow = usePlayTurnStream({ client, onCommitted });
      const submit = flow.submit({
        sessionId: 'play-1',
        baseRevision: 0,
        userText: '等待',
        actionKind: 'wait',
      });

      await vi.runAllTimersAsync();

      await expect(submit).resolves.toBe('committed');
      expect(cancellationCalls).toBe(9);
      expect(onCommitted).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an indeterminate outcome instead of claiming no commit after status transport loss', async () => {
    vi.useFakeTimers();
    try {
      const client = createClient(
        async function* (_id, _input, options) {
          options?.onTurnId?.('run-1');
          throw new Error('stream disconnected');
        },
        async () => {
          throw new Error('status transport unavailable');
        },
      );
      const flow = usePlayTurnStream({ client, onCommitted: vi.fn() });
      const submit = flow.submit({
        sessionId: 'play-1',
        baseRevision: 0,
        userText: '等待',
        actionKind: 'wait',
      });

      await vi.runAllTimersAsync();

      await expect(submit).resolves.toBe('unknown');
      expect(flow.run.value).toMatchObject({
        phase: 'indeterminate',
        statusMessage: expect.stringContaining('outcome unknown'),
      });
      expect(flow.run.value?.statusMessage).not.toContain('not committed');
      expect(flow.busy.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles an indeterminate run when the user explicitly refreshes truth', async () => {
    vi.useFakeTimers();
    try {
      let statusAvailable = false;
      const client = createClient(
        async function* (_id, _input, options) {
          options?.onTurnId?.('run-1');
          throw new Error('stream disconnected');
        },
        async () => {
          if (!statusAvailable) {
            throw new Error('status transport unavailable');
          }
          return {
            status: 'cancelled',
            committed: false,
            turnId: 'run-1',
          };
        },
      );
      const flow = usePlayTurnStream({ client, onCommitted: vi.fn() });
      const submit = flow.submit({
        sessionId: 'play-1',
        baseRevision: 0,
        userText: '等待',
        actionKind: 'wait',
      });

      await vi.runAllTimersAsync();
      await expect(submit).resolves.toBe('unknown');
      expect(flow.run.value?.phase).toBe('indeterminate');

      statusAvailable = true;
      const reconcile = flow.reconcile();
      await vi.runAllTimersAsync();

      await expect(reconcile).resolves.toBe('cancelled');
      expect(flow.run.value?.phase).toBe('cancelled');
      expect(flow.busy.value).toBe(false);

      flow.clearTerminalRun();
      expect(flow.run.value).toBeUndefined();
      expect(flow.announcement.value).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs Retry through the same provisional, cancellation, and commit state machine', async () => {
    const committedSession = createSession(1);
    let releaseCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const submitStream = vi.fn(async function* () {
      throw new Error('ordinary submit must not be opened for Retry');
    });
    const retryStream = vi.fn(async function* (
      _id: string,
      _artifactId: string,
      _input: { baseRevision: number },
      options?: Parameters<PlayTurnStreamClient['retryPlayWorldRefereeTurn']>[3],
    ) {
      options?.onTurnId?.('retry-run-1');
      yield {
        ...startedEvent(),
        eventId: 'retry-run-1:1',
        turnId: 'retry-run-1',
        expectedArtifactId: 'turn-artifact-2',
        retry: {
          sourceArtifactId: 'turn-artifact-1',
          parentArtifactId: 'turn-artifact-root',
        },
      } satisfies PlayTurnStreamEvent;
      yield {
        ...deltaEvent('新的分支结果'),
        eventId: 'retry-run-1:2',
        turnId: 'retry-run-1',
      } satisfies PlayTurnStreamEvent;
      markStarted?.();
      await commitGate;
      yield {
        ...committedEvent(committedSession),
        eventId: 'retry-run-1:3',
        turnId: 'retry-run-1',
        artifactId: 'turn-artifact-2',
      } satisfies PlayTurnStreamEvent;
    });
    const client = createClient(submitStream, undefined, retryStream);
    const onCommitted = vi.fn();
    const flow = usePlayTurnStream({ client, onCommitted });

    const retry = flow.retry({
      sessionId: 'play-1',
      artifactId: 'turn-artifact-1',
      baseRevision: 0,
      userText: '等待',
      actionKind: 'wait',
    });
    await started;

    expect(submitStream).not.toHaveBeenCalled();
    expect(retryStream).toHaveBeenCalledWith(
      'play-1',
      'turn-artifact-1',
      { baseRevision: 0 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(flow.run.value).toMatchObject({
      intent: 'retry',
      retrySourceArtifactId: 'turn-artifact-1',
      retryParentArtifactId: 'turn-artifact-root',
      phase: 'streaming',
      provisionalText: '新的分支结果',
      statusMessage: 'Retry streaming · not committed',
    });
    await expect(flow.submit({
      sessionId: 'play-1',
      baseRevision: 0,
      userText: '另一个动作',
      actionKind: 'do',
    })).resolves.toBe('ignored');

    releaseCommit?.();
    await expect(retry).resolves.toBe('committed');
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledWith(committedSession);
    expect(flow.run.value).toBeUndefined();
  });

  it('keeps touched Play components on the neutral shared design tokens', async () => {
    const componentUrls = [
      '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue',
      '../../../apps/desktop-ui/src/components/play/PlayTranscript.vue',
      '../../../apps/desktop-ui/src/components/play/PlayComposer.vue',
      '../../../apps/desktop-ui/src/components/play/PlayTimeAdvanceControl.vue',
      '../../../apps/desktop-ui/src/components/play/PlaySessionRail.vue',
      '../../../apps/desktop-ui/src/components/play/PlaySessionCreateForm.vue',
      '../../../apps/desktop-ui/src/components/play/PlayHistoryControls.vue',
      '../../../apps/desktop-ui/src/components/play/PlayWorldHud.vue',
      '../../../apps/desktop-ui/src/components/play/PlayWorldMomentum.vue',
      '../../../apps/desktop-ui/src/components/play/PlayEventFeed.vue',
      '../../../apps/desktop-ui/src/components/play/PlayAdoptionPanel.vue',
      '../../../apps/desktop-ui/src/components/play/PlayAdoptionDraftForm.vue',
      '../../../apps/desktop-ui/src/components/play/play-design.css',
    ].map((path) => new URL(path, import.meta.url));
    const source = (await Promise.all(componentUrls.map((url) =>
      readFile(fileURLToPath(url), 'utf-8'),
    ))).join('\n');

    expect(source).not.toMatch(/Georgia|Times New Roman|linear-gradient/iu);
    expect(source).not.toMatch(/rgb\(180 83 9|rgb\(217 119 6|rgb\(255 252 247/iu);
    expect(source).toContain('{{ announcement }}');
    expect(source).toContain(':busy="interactionBlocked"');
    expect(source).toContain('<PlayHistoryControls');
    expect(source).toContain(':disabled="disabled || Boolean(busyCandidateId)"');
  });
});

function createClient(
  stream: PlayTurnStreamClient['streamPlayWorldRefereeTurn'],
  cancel: PlayTurnStreamClient['cancelPlayWorldRefereeTurn'] = async () => ({
    status: 'cancelled',
    committed: false,
    turnId: 'run-1',
  }),
  retry: PlayTurnStreamClient['retryPlayWorldRefereeTurn'] = async function* () {
    throw new Error('Retry stream was not configured for this test.');
  },
): PlayTurnStreamClient {
  return {
    streamPlayWorldRefereeTurn: stream,
    retryPlayWorldRefereeTurn: retry,
    cancelPlayWorldRefereeTurn: cancel,
  };
}

function startedEvent(): PlayTurnStreamEvent {
  return {
    type: 'play.turn.started',
    eventId: 'run-1:1',
    sequence: 1,
    sessionId: 'play-1',
    turnId: 'run-1',
    baseRevision: 0,
    expectedArtifactId: 'turn-artifact-1',
  };
}

function deltaEvent(delta: string): PlayTurnStreamEvent {
  return {
    type: 'play.narrative.delta',
    eventId: 'run-1:2',
    sequence: 2,
    sessionId: 'play-1',
    turnId: 'run-1',
    delta,
    provisional: true,
  };
}

function committedEvent(session: PlaySession): PlayTurnStreamEvent {
  return {
    type: 'play.turn.committed',
    eventId: 'run-1:3',
    sequence: 3,
    sessionId: 'play-1',
    turnId: 'run-1',
    artifactId: 'turn-artifact-1',
    revision: 1,
    session,
  };
}

function cancelledEvent(): PlayTurnStreamEvent {
  return {
    type: 'play.turn.cancelled',
    eventId: 'run-1:3',
    sequence: 3,
    sessionId: 'play-1',
    turnId: 'run-1',
    committed: false,
    revision: 0,
    reason: 'user',
  };
}

function failedEvent(): PlayTurnStreamEvent {
  return {
    type: 'play.turn.failed',
    eventId: 'run-1:3',
    sequence: 3,
    sessionId: 'play-1',
    turnId: 'run-1',
    error: {
      code: 'invalid_settlement',
      message: 'Settlement validation failed.',
      retryable: true,
    },
  };
}

function createSession(revision: number): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Play',
    createdAt: '2026-07-14T00:00:00.000Z',
    revision,
    sceneStart: 'Station',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: revision,
    branchBaseSnapshot: {
      worldClock: { turn: revision, revision },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock: { turn: revision, revision },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [],
    scheduledEvents: [],
    suggestedActions: [],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}
