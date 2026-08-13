<script setup lang="ts">
import PendingActionCard from './PendingActionCard.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

defineProps<{
  actions: Array<PendingActionView & {
    decision?: 'accepting' | 'rejecting' | 'quick-committing' | 'accepted' | 'rejected';
    decisionError?: string;
  }>;
}>();

const emit = defineEmits<{
  accept: [action: PendingActionView];
  reject: [action: PendingActionView];
  quickCommit: [action: PendingActionView];
  review: [action: PendingActionView];
  openDiff: [action: PendingActionView];
}>();
</script>

<template>
  <div class="panel pending-panel">
    <div class="panel-heading">
      <h2 class="panel-title">Pending Actions</h2>
      <span class="count-pill">{{ actions.length }}</span>
    </div>

    <div v-if="actions.length" class="pending-list">
      <PendingActionCard
        v-for="action in actions"
        :key="action.id"
        :action="action"
        @accept="emit('accept', $event)"
        @reject="emit('reject', $event)"
        @quick-commit="emit('quickCommit', $event)"
        @review="emit('review', $event)"
        @open-diff="emit('openDiff', $event)"
      />
    </div>

    <p v-else class="empty-copy">No pending actions yet.</p>
  </div>
</template>
