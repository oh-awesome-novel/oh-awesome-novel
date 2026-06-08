<script setup lang="ts">
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

defineProps<{
  actions: Array<PendingActionView & { decision?: 'accepted' | 'rejected' }>;
}>();

const emit = defineEmits<{
  accept: [action: PendingActionView];
  reject: [action: PendingActionView];
}>();
</script>

<template>
  <div class="panel pending-panel">
    <div class="panel-heading">
      <h2 class="panel-title">Pending Actions</h2>
      <span class="count-pill">{{ actions.length }}</span>
    </div>

    <div v-if="actions.length" class="pending-list">
      <article v-for="action in actions" :key="action.id" class="pending-card">
        <div class="pending-header">
          <span class="pending-title">{{ action.title }}</span>
          <span class="status-pill">{{ action.decision ?? action.status }}</span>
        </div>
        <p class="pending-description">{{ action.description }}</p>
        <pre class="diff-preview">{{ action.diff }}</pre>
        <div class="pending-actions">
          <button class="secondary-button" type="button" @click="emit('reject', action)">
            Reject
          </button>
          <button class="primary-button" type="button" @click="emit('accept', action)">
            Accept
          </button>
        </div>
      </article>
    </div>

    <p v-else class="empty-copy">No pending actions yet.</p>
  </div>
</template>
