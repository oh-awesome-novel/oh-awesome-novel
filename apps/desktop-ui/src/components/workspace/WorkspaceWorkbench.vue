<script setup lang="ts">
import CopilotPanel from './CopilotPanel.vue';
import WorkspaceLeftHoverRail from './WorkspaceLeftHoverRail.vue';
import WorkspaceLeftPanel from './WorkspaceLeftPanel.vue';
import WorkspaceOnboardingGuide from './WorkspaceOnboardingGuide.vue';
import WorkspaceRightPanel from './WorkspaceRightPanel.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';
import type { WorkspaceRightTab } from '../../composables/useWorkspaceLayoutState';
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

interface OnboardingFinishPayload extends WorkspaceOnboardingInput {
  prompt: string;
}

defineProps<{
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
  leftPinned: boolean;
  leftOverlayOpen: boolean;
  sidebarTab: 'files' | 'chapters';
  workbenchClass: Record<string, boolean>;
  workbenchStyle: Record<string, string>;
  tree: FileTreeNode[];
  treeLoading: boolean;
  treeError: string;
  chapterIndex?: ChapterIndex;
  chapterStatus?: ChapterIndexStatus;
  chaptersLoading: boolean;
  chaptersError: string;
  activeFilePath: string;
  fileContent: string;
  fileLoading: boolean;
  fileError: string;
  guideVisible: boolean;
  guideSaving: boolean;
  guideError: string;
  queuedPrompt: string;
  rightShown: boolean;
  rightTab: WorkspaceRightTab;
  pendingActions: Array<PendingAction & {
    decision?: 'accepting' | 'rejecting' | 'accepted' | 'rejected';
    decisionError?: string;
  }>;
  selectedPendingAction?: PendingActionView;
  pendingActionsLoading: boolean;
  pendingActionsError: string;
  workspaceStatus?: WorkspaceStatus;
  projectHealth?: ProjectHealth;
}>();

const emit = defineEmits<{
  updateLeftOverlayOpen: [open: boolean];
  updateSidebarTab: [tab: 'files' | 'chapters'];
  pinLeft: [];
  openFile: [path: string];
  openChapter: [chapter: ChapterIndexChapter];
  rescanChapters: [];
  skipOnboarding: [];
  finishOnboarding: [payload: OnboardingFinishPayload];
  configureProvider: [];
  promptConsumed: [];
  acceptPendingAction: [action: PendingActionView];
  rejectPendingAction: [action: PendingActionView];
  reviewPendingAction: [action: PendingActionView];
  openPendingActionDiff: [action: PendingActionView];
  selectRightTab: [tab: WorkspaceRightTab];
  closeRight: [];
}>();
</script>

<template>
  <div class="workspace-workbench" :class="workbenchClass" :style="workbenchStyle">
    <WorkspaceLeftPanel
      v-if="leftPinned"
      :tab="sidebarTab"
      :tree="tree"
      :active-path="activeFilePath"
      :tree-loading="treeLoading"
      :tree-error="treeError"
      :chapter-index="chapterIndex"
      :chapter-status="chapterStatus"
      :chapters-loading="chaptersLoading"
      :chapters-error="chaptersError"
      @update-tab="emit('updateSidebarTab', $event)"
      @open-file="emit('openFile', $event)"
      @open-chapter="emit('openChapter', $event)"
      @rescan-chapters="emit('rescanChapters')"
      @pin="emit('pinLeft')"
    />
    <WorkspaceLeftHoverRail
      v-else
      :open="leftOverlayOpen"
      @update-open="emit('updateLeftOverlayOpen', $event)"
    >
      <WorkspaceLeftPanel
        :tab="sidebarTab"
        :tree="tree"
        :active-path="activeFilePath"
        :tree-loading="treeLoading"
        :tree-error="treeError"
        :chapter-index="chapterIndex"
        :chapter-status="chapterStatus"
        :chapters-loading="chaptersLoading"
        :chapters-error="chaptersError"
        @update-tab="emit('updateSidebarTab', $event)"
        @open-file="emit('openFile', $event)"
        @open-chapter="emit('openChapter', $event)"
        @rescan-chapters="emit('rescanChapters')"
        @pin="emit('pinLeft')"
      />
    </WorkspaceLeftHoverRail>

    <section class="workspace-center" aria-label="Agent Copilot workspace">
      <WorkspaceOnboardingGuide
        v-if="guideVisible"
        :workspace="workspace"
        :provider-configured="providerConfigured"
        :saving="guideSaving"
        :error="guideError"
        @skip="emit('skipOnboarding')"
        @finish="emit('finishOnboarding', $event)"
        @configure-provider="emit('configureProvider')"
      />
      <CopilotPanel
        v-else
        :provider-configured="providerConfigured"
        :queued-prompt="queuedPrompt"
        :pending-actions="pendingActions"
        :pending-actions-loading="pendingActionsLoading"
        :pending-actions-error="pendingActionsError"
        :right-panel-shown="rightShown"
        @prompt-consumed="emit('promptConsumed')"
        @configure-provider="emit('configureProvider')"
        @accept-pending-action="emit('acceptPendingAction', $event)"
        @reject-pending-action="emit('rejectPendingAction', $event)"
        @review-pending-action="emit('reviewPendingAction', $event)"
        @open-pending-action-diff="emit('openPendingActionDiff', $event)"
      />
    </section>

    <WorkspaceRightPanel
      v-if="rightShown"
      :active-tab="rightTab"
      :active-file-path="activeFilePath"
      :file-content="fileContent"
      :file-loading="fileLoading"
      :file-error="fileError"
      :pending-actions="pendingActions"
      :selected-pending-action="selectedPendingAction"
      :pending-actions-loading="pendingActionsLoading"
      :pending-actions-error="pendingActionsError"
      :workspace-status="workspaceStatus"
      :project-health="projectHealth"
      @select-tab="emit('selectRightTab', $event)"
      @close="emit('closeRight')"
      @accept-pending-action="emit('acceptPendingAction', $event)"
      @reject-pending-action="emit('rejectPendingAction', $event)"
      @review-pending-action="emit('reviewPendingAction', $event)"
      @open-pending-action-diff="emit('openPendingActionDiff', $event)"
    />
  </div>
</template>
