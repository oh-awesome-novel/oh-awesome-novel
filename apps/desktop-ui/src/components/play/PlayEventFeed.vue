<script setup lang="ts">
import { computed } from 'vue';

import type { PlayWorldEvent } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  events: PlayWorldEvent[];
}>();

const showSpoilers = defineModel<boolean>('showSpoilers', { required: true });
const hiddenCount = computed(() =>
  props.events.filter((event) => event.visibility === 'playerUnknown').length,
);
const visibleEvents = computed(() =>
  showSpoilers.value
    ? props.events
    : props.events.filter((event) => event.visibility !== 'playerUnknown'),
);

function eventKindLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/gu, '$1 $2');
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
        v-if="hiddenCount"
        type="button"
        role="switch"
        :aria-checked="showSpoilers"
        :title="showSpoilers ? '隐藏玩家未知事件' : '作者视图：显示未知事件'"
        @click="showSpoilers = !showSpoilers"
      >
        <span aria-hidden="true">{{ showSpoilers ? '[-]' : '[+]' }}</span>
        {{ hiddenCount }} hidden
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
          <details>
            <summary>Cause</summary>
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
