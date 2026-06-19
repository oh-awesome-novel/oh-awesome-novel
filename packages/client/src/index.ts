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
  git: GitWorkspaceStatus;
}

export type ReferenceSourceType =
  | 'novel'
  | 'chapterSample'
  | 'styleSample'
  | 'settingBible'
  | 'notes';

export type ReferenceRights =
  | 'owned'
  | 'publicDomain'
  | 'licensed'
  | 'excerpt'
  | 'unknown';

export type ReferenceAllowedUsage =
  | 'analysisOnly'
  | 'styleInspiration'
  | 'structureReference'
  | 'noDirectQuotation';

export interface ReferenceImportInput {
  title: string;
  sourcePath?: string;
  sourceText?: string;
  originalFileName?: string;
  sourceType?: ReferenceSourceType;
  rights?: ReferenceRights;
  allowedUsage?: ReferenceAllowedUsage[];
  enabled?: boolean;
  notes?: string;
}

export interface ReferenceProgress {
  currentStage: string;
  completedStages: string[];
  failedStages: Array<{
    stage: string;
    message: string;
    failedAt: string;
  }>;
  resumable: boolean;
  updatedAt: string;
}

export interface ReferenceWorkSummary {
  id: string;
  title: string;
  sourceType: ReferenceSourceType;
  rights: ReferenceRights;
  allowedUsage: ReferenceAllowedUsage[];
  enabled: boolean;
  importedAt: string;
  checksumSha256: string;
  bundlePath: string;
  summaryPath: string;
  distilledPaths: string[];
  chapterCount: number;
  progress: ReferenceProgress;
}

export interface ReferenceSourceManifest {
  originalFile: string;
  originalFileName: string;
  sourcePath?: string;
  checksumSha256: string;
  importedAt: string;
  byteLength: number;
  charLength: number;
  lineCount: number;
  detectedStructure: {
    chapterCount: number;
    confidence: 'high' | 'medium' | 'low';
    chapters: Array<{
      id: string;
      title: string;
      lineStart: number;
      lineEnd: number;
      wordCount: number;
    }>;
  };
}

export interface ReferenceImportResult {
  reference: ReferenceWorkSummary;
  manifest: ReferenceSourceManifest;
  createdFiles: string[];
}

export interface ReferenceContextSelection {
  tokenBudget: number;
  originalSourceRead: boolean;
  noCopyWarnings: string[];
  included: Array<{
    id: string;
    title: string;
    path: string;
    reason: string;
    budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
    semanticBoundary: 'protected' | 'compressible' | 'excluded';
    estimatedTokens: number;
    content: string;
  }>;
  omitted: Array<{
    id: string;
    title: string;
    reason: string;
    budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
  }>;
}

export type PlaySourceTrust = 'canonical' | 'interactionHint' | 'playLocal' | 'modelImprovisation';
export type PlayAdoptionTarget = 'chapterDraft' | 'state' | 'timeline' | 'foreshadow';

export interface PlayActivatedSource {
  sourceId: string;
  path?: string;
  reason: string;
  budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
  semanticBoundary: 'protected' | 'compressible' | 'excluded';
  trust: PlaySourceTrust;
}

export interface PlayTranscriptTurn {
  speaker: string;
  content: string;
  createdAt: string;
}

export interface PlayObservation {
  id: string;
  summary: string;
  evidence: string;
  canonical: false;
}

export interface PlayAdoptionCandidate {
  id: string;
  target: PlayAdoptionTarget;
  summary: string;
  evidence: string;
  payload?: Record<string, unknown>;
  requiresPendingAction: true;
}

export interface PlaySession {
  id: string;
  title: string;
  createdAt: string;
  userPersona?: string;
  sceneStart: string;
  characters: string[];
  transcript: PlayTranscriptTurn[];
  playLocalState: Record<string, unknown>;
  activatedSources: PlayActivatedSource[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
}

export interface GitCommandError {
  code:
    | 'git_unavailable'
    | 'not_git_repository'
    | 'identity_missing'
    | 'remote_missing'
    | 'auth_failed'
    | 'conflict'
    | 'invalid_input'
    | 'git_failed';
  message: string;
  stderr?: string;
}

export interface GitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  raw: string;
}

export interface GitWorkspaceStatus {
  available: boolean;
  source: 'global';
  version?: string;
  repository: boolean;
  branch?: string;
  head?: string;
  status: 'clean' | 'dirty' | 'unknown';
  dirty: boolean | null;
  files: GitFileStatus[];
  error?: GitCommandError;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  authorName?: string;
  authorEmail?: string;
  authoredAt?: string;
}

export interface GitCommitDetail extends GitCommitSummary {
  body: string;
  files: Array<{
    path: string;
    status: string;
  }>;
  diff: string;
}

export type GitCommitResult =
  | { status: 'committed'; hash: string; message: string }
  | { status: 'skipped'; reason: 'auto_commit_disabled'; message: string }
  | { status: 'failed'; message: string; error: GitCommandError };

export type GitSyncResult =
  | { status: 'synced'; fetch: string; pull: string; push: string }
  | { status: 'failed'; step: 'fetch' | 'pull' | 'push'; error: GitCommandError };

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

export interface WorkspaceDecisionRefresh {
  workspaceStatus: WorkspaceStatus;
  projectHealth: ProjectHealth;
}

export interface ProjectionRebuildResult {
  projections: Array<{
    target: string;
    path: string;
  }>;
  warnings: string[];
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
  gitCommit: GitCommitResult;
  dirtyStatus: string;
  refresh?: WorkspaceDecisionRefresh;
}

export interface RejectedPendingAction {
  id: string;
  status: 'rejected';
  refresh?: WorkspaceDecisionRefresh;
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
  listReferences(): Promise<{ references: ReferenceWorkSummary[] }>;
  importReference(input: ReferenceImportInput): Promise<ReferenceImportResult>;
  setReferenceEnabled(id: string, enabled: boolean): Promise<{ reference: ReferenceWorkSummary }>;
  selectReferenceContext(input?: {
    tokenBudget?: number;
    maxReferences?: number;
  }): Promise<{ selection: ReferenceContextSelection }>;
  getGitStatus(): Promise<GitWorkspaceStatus>;
  getGitLog(maxCount?: number): Promise<{ commits: GitCommitSummary[]; error?: GitCommandError }>;
  getGitCommit(hash: string): Promise<GitCommitDetail>;
  getGitDiff(files?: string[]): Promise<{ diff: string }>;
  quickCommit(input: { files?: string[]; message: string }): Promise<GitCommitResult>;
  syncGit(): Promise<GitSyncResult>;
  openExternalEditor(editor: 'vscode' | 'zed' | 'webstorm'): Promise<{
    opened: boolean;
    editor: string;
    error?: string;
  }>;
  getProjectHealth(): Promise<{ health: ProjectHealth }>;
  rebuildProjections(): Promise<ProjectionRebuildResult>;
  listPlaySessions(): Promise<{ sessions: PlaySession[] }>;
  createPlaySession(input: {
    id?: string;
    title: string;
    sceneStart: string;
    userPersona?: string;
    characters?: string[];
    activatedSources?: PlayActivatedSource[];
  }): Promise<{ session: PlaySession; files: string[] }>;
  getPlaySession(id: string): Promise<{ session: PlaySession }>;
  appendPlayTranscript(id: string, turn: {
    speaker: string;
    content: string;
    createdAt?: string;
  }): Promise<{ session: PlaySession }>;
  addPlayObservation(id: string, observation: {
    id?: string;
    summary: string;
    evidence: string;
  }): Promise<{ session: PlaySession }>;
  addPlayAdoptionCandidate(id: string, candidate: {
    id?: string;
    target: PlayAdoptionTarget;
    summary: string;
    evidence: string;
    payload?: Record<string, unknown>;
  }): Promise<{ session: PlaySession; candidate: PlayAdoptionCandidate }>;
  createPlayAdoptionPendingAction(
    id: string,
    candidateId: string,
    payload?: Record<string, unknown>,
  ): Promise<{
    candidate: PlayAdoptionCandidate;
    pendingActionResult: unknown;
    refresh: WorkspaceDecisionRefresh;
  }>;
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
    listReferences: () =>
      requestJson<{ references: ReferenceWorkSummary[] }>('/api/workspace/references'),
    importReference: (input) =>
      requestJson<ReferenceImportResult>('/api/workspace/references/import', {
        method: 'POST',
        body: input,
      }),
    setReferenceEnabled: (id, enabled) =>
      requestJson<{ reference: ReferenceWorkSummary }>(
        `/api/workspace/references/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: { enabled },
        },
      ),
    selectReferenceContext: (input = {}) =>
      requestJson<{ selection: ReferenceContextSelection }>('/api/workspace/references/context', {
        method: 'POST',
        body: input,
      }),
    getGitStatus: () => requestJson<GitWorkspaceStatus>('/api/git/status'),
    getGitLog: (maxCount = 30) =>
      requestJson<{ commits: GitCommitSummary[]; error?: GitCommandError }>(
        `/api/git/log?maxCount=${encodeURIComponent(String(maxCount))}`,
      ),
    getGitCommit: (hash) =>
      requestJson<GitCommitDetail>(`/api/git/show/${encodeURIComponent(hash)}`),
    getGitDiff: (files = []) =>
      requestJson<{ diff: string }>(
        `/api/git/diff${files.length ? `?${files.map((file) => `file=${encodeURIComponent(file)}`).join('&')}` : ''}`,
      ),
    quickCommit: (input) =>
      requestJson<GitCommitResult>('/api/git/commit', {
        method: 'POST',
        body: input,
      }),
    syncGit: () =>
      requestJson<GitSyncResult>('/api/git/sync', {
        method: 'POST',
      }),
    openExternalEditor: (editor) =>
      requestJson<{ opened: boolean; editor: string; error?: string }>(
        '/api/external-editor/open',
        {
          method: 'POST',
          body: { editor },
        },
      ),
    getProjectHealth: () =>
      requestJson<{ health: ProjectHealth }>('/api/workspace/project-health'),
    rebuildProjections: () =>
      requestJson<ProjectionRebuildResult>('/api/workspace/projections/rebuild', {
        method: 'POST',
      }),
    listPlaySessions: () =>
      requestJson<{ sessions: PlaySession[] }>('/api/workspace/play-sessions'),
    createPlaySession: (input) =>
      requestJson<{ session: PlaySession; files: string[] }>('/api/workspace/play-sessions', {
        method: 'POST',
        body: input,
      }),
    getPlaySession: (id) =>
      requestJson<{ session: PlaySession }>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}`,
      ),
    appendPlayTranscript: (id, turn) =>
      requestJson<{ session: PlaySession }>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/transcript`,
        {
          method: 'POST',
          body: turn,
        },
      ),
    addPlayObservation: (id, observation) =>
      requestJson<{ session: PlaySession }>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/observations`,
        {
          method: 'POST',
          body: observation,
        },
      ),
    addPlayAdoptionCandidate: (id, candidate) =>
      requestJson<{ session: PlaySession; candidate: PlayAdoptionCandidate }>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/adoption-candidates`,
        {
          method: 'POST',
          body: candidate,
        },
      ),
    createPlayAdoptionPendingAction: (id, candidateId, payload) =>
      requestJson<{
        candidate: PlayAdoptionCandidate;
        pendingActionResult: unknown;
        refresh: WorkspaceDecisionRefresh;
      }>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/adoption-candidates/${encodeURIComponent(candidateId)}/pending-action`,
        {
          method: 'POST',
          body: payload ? { payload } : {},
        },
      ),
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
