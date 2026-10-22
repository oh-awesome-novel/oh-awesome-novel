// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlaySession,
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
  streamPlayWorldRefereeTurn: vi.fn(),
  cancelPlayWorldRefereeTurn: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';
import {
  combinePlaySteerText,
  createPlayFollowUpQueue,
  playFollowUpPauseForOutcome,
  playSourceDriftNeedsDecision,
} from '../../../apps/desktop-ui/src/composables/usePlayFollowUpQueue';
import { installLegacyPlayReadModelMocks } from './support/playReadModelMock';
import { shallowRef } from 'vue';

type TurnInput = {
  userText: string;
  actionKind?: string;
  baseRevision?: number;
  delivery?: string;
};

describe('Play follow-up queue helpers', () => {
  it('keeps the original action first when combining a steer', () => {
    expect(combinePlaySteerText(' Open the door ', ' quietly ')).toBe('Open the door\n\n补充：quietly');
  });

  it('maps turn outcomes to pause reasons', () => {
    expect(playFollowUpPauseForOutcome('committed', undefined)).toBeUndefined();
    expect(playFollowUpPauseForOutcome('cancelled', 'cancelled')).toBe('stopped');
    expect(playFollowUpPauseForOutcome('failed', 'conflict')).toBe('conflict');
    expect(playFollowUpPauseForOutcome('failed', 'failed')).toBe('failed');
    expect(playFollowUpPauseForOutcome('unknown', 'indeterminate')).toBe('unknown');
  });

  it('treats a drifted source without a decision as blocking', () => {
    const drifted = {
      overall: 'drifted' as const,
      items: [],
      availableDecisions: ['continueFrozen' as const],
    };
    expect(playSourceDriftNeedsDecision(drifted)).toBe(true);
    expect(playSourceDriftNeedsDecision({ ...drifted, activeResolution: 'Active decision: frozen' })).toBe(false);
    expect(playSourceDriftNeedsDecision({ ...drifted, overall: 'current' })).toBe(false);
  });

  it('keeps items bound to their session and moves within it', () => {
    const selected = shallowRef('a');
    const queue = createPlayFollowUpQueue(selected);
    const first = queue.enqueue({ sessionId: 'a', userText: 'one', actionKind: 'do' });
    queue.enqueue({ sessionId: 'b', userText: 'other', actionKind: 'do' });
    const second = queue.enqueue({ sessionId: 'a', userText: 'two', actionKind: 'say' });

    expect(queue.sessionItems.value.map((item) => item.userText)).toEqual(['one', 'two']);
    queue.move(second.id, -1);
    expect(queue.sessionItems.value.map((item) => item.userText)).toEqual(['two', 'one']);
    queue.edit(first.id, 'one edited');
    expect(queue.shift('a')?.userText).toBe('two');
    expect(queue.shift('a')?.userText).toBe('one edited');
    expect(queue.shift('a')).toBeUndefined();
    selected.value = 'b';
    expect(queue.sessionItems.value.map((item) => item.userText)).toEqual(['other']);
  });
});

describe('PlayWorkspace steer and follow-up', () => {
  let session: PlaySession;

  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    installLegacyPlayReadModelMocks(api);
    session = createSession(1);
    api.listPlaySessions.mockImplementation(async () => ({ sessions: [session] }));
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
  });

  it('cancels the running turn and resends the action with the steer at the same revision', async () => {
    const calls: TurnInput[] = [];
    const firstStreaming = deferred<void>();
    api.cancelPlayWorldRefereeTurn.mockResolvedValue({
      status: 'cancelled',
      committed: false,
      turnId: 'run-1',
    });
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* (
      _id: string,
      input: TurnInput,
      options?: PlayTurnStreamOptions,
    ) {
      calls.push(input);
      const turnId = `run-${calls.length}`;
      options?.onTurnId?.(turnId);
      yield startedEvent(turnId, input.baseRevision ?? 0);
      if (calls.length === 1) {
        firstStreaming.resolve();
        await abortedBy(options?.signal);
        return;
      }
      session = createSession(2);
      yield committedEvent(turnId, session);
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('.play-composer textarea').setValue('Open the door');
    await wrapper.get('.play-composer').trigger('submit');
    await firstStreaming.promise;
    await flushPromises();

    const textarea = wrapper.get<HTMLTextAreaElement>('.play-composer textarea');
    expect(textarea.element.disabled).toBe(false);
    await textarea.setValue('quietly');
    await wrapper.get('.play-steer-button').trigger('click');
    await flushPromises();
    await flushPromises();

    expect(api.cancelPlayWorldRefereeTurn).toHaveBeenCalledWith('play-1', 'run-1');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      userText: 'Open the door\n\n补充：quietly',
      baseRevision: 1,
      delivery: 'steer',
    });
    expect(calls[0]!.delivery).toBeUndefined();
    wrapper.unmount();
  });

  it('sends a queued action after the turn commits, using the new revision', async () => {
    const calls: TurnInput[] = [];
    const gate = deferred<void>();
    const firstStreaming = deferred<void>();
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* (
      _id: string,
      input: TurnInput,
      options?: PlayTurnStreamOptions,
    ) {
      calls.push(input);
      const turnId = `run-${calls.length}`;
      options?.onTurnId?.(turnId);
      yield startedEvent(turnId, input.baseRevision ?? 0);
      if (calls.length === 1) {
        firstStreaming.resolve();
        await gate.promise;
      }
      session = createSession((input.baseRevision ?? 0) + 1);
      yield committedEvent(turnId, session);
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('.play-composer textarea').setValue('Look around');
    await wrapper.get('.play-composer').trigger('submit');
    await firstStreaming.promise;
    await flushPromises();

    await wrapper.get('.play-composer textarea').setValue('Ask the guard');
    await wrapper.get('.play-composer').trigger('submit');
    await flushPromises();
    expect(wrapper.get('.play-follow-up-queue').text()).toContain('Ask the guard');
    expect(calls).toHaveLength(1);

    gate.resolve();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      userText: 'Ask the guard',
      baseRevision: 2,
      delivery: 'follow_up',
    });
    expect(wrapper.find('.play-follow-up-queue').exists()).toBe(false);
    wrapper.unmount();
  });

  it('pauses the queue and keeps the failed action when the turn is not committed', async () => {
    const calls: TurnInput[] = [];
    const gate = deferred<void>();
    const firstStreaming = deferred<void>();
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* (
      _id: string,
      input: TurnInput,
      options?: PlayTurnStreamOptions,
    ) {
      calls.push(input);
      options?.onTurnId?.('run-1');
      yield startedEvent('run-1', input.baseRevision ?? 0);
      firstStreaming.resolve();
      await gate.promise;
      yield failedEvent('run-1');
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('.play-composer textarea').setValue('Look around');
    await wrapper.get('.play-composer').trigger('submit');
    await firstStreaming.promise;
    await flushPromises();
    await wrapper.get('.play-composer textarea').setValue('Ask the guard');
    await wrapper.get('.play-composer').trigger('submit');
    gate.resolve();
    await flushPromises();
    await flushPromises();

    expect(calls).toHaveLength(1);
    const queue = wrapper.get('.play-follow-up-queue');
    expect(queue.text()).toContain('Ask the guard');
    expect(queue.text()).toContain('排队的行动已暂停');
    expect(wrapper.get<HTMLTextAreaElement>('.play-composer textarea').element.value).toBe('Look around');
    expect(wrapper.find('.play-follow-up-resume').exists()).toBe(true);
    wrapper.unmount();
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

function createSession(revision: number): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Station',
    createdAt: '2026-07-15T00:00:00.000Z',
    revision,
    sceneStart: 'Rain hits the roof.',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
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

function startedEvent(turnId: string, baseRevision: number): PlayTurnStreamEvent {
  return {
    type: 'play.turn.started',
    eventId: `${turnId}:1`,
    sequence: 1,
    sessionId: 'play-1',
    turnId,
    baseRevision,
    expectedArtifactId: `artifact-${turnId}`,
  };
}

function committedEvent(turnId: string, committed: PlaySession): PlayTurnStreamEvent {
  return {
    type: 'play.turn.committed',
    eventId: `${turnId}:2`,
    sequence: 2,
    sessionId: 'play-1',
    turnId,
    artifactId: `artifact-${turnId}`,
    revision: committed.revision,
    session: committed,
  };
}

function failedEvent(turnId: string): PlayTurnStreamEvent {
  return {
    type: 'play.turn.failed',
    eventId: `${turnId}:2`,
    sequence: 2,
    sessionId: 'play-1',
    turnId,
    error: { code: 'invalid_settlement', message: 'Settlement failed.', retryable: true },
  };
}

function abortedBy(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
