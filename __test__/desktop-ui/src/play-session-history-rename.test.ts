import { flushPromises } from '@vue/test-utils';
import { computed, effectScope, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { usePlaySessionHistory } from '../../../apps/desktop-ui/src/composables/usePlaySessionHistory';
import type { PlaySessionHistoryClient } from '../../../apps/desktop-ui/src/composables/usePlaySessionHistory';
import type {
  PlayCheckpointSummary,
  PlaySession,
} from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';

describe('usePlaySessionHistory rename', () => {
  it('renames by checkpoint id with CAS and adopts the authoritative session', async () => {
    const checkpoint = createCheckpoint();
    const renamedCheckpoint = {
      ...checkpoint,
      name: 'Station lockdown',
    } as PlayCheckpointSummary;
    const selected = shallowRef<PlaySession | undefined>(createSession(2));
    let resolveRename: ((value: {
      session: PlaySession;
      checkpoints: PlayCheckpointSummary[];
      renamedCheckpointId: string;
    }) => void) | undefined;
    const renameResponse = new Promise<{
      session: PlaySession;
      checkpoints: PlayCheckpointSummary[];
      renamedCheckpointId: string;
    }>((resolve) => {
      resolveRename = resolve;
    });
    const renamePlayCheckpoint = vi.fn(() => renameResponse);
    const onRenamed = vi.fn((session: PlaySession) => {
      selected.value = session;
    });
    const client: PlaySessionHistoryClient = {
      listPlayCheckpoints: vi.fn(async () => ({ checkpoints: [checkpoint] })),
      restorePlayCheckpoint: vi.fn(async () => {
        throw new Error('restore was not expected');
      }),
      renamePlayCheckpoint,
    };
    const scope = effectScope();
    const history = scope.run(() => usePlaySessionHistory({
      client,
      selectedSession: computed(() => selected.value),
      blocked: computed(() => false),
      onRestored: vi.fn(),
      onRenamed,
      onError: vi.fn(),
    }));
    await flushPromises();

    const rename = history?.rename('turn-1', '  Station lockdown  ');

    expect(history?.namingCheckpointId.value).toBe('turn-1');
    expect(renamePlayCheckpoint).toHaveBeenCalledWith(
      'play-1',
      'turn-1',
      { baseRevision: 2, name: 'Station lockdown' },
    );

    const renamedSession = createSession(3);
    resolveRename?.({
      session: renamedSession,
      checkpoints: [renamedCheckpoint],
      renamedCheckpointId: 'turn-1',
    });

    await expect(rename).resolves.toBe(true);
    expect(onRenamed).toHaveBeenCalledWith(renamedSession);
    expect(history?.checkpoints.value).toEqual([renamedCheckpoint]);
    expect(history?.namingCheckpointId.value).toBe('');
    expect(history?.notice.value).toBe('Worldline point named.');
    scope.stop();
  });
});

function createCheckpoint(): PlayCheckpointSummary {
  return {
    checkpointId: 'turn-1',
    kind: 'turn',
    artifactId: 'turn-1',
    parentCheckpointId: 'initial-world',
    selectedTurnIds: ['turn-1'],
    depth: 1,
    revision: 1,
    worldTurn: 1,
    committedAt: '2026-07-15T00:00:00.000Z',
    preview: 'First turn',
    status: 'current',
    restorable: false,
    retryable: true,
    canonical: false,
  } as PlayCheckpointSummary;
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
