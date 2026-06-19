<script setup lang="ts">
import type { WorkspaceRightTab } from '../../composables/useWorkspaceLayoutState';

defineProps<{
  activeTab: WorkspaceRightTab;
}>();

const emit = defineEmits<{
  select: [tab: WorkspaceRightTab];
  close: [];
}>();

const tabs: Array<{ id: WorkspaceRightTab; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'diff', label: 'Diff' },
  { id: 'approval', label: 'Approval' },
  { id: 'health', label: 'Health' },
  { id: 'git', label: 'Git' },
  { id: 'references', label: 'Refs' },
  { id: 'play', label: 'Play' },
];
</script>

<template>
  <div class="right-panel-tabs" role="tablist" aria-label="Workspace review tabs">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="right-panel-tab"
      :class="{ 'right-panel-tab-active': activeTab === tab.id }"
      type="button"
      role="tab"
      :aria-selected="activeTab === tab.id"
      @click="emit('select', tab.id)"
    >
      {{ tab.label }}
    </button>
    <button class="icon-button" type="button" aria-label="隐藏右栏" @click="emit('close')">
      ×
    </button>
  </div>
</template>
