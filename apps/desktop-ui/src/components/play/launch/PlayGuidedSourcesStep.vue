<script setup lang="ts">
import { useId } from 'vue';

import type { PlayGuidedSourceOption } from '../../../composables/usePlayGuidedStart';

const { sources, selectedSourceIds, error, disabled } = defineProps<{
  sources: readonly Readonly<PlayGuidedSourceOption>[];
  selectedSourceIds: readonly string[];
  error?: string;
  disabled: boolean;
}>();

const emit = defineEmits<{
  toggle: [sourceId: string, selected: boolean];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-guided-sources`;

function toggle(sourceId: string, event: Event): void {
  emit('toggle', sourceId, (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <form class="guided-step" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>Step 1 / 5</span>
      <h2 :id="`${prefix}-heading`">Sources</h2>
      <p>Select real files from this workspace. Their domain determines the launch role.</p>
    </header>

    <p v-if="error" :id="`${prefix}-error`" class="field-error" role="alert">{{ error }}</p>

    <ul v-if="sources.length" class="source-tree" :aria-describedby="error ? `${prefix}-error` : undefined">
      <li v-for="source in sources" :key="source.sourceId">
        <label>
          <input
            type="checkbox"
            :name="`guided-source-${source.sourceId}`"
            :value="source.sourceId"
            :checked="selectedSourceIds.includes(source.sourceId)"
            :disabled="disabled || (!selectedSourceIds.includes(source.sourceId) && selectedSourceIds.length >= 24)"
            @change="toggle(source.sourceId, $event)"
          >
          <span class="source-copy">
            <strong>{{ source.name }}</strong>
            <small>{{ source.path }}</small>
          </span>
          <span class="role-badge">{{ source.role }}</span>
        </label>
      </li>
    </ul>
    <p v-else class="empty-state">No selectable workspace files are available.</p>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">Cancel</button>
      <button class="primary" type="submit" :disabled="disabled">Continue to Entry</button>
    </footer>
  </form>
</template>

<style scoped>
.guided-step,
.guided-step > header,
.source-tree {
  display: grid;
  gap: 12px;
}

.guided-step > header {
  gap: 4px;
}

.guided-step h2,
.guided-step p {
  margin: 0;
}

.guided-step h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

.guided-step > header > span,
.guided-step > header p,
.source-copy small,
.empty-state {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.source-tree {
  max-height: min(44vh, 430px);
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.source-tree li {
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.source-tree label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  cursor: pointer;
}

.source-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.source-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-badge {
  padding: 2px 6px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
  text-transform: uppercase;
}

.field-error {
  color: var(--play-danger, var(--editor-danger));
  font-size: 11px;
}

footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
}

button {
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}
</style>
