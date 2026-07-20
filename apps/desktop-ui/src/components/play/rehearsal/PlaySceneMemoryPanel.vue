<script setup lang="ts">
import type { PlaySceneMemoryView } from './types';

defineProps<{
  memory?: Readonly<PlaySceneMemoryView>;
  lens: 'player' | 'director';
  loading: boolean;
  rebuilding: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  updateLens: [lens: 'player' | 'director'];
  refresh: [];
  rebuild: [];
}>();
</script>

<template>
  <section class="play-scene-memory-panel" aria-label="Scene memory" :aria-busy="loading || rebuilding">
    <header>
      <div>
        <span>Rebuildable projection</span>
        <h2>Scene Memory</h2>
      </div>
      <div class="play-scene-memory-actions">
        <div role="group" aria-label="Scene Memory lens">
          <button
            type="button"
            :aria-pressed="lens === 'player'"
            :disabled="loading || rebuilding"
            @click="emit('updateLens', 'player')"
          >Player</button>
          <button
            type="button"
            :aria-pressed="lens === 'director'"
            :disabled="loading || rebuilding"
            @click="emit('updateLens', 'director')"
          >Director</button>
        </div>
        <button type="button" :disabled="loading || rebuilding" @click="emit('refresh')">Refresh</button>
        <button type="button" :disabled="loading || rebuilding" @click="emit('rebuild')">
          {{ rebuilding ? 'Rebuilding…' : 'Rebuild' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="play-scene-memory-error" role="alert">{{ error }}</p>
    <p v-if="memory?.status === 'stale'" class="play-scene-memory-stale" role="status">
      Memory is stale: {{ memory.staleReasons.join(', ') || 'selected branch context changed' }}.
    </p>
    <dl v-if="memory" class="play-scene-memory-meta">
      <div><dt>Lens</dt><dd>{{ memory.lens }}</dd></div>
      <div><dt>Revision</dt><dd>{{ memory.revision }}</dd></div>
      <div><dt>Built</dt><dd><time :datetime="memory.builtAt">{{ memory.builtAt }}</time></dd></div>
    </dl>
    <ul v-if="memory?.items.length">
      <li v-for="item in memory.items" :key="item.id">
        <span>{{ item.kind }}</span>
        <strong>{{ item.summary }}</strong>
        <small v-if="item.provenanceLabel">{{ item.provenanceLabel }}</small>
      </li>
    </ul>
    <p v-else-if="!loading" class="play-scene-memory-empty">
      No Scene Memory is stored for this selected branch and lens.
    </p>
    <p class="play-scene-memory-announcement" role="status" aria-live="polite">
      {{ loading ? 'Loading Scene Memory…' : rebuilding ? 'Rebuilding Scene Memory…' : '' }}
    </p>
  </section>
</template>

<style scoped>
.play-scene-memory-panel {
  display: grid;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-scene-memory-panel > header,
.play-scene-memory-actions,
.play-scene-memory-actions > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
}

.play-scene-memory-panel :where(h2, p, dl, ul) {
  margin: 0;
}

.play-scene-memory-panel h2 {
  font-size: 13px;
}

.play-scene-memory-panel header span,
.play-scene-memory-panel dt,
.play-scene-memory-panel small,
.play-scene-memory-empty,
.play-scene-memory-announcement {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-scene-memory-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.play-scene-memory-meta div {
  display: flex;
  gap: 4px;
}

.play-scene-memory-meta dd {
  margin: 0;
  font-size: 10px;
}

.play-scene-memory-panel ul {
  display: grid;
  gap: 6px;
  padding-left: 16px;
}

.play-scene-memory-panel li {
  display: grid;
  gap: 2px;
  font-size: 10px;
}

.play-scene-memory-error,
.play-scene-memory-stale {
  color: var(--play-danger, var(--editor-danger));
}

@media (max-width: 760px) {
  .play-scene-memory-panel > header,
  .play-scene-memory-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
