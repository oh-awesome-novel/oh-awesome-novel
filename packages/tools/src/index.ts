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
  CANDIDATE_CHANGE_SET_SCHEMA_VERSION,
  DEFAULT_CREATED_FILE_MODE,
  assertValidTextContent,
  createCandidateChangeSet,
  fingerprintCandidateChanges,
  fingerprintFileSnapshots,
  normalizeWorkspaceRelativePath,
  sha256Text,
} from './candidate-change-set';
export type {
  CandidateChangeSet,
  CandidateChangeSource,
  CandidateContent,
  CandidateFileChange,
  CandidateFileSnapshot,
  CreateCandidateChangeSetInput,
  ExistingContent,
  RepositoryBaseline,
  WorkspaceEditCapability,
} from './candidate-change-set';

export {
  DEFAULT_MAX_CANDIDATE_BYTES,
  DEFAULT_MAX_CHANGED_FILES,
  DEFAULT_MAX_PATH_DEPTH,
  assertPathAllowedByRules,
  assertPathReadableByPolicy,
  assertPathWritableByPolicy,
  assertSafeWorkspacePolicyPath,
  createWorkspaceChangePolicy,
  normalizeHostSelectedCapability,
  normalizePathRule,
  pathMatchesAnyRule,
  pathMatchesRule,
  validateCandidateChangeSetAgainstPolicy,
} from './workspace-change-policy';
export type {
  CreateWorkspaceChangePolicyInput,
  PathRule,
  WorkspaceChangePolicy,
} from './workspace-change-policy';

export {
  DEFAULT_MAX_IN_MEMORY_FS_BYTES,
  DEFAULT_MAX_PROJECTION_BYTES,
  DEFAULT_MAX_PROJECTION_FILE_BYTES,
  VIRTUAL_SCRATCH_ROOT,
  VIRTUAL_WORKSPACE_ROOT,
  WORKSPACE_PROJECTION_SCHEMA_VERSION,
  WorkspaceProjectionDriftError,
  createWorkspaceProjection,
  decodeWorkspaceText,
  fromVirtualWorkspacePath,
  toVirtualWorkspacePath,
} from './workspace-projection';
export type {
  CreateWorkspaceProjectionOptions,
  ProjectionFreshnessResult,
  WorkspaceProjection,
  WorkspaceProjectionManifest,
  WorkspaceProjectionManifestFile,
  WorkspaceProjectionPathRule,
  WorkspaceProjectionPolicyLike,
} from './workspace-projection';

export { TrackingFs } from './tracking-fs';
export type {
  FinalizeTrackedWorkspaceInput,
  TrackingFsOptions,
  TrackingMutation,
  TrackingMutationOperation,
  WorkspaceReconciliation,
} from './tracking-fs';

export { PolicyFs } from './policy-fs';
export type {
  PolicyFsOptions,
  PolicyFsUsage,
} from './policy-fs';

export {
  DEFAULT_MAX_DOCUMENT_DEPTH,
  DEFAULT_MAX_DOCUMENT_NODES,
  DEFAULT_MAX_FINAL_DOCUMENT_BYTES,
  getFinalDocumentValidatorIdForPath,
  inspectFinalDocument,
  validateFinalDocument,
} from './final-document-validator';
export type {
  FinalDocumentValidationContext,
  FinalDocumentValidatorId,
  ValidateFinalDocumentInput,
  ValidatedFinalDocument,
} from './final-document-validator';

export {
  DEFAULT_MAX_RENDERED_DIFF_BYTES,
  renderCandidateChangeDiff,
} from './change-diff';
export type { ChangeDiffInput } from './change-diff';

export {
  PENDING_ACTION_SCHEMA_VERSION,
  PENDING_ACTION_TERMINAL_SCHEMA_VERSION,
  PREPARED_CHANGE_PREVIEW_SCHEMA_VERSION,
  UNSUPPORTED_PENDING_ACTION_SCHEMA,
  PendingActionProtocolError,
  assertCanonicalTargetPath,
  assertOpaquePendingActionId,
  parsePendingAction,
  parsePendingActionOrigin,
  parsePendingActionSource,
  parsePendingActionTerminal,
  parsePreparedChangePreview,
  parsePreparedChangePreviewPromotion,
} from './pending-action-types';
export type {
  DraftArtifact,
  PendingAction,
  PendingActionGitResult,
  PendingActionOrigin as SandboxPendingActionOrigin,
  PendingActionProtocolErrorCode,
  PendingActionRecord,
  PendingActionSource,
  PendingActionTerminalRecord,
  PendingActionView,
  PendingFileChange,
  PreparedChangePreviewPromotion,
  PreparedChangePreviewV1,
} from './pending-action-types';

export {
  PENDING_ACTION_DECISION_RECEIPT_SCHEMA_VERSION,
  createPendingActionDecisionReceipt,
  isAllowedDecisionReceiptTransition,
  parsePendingActionDecisionReceipt,
  parsePendingActionGitResult,
} from './pending-action-decision-receipt';
export type {
  CreatePendingActionDecisionReceiptInput,
  PendingActionDecisionReceipt,
} from './pending-action-decision-receipt';

export {
  createPendingActionStore,
  createRejectedDecisionReceipt,
} from './pending-action-store';

export {
  createChangeMaterializer,
} from './change-materializer';
export type {
  AcceptChangeInput,
  AcceptedChangeResult,
  ChangeMaterializer,
  ChangeMaterializerFaultPoint,
  ChangeMaterializerOptions,
  RejectChangeInput,
  RejectedChangeResult,
} from './change-materializer';
export type {
  LockedPendingActionAccess,
  PendingActionListOptions,
  PendingActionStore,
  PendingActionStoreOptions,
  PrepareChangePreviewInput,
  PromotePreparedChangePreviewInput,
  ProposePendingActionInput,
  WritePendingActionTerminalInput,
} from './pending-action-store';

export {
  CandidateChangeSetBuilder,
  createCandidateChangeSetBuilder,
  finalizeDeterministicChangeProposal,
  normalizeExactTargetSet,
} from './deterministic-change-producers';
export type {
  CandidateChangeSetBuilderOptions,
  DeterministicChangeProposal,
  TrustedDeterministicProducerContext,
} from './deterministic-change-producers';

export {
  REFERENCE_PUBLICATION_CHANGE_PRODUCER,
  createReferencePublicationChangeProposal,
} from './reference-publication-change-producer';
export type {
  CreateReferencePublicationChangeProposalInput,
  ReferencePublicationOrigin,
} from './reference-publication-change-producer';

export {
  PLAY_ADOPTION_CHANGE_PRODUCER,
  createPlayAdoptionChangeProposal,
} from './play-adoption-change-producer';
export type {
  CreatePlayAdoptionChangeProposalInput,
  PlayAdoptionChangeOrigin,
  PlayAdoptionSourceBinding,
} from './play-adoption-change-producer';

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
export type {
  CreateReadToolsOptions,
  WorkspaceReader,
  WorkspaceReaderDirectoryEntry,
} from './read-tools';

export {
  DEFAULT_MODEL_TOOL_OUTPUT_CHARS,
  OAN_COMMAND_ALLOWLIST,
  createSandboxBashToolPrompt,
  createSandboxToolSet,
} from './sandbox-toolset';
export type {
  CreateSandboxToolSetOptions,
  SandboxProposeChangesInput,
  SandboxReadFileInput,
  SandboxWriteFileInput,
} from './sandbox-toolset';

export {
  DEFAULT_SANDBOX_AUDIT_PREVIEW_BYTES,
  DEFAULT_SANDBOX_AUDIT_TOTAL_BYTES,
  DEFAULT_SANDBOX_PREVIEW_BYTES,
  DEFAULT_SANDBOX_READ_BYTES,
  MAX_SANDBOX_READ_BYTES,
  createSandboxEditSession,
  sanitizeSandboxText,
} from './sandbox-edit-session';
export type {
  CandidateChangePreview,
  CandidateSourceMetadata,
  CreateSandboxEditSessionOptions,
  SandboxCommandAuditEntry,
  SandboxCommandAuditSummary,
  SandboxEditSession,
  SandboxEditSessionLimits,
  SandboxProposalResult,
} from './sandbox-edit-session';

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
  REFERENCE_MATERIAL_ADOPTION_CHANGE_PRODUCER,
  createReferenceMaterialAdoptionChangeProposal,
} from './reference-material-adoption';
export type {
  CreateReferenceMaterialAdoptionChangeProposalInput,
  ReferenceMaterialChangeOrigin,
} from './reference-material-adoption';
export {
  commitPendingActionFiles,
  commitFiles,
  createPendingActionCommitMessage,
  gitDiff,
  gitStatusShort,
  inspectPendingActionGitPreflight,
  listGitCommits,
  readPendingActionCommitAtHead,
  readRepositoryBaseline,
  assertRepositoryBaseline,
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
  PendingActionGitBaselineFile,
  PendingActionGitPreflight,
  PendingActionHeadCommit,
  PendingActionScopedCommitResult,
  RepositoryBaseline as GitRepositoryBaseline,
} from './git-integration';
