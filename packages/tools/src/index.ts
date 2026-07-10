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
  CreateWriteIntentToolsOptions,
  RejectedPendingAction,
  RejectPendingActionInput,
  StoredWriteIntentAction,
  WriteIntentPendingAction,
} from './write-intent-tools';

export {
  previewSemanticPatches,
  resolvePatchTargetFile,
  validateSemanticPatch,
} from './apply-engine';
export type {
  ApplyPreviewCandidate,
  ApplyPreviewResult,
  CollectionPatch,
  NarrativePatch,
  ObjectPatch,
  PreviewSemanticPatchesInput,
  SemanticPatch,
  ShadowWriteReference,
} from './apply-engine';

export {
  commitFiles,
  createPendingActionCommitMessage,
  gitDiff,
  gitStatusShort,
  listGitCommits,
  readGitStatus,
  showGitCommit,
  syncGit,
} from './git-integration';
export type {
  GitCommandError,
  GitCommitDetail,
  GitCommitResult,
  GitCommitSummary,
  GitFileStatus,
  GitSyncResult,
  GitWorkspaceStatus,
} from './git-integration';
