<script setup lang="ts">
import { computed } from 'vue';

import type {
  ReferenceDeconstructionFullRun,
  ReferenceDeconstructionStageId,
  ReferenceDeconstructionUnitSummary,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  full: ReferenceDeconstructionFullRun;
  advancing: boolean;
}>();

const stageLabels: Record<ReferenceDeconstructionStageId, string> = {
  detectStructure: 'Detect structure',
  quickPreview: 'Quick Preview',
  chapterAnalysis: 'Chapter analysis',
  aggregateAnalysis: 'Aggregate analysis',
  styleProfile: 'Style Profile',
  distillForOan: 'Distill for OAN',
  qualityGate: 'Analysis quality',
};

const progressSummary = computed(() => {
  const progress = props.full.progress;
  return `${progress.completedUnits}/${progress.plannedUnits} units · ` +
    `${progress.completedChapters}/${progress.totalChapters} chapters`;
});

function stageLabel(stageId: ReferenceDeconstructionStageId): string {
  return stageLabels[stageId];
}

function unitLabel(unit: ReferenceDeconstructionUnitSummary): string {
  const chapter = unit.chapterId ? ` · Chapter ${unit.chapterId}` : '';
  return `Unit ${unit.ordinal + 1}${chapter} · ${stageLabel(unit.stageId)}`;
}
</script>

<template>
  <div class="reference-progress-summary">
    <div>
      <strong>{{ full.progress.percent }}%</strong>
      <span>{{ progressSummary }}</span>
    </div>
    <progress :value="full.progress.percent" max="100">
      {{ full.progress.percent }}%
    </progress>
    <span v-if="full.progress.failedUnits" class="reference-failed-count">
      {{ full.progress.failedUnits }} failed unit(s)
    </span>
  </div>

  <ul class="reference-stage-list">
    <li
      v-for="stage in full.stages"
      :key="stage.stageId"
      class="reference-stage-card"
    >
      <div>
        <strong>{{ stageLabel(stage.stageId) }}</strong>
        <span>{{ stage.status }}</span>
      </div>
      <small>
        {{ stage.completedUnits }}/{{ stage.plannedUnits }} completed
        <template v-if="stage.failedUnits"> · {{ stage.failedUnits }} failed</template>
      </small>
    </li>
  </ul>

  <p v-if="advancing" class="reference-unit-notice">
    Running one bounded unit. A later unit will not start automatically.
  </p>
  <p v-else-if="full.currentUnit" class="reference-unit-notice">
    Current: {{ unitLabel(full.currentUnit) }}
  </p>
  <p v-if="full.nextUnit" class="reference-unit-notice">
    Next: {{ unitLabel(full.nextUnit) }}
  </p>
  <p v-if="full.failedUnit" class="reference-unit-failure" role="alert">
    Failed: {{ unitLabel(full.failedUnit) }}. Retry only requeues this unit; run it with a
    separate explicit advance.
  </p>
</template>

<style scoped>
.reference-progress-summary {
  display: grid;
  gap: 6px;
}

.reference-progress-summary > div,
.reference-stage-card > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reference-progress-summary progress {
  width: 100%;
}

.reference-failed-count,
.reference-unit-failure {
  color: rgb(185 28 28);
}

.reference-stage-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reference-stage-card,
.reference-unit-notice,
.reference-unit-failure {
  padding: 8px;
  border-radius: 6px;
  background: rgb(255 255 255);
}

.reference-stage-card {
  display: grid;
  gap: 4px;
}

.reference-stage-card span,
.reference-stage-card small {
  color: rgb(100 116 139);
}

.reference-unit-notice,
.reference-unit-failure {
  margin: 0;
}

:global([data-theme="dark"]) .reference-stage-card,
:global([data-theme="dark"]) .reference-unit-notice,
:global([data-theme="dark"]) .reference-unit-failure {
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-stage-card span,
:global([data-theme="dark"]) .reference-stage-card small {
  color: rgb(163 163 163);
}
</style>
