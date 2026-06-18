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
} from './workspace.js';

export type {
  WorkspaceInitOptions,
  WorkspaceConfig,
  WorkspaceEntry,
  WorkspaceList,
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
  redactLlmProviderConfig,
} from './llm-provider.js';

export type {
  LlmProviderKind,
  LlmProviderConfig,
  LlmProviderConfigState,
} from './llm-provider.js';

// Novel Copilot Skill
export {
  NOVEL_COPILOT_ALLOWED_TOOLS,
  NOVEL_COPILOT_QUICK_COMMANDS,
  createDefaultNovelCopilotSkill,
  loadNovelCopilotSkill,
} from './novel-copilot-skill.js';

export type {
  LoadNovelCopilotSkillOptions,
  NovelCopilotQuickCommand,
  NovelCopilotSkill,
} from './novel-copilot-skill.js';
