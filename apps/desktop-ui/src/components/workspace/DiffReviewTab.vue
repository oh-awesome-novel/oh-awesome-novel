<script setup lang="ts">
import { computed } from 'vue';

import PendingActionDiffViewer from '../agent-checkpoint/PendingActionDiffViewer.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  selectedAction?: PendingActionView;
  actions: PendingActionView[];
}>();

const emit = defineEmits<{
  forgeHandoff: [input: { draftId: string; revision: number; mode: 'play' | 'writing' }];
}>();

const action = computed(() => props.selectedAction ?? props.actions[0]);
const changes = computed(() => action.value?.changes ?? []);
const isForgeAccepted = computed(() => {
  const a = action.value;
  return a?.origin?.kind === 'forge' && (a.status === 'accepted' || (a as any).decision === 'accepted');
});
</script>

<template>
  <section class="right-tab-panel" aria-label="Diff review">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Diff</p>
        <h2 class="panel-title">{{ action?.title ?? 'No selected action' }}</h2>
      </div>
    </div>

    <div
      v-if="isForgeAccepted && action?.origin?.kind === 'forge'"
      class="forge-handoff-banner"
    >
      <div class="banner-message">
        <strong>设定已批准入库！</strong>
        <span>您可以直接前往：</span>
      </div>
      <div class="banner-buttons">
        <button
          type="button"
          class="primary-button tight-button"
          @click="emit('forgeHandoff', { draftId: action.origin.draftId, revision: action.origin.revision, mode: 'play' })"
        >
          一键开演
        </button>
        <button
          type="button"
          class="secondary-button tight-button"
          @click="emit('forgeHandoff', { draftId: action.origin.draftId, revision: action.origin.revision, mode: 'writing' })"
        >
          一键入书
        </button>
      </div>
    </div>

    <PendingActionDiffViewer
      v-if="action"
      :diff="action.diff"
      :changes="changes"
    />
    <p v-else class="empty-copy">Select a PendingAction to inspect its diff.</p>
  </section>
</template>

<style scoped>
.forge-handoff-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: var(--surface-color, #f0fdf4);
  border: 1px solid var(--border-color, #bbf7d0);
  border-radius: 6px;
}
.banner-message {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: #166534;
}
.banner-buttons {
  display: flex;
  gap: 8px;
}
</style>
