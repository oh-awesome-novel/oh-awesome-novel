<script setup lang="ts">
import { computed } from 'vue';

import type { PlayWorldEvent } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  events: PlayWorldEvent[];
  causeLabelsByEventId: Record<string, string[]>;
  hasHiddenPlayContent: boolean;
}>();

const showSpoilers = defineModel<boolean>('showSpoilers', { required: true });
const visibleEvents = computed(() =>
  showSpoilers.value
    ? props.events
    : props.events.filter((event) => event.visibility !== 'playerUnknown'),
);

function eventKindLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/gu, '$1 $2');
}

function causeLabels(eventId: string): string[] {
  return props.causeLabelsByEventId[eventId] ?? [];
}
</script>

<template>
  <section class="play-event-feed" aria-label="World events">
    <header>
      <div>
        <span>World motion</span>
        <h2>Recent events</h2>
      </div>
      <button
        v-if="hasHiddenPlayContent"
        type="button"
        role="switch"
        :aria-checked="showSpoilers"
        :aria-label="showSpoilers ? '关闭作者视图' : '开启作者视图，显示玩家未知内容和因果分析'"
        :title="showSpoilers ? '隐藏作者专用内容' : '作者视图：显示未知内容和因果分析'"
        @click="showSpoilers = !showSpoilers"
      >
        <span aria-hidden="true">{{ showSpoilers ? '[-]' : '[+]' }}</span>
        Author view
      </button>
    </header>

    <div v-if="visibleEvents.length" class="play-event-list">
      <article
        v-for="event in visibleEvents"
        :key="event.id"
        class="play-event-card"
        :class="`play-event-${event.visibility}`"
      >
        <div class="play-event-line" aria-hidden="true"></div>
        <div class="play-event-body">
          <div class="play-event-meta">
            <span>Turn {{ event.worldClock.turn }}</span>
            <span>{{ eventKindLabel(event.kind) }}</span>
            <span>{{ event.origin }}</span>
            <span>{{ event.visibility }}</span>
          </div>
          <h3>{{ event.title }}</h3>
          <p>{{ event.summary }}</p>
          <div v-if="causeLabels(event.id).length" class="play-event-cause">
            <span>Caused by</span>
            <ul>
              <li v-for="label in causeLabels(event.id)" :key="label">{{ label }}</li>
            </ul>
          </div>
          <details v-if="showSpoilers">
            <summary>Author cause detail</summary>
            <p>{{ event.cause.reason }}</p>
          </details>
        </div>
      </article>
    </div>

    <div v-else class="play-event-empty">
      <span aria-hidden="true">[ ]</span>
      <p>尚无已揭示的外部事件。世界变化会在完成回合后出现在这里。</p>
    </div>
  </section>
</template>
