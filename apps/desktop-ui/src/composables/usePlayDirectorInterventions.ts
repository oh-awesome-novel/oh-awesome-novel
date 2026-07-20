import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
  watch,
} from 'vue';
import type { DeepReadonly, Ref } from 'vue';

import type {
  PlayDirectorInterventionDraft,
  PlaySceneMemoryView,
} from '../components/play/rehearsal/types';
import type {
  PlayDirectorInterventionAction,
  PlayRehearsalMutationOutcome,
} from './usePlayRehearsalAttempt';
import type { PlayRehearsalAttemptRecord } from './usePlayActorStepStream';
import type {
  NarrativeBlock,
  PlaySceneMemoryArtifact,
} from './useWorkspaceApi';

export interface PlayDirectorInterventionClient {
  getPlaySceneMemory(
    sessionId: string,
    lens: 'player' | 'director',
  ): Promise<{ memory: PlaySceneMemoryArtifact | null }>;
  rebuildPlaySceneMemory(
    sessionId: string,
    lens: 'player' | 'director',
  ): Promise<{ memory: PlaySceneMemoryArtifact }>;
}

export interface UsePlayDirectorInterventionsOptions {
  client: PlayDirectorInterventionClient;
  sessionId: Readonly<Ref<string | undefined>>;
  sessionRevision: Readonly<Ref<number | undefined>>;
  attempt: Readonly<Ref<DeepReadonly<PlayRehearsalAttemptRecord> | undefined>>;
  apply(action: PlayDirectorInterventionAction): Promise<PlayRehearsalMutationOutcome>;
}

export function usePlayDirectorInterventions(
  options: UsePlayDirectorInterventionsOptions,
) {
  const lens = shallowRef<'player' | 'director'>('director');
  const storedMemory = shallowRef<PlaySceneMemoryArtifact>();
  const loadingMemory = shallowRef(false);
  const rebuildingMemory = shallowRef(false);
  const error = shallowRef('');
  let memoryGeneration = 0;
  let disposed = false;

  const memory = computed<PlaySceneMemoryView | undefined>(() => {
    const artifact = storedMemory.value;
    if (!artifact) return undefined;
    return {
      id: artifact.id,
      lens: artifact.lens,
      status: artifact.status === 'current' ? 'current' : 'stale',
      revision: artifact.throughRevision,
      builtAt: artifact.builtAt,
      staleReasons: artifact.status === 'superseded'
        ? ['memory was superseded']
        : [...(artifact.staleReasons ?? [])],
      items: artifact.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        summary: item.summary,
        ...(artifact.lens === 'director'
          ? {
              provenanceLabel: formatMemoryProvenance(item),
            }
          : {}),
      })),
    };
  });

  watch(
    [options.sessionId, options.sessionRevision, lens],
    ([sessionId, , requestLens], [previousSessionId, , previousLens]) => {
      // Cancel reads tied to an older revision or lens. In particular, never
      // leave Director memory visible while a Player projection is loading.
      memoryGeneration += 1;
      loadingMemory.value = false;
      rebuildingMemory.value = false;
      error.value = '';
      if (sessionId !== previousSessionId || requestLens !== previousLens) {
        storedMemory.value = undefined;
      }
      if (sessionId) void refreshMemory();
      else resetMemory();
    },
    { immediate: true },
  );

  async function intervene(draft: PlayDirectorInterventionDraft): Promise<boolean> {
    if (disposed) return false;
    try {
      const action = buildInterventionAction(draft, options.attempt.value);
      error.value = '';
      return await options.apply(action) === 'applied';
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    }
  }

  async function refreshMemory(): Promise<boolean> {
    const sessionId = options.sessionId.value;
    if (!sessionId || disposed || loadingMemory.value || rebuildingMemory.value) {
      return false;
    }
    const generation = ++memoryGeneration;
    const requestLens = lens.value;
    loadingMemory.value = true;
    error.value = '';
    try {
      const result = await options.client.getPlaySceneMemory(sessionId, requestLens);
      if (!isCurrentMemoryRequest(generation, sessionId, requestLens)) return false;
      storedMemory.value = result.memory ?? undefined;
      return true;
    } catch (caught) {
      if (isCurrentMemoryRequest(generation, sessionId, requestLens)) {
        error.value = toErrorMessage(caught);
      }
      return false;
    } finally {
      if (generation === memoryGeneration) loadingMemory.value = false;
    }
  }

  async function rebuildMemory(): Promise<boolean> {
    const sessionId = options.sessionId.value;
    if (!sessionId || disposed || loadingMemory.value || rebuildingMemory.value) {
      return false;
    }
    const generation = ++memoryGeneration;
    const requestLens = lens.value;
    rebuildingMemory.value = true;
    error.value = '';
    try {
      const result = await options.client.rebuildPlaySceneMemory(sessionId, requestLens);
      if (!isCurrentMemoryRequest(generation, sessionId, requestLens)) return false;
      storedMemory.value = result.memory;
      return true;
    } catch (caught) {
      if (isCurrentMemoryRequest(generation, sessionId, requestLens)) {
        error.value = toErrorMessage(caught);
      }
      return false;
    } finally {
      if (generation === memoryGeneration) rebuildingMemory.value = false;
    }
  }

  function setLens(nextLens: 'player' | 'director'): void {
    if (!loadingMemory.value && !rebuildingMemory.value) lens.value = nextLens;
  }

  function resetMemory(): void {
    memoryGeneration += 1;
    storedMemory.value = undefined;
    loadingMemory.value = false;
    rebuildingMemory.value = false;
    error.value = '';
  }

  function dispose(): void {
    disposed = true;
    resetMemory();
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    lens: readonly(lens),
    memory,
    loadingMemory: readonly(loadingMemory),
    rebuildingMemory: readonly(rebuildingMemory),
    error: readonly(error),
    intervene,
    refreshMemory,
    rebuildMemory,
    setLens,
    resetMemory,
    dispose,
  };

  function isCurrentMemoryRequest(
    generation: number,
    sessionId: string,
    requestLens: 'player' | 'director',
  ): boolean {
    return !disposed &&
      generation === memoryGeneration &&
      options.sessionId.value === sessionId &&
      lens.value === requestLens;
  }
}

export function buildInterventionAction(
  draft: Readonly<PlayDirectorInterventionDraft>,
  attempt: DeepReadonly<PlayRehearsalAttemptRecord> | undefined,
): PlayDirectorInterventionAction {
  if (!attempt || (attempt.status !== 'running' && attempt.status !== 'prepared')) {
    throw new Error('A live rehearsal attempt is required for Director intervention.');
  }
  if (draft.kind === 'reviseProjection') {
    const step = requireLiveStep(attempt, draft.stepRef);
    if (!step.effectFingerprint) {
      throw new Error('The target step has no host-issued effect fingerprint.');
    }
    const replacementEntries = draft.replacementProjection.map((item) => [
      item.blockId,
      item.content.trim(),
    ] as const);
    const replacements = new Map(replacementEntries);
    const replacementBlocks = (step.narrativeBlocks ?? []).filter((block) =>
      block.kind !== 'worldNotice',
    );
    const playerEditableBlocks = replacementBlocks.filter((block) =>
      block.projection === 'transcript' && block.visibility !== 'playerUnknown',
    );
    const allowedReplacementIds = new Set(
      playerEditableBlocks.map((block) => block.id),
    );
    if (
      playerEditableBlocks.length === 0 ||
      replacements.size !== replacementEntries.length ||
      replacements.size !== playerEditableBlocks.length ||
      replacementEntries.some(([blockId, content]) =>
        !allowedReplacementIds.has(blockId) || !content) ||
      playerEditableBlocks.some((block) => !replacements.has(block.id))
    ) {
      throw new Error(
        'Projection revision must replace every player-visible narrative block exactly once.',
      );
    }
    return {
      kind: 'reviseProjection',
      stepRef: step.id,
      expectedEffectFingerprint: step.effectFingerprint,
      // Hidden and Director-only blocks are never exposed by the form. Keep
      // their original evidence closure and content rather than dropping them.
      replacementBlocks: replacementBlocks.map((block) => cloneReplacementBlock(
        block,
        replacements.get(block.id) ?? block.content,
      )),
    };
  }
  if (draft.kind === 'redirectStep') {
    requireLiveStep(attempt, draft.stepRef);
    if (!draft.directorIntent.trim()) throw new Error('Redirect requires Director intent.');
    return {
      kind: 'redirectStep',
      stepRef: draft.stepRef,
      directorIntent: draft.directorIntent.trim(),
      authorConstraintRefs: [...new Set(draft.authorConstraintRefs)],
    };
  }
  if (draft.kind === 'insertActor') {
    if (!(attempt.participantRefs ?? attempt.actorOrder).includes(draft.participantRef)) {
      throw new Error('Insert actor must reference a Scene Contract participant.');
    }
    if (draft.anchor === 'next') {
      return { kind: 'insertActor', participantRef: draft.participantRef };
    }
    if (!draft.anchorStepRef) throw new Error('Insert actor requires a live anchor step.');
    requireLiveStep(attempt, draft.anchorStepRef);
    return {
      kind: 'insertActor',
      participantRef: draft.participantRef,
      ...(draft.anchor === 'before'
        ? { beforeStepRef: draft.anchorStepRef }
        : { afterStepRef: draft.anchorStepRef }),
    };
  }
  requireLiveStep(attempt, draft.effectiveFromStepRef);
  if (!(attempt.participantRefs ?? attempt.actorOrder).includes(draft.participantRef)) {
    throw new Error('Knowledge grant must reference a Scene Contract participant.');
  }
  return {
    kind: 'grantKnowledge',
    participantRef: draft.participantRef,
    effectiveFromStepRef: draft.effectiveFromStepRef,
    grant: draft.grant.kind === 'existingFact'
      ? {
          kind: 'existingFact',
          factRefs: [...new Set(draft.grant.factRefs)],
        }
      : {
          kind: 'authorProvidedPlayFact',
          summary: draft.grant.summary.trim(),
          visibility: draft.grant.visibility,
          providedAt: new Date().toISOString(),
        },
  };
}

function requireLiveStep(
  attempt: DeepReadonly<PlayRehearsalAttemptRecord>,
  stepRef: string,
) {
  const step = attempt.steps.find((candidate) =>
    candidate.id === stepRef &&
    (candidate.status === 'draft' || candidate.status === 'selected'));
  if (!step) throw new Error(`Director intervention target is not on the live branch: ${stepRef}.`);
  return step;
}

function cloneReplacementBlock(
  block: DeepReadonly<NonNullable<PlayRehearsalAttemptRecord['steps'][number]['narrativeBlocks']>[number]>,
  content: string,
): NarrativeBlock {
  if (!block.visibility || !block.eventRefs || !block.sourceRefs) {
    throw new Error('The target narrative block is missing its host evidence closure.');
  }
  return {
    id: block.id,
    kind: block.kind,
    ...(block.speakerRef ? { speakerRef: block.speakerRef } : {}),
    content,
    visibility: block.visibility,
    projection: block.projection,
    eventRefs: [...block.eventRefs],
    sourceRefs: [...block.sourceRefs],
  };
}

function formatMemoryProvenance(item: {
  artifactTurnRefs: string[];
  eventRefs: string[];
  evidenceRefs: string[];
  sourceRefs: string[];
}): string {
  return [
    `${item.artifactTurnRefs.length} turn refs`,
    `${item.eventRefs.length} event refs`,
    `${item.evidenceRefs.length} evidence refs`,
    `${item.sourceRefs.length} source refs`,
  ].join(' · ');
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
