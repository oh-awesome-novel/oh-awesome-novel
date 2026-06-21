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
  <div class="transcript-panel agent-timeline-panel">
    <div class="panel-heading">
      <h2 class="panel-title">Agent Timeline</h2>
      <span class="count-pill">{{ items.length }}</span>
    </div>

    <div class="transcript agent-timeline">
      <article
        v-for="item in items"
        :key="item.id"
        class="timeline-item"
        :class="`timeline-item-${item.type}`"
      >
        <template v-if="item.type === 'tool-activity'">
          <button class="tool-row timeline-tool-row" type="button" @click="toggleTool(item.id)">
            <span class="tool-name">{{ item.label }}</span>
            <span class="tool-kind">{{ expandedTools[item.id] ? 'expanded' : item.detail }}</span>
          </button>
          <pre v-if="expandedTools[item.id]" class="tool-detail">{{ item.detail }}</pre>
        </template>
        <template v-else-if="item.type === 'status'">
          <p class="timeline-status">{{ item.text }}</p>
        </template>
        <template v-else>
          <div class="message-row" :class="`message-row-${item.role}`">
            <div class="message-role">{{ item.role }}</div>
            <p class="message-text">{{ item.text }}</p>
            <button class="ghost-button timeline-copy" type="button" @click="copyText(item.text)">
              Copy
            </button>
          </div>
        </template>
      </article>
    </div>
  </div>
</template>
