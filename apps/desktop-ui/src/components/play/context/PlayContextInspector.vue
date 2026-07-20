<script setup lang="ts">
import PlayContextTraceList from './PlayContextTraceList.vue';
import PlaySourceDriftControls from './PlaySourceDriftControls.vue';
import type {
  PlayContextTraceView,
  PlaySourceDriftDecisionDraft,
  PlaySourceDriftView,
} from './types';

defineProps<{
  traces: readonly Readonly<PlayContextTraceView>[];
  drift?: Readonly<PlaySourceDriftView>;
  loading: boolean;
  busy: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  refresh: [];
  decide: [decision: PlaySourceDriftDecisionDraft];
}>();
</script>

<template>
  <section class="play-context-inspector" aria-label="Play context inspector" :aria-busy="loading || busy">
    <header>
      <span>Context evidence</span>
      <h2>Sources &amp; windows</h2>
    </header>
    <p v-if="error" class="play-context-inspector-error" role="alert">{{ error }}</p>
    <PlaySourceDriftControls
      :drift="drift"
      :busy="busy"
      @refresh="emit('refresh')"
      @decide="emit('decide', $event)"
    />
    <PlayContextTraceList :traces="traces" />
    <p class="play-context-inspector-status" role="status" aria-live="polite">
      {{ loading ? 'Refreshing Play context evidence…' : '' }}
    </p>
  </section>
</template>

<style scoped>
.play-context-inspector {
  display: grid;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-context-inspector > header {
  display: grid;
  gap: 2px;
}

.play-context-inspector :where(h2, p) {
  margin: 0;
}

.play-context-inspector > header span,
.play-context-inspector-status {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-context-inspector h2 {
  font-size: 13px;
}

.play-context-inspector-error {
  color: var(--play-danger, var(--editor-danger));
}
</style>
