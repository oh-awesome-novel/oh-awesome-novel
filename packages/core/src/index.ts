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
} from './workspace.js';

export type {
  WorkspaceInitOptions,
  WorkspaceConfig,
  WorkspaceEntry,
  WorkspaceList,
  ChapterPathParts,
} from './workspace.js';

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
