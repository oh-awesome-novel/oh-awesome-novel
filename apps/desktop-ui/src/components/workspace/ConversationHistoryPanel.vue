<script setup lang="ts">
import { MessageSquareText } from '@lucide/vue';
import type { AgentConversationSummary } from '../../composables/useAgentConversationSessions';

defineProps<{
  conversations: AgentConversationSummary[];
}>();

const emit = defineEmits<{
  selectConversation: [id: string];
}>();
</script>

<template>
  <section class="sidebar-panel" aria-label="Conversation history">
    <div class="panel-heading compact-heading">
      <h2 class="panel-title">历史对话</h2>
    </div>

    <div v-if="conversations.length > 0" class="conversation-history-list">
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        class="conversation-history-row"
        :class="{ 'conversation-history-row-active': conversation.active }"
        type="button"
        @click="emit('selectConversation', conversation.id)"
      >
        <MessageSquareText :size="16" aria-hidden="true" />
        <span class="conversation-history-copy">
          <strong>{{ conversation.title }}</strong>
          <span>{{ conversation.preview }}</span>
        </span>
      </button>
    </div>

    <p v-else class="empty-copy">暂无历史对话。</p>
  </section>
</template>
