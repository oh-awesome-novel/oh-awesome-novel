<script setup lang="ts">
import { computed } from 'vue';

import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  actions: Array<PendingActionView & {
    touchedFiles?: string[];
    decision?: 'accepting' | 'rejecting' | 'accepted' | 'rejected';
    decisionError?: string;
  }>;
}>();

const emit = defineEmits<{
  accept: [action: PendingActionView];
  reject: [action: PendingActionView];
  review: [action: PendingActionView];
}>();

const latestAction = computed(() => props.actions[0]);
const canQuickAccept = computed(() => (latestAction.value?.touchedFiles ?? []).length <= 1);
</script>

<template>
  <section v-if="latestAction" class="compact-approval-tray" aria-label="PendingAction quick review">
    <div class="compact-approval-main">
      <strong>{{ actions.length }} PendingAction</strong>
      <span>{{ latestAction.title }}</span>
    </div>
    <div class="pending-actions">
      <button class="secondary-button tight-button" type="button" @click="emit('review', latestAction)">
        Review all
      </button>
      <button
        class="secondary-button tight-button"
        type="button"
        :disabled="Boolean(latestAction.decision)"
        @click="emit('reject', latestAction)"
      >
        Reject
      </button>
      <button
        v-if="canQuickAccept"
        class="primary-button tight-button"
        type="button"
        :disabled="Boolean(latestAction.decision)"
        @click="emit('accept', latestAction)"
      >
        Accept
      </button>
    </div>
  </section>
</template>
