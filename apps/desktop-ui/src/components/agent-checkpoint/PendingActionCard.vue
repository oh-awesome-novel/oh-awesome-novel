<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import PendingActionDiffViewer from './PendingActionDiffViewer.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  action: PendingActionView & {
    decision?: 'accepting' | 'rejecting' | 'quick-committing' | 'accepted' | 'rejected';
    decisionError?: string;
  };
  compact?: boolean;
}>();

const emit = defineEmits<{
  accept: [action: PendingActionView];
  reject: [action: PendingActionView];
  quickCommit: [action: PendingActionView];
  review: [action: PendingActionView];
  openDiff: [action: PendingActionView];
  forgeHandoff: [input: { draftId: string; revision: number; mode: 'play' | 'writing' }];
}>();

const diffOpen = shallowRef(false);

const isForgeAccepted = computed(() => (
  props.action.origin?.kind === 'forge'
  && (props.action.status === 'accepted' || props.action.decision === 'accepted')
));

const changes = computed(() => props.action.changes);
const fileLabel = computed(() => {
  if (changes.value.length === 0) {
    return 'No file changes';
  }

  if (changes.value.length === 1) {
    const change = changes.value[0]!;
    return `${operationLabel(change.operation)}: ${change.path}`;
  }

  const counts = changes.value.reduce(
    (result, change) => ({
      ...result,
      [change.operation]: result[change.operation] + 1,
    }),
    { create: 0, update: 0, delete: 0 },
  );
  const breakdown = (['create', 'update', 'delete'] as const)
    .filter((operation) => counts[operation] > 0)
    .map((operation) => `${counts[operation]} ${operationLabel(operation).toLowerCase()}`)
    .join(' · ');

  return `${changes.value.length} file changes · ${breakdown}`;
});

const disabled = computed(() => (
  props.action.status !== 'pending' || Boolean(props.action.decision)
));
const quickCommitAvailable = computed(() => (
  props.action.status === 'accepted'
  && (props.action.git?.status === 'staged-not-committed'
    || props.action.git?.status === 'failed')
));

function operationLabel(operation: 'create' | 'update' | 'delete'): string {
  if (operation === 'create') return 'Created';
  if (operation === 'delete') return 'Deleted';
  return 'Updated';
}
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
        v-if="quickCommitAvailable"
        class="primary-button tight-button"
        type="button"
        :disabled="Boolean(action.decision)"
        @click="emit('quickCommit', action)"
      >
        Quick commit
      </button>
      <button
        v-if="action.status === 'pending' && (!compact || changes.length <= 1)"
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

    <div
      v-if="isForgeAccepted && action.origin?.kind === 'forge'"
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
      v-if="diffOpen && !compact"
      :diff="action.diff"
      :changes="changes"
    />
  </article>
</template>

<style scoped>
.forge-handoff-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  margin-top: 10px;
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
