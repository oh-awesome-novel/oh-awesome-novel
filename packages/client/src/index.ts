import { DefaultChatTransport } from 'ai';
import type { ChatTransport, UIMessage } from 'ai';

import {
  createOanRequestError,
  createPlayRehearsalClientMethods,
  isPlayRehearsalSessionEnvelope,
} from './play-rehearsal.js';
import type {
  CreatePlaySceneRehearsalSessionInput,
  PlayRehearsalClientMethods,
  PlayRehearsalSessionV5,
  PlaySessionPurpose,
} from './play-rehearsal.js';

export {
  OanRequestError,
  isPlayRehearsalSessionEnvelope,
} from './play-rehearsal.js';
export type {
  CharacterStepDraft,
  CharacterStepDraftStatus,
  CreatePlaySceneRehearsalSessionInput,
  NarrativeBlock,
  NarrativeBlockKind,
  PlayActorStepCancelResult,
  PlayActorStepStreamEvent,
  PlayActorStepStreamInput,
  PlayActorStepStreamOptions,
  PlayAgendaChange,
  PlayAttemptMutationInput,
  PlayAttemptMutationReceipt,
  PlayAttemptMutationResult,
  PlayCommittedCharacterStepEvidence,
  PlayCommittedSceneEvidence,
  PlayRehearsalClientMethods,
  PlayRehearsalFinalizeReceipt,
  PlayRehearsalFinalizeResult,
  PlayRehearsalParticipant,
  PlayRehearsalAttempt,
  PlayRehearsalSessionV5,
  PlayRehearsalStepStopResult,
  PlayRehearsalStepStreamError,
  PlayRehearsalStepStreamEvent,
  PlayRehearsalStepStreamInput,
  PlayRehearsalStepStreamOptions,
  PlayRehearsalTurnEvidence,
  PlayRehearsalTurnArtifactV3,
  PlaySceneContract,
  PlaySceneKnowledgeEvidence,
  PlaySceneRehearsalSidecar,
  PlaySceneValue,
  PlaySessionPurpose,
  PlayStartMode,
  PlayTurnAttempt,
  PlayTurnAttemptStatus,
  PlayWorldRefereeScheduledEventChange,
  PlayWorldRefereeSettlement,
  PlayWorldRefereeSettlementEvent,
} from './play-rehearsal.js';

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
export type PlayAdoptionProjection = 'player' | 'director';
export type PlayAdoptionWriteIntentToolName =
  | 'chapter.createDraft'
  | 'state.set'
  | 'timeline.add'
  | 'foreshadow.create';
export type PlayAdoptionSeed =
  | { kind: 'event'; eventId: string }
  | { kind: 'observation'; observationId: string }
  | {
      kind: 'outcome';
      outcomeItemId: string;
      outcomeReportFingerprint: string;
    };
export interface PlayAdoptionSourceSnapshot {
  sourceId: string;
  path?: string;
  contentHash?: string;
}
export interface PlayAdoptionEvidenceClosure {
  schemaVersion: 1;
  sessionId: string;
  sessionRevision: number;
  selectedArtifactTurnRefs: string[];
  artifactTurnRefs: string[];
  messageRefs: string[];
  eventRefs: string[];
  observationRefs: string[];
  evidenceRefs: string[];
  sourceSnapshots: PlayAdoptionSourceSnapshot[];
  selectedPathFingerprint: string;
  sourceBaseFingerprint: string;
}
export interface PlayAdoptionTargetSuggestion {
  target: PlayAdoptionTarget;
  toolName: PlayAdoptionWriteIntentToolName;
  recommended: boolean;
  reason: string;
  defaultPayload: Record<string, unknown>;
}
export interface PlayAdoptionDraft {
  seed: PlayAdoptionSeed;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  evidenceClosure: PlayAdoptionEvidenceClosure;
  evidenceFingerprint: string;
  targetSuggestions: PlayAdoptionTargetSuggestion[];
}
export interface PlayAdoptionPreview {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  baseRevision: number;
  projection: PlayAdoptionProjection;
  seed: PlayAdoptionSeed;
  candidateId: string;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  evidenceClosure: PlayAdoptionEvidenceClosure;
  evidenceFingerprint: string;
  suggestions: PlayAdoptionTargetSuggestion[];
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  touchedFiles: string[];
  diff: string;
  fingerprint: string;
  createdAt: string;
  canonicalUnchanged: true;
}
export interface CreatePlayAdoptionPreviewInput {
  baseRevision: number;
  projection: PlayAdoptionProjection;
  seed: PlayAdoptionSeed;
  target?: PlayAdoptionTarget;
  payload?: Record<string, unknown>;
}
export interface CreatePlayAdoptionPendingActionInput {
  baseRevision: number;
  fingerprint: string;
}
export type PlayActionKind = 'say' | 'look' | 'move' | 'do' | 'wait';
export type PlaySimulationMode = 'conversation' | 'reactiveWorld' | 'activeWorld';
export type PlayEventDensity = 'quiet' | 'balanced' | 'volatile';
export type PlayEventVisibility = 'playerVisible' | 'rumor' | 'playerUnknown';
export const PLAY_KNOWLEDGE_STATE_KEY = 'playKnowledge' as const;
export const PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION = 1 as const;
export const MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN = 8 as const;
export const MAX_PLAY_KNOWLEDGE_RECORDS = 512 as const;
export type PlayKnowledgePlayerProjection = PlayEventVisibility;
export interface PlayEventRevealRecord {
  id: string;
  kind: 'eventReveal';
  subjectEventId: string;
  previousPlayerProjection: 'playerUnknown' | 'rumor';
  playerProjection: 'rumor' | 'playerVisible';
  knownByParticipantRefs: [];
  revealedAtTurnId: string;
  revealedByEventId: string;
  canonical: false;
}
export interface PlayKnowledgeState {
  schemaVersion: 1;
  records: PlayEventRevealRecord[];
}
export interface PlayRevealEventKnowledgeChange {
  type: 'revealEvent';
  subjectEventId: string;
  playerProjection: 'rumor' | 'playerVisible';
}
export type PlayKnowledgeChange = PlayRevealEventKnowledgeChange;
export interface PlayKnowledgeRevealCandidate {
  subjectEventId: string;
  currentPlayerProjection: 'playerUnknown' | 'rumor';
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  reason: string;
  worldClock: PlayWorldClock;
}
export type PlayKnowledgeProjection =
  | {
      lens: 'player';
      kind: 'eventReveal';
      playerProjection: 'rumor' | 'playerVisible';
      revealedAtTurnId: string;
      revealedByEventId: string;
      causalLabel: 'revealsEarlierOffscreenChange' | 'confirmsEarlierRumor';
    }
  | {
      lens: 'author';
      record: PlayEventRevealRecord;
    };
export type PlayTimeAdvanceUnit = 'minute' | 'hour' | 'day';
export interface PlayRelativeTimeAdvance {
  amount: number;
  unit: PlayTimeAdvanceUnit;
}
export type PlayPressureKind =
  | 'deadline'
  | 'pursuit'
  | 'factionProject'
  | 'environment'
  | 'rumor'
  | 'relationship';
export type PlayPressureStatus = 'latent' | 'active' | 'resolved';
export interface PlayPressure {
  id: string;
  kind: PlayPressureKind;
  label: string;
  status: PlayPressureStatus;
  level?: number;
  threshold?: number;
  causeRefs: string[];
  nextConsequence?: string;
  visibility: PlayEventVisibility;
}
export type PlayAgendaStatus = 'active' | 'blocked' | 'completed' | 'abandoned';
export interface PlayAgenda {
  id: string;
  ownerEntityId: string;
  goal: string;
  nextMove?: string;
  blockers: string[];
  status: PlayAgendaStatus;
  visibility: PlayEventVisibility;
  updatedAtTurnId: string;
}
export interface PlayWorldMomentum {
  pressures: PlayPressure[];
  agendas: PlayAgenda[];
}
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
  objectId?: string;
  contentHash?: string;
  role?: PlayLaunchSourceRole;
  reason: string;
  budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
  semanticBoundary: 'protected' | 'compressible' | 'excluded';
  trust: PlaySourceTrust;
}

export type PlayLaunchSourceRole =
  | 'chapter'
  | 'character'
  | 'world'
  | 'timeline'
  | 'state'
  | 'other';

export type PlayLaunchSourceStatus = 'ready' | 'missing' | 'invalid';

export type PlayLaunchDiagnosticCode =
  | 'invalidSource'
  | 'missingSource'
  | 'staleSource'
  | 'sourceTooLarge'
  | 'binarySource'
  | 'participantWithoutCharacterSource'
  | 'participantCharacterMismatch';

export interface PlayLaunchSourceInput {
  sourceId: string;
  path: string;
  role: PlayLaunchSourceRole;
  reason?: string;
}

export interface PlayLaunchSceneValue {
  value: string;
  provenance:
    | { kind: 'sourceBacked'; sourceRefs: string[] }
    | { kind: 'authorProvided'; providedAt: string };
}

export interface PlayLaunchEntryPointInput {
  id: string;
  label: string;
  opening: string;
  sourceRefs: string[];
  location?: PlayLaunchSceneValue;
  worldTime?: PlayLaunchSceneValue;
  atmosphere?: PlayLaunchSceneValue;
  trigger?: PlayLaunchSceneValue;
  objective?: PlayLaunchSceneValue;
  risk?: PlayLaunchSceneValue;
}

export interface PlayLaunchIdentityInput {
  kind: 'player' | 'director';
  persona?: string;
  directorPurpose?: string;
}

export interface PlayLaunchKnowledgeBoundaryInput {
  id: string;
  fact: string;
  visibility: PlayEventVisibility;
  sourceRefs: string[];
}

export interface PlayLaunchParticipantRoleInput {
  participantRef: string;
  displayName: string;
  canonicalCharacterRef?: string;
  sourceRefs: string[];
  position?: string;
  currentGoal?: string;
  initialKnowledge: PlayLaunchKnowledgeBoundaryInput[];
}

export interface PlayLaunchPackagePreviewInput {
  id?: string;
  createdAt?: string;
  title: string;
  purpose: PlaySessionPurpose;
  startMode: 'guided';
  simulationMode: PlaySimulationMode;
  density: PlayEventDensity;
  sources: PlayLaunchSourceInput[];
  entryPoint: PlayLaunchEntryPointInput;
  identity: PlayLaunchIdentityInput;
  participantRoles: PlayLaunchParticipantRoleInput[];
}

export interface PlayLaunchSource {
  sourceId: string;
  path: string;
  objectId?: string;
  role: PlayLaunchSourceRole;
  reason: string;
  budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
  semanticBoundary: 'protected' | 'compressible' | 'excluded';
  trust: PlaySourceTrust;
  status: PlayLaunchSourceStatus;
  contentHash?: string;
  excerpt?: string;
}

export interface PlayLaunchDiagnostic {
  id: string;
  code: PlayLaunchDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  sourceId?: string;
  path?: string;
  participantRef?: string;
  expectedContentHash?: string;
  actualContentHash?: string;
}

export interface PlayLaunchPackage {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  title: string;
  purpose: PlaySessionPurpose;
  startMode: 'guided';
  eventPolicy: {
    simulationMode: PlaySimulationMode;
    density: PlayEventDensity;
  };
  sourceBase: { activatedSources: PlayLaunchSource[] };
  entryPoint: PlayLaunchEntryPointInput;
  identity: PlayLaunchIdentityInput;
  participantRoles: PlayLaunchParticipantRoleInput[];
  diagnostics: PlayLaunchDiagnostic[];
  canonical: false;
}

export interface PlayLaunchPackagePreviewResult {
  launchPackage: PlayLaunchPackage;
}

export interface PlayLaunchPackageCreateResult {
  launchPackage: PlayLaunchPackage;
  files: string[];
}

export interface PlayLaunchPackageReadResult {
  launchPackage: PlayLaunchPackage;
}

export interface StartPlaySessionFromLaunchPackageInput {
  launchPackageId: string;
  id?: string;
}

export interface PlayLaunchSessionMetadata {
  setupId: string;
  setupSchemaVersion: 1;
  purpose: PlaySessionPurpose;
  startMode: 'guided';
}

export interface PlayTranscriptTurn {
  id?: string;
  speaker: string;
  content: string;
  createdAt: string;
  actionKind?: PlayActionKind;
}

export interface PlayTurnArtifact {
  schemaVersion: 1 | 2 | 3;
  artifactKind?: 'worldSettlement' | 'transcriptAppend';
  branchSnapshotVersion?: 1;
  id: string;
  revision: number;
  parentTurnId?: string;
  input?: {
    kind: PlayActionKind;
    raw: string;
    timeAdvance?: PlayRelativeTimeAdvance;
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
  rehearsalEvidenceRefs?: string[];
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
  seed?: PlayAdoptionSeed;
  evidenceClosure?: PlayAdoptionEvidenceClosure;
  evidenceFingerprint?: string;
  requiresPendingAction: true;
}

export type PlayOutcomeProjection = 'player' | 'director';
export type PlayOutcomeReportStatus = 'current' | 'stale';
export type PlayOutcomeItemKind =
  | 'sceneSummary'
  | 'goalAssessment'
  | 'participantFootprint'
  | 'worldChange'
  | 'writingMaterial';
export type PlayOutcomeConfidence = 'confirmed' | 'inferred' | 'authorProvided';
export type PlayOutcomeGoalStatus = 'reached' | 'partial' | 'missed' | 'changed';
export type PlayOutcomeTag =
  | 'goal'
  | 'divergence'
  | 'consistency'
  | 'worldChange'
  | 'participantFootprint'
  | 'writingMaterial';

export interface PlayOutcomeSourceSnapshot {
  sourceId: string;
  path?: string;
  contentHash?: string;
}

export interface PlayOutcomeItem {
  id: string;
  kind: PlayOutcomeItemKind;
  summary: string;
  visibility: PlayEventVisibility;
  confidence: PlayOutcomeConfidence;
  goalStatus?: PlayOutcomeGoalStatus;
  tags: PlayOutcomeTag[];
  artifactTurnRefs: string[];
  messageRefs: string[];
  eventRefs: string[];
  observationRefs: string[];
  evidenceRefs: string[];
  sourceRefs: string[];
  participantRefs: string[];
}

export interface PlayOutcomeReport {
  schemaVersion: 1;
  sessionId: string;
  sceneId?: string;
  createdAt: string;
  sessionRevision: number;
  selectedArtifactTurnRefs: string[];
  sourceSnapshots: PlayOutcomeSourceSnapshot[];
  items: PlayOutcomeItem[];
}

export type PlayOutcomeReportStaleReason =
  | 'sessionRevisionChanged'
  | 'selectedBranchChanged'
  | 'sourceSnapshotChanged'
  | `sourceContentChanged:${string}`
  | `sourceUnavailable:${string}`;

export interface PlayOutcomeReportResult {
  report: PlayOutcomeReport;
  reportFingerprint: string;
  projection: PlayOutcomeProjection;
  status: PlayOutcomeReportStatus;
  staleReasons: PlayOutcomeReportStaleReason[];
}

export interface PlayOutcomeReportGenerateResult extends PlayOutcomeReportResult {
  files: string[];
}

export type PlayWritingReferenceStatus = 'active' | 'detached' | 'stale';

export interface PlayWritingReferenceAttachment {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  reportRef: string;
  reportFingerprint: string;
  selectedOutcomeItemRefs: string[];
  selectedArtifactTurnRefs: string[];
  evidenceClosureRefs: string[];
  sourceSnapshots: PlayOutcomeSourceSnapshot[];
  status: PlayWritingReferenceStatus;
  createdAt: string;
  detachedAt?: string;
}

export interface CreatePlayWritingReferenceAttachmentInput {
  sessionId: string;
  baseRevision: number;
  selectedOutcomeItemIds: string[];
}

export interface PlaySessionV4 {
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

export type PlaySession = PlaySessionV4 | PlayRehearsalSessionV5;

export type PlayCheckpointStatus = 'current' | 'selectedAncestor' | 'variant';
export type PlayCheckpointKind = 'initialWorld' | 'turn';

export const PLAY_INITIAL_WORLD_CHECKPOINT_ID = 'initial-world' as const;

export interface PlayCheckpointSummary {
  checkpointId: string;
  kind: PlayCheckpointKind;
  artifactId?: string;
  parentCheckpointId?: string;
  selectedTurnIds: string[];
  depth: number;
  revision: number;
  worldTurn: number;
  committedAt: string;
  preview: string;
  name?: string;
  status: PlayCheckpointStatus;
  restorable: boolean;
  retryable: boolean;
  canonical: false;
}

export interface PlayCheckpointRestoreResult {
  session: PlaySession;
  checkpoints: PlayCheckpointSummary[];
  restoredCheckpointId: string;
}

export interface PlayCheckpointRenameResult {
  session: PlaySession;
  checkpoints: PlayCheckpointSummary[];
  renamedCheckpointId: string;
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

export interface PlayTurnRetryStreamMetadata {
  sourceArtifactId: string;
  parentArtifactId?: string;
}

export type PlayTurnStreamEvent =
  | (PlayTurnStreamEventBase & {
      type: 'play.turn.started';
      baseRevision: number;
      expectedArtifactId: string;
      retry?: PlayTurnRetryStreamMetadata;
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
    originalHash?: string;
    draftHash?: string;
    targetExisted?: boolean;
  }>;
}

export interface PlayAdoptionPreviewResult {
  preview: PlayAdoptionPreview;
}

export interface PlayAdoptionSessionUpdate {
  sessionId: string;
  baseRevision: number;
  revision: number;
}

export interface PlayAdoptionPendingActionReceipt {
  id: string;
  title: string;
  description: string;
  touchedFiles: string[];
  diff: string;
  createdAt: string;
  status: 'pending';
}

export interface PlayAdoptionPendingActionResult {
  sessionUpdate: PlayAdoptionSessionUpdate;
  candidate: PlayAdoptionCandidate;
  pendingAction: PlayAdoptionPendingActionReceipt;
  refresh: WorkspaceDecisionRefresh;
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

export interface OanClient extends PlayRehearsalClientMethods {
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
  previewPlayLaunchPackage(
    input: PlayLaunchPackagePreviewInput,
  ): Promise<PlayLaunchPackagePreviewResult>;
  createPlayLaunchPackage(
    launchPackage: PlayLaunchPackage,
  ): Promise<PlayLaunchPackageCreateResult>;
  getPlayLaunchPackage(id: string): Promise<PlayLaunchPackageReadResult>;
  startPlaySessionFromLaunchPackage(
    input: StartPlaySessionFromLaunchPackageInput,
  ): Promise<{ session: PlaySession; files: string[] }>;
  listPlaySessions(): Promise<{ sessions: PlaySession[] }>;
  createPlaySession(input: {
    id?: string;
    title: string;
    sceneStart: string;
    userPersona?: string;
    characters?: string[];
    activatedSources?: PlayActivatedSource[];
    eventPolicy?: Partial<PlayEventPolicy>;
    worldMomentum?: PlayWorldMomentum;
  } | CreatePlaySceneRehearsalSessionInput): Promise<{
    session: PlaySession;
    files: string[];
  }>;
  getPlaySession(id: string): Promise<{ session: PlaySession }>;
  generatePlayOutcomeReport(id: string, input: {
    baseRevision: number;
    projection?: PlayOutcomeProjection;
  }): Promise<PlayOutcomeReportGenerateResult>;
  getPlayOutcomeReport(id: string, input: {
    baseRevision: number;
    projection?: PlayOutcomeProjection;
  }): Promise<PlayOutcomeReportResult>;
  createPlayOutcomeAdoptionCandidate(
    id: string,
    itemId: string,
    input: {
      baseRevision: number;
      target: PlayAdoptionTarget;
      payload?: Record<string, unknown>;
    },
  ): Promise<{
    session: PlaySession;
    observation: PlayObservation;
    candidate: PlayAdoptionCandidate;
  }>;
  createPlayWritingReferenceAttachment(
    input: CreatePlayWritingReferenceAttachmentInput,
  ): Promise<{ attachment: PlayWritingReferenceAttachment; files: string[] }>;
  listPlayWritingReferenceAttachments(): Promise<{
    attachments: PlayWritingReferenceAttachment[];
  }>;
  detachPlayWritingReferenceAttachment(id: string): Promise<{
    attachment: PlayWritingReferenceAttachment;
  }>;
  listPlayCheckpoints(id: string): Promise<{ checkpoints: PlayCheckpointSummary[] }>;
  restorePlayCheckpoint(
    id: string,
    checkpointId: string,
    input: { baseRevision: number },
  ): Promise<PlayCheckpointRestoreResult>;
  renamePlayCheckpoint(
    id: string,
    checkpointId: string,
    input: { baseRevision: number; name: string },
  ): Promise<PlayCheckpointRenameResult>;
  runPlayWorldRefereeTurn(id: string, input: {
    userText: string;
    actionKind?: PlayActionKind;
    baseRevision?: number;
    timeAdvance?: PlayRelativeTimeAdvance;
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
      timeAdvance?: PlayRelativeTimeAdvance;
    },
    options?: PlayTurnStreamOptions,
  ): AsyncIterable<PlayTurnStreamEvent>;
  retryPlayWorldRefereeTurn(
    id: string,
    artifactId: string,
    input: { baseRevision: number },
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
  createPlayAdoptionPreview(
    id: string,
    input: CreatePlayAdoptionPreviewInput,
  ): Promise<PlayAdoptionPreviewResult>;
  createPlayAdoptionPendingAction(
    id: string,
    previewId: string,
    input: CreatePlayAdoptionPendingActionInput,
  ): Promise<PlayAdoptionPendingActionResult>;
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
  const playRehearsalClient = createPlayRehearsalClientMethods({
    fetcher,
    backendBaseUrl,
    requestJson,
    isRehearsalSession: (
      value,
      sessionId,
      revision,
    ): value is PlayRehearsalSessionV5 =>
      isPlaySessionEnvelope(value, sessionId, revision)
      && value.schemaVersion === 5,
  });

  return {
    ...playRehearsalClient,
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
    previewPlayLaunchPackage: async (input) => {
      const normalized = normalizePlayLaunchPackagePreviewRequest(input);
      const value = await requestJson<unknown>('/api/workspace/play-setups/preview', {
        method: 'POST',
        body: normalized,
      });
      return parsePlayLaunchPackagePreviewResponse(value, normalized);
    },
    createPlayLaunchPackage: async (launchPackage) => {
      const normalized = normalizePlayLaunchPackageCreateRequest(launchPackage);
      const value = await requestJson<unknown>('/api/workspace/play-setups', {
        method: 'POST',
        body: normalized,
      });
      return parsePlayLaunchPackageCreateResponse(value, normalized);
    },
    getPlayLaunchPackage: async (id) => {
      const setupId = assertPlayLaunchSafeId(id, 'setup id');
      const value = await requestJson<unknown>(
        `/api/workspace/play-setups/${encodeURIComponent(setupId)}`,
      );
      return parsePlayLaunchPackageReadResponse(value, setupId);
    },
    startPlaySessionFromLaunchPackage: async (input) => {
      const normalized = normalizePlayLaunchSessionStartRequest(input);
      const value = await requestJson<unknown>('/api/workspace/play-sessions', {
        method: 'POST',
        body: normalized,
      });
      return parsePlayLaunchSessionCreateResponse(value, normalized);
    },
    listPlaySessions: () =>
      requestJson<unknown>('/api/workspace/play-sessions')
        .then(parsePlaySessionListResponse),
    createPlaySession: (input) => {
      const normalized = normalizePlaySessionCreateRequest(input);
      return requestJson<unknown>('/api/workspace/play-sessions', {
        method: 'POST',
        body: normalized.body,
      }).then((value) => parsePlaySessionCreateResponse(
        value,
        normalized.requestedSessionId,
      ));
    },
    getPlaySession: (id) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}`,
      ).then((value) => parsePlaySessionResponse(value, id)),
    generatePlayOutcomeReport: (id, input) => {
      const normalized = normalizePlayOutcomeRequest(id, input);
      return requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(normalized.sessionId)}/reports/outcome`,
        { method: 'POST', body: normalized.body },
      ).then((value) => parsePlayOutcomeReportResponse(
        value,
        normalized.sessionId,
        normalized.body.projection,
        true,
      ));
    },
    getPlayOutcomeReport: (id, input) => {
      const normalized = normalizePlayOutcomeRequest(id, input);
      const query = new URLSearchParams({
        baseRevision: String(normalized.body.baseRevision),
        projection: normalized.body.projection,
      });
      return requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(normalized.sessionId)}/reports/outcome?${query.toString()}`,
      ).then((value) => parsePlayOutcomeReportResponse(
        value,
        normalized.sessionId,
        normalized.body.projection,
        false,
      ));
    },
    createPlayOutcomeAdoptionCandidate: (id, itemId, input) => {
      const sessionId = requireSafePlayClientId(id, 'Play session id');
      const outcomeItemId = requireSafePlayClientId(itemId, 'Play outcome item id');
      const body = normalizePlayOutcomeAdoptionRequest(input);
      return requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(sessionId)}/reports/outcome/items/${encodeURIComponent(outcomeItemId)}/adoption-candidate`,
        { method: 'POST', body },
      ).then((value) => parsePlayOutcomeAdoptionResponse(value, sessionId));
    },
    createPlayWritingReferenceAttachment: (input) => {
      const body = normalizeCreatePlayWritingReferenceRequest(input);
      return requestJson<unknown>('/api/workspace/writing-references', {
        method: 'POST',
        body,
      }).then(parsePlayWritingReferenceCreateResponse);
    },
    listPlayWritingReferenceAttachments: () =>
      requestJson<unknown>('/api/workspace/writing-references')
        .then(parsePlayWritingReferenceListResponse),
    detachPlayWritingReferenceAttachment: (id) => {
      const attachmentId = requireSafePlayClientId(
        id,
        'Play writing reference attachment id',
      );
      return requestJson<unknown>(
        `/api/workspace/writing-references/${encodeURIComponent(attachmentId)}/detach`,
        { method: 'POST', body: {} },
      ).then((value) => parsePlayWritingReferenceDetachResponse(value, attachmentId));
    },
    listPlayCheckpoints: (id) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/checkpoints`,
      ).then(parsePlayCheckpointListResponse),
    restorePlayCheckpoint: (id, checkpointId, input) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
        {
          method: 'POST',
          body: input,
        },
      ).then((value) => parsePlayCheckpointRestoreResponse(
        value,
        id,
        checkpointId,
      )),
    renamePlayCheckpoint: (id, checkpointId, input) =>
      requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/name`,
        {
          method: 'POST',
          body: input,
        },
      ).then((value) => parsePlayCheckpointRenameResponse(
        value,
        id,
        checkpointId,
        input,
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
    retryPlayWorldRefereeTurn: (id, artifactId, input, streamOptions) =>
      streamPlayWorldRefereeTurnWith(
        fetcher,
        backendBaseUrl,
        id,
        input,
        streamOptions,
        artifactId,
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
    createPlayAdoptionPreview: (id, input) => {
      const normalized = normalizePlayAdoptionPreviewRequest(id, input);
      return requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(normalized.sessionId)}/adoption-previews`,
        { method: 'POST', body: normalized.body },
      ).then((value) => parsePlayAdoptionPreviewResponse(value, normalized));
    },
    createPlayAdoptionPendingAction: (id, previewId, input) => {
      const normalized = normalizePlayAdoptionPendingActionRequest(
        id,
        previewId,
        input,
      );
      return requestJson<unknown>(
        `/api/workspace/play-sessions/${encodeURIComponent(normalized.sessionId)}/adoption-previews/${encodeURIComponent(normalized.previewId)}/pending-action`,
        { method: 'POST', body: normalized.body },
      ).then((value) => parsePlayAdoptionPendingActionResponse(value, normalized));
    },
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
    timeAdvance?: PlayRelativeTimeAdvance;
  } | { baseRevision: number },
  options: PlayTurnStreamOptions = {},
  retrySourceArtifactId?: string,
): AsyncIterable<PlayTurnStreamEvent> {
  const path = retrySourceArtifactId !== undefined
    ? `/api/workspace/play-sessions/${encodeURIComponent(id)}/turns/${encodeURIComponent(retrySourceArtifactId)}/retry/stream`
    : `/api/workspace/play-sessions/${encodeURIComponent(id)}/turns/stream`;
  const response = await fetcher(
    joinUrl(
      backendBaseUrl,
      path,
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
    throw createOanRequestError(
      response,
      data,
      'Play turn stream request failed.',
    );
  }
  if (!response.body) {
    throw new Error('Play turn stream returned no response body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamCompleted = false;
  let responseTurnId: string | undefined;
  let streamTurnId: string | undefined;
  let retryStartedEvent: Extract<
    PlayTurnStreamEvent,
    { type: 'play.turn.started' }
  > | undefined;
  let retryPreparedArtifactId: string | undefined;

  try {
    responseTurnId = response.headers.get('X-OAN-Play-Turn-Id') ?? undefined;
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
          streamTurnId = validatePlayTurnStreamRequestContext({
            event: parsed.event,
            expectedSessionId: id,
            responseTurnId,
            streamTurnId,
            retrySourceArtifactId,
            retryBaseRevision: 'baseRevision' in input ? input.baseRevision : undefined,
            retryStartedEvent,
            retryPreparedArtifactId,
          });
          if (parsed.event.type === 'play.turn.started') {
            retryStartedEvent = parsed.event;
          } else if (parsed.event.type === 'play.turn.prepared') {
            retryPreparedArtifactId = parsed.event.artifactId;
          }
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
        validatePlayTurnStreamRequestContext({
          event: parsed.event,
          expectedSessionId: id,
          responseTurnId,
          streamTurnId,
          retrySourceArtifactId,
          retryBaseRevision: 'baseRevision' in input ? input.baseRevision : undefined,
          retryStartedEvent,
          retryPreparedArtifactId,
        });
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

function validatePlayTurnStreamRequestContext(input: {
  event: PlayTurnStreamEvent;
  expectedSessionId: string;
  responseTurnId?: string;
  streamTurnId?: string;
  retrySourceArtifactId?: string;
  retryBaseRevision?: number;
  retryStartedEvent?: Extract<
    PlayTurnStreamEvent,
    { type: 'play.turn.started' }
  >;
  retryPreparedArtifactId?: string;
}): string {
  const { event } = input;
  if (event.sessionId !== input.expectedSessionId) {
    throw new Error('Play turn stream changed session identity.');
  }
  if (
    (input.responseTurnId && event.turnId !== input.responseTurnId) ||
    (input.streamTurnId && event.turnId !== input.streamTurnId)
  ) {
    throw new Error('Play turn stream changed turn identity.');
  }

  if (input.retrySourceArtifactId === undefined) {
    if (event.type === 'play.turn.started' && event.retry !== undefined) {
      throw new Error('Play turn stream returned unexpected retry metadata.');
    }
    return event.turnId;
  }

  if (event.type === 'play.turn.started') {
    if (
      input.retryStartedEvent ||
      event.baseRevision !== input.retryBaseRevision ||
      event.retry?.sourceArtifactId !== input.retrySourceArtifactId
    ) {
      throw new Error('Play turn retry stream returned inconsistent start metadata.');
    }
    return event.turnId;
  }
  if (!input.retryStartedEvent) {
    throw new Error('Play turn retry stream emitted data before its start event.');
  }
  if (
    event.type === 'play.turn.prepared' &&
    event.artifactId !== input.retryStartedEvent.expectedArtifactId
  ) {
    throw new Error('Play turn retry stream prepared an unexpected artifact.');
  }
  if (event.type === 'play.turn.committed') {
    assertConsistentPlayTurnRetryCommit({
      event,
      sourceArtifactId: input.retrySourceArtifactId,
      baseRevision: input.retryBaseRevision!,
      startedEvent: input.retryStartedEvent,
      preparedArtifactId: input.retryPreparedArtifactId,
    });
  }

  return event.turnId;
}

function assertConsistentPlayTurnRetryCommit(input: {
  event: Extract<PlayTurnStreamEvent, { type: 'play.turn.committed' }>;
  sourceArtifactId: string;
  baseRevision: number;
  startedEvent: Extract<PlayTurnStreamEvent, { type: 'play.turn.started' }>;
  preparedArtifactId?: string;
}): void {
  const committedArtifactId = input.event.artifactId;
  const session = input.event.session;
  const sourceArtifact = session.turnArtifacts.find((artifact) =>
    artifact.id === input.sourceArtifactId);
  const committedArtifact = committedArtifactId
    ? session.turnArtifacts.find((artifact) => artifact.id === committedArtifactId)
    : undefined;
  const sourcePath = sourceArtifact
    ? resolvePlayArtifactPath(sourceArtifact, session.turnArtifacts)
    : undefined;
  const expectedSelectedPath = sourcePath && committedArtifactId
    ? [...sourcePath.slice(0, -1), committedArtifactId]
    : undefined;

  if (
    !committedArtifactId ||
    !sourceArtifact ||
    !sourceArtifact.input ||
    sourceArtifact.artifactKind !== 'worldSettlement' ||
    !committedArtifact ||
    !committedArtifact.input ||
    committedArtifact.artifactKind !== 'worldSettlement' ||
    committedArtifactId === input.sourceArtifactId ||
    input.startedEvent.expectedArtifactId !== committedArtifactId ||
    input.preparedArtifactId !== committedArtifactId ||
    input.startedEvent.retry?.sourceArtifactId !== input.sourceArtifactId ||
    input.startedEvent.retry.parentArtifactId !== sourceArtifact.parentTurnId ||
    committedArtifact.parentTurnId !== sourceArtifact.parentTurnId ||
    !isDeepEqualJson(committedArtifact.input, sourceArtifact.input) ||
    committedArtifact.revision !== session.revision ||
    input.event.revision !== session.revision ||
    session.revision !== input.baseRevision + 1 ||
    !expectedSelectedPath ||
    !isDeepEqualJson(session.selectedTurnIds, expectedSelectedPath)
  ) {
    throw new Error('Play turn retry stream returned an inconsistent committed session.');
  }
}

function resolvePlayArtifactPath(
  artifact: PlayTurnArtifact,
  artifacts: PlayTurnArtifact[],
): string[] | undefined {
  const byId = new Map(artifacts.map((item) => [item.id, item]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current: PlayTurnArtifact | undefined = artifact;
  while (current) {
    if (seen.has(current.id)) {
      return undefined;
    }
    seen.add(current.id);
    path.push(current.id);
    current = current.parentTurnId ? byId.get(current.parentTurnId) : undefined;
  }
  return path.reverse();
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
  const hasOptionalArtifactId = value.artifactId === undefined || isSafePlayFactId(value.artifactId);

  switch (value.type) {
    case 'play.turn.started':
      return hasOnlyKnownFields(value, [
        'type',
        'eventId',
        'sequence',
        'sessionId',
        'turnId',
        'baseRevision',
        'expectedArtifactId',
        'retry',
      ])
        && isNonNegativeSafeInteger(value.baseRevision)
        && isSafePlayFactId(value.expectedArtifactId)
        && (value.retry === undefined || isPlayTurnRetryStreamMetadata(value.retry))
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
  checkpointId: string,
): PlayCheckpointRestoreResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['session', 'checkpoints', 'restoredCheckpointId']) ||
    value.restoredCheckpointId !== checkpointId ||
    !isSafePlayCheckpointId(value.restoredCheckpointId) ||
    !isPlaySessionEnvelope(value.session, sessionId) ||
    !isPlayCheckpointSummaryList(value.checkpoints)
  ) {
    throw new Error('Play checkpoint restore returned an invalid payload.');
  }

  const session = value.session;
  const checkpoints = value.checkpoints;
  const restored = checkpoints.find((checkpoint) =>
    checkpoint.checkpointId === checkpointId);
  const currentCheckpoints = checkpoints.filter((checkpoint) =>
    checkpoint.status === 'current');
  if (
    !restored ||
    restored.status !== 'current' ||
    restored.restorable ||
    currentCheckpoints.length !== 1 ||
    !isDeepEqualJson(session.selectedTurnIds, restored.selectedTurnIds) ||
    session.worldClock.turn !== restored.worldTurn ||
    !doesCheckpointMatchSession(restored, checkpoints, session) ||
    restored.revision >= session.revision
  ) {
    throw new Error('Play checkpoint restore returned an inconsistent payload.');
  }

  return value as unknown as PlayCheckpointRestoreResult;
}

function parsePlayCheckpointRenameResponse(
  value: unknown,
  sessionId: string,
  checkpointId: string,
  input: { baseRevision: number; name: string },
): PlayCheckpointRenameResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['session', 'checkpoints', 'renamedCheckpointId']) ||
    value.renamedCheckpointId !== checkpointId ||
    !isSafePlayCheckpointId(value.renamedCheckpointId) ||
    !isPlaySessionEnvelope(value.session, sessionId) ||
    !isPlayCheckpointSummaryList(value.checkpoints)
  ) {
    throw new Error('Play checkpoint name returned an invalid payload.');
  }

  const session = value.session;
  const checkpoints = value.checkpoints;
  const renamed = checkpoints.find((checkpoint) =>
    checkpoint.checkpointId === checkpointId);
  const current = checkpoints.find((checkpoint) => checkpoint.status === 'current');
  if (
    !renamed ||
    renamed.name !== input.name.trim() ||
    session.revision !== input.baseRevision + 1 ||
    !current ||
    !isDeepEqualJson(session.selectedTurnIds, current.selectedTurnIds) ||
    session.worldClock.turn !== current.worldTurn ||
    !doesCheckpointMatchSession(current, checkpoints, session)
  ) {
    throw new Error('Play checkpoint name returned an inconsistent payload.');
  }

  return value as unknown as PlayCheckpointRenameResult;
}

function isPlayCheckpointSummaryList(
  value: unknown,
): value is PlayCheckpointSummary[] {
  if (
    !Array.isArray(value) ||
    !value.every(isPlayCheckpointSummaryEnvelope) ||
    new Set(value.map((checkpoint) => checkpoint.checkpointId)).size !== value.length
  ) {
    return false;
  }

  const initialCheckpoints = value.filter((checkpoint) =>
    checkpoint.kind === 'initialWorld');
  if (initialCheckpoints.length > 1) {
    return false;
  }
  const hasInitialWorld = initialCheckpoints.length === 1;
  const checkpointsById = new Map(value.map((checkpoint) => [
    checkpoint.checkpointId,
    checkpoint,
  ]));
  const currentCheckpoints = value.filter((checkpoint) =>
    checkpoint.status === 'current');
  if (currentCheckpoints.length !== 1 || currentCheckpoints[0]!.restorable) {
    return false;
  }
  const current = currentCheckpoints[0]!;
  const currentPath = new Set(current.selectedTurnIds);

  return value.every((checkpoint) => {
    if (checkpoint.kind === 'initialWorld') {
      return checkpoint.status === (
        current.kind === 'initialWorld' ? 'current' : 'selectedAncestor'
      );
    }

    const expectedParent = checkpoint.selectedTurnIds.length > 1
      ? checkpoint.selectedTurnIds.at(-2)
      : hasInitialWorld
        ? PLAY_INITIAL_WORLD_CHECKPOINT_ID
        : undefined;
    const expectedStatus: PlayCheckpointStatus = checkpoint.checkpointId ===
      current.checkpointId
      ? 'current'
      : currentPath.has(checkpoint.checkpointId)
        ? 'selectedAncestor'
        : 'variant';
    return checkpoint.parentCheckpointId === expectedParent &&
      (expectedParent === undefined || checkpointsById.has(expectedParent)) &&
      checkpoint.depth === checkpoint.selectedTurnIds.length -
        (hasInitialWorld ? 0 : 1) &&
      checkpoint.status === expectedStatus;
  });
}

function isPlayCheckpointSummaryEnvelope(
  value: unknown,
): value is PlayCheckpointSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'checkpointId',
      'kind',
      'artifactId',
      'parentCheckpointId',
      'selectedTurnIds',
      'depth',
      'revision',
      'worldTurn',
      'committedAt',
      'preview',
      'name',
      'status',
      'restorable',
      'retryable',
      'canonical',
    ]) ||
    !isSafePlayCheckpointId(value.checkpointId) ||
    (value.kind !== 'initialWorld' && value.kind !== 'turn') ||
    (value.artifactId !== undefined && !isSafePlayFactId(value.artifactId)) ||
    (value.parentCheckpointId !== undefined &&
      !isSafePlayCheckpointId(value.parentCheckpointId)) ||
    !isUniqueSafePlayIdArray(value.selectedTurnIds) ||
    !isNonNegativeSafeInteger(value.depth) ||
    !isNonNegativeSafeInteger(value.revision) ||
    !isNonNegativeSafeInteger(value.worldTurn) ||
    !isNonEmptyString(value.committedAt) ||
    !isNonEmptyString(value.preview) ||
    (value.name !== undefined && !isValidPlayCheckpointName(value.name)) ||
    (
      value.status !== 'current' &&
      value.status !== 'selectedAncestor' &&
      value.status !== 'variant'
    ) ||
    typeof value.restorable !== 'boolean' ||
    typeof value.retryable !== 'boolean' ||
    value.canonical !== false
  ) {
    return false;
  }

  if (value.kind === 'initialWorld') {
    return value.checkpointId === PLAY_INITIAL_WORLD_CHECKPOINT_ID &&
      value.artifactId === undefined &&
      value.parentCheckpointId === undefined &&
      value.selectedTurnIds.length === 0 &&
      value.depth === 0 &&
      value.retryable === false &&
      value.status !== 'variant';
  }

  return value.artifactId === value.checkpointId &&
    value.selectedTurnIds.length > 0 &&
    value.selectedTurnIds.at(-1) === value.artifactId &&
    value.checkpointId !== PLAY_INITIAL_WORLD_CHECKPOINT_ID;
}

function doesCheckpointMatchSession(
  checkpoint: PlayCheckpointSummary,
  checkpoints: PlayCheckpointSummary[],
  session: PlaySession,
): boolean {
  if (checkpoint.kind === 'initialWorld') {
    return checkpoint.checkpointId === PLAY_INITIAL_WORLD_CHECKPOINT_ID &&
      session.selectedTurnIds.length === 0 &&
      checkpoint.revision === session.branchBaseSnapshot.worldClock.revision &&
      checkpoint.worldTurn === session.branchBaseSnapshot.worldClock.turn &&
      checkpoint.committedAt === session.createdAt;
  }

  const artifact = session.turnArtifacts.find((candidate) =>
    candidate.id === checkpoint.artifactId);
  if (!artifact || session.selectedTurnIds.at(-1) !== artifact.id) {
    return false;
  }
  const expectedParentCheckpointId = artifact.parentTurnId ?? (
    checkpoints.some((candidate) => candidate.kind === 'initialWorld')
      ? PLAY_INITIAL_WORLD_CHECKPOINT_ID
      : undefined
  );
  return checkpoint.revision === artifact.revision &&
    checkpoint.parentCheckpointId === expectedParentCheckpointId &&
    checkpoint.committedAt === artifact.committedAt;
}

function isSafePlayCheckpointId(value: unknown): value is string {
  return value === PLAY_INITIAL_WORLD_CHECKPOINT_ID || isSafePlayFactId(value);
}

function isValidPlayCheckpointName(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= 80 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
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

function normalizePlayOutcomeRequest(
  id: string,
  input: { baseRevision: number; projection?: PlayOutcomeProjection },
): {
  sessionId: string;
  body: { baseRevision: number; projection: PlayOutcomeProjection };
} {
  const sessionId = requireSafePlayClientId(id, 'Play session id');
  if (!isNonNegativeSafeInteger(input.baseRevision)) {
    throw new Error('Play outcome baseRevision must be a non-negative integer.');
  }
  if (
    input.projection !== undefined
    && input.projection !== 'player'
    && input.projection !== 'director'
  ) {
    throw new Error('Play outcome projection must be player or director.');
  }
  return {
    sessionId,
    body: {
      baseRevision: input.baseRevision,
      projection: input.projection ?? 'player',
    },
  };
}

interface NormalizedPlayAdoptionPreviewRequest {
  sessionId: string;
  body: CreatePlayAdoptionPreviewInput;
}

interface NormalizedPlayAdoptionPendingActionRequest {
  sessionId: string;
  previewId: string;
  body: CreatePlayAdoptionPendingActionInput;
}

function normalizePlayAdoptionPreviewRequest(
  id: string,
  input: CreatePlayAdoptionPreviewInput,
): NormalizedPlayAdoptionPreviewRequest {
  const sessionId = requireSafePlayClientId(id, 'Play session id');
  if (
    !isRecord(input)
    || !hasOnlyKnownFields(input, [
      'baseRevision',
      'projection',
      'seed',
      'target',
      'payload',
    ])
    || !isNonNegativeSafeInteger(input.baseRevision)
    || !isPlayAdoptionProjection(input.projection)
    || !isPlayAdoptionSeedEnvelope(input.seed)
    || (input.target !== undefined && !isPlayAdoptionTarget(input.target))
    || (input.payload !== undefined && !isStrictJsonRecord(input.payload))
  ) {
    throw new Error('Play adoption preview request is invalid.');
  }
  if (
    input.payload !== undefined
    && (
      input.target === undefined
      || !isPlayAdoptionPayloadForTarget(input.target, input.payload)
    )
  ) {
    throw new Error('Play adoption preview payload does not match its target.');
  }
  return {
    sessionId,
    body: structuredClone(input),
  };
}

function normalizePlayAdoptionPendingActionRequest(
  id: string,
  previewId: string,
  input: CreatePlayAdoptionPendingActionInput,
): NormalizedPlayAdoptionPendingActionRequest {
  const sessionId = requireSafePlayClientId(id, 'Play session id');
  if (!isPlayAdoptionPreviewId(previewId)) {
    throw new Error('Play adoption preview id is invalid.');
  }
  if (
    !isRecord(input)
    || !hasOnlyKnownFields(input, ['baseRevision', 'fingerprint'])
    || !isNonNegativeSafeInteger(input.baseRevision)
    || !isSha256Hex(input.fingerprint)
  ) {
    throw new Error('Play adoption PendingAction request is invalid.');
  }
  return {
    sessionId,
    previewId,
    body: structuredClone(input),
  };
}

function parsePlayAdoptionPreviewResponse(
  value: unknown,
  request: NormalizedPlayAdoptionPreviewRequest,
): PlayAdoptionPreviewResult {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, ['preview'])
    || !isPlayAdoptionPreviewEnvelope(value.preview, request)
  ) {
    throw new Error('Play adoption preview returned an invalid payload.');
  }
  return value as unknown as PlayAdoptionPreviewResult;
}

function isPlayAdoptionPreviewEnvelope(
  value: unknown,
  request: NormalizedPlayAdoptionPreviewRequest,
): value is PlayAdoptionPreview {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'sessionId',
      'baseRevision',
      'projection',
      'seed',
      'candidateId',
      'summary',
      'evidence',
      'visibility',
      'evidenceClosure',
      'evidenceFingerprint',
      'suggestions',
      'target',
      'payload',
      'touchedFiles',
      'diff',
      'fingerprint',
      'createdAt',
      'canonicalUnchanged',
    ])
    || value.schemaVersion !== 1
    || !isPlayAdoptionPreviewId(value.id)
    || value.sessionId !== request.sessionId
    || value.baseRevision !== request.body.baseRevision
    || value.projection !== request.body.projection
    || !isPlayAdoptionSeedEnvelope(value.seed)
    || !isDeepEqualJson(value.seed, request.body.seed)
    || !isSafePlayFactId(value.candidateId)
    || !isBoundedNonEmptyString(value.summary, 4_000)
    || !isBoundedNonEmptyString(value.evidence, 8_000)
    || !isPlayVisibility(value.visibility)
    || !isPlayAdoptionEvidenceClosureEnvelope(
      value.evidenceClosure,
      request.sessionId,
      request.body.baseRevision,
      request.body.projection,
    )
    || !isSha256Hex(value.evidenceFingerprint)
    || !isPlayAdoptionTargetSuggestionList(value.suggestions)
    || !isPlayAdoptionTarget(value.target)
    || !isPlayAdoptionPayloadForTarget(value.target, value.payload)
    || !isPlayAdoptionTouchedFiles(value.touchedFiles, value.target, value.payload)
    || !isPlayAdoptionDiff(value.diff, value.touchedFiles)
    || !isSha256Hex(value.fingerprint)
    || !isValidPlayTimestamp(value.createdAt)
    || value.canonicalUnchanged !== true
  ) {
    return false;
  }

  const selectedSuggestion = value.suggestions.find((suggestion) =>
    suggestion.target === value.target);
  const recommended = value.suggestions.find((suggestion) => suggestion.recommended);
  if (
    !selectedSuggestion
    || !recommended
    || (request.body.target !== undefined
      ? value.target !== request.body.target
      : value.target !== recommended.target)
    || (request.body.payload !== undefined
      ? !isDeepEqualJson(value.payload, request.body.payload)
      : !isDeepEqualJson(value.payload, selectedSuggestion.defaultPayload))
  ) {
    return false;
  }

  if (value.projection === 'player') {
    const closure = value.evidenceClosure;
    return value.visibility !== 'playerUnknown'
      && closure.selectedArtifactTurnRefs.length === 0
      && closure.artifactTurnRefs.length === 0
      && closure.messageRefs.length === 0
      && closure.eventRefs.length === 0
      && closure.observationRefs.length === 0
      && closure.evidenceRefs.length === 0
      && closure.sourceSnapshots.length === 0;
  }
  return true;
}

function isPlayAdoptionSeedEnvelope(value: unknown): value is PlayAdoptionSeed {
  if (!isRecord(value)) return false;
  if (value.kind === 'event') {
    return hasOnlyKnownFields(value, ['kind', 'eventId'])
      && isSafePlayFactId(value.eventId);
  }
  if (value.kind === 'observation') {
    return hasOnlyKnownFields(value, ['kind', 'observationId'])
      && isSafePlayFactId(value.observationId);
  }
  return value.kind === 'outcome'
    && hasOnlyKnownFields(value, [
      'kind',
      'outcomeItemId',
      'outcomeReportFingerprint',
    ])
    && isSafePlayFactId(value.outcomeItemId)
    && isSha256Hex(value.outcomeReportFingerprint);
}

function isPlayAdoptionEvidenceClosureEnvelope(
  value: unknown,
  sessionId?: string,
  sessionRevision?: number,
  projection?: PlayAdoptionProjection,
): value is PlayAdoptionEvidenceClosure {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'schemaVersion',
      'sessionId',
      'sessionRevision',
      'selectedArtifactTurnRefs',
      'artifactTurnRefs',
      'messageRefs',
      'eventRefs',
      'observationRefs',
      'evidenceRefs',
      'sourceSnapshots',
      'selectedPathFingerprint',
      'sourceBaseFingerprint',
    ])
    || value.schemaVersion !== 1
    || !isSafePlayFactId(value.sessionId)
    || (sessionId !== undefined && value.sessionId !== sessionId)
    || !isNonNegativeSafeInteger(value.sessionRevision)
    || (sessionRevision !== undefined && value.sessionRevision !== sessionRevision)
    || !isBoundedUniqueSafePlayIdArray(value.selectedArtifactTurnRefs, 512)
    || !isBoundedUniqueSafePlayIdArray(value.artifactTurnRefs, 24)
    || !isBoundedUniqueSafePlayIdArray(value.messageRefs, 24)
    || !isBoundedUniqueSafePlayIdArray(value.eventRefs, 24)
    || !isBoundedUniqueSafePlayIdArray(value.observationRefs, 24)
    || !isBoundedUniqueSafePlayIdArray(value.evidenceRefs, 24)
    || !Array.isArray(value.sourceSnapshots)
    || value.sourceSnapshots.length > 24
    || !value.sourceSnapshots.every(isPlayAdoptionSourceSnapshotEnvelope)
    || new Set(value.sourceSnapshots.map((source) => source.sourceId)).size
      !== value.sourceSnapshots.length
    || !isStableSourceSnapshotOrder(value.sourceSnapshots)
    || !isSha256Hex(value.selectedPathFingerprint)
    || !isSha256Hex(value.sourceBaseFingerprint)
  ) {
    return false;
  }
  const selected = new Set(value.selectedArtifactTurnRefs);
  if (value.artifactTurnRefs.some((ref) => !selected.has(ref))) return false;
  return projection !== 'player' || (
    value.selectedArtifactTurnRefs.length === 0
    && value.artifactTurnRefs.length === 0
    && value.messageRefs.length === 0
    && value.eventRefs.length === 0
    && value.observationRefs.length === 0
    && value.evidenceRefs.length === 0
    && value.sourceSnapshots.length === 0
  );
}

function isPlayAdoptionSourceSnapshotEnvelope(
  value: unknown,
): value is PlayAdoptionSourceSnapshot {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['sourceId', 'path', 'contentHash'])
    && isBoundedNonEmptyString(value.sourceId, 512)
    && value.sourceId === value.sourceId.trim()
    && (value.path === undefined
      || (isBoundedNonEmptyString(value.path, 1_000) && value.path === value.path.trim()))
    && (value.contentHash === undefined || isSha256Hex(value.contentHash));
}

function isStableSourceSnapshotOrder(
  value: readonly PlayAdoptionSourceSnapshot[],
): boolean {
  return value.every((source, index) =>
    index === 0 || value[index - 1]!.sourceId.localeCompare(source.sourceId) < 0);
}

function isPlayAdoptionTargetSuggestionList(
  value: unknown,
): value is PlayAdoptionTargetSuggestion[] {
  const targets = [
    'chapterDraft',
    'state',
    'timeline',
    'foreshadow',
  ] as const satisfies readonly PlayAdoptionTarget[];
  const tools: Record<PlayAdoptionTarget, PlayAdoptionWriteIntentToolName> = {
    chapterDraft: 'chapter.createDraft',
    state: 'state.set',
    timeline: 'timeline.add',
    foreshadow: 'foreshadow.create',
  };
  if (!Array.isArray(value) || value.length !== targets.length) return false;
  let recommended = 0;
  for (const [index, entry] of value.entries()) {
    const target = targets[index]!;
    if (
      !isRecord(entry)
      || !hasOnlyKnownFields(entry, [
        'target',
        'toolName',
        'recommended',
        'reason',
        'defaultPayload',
      ])
      || entry.target !== target
      || entry.toolName !== tools[target]
      || typeof entry.recommended !== 'boolean'
      || !isBoundedNonEmptyString(entry.reason, 1_000)
      || entry.reason !== entry.reason.trim()
      || !isPlayAdoptionPayloadForTarget(target, entry.defaultPayload)
    ) {
      return false;
    }
    if (entry.recommended) recommended += 1;
  }
  return recommended === 1;
}

function isPlayAdoptionPayloadForTarget(
  target: PlayAdoptionTarget,
  value: unknown,
): value is Record<string, unknown> {
  if (!isStrictJsonRecord(value)) return false;
  if (target === 'chapterDraft') {
    if (
      !hasOnlyKnownFields(value, ['chapterId', 'title', 'content', 'file', 'mode'])
      || typeof value.chapterId !== 'string'
      || !/^\d{4}\/\d{4}$/u.test(value.chapterId)
      || value.chapterId.endsWith('/0000')
      || typeof value.content !== 'string'
      || !value.content.trim()
      || (value.title !== undefined && typeof value.title !== 'string')
      || (value.mode !== undefined && value.mode !== 'create' && value.mode !== 'replace')
    ) {
      return false;
    }
    if (value.file !== undefined) {
      const expected = `${value.chapterId}.md`;
      if (value.file !== expected && value.file !== `chapters/${expected}`) return false;
    }
    return true;
  }
  if (target === 'state') {
    return hasOnlyKnownFields(value, ['file', 'path', 'value'])
      && isSafeWorkspaceRelativePath(value.file)
      && isNonEmptyTrimmedString(value.path)
      && Object.hasOwn(value, 'value')
      && isStrictJsonValue(value.value);
  }
  const valueField = target === 'timeline' ? 'event' : 'item';
  return hasOnlyKnownFields(value, ['file', 'path', valueField])
    && (value.file === undefined || isSafeWorkspaceRelativePath(value.file))
    && (value.path === undefined || isNonEmptyTrimmedString(value.path))
    && Object.hasOwn(value, valueField)
    && isStrictJsonValue(value[valueField]);
}

function isPlayAdoptionTouchedFiles(
  value: unknown,
  target: PlayAdoptionTarget,
  payload: Record<string, unknown>,
): value is string[] {
  if (
    !Array.isArray(value)
    || value.length !== 1
    || !isSafeWorkspaceRelativePath(value[0])
  ) {
    return false;
  }
  let expected: string;
  if (target === 'chapterDraft') {
    expected = `chapters/${String(payload.chapterId)}.md`;
  } else {
    const file = typeof payload.file === 'string'
      ? payload.file
      : target === 'timeline'
        ? 'events.yaml'
        : 'active.yaml';
    expected = `${target}/${file}`;
  }
  return value[0] === expected;
}

function isPlayAdoptionDiff(value: unknown, touchedFiles: string[]): value is string {
  if (typeof value !== 'string' || value.length > 8 * 1024 * 1024) return false;
  if (!value) return true;
  const headers = value.split('\n').filter((line) => line.startsWith('diff --git '));
  return headers.length === touchedFiles.length
    && touchedFiles.every((file) =>
      headers.includes(`diff --git a/${file} b/${file}`));
}

function isPlayAdoptionProjection(value: unknown): value is PlayAdoptionProjection {
  return value === 'player' || value === 'director';
}

function isPlayAdoptionPreviewId(value: unknown): value is string {
  return typeof value === 'string' && /^pa_[a-f0-9-]+$/u.test(value);
}

function isBoundedUniqueSafePlayIdArray(
  value: unknown,
  maximum: number,
): value is string[] {
  return isUniqueSafePlayIdArray(value) && value.length <= maximum;
}

function isSafeWorkspaceRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1_000
    && value === value.trim()
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every((segment) => segment.length > 0 && !segment.startsWith('.'));
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return isNonEmptyString(value) && value === value.trim();
}

function isStrictJsonRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null)
    && isStrictJsonValue(value);
}

function isStrictJsonValue(
  value: unknown,
  ancestors: Set<object> = new Set<object>(),
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? value.every((entry) => isStrictJsonValue(entry, ancestors))
      : Object.values(value as Record<string, unknown>)
        .every((entry) => isStrictJsonValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

function parsePlayAdoptionPendingActionResponse(
  value: unknown,
  request: NormalizedPlayAdoptionPendingActionRequest,
): PlayAdoptionPendingActionResult {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'sessionUpdate',
      'candidate',
      'pendingAction',
      'refresh',
    ])
    || !isPlayAdoptionSessionUpdateEnvelope(
      value.sessionUpdate,
      request.sessionId,
      request.body.baseRevision,
    )
    || !isPlayAdoptionCandidateEnvelope(value.candidate)
    || value.candidate.id !== `adoption-${request.previewId.slice(3)}`
    || !isPlayAdoptionPendingActionEnvelope(
      value.pendingAction,
      request.previewId,
      value.candidate,
    )
    || !isWorkspaceDecisionRefreshEnvelope(value.refresh)
  ) {
    throw new Error('Play adoption PendingAction returned an invalid payload.');
  }
  return value as unknown as PlayAdoptionPendingActionResult;
}

function isPlayAdoptionSessionUpdateEnvelope(
  value: unknown,
  sessionId: string,
  baseRevision: number,
): value is PlayAdoptionSessionUpdate {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['sessionId', 'baseRevision', 'revision'])
    && value.sessionId === sessionId
    && value.baseRevision === baseRevision
    && value.revision === baseRevision + 1;
}

function isPlayAdoptionPendingActionEnvelope(
  value: unknown,
  previewId: string,
  candidate: PlayAdoptionCandidate,
): value is PlayAdoptionPendingActionReceipt {
  const touchedFiles = isRecord(value) ? value.touchedFiles : undefined;
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'id',
      'title',
      'description',
      'touchedFiles',
      'diff',
      'createdAt',
      'status',
    ])
    || value.id !== previewId
    || !isBoundedNonEmptyString(value.title, 1_000)
    || !isBoundedNonEmptyString(value.description, 4_000)
    || !candidate.payload
    || !isPlayAdoptionTouchedFiles(
      touchedFiles,
      candidate.target,
      candidate.payload,
    )
    || !isPlayAdoptionDiff(value.diff, touchedFiles)
    || !isValidPlayTimestamp(value.createdAt)
    || value.status !== 'pending'
  ) {
    return false;
  }
  return true;
}

function isWorkspaceDecisionRefreshEnvelope(
  value: unknown,
): value is WorkspaceDecisionRefresh {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, ['workspaceStatus', 'projectHealth'])
    || !isWorkspaceStatusEnvelope(value.workspaceStatus)
    || !isProjectHealthEnvelope(value.projectHealth)
  ) {
    return false;
  }
  return value.workspaceStatus.pendingActionCount
    === value.projectHealth.pendingActionCount;
}

function isWorkspaceStatusEnvelope(value: unknown): value is WorkspaceStatus {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['pendingActionCount', 'git', 'gitConfig'])
    && isNonNegativeSafeInteger(value.pendingActionCount)
    && isGitWorkspaceStatusEnvelope(value.git)
    && isRecord(value.gitConfig)
    && hasOnlyKnownFields(value.gitConfig, ['autoCommitOnAccept'])
    && typeof value.gitConfig.autoCommitOnAccept === 'boolean';
}

function isGitWorkspaceStatusEnvelope(value: unknown): value is GitWorkspaceStatus {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'available',
      'source',
      'version',
      'repository',
      'branch',
      'head',
      'status',
      'dirty',
      'files',
      'error',
    ])
    || typeof value.available !== 'boolean'
    || value.source !== 'global'
    || (value.version !== undefined && typeof value.version !== 'string')
    || typeof value.repository !== 'boolean'
    || (value.branch !== undefined && typeof value.branch !== 'string')
    || (value.head !== undefined && typeof value.head !== 'string')
    || (value.status !== 'clean' && value.status !== 'dirty' && value.status !== 'unknown')
    || (value.dirty !== null && typeof value.dirty !== 'boolean')
    || !Array.isArray(value.files)
    || !value.files.every(isGitFileStatusEnvelope)
    || (value.error !== undefined && !isGitCommandErrorEnvelope(value.error))
  ) {
    return false;
  }
  return value.status === 'clean'
    ? value.dirty === false
    : value.status === 'dirty'
      ? value.dirty === true
      : value.dirty === null;
}

function isGitFileStatusEnvelope(value: unknown): value is GitFileStatus {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['path', 'indexStatus', 'worktreeStatus', 'raw'])
    && isNonEmptyString(value.path)
    && typeof value.indexStatus === 'string'
    && typeof value.worktreeStatus === 'string'
    && typeof value.raw === 'string';
}

function isGitCommandErrorEnvelope(value: unknown): value is GitCommandError {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['code', 'message', 'stderr'])
    && (
      value.code === 'git_unavailable'
      || value.code === 'not_git_repository'
      || value.code === 'identity_missing'
      || value.code === 'remote_missing'
      || value.code === 'auth_failed'
      || value.code === 'conflict'
      || value.code === 'invalid_input'
      || value.code === 'git_failed'
    )
    && isNonEmptyString(value.message)
    && (value.stderr === undefined || typeof value.stderr === 'string');
}

function isProjectHealthEnvelope(value: unknown): value is ProjectHealth {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'generatedAt',
      'missingCharacterCards',
      'chaptersWithoutSummaries',
      'activeHookCount',
      'latestStateStale',
      'timelineGapCount',
      'pendingActionCount',
      'issues',
    ])
    && isValidPlayTimestamp(value.generatedAt)
    && isUniqueNonEmptyStringArray(value.missingCharacterCards)
    && isUniqueNonEmptyStringArray(value.chaptersWithoutSummaries)
    && isNonNegativeSafeInteger(value.activeHookCount)
    && typeof value.latestStateStale === 'boolean'
    && isNonNegativeSafeInteger(value.timelineGapCount)
    && isNonNegativeSafeInteger(value.pendingActionCount)
    && Array.isArray(value.issues)
    && value.issues.every(isProjectHealthIssueEnvelope)
    && new Set(value.issues.map((issue) => issue.id)).size === value.issues.length;
}

function isProjectHealthIssueEnvelope(value: unknown): value is ProjectHealthIssue {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['id', 'severity', 'title', 'detail', 'path'])
    && isBoundedNonEmptyString(value.id, 1_000)
    && (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error')
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.detail)
    && (value.path === undefined || typeof value.path === 'string');
}

function normalizePlayOutcomeAdoptionRequest(input: {
  baseRevision: number;
  target: PlayAdoptionTarget;
  payload?: Record<string, unknown>;
}): {
  baseRevision: number;
  target: PlayAdoptionTarget;
  payload?: Record<string, unknown>;
} {
  if (
    !isNonNegativeSafeInteger(input.baseRevision)
    || !isPlayAdoptionTarget(input.target)
    || (input.payload !== undefined && !isRecord(input.payload))
  ) {
    throw new Error('Play outcome adoption request is invalid.');
  }
  return structuredClone(input);
}

function isPlayAdoptionTarget(value: unknown): value is PlayAdoptionTarget {
  return value === 'chapterDraft'
    || value === 'state'
    || value === 'timeline'
    || value === 'foreshadow';
}

function isValidPlayTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && Number.isFinite(Date.parse(value));
}

function normalizeCreatePlayWritingReferenceRequest(
  input: CreatePlayWritingReferenceAttachmentInput,
): CreatePlayWritingReferenceAttachmentInput {
  if (
    !isSafePlayFactId(input.sessionId)
    || !isNonNegativeSafeInteger(input.baseRevision)
    || !isUniqueSafePlayIdArray(input.selectedOutcomeItemIds)
    || input.selectedOutcomeItemIds.length === 0
    || input.selectedOutcomeItemIds.length > 24
  ) {
    throw new Error('Play writing reference request is invalid.');
  }
  return structuredClone(input);
}

function requireSafePlayClientId(value: unknown, label: string): string {
  if (!isSafePlayFactId(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parsePlayOutcomeReportResponse(
  value: unknown,
  sessionId: string,
  projection: PlayOutcomeProjection,
  requireFiles: true,
): PlayOutcomeReportGenerateResult;
function parsePlayOutcomeReportResponse(
  value: unknown,
  sessionId: string,
  projection: PlayOutcomeProjection,
  requireFiles: false,
): PlayOutcomeReportResult;
function parsePlayOutcomeReportResponse(
  value: unknown,
  sessionId: string,
  projection: PlayOutcomeProjection,
  requireFiles: boolean,
): PlayOutcomeReportGenerateResult | PlayOutcomeReportResult {
  const expectedFields = requireFiles
    ? ['report', 'reportFingerprint', 'projection', 'status', 'staleReasons', 'files']
    : ['report', 'reportFingerprint', 'projection', 'status', 'staleReasons'];
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, expectedFields)
    || value.projection !== projection
    || (value.status !== 'current' && value.status !== 'stale')
    || !isPlayOutcomeReportEnvelope(value.report, sessionId, projection)
    || !isSha256Hex(value.reportFingerprint)
    || !isPlayOutcomeStaleReasonList(value.staleReasons, projection)
    || (value.status === 'current' && value.staleReasons.length !== 0)
    || (value.status === 'stale' && value.staleReasons.length === 0)
    || (requireFiles && (!isStringArray(value.files) || value.files.length !== 2))
  ) {
    throw new Error('Play outcome report returned an invalid payload.');
  }
  return value as unknown as PlayOutcomeReportGenerateResult | PlayOutcomeReportResult;
}

function isPlayOutcomeReportEnvelope(
  value: unknown,
  sessionId: string,
  projection: PlayOutcomeProjection,
): value is PlayOutcomeReport {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'schemaVersion',
      'sessionId',
      'sceneId',
      'createdAt',
      'sessionRevision',
      'selectedArtifactTurnRefs',
      'sourceSnapshots',
      'items',
    ])
    && value.schemaVersion === 1
    && value.sessionId === sessionId
    && (value.sceneId === undefined || isSafePlayFactId(value.sceneId))
    && isValidPlayTimestamp(value.createdAt)
    && isNonNegativeSafeInteger(value.sessionRevision)
    && isUniqueSafePlayIdArray(value.selectedArtifactTurnRefs)
    && Array.isArray(value.sourceSnapshots)
    && value.sourceSnapshots.every(isPlayOutcomeSourceSnapshotEnvelope)
    && new Set(value.sourceSnapshots.map((snapshot) => snapshot.sourceId)).size
      === value.sourceSnapshots.length
    && Array.isArray(value.items)
    && value.items.every((item) => isPlayOutcomeItemEnvelope(item, projection))
    && hasUniqueEntityIds(value.items)
    && (projection !== 'player' || (
      value.selectedArtifactTurnRefs.length === 0
      && value.sourceSnapshots.length === 0
      && value.items.every((item) =>
        item.visibility !== 'playerUnknown'
        && item.artifactTurnRefs.length === 0
        && item.messageRefs.length === 0
        && item.eventRefs.length === 0
        && item.observationRefs.length === 0
        && item.sourceRefs.length === 0
        && item.evidenceRefs.length === 0
        && item.participantRefs.length === 0)
    ));
}

function isPlayOutcomeSourceSnapshotEnvelope(
  value: unknown,
): value is PlayOutcomeSourceSnapshot {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['sourceId', 'path', 'contentHash'])
    && isBoundedNonEmptyString(value.sourceId, 512)
    && (value.path === undefined || isNonEmptyString(value.path))
    && (value.contentHash === undefined || /^[a-f0-9]{64}$/u.test(String(value.contentHash)));
}

function isPlayOutcomeItemEnvelope(
  value: unknown,
  projection: PlayOutcomeProjection,
): value is PlayOutcomeItem {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'id',
      'kind',
      'summary',
      'visibility',
      'confidence',
      'goalStatus',
      'tags',
      'artifactTurnRefs',
      'messageRefs',
      'eventRefs',
      'observationRefs',
      'evidenceRefs',
      'sourceRefs',
      'participantRefs',
    ])
    || !isSafePlayFactId(value.id)
    || !isPlayOutcomeItemKind(value.kind)
    || !isNonEmptyString(value.summary)
    || !isPlayVisibility(value.visibility)
    || !isPlayOutcomeConfidence(value.confidence)
    || !isPlayOutcomeTagList(value.tags)
    || !isUniqueSafePlayIdArray(value.artifactTurnRefs)
    || !isUniqueSafePlayIdArray(value.messageRefs)
    || !isUniqueSafePlayIdArray(value.eventRefs)
    || !isUniqueSafePlayIdArray(value.observationRefs)
    || !isUniqueSafePlayIdArray(value.evidenceRefs)
    || !isUniqueSafePlayIdArray(value.sourceRefs)
    || !isUniqueSafePlayIdArray(value.participantRefs)
    || (projection === 'director' && value.artifactTurnRefs.length === 0)
    || value.tags.length === 0
  ) {
    return false;
  }
  return value.kind === 'goalAssessment'
    ? isPlayOutcomeGoalStatus(value.goalStatus)
    : value.goalStatus === undefined;
}

function isPlayOutcomeItemKind(value: unknown): value is PlayOutcomeItemKind {
  return value === 'sceneSummary'
    || value === 'goalAssessment'
    || value === 'participantFootprint'
    || value === 'worldChange'
    || value === 'writingMaterial';
}

function isPlayOutcomeConfidence(value: unknown): value is PlayOutcomeConfidence {
  return value === 'confirmed' || value === 'inferred' || value === 'authorProvided';
}

function isPlayOutcomeGoalStatus(value: unknown): value is PlayOutcomeGoalStatus {
  return value === 'reached' || value === 'partial' || value === 'missed' || value === 'changed';
}

function isPlayOutcomeTagList(value: unknown): value is PlayOutcomeTag[] {
  return Array.isArray(value)
    && value.every((tag) =>
      tag === 'goal'
      || tag === 'divergence'
      || tag === 'consistency'
      || tag === 'worldChange'
      || tag === 'participantFootprint'
      || tag === 'writingMaterial')
    && new Set(value).size === value.length;
}

function isPlayOutcomeStaleReasonList(
  value: unknown,
  projection: PlayOutcomeProjection,
): value is PlayOutcomeReportStaleReason[] {
  return Array.isArray(value)
    && value.every((reason) =>
      reason === 'sessionRevisionChanged'
      || reason === 'selectedBranchChanged'
      || reason === 'sourceSnapshotChanged'
      || (projection === 'director' && typeof reason === 'string' && (
        reason.startsWith('sourceContentChanged:')
        || reason.startsWith('sourceUnavailable:')
      )))
    && new Set(value).size === value.length;
}

function parsePlayOutcomeAdoptionResponse(
  value: unknown,
  sessionId: string,
): {
  session: PlaySession;
  observation: PlayObservation;
  candidate: PlayAdoptionCandidate;
} {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, ['session', 'observation', 'candidate'])
    || !isPlaySessionEnvelope(value.session, sessionId)
    || !isPlayObservationEnvelope(value.observation)
    || !isPlayAdoptionCandidateEnvelope(value.candidate)
    || !value.candidate.sourceObservationIds.includes(value.observation.id)
    || !value.session.observations.some((item) =>
      isDeepEqualJson(item, value.observation))
    || !value.session.adoptionCandidates.some((item) =>
      isDeepEqualJson(item, value.candidate))
  ) {
    throw new Error('Play outcome adoption returned an invalid payload.');
  }
  return value as unknown as {
    session: PlaySession;
    observation: PlayObservation;
    candidate: PlayAdoptionCandidate;
  };
}

function parsePlayWritingReferenceCreateResponse(value: unknown): {
  attachment: PlayWritingReferenceAttachment;
  files: string[];
} {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, ['attachment', 'files'])
    || !isPlayWritingReferenceAttachmentEnvelope(value.attachment)
    || value.attachment.status !== 'active'
    || !isStringArray(value.files)
    || value.files.length !== 1
  ) {
    throw new Error('Play writing reference creation returned an invalid payload.');
  }
  return value as unknown as {
    attachment: PlayWritingReferenceAttachment;
    files: string[];
  };
}

function parsePlayWritingReferenceListResponse(value: unknown): {
  attachments: PlayWritingReferenceAttachment[];
} {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, ['attachments'])
    || !Array.isArray(value.attachments)
    || !value.attachments.every(isPlayWritingReferenceAttachmentEnvelope)
    || !hasUniqueEntityIds(value.attachments)
  ) {
    throw new Error('Play writing reference list returned an invalid payload.');
  }
  return value as unknown as { attachments: PlayWritingReferenceAttachment[] };
}

function parsePlayWritingReferenceDetachResponse(
  value: unknown,
  attachmentId: string,
): { attachment: PlayWritingReferenceAttachment } {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, ['attachment'])
    || !isPlayWritingReferenceAttachmentEnvelope(value.attachment)
    || value.attachment.id !== attachmentId
    || value.attachment.status !== 'detached'
    || value.attachment.detachedAt === undefined
  ) {
    throw new Error('Play writing reference detach returned an invalid payload.');
  }
  return value as unknown as { attachment: PlayWritingReferenceAttachment };
}

function isPlayWritingReferenceAttachmentEnvelope(
  value: unknown,
): value is PlayWritingReferenceAttachment {
  if (!isRecord(value)) return false;
  return hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'sessionId',
      'reportRef',
      'reportFingerprint',
      'selectedOutcomeItemRefs',
      'selectedArtifactTurnRefs',
      'evidenceClosureRefs',
      'sourceSnapshots',
      'status',
      'createdAt',
      'detachedAt',
    ])
    && value.schemaVersion === 1
    && isSafePlayFactId(value.id)
    && isSafePlayFactId(value.sessionId)
    && value.reportRef === `.workspace/play-sessions/${value.sessionId}/reports/outcome.yaml`
    && typeof value.reportFingerprint === 'string'
    && /^[a-f0-9]{64}$/u.test(value.reportFingerprint)
    && isUniqueSafePlayIdArray(value.selectedOutcomeItemRefs)
    && value.selectedOutcomeItemRefs.length > 0
    && value.selectedOutcomeItemRefs.length <= 24
    && isUniqueSafePlayIdArray(value.selectedArtifactTurnRefs)
    && isUniquePlayEvidenceClosureRefArray(value.evidenceClosureRefs)
    && value.evidenceClosureRefs.length > 0
    && Array.isArray(value.sourceSnapshots)
    && value.sourceSnapshots.every(isPlayOutcomeSourceSnapshotEnvelope)
    && new Set(value.sourceSnapshots.map((source) => source.sourceId)).size
      === value.sourceSnapshots.length
    && (value.status === 'active' || value.status === 'detached' || value.status === 'stale')
    && isValidPlayTimestamp(value.createdAt)
    && (value.detachedAt === undefined || isValidPlayTimestamp(value.detachedAt))
    && (value.status === 'detached'
      ? value.detachedAt !== undefined
      : value.detachedAt === undefined);
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

function normalizePlaySessionCreateRequest(
  input: Parameters<OanClient['createPlaySession']>[0],
): {
  body: Parameters<OanClient['createPlaySession']>[0];
  requestedSessionId?: string;
} {
  const body = { ...input };
  const requestedSessionId = input.id?.trim();
  if (requestedSessionId) body.id = requestedSessionId;
  else delete body.id;
  return {
    body,
    ...(requestedSessionId ? { requestedSessionId } : {}),
  };
}

function normalizePlayLaunchPackagePreviewRequest(
  input: PlayLaunchPackagePreviewInput,
): PlayLaunchPackagePreviewInput {
  if (!isPlayLaunchPackagePreviewInput(input)) {
    throw new Error('Play launch preview request is invalid.');
  }
  return structuredClone(input);
}

function normalizePlayLaunchPackageCreateRequest(
  launchPackage: PlayLaunchPackage,
): PlayLaunchPackage {
  if (!isPlayLaunchPackageEnvelope(launchPackage)) {
    throw new Error('Play launch package create request is invalid.');
  }
  return structuredClone(launchPackage);
}

function normalizePlayLaunchSessionStartRequest(
  input: StartPlaySessionFromLaunchPackageInput,
): StartPlaySessionFromLaunchPackageInput {
  if (
    !isRecord(input) ||
    !hasOnlyKnownFields(input, ['launchPackageId', 'id']) ||
    !isPlayLaunchSafeId(input.launchPackageId) ||
    (input.id !== undefined && !isPlayLaunchSafeId(input.id))
  ) {
    throw new Error('Play launch session request is invalid.');
  }
  return structuredClone(input);
}

function parsePlayLaunchPackagePreviewResponse(
  value: unknown,
  input: PlayLaunchPackagePreviewInput,
): PlayLaunchPackagePreviewResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['launchPackage']) ||
    !isPlayLaunchPackageEnvelope(value.launchPackage) ||
    !doesPlayLaunchPreviewMatchRequest(value.launchPackage, input)
  ) {
    throw new Error('Play launch preview returned an invalid payload.');
  }
  return value as unknown as PlayLaunchPackagePreviewResult;
}

function parsePlayLaunchPackageCreateResponse(
  value: unknown,
  request: PlayLaunchPackage,
): PlayLaunchPackageCreateResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['launchPackage', 'files']) ||
    !isPlayLaunchPackageEnvelope(value.launchPackage) ||
    !isDeepEqualJson(value.launchPackage, request) ||
    !isStringArray(value.files) ||
    value.files.length !== 1 ||
    value.files[0] !== `.workspace/play-setups/${request.id}/setup.yaml`
  ) {
    throw new Error('Play launch package creation returned an invalid payload.');
  }
  return value as unknown as PlayLaunchPackageCreateResult;
}

function parsePlayLaunchPackageReadResponse(
  value: unknown,
  setupId: string,
): PlayLaunchPackageReadResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['launchPackage']) ||
    !isPlayLaunchPackageEnvelope(value.launchPackage) ||
    value.launchPackage.id !== setupId
  ) {
    throw new Error('Play launch package request returned an invalid payload.');
  }
  return value as unknown as PlayLaunchPackageReadResult;
}

function parsePlayLaunchSessionCreateResponse(
  value: unknown,
  request: StartPlaySessionFromLaunchPackageInput,
): { session: PlaySession; files: string[] } {
  const result = parsePlaySessionCreateResponse(value, request.id);
  if (!hasConsistentPlayLaunchSessionMetadata(
    result.session,
    request.launchPackageId,
  )) {
    throw new Error('Play launch session creation returned an invalid payload.');
  }
  return result;
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

function isPlayTurnRetryStreamMetadata(
  value: unknown,
): value is PlayTurnRetryStreamMetadata {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['sourceArtifactId', 'parentArtifactId'])
    && isSafePlayFactId(value.sourceArtifactId)
    && (
      value.parentArtifactId === undefined ||
      isSafePlayFactId(value.parentArtifactId)
    );
}

function isPlaySessionEnvelope(
  value: unknown,
  sessionId: unknown,
  revision?: number,
): value is PlaySession {
  if (!isRecord(value)) {
    return false;
  }
  if (value.schemaVersion === 5) {
    return isPlayRehearsalSessionEnvelope(
      value,
      sessionId,
      revision,
      isPlaySessionV4Envelope,
    ) && hasValidOptionalPlayLaunchSessionMetadata(
      value as unknown as PlaySession,
    );
  }
  return isPlaySessionV4Envelope(value, sessionId, revision) &&
    hasValidOptionalPlayLaunchSessionMetadata(value);
}

function isPlaySessionV4Envelope(
  value: unknown,
  sessionId: unknown,
  revision?: number,
): value is PlaySessionV4 {
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
    && value.turnArtifacts.every((artifact) => artifact.schemaVersion !== 3)
    && isUniqueSafePlayIdArray(value.selectedTurnIds)
    && isNonNegativeSafeInteger(value.branchSnapshotRequiredFromRevision)
    && isPlayBranchBaseSnapshotEnvelope(value.branchBaseSnapshot)
    && isRecord(value.metadataExtensions)
    && isRecord(value.playLocalState)
    && isPlayVisibilityMap(value.playLocalStateVisibility)
    && hasValidPlayReservedState(
      value.playLocalState,
      value.playLocalStateVisibility,
    )
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
    && hasConsistentPlaySessionFacts(value as unknown as PlaySessionV4);
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
  if (
    roots.length > 1 &&
    (
      session.branchBaseSnapshot.parentTurnId !== undefined ||
      roots.some((artifact) => artifact.schemaVersion !== 2)
    )
  ) {
    return false;
  }
  if (
    session.turnArtifacts.length > 0 &&
    session.selectedTurnIds.length === 0 &&
    (
      session.branchBaseSnapshot.parentTurnId !== undefined ||
      roots.some((artifact) => artifact.schemaVersion !== 2)
    )
  ) {
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
  if (
    artifact.revision <= predecessorClock.revision ||
    !hasValidPlayKnowledgeTransition(
      artifact,
      predecessorState,
      artifactsById,
      eventsById,
    )
  ) {
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
    expectedVisibility[key] = key === 'worldMomentum' ||
        key === PLAY_KNOWLEDGE_STATE_KEY
      ? 'playerUnknown'
      : settlementVisibility;
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
    (
      artifact.artifactKind === 'worldSettlement' &&
      artifact.input?.timeAdvance !== undefined &&
      artifactWorldClock.elapsed !== formatPlayRelativeTimeAdvance(
        artifact.input.timeAdvance,
      )
    ) ||
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

function hasValidPlayKnowledgeTransition(
  artifact: PlayTurnArtifact,
  predecessorState: Record<string, unknown>,
  artifactsById: Map<string, PlayTurnArtifact>,
  eventsById: Map<string, PlayWorldEvent>,
): boolean {
  const predecessorKnowledge = Object.hasOwn(
    predecessorState,
    PLAY_KNOWLEDGE_STATE_KEY,
  )
    ? predecessorState[PLAY_KNOWLEDGE_STATE_KEY]
    : { schemaVersion: 1, records: [] };
  if (!isPlayKnowledgeState(predecessorKnowledge)) {
    return false;
  }

  if (!Object.hasOwn(artifact.stateDelta, PLAY_KNOWLEDGE_STATE_KEY)) {
    return true;
  }
  const nextKnowledge = artifact.stateDelta[PLAY_KNOWLEDGE_STATE_KEY];
  if (
    artifact.artifactKind !== 'worldSettlement' ||
    !isPlayKnowledgeState(nextKnowledge) ||
    nextKnowledge.records.length <= predecessorKnowledge.records.length
  ) {
    return false;
  }

  const appendedRecords = nextKnowledge.records.slice(
    predecessorKnowledge.records.length,
  );
  if (
    appendedRecords.length > MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN ||
    !predecessorKnowledge.records.every((record, index) =>
      isDeepEqualJson(record, nextKnowledge.records[index]))
  ) {
    return false;
  }

  const refereeTurnId = artifact.messages[1]?.id;
  if (!refereeTurnId) {
    return false;
  }
  const projections = new Map<string, PlayKnowledgePlayerProjection>();
  for (const record of predecessorKnowledge.records) {
    projections.set(record.subjectEventId, record.playerProjection);
  }
  const changedSubjects = new Set<string>();
  const usedRevealEvents = new Set<string>();

  for (const [index, record] of appendedRecords.entries()) {
    const previousProjection = projections.get(record.subjectEventId) ??
      'playerUnknown';
    const subjectEvent = eventsById.get(record.subjectEventId);
    const subjectOwner = findPlayEventOwner(
      record.subjectEventId,
      artifactsById,
    );
    const matchingRevealEvents = artifact.eventIds
      .map((eventId) => eventsById.get(eventId))
      .filter((event): event is PlayWorldEvent =>
        event !== undefined &&
        event.kind === 'informationSpread' &&
        event.visibility === record.playerProjection &&
        event.cause.sourceEventIds?.includes(record.subjectEventId) === true);
    const revealEvent = matchingRevealEvents[0];

    if (
      record.id !== `knowledge-${artifact.revision}-${index + 1}` ||
      changedSubjects.has(record.subjectEventId) ||
      record.previousPlayerProjection !== previousProjection ||
      !subjectEvent ||
      subjectEvent.visibility !== 'playerUnknown' ||
      !subjectOwner ||
      subjectOwner.id === artifact.id ||
      !isPlayArtifactAncestorOrSelf(
        subjectOwner.id,
        artifact,
        artifactsById,
      ) ||
      matchingRevealEvents.length !== 1 ||
      !revealEvent ||
      usedRevealEvents.has(revealEvent.id) ||
      record.revealedAtTurnId !== refereeTurnId ||
      record.revealedByEventId !== revealEvent.id ||
      revealEvent.turnId !== refereeTurnId
    ) {
      return false;
    }

    changedSubjects.add(record.subjectEventId);
    usedRevealEvents.add(revealEvent.id);
    projections.set(record.subjectEventId, record.playerProjection);
  }

  return true;
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
    && hasValidPlayReservedState(
      value.playLocalState,
      value.playLocalStateVisibility,
    )
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

function isPlayTurnArtifactInput(
  value: unknown,
): value is NonNullable<PlayTurnArtifact['input']> {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['kind', 'raw', 'timeAdvance'])
    && isPlayActionKind(value.kind)
    && isNonEmptyString(value.raw)
    && (
      value.timeAdvance === undefined ||
      (value.kind === 'wait' && isPlayRelativeTimeAdvance(value.timeAdvance))
    );
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
      'rehearsalEvidenceRefs',
      'stateDelta',
      'suggestedActions',
      'committedAt',
      'canonical',
    ])
    && (
      value.schemaVersion === 1 ||
      value.schemaVersion === 2 ||
      value.schemaVersion === 3
    )
    && (value.artifactKind === undefined
      || value.artifactKind === 'worldSettlement'
      || value.artifactKind === 'transcriptAppend')
    && (value.branchSnapshotVersion === undefined || value.branchSnapshotVersion === 1)
    && isSafePlayFactId(value.id)
    && isNonNegativeSafeInteger(value.revision)
    && (value.parentTurnId === undefined || isSafePlayFactId(value.parentTurnId))
    && (value.input === undefined || (
      isPlayTurnArtifactInput(value.input)
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
    && (
      value.playLocalStateSnapshot === undefined ||
      hasValidPlayReservedState(
        value.playLocalStateSnapshot,
        value.playLocalStateVisibilitySnapshot,
      )
    )
    && ((value.schemaVersion !== 2 && value.schemaVersion !== 3) || (
      (value.artifactKind === 'worldSettlement'
        || value.artifactKind === 'transcriptAppend')
      && value.branchSnapshotVersion === 1
      && value.worldClock !== undefined
      && isRecord(value.playLocalStateSnapshot)
      && isPlayVisibilityMap(value.playLocalStateVisibilitySnapshot)
    ))
    && isUniqueSafePlayIdArray(value.observationIds)
    && (
      value.schemaVersion === 3
        ? value.artifactKind === 'worldSettlement'
          && isUniqueSafePlayIdArray(value.rehearsalEvidenceRefs)
          && value.rehearsalEvidenceRefs.length > 0
        : value.rehearsalEvidenceRefs === undefined
    )
    && isRecord(value.stateDelta)
    && hasValidPlayReservedStateDelta(value.stateDelta)
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

const PLAY_LAUNCH_SCENE_VALUE_FIELDS = [
  'location',
  'worldTime',
  'atmosphere',
  'trigger',
  'objective',
  'risk',
] as const;

function isPlayLaunchPackagePreviewInput(
  value: unknown,
): value is PlayLaunchPackagePreviewInput {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'createdAt',
      'title',
      'purpose',
      'startMode',
      'simulationMode',
      'density',
      'sources',
      'entryPoint',
      'identity',
      'participantRoles',
    ]) ||
    (value.id !== undefined && !isPlayLaunchSafeId(value.id)) ||
    (value.createdAt !== undefined && !isPlayLaunchText(value.createdAt, 128)) ||
    !isPlayLaunchText(value.title, 200) ||
    !isPlayLaunchPurpose(value.purpose) ||
    value.startMode !== 'guided' ||
    !isPlayLaunchSimulationMode(value.simulationMode) ||
    !isPlayLaunchDensity(value.density) ||
    !Array.isArray(value.sources) ||
    value.sources.length < 1 ||
    value.sources.length > 24 ||
    !value.sources.every(isPlayLaunchSourceInput) ||
    !hasUniquePlayLaunchValues(value.sources, 'sourceId') ||
    !hasUniquePlayLaunchValues(value.sources, 'path') ||
    !isPlayLaunchEntryPoint(value.entryPoint) ||
    !isPlayLaunchIdentity(value.identity) ||
    !isPlayLaunchParticipantList(value.participantRoles)
  ) return false;

  const sources = value.sources as PlayLaunchSourceInput[];
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const participants = value.participantRoles as PlayLaunchParticipantRoleInput[];
  return isPlayLaunchIdentityPurposePair(value.purpose, value.identity)
    && (value.purpose !== 'sceneRehearsal' || participants.length > 0)
    && hasKnownPlayLaunchSourceRefs(value.entryPoint, participants, sourceIds)
    && participants.every((participant) =>
      !participant.canonicalCharacterRef || participant.sourceRefs.some((sourceRef) => {
        const source = sources.find((item) => item.sourceId === sourceRef);
        return source?.role === 'character' &&
          derivePlayLaunchObjectId(source.path, source.role) ===
            participant.canonicalCharacterRef;
      }));
}

function isPlayLaunchPackageEnvelope(value: unknown): value is PlayLaunchPackage {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'createdAt',
      'title',
      'purpose',
      'startMode',
      'eventPolicy',
      'sourceBase',
      'entryPoint',
      'identity',
      'participantRoles',
      'diagnostics',
      'canonical',
    ]) ||
    value.schemaVersion !== 1 ||
    !isPlayLaunchSafeId(value.id) ||
    !isPlayLaunchText(value.createdAt, 128) ||
    !isPlayLaunchText(value.title, 200) ||
    !isPlayLaunchPurpose(value.purpose) ||
    value.startMode !== 'guided' ||
    !isRecord(value.eventPolicy) ||
    !hasOnlyKnownFields(value.eventPolicy, ['simulationMode', 'density']) ||
    !isPlayLaunchSimulationMode(value.eventPolicy.simulationMode) ||
    !isPlayLaunchDensity(value.eventPolicy.density) ||
    !isRecord(value.sourceBase) ||
    !hasOnlyKnownFields(value.sourceBase, ['activatedSources']) ||
    !Array.isArray(value.sourceBase.activatedSources) ||
    value.sourceBase.activatedSources.length < 1 ||
    value.sourceBase.activatedSources.length > 24 ||
    !value.sourceBase.activatedSources.every(isPlayLaunchSource) ||
    !hasUniquePlayLaunchValues(value.sourceBase.activatedSources, 'sourceId') ||
    !hasUniquePlayLaunchValues(value.sourceBase.activatedSources, 'path') ||
    !isPlayLaunchEntryPoint(value.entryPoint) ||
    !isPlayLaunchIdentity(value.identity) ||
    !isPlayLaunchParticipantList(value.participantRoles) ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > 128 ||
    !value.diagnostics.every(isPlayLaunchDiagnostic) ||
    !hasUniquePlayLaunchValues(value.diagnostics, 'id') ||
    !hasSortedPlayLaunchDiagnostics(value.diagnostics) ||
    value.canonical !== false
  ) return false;

  const sources = value.sourceBase.activatedSources as PlayLaunchSource[];
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const participants = value.participantRoles as PlayLaunchParticipantRoleInput[];
  const participantIds = new Set(participants.map((item) => item.participantRef));
  const diagnostics = value.diagnostics as PlayLaunchDiagnostic[];
  return isPlayLaunchIdentityPurposePair(value.purpose, value.identity)
    && (value.purpose !== 'sceneRehearsal' || participants.length > 0)
    && hasKnownPlayLaunchSourceRefs(value.entryPoint, participants, sourceIds)
    && participants.every((participant) =>
      !participant.canonicalCharacterRef || participant.sourceRefs.some((sourceRef) => {
        const source = sources.find((item) => item.sourceId === sourceRef);
        return source?.role === 'character' &&
          source.objectId === participant.canonicalCharacterRef;
      }))
    && diagnostics.every((diagnostic) =>
      (diagnostic.sourceId === undefined || sourceIds.has(diagnostic.sourceId)) &&
      (diagnostic.participantRef === undefined ||
        participantIds.has(diagnostic.participantRef)) &&
      (diagnostic.sourceId === undefined || diagnostic.path === undefined ||
        sources.find((source) => source.sourceId === diagnostic.sourceId)?.path ===
          diagnostic.path))
    && sources.every((source) => {
      if (source.status === 'ready') return true;
      return diagnostics.some((diagnostic) =>
        diagnostic.sourceId === source.sourceId &&
        diagnostic.severity === 'error' &&
        (source.status === 'missing'
          ? diagnostic.code === 'missingSource'
          : diagnostic.code === 'invalidSource' ||
            diagnostic.code === 'sourceTooLarge' ||
            diagnostic.code === 'binarySource'));
    });
}

function isPlayLaunchSourceInput(value: unknown): value is PlayLaunchSourceInput {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['sourceId', 'path', 'role', 'reason'])
    && isPlayLaunchSafeId(value.sourceId)
    && isPlayLaunchSourcePath(value.path)
    && isPlayLaunchSourceRole(value.role)
    && doesPlayLaunchPathMatchRole(value.path, value.role)
    && (value.reason === undefined || isPlayLaunchText(value.reason, 500));
}

function isPlayLaunchSource(value: unknown): value is PlayLaunchSource {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'sourceId',
      'path',
      'objectId',
      'role',
      'reason',
      'budgetLayer',
      'semanticBoundary',
      'trust',
      'status',
      'contentHash',
      'excerpt',
    ]) ||
    !isPlayLaunchSafeId(value.sourceId) ||
    !isPlayLaunchSourcePath(value.path) ||
    !isPlayLaunchSourceRole(value.role) ||
    !doesPlayLaunchPathMatchRole(value.path, value.role) ||
    !isPlayLaunchText(value.reason, 500) ||
    !isPlayLaunchBudgetLayer(value.budgetLayer) ||
    !isPlayLaunchSemanticBoundary(value.semanticBoundary) ||
    !isPlayLaunchSourceTrust(value.trust) ||
    !isPlayLaunchSourceStatus(value.status)
  ) return false;

  const expectedObjectId = derivePlayLaunchObjectId(value.path, value.role);
  if (
    value.objectId !== expectedObjectId ||
    (value.objectId !== undefined && !isPlayLaunchObjectId(value.objectId))
  ) return false;
  if (value.status === 'ready') {
    return isSha256Hex(value.contentHash) &&
      isPlayLaunchText(value.excerpt, 2_000);
  }
  return value.contentHash === undefined && value.excerpt === undefined;
}

function isPlayLaunchEntryPoint(
  value: unknown,
): value is PlayLaunchEntryPointInput {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'label',
      'opening',
      'sourceRefs',
      ...PLAY_LAUNCH_SCENE_VALUE_FIELDS,
    ]) ||
    !isPlayLaunchSafeId(value.id) ||
    !isPlayLaunchText(value.label, 200) ||
    !isPlayLaunchText(value.opening, 12_000) ||
    !isPlayLaunchRefList(value.sourceRefs, 24) ||
    value.sourceRefs.length === 0
  ) return false;
  return PLAY_LAUNCH_SCENE_VALUE_FIELDS.every((field) =>
    value[field] === undefined || isPlayLaunchSceneValue(value[field], field));
}

function isPlayLaunchSceneValue(
  value: unknown,
  label: string,
): value is PlayLaunchSceneValue {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['value', 'provenance']) ||
    !isPlayLaunchText(value.value, 2_000) ||
    !isRecord(value.provenance)
  ) return false;
  if (value.provenance.kind === 'sourceBacked') {
    return hasOnlyKnownFields(value.provenance, ['kind', 'sourceRefs']) &&
      isPlayLaunchRefList(value.provenance.sourceRefs, 24);
  }
  return value.provenance.kind === 'authorProvided' &&
    hasOnlyKnownFields(value.provenance, ['kind', 'providedAt']) &&
    isPlayLaunchText(value.provenance.providedAt, 128) &&
    label.length > 0;
}

function isPlayLaunchIdentity(value: unknown): value is PlayLaunchIdentityInput {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['kind', 'persona', 'directorPurpose']) ||
    (value.kind !== 'player' && value.kind !== 'director') ||
    (value.persona !== undefined && !isPlayLaunchText(value.persona, 2_000)) ||
    (value.directorPurpose !== undefined &&
      !isPlayLaunchText(value.directorPurpose, 2_000))
  ) return false;
  return value.kind !== 'director' || isPlayLaunchText(value.directorPurpose, 2_000);
}

function isPlayLaunchParticipantList(
  value: unknown,
): value is PlayLaunchParticipantRoleInput[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    !value.every(isPlayLaunchParticipant) ||
    !hasUniquePlayLaunchValues(value, 'participantRef')
  ) return false;
  const knowledgeIds = value.flatMap((participant) =>
    participant.initialKnowledge.map((knowledge) => knowledge.id));
  return new Set(knowledgeIds).size === knowledgeIds.length;
}

function isPlayLaunchParticipant(
  value: unknown,
): value is PlayLaunchParticipantRoleInput {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'participantRef',
      'displayName',
      'canonicalCharacterRef',
      'sourceRefs',
      'position',
      'currentGoal',
      'initialKnowledge',
    ])
    && isPlayLaunchSafeId(value.participantRef)
    && isPlayLaunchText(value.displayName, 200)
    && (value.canonicalCharacterRef === undefined ||
      isPlayLaunchSafeId(value.canonicalCharacterRef))
    && isPlayLaunchRefList(value.sourceRefs, 24)
    && (value.position === undefined || isPlayLaunchText(value.position, 1_000))
    && (value.currentGoal === undefined || isPlayLaunchText(value.currentGoal, 2_000))
    && Array.isArray(value.initialKnowledge)
    && value.initialKnowledge.length <= 32
    && value.initialKnowledge.every(isPlayLaunchKnowledgeBoundary);
}

function isPlayLaunchKnowledgeBoundary(
  value: unknown,
): value is PlayLaunchKnowledgeBoundaryInput {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['id', 'fact', 'visibility', 'sourceRefs'])
    && isPlayLaunchSafeId(value.id)
    && isPlayLaunchText(value.fact, 2_000)
    && isPlayVisibility(value.visibility)
    && isPlayLaunchRefList(value.sourceRefs, 24);
}

function isPlayLaunchDiagnostic(value: unknown): value is PlayLaunchDiagnostic {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'code',
      'severity',
      'message',
      'sourceId',
      'path',
      'participantRef',
      'expectedContentHash',
      'actualContentHash',
    ]) ||
    !isPlayLaunchSafeId(value.id) ||
    !isPlayLaunchDiagnosticCode(value.code) ||
    (value.severity !== 'warning' && value.severity !== 'error') ||
    !isPlayLaunchText(value.message, 1_000) ||
    (value.sourceId !== undefined && !isPlayLaunchSafeId(value.sourceId)) ||
    (value.path !== undefined && !isPlayLaunchSourcePath(value.path)) ||
    (value.participantRef !== undefined &&
      !isPlayLaunchSafeId(value.participantRef))
  ) return false;
  if (value.code === 'staleSource') {
    return isSha256Hex(value.expectedContentHash) &&
      isSha256Hex(value.actualContentHash) &&
      value.expectedContentHash !== value.actualContentHash;
  }
  return value.expectedContentHash === undefined &&
    value.actualContentHash === undefined;
}

function doesPlayLaunchPreviewMatchRequest(
  launchPackage: PlayLaunchPackage,
  input: PlayLaunchPackagePreviewInput,
): boolean {
  if (
    (input.id !== undefined && launchPackage.id !== input.id) ||
    (input.createdAt !== undefined && launchPackage.createdAt !== input.createdAt) ||
    launchPackage.title !== input.title ||
    launchPackage.purpose !== input.purpose ||
    launchPackage.startMode !== input.startMode ||
    launchPackage.eventPolicy.simulationMode !== input.simulationMode ||
    launchPackage.eventPolicy.density !== input.density ||
    !isDeepEqualJson(launchPackage.entryPoint, input.entryPoint) ||
    !isDeepEqualJson(launchPackage.identity, input.identity) ||
    !isDeepEqualJson(launchPackage.participantRoles, input.participantRoles) ||
    launchPackage.sourceBase.activatedSources.length !== input.sources.length
  ) return false;
  return launchPackage.sourceBase.activatedSources.every((source, index) => {
    const requested = input.sources[index];
    return requested !== undefined &&
      source.sourceId === requested.sourceId &&
      source.path === requested.path &&
      source.role === requested.role &&
      source.reason === (requested.reason ??
        `Guided Start ${requested.role} source`);
  });
}

function hasKnownPlayLaunchSourceRefs(
  entryPoint: PlayLaunchEntryPointInput,
  participants: PlayLaunchParticipantRoleInput[],
  sourceIds: Set<string>,
): boolean {
  const refs = [
    ...entryPoint.sourceRefs,
    ...PLAY_LAUNCH_SCENE_VALUE_FIELDS.flatMap((field) => {
      const sceneValue = entryPoint[field];
      return sceneValue?.provenance.kind === 'sourceBacked'
        ? sceneValue.provenance.sourceRefs
        : [];
    }),
    ...participants.flatMap((participant) => [
      ...participant.sourceRefs,
      ...participant.initialKnowledge.flatMap((knowledge) => knowledge.sourceRefs),
    ]),
  ];
  return refs.every((ref) => sourceIds.has(ref));
}

function hasSortedPlayLaunchDiagnostics(value: unknown[]): boolean {
  const diagnostics = value as PlayLaunchDiagnostic[];
  return diagnostics.every((diagnostic, index) => {
    const previous = diagnostics[index - 1];
    return previous === undefined ||
      previous.severity.localeCompare(diagnostic.severity) < 0 ||
      (previous.severity === diagnostic.severity &&
        previous.id.localeCompare(diagnostic.id) < 0);
  });
}

function hasUniquePlayLaunchValues(
  value: unknown[],
  field: string,
): boolean {
  const values = value.map((item) => isRecord(item) ? item[field] : undefined);
  return values.every((item): item is string => typeof item === 'string') &&
    new Set(values).size === values.length;
}

function isPlayLaunchRefList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) &&
    value.length <= maximum &&
    value.every(isPlayLaunchSafeId) &&
    new Set(value).size === value.length;
}

function isPlayLaunchIdentityPurposePair(
  purpose: PlaySessionPurpose,
  identity: PlayLaunchIdentityInput,
): boolean {
  return purpose === 'immersiveJourney'
    ? identity.kind === 'player'
    : identity.kind === 'director';
}

function isPlayLaunchPurpose(value: unknown): value is PlaySessionPurpose {
  return value === 'immersiveJourney' || value === 'sceneRehearsal';
}

function isPlayLaunchSimulationMode(value: unknown): value is PlaySimulationMode {
  return value === 'conversation' ||
    value === 'reactiveWorld' ||
    value === 'activeWorld';
}

function isPlayLaunchDensity(value: unknown): value is PlayEventDensity {
  return value === 'quiet' || value === 'balanced' || value === 'volatile';
}

function isPlayLaunchSourceRole(value: unknown): value is PlayLaunchSourceRole {
  return value === 'chapter' ||
    value === 'character' ||
    value === 'world' ||
    value === 'timeline' ||
    value === 'state' ||
    value === 'other';
}

function isPlayLaunchSourceStatus(value: unknown): value is PlayLaunchSourceStatus {
  return value === 'ready' || value === 'missing' || value === 'invalid';
}

function isPlayLaunchDiagnosticCode(
  value: unknown,
): value is PlayLaunchDiagnosticCode {
  return value === 'invalidSource' ||
    value === 'missingSource' ||
    value === 'staleSource' ||
    value === 'sourceTooLarge' ||
    value === 'binarySource' ||
    value === 'participantWithoutCharacterSource' ||
    value === 'participantCharacterMismatch';
}

function isPlayLaunchBudgetLayer(value: unknown): boolean {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}

function isPlayLaunchSemanticBoundary(value: unknown): boolean {
  return value === 'protected' || value === 'compressible' || value === 'excluded';
}

function isPlayLaunchSourceTrust(value: unknown): value is PlaySourceTrust {
  return value === 'canonical' ||
    value === 'interactionHint' ||
    value === 'playLocal' ||
    value === 'modelImprovisation';
}

function isPlayLaunchText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' &&
    value.trim() === value &&
    value.length >= 1 &&
    value.length <= maximum;
}

function isPlayLaunchSafeId(value: unknown): value is string {
  return isPlayLaunchText(value, 200) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
    !value.includes('..') &&
    !value.includes('/') &&
    !value.includes('\\');
}

function assertPlayLaunchSafeId(value: unknown, label: string): string {
  if (!isPlayLaunchSafeId(value)) {
    throw new Error(`Play launch ${label} is invalid.`);
  }
  return value;
}

function isPlayLaunchSourcePath(value: unknown): value is string {
  if (
    !isPlayLaunchText(value, 1_000) ||
    value.startsWith('/') ||
    /^[A-Za-z]:\//u.test(value) ||
    value.includes('\\')
  ) return false;
  return value.split('/').every((part) =>
    part.length > 0 && part !== '..' && !part.startsWith('.'));
}

function isPlayLaunchObjectId(value: unknown): value is string {
  return isPlayLaunchText(value, 300) &&
    !value.includes('\\') &&
    value.split('/').every((part) =>
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part) && part !== '..');
}

function doesPlayLaunchPathMatchRole(
  path: string,
  role: PlayLaunchSourceRole,
): boolean {
  const root = role === 'chapter'
    ? 'chapters'
    : role === 'character'
      ? 'characters'
      : role === 'world'
        ? 'world'
        : role === 'timeline'
          ? 'timeline'
          : role === 'state'
            ? 'state'
            : undefined;
  return root === undefined || path.split('/')[0] === root;
}

function derivePlayLaunchObjectId(
  path: string,
  role: PlayLaunchSourceRole,
): string | undefined {
  if (role === 'other') return undefined;
  const parts = path.split('/');
  const identityParts = role === 'character' ? parts.slice(1, 2) : parts.slice(1);
  if (!identityParts.length) return undefined;
  const last = identityParts.at(-1)!;
  const extensionIndex = last.lastIndexOf('.');
  identityParts[identityParts.length - 1] = extensionIndex > 0
    ? last.slice(0, extensionIndex)
    : last;
  const candidate = identityParts.join('/');
  return isPlayLaunchObjectId(candidate) ? candidate : undefined;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function hasValidOptionalPlayLaunchSessionMetadata(
  session: PlaySession,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(
    session.metadataExtensions,
    'playLaunch',
  )) return true;
  return hasConsistentPlayLaunchSessionMetadata(session);
}

function hasConsistentPlayLaunchSessionMetadata(
  session: PlaySession,
  expectedSetupId?: string,
): boolean {
  const metadata = session.metadataExtensions.playLaunch;
  if (
    !isRecord(metadata) ||
    !hasOnlyKnownFields(metadata, [
      'setupId',
      'setupSchemaVersion',
      'purpose',
      'startMode',
    ]) ||
    !isPlayLaunchSafeId(metadata.setupId) ||
    (expectedSetupId !== undefined && metadata.setupId !== expectedSetupId) ||
    metadata.setupSchemaVersion !== 1 ||
    !isPlayLaunchPurpose(metadata.purpose) ||
    metadata.startMode !== 'guided' ||
    (session.schemaVersion === 4 && metadata.purpose !== 'immersiveJourney') ||
    (session.schemaVersion === 5 && metadata.purpose !== 'sceneRehearsal')
  ) return false;

  const sourceIds = session.activatedSources.map((source) => source.sourceId);
  return sourceIds.length > 0 &&
    new Set(sourceIds).size === sourceIds.length &&
    session.activatedSources.every((source) =>
      isSha256Hex(source.contentHash) &&
      isPlayLaunchSourceRole(source.role) &&
      isPlayLaunchSourcePath(source.path));
}

function isPlayActivatedSourceEnvelope(value: unknown): value is PlayActivatedSource {
  if (!isRecord(value) || !hasOnlyKnownFields(value, [
    'sourceId',
    'path',
    'objectId',
    'contentHash',
    'role',
    'reason',
    'budgetLayer',
    'semanticBoundary',
    'trust',
  ])) return false;
  const guided = value.objectId !== undefined ||
    value.contentHash !== undefined ||
    value.role !== undefined;
  const guidedPath = typeof value.path === 'string' ? value.path : undefined;
  const guidedRole = isPlayLaunchSourceRole(value.role) ? value.role : undefined;
  const guidedIdentityValid = !guided || (
    isPlayLaunchSourcePath(guidedPath) &&
    guidedRole !== undefined &&
    isSha256Hex(value.contentHash) &&
    doesPlayLaunchPathMatchRole(guidedPath, guidedRole) &&
    value.objectId === derivePlayLaunchObjectId(guidedPath, guidedRole)
  );
  return isNonEmptyString(value.sourceId)
    && (!guided || isPlayLaunchSafeId(value.sourceId))
    && (value.path === undefined || isNonEmptyString(value.path))
    && (value.objectId === undefined || isPlayLaunchObjectId(value.objectId))
    && guidedIdentityValid
    && isNonEmptyString(value.sourceId)
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
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'id',
      'target',
      'summary',
      'evidence',
      'payload',
      'visibility',
      'sourceObservationIds',
      'sourceTurnIds',
      'sourceEventIds',
      'seed',
      'evidenceClosure',
      'evidenceFingerprint',
      'requiresPendingAction',
    ])
    || !isSafePlayFactId(value.id)
    || !isPlayAdoptionTarget(value.target)
    || !isNonEmptyString(value.summary)
    || !isNonEmptyString(value.evidence)
    || (value.payload !== undefined && !isStrictJsonRecord(value.payload))
    || !isPlayVisibility(value.visibility)
    || !isUniqueSafePlayIdArray(value.sourceObservationIds)
    || !isUniqueSafePlayIdArray(value.sourceTurnIds)
    || !isUniqueSafePlayIdArray(value.sourceEventIds)
    || value.requiresPendingAction !== true
  ) {
    return false;
  }
  const hasSeed = value.seed !== undefined;
  const hasClosure = value.evidenceClosure !== undefined;
  const hasFingerprint = value.evidenceFingerprint !== undefined;
  if (!(hasSeed || hasClosure || hasFingerprint)) return true;
  return hasSeed
    && hasClosure
    && hasFingerprint
    && isPlayAdoptionSeedEnvelope(value.seed)
    && isPlayAdoptionEvidenceClosureEnvelope(value.evidenceClosure)
    && isSha256Hex(value.evidenceFingerprint)
    && isDeepEqualJson(
      value.sourceObservationIds,
      value.evidenceClosure.observationRefs,
    )
    && isDeepEqualJson(value.sourceTurnIds, value.evidenceClosure.messageRefs)
    && isDeepEqualJson(value.sourceEventIds, value.evidenceClosure.eventRefs);
}

function isPlayVisibilityMap(value: unknown): value is Record<string, PlayEventVisibility> {
  return isRecord(value) && Object.values(value).every(isPlayVisibility);
}

function isPlayVisibility(value: unknown): value is PlayEventVisibility {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

function isPlayRelativeTimeAdvance(
  value: unknown,
): value is PlayRelativeTimeAdvance {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['amount', 'unit']) ||
    !isPositiveSafeInteger(value.amount) ||
    (value.unit !== 'minute' && value.unit !== 'hour' && value.unit !== 'day')
  ) {
    return false;
  }

  const multiplier = value.unit === 'minute' ? 1 : value.unit === 'hour' ? 60 : 1_440;
  return value.amount * multiplier <= 525_600;
}

function formatPlayRelativeTimeAdvance(value: PlayRelativeTimeAdvance): string {
  if (value.unit === 'minute') return `PT${value.amount}M`;
  if (value.unit === 'hour') return `PT${value.amount}H`;
  return `P${value.amount}D`;
}

function hasValidPlayReservedState(
  state: Record<string, unknown>,
  visibility: unknown,
): boolean {
  return hasValidPlayWorldMomentumState(state, visibility) &&
    hasValidPlayKnowledgeState(state, visibility);
}

function hasValidPlayWorldMomentumState(
  state: Record<string, unknown>,
  visibility: unknown,
): boolean {
  const hasMomentum = Object.prototype.hasOwnProperty.call(state, 'worldMomentum');
  const visibilityHasMomentum = isRecord(visibility) &&
    Object.prototype.hasOwnProperty.call(visibility, 'worldMomentum');
  if (!hasMomentum) {
    return !visibilityHasMomentum;
  }

  return isPlayWorldMomentum(state.worldMomentum)
    && isRecord(visibility)
    && visibility.worldMomentum === 'playerUnknown';
}

function hasValidPlayKnowledgeState(
  state: Record<string, unknown>,
  visibility: unknown,
): boolean {
  const hasKnowledge = Object.hasOwn(state, PLAY_KNOWLEDGE_STATE_KEY);
  const visibilityHasKnowledge = isRecord(visibility) &&
    Object.hasOwn(visibility, PLAY_KNOWLEDGE_STATE_KEY);
  if (!hasKnowledge) {
    return !visibilityHasKnowledge;
  }

  return isPlayKnowledgeState(state[PLAY_KNOWLEDGE_STATE_KEY]) &&
    isRecord(visibility) &&
    visibility[PLAY_KNOWLEDGE_STATE_KEY] === 'playerUnknown';
}

function hasValidPlayReservedStateDelta(
  stateDelta: Record<string, unknown>,
): boolean {
  return (
    !Object.hasOwn(stateDelta, 'worldMomentum') ||
    isPlayWorldMomentum(stateDelta.worldMomentum)
  ) && (
    !Object.hasOwn(stateDelta, PLAY_KNOWLEDGE_STATE_KEY) ||
    isPlayKnowledgeState(stateDelta[PLAY_KNOWLEDGE_STATE_KEY])
  );
}

function isPlayKnowledgeState(value: unknown): value is PlayKnowledgeState {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['schemaVersion', 'records']) ||
    value.schemaVersion !== PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION ||
    !Array.isArray(value.records) ||
    value.records.length > MAX_PLAY_KNOWLEDGE_RECORDS ||
    !value.records.every(isPlayEventRevealRecord)
  ) {
    return false;
  }

  const recordIds = new Set<string>();
  const revealEventIds = new Set<string>();
  const projections = new Map<string, PlayKnowledgePlayerProjection>();
  const subjectCounts = new Map<string, number>();
  let previousRevision = -1;
  let previousLocalIndex = 0;

  for (const record of value.records) {
    const idMatch = /^knowledge-(0|[1-9][0-9]*)-([1-9][0-9]*)$/u.exec(
      record.id,
    );
    if (!idMatch) {
      return false;
    }
    const revision = Number(idMatch[1]);
    const localIndex = Number(idMatch[2]);
    const previousProjection = projections.get(record.subjectEventId) ??
      'playerUnknown';
    const subjectCount = subjectCounts.get(record.subjectEventId) ?? 0;
    if (
      !Number.isSafeInteger(revision) ||
      !Number.isSafeInteger(localIndex) ||
      revision < previousRevision ||
      (revision === previousRevision
        ? localIndex !== previousLocalIndex + 1
        : localIndex !== 1) ||
      recordIds.has(record.id) ||
      revealEventIds.has(record.revealedByEventId) ||
      subjectCount >= 2 ||
      record.previousPlayerProjection !== previousProjection
    ) {
      return false;
    }
    recordIds.add(record.id);
    revealEventIds.add(record.revealedByEventId);
    projections.set(record.subjectEventId, record.playerProjection);
    subjectCounts.set(record.subjectEventId, subjectCount + 1);
    previousRevision = revision;
    previousLocalIndex = localIndex;
  }
  return true;
}

function isPlayEventRevealRecord(
  value: unknown,
): value is PlayEventRevealRecord {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'id',
      'kind',
      'subjectEventId',
      'previousPlayerProjection',
      'playerProjection',
      'knownByParticipantRefs',
      'revealedAtTurnId',
      'revealedByEventId',
      'canonical',
    ])
    && isSafePlayFactId(value.id)
    && value.kind === 'eventReveal'
    && isSafePlayFactId(value.subjectEventId)
    && (value.previousPlayerProjection === 'playerUnknown'
      || value.previousPlayerProjection === 'rumor')
    && (value.playerProjection === 'rumor'
      || value.playerProjection === 'playerVisible')
    && !(value.previousPlayerProjection === 'rumor'
      && value.playerProjection === 'rumor')
    && Array.isArray(value.knownByParticipantRefs)
    && value.knownByParticipantRefs.length === 0
    && isSafePlayFactId(value.revealedAtTurnId)
    && isSafePlayFactId(value.revealedByEventId)
    && value.canonical === false;
}

function isPlayWorldMomentum(value: unknown): value is PlayWorldMomentum {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['pressures', 'agendas'])
    && Array.isArray(value.pressures)
    && value.pressures.length <= 24
    && value.pressures.every(isPlayPressureEnvelope)
    && hasUniqueMomentumIds(value.pressures)
    && Array.isArray(value.agendas)
    && value.agendas.length <= 24
    && value.agendas.every(isPlayAgendaEnvelope)
    && hasUniqueMomentumIds(value.agendas);
}

function isPlayPressureEnvelope(value: unknown): value is PlayPressure {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'kind',
      'label',
      'status',
      'level',
      'threshold',
      'causeRefs',
      'nextConsequence',
      'visibility',
    ]) ||
    !isSafePlayMomentumId(value.id) ||
    (value.kind !== 'deadline' &&
      value.kind !== 'pursuit' &&
      value.kind !== 'factionProject' &&
      value.kind !== 'environment' &&
      value.kind !== 'rumor' &&
      value.kind !== 'relationship') ||
    !isPlayMomentumText(value.label) ||
    (value.status !== 'latent' && value.status !== 'active' && value.status !== 'resolved') ||
    !Array.isArray(value.causeRefs) ||
    value.causeRefs.length > 24 ||
    !value.causeRefs.every(isSafePlayMomentumId) ||
    new Set(value.causeRefs).size !== value.causeRefs.length ||
    (value.nextConsequence !== undefined && !isPlayMomentumText(value.nextConsequence)) ||
    !isPlayVisibility(value.visibility)
  ) {
    return false;
  }

  const hasLevel = value.level !== undefined;
  const hasThreshold = value.threshold !== undefined;
  return hasLevel === hasThreshold
    && (!hasLevel || (
      isNonNegativeSafeInteger(value.level)
      && isPositiveSafeInteger(value.threshold)
      && value.level <= value.threshold
    ));
}

function isPlayAgendaEnvelope(value: unknown): value is PlayAgenda {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'id',
      'ownerEntityId',
      'goal',
      'nextMove',
      'blockers',
      'status',
      'visibility',
      'updatedAtTurnId',
    ])
    && isSafePlayMomentumId(value.id)
    && isPlayMomentumText(value.ownerEntityId)
    && isPlayMomentumText(value.goal)
    && (value.nextMove === undefined || isPlayMomentumText(value.nextMove))
    && isUniquePlayMomentumTextArray(value.blockers, 12)
    && (value.status === 'active'
      || value.status === 'blocked'
      || value.status === 'completed'
      || value.status === 'abandoned')
    && isPlayVisibility(value.visibility)
    && isSafePlayMomentumId(value.updatedAtTurnId);
}

function isSafePlayMomentumId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    && !value.includes('..');
}

function isPlayMomentumText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length >= 1
    && value.trim().length <= 500;
}

function isUniquePlayMomentumTextArray(value: unknown, maximum: number): value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    !value.every(isPlayMomentumText)
  ) {
    return false;
  }
  const normalized = value.map((item) => item.trim());
  return new Set(normalized).size === normalized.length;
}

function hasUniqueMomentumIds(value: readonly unknown[]): boolean {
  const ids = value.map((item) => isRecord(item) ? item.id : undefined);
  return ids.every(isSafePlayMomentumId) && new Set(ids).size === ids.length;
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

function isBoundedNonEmptyString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maximumLength;
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

function isUniquePlayEvidenceClosureRefArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string'
      && /^(artifact|message|event|observation|evidence|source|participant):[A-Za-z0-9][A-Za-z0-9._-]*$/u
        .test(item)
      && !item.includes('..'))
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
    throw createOanRequestError(response, data);
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
