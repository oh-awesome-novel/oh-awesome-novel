<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { ChatStatus, UIMessage } from 'ai';

import AgentTimeline from '../agent-checkpoint/AgentTimeline.vue';
import ChatComposer from '../agent-checkpoint/ChatComposer.vue';
import CompactApprovalTray from '../agent-checkpoint/CompactApprovalTray.vue';
import PendingActionPanel from '../agent-checkpoint/PendingActionPanel.vue';
import { useAgentTimeline } from '../../composables/useAgentTimeline';
import type { PendingAction } from '../../composables/useWorkspaceApi';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  providerConfigured: boolean;
  queuedPrompt: string;
  chatStatus: ChatStatus;
  chatInput: string;
  chatMessages: UIMessage[];
  chatPendingActions: PendingActionView[];
  pendingActions: PendingAction[];
  pendingActionsLoading: boolean;
  pendingActionsError: string;
  rightPanelShown: boolean;
}>();

const emit = defineEmits<{
  updateChatInput: [input: string];
  sendChatInput: [];
  stopChat: [];
  promptConsumed: [];
  configureProvider: [];
  acceptPendingAction: [action: PendingActionView];
  rejectPendingAction: [action: PendingActionView];
  reviewPendingAction: [action: PendingActionView];
  openPendingActionDiff: [action: PendingActionView];
}>();

const inputModel = computed({
  get: () => props.chatInput,
  set: (value: string) => emit('updateChatInput', value),
});
const messages = computed(() => props.chatMessages);
const { items: timelineItems } = useAgentTimeline(messages);

type PendingDecision = 'accepting' | 'rejecting' | 'accepted' | 'rejected';

const decisions = reactive<Record<string, PendingDecision>>({});
const decisionErrors = reactive<Record<string, string>>({});
const quickCommands = [
  { id: 'outline.plan', label: '规划大纲', prompt: '/规划大纲' },
  { id: 'volume.planNext', label: '规划下一卷', prompt: '/规划下一卷' },
  { id: 'chapter.planNext', label: '规划下一章', prompt: '/规划下一章' },
  { id: 'chapter.writeNext', label: '写下一章', prompt: '/写下一章' },
  { id: 'chapter.settle', label: '整理本章', prompt: '/整理本章' },
  { id: 'character.generateCard', label: '生成角色卡', prompt: '/生成角色卡' },
  { id: 'chapter.review', label: '审稿', prompt: '/审稿' },
  { id: 'state.update', label: '更新状态', prompt: '/更新状态' },
  { id: 'foreshadow.plan', label: '补伏笔', prompt: '/补伏笔' },
  { id: 'chapter.deAi', label: '去AI味', prompt: '/去AI味' },
];
const decoratedPendingActions = computed(() =>
  mergePendingActions(props.pendingActions, props.chatPendingActions).map((action) => ({
    ...action,
    decision: decisions[action.id],
    decisionError: decisionErrors[action.id],
  })),
);

watch(
  () => props.queuedPrompt,
  (prompt) => {
    if (!prompt) {
      return;
    }

    emit('updateChatInput', prompt);
    emit('promptConsumed');
  },
);

watch(
  () => props.pendingActions.map((action) => action.id).join('|'),
  () => {
    for (const id of Object.keys(decisions)) {
      if (!props.pendingActions.some((action) => action.id === id)) {
        delete decisions[id];
      }
    }
  },
);

function acceptPendingAction(action: PendingActionView) {
  decisions[action.id] = 'accepting';
  decisionErrors[action.id] = '';
  emit('acceptPendingAction', action);
}

function rejectPendingAction(action: PendingActionView) {
  decisions[action.id] = 'rejecting';
  decisionErrors[action.id] = '';
  emit('rejectPendingAction', action);
}

function mergePendingActions(
  storedActions: PendingAction[],
  streamedActions: PendingActionView[],
): PendingActionView[] {
  const actions = new Map<string, PendingActionView>();

  for (const action of storedActions) {
    actions.set(action.id, action);
  }

  for (const action of streamedActions) {
    actions.set(action.id, {
      ...actions.get(action.id),
      ...action,
      touchedFiles: action.touchedFiles ?? actions.get(action.id)?.touchedFiles,
    });
  }

  return [...actions.values()];
}
</script>

<template>
  <section class="copilot-panel" aria-label="Agent Copilot">
    <button
      v-if="chatStatus !== 'ready'"
      class="secondary-button tight-button copilot-stop-button"
      type="button"
      @click="emit('stopChat')"
    >
      停止
    </button>

    <div v-if="!providerConfigured" class="provider-disabled">
      <strong>Copilot 当前不可用</strong>
      <p>配置 provider 后才能发起 agent 请求；文件浏览保持可用。</p>
      <button class="primary-button" type="button" @click="emit('configureProvider')">
        配置 Provider
      </button>
    </div>

    <template v-else>
      <AgentTimeline :items="timelineItems" />
      <CompactApprovalTray
        v-if="!rightPanelShown"
        :actions="decoratedPendingActions"
        @accept="acceptPendingAction"
        @reject="rejectPendingAction"
        @review="emit('reviewPendingAction', $event)"
      />
      <div v-else-if="decoratedPendingActions.length > 0" class="copilot-review-hint">
        <span>{{ decoratedPendingActions.length }} PendingAction</span>
        <button class="ghost-button tight-button" type="button" @click="emit('reviewPendingAction', decoratedPendingActions[0])">
          Open review
        </button>
      </div>
      <p v-if="pendingActionsLoading" class="empty-copy">正在同步 PendingAction…</p>
      <p v-if="pendingActionsError" class="error-copy">{{ pendingActionsError }}</p>
      <PendingActionPanel
        v-if="!rightPanelShown && decoratedPendingActions.length > 0"
        :actions="decoratedPendingActions"
        @accept="acceptPendingAction"
        @reject="rejectPendingAction"
        @review="emit('reviewPendingAction', $event)"
        @open-diff="emit('openPendingActionDiff', $event)"
      />
      <ChatComposer
        v-model="inputModel"
        :disabled="chatStatus !== 'ready'"
        :quick-commands="quickCommands"
        :quick-commands-disabled="!providerConfigured"
        @configure-model="emit('configureProvider')"
        @submit="emit('sendChatInput')"
      />
    </template>
  </section>
</template>
