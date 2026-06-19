<script setup lang="ts">
import ChapterNavigationView from './ChapterNavigationView.vue';
import FileTreePanel from './FileTreePanel.vue';
import type {
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
  FileTreeNode,
} from '../../composables/useWorkspaceApi';

defineProps<{
  tab: 'files' | 'chapters';
  tree: FileTreeNode[];
  activePath: string;
  treeLoading: boolean;
  treeError: string;
  chapterIndex?: ChapterIndex;
  chapterStatus?: ChapterIndexStatus;
  chaptersLoading: boolean;
  chaptersError: string;
}>();

const emit = defineEmits<{
  updateTab: [tab: 'files' | 'chapters'];
  openFile: [path: string];
  openChapter: [chapter: ChapterIndexChapter];
  rescanChapters: [];
  pin: [];
}>();
</script>

<template>
  <aside class="workspace-left-panel" aria-label="Workspace navigation">
    <div class="left-panel-toolbar">
      <div class="segmented-control">
        <button
          class="segment-button"
          :class="{ 'segment-button-active': tab === 'files' }"
          type="button"
          @click="emit('updateTab', 'files')"
        >
          Files
        </button>
        <button
          class="segment-button"
          :class="{ 'segment-button-active': tab === 'chapters' }"
          type="button"
          @click="emit('updateTab', 'chapters')"
        >
          Chapters
        </button>
      </div>
      <button class="icon-button" type="button" aria-label="固定左栏" @click="emit('pin')">
        ⇥
      </button>
    </div>

    <FileTreePanel
      v-if="tab === 'files'"
      :tree="tree"
      :active-path="activePath"
      :loading="treeLoading"
      :error="treeError"
      @open-file="emit('openFile', $event)"
    />
    <ChapterNavigationView
      v-else
      :index="chapterIndex"
      :status="chapterStatus"
      :active-path="activePath"
      :loading="chaptersLoading"
      :error="chaptersError"
      @open-chapter="emit('openChapter', $event)"
      @rescan="emit('rescanChapters')"
    />
  </aside>
</template>
