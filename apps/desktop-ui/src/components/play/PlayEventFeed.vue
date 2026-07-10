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

<style scoped>
.play-event-feed {
  display: grid;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid rgb(235 226 212);
}

.play-event-feed > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.play-event-feed header span {
  color: rgb(180 83 9);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.play-event-feed h2 {
  margin: 2px 0 0;
  color: rgb(68 54 43);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 16px;
}

.play-event-feed header button {
  display: inline-flex;
  min-height: 27px;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid rgb(224 208 185);
  border-radius: 7px;
  background: rgb(255 253 249);
  color: rgb(120 83 51);
  font-size: 9px;
  font-weight: 800;
}

.play-event-list {
  display: grid;
  gap: 8px;
}

.play-event-card {
  display: grid;
  grid-template-columns: 3px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgb(235 226 212);
  border-radius: 8px;
  background: rgb(255 253 249);
}

.play-event-line {
  background: rgb(217 119 6);
}

.play-event-rumor .play-event-line {
  background: rgb(147 51 234);
}

.play-event-playerUnknown {
  border-style: dashed;
  opacity: .76;
}

.play-event-playerUnknown .play-event-line {
  background: rgb(71 85 105);
}

.play-event-body {
  padding: 9px 10px;
}

.play-event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.play-event-meta span {
  color: rgb(166 102 45);
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
}

.play-event-card h3 {
  margin: 5px 0 0;
  color: rgb(82 60 43);
  font-size: 11px;
}

.play-event-card p,
.play-event-card summary,
.play-event-empty p {
  margin: 4px 0 0;
  color: rgb(139 112 88);
  font-size: 10px;
  line-height: 1.45;
}

.play-event-card summary {
  cursor: pointer;
  font-weight: 800;
}

.play-event-empty {
  display: grid;
  justify-items: center;
  padding: 16px 8px;
  color: rgb(180 140 101);
  text-align: center;
}

:global([data-theme="dark"]) .play-event-feed {
  border-color: rgb(68 58 49);
}

:global([data-theme="dark"]) .play-event-feed h2,
:global([data-theme="dark"]) .play-event-card h3 {
  color: rgb(245 235 220);
}

:global([data-theme="dark"]) .play-event-card,
:global([data-theme="dark"]) .play-event-feed header button {
  border-color: rgb(83 70 58);
  background: rgb(38 32 28);
}
</style>
