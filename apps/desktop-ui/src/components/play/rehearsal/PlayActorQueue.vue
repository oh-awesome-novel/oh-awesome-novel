<script setup lang="ts">
import { useId } from 'vue';

import type {
  PlayRehearsalActorQueueItem,
  PlayRehearsalActorStatus,
} from './types';

const { items } = defineProps<{
  items: readonly Readonly<PlayRehearsalActorQueueItem>[];
}>();

const headingId = `${useId()}-actor-queue-heading`;

function statusLabel(status: PlayRehearsalActorStatus): string {
  switch (status) {
    case 'current': return 'Current';
    case 'waiting': return 'Waiting';
    case 'selected': return 'Selected';
    case 'committed': return 'Committed';
  }
}

function statusMarker(status: PlayRehearsalActorStatus): string {
  switch (status) {
    case 'current': return '[>]';
    case 'waiting': return '[ ]';
    case 'selected': return '[s]';
    case 'committed': return '[x]';
  }
}
</script>

<template>
  <section class="play-actor-queue" :aria-labelledby="headingId">
    <header>
      <div>
        <span>Director fixed</span>
        <h2 :id="headingId">Actor Queue</h2>
      </div>
      <span>{{ items.length }}</span>
    </header>

    <ol v-if="items.length">
      <li
        v-for="(item, index) in items"
        :key="item.participantRef"
        :data-status="item.status"
        :aria-current="item.status === 'current' ? 'step' : undefined"
      >
        <span class="play-actor-queue-marker" aria-hidden="true">{{ statusMarker(item.status) }}</span>
        <div>
          <header>
            <strong>{{ item.displayName }}</strong>
            <span>{{ statusLabel(item.status) }}</span>
          </header>
          <small>Queue {{ index + 1 }}<template v-if="item.position"> · {{ item.position }}</template></small>
          <p v-if="item.currentGoal">{{ item.currentGoal }}</p>
        </div>
      </li>
    </ol>
    <p v-else class="play-actor-queue-empty">No actors in this rehearsal.</p>
  </section>
</template>

<style scoped>
.play-actor-queue {
  min-width: 0;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-actor-queue > header,
.play-actor-queue > header > div,
.play-actor-queue li,
.play-actor-queue li header {
  display: flex;
  align-items: center;
}

.play-actor-queue > header {
  justify-content: space-between;
  gap: 8px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
}

.play-actor-queue > header > div {
  align-items: flex-start;
  flex-direction: column;
  gap: 1px;
}

.play-actor-queue > header span,
.play-actor-queue li header span,
.play-actor-queue small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-actor-queue h2 {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.play-actor-queue ol {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-actor-queue li {
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 2px solid transparent;
}

.play-actor-queue li:last-child {
  border-bottom: 0;
}

.play-actor-queue li[data-status="current"] {
  border-left-color: var(--play-ink, var(--editor-ink));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-actor-queue li[data-status="selected"] {
  border-left-style: double;
  border-left-color: var(--play-line-strong, var(--editor-hairline-strong));
}

.play-actor-queue li[data-status="committed"] {
  border-left-style: dotted;
  border-left-color: var(--play-success, var(--editor-success));
}

.play-actor-queue-marker {
  flex: 0 0 auto;
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-actor-queue li > div {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 3px;
}

.play-actor-queue li header {
  justify-content: space-between;
  gap: 6px;
}

.play-actor-queue strong {
  overflow: hidden;
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-actor-queue p,
.play-actor-queue-empty {
  margin: 0;
  color: var(--play-body, var(--editor-body));
  font-size: 10px;
  line-height: 1.45;
}

.play-actor-queue-empty {
  padding: 12px;
  color: var(--play-muted, var(--editor-muted));
}
</style>
