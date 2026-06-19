<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';

import WorkspaceWorkbench from './WorkspaceWorkbench.vue';
import { useWorkspaceLayoutState } from '../../composables/useWorkspaceLayoutState';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';
import type {
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
  FileTreeNode,
  PendingAction,
  ProjectHealth,
  WorkspaceOnboardingInput,
  WorkspaceStatus,
  WorkspaceSummary,
} from '../../composables/useWorkspaceApi';

const props = defineProps<{
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
  theme: 'light' | 'dark';
  startGuide: boolean;
}>();

const emit = defineEmits<{
  leaveWorkspace: [];
  configureProvider: [];
  toggleTheme: [];
  workspaceUpdated: [workspace: WorkspaceSummary];
}>();

interface OnboardingFinishPayload extends WorkspaceOnboardingInput {
  prompt: string;
}

const api = useWorkspaceApi();
const searchOpen = shallowRef(false);
const searchQuery = shallowRef('');
const layout = useWorkspaceLayoutState(props.workspace.path);
const activeFilePath = shallowRef('');
const fileContent = shallowRef('');
const fileLoading = shallowRef(false);
const fileError = shallowRef('');
const tree = shallowRef<FileTreeNode[]>([]);
const treeLoading = shallowRef(false);
const treeError = shallowRef('');
const chapterIndex = shallowRef<ChapterIndex>();
const chapterStatus = shallowRef<ChapterIndexStatus>();
const projectHealth = shallowRef<ProjectHealth>();
const chaptersLoading = shallowRef(false);
const chaptersError = shallowRef('');
const workspaceStatus = shallowRef<WorkspaceStatus>();
const workspacePendingActions = shallowRef<PendingAction[]>([]);
const pendingActionsLoading = shallowRef(false);
const pendingActionsError = shallowRef('');
const selectedPendingActionId = shallowRef('');
const decisionErrors = shallowRef<Record<string, string>>({});
const decisions = shallowRef<Record<string, 'accepting' | 'rejecting' | 'accepted' | 'rejected'>>({});
const queuedPrompt = shallowRef('');
const guideVisible = shallowRef(props.startGuide);
const guideSaving = shallowRef(false);
const guideError = shallowRef('');
const editorError = shallowRef('');

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
const decoratedPendingActions = computed(() =>
  workspacePendingActions.value.map((action) => ({
    ...action,
    decision: decisions.value[action.id],
    decisionError: decisionErrors.value[action.id],
  })),
);
const selectedPendingAction = computed(() =>
  decoratedPendingActions.value.find((action) => action.id === selectedPendingActionId.value),
);

onMounted(() => {
  void loadTree();
  void loadChapters();
  void loadWorkspaceStatus();
  void loadProjectHealth();
  void loadPendingActions();
});

watch(
  () => props.startGuide,
  (shouldStartGuide) => {
    if (shouldStartGuide) {
      guideVisible.value = true;
    }
  },
);

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
        available: false,
        source: 'global',
        repository: false,
        status: 'unknown',
        dirty: null,
        files: [],
      },
    };
  }
}

async function loadPendingActions() {
  pendingActionsLoading.value = true;
  pendingActionsError.value = '';

  try {
    workspacePendingActions.value = (await api.listPendingActions()).pendingActions;
  } catch (error) {
    pendingActionsError.value = error instanceof Error ? error.message : String(error);
  } finally {
    pendingActionsLoading.value = false;
  }
}

async function loadProjectHealth() {
  try {
    projectHealth.value = (await api.getProjectHealth()).health;
  } catch {
    projectHealth.value = undefined;
  }
}

async function openFile(path: string) {
  searchOpen.value = false;
  activeFilePath.value = path;
  layout.openRightPanel('file');
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
  layout.sidebarTab.value = 'chapters';
  void openFile(chapter.path);
}

function openChapterNavigation() {
  layout.sidebarTab.value = 'chapters';
  layout.leftPinned.value = true;
}

function openCopilot(prompt?: string) {
  if (prompt) {
    queuedPrompt.value = prompt;
  }
}

function openPendingActions() {
  layout.openRightPanel('approval');
  void loadWorkspaceStatus();
  void loadPendingActions();
}

async function acceptPendingAction(action: PendingActionView) {
  decisions.value = { ...decisions.value, [action.id]: 'accepting' };
  decisionErrors.value = { ...decisionErrors.value, [action.id]: '' };

  try {
    const result = await api.acceptPendingAction(action.id);
    decisions.value = { ...decisions.value, [action.id]: 'accepted' };
    applyDecisionRefresh(result.refresh);
    await refreshAfterPendingAction();
  } catch (error) {
    const nextDecisions = { ...decisions.value };
    delete nextDecisions[action.id];
    decisions.value = nextDecisions;
    decisionErrors.value = {
      ...decisionErrors.value,
      [action.id]: error instanceof Error ? error.message : String(error),
    };
  }
}

async function rejectPendingAction(action: PendingActionView) {
  decisions.value = { ...decisions.value, [action.id]: 'rejecting' };
  decisionErrors.value = { ...decisionErrors.value, [action.id]: '' };

  try {
    const result = await api.rejectPendingAction(action.id);
    decisions.value = { ...decisions.value, [action.id]: 'rejected' };
    applyDecisionRefresh(result.refresh);
    await refreshAfterPendingAction();
  } catch (error) {
    const nextDecisions = { ...decisions.value };
    delete nextDecisions[action.id];
    decisions.value = nextDecisions;
    decisionErrors.value = {
      ...decisionErrors.value,
      [action.id]: error instanceof Error ? error.message : String(error),
    };
  }
}

function reviewPendingAction(action?: PendingActionView) {
  selectedPendingActionId.value = action?.id ?? decoratedPendingActions.value[0]?.id ?? '';
  layout.openRightPanel('approval');
}

function openPendingActionDiff(action: PendingActionView) {
  selectedPendingActionId.value = action.id;
  layout.openRightPanel('diff');
}

async function openExternalEditor(editor: 'vscode' | 'zed' | 'webstorm') {
  editorError.value = '';

  try {
    await api.openExternalEditor(editor);
  } catch (error) {
    editorError.value = error instanceof Error ? error.message : String(error);
  }
}

async function skipOnboarding() {
  guideSaving.value = true;
  guideError.value = '';

  try {
    const result = await api.saveWorkspaceOnboarding({ skipped: true });
    emit('workspaceUpdated', result.workspace);
    guideVisible.value = false;
    await loadWorkspaceStatus();
  } catch (error) {
    guideError.value = error instanceof Error ? error.message : String(error);
  } finally {
    guideSaving.value = false;
  }
}

async function completeOnboarding(payload: OnboardingFinishPayload) {
  guideSaving.value = true;
  guideError.value = '';

  try {
    const { prompt, ...input } = payload;
    const result = await api.saveWorkspaceOnboarding(input);
    emit('workspaceUpdated', result.workspace);
    guideVisible.value = false;
    openCopilot(prompt);

    if (!props.providerConfigured) {
      emit('configureProvider');
    }

    await Promise.all([
      loadWorkspaceStatus(),
      loadProjectHealth(),
      loadTree(),
    ]);
  } catch (error) {
    guideError.value = error instanceof Error ? error.message : String(error);
  } finally {
    guideSaving.value = false;
  }
}

function clearQueuedPrompt() {
  queuedPrompt.value = '';
}

function showHome() {
  activeFilePath.value = '';
  fileContent.value = '';
  fileError.value = '';
  layout.openRightPanel('health');
}

function flattenFileNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenFileNodes(node.children ?? []),
  ]);
}

async function refreshAfterPendingAction() {
  await Promise.all([
    loadTree(),
    loadChapters(),
    loadPendingActions(),
    activeFilePath.value ? openFile(activeFilePath.value) : Promise.resolve(),
  ]);

  if (!workspaceStatus.value || !projectHealth.value) {
    await Promise.all([
      loadWorkspaceStatus(),
      loadProjectHealth(),
    ]);
  }
}

async function refreshPendingActionSurface() {
  await Promise.all([
    loadWorkspaceStatus(),
    loadProjectHealth(),
    loadPendingActions(),
  ]);
}

function applyDecisionRefresh(
  refresh: Awaited<ReturnType<typeof api.acceptPendingAction>>['refresh'] | undefined,
) {
  if (!refresh) {
    return;
  }

  workspaceStatus.value = refresh.workspaceStatus;
  projectHealth.value = refresh.projectHealth;
}
</script>

<template>
  <main class="workspace-shell">
    <header class="workspace-toolbar">
      <div class="toolbar-left">
        <button class="icon-button" type="button" aria-label="切换文件栏" @click="layout.toggleLeftPinned">
          ☰
        </button>
        <button class="ghost-button" type="button" @click="showHome">Home</button>
        <button class="ghost-button" type="button" @click="openChapterNavigation">Chapters</button>
        <button class="ghost-button" type="button" @click="searchOpen = true">Search</button>
        <button class="ghost-button" type="button" @click="openPendingActions">Pending</button>
        <button class="ghost-button" type="button" @click="layout.openRightPanel('git')">Git</button>
        <button class="ghost-button" type="button" @click="layout.openRightPanel('references')">Refs</button>
        <button class="ghost-button" type="button" @click="layout.openRightPanel('play')">Play</button>
      </div>
      <div class="toolbar-title">
        <strong>{{ props.workspace.name }}</strong>
        <span>{{ props.workspace.path }}</span>
        <small v-if="editorError" class="toolbar-error">{{ editorError }}</small>
      </div>
      <div class="toolbar-right">
        <span class="status-pill">{{ providerConfigured ? 'Provider ready' : 'Read-only' }}</span>
        <button class="ghost-button" type="button" @click="openExternalEditor('vscode')">VS Code</button>
        <button class="ghost-button" type="button" @click="openExternalEditor('zed')">Zed</button>
        <button class="ghost-button" type="button" @click="openExternalEditor('webstorm')">WebStorm</button>
        <button
          class="icon-button"
          type="button"
          aria-label="切换审阅栏"
          @click="layout.toggleRightPanel()"
        >
          ⇤
        </button>
        <button
          class="theme-switch theme-switch-compact"
          type="button"
          role="switch"
          :aria-checked="theme === 'dark'"
          @click="emit('toggleTheme')"
        >
          <span class="theme-switch-track" aria-hidden="true">
            <span class="theme-switch-thumb"></span>
          </span>
          <span>{{ theme === 'dark' ? 'Dark' : 'Light' }}</span>
        </button>
        <button class="ghost-button" type="button" @click="emit('configureProvider')">Settings</button>
        <button class="ghost-button" type="button" @click="emit('leaveWorkspace')">Launcher</button>
      </div>
    </header>

    <WorkspaceWorkbench
      :workspace="workspace"
      :provider-configured="providerConfigured"
      :left-pinned="layout.leftPinned.value"
      :left-overlay-open="layout.leftOverlayOpen.value"
      :sidebar-tab="layout.sidebarTab.value"
      :workbench-class="layout.workbenchClass.value"
      :workbench-style="layout.workbenchStyle.value"
      :tree="tree"
      :tree-loading="treeLoading"
      :tree-error="treeError"
      :chapter-index="chapterIndex"
      :chapter-status="chapterStatus"
      :chapters-loading="chaptersLoading"
      :chapters-error="chaptersError"
      :active-file-path="activeFilePath"
      :file-content="fileContent"
      :file-loading="fileLoading"
      :file-error="fileError"
      :guide-visible="guideVisible"
      :guide-saving="guideSaving"
      :guide-error="guideError"
      :queued-prompt="queuedPrompt"
      :right-shown="layout.rightShown.value"
      :right-tab="layout.rightTab.value"
      :pending-actions="decoratedPendingActions"
      :selected-pending-action="selectedPendingAction"
      :pending-actions-loading="pendingActionsLoading"
      :pending-actions-error="pendingActionsError"
      :workspace-status="workspaceStatus"
      :project-health="projectHealth"
      @update-left-overlay-open="layout.leftOverlayOpen.value = $event"
      @update-sidebar-tab="layout.sidebarTab.value = $event"
      @pin-left="layout.leftPinned.value = true"
      @open-file="openFile"
      @open-chapter="openChapter"
      @rescan-chapters="rescanChapters"
      @skip-onboarding="skipOnboarding"
      @finish-onboarding="completeOnboarding"
      @configure-provider="emit('configureProvider')"
      @prompt-consumed="clearQueuedPrompt"
      @accept-pending-action="acceptPendingAction"
      @reject-pending-action="rejectPendingAction"
      @review-pending-action="reviewPendingAction"
      @open-pending-action-diff="openPendingActionDiff"
      @pending-action-created="refreshPendingActionSurface"
      @select-right-tab="layout.openRightPanel($event)"
      @close-right="layout.rightShown.value = false"
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
