<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

import PlayWorkspace from '../play/PlayWorkspace.vue';
import WorkspaceToolbar from './WorkspaceToolbar.vue';
import WorkspaceSearchDialog from './WorkspaceSearchDialog.vue';
import ManuscriptExportDialog from './ManuscriptExportDialog.vue';
import ManuscriptImportDialog from './ManuscriptImportDialog.vue';
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
  ProjectHealth,
  WorkspaceOnboardingInput,
  WorkspaceStatus,
  WorkspaceSummary,
  WritingProfileState,
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
const searchOpen = shallowRef(false);
const exportOpen = shallowRef(false);
const manuscriptImportOpen = shallowRef(false);
const searchRefreshVersion = shallowRef(0);
const activeFileLine = shallowRef<number>();
let fileRequest = 0;
let treeRequest = 0;
let workspaceEpoch = 0;
let pendingRequest = 0;
onBeforeUnmount(() => { ++workspaceEpoch; ++pendingRequest; });
const layout = useWorkspaceLayoutState(props.workspace.path);
const activeFilePath = shallowRef('');
const conversations = useAgentConversationSessions({
  getExactWritablePaths: () => activeFilePath.value ? [activeFilePath.value] : [],
});
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
const workspacePendingActions = shallowRef<PendingActionView[]>([]);
const pendingActionsLoading = shallowRef(false);
const pendingActionsError = shallowRef('');
const selectedPendingActionId = shallowRef('');
const decisionErrors = shallowRef<Record<string, string>>({});
const decisions = shallowRef<Record<string, 'accepting' | 'rejecting' | 'quick-committing' | 'accepted' | 'rejected'>>({});
const queuedPrompt = shallowRef('');
const guideVisible = shallowRef(props.startGuide);
const guideSaving = shallowRef(false);
const guideError = shallowRef('');
const editorError = shallowRef('');
const writingProfileState = shallowRef<WritingProfileState>();
const writingProfilesLoading = shallowRef(false);
const writingProfilesError = shallowRef('');

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
  void loadWritingProfiles();
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
  const request = ++treeRequest;
  const workspacePath = props.workspace.path;
  treeLoading.value = true;
  treeError.value = '';
  try {
    const response = await api.getWorkspaceTree();
    if (request === treeRequest && workspacePath === props.workspace.path) tree.value = response.tree;
  } catch (error) {
    if (request === treeRequest && workspacePath === props.workspace.path) treeError.value = error instanceof Error ? error.message : String(error);
  } finally { if (request === treeRequest && workspacePath === props.workspace.path) treeLoading.value = false; }
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
  const epoch = workspaceEpoch;
  try {
    const result = await api.getWorkspaceStatus();
    if (epoch === workspaceEpoch) workspaceStatus.value = result;
  } catch {
    if (epoch !== workspaceEpoch) return;
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
  const epoch = workspaceEpoch;
  const request = ++pendingRequest;
  pendingActionsLoading.value = true;
  pendingActionsError.value = '';

  try {
    const result = await api.listPendingActions();
    if (epoch === workspaceEpoch && request === pendingRequest) workspacePendingActions.value = [...result.pendingActions];
  } catch (error) {
    if (epoch === workspaceEpoch && request === pendingRequest) pendingActionsError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (epoch === workspaceEpoch && request === pendingRequest) pendingActionsLoading.value = false;
  }
}

async function loadProjectHealth() {
  const epoch = workspaceEpoch;
  try {
    const result = await api.getProjectHealth();
    if (epoch === workspaceEpoch) projectHealth.value = result.health;
  } catch {
    if (epoch === workspaceEpoch) projectHealth.value = undefined;
  }
}

async function loadWritingProfiles() {
  writingProfilesLoading.value = true;
  writingProfilesError.value = '';
  try {
    writingProfileState.value = (await api.getWritingProfiles()).state;
  } catch (error) {
    writingProfilesError.value = error instanceof Error ? error.message : String(error);
  } finally {
    writingProfilesLoading.value = false;
  }
}

function updateWritingProfileState(state: WritingProfileState) {
  writingProfileState.value = state;
  writingProfilesError.value = '';
}

async function openFile(path: string, line?: number) {
  const request = ++fileRequest;
  const workspacePath = props.workspace.path;
  searchOpen.value = false;
  activeFilePath.value = path;
  activeFileLine.value = line;
  layout.openRightPanel('file');
  fileLoading.value = true;
  fileError.value = '';
  fileContent.value = '';
  try {
    const file = await api.getWorkspaceFile(path);
    if (request === fileRequest && workspacePath === props.workspace.path) fileContent.value = file.content;
  } catch (error) {
    if (request === fileRequest && workspacePath === props.workspace.path) fileError.value = error instanceof Error ? error.message : String(error);
  } finally { if (request === fileRequest && workspacePath === props.workspace.path) fileLoading.value = false; }
}

function openSearchResult(hit: { path: string; line: number }) {
  layout.sidebarTab.value = 'files';
  void loadTree();
  void openFile(hit.path, hit.line);
}

watch(() => props.workspace.path, () => {
  ++workspaceEpoch;
  ++pendingRequest;
  ++fileRequest;
  searchOpen.value = false;
  exportOpen.value = false;
  manuscriptImportOpen.value = false;
  activeFilePath.value = '';
  activeFileLine.value = undefined;
  fileContent.value = ''; fileError.value = ''; fileLoading.value = false;
  tree.value = [];
  workspacePendingActions.value = [];
  selectedPendingActionId.value = '';
  pendingActionsLoading.value = false;
  pendingActionsError.value = '';
  workspaceStatus.value = undefined;
  projectHealth.value = undefined;
  decisions.value = {};
  decisionErrors.value = {};
  void loadTree();
}, { flush: 'sync' });

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
    await api.acceptPendingAction(action.id);
    decisions.value = { ...decisions.value, [action.id]: 'accepted' };
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
    await api.rejectPendingAction(action.id);
    decisions.value = { ...decisions.value, [action.id]: 'rejected' };
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

async function quickCommitPendingAction(action: PendingActionView) {
  decisions.value = { ...decisions.value, [action.id]: 'quick-committing' };
  decisionErrors.value = { ...decisionErrors.value, [action.id]: '' };

  try {
    await api.quickCommitPendingAction(action.id);
    const nextDecisions = { ...decisions.value };
    delete nextDecisions[action.id];
    decisions.value = nextDecisions;
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

async function reviewPendingActionById(pendingActionId: string): Promise<void> {
  const epoch = workspaceEpoch;
  await refreshPendingActionSurface();
  if (epoch !== workspaceEpoch) return;
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

function reviewManuscriptImport(pendingActionId: string) {
  manuscriptImportOpen.value = false;
  void reviewPendingActionById(pendingActionId);
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
  ++fileRequest;
  activeFileLine.value = undefined;
  fileLoading.value = false;
  activeFilePath.value = '';
  fileContent.value = '';
  fileError.value = '';
  layout.openRightPanel('health');
}

async function refreshAfterPendingAction() {
  ++searchRefreshVersion.value;
  await Promise.all([
    loadTree(),
    loadChapters(),
    loadPendingActions(),
    loadWorkspaceStatus(),
    loadProjectHealth(),
    activeFilePath.value ? openFile(activeFilePath.value) : Promise.resolve(),
  ]);
}

async function refreshPendingActionSurface() {
  await Promise.all([
    loadWorkspaceStatus(),
    loadProjectHealth(),
    loadPendingActions(),
  ]);
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
      @open-export="exportOpen = true"
      @open-manuscript-import="manuscriptImportOpen = true"
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
      :file-line="activeFileLine"
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
      :writing-profile-state="writingProfileState"
      :writing-profiles-loading="writingProfilesLoading"
      :writing-profiles-error="writingProfilesError"
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
      @refresh-writing-profiles="loadWritingProfiles"
      @writing-profile-state-changed="updateWritingProfileState"
      @prompt-consumed="clearQueuedPrompt"
      @accept-pending-action="acceptPendingAction"
      @reject-pending-action="rejectPendingAction"
      @quick-commit-pending-action="quickCommitPendingAction"
      @review-pending-action="reviewPendingAction"
      @open-pending-action-diff="openPendingActionDiff"
      @review-pending-action-id="reviewPendingActionById"
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
      @review-pending-action="reviewPendingActionById"
      @writing-references-updated="conversations.refreshWritingReferences"
    />

    <WorkspaceSearchDialog v-if="searchOpen" :workspace-path="workspace.path" :refresh-version="searchRefreshVersion" @close="searchOpen = false" @open-file="openSearchResult" />
    <ManuscriptExportDialog v-if="exportOpen" :workspace-path="workspace.path" @close="exportOpen = false" />
    <ManuscriptImportDialog v-if="manuscriptImportOpen" :workspace-path="workspace.path" @close="manuscriptImportOpen = false" @proposed="reviewManuscriptImport" />
  </main>
</template>
