import { oanClient } from '../client';

export type {
  AcceptedPendingAction,
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
  ChapterIndexVolume,
  FileTreeNode,
  PendingAction,
  ProjectHealth,
  ProjectHealthIssue,
  ProviderCheckInput,
  ProviderCheckResult,
  ProviderConfigInput,
  ProviderConfigState,
  ProviderModelConfig,
  ProviderModelSummary,
  RejectedPendingAction,
  WorkspaceOnboardingInput,
  WorkspaceStatus,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

export function useWorkspaceApi() {
  return oanClient;
}
