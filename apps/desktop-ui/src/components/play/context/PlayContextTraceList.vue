<script setup lang="ts">
import type { PlayContextTraceView } from './types';

defineProps<{
  traces: readonly Readonly<PlayContextTraceView>[];
}>();
</script>

<template>
  <section class="play-context-trace-list" aria-label="Play turn context traces">
    <h3>Turn context</h3>
    <article v-for="trace in traces" :key="trace.id" class="play-context-trace-card">
      <header>
        <strong>{{ trace.transcriptWindowLabel }}</strong>
        <time :datetime="trace.createdAt">{{ trace.createdAt }}</time>
      </header>
      <p>{{ trace.eventWindowLabel }}</p>
      <ul v-if="trace.sources.length">
        <li v-for="source in trace.sources" :key="source.id">
          <span>{{ source.outcome === 'selected' ? '[used]' : '[omitted]' }}</span>
          <strong>{{ source.label }}</strong>
          <small v-if="source.reason">{{ source.reason }}</small>
          <small v-if="source.evidence">{{ source.evidence }}</small>
        </li>
      </ul>
      <p v-else>No activated source entered this turn context.</p>
    </article>
    <p v-if="traces.length === 0" class="play-context-trace-empty">
      A committed M5 turn will record its selected and omitted context here.
    </p>
  </section>
</template>

<style scoped>
.play-context-trace-list,
.play-context-trace-card,
.play-context-trace-card li {
  display: grid;
  gap: 6px;
}

.play-context-trace-list :where(h3, p, ul) {
  margin: 0;
}

.play-context-trace-card {
  padding: 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-context-trace-card header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.play-context-trace-card ul {
  padding-left: 16px;
}

.play-context-trace-card li small,
.play-context-trace-card time,
.play-context-trace-empty {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}
</style>
