<script setup lang="ts">
import type { PlayContextSourceTraceView, PlayContextTraceView } from './types';

defineProps<{
  traces: readonly Readonly<PlayContextTraceView>[];
}>();
function groups(sources: readonly PlayContextSourceTraceView[]) {
  const grouped = new Map<string, PlayContextSourceTraceView[]>();
  for (const source of sources) {
    const label = source.workLabel ?? (sources.some(s => s.workLabel) ? '未标注作品' : '');
    grouped.set(label, [...grouped.get(label) ?? [], source]);
  }
  return [...grouped].map(([label, sources]) => ({ label, sources }));
}
</script>

<template>
  <section class="play-context-trace-list" aria-label="回合上下文记录">
    <h3>回合上下文</h3>
    <article v-for="trace in traces" :key="trace.id" class="play-context-trace-card">
      <header>
        <strong>{{ trace.transcriptWindowLabel }}</strong>
        <time :datetime="trace.createdAt">{{ trace.createdAt }}</time>
      </header>
      <p>{{ trace.eventWindowLabel }}</p>
      <p v-for="notice in trace.stageMarkupNotices ?? []" :key="notice" class="play-context-trace-notice">{{ notice }}</p>
      <section v-for="group in groups(trace.sources)" :key="group.label" class="work-source-group">
        <h4 v-if="group.label">{{ group.label }}</h4>
      <ul>
        <li v-for="source in group.sources" :key="source.id">
          <span>{{ source.outcome === 'selected' ? '[已使用]' : '[已省略]' }}</span>
          <strong>{{ source.label }}</strong>
          <small v-if="source.reason">{{ source.reason }}</small>
          <small v-if="source.evidence">{{ source.evidence }}</small>
        </li>
      </ul>
      </section>
      <p v-if="!trace.sources.length">这一回合的上下文没有使用启用的来源。</p>
    </article>
    <p v-if="traces.length === 0" class="play-context-trace-empty">
      提交回合后，这里会记录选用和省略的上下文。
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
