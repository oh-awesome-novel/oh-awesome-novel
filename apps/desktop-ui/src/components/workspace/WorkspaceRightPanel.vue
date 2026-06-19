<script setup lang="ts">
import ApprovalTab from './ApprovalTab.vue';
import DiffReviewTab from './DiffReviewTab.vue';
import FileViewer from './FileViewer.vue';
import GitReviewTab from './GitReviewTab.vue';
import ProjectHealthTab from './ProjectHealthTab.vue';
import WorkspacePanelTabs from './WorkspacePanelTabs.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';
import type { WorkspaceRightTab } from '../../composables/useWorkspaceLayoutState';
import type {
  ProjectHealth,
  WorkspaceStatus,
} from '../../composables/useWorkspaceApi';

defineProps<{
  activeTab: WorkspaceRightTab;
  activeFilePath: string;
  fileContent: string;
  fileLoading: boolean;
  fileError: string;
  pendingActions: Array<PendingActionView & {
    touchedFiles?: string[];
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
  selectTab: [tab: WorkspaceRightTab];
  close: [];
  acceptPendingAction: [action: PendingActionView];
  rejectPendingAction: [action: PendingActionView];
  reviewPendingAction: [action: PendingActionView];
  openPendingActionDiff: [action: PendingActionView];
}>();
</script>

<template>
  <section class="workspace-right-panel" aria-label="Workspace review panel">
    <WorkspacePanelTabs
      :active-tab="activeTab"
      @select="emit('selectTab', $event)"
      @close="emit('close')"
    />

    <FileViewer
      v-if="activeTab === 'file'"
      :path="activeFilePath"
      :content="fileContent"
      :loading="fileLoading"
      :error="fileError"
    />
    <DiffReviewTab
      v-else-if="activeTab === 'diff'"
      :actions="pendingActions"
      :selected-action="selectedPendingAction"
    />
    <ApprovalTab
      v-else-if="activeTab === 'approval'"
      :actions="pendingActions"
      :loading="pendingActionsLoading"
      :error="pendingActionsError"
      @accept="emit('acceptPendingAction', $event)"
      @reject="emit('rejectPendingAction', $event)"
      @review="emit('reviewPendingAction', $event)"
      @open-diff="emit('openPendingActionDiff', $event)"
    />
    <ProjectHealthTab
      v-else-if="activeTab === 'health'"
      :status="workspaceStatus"
      :health="projectHealth"
    />
    <GitReviewTab v-else />
  </section>
</template>
