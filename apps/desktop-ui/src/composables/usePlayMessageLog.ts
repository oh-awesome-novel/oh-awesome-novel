import { computed, shallowRef, type Ref } from 'vue';

import type { PlayMessageLogEntry, PlayMessageLogPage } from './useWorkspaceApi';

export interface PlayMessageLogClient {
  getPlayMessageLog(id: string, options?: {
    cursor?: number;
    limit?: number;
  }): Promise<PlayMessageLogPage>;
}

export type PlayMessageLogKindFilter = 'all' | 'author' | 'request' | 'reasoning' | 'output' | 'outcome';

export const PLAY_MESSAGE_LOG_KIND_FILTERS: ReadonlyArray<{
  value: PlayMessageLogKindFilter;
  label: string;
}> = [
  { value: 'all', label: '全部' },
  { value: 'author', label: '作者行动' },
  { value: 'request', label: '模型请求' },
  { value: 'reasoning', label: '思考过程' },
  { value: 'output', label: '模型输出' },
  { value: 'outcome', label: '回合结果' },
];

const KIND_GROUPS: Record<Exclude<PlayMessageLogKindFilter, 'all'>, readonly string[]> = {
  author: ['author_action'],
  request: ['model_request'],
  reasoning: ['model_reasoning'],
  output: ['model_output'],
  outcome: ['turn_committed', 'turn_cancelled', 'turn_failed'],
};

const PAGE_SIZE = 200;

/**
 * Reads the append-only Play debug log page by page. The log is debug data;
 * nothing here feeds Play state.
 */
export function usePlayMessageLog(options: {
  client: PlayMessageLogClient;
  sessionId: Ref<string | undefined>;
}) {
  const entries = shallowRef<PlayMessageLogEntry[]>([]);
  const skippedLines = shallowRef(0);
  const nextCursor = shallowRef<number | undefined>();
  const loading = shallowRef(false);
  const error = shallowRef('');
  const kindFilter = shallowRef<PlayMessageLogKindFilter>('all');
  const participantFilter = shallowRef('');
  let loadedSessionId: string | undefined;
  let generation = 0;

  const participants = computed(() => [...new Set(entries.value
    .map(participantKey)
    .filter((key): key is string => Boolean(key)))]);

  const visibleEntries = computed(() => entries.value.filter((entry) => {
    if (kindFilter.value !== 'all' && !KIND_GROUPS[kindFilter.value].includes(entry.kind)) {
      return false;
    }
    return !participantFilter.value || participantKey(entry) === participantFilter.value;
  }));

  async function reload(): Promise<void> {
    const sessionId = options.sessionId.value;
    generation += 1;
    entries.value = [];
    skippedLines.value = 0;
    nextCursor.value = undefined;
    loadedSessionId = sessionId;
    if (!sessionId) return;
    await loadPage(sessionId, 0, generation);
  }

  async function loadMore(): Promise<void> {
    const sessionId = loadedSessionId;
    if (!sessionId || nextCursor.value === undefined || loading.value) return;
    await loadPage(sessionId, nextCursor.value, generation);
  }

  async function loadPage(sessionId: string, cursor: number, requestGeneration: number): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const page = await options.client.getPlayMessageLog(sessionId, { cursor, limit: PAGE_SIZE });
      if (requestGeneration !== generation) return;
      entries.value = [...entries.value, ...page.entries];
      skippedLines.value += page.skippedLines;
      nextCursor.value = page.nextCursor;
    } catch (caught) {
      if (requestGeneration !== generation) return;
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (requestGeneration === generation) loading.value = false;
    }
  }

  return {
    entries,
    visibleEntries,
    participants,
    skippedLines,
    hasMore: computed(() => nextCursor.value !== undefined),
    loading,
    error,
    kindFilter,
    participantFilter,
    reload,
    loadMore,
  };
}

export function participantKey(entry: PlayMessageLogEntry): string | undefined {
  if (entry.participantRef) return entry.participantRef;
  return entry.role === 'world_referee' ? 'world_referee' : undefined;
}

export function playMessageLogKindLabel(entry: PlayMessageLogEntry): string {
  switch (entry.kind) {
    case 'author_action': return '作者行动';
    case 'model_request': return '模型请求';
    case 'model_reasoning': return '思考过程';
    case 'model_output': return '模型输出';
    case 'turn_committed': return '回合已提交';
    case 'turn_cancelled': return '回合已取消';
    case 'turn_failed': return '回合失败';
    default: return entry.kind;
  }
}

export function playMessageLogRoleLabel(entry: PlayMessageLogEntry): string {
  switch (entry.role) {
    case 'world_referee': return 'World referee';
    case 'rehearsal_actor': return entry.participantRef ? `Actor · ${entry.participantRef}` : 'Actor';
    case 'rehearsal_referee': return 'Rehearsal referee';
    default: return entry.role ?? '';
  }
}
