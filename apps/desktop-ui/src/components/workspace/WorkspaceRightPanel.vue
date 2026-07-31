<script setup lang="ts">
import ApprovalTab from './ApprovalTab.vue';
import DiffReviewTab from './DiffReviewTab.vue';
import FileViewer from './FileViewer.vue';
import GitReviewTab from './GitReviewTab.vue';
import ProjectHealthTab from './ProjectHealthTab.vue';
import ReferenceImportTab from './ReferenceImportTab.vue';
import WorkspacePanelTabs from './WorkspacePanelTabs.vue';
import WritingProfileManagerTab from './writing-profile/WritingProfileManagerTab.vue';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';
import type { WorkspaceRightTab } from '../../composables/useWorkspaceLayoutState';
import type {
  ProjectHealth,
  WritingProfileState,
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
  writingProfileState?: WritingProfileState;
  writingProfilesLoading: boolean;
  writingProfilesError: string;
}>();

const emit = defineEmits<{
  selectTab: [tab: WorkspaceRightTab];
  close: [];
  acceptPendingAction: [action: PendingActionView];
  rejectPendingAction: [action: PendingActionView];
  reviewPendingAction: [action: PendingActionView];
  openPendingActionDiff: [action: PendingActionView];
  reviewPendingActionId: [pendingActionId: string];
  refreshWritingProfiles: [];
  writingProfileStateChanged: [state: WritingProfileState];
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
    <GitReviewTab v-else-if="activeTab === 'git'" />
    <WritingProfileManagerTab
      v-else-if="activeTab === 'profiles'"
      :state="writingProfileState"
      :loading="writingProfilesLoading"
      :load-error="writingProfilesError"
      @refresh="emit('refreshWritingProfiles')"
      @state-changed="emit('writingProfileStateChanged', $event)"
    />
    <ReferenceImportTab
      v-else-if="activeTab === 'references'"
      :writing-profile-state="writingProfileState"
      @review-pending-action="emit('reviewPendingActionId', $event)"
    />
  </section>
</template>
