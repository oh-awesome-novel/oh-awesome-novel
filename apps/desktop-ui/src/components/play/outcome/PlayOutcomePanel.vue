<script setup lang="ts">
import { computed, nextTick, toRef, useTemplateRef } from 'vue';

import PlayOutcomeReportView from './PlayOutcomeReportView.vue';
import PlayWritingReferenceAudit from './PlayWritingReferenceAudit.vue';
import type { PlayAdoptionSeed } from '../../../composables/usePlayAdoptionPreview';
import { usePlayOutcome } from '../../../composables/usePlayOutcome';
import type { PlaySession } from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  session: PlaySession;
  showSpoilers: boolean;
  disabled: boolean;
  disabledReason?: string;
}>();

const emit = defineEmits<{
  updateShowSpoilers: [show: boolean];
  writingReferencesUpdated: [];
  prepareAdoption: [seed: PlayAdoptionSeed];
}>();

const reportHeading = useTemplateRef<HTMLHeadingElement>('reportHeading');

const {
  report,
  reportFingerprint,
  reportStatus,
  staleReasons,
  loading,
  generating,
  error,
  notice,
  selectedItemIds,
  groups,
  projection,
  sessionAttachments,
  attachmentsLoading,
  attachmentCreating,
  detachingAttachmentId,
  actionsDisabled,
  selectionLimitReached,
  createWritingReference,
  detachWritingReference,
  generateReport,
  refreshAttachments,
  refreshReport,
  toggleItemSelection,
} = usePlayOutcome({
  session: toRef(props, 'session'),
  showSpoilers: toRef(props, 'showSpoilers'),
  onWritingReferencesUpdated: () => emit('writingReferencesUpdated'),
});

const panelBusy = computed(() =>
  props.disabled ||
  loading.value ||
  generating.value ||
  attachmentCreating.value,
);

async function generateAndFocus(): Promise<void> {
  if (await generateReport()) {
    await nextTick();
    reportHeading.value?.focus();
  }
}
</script>

<template>
  <section class="play-outcome-panel" aria-label="Play Outcome and Writing handoff">
    <header class="play-outcome-panel-header">
      <div>
        <span class="play-section-marker" aria-hidden="true">[outcome]</span>
        <h2 ref="reportHeading" tabindex="-1">Outcome Report</h2>
      </div>
      <div class="play-outcome-panel-actions">
        <div class="play-outcome-lens" role="group" aria-label="Outcome visibility lens">
          <button
            type="button"
            :aria-pressed="projection === 'player'"
            :disabled="panelBusy"
            @click="emit('updateShowSpoilers', false)"
          >Player</button>
          <button
            type="button"
            :aria-pressed="projection === 'director'"
            :disabled="panelBusy"
            @click="emit('updateShowSpoilers', true)"
          >Director</button>
        </div>
        <button
          class="ghost-button tight-button"
          type="button"
          :disabled="panelBusy"
          @click="refreshReport()"
        >刷新</button>
        <button
          class="primary-button tight-button"
          type="button"
          :disabled="panelBusy"
          @click="generateAndFocus"
        >{{ generating ? 'Generating…' : 'Generate report' }}</button>
      </div>
    </header>

    <p class="play-outcome-boundary">
      仅从当前 committed selected branch 生成；未选择的 sibling、discarded variant 与 provisional attempt 不进入报告。
    </p>
    <p v-if="disabledReason" class="play-outcome-boundary" role="status">
      {{ disabledReason }}
    </p>
    <p v-if="error" class="play-outcome-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="play-outcome-notice" role="status" aria-live="polite">
      {{ notice }}
    </p>
    <p v-if="loading && !report" class="play-muted-copy" role="status">
      正在读取 Outcome Report…
    </p>
    <p v-else-if="reportStatus === 'missing' && !report" class="play-muted-copy">
      尚未生成 Outcome Report。完成 committed Play 分支后可按需生成。
    </p>

    <PlayOutcomeReportView
      v-if="report"
      :report="report"
      :report-fingerprint="reportFingerprint"
      :report-status="reportStatus"
      :stale-reasons="staleReasons"
      :projection="projection"
      :groups="groups"
      :selected-item-ids="selectedItemIds"
      :actions-disabled="disabled || actionsDisabled"
      :panel-busy="panelBusy"
      :selection-limit-reached="selectionLimitReached"
      :attachment-creating="attachmentCreating"
      @toggle-selection="toggleItemSelection"
      @prepare-adoption="emit('prepareAdoption', $event)"
      @create-writing-reference="createWritingReference"
    />

    <PlayWritingReferenceAudit
      :attachments="sessionAttachments"
      :loading="attachmentsLoading"
      :detaching-attachment-id="detachingAttachmentId"
      @refresh="refreshAttachments"
      @detach="detachWritingReference"
    />
  </section>
</template>

<style scoped>
.play-outcome-panel {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-outcome-panel-header,
.play-outcome-panel-header > div,
.play-outcome-panel-actions {
  display: flex;
  align-items: center;
}

.play-outcome-panel-header {
  justify-content: space-between;
  gap: 8px;
}

.play-outcome-panel-header > div {
  gap: 6px;
}

.play-outcome-panel :where(h2, h3, p, ul) {
  margin: 0;
}

.play-outcome-panel h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
  outline: none;
}

.play-outcome-panel-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.play-outcome-lens {
  display: inline-flex;
}

.play-outcome-lens button {
  min-height: 28px;
  padding: 0 7px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-muted, var(--editor-muted));
}

.play-outcome-lens button[aria-pressed="true"] {
  border-color: var(--play-ink, var(--editor-ink));
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

.play-outcome-boundary,
.play-outcome-notice,
.play-outcome-error {
  padding: 7px 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  font-size: 10px;
  line-height: 1.5;
}

.play-outcome-boundary {
  color: var(--play-muted, var(--editor-muted));
}

.play-outcome-notice {
  color: var(--play-success, var(--editor-success));
}

.play-outcome-error {
  color: var(--play-danger, var(--editor-danger));
}

@media (max-width: 720px) {
  .play-outcome-panel-header {
    align-items: stretch;
    flex-direction: column;
  }

  .play-outcome-panel-actions {
    justify-content: flex-start;
  }
}
</style>
