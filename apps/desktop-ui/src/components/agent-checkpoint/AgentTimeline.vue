<script setup lang="ts">
import { shallowRef } from 'vue';

import type { AgentTimelineItem } from '../../composables/useAgentTimeline';

defineProps<{
  items: AgentTimelineItem[];
}>();

const expandedTools = shallowRef<Record<string, boolean>>({});

function toggleTool(id: string) {
  expandedTools.value = {
    ...expandedTools.value,
    [id]: !expandedTools.value[id],
  };
}

async function copyText(text: string) {
  await navigator.clipboard?.writeText(text);
}
</script>

<template>
  <div class="transcript-panel agent-timeline-panel" aria-label="Agent conversation">
    <div v-if="items.length === 0" class="conversation-empty">
      <span>等待新的对话</span>
    </div>

    <div v-else class="transcript agent-timeline agent-conversation">
      <article
        v-for="item in items"
        :key="item.id"
        class="timeline-item conversation-item"
        :class="`timeline-item-${item.type}`"
      >
        <template v-if="item.type === 'tool-activity'">
          <div class="conversation-tool-event">
            <button class="conversation-tool-button" type="button" @click="toggleTool(item.id)">
              <span class="conversation-tool-dot" aria-hidden="true"></span>
              <span class="conversation-tool-name">{{ item.label }}</span>
              <span class="conversation-tool-kind">
                {{ expandedTools[item.id] ? '收起详情' : item.detail }}
              </span>
            </button>
            <pre v-if="expandedTools[item.id]" class="tool-detail">{{ item.detail }}</pre>
          </div>
        </template>
        <template v-else-if="item.type === 'status'">
          <p class="timeline-status conversation-status">{{ item.text }}</p>
        </template>
        <template v-else>
          <div class="conversation-message" :class="`conversation-message-${item.role}`">
            <p class="message-text">{{ item.text }}</p>
            <button
              class="conversation-copy-button"
              type="button"
              aria-label="Copy message"
              @click="copyText(item.text)"
            >
              Copy
            </button>
          </div>
        </template>
      </article>
    </div>
  </div>
</template>
