<script setup lang="ts">
import PlayOutcomeItem from './PlayOutcomeItem.vue';
import type { PlayAdoptionSeed } from '../../../composables/usePlayAdoptionPreview';
import { MAX_PLAY_OUTCOME_ATTACHMENT_ITEMS } from '../../../composables/usePlayOutcome';
import type { PlayOutcomeGroup } from '../../../composables/usePlayOutcome';
import type {
  PlayOutcomeProjection,
  PlayOutcomeReport,
} from '../../../composables/useWorkspaceApi';

defineProps<{
  report: Readonly<PlayOutcomeReport>;
  reportFingerprint: string;
  reportStatus: 'idle' | 'missing' | 'current' | 'stale';
  staleReasons: readonly string[];
  projection: PlayOutcomeProjection;
  groups: readonly PlayOutcomeGroup[];
  selectedItemIds: readonly string[];
  actionsDisabled: boolean;
  panelBusy: boolean;
  selectionLimitReached: boolean;
  attachmentCreating: boolean;
}>();

const emit = defineEmits<{
  toggleSelection: [itemId: string];
  prepareAdoption: [seed: PlayAdoptionSeed];
  createWritingReference: [];
}>();

</script>

<template>
  <div class="play-outcome-report" :aria-busy="panelBusy">
    <div class="play-outcome-report-meta">
      <span>revision {{ report.sessionRevision }}</span>
      <span>{{ projection }} lens</span>
      <span>{{ report.items.length }} item{{ report.items.length === 1 ? '' : 's' }}</span>
    </div>
    <div v-if="reportStatus === 'stale'" class="play-outcome-stale" role="alert">
      <strong>Report stale · actions are disabled</strong>
      <span>{{ staleReasons.join(', ') || 'selected branch or source evidence changed' }}</span>
    </div>

    <section
      v-for="group in groups"
      :key="group.kind"
      class="play-outcome-group"
      :aria-labelledby="`play-outcome-group-${group.kind}`"
    >
      <header class="play-outcome-group-header">
        <h3 :id="`play-outcome-group-${group.kind}`">{{ group.label }}</h3>
        <span>{{ group.items.length }}</span>
      </header>
      <PlayOutcomeItem
        v-for="item in group.items"
        :key="item.id"
        :item="item"
        :selected="selectedItemIds.includes(item.id)"
        :disabled="actionsDisabled || (
          selectionLimitReached && !selectedItemIds.includes(item.id)
        )"
        :outcome-report-fingerprint="reportFingerprint"
        @toggle-selection="emit('toggleSelection', $event)"
        @prepare-adoption="emit('prepareAdoption', $event)"
      />
    </section>
    <p v-if="groups.length === 0" class="play-muted-copy">
      当前 {{ projection }} lens 没有可显示的 committed outcome。
    </p>

    <div class="play-outcome-writing-action">
      <div>
        <strong>Use as Writing Reference</strong>
        <p role="status" aria-live="polite">
          {{ selectedItemIds.length }} / {{ MAX_PLAY_OUTCOME_ATTACHMENT_ITEMS }} item(s) selected
          · noncanonical and request-local
          <template v-if="selectionLimitReached"> · selection limit reached</template>
        </p>
      </div>
      <button
        class="primary-button tight-button"
        type="button"
        :disabled="actionsDisabled || selectedItemIds.length === 0"
        @click="emit('createWritingReference')"
      >{{ attachmentCreating ? 'Attaching…' : 'Create attachment' }}</button>
    </div>
  </div>
</template>

<style scoped>
.play-outcome-report,
.play-outcome-group {
  display: grid;
  gap: 8px;
}

.play-outcome-report-meta,
.play-outcome-group-header,
.play-outcome-writing-action {
  display: flex;
  align-items: center;
}

.play-outcome-report-meta {
  flex-wrap: wrap;
  gap: 5px;
}

.play-outcome-report-meta span,
.play-outcome-group-header span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
}

.play-outcome-group-header,
.play-outcome-writing-action {
  justify-content: space-between;
  gap: 8px;
}

.play-outcome-group-header h3,
.play-outcome-writing-action p {
  margin: 0;
}

.play-outcome-group-header h3,
.play-outcome-writing-action strong {
  color: var(--play-ink, var(--editor-ink));
}

.play-outcome-group-header h3 {
  font-size: 11px;
}

.play-outcome-stale {
  display: grid;
  gap: 2px;
  padding: 7px 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  color: var(--play-danger, var(--editor-danger));
  font-size: 10px;
  line-height: 1.5;
}

.play-outcome-writing-action {
  padding: 9px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-outcome-writing-action > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.play-outcome-writing-action strong {
  font-size: 10px;
}

.play-outcome-writing-action p {
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
}

@media (max-width: 720px) {
  .play-outcome-writing-action {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
