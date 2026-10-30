<script setup lang="ts">
import { computed } from 'vue';
import { isDerivedRecordPendingAction } from '@oh-awesome-novel/client';

import PendingActionCard from '../agent-checkpoint/PendingActionCard.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  actions: Array<PendingActionView & {
    decision?: 'accepting' | 'rejecting' | 'quick-committing' | 'accepted' | 'rejected';
    decisionError?: string;
  }>;
  loading: boolean;
  error: string;
  batchStatus?: string;
}>();

const emit = defineEmits<{
  accept: [action: PendingActionView];
  reject: [action: PendingActionView];
  quickCommit: [action: PendingActionView];
  review: [action: PendingActionView];
  openDiff: [action: PendingActionView];
  acceptDerived: [actions: PendingActionView[]];
  forgeHandoff: [input: { draftId: string; revision: number; mode: 'play' | 'writing' }];
}>();

// Summaries, state, timeline, foreshadow and growth records derived from an
// accepted chapter. Accepting them together is still one normal Accept each.
const derivedActions = computed(() => props.actions.filter(
  (action) => !action.decision && isDerivedRecordPendingAction(action),
));
const batchBusy = computed(() => props.actions.some((action) => action.decision === 'accepting'));
</script>

<template>
  <section class="right-tab-panel" aria-label="PendingAction approval">
    <div class="panel-heading">
      <h2 class="panel-title">Approval</h2>
      <span class="count-pill">{{ actions.length }}</span>
    </div>
    <div v-if="derivedActions.length > 1" class="approval-batch-row">
      <span class="muted-copy">派生记录只更新摘要、状态、时间线、伏笔或角色成长，不改正文。</span>
      <button
        class="secondary-button tight-button"
        type="button"
        :disabled="batchBusy"
        @click="emit('acceptDerived', derivedActions)"
      >
        接受全部派生记录（{{ derivedActions.length }}）
      </button>
    </div>
    <p v-if="batchStatus" class="muted-copy" role="status">{{ batchStatus }}</p>
    <p v-if="loading" class="empty-copy">正在同步 PendingAction…</p>
    <p v-else-if="error" class="error-copy">{{ error }}</p>
    <div v-else-if="actions.length" class="pending-list">
      <PendingActionCard
        v-for="action in actions"
        :key="action.id"
        :action="action"
        @accept="emit('accept', $event)"
        @reject="emit('reject', $event)"
        @quick-commit="emit('quickCommit', $event)"
        @review="emit('review', $event)"
        @open-diff="emit('openDiff', $event)"
        @forge-handoff="emit('forgeHandoff', $event)"
      />
    </div>
    <p v-else class="empty-copy">No pending actions.</p>
  </section>
</template>


<style scoped>
.approval-batch-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
