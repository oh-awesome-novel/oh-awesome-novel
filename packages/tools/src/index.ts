export {
  loadMarkdown,
  parseFrontmatter,
  parseSections,
  replaceSection,
  appendSection,
} from './markdown';
export type {
  MarkdownDocument,
  MarkdownDraft,
  MarkdownSection,
} from './markdown';

export {
  loadYaml,
  yamlGet,
  yamlSetDraft,
  yamlDeleteDraft,
  yamlAppendDraft,
  validateYamlDocument,
} from './yaml-engine';
export type {
  YamlDocument,
  YamlDraft,
  YamlValue,
} from './yaml-engine';

export { createReadTools } from './read-tools';
export type { CreateReadToolsOptions } from './read-tools';

export {
  buildChapterIndex,
  readChapterIndexStatus,
  writeChapterIndexFile,
} from './chapter-index';
export type {
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
  ChapterIndexStatusResult,
  ChapterIndexVolume,
  PersistedChapterIndex,
} from './chapter-index';

export {
  createRestrictedWriteTools,
  createWorkspaceWriteFileTool,
  writeRestrictedWorkspaceFile,
} from './restricted-write-tool';
export type {
  CreateRestrictedWriteToolsOptions,
  RestrictedWriteResult,
} from './restricted-write-tool';

export {
  acceptPendingAction,
  createWriteIntentTools,
  listPendingActions,
  rejectPendingAction,
} from './write-intent-tools';
export type {
  AcceptedPendingAction,
  AcceptPendingActionInput,
  CollectionPatch,
  CreateWriteIntentToolsOptions,
  NarrativePatch,
  ObjectPatch,
  RejectedPendingAction,
  RejectPendingActionInput,
  SemanticPatch,
  ShadowWriteReference,
  StoredWriteIntentAction,
  WriteIntentPendingAction,
} from './write-intent-tools';
