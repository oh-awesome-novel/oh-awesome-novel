<script setup lang="ts">
import FileTreeNodeItem from './FileTreeNodeItem.vue';
import type { FileTreeNode } from '../../composables/useWorkspaceApi';

defineProps<{
  tree: FileTreeNode[];
  activePath?: string;
  loading: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  openFile: [path: string];
}>();
</script>

<template>
  <section class="sidebar-panel" aria-label="Workspace files">
    <div class="panel-heading compact-heading">
      <h2 class="panel-title">Files</h2>
      <span class="count-pill">{{ tree.length }}</span>
    </div>
    <p v-if="loading" class="empty-copy">读取文件树…</p>
    <p v-else-if="error" class="error-copy">{{ error }}</p>
    <ul v-else-if="tree.length" class="file-tree">
      <FileTreeNodeItem
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :active-path="activePath"
        :depth="0"
        @open-file="emit('openFile', $event)"
      />
    </ul>
    <p v-else class="empty-copy">这个 workspace 还没有可浏览文件。</p>
  </section>
</template>
