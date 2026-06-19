<script setup lang="ts">
import { computed, reactive } from 'vue';

import CheckpointControls from './CheckpointControls.vue';
import ChatComposer from './ChatComposer.vue';
import ChatTranscript from './ChatTranscript.vue';
import PendingActionPanel from './PendingActionPanel.vue';
import ToolActivityList from './ToolActivityList.vue';
import { useAgentCheckpointChat, type PendingActionView } from '../../composables/useAgentCheckpointChat';

const {
  chat,
  input,
  messages,
  pendingActions,
  sendPrompt,
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

function runCheckpoint(prompt: string) {
  void sendPrompt(prompt);
}

function markPendingAction(action: PendingActionView, decision: 'accepted' | 'rejected') {
  decisions[action.id] = decision;
}
</script>

<template>
  <main class="checkpoint-shell">
    <section class="checkpoint-sidebar" aria-label="Agent checkpoints">
      <div class="brand-block">
        <p class="eyebrow">oh-awesome-novel</p>
        <h1 class="app-title">Agent Checkpoint</h1>
      </div>

      <CheckpointControls
        :status="chat.status"
        @run="runCheckpoint"
        @stop="stop"
      />

      <PendingActionPanel
        :actions="decoratedPendingActions"
        @accept="markPendingAction($event, 'accepted')"
        @reject="markPendingAction($event, 'rejected')"
      />
    </section>

    <section class="checkpoint-main" aria-label="Agent conversation">
      <ChatTranscript :messages="messages" />
      <ToolActivityList :messages="messages" />
      <ChatComposer
        v-model="input"
        :disabled="chat.status !== 'ready'"
        @submit="sendCurrentInput"
      />
    </section>
  </main>
</template>
