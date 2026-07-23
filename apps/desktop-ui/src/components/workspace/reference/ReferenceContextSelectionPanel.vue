<script setup lang="ts">
import type { ReferenceContextSelection } from '../../../composables/useWorkspaceApi';

defineProps<{
  selection?: ReferenceContextSelection;
}>();
</script>

<template>
  <section class="reference-context-panel" aria-label="Reference context selection">
    <div class="panel-heading">
      <h3 class="panel-title">Context Selector</h3>
      <span class="status-pill">
        {{ selection?.originalSourceRead ? 'source read' : 'distilled only' }}
      </span>
    </div>
    <p class="empty-copy">
      {{ selection?.tokenBudget ?? 1500 }} tokens · no-copy guardrail active
    </p>
    <div v-if="selection?.noCopyWarnings.length" class="reference-context-list">
      <div v-for="warning in selection.noCopyWarnings" :key="warning" class="reference-context-row">
        <strong>No-copy</strong>
        <span>{{ warning }}</span>
      </div>
    </div>
    <div v-if="selection?.included.length" class="reference-context-list">
      <div v-for="item in selection.included" :key="item.id" class="reference-context-row">
        <strong>{{ item.title }}</strong>
        <span>
          {{ item.path }} · {{ item.budgetLayer }}/{{ item.semanticBoundary }} · {{ item.reason }}
        </span>
      </div>
    </div>
    <p v-else class="empty-copy">No eligible reference context selected.</p>
    <div v-if="selection?.omitted.length" class="reference-context-list">
      <div
        v-for="item in selection.omitted"
        :key="`${item.id}:${item.reasonCode}`"
        class="reference-context-row"
      >
        <strong>{{ item.title }}</strong>
        <span>
          Omitted {{ item.budgetLayer }} · {{ item.reasonCode }}: {{ item.reason }}
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.reference-context-panel {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(255 255 255);
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

.reference-context-row span {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-context-panel {
  border-color: rgb(64 64 64);
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-context-row {
  background: rgb(38 38 38);
}

:global([data-theme="dark"]) .reference-context-row span {
  color: rgb(163 163 163);
}
</style>
