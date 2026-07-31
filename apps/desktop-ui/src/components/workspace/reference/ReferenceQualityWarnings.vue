<script setup lang="ts">
import { computed } from 'vue';

import type {
  ReferenceDeconstructionAnalysisQualityStatus,
  ReferenceDeconstructionDiagnostic,
} from '../../../composables/useWorkspaceApi';

const props = withDefaults(defineProps<{
  status: ReferenceDeconstructionAnalysisQualityStatus;
  diagnostics: readonly ReferenceDeconstructionDiagnostic[];
  requireExpansion?: boolean;
}>(), {
  requireExpansion: false,
});

const emit = defineEmits<{
  reviewed: [];
}>();

const warnings = computed(() =>
  props.diagnostics.filter((diagnostic) => !diagnostic.blocking),
);
const warningGroups = computed(() => {
  const groups = new Map<string, ReferenceDeconstructionDiagnostic[]>();
  for (const diagnostic of warnings.value) {
    const items = groups.get(diagnostic.code) ?? [];
    items.push(diagnostic);
    groups.set(diagnostic.code, items);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, diagnostics]) => ({ code, diagnostics }));
});
const qualityConclusion = computed(() => {
  if (props.status === 'failed') return 'Failed — structural integrity problem';
  if (props.status === 'warned') return `Warned — ${warnings.value.length} notice(s)`;
  if (props.status === 'passed') return 'Passed — no quality notices';
  return 'Not evaluated';
});

function diagnosticLocation(diagnostic: ReferenceDeconstructionDiagnostic): string {
  return [
    diagnostic.stageId ? `Stage ${diagnostic.stageId}` : undefined,
    diagnostic.chapterId ? `Chapter ${diagnostic.chapterId}` : undefined,
    diagnostic.unitId ? `Unit ${diagnostic.unitId}` : undefined,
    diagnostic.pointerId ? `Pointer ${diagnostic.pointerId}` : undefined,
  ].filter((part): part is string => Boolean(part)).join(' · ');
}

function diagnosticAdvice(code: string): string {
  if (code.includes('copyRisk.exactOverlap')) {
    return 'Inspect the named output and rewrite the overlapping expression before Accept if needed.';
  }
  if (code.includes('missingCategory')) {
    return 'Confirm that publishing without this category is acceptable for the current analysis.';
  }
  if (code.includes('uncertainty')) {
    return 'Verify the uncertain conclusion against its evidence before relying on it.';
  }
  return 'Review this notice and decide whether the candidate is suitable to publish.';
}

function handleToggle(event: Event): void {
  if ((event.currentTarget as HTMLDetailsElement).open) emit('reviewed');
}
</script>

<template>
  <section class="reference-quality-warnings" aria-label="Reference quality conclusion">
    <div class="reference-quality-heading">
      <span>Quality conclusion</span>
      <strong>{{ qualityConclusion }}</strong>
    </div>

    <details
      v-if="warningGroups.length"
      class="reference-quality-details"
      :open="!requireExpansion"
      @toggle="handleToggle"
    >
      <summary>Review {{ warnings.length }} non-blocking warning(s)</summary>
      <section
        v-for="group in warningGroups"
        :key="group.code"
        class="reference-quality-group"
      >
        <h6>{{ group.code }} · {{ group.diagnostics.length }}</h6>
        <ul>
          <li v-for="diagnostic in group.diagnostics" :key="diagnostic.id">
            <span>{{ diagnostic.message }}</span>
            <small v-if="diagnosticLocation(diagnostic)">
              {{ diagnosticLocation(diagnostic) }}
            </small>
            <small v-if="diagnostic.evidenceRefs.length">
              Evidence {{ diagnostic.evidenceRefs.join(', ') }}
            </small>
            <small>Suggested action: {{ diagnosticAdvice(diagnostic.code) }}</small>
          </li>
        </ul>
      </section>
    </details>
    <p v-else class="reference-quality-empty">
      No non-blocking quality warnings remain.
    </p>
  </section>
</template>

<style scoped>
.reference-quality-warnings,
.reference-quality-group,
.reference-quality-group li {
  display: grid;
  gap: 6px;
}

.reference-quality-warnings {
  padding: 8px;
  border: 1px solid rgb(245 158 11);
  border-radius: 6px;
  background: rgb(255 251 235);
}

.reference-quality-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.reference-quality-heading span,
.reference-quality-group small {
  color: rgb(120 53 15);
  font-size: 12px;
}

.reference-quality-details summary {
  cursor: pointer;
  font-weight: 700;
}

.reference-quality-group h6 {
  margin: 8px 0 0;
  font-size: 12px;
}

.reference-quality-group ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reference-quality-group li {
  padding: 7px;
  border-radius: 5px;
  background: rgb(255 255 255 / 72%);
}

.reference-quality-empty {
  margin: 0;
  color: rgb(71 85 105);
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-quality-warnings {
  border-color: rgb(180 83 9);
  background: rgb(69 26 3 / 50%);
}

:global([data-theme="dark"]) .reference-quality-heading span,
:global([data-theme="dark"]) .reference-quality-group small {
  color: rgb(253 230 138);
}

:global([data-theme="dark"]) .reference-quality-group li {
  background: rgb(15 23 42 / 58%);
}
</style>
