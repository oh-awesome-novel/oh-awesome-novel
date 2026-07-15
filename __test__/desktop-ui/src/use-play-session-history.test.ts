import { flushPromises } from '@vue/test-utils';
import {
  computed,
  effectScope,
  nextTick,
  shallowRef,
} from 'vue';
import { describe, expect, it, vi } from 'vitest';

import {
  usePlaySessionHistory,
} from '../../../apps/desktop-ui/src/composables/usePlaySessionHistory';
import type {
  PlaySessionHistoryClient,
} from '../../../apps/desktop-ui/src/composables/usePlaySessionHistory';
import type {
  PlayCheckpointSummary,
  PlaySession,
} from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';

describe('usePlaySessionHistory', () => {
  it('loads checkpoints again when the selected session revision changes', async () => {
    const first = createCheckpoint('turn-1', 'current', false, 1);
    const second = createCheckpoint('turn-2', 'current', false, 2);
    let resolveSecondLoad: ((value: { checkpoints: PlayCheckpointSummary[] }) => void) | undefined;
    const secondLoad = new Promise<{ checkpoints: PlayCheckpointSummary[] }>((resolve) => {
      resolveSecondLoad = resolve;
    });
    const listPlayCheckpoints = vi.fn()
      .mockResolvedValueOnce({ checkpoints: [first] })
      .mockReturnValueOnce(secondLoad);
    const selected = shallowRef<PlaySession | undefined>(createSession(1));
    const scope = effectScope();
    const history = scope.run(() => usePlaySessionHistory({
      client: createClient({ listPlayCheckpoints }),
      selectedSession: computed(() => selected.value),
      blocked: computed(() => false),
      onRestored: vi.fn(),
      onError: vi.fn(),
    }));

    await flushPromises();
    expect(history?.checkpoints.value).toEqual([first]);

    selected.value = createSession(2);
    await nextTick();

    expect(history?.checkpoints.value).toEqual([]);
    resolveSecondLoad?.({ checkpoints: [second] });
    await flushPromises();

    expect(listPlayCheckpoints).toHaveBeenCalledTimes(2);
    expect(history?.checkpoints.value).toEqual([second]);
    scope.stop();
  });

  it('restores with mandatory baseRevision and adopts the authoritative session', async () => {
    const restorable = createCheckpoint('turn-1', 'selectedAncestor', true, 1);
    const restoredCurrent = createCheckpoint('turn-1', 'current', false, 3);
    const selected = shallowRef<PlaySession | undefined>(createSession(2));
    let resolveRestore: ((value: {
      session: PlaySession;
      checkpoints: PlayCheckpointSummary[];
      restoredArtifactId: string;
    }) => void) | undefined;
    const restoreResponse = new Promise<{
      session: PlaySession;
      checkpoints: PlayCheckpointSummary[];
      restoredArtifactId: string;
    }>((resolve) => {
      resolveRestore = resolve;
    });
    const restorePlayCheckpoint = vi.fn(() => restoreResponse);
    const onRestored = vi.fn((session: PlaySession) => {
      selected.value = session;
    });
    const scope = effectScope();
    const history = scope.run(() => usePlaySessionHistory({
      client: createClient({
        listPlayCheckpoints: vi.fn(async () => ({ checkpoints: [restorable] })),
        restorePlayCheckpoint,
      }),
      selectedSession: computed(() => selected.value),
      blocked: computed(() => false),
      onRestored,
      onError: vi.fn(),
    }));
    await flushPromises();

    const restore = history?.restore('turn-1');
    expect(history?.busyArtifactId.value).toBe('turn-1');
    expect(restorePlayCheckpoint).toHaveBeenCalledWith(
      'play-1',
      'turn-1',
      { baseRevision: 2 },
    );

    const restoredSession = createSession(3);
    resolveRestore?.({
      session: restoredSession,
      checkpoints: [restoredCurrent],
      restoredArtifactId: 'turn-1',
    });
    await expect(restore).resolves.toBe(true);
    await nextTick();

    expect(onRestored).toHaveBeenCalledWith(restoredSession);
    expect(history?.checkpoints.value).toEqual([restoredCurrent]);
    expect(history?.busyArtifactId.value).toBe('');
    expect(history?.notice.value).toContain('Later turns remain available as variants');

    selected.value = createSession(4);
    await nextTick();
    expect(history?.notice.value).toBe('');
    scope.stop();
  });

  it('does not restore while blocked and reports restore failures without changing history', async () => {
    const restorable = createCheckpoint('turn-1', 'selectedAncestor', true, 1);
    const blocked = shallowRef(true);
    const error = new Error('revision conflict');
    const listPlayCheckpoints = vi.fn(async () => ({ checkpoints: [restorable] }));
    const restorePlayCheckpoint = vi.fn(async () => {
      throw error;
    });
    const onError = vi.fn();
    const scope = effectScope();
    const history = scope.run(() => usePlaySessionHistory({
      client: createClient({
        listPlayCheckpoints,
        restorePlayCheckpoint,
      }),
      selectedSession: computed(() => createSession(2)),
      blocked: computed(() => blocked.value),
      onRestored: vi.fn(),
      onError,
    }));
    await flushPromises();

    await expect(history?.restore('turn-1')).resolves.toBe(false);
    expect(restorePlayCheckpoint).not.toHaveBeenCalled();

    blocked.value = false;
    await nextTick();
    await flushPromises();
    expect(listPlayCheckpoints).toHaveBeenCalledTimes(1);
    expect(history?.checkpoints.value).toEqual([restorable]);

    await expect(history?.restore('turn-1')).resolves.toBe(false);

    expect(onError).toHaveBeenCalledWith(error);
    expect(history?.checkpoints.value).toEqual([restorable]);
    expect(history?.busyArtifactId.value).toBe('');
    scope.stop();
  });

  it('waits for an active turn to unblock before loading a new revision', async () => {
    const first = createCheckpoint('turn-1', 'current', false, 1);
    const second = createCheckpoint('turn-2', 'current', false, 2);
    const selected = shallowRef<PlaySession | undefined>(createSession(1));
    const blocked = shallowRef(false);
    const listPlayCheckpoints = vi.fn()
      .mockResolvedValueOnce({ checkpoints: [first] })
      .mockResolvedValueOnce({ checkpoints: [second] });
    const scope = effectScope();
    const history = scope.run(() => usePlaySessionHistory({
      client: createClient({ listPlayCheckpoints }),
      selectedSession: computed(() => selected.value),
      blocked: computed(() => blocked.value),
      onRestored: vi.fn(),
      onError: vi.fn(),
    }));
    await flushPromises();

    blocked.value = true;
    selected.value = createSession(2);
    await nextTick();

    expect(history?.checkpoints.value).toEqual([]);
    expect(listPlayCheckpoints).toHaveBeenCalledTimes(1);

    blocked.value = false;
    await nextTick();
    await flushPromises();

    expect(listPlayCheckpoints).toHaveBeenCalledTimes(2);
    expect(history?.checkpoints.value).toEqual([second]);
    scope.stop();
  });
});

function createClient(overrides: Partial<PlaySessionHistoryClient> = {}): PlaySessionHistoryClient {
  return {
    listPlayCheckpoints: async () => ({ checkpoints: [] }),
    restorePlayCheckpoint: async () => {
      throw new Error('restorePlayCheckpoint was not configured');
    },
    ...overrides,
  };
}

function createCheckpoint(
  artifactId: string,
  status: PlayCheckpointSummary['status'],
  restorable: boolean,
  revision: number,
): PlayCheckpointSummary {
  return {
    artifactId,
    selectedTurnIds: [artifactId],
    revision,
    worldTurn: revision,
    committedAt: '2026-07-15T00:00:00.000Z',
    preview: artifactId,
    status,
    restorable,
    canonical: false,
  };
}

function createSession(revision: number): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Play',
    createdAt: '2026-07-15T00:00:00.000Z',
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
