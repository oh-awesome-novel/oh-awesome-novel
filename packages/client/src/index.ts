import { DefaultChatTransport } from 'ai';
import type { ChatTransport, UIMessage } from 'ai';

export type ThemeMode = 'light' | 'dark';

export interface OanDesktopBridge {
  backendBaseUrl?: string;
  app?: {
    getVersion: () => Promise<string>;
  };
  theme?: {
    get: () => Promise<ThemeMode>;
    set: (theme: ThemeMode) => Promise<ThemeMode>;
  };
  workspace?: {
    selectDirectory: () => Promise<string | undefined>;
  };
}

export interface OanClientOptions {
  backendBaseUrl?: string;
  bridge?: OanDesktopBridge;
  fetch?: typeof fetch;
  systemTheme?: () => ThemeMode;
}

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
    models?: ProviderModelConfig[];
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
  models?: ProviderModelConfig[];
  apiKey?: string;
  default?: boolean;
  apiKeyEnv?: string;
}

export interface ProviderModelConfig {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  default?: boolean;
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
  displayName?: string;
  contextWindow?: number;
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

export interface ProjectHealthIssue {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  path?: string;
}

export interface ProjectHealth {
  generatedAt: string;
  missingCharacterCards: string[];
  chaptersWithoutSummaries: string[];
  activeHookCount: number;
  latestStateStale: boolean;
  timelineGapCount: number;
  pendingActionCount: number;
  issues: ProjectHealthIssue[];
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

export interface OanClient {
  readonly backendBaseUrl: string;
  getAgentChatApi(): string;
  createAgentChatTransport(): ChatTransport<UIMessage>;
  getAppVersion(): Promise<string | undefined>;
  getSystemThemePreference(): ThemeMode;
  getThemePreference(): Promise<ThemeMode>;
  setThemePreference(theme: ThemeMode): Promise<ThemeMode>;
  isDirectoryPickerAvailable(): boolean;
  selectDirectory(): Promise<string | undefined>;
  listWorkspaces(): Promise<{
    workspaces: WorkspaceSummary[];
    activeWorkspacePath?: string;
    providerConfigured: boolean;
  }>;
  importWorkspace(path: string): Promise<{ workspace: WorkspaceSummary }>;
  createWorkspace(path: string): Promise<{
    workspace: WorkspaceSummary;
    providerConfigured: boolean;
    onboarding: { show: boolean };
  }>;
  openWorkspace(path: string): Promise<{
    workspace: WorkspaceSummary;
    providerConfigured: boolean;
  }>;
  renameWorkspace(path: string, name: string): Promise<{ workspaces: WorkspaceSummary[] }>;
  removeWorkspace(path: string): Promise<{ workspaces: WorkspaceSummary[] }>;
  getProviderConfig(): Promise<ProviderConfigState>;
  saveProviderConfig(provider: ProviderConfigInput): Promise<ProviderConfigState>;
  setDefaultProviderConfig(id: string): Promise<ProviderConfigState>;
  deleteProviderConfig(id: string): Promise<ProviderConfigState>;
  listProviderModels(input: {
    providerId?: string;
    kind?: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<{ models: ProviderModelSummary[] }>;
  checkProviderConfig(input: ProviderCheckInput): Promise<ProviderCheckResult>;
  getWorkspaceTree(): Promise<{ tree: FileTreeNode[] }>;
  getWorkspaceFile(path: string): Promise<{ path: string; content: string }>;
  getWorkspaceStatus(): Promise<WorkspaceStatus>;
  getProjectHealth(): Promise<{ health: ProjectHealth }>;
  saveWorkspaceOnboarding(input: WorkspaceOnboardingInput): Promise<{
    workspace: WorkspaceSummary;
    config: unknown;
  }>;
  listPendingActions(): Promise<{ pendingActions: PendingAction[] }>;
  acceptPendingAction(id: string): Promise<AcceptedPendingAction>;
  rejectPendingAction(id: string): Promise<RejectedPendingAction>;
  getChapters(): Promise<{ index: ChapterIndex; status: ChapterIndexStatus }>;
  rescanChapters(): Promise<{ index: ChapterIndex; status: ChapterIndexStatus }>;
}

export function createOanClient(options: OanClientOptions = {}): OanClient {
  const bridge = options.bridge ?? detectDesktopBridge();
  const backendBaseUrl = normalizeBackendBaseUrl(
    bridge?.backendBaseUrl ?? options.backendBaseUrl ?? '',
  );
  const fetcher = options.fetch ?? detectFetch();
  const systemTheme = options.systemTheme ?? detectSystemThemePreference;
  const requestJson = <T>(
    path: string,
    requestOptions: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
    } = {},
  ) => requestJsonWith<T>(fetcher, backendBaseUrl, path, requestOptions);

  return {
    backendBaseUrl,
    getAgentChatApi: () => joinUrl(backendBaseUrl, '/api/agent/chat'),
    createAgentChatTransport: () =>
      new DefaultChatTransport<UIMessage>({
        api: joinUrl(backendBaseUrl, '/api/agent/chat'),
      }),
    getAppVersion: async () => bridge?.app?.getVersion(),
    getSystemThemePreference: systemTheme,
    getThemePreference: async () => bridge?.theme?.get() ?? systemTheme(),
    setThemePreference: async (theme) => bridge?.theme?.set(theme) ?? theme,
    isDirectoryPickerAvailable: () => Boolean(bridge?.workspace?.selectDirectory),
    selectDirectory: async () => bridge?.workspace?.selectDirectory(),
    listWorkspaces: () =>
      requestJson<{
        workspaces: WorkspaceSummary[];
        activeWorkspacePath?: string;
        providerConfigured: boolean;
      }>('/api/workspaces'),
    importWorkspace: (path) =>
      requestJson<{ workspace: WorkspaceSummary }>('/api/workspaces/import', {
        method: 'POST',
        body: { path },
      }),
    createWorkspace: (path) =>
      requestJson<{
        workspace: WorkspaceSummary;
        providerConfigured: boolean;
        onboarding: { show: boolean };
      }>('/api/workspaces/create', {
        method: 'POST',
        body: { path },
      }),
    openWorkspace: (path) =>
      requestJson<{
        workspace: WorkspaceSummary;
        providerConfigured: boolean;
      }>('/api/workspaces/open', {
        method: 'POST',
        body: { path },
      }),
    renameWorkspace: (path, name) =>
      requestJson<{ workspaces: WorkspaceSummary[] }>('/api/workspaces/name', {
        method: 'PATCH',
        body: { path, name },
      }),
    removeWorkspace: (path) =>
      requestJson<{ workspaces: WorkspaceSummary[] }>('/api/workspaces', {
        method: 'DELETE',
        body: { path },
      }),
    getProviderConfig: () => requestJson<ProviderConfigState>('/api/provider-config'),
    saveProviderConfig: (provider) =>
      requestJson<ProviderConfigState>('/api/provider-config', {
        method: 'POST',
        body: provider,
      }),
    setDefaultProviderConfig: (id) =>
      requestJson<ProviderConfigState>(
        `/api/provider-config/${encodeURIComponent(id)}/default`,
        { method: 'POST' },
      ),
    deleteProviderConfig: (id) =>
      requestJson<ProviderConfigState>(
        `/api/provider-config/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
    listProviderModels: (input) =>
      requestJson<{ models: ProviderModelSummary[] }>('/api/provider-config/models', {
        method: 'POST',
        body: input,
      }),
    checkProviderConfig: (input) =>
      requestJson<ProviderCheckResult>('/api/provider-config/check', {
        method: 'POST',
        body: input,
      }),
    getWorkspaceTree: () => requestJson<{ tree: FileTreeNode[] }>('/api/workspace/tree'),
    getWorkspaceFile: (path) =>
      requestJson<{ path: string; content: string }>(
        `/api/workspace/file?path=${encodeURIComponent(path)}`,
      ),
    getWorkspaceStatus: () => requestJson<WorkspaceStatus>('/api/workspace/status'),
    getProjectHealth: () =>
      requestJson<{ health: ProjectHealth }>('/api/workspace/project-health'),
    saveWorkspaceOnboarding: (input) =>
      requestJson<{ workspace: WorkspaceSummary; config: unknown }>('/api/workspace/onboarding', {
        method: 'POST',
        body: input,
      }),
    listPendingActions: () =>
      requestJson<{ pendingActions: PendingAction[] }>('/api/workspace/pending-actions'),
    acceptPendingAction: (id) =>
      requestJson<AcceptedPendingAction>(
        `/api/workspace/pending-actions/${encodeURIComponent(id)}/accept`,
        { method: 'POST' },
      ),
    rejectPendingAction: (id) =>
      requestJson<RejectedPendingAction>(
        `/api/workspace/pending-actions/${encodeURIComponent(id)}/reject`,
        { method: 'POST' },
      ),
    getChapters: () =>
      requestJson<{ index: ChapterIndex; status: ChapterIndexStatus }>(
        '/api/workspace/chapters',
      ),
    rescanChapters: () =>
      requestJson<{ index: ChapterIndex; status: ChapterIndexStatus }>(
        '/api/workspace/chapters/rescan',
        { method: 'POST' },
      ),
  };
}

async function requestJsonWith<T>(
  fetcher: typeof fetch,
  backendBaseUrl: string,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
  },
): Promise<T> {
  const response = await fetcher(joinUrl(backendBaseUrl, path), {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const errorMessage = isRecord(data) && typeof data.error === 'string'
      ? data.error
      : 'Request failed.';
    throw new Error(errorMessage);
  }

  return data as T;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return undefined;
  }

  return JSON.parse(text) as unknown;
}

function normalizeBackendBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

function detectDesktopBridge(): OanDesktopBridge | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as { ohAwesomeNovel?: OanDesktopBridge }).ohAwesomeNovel;
}

function detectFetch(): typeof fetch {
  if (typeof fetch === 'undefined') {
    throw new Error('Fetch API is not available.');
  }

  return fetch.bind(globalThis);
}

function detectSystemThemePreference(): ThemeMode {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
