<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import type { FileTreeNode } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  node: FileTreeNode;
  activePath?: string;
  depth: number;
}>();

const emit = defineEmits<{
  openFile: [path: string];
}>();

const expanded = shallowRef(props.depth < 1);
const isDirectory = computed(() => props.node.type === 'directory');
const isActive = computed(() => props.node.path === props.activePath);

function activate() {
  if (isDirectory.value) {
    expanded.value = !expanded.value;
    return;
  }

  emit('openFile', props.node.path);
}
</script>

<template>
  <li class="file-node">
    <button
      class="file-node-button"
      :class="{ 'file-node-button-active': isActive }"
      type="button"
      :style="{ paddingLeft: `${10 + depth * 14}px` }"
      @click="activate"
    >
      <span class="file-node-caret">{{ isDirectory ? (expanded ? '▾' : '▸') : '·' }}</span>
      <span class="file-node-name">{{ node.name }}</span>
    </button>
    <ul v-if="isDirectory && expanded" class="file-node-children">
      <FileTreeNodeItem
        v-for="child in node.children ?? []"
        :key="child.path"
        :node="child"
        :active-path="activePath"
        :depth="depth + 1"
        @open-file="emit('openFile', $event)"
      />
    </ul>
  </li>
</template>
