<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';

import ReferenceImportForm from './ReferenceImportForm.vue';
import ReferenceList from './ReferenceList.vue';
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

const enabledCount = computed(() =>
  references.value.filter((reference) => reference.enabled).length,
);

onMounted(() => {
  void refreshReferences();
});

async function refreshReferences() {
  loading.value = true;
  error.value = '';

  try {
    references.value = (await api.listReferences()).references;
    selection.value = (await api.selectReferenceContext({
      tokenBudget: 1500,
      maxReferences: 3,
    })).selection;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function importReference(input: ReferenceImportInput) {
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

async function toggleReference(reference: ReferenceWorkSummary) {
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
        <p class="empty-copy">{{ enabledCount }} enabled · {{ references.length }} total</p>
      </div>
      <button class="ghost-button tight-button" type="button" :disabled="loading" @click="refreshReferences">
        Refresh
      </button>
    </div>

    <p v-if="error" class="error-copy">{{ error }}</p>
    <p v-if="loading" class="empty-copy">Reading references...</p>

    <ReferenceImportForm :importing="importing" @import="importReference" />

    <article v-if="lastImport" class="reference-import-result">
      <div class="panel-heading">
        <h3 class="panel-title">{{ lastImport.reference.title }}</h3>
        <span class="status-pill">{{ lastImport.manifest.detectedStructure.confidence }}</span>
      </div>
      <div class="reference-meta-grid">
        <div class="status-block">
          <span>Chapters</span>
          <strong>{{ lastImport.manifest.detectedStructure.chapterCount }}</strong>
        </div>
        <div class="status-block">
          <span>Files</span>
          <strong>{{ lastImport.createdFiles.length }}</strong>
        </div>
      </div>
      <p class="reference-path">{{ lastImport.reference.bundlePath }}</p>
      <p class="reference-checksum">{{ lastImport.reference.checksumSha256 }}</p>
    </article>

    <section class="reference-context-panel" aria-label="Reference context selection">
      <div class="panel-heading">
        <h3 class="panel-title">Context Selector</h3>
        <span class="status-pill">{{ selection?.originalSourceRead ? 'source read' : 'distilled only' }}</span>
      </div>
      <p class="empty-copy">{{ selection?.tokenBudget ?? 1500 }} tokens · no-copy guardrail active</p>
      <div v-if="selection?.noCopyWarnings.length" class="reference-context-list">
        <div v-for="warning in selection.noCopyWarnings" :key="warning" class="reference-context-row">
          <strong>No-copy</strong>
          <span>{{ warning }}</span>
        </div>
      </div>
      <div v-if="selection?.included.length" class="reference-context-list">
        <div v-for="item in selection.included" :key="item.id" class="reference-context-row">
          <strong>{{ item.title }}</strong>
          <span>{{ item.path }} · {{ item.budgetLayer }}/{{ item.semanticBoundary }} · {{ item.reason }}</span>
        </div>
      </div>
      <p v-else class="empty-copy">No reference context selected.</p>
      <div v-if="selection?.omitted.length" class="reference-context-list">
        <div v-for="item in selection.omitted" :key="`${item.id}:${item.reason}`" class="reference-context-row">
          <strong>{{ item.title }}</strong>
          <span>Omitted {{ item.budgetLayer }}: {{ item.reason }}</span>
        </div>
      </div>
    </section>

    <ReferenceList
      :references="references"
      :updating-id="updatingId"
      @toggle-enabled="toggleReference"
    />
  </section>
</template>

<style scoped>
.reference-import-result,
.reference-context-panel {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(255 255 255);
}

:global([data-theme="dark"]) .reference-import-result,
:global([data-theme="dark"]) .reference-context-panel {
  border-color: rgb(64 64 64);
  background: rgb(23 23 23);
}

.reference-meta-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reference-path,
.reference-checksum {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-path,
:global([data-theme="dark"]) .reference-checksum {
  color: rgb(163 163 163);
}

.reference-context-list {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.reference-context-row {
  display: grid;
  gap: 4px;
  padding: 8px;
  border-radius: 8px;
  background: rgb(248 250 252);
}

:global([data-theme="dark"]) .reference-context-row {
  background: rgb(38 38 38);
}

.reference-context-row span {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-context-row span {
  color: rgb(163 163 163);
}
</style>
