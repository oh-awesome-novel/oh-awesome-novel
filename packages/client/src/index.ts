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

export interface PlayBranchBaseSnapshot {
  parentTurnId?: string;
  worldClock: PlayWorldClock;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
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

export type PlayFlagValue = string | number | boolean;

export type PlayEventTrigger =
  | { type: 'nextTurn' }
  | { type: 'afterTurns'; turns: number }
  | { type: 'flagEquals'; path: string; value: PlayFlagValue }
  | { type: 'atWorldTime'; value: string }
  | { type: 'manual' };

export type PlayScheduledEventStatus = 'scheduled' | 'occurred' | 'cancelled';

export interface PlayScheduledEventTemplate {
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
}

export interface PlayScheduledEvent {
  id: string;
  label: string;
  trigger: PlayEventTrigger;
  template: PlayScheduledEventTemplate;
  status: PlayScheduledEventStatus;
  scheduledAtTurn: number;
  scheduledAtRevision: number;
  sourceTurnId?: string;
  changeReason?: string;
  priority?: number;
  occurredEventIds?: string[];
  resolvedAtTurnId?: string;
  resolutionReason?: string;
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
  schemaVersion: 1 | 2;
  artifactKind?: 'worldSettlement' | 'transcriptAppend';
  branchSnapshotVersion?: 1;
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
  dueScheduledEventIds: string[];
  scheduledEventIds: string[];
  scheduledEventSnapshots: PlayScheduledEvent[];
  playLocalStateSnapshot?: Record<string, unknown>;
  playLocalStateVisibilitySnapshot?: Record<string, PlayEventVisibility>;
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
  schemaVersion: 4;
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
  branchSnapshotRequiredFromRevision: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
  metadataExtensions: Record<string, unknown>;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  eventPolicy: PlayEventPolicy;
  events: PlayWorldEvent[];
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
  activatedSources: PlayActivatedSource[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
}

export type PlayCheckpointStatus = 'current' | 'selectedAncestor' | 'variant';

export interface PlayCheckpointSummary {
  artifactId: string;
  parentArtifactId?: string;
  selectedTurnIds: string[];
  revision: number;
  worldTurn: number;
  committedAt: string;
  preview: string;
  status: PlayCheckpointStatus;
  restorable: boolean;
  canonical: false;
}

export interface PlayCheckpointRestoreResult {
  session: PlaySession;
  checkpoints: PlayCheckpointSummary[];
  restoredArtifactId: string;
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
      type: 'play.event.occurred';
      revision: number;
      event: PlayWorldEvent;
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
  listPlayCheckpoints(id: string): Promise<{ checkpoints: PlayCheckpointSummary[] }>;
  restorePlayCheckpoint(
    id: string,
    artifactId: string,
    input: { baseRevision: number },
  ): Promise<PlayCheckpointRestoreResult>;
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
    summary: string;
    evidence: string;
    baseRevision?: number;
  }): Promise<{ session: PlaySession }>;
  addPlayAdoptionCandidate(id: string, candidate: {
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
      requestJson<unknown>('/api/workspace/play-sessions')
        .then(parsePlaySessionListResponse),
    createPlaySession: (input) =>
      requestJson<unknown>('/api/workspace/play-sessions', {
        method: 'POST',
        body: input,
      }).then((value) => parsePlaySessionCreateResponse(value, input.id)),
    getPlaySession: (id) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}`,
      ).then((value) => parsePlaySessionResponse(value, id)),
    listPlayCheckpoints: (id) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/checkpoints`,
      ).then(parsePlayCheckpointListResponse),
    restorePlayCheckpoint: (id, artifactId, input) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(artifactId)}/restore`,
        {
          method: 'POST',
          body: input,
        },
      ).then((value) => parsePlayCheckpointRestoreResponse(
        value,
        id,
        artifactId,
      )),
    runPlayWorldRefereeTurn: (id, input) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/world-referee-turn`,
        {
          method: 'POST',
          body: input,
        },
      ).then((value) => parsePlayWorldRefereeTurnResponse(value, id)),
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
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/transcript`,
        {
          method: 'POST',
          body: turn,
        },
      ).then((value) => parsePlaySessionResponse(value, id)),
    addPlayObservation: (id, observation) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/observations`,
        {
          method: 'POST',
          body: observation,
        },
      ).then((value) => parsePlaySessionResponse(value, id)),
    addPlayAdoptionCandidate: (id, candidate) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/adoption-candidates`,
        {
          method: 'POST',
          body: candidate,
        },
      ).then((value) => parsePlayAdoptionCandidateResponse(value, id)),
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
    case 'play.event.occurred':
      if (
        !hasOnlyKnownFields(value, [
          'type',
          'eventId',
          'sequence',
          'sessionId',
          'turnId',
          'revision',
          'event',
        ]) ||
        !isNonNegativeSafeInteger(value.revision) ||
        !isPlayWorldEventEnvelope(value.event) ||
        value.revision !== value.event.worldClock.revision
      ) {
        return undefined;
      }
      return value as unknown as PlayTurnStreamEvent;
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

function parsePlayCheckpointListResponse(
  value: unknown,
): { checkpoints: PlayCheckpointSummary[] } {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['checkpoints']) ||
    !isPlayCheckpointSummaryList(value.checkpoints)
  ) {
    throw new Error('Play checkpoint list returned an invalid payload.');
  }

  return value as unknown as { checkpoints: PlayCheckpointSummary[] };
}

function parsePlayCheckpointRestoreResponse(
  value: unknown,
  sessionId: string,
  artifactId: string,
): PlayCheckpointRestoreResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['session', 'checkpoints', 'restoredArtifactId']) ||
    value.restoredArtifactId !== artifactId ||
    !isSafePlayFactId(value.restoredArtifactId) ||
    !isPlaySessionEnvelope(value.session, sessionId) ||
    !isPlayCheckpointSummaryList(value.checkpoints)
  ) {
    throw new Error('Play checkpoint restore returned an invalid payload.');
  }

  const session = value.session;
  const checkpoints = value.checkpoints;
  const restored = checkpoints.find((checkpoint) =>
    checkpoint.artifactId === artifactId);
  const currentCheckpoints = checkpoints.filter((checkpoint) =>
    checkpoint.status === 'current');
  const restoredArtifact = session.turnArtifacts.find((artifact) =>
    artifact.id === artifactId);
  if (
    !restored ||
    !restoredArtifact ||
    restored.status !== 'current' ||
    restored.restorable ||
    currentCheckpoints.length !== 1 ||
    session.selectedTurnIds.at(-1) !== artifactId ||
    !isDeepEqualJson(session.selectedTurnIds, restored.selectedTurnIds) ||
    session.worldClock.turn !== restored.worldTurn ||
    restored.revision !== restoredArtifact.revision ||
    restored.parentArtifactId !== restoredArtifact.parentTurnId ||
    restored.committedAt !== restoredArtifact.committedAt ||
    restored.revision >= session.revision
  ) {
    throw new Error('Play checkpoint restore returned an inconsistent payload.');
  }

  return value as unknown as PlayCheckpointRestoreResult;
}

function isPlayCheckpointSummaryList(
  value: unknown,
): value is PlayCheckpointSummary[] {
  if (
    !Array.isArray(value) ||
    !value.every(isPlayCheckpointSummaryEnvelope) ||
    new Set(value.map((checkpoint) => checkpoint.artifactId)).size !== value.length
  ) {
    return false;
  }

  const currentCheckpoints = value.filter((checkpoint) =>
    checkpoint.status === 'current');
  return currentCheckpoints.length === (value.length ? 1 : 0) &&
    currentCheckpoints.every((checkpoint) => !checkpoint.restorable);
}

function isPlayCheckpointSummaryEnvelope(
  value: unknown,
): value is PlayCheckpointSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'artifactId',
      'parentArtifactId',
      'selectedTurnIds',
      'revision',
      'worldTurn',
      'committedAt',
      'preview',
      'status',
      'restorable',
      'canonical',
    ]) ||
    !isSafePlayFactId(value.artifactId) ||
    (value.parentArtifactId !== undefined && !isSafePlayFactId(value.parentArtifactId)) ||
    !isUniqueSafePlayIdArray(value.selectedTurnIds) ||
    value.selectedTurnIds.length === 0 ||
    value.selectedTurnIds.at(-1) !== value.artifactId ||
    value.selectedTurnIds.at(-2) !== value.parentArtifactId ||
    !isNonNegativeSafeInteger(value.revision) ||
    !isNonNegativeSafeInteger(value.worldTurn) ||
    !isNonEmptyString(value.committedAt) ||
    !isNonEmptyString(value.preview) ||
    (
      value.status !== 'current' &&
      value.status !== 'selectedAncestor' &&
      value.status !== 'variant'
    ) ||
    typeof value.restorable !== 'boolean' ||
    value.canonical !== false
  ) {
    return false;
  }

  return true;
}

function parsePlaySessionListResponse(
  value: unknown,
): { sessions: PlaySession[] } {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['sessions']) ||
    !Array.isArray(value.sessions) ||
    !value.sessions.every((session) =>
      isRecord(session) && isPlaySessionEnvelope(session, session.id))
  ) {
    throw new Error('Play session list returned an invalid payload.');
  }
  return value as unknown as { sessions: PlaySession[] };
}

function parsePlaySessionResponse(
  value: unknown,
  sessionId: string,
): { session: PlaySession } {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['session']) ||
    !isPlaySessionEnvelope(value.session, sessionId)
  ) {
    throw new Error('Play session request returned an invalid payload.');
  }
  return value as unknown as { session: PlaySession };
}

function parsePlaySessionCreateResponse(
  value: unknown,
  requestedSessionId?: string,
): { session: PlaySession; files: string[] } {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['session', 'files']) ||
    !isRecord(value.session) ||
    !isPlaySessionEnvelope(
      value.session,
      requestedSessionId ?? value.session.id,
    ) ||
    !isStringArray(value.files)
  ) {
    throw new Error('Play session creation returned an invalid payload.');
  }
  return value as unknown as { session: PlaySession; files: string[] };
}

function parsePlayWorldRefereeTurnResponse(
  value: unknown,
  sessionId: string,
): {
  session: PlaySession;
  result?: { assistantMessage?: { role: 'assistant'; content: string } };
} {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['session', 'result']) ||
    !isPlaySessionEnvelope(value.session, sessionId) ||
    (value.result !== undefined && !isPlayWorldRefereeResult(value.result))
  ) {
    throw new Error('Play world referee turn returned an invalid payload.');
  }
  return value as unknown as {
    session: PlaySession;
    result?: { assistantMessage?: { role: 'assistant'; content: string } };
  };
}

function isPlayWorldRefereeResult(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKnownFields(value, ['assistantMessage'])) {
    return false;
  }
  if (value.assistantMessage === undefined) {
    return true;
  }
  return isRecord(value.assistantMessage)
    && hasOnlyKnownFields(value.assistantMessage, ['role', 'content'])
    && value.assistantMessage.role === 'assistant'
    && typeof value.assistantMessage.content === 'string';
}

function parsePlayAdoptionCandidateResponse(
  value: unknown,
  sessionId: string,
): { session: PlaySession; candidate: PlayAdoptionCandidate } {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['session', 'candidate']) ||
    !isPlaySessionEnvelope(value.session, sessionId) ||
    !isPlayAdoptionCandidateEnvelope(value.candidate)
  ) {
    throw new Error('Play adoption candidate returned an invalid payload.');
  }
  return value as unknown as {
    session: PlaySession;
    candidate: PlayAdoptionCandidate;
  };
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
  if (!isRecord(value) || value.schemaVersion !== 4) {
    return false;
  }

  return hasOnlyKnownFields(value, [
    'schemaVersion',
    'id',
    'title',
    'createdAt',
    'revision',
    'userPersona',
    'sceneStart',
    'characters',
    'transcript',
    'turnArtifacts',
    'selectedTurnIds',
    'branchSnapshotRequiredFromRevision',
    'branchBaseSnapshot',
    'metadataExtensions',
    'playLocalState',
    'playLocalStateVisibility',
    'worldClock',
    'eventPolicy',
    'events',
    'scheduledEvents',
    'suggestedActions',
    'activatedSources',
    'observations',
    'adoptionCandidates',
  ])
    && value.id === sessionId
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
    && value.turnArtifacts.every(isPlayTurnArtifactEnvelope)
    && isUniqueSafePlayIdArray(value.selectedTurnIds)
    && isNonNegativeSafeInteger(value.branchSnapshotRequiredFromRevision)
    && isPlayBranchBaseSnapshotEnvelope(value.branchBaseSnapshot)
    && isRecord(value.metadataExtensions)
    && isRecord(value.playLocalState)
    && isPlayVisibilityMap(value.playLocalStateVisibility)
    && isPlayWorldClock(value.worldClock)
    && isPlayEventPolicy(value.eventPolicy)
    && isPlayWorldEventList(value.events)
    && isPlayScheduledEventList(value.scheduledEvents)
    && isStringArray(value.suggestedActions)
    && Array.isArray(value.activatedSources)
    && value.activatedSources.every(isPlayActivatedSourceEnvelope)
    && Array.isArray(value.observations)
    && value.observations.every(isPlayObservationEnvelope)
    && hasUniqueEntityIds(value.observations)
    && Array.isArray(value.adoptionCandidates)
    && value.adoptionCandidates.every(isPlayAdoptionCandidateEnvelope)
    && hasUniqueEntityIds(value.adoptionCandidates)
    && hasConsistentPlaySessionFacts(value as unknown as PlaySession);
}

function hasConsistentPlaySessionFacts(session: PlaySession): boolean {
  if (
    session.worldClock.revision !== session.revision ||
    session.branchSnapshotRequiredFromRevision > session.revision ||
    session.branchSnapshotRequiredFromRevision !==
      session.branchBaseSnapshot.worldClock.revision ||
    !hasValidPlayBranchBaseScheduleSeeds(session.branchBaseSnapshot) ||
    !hasUniqueEntityIds(session.turnArtifacts)
  ) {
    return false;
  }
  const artifactsById = new Map(
    session.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const roots = session.turnArtifacts.filter((artifact) => !artifact.parentTurnId);
  if (session.turnArtifacts.length > 0 && roots.length !== 1) {
    return false;
  }
  const eventsById = new Map(session.events.map((event) => [event.id, event]));
  const observationsById = new Map(
    session.observations.map((observation) => [observation.id, observation]),
  );
  const messageIds = new Set<string>();
  const messageOwners = new Map<string, string>();
  const eventOwners = new Map<string, string>();
  const observationOwners = new Map<string, string>();

  for (const artifact of session.turnArtifacts) {
    const parent = artifact.parentTurnId
      ? artifactsById.get(artifact.parentTurnId)
      : undefined;
    if (
      (artifact.parentTurnId !== undefined && !parent) ||
      (parent !== undefined && artifact.revision <= parent.revision) ||
      (
        artifact.revision > session.branchSnapshotRequiredFromRevision &&
        artifact.schemaVersion !== 2
      ) ||
      (
        artifact.worldClock !== undefined &&
        artifact.worldClock.revision !== artifact.revision
      )
    ) {
      return false;
    }

    const visited = new Set([artifact.id]);
    let ancestor = parent;
    while (ancestor) {
      if (visited.has(ancestor.id)) {
        return false;
      }
      visited.add(ancestor.id);
      ancestor = ancestor.parentTurnId
        ? artifactsById.get(ancestor.parentTurnId)
        : undefined;
    }

    for (const message of artifact.messages) {
      if (!message.id || messageIds.has(message.id)) {
        return false;
      }
      messageIds.add(message.id);
      messageOwners.set(message.id, artifact.id);
    }

    if (artifact.schemaVersion === 2) {
      if (!hasConsistentPlayV2Artifact(
        artifact,
        parent,
        artifactsById,
        eventsById,
        session.branchBaseSnapshot,
      )) {
        return false;
      }
    } else if (
      parent?.schemaVersion === 2 ||
      artifact.branchSnapshotVersion !== undefined ||
      artifact.artifactKind !== undefined ||
      artifact.playLocalStateSnapshot !== undefined ||
      artifact.playLocalStateVisibilitySnapshot !== undefined ||
      artifact.scheduledEventSnapshots.length > 0
    ) {
      return false;
    }

    for (const eventId of artifact.eventIds) {
      const event = eventsById.get(eventId);
      const allowedArtifactIds = collectPlayArtifactAncestorIds(
        artifact,
        artifactsById,
      );
      const allowedTurnIds = collectPlayArtifactMessageIds(
        allowedArtifactIds,
        artifactsById,
      );
      const allowedEventIds = collectPlayArtifactEventIds(
        allowedArtifactIds,
        artifactsById,
      );
      if (
        !event ||
        eventOwners.has(eventId) ||
        !artifact.messages.some((message) => message.id === event.turnId) ||
        !hasScopedPlayFactReferences(
          event.cause.sourceTurnIds ?? [],
          event.cause.sourceEventIds ?? [],
          allowedTurnIds,
          allowedEventIds,
        ) ||
        (artifact.worldClock !== undefined &&
          !isDeepEqualJson(event.worldClock, artifact.worldClock))
      ) {
        return false;
      }
      eventOwners.set(eventId, artifact.id);
    }

    for (const observationId of artifact.observationIds) {
      const observation = observationsById.get(observationId);
      const allowedArtifactIds = collectPlayArtifactAncestorIds(
        artifact,
        artifactsById,
      );
      const allowedTurnIds = collectPlayArtifactMessageIds(
        allowedArtifactIds,
        artifactsById,
      );
      const allowedEventIds = collectPlayArtifactEventIds(
        allowedArtifactIds,
        artifactsById,
      );
      if (
        !observation ||
        observationOwners.has(observationId) ||
        !hasScopedPlayFactReferences(
          observation.sourceTurnIds,
          observation.sourceEventIds,
          allowedTurnIds,
          allowedEventIds,
        )
      ) {
        return false;
      }
      observationOwners.set(observationId, artifact.id);
    }
  }

  if (session.events.some((event) => !eventOwners.has(event.id))) {
    return false;
  }
  if (session.scheduledEvents.some((event) =>
    event.scheduledAtRevision > session.revision ||
    event.scheduledAtTurn > session.worldClock.turn)) {
    return false;
  }

  const selectedArtifacts: PlayTurnArtifact[] = [];
  let expectedParentId: string | undefined;
  for (const selectedId of session.selectedTurnIds) {
    const artifact = artifactsById.get(selectedId);
    if (!artifact || artifact.parentTurnId !== expectedParentId) {
      return false;
    }
    selectedArtifacts.push(artifact);
    expectedParentId = artifact.id;
  }
  if (session.turnArtifacts.length > 0 && selectedArtifacts.length === 0) {
    return false;
  }
  if (!isDeepEqualJson(
    session.transcript,
    selectedArtifacts.flatMap((artifact) => artifact.messages),
  )) {
    return false;
  }
  const allEventIds = new Set(eventsById.keys());
  for (const observation of session.observations) {
    if (observationOwners.has(observation.id)) {
      continue;
    }
    if (
      !hasScopedPlayFactReferences(
        observation.sourceTurnIds,
        observation.sourceEventIds,
        messageIds,
        allEventIds,
      ) ||
      !doPlayReferenceOwnersShareBranch(
        collectPlayReferenceOwnerIds(
          observation.sourceTurnIds,
          observation.sourceEventIds,
          messageOwners,
          eventOwners,
        ),
        artifactsById,
      )
    ) {
      return false;
    }
  }
  for (const candidate of session.adoptionCandidates) {
    const provenanceOwnerIds = collectPlayReferenceOwnerIds(
      candidate.sourceTurnIds,
      candidate.sourceEventIds,
      messageOwners,
      eventOwners,
    );
    for (const observationId of candidate.sourceObservationIds) {
      const observationOwnerId = observationOwners.get(observationId);
      if (observationOwnerId) {
        provenanceOwnerIds.push(observationOwnerId);
        continue;
      }
      const observation = observationsById.get(observationId);
      if (observation) {
        provenanceOwnerIds.push(...collectPlayReferenceOwnerIds(
          observation.sourceTurnIds,
          observation.sourceEventIds,
          messageOwners,
          eventOwners,
        ));
      }
    }
    if (
      !hasScopedPlayFactReferences(
        candidate.sourceTurnIds,
        candidate.sourceEventIds,
        messageIds,
        allEventIds,
      ) ||
      candidate.sourceObservationIds.some((id) => !observationsById.has(id)) ||
      !doPlayReferenceOwnersShareBranch(
        provenanceOwnerIds,
        artifactsById,
      )
    ) {
      return false;
    }
  }

  const selectedHead = selectedArtifacts.at(-1);
  if (selectedHead?.schemaVersion === 2) {
    if (
      !isDeepEqualJson(session.scheduledEvents, selectedHead.scheduledEventSnapshots) ||
      !isDeepEqualJson(session.playLocalState, selectedHead.playLocalStateSnapshot) ||
      !isDeepEqualJson(
        session.playLocalStateVisibility,
        selectedHead.playLocalStateVisibilitySnapshot,
      ) ||
      !isDeepEqualJson(session.suggestedActions, selectedHead.suggestedActions) ||
      session.worldClock.turn !== selectedHead.worldClock?.turn ||
      session.worldClock.anchor !== selectedHead.worldClock?.anchor ||
      session.worldClock.elapsed !== selectedHead.worldClock?.elapsed
    ) {
      return false;
    }
  } else if (
    selectedHead?.id !== session.branchBaseSnapshot.parentTurnId ||
    !isDeepEqualJson(
      session.scheduledEvents,
      session.branchBaseSnapshot.scheduledEvents,
    ) ||
    !isDeepEqualJson(
      session.playLocalState,
      session.branchBaseSnapshot.playLocalState,
    ) ||
    !isDeepEqualJson(
      session.playLocalStateVisibility,
      session.branchBaseSnapshot.playLocalStateVisibility,
    ) ||
    !isDeepEqualJson(
      session.suggestedActions,
      session.branchBaseSnapshot.suggestedActions,
    ) ||
    session.worldClock.turn !== session.branchBaseSnapshot.worldClock.turn ||
    session.worldClock.anchor !== session.branchBaseSnapshot.worldClock.anchor ||
    session.worldClock.elapsed !== session.branchBaseSnapshot.worldClock.elapsed
  ) {
    return false;
  }

  return true;
}

function hasConsistentPlayV2Artifact(
  artifact: PlayTurnArtifact,
  parent: PlayTurnArtifact | undefined,
  artifactsById: Map<string, PlayTurnArtifact>,
  eventsById: Map<string, PlayWorldEvent>,
  branchBaseSnapshot: PlayBranchBaseSnapshot,
): boolean {
  if (
    artifact.branchSnapshotVersion !== 1 ||
    !artifact.worldClock ||
    !artifact.playLocalStateSnapshot ||
    !artifact.playLocalStateVisibilitySnapshot ||
    !isDeepEqualJson(
      Object.keys(artifact.playLocalStateSnapshot).sort(),
      Object.keys(artifact.playLocalStateVisibilitySnapshot).sort(),
    )
  ) {
    return false;
  }
  const artifactWorldClock = artifact.worldClock;
  const dueIds = new Set(artifact.dueScheduledEventIds);
  if (artifact.dueScheduledEventIds.some((dueId) =>
    artifact.scheduledEventSnapshots.find((event) => event.id === dueId)?.status
      !== 'occurred')) {
    return false;
  }

  if (artifact.artifactKind === 'worldSettlement') {
    const [userMessage, refereeMessage] = artifact.messages;
    if (
      !artifact.input ||
      artifact.messages.length !== 2 ||
      userMessage?.speaker !== 'user' ||
      refereeMessage?.speaker !== 'world-referee' ||
      userMessage.content !== artifact.input.raw ||
      userMessage.actionKind !== artifact.input.kind ||
      refereeMessage.actionKind !== undefined ||
      artifact.eventIds.some((eventId) =>
        eventsById.get(eventId)?.turnId !== refereeMessage.id)
    ) {
      return false;
    }
  } else if (
    artifact.artifactKind !== 'transcriptAppend' ||
    artifact.input !== undefined ||
    artifact.messages.length !== 1 ||
    artifact.eventIds.length !== 0 ||
    artifact.dueScheduledEventIds.length !== 0 ||
    artifact.observationIds.length !== 0 ||
    Object.keys(artifact.stateDelta).length !== 0
  ) {
    return false;
  }

  const parentComplete = parent?.schemaVersion === 2;
  if (!parentComplete && branchBaseSnapshot.parentTurnId !== artifact.parentTurnId) {
    return false;
  }
  const predecessorClock = parentComplete
    ? parent.worldClock!
    : branchBaseSnapshot.worldClock;
  const predecessorState = parentComplete
    ? parent.playLocalStateSnapshot!
    : branchBaseSnapshot.playLocalState;
  const predecessorVisibility = parentComplete
    ? parent.playLocalStateVisibilitySnapshot!
    : branchBaseSnapshot.playLocalStateVisibility;
  const predecessorSchedules = parentComplete
    ? parent.scheduledEventSnapshots
    : branchBaseSnapshot.scheduledEvents;
  const predecessorSuggestedActions = parentComplete
    ? parent.suggestedActions
    : branchBaseSnapshot.suggestedActions;
  if (artifact.revision <= predecessorClock.revision) {
    return false;
  }
  const expectedTurn = predecessorClock.turn +
    (artifact.artifactKind === 'worldSettlement' ? 1 : 0);
  const expectedState = {
    ...predecessorState,
    ...artifact.stateDelta,
  };
  const expectedVisibility = { ...predecessorVisibility };
  const eventVisibilities = artifact.eventIds.map((eventId) =>
    eventsById.get(eventId)?.visibility ?? 'playerVisible');
  const settlementVisibility: PlayEventVisibility =
    eventVisibilities.includes('playerUnknown')
      ? 'playerUnknown'
      : eventVisibilities.includes('rumor')
        ? 'rumor'
        : 'playerVisible';
  for (const key of Object.keys(artifact.stateDelta)) {
    expectedVisibility[key] = settlementVisibility;
  }
  const expectedDueIds = artifact.artifactKind === 'worldSettlement'
    ? predecessorSchedules
        .filter((event) => event.status === 'scheduled')
        .filter((event) => isClientScheduledEventDue(
          event,
          artifactWorldClock.turn,
          predecessorState,
        ))
        .sort(compareClientScheduledEvents)
        .map((event) => event.id)
    : [];
  const predecessorSchedulesById = new Map(
    predecessorSchedules.map((event) => [event.id, event]),
  );
  const currentSchedulesById = new Map(
    artifact.scheduledEventSnapshots.map((event) => [event.id, event]),
  );
  if (
    artifactWorldClock.turn !== expectedTurn ||
    (artifact.artifactKind === 'transcriptAppend' &&
      (
        artifactWorldClock.anchor !== predecessorClock.anchor ||
        artifactWorldClock.elapsed !== predecessorClock.elapsed
      )) ||
    !isDeepEqualJson(artifact.playLocalStateSnapshot, expectedState) ||
    !isDeepEqualJson(
      artifact.playLocalStateVisibilitySnapshot,
      expectedVisibility,
    ) ||
    (artifact.artifactKind === 'transcriptAppend' &&
      (
        !isDeepEqualJson(
          artifact.suggestedActions,
          predecessorSuggestedActions,
        ) ||
        !isDeepEqualJson(
          artifact.scheduledEventSnapshots,
          predecessorSchedules,
        )
      )) ||
    !isDeepEqualJson(artifact.dueScheduledEventIds, expectedDueIds) ||
    predecessorSchedules.some((event) => !currentSchedulesById.has(event.id)) ||
    artifact.scheduledEventSnapshots.some((event) =>
      predecessorSchedulesById.get(event.id)?.status === 'scheduled' &&
      event.status === 'occurred' &&
      !dueIds.has(event.id))
  ) {
    return false;
  }

  for (const scheduledEvent of artifact.scheduledEventSnapshots) {
    const previous = predecessorSchedulesById.get(scheduledEvent.id);
    if (!previous) {
      if (
        scheduledEvent.status !== 'scheduled' ||
        !hasCurrentArtifactScheduleEvidence(scheduledEvent, artifact)
      ) {
        return false;
      }
    } else if (previous.status !== 'scheduled') {
      if (!isDeepEqualJson(previous, scheduledEvent)) {
        return false;
      }
    } else if (!isDeepEqualJson(previous, scheduledEvent)) {
      if (scheduledEvent.status === 'scheduled') {
        if (
          previous.id !== scheduledEvent.id ||
          previous.label !== scheduledEvent.label ||
          !isDeepEqualJson(previous.template, scheduledEvent.template) ||
          !hasCurrentArtifactScheduleEvidence(scheduledEvent, artifact)
        ) {
          return false;
        }
      } else if (
        !hasSamePlayScheduledEventPlan(previous, scheduledEvent) ||
        !hasCurrentArtifactScheduleResolution(scheduledEvent, artifact)
      ) {
        return false;
      }
    }
    if (scheduledEvent.status !== 'occurred') {
      continue;
    }

    const occurredEventIds = scheduledEvent.occurredEventIds;
    const occurredEventId = occurredEventIds?.[0];
    const occurredEvent = occurredEventId
      ? eventsById.get(occurredEventId)
      : undefined;
    const occurrenceOwner = occurredEventId
      ? findPlayEventOwner(occurredEventId, artifactsById)
      : undefined;
    const newlyOccurred = previous?.status !== 'occurred';
    if (
      occurredEventIds?.length !== 1 ||
      !occurredEvent ||
      !occurrenceOwner ||
      (newlyOccurred
        ? occurrenceOwner.id !== artifact.id
        : !isPlayArtifactAncestorOrSelf(
          occurrenceOwner.id,
          artifact,
          artifactsById,
        )) ||
      occurrenceOwner.artifactKind !== 'worldSettlement' ||
      occurrenceOwner.messages[1]?.id !== scheduledEvent.resolvedAtTurnId ||
      occurredEvent.turnId !== scheduledEvent.resolvedAtTurnId ||
      occurredEvent.cause.triggerId !== scheduledEvent.id ||
      !doesPlayEventMatchScheduledTemplate(occurredEvent, scheduledEvent)
    ) {
      return false;
    }
  }

  for (const eventId of artifact.eventIds) {
    const event = eventsById.get(eventId);
    const triggerId = event?.cause.triggerId;
    if (!triggerId) {
      continue;
    }
    const scheduledEvent = currentSchedulesById.get(triggerId);
    if (
      scheduledEvent?.status !== 'occurred' ||
      scheduledEvent.occurredEventIds?.length !== 1 ||
      scheduledEvent.occurredEventIds[0] !== eventId
    ) {
      return false;
    }
  }

  return true;
}

function hasValidPlayBranchBaseScheduleSeeds(
  branchBaseSnapshot: PlayBranchBaseSnapshot,
): boolean {
  return branchBaseSnapshot.scheduledEvents.every((event) =>
    event.status === 'scheduled' &&
    event.scheduledAtTurn <= branchBaseSnapshot.worldClock.turn &&
    event.scheduledAtRevision <= branchBaseSnapshot.worldClock.revision &&
    event.sourceTurnId === undefined &&
    event.changeReason === undefined &&
    event.occurredEventIds === undefined &&
    event.resolvedAtTurnId === undefined &&
    event.resolutionReason === undefined);
}

function findPlayEventOwner(
  eventId: string,
  artifactsById: Map<string, PlayTurnArtifact>,
): PlayTurnArtifact | undefined {
  let owner: PlayTurnArtifact | undefined;
  for (const artifact of artifactsById.values()) {
    if (!artifact.eventIds.includes(eventId)) {
      continue;
    }
    if (owner) {
      return undefined;
    }
    owner = artifact;
  }
  return owner;
}

function isPlayArtifactAncestorOrSelf(
  candidateId: string,
  artifact: PlayTurnArtifact,
  artifactsById: Map<string, PlayTurnArtifact>,
): boolean {
  let current: PlayTurnArtifact | undefined = artifact;
  while (current) {
    if (current.id === candidateId) {
      return true;
    }
    current = current.parentTurnId
      ? artifactsById.get(current.parentTurnId)
      : undefined;
  }
  return false;
}

function collectPlayArtifactAncestorIds(
  artifact: PlayTurnArtifact,
  artifactsById: Map<string, PlayTurnArtifact>,
): Set<string> {
  const ids = new Set<string>();
  let current: PlayTurnArtifact | undefined = artifact;
  while (current) {
    ids.add(current.id);
    current = current.parentTurnId
      ? artifactsById.get(current.parentTurnId)
      : undefined;
  }
  return ids;
}

function collectPlayArtifactMessageIds(
  artifactIds: Set<string>,
  artifactsById: Map<string, PlayTurnArtifact>,
): Set<string> {
  return new Set([...artifactIds].flatMap((artifactId) =>
    artifactsById.get(artifactId)?.messages.flatMap((message) =>
      message.id ? [message.id] : []) ?? []));
}

function collectPlayArtifactEventIds(
  artifactIds: Set<string>,
  artifactsById: Map<string, PlayTurnArtifact>,
): Set<string> {
  return new Set([...artifactIds].flatMap((artifactId) =>
    artifactsById.get(artifactId)?.eventIds ?? []));
}

function hasScopedPlayFactReferences(
  sourceTurnIds: string[],
  sourceEventIds: string[],
  allowedTurnIds: Set<string>,
  allowedEventIds: Set<string>,
): boolean {
  return sourceTurnIds.every((id) => allowedTurnIds.has(id)) &&
    sourceEventIds.every((id) => allowedEventIds.has(id));
}

function collectPlayReferenceOwnerIds(
  sourceTurnIds: string[],
  sourceEventIds: string[],
  messageOwners: Map<string, string>,
  eventOwners: Map<string, string>,
): string[] {
  return [
    ...sourceTurnIds.map((turnId) => messageOwners.get(turnId)),
    ...sourceEventIds.map((eventId) => eventOwners.get(eventId)),
  ].filter((artifactId): artifactId is string => artifactId !== undefined);
}

function doPlayReferenceOwnersShareBranch(
  ownerArtifactIds: string[],
  artifactsById: Map<string, PlayTurnArtifact>,
): boolean {
  const uniqueOwnerIds = [...new Set(ownerArtifactIds)];
  if (uniqueOwnerIds.length < 2) {
    return true;
  }
  const deepestOwner = uniqueOwnerIds
    .map((artifactId) => artifactsById.get(artifactId))
    .filter((artifact): artifact is PlayTurnArtifact => artifact !== undefined)
    .sort((left, right) => right.revision - left.revision)[0];
  if (!deepestOwner) {
    return false;
  }
  const ancestorIds = collectPlayArtifactAncestorIds(
    deepestOwner,
    artifactsById,
  );
  return uniqueOwnerIds.every((artifactId) => ancestorIds.has(artifactId));
}

function doesPlayEventMatchScheduledTemplate(
  event: PlayWorldEvent,
  scheduledEvent: PlayScheduledEvent,
): boolean {
  return event.kind === scheduledEvent.template.kind &&
    event.origin === scheduledEvent.template.origin &&
    event.title === scheduledEvent.template.title &&
    event.visibility === scheduledEvent.template.visibility;
}

function hasCurrentArtifactScheduleEvidence(
  scheduledEvent: PlayScheduledEvent,
  artifact: PlayTurnArtifact,
): boolean {
  const refereeMessage = artifact.messages[1];
  return artifact.artifactKind === 'worldSettlement' &&
    refereeMessage?.speaker === 'world-referee' &&
    scheduledEvent.sourceTurnId === refereeMessage.id &&
    isNonEmptyString(scheduledEvent.changeReason) &&
    scheduledEvent.scheduledAtRevision === artifact.revision &&
    scheduledEvent.scheduledAtTurn === artifact.worldClock?.turn;
}

function hasCurrentArtifactScheduleResolution(
  scheduledEvent: PlayScheduledEvent,
  artifact: PlayTurnArtifact,
): boolean {
  const refereeMessage = artifact.messages[1];
  return artifact.artifactKind === 'worldSettlement' &&
    refereeMessage?.speaker === 'world-referee' &&
    scheduledEvent.resolvedAtTurnId === refereeMessage.id;
}

function hasSamePlayScheduledEventPlan(
  left: PlayScheduledEvent,
  right: PlayScheduledEvent,
): boolean {
  return left.id === right.id &&
    left.label === right.label &&
    isDeepEqualJson(left.trigger, right.trigger) &&
    isDeepEqualJson(left.template, right.template) &&
    left.scheduledAtTurn === right.scheduledAtTurn &&
    left.scheduledAtRevision === right.scheduledAtRevision &&
    left.sourceTurnId === right.sourceTurnId &&
    left.changeReason === right.changeReason &&
    left.priority === right.priority;
}

function isClientScheduledEventDue(
  event: PlayScheduledEvent,
  nextTurn: number,
  playLocalState: Record<string, unknown>,
): boolean {
  if (event.trigger.type === 'nextTurn') {
    return nextTurn > event.scheduledAtTurn;
  }
  if (event.trigger.type === 'afterTurns') {
    return nextTurn >= event.scheduledAtTurn + event.trigger.turns;
  }
  if (event.trigger.type === 'flagEquals') {
    let value: unknown = playLocalState;
    for (const segment of event.trigger.path.split('.')) {
      if (!isRecord(value) || !Object.hasOwn(value, segment)) {
        return false;
      }
      value = value[segment];
    }
    return value === event.trigger.value;
  }
  return false;
}

function compareClientScheduledEvents(
  left: PlayScheduledEvent,
  right: PlayScheduledEvent,
): number {
  return (right.priority ?? 0) - (left.priority ?? 0) ||
    left.scheduledAtTurn - right.scheduledAtTurn ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function isPlayWorldClock(value: unknown): value is PlayWorldClock {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['turn', 'revision', 'anchor', 'elapsed'])
    && isNonNegativeSafeInteger(value.turn)
    && isNonNegativeSafeInteger(value.revision)
    && (value.anchor === undefined || isNonEmptyString(value.anchor))
    && (value.elapsed === undefined || isNonEmptyString(value.elapsed));
}

function isPlayBranchBaseSnapshotEnvelope(
  value: unknown,
): value is PlayBranchBaseSnapshot {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'parentTurnId',
      'worldClock',
      'playLocalState',
      'playLocalStateVisibility',
      'scheduledEvents',
      'suggestedActions',
    ])
    && (value.parentTurnId === undefined || isSafePlayFactId(value.parentTurnId))
    && isPlayWorldClock(value.worldClock)
    && isRecord(value.playLocalState)
    && isPlayVisibilityMap(value.playLocalStateVisibility)
    && isDeepEqualJson(
      Object.keys(value.playLocalState).sort(),
      Object.keys(value.playLocalStateVisibility).sort(),
    )
    && isPlayScheduledEventList(value.scheduledEvents)
    && isUniqueNonEmptyStringArray(value.suggestedActions);
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
    && hasOnlyKnownFields(value, [
      'id',
      'turnId',
      'sequence',
      'kind',
      'origin',
      'title',
      'summary',
      'visibility',
      'cause',
      'worldClock',
      'createdAt',
      'canonical',
    ])
    && isSafePlayFactId(value.id)
    && isSafePlayFactId(value.turnId)
    && isPositiveSafeInteger(value.sequence)
    && isPlayWorldEventKind(value.kind)
    && isPlayEventOrigin(value.origin)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.summary)
    && isPlayVisibility(value.visibility)
    && isPlayEventCauseEnvelope(value.cause)
    && isPlayWorldClock(value.worldClock)
    && isNonEmptyString(value.createdAt)
    && value.canonical === false;
}

function isPlayWorldEventList(value: unknown): value is PlayWorldEvent[] {
  return Array.isArray(value)
    && value.every(isPlayWorldEventEnvelope)
    && hasUniqueEntityIds(value);
}

function isPlayEventCauseEnvelope(value: unknown): value is PlayEventCause {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'reason',
      'sourceTurnIds',
      'sourceEventIds',
      'triggerId',
      'pressureId',
      'agendaId',
    ])
    && isNonEmptyString(value.reason)
    && (value.sourceTurnIds === undefined || isUniqueSafePlayIdArray(value.sourceTurnIds))
    && (value.sourceEventIds === undefined || isUniqueSafePlayIdArray(value.sourceEventIds))
    && (value.triggerId === undefined || isSafePlayFactId(value.triggerId))
    && (value.pressureId === undefined || isSafePlayFactId(value.pressureId))
    && (value.agendaId === undefined || isSafePlayFactId(value.agendaId));
}

function isPlayTurnArtifactEnvelope(value: unknown): value is PlayTurnArtifact {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'schemaVersion',
      'artifactKind',
      'branchSnapshotVersion',
      'id',
      'revision',
      'parentTurnId',
      'input',
      'messages',
      'worldClock',
      'eventIds',
      'dueScheduledEventIds',
      'scheduledEventIds',
      'scheduledEventSnapshots',
      'playLocalStateSnapshot',
      'playLocalStateVisibilitySnapshot',
      'observationIds',
      'stateDelta',
      'suggestedActions',
      'committedAt',
      'canonical',
    ])
    && (value.schemaVersion === 1 || value.schemaVersion === 2)
    && (value.artifactKind === undefined
      || value.artifactKind === 'worldSettlement'
      || value.artifactKind === 'transcriptAppend')
    && (value.branchSnapshotVersion === undefined || value.branchSnapshotVersion === 1)
    && isSafePlayFactId(value.id)
    && isNonNegativeSafeInteger(value.revision)
    && (value.parentTurnId === undefined || isSafePlayFactId(value.parentTurnId))
    && (value.input === undefined || (
      isRecord(value.input)
      && hasOnlyKnownFields(value.input, ['kind', 'raw'])
      && isPlayActionKind(value.input.kind)
      && isNonEmptyString(value.input.raw)
    ))
    && Array.isArray(value.messages)
    && value.messages.length > 0
    && value.messages.every(isPlayTurnArtifactMessage)
    && (value.worldClock === undefined || isPlayWorldClock(value.worldClock))
    && isUniqueSafePlayIdArray(value.eventIds)
    && isUniqueSafePlayIdArray(value.dueScheduledEventIds)
    && hasMatchingScheduledEventSnapshots(
      value.scheduledEventIds,
      value.scheduledEventSnapshots,
    )
    && (value.playLocalStateSnapshot === undefined || isRecord(value.playLocalStateSnapshot))
    && (value.playLocalStateVisibilitySnapshot === undefined
      || isPlayVisibilityMap(value.playLocalStateVisibilitySnapshot))
    && (value.schemaVersion !== 2 || (
      (value.artifactKind === 'worldSettlement'
        || value.artifactKind === 'transcriptAppend')
      && value.branchSnapshotVersion === 1
      && value.worldClock !== undefined
      && isRecord(value.playLocalStateSnapshot)
      && isPlayVisibilityMap(value.playLocalStateVisibilitySnapshot)
    ))
    && isUniqueSafePlayIdArray(value.observationIds)
    && isRecord(value.stateDelta)
    && isUniqueNonEmptyStringArray(value.suggestedActions)
    && isNonEmptyString(value.committedAt)
    && value.canonical === false;
}

function isPlayTurnArtifactMessage(value: unknown): value is PlayTranscriptTurn & { id: string } {
  return isPlayTranscriptTurn(value)
    && isRecord(value)
    && hasOnlyKnownFields(value, ['id', 'speaker', 'content', 'createdAt', 'actionKind'])
    && isSafePlayFactId(value.id)
    && isNonEmptyString(value.content);
}

function hasMatchingScheduledEventSnapshots(
  scheduledEventIds: unknown,
  scheduledEventSnapshots: unknown,
): boolean {
  if (
    !isUniqueSafePlayIdArray(scheduledEventIds) ||
    !isPlayScheduledEventList(scheduledEventSnapshots)
  ) {
    return false;
  }

  return scheduledEventSnapshots.length === scheduledEventIds.length
    && scheduledEventSnapshots.every((event, index) =>
      event.id === scheduledEventIds[index]);
}

function isPlayScheduledEventEnvelope(value: unknown): value is PlayScheduledEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'label',
      'trigger',
      'template',
      'status',
      'scheduledAtTurn',
      'scheduledAtRevision',
      'sourceTurnId',
      'changeReason',
      'priority',
      'occurredEventIds',
      'resolvedAtTurnId',
      'resolutionReason',
    ])
  ) {
    return false;
  }
  const status = value.status;
  const occurredEventIds = value.occurredEventIds;
  const resolvedAtTurnId = value.resolvedAtTurnId;
  const resolutionReason = value.resolutionReason;

  return isSafePlayFactId(value.id)
    && isNonEmptyString(value.label)
    && isPlayEventTrigger(value.trigger)
    && isPlayScheduledEventTemplate(value.template)
    && (status === 'scheduled' || status === 'occurred' || status === 'cancelled')
    && isNonNegativeSafeInteger(value.scheduledAtTurn)
    && isNonNegativeSafeInteger(value.scheduledAtRevision)
    && (value.sourceTurnId === undefined || isSafePlayFactId(value.sourceTurnId))
    && (value.changeReason === undefined || isNonEmptyString(value.changeReason))
    && (value.priority === undefined || Number.isSafeInteger(value.priority))
    && (occurredEventIds === undefined || isUniqueSafePlayIdArray(occurredEventIds))
    && (resolvedAtTurnId === undefined || isSafePlayFactId(resolvedAtTurnId))
    && (resolutionReason === undefined || isNonEmptyString(resolutionReason))
    && (status !== 'scheduled' || (
      occurredEventIds === undefined
      && resolvedAtTurnId === undefined
      && resolutionReason === undefined
    ))
    && (status !== 'occurred' || (
      Array.isArray(occurredEventIds)
      && occurredEventIds.length > 0
      && isNonEmptyString(resolvedAtTurnId)
    ))
    && (status !== 'cancelled' || (
      occurredEventIds === undefined
      && isNonEmptyString(resolvedAtTurnId)
      && isNonEmptyString(resolutionReason)
    ));
}

function isPlayScheduledEventList(value: unknown): value is PlayScheduledEvent[] {
  return Array.isArray(value)
    && value.every(isPlayScheduledEventEnvelope)
    && hasUniqueEntityIds(value);
}

function isPlayEventTrigger(value: unknown): value is PlayEventTrigger {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === 'nextTurn' || value.type === 'manual') {
    return hasOnlyKnownFields(value, ['type']);
  }
  if (value.type === 'afterTurns') {
    return hasOnlyKnownFields(value, ['type', 'turns'])
      && isPositiveSafeInteger(value.turns);
  }
  if (value.type === 'flagEquals') {
    return hasOnlyKnownFields(value, ['type', 'path', 'value'])
      && isSafePlayStatePath(value.path)
      && (typeof value.value === 'string'
        || typeof value.value === 'boolean'
        || (typeof value.value === 'number' && Number.isFinite(value.value)));
  }
  return value.type === 'atWorldTime'
    && hasOnlyKnownFields(value, ['type', 'value'])
    && isNonEmptyString(value.value);
}

function isPlayScheduledEventTemplate(
  value: unknown,
): value is PlayScheduledEventTemplate {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['kind', 'origin', 'title', 'summary', 'visibility'])
    && isPlayWorldEventKind(value.kind)
    && isPlayEventOrigin(value.origin)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.summary)
    && isPlayVisibility(value.visibility);
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
    && isSafePlayFactId(value.id)
    && isNonEmptyString(value.summary)
    && typeof value.evidence === 'string'
    && isPlayVisibility(value.visibility)
    && isUniqueSafePlayIdArray(value.sourceTurnIds)
    && isUniqueSafePlayIdArray(value.sourceEventIds)
    && value.canonical === false;
}

function isPlayAdoptionCandidateEnvelope(value: unknown): value is PlayAdoptionCandidate {
  return isRecord(value)
    && isSafePlayFactId(value.id)
    && (value.target === 'chapterDraft'
      || value.target === 'state'
      || value.target === 'timeline'
      || value.target === 'foreshadow')
    && isNonEmptyString(value.summary)
    && typeof value.evidence === 'string'
    && (value.payload === undefined || isRecord(value.payload))
    && isPlayVisibility(value.visibility)
    && isUniqueSafePlayIdArray(value.sourceObservationIds)
    && isUniqueSafePlayIdArray(value.sourceTurnIds)
    && isUniqueSafePlayIdArray(value.sourceEventIds)
    && value.requiresPendingAction === true;
}

function isPlayVisibilityMap(value: unknown): value is Record<string, PlayEventVisibility> {
  return isRecord(value) && Object.values(value).every(isPlayVisibility);
}

function isPlayVisibility(value: unknown): value is PlayEventVisibility {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

function isPlayActionKind(value: unknown): value is PlayActionKind {
  return value === 'say'
    || value === 'look'
    || value === 'move'
    || value === 'do'
    || value === 'wait';
}

function isPlayEventOrigin(value: unknown): value is PlayEventOrigin {
  return value === 'player'
    || value === 'npc'
    || value === 'faction'
    || value === 'clock'
    || value === 'environment'
    || value === 'worldRule'
    || value === 'manual';
}

function isPlayWorldEventKind(value: unknown): value is PlayWorldEventKind {
  return value === 'environmentChanged'
    || value === 'locationChanged'
    || value === 'npcActed'
    || value === 'factionActed'
    || value === 'arrival'
    || value === 'departure'
    || value === 'deadlineAdvanced'
    || value === 'resourceChanged'
    || value === 'itemMoved'
    || value === 'evidenceChanged'
    || value === 'relationshipChanged'
    || value === 'informationSpread'
    || value === 'ruleConsequence'
    || value === 'manual';
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
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function hasOnlyKnownFields(
  value: Record<string, unknown>,
  knownFields: readonly string[],
): boolean {
  const known = new Set(knownFields);
  return Object.keys(value).every((field) => known.has(field));
}

function isSafePlayFactId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    && !value.includes('..')
    && !value.includes('/')
    && !value.includes('\\');
}

function isUniqueSafePlayIdArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isSafePlayFactId)
    && new Set(value).size === value.length;
}

function isUniqueNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}

function hasUniqueEntityIds(value: readonly unknown[]): boolean {
  const ids = value.map((item) => isRecord(item) && isSafePlayFactId(item.id)
    ? item.id
    : undefined);
  return ids.every((id): id is string => id !== undefined)
    && new Set(ids).size === ids.length;
}

function isDeepEqualJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => isDeepEqualJson(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && isDeepEqualJson(left[key], right[key]));
}

const UNSAFE_PLAY_STATE_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function isSafePlayStatePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value
  ) {
    return false;
  }

  return value.split('.').every((segment) =>
    /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(segment)
    && !UNSAFE_PLAY_STATE_PATH_SEGMENTS.has(segment));
}

function isPlayTurnStreamEventType(value: string): value is PlayTurnStreamEvent['type'] {
  return value === 'play.turn.started'
    || value === 'play.context.ready'
    || value === 'play.narrative.delta'
    || value === 'play.narrative.reset'
    || value === 'play.turn.prepared'
    || value === 'play.event.occurred'
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
