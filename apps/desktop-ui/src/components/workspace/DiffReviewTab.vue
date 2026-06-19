<script setup lang="ts">
import { computed } from 'vue';

import PendingActionDiffViewer from '../agent-checkpoint/PendingActionDiffViewer.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  selectedAction?: PendingActionView;
  actions: PendingActionView[];
}>();

const action = computed(() => props.selectedAction ?? props.actions[0]);
</script>

<template>
  <section class="right-tab-panel" aria-label="Diff review">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Diff</p>
        <h2 class="panel-title">{{ action?.title ?? 'No selected action' }}</h2>
      </div>
    </div>
    <PendingActionDiffViewer
      v-if="action"
      :diff="action.diff"
      :touched-files="action.touchedFiles"
    />
    <p v-else class="empty-copy">Select a PendingAction to inspect its diff.</p>
  </section>
</template>
