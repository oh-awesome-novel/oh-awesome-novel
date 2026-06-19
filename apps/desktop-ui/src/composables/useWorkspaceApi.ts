import { resolveBackendBaseUrl } from './useBackendBaseUrl';

export interface WorkspaceSummary {
  name: string;
  novelName: string;
  path: string;
  lastOpenedAt?: string;
  addedAt?: string;
  valid: boolean;
  reason?: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: FileTreeNode[];
}

export interface ProviderConfigState {
  configured: boolean;
  defaultProviderId?: string;
  providers: Array<{
    id: string;
    kind: string;
    model: string;
    displayName?: string;
    baseUrl?: string;
    hasApiKey?: boolean;
    apiKeyEnv?: string;
    default?: boolean;
  }>;
}

export interface ProviderConfigInput {
  id: string;
  kind: string;
  displayName?: string;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  default?: boolean;
  apiKeyEnv?: string;
}

export interface ProviderCheckInput {
  providerId?: string;
  kind?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface ProviderCheckResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  status?: number;
  message: string;
}

export interface ProviderModelSummary {
  id: string;
}

export interface ChapterIndex {
  volumes: ChapterIndexVolume[];
}

export interface ChapterIndexVolume {
  id: string;
  path: string;
  title: string;
  metadataPath: string;
  chapters: ChapterIndexChapter[];
}

export interface ChapterIndexChapter {
  id: string;
  path: string;
  title: string;
  volumeId: string;
  chapterNumber: string;
}

export interface ChapterIndexStatus {
  status: 'missing' | 'current' | 'stale' | 'unknown' | 'dirty';
  currentGitHead: string | null;
  dirty: boolean;
  index: unknown | null;
}

export interface WorkspaceStatus {
  pendingActionCount: number;
  git: {
    status: 'clean' | 'dirty' | 'unknown';
    dirty: boolean | null;
  };
}

export interface WorkspaceOnboardingInput {
  novelName?: string;
  inspiration?: string;
  characterSeed?: string;
  startGoal?: string;
  skipped?: boolean;
}

export interface PendingAction {
  id: string;
  title: string;
  description: string;
  patches: unknown[];
  touchedFiles: string[];
  diff: string;
  createdAt: string;
  status: 'pending';
  shadowWrites?: Array<{
    targetFile: string;
    shadowFile: string;
  }>;
}

export interface AcceptedPendingAction {
  id: string;
  status: 'accepted';
  appliedFiles: string[];
  gitDiff: string;
}

export interface RejectedPendingAction {
  id: string;
  status: 'rejected';
}

export function useWorkspaceApi() {
  const backendBaseUrl = resolveBackendBaseUrl();

  return {
    backendBaseUrl,
    listWorkspaces: () =>
      requestJson<{
        workspaces: WorkspaceSummary[];
        activeWorkspacePath?: string;
        providerConfigured: boolean;
      }>(backendBaseUrl, '/api/workspaces'),
    importWorkspace: (path: string) =>
      requestJson<{ workspace: WorkspaceSummary }>(backendBaseUrl, '/api/workspaces/import', {
        method: 'POST',
        body: { path },
      }),
    createWorkspace: (path: string) =>
      requestJson<{
        workspace: WorkspaceSummary;
        providerConfigured: boolean;
        onboarding: { show: boolean };
      }>(backendBaseUrl, '/api/workspaces/create', {
        method: 'POST',
        body: { path },
      }),
    openWorkspace: (path: string) =>
      requestJson<{ workspace: WorkspaceSummary; providerConfigured: boolean }>(
        backendBaseUrl,
        '/api/workspaces/open',
        {
          method: 'POST',
          body: { path },
        },
      ),
    renameWorkspace: (path: string, name: string) =>
      requestJson<{ workspaces: WorkspaceSummary[] }>(backendBaseUrl, '/api/workspaces/name', {
        method: 'PATCH',
        body: { path, name },
      }),
    removeWorkspace: (path: string) =>
      requestJson<{ workspaces: WorkspaceSummary[] }>(backendBaseUrl, '/api/workspaces', {
        method: 'DELETE',
        body: { path },
      }),
    getProviderConfig: () =>
      requestJson<ProviderConfigState>(backendBaseUrl, '/api/provider-config'),
    saveProviderConfig: (provider: ProviderConfigInput) =>
      requestJson<ProviderConfigState>(backendBaseUrl, '/api/provider-config', {
        method: 'POST',
        body: provider,
      }),
    setDefaultProviderConfig: (id: string) =>
      requestJson<ProviderConfigState>(
        backendBaseUrl,
        `/api/provider-config/${encodeURIComponent(id)}/default`,
        { method: 'POST' },
      ),
    deleteProviderConfig: (id: string) =>
      requestJson<ProviderConfigState>(
        backendBaseUrl,
        `/api/provider-config/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
    listProviderModels: (input: { baseUrl: string; apiKey?: string }) =>
      requestJson<{ models: ProviderModelSummary[] }>(
        backendBaseUrl,
        '/api/provider-config/models',
        {
          method: 'POST',
          body: input,
        },
      ),
    checkProviderConfig: (input: ProviderCheckInput) =>
      requestJson<ProviderCheckResult>(backendBaseUrl, '/api/provider-config/check', {
        method: 'POST',
        body: input,
      }),
    getWorkspaceTree: () =>
      requestJson<{ tree: FileTreeNode[] }>(backendBaseUrl, '/api/workspace/tree'),
    getWorkspaceFile: (path: string) =>
      requestJson<{ path: string; content: string }>(
        backendBaseUrl,
        `/api/workspace/file?path=${encodeURIComponent(path)}`,
      ),
    getWorkspaceStatus: () =>
      requestJson<WorkspaceStatus>(backendBaseUrl, '/api/workspace/status'),
    saveWorkspaceOnboarding: (input: WorkspaceOnboardingInput) =>
      requestJson<{ workspace: WorkspaceSummary; config: unknown }>(
        backendBaseUrl,
        '/api/workspace/onboarding',
        {
          method: 'POST',
          body: input,
        },
      ),
    listPendingActions: () =>
      requestJson<{ pendingActions: PendingAction[] }>(
        backendBaseUrl,
        '/api/workspace/pending-actions',
      ),
    acceptPendingAction: (id: string) =>
      requestJson<AcceptedPendingAction>(
        backendBaseUrl,
        `/api/workspace/pending-actions/${encodeURIComponent(id)}/accept`,
        { method: 'POST' },
      ),
    rejectPendingAction: (id: string) =>
      requestJson<RejectedPendingAction>(
        backendBaseUrl,
        `/api/workspace/pending-actions/${encodeURIComponent(id)}/reject`,
        { method: 'POST' },
      ),
    getChapters: () =>
      requestJson<{ index: ChapterIndex; status: ChapterIndexStatus }>(
        backendBaseUrl,
        '/api/workspace/chapters',
      ),
    rescanChapters: () =>
      requestJson<{ index: ChapterIndex; status: ChapterIndexStatus }>(
        backendBaseUrl,
        '/api/workspace/chapters/rescan',
        { method: 'POST' },
      ),
  };
}

async function requestJson<T>(
  backendBaseUrl: string,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {},
): Promise<T> {
  const response = await fetch(`${backendBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json() as unknown;

  if (!response.ok) {
    const errorMessage = isRecord(data) && typeof data.error === 'string'
      ? data.error
      : 'Request failed.';
    throw new Error(errorMessage);
  }

  return data as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
