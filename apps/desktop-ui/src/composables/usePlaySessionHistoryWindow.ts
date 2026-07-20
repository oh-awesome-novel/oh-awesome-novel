import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowReadonly,
  shallowRef,
  watch,
} from 'vue';
import type { Ref } from 'vue';

import type {
  PlaySourceDriftDecision,
  PlaySourceDriftDecisionResult,
  PlaySourceDriftStatus,
  PlaySessionSelectedDetail,
  PlayTurnContextTrace,
} from './useWorkspaceApi';
import type {
  PlayContextTraceView,
  PlaySourceDriftDecisionDraft,
  PlaySourceDriftView,
} from '../components/play/context/types';

const PLAY_HISTORY_WINDOW_SIZE = 50;
const PLAY_CONTEXT_TRACE_LIMIT = 20;

export interface PlaySessionHistoryWindowClient {
  getPlaySessionDetail(
    id: string,
    options?: {
      limit?: number;
      transcriptCursor?: string;
      eventCursor?: string;
    },
  ): Promise<{ detail: PlaySessionSelectedDetail }>;
  listPlayContextTraces(
    id: string,
    options?: { limit?: number },
  ): Promise<{ traces: PlayTurnContextTrace[] }>;
  getPlaySourceDrift(id: string): Promise<{ status: PlaySourceDriftStatus }>;
  decidePlaySourceDrift(
    id: string,
    decision: PlaySourceDriftDecision,
  ): Promise<PlaySourceDriftDecisionResult>;
}

export interface UsePlaySessionHistoryWindowOptions {
  client: PlaySessionHistoryWindowClient;
  selectedSessionId: Readonly<Ref<string>>;
  directorLens: Readonly<Ref<boolean>>;
  onDecision(result: PlaySourceDriftDecisionResult): void;
  onError?(error: unknown): void;
}

export function usePlaySessionHistoryWindow(
  options: UsePlaySessionHistoryWindowOptions,
) {
  const detail = shallowRef<PlaySessionSelectedDetail>();
  const rawTraces = shallowRef<PlayTurnContextTrace[]>([]);
  const rawDrift = shallowRef<PlaySourceDriftStatus>();
  const loading = shallowRef(false);
  const loadingEarlierTranscript = shallowRef(false);
  const loadingEarlierEvents = shallowRef(false);
  const contextLoading = shallowRef(false);
  const decisionBusy = shallowRef(false);
  const error = shallowRef('');
  const contextError = shallowRef('');
  const announcement = shallowRef('');
  let selectionGeneration = 0;
  let contextGeneration = 0;
  let disposed = false;

  const traces = computed<PlayContextTraceView[]>(() =>
    rawTraces.value.map((trace) => projectContextTrace(
      trace,
      options.directorLens.value,
    )),
  );
  const drift = computed<PlaySourceDriftView | undefined>(() =>
    rawDrift.value
      ? projectSourceDrift(rawDrift.value, options.directorLens.value)
      : undefined,
  );

  watch(
    options.selectedSessionId,
    (sessionId, previousSessionId) => {
      if (sessionId === previousSessionId && detail.value?.snapshot.id === sessionId) {
        return;
      }
      reset();
    },
    { immediate: true, flush: 'sync' },
  );

  async function refreshSelected(): Promise<boolean> {
    const sessionId = options.selectedSessionId.value;
    if (!sessionId || disposed) return false;
    const generation = ++selectionGeneration;
    loading.value = true;
    error.value = '';
    try {
      const result = await options.client.getPlaySessionDetail(sessionId, {
        limit: PLAY_HISTORY_WINDOW_SIZE,
      });
      if (!isCurrentSelection(generation, sessionId)) return false;
      detail.value = result.detail;
      announcement.value = formatWindowReady(result.detail);
      void refreshContext();
      return true;
    } catch (caught) {
      if (isCurrentSelection(generation, sessionId)) {
        error.value = toErrorMessage(caught);
        options.onError?.(caught);
      }
      return false;
    } finally {
      if (generation === selectionGeneration) loading.value = false;
    }
  }

  async function loadEarlierTranscript(): Promise<boolean> {
    return loadEarlier('transcript');
  }

  async function loadEarlierEvents(): Promise<boolean> {
    return loadEarlier('event');
  }

  async function loadEarlier(kind: 'transcript' | 'event'): Promise<boolean> {
    const current = detail.value;
    const sessionId = options.selectedSessionId.value;
    const window = kind === 'transcript' ? current?.transcript : current?.events;
    if (
      !current ||
      current.snapshot.id !== sessionId ||
      !window?.hasMoreBefore ||
      !window.nextCursor ||
      loading.value ||
      loadingEarlierTranscript.value ||
      loadingEarlierEvents.value ||
      disposed
    ) return false;

    const revision = current.snapshot.revision;
    const cursor = window.nextCursor;
    const generation = selectionGeneration;
    const busyRef = kind === 'transcript'
      ? loadingEarlierTranscript
      : loadingEarlierEvents;
    busyRef.value = true;
    error.value = '';
    try {
      const result = await options.client.getPlaySessionDetail(sessionId, {
        limit: PLAY_HISTORY_WINDOW_SIZE,
        ...(kind === 'transcript'
          ? { transcriptCursor: cursor }
          : { eventCursor: cursor }),
      });
      if (
        !isCurrentSelection(generation, sessionId) ||
        detail.value !== current ||
        result.detail.snapshot.revision !== revision
      ) return false;

      // Opaque cursors describe adjacent, non-overlapping ranges. Do not
      // deduplicate transcript rows by id because historical messages may
      // legitimately omit that optional field.
      if (kind === 'transcript') {
        const page = result.detail.transcript;
        const merged = [...page.items, ...current.transcript.items];
        detail.value = {
          ...current,
          summary: result.detail.summary,
          snapshot: result.detail.snapshot,
          transcript: { ...page, items: merged },
        };
        announcement.value = `Loaded ${page.items.length} earlier messages; showing ${merged.length} of ${page.totalCount}.`;
      } else {
        const page = result.detail.events;
        const seenEventIds = new Set<string>();
        const merged = [...page.items, ...current.events.items].filter((event) => {
          if (seenEventIds.has(event.id)) return false;
          seenEventIds.add(event.id);
          return true;
        });
        const presentationByEventId = new Map([
          ...result.detail.eventPresentation,
          ...current.eventPresentation,
        ].map((evidence) => [evidence.eventId, evidence]));
        const mergedPresentation = merged.map((event) => {
          const evidence = presentationByEventId.get(event.id);
          if (!evidence) {
            throw new Error(`Play event presentation is missing: ${event.id}.`);
          }
          return evidence;
        });
        detail.value = {
          ...current,
          summary: result.detail.summary,
          snapshot: result.detail.snapshot,
          events: { ...page, items: merged },
          eventPresentation: mergedPresentation,
        };
        announcement.value = `Loaded ${page.items.length} earlier events; showing ${merged.length} of ${page.totalCount}.`;
      }
      return true;
    } catch (caught) {
      if (!isCurrentSelection(generation, sessionId)) return false;
      if (isStaleCursorError(caught)) {
        announcement.value = 'The selected branch changed; history was refreshed from current truth.';
        return refreshSelected();
      }
      error.value = toErrorMessage(caught);
      options.onError?.(caught);
      return false;
    } finally {
      busyRef.value = false;
    }
  }

  async function refreshContext(): Promise<boolean> {
    const sessionId = options.selectedSessionId.value;
    if (!sessionId || disposed) return false;
    const generation = ++contextGeneration;
    contextLoading.value = true;
    contextError.value = '';
    const [traceResult, driftResult] = await Promise.allSettled([
      options.client.listPlayContextTraces(sessionId, {
        limit: PLAY_CONTEXT_TRACE_LIMIT,
      }),
      options.client.getPlaySourceDrift(sessionId),
    ]);
    if (!isCurrentContext(generation, sessionId)) return false;
    if (traceResult.status === 'fulfilled') {
      rawTraces.value = traceResult.value.traces;
    }
    if (driftResult.status === 'fulfilled') {
      rawDrift.value = driftResult.value.status;
    }
    const failures = [traceResult, driftResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => toErrorMessage(result.reason));
    if (failures.length) contextError.value = failures.join(' ');
    contextLoading.value = false;
    return failures.length === 0;
  }

  async function decideSourceDrift(
    draft: PlaySourceDriftDecisionDraft,
  ): Promise<boolean> {
    const current = detail.value;
    const sessionId = options.selectedSessionId.value;
    if (
      !current ||
      current.snapshot.id !== sessionId ||
      decisionBusy.value ||
      loading.value ||
      disposed
    ) return false;
    const decision: PlaySourceDriftDecision = {
      ...draft,
      baseRevision: current.snapshot.revision,
    };
    decisionBusy.value = true;
    contextError.value = '';
    try {
      const result = await options.client.decidePlaySourceDrift(sessionId, decision);
      options.onDecision(result);
      rawDrift.value = result.status;
      announcement.value = draft.kind === 'fork'
        ? `Forked Play session ${result.createdSessionId ?? draft.newSessionId}.`
        : `Applied ${formatDecisionKind(draft.kind)} to Play-local context.`;
      // The callback updates the selected id synchronously for Fork. Reload
      // from the bounded read model so a source decision never leaves a full
      // mutation response as renderer state.
      await refreshSelected();
      return true;
    } catch (caught) {
      contextError.value = toErrorMessage(caught);
      options.onError?.(caught);
      return false;
    } finally {
      decisionBusy.value = false;
    }
  }

  function reset(): void {
    selectionGeneration += 1;
    contextGeneration += 1;
    detail.value = undefined;
    rawTraces.value = [];
    rawDrift.value = undefined;
    loading.value = false;
    loadingEarlierTranscript.value = false;
    loadingEarlierEvents.value = false;
    contextLoading.value = false;
    decisionBusy.value = false;
    error.value = '';
    contextError.value = '';
    announcement.value = '';
  }

  function dispose(): void {
    disposed = true;
    reset();
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    detail: shallowReadonly(detail),
    transcript: computed(() => detail.value?.transcript),
    events: computed(() => detail.value?.events),
    traces,
    drift,
    loading: readonly(loading),
    loadingEarlierTranscript: readonly(loadingEarlierTranscript),
    loadingEarlierEvents: readonly(loadingEarlierEvents),
    contextLoading: readonly(contextLoading),
    decisionBusy: readonly(decisionBusy),
    error: readonly(error),
    contextError: readonly(contextError),
    announcement: readonly(announcement),
    refreshSelected,
    loadEarlierTranscript,
    loadEarlierEvents,
    refreshContext,
    decideSourceDrift,
    reset,
    dispose,
  };

  function isCurrentSelection(generation: number, sessionId: string): boolean {
    return !disposed &&
      generation === selectionGeneration &&
      options.selectedSessionId.value === sessionId;
  }

  function isCurrentContext(generation: number, sessionId: string): boolean {
    return !disposed &&
      generation === contextGeneration &&
      options.selectedSessionId.value === sessionId;
  }
}

export function projectContextTrace(
  trace: Readonly<PlayTurnContextTrace>,
  directorLens: boolean,
): PlayContextTraceView {
  return {
    id: trace.artifactId,
    createdAt: trace.createdAt,
    transcriptWindowLabel: formatTraceWindow(trace.transcriptWindow, 'messages'),
    eventWindowLabel: formatTraceWindow(trace.eventWindow, 'events'),
    sources: trace.sources.map((source, index) => ({
      id: directorLens ? source.sourceId : `${trace.artifactId}:source:${index + 1}`,
      label: directorLens
        ? source.path ?? source.sourceId
        : `Activated source ${index + 1}`,
      outcome: source.outcome,
      ...(source.omissionReason
        ? { reason: directorLens ? source.omissionReason : 'not selected for this turn' }
        : {}),
      ...(directorLens
        ? {
            evidence: [
              source.trust,
              source.budgetLayer,
              source.semanticBoundary,
              formatHashEvidence(source.expectedContentHash, source.actualContentHash),
            ].filter(Boolean).join(' · '),
          }
        : {}),
    })),
  };
}

export function projectSourceDrift(
  status: Readonly<PlaySourceDriftStatus>,
  directorLens: boolean,
): PlaySourceDriftView {
  return {
    overall: status.overall,
    items: status.sources.map((source, index) => ({
      id: directorLens ? source.sourceId : `source-drift:${index + 1}`,
      label: directorLens
        ? source.path ?? source.sourceId
        : `Activated source ${index + 1}`,
      state: source.state,
      ...(directorLens
        ? { evidence: formatHashEvidence(
            source.expectedContentHash,
            source.actualContentHash,
          ) || source.state }
        : {}),
    })),
    availableDecisions: [...status.availableDecisions],
    ...(status.activeResolution
      ? { activeResolution: `Active decision: ${formatDecisionKind(status.activeResolution.kind)}` }
      : {}),
  };
}

function formatTraceWindow(
  window: Readonly<PlayTurnContextTrace['transcriptWindow']>,
  noun: string,
): string {
  return `${window.selectedCount} of ${window.availableCount} ${noun} selected` +
    (window.omittedCount ? ` · ${window.omittedCount} omitted by window limit` : '');
}

function formatHashEvidence(expected?: string, actual?: string): string {
  if (!expected && !actual) return '';
  const compact = (value: string | undefined) => value ? value.slice(0, 12) : 'unavailable';
  return `hash ${compact(expected)} → ${compact(actual)}`;
}

function formatDecisionKind(kind: PlaySourceDriftDecision['kind']): string {
  if (kind === 'continueFrozen') return 'continue frozen';
  if (kind === 'reassemble') return 'reassemble';
  return 'fork session';
}

function formatWindowReady(detail: Readonly<PlaySessionSelectedDetail>): string {
  return `Showing ${detail.transcript.items.length} of ${detail.transcript.totalCount} messages and ${detail.events.items.length} of ${detail.events.totalCount} events.`;
}

function isStaleCursorError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return /cursor|selected branch|revision|stale/iu.test(message);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
