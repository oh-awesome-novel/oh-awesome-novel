<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';

import PlayWorkspace from '../play/PlayWorkspace.vue';
import WorkspaceToolbar from './WorkspaceToolbar.vue';
import WorkspaceWorkbench from './WorkspaceWorkbench.vue';
import { useAgentConversationSessions } from '../../composables/useAgentConversationSessions';
import { useWorkspaceLayoutState } from '../../composables/useWorkspaceLayoutState';
import type { WorkspaceMode } from '../../composables/useWorkspaceLayoutState';
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
  mode: WorkspaceMode;
}>();

const emit = defineEmits<{
  leaveWorkspace: [];
  configureProvider: [];
  toggleTheme: [];
  workspaceUpdated: [workspace: WorkspaceSummary];
  selectMode: [mode: WorkspaceMode];
}>();

interface OnboardingFinishPayload extends WorkspaceOnboardingInput {
  prompt: string;
}

const api = useWorkspaceApi();
const conversations = useAgentConversationSessions();
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
  void conversations.refreshWritingReferences();
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
      gitConfig: {
        autoCommitOnAccept: true,
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

function startNewConversation() {
  conversations.createConversation();
  layout.sidebarTab.value = 'history';
  layout.leftPinned.value = true;
}

function selectConversation(id: string) {
  conversations.selectConversation(id);
  layout.sidebarTab.value = 'history';
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

async function reviewPlayPendingAction(pendingActionId: string): Promise<void> {
  await refreshPendingActionSurface();
  const action = decoratedPendingActions.value.find(
    (candidate) => candidate.id === pendingActionId,
  );
  if (action) {
    reviewPendingAction(action);
    return;
  }
  openPendingActions();
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
    <WorkspaceToolbar
      :workspace="workspace"
      :workspace-mode="mode"
      :provider-configured="providerConfigured"
      :theme="theme"
      :left-pinned="layout.leftPinned.value"
      :right-shown="layout.rightShown.value"
      :right-tab="layout.rightTab.value"
      :pending-action-count="workspaceStatus?.pendingActionCount ?? workspacePendingActions.length"
      :editor-error="editorError"
      @toggle-left="layout.toggleLeftPinned"
      @select-workspace-mode="emit('selectMode', $event)"
      @show-home="showHome"
      @open-chapters="openChapterNavigation"
      @open-search="searchOpen = true"
      @open-pending="openPendingActions"
      @open-right-tab="layout.openRightPanel"
      @open-external-editor="openExternalEditor"
      @toggle-right="layout.toggleRightPanel()"
      @configure-provider="emit('configureProvider')"
      @toggle-theme="emit('toggleTheme')"
      @leave-workspace="emit('leaveWorkspace')"
    />

    <WorkspaceWorkbench
      v-show="mode === 'writing'"
      id="writing-workspace"
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
      :conversations="conversations.conversationSummaries.value"
      :chat-status="conversations.activeStatus.value"
      :chat-input="conversations.activeInput.value"
      :chat-messages="conversations.activeMessages.value"
      :chat-pending-actions="conversations.activePendingActions.value"
      :writing-reference-attachments="conversations.writingReferenceAttachments.value"
      :selected-writing-reference-attachment-ids="conversations.selectedWritingReferenceAttachmentIds.value"
      :writing-references-loading="conversations.writingReferencesLoading.value"
      :writing-references-error="conversations.writingReferencesError.value"
      @update-left-overlay-open="layout.leftOverlayOpen.value = $event"
      @update-sidebar-tab="layout.sidebarTab.value = $event"
      @open-file="openFile"
      @open-chapter="openChapter"
      @rescan-chapters="rescanChapters"
      @new-conversation="startNewConversation"
      @select-conversation="selectConversation"
      @skip-onboarding="skipOnboarding"
      @finish-onboarding="completeOnboarding"
      @configure-provider="emit('configureProvider')"
      @update-chat-input="conversations.activeInput.value = $event"
      @send-chat-input="conversations.sendCurrentInput"
      @stop-chat="conversations.stop"
      @refresh-writing-references="conversations.refreshWritingReferences"
      @toggle-writing-reference="conversations.toggleWritingReferenceAttachment"
      @prompt-consumed="clearQueuedPrompt"
      @accept-pending-action="acceptPendingAction"
      @reject-pending-action="rejectPendingAction"
      @review-pending-action="reviewPendingAction"
      @open-pending-action-diff="openPendingActionDiff"
      @select-right-tab="layout.openRightPanel($event)"
      @close-right="layout.rightShown.value = false"
    />

    <PlayWorkspace
      v-show="mode === 'play'"
      :workspace="workspace"
      :provider-configured="providerConfigured"
      :files="tree"
      :files-loading="treeLoading"
      :files-error="treeError"
      @configure-provider="emit('configureProvider')"
      @pending-action-created="refreshPendingActionSurface"
      @review-pending-action="reviewPlayPendingAction"
      @writing-references-updated="conversations.refreshWritingReferences"
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
