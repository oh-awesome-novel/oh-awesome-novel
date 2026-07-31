<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';

import ReferenceDiagnostics from './ReferenceDiagnostics.vue';
import ReferenceFullDeconstructionProgress from './ReferenceFullDeconstructionProgress.vue';
import ReferencePublishReview from './ReferencePublishReview.vue';
import ReferencePublishedContextSummary from './ReferencePublishedContextSummary.vue';
import ReferenceQualityWarnings from './ReferenceQualityWarnings.vue';
import ReferenceQuickPreview from './ReferenceQuickPreview.vue';
import ReferenceStoryMaterialCoveragePreview from './ReferenceStoryMaterialCoveragePreview.vue';
import type {
  ReferenceDeconstructionPublicationView,
} from '../../../composables/useReferenceDeconstruction';
import type {
  ReferenceDeconstructionRun,
  ReferenceDeconstructionAnalysisQualityStatus,
  ReferenceDeconstructionRunStatus,
  ReferenceWorkSummary,
  WritingProfile,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  reference?: ReferenceWorkSummary;
  run?: ReferenceDeconstructionRun;
  writingProfile?: WritingProfile;
  loadingActiveRun: boolean;
  creating: boolean;
  advancing: boolean;
  cancelling: boolean;
  approving: boolean;
  pausing: boolean;
  resuming: boolean;
  retrying: boolean;
  publishing: boolean;
  reconciling: boolean;
  indeterminate: boolean;
  error: string;
  canStart: boolean;
  canAdvance: boolean;
  canAdvanceFull: boolean;
  canPause: boolean;
  canResume: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canApprove: boolean;
  canPublish: boolean;
  needsReconcile: boolean;
  publication?: ReferenceDeconstructionPublicationView;
}>();

const emit = defineEmits<{
  startPreview: [confirmDetectedRange?: true];
  advancePreview: [];
  cancel: [];
  reconcile: [];
  approveFull: [];
  advanceFull: [];
  pauseFull: [];
  resumeFull: [];
  retryFailedUnit: [unitId: string];
  publish: [];
  reviewPendingAction: [pendingActionId: string];
}>();

const runStatusLabels: Record<ReferenceDeconstructionRunStatus, string> = {
  created: 'Preview created',
  previewRunning: 'Preview running',
  awaitingFullApproval: 'Preview ready',
  fullApproved: 'Full analysis approved',
  fullRunning: 'Full analysis in progress',
  paused: 'Full analysis paused',
  reviewReady: 'Analysis ready for review',
  publishing: 'Publishing',
  completed: 'Published',
  cancelled: 'Deconstruction cancelled',
  failed: 'Deconstruction failed',
  interrupted: 'Deconstruction interrupted',
  stale: 'Source changed',
};

const confirmingFull = shallowRef(false);
const confirmingLowConfidenceRange = shallowRef(false);
const qualityWarningsReviewed = shallowRef(false);
const blockingDiagnosticCount = computed(() =>
  props.run?.diagnostics.filter((diagnostic) => diagnostic.blocking).length ?? 0,
);
const publishedContext = computed(() => props.reference?.publishedContext);
const storyMaterialOnlyBundle = computed(() =>
  props.reference?.deconstructionStatus === 'completed'
  && props.reference.readinessReason === 'techniqueTrackNotPublished',
);
const writingContextLabel = computed(() => {
  if (props.reference?.contextEligible) return 'Eligible';
  return storyMaterialOnlyBundle.value ? 'Not generated' : 'Not eligible';
});
const detectedPreviewChapterCount = computed(() =>
  Math.min(props.reference?.chapterCount ?? 0, 3),
);
const hasLowBoundaryConfidence = computed(() =>
  props.reference?.structureConfidence === 'low',
);
const nonBlockingDiagnosticCount = computed(() =>
  props.run?.diagnostics.filter((diagnostic) => !diagnostic.blocking).length ?? 0,
);
const selectedOutputs = computed(() =>
  props.run?.outputs ?? props.writingProfile?.deconstruction.outputs ?? [],
);
const includesStoryMaterials = computed(() =>
  selectedOutputs.value.some((output) => output !== 'techniques'),
);
const qualitySummaries = computed(() =>
  props.run?.full
    ? Object.values(props.run.full.analysisQuality).filter((quality) => quality !== undefined)
    : [],
);
const qualityStatus = computed<ReferenceDeconstructionAnalysisQualityStatus>(() => {
  const statuses = qualitySummaries.value.map((quality) => quality.status);
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('warned')) return 'warned';
  if (statuses.length && statuses.every((status) => status === 'passed')) return 'passed';
  return 'notEvaluated';
});
const qualityCoveragePercent = computed(() =>
  qualitySummaries.value.length
    ? Math.min(...qualitySummaries.value.map((quality) => quality.coveragePercent))
    : 0,
);
const canCreatePublishAction = computed(() =>
  props.canPublish
  && (
    nonBlockingDiagnosticCount.value === 0
    || qualityWarningsReviewed.value
  ),
);

const statusLabel = computed(() => {
  if (props.loadingActiveRun) return 'Checking run';
  if (props.creating) return 'Creating preview';
  if (props.advancing) return props.run?.full ? 'Running one full unit' : 'Preview running';
  if (props.pausing) return 'Pausing full analysis';
  if (props.resuming) return 'Resuming full analysis';
  if (props.retrying) return 'Requeuing failed unit';
  if (props.publishing) return 'Creating publish PendingAction';
  if (!props.run) return props.reference?.deconstructionStatus ?? 'Not selected';
  return runStatusLabels[props.run.status];
});

watch(
  () => `${props.reference?.id ?? ''}:${props.run?.id ?? ''}:${props.run?.status ?? ''}`,
  () => {
    confirmingFull.value = false;
    confirmingLowConfidenceRange.value = false;
    qualityWarningsReviewed.value = false;
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
        <p v-if="run" class="empty-copy">
          Profile snapshot {{ run.profileId }} · outputs {{ run.outputs.join(', ') }}
        </p>
        <p v-else-if="writingProfile" class="empty-copy">
          Current Profile: {{ writingProfile.displayName }} ({{ writingProfile.id }}) ·
          will generate {{ writingProfile.deconstruction.outputs.join(', ') }}
        </p>
      </div>
      <span class="status-pill">{{ statusLabel }}</span>
    </div>

    <p v-if="!reference" class="empty-copy">Select an imported reference to inspect or analyze.</p>
    <template v-else>
      <p v-if="includesStoryMaterials" class="reference-material-notice">
        Content notice: Story Materials may contain source settings, characters, relationships,
        plot events, and chronology. Review them before publication; this notice adds no hard gate.
      </p>
      <div class="reference-readiness-row">
        <span>Writing context</span>
        <strong>{{ writingContextLabel }}</strong>
        <small>
          {{ storyMaterialOnlyBundle
            ? 'Story Materials published; Technique context was not selected.'
            : reference.readinessReason }}
        </small>
      </div>
      <ReferencePublishedContextSummary
        v-if="publishedContext"
        :context="publishedContext"
        :enabled="reference.enabled"
        :context-eligible="reference.contextEligible"
      />

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
          {{ cancelling ? 'Cancelling…' : 'Cancel deconstruction' }}
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
      <ReferenceStoryMaterialCoveragePreview
        v-if="run?.materialPreview"
        :preview="run.materialPreview"
        :evidence="run.evidence"
      />
      <ReferenceFullDeconstructionProgress
        v-if="run?.full"
        :full="run.full"
        :status="run.status"
        :advancing="advancing"
        :pausing="pausing"
        :resuming="resuming"
        :retrying="retrying"
        :can-advance="canAdvanceFull"
        :can-pause="canPause"
        :can-resume="canResume"
        :can-retry="canRetry"
        @advance="emit('advanceFull')"
        @pause="emit('pauseFull')"
        @resume="emit('resumeFull')"
        @retry="emit('retryFailedUnit', $event)"
      />
      <ReferenceDiagnostics
        v-if="run"
        :diagnostics="run.diagnostics"
      />
      <section
        v-if="run?.status === 'reviewReady' && !publication"
        class="reference-full-gate"
        aria-label="Reference publish preparation"
      >
        <strong>Analysis ready to publish</strong>
        <p>
          Prepare the deterministic multi-file candidate and open one global PendingAction.
          The published reference bundle remains unchanged until that action is accepted.
        </p>
        <ReferenceQualityWarnings
          :status="qualityStatus"
          :diagnostics="run.diagnostics"
          :require-expansion="nonBlockingDiagnosticCount > 0"
          @reviewed="qualityWarningsReviewed = true"
        />
        <p
          v-if="nonBlockingDiagnosticCount > 0 && !qualityWarningsReviewed"
          class="empty-copy"
        >
          Expand the warning list once before creating the publish PendingAction.
        </p>
        <button
          class="primary-button tight-button"
          type="button"
          :disabled="!canCreatePublishAction"
          @click="emit('publish')"
        >
          {{ publishing ? 'Creating PendingAction…' : 'Create publish PendingAction' }}
        </button>
      </section>
      <ReferencePublishReview
        v-if="run && publication"
        :publication="publication"
        :status="run.status"
        :source-checksum-sha256="run.sourceChecksumSha256"
        :pipeline-version="run.pipelineVersion"
        :capability-version="run.capabilityVersion"
        :coverage-percent="qualityCoveragePercent"
        :quality-status="qualityStatus"
        :diagnostics="run.diagnostics"
        :publishing="publishing"
        :can-publish="canPublish"
        @publish="emit('publish')"
        @review-pending-action="emit('reviewPendingAction', $event)"
      />

      <section
        v-if="run?.status === 'awaitingFullApproval'"
        class="reference-full-gate"
        aria-label="Full deconstruction confirmation"
      >
        <strong>Continue full deconstruction?</strong>
        <p>
          This creates the deterministic full-analysis work plan. It does not publish artifacts or
          start a chapter unit automatically.
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
.reference-range-warning {
  margin: 0;
  padding: 10px;
  border: 1px solid rgb(37 99 235);
  border-radius: 8px;
  background: rgb(239 246 255);
}

.reference-material-notice {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgb(216 180 254);
  border-radius: 8px;
  color: rgb(88 28 135);
  background: rgb(250 245 255);
}

:global([data-theme="dark"]) .reference-material-notice {
  border-color: rgb(107 33 168);
  color: rgb(216 180 254);
  background: rgb(59 7 100 / 22%);
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

:global([data-theme="dark"]) .reference-full-gate {
  background: rgb(30 58 138 / 25%);
}

:global([data-theme="dark"]) .reference-range-warning {
  background: rgb(120 53 15 / 25%);
}
</style>
