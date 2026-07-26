<script setup lang="ts">
import { computed } from 'vue';

import type { ReferenceContextSelection } from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  selection?: ReferenceContextSelection;
}>();

const includedEntries = computed(() =>
  props.selection?.included ?? [],
);
const omittedEntries = computed(() =>
  props.selection?.omitted ?? [],
);

function omittedKey(entry: ReferenceContextSelection['omitted'][number]): string {
  return [
    entry.scope,
    entry.referenceId,
    entry.entryId ?? '',
    entry.reasonCode,
  ].join(':');
}
</script>

<template>
  <section class="reference-context-panel" aria-label="Reference context selection">
    <div class="panel-heading">
      <h3 class="panel-title">Context Selector</h3>
      <span class="status-pill">
        {{ selection?.originalSourceRead ? 'unexpected source read' : 'distilled only' }}
      </span>
    </div>
    <p
      v-if="selection?.originalSourceRead"
      class="reference-source-read-error"
      role="alert"
    >
      This selector response violated the distilled-only boundary and cannot be used.
    </p>
    <p class="empty-copy">
      {{ selection?.usedTokens ?? 0 }} / {{ selection?.tokenBudget ?? 1500 }} tokens ·
      {{ selection?.maxEntries ?? 0 }} entry cap ·
      {{ selection?.maxReferences ?? 0 }} reference cap ·
      no-copy guardrail active
    </p>
    <div v-if="selection?.noCopyWarnings.length" class="reference-context-list">
      <div v-for="warning in selection.noCopyWarnings" :key="warning" class="reference-context-row">
        <strong>No-copy</strong>
        <span>{{ warning }}</span>
      </div>
    </div>
    <div v-if="selection?.differentiationWarnings.length" class="reference-context-list">
      <div
        v-for="warning in selection.differentiationWarnings"
        :key="warning"
        class="reference-context-row"
      >
        <strong>Differentiation</strong>
        <span>{{ warning }}</span>
      </div>
    </div>
    <div v-if="includedEntries.length" class="reference-context-list">
      <article
        v-for="item in includedEntries"
        :key="`${item.referenceId ?? item.id}:${item.id}`"
        class="reference-context-row"
      >
        <div class="reference-context-heading">
          <strong>{{ item.referenceTitle }} · {{ item.entryTitle }}</strong>
          <small>{{ item.category }} · {{ item.estimatedTokens }} tokens</small>
        </div>
        <span>{{ item.id }}</span>
        <span>
          {{ item.reasonCode }}: {{ item.reason }}
        </span>
        <span>
          {{ item.path }} · {{ item.budgetLayer }}/{{ item.semanticBoundary }}
        </span>
        <span v-if="item.tags.length">Tags {{ item.tags.join(', ') }}</span>
        <span v-if="item.capabilityIds.length">
          Capabilities {{ item.capabilityIds.join(', ') }}
        </span>
      </article>
    </div>
    <p v-else class="empty-copy">No eligible reference context selected.</p>
    <div v-if="omittedEntries.length" class="reference-context-list">
      <article
        v-for="item in omittedEntries"
        :key="omittedKey(item)"
        class="reference-context-row"
      >
        <div class="reference-context-heading">
          <strong>
            {{ item.referenceTitle }}
            <template v-if="item.entryTitle"> · {{ item.entryTitle }}</template>
          </strong>
          <small>
            {{ item.scope }}
            <template v-if="item.category"> · {{ item.category }}</template>
          </small>
        </div>
        <span v-if="item.entryId">{{ item.entryId }}</span>
        <span>
          Omitted {{ item.budgetLayer }} · {{ item.reasonCode }}: {{ item.reason }}
        </span>
        <span v-if="item.estimatedTokens !== undefined">
          Estimated {{ item.estimatedTokens }} tokens
        </span>
      </article>
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

.reference-context-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.reference-context-heading small {
  color: rgb(71 85 105);
}

.reference-context-row span {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-size: 12px;
}

.reference-source-read-error {
  margin: 8px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: rgb(254 226 226);
  color: rgb(185 28 28);
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

:global([data-theme="dark"]) .reference-context-heading small {
  color: rgb(163 163 163);
}

:global([data-theme="dark"]) .reference-source-read-error {
  background: rgb(127 29 29 / 30%);
}

@media (max-width: 880px) {
  .reference-context-heading {
    display: grid;
  }
}
</style>
