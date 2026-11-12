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
  beforeLoad?(sessionId: string): Promise<void>;
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
      await options.beforeLoad?.(sessionId);
      if (!isCurrentSelection(generation, sessionId)) return false;
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
        announcement.value = `已载入 ${page.items.length} 条更早的消息，显示 ${merged.length} / ${page.totalCount} 条。`;
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
        announcement.value = `已载入 ${page.items.length} 条更早的事件，显示 ${merged.length} / ${page.totalCount} 条。`;
      }
      return true;
    } catch (caught) {
      if (!isCurrentSelection(generation, sessionId)) return false;
      if (isStaleCursorError(caught)) {
        announcement.value = '选中的分支已改变，历史已按当前状态刷新。';
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
        ? `已另开推演会话 ${result.createdSessionId ?? draft.newSessionId}。`
        : `已对推演上下文应用“${formatDecisionKind(draft.kind)}”。`;
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
    transcriptWindowLabel: formatTraceWindow(trace.transcriptWindow, '消息'),
    eventWindowLabel: formatTraceWindow(trace.eventWindow, '事件'),
    sources: trace.sources.map((source, index) => ({
      id: directorLens ? source.sourceId : `${trace.artifactId}:source:${index + 1}`,
      label: directorLens
        ? source.path ?? source.sourceId
        : `启用的来源 ${index + 1}`,
      outcome: source.outcome,
      ...(source.originWork ? { workLabel: directorLens ? source.originWork.title : `作品 ${[...new Set(trace.sources.flatMap(s => s.originWork?.id ?? []))].indexOf(source.originWork.id) + 1}` } : {}),
      ...(source.omissionReason
        ? { reason: directorLens ? source.omissionReason : '本回合未选用' }
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
        : `启用的来源 ${index + 1}`,
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
      ? { activeResolution: `当前处理：${formatDecisionKind(status.activeResolution.kind)}` }
      : {}),
  };
}

function formatTraceWindow(
  window: Readonly<PlayTurnContextTrace['transcriptWindow']>,
  noun: string,
): string {
  return `选用 ${window.selectedCount} / ${window.availableCount} 条${noun}` +
    (window.omittedCount ? ` · 因窗口限制省略 ${window.omittedCount} 条` : '');
}

function formatHashEvidence(expected?: string, actual?: string): string {
  if (!expected && !actual) return '';
  const compact = (value: string | undefined) => value ? value.slice(0, 12) : '不可用';
  return `hash ${compact(expected)} → ${compact(actual)}`;
}

function formatDecisionKind(kind: PlaySourceDriftDecision['kind']): string {
  if (kind === 'continueFrozen') return '沿用开局时的内容';
  if (kind === 'reassemble') return '按当前文件重组';
  return '另开会话';
}

function formatWindowReady(detail: Readonly<PlaySessionSelectedDetail>): string {
  return `显示 ${detail.transcript.items.length} / ${detail.transcript.totalCount} 条消息、${detail.events.items.length} / ${detail.events.totalCount} 条事件。`;
}

function isStaleCursorError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return /cursor|selected branch|revision|stale/iu.test(message);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
