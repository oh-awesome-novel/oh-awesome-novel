<script setup lang="ts">
import PendingActionCard from '../agent-checkpoint/PendingActionCard.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

defineProps<{
  actions: Array<PendingActionView & {
    touchedFiles?: string[];
    decision?: 'accepting' | 'rejecting' | 'accepted' | 'rejected';
    decisionError?: string;
  }>;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  accept: [action: PendingActionView];
  reject: [action: PendingActionView];
  review: [action: PendingActionView];
  openDiff: [action: PendingActionView];
}>();
</script>

<template>
  <section class="right-tab-panel" aria-label="PendingAction approval">
    <div class="panel-heading">
      <h2 class="panel-title">Approval</h2>
      <span class="count-pill">{{ actions.length }}</span>
    </div>
    <p v-if="loading" class="empty-copy">正在同步 PendingAction…</p>
    <p v-else-if="error" class="error-copy">{{ error }}</p>
    <div v-else-if="actions.length" class="pending-list">
      <PendingActionCard
        v-for="action in actions"
        :key="action.id"
        :action="action"
        @accept="emit('accept', $event)"
        @reject="emit('reject', $event)"
        @review="emit('review', $event)"
        @open-diff="emit('openDiff', $event)"
      />
    </div>
    <p v-else class="empty-copy">No pending actions.</p>
  </section>
</template>
