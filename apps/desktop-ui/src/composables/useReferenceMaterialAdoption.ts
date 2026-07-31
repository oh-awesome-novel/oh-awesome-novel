import { computed, shallowReadonly, shallowRef } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionDecision,
  ReferenceMaterialAdoptionPendingActionResult,
  ReferenceMaterialAdoptionPreview,
  ReferenceMaterialAdoptionSelection,
} from './useWorkspaceApi';

type WorkspaceApi = ReturnType<typeof useWorkspaceApi>;

export type ReferenceMaterialAdoptionClient = Pick<WorkspaceApi,
  | 'getReferenceMaterialAdoptionCatalog'
  | 'createReferenceMaterialAdoptionPreview'
  | 'createReferenceMaterialAdoptionPendingAction'
>;

export interface UseReferenceMaterialAdoptionOptions {
  client?: ReferenceMaterialAdoptionClient;
  onPendingActionCreated?: (pendingActionId: string) => void;
}

export function useReferenceMaterialAdoption(
  options: UseReferenceMaterialAdoptionOptions = {},
) {
  const client = options.client ?? useWorkspaceApi();
  const referenceId = shallowRef('');
  const catalog = shallowRef<ReferenceMaterialAdoptionCatalog>();
  const preview = shallowRef<ReferenceMaterialAdoptionPreview>();
  const noChangeDecisions = shallowRef<ReferenceMaterialAdoptionDecision[]>([]);
  const pendingAction = shallowRef<ReferenceMaterialAdoptionPendingActionResult['pendingAction']>();
  const loading = shallowRef(false);
  const previewing = shallowRef(false);
  const confirming = shallowRef(false);
  const error = shallowRef('');
  let epoch = 0;

  const busy = computed(() => loading.value || previewing.value || confirming.value);

  async function load(nextReferenceId: string): Promise<void> {
    const requestEpoch = ++epoch;
    referenceId.value = nextReferenceId;
    catalog.value = undefined;
    preview.value = undefined;
    noChangeDecisions.value = [];
    pendingAction.value = undefined;
    error.value = '';
    if (!nextReferenceId) return;
    loading.value = true;
    try {
      const result = await client.getReferenceMaterialAdoptionCatalog(nextReferenceId);
      if (requestEpoch !== epoch || referenceId.value !== nextReferenceId) return;
      catalog.value = result.catalog;
    } catch (caught) {
      if (requestEpoch !== epoch) return;
      error.value = toErrorMessage(caught);
    } finally {
      if (requestEpoch === epoch) loading.value = false;
    }
  }

  async function requestPreview(
    selections: ReferenceMaterialAdoptionSelection[],
  ): Promise<boolean> {
    const activeCatalog = catalog.value;
    if (!activeCatalog || previewing.value || confirming.value) return false;
    const requestEpoch = ++epoch;
    previewing.value = true;
    preview.value = undefined;
    noChangeDecisions.value = [];
    pendingAction.value = undefined;
    error.value = '';
    try {
      const result = await client.createReferenceMaterialAdoptionPreview(
        activeCatalog.referenceId,
        {
          catalogFingerprint: activeCatalog.fingerprint,
          selections: selections.map((selection) => ({ ...selection })),
        },
      );
      if (
        requestEpoch !== epoch
        || catalog.value?.fingerprint !== activeCatalog.fingerprint
      ) return false;
      if (result.status === 'ready') {
        preview.value = result.preview;
      } else {
        noChangeDecisions.value = result.decisions.map((decision) => ({ ...decision }));
      }
      return true;
    } catch (caught) {
      if (requestEpoch !== epoch) return false;
      error.value = toErrorMessage(caught);
      return false;
    } finally {
      if (requestEpoch === epoch) previewing.value = false;
    }
  }

  async function confirm(): Promise<boolean> {
    const activePreview = preview.value;
    if (!activePreview || confirming.value) return false;
    const requestEpoch = ++epoch;
    confirming.value = true;
    error.value = '';
    try {
      const result = await client.createReferenceMaterialAdoptionPendingAction(
        activePreview.referenceId,
        activePreview.id,
        { fingerprint: activePreview.fingerprint },
      );
      if (requestEpoch !== epoch || preview.value?.id !== activePreview.id) return false;
      pendingAction.value = { ...result.pendingAction };
      options.onPendingActionCreated?.(result.pendingAction.id);
      return true;
    } catch (caught) {
      if (requestEpoch !== epoch) return false;
      error.value = toErrorMessage(caught);
      return false;
    } finally {
      if (requestEpoch === epoch) confirming.value = false;
    }
  }

  function clearPreview(): void {
    epoch += 1;
    preview.value = undefined;
    noChangeDecisions.value = [];
    pendingAction.value = undefined;
    previewing.value = false;
    confirming.value = false;
    error.value = '';
  }

  return {
    catalog: shallowReadonly(catalog),
    preview: shallowReadonly(preview),
    noChangeDecisions: shallowReadonly(noChangeDecisions),
    pendingAction: shallowReadonly(pendingAction),
    loading: shallowReadonly(loading),
    previewing: shallowReadonly(previewing),
    confirming: shallowReadonly(confirming),
    busy,
    error: shallowReadonly(error),
    load,
    requestPreview,
    confirm,
    clearPreview,
  };
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
