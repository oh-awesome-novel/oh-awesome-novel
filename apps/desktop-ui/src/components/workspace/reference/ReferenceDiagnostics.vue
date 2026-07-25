<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import type {
  ReferenceDeconstructionDiagnostic,
  ReferenceDeconstructionDiagnosticSeverity,
  ReferenceDeconstructionStageId,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  diagnostics: readonly ReferenceDeconstructionDiagnostic[];
}>();

type SeverityFilter = 'all' | ReferenceDeconstructionDiagnosticSeverity;
type StageFilter = 'all' | ReferenceDeconstructionStageId;

const severityFilter = shallowRef<SeverityFilter>('all');
const stageFilter = shallowRef<StageFilter>('all');
const chapterFilter = shallowRef('all');
const blockingCount = computed(() =>
  props.diagnostics.filter((diagnostic) => diagnostic.blocking).length,
);
const stageOptions = computed(() =>
  [...new Set(props.diagnostics.flatMap((diagnostic) =>
    diagnostic.stageId ? [diagnostic.stageId] : []))].sort(),
);
const chapterOptions = computed(() =>
  [...new Set(props.diagnostics.flatMap((diagnostic) =>
    diagnostic.chapterId ? [diagnostic.chapterId] : []))].sort(),
);
const visibleDiagnostics = computed(() =>
  props.diagnostics.filter((diagnostic) =>
    (severityFilter.value === 'all' || diagnostic.severity === severityFilter.value) &&
    (stageFilter.value === 'all' || diagnostic.stageId === stageFilter.value) &&
    (chapterFilter.value === 'all' || diagnostic.chapterId === chapterFilter.value)),
);
const visibleBlockingCount = computed(() =>
  visibleDiagnostics.value.filter((diagnostic) => diagnostic.blocking).length,
);

function diagnosticLocation(diagnostic: ReferenceDeconstructionDiagnostic): string {
  return [
    diagnostic.stageId ? `Stage ${diagnostic.stageId}` : undefined,
    diagnostic.chapterId ? `Chapter ${diagnostic.chapterId}` : undefined,
    diagnostic.unitId ? `Unit ${diagnostic.unitId}` : undefined,
    diagnostic.attemptId ? `Attempt ${diagnostic.attemptId}` : undefined,
  ].filter((part): part is string => Boolean(part)).join(' · ');
}
</script>

<template>
  <section
    v-if="diagnostics.length"
    class="reference-diagnostics"
    aria-label="Deconstruction diagnostics"
  >
    <div class="reference-section-heading">
      <h4>Diagnostics</h4>
      <span class="status-pill">
        {{ blockingCount ? `${blockingCount} blocking` : `${diagnostics.length} notices` }}
      </span>
    </div>

    <p v-if="blockingCount" class="reference-blocking-explanation" role="alert">
      Blocking diagnostics prevent full approval or review-ready quality completion.
      {{ visibleBlockingCount }} blocking item(s) are visible with the current filters.
    </p>

    <div class="reference-diagnostic-filters">
      <label>
        Severity
        <select v-model="severityFilter">
          <option value="all">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
      </label>
      <label>
        Stage
        <select v-model="stageFilter">
          <option value="all">All stages</option>
          <option v-for="stage in stageOptions" :key="stage" :value="stage">
            {{ stage }}
          </option>
        </select>
      </label>
      <label>
        Chapter
        <select v-model="chapterFilter">
          <option value="all">All chapters</option>
          <option v-for="chapter in chapterOptions" :key="chapter" :value="chapter">
            {{ chapter }}
          </option>
        </select>
      </label>
    </div>

    <p v-if="!visibleDiagnostics.length" class="reference-diagnostic-empty">
      No diagnostics match these filters.
    </p>
    <ul v-else class="reference-diagnostic-list">
      <li
        v-for="diagnostic in visibleDiagnostics"
        :key="diagnostic.id"
        class="reference-diagnostic"
        :class="`reference-diagnostic-${diagnostic.severity}`"
      >
        <div class="reference-diagnostic-heading">
          <strong>{{ diagnostic.code }}</strong>
          <span>{{ diagnostic.severity }}{{ diagnostic.blocking ? ' · blocking' : '' }}</span>
        </div>
        <span>{{ diagnostic.message }}</span>
        <small v-if="diagnosticLocation(diagnostic)">
          {{ diagnosticLocation(diagnostic) }}
        </small>
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

.reference-blocking-explanation,
.reference-diagnostic-empty {
  margin: 0;
  padding: 8px;
  border-radius: 6px;
  background: rgb(254 242 242);
  color: rgb(185 28 28);
}

.reference-diagnostic-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}

.reference-diagnostic-filters label {
  display: grid;
  gap: 4px;
  color: rgb(100 116 139);
  font-size: 12px;
}

.reference-diagnostic-filters select {
  min-width: 0;
  padding: 6px;
  border: 1px solid rgb(203 213 225);
  border-radius: 6px;
  background: rgb(255 255 255);
  color: inherit;
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

.reference-diagnostic-heading {
  display: flex;
  justify-content: space-between;
  gap: 8px;
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

:global([data-theme="dark"]) .reference-blocking-explanation,
:global([data-theme="dark"]) .reference-diagnostic-empty {
  background: rgb(127 29 29 / 25%);
}

:global([data-theme="dark"]) .reference-diagnostic-filters label {
  color: rgb(163 163 163);
}

:global([data-theme="dark"]) .reference-diagnostic-filters select {
  border-color: rgb(82 82 82);
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-diagnostic span,
:global([data-theme="dark"]) .reference-diagnostic small {
  color: rgb(163 163 163);
}
</style>
