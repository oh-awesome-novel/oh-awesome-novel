import { computed, readonly, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import type {
  CreatePlayAdoptionPreviewInput,
  PlayAdoptionCandidate,
  PlayAdoptionSessionUpdate,
  PlayAdoptionPreview,
  PlayAdoptionProjection,
  PlayAdoptionSeed,
  PlayAdoptionTarget,
  PlayAdoptionTargetSuggestion,
  PlayEventVisibility,
  PlaySession,
} from './useWorkspaceApi';

export type {
  PlayAdoptionPreview,
  PlayAdoptionProjection,
  PlayAdoptionSeed,
  PlayAdoptionTargetSuggestion,
} from './useWorkspaceApi';

export interface PlayAdoptionPreviewView {
  id: string;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  suggestions: PlayAdoptionTargetSuggestion[];
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  touchedFiles: string[];
  diff: string;
  fingerprint: string;
  canonicalUnchanged: true;
}

export interface PlayAdoptionPendingActionView {
  id: string;
  title: string;
  description: string;
  touchedFiles: readonly string[];
  diff: string;
  createdAt: string;
  status: string;
}

export type PlayAdoptionPreviewRequest = Pick<
  CreatePlayAdoptionPreviewInput,
  'target' | 'payload'
>;

export interface UsePlayAdoptionPreviewOptions {
  session: Readonly<Ref<PlaySession | undefined>>;
  projection: Readonly<Ref<PlayAdoptionProjection>>;
  contextKey: Readonly<Ref<string>>;
  disabled: Readonly<Ref<boolean>>;
  onSessionUpdated?: (session: PlaySession) => void;
  onPendingActionCreated?: (pendingActionId: string) => void;
}

export function usePlayAdoptionPreview(options: UsePlayAdoptionPreviewOptions) {
  const client = useWorkspaceApi();
  const activeSeed = shallowRef<PlayAdoptionSeed>();
  const storedPreview = shallowRef<PlayAdoptionPreview>();
  const pendingAction = shallowRef<PlayAdoptionPendingActionView>();
  const previewing = shallowRef(false);
  const confirming = shallowRef(false);
  const storedError = shallowRef('');
  let epoch = 0;
  let preserveConfirmedContextChange = false;

  const preview = computed<PlayAdoptionPreviewView | undefined>(() => {
    const value = storedPreview.value;
    if (!value) return undefined;
    return {
      id: value.id,
      summary: value.summary,
      evidence: value.evidence,
      visibility: value.visibility,
      suggestions: value.suggestions.map((suggestion) => ({
        ...suggestion,
        defaultPayload: { ...suggestion.defaultPayload },
      })),
      target: value.target,
      payload: { ...value.payload },
      touchedFiles: [...value.touchedFiles],
      diff: value.diff,
      fingerprint: value.fingerprint,
      canonicalUnchanged: true,
    };
  });
  const error = computed(() => {
    if (!storedError.value) return '';
    return options.projection.value === 'player'
      ? 'Adoption preview could not be prepared for the Player lens.'
      : storedError.value;
  });
  const busy = computed(() => previewing.value || confirming.value);

  watch(
    [
      () => options.session.value?.id ?? '',
      () => options.session.value?.revision ?? -1,
      options.projection,
      options.contextKey,
    ],
    () => {
      if (preserveConfirmedContextChange) {
        return;
      }
      clear();
    },
    { flush: 'sync' },
  );

  async function open(seed: PlayAdoptionSeed): Promise<boolean> {
    if (!options.session.value || options.disabled.value) return false;
    clear();
    activeSeed.value = cloneSeed(seed);
    return requestPreview();
  }

  async function requestPreview(
    request: PlayAdoptionPreviewRequest = {},
  ): Promise<boolean> {
    const seed = activeSeed.value;
    const session = options.session.value;
    if (!seed || !session || options.disabled.value) return false;

    const requestEpoch = ++epoch;
    const contextKey = options.contextKey.value;
    previewing.value = true;
    storedPreview.value = undefined;
    pendingAction.value = undefined;
    storedError.value = '';

    try {
      const result = await client.createPlayAdoptionPreview(session.id, {
        baseRevision: session.revision,
        projection: options.projection.value,
        seed: cloneSeed(seed),
        ...(request.target ? { target: request.target } : {}),
        ...(request.payload ? { payload: request.payload } : {}),
      });
      const nextPreview = result.preview;
      if (
        requestEpoch !== epoch ||
        contextKey !== options.contextKey.value ||
        !sameSeed(activeSeed.value, seed)
      ) {
        return false;
      }
      if (!isPreviewForCurrentContext(nextPreview, session, seed, options.projection.value)) {
        throw new Error('Adoption preview did not match the current Play context.');
      }
      storedPreview.value = nextPreview;
      return true;
    } catch (caught) {
      if (requestEpoch !== epoch) return false;
      storedError.value = toErrorMessage(caught);
      return false;
    } finally {
      if (requestEpoch === epoch) previewing.value = false;
    }
  }

  async function confirm(): Promise<boolean> {
    const value = storedPreview.value;
    const session = options.session.value;
    if (
      !value ||
      !session ||
      options.disabled.value ||
      confirming.value ||
      session.id !== value.sessionId ||
      session.revision !== value.baseRevision
    ) {
      return false;
    }

    const requestEpoch = ++epoch;
    const contextKey = options.contextKey.value;
    confirming.value = true;
    storedError.value = '';

    try {
      const result = await client.createPlayAdoptionPendingAction(
        session.id,
        value.id,
        {
          baseRevision: value.baseRevision,
          fingerprint: value.fingerprint,
        },
      );
      const responseIsStale =
        requestEpoch !== epoch ||
        contextKey !== options.contextKey.value ||
        storedPreview.value?.id !== value.id;
      options.onPendingActionCreated?.(result.pendingAction.id);
      if (responseIsStale) {
        options.onSessionUpdated?.(applyPlayAdoptionSessionRevision(
          session,
          result.sessionUpdate,
        ));
        return false;
      }

      pendingAction.value = toPendingActionView(result.pendingAction);
      preserveConfirmedContextChange = true;
      try {
        options.onSessionUpdated?.(applyPlayAdoptionSessionUpdate(
          session,
          result.sessionUpdate,
          result.candidate,
        ));
      } finally {
        preserveConfirmedContextChange = false;
      }
      return true;
    } catch (caught) {
      if (requestEpoch !== epoch) return false;
      storedError.value = toErrorMessage(caught);
      return false;
    } finally {
      if (requestEpoch === epoch) confirming.value = false;
    }
  }

  function clear(): void {
    epoch += 1;
    activeSeed.value = undefined;
    storedPreview.value = undefined;
    pendingAction.value = undefined;
    previewing.value = false;
    confirming.value = false;
    storedError.value = '';
  }

  return {
    activeSeed: readonly(activeSeed),
    preview,
    pendingAction: readonly(pendingAction),
    previewing: readonly(previewing),
    confirming: readonly(confirming),
    busy,
    error,
    open,
    requestPreview,
    confirm,
    clear,
  };
}

function isPreviewForCurrentContext(
  preview: Readonly<PlayAdoptionPreview>,
  session: Readonly<PlaySession>,
  seed: Readonly<PlayAdoptionSeed>,
  projection: PlayAdoptionProjection,
): boolean {
  return preview.schemaVersion === 1 &&
    preview.sessionId === session.id &&
    preview.baseRevision === session.revision &&
    preview.projection === projection &&
    preview.canonicalUnchanged === true &&
    sameSeed(preview.seed, seed) &&
    (projection === 'director' || preview.visibility !== 'playerUnknown');
}

function sameSeed(
  left: Readonly<PlayAdoptionSeed> | undefined,
  right: Readonly<PlayAdoptionSeed> | undefined,
): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'event' && right.kind === 'event') {
    return left.eventId === right.eventId;
  }
  if (left.kind === 'observation' && right.kind === 'observation') {
    return left.observationId === right.observationId;
  }
  return left.kind === 'outcome' && right.kind === 'outcome' &&
    left.outcomeItemId === right.outcomeItemId &&
    left.outcomeReportFingerprint === right.outcomeReportFingerprint;
}

function cloneSeed(seed: Readonly<PlayAdoptionSeed>): PlayAdoptionSeed {
  if (seed.kind === 'event') return { kind: 'event', eventId: seed.eventId };
  if (seed.kind === 'observation') {
    return { kind: 'observation', observationId: seed.observationId };
  }
  return {
    kind: 'outcome',
    outcomeItemId: seed.outcomeItemId,
    outcomeReportFingerprint: seed.outcomeReportFingerprint,
  };
}

function toPendingActionView(
  value: Readonly<PlayAdoptionPendingActionView>,
): PlayAdoptionPendingActionView {
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    touchedFiles: [...value.touchedFiles],
    diff: value.diff,
    createdAt: value.createdAt,
    status: value.status,
  };
}

function applyPlayAdoptionSessionUpdate(
  session: Readonly<PlaySession>,
  update: Readonly<PlayAdoptionSessionUpdate>,
  candidate: Readonly<PlayAdoptionCandidate>,
): PlaySession {
  if (
    update.sessionId !== session.id ||
    update.baseRevision !== session.revision ||
    update.revision !== session.revision + 1 ||
    session.adoptionCandidates.some((item) => item.id === candidate.id)
  ) {
    throw new Error('Play adoption session update is stale or duplicated.');
  }
  return {
    ...structuredClone(session),
    revision: update.revision,
    worldClock: {
      ...session.worldClock,
      revision: update.revision,
    },
    adoptionCandidates: [
      ...session.adoptionCandidates.map((item) => structuredClone(item)),
      structuredClone(candidate),
    ],
  };
}

function applyPlayAdoptionSessionRevision(
  session: Readonly<PlaySession>,
  update: Readonly<PlayAdoptionSessionUpdate>,
): PlaySession {
  if (
    update.sessionId !== session.id ||
    update.baseRevision !== session.revision ||
    update.revision !== session.revision + 1
  ) {
    throw new Error('Play adoption session revision is stale.');
  }
  return {
    ...structuredClone(session),
    revision: update.revision,
    worldClock: {
      ...session.worldClock,
      revision: update.revision,
    },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
