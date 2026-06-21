<script setup lang="ts">
import { shallowRef } from 'vue';
import { ListCollapse } from '@lucide/vue';

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

const collapseVersion = shallowRef(0);

function collapseAll() {
  collapseVersion.value += 1;
}
</script>

<template>
  <section class="sidebar-panel" aria-label="Workspace files">
    <div class="panel-heading compact-heading">
      <h2 class="panel-title">Files</h2>
      <button
        class="heading-icon-button"
        type="button"
        :disabled="loading || tree.length === 0"
        aria-label="全部收齐"
        title="全部收齐"
        @click="collapseAll"
      >
        <ListCollapse :size="15" aria-hidden="true" />
      </button>
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
        :collapse-version="collapseVersion"
        @open-file="emit('openFile', $event)"
      />
    </ul>
    <p v-else class="empty-copy">这个 workspace 还没有可浏览文件。</p>
  </section>
</template>
