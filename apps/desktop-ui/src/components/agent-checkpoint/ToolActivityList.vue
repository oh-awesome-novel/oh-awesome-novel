<script setup lang="ts">
import { computed } from 'vue';
import type { UIMessage } from 'ai';

const props = defineProps<{
  messages: UIMessage[];
}>();

const toolParts = computed(() =>
  props.messages.flatMap((message) =>
    message.parts.filter((part) =>
      part.type.startsWith('tool-') || part.type === 'data-tool-log',
    ),
  ),
);

function toolLabel(part: UIMessage['parts'][number]): string {
  if ('toolName' in part && typeof part.toolName === 'string') {
    return part.toolName;
  }

  if (
    part.type === 'data-tool-log' &&
    typeof part.data === 'object' &&
    part.data !== null &&
    'toolCall' in part.data
  ) {
    const toolCall = part.data.toolCall as { name?: unknown };
    return typeof toolCall.name === 'string' ? toolCall.name : 'tool';
  }

  return part.type;
}
</script>

<template>
  <div class="panel tool-panel">
    <div class="panel-heading">
      <h2 class="panel-title">Tool Activity</h2>
      <span class="count-pill">{{ toolParts.length }}</span>
    </div>

    <div class="tool-list">
      <div v-for="(part, index) in toolParts" :key="index" class="tool-row">
        <span class="tool-name">{{ toolLabel(part) }}</span>
        <span class="tool-kind">{{ part.type }}</span>
      </div>
    </div>
  </div>
</template>
