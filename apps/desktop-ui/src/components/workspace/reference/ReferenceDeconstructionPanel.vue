<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';

import ReferenceDiagnostics from './ReferenceDiagnostics.vue';
import ReferenceQuickPreview from './ReferenceQuickPreview.vue';
import type {
  ReferenceDeconstructionRun,
  ReferenceWorkSummary,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  reference?: ReferenceWorkSummary;
  run?: ReferenceDeconstructionRun;
  loadingActiveRun: boolean;
  creating: boolean;
  advancing: boolean;
  cancelling: boolean;
  approving: boolean;
  reconciling: boolean;
  indeterminate: boolean;
  error: string;
  canStart: boolean;
  canAdvance: boolean;
  canCancel: boolean;
  canApprove: boolean;
  needsReconcile: boolean;
}>();

const emit = defineEmits<{
  startPreview: [confirmDetectedRange?: true];
  advancePreview: [];
  cancel: [];
  reconcile: [];
  approveFull: [];
}>();

const confirmingFull = shallowRef(false);
const confirmingLowConfidenceRange = shallowRef(false);
const blockingDiagnosticCount = computed(() =>
  props.run?.diagnostics.filter((diagnostic) => diagnostic.blocking).length ?? 0,
);
const detectedPreviewChapterCount = computed(() =>
  Math.min(props.reference?.chapterCount ?? 0, 3),
);
const hasLowBoundaryConfidence = computed(() =>
  props.reference?.structureConfidence === 'low',
);

const statusLabel = computed(() => {
  if (props.loadingActiveRun) return 'Checking run';
  if (props.creating) return 'Creating preview';
  if (props.advancing) return 'Preview running';
  if (!props.run) return props.reference?.deconstructionStatus ?? 'Not selected';
  switch (props.run.status) {
    case 'created': return 'Preview created';
    case 'previewRunning': return 'Preview running';
    case 'awaitingFullApproval': return 'Preview ready';
    case 'fullApproved': return 'Full analysis approved';
    case 'cancelled': return 'Preview cancelled';
    case 'failed': return 'Preview failed';
    case 'interrupted': return 'Preview interrupted';
    case 'stale': return 'Source changed';
  }
});

watch(
  () => `${props.reference?.id ?? ''}:${props.run?.id ?? ''}:${props.run?.status ?? ''}`,
  () => {
    confirmingFull.value = false;
    confirmingLowConfidenceRange.value = false;
  },
);

function requestPreviewStart(): void {
  if (hasLowBoundaryConfidence.value && !confirmingLowConfidenceRange.value) {
    confirmingLowConfidenceRange.value = true;
    return;
  }
  const confirmDetectedRange = hasLowBoundaryConfidence.value ? true : undefined;
  confirmingLowConfidenceRange.value = false;
  emit('startPreview', confirmDetectedRange);
}

function requestFullApproval(): void {
  if (!confirmingFull.value) {
    confirmingFull.value = true;
    return;
  }
  confirmingFull.value = false;
  emit('approveFull');
}
</script>

<template>
  <section class="reference-deconstruction-panel" aria-label="Reference deconstruction">
    <div class="panel-heading">
      <div>
        <h3 class="panel-title">Deep Deconstruction</h3>
        <p v-if="reference" class="empty-copy">
          {{ reference.title }} · enabled preference {{ reference.enabled ? 'on' : 'off' }} ·
          boundary confidence {{ reference.structureConfidence }}
        </p>
      </div>
      <span class="status-pill">{{ statusLabel }}</span>
    </div>

    <p v-if="!reference" class="empty-copy">Select an imported reference to inspect or analyze.</p>
    <template v-else>
      <div class="reference-readiness-row">
        <span>Writing context</span>
        <strong>{{ reference.contextEligible ? 'Eligible' : 'Not eligible' }}</strong>
        <small>{{ reference.readinessReason }}</small>
      </div>

      <p v-if="hasLowBoundaryConfidence" class="reference-range-warning">
        Boundary confidence low. The default preview uses the detected first
        {{ detectedPreviewChapterCount }} chapter(s) out of {{ reference.chapterCount }}.
        Confirm this detected range before analysis.
      </p>

      <p v-if="error" class="error-copy" role="alert">{{ error }}</p>
      <p v-if="indeterminate" class="empty-copy">
        The last command has no proven terminal result. Reconcile authoritative run state before continuing.
      </p>

      <div class="pending-actions reference-deconstruction-actions">
        <button
          v-if="canStart"
          class="primary-button tight-button"
          type="button"
          :disabled="creating || loadingActiveRun"
          @click="requestPreviewStart"
        >
          {{ confirmingLowConfidenceRange
            ? `Confirm detected first ${detectedPreviewChapterCount} chapters`
            : run ? 'Start new preview' : 'Analyze preview' }}
        </button>
        <button
          v-if="canAdvance"
          class="primary-button tight-button"
          type="button"
          :disabled="advancing"
          @click="emit('advancePreview')"
        >
          {{ run?.status === 'interrupted' ? 'Retry bounded preview' : 'Run bounded preview' }}
        </button>
        <button
          v-if="canCancel"
          class="secondary-button tight-button"
          type="button"
          :disabled="cancelling"
          @click="emit('cancel')"
        >
          {{ cancelling ? 'Cancelling…' : 'Stop / cancel preview' }}
        </button>
        <button
          v-if="needsReconcile"
          class="secondary-button tight-button"
          type="button"
          :disabled="reconciling"
          @click="emit('reconcile')"
        >
          {{ reconciling ? 'Reconciling…' : 'Reconcile run' }}
        </button>
      </div>

      <ReferenceQuickPreview
        v-if="run?.preview"
        :preview="run.preview"
        :evidence="run.evidence"
      />
      <ReferenceDiagnostics
        v-if="run"
        :diagnostics="run.diagnostics"
      />

      <section
        v-if="run?.status === 'awaitingFullApproval'"
        class="reference-full-gate"
        aria-label="Full deconstruction confirmation"
      >
        <strong>Continue full deconstruction?</strong>
        <p>
          This records explicit permission for later bounded chapter analysis. It does not publish
          artifacts or start D2 automatically.
        </p>
        <p v-if="blockingDiagnosticCount" class="error-copy" role="alert">
          {{ blockingDiagnosticCount }} blocking diagnostic(s) must be resolved before full
          deconstruction can be approved.
        </p>
        <div class="pending-actions">
          <button
            class="primary-button tight-button"
            type="button"
            :disabled="!canApprove"
            @click="requestFullApproval"
          >
            {{ confirmingFull ? 'Confirm full deconstruction' : 'Continue full deconstruction' }}
          </button>
          <button
            v-if="confirmingFull"
            class="ghost-button tight-button"
            type="button"
            @click="confirmingFull = false"
          >
            Keep preview only
          </button>
        </div>
      </section>

      <p v-if="run?.status === 'fullApproved'" class="reference-full-approved">
        Full deconstruction is explicitly approved. D2 chapter processing is not part of this slice
        and has not started.
      </p>
    </template>
  </section>
</template>

<style scoped>
.reference-deconstruction-panel {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(255 255 255);
}

.reference-readiness-row {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: baseline;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: rgb(248 250 252);
}

.reference-readiness-row small {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  text-align: right;
}

.reference-deconstruction-actions {
  flex-wrap: wrap;
}

.reference-full-gate,
.reference-full-approved,
.reference-range-warning {
  margin: 0;
  padding: 10px;
  border: 1px solid rgb(37 99 235);
  border-radius: 8px;
  background: rgb(239 246 255);
}

.reference-range-warning {
  border-color: rgb(217 119 6);
  background: rgb(255 247 237);
}

.reference-full-gate p {
  margin: 6px 0 10px;
}

:global([data-theme="dark"]) .reference-deconstruction-panel {
  border-color: rgb(64 64 64);
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-readiness-row {
  background: rgb(38 38 38);
}

:global([data-theme="dark"]) .reference-readiness-row small {
  color: rgb(163 163 163);
}

:global([data-theme="dark"]) .reference-full-gate,
:global([data-theme="dark"]) .reference-full-approved {
  background: rgb(30 58 138 / 25%);
}

:global([data-theme="dark"]) .reference-range-warning {
  background: rgb(120 53 15 / 25%);
}
</style>
