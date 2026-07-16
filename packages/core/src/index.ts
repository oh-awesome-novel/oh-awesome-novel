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
  loadComposerSubmitShortcutPreference,
  saveComposerSubmitShortcutPreference,
} from './app-config.js';

export type {
  AppConfig,
  ComposerSubmitShortcutPreference,
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
  ContextTraceEntry,
  ContextTraceOutcome,
  ContextTraceType,
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

// Evidence-backed Play adoption
export {
  MAX_PLAY_ADOPTION_EVIDENCE_REFS,
  MAX_PLAY_ADOPTION_SELECTED_PATH_REFS,
  MAX_PLAY_ADOPTION_SOURCE_SNAPSHOTS,
  PLAY_ADOPTION_EVIDENCE_SCHEMA_VERSION,
  PLAY_ADOPTION_TARGETS,
  createPlayAdoptionCandidateFromDraft,
  createPlayAdoptionSourceBase,
  fingerprintPlayAdoptionEvidenceClosure,
  normalizePlayAdoptionDraft,
  normalizePlayAdoptionEvidenceClosure,
  normalizePlayAdoptionSeed,
  projectPlayAdoptionCandidate,
  projectPlayAdoptionDraft,
  rebuildPlayAdoptionDraft,
  suggestPlayAdoptionTargets,
} from './play-adoption.js';
export type {
  CreatePlayAdoptionCandidateFromDraftInput,
  PlayAdoptionSourceBase,
  PlayAdoptionDraft,
  PlayAdoptionEvidenceClosure,
  PlayAdoptionSeed,
  PlayAdoptionSourceSnapshot,
  PlayAdoptionTargetSuggestion,
  PlayAdoptionWriteIntentToolName,
  RebuildPlayAdoptionDraftInput,
} from './play-adoption.js';

// Play branch-local knowledge and causal reveal
export {
  DEFAULT_PLAY_KNOWLEDGE_REVEAL_CANDIDATE_LIMIT,
  MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN,
  MAX_PLAY_KNOWLEDGE_RECORDS,
  MAX_PLAY_KNOWLEDGE_REVEAL_CANDIDATE_LIMIT,
  PLAY_KNOWLEDGE_STATE_KEY,
  PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION,
  applyPlayKnowledgeChanges,
  assertPlayKnowledgeHistory,
  assertPlayKnowledgeTransition,
  createEmptyPlayKnowledgeState,
  isPlayKnowledgeStateVisibility,
  listPlayKnowledgeRevealCandidates,
  normalizePlayKnowledgeChanges,
  normalizePlayKnowledgeState,
  projectPlayEventRevealRecord,
  readPlayKnowledgeState,
  resolvePlayKnowledgeEventProjection,
} from './play-knowledge.js';
export type {
  ApplyPlayKnowledgeChangesInput,
  AssertPlayKnowledgeHistoryInput,
  AssertPlayKnowledgeTransitionInput,
  PlayEventRevealRecord,
  PlayKnowledgeChange,
  PlayKnowledgePlayerProjection,
  PlayKnowledgeProjection,
  PlayKnowledgeRevealCandidate,
  PlayKnowledgeState,
  PlayRevealEventKnowledgeChange,
} from './play-knowledge.js';

// Play Mode And Tavern-Compatible Import
export {
  DEFAULT_PLAY_EVENT_POLICY,
  PLAY_SESSION_SCHEMA_VERSION,
  PLAY_SESSION_FILES,
  PLAY_TURNS_DIRECTORY,
  PlaySessionWriteConflictError,
  addPlayAdoptionCandidate,
  addPlayObservation,
  addPlayTranscriptTurn,
  createPlayAdoptionCandidate,
  createPlaySceneRehearsalSessionDraft,
  createPlaySessionDraft,
  createDefaultPlayWorldClock,
  evaluatePlaySessionEligibleEvents,
  evaluatePlaySessionDueEvents,
  formatPlayWorldRefereePrompt,
  listPlaySessionCheckpoints,
  listPlaySessions,
  previewPlaySessionMigration,
  readPlaySessionFiles,
  resolvePlaySessionPath,
  resolvePlayTurnArtifactPath,
  restorePlaySessionCheckpoint,
  parsePlayWorldRefereeResponse,
  normalizePlayWorldRefereeSettlement,
  settlePlayWorldRefereeSettlement,
  settlePlayWorldRefereeResponse,
  withPlaySessionFileTransaction,
  writePlaySessionFiles,
} from './play-session.js';
export {
  MAX_PLAY_LAUNCH_SOURCE_BYTES,
  MAX_PLAY_LAUNCH_SOURCE_EXCERPT,
  PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION,
  PLAY_LAUNCH_SETUP_DIRECTORY,
  PLAY_LAUNCH_SETUP_FILE,
  PlayLaunchSourceValidationError,
  normalizePlayLaunchPackage,
  previewPlayLaunchPackage,
  readPlayLaunchPackage,
  resolvePlayLaunchSetupPath,
  validatePlayLaunchPackageSources,
  writePlayLaunchPackage,
} from './play-launch.js';
export type {
  PlayLaunchDiagnostic,
  PlayLaunchDiagnosticCode,
  PlayLaunchEntryPointInput,
  PlayLaunchIdentityInput,
  PlayLaunchKnowledgeBoundaryInput,
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlayLaunchParticipantRoleInput,
  PlayLaunchSceneValue,
  PlayLaunchSource,
  PlayLaunchSourceInput,
  PlayLaunchSourceRole,
  PlayLaunchSourceStatus,
} from './play-launch.js';
export {
  PLAY_LAUNCH_SESSION_METADATA_KEY,
  createPlaySessionFromLaunchPackage,
  getPlayLaunchSessionMetadata,
  getPlaySessionPurpose,
  getPlaySessionStartMode,
} from './play-launch-session.js';
export type {
  CreatePlaySessionFromLaunchPackageOptions,
  PlayLaunchSessionMetadata,
} from './play-launch-session.js';
export {
  PLAY_CHECKPOINT_NAMES_METADATA_KEY,
  PLAY_INITIAL_WORLD_CHECKPOINT_ID,
  renamePlaySessionCheckpoint,
} from './play-turn-graph.js';
export type { PlayCheckpointKind } from './play-turn-graph.js';
export {
  auditTavernCardSafety,
  createOanTavernImportPreview,
  extractTavernCardJsonFromPng,
  normalizeTavernCard,
  parseTavernCardInput,
} from './tavern-card.js';
export type {
  CreatePlaySessionInput,
  CreatePlaySceneRehearsalSessionInput,
  ParsedPlayWorldRefereeResponse,
  PlayActionKind,
  PlayActivatedSource,
  PlayAgenda,
  PlayAgendaStatus,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayBranchBaseSnapshot,
  PlayCheckpointStatus,
  PlayCheckpointSummary,
  PlayObservation,
  PlayPressure,
  PlayPressureKind,
  PlayPressureStatus,
  PlayRelativeTimeAdvance,
  PlayTimeAdvanceUnit,
  PlayEventDensity,
  PlayEventOrigin,
  PlayEventPolicy,
  PlayEventVisibility,
  PlaySession,
  PlaySessionFile,
  PlaySessionFileTransaction,
  PlaySourceTrust,
  PlaySimulationMode,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldEventCause,
  PlayWorldEventKind,
  PlayWorldRefereeSettlement,
  PlayWorldRefereeSettlementEvent,
  PlayWorldRefereeScheduledEventChange,
  PlayWorldMomentum,
  PlayWorldRefereeTurnContext,
  SettlePlayWorldRefereeResponseInput,
  SettlePlayWorldRefereeSettlementInput,
  PlaySessionMigrationPreview,
  WritePlaySessionFilesOptions,
} from './play-session.js';
export {
  PLAY_OUTCOME_REPORT_MARKDOWN_FILE,
  PLAY_OUTCOME_REPORT_SCHEMA_VERSION,
  PLAY_OUTCOME_REPORT_YAML_FILE,
  PLAY_OUTCOME_REPORTS_DIRECTORY,
  createPlayOutcomeReport,
  createSelectedPlayOutcomeEvidenceIndex,
  fingerprintPlayOutcomeReport,
  formatPlayOutcomeReportMarkdown,
  normalizePlayOutcomeReport,
  projectPlayOutcomeReport,
  readPlayOutcomeReport,
  resolvePlayOutcomeReportPath,
  writePlayOutcomeReport,
} from './play-outcome.js';
export type {
  CreatePlayOutcomeReportOptions,
  PlayOutcomeConfidence,
  PlayOutcomeGoalStatus,
  PlayOutcomeItem,
  PlayOutcomeItemKind,
  PlayOutcomeProjection,
  PlayOutcomeReport,
  PlayOutcomeReportFormat,
  PlayOutcomeReportReadResult,
  PlayOutcomeReportStaleReason,
  PlayOutcomeSourceSnapshot,
  PlayOutcomeTag,
  SelectedPlayOutcomeEvidenceIndex,
  SelectedPlayOutcomeEventEvidence,
  SelectedPlayOutcomeMessageEvidence,
  SelectedPlayOutcomeObservationEvidence,
  SelectedPlayOutcomeRehearsalEvidence,
} from './play-outcome.js';
export {
  PLAY_WRITING_REFERENCE_SCHEMA_VERSION,
  PLAY_WRITING_REFERENCES_DIRECTORY,
  MAX_PLAY_WRITING_REFERENCE_CONTEXT_CHARS,
  MAX_PLAY_WRITING_REFERENCE_ITEMS,
  createPlayWritingReferenceAttachment,
  detachPlayWritingReferenceAttachment,
  formatPlayWritingReferenceContext,
  listPlayWritingReferenceAttachments,
  normalizePlayWritingReferenceAttachment,
  readPlayWritingReferenceAttachment,
  resolvePlayWritingReferenceAttachmentPath,
  validatePlayWritingReferenceAttachment,
} from './play-writing-reference.js';
export type {
  CreatePlayWritingReferenceAttachmentInput,
  DetachPlayWritingReferenceAttachmentOptions,
  PlayWritingReferenceAttachment,
  PlayWritingReferenceContext,
  PlayWritingReferenceStatus,
  ValidatedPlayWritingReferenceAttachment,
} from './play-writing-reference.js';
export {
  PLAY_WORLD_MOMENTUM_STATE_KEY,
  applyPlayWorldMomentumChanges,
  assertPlayWorldMomentumTransition,
  createEmptyPlayWorldMomentum,
  evaluatePlayEligibleWorldEvents,
  formatPlayRelativeTimeAdvance,
  normalizePlayAgendaChanges,
  normalizePlayPressureChanges,
  normalizePlayRelativeTimeAdvance,
  normalizePlayWorldMomentum,
  readPlayWorldMomentum,
} from './play-world-momentum.js';
export type {
  ApplyPlayWorldMomentumChangesInput,
  EvaluatePlayEligibleWorldEventsInput,
  PlayAgendaChange,
  PlayEligibleWorldEventCandidate,
  PlayEligibleWorldEventEvaluation,
  PlayPressureChange,
} from './play-world-momentum.js';
export {
  LEGACY_PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
  PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION,
  PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
  assertSafePlayTurnArtifactId,
  createLegacyPlayTurnArtifacts,
  createPlayTurnArtifactId,
  normalizePlayTurnArtifact,
  projectPlayTranscript,
  selectDefaultPlayTurnPath,
} from './play-turn-artifact.js';
export type {
  LegacyPlayTurnArtifactInput,
  PlayTurnArtifactKind,
  PlayTurnArtifactSchemaVersion,
  PlayTurnArtifact,
} from './play-turn-artifact.js';
export {
  PlayWorldSettlementRetryError,
  preparePlayWorldSettlementRetry,
  settlePlayWorldSettlementRetry,
} from './play-turn-retry.js';
export type {
  PlayWorldSettlementRetryErrorCode,
  PlayWorldSettlementRetryPreparation,
  SettlePlayWorldSettlementRetryInput,
  SettledPlayWorldSettlementRetry,
} from './play-turn-retry.js';
export {
  PLAY_SETTLEMENT_FENCE,
  createPlayNarrativeStreamFilter,
} from './play-narrative-stream.js';
export type { PlayNarrativeStreamFilter } from './play-narrative-stream.js';
export {
  PLAY_REHEARSAL_SCENES_DIRECTORY,
  PLAY_REHEARSAL_SCENE_SCHEMA_VERSION,
  PLAY_REHEARSAL_SIDECAR_FILE,
  PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION,
  PLAY_REHEARSAL_SESSION_SCHEMA_VERSION,
  assertNarrativeBlocksWithinPerception,
  assertSafePlayRehearsalId,
  createCharacterPerceptionPackage,
  createPlayParticipantRef,
  listForbiddenPlayKnowledgeEvidenceRefs,
  normalizeCharacterPerceptionPackage,
  normalizeNarrativeBlock,
  normalizePlayCommittedSceneEvidence,
  normalizePlaySceneContract,
  normalizePlaySceneRehearsalSidecar,
  projectSelectedPlayRehearsalEvidence,
} from './play-rehearsal.js';
export type {
  CharacterPerceptionPackage,
  NarrativeBlock,
  NarrativeBlockKind,
  PlayCommittedCharacterStepEvidence,
  PlayCommittedSceneEvidence,
  PlayRehearsalParticipant,
  PlayRehearsalTurnEvidence,
  PlaySceneContract,
  PlaySceneKnowledgeEvidence,
  PlaySceneRehearsalSidecar,
  PlaySceneValue,
  PlaySessionPurpose,
  PlayStartMode,
} from './play-rehearsal.js';
export {
  PlayTurnAttemptError,
  acceptPlayTurnAttemptStep,
  addPlayTurnAttemptStep,
  assertPlayTurnAttemptFinalizable,
  cancelPlayTurnAttempt,
  createPlayTurnAttempt,
  findPlayAttemptMutationReceipt,
  fingerprintPlayAttemptRequest,
  fingerprintPlayTurnAttemptStepOperation,
  markPlayTurnAttemptCommitted,
  normalizePlayTurnAttempt,
  preparePlayTurnAttemptRetry,
} from './play-turn-attempt.js';
export type {
  CharacterStepDraft,
  CharacterStepDraftStatus,
  PlayAttemptMutationInput,
  PlayAttemptMutationReceipt,
  PlayAttemptMutationResult,
  PlayTurnAttempt,
  PlayTurnAttemptErrorCode,
  PlayTurnAttemptStatus,
} from './play-turn-attempt.js';
export {
  PLAY_ATTEMPT_RECOVERY_DIRECTORY,
  PLAY_ATTEMPT_RECOVERY_FILE,
  PLAY_ATTEMPT_ACTIVE_MARKER_FILE,
  createPlayTurnAttemptRecovery,
  listPlayTurnAttemptRecoveries,
  readPlayTurnAttemptRecovery,
  removePlayTurnAttemptRecovery,
  resolvePlayAttemptRecoveryPath,
  withPlayTurnAttemptRecoveryTransaction,
  writePlayTurnAttemptRecovery,
} from './play-attempt-recovery.js';
export type {
  PlayAttemptRecoveryClassification,
  PlayAttemptRecoverySummary,
  PlayTurnAttemptRecoveryTransaction,
  WritePlayTurnAttemptRecoveryOptions,
} from './play-attempt-recovery.js';
export {
  aggregatePlayTurnAttemptSettlement,
  finalizePlaySceneRehearsalAttempt,
  startPlaySceneRehearsalAttempt,
} from './play-rehearsal-turn.js';
export type {
  FinalizePlaySceneRehearsalAttemptInput,
  FinalizedPlaySceneRehearsalAttempt,
  StartPlaySceneRehearsalAttemptInput,
} from './play-rehearsal-turn.js';
export {
  assertPlayScheduledEvent,
  assertPlayScheduledEvents,
  assertSafePlayScheduledEventId,
  assertSafePlayStatePath,
  evaluatePlayDueEvents,
  normalizePlayEventTrigger,
  normalizePlayScheduledEvent,
  normalizePlayScheduledEventTemplate,
  normalizePlayScheduledEvents,
} from './play-event-schedule.js';
export type {
  EvaluatePlayDueEventsInput,
  PlayDueEventEvaluation,
  PlayEventTrigger,
  PlayFlagValue,
  PlayScheduledEvent,
  PlayScheduledEventStatus,
  PlayScheduledEventTemplate,
} from './play-event-schedule.js';
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
  formatReferenceContextSelectionMarkdown,
  importReferenceWork,
  listReferenceWorks,
  referenceSelectionToContextSources,
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
