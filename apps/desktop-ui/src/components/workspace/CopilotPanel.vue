<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef, watch } from 'vue';

import ChatComposer from '../agent-checkpoint/ChatComposer.vue';
import ChatTranscript from '../agent-checkpoint/ChatTranscript.vue';
import PendingActionPanel from '../agent-checkpoint/PendingActionPanel.vue';
import ToolActivityList from '../agent-checkpoint/ToolActivityList.vue';
import { useWorkspaceApi, type PendingAction } from '../../composables/useWorkspaceApi';
import {
  useAgentCheckpointChat,
  type PendingActionView,
} from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  providerConfigured: boolean;
  queuedPrompt: string;
}>();

const emit = defineEmits<{
  promptConsumed: [];
  configureProvider: [];
  pendingActionResolved: [];
}>();

const api = useWorkspaceApi();
const {
  chat,
  input,
  messages,
  pendingActions,
  sendCurrentInput,
  stop,
} = useAgentCheckpointChat();

type PendingDecision = 'accepting' | 'rejecting' | 'accepted' | 'rejected';

const workspacePendingActions = shallowRef<PendingAction[]>([]);
const pendingActionsLoading = shallowRef(false);
const pendingActionsError = shallowRef('');
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
  mergePendingActions(workspacePendingActions.value, pendingActions.value).map((action) => ({
    ...action,
    decision: decisions[action.id],
    decisionError: decisionErrors[action.id],
  })),
);

onMounted(() => {
  void loadPendingActions();
});

watch(
  () => props.queuedPrompt,
  (prompt) => {
    if (!prompt) {
      return;
    }

    input.value = prompt;
    emit('promptConsumed');
  },
);

function useQuickCommand(prompt: string) {
  input.value = prompt;
}

async function loadPendingActions() {
  pendingActionsLoading.value = true;
  pendingActionsError.value = '';

  try {
    workspacePendingActions.value = (await api.listPendingActions()).pendingActions;
  } catch (error) {
    pendingActionsError.value = error instanceof Error ? error.message : String(error);
  } finally {
    pendingActionsLoading.value = false;
  }
}

async function acceptPendingAction(action: PendingActionView) {
  decisions[action.id] = 'accepting';
  decisionErrors[action.id] = '';

  try {
    await api.acceptPendingAction(action.id);
    decisions[action.id] = 'accepted';
    await loadPendingActions();
    emit('pendingActionResolved');
  } catch (error) {
    delete decisions[action.id];
    decisionErrors[action.id] = error instanceof Error ? error.message : String(error);
  }
}

async function rejectPendingAction(action: PendingActionView) {
  decisions[action.id] = 'rejecting';
  decisionErrors[action.id] = '';

  try {
    await api.rejectPendingAction(action.id);
    decisions[action.id] = 'rejected';
    await loadPendingActions();
    emit('pendingActionResolved');
  } catch (error) {
    delete decisions[action.id];
    decisionErrors[action.id] = error instanceof Error ? error.message : String(error);
  }
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
    });
  }

  return [...actions.values()];
}
</script>

<template>
  <section class="copilot-panel" aria-label="Agent Copilot">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Copilot</p>
        <h2 class="panel-title">Novel Agent</h2>
      </div>
      <button
        v-if="chat.status !== 'ready'"
        class="secondary-button tight-button"
        type="button"
        @click="stop"
      >
        停止
      </button>
    </div>

    <div class="quick-command-strip" aria-label="Novel quick commands">
      <button
        v-for="command in quickCommands"
        :key="command.id"
        class="quick-command-chip"
        type="button"
        :disabled="!providerConfigured"
        @click="useQuickCommand(command.prompt)"
      >
        {{ command.label }}
      </button>
    </div>

    <div v-if="!providerConfigured" class="provider-disabled">
      <strong>Copilot 当前不可用</strong>
      <p>配置 provider 后才能发起 agent 请求；文件浏览保持可用。</p>
      <button class="primary-button" type="button" @click="emit('configureProvider')">
        配置 Provider
      </button>
    </div>

    <template v-else>
      <ChatTranscript :messages="messages" />
      <ToolActivityList :messages="messages" />
      <p v-if="pendingActionsLoading" class="empty-copy">正在同步 PendingAction…</p>
      <p v-if="pendingActionsError" class="error-copy">{{ pendingActionsError }}</p>
      <PendingActionPanel
        :actions="decoratedPendingActions"
        @accept="acceptPendingAction"
        @reject="rejectPendingAction"
      />
      <ChatComposer
        v-model="input"
        :disabled="chat.status !== 'ready'"
        @submit="sendCurrentInput"
      />
    </template>
  </section>
</template>
