<script setup lang="ts">
import type {
  ReferenceDeconstructionAttemptSummary,
  ReferenceDeconstructionStageId,
  ReferenceDeconstructionUnitSummary,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  attempts: readonly ReferenceDeconstructionAttemptSummary[];
  units: readonly ReferenceDeconstructionUnitSummary[];
}>();

const stageLabels: Record<ReferenceDeconstructionStageId, string> = {
  detectStructure: 'Detect structure',
  quickPreview: 'Quick Preview',
  chapterAnalysis: 'Chapter analysis',
  aggregateAnalysis: 'Aggregate analysis',
  styleProfile: 'Style Profile',
  distillForOan: 'Distill for OAN',
  materialChapterAnalysis: 'Material chapter analysis',
  materialAggregateAnalysis: 'Material aggregate analysis',
  materialProjection: 'Story Material projection',
  qualityGate: 'Analysis quality',
};

const trackLabels = {
  technique: 'Technique',
  storyMaterial: 'Story Materials',
} as const;

function attemptUnitLabel(attempt: ReferenceDeconstructionAttemptSummary): string {
  const unit = props.units.find((candidate) => candidate.id === attempt.unitId);
  if (!unit) return attempt.unitId;
  const chapter = unit.chapterId ? ` · Chapter ${unit.chapterId}` : '';
  return `Unit ${unit.ordinal}${chapter} · ${trackLabels[unit.track]} · ${stageLabels[unit.stageId]}`;
}

function completedLabel(attempt: ReferenceDeconstructionAttemptSummary): string {
  if (!attempt.completedAt) return 'in progress';
  return attempt.completedAt.replace('T', ' ').replace('.000Z', 'Z');
}
</script>

<template>
  <section class="reference-attempt-history" aria-label="Recent attempt history">
    <div class="reference-section-heading">
      <h5>Recent attempts</h5>
      <span>{{ attempts.length }}</span>
    </div>
    <p v-if="!attempts.length" class="reference-progress-copy">
      No full-analysis attempt has started.
    </p>
    <ul v-else class="reference-attempt-list">
      <li
        v-for="attempt in attempts"
        :key="attempt.id"
        class="reference-attempt-card"
      >
        <strong>{{ attemptUnitLabel(attempt) }}</strong>
        <span>Attempt {{ attempt.attemptNumber }} · {{ attempt.status }}</span>
        <small>{{ completedLabel(attempt) }}</small>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reference-attempt-history {
  display: grid;
  gap: 6px;
}

.reference-section-heading,
.reference-attempt-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reference-section-heading h5,
.reference-progress-copy {
  margin: 0;
}

.reference-progress-copy,
.reference-attempt-card span,
.reference-attempt-card small {
  color: rgb(100 116 139);
}

.reference-attempt-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reference-attempt-card {
  flex-wrap: wrap;
  padding: 8px;
  border-radius: 6px;
  background: rgb(255 255 255);
}

:global([data-theme="dark"]) .reference-attempt-card {
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-progress-copy,
:global([data-theme="dark"]) .reference-attempt-card span,
:global([data-theme="dark"]) .reference-attempt-card small {
  color: rgb(163 163 163);
}
</style>
