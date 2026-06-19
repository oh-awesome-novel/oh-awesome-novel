<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import PendingActionDiffViewer from './PendingActionDiffViewer.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  action: PendingActionView & {
    touchedFiles?: string[];
    decision?: 'accepting' | 'rejecting' | 'accepted' | 'rejected';
    decisionError?: string;
  };
  compact?: boolean;
}>();

const emit = defineEmits<{
  accept: [action: PendingActionView];
  reject: [action: PendingActionView];
  review: [action: PendingActionView];
  openDiff: [action: PendingActionView];
}>();

const diffOpen = shallowRef(false);

const fileLabel = computed(() => {
  const files = props.action.touchedFiles ?? [];

  if (files.length === 0) {
    return 'No touched files';
  }

  return files.length === 1 ? files[0] : `${files.length} files`;
});

const disabled = computed(() => Boolean(props.action.decision));
</script>

<template>
  <article class="pending-card">
    <div class="pending-header">
      <div class="pending-card-title">
        <span class="pending-title">{{ action.title }}</span>
        <small>{{ fileLabel }}</small>
      </div>
      <span class="status-pill">{{ action.decision ?? action.status }}</span>
    </div>
    <p class="pending-description">{{ action.description }}</p>
    <p v-if="action.decisionError" class="error-copy">{{ action.decisionError }}</p>

    <div class="pending-actions">
      <button
        class="secondary-button tight-button"
        type="button"
        :disabled="disabled"
        @click="emit('reject', action)"
      >
        Reject
      </button>
      <button
        v-if="!compact || (action.touchedFiles ?? []).length <= 1"
        class="primary-button tight-button"
        type="button"
        :disabled="disabled"
        @click="emit('accept', action)"
      >
        Accept
      </button>
      <button class="ghost-button" type="button" @click="emit('review', action)">
        Review
      </button>
      <button class="ghost-button" type="button" @click="diffOpen = !diffOpen; emit('openDiff', action)">
        Diff
      </button>
    </div>

    <PendingActionDiffViewer
      v-if="diffOpen && !compact"
      :diff="action.diff"
      :touched-files="action.touchedFiles"
    />
  </article>
</template>
