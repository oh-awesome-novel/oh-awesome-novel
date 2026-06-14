<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';

import ChapterNavigationView from './ChapterNavigationView.vue';
import CopilotPanel from './CopilotPanel.vue';
import FileTreePanel from './FileTreePanel.vue';
import FileViewer from './FileViewer.vue';
import WorkspaceHome from './WorkspaceHome.vue';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
  FileTreeNode,
  WorkspaceStatus,
  WorkspaceSummary,
} from '../../composables/useWorkspaceApi';

const props = defineProps<{
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
}>();

const emit = defineEmits<{
  leaveWorkspace: [];
  configureProvider: [];
}>();

const api = useWorkspaceApi();
const leftVisible = shallowRef(true);
const copilotVisible = shallowRef(false);
const searchOpen = shallowRef(false);
const searchQuery = shallowRef('');
const sidebarTab = shallowRef<'files' | 'chapters'>('files');
const activeFilePath = shallowRef('');
const fileContent = shallowRef('');
const fileLoading = shallowRef(false);
const fileError = shallowRef('');
const tree = shallowRef<FileTreeNode[]>([]);
const treeLoading = shallowRef(false);
const treeError = shallowRef('');
const chapterIndex = shallowRef<ChapterIndex>();
const chapterStatus = shallowRef<ChapterIndexStatus>();
const chaptersLoading = shallowRef(false);
const chaptersError = shallowRef('');
const workspaceStatus = shallowRef<WorkspaceStatus>();
const queuedPrompt = shallowRef('');

const shellClass = computed(() => ({
  'workspace-shell-left-hidden': !leftVisible.value,
  'workspace-shell-copilot-visible': copilotVisible.value,
}));
const fileSearchResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const files = flattenFileNodes(tree.value).filter((node) => node.type === 'file');

  if (!query) {
    return files.slice(0, 12);
  }

  return files
    .filter((node) => node.path.toLowerCase().includes(query) || node.name.toLowerCase().includes(query))
    .slice(0, 20);
});

onMounted(() => {
  void loadTree();
  void loadChapters();
  void loadWorkspaceStatus();
});

async function loadTree() {
  treeLoading.value = true;
  treeError.value = '';

  try {
    tree.value = (await api.getWorkspaceTree()).tree;
  } catch (error) {
    treeError.value = error instanceof Error ? error.message : String(error);
  } finally {
    treeLoading.value = false;
  }
}

async function loadChapters() {
  chaptersLoading.value = true;
  chaptersError.value = '';

  try {
    const result = await api.getChapters();
    chapterIndex.value = result.index;
    chapterStatus.value = result.status;
  } catch (error) {
    chaptersError.value = error instanceof Error ? error.message : String(error);
  } finally {
    chaptersLoading.value = false;
  }
}

async function rescanChapters() {
  chaptersLoading.value = true;
  chaptersError.value = '';

  try {
    const result = await api.rescanChapters();
    chapterIndex.value = {
      volumes: result.index.volumes,
    };
    chapterStatus.value = result.status;
  } catch (error) {
    chaptersError.value = error instanceof Error ? error.message : String(error);
  } finally {
    chaptersLoading.value = false;
  }
}

async function loadWorkspaceStatus() {
  try {
    workspaceStatus.value = await api.getWorkspaceStatus();
  } catch {
    workspaceStatus.value = {
      pendingActionCount: 0,
      git: {
        status: 'unknown',
        dirty: null,
      },
    };
  }
}

async function openFile(path: string) {
  searchOpen.value = false;
  activeFilePath.value = path;
  fileLoading.value = true;
  fileError.value = '';
  fileContent.value = '';

  try {
    fileContent.value = (await api.getWorkspaceFile(path)).content;
  } catch (error) {
    fileError.value = error instanceof Error ? error.message : String(error);
  } finally {
    fileLoading.value = false;
  }
}

function openChapter(chapter: ChapterIndexChapter) {
  sidebarTab.value = 'chapters';
  void openFile(chapter.path);
}

function openChapterNavigation() {
  sidebarTab.value = 'chapters';
  leftVisible.value = true;
}

function openCopilot(prompt?: string) {
  copilotVisible.value = true;

  if (prompt) {
    queuedPrompt.value = prompt;
  }
}

function openPendingActions() {
  copilotVisible.value = true;
  void loadWorkspaceStatus();
}

function clearQueuedPrompt() {
  queuedPrompt.value = '';
}

function showHome() {
  activeFilePath.value = '';
  fileContent.value = '';
  fileError.value = '';
}

function flattenFileNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenFileNodes(node.children ?? []),
  ]);
}
</script>

<template>
  <main class="workspace-shell" :class="shellClass">
    <header class="workspace-toolbar">
      <div class="toolbar-left">
        <button class="icon-button" type="button" aria-label="切换文件栏" @click="leftVisible = !leftVisible">
          ☰
        </button>
        <button class="ghost-button" type="button" @click="showHome">Home</button>
        <button class="ghost-button" type="button" @click="openChapterNavigation">Chapters</button>
        <button class="ghost-button" type="button" @click="searchOpen = true">Search</button>
      </div>
      <div class="toolbar-title">
        <strong>{{ props.workspace.name }}</strong>
        <span>{{ props.workspace.path }}</span>
      </div>
      <div class="toolbar-right">
        <span class="status-pill">{{ providerConfigured ? 'Provider ready' : 'Read-only' }}</span>
        <button class="ghost-button" type="button" @click="emit('configureProvider')">Settings</button>
        <button class="ghost-button" type="button" @click="copilotVisible = !copilotVisible">
          Copilot
        </button>
        <button class="ghost-button" type="button" @click="emit('leaveWorkspace')">Launcher</button>
      </div>
    </header>

    <aside v-if="leftVisible" class="workspace-sidebar" aria-label="Workspace navigation">
      <div class="segmented-control">
        <button
          class="segment-button"
          :class="{ 'segment-button-active': sidebarTab === 'files' }"
          type="button"
          @click="sidebarTab = 'files'"
        >
          Files
        </button>
        <button
          class="segment-button"
          :class="{ 'segment-button-active': sidebarTab === 'chapters' }"
          type="button"
          @click="sidebarTab = 'chapters'"
        >
          Chapters
        </button>
      </div>

      <FileTreePanel
        v-if="sidebarTab === 'files'"
        :tree="tree"
        :active-path="activeFilePath"
        :loading="treeLoading"
        :error="treeError"
        @open-file="openFile"
      />
      <ChapterNavigationView
        v-else
        :index="chapterIndex"
        :status="chapterStatus"
        :active-path="activeFilePath"
        :loading="chaptersLoading"
        :error="chaptersError"
        @open-chapter="openChapter"
        @rescan="rescanChapters"
      />
    </aside>

    <section class="workspace-center" aria-label="Workspace content">
      <FileViewer
        v-if="activeFilePath"
        :path="activeFilePath"
        :content="fileContent"
        :loading="fileLoading"
        :error="fileError"
      />
      <WorkspaceHome
        v-else
        :workspace="workspace"
        :provider-configured="providerConfigured"
        :status="workspaceStatus"
        @generate-next-chapter="openCopilot('请基于当前大纲和章节状态，提出下一章生成方案，并先说明会创建哪些 PendingAction。')"
        @open-chapters="openChapterNavigation"
        @open-copilot="openCopilot()"
        @open-pending="openPendingActions"
        @configure-provider="emit('configureProvider')"
        @leave-workspace="emit('leaveWorkspace')"
      />
    </section>

    <CopilotPanel
      v-if="copilotVisible"
      :provider-configured="providerConfigured"
      :queued-prompt="queuedPrompt"
      @prompt-consumed="clearQueuedPrompt"
      @configure-provider="emit('configureProvider')"
    />

    <div v-if="searchOpen" class="search-overlay" role="dialog" aria-label="Workspace search">
      <div class="search-panel">
        <div class="search-panel-header">
          <input
            v-model="searchQuery"
            class="search-input"
            type="search"
            placeholder="Search files"
            aria-label="Search files"
          >
          <button class="icon-button" type="button" aria-label="Close search" @click="searchOpen = false">
            ×
          </button>
        </div>
        <div class="search-results" role="listbox" aria-label="Search results">
          <button
            v-for="node in fileSearchResults"
            :key="node.path"
            class="search-result"
            type="button"
            @click="openFile(node.path)"
          >
            <strong>{{ node.name }}</strong>
            <span>{{ node.path }}</span>
          </button>
          <p v-if="fileSearchResults.length === 0" class="empty-copy">No matches</p>
        </div>
      </div>
    </div>
  </main>
</template>
