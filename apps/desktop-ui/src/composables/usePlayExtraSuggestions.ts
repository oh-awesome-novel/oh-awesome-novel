import { computed, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';

import { parsePlayTurnChoices } from '@oh-awesome-novel/core/play-turn-choices';

import type { PlaySuggestedActionView } from './usePlayWorkspace';

export interface PlayExtraSuggestionsClient {
  requestPlayExtraSuggestions(
    id: string,
    input: { baseRevision: number; headId?: string; existing?: string[] },
    signal?: AbortSignal,
  ): Promise<{ suggestions: string[]; baseRevision: number; headId?: string }>;
}

export interface PlayExtraSuggestionsTarget {
  sessionId: string;
  revision: number;
  /** Selected head; undefined at the initial world. */
  headId?: string;
  /** Raw stored suggestion strings currently on screen. */
  existing: readonly string[];
}

/**
 * "再给几个行动建议" / "换一批": one read-only call per click. The batch lives
 * only in this composable. It is never written to the session, and it is
 * dropped as soon as the session, revision or selected head changes.
 */
export function usePlayExtraSuggestions(options: {
  client: PlayExtraSuggestionsClient;
  target: ComputedRef<PlayExtraSuggestionsTarget | undefined>;
  blocked: Readonly<Ref<boolean>>;
}) {
  const batch = shallowRef<{ key: string; raw: string[] }>();
  const loading = shallowRef(false);
  const error = shallowRef('');
  let controller: AbortController | undefined;

  const key = computed(() => {
    const target = options.target.value;
    return target ? `${target.sessionId}:${target.revision}:${target.headId ?? ''}` : '';
  });

  watch(key, () => {
    controller?.abort();
    controller = undefined;
    batch.value = undefined;
    loading.value = false;
    error.value = '';
  });

  const items = computed<PlaySuggestedActionView[] | undefined>(() => {
    const current = batch.value;
    if (!current || current.key !== key.value) return undefined;
    return parsePlayTurnChoices(current.raw).map((choice, index) => ({
      id: `${current.key}-extra-${index}`,
      label: choice.text,
      userText: choice.text,
      actionKind: choice.actionKind,
      ...(choice.timeAdvance ? { timeAdvance: choice.timeAdvance } : {}),
    }));
  });

  async function request(): Promise<boolean> {
    const target = options.target.value;
    if (!target || loading.value || options.blocked.value) return false;
    const requestKey = key.value;
    const existing = [...(batch.value?.key === requestKey ? batch.value.raw : []), ...target.existing];
    controller = new AbortController();
    const signal = controller.signal;
    loading.value = true;
    error.value = '';
    try {
      const result = await options.client.requestPlayExtraSuggestions(target.sessionId, {
        baseRevision: target.revision,
        ...(target.headId ? { headId: target.headId } : {}),
        ...(existing.length ? { existing: [...new Set(existing)].slice(0, 12) } : {}),
      }, signal);
      if (signal.aborted || key.value !== requestKey) return false;
      batch.value = { key: requestKey, raw: result.suggestions };
      return true;
    } catch (caught) {
      if (!signal.aborted && key.value === requestKey) {
        error.value = caught instanceof Error ? caught.message : String(caught);
      }
      return false;
    } finally {
      if (key.value === requestKey) loading.value = false;
    }
  }

  function cancel(): void {
    controller?.abort();
    loading.value = false;
  }

  return { items, loading, error, request, cancel };
}
