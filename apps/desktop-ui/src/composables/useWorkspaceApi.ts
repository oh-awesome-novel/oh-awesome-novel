import { oanClient } from '../client';

export type {
  AcceptedPendingAction,
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
  ChapterIndexVolume,
  FileTreeNode,
  GitCommandError,
  GitCommitDetail,
  GitCommitResult,
  GitCommitSummary,
  GitFileStatus,
  GitSyncResult,
  GitWorkspaceStatus,
  PendingAction,
  ProjectHealth,
  ProjectHealthIssue,
  ProviderCheckInput,
  ProviderCheckResult,
  ProviderConfigInput,
  ProviderConfigState,
  ProviderModelConfig,
  ProviderModelSummary,
  ReferenceAllowedUsage,
  ReferenceContextSelection,
  ReferenceImportInput,
  ReferenceImportResult,
  ReferenceRights,
  ReferenceSourceManifest,
  ReferenceSourceType,
  ReferenceWorkSummary,
  RejectedPendingAction,
  WorkspaceOnboardingInput,
  WorkspaceStatus,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

export function useWorkspaceApi() {
  return oanClient;
}
