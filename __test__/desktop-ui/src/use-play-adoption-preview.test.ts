import { effectScope, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaySession } from '@oh-awesome-novel/client';
import {
  usePlayAdoptionPreview,
  type PlayAdoptionPreview,
  type PlayAdoptionSeed,
} from '../../../apps/desktop-ui/src/composables/usePlayAdoptionPreview';

const api = vi.hoisted(() => ({
  createPlayAdoptionPreview: vi.fn(),
  createPlayAdoptionPendingAction: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

describe('usePlayAdoptionPreview', () => {
  beforeEach(() => {
    api.createPlayAdoptionPreview.mockReset();
    api.createPlayAdoptionPendingAction.mockReset();
  });

  it('requests a strict preview while keeping the evidence closure out of the exposed view', async () => {
    const harness = createHarness();
    api.createPlayAdoptionPreview.mockResolvedValue({
      preview: createPreview({
        closureSecret: 'director-only-source.md',
      }),
    });

    await expect(harness.flow.open(EVENT_SEED)).resolves.toBe(true);

    expect(api.createPlayAdoptionPreview).toHaveBeenCalledWith('play-1', {
      baseRevision: 3,
      projection: 'player',
      seed: EVENT_SEED,
    });
    expect(harness.flow.preview.value).toMatchObject({
      id: 'adoption-preview-1',
      target: 'chapterDraft',
      canonicalUnchanged: true,
    });
    const playerView = JSON.stringify(harness.flow.preview.value);
    expect(playerView).not.toContain('evidenceClosure');
    expect(playerView).not.toContain('evidenceFingerprint');
    expect(playerView).not.toContain('director-only-source.md');
    harness.stop();
  });

  it('drops a late preview after a lens switch and never exposes its hidden response', async () => {
    const harness = createHarness();
    const gate = deferred<{ preview: PlayAdoptionPreview }>();
    api.createPlayAdoptionPreview.mockReturnValue(gate.promise);

    const opening = harness.flow.open(EVENT_SEED);
    expect(harness.flow.previewing.value).toBe(true);

    harness.projection.value = 'director';
    expect(harness.flow.activeSeed.value).toBeUndefined();
    expect(harness.flow.preview.value).toBeUndefined();
    expect(harness.flow.previewing.value).toBe(false);

    gate.resolve({
      preview: createPreview({
        projection: 'player',
        visibility: 'playerUnknown',
        summary: 'SECRET: the regent ordered the ambush.',
        closureSecret: 'secret-regent-plan.md',
      }),
    });
    await expect(opening).resolves.toBe(false);

    expect(harness.flow.preview.value).toBeUndefined();
    expect(harness.flow.error.value).toBe('');
    expect(JSON.stringify({
      seed: harness.flow.activeSeed.value,
      preview: harness.flow.preview.value,
      error: harness.flow.error.value,
    })).not.toContain('SECRET');
    harness.stop();
  });

  it('clears synchronously when Restore, Retry, or the session revision changes', async () => {
    const harness = createHarness();
    api.createPlayAdoptionPreview.mockImplementation(async () => ({
      preview: createPreview({
        baseRevision: harness.session.value?.revision ?? 3,
      }),
    }));

    await harness.flow.open(EVENT_SEED);
    expect(harness.flow.preview.value).toBeDefined();

    harness.contextKey.value = 'retry:before-turn-2';
    expect(harness.flow.activeSeed.value).toBeUndefined();
    expect(harness.flow.preview.value).toBeUndefined();

    await harness.flow.open(EVENT_SEED);
    expect(harness.flow.preview.value).toBeDefined();

    harness.session.value = createSession(4);
    expect(harness.flow.activeSeed.value).toBeUndefined();
    expect(harness.flow.preview.value).toBeUndefined();
    harness.stop();
  });

  it('fails closed for a Player-hidden preview without echoing server details', async () => {
    const harness = createHarness();
    api.createPlayAdoptionPreview.mockResolvedValue({
      preview: createPreview({
        visibility: 'playerUnknown',
        summary: 'SECRET: poison is already in the cup.',
      }),
    });

    await expect(harness.flow.open(EVENT_SEED)).resolves.toBe(false);

    expect(harness.flow.preview.value).toBeUndefined();
    expect(harness.flow.error.value).toBe(
      'Adoption preview could not be prepared for the Player lens.',
    );
    expect(harness.flow.error.value).not.toContain('poison');
    harness.stop();
  });

  it('confirms by fingerprint, preserves the created PendingAction, and only reports it for Review', async () => {
    const harness = createHarness();
    const onPendingActionCreated = vi.fn();
    const onSessionUpdated = vi.fn((session: PlaySession) => {
      harness.session.value = session;
    });
    harness.stop();
    const confirmedHarness = createHarness({
      session: harness.session,
      onPendingActionCreated,
      onSessionUpdated,
    });
    const preview = createPreview();
    api.createPlayAdoptionPreview.mockResolvedValue({ preview });
    api.createPlayAdoptionPendingAction.mockResolvedValue({
      sessionUpdate: {
        sessionId: 'play-1',
        baseRevision: 3,
        revision: 4,
      },
      candidate: {
        id: 'candidate-1',
        target: 'chapterDraft',
        summary: preview.summary,
        evidence: preview.evidence,
        visibility: 'playerVisible',
        sourceObservationIds: [],
        sourceTurnIds: [],
        sourceEventIds: [],
        requiresPendingAction: true,
      },
      pendingAction: {
        id: 'pending-action-1',
        title: 'Adopt Play evidence',
        description: 'Prepare the chapter diff.',
        touchedFiles: ['chapters/0001.md'],
        diff: preview.diff,
        createdAt: '2026-07-16T05:01:00.000Z',
        status: 'pending',
      },
      refresh: {
        fileTreeChanged: false,
        chapterIndexChanged: false,
        contextChanged: true,
      },
    });

    await confirmedHarness.flow.open(EVENT_SEED);
    await expect(confirmedHarness.flow.confirm()).resolves.toBe(true);

    expect(api.createPlayAdoptionPendingAction).toHaveBeenCalledWith(
      'play-1',
      'adoption-preview-1',
      {
        baseRevision: 3,
        fingerprint: 'd'.repeat(64),
      },
    );
    expect(onSessionUpdated).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
    expect(onPendingActionCreated).toHaveBeenCalledWith('pending-action-1');
    expect(confirmedHarness.flow.pendingAction.value?.id).toBe('pending-action-1');
    expect(confirmedHarness.flow.preview.value?.id).toBe('adoption-preview-1');
    confirmedHarness.stop();
  });

  it('reconciles a late successful confirmation without projecting Director data after a lens switch', async () => {
    const onPendingActionCreated = vi.fn();
    const onSessionUpdated = vi.fn();
    const harness = createHarness({
      onPendingActionCreated,
      onSessionUpdated,
    });
    harness.projection.value = 'director';
    const preview = createPreview({
      projection: 'director',
      visibility: 'playerUnknown',
      summary: 'SECRET: the regent ordered the ambush.',
      closureSecret: 'secret-regent-plan.md',
    });
    api.createPlayAdoptionPreview.mockResolvedValue({ preview });
    const gate = deferred<{
      sessionUpdate: { sessionId: string; baseRevision: number; revision: number };
      candidate: Record<string, unknown>;
      pendingAction: Record<string, unknown>;
      refresh: Record<string, unknown>;
    }>();
    api.createPlayAdoptionPendingAction.mockReturnValue(gate.promise);

    await expect(harness.flow.open(EVENT_SEED)).resolves.toBe(true);
    const confirming = harness.flow.confirm();
    harness.projection.value = 'player';
    gate.resolve({
      sessionUpdate: { sessionId: 'play-1', baseRevision: 3, revision: 4 },
      candidate: {
        id: 'candidate-secret',
        summary: 'SECRET: the regent ordered the ambush.',
        evidenceClosure: { sourceSnapshots: ['secret-regent-plan.md'] },
      },
      pendingAction: {
        id: 'pending-action-secret',
        title: 'Secret adoption',
        description: 'SECRET: canonical baseline',
        touchedFiles: ['chapters/0001.md'],
        diff: 'SECRET: canonical baseline',
        createdAt: '2026-07-16T05:01:00.000Z',
        status: 'pending',
      },
      refresh: {},
    });

    await expect(confirming).resolves.toBe(false);
    expect(onPendingActionCreated).toHaveBeenCalledOnce();
    expect(onPendingActionCreated).toHaveBeenCalledWith('pending-action-secret');
    expect(onSessionUpdated).toHaveBeenCalledOnce();
    const reconciled = onSessionUpdated.mock.calls[0]![0] as PlaySession;
    expect(reconciled.revision).toBe(4);
    expect(reconciled.adoptionCandidates).toEqual([]);
    expect(JSON.stringify(reconciled)).not.toContain('SECRET');
    expect(harness.flow.preview.value).toBeUndefined();
    expect(harness.flow.pendingAction.value).toBeUndefined();
    harness.stop();
  });
});

const EVENT_SEED: PlayAdoptionSeed = {
  kind: 'event',
  eventId: 'event-visible-1',
};

function createHarness(overrides: {
  session?: ShallowRef<PlaySession | undefined>;
  onSessionUpdated?: (session: PlaySession) => void;
  onPendingActionCreated?: (pendingActionId: string) => void;
} = {}) {
  const scope = effectScope();
  const session = overrides.session ?? shallowRef<PlaySession | undefined>(createSession(3));
  const projection = shallowRef<'player' | 'director'>('player');
  const contextKey = shallowRef('selected:turn-1');
  const disabled = shallowRef(false);
  const flow = scope.run(() => usePlayAdoptionPreview({
    session,
    projection,
    contextKey,
    disabled,
    onSessionUpdated: overrides.onSessionUpdated,
    onPendingActionCreated: overrides.onPendingActionCreated,
  }));
  if (!flow) throw new Error('Failed to create adoption preview flow.');
  return {
    flow,
    session,
    projection,
    contextKey,
    disabled,
    stop: () => scope.stop(),
  };
}

function createPreview(overrides: {
  baseRevision?: number;
  projection?: 'player' | 'director';
  visibility?: 'playerVisible' | 'rumor' | 'playerUnknown';
  summary?: string;
  closureSecret?: string;
} = {}): PlayAdoptionPreview {
  return {
    schemaVersion: 1,
    id: 'adoption-preview-1',
    sessionId: 'play-1',
    baseRevision: overrides.baseRevision ?? 3,
    projection: overrides.projection ?? 'player',
    seed: EVENT_SEED,
    candidateId: 'candidate-1',
    summary: overrides.summary ?? 'The public gate is locked.',
    evidence: 'The selected branch contains the visible gate-closing event.',
    visibility: overrides.visibility ?? 'playerVisible',
    evidenceClosure: {
      schemaVersion: 1,
      sessionId: 'play-1',
      sessionRevision: overrides.baseRevision ?? 3,
      selectedArtifactTurnRefs: ['artifact-1'],
      artifactTurnRefs: ['artifact-1'],
      messageRefs: [],
      eventRefs: ['event-visible-1'],
      observationRefs: [],
      evidenceRefs: ['event:event-visible-1'],
      sourceSnapshots: [{
        sourceId: 'source-secret',
        path: overrides.closureSecret ?? 'world/public-gate.md',
        contentHash: 'c'.repeat(64),
      }],
      selectedPathFingerprint: 'a'.repeat(64),
      sourceBaseFingerprint: 'b'.repeat(64),
    },
    evidenceFingerprint: 'c'.repeat(64),
    suggestions: [{
      target: 'chapterDraft',
      toolName: 'chapter.createDraft',
      recommended: true,
      reason: 'Append the selected evidence to a chapter draft.',
      defaultPayload: {
        chapterId: '0001',
        content: 'The public gate is locked.',
      },
    }],
    target: 'chapterDraft',
    payload: {
      chapterId: '0001',
      content: 'The public gate is locked.',
    },
    touchedFiles: ['chapters/0001.md'],
    diff: '--- a/chapters/0001.md\n+++ b/chapters/0001.md\n+The public gate is locked.',
    fingerprint: 'd'.repeat(64),
    createdAt: '2026-07-16T05:00:00.000Z',
    canonicalUnchanged: true,
  };
}

function createSession(revision: number): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Play',
    createdAt: '2026-07-16T00:00:00.000Z',
    revision,
    sceneStart: 'Station',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: ['turn-1'],
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
