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
