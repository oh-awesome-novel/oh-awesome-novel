import MiniSearch from 'minisearch';
import { computed, type Ref } from 'vue';

import type { WorkspaceSummary } from './useWorkspaceApi';

export function useWorkspaceSearch(
  workspaces: Ref<WorkspaceSummary[]>,
  query: Ref<string>,
) {
  const index = computed(() => {
    const miniSearch = new MiniSearch<WorkspaceSummary>({
      fields: ['name', 'novelName', 'path'],
      storeFields: ['name', 'novelName', 'path', 'lastOpenedAt', 'addedAt', 'valid', 'reason'],
      idField: 'path',
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
      },
    });
    miniSearch.addAll(workspaces.value);
    return miniSearch;
  });

  const results = computed(() => {
    const normalizedQuery = query.value.trim();

    if (!normalizedQuery) {
      return [...workspaces.value].sort((left, right) =>
        (right.lastOpenedAt ?? right.addedAt ?? '').localeCompare(
          left.lastOpenedAt ?? left.addedAt ?? '',
        ),
      );
    }

    return index.value.search(normalizedQuery).map((result) => ({
      name: result.name,
      novelName: result.novelName,
      path: result.path,
      lastOpenedAt: result.lastOpenedAt,
      addedAt: result.addedAt,
      valid: result.valid,
      reason: result.reason,
    }));
  });

  return { results };
}
