<script setup lang="ts">
import type { WorkspaceMode } from '../../composables/useWorkspaceLayoutState';

defineProps<{
  activeMode: WorkspaceMode;
}>();

const emit = defineEmits<{
  selectMode: [mode: WorkspaceMode];
}>();

const modes = [
  { id: 'writing', label: 'Writing', marker: '[W]' },
  { id: 'play', label: 'Play', marker: '[P]' },
] as const;
</script>

<template>
  <nav class="workspace-mode-navigation" aria-label="Workspace mode">
    <button
      v-for="mode in modes"
      :key="mode.id"
      class="workspace-mode-button"
      :class="{ 'workspace-mode-button-active': activeMode === mode.id }"
      type="button"
      :aria-current="activeMode === mode.id ? 'page' : undefined"
      @click="emit('selectMode', mode.id)"
    >
      <span class="workspace-mode-marker" aria-hidden="true">{{ mode.marker }}</span>
      <span>{{ mode.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.workspace-mode-navigation {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0;
  border-bottom: 1px solid var(--editor-hairline);
  background: transparent;
}

.workspace-mode-button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--editor-muted);
  font-size: 12px;
  font-weight: 500;
}

.workspace-mode-button-active {
  color: var(--editor-ink);
  box-shadow: inset 0 -2px var(--editor-ink);
}

.workspace-mode-marker {
  color: var(--editor-faint);
  font-size: 10px;
}
</style>
