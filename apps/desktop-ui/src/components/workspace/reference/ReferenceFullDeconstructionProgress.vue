<script setup lang="ts">
import ReferenceAttemptHistory from './ReferenceAttemptHistory.vue';
import ReferenceFullStageCoverage from './ReferenceFullStageCoverage.vue';
import type {
  ReferenceDeconstructionFullRun,
  ReferenceDeconstructionRunStatus,
} from '../../../composables/useWorkspaceApi';

defineProps<{
  full: ReferenceDeconstructionFullRun;
  status: ReferenceDeconstructionRunStatus;
  advancing: boolean;
  pausing: boolean;
  resuming: boolean;
  retrying: boolean;
  canAdvance: boolean;
  canPause: boolean;
  canResume: boolean;
  canRetry: boolean;
}>();

const emit = defineEmits<{
  advance: [];
  pause: [];
  resume: [];
  retry: [unitId: string];
}>();
</script>

<template>
  <section class="reference-full-progress" aria-label="Full deconstruction progress">
    <div class="reference-section-heading">
      <div>
        <h4>Full Deconstruction</h4>
        <p class="reference-progress-copy">
          One explicit action processes at most one bounded unit.
        </p>
      </div>
      <span class="status-pill">{{ status }}</span>
    </div>

    <ReferenceFullStageCoverage :full="full" :advancing="advancing" />

    <div class="pending-actions reference-full-actions">
      <button
        v-if="full.nextUnit && (status === 'fullApproved' || status === 'fullRunning')"
        class="primary-button tight-button"
        type="button"
        :disabled="!canAdvance"
        @click="emit('advance')"
      >
        {{ advancing ? 'Running one unit…' : 'Run next unit' }}
      </button>
      <button
        v-if="status === 'fullRunning'"
        class="secondary-button tight-button"
        type="button"
        :disabled="!canPause"
        @click="emit('pause')"
      >
        {{ pausing ? 'Pausing…' : 'Pause between units' }}
      </button>
      <button
        v-if="status === 'paused' || status === 'interrupted'"
        class="primary-button tight-button"
        type="button"
        :disabled="!canResume"
        @click="emit('resume')"
      >
        {{ resuming ? 'Resuming…' : 'Resume full analysis' }}
      </button>
      <button
        v-if="full.failedUnit"
        class="primary-button tight-button"
        type="button"
        :disabled="!canRetry"
        @click="emit('retry', full.failedUnit.id)"
      >
        {{ retrying ? 'Requeuing…' : 'Retry failed unit' }}
      </button>
    </div>

    <ReferenceAttemptHistory
      :attempts="full.recentAttempts"
      :units="full.recentUnits"
    />

    <div v-if="full.analysisQuality" class="reference-analysis-quality">
      <strong>Analysis quality: {{ full.analysisQuality.status }}</strong>
      <span>
        Coverage {{ full.analysisQuality.coveragePercent }}% ·
        {{ full.analysisQuality.blockingDiagnosticCount }} blocking diagnostic(s)
      </span>
    </div>
    <p v-if="status === 'reviewReady'" class="reference-review-ready">
      Analysis quality passed. D0–D3 results are ready for later candidate review and publish;
      the reference bundle has not been published by this run.
    </p>
  </section>
</template>

<style scoped>
.reference-full-progress {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgb(148 163 184);
  border-radius: 8px;
  background: rgb(248 250 252);
}

.reference-section-heading,
.reference-analysis-quality {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reference-section-heading h4,
.reference-progress-copy,
.reference-review-ready {
  margin: 0;
}

.reference-progress-copy,
.reference-analysis-quality span {
  color: rgb(100 116 139);
}

.reference-analysis-quality,
.reference-review-ready {
  padding: 8px;
  border-radius: 6px;
  background: rgb(255 255 255);
}

.reference-analysis-quality {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.reference-review-ready {
  border: 1px solid rgb(22 163 74);
  background: rgb(240 253 244);
}

.reference-full-actions {
  flex-wrap: wrap;
}

:global([data-theme="dark"]) .reference-full-progress {
  border-color: rgb(82 82 82);
  background: rgb(38 38 38);
}

:global([data-theme="dark"]) .reference-analysis-quality {
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-review-ready {
  background: rgb(20 83 45 / 25%);
}

:global([data-theme="dark"]) .reference-progress-copy,
:global([data-theme="dark"]) .reference-analysis-quality span {
  color: rgb(163 163 163);
}
</style>
