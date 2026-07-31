<script setup lang="ts">
import ReferenceMaterialAdoptionPreview from './ReferenceMaterialAdoptionPreview.vue';
import ReferenceMaterialEntrySelector from './ReferenceMaterialEntrySelector.vue';
import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionDecision,
  ReferenceMaterialAdoptionPendingActionResult,
  ReferenceMaterialAdoptionPreview as AdoptionPreview,
  ReferenceMaterialAdoptionSelection,
} from '../../../composables/useWorkspaceApi';

defineProps<{
  catalog?: ReferenceMaterialAdoptionCatalog;
  preview?: AdoptionPreview;
  noChangeDecisions: readonly ReferenceMaterialAdoptionDecision[];
  pendingAction?: ReferenceMaterialAdoptionPendingActionResult['pendingAction'];
  loading: boolean;
  previewing: boolean;
  confirming: boolean;
  error: string;
}>();

const emit = defineEmits<{
  preview: [selections: ReferenceMaterialAdoptionSelection[]];
  confirm: [];
  review: [pendingActionId: string];
  clear: [];
}>();
</script>

<template>
  <section class="reference-material-adoption-panel" aria-label="Story Material adoption">
    <div class="panel-heading">
      <div>
        <h3 class="panel-title">Adopt Story Materials</h3>
        <p class="empty-copy">
          Map selected published material into controlled project files through a reviewable diff.
        </p>
      </div>
      <span class="status-pill">
        {{ loading ? 'Loading' : previewing ? 'Generating preview' : confirming ? 'Confirming' : 'Manual' }}
      </span>
    </div>

    <p class="material-adoption-boundary">
      Published reference material is evidence, not Project Truth. Nothing is written until its
      PendingAction is accepted in Review.
    </p>
    <p v-if="error" class="error-copy" role="alert">{{ error }}</p>
    <p v-if="loading" class="empty-copy">Reading the current published material catalog…</p>

    <template v-else-if="catalog">
      <p v-if="catalog.warnings.length" class="material-adoption-warning">
        This publication has {{ catalog.warnings.length }} non-blocking warning(s). Preserve
        uncertainty and verify the final diff before accepting it.
      </p>
      <ReferenceMaterialEntrySelector
        v-if="!preview && !noChangeDecisions.length && !pendingAction"
        :catalog="catalog"
        :disabled="previewing || confirming"
        @preview="emit('preview', $event)"
      />
      <ReferenceMaterialAdoptionPreview
        v-else
        :preview="preview"
        :no-change-decisions="noChangeDecisions"
        :pending-action="pendingAction"
        :confirming="confirming"
        @confirm="emit('confirm')"
        @review="emit('review', $event)"
        @clear="emit('clear')"
      />
    </template>
  </section>
</template>

<style scoped>
.reference-material-adoption-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 10px;
}

.material-adoption-boundary,
.material-adoption-warning {
  margin: 0;
  font-size: 12px;
}

.material-adoption-boundary {
  color: rgb(71 85 105);
}

.material-adoption-warning {
  padding: 8px;
  border-radius: 6px;
  background: rgb(254 243 199);
  color: rgb(146 64 14);
}

:global([data-theme="dark"]) .reference-material-adoption-panel {
  border-color: rgb(64 64 64);
}

:global([data-theme="dark"]) .material-adoption-boundary {
  color: rgb(163 163 163);
}
</style>
