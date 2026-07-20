// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlayCheckpointSummary,
  PlaySession,
  PlayTurnArtifact,
  PlayTurnStreamEvent,
  PlayTurnStreamOptions,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  listPlaySessions: vi.fn(),
  listPlaySessionSummaries: vi.fn(),
  getPlaySession: vi.fn(),
  getPlaySessionDetail: vi.fn(),
  listPlayContextTraces: vi.fn(),
  getPlaySourceDrift: vi.fn(),
  listPlayCheckpoints: vi.fn(),
  retryPlayWorldRefereeTurn: vi.fn(),
  cancelPlayWorldRefereeTurn: vi.fn(),
  restorePlayCheckpoint: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';
import { installLegacyPlayReadModelMocks } from './support/playReadModelMock';

describe('PlayWorkspace Retry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    installLegacyPlayReadModelMocks(api);
    api.cancelPlayWorldRefereeTurn.mockResolvedValue({
      status: 'cancelled',
      committed: false,
      turnId: 'retry-run-1',
    });
  });

  it('shows the exact before-turn projection and restores current truth after failure', async () => {
    const session = createSession();
    const gate = deferred<void>();
    const streamStarted = deferred<void>();
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });
    api.listPlayCheckpoints.mockResolvedValue({
      checkpoints: [createCheckpoint('turn-source', 'current', session.revision)],
    });
    api.retryPlayWorldRefereeTurn.mockImplementation(
      async function* (
        _sessionId: string,
        _artifactId: string,
        _input: { baseRevision: number },
        options?: PlayTurnStreamOptions,
      ) {
        options?.onTurnId?.('retry-run-1');
        yield retryStartedEvent();
        yield retryDeltaEvent('A different answer begins.');
        streamStarted.resolve();
        await gate.promise;
        yield retryFailedEvent();
      },
    );
    const wrapper = mountWorkspace();
    await flushPromises();

    await startRetry(wrapper);
    await streamStarted.promise;
    await flushPromises();

    const activeTranscript = wrapper.get('.play-transcript').text();
    expect(activeTranscript).toContain('Root result');
    expect(activeTranscript).not.toContain('Old source result');
    expect(activeTranscript).toContain('Source action');
    expect(activeTranscript).toContain('Retry · provisional · not committed');
    expect(wrapper.get('.play-history-status').text()).toContain(
      'existing result remains a variant',
    );

    expect(api.retryPlayWorldRefereeTurn).toHaveBeenCalledWith(
      'play-1',
      'turn-source',
      { baseRevision: 2 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    gate.resolve();
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('.play-transcript').text()).toContain('Old source result');
    expect(wrapper.find('.play-turn-failed').exists()).toBe(true);
    expect(wrapper.get('.play-retry-source').text()).toContain('Old result preserved');
    expect(wrapper.get('[role="alert"]').text()).toContain('Retry settlement failed');
    wrapper.unmount();
  });

  it('replaces the projection with the authoritative sibling after commit', async () => {
    const session = createSession();
    const committedSession = createCommittedSiblingSession(session);
    const gate = deferred<void>();
    const streamStarted = deferred<void>();
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });
    api.listPlayCheckpoints.mockResolvedValue({
      checkpoints: [createCheckpoint('turn-source', 'current', session.revision)],
    });
    api.retryPlayWorldRefereeTurn.mockImplementation(
      async function* (
        _sessionId: string,
        _artifactId: string,
        _input: { baseRevision: number },
        options?: PlayTurnStreamOptions,
      ) {
        options?.onTurnId?.('retry-run-1');
        yield retryStartedEvent();
        yield retryDeltaEvent('Sibling result begins.');
        streamStarted.resolve();
        await gate.promise;
        yield {
          type: 'play.turn.committed',
          eventId: 'retry-run-1:3',
          sequence: 3,
          sessionId: 'play-1',
          turnId: 'retry-run-1',
          artifactId: 'turn-sibling',
          revision: 3,
          session: committedSession,
        } satisfies PlayTurnStreamEvent;
      },
    );
    const wrapper = mountWorkspace();
    await flushPromises();

    await startRetry(wrapper);
    await streamStarted.promise;
    api.listPlaySessions.mockResolvedValue({ sessions: [committedSession] });
    gate.resolve();
    await flushPromises();
    await flushPromises();

    const transcript = wrapper.get('.play-transcript').text();
    expect(transcript).toContain('New sibling result');
    expect(transcript).not.toContain('Old source result');
    expect(wrapper.find('.play-retry-source').exists()).toBe(false);
    expect(wrapper.text()).toContain('Session revision 3');
    wrapper.unmount();
  });

  it('keeps mutations locked but allows Refresh to recover indeterminate truth', async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      let statusAvailable = false;
      api.listPlaySessions.mockResolvedValue({ sessions: [session] });
      api.listPlayCheckpoints.mockResolvedValue({
        checkpoints: [createCheckpoint('turn-source', 'current', session.revision)],
      });
      api.retryPlayWorldRefereeTurn.mockImplementation(
        async function* (
          _sessionId: string,
          _artifactId: string,
          _input: { baseRevision: number },
          options?: PlayTurnStreamOptions,
        ) {
          options?.onTurnId?.('retry-run-1');
          throw new Error('retry stream disconnected');
        },
      );
      api.cancelPlayWorldRefereeTurn.mockImplementation(async () => {
        if (!statusAvailable) {
          throw new Error('status transport unavailable');
        }
        return {
          status: 'cancelled',
          committed: false,
          turnId: 'retry-run-1',
        };
      });
      const wrapper = mountWorkspace();
      await flushPromises();

      await startRetry(wrapper);
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(wrapper.find('.play-turn-indeterminate').exists()).toBe(true);
      expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeDefined();
      const refresh = wrapper.get<HTMLButtonElement>(
        '.play-workspace-status button[aria-label="刷新 Play workspace"]',
      );
      expect(refresh.element.disabled).toBe(false);

      statusAvailable = true;
      const listCallsBeforeRefresh = api.listPlaySessionSummaries.mock.calls.length;
      await refresh.trigger('click');
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(api.listPlaySessionSummaries).toHaveBeenCalledTimes(
        listCallsBeforeRefresh + 1,
      );
      expect(wrapper.find('.play-turn-indeterminate').exists()).toBe(false);
      expect(wrapper.get('.play-composer textarea').attributes('disabled')).toBeUndefined();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

function mountWorkspace() {
  const workspace: WorkspaceSummary = {
    name: 'alpha',
    novelName: 'Alpha',
    path: '/novels/alpha',
    valid: true,
  };
  return mount(PlayWorkspace, {
    attachTo: document.body,
    props: { workspace, providerConfigured: true },
  });
}

async function startRetry(wrapper: ReturnType<typeof mountWorkspace>) {
  await wrapper.get(
    '.play-history-retry[data-artifact-id="turn-source"]',
  ).trigger('click');
  await flushPromises();
  await wrapper.get('.play-history-confirm').trigger('click');
}

function createSession(): PlaySession {
  const root = createArtifact('turn-root', undefined, 'Root', {
    location: 'hall',
  });
  const source = createArtifact('turn-source', 'turn-root', 'Source', {
    location: 'vault',
  });
  return createSessionEnvelope(
    [root, source],
    ['turn-root', 'turn-source'],
    2,
  );
}

function createCommittedSiblingSession(session: PlaySession): PlaySession {
  const sibling = createArtifact('turn-sibling', 'turn-root', 'New sibling', {
    location: 'tower',
  });
  sibling.revision = 3;
  return {
    ...session,
    revision: 3,
    turnArtifacts: [...session.turnArtifacts, sibling],
    selectedTurnIds: ['turn-root', 'turn-sibling'],
    transcript: [
      ...session.turnArtifacts[0]!.messages,
      ...sibling.messages,
    ],
    playLocalState: { location: 'tower' },
    worldClock: { turn: 2, revision: 3 },
  };
}

function createSessionEnvelope(
  turnArtifacts: PlayTurnArtifact[],
  selectedTurnIds: string[],
  revision: number,
): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Station',
    createdAt: '2026-07-15T00:00:00.000Z',
    revision,
    sceneStart: 'Rain hits the roof.',
    characters: [],
    transcript: selectedTurnIds.flatMap((id) =>
      turnArtifacts.find((artifact) => artifact.id === id)?.messages ?? [],
    ),
    turnArtifacts,
    selectedTurnIds,
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: { location: 'platform' },
      playLocalStateVisibility: { location: 'playerVisible' },
      scheduledEvents: [],
      suggestedActions: ['Listen'],
    },
    metadataExtensions: {},
    playLocalState: { location: 'vault' },
    playLocalStateVisibility: { location: 'playerVisible' },
    worldClock: { turn: 2, revision },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [],
    scheduledEvents: [],
    suggestedActions: ['Wait'],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}

function createArtifact(
  id: string,
  parentTurnId: string | undefined,
  label: string,
  state: Record<string, unknown>,
): PlayTurnArtifact {
  const revision = parentTurnId ? 2 : 1;
  return {
    schemaVersion: 2,
    artifactKind: 'worldSettlement',
    branchSnapshotVersion: 1,
    id,
    revision,
    parentTurnId,
    input: { kind: 'do', raw: `${label} action` },
    messages: [
      {
        id: `${id}-user`,
        speaker: 'user',
        content: `${label} action`,
        createdAt: '2026-07-15T00:00:00.000Z',
      },
      {
        id: `${id}-assistant`,
        speaker: 'world-referee',
        content: label === 'Source' ? 'Old source result' : `${label} result`,
        createdAt: '2026-07-15T00:00:01.000Z',
      },
    ],
    worldClock: { turn: revision, revision },
    eventIds: [],
    dueScheduledEventIds: [],
    scheduledEventIds: [],
    scheduledEventSnapshots: [],
    playLocalStateSnapshot: state,
    playLocalStateVisibilitySnapshot: { location: 'playerVisible' },
    observationIds: [],
    stateDelta: state,
    suggestedActions: ['Continue'],
    committedAt: '2026-07-15T00:00:02.000Z',
    canonical: false,
  };
}

function createCheckpoint(
  artifactId: string,
  status: PlayCheckpointSummary['status'],
  revision: number,
): PlayCheckpointSummary {
  return {
    artifactId,
    parentArtifactId: 'turn-root',
    selectedTurnIds: ['turn-root', artifactId],
    revision,
    worldTurn: revision,
    committedAt: '2026-07-15T00:00:02.000Z',
    preview: 'Old source result',
    status,
    restorable: false,
    retryable: true,
    canonical: false,
  };
}

function retryStartedEvent(): PlayTurnStreamEvent {
  return {
    type: 'play.turn.started',
    eventId: 'retry-run-1:1',
    sequence: 1,
    sessionId: 'play-1',
    turnId: 'retry-run-1',
    baseRevision: 2,
    expectedArtifactId: 'turn-sibling',
    retry: {
      sourceArtifactId: 'turn-source',
      parentArtifactId: 'turn-root',
    },
  };
}

function retryDeltaEvent(delta: string): PlayTurnStreamEvent {
  return {
    type: 'play.narrative.delta',
    eventId: 'retry-run-1:2',
    sequence: 2,
    sessionId: 'play-1',
    turnId: 'retry-run-1',
    delta,
    provisional: true,
  };
}

function retryFailedEvent(): PlayTurnStreamEvent {
  return {
    type: 'play.turn.failed',
    eventId: 'retry-run-1:3',
    sequence: 3,
    sessionId: 'play-1',
    turnId: 'retry-run-1',
    error: {
      code: 'invalid_settlement',
      message: 'Retry settlement failed.',
      retryable: true,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
