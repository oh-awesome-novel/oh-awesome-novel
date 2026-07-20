import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import type { PlaySceneMemoryArtifact } from '@oh-awesome-novel/client';
import type { PlayDirectorInterventionDraft } from '../../../apps/desktop-ui/src/components/play/rehearsal/types';
import type { PlayRehearsalAttemptRecord } from '../../../apps/desktop-ui/src/composables/usePlayActorStepStream';
import {
  buildInterventionAction,
  usePlayDirectorInterventions,
} from '../../../apps/desktop-ui/src/composables/usePlayDirectorInterventions';

describe('buildInterventionAction', () => {
  it('carries the host fingerprint and narrative evidence closure into a revision', () => {
    const action = buildInterventionAction(revisionDraft(), createAttempt());

    expect(action).toEqual({
      kind: 'reviseProjection',
      stepRef: 'step-ivo-draft',
      expectedEffectFingerprint: 'sha256:host-effect-ivo',
      replacementBlocks: [{
        id: 'block-ivo-action',
        kind: 'characterAction',
        speakerRef: 'ivo',
        content: 'Ivo stops beside the closing door.',
        visibility: 'playerVisible',
        projection: 'transcript',
        eventRefs: ['event-bell'],
        sourceRefs: ['source-scene-contract'],
      }, {
        id: 'block-director-only',
        kind: 'narrator',
        content: 'The signal operator hides the route change.',
        visibility: 'playerUnknown',
        projection: 'directorOnly',
        eventRefs: ['event-hidden-route'],
        sourceRefs: ['source-director-note'],
      }],
    });
  });

  it('rejects projection revision without a host-issued fingerprint', () => {
    const attempt = createAttempt();
    attempt.steps[1]!.effectFingerprint = undefined;

    expect(() => buildInterventionAction(revisionDraft(), attempt)).toThrow(
      'The target step has no host-issued effect fingerprint.',
    );
  });

  it('rejects an intervention targeting a superseded non-live step', () => {
    const draft: PlayDirectorInterventionDraft = {
      kind: 'redirectStep',
      stepRef: 'step-old-superseded',
      directorIntent: 'Try a different question.',
      authorConstraintRefs: [],
    };

    expect(() => buildInterventionAction(draft, createAttempt())).toThrow(
      'Director intervention target is not on the live branch: step-old-superseded.',
    );
  });

  it('rejects projection revision when the host evidence closure is incomplete', () => {
    const attempt = createAttempt();
    attempt.steps[1]!.narrativeBlocks![0]!.sourceRefs = undefined;

    expect(() => buildInterventionAction(revisionDraft(), attempt)).toThrow(
      'The target narrative block is missing its host evidence closure.',
    );
  });

  it('clears the previous Scene Memory projection while a new lens loads', async () => {
    const playerMemory = deferred<{ memory: PlaySceneMemoryArtifact | null }>();
    const getPlaySceneMemory = vi.fn(
      async (_sessionId: string, lens: 'player' | 'director') => {
        if (lens === 'director') return { memory: memoryArtifact('director') };
        return playerMemory.promise;
      },
    );
    const scope = effectScope();
    const controls = scope.run(() => usePlayDirectorInterventions({
      client: {
        getPlaySceneMemory,
        rebuildPlaySceneMemory: vi.fn(),
      },
      sessionId: ref('play-rehearsal-1'),
      sessionRevision: ref(3),
      attempt: shallowRef(),
      apply: vi.fn(async () => 'applied' as const),
    }));
    if (!controls) throw new Error('Failed to create Director intervention scope.');

    await vi.waitFor(() => {
      expect(controls.memory.value?.lens).toBe('director');
    });
    controls.setLens('player');
    await nextTick();

    expect(controls.lens.value).toBe('player');
    expect(getPlaySceneMemory).toHaveBeenLastCalledWith('play-rehearsal-1', 'player');
    expect(controls.memory.value).toBeUndefined();

    playerMemory.resolve({ memory: memoryArtifact('player') });
    await vi.waitFor(() => {
      expect(controls.memory.value?.lens).toBe('player');
    });
    scope.stop();
  });
});

function revisionDraft(): PlayDirectorInterventionDraft {
  return {
    kind: 'reviseProjection',
    stepRef: 'step-ivo-draft',
    replacementProjection: [{
      blockId: 'block-ivo-action',
      content: ' Ivo stops beside the closing door. ',
    }],
  };
}

function createAttempt(): PlayRehearsalAttemptRecord {
  return {
    id: 'attempt-1',
    sessionId: 'play-rehearsal-1',
    baseRevision: 3,
    attemptRevision: 4,
    status: 'prepared',
    actorOrder: ['mara', 'ivo', 'guard'],
    participantRefs: ['mara', 'ivo', 'guard'],
    selectedStepRefs: ['step-mara-selected'],
    selectedHeadRef: 'step-mara-selected',
    currentStepRef: 'step-ivo-draft',
    steps: [
      {
        id: 'step-mara-selected',
        participantRef: 'mara',
        status: 'selected',
      },
      {
        id: 'step-ivo-draft',
        participantRef: 'ivo',
        status: 'draft',
        effectFingerprint: 'sha256:host-effect-ivo',
        narrativeBlocks: [{
          id: 'block-ivo-action',
          kind: 'characterAction',
          speakerRef: 'ivo',
          content: 'Ivo reaches for the closing door.',
          visibility: 'playerVisible',
          projection: 'transcript',
          eventRefs: ['event-bell'],
          sourceRefs: ['source-scene-contract'],
        }, {
          id: 'block-director-only',
          kind: 'narrator',
          content: 'The signal operator hides the route change.',
          visibility: 'playerUnknown',
          projection: 'directorOnly',
          eventRefs: ['event-hidden-route'],
          sourceRefs: ['source-director-note'],
        }],
      },
      {
        id: 'step-old-superseded',
        participantRef: 'guard',
        status: 'superseded',
      },
    ],
  };
}

function memoryArtifact(lens: 'player' | 'director'): PlaySceneMemoryArtifact {
  return {
    schemaVersion: 1,
    id: `scene-memory-${lens}-3`,
    sessionId: 'play-rehearsal-1',
    lens,
    throughRevision: 3,
    selectedTurnRefs: [],
    sourceHashes: {},
    items: [],
    status: 'current',
    builtAt: '2026-07-20T12:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
