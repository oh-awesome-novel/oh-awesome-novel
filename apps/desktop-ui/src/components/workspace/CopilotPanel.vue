<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

import ChatComposer from '../agent-checkpoint/ChatComposer.vue';
import ChatTranscript from '../agent-checkpoint/ChatTranscript.vue';
import PendingActionPanel from '../agent-checkpoint/PendingActionPanel.vue';
import ToolActivityList from '../agent-checkpoint/ToolActivityList.vue';
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
}>();

const {
  chat,
  input,
  messages,
  pendingActions,
  sendCurrentInput,
  stop,
} = useAgentCheckpointChat();

const decisions = reactive<Record<string, 'accepted' | 'rejected'>>({});
const decoratedPendingActions = computed(() =>
  pendingActions.value.map((action) => ({
    ...action,
    decision: decisions[action.id],
  })),
);

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

function markPendingAction(action: PendingActionView, decision: 'accepted' | 'rejected') {
  decisions[action.id] = decision;
}
</script>

<template>
  <aside class="copilot-panel" aria-label="Agent Copilot">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Copilot</p>
        <h2 class="panel-title">Agent</h2>
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
      <PendingActionPanel
        :actions="decoratedPendingActions"
        @accept="markPendingAction($event, 'accepted')"
        @reject="markPendingAction($event, 'rejected')"
      />
      <ChatComposer
        v-model="input"
        :disabled="chat.status !== 'ready'"
        @submit="sendCurrentInput"
      />
    </template>
  </aside>
</template>
