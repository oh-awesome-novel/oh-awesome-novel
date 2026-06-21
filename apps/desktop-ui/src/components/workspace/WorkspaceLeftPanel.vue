<script setup lang="ts">
import { GitBranch, ShieldCheck } from '@lucide/vue';
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
  gitAutoCommitOnAccept: boolean;
}>();

const emit = defineEmits<{
  updateTab: [tab: 'files' | 'chapters'];
  openFile: [path: string];
  openChapter: [chapter: ChapterIndexChapter];
  rescanChapters: [];
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
    </div>

    <div class="left-panel-main">
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
    </div>

    <footer class="left-panel-status" aria-label="Workspace safeguards">
      <span class="left-panel-status-pill left-panel-status-pill-review" title="所有写入先进入 PendingAction 审阅">
        <ShieldCheck :size="14" aria-hidden="true" />
        审阅保护
      </span>
      <span
        class="left-panel-status-pill left-panel-status-pill-git"
        :class="{ 'left-panel-status-pill-muted': !gitAutoCommitOnAccept }"
        :title="gitAutoCommitOnAccept ? '接受 PendingAction 后自动提交' : '当前 workspace 已关闭 PendingAction 自动提交'"
      >
        <GitBranch :size="14" aria-hidden="true" />
        {{ gitAutoCommitOnAccept ? 'Git 自动提交' : 'Git 手动提交' }}
      </span>
    </footer>
  </aside>
</template>
