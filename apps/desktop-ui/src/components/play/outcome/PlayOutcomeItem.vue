<script setup lang="ts">
import { computed, useId } from 'vue';

import type { PlayAdoptionSeed } from '../../../composables/usePlayAdoptionPreview';
import type { PlayOutcomeItem } from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  item: Readonly<PlayOutcomeItem>;
  selected: boolean;
  disabled: boolean;
  outcomeReportFingerprint: string;
}>();

const emit = defineEmits<{
  toggleSelection: [itemId: string];
  prepareAdoption: [seed: PlayAdoptionSeed];
}>();

const selectionId = `${useId()}-outcome-item`;
const evidenceCount = computed(() =>
  new Set([
    ...props.item.artifactTurnRefs,
    ...props.item.messageRefs,
    ...props.item.eventRefs,
    ...props.item.observationRefs,
    ...props.item.evidenceRefs,
    ...props.item.sourceRefs,
  ]).size,
);
const visibilityLabel = computed(() => {
  if (props.item.visibility === 'playerVisible') return 'player visible';
  if (props.item.visibility === 'rumor') return 'rumor';
  return 'director only';
});
</script>

<template>
  <article class="play-outcome-item" :data-visibility="item.visibility">
    <header class="play-outcome-item-header">
      <label :for="selectionId" class="play-outcome-item-selection">
        <input
          :id="selectionId"
          type="checkbox"
          :checked="selected"
          :disabled="disabled"
          :aria-label="`Select outcome item: ${item.summary}`"
          @change="emit('toggleSelection', item.id)"
        >
        <span>Use as Writing Reference</span>
      </label>
      <div class="play-outcome-item-badges" aria-label="Outcome evidence classification">
        <span>{{ visibilityLabel }}</span>
        <span>{{ item.confidence }}</span>
        <span v-if="item.goalStatus">{{ item.goalStatus }}</span>
      </div>
    </header>

    <p class="play-outcome-item-summary">{{ item.summary }}</p>

    <ul v-if="item.tags.length" class="play-outcome-item-tags" aria-label="Outcome tags">
      <li v-for="tag in item.tags" :key="tag">{{ tag }}</li>
    </ul>

    <details class="play-outcome-item-evidence">
      <summary>{{ evidenceCount }} evidence reference{{ evidenceCount === 1 ? '' : 's' }}</summary>
      <dl>
        <div v-if="item.artifactTurnRefs.length">
          <dt>Committed artifacts</dt>
          <dd>{{ item.artifactTurnRefs.join(', ') }}</dd>
        </div>
        <div v-if="item.messageRefs.length">
          <dt>Messages</dt>
          <dd>{{ item.messageRefs.join(', ') }}</dd>
        </div>
        <div v-if="item.eventRefs.length">
          <dt>Events</dt>
          <dd>{{ item.eventRefs.join(', ') }}</dd>
        </div>
        <div v-if="item.observationRefs.length">
          <dt>Observations</dt>
          <dd>{{ item.observationRefs.join(', ') }}</dd>
        </div>
        <div v-if="item.evidenceRefs.length">
          <dt>Evidence</dt>
          <dd>{{ item.evidenceRefs.join(', ') }}</dd>
        </div>
        <div v-if="item.sourceRefs.length">
          <dt>Sources</dt>
          <dd>{{ item.sourceRefs.join(', ') }}</dd>
        </div>
        <div v-if="item.participantRefs.length">
          <dt>Participants</dt>
          <dd>{{ item.participantRefs.join(', ') }}</dd>
        </div>
      </dl>
    </details>

    <button
      class="ghost-button tight-button"
      type="button"
      :disabled="disabled || !outcomeReportFingerprint"
      :aria-label="`Bring outcome to writing: ${item.summary}`"
      @click="emit('prepareAdoption', {
        kind: 'outcome',
        outcomeItemId: item.id,
        outcomeReportFingerprint,
      })"
    >
      Bring to writing
    </button>
  </article>
</template>

<style scoped>
.play-outcome-item {
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-outcome-item-header,
.play-outcome-item-selection,
.play-outcome-item-badges {
  display: flex;
  align-items: center;
}

.play-outcome-item-header {
  justify-content: space-between;
  gap: 8px;
}

.play-outcome-item-selection {
  gap: 6px;
  color: var(--play-ink, var(--editor-ink));
  font-size: 10px;
  font-weight: 700;
}

.play-outcome-item-badges {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.play-outcome-item-badges span,
.play-outcome-item-tags li {
  padding: 2px 5px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
}

.play-outcome-item-summary {
  margin: 0;
  color: var(--play-body, var(--editor-body));
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.play-outcome-item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-outcome-item-evidence {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-outcome-item-evidence summary {
  cursor: pointer;
}

.play-outcome-item-evidence dl {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
}

.play-outcome-item-evidence dl > div {
  display: grid;
  grid-template-columns: minmax(90px, .36fr) minmax(0, 1fr);
  gap: 7px;
}

.play-outcome-item-evidence dt {
  color: var(--play-faint, var(--editor-faint));
}

.play-outcome-item-evidence dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
