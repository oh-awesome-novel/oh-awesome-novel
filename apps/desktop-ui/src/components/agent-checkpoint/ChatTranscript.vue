<script setup lang="ts">
import type { UIMessage } from 'ai';

defineProps<{
  messages: UIMessage[];
}>();

function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}
</script>

<template>
  <div class="panel transcript-panel">
    <div class="panel-heading">
      <h2 class="panel-title">Conversation</h2>
      <span class="count-pill">{{ messages.length }}</span>
    </div>

    <div class="transcript">
      <article
        v-for="message in messages"
        :key="message.id"
        class="message-row"
        :class="`message-row-${message.role}`"
      >
        <div class="message-role">{{ message.role }}</div>
        <p class="message-text">{{ messageText(message) || '...' }}</p>
      </article>
    </div>
  </div>
</template>
