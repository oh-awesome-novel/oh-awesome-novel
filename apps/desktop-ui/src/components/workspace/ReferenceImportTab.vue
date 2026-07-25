<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';

import ReferenceImportForm from './ReferenceImportForm.vue';
import ReferenceList from './ReferenceList.vue';
import ReferenceContextSelectionPanel from './reference/ReferenceContextSelectionPanel.vue';
import ReferenceDeconstructionPanel from './reference/ReferenceDeconstructionPanel.vue';
import ReferenceImportResultCard from './reference/ReferenceImportResultCard.vue';
import { useReferenceDeconstruction } from '../../composables/useReferenceDeconstruction';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  ReferenceContextSelection,
  ReferenceImportInput,
  ReferenceImportResult,
  ReferenceWorkSummary,
} from '../../composables/useWorkspaceApi';

const api = useWorkspaceApi();
const references = shallowRef<ReferenceWorkSummary[]>([]);
const selection = shallowRef<ReferenceContextSelection>();
const lastImport = shallowRef<ReferenceImportResult>();
const loading = shallowRef(false);
const importing = shallowRef(false);
const updatingId = shallowRef('');
const error = shallowRef('');
const deconstruction = useReferenceDeconstruction({ client: api });

const enabledCount = computed(() =>
  references.value.filter((reference) => reference.enabled).length,
);
const eligibleCount = computed(() =>
  references.value.filter((reference) => reference.contextEligible).length,
);

onMounted(() => {
  void refreshReferences();
});

async function refreshReferences(): Promise<void> {
  loading.value = true;
  error.value = '';

  try {
    const listed = await api.listReferences();
    references.value = listed.references;
    await deconstruction.syncReferences(listed.references);
    selection.value = (await api.selectReferenceContext({
      tokenBudget: 1500,
      maxReferences: 3,
      capability: 'novel.write_chapter',
      goal: 'Inspect eligible distilled reference context from the References panel.',
    })).selection;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function importReference(input: ReferenceImportInput): Promise<void> {
  importing.value = true;
  error.value = '';

  try {
    lastImport.value = await api.importReference(input);
    await refreshReferences();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    importing.value = false;
  }
}

async function toggleReference(reference: ReferenceWorkSummary): Promise<void> {
  updatingId.value = reference.id;
  error.value = '';

  try {
    await api.setReferenceEnabled(reference.id, !reference.enabled);
    await refreshReferences();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    updatingId.value = '';
  }
}
</script>

<template>
  <section class="right-tab-panel" aria-label="Reference import">
    <div class="panel-heading">
      <div>
        <h2 class="panel-title">References</h2>
        <p class="empty-copy">
          {{ enabledCount }} enabled preferences · {{ eligibleCount }} context eligible ·
          {{ references.length }} total
        </p>
      </div>
      <button
        class="ghost-button tight-button"
        type="button"
        :disabled="loading || deconstruction.busy.value"
        @click="refreshReferences"
      >
        Refresh
      </button>
    </div>

    <p v-if="error" class="error-copy" role="alert">{{ error }}</p>
    <p v-if="loading" class="empty-copy">Reading references...</p>

    <ReferenceImportForm :importing="importing" @import="importReference" />
    <ReferenceImportResultCard v-if="lastImport" :result="lastImport" />
    <ReferenceContextSelectionPanel :selection="selection" />

    <ReferenceDeconstructionPanel
      :reference="deconstruction.selectedReference.value"
      :run="deconstruction.run.value"
      :loading-active-run="deconstruction.loadingActiveRun.value"
      :creating="deconstruction.creating.value"
      :advancing="deconstruction.advancing.value"
      :cancelling="deconstruction.cancelling.value"
      :approving="deconstruction.approving.value"
      :pausing="deconstruction.pausing.value"
      :resuming="deconstruction.resuming.value"
      :retrying="deconstruction.retrying.value"
      :reconciling="deconstruction.reconciling.value"
      :indeterminate="deconstruction.indeterminate.value"
      :error="deconstruction.error.value"
      :can-start="deconstruction.canStart.value"
      :can-advance="deconstruction.canAdvance.value"
      :can-advance-full="deconstruction.canAdvanceFull.value"
      :can-pause="deconstruction.canPause.value"
      :can-resume="deconstruction.canResume.value"
      :can-retry="deconstruction.canRetry.value"
      :can-cancel="deconstruction.canCancel.value"
      :can-approve="deconstruction.canApprove.value"
      :needs-reconcile="deconstruction.needsReconcile.value"
      @start-preview="deconstruction.startPreview(undefined, $event)"
      @advance-preview="deconstruction.advancePreview()"
      @cancel="deconstruction.cancel()"
      @reconcile="deconstruction.reconcile()"
      @approve-full="deconstruction.approveFull()"
      @advance-full="deconstruction.advanceFull()"
      @pause-full="deconstruction.pauseFull()"
      @resume-full="deconstruction.resumeFull()"
      @retry-failed-unit="deconstruction.retryFailedUnit($event)"
    />

    <ReferenceList
      :references="references"
      :updating-id="updatingId"
      :selected-id="deconstruction.selectedReference.value?.id ?? ''"
      :selection-disabled="deconstruction.busy.value"
      @select="deconstruction.selectReference($event)"
      @toggle-enabled="toggleReference"
    />
  </section>
</template>
