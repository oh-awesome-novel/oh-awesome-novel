import { computed, shallowReadonly, shallowRef } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionDecision,
  ReferenceMaterialAdoptionPendingActionResult,
  ReferenceMaterialAdoptionPreflight,
  ReferenceMaterialAdoptionPreview,
  ReferenceMaterialAdoptionRecords,
  ReferenceMaterialAdoptionSelection,
  ReferenceMaterialAdoptionTargetSuggestions,
} from './useWorkspaceApi';

type WorkspaceApi = ReturnType<typeof useWorkspaceApi>;

export type ReferenceMaterialAdoptionClient = Pick<WorkspaceApi,
  | 'getReferenceMaterialAdoptionCatalog'
  | 'createReferenceMaterialAdoptionPreview'
  | 'createReferenceMaterialAdoptionPendingAction'
> & Partial<Pick<WorkspaceApi,
  | 'preflightReferenceMaterialAdoption'
  | 'listReferenceMaterialAdoptionRecords'
>>;

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
  const targetSuggestions = shallowRef<ReferenceMaterialAdoptionTargetSuggestions>();
  const preflight = shallowRef<ReferenceMaterialAdoptionPreflight>();
  /** The exact batch the current preflight checked; a preview is only ever requested for it. */
  const preflightSelections = shallowRef<ReferenceMaterialAdoptionSelection[]>([]);
  const records = shallowRef<ReferenceMaterialAdoptionRecords>();
  const recordsError = shallowRef('');
  const preview = shallowRef<ReferenceMaterialAdoptionPreview>();
  const noChangeDecisions = shallowRef<ReferenceMaterialAdoptionDecision[]>([]);
  const pendingAction = shallowRef<ReferenceMaterialAdoptionPendingActionResult['pendingAction']>();
  const loading = shallowRef(false);
  const preflighting = shallowRef(false);
  const previewing = shallowRef(false);
  const confirming = shallowRef(false);
  const error = shallowRef('');
  let epoch = 0;
  let recordsEpoch = 0;

  const busy = computed(() =>
    loading.value || preflighting.value || previewing.value || confirming.value);

  async function load(nextReferenceId: string): Promise<void> {
    const requestEpoch = ++epoch;
    recordsEpoch += 1;
    referenceId.value = nextReferenceId;
    catalog.value = undefined;
    targetSuggestions.value = undefined;
    preflight.value = undefined;
    preflightSelections.value = [];
    records.value = undefined;
    recordsError.value = '';
    preview.value = undefined;
    noChangeDecisions.value = [];
    pendingAction.value = undefined;
    preflighting.value = false;
    error.value = '';
    if (!nextReferenceId) return;
    loading.value = true;
    try {
      const result = await client.getReferenceMaterialAdoptionCatalog(nextReferenceId);
      if (requestEpoch !== epoch || referenceId.value !== nextReferenceId) return;
      catalog.value = result.catalog;
      targetSuggestions.value = result.targetSuggestions;
    } catch (caught) {
      if (requestEpoch !== epoch) return;
      error.value = toErrorMessage(caught);
    } finally {
      if (requestEpoch === epoch) loading.value = false;
    }
    if (requestEpoch === epoch && catalog.value) await refreshRecords();
  }

  /** Records are a convenience view; failing to read them never blocks adoption. */
  async function refreshRecords(): Promise<void> {
    const activeReferenceId = referenceId.value;
    if (!activeReferenceId || !client.listReferenceMaterialAdoptionRecords) return;
    const requestEpoch = ++recordsEpoch;
    try {
      const result = await client.listReferenceMaterialAdoptionRecords(activeReferenceId);
      if (requestEpoch !== recordsEpoch || referenceId.value !== activeReferenceId) return;
      records.value = result;
      recordsError.value = '';
    } catch (caught) {
      if (requestEpoch !== recordsEpoch) return;
      records.value = undefined;
      recordsError.value = toErrorMessage(caught);
    }
  }

  /** Checks the batch with no model call. Any later selection change must call `clearPreflight`. */
  async function requestPreflight(
    selections: ReferenceMaterialAdoptionSelection[],
  ): Promise<boolean> {
    const activeCatalog = catalog.value;
    if (
      !activeCatalog || !client.preflightReferenceMaterialAdoption
      || preflighting.value || previewing.value || confirming.value
    ) return false;
    const requestEpoch = ++epoch;
    const batch = selections.map((selection) => ({ ...selection }));
    preflighting.value = true;
    preflight.value = undefined;
    preflightSelections.value = [];
    error.value = '';
    try {
      const result = await client.preflightReferenceMaterialAdoption(
        activeCatalog.referenceId,
        { catalogFingerprint: activeCatalog.fingerprint, selections: batch },
      );
      if (
        requestEpoch !== epoch
        || catalog.value?.fingerprint !== activeCatalog.fingerprint
      ) return false;
      preflight.value = result.preflight;
      preflightSelections.value = batch;
      return true;
    } catch (caught) {
      if (requestEpoch !== epoch) return false;
      error.value = toErrorMessage(caught);
      return false;
    } finally {
      if (requestEpoch === epoch) preflighting.value = false;
    }
  }

  function clearPreflight(): void {
    if (!preflight.value && !preflighting.value) return;
    epoch += 1;
    preflight.value = undefined;
    preflightSelections.value = [];
    preflighting.value = false;
  }

  /** Generates the preview for the batch the ready preflight checked. */
  async function requestPreflightedPreview(): Promise<boolean> {
    if (preflight.value?.status !== 'ready' || !preflightSelections.value.length) return false;
    return requestPreview(preflightSelections.value);
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
      void refreshRecords();
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
    targetSuggestions: shallowReadonly(targetSuggestions),
    preflight: shallowReadonly(preflight),
    records: shallowReadonly(records),
    recordsError: shallowReadonly(recordsError),
    preview: shallowReadonly(preview),
    noChangeDecisions: shallowReadonly(noChangeDecisions),
    pendingAction: shallowReadonly(pendingAction),
    loading: shallowReadonly(loading),
    preflighting: shallowReadonly(preflighting),
    previewing: shallowReadonly(previewing),
    confirming: shallowReadonly(confirming),
    busy,
    error: shallowReadonly(error),
    load,
    refreshRecords,
    requestPreflight,
    clearPreflight,
    requestPreflightedPreview,
    requestPreview,
    confirm,
    clearPreview,
  };
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
