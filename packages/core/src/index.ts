// Workspace initialization & config
export {
  isEmptyDirectory,
  initWorkspace,
  resolveGlobalOanConfigDir,
  loadWorkspaceList,
  saveWorkspaceList,
  formatVolumeDirectoryName,
  formatChapterFileName,
  resolveChapterFilePath,
  resolveVolumeMetadataFilePath,
  resolveNarrativeChapterFilePath,
  loadWorkspaceConfig,
  saveWorkspaceOnboarding,
} from './workspace.js';

export type {
  WorkspaceInitOptions,
  WorkspaceConfig,
  WorkspaceEntry,
  WorkspaceList,
  WorkspaceConfigData,
  WorkspaceOnboardingInput,
  WorkspaceOnboardingState,
  ChapterPathParts,
} from './workspace.js';

// Application Configuration
export {
  loadAppConfig,
  saveAppConfig,
  loadThemePreference,
  saveThemePreference,
} from './app-config.js';

export type {
  AppConfig,
  ThemePreference,
} from './app-config.js';

// LLM Provider Configuration
export {
  createEmptyLlmProviderConfigState,
  upsertLlmProviderConfig,
  removeLlmProviderConfig,
  getLlmProviderConfig,
  getDefaultLlmProviderConfig,
  setDefaultLlmProviderConfig,
  normalizeLlmProviderConfig,
  redactLlmProviderConfig,
} from './llm-provider.js';

export type {
  LlmProviderKind,
  LlmProviderModel,
  LlmProviderConfig,
  LlmProviderConfigState,
} from './llm-provider.js';

// Novel Copilot Skill
export {
  NOVEL_COPILOT_ALLOWED_TOOLS,
  NOVEL_COPILOT_CAPABILITIES,
  NOVEL_COPILOT_CAPABILITY_IDS,
  NOVEL_COPILOT_QUICK_COMMANDS,
  createDefaultNovelCopilotSkill,
  loadNovelCopilotSkill,
} from './novel-copilot-skill.js';

export type {
  LoadNovelCopilotSkillOptions,
  NovelCopilotCapability,
  NovelCopilotCapabilityId,
  NovelCopilotCapabilityMode,
  NovelCopilotCapabilityStatus,
  NovelCopilotQuickCommandId,
  NovelCopilotQuickCommand,
  NovelCopilotSkill,
} from './novel-copilot-skill.js';

// Agent Context Package
export {
  CONTEXT_SOURCE_IDS,
  addOmittedSource,
  addSelectedSource,
  createContextPackageDraft,
  deriveMinimalMemory,
  formatContextPackageSummary,
  resolveContextPackageArtifactPath,
  writeContextPackageArtifact,
} from './agent-context-package.js';

export type {
  ContextBudgetLayer,
  ContextPackage,
  ContextSourceId,
  ContextSourceRef,
  CreateContextPackageDraftInput,
  MinimalMemory,
  MinimalMemoryInput,
  RuleStackEntry,
  SemanticBoundary,
  WriteContextPackageArtifactInput,
} from './agent-context-package.js';

// Writing Planning
export {
  formatChapterContractMarkdown,
  formatPreWriteCheckMarkdown,
  formatVolumePlanningPacketMarkdown,
} from './writing-planning.js';

export type {
  ChapterContract,
  ChapterContractCastEntry,
  ChapterContractHook,
  ChapterPlanningPacket,
  HookPlanOperation,
  OutlinePlanningPacket,
  PlanningGranularity,
  PlanningPacket,
  PreWriteCheck,
  PreWriteRiskScan,
  VolumePlanningPacket,
} from './writing-planning.js';

// Writing Review
export {
  DE_AI_PROTECTION_RULES,
  REVIEW_DIMENSIONS,
  formatDeAiProtectionRulesMarkdown,
  formatReviewReportMarkdown,
} from './writing-review.js';

export type {
  ReviewCategory,
  ReviewDimensionResult,
  ReviewDimensionStatus,
  ReviewFinding,
  ReviewSeverity,
} from './writing-review.js';

// Writing Settlement
export {
  SETTLEMENT_HOOK_OPERATIONS,
  formatObservationLogMarkdown,
  formatSettlementBundleMarkdown,
} from './writing-settlement.js';

export type {
  EvidenceConfidence,
  ObservationCategory,
  ObservationEntry,
  ObservationLog,
  SettlementBundle,
  SettlementCharacterUpdate,
  SettlementForeshadowChange,
  SettlementHookOperation,
  SettlementPatchProposal,
  SettlementStateChange,
  SettlementTimelineEvent,
} from './writing-settlement.js';

// Session Artifacts
export {
  SESSION_ARTIFACT_FILES,
  checkSessionResumeBoundary,
  createSessionResumeBoundary,
  formatAuthorReportMarkdown,
  resolveSessionArtifactPath,
  writeAgentSessionArtifact,
  writeSessionOutputs,
  writeSessionProposedPatches,
  writeSessionRunMetadata,
  writeSessionUnresolved,
} from './session-artifacts.js';

export type {
  AgentSessionArtifact,
  AuthorReport,
  SessionArtifactFile,
  SessionInputSource,
  SessionOutputArtifact,
  SessionProposedPatch,
  SessionResumeBoundary,
  SessionResumeCheck,
  SessionResumeFileSnapshot,
  SessionRunMetadata,
  SessionRunStatus,
} from './session-artifacts.js';

// Projections And Project Health
export {
  PROJECTION_TARGETS,
  PROJECTION_WARNING,
  buildWorkspaceProjectionDocuments,
  writeWorkspaceProjections,
} from './projections.js';
export {
  formatProjectHealthMarkdown,
  readProjectHealth,
} from './project-health.js';
export type {
  ProjectionDocument,
  ProjectionTarget,
} from './projections.js';
export type {
  ProjectHealth,
  ProjectHealthIssue,
  ProjectHealthSeverity,
  ReadProjectHealthOptions,
} from './project-health.js';

// Play Mode And Tavern-Compatible Import
export {
  PLAY_SESSION_FILES,
  addPlayAdoptionCandidate,
  addPlayObservation,
  addPlayTranscriptTurn,
  createPlayAdoptionCandidate,
  createPlaySessionDraft,
  formatPlayWorldRefereePrompt,
  resolvePlaySessionPath,
  writePlaySessionFiles,
} from './play-session.js';
export {
  auditTavernCardSafety,
  createOanTavernImportPreview,
  extractTavernCardJsonFromPng,
  normalizeTavernCard,
  parseTavernCardInput,
} from './tavern-card.js';
export type {
  CreatePlaySessionInput,
  PlayActivatedSource,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayObservation,
  PlaySession,
  PlaySessionFile,
  PlaySourceTrust,
  PlayTranscriptTurn,
} from './play-session.js';
export type {
  CreateOanTavernImportPreviewOptions,
  NormalizedTavernCard,
  OanTavernImportPreview,
  TavernCardSpec,
  TavernDepthPrompt,
  TavernImportMode,
  TavernImportSafetyAudit,
} from './tavern-card.js';

// Reference Work Import And Deconstruction
export {
  importReferenceWork,
  listReferenceWorks,
  selectReferenceContext,
  setReferenceEnabled,
} from './reference-work.js';
export type {
  ReferenceAllowedUsage,
  ReferenceChapterBoundary,
  ReferenceContextSelection,
  ReferenceContextSelectionInput,
  ReferenceImportInput,
  ReferenceImportResult,
  ReferenceMetadata,
  ReferenceProgress,
  ReferenceProgressStage,
  ReferenceRights,
  ReferenceSourceManifest,
  ReferenceSourceType,
  ReferenceWorkSummary,
} from './reference-work.js';
