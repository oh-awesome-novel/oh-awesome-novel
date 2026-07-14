import { DefaultChatTransport } from 'ai';
import type { ChatTransport, UIMessage } from 'ai';

export type ThemeMode = 'light' | 'dark';
export type ComposerSubmitShortcutPreference = 'enter' | 'meta-enter' | 'ctrl-enter';

export interface AppConfigState {
  theme?: ThemeMode;
  composerSubmitShortcut?: ComposerSubmitShortcutPreference;
}

export interface OanDesktopBridge {
  backendBaseUrl?: string;
  app?: {
    getVersion: () => Promise<string>;
  };
  appConfig?: {
    get: () => Promise<AppConfigState>;
    set: (config: Partial<AppConfigState>) => Promise<AppConfigState>;
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
  gitConfig: {
    autoCommitOnAccept: boolean;
  };
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
export type PlayActionKind = 'say' | 'look' | 'move' | 'do' | 'wait';
export type PlaySimulationMode = 'conversation' | 'reactiveWorld' | 'activeWorld';
export type PlayEventDensity = 'quiet' | 'balanced' | 'volatile';
export type PlayEventVisibility = 'playerVisible' | 'rumor' | 'playerUnknown';
export type PlayEventOrigin =
  | 'player'
  | 'npc'
  | 'faction'
  | 'clock'
  | 'environment'
  | 'worldRule'
  | 'manual';
export type PlayWorldEventKind =
  | 'environmentChanged'
  | 'locationChanged'
  | 'npcActed'
  | 'factionActed'
  | 'arrival'
  | 'departure'
  | 'deadlineAdvanced'
  | 'resourceChanged'
  | 'itemMoved'
  | 'evidenceChanged'
  | 'relationshipChanged'
  | 'informationSpread'
  | 'ruleConsequence'
  | 'manual';

export interface PlayWorldClock {
  turn: number;
  revision: number;
  anchor?: string;
  elapsed?: string;
}

export interface PlayEventPolicy {
  simulationMode: PlaySimulationMode;
  density: PlayEventDensity;
  allowOffscreen: boolean;
  allowHidden: boolean;
  maxExternalEventsPerTurn: number;
}

export interface PlayEventCause {
  reason: string;
  sourceTurnIds?: string[];
  sourceEventIds?: string[];
  triggerId?: string;
  pressureId?: string;
  agendaId?: string;
}

export interface PlayWorldEvent {
  id: string;
  turnId: string;
  sequence: number;
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
  cause: PlayEventCause;
  worldClock: PlayWorldClock;
  createdAt: string;
  canonical: false;
}

export interface PlayActivatedSource {
  sourceId: string;
  path?: string;
  reason: string;
  budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
  semanticBoundary: 'protected' | 'compressible' | 'excluded';
  trust: PlaySourceTrust;
}

export interface PlayTranscriptTurn {
  id?: string;
  speaker: string;
  content: string;
  createdAt: string;
  actionKind?: PlayActionKind;
}

export interface PlayTurnArtifact {
  schemaVersion: 1;
  id: string;
  revision: number;
  parentTurnId?: string;
  input?: {
    kind: PlayActionKind;
    raw: string;
  };
  messages: PlayTranscriptTurn[];
  worldClock?: PlayWorldClock;
  eventIds: string[];
  observationIds: string[];
  stateDelta: Record<string, unknown>;
  suggestedActions: string[];
  committedAt: string;
  canonical: false;
}

export interface PlayObservation {
  id: string;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  sourceTurnIds: string[];
  sourceEventIds: string[];
  canonical: false;
}

export interface PlayAdoptionCandidate {
  id: string;
  target: PlayAdoptionTarget;
  summary: string;
  evidence: string;
  payload?: Record<string, unknown>;
  visibility: PlayEventVisibility;
  sourceObservationIds: string[];
  sourceTurnIds: string[];
  sourceEventIds: string[];
  requiresPendingAction: true;
}

export interface PlaySession {
  schemaVersion: 3;
  id: string;
  title: string;
  createdAt: string;
  revision: number;
  userPersona?: string;
  sceneStart: string;
  characters: string[];
  transcript: PlayTranscriptTurn[];
  turnArtifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  metadataExtensions: Record<string, unknown>;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  eventPolicy: PlayEventPolicy;
  events: PlayWorldEvent[];
  suggestedActions: string[];
  activatedSources: PlayActivatedSource[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
}

export interface PlayTurnStreamEventBase {
  eventId: string;
  sequence: number;
  sessionId: string;
  turnId: string;
}

export interface PlayTurnStreamError {
  code: string;
  message: string;
  retryable: boolean;
}

export type PlayTurnStreamEvent =
  | (PlayTurnStreamEventBase & {
      type: 'play.turn.started';
      baseRevision: number;
      expectedArtifactId: string;
    })
  | (PlayTurnStreamEventBase & {
      type: 'play.context.ready';
      activatedSourceCount: number;
    })
  | (PlayTurnStreamEventBase & {
      type: 'play.narrative.delta';
      delta: string;
      provisional: true;
    })
  | (PlayTurnStreamEventBase & {
      type: 'play.narrative.reset';
      provisional: true;
      reason: string;
    })
  | (PlayTurnStreamEventBase & {
      type: 'play.turn.prepared';
      baseRevision: number;
      targetRevision: number;
      artifactId?: string;
    })
  | (PlayTurnStreamEventBase & {
      type: 'play.turn.committed';
      artifactId?: string;
      revision: number;
      session: PlaySession;
    })
  | (PlayTurnStreamEventBase & {
      type: 'play.turn.cancelled';
      committed: false;
      revision: number;
      reason: string;
    })
  | (PlayTurnStreamEventBase & {
      type: 'play.turn.failed';
      error: PlayTurnStreamError;
    });

export type PlayTurnCancelResult =
  | { status: 'cancelling'; committed: false; turnId: string }
  | { status: 'cancelled'; committed: false; turnId: string }
  | {
      status: 'committing';
      committed: false;
      tooLateToCancel: true;
      turnId: string;
    }
  | { status: 'committed'; committed: true; turnId: string; session: PlaySession }
  | { status: 'failed'; committed: false; turnId: string; error: string };

export interface PlayTurnStreamOptions {
  signal?: AbortSignal;
  onTurnId?(turnId: string): void;
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
  getAppConfig(): Promise<AppConfigState>;
  saveAppConfig(config: Partial<AppConfigState>): Promise<AppConfigState>;
  getThemePreference(): Promise<ThemeMode>;
  setThemePreference(theme: ThemeMode): Promise<ThemeMode>;
  getComposerSubmitShortcutPreference(): Promise<ComposerSubmitShortcutPreference | undefined>;
  setComposerSubmitShortcutPreference(
    shortcut: ComposerSubmitShortcutPreference,
  ): Promise<ComposerSubmitShortcutPreference>;
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
    eventPolicy?: Partial<PlayEventPolicy>;
  }): Promise<{ session: PlaySession; files: string[] }>;
  getPlaySession(id: string): Promise<{ session: PlaySession }>;
  runPlayWorldRefereeTurn(id: string, input: {
    userText: string;
    actionKind?: PlayActionKind;
    baseRevision?: number;
  }): Promise<{
    session: PlaySession;
    result?: {
      assistantMessage?: { role: 'assistant'; content: string };
    };
  }>;
  streamPlayWorldRefereeTurn(
    id: string,
    input: {
      userText: string;
      actionKind?: PlayActionKind;
      baseRevision?: number;
    },
    options?: PlayTurnStreamOptions,
  ): AsyncIterable<PlayTurnStreamEvent>;
  cancelPlayWorldRefereeTurn(id: string, turnId: string): Promise<PlayTurnCancelResult>;
  appendPlayTranscript(id: string, turn: {
    speaker: string;
    content: string;
    createdAt?: string;
    baseRevision?: number;
  }): Promise<{ session: PlaySession }>;
  addPlayObservation(id: string, observation: {
    id?: string;
    summary: string;
    evidence: string;
    baseRevision?: number;
  }): Promise<{ session: PlaySession }>;
  addPlayAdoptionCandidate(id: string, candidate: {
    id?: string;
    target: PlayAdoptionTarget;
    summary: string;
    evidence: string;
    payload?: Record<string, unknown>;
    sourceObservationIds?: string[];
    baseRevision?: number;
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
      signal?: AbortSignal;
    } = {},
  ) => requestJsonWith<T>(fetcher, backendBaseUrl, path, requestOptions);
  const getAppConfig = async (): Promise<AppConfigState> => {
    if (bridge?.appConfig?.get) {
      return normalizeAppConfig(await bridge.appConfig.get());
    }

    try {
      const result = await requestJson<{ config?: AppConfigState }>('/api/app-config');
      return normalizeAppConfig(result.config);
    } catch {
      return {};
    }
  };
  const saveAppConfig = async (config: Partial<AppConfigState>): Promise<AppConfigState> => {
    if (bridge?.appConfig?.set) {
      return normalizeAppConfig(await bridge.appConfig.set(config));
    }

    try {
      const result = await requestJson<{ config?: AppConfigState }>('/api/app-config', {
        method: 'PATCH',
        body: config,
      });
      return normalizeAppConfig(result.config);
    } catch {
      return normalizeAppConfig(config);
    }
  };

  return {
    backendBaseUrl,
    getAgentChatApi: () => joinUrl(backendBaseUrl, '/api/agent/chat'),
    createAgentChatTransport: () =>
      new DefaultChatTransport<UIMessage>({
        api: joinUrl(backendBaseUrl, '/api/agent/chat'),
      }),
    getAppVersion: async () => bridge?.app?.getVersion(),
    getSystemThemePreference: systemTheme,
    getAppConfig,
    saveAppConfig,
    getThemePreference: async () =>
      bridge?.theme?.get() ?? (await getAppConfig()).theme ?? systemTheme(),
    setThemePreference: async (theme) =>
      bridge?.theme?.set(theme) ?? (await saveAppConfig({ theme })).theme ?? theme,
    getComposerSubmitShortcutPreference: async () =>
      (await getAppConfig()).composerSubmitShortcut,
    setComposerSubmitShortcutPreference: async (shortcut) =>
      (await saveAppConfig({ composerSubmitShortcut: shortcut })).composerSubmitShortcut ?? shortcut,
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
    runPlayWorldRefereeTurn: (id, input) =>
      requestJson<{
        session: PlaySession;
        result?: { assistantMessage?: { role: 'assistant'; content: string } };
      }>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/world-referee-turn`,
        {
          method: 'POST',
          body: input,
        },
      ),
    streamPlayWorldRefereeTurn: (id, input, streamOptions) =>
      streamPlayWorldRefereeTurnWith(
        fetcher,
        backendBaseUrl,
        id,
        input,
        streamOptions,
      ),
    cancelPlayWorldRefereeTurn: (id, turnId) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/turns/${encodeURIComponent(turnId)}/cancel`,
        { method: 'POST' },
      ).then((value) => parsePlayTurnCancelResult(value, id, turnId)),
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

async function* streamPlayWorldRefereeTurnWith(
  fetcher: typeof fetch,
  backendBaseUrl: string,
  id: string,
  input: {
    userText: string;
    actionKind?: PlayActionKind;
    baseRevision?: number;
  },
  options: PlayTurnStreamOptions = {},
): AsyncIterable<PlayTurnStreamEvent> {
  const response = await fetcher(
    joinUrl(
      backendBaseUrl,
      `/api/workspace/play-sessions/${encodeURIComponent(id)}/turns/stream`,
    ),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: options.signal,
    },
  );

  if (!response.ok) {
    const data = await parseJsonResponse(response);
    const message = isRecord(data) && typeof data.error === 'string'
      ? data.error
      : 'Play turn stream request failed.';
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error('Play turn stream returned no response body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamCompleted = false;

  try {
    const responseTurnId = response.headers.get('X-OAN-Play-Turn-Id');
    if (responseTurnId) {
      options.onTurnId?.(responseTurnId);
    }

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      while (true) {
        const boundary = /\r?\n\r?\n/u.exec(buffer);
        if (!boundary || boundary.index === undefined) {
          break;
        }

        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const parsed = parsePlayTurnSseBlock(block);

        if (parsed.done) {
          streamCompleted = true;
          return;
        }
        if (parsed.event) {
          yield parsed.event;
        }
      }

      if (done) {
        streamCompleted = true;
        break;
      }
    }

    if (buffer.trim()) {
      const parsed = parsePlayTurnSseBlock(buffer);
      if (parsed.event) {
        yield parsed.event;
      }
    }
  } finally {
    if (!streamCompleted) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function parsePlayTurnSseBlock(block: string): {
  done: boolean;
  event?: PlayTurnStreamEvent;
} {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data) {
    return { done: false };
  }
  if (data === '[DONE]') {
    return { done: true };
  }

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new Error('Play turn stream returned invalid JSON.');
  }

  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !isNonEmptyString(value.eventId) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.turnId) ||
    !isPlayTurnStreamEventType(value.type)
  ) {
    throw new Error('Play turn stream returned an invalid event.');
  }

  const event = parsePlayTurnStreamEventPayload(value);
  if (!event) {
    throw new Error(`Play turn stream returned an invalid ${value.type} event.`);
  }

  return { done: false, event };
}

function parsePlayTurnStreamEventPayload(
  value: Record<string, unknown>,
): PlayTurnStreamEvent | undefined {
  const hasOptionalArtifactId = value.artifactId === undefined || isNonEmptyString(value.artifactId);

  switch (value.type) {
    case 'play.turn.started':
      return isNonNegativeSafeInteger(value.baseRevision) && isNonEmptyString(value.expectedArtifactId)
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
    case 'play.context.ready':
      return isNonNegativeSafeInteger(value.activatedSourceCount)
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
    case 'play.narrative.delta':
      return typeof value.delta === 'string' && value.provisional === true
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
    case 'play.narrative.reset':
      return isNonEmptyString(value.reason) && value.provisional === true
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
    case 'play.turn.prepared':
      return isNonNegativeSafeInteger(value.baseRevision)
        && isNonNegativeSafeInteger(value.targetRevision)
        && hasOptionalArtifactId
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
    case 'play.turn.committed':
      return isNonNegativeSafeInteger(value.revision)
        && hasOptionalArtifactId
        && isPlaySessionEnvelope(value.session, value.sessionId, value.revision as number)
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
    case 'play.turn.cancelled':
      return value.committed === false
        && isNonNegativeSafeInteger(value.revision)
        && isNonEmptyString(value.reason)
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
    case 'play.turn.failed':
      return isPlayTurnStreamError(value.error)
        ? value as unknown as PlayTurnStreamEvent
        : undefined;
  }
}

function parsePlayTurnCancelResult(
  value: unknown,
  sessionId: string,
  turnId: string,
): PlayTurnCancelResult {
  if (!isRecord(value) || value.turnId !== turnId) {
    throw new Error('Play turn cancellation returned an invalid result.');
  }

  if (
    (value.status === 'cancelling' || value.status === 'cancelled')
    && value.committed === false
  ) {
    return value as unknown as PlayTurnCancelResult;
  }
  if (
    value.status === 'committing'
    && value.committed === false
    && value.tooLateToCancel === true
  ) {
    return value as unknown as PlayTurnCancelResult;
  }
  if (
    value.status === 'committed'
    && value.committed === true
    && isPlaySessionEnvelope(value.session, sessionId)
  ) {
    return value as unknown as PlayTurnCancelResult;
  }
  if (
    value.status === 'failed'
    && value.committed === false
    && isNonEmptyString(value.error)
  ) {
    return value as unknown as PlayTurnCancelResult;
  }

  throw new Error('Play turn cancellation returned an invalid result.');
}

function isPlayTurnStreamError(value: unknown): value is PlayTurnStreamError {
  return isRecord(value)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.message)
    && typeof value.retryable === 'boolean';
}

function isPlaySessionEnvelope(
  value: unknown,
  sessionId: unknown,
  revision?: number,
): value is PlaySession {
  if (!isRecord(value) || value.schemaVersion !== 3) {
    return false;
  }

  return value.id === sessionId
    && (revision === undefined || value.revision === revision)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.createdAt)
    && isNonEmptyString(value.sceneStart)
    && isNonNegativeSafeInteger(value.revision)
    && isStringArray(value.characters)
    && Array.isArray(value.transcript)
    && value.transcript.every(isPlayTranscriptTurn)
    && Array.isArray(value.turnArtifacts)
    && value.turnArtifacts.every(isRecord)
    && isStringArray(value.selectedTurnIds)
    && isRecord(value.metadataExtensions)
    && isRecord(value.playLocalState)
    && isPlayVisibilityMap(value.playLocalStateVisibility)
    && isPlayWorldClock(value.worldClock)
    && isPlayEventPolicy(value.eventPolicy)
    && Array.isArray(value.events)
    && value.events.every(isPlayWorldEventEnvelope)
    && isStringArray(value.suggestedActions)
    && Array.isArray(value.activatedSources)
    && value.activatedSources.every(isPlayActivatedSourceEnvelope)
    && Array.isArray(value.observations)
    && value.observations.every(isPlayObservationEnvelope)
    && Array.isArray(value.adoptionCandidates)
    && value.adoptionCandidates.every(isPlayAdoptionCandidateEnvelope);
}

function isPlayWorldClock(value: unknown): value is PlayWorldClock {
  return isRecord(value)
    && isNonNegativeSafeInteger(value.turn)
    && isNonNegativeSafeInteger(value.revision)
    && (value.anchor === undefined || typeof value.anchor === 'string')
    && (value.elapsed === undefined || typeof value.elapsed === 'string');
}

function isPlayTranscriptTurn(value: unknown): value is PlayTranscriptTurn {
  return isRecord(value)
    && (value.id === undefined || isNonEmptyString(value.id))
    && isNonEmptyString(value.speaker)
    && typeof value.content === 'string'
    && isNonEmptyString(value.createdAt)
    && (value.actionKind === undefined
      || value.actionKind === 'say'
      || value.actionKind === 'look'
      || value.actionKind === 'move'
      || value.actionKind === 'do'
      || value.actionKind === 'wait');
}

function isPlayWorldEventEnvelope(value: unknown): value is PlayWorldEvent {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.turnId)
    && isNonNegativeSafeInteger(value.sequence)
    && isNonEmptyString(value.kind)
    && isNonEmptyString(value.origin)
    && isNonEmptyString(value.title)
    && typeof value.summary === 'string'
    && isPlayVisibility(value.visibility)
    && isRecord(value.cause)
    && isNonEmptyString(value.cause.reason)
    && isPlayWorldClock(value.worldClock)
    && isNonEmptyString(value.createdAt)
    && value.canonical === false;
}

function isPlayActivatedSourceEnvelope(value: unknown): value is PlayActivatedSource {
  return isRecord(value)
    && isNonEmptyString(value.sourceId)
    && (value.path === undefined || isNonEmptyString(value.path))
    && isNonEmptyString(value.reason)
    && (value.budgetLayer === 'L0'
      || value.budgetLayer === 'L1'
      || value.budgetLayer === 'L2'
      || value.budgetLayer === 'L3')
    && (value.semanticBoundary === 'protected'
      || value.semanticBoundary === 'compressible'
      || value.semanticBoundary === 'excluded')
    && (value.trust === 'canonical'
      || value.trust === 'interactionHint'
      || value.trust === 'playLocal'
      || value.trust === 'modelImprovisation');
}

function isPlayObservationEnvelope(value: unknown): value is PlayObservation {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.summary)
    && typeof value.evidence === 'string'
    && isPlayVisibility(value.visibility)
    && isStringArray(value.sourceTurnIds)
    && isStringArray(value.sourceEventIds)
    && value.canonical === false;
}

function isPlayAdoptionCandidateEnvelope(value: unknown): value is PlayAdoptionCandidate {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && (value.target === 'chapterDraft'
      || value.target === 'state'
      || value.target === 'timeline'
      || value.target === 'foreshadow')
    && isNonEmptyString(value.summary)
    && typeof value.evidence === 'string'
    && (value.payload === undefined || isRecord(value.payload))
    && isPlayVisibility(value.visibility)
    && isStringArray(value.sourceObservationIds)
    && isStringArray(value.sourceTurnIds)
    && isStringArray(value.sourceEventIds)
    && value.requiresPendingAction === true;
}

function isPlayVisibilityMap(value: unknown): value is Record<string, PlayEventVisibility> {
  return isRecord(value) && Object.values(value).every(isPlayVisibility);
}

function isPlayVisibility(value: unknown): value is PlayEventVisibility {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

function isPlayEventPolicy(value: unknown): value is PlayEventPolicy {
  return isRecord(value)
    && (value.simulationMode === 'conversation'
      || value.simulationMode === 'reactiveWorld'
      || value.simulationMode === 'activeWorld')
    && (value.density === 'quiet' || value.density === 'balanced' || value.density === 'volatile')
    && typeof value.allowOffscreen === 'boolean'
    && typeof value.allowHidden === 'boolean'
    && isNonNegativeSafeInteger(value.maxExternalEventsPerTurn);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPlayTurnStreamEventType(value: string): value is PlayTurnStreamEvent['type'] {
  return value === 'play.turn.started'
    || value === 'play.context.ready'
    || value === 'play.narrative.delta'
    || value === 'play.narrative.reset'
    || value === 'play.turn.prepared'
    || value === 'play.turn.committed'
    || value === 'play.turn.cancelled'
    || value === 'play.turn.failed';
}

async function requestJsonWith<T>(
  fetcher: typeof fetch,
  backendBaseUrl: string,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<T> {
  const response = await fetcher(joinUrl(backendBaseUrl, path), {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
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

function normalizeAppConfig(value: unknown): AppConfigState {
  if (!isRecord(value)) {
    return {};
  }

  return {
    theme: isThemeMode(value.theme) ? value.theme : undefined,
    composerSubmitShortcut: isComposerSubmitShortcutPreference(value.composerSubmitShortcut)
      ? value.composerSubmitShortcut
      : undefined,
  };
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function isComposerSubmitShortcutPreference(
  value: unknown,
): value is ComposerSubmitShortcutPreference {
  return value === 'enter' || value === 'meta-enter' || value === 'ctrl-enter';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
