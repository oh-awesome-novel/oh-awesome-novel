<script setup lang="ts">
import { computed } from 'vue';

import type { ReferenceDeconstructionDiagnostic } from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  diagnostics: ReferenceDeconstructionDiagnostic[];
}>();

const blockingCount = computed(() =>
  props.diagnostics.filter((diagnostic) => diagnostic.blocking).length,
);
</script>

<template>
  <section v-if="diagnostics.length" class="reference-diagnostics" aria-label="Preview diagnostics">
    <div class="reference-section-heading">
      <h4>Diagnostics</h4>
      <span class="status-pill">
        {{ blockingCount ? `${blockingCount} blocking` : `${diagnostics.length} notices` }}
      </span>
    </div>
    <ul class="reference-diagnostic-list">
      <li
        v-for="diagnostic in diagnostics"
        :key="diagnostic.id"
        class="reference-diagnostic"
        :class="`reference-diagnostic-${diagnostic.severity}`"
      >
        <strong>{{ diagnostic.code }}</strong>
        <span>{{ diagnostic.message }}</span>
        <small v-if="diagnostic.evidenceRefs.length">
          Evidence {{ diagnostic.evidenceRefs.join(', ') }}
        </small>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reference-diagnostics {
  display: grid;
  gap: 8px;
}

.reference-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reference-section-heading h4 {
  margin: 0;
}

.reference-diagnostic-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reference-diagnostic {
  display: grid;
  gap: 3px;
  padding: 8px;
  border-left: 3px solid rgb(148 163 184);
  border-radius: 6px;
  background: rgb(248 250 252);
}

.reference-diagnostic-warning {
  border-left-color: rgb(217 119 6);
}

.reference-diagnostic-error {
  border-left-color: rgb(220 38 38);
}

.reference-diagnostic span,
.reference-diagnostic small {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
}

:global([data-theme="dark"]) .reference-diagnostic {
  background: rgb(38 38 38);
}

:global([data-theme="dark"]) .reference-diagnostic span,
:global([data-theme="dark"]) .reference-diagnostic small {
  color: rgb(163 163 163);
}
</style>
