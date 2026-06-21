<script setup lang="ts">
import {
  BookOpen,
  Files,
  GitBranch,
  History,
  Settings,
  ShieldCheck,
  SquarePen,
} from '@lucide/vue';
import ChapterNavigationView from './ChapterNavigationView.vue';
import ConversationHistoryPanel from './ConversationHistoryPanel.vue';
import FileTreePanel from './FileTreePanel.vue';
import type { AgentConversationSummary } from '../../composables/useAgentConversationSessions';
import type {
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
  FileTreeNode,
} from '../../composables/useWorkspaceApi';

defineProps<{
  tab: 'files' | 'chapters' | 'history';
  tree: FileTreeNode[];
  activePath: string;
  treeLoading: boolean;
  treeError: string;
  chapterIndex?: ChapterIndex;
  chapterStatus?: ChapterIndexStatus;
  chaptersLoading: boolean;
  chaptersError: string;
  gitAutoCommitOnAccept: boolean;
  conversations: AgentConversationSummary[];
}>();

const emit = defineEmits<{
  updateTab: [tab: 'files' | 'chapters' | 'history'];
  openFile: [path: string];
  openChapter: [chapter: ChapterIndexChapter];
  rescanChapters: [];
  configureProvider: [];
  newConversation: [];
  selectConversation: [id: string];
}>();
</script>

<template>
  <aside class="workspace-left-panel" aria-label="Workspace navigation">
    <div class="left-panel-toolbar">
      <nav class="left-nav-list" aria-label="Workspace actions">
        <button
          class="left-nav-item"
          type="button"
          @click="emit('newConversation')"
        >
          <SquarePen :size="21" aria-hidden="true" />
          <span>新对话</span>
        </button>
        <button
          class="left-nav-item"
          :class="{ 'left-nav-item-active': tab === 'history' }"
          type="button"
          @click="emit('updateTab', 'history')"
        >
          <History :size="21" aria-hidden="true" />
          <span>历史对话</span>
        </button>
        <button
          class="left-nav-item"
          :class="{ 'left-nav-item-active': tab === 'files' }"
          type="button"
          @click="emit('updateTab', 'files')"
        >
          <Files :size="21" aria-hidden="true" />
          <span>文件</span>
        </button>
        <button
          class="left-nav-item"
          :class="{ 'left-nav-item-active': tab === 'chapters' }"
          type="button"
          @click="emit('updateTab', 'chapters')"
        >
          <BookOpen :size="21" aria-hidden="true" />
          <span>章节</span>
        </button>
      </nav>
    </div>

    <div class="left-panel-main">
      <ConversationHistoryPanel
        v-if="tab === 'history'"
        :conversations="conversations"
        @select-conversation="emit('selectConversation', $event)"
      />
      <FileTreePanel
        v-else-if="tab === 'files'"
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
      <button
        class="left-panel-status-icon-button"
        type="button"
        aria-label="Provider settings"
        title="Provider settings"
        @click="emit('configureProvider')"
      >
        <Settings :size="14" aria-hidden="true" />
      </button>
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
