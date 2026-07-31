import type {
  ReferenceContextSelection,
  ReferenceDeconstructionStageId,
  ReferenceDeconstructionStageStatus,
  ReferenceImportInput,
  ReferenceImportResult,
  ReferenceSourceManifest,
  ReferenceWorkSummary,
} from './index.js';
import { WRITING_PROFILE_OUTPUTS } from './writing-profile.js';
import type { WritingProfileOutput } from './writing-profile.js';

export type NovelCopilotCapabilityId =
  | 'novel.generate_character_card'
  | 'novel.plan_outline'
  | 'novel.plan_volume'
  | 'novel.plan_chapter'
  | 'novel.write_chapter'
  | 'novel.review_chapter'
  | 'novel.revise_chapter'
  | 'novel.settle_chapter'
  | 'novel.update_state'
  | 'novel.plan_foreshadow'
  | 'novel.de_ai'
  | 'novel.play_scene'
  | 'novel.import_tavern_character'
  | 'novel.deconstruct_reference';

export type ReferenceDeconstructionRunStatus =
  | 'created'
  | 'previewRunning'
  | 'awaitingFullApproval'
  | 'fullApproved'
  | 'fullRunning'
  | 'paused'
  | 'reviewReady'
  | 'publishing'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'stale';

export type ReferenceDeconstructionConfidence = 'low' | 'medium' | 'high';

export interface ReferenceSourcePointer {
  referenceId: string;
  sourceChecksumSha256: string;
  chapterId: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
}

export interface ReferencePreviewEvidence {
  id: string;
  pointer: ReferenceSourcePointer;
}

export type ReferenceDeconstructionDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ReferenceDeconstructionDiagnostic {
  id: string;
  severity: ReferenceDeconstructionDiagnosticSeverity;
  code: string;
  message: string;
  blocking: boolean;
  evidenceRefs: string[];
  stageId?: ReferenceDeconstructionStageId;
  chapterId?: string;
  pointerId?: string;
  unitId?: string;
  attemptId?: string;
}

export type ReferenceQuickPreviewFindingKind =
  | 'hook'
  | 'pacing'
  | 'sceneTechnique'
  | 'characterTechnique'
  | 'worldbuildingTechnique';

export interface ReferenceQuickPreviewChapter {
  id: string;
  chapterId: string;
  summary: string;
  evidenceRefs: string[];
  confidence: ReferenceDeconstructionConfidence;
  uncertainty?: string;
}

export interface ReferenceQuickPreviewFinding {
  id: string;
  kind: ReferenceQuickPreviewFindingKind;
  observation: string;
  technique: string;
  whenUseful?: string;
  avoid?: string;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  generalInference: boolean;
  uncertainty?: string;
}

export interface ReferenceQuickPreviewBorrowablePattern {
  id: string;
  title: string;
  technique: string;
  whenUseful?: string;
  evidenceRefs: string[];
  confidence: ReferenceDeconstructionConfidence;
}

export interface ReferenceQuickPreviewCoverage {
  selectedChapterIds: string[];
  analyzedChapterIds: string[];
  selectedPointerCount: number;
  citedPointerCount: number;
  chapterCoveragePercent: number;
}

export interface ReferenceQuickPreview {
  version: 2;
  runId: string;
  referenceId: string;
  sourceChecksumSha256: string;
  sourceOverview: string;
  chapterPreviews: ReferenceQuickPreviewChapter[];
  findings: ReferenceQuickPreviewFinding[];
  borrowablePatterns: ReferenceQuickPreviewBorrowablePattern[];
  doNotCopy: string[];
  differentiationRequirements: string[];
  differentiationPrompts: string[];
  canonContaminationWarnings: string[];
  confidence: ReferenceDeconstructionConfidence;
  uncertainties: string[];
  coverage: ReferenceQuickPreviewCoverage;
  diagnostics: ReferenceDeconstructionDiagnostic[];
}

export type ReferenceDeconstructionTrackId = 'technique' | 'storyMaterial';

export type ReferenceStoryMaterialKind = Exclude<
  WritingProfileOutput,
  'techniques'
>;

export type ReferenceStoryMaterialCoverageLevel =
  | 'none'
  | 'partial'
  | 'substantial';

export interface ReferenceStoryMaterialCoverageItem {
  id: string;
  materialKind: ReferenceStoryMaterialKind;
  coverage: ReferenceStoryMaterialCoverageLevel;
  summary: string;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  uncertainty?: string;
}

export interface ReferenceStoryMaterialCoveragePreview {
  version: 2;
  runId: string;
  referenceId: string;
  sourceChecksumSha256: string;
  track: 'storyMaterial';
  materialKinds: ReferenceStoryMaterialKind[];
  items: ReferenceStoryMaterialCoverageItem[];
  uncertainties: string[];
}

export interface ReferenceDeconstructionMutationReceipt {
  idempotencyKey: string;
  requestFingerprint: string;
  resultingRunRevision: number;
  resultStatus: ReferenceDeconstructionRunStatus;
}

export type ReferenceDeconstructionUnitKind =
  | 'chapterChunk'
  | 'aggregate'
  | 'style'
  | 'distill'
  | 'materialProjection'
  | 'analysisQuality';

export type ReferenceDeconstructionUnitStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'stale';

export type ReferenceDeconstructionAttemptStatus =
  Exclude<ReferenceDeconstructionUnitStatus, 'queued'>;

export interface ReferenceDeconstructionFullStageSummary {
  track: ReferenceDeconstructionTrackId;
  stageId: ReferenceDeconstructionStageId;
  status: ReferenceDeconstructionStageStatus;
  plannedUnits: number;
  completedUnits: number;
  failedUnits: number;
}

export interface ReferenceDeconstructionFullProgress {
  plannedUnits: number;
  completedUnits: number;
  failedUnits: number;
  completedChapters: number;
  totalChapters: number;
  percent: number;
}

export interface ReferenceDeconstructionUnitSummary {
  id: string;
  ordinal: number;
  track: ReferenceDeconstructionTrackId;
  stageId: ReferenceDeconstructionStageId;
  kind: ReferenceDeconstructionUnitKind;
  chapterId?: string;
  chunkId?: string;
  status: ReferenceDeconstructionUnitStatus;
  attemptCount: number;
  selectedAttemptId?: string;
}

export interface ReferenceDeconstructionAttemptSummary {
  id: string;
  unitId: string;
  attemptNumber: number;
  status: ReferenceDeconstructionAttemptStatus;
  inputFingerprint: string;
  outputHash?: string;
  startedAt: string;
  completedAt?: string;
}

export type ReferenceDeconstructionAnalysisQualityStatus =
  | 'notEvaluated'
  | 'passed'
  | 'warned'
  | 'failed';

export interface ReferenceDeconstructionAnalysisQuality {
  status: ReferenceDeconstructionAnalysisQualityStatus;
  coveragePercent: number;
  blockingDiagnosticCount: number;
  outputHashes: string[];
}

export interface ReferenceDeconstructionFullRun {
  stages: ReferenceDeconstructionFullStageSummary[];
  progress: ReferenceDeconstructionFullProgress;
  nextUnit?: ReferenceDeconstructionUnitSummary;
  currentUnit?: ReferenceDeconstructionUnitSummary;
  failedUnit?: ReferenceDeconstructionUnitSummary;
  recentUnits: ReferenceDeconstructionUnitSummary[];
  recentAttempts: ReferenceDeconstructionAttemptSummary[];
  analysisQuality: Partial<Record<
    ReferenceDeconstructionTrackId,
    ReferenceDeconstructionAnalysisQuality
  >>;
}

export type ReferenceDistilledCategory =
  | 'writingStyle'
  | 'pacing'
  | 'hooks'
  | 'scene'
  | 'character';

export type ReferenceDeconstructionPublicationFileKind =
  | 'index'
  | 'manifest'
  | 'diagnostics'
  | 'progress'
  | 'deconstruction'
  | 'distilled'
  | 'materials'
  | 'context';

export interface ReferenceDeconstructionPublicationFile {
  path: string;
  checksumSha256: string;
  kind: ReferenceDeconstructionPublicationFileKind;
}

export interface ReferenceDeconstructionPublicationEntry {
  id: string;
  category: ReferenceDistilledCategory;
  title: string;
  estimatedTokens: number;
}

export type ReferenceStoryMaterialAssertionType =
  | 'fact'
  | 'interpretation'
  | 'uncertain';

export interface ReferenceDeconstructionPublicationMaterialInventoryItem {
  id: string;
  materialKind: ReferenceStoryMaterialKind;
  title: string;
  assertionType: ReferenceStoryMaterialAssertionType;
  confidence: ReferenceDeconstructionConfidence;
  path: string;
}

export interface ReferenceDeconstructionPublication {
  candidateFingerprint: string;
  pendingActionId?: string;
  files: ReferenceDeconstructionPublicationFile[];
  entryInventory: ReferenceDeconstructionPublicationEntry[];
  materialInventory?: ReferenceDeconstructionPublicationMaterialInventoryItem[];
  preparedAt: string;
}

export interface ReferenceDeconstructionRun {
  schemaVersion: 2;
  id: string;
  referenceId: string;
  runRevision: number;
  status: ReferenceDeconstructionRunStatus;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  pipelineVersion: 2;
  capabilityVersion: 'novel.deconstruct_reference@2';
  profileId: string;
  outputs: WritingProfileOutput[];
  selectedChapterIds: string[];
  evidence: ReferencePreviewEvidence[];
  preview?: ReferenceQuickPreview;
  materialPreview?: ReferenceStoryMaterialCoveragePreview;
  diagnostics: ReferenceDeconstructionDiagnostic[];
  mutationReceipts: ReferenceDeconstructionMutationReceipt[];
  receiptCount: number;
  full?: ReferenceDeconstructionFullRun;
  publication?: ReferenceDeconstructionPublication;
  createdAt: string;
  updatedAt: string;
  fullApprovedAt?: string;
}

export interface CreateReferenceDeconstructionRunInput {
  mode: 'quickPreview';
  baseRunRevision: 0;
  idempotencyKey: string;
  selectedChapterIds?: string[];
  confirmDetectedRange?: true;
}

export interface MutateReferenceDeconstructionRunInput {
  baseRunRevision: number;
  idempotencyKey: string;
}

export interface RetryReferenceDeconstructionRunInput
  extends MutateReferenceDeconstructionRunInput {
  unitId: string;
}

export interface ReferenceDeconstructionRunMutationResult {
  run: ReferenceDeconstructionRun;
  receipt: ReferenceDeconstructionMutationReceipt;
  replayed: boolean;
}

export interface ReferenceDeconstructionPublishPendingActionOrigin {
  kind: 'referenceDeconstructionPublish';
  referenceId: string;
  runId: string;
  runRevision: number;
  candidateFingerprint: string;
}

export interface ReferenceDeconstructionPublishPendingAction {
  id: string;
  title: string;
  description: string;
  touchedFiles: string[];
  diff: string;
  createdAt: string;
  status: 'pending' | 'accepted';
  acceptedAt?: string;
  origin: ReferenceDeconstructionPublishPendingActionOrigin;
}

export interface ReferenceDeconstructionPublishResult
  extends ReferenceDeconstructionRunMutationResult {
  pendingAction: ReferenceDeconstructionPublishPendingAction;
}

export interface ReferenceDeconstructionRunReadResult {
  run: ReferenceDeconstructionRun;
}

export interface ActiveReferenceDeconstructionRunReadResult {
  run: ReferenceDeconstructionRun | null;
}

const CAPABILITY_IDS: ReadonlySet<string> = new Set([
  'novel.generate_character_card',
  'novel.plan_outline',
  'novel.plan_volume',
  'novel.plan_chapter',
  'novel.write_chapter',
  'novel.review_chapter',
  'novel.revise_chapter',
  'novel.settle_chapter',
  'novel.update_state',
  'novel.plan_foreshadow',
  'novel.de_ai',
  'novel.play_scene',
  'novel.import_tavern_character',
  'novel.deconstruct_reference',
]);

const RUN_STATUSES: ReadonlySet<string> = new Set([
  'created',
  'previewRunning',
  'awaitingFullApproval',
  'fullApproved',
  'fullRunning',
  'paused',
  'reviewReady',
  'publishing',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
  'stale',
]);

const CONFIDENCE_VALUES: ReadonlySet<string> = new Set(['low', 'medium', 'high']);
const DIAGNOSTIC_SEVERITIES: ReadonlySet<string> = new Set(['info', 'warning', 'error']);
const FINDING_KINDS: ReadonlySet<string> = new Set([
  'hook',
  'pacing',
  'sceneTechnique',
  'characterTechnique',
  'worldbuildingTechnique',
]);
const TECHNIQUE_FULL_STAGES = [
  'chapterAnalysis',
  'aggregateAnalysis',
  'styleProfile',
  'distillForOan',
  'qualityGate',
] as const satisfies readonly ReferenceDeconstructionStageId[];
const STORY_MATERIAL_FULL_STAGES = [
  'materialChapterAnalysis',
  'materialAggregateAnalysis',
  'materialProjection',
  'qualityGate',
] as const satisfies readonly ReferenceDeconstructionStageId[];
const FULL_STAGE_IDS: readonly ReferenceDeconstructionStageId[] = [
  ...TECHNIQUE_FULL_STAGES,
  ...STORY_MATERIAL_FULL_STAGES.filter((stageId) => stageId !== 'qualityGate'),
];
const TRACK_IDS = ['technique', 'storyMaterial'] as const;
const STORY_MATERIAL_KINDS = WRITING_PROFILE_OUTPUTS.filter(
  (output): output is ReferenceStoryMaterialKind => output !== 'techniques',
);
const STORY_MATERIAL_COVERAGE_LEVELS: ReadonlySet<string> = new Set([
  'none',
  'partial',
  'substantial',
]);
const UNIT_KINDS: ReadonlySet<string> = new Set([
  'chapterChunk',
  'aggregate',
  'style',
  'distill',
  'materialProjection',
  'analysisQuality',
]);
const DISTILLED_CATEGORIES: ReadonlySet<string> = new Set([
  'writingStyle',
  'pacing',
  'hooks',
  'scene',
  'character',
]);
const MAX_REFERENCE_DISTILLED_ENTRY_TOKENS = 2_048;
const PUBLICATION_FILE_KINDS: ReadonlySet<string> = new Set([
  'index',
  'manifest',
  'diagnostics',
  'progress',
  'deconstruction',
  'distilled',
  'materials',
  'context',
]);
const UNIT_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'stale',
]);
const ATTEMPT_STATUSES: ReadonlySet<string> = new Set([
  'running',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'stale',
]);
const ANALYSIS_QUALITY_STATUSES: ReadonlySet<string> = new Set([
  'notEvaluated',
  'passed',
  'warned',
  'failed',
]);
const MAX_FULL_DECONSTRUCTION_UNITS = 2_048;
const MAX_FULL_DECONSTRUCTION_RECENT_ITEMS = 64;

export function assertReferenceWireId(value: string, label: string): string {
  if (!isSafeId(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function assertCreateReferenceDeconstructionRunInput(
  value: CreateReferenceDeconstructionRunInput,
): void {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'mode',
      'baseRunRevision',
      'idempotencyKey',
      'selectedChapterIds',
      'confirmDetectedRange',
    ]) ||
    value.mode !== 'quickPreview' ||
    value.baseRunRevision !== 0 ||
    !isSafeId(value.idempotencyKey) ||
    (value.selectedChapterIds !== undefined &&
      !isUniqueSafeIdArray(value.selectedChapterIds, 3)) ||
    (value.confirmDetectedRange !== undefined && value.confirmDetectedRange !== true)
  ) {
    throw new Error('Reference deconstruction create request is invalid.');
  }
}

export function assertReferenceImportInput(value: ReferenceImportInput): void {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'title',
      'sourcePath',
      'sourceText',
      'originalFileName',
      'sourceType',
      'rights',
      'allowedUsage',
      'enabled',
      'notes',
    ]) ||
    !isBoundedText(value.title, 500) ||
    (value.sourcePath === undefined && value.sourceText === undefined) ||
    (value.sourcePath !== undefined && !isBoundedText(value.sourcePath, 4_096)) ||
    (value.sourceText !== undefined && !isBoundedText(value.sourceText, 5_000_000)) ||
    (value.originalFileName !== undefined && !isBoundedText(value.originalFileName, 1_024)) ||
    (value.sourceType !== undefined && !isReferenceSourceType(value.sourceType)) ||
    (value.rights !== undefined && !isReferenceRights(value.rights)) ||
    (value.allowedUsage !== undefined && (
      !Array.isArray(value.allowedUsage) ||
      value.allowedUsage.length > 4 ||
      !value.allowedUsage.every(isReferenceAllowedUsage) ||
      new Set(value.allowedUsage).size !== value.allowedUsage.length
    )) ||
    (value.enabled !== undefined && typeof value.enabled !== 'boolean') ||
    (value.notes !== undefined && !isBoundedText(value.notes, 10_000, true))
  ) {
    throw new Error('Reference import request is invalid.');
  }
}

export function assertMutateReferenceDeconstructionRunInput(
  value: MutateReferenceDeconstructionRunInput,
): void {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['baseRunRevision', 'idempotencyKey']) ||
    !isNonNegativeSafeInteger(value.baseRunRevision) ||
    !isSafeId(value.idempotencyKey)
  ) {
    throw new Error('Reference deconstruction mutation request is invalid.');
  }
}

export function assertRetryReferenceDeconstructionRunInput(
  value: RetryReferenceDeconstructionRunInput,
): void {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['baseRunRevision', 'idempotencyKey', 'unitId']) ||
    !isNonNegativeSafeInteger(value.baseRunRevision) ||
    !isSafeId(value.idempotencyKey) ||
    !isSafeId(value.unitId)
  ) {
    throw new Error('Reference deconstruction retry request is invalid.');
  }
}

export function assertReferenceContextRequest(input: {
  tokenBudget?: number;
  maxReferences?: number;
  maxEntries?: number;
  capability?: NovelCopilotCapabilityId;
  goal?: string;
  sceneType?: string;
  pacingIntent?: string;
  hookIntent?: string;
  styleIntent?: string;
  characterIntent?: string;
  explicitReferenceIds?: string[];
}): void {
  if (
    !isRecord(input) ||
    !hasOnlyKnownFields(input, [
      'tokenBudget',
      'maxReferences',
      'maxEntries',
      'capability',
      'goal',
      'sceneType',
      'pacingIntent',
      'hookIntent',
      'styleIntent',
      'characterIntent',
      'explicitReferenceIds',
    ]) ||
    (input.tokenBudget !== undefined &&
      (!isPositiveSafeInteger(input.tokenBudget) || input.tokenBudget > 100_000)) ||
    (input.maxReferences !== undefined &&
      (!isPositiveSafeInteger(input.maxReferences) || input.maxReferences > 20)) ||
    (input.maxEntries !== undefined &&
      (!isPositiveSafeInteger(input.maxEntries) || input.maxEntries > 50)) ||
    (input.capability !== undefined && !CAPABILITY_IDS.has(input.capability)) ||
    (input.goal !== undefined && !isBoundedText(input.goal, 4_000, true)) ||
    (input.sceneType !== undefined && !isBoundedText(input.sceneType, 1_000, true)) ||
    (input.pacingIntent !== undefined &&
      !isBoundedText(input.pacingIntent, 1_000, true)) ||
    (input.hookIntent !== undefined && !isBoundedText(input.hookIntent, 1_000, true)) ||
    (input.styleIntent !== undefined &&
      !isBoundedText(input.styleIntent, 1_000, true)) ||
    (input.characterIntent !== undefined &&
      !isBoundedText(input.characterIntent, 1_000, true)) ||
    (input.explicitReferenceIds !== undefined &&
      !isUniqueSafeIdArray(input.explicitReferenceIds, 32))
  ) {
    throw new Error('Reference context request is invalid.');
  }
}

export function parseReferenceListEnvelope(value: unknown): {
  references: ReferenceWorkSummary[];
} {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['references']) ||
    !Array.isArray(value.references) ||
    value.references.length > 1_000 ||
    !value.references.every(isReferenceWorkSummary) ||
    !hasUniqueIds(value.references)
  ) {
    throw new Error('Reference list returned an invalid payload.');
  }
  return value as unknown as { references: ReferenceWorkSummary[] };
}

export function parseReferenceImportResult(value: unknown): ReferenceImportResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['reference', 'manifest', 'createdFiles']) ||
    !isReferenceWorkSummary(value.reference) ||
    !isReferenceSourceManifest(value.manifest) ||
    !Array.isArray(value.createdFiles) ||
    value.createdFiles.length > 256 ||
    !value.createdFiles.every((item) => isSafeRelativePath(item)) ||
    new Set(value.createdFiles).size !== value.createdFiles.length
  ) {
    throw new Error('Reference import returned an invalid payload.');
  }
  const reference = value.reference as ReferenceWorkSummary;
  const manifest = value.manifest as ReferenceSourceManifest;
  const createdFiles = value.createdFiles as string[];
  if (
    reference.id !== manifest.referenceId ||
    reference.checksumSha256 !== manifest.checksumSha256 ||
    reference.chapterCount !== manifest.detectedStructure.chapterCount ||
    reference.structureConfidence !== manifest.detectedStructure.confidence ||
    createdFiles.some((path) => !path.startsWith(`${reference.bundlePath}/`) &&
      path !== 'examples/README.md' && path !== 'examples/references.yaml')
  ) {
    throw new Error('Reference import returned an inconsistent payload.');
  }
  return value as unknown as ReferenceImportResult;
}

export function parseReferenceEnvelope(
  value: unknown,
  expectedReferenceId?: string,
): { reference: ReferenceWorkSummary } {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['reference']) ||
    !isReferenceWorkSummary(value.reference) ||
    (expectedReferenceId !== undefined && value.reference.id !== expectedReferenceId)
  ) {
    throw new Error('Reference update returned an invalid payload.');
  }
  return value as unknown as { reference: ReferenceWorkSummary };
}

export function parseReferenceContextEnvelope(value: unknown): {
  selection: ReferenceContextSelection;
} {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['selection']) ||
    !isReferenceContextSelection(value.selection)
  ) {
    throw new Error('Reference context selection returned an invalid payload.');
  }
  return value as unknown as { selection: ReferenceContextSelection };
}

export function parseReferenceDeconstructionRunReadResult(
  value: unknown,
  expectedReferenceId: string,
  expectedRunId: string,
): ReferenceDeconstructionRunReadResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['run']) ||
    !isReferenceDeconstructionRun(value.run) ||
    value.run.referenceId !== expectedReferenceId ||
    value.run.id !== expectedRunId
  ) {
    throw new Error('Reference deconstruction run returned an invalid payload.');
  }
  return value as unknown as ReferenceDeconstructionRunReadResult;
}

export function parseActiveReferenceDeconstructionRunReadResult(
  value: unknown,
  expectedReferenceId: string,
): ActiveReferenceDeconstructionRunReadResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['run']) ||
    (value.run !== null && (
      !isReferenceDeconstructionRun(value.run) ||
      value.run.referenceId !== expectedReferenceId
    ))
  ) {
    throw new Error('Active reference deconstruction run returned an invalid payload.');
  }
  return value as unknown as ActiveReferenceDeconstructionRunReadResult;
}

export function parseReferenceDeconstructionRunMutationResult(
  value: unknown,
  expectedReferenceId: string,
  expectedIdempotencyKey: string,
  expectedRunId?: string,
): ReferenceDeconstructionRunMutationResult {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, ['run', 'receipt', 'replayed']) ||
    !isReferenceDeconstructionRun(value.run) ||
    !isReferenceDeconstructionMutationReceipt(value.receipt) ||
    typeof value.replayed !== 'boolean' ||
    value.run.referenceId !== expectedReferenceId ||
    (expectedRunId !== undefined && value.run.id !== expectedRunId) ||
    value.receipt.idempotencyKey !== expectedIdempotencyKey ||
    value.receipt.resultingRunRevision > value.run.runRevision ||
    (!value.replayed && value.receipt.resultingRunRevision !== value.run.runRevision) ||
    (!value.replayed && !value.run.mutationReceipts.some((receipt) =>
      deepEqual(receipt, value.receipt)))
  ) {
    throw new Error('Reference deconstruction mutation returned an invalid payload.');
  }
  return value as unknown as ReferenceDeconstructionRunMutationResult;
}

export function parseReferenceDeconstructionPublishResult(
  value: unknown,
  expectedReferenceId: string,
  expectedRunId: string,
  expectedInput: MutateReferenceDeconstructionRunInput,
): ReferenceDeconstructionPublishResult {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'run',
      'receipt',
      'replayed',
      'pendingAction',
    ])
  ) {
    throw new Error('Reference deconstruction publish returned an invalid payload.');
  }
  parseReferenceDeconstructionRunMutationResult(
    {
      run: value.run,
      receipt: value.receipt,
      replayed: value.replayed,
    },
    expectedReferenceId,
    expectedInput.idempotencyKey,
    expectedRunId,
  );
  if (
    !isReferenceDeconstructionPublishPendingAction(
      value.pendingAction,
      expectedReferenceId,
      expectedRunId,
      expectedInput.baseRunRevision,
    )
  ) {
    throw new Error('Reference deconstruction publish returned an invalid payload.');
  }
  const run = value.run as ReferenceDeconstructionRun;
  const pendingAction =
    value.pendingAction as ReferenceDeconstructionPublishPendingAction;
  if (
    !run.publication
    || run.publication.pendingActionId !== pendingAction.id
    || run.publication.candidateFingerprint !==
      pendingAction.origin.candidateFingerprint
    || pendingAction.touchedFiles.length !== run.publication.files.length
    || pendingAction.touchedFiles.some((path) =>
      !run.publication?.files.some((file) => file.path === path))
    || (pendingAction.status === 'pending' && run.status !== 'publishing')
    || (pendingAction.status === 'accepted' && run.status !== 'completed')
  ) {
    throw new Error('Reference deconstruction publish returned an inconsistent payload.');
  }
  return value as unknown as ReferenceDeconstructionPublishResult;
}

export function isReferenceDeconstructionRun(
  value: unknown,
): value is ReferenceDeconstructionRun {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'referenceId',
      'runRevision',
      'status',
      'sourceChecksumSha256',
      'structureFingerprint',
      'pipelineVersion',
      'capabilityVersion',
      'profileId',
      'outputs',
      'selectedChapterIds',
      'evidence',
      'preview',
      'materialPreview',
      'diagnostics',
      'mutationReceipts',
      'receiptCount',
      'full',
      'publication',
      'createdAt',
      'updatedAt',
      'fullApprovedAt',
    ]) ||
    value.schemaVersion !== 2 ||
    !isSafeId(value.id) ||
    !isSafeId(value.referenceId) ||
    !isNonNegativeSafeInteger(value.runRevision) ||
    !isRunStatus(value.status) ||
    !isSha256(value.sourceChecksumSha256) ||
    !isSha256(value.structureFingerprint) ||
    value.pipelineVersion !== 2 ||
    value.capabilityVersion !== 'novel.deconstruct_reference@2' ||
    !isWritingProfileId(value.profileId) ||
    !isCanonicalWritingProfileOutputs(value.outputs) ||
    !isUniqueSafeIdArray(value.selectedChapterIds, 3) ||
    value.selectedChapterIds.length === 0 ||
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0 ||
    value.evidence.length > 24 ||
    !value.evidence.every((item) => isPreviewEvidence(
      item,
      value.referenceId as string,
      value.sourceChecksumSha256 as string,
      value.selectedChapterIds as string[],
    )) ||
    !hasUniqueIds(value.evidence) ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > 128 ||
    !value.diagnostics.every(isDiagnostic) ||
    !hasUniqueIds(value.diagnostics) ||
    !(value.diagnostics as ReferenceDeconstructionDiagnostic[]).every((diagnostic) =>
      isRunDiagnosticClosed(
        diagnostic,
        value.evidence as ReferencePreviewEvidence[],
        value.full,
        value.diagnostics,
        value.outputs,
      )) ||
    !Array.isArray(value.mutationReceipts) ||
    value.mutationReceipts.length === 0 ||
    value.mutationReceipts.length > 64 ||
    !value.mutationReceipts.every(isReferenceDeconstructionMutationReceipt) ||
    !hasUniqueIds(value.mutationReceipts, 'idempotencyKey') ||
    !isPositiveSafeInteger(value.receiptCount) ||
    value.receiptCount !== (value.runRevision as number) + 1 ||
    value.receiptCount < value.mutationReceipts.length ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    (value.fullApprovedAt !== undefined && !isTimestamp(value.fullApprovedAt)) ||
    (isDefinitelyPostApprovalRunStatus(value.status) &&
      value.fullApprovedAt === undefined) ||
    (value.fullApprovedAt !== undefined &&
      isPreApprovalRunStatus(value.status)) ||
    (value.full !== undefined &&
      !isReferenceDeconstructionFullRun(value.full, value.diagnostics, value.outputs)) ||
    ((value.full === undefined) !== (value.fullApprovedAt === undefined)) ||
    (value.publication !== undefined &&
      !isReferenceDeconstructionPublication(
        value.publication,
        value.referenceId,
        value.outputs,
      )) ||
    ((value.status === 'publishing' || value.status === 'completed') !==
      (value.publication !== undefined)) ||
    ((value.status === 'publishing' || value.status === 'completed') &&
      !isSafeId(
        (value.publication as unknown as Record<string, unknown>)?.pendingActionId,
      )) ||
    (value.preview !== undefined && !isQuickPreview(
      value.preview,
      value.id as string,
      value.referenceId as string,
      value.sourceChecksumSha256 as string,
      new Set((value.evidence as ReferencePreviewEvidence[]).map((item) => item.id)),
      value.selectedChapterIds as string[],
    )) ||
    (value.materialPreview !== undefined && !isStoryMaterialCoveragePreview(
      value.materialPreview,
      value.id as string,
      value.referenceId as string,
      value.sourceChecksumSha256 as string,
      new Set((value.evidence as ReferencePreviewEvidence[]).map((item) => item.id)),
      materialKindsFromOutputs(value.outputs),
    )) ||
    (value.preview !== undefined && !arePreviewDiagnosticsConsistent(
      value.preview,
      value.diagnostics as ReferenceDeconstructionDiagnostic[],
      value.full !== undefined,
    )) ||
    (requiresPreview(value.status, value.fullApprovedAt) && (
      outputsIncludeTechnique(value.outputs) && value.preview === undefined
      || outputsIncludeStoryMaterial(value.outputs) && value.materialPreview === undefined
    )) ||
    (!outputsIncludeTechnique(value.outputs) && value.preview !== undefined) ||
    (!outputsIncludeStoryMaterial(value.outputs) && value.materialPreview !== undefined) ||
    (['reviewReady', 'publishing', 'completed'].includes(value.status as string) &&
      !isReviewReadyFullRun(value.full, value.diagnostics, value.outputs)) ||
    value.mutationReceipts.some((receipt) =>
      receipt.resultingRunRevision > (value.runRevision as number))
  ) {
    return false;
  }

  const receiptRevisions = (value.mutationReceipts as ReferenceDeconstructionMutationReceipt[])
    .map((receipt) => receipt.resultingRunRevision);
  const firstExpectedRevision = (value.receiptCount as number) - receiptRevisions.length;
  return receiptRevisions.every((revision, index) =>
    revision === firstExpectedRevision + index) &&
    receiptRevisions.at(-1) === value.runRevision &&
    (value.mutationReceipts as ReferenceDeconstructionMutationReceipt[]).at(-1)
      ?.resultStatus === value.status;
}

function isReferenceDeconstructionFullRun(
  value: unknown,
  diagnostics: unknown,
  outputs: unknown,
): value is ReferenceDeconstructionFullRun {
  const expectedStages = expectedFullStagePairs(outputs);
  const selectedTracks = trackIdsFromOutputs(outputs);
  if (
    !expectedStages.length ||
    !selectedTracks.length ||
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'stages',
      'progress',
      'nextUnit',
      'currentUnit',
      'failedUnit',
      'recentUnits',
      'recentAttempts',
      'analysisQuality',
    ]) ||
    !Array.isArray(value.stages) ||
    value.stages.length !== expectedStages.length ||
    !value.stages.every(isFullStageSummary) ||
    !value.stages.every((stage, index) =>
      (stage as ReferenceDeconstructionFullStageSummary).track ===
        expectedStages[index]?.track
      && (stage as ReferenceDeconstructionFullStageSummary).stageId ===
        expectedStages[index]?.stageId) ||
    !isFullProgress(value.progress) ||
    (value.nextUnit !== undefined && (
      !isUnitSummary(value.nextUnit) ||
      !selectedTracks.includes(value.nextUnit.track) ||
      value.nextUnit.status !== 'queued'
    )) ||
    (value.currentUnit !== undefined && (
      !isUnitSummary(value.currentUnit) ||
      !selectedTracks.includes(value.currentUnit.track) ||
      value.currentUnit.status !== 'running'
    )) ||
    (value.failedUnit !== undefined && (
      !isUnitSummary(value.failedUnit) ||
      !selectedTracks.includes(value.failedUnit.track) ||
      !['failed', 'interrupted'].includes(value.failedUnit.status)
    )) ||
    !Array.isArray(value.recentUnits) ||
    value.recentUnits.length > MAX_FULL_DECONSTRUCTION_RECENT_ITEMS ||
    !value.recentUnits.every(isUnitSummary) ||
    !(value.recentUnits as ReferenceDeconstructionUnitSummary[]).every((unit) =>
      selectedTracks.includes(unit.track)) ||
    !hasUniqueIds(value.recentUnits) ||
    !hasUniqueOrdinals(value.recentUnits) ||
    !Array.isArray(value.recentAttempts) ||
    value.recentAttempts.length > MAX_FULL_DECONSTRUCTION_RECENT_ITEMS ||
    !value.recentAttempts.every(isAttemptSummary) ||
    !hasUniqueIds(value.recentAttempts) ||
    !hasUniqueAttemptNumbers(value.recentAttempts) ||
    !isAnalysisQualityByTrack(
      value.analysisQuality,
      diagnostics,
      selectedTracks,
    ) ||
    !areSpecialUnitsConsistentWithRecent(value) ||
    !isFullProgressConsistentWithStages(value.progress, value.stages)
  ) {
    return false;
  }

  const progress = value.progress as ReferenceDeconstructionFullProgress;
  const units = [
    ...(value.recentUnits as ReferenceDeconstructionUnitSummary[]),
    ...[value.nextUnit, value.currentUnit, value.failedUnit]
      .filter((item): item is ReferenceDeconstructionUnitSummary => item !== undefined),
  ];
  return units.every((unit) => unit.ordinal <= progress.plannedUnits);
}

function isReferenceDeconstructionPublication(
  value: unknown,
  referenceId: unknown,
  outputs: unknown,
): value is ReferenceDeconstructionPublication {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'candidateFingerprint',
      'pendingActionId',
      'files',
      'entryInventory',
      'materialInventory',
      'preparedAt',
    ])
    || !isSha256(value.candidateFingerprint)
    || (value.pendingActionId !== undefined && !isPendingActionId(value.pendingActionId))
    || !Array.isArray(value.files)
    || value.files.length < 1
    || value.files.length > 4_096
    || !value.files.every((file) =>
      isReferenceDeconstructionPublicationFile(file, referenceId))
    || !hasUniqueStringField(value.files, 'path')
    || !Array.isArray(value.entryInventory)
    || value.entryInventory.length > 50
    || !value.entryInventory.every(isReferenceDeconstructionPublicationEntry)
    || !hasUniqueIds(value.entryInventory)
    || (value.materialInventory !== undefined && (
      !Array.isArray(value.materialInventory)
      || value.materialInventory.length < 1
      || value.materialInventory.length > 320
      || !value.materialInventory.every(isReferenceDeconstructionPublicationMaterialEntry)
      || !hasUniqueIds(value.materialInventory)
    ))
    || !isTimestamp(value.preparedAt)
  ) {
    return false;
  }
  const entries = value.entryInventory as ReferenceDeconstructionPublicationEntry[];
  const techniqueInventoryValid = [...DISTILLED_CATEGORIES].every((category) => {
    const count = entries.filter((entry) => entry.category === category).length;
    return count >= 1 && count <= 12;
  });
  if (outputsIncludeTechnique(outputs) !== techniqueInventoryValid) return false;
  if (!outputsIncludeTechnique(outputs) && entries.length !== 0) return false;
  const files = value.files as ReferenceDeconstructionPublicationFile[];
  const selectedMaterialKinds = materialKindsFromOutputs(outputs);
  const publishedMaterialKinds = files
    .filter((file) => file.kind === 'materials')
    .map((file) => publicationMaterialKind(file.path, referenceId));
  const materialInventory = (value.materialInventory ?? []) as
    ReferenceDeconstructionPublicationMaterialInventoryItem[];
  if (
    !outputsIncludeStoryMaterial(outputs)
    && (value.materialInventory !== undefined || files.some((file) => file.kind === 'materials'))
  ) {
    return false;
  }
  return !outputsIncludeStoryMaterial(outputs) || (
    publishedMaterialKinds.length === selectedMaterialKinds.length
    && publishedMaterialKinds.every((kind) =>
      kind !== undefined && selectedMaterialKinds.includes(kind))
    && materialInventory.every((entry) =>
      selectedMaterialKinds.includes(entry.materialKind))
  );
}

function publicationMaterialKind(
  path: string,
  referenceId: unknown,
): ReferenceStoryMaterialKind | undefined {
  if (!isSafeId(referenceId)) return undefined;
  const prefix = `examples/references/${referenceId}/materials/`;
  if (!path.startsWith(prefix) || !path.endsWith('.yaml')) return undefined;
  const kind = path.slice(prefix.length, -'.yaml'.length);
  return isStoryMaterialKind(kind) ? kind : undefined;
}

function isReferenceDeconstructionPublicationMaterialEntry(
  value: unknown,
): value is ReferenceDeconstructionPublicationMaterialInventoryItem {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'id',
      'materialKind',
      'title',
      'assertionType',
      'confidence',
      'path',
    ])
    && isSafeId(value.id)
    && isStoryMaterialKind(value.materialKind)
    && isBoundedText(value.title, 300)
    && (
      value.assertionType === 'fact'
      || value.assertionType === 'interpretation'
      || value.assertionType === 'uncertain'
    )
    && isConfidence(value.confidence)
    && value.path === `materials/${value.materialKind}.yaml`;
}

function isReferenceDeconstructionPublicationFile(
  value: unknown,
  referenceId: unknown,
): value is ReferenceDeconstructionPublicationFile {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, ['path', 'checksumSha256', 'kind'])
    || typeof value.path !== 'string'
    || !isSafeRelativePath(value.path)
    || !isSha256(value.checksumSha256)
    || typeof value.kind !== 'string'
    || !PUBLICATION_FILE_KINDS.has(value.kind)
    || !isSafeId(referenceId)
  ) {
    return false;
  }
  const bundlePrefix = `examples/references/${referenceId}/`;
  if (value.kind === 'index') return value.path === 'examples/references.yaml';
  if (!value.path.startsWith(bundlePrefix)) return false;
  const relativePath = value.path.slice(bundlePrefix.length);
  switch (value.kind) {
    case 'manifest':
      return relativePath === 'deconstruction-manifest.yaml';
    case 'diagnostics':
      return relativePath === 'diagnostics.yaml';
    case 'progress':
      return relativePath === 'progress.yaml';
    case 'deconstruction':
      return relativePath.startsWith('deconstruction/')
        && relativePath.endsWith('.md');
    case 'distilled':
      return relativePath.startsWith('distilled/')
        && relativePath.endsWith('.md');
    case 'materials':
      return relativePath.startsWith('materials/')
        && relativePath.endsWith('.yaml');
    case 'context':
      return relativePath.startsWith('context/')
        && (relativePath.endsWith('.md') || relativePath.endsWith('.yaml'));
    default:
      return false;
  }
}

function isReferenceDeconstructionPublicationEntry(
  value: unknown,
): value is ReferenceDeconstructionPublicationEntry {
  return isRecord(value)
    && hasOnlyKnownFields(value, [
      'id',
      'category',
      'title',
      'estimatedTokens',
    ])
    && isSafeId(value.id)
    && typeof value.category === 'string'
    && DISTILLED_CATEGORIES.has(value.category)
    && isBoundedText(value.title, 500)
    && isPositiveSafeInteger(value.estimatedTokens)
    && value.estimatedTokens <= MAX_REFERENCE_DISTILLED_ENTRY_TOKENS;
}

function isReferenceDeconstructionPublishPendingAction(
  value: unknown,
  referenceId: string,
  runId: string,
  runRevision: number,
): value is ReferenceDeconstructionPublishPendingAction {
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
      'acceptedAt',
      'rejectedAt',
      'origin',
    ])
    || !isPendingActionId(value.id)
    || !isBoundedText(value.title, 1_000)
    || !isBoundedText(value.description, 4_000)
    || !Array.isArray(value.touchedFiles)
    || value.touchedFiles.length < 1
    || value.touchedFiles.length > 4_096
    || !value.touchedFiles.every(isSafeRelativePath)
    || new Set(value.touchedFiles).size !== value.touchedFiles.length
    || typeof value.diff !== 'string'
    || value.diff.length > 10_000_000
    || !isTimestamp(value.createdAt)
    || (value.status !== 'pending' && value.status !== 'accepted')
    || (value.acceptedAt !== undefined && !isTimestamp(value.acceptedAt))
    || value.rejectedAt !== undefined
    || !isRecord(value.origin)
    || !hasOnlyKnownFields(value.origin, [
      'kind',
      'referenceId',
      'runId',
      'runRevision',
      'candidateFingerprint',
    ])
    || value.origin.kind !== 'referenceDeconstructionPublish'
    || value.origin.referenceId !== referenceId
    || value.origin.runId !== runId
    || value.origin.runRevision !== runRevision
    || !isSha256(value.origin.candidateFingerprint)
  ) {
    return false;
  }
  return value.status === 'accepted'
    ? value.acceptedAt !== undefined
    : value.acceptedAt === undefined;
}

function isFullStageSummary(
  value: unknown,
): value is ReferenceDeconstructionFullStageSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'track',
      'stageId',
      'status',
      'plannedUnits',
      'completedUnits',
      'failedUnits',
    ]) ||
    !isTrackId(value.track) ||
    !FULL_STAGE_IDS.includes(value.stageId as ReferenceDeconstructionStageId) ||
    !isStageOwnedByTrack(value.stageId, value.track) ||
    !isReferenceStageStatus(value.status) ||
    !isBoundedUnitCount(value.plannedUnits) ||
    !isBoundedUnitCount(value.completedUnits) ||
    !isBoundedUnitCount(value.failedUnits) ||
    (value.completedUnits as number) + (value.failedUnits as number) >
      (value.plannedUnits as number)
  ) {
    return false;
  }
  if (
    value.status === 'notStarted' &&
    (value.completedUnits !== 0 || value.failedUnits !== 0)
  ) return false;
  if (
    value.status === 'completed' &&
    (
      value.completedUnits !== value.plannedUnits ||
      value.failedUnits !== 0
    )
  ) return false;
  return value.status !== 'failed' || (value.failedUnits as number) > 0;
}

function isFullProgress(
  value: unknown,
): value is ReferenceDeconstructionFullProgress {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'plannedUnits',
      'completedUnits',
      'failedUnits',
      'completedChapters',
      'totalChapters',
      'percent',
    ]) ||
    !isPositiveSafeInteger(value.plannedUnits) ||
    (value.plannedUnits as number) > MAX_FULL_DECONSTRUCTION_UNITS ||
    !isBoundedUnitCount(value.completedUnits) ||
    !isBoundedUnitCount(value.failedUnits) ||
    (value.completedUnits as number) + (value.failedUnits as number) >
      (value.plannedUnits as number) ||
    !isNonNegativeSafeInteger(value.completedChapters) ||
    !isPositiveSafeInteger(value.totalChapters) ||
    (value.totalChapters as number) > MAX_FULL_DECONSTRUCTION_UNITS ||
    (value.completedChapters as number) > (value.totalChapters as number) ||
    (value.totalChapters as number) > (value.plannedUnits as number) ||
    !isPercent(value.percent)
  ) {
    return false;
  }
  return value.percent === Math.round(
    ((value.completedUnits as number) / (value.plannedUnits as number)) * 100,
  );
}

function isUnitSummary(
  value: unknown,
): value is ReferenceDeconstructionUnitSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'ordinal',
      'track',
      'stageId',
      'kind',
      'chapterId',
      'chunkId',
      'status',
      'attemptCount',
      'selectedAttemptId',
    ]) ||
    !isSafeId(value.id) ||
    !isPositiveSafeInteger(value.ordinal) ||
    (value.ordinal as number) > MAX_FULL_DECONSTRUCTION_UNITS ||
    !isTrackId(value.track) ||
    !FULL_STAGE_IDS.includes(value.stageId as ReferenceDeconstructionStageId) ||
    !isStageOwnedByTrack(value.stageId, value.track) ||
    typeof value.kind !== 'string' ||
    !UNIT_KINDS.has(value.kind) ||
    typeof value.status !== 'string' ||
    !UNIT_STATUSES.has(value.status) ||
    !isNonNegativeSafeInteger(value.attemptCount) ||
    (value.attemptCount as number) > 4_096 ||
    (value.selectedAttemptId !== undefined && !isSafeId(value.selectedAttemptId))
  ) {
    return false;
  }

  const isChapterChunk = value.kind === 'chapterChunk';
  if (
    isChapterChunk !== (
      (
        value.stageId === 'chapterAnalysis'
        || value.stageId === 'materialChapterAnalysis'
      ) &&
      isSafeId(value.chapterId) &&
      isSafeId(value.chunkId)
    )
  ) return false;
  if (
    !isChapterChunk &&
    (value.chapterId !== undefined || value.chunkId !== undefined)
  ) return false;
  if (
    (value.kind === 'aggregate') !== (
      value.stageId === 'aggregateAnalysis'
      || value.stageId === 'materialAggregateAnalysis'
    ) ||
    (value.kind === 'style') !== (value.stageId === 'styleProfile') ||
    (value.kind === 'distill') !== (value.stageId === 'distillForOan') ||
    (value.kind === 'materialProjection') !==
      (value.stageId === 'materialProjection') ||
    (value.kind === 'analysisQuality') !== (value.stageId === 'qualityGate')
  ) return false;
  if (
    value.status === 'queued' &&
    value.selectedAttemptId !== undefined
  ) return false;
  if (
    value.status !== 'queued' &&
    (value.attemptCount as number) < 1
  ) return false;
  return value.status === 'completed'
    ? value.selectedAttemptId !== undefined
    : value.selectedAttemptId === undefined;
}

function isAttemptSummary(
  value: unknown,
): value is ReferenceDeconstructionAttemptSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'id',
      'unitId',
      'attemptNumber',
      'status',
      'inputFingerprint',
      'outputHash',
      'startedAt',
      'completedAt',
    ]) ||
    !isSafeId(value.id) ||
    !isSafeId(value.unitId) ||
    !isPositiveSafeInteger(value.attemptNumber) ||
    (value.attemptNumber as number) > 4_096 ||
    typeof value.status !== 'string' ||
    !ATTEMPT_STATUSES.has(value.status) ||
    !isSha256(value.inputFingerprint) ||
    (value.outputHash !== undefined && !isSha256(value.outputHash)) ||
    !isTimestamp(value.startedAt) ||
    (value.completedAt !== undefined && !isTimestamp(value.completedAt)) ||
    (value.completedAt !== undefined &&
      Date.parse(value.completedAt as string) < Date.parse(value.startedAt as string))
  ) {
    return false;
  }
  if (value.status === 'running') {
    return value.completedAt === undefined && value.outputHash === undefined;
  }
  if (value.completedAt === undefined) return false;
  return value.status !== 'completed' || value.outputHash !== undefined;
}

function isAnalysisQuality(
  value: unknown,
  diagnostics: unknown,
): value is ReferenceDeconstructionAnalysisQuality {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'status',
      'coveragePercent',
      'blockingDiagnosticCount',
      'outputHashes',
    ]) ||
    typeof value.status !== 'string' ||
    !ANALYSIS_QUALITY_STATUSES.has(value.status) ||
    !isPercent(value.coveragePercent) ||
    !isNonNegativeSafeInteger(value.blockingDiagnosticCount) ||
    (value.blockingDiagnosticCount as number) > 128 ||
    !Array.isArray(value.outputHashes) ||
    value.outputHashes.length > MAX_FULL_DECONSTRUCTION_UNITS ||
    !value.outputHashes.every(isSha256) ||
    new Set(value.outputHashes).size !== value.outputHashes.length ||
    !Array.isArray(diagnostics) ||
    (value.blockingDiagnosticCount as number) > diagnostics.filter((diagnostic) =>
      isRecord(diagnostic) && diagnostic.blocking === true).length
  ) {
    return false;
  }
  if (value.status === 'passed') {
    return value.coveragePercent === 100 &&
      value.blockingDiagnosticCount === 0 &&
      value.outputHashes.length > 0;
  }
  if (value.status === 'warned') {
    return value.coveragePercent === 100 &&
      value.blockingDiagnosticCount === 0 &&
      value.outputHashes.length > 0 &&
      diagnostics.length > 0 &&
      diagnostics.some((diagnostic) =>
        isRecord(diagnostic) && diagnostic.blocking === false);
  }
  if (value.status === 'notEvaluated') {
    return value.coveragePercent === 0 && value.outputHashes.length === 0;
  }
  return (value.blockingDiagnosticCount as number) > 0;
}

function isAnalysisQualityByTrack(
  value: unknown,
  diagnostics: unknown,
  selectedTracks: readonly ReferenceDeconstructionTrackId[],
): value is ReferenceDeconstructionFullRun['analysisQuality'] {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === selectedTracks.length
    && keys.every((key) => isTrackId(key) && selectedTracks.includes(key))
    && selectedTracks.every((track) => isAnalysisQuality(value[track], diagnostics));
}

function isFullProgressConsistentWithStages(
  progressValue: unknown,
  stagesValue: unknown,
): boolean {
  if (!isFullProgress(progressValue) || !Array.isArray(stagesValue)) return false;
  const stages = stagesValue as ReferenceDeconstructionFullStageSummary[];
  return sum(stages.map((stage) => stage.plannedUnits)) === progressValue.plannedUnits &&
    sum(stages.map((stage) => stage.completedUnits)) === progressValue.completedUnits &&
    sum(stages.map((stage) => stage.failedUnits)) === progressValue.failedUnits;
}

function areSpecialUnitsConsistentWithRecent(
  value: Record<string, unknown>,
): boolean {
  const recentUnits = value.recentUnits as ReferenceDeconstructionUnitSummary[];
  return [value.nextUnit, value.currentUnit, value.failedUnit]
    .filter((item): item is ReferenceDeconstructionUnitSummary => item !== undefined)
    .every((unit) => {
      const recent = recentUnits.find((candidate) => candidate.id === unit.id);
      return !recent || deepEqual(recent, unit);
    });
}

function hasUniqueOrdinals(value: readonly unknown[]): boolean {
  const ordinals = value.map((item) =>
    isRecord(item) && isNonNegativeSafeInteger(item.ordinal)
      ? item.ordinal
      : undefined);
  return ordinals.every((ordinal): ordinal is number => ordinal !== undefined) &&
    new Set(ordinals).size === ordinals.length;
}

function hasUniqueAttemptNumbers(value: readonly unknown[]): boolean {
  const identities = value.map((item) =>
    isRecord(item) && typeof item.unitId === 'string' &&
    isPositiveSafeInteger(item.attemptNumber)
      ? `${item.unitId}\u0000${item.attemptNumber}`
      : undefined);
  return identities.every((identity): identity is string => identity !== undefined) &&
    new Set(identities).size === identities.length;
}

function isBoundedUnitCount(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) &&
    value <= MAX_FULL_DECONSTRUCTION_UNITS;
}

function isPercent(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isReviewReadyFullRun(
  value: unknown,
  diagnostics: unknown,
  outputs: unknown,
): boolean {
  if (!isReferenceDeconstructionFullRun(value, diagnostics, outputs)) return false;
  const selectedTracks = trackIdsFromOutputs(outputs);
  return value.progress.completedUnits === value.progress.plannedUnits &&
    value.progress.failedUnits === 0 &&
    value.progress.completedChapters === value.progress.totalChapters &&
    value.progress.percent === 100 &&
    value.nextUnit === undefined &&
    value.currentUnit === undefined &&
    value.failedUnit === undefined &&
    value.stages.every((stage) => stage.status === 'completed') &&
    selectedTracks.every((track) => {
      const quality = value.analysisQuality[track];
      return Boolean(
        quality
        && (quality.status === 'passed' || quality.status === 'warned')
        && quality.coveragePercent === 100
        && quality.blockingDiagnosticCount === 0,
      );
    }) &&
    Array.isArray(diagnostics) &&
    !diagnostics.some((diagnostic) =>
      isRecord(diagnostic) && diagnostic.blocking === true);
}

function isRunDiagnosticClosed(
  diagnostic: ReferenceDeconstructionDiagnostic,
  evidence: readonly ReferencePreviewEvidence[],
  full: unknown,
  diagnostics: unknown,
  outputs: unknown,
): boolean {
  const fullRun = full === undefined
    ? undefined
    : isReferenceDeconstructionFullRun(full, diagnostics, outputs)
      ? full
      : undefined;
  if (diagnostic.unitId !== undefined && !fullRun) return false;
  const previewClosed = diagnostic.evidenceRefs.every((id) =>
    evidence.some((item) => item.id === id));
  if (previewClosed && diagnostic.attemptId === undefined) return true;
  if (diagnostic.unitId === undefined || !fullRun) return false;
  if (diagnostic.attemptId === undefined) return true;
  const attempt = fullRun.recentAttempts.find((item) =>
    item.id === diagnostic.attemptId);
  return attempt === undefined || attempt.unitId === diagnostic.unitId;
}

function arePreviewDiagnosticsConsistent(
  preview: ReferenceQuickPreview,
  diagnostics: readonly ReferenceDeconstructionDiagnostic[],
  hasFullRun: boolean,
): boolean {
  if (!hasFullRun) return deepEqual(diagnostics, preview.diagnostics);
  return preview.diagnostics.every((diagnostic) =>
    diagnostics.some((candidate) =>
      candidate.id === diagnostic.id && deepEqual(candidate, diagnostic)));
}

function isQuickPreview(
  value: unknown,
  runId: string,
  referenceId: string,
  checksum: string,
  evidenceIds: ReadonlySet<string>,
  selectedChapterIds: readonly string[],
): value is ReferenceQuickPreview {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'version',
      'runId',
      'referenceId',
      'sourceChecksumSha256',
      'sourceOverview',
      'chapterPreviews',
      'findings',
      'borrowablePatterns',
      'doNotCopy',
      'differentiationRequirements',
      'differentiationPrompts',
      'canonContaminationWarnings',
      'confidence',
      'uncertainties',
      'coverage',
      'diagnostics',
    ]) ||
    value.version !== 2 ||
    value.runId !== runId ||
    value.referenceId !== referenceId ||
    value.sourceChecksumSha256 !== checksum ||
    !isBoundedText(value.sourceOverview, 8_000) ||
    !Array.isArray(value.chapterPreviews) ||
    value.chapterPreviews.length === 0 ||
    value.chapterPreviews.length > 3 ||
    !value.chapterPreviews.every((item) =>
      isChapterPreview(item, evidenceIds, selectedChapterIds)) ||
    !hasUniqueIds(value.chapterPreviews) ||
    new Set((value.chapterPreviews as ReferenceQuickPreviewChapter[])
      .map((item) => item.chapterId)).size !== value.chapterPreviews.length ||
    !Array.isArray(value.findings) ||
    value.findings.length === 0 ||
    value.findings.length > 48 ||
    !value.findings.every((item) => isFinding(item, evidenceIds)) ||
    !hasUniqueIds(value.findings) ||
    !Array.isArray(value.borrowablePatterns) ||
    value.borrowablePatterns.length === 0 ||
    value.borrowablePatterns.length > 24 ||
    !value.borrowablePatterns.every((item) => isBorrowablePattern(item, evidenceIds)) ||
    !hasUniqueIds(value.borrowablePatterns) ||
    !isBoundedStringArray(value.doNotCopy, 32, 2_000) ||
    value.doNotCopy.length === 0 ||
    !isBoundedStringArray(value.differentiationRequirements, 32, 2_000) ||
    value.differentiationRequirements.length === 0 ||
    !isBoundedStringArray(value.differentiationPrompts, 32, 2_000) ||
    value.differentiationPrompts.length === 0 ||
    !isBoundedStringArray(value.canonContaminationWarnings, 32, 2_000) ||
    value.canonContaminationWarnings.length === 0 ||
    !isConfidence(value.confidence) ||
    !isBoundedStringArray(value.uncertainties, 32, 2_000) ||
    !isCoverage(value.coverage, selectedChapterIds, evidenceIds.size) ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > 128 ||
    !value.diagnostics.every(isDiagnostic) ||
    !hasUniqueIds(value.diagnostics)
  ) {
    return false;
  }
  return allEvidenceRefs(value, evidenceIds) && coverageCitationsMatch(value);
}

function isStoryMaterialCoveragePreview(
  value: unknown,
  runId: string,
  referenceId: string,
  checksum: string,
  evidenceIds: ReadonlySet<string>,
  selectedMaterialKinds: readonly ReferenceStoryMaterialKind[],
): value is ReferenceStoryMaterialCoveragePreview {
  if (
    !selectedMaterialKinds.length
    || !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'version',
      'runId',
      'referenceId',
      'sourceChecksumSha256',
      'track',
      'materialKinds',
      'items',
      'uncertainties',
    ])
    || value.version !== 2
    || value.runId !== runId
    || value.referenceId !== referenceId
    || value.sourceChecksumSha256 !== checksum
    || value.track !== 'storyMaterial'
    || !Array.isArray(value.materialKinds)
    || !arraysEqual(value.materialKinds, selectedMaterialKinds)
    || !value.materialKinds.every(isStoryMaterialKind)
    || !Array.isArray(value.items)
    || value.items.length !== selectedMaterialKinds.length
    || !value.items.every((item) => isStoryMaterialCoverageItem(item, evidenceIds))
    || !hasUniqueIds(value.items)
    || !isBoundedStringArray(value.uncertainties, 32, 2_000)
  ) {
    return false;
  }
  return (value.items as ReferenceStoryMaterialCoverageItem[]).every((item, index) =>
    item.materialKind === selectedMaterialKinds[index]);
}

function isStoryMaterialCoverageItem(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): value is ReferenceStoryMaterialCoverageItem {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'id',
      'materialKind',
      'coverage',
      'summary',
      'confidence',
      'evidenceRefs',
      'uncertainty',
    ])
    || !isSafeId(value.id)
    || !isStoryMaterialKind(value.materialKind)
    || typeof value.coverage !== 'string'
    || !STORY_MATERIAL_COVERAGE_LEVELS.has(value.coverage)
    || !isBoundedText(value.summary, 4_000)
    || !isConfidence(value.confidence)
    || !isEvidenceRefArray(
      value.evidenceRefs,
      evidenceIds,
      16,
      value.coverage !== 'none',
    )
    || (value.uncertainty !== undefined && !isBoundedText(value.uncertainty, 2_000))
  ) {
    return false;
  }
  return value.coverage !== 'none' || value.uncertainty !== undefined;
}

function isChapterPreview(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  selectedChapterIds: readonly string[],
): value is ReferenceQuickPreviewChapter {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'id',
      'chapterId',
      'summary',
      'evidenceRefs',
      'confidence',
      'uncertainty',
    ]) &&
    isSafeId(value.id) &&
    isSafeId(value.chapterId) &&
    selectedChapterIds.includes(value.chapterId) &&
    isBoundedText(value.summary, 4_000) &&
    isEvidenceRefArray(value.evidenceRefs, evidenceIds, 32, true) &&
    isConfidence(value.confidence) &&
    (value.uncertainty === undefined || isBoundedText(value.uncertainty, 2_000));
}

function isFinding(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): value is ReferenceQuickPreviewFinding {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'id',
      'kind',
      'observation',
      'technique',
      'whenUseful',
      'avoid',
      'confidence',
      'evidenceRefs',
      'generalInference',
      'uncertainty',
    ]) &&
    isSafeId(value.id) &&
    typeof value.kind === 'string' && FINDING_KINDS.has(value.kind) &&
    isBoundedText(value.observation, 4_000) &&
    isBoundedText(value.technique, 3_000) &&
    (value.whenUseful === undefined || isBoundedText(value.whenUseful, 2_000)) &&
    (value.avoid === undefined || isBoundedText(value.avoid, 2_000)) &&
    isConfidence(value.confidence) &&
    typeof value.generalInference === 'boolean' &&
    isEvidenceRefArray(value.evidenceRefs, evidenceIds, 32, !value.generalInference) &&
    (value.uncertainty === undefined || isBoundedText(value.uncertainty, 2_000)) &&
    (!value.generalInference || value.uncertainty !== undefined);
}

function isBorrowablePattern(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): value is ReferenceQuickPreviewBorrowablePattern {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'id',
      'title',
      'technique',
      'whenUseful',
      'evidenceRefs',
      'confidence',
    ]) &&
    isSafeId(value.id) &&
    isBoundedText(value.title, 300) &&
    isBoundedText(value.technique, 3_000) &&
    (value.whenUseful === undefined || isBoundedText(value.whenUseful, 2_000)) &&
    isEvidenceRefArray(value.evidenceRefs, evidenceIds, 32, true) &&
    isConfidence(value.confidence);
}

function isCoverage(
  value: unknown,
  selectedChapterIds: readonly string[],
  selectedPointerCount: number,
): boolean {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'selectedChapterIds',
      'analyzedChapterIds',
      'selectedPointerCount',
      'citedPointerCount',
      'chapterCoveragePercent',
    ]) &&
    isUniqueSafeIdArray(value.selectedChapterIds, 3) &&
    arraysEqual(value.selectedChapterIds, selectedChapterIds) &&
    isUniqueSafeIdArray(value.analyzedChapterIds, 3) &&
    (value.analyzedChapterIds as string[]).every((id) => selectedChapterIds.includes(id)) &&
    value.selectedPointerCount === selectedPointerCount &&
    isNonNegativeSafeInteger(value.citedPointerCount) &&
    (value.citedPointerCount as number) <= selectedPointerCount &&
    typeof value.chapterCoveragePercent === 'number' &&
    Number.isFinite(value.chapterCoveragePercent) &&
    value.chapterCoveragePercent === Math.round(
      ((value.analyzedChapterIds as string[]).length / selectedChapterIds.length) * 100,
    );
}

function isPreviewEvidence(
  value: unknown,
  referenceId: string,
  checksum: string,
  selectedChapterIds: readonly string[],
): value is ReferencePreviewEvidence {
  return isRecord(value) &&
    hasOnlyKnownFields(value, ['id', 'pointer']) &&
    isSafeId(value.id) &&
    isRecord(value.pointer) &&
    hasOnlyKnownFields(value.pointer, [
      'referenceId',
      'sourceChecksumSha256',
      'chapterId',
      'chunkId',
      'lineStart',
      'lineEnd',
    ]) &&
    value.pointer.referenceId === referenceId &&
    value.pointer.sourceChecksumSha256 === checksum &&
    isSafeId(value.pointer.chapterId) &&
    selectedChapterIds.includes(value.pointer.chapterId) &&
    isSafeId(value.pointer.chunkId) &&
    isPositiveSafeInteger(value.pointer.lineStart) &&
    isPositiveSafeInteger(value.pointer.lineEnd) &&
    (value.pointer.lineStart as number) <= (value.pointer.lineEnd as number);
}

function isDiagnostic(value: unknown): value is ReferenceDeconstructionDiagnostic {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'id',
      'severity',
      'code',
      'message',
      'blocking',
      'evidenceRefs',
      'stageId',
      'chapterId',
      'pointerId',
      'unitId',
      'attemptId',
    ]) &&
    isSafeId(value.id) &&
    typeof value.severity === 'string' && DIAGNOSTIC_SEVERITIES.has(value.severity) &&
    isBoundedText(value.code, 128) &&
    isBoundedText(value.message, 4_000) &&
    typeof value.blocking === 'boolean' &&
    isUniqueSafeIdArray(value.evidenceRefs, 32) &&
    (value.stageId === undefined || isReferenceStage(value.stageId)) &&
    (value.chapterId === undefined || isSafeId(value.chapterId)) &&
    (value.unitId === undefined || isSafeId(value.unitId)) &&
    (value.attemptId === undefined || isSafeId(value.attemptId)) &&
    (value.attemptId === undefined || value.unitId !== undefined) &&
    (value.pointerId === undefined || (
      isSafeId(value.pointerId) &&
      (value.evidenceRefs as string[]).includes(value.pointerId)
    ));
}

function isReferenceDeconstructionMutationReceipt(
  value: unknown,
): value is ReferenceDeconstructionMutationReceipt {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'idempotencyKey',
      'requestFingerprint',
      'resultingRunRevision',
      'resultStatus',
    ]) &&
    isSafeId(value.idempotencyKey) &&
    isSha256(value.requestFingerprint) &&
    isNonNegativeSafeInteger(value.resultingRunRevision) &&
    isRunStatus(value.resultStatus);
}

function isReferenceWorkSummary(value: unknown): value is ReferenceWorkSummary {
  if (!isRecord(value)) return false;
  const allowed = [
    'id',
    'title',
    'sourceType',
    'rights',
    'allowedUsage',
    'enabled',
    'importedAt',
    'checksumSha256',
    'bundlePath',
    'summaryPath',
    'distilledPaths',
    'chapterCount',
    'structureConfidence',
    'progress',
    'deconstructionStatus',
    'contextEligible',
    'readinessReason',
    'publishedContext',
  ];
  return hasOnlyKnownFields(value, allowed) &&
    isSafeId(value.id) &&
    isBoundedText(value.title, 500) &&
    isReferenceSourceType(value.sourceType) &&
    isReferenceRights(value.rights) &&
    Array.isArray(value.allowedUsage) &&
    value.allowedUsage.length <= 4 &&
    value.allowedUsage.every(isReferenceAllowedUsage) &&
    new Set(value.allowedUsage).size === value.allowedUsage.length &&
    typeof value.enabled === 'boolean' &&
    isTimestamp(value.importedAt) &&
    isSha256(value.checksumSha256) &&
    value.bundlePath === `examples/references/${value.id}` &&
    value.summaryPath === `${value.bundlePath}/context/reference-summary.md` &&
    Array.isArray(value.distilledPaths) &&
    value.distilledPaths.length <= 32 &&
    value.distilledPaths.every((path) =>
      isSafeRelativePath(path) && path.startsWith(`${value.bundlePath}/distilled/`)) &&
    new Set(value.distilledPaths).size === value.distilledPaths.length &&
    isPositiveSafeInteger(value.chapterCount) &&
    isConfidence(value.structureConfidence) &&
    isReferenceProgress(value.progress) &&
    (value.progress as Record<string, unknown>).referenceId === value.id &&
    (value.progress as Record<string, unknown>).status === value.deconstructionStatus &&
    (value.progress as Record<string, unknown>).contextEligible === value.contextEligible &&
    isPublishedDeconstructionStatus(value.deconstructionStatus) &&
    typeof value.contextEligible === 'boolean' &&
    isReferenceReadinessReason(value.readinessReason) &&
    (value.publishedContext === undefined ||
      isPublishedReferenceContext(value.publishedContext)) &&
    ((value.deconstructionStatus === 'completed') ===
      (value.publishedContext !== undefined)) &&
    isReferenceSummaryReadinessConsistent(value) &&
    (!value.contextEligible || value.deconstructionStatus === 'completed');
}

function isPublishedReferenceContext(value: unknown): boolean {
  if (
    !isRecord(value)
    || !hasOnlyKnownFields(value, [
      'runId',
      'fingerprint',
      'entryCount',
      'categoryCounts',
    ])
    || !isSafeId(value.runId)
    || !isSha256(value.fingerprint)
    || !isNonNegativeSafeInteger(value.entryCount)
    || value.entryCount > 50
    || !isRecord(value.categoryCounts)
    || Object.keys(value.categoryCounts).length !== DISTILLED_CATEGORIES.size
    || ![...DISTILLED_CATEGORIES].every((category) =>
      isNonNegativeSafeInteger(
        (value.categoryCounts as Record<string, unknown>)[category],
      )
      && Number((value.categoryCounts as Record<string, unknown>)[category]) <= 12)
  ) {
    return false;
  }
  const categoryCounts = value.categoryCounts as Record<string, unknown>;
  const entryCount = value.entryCount as number;
  return Object.values(categoryCounts)
    .reduce<number>((total, count) => total + Number(count), 0) === entryCount
    && (
      entryCount === 0
      || [...DISTILLED_CATEGORIES].every((category) => Number(categoryCounts[category]) > 0)
    );
}

function isReferenceSummaryReadinessConsistent(
  value: Record<string, unknown>,
): boolean {
  if (value.contextEligible === true) {
    return value.enabled === true &&
      value.deconstructionStatus === 'completed' &&
      value.readinessReason === 'ready';
  }
  if (value.readinessReason === 'ready') return false;
  if (value.readinessReason === 'disabled') return value.enabled === false;
  if (value.deconstructionStatus === 'completed') {
    const publishedContext = value.publishedContext;
    return value.enabled === true
      && value.readinessReason === 'techniqueTrackNotPublished'
      && isRecord(publishedContext)
      && publishedContext.entryCount === 0;
  }
  if (value.deconstructionStatus === 'notAnalyzed') {
    return value.readinessReason === 'notAnalyzed';
  }
  if (value.deconstructionStatus === 'stale') {
    return value.readinessReason === 'stale'
      || value.readinessReason === 'invalidContextIndex';
  }
  if (value.deconstructionStatus === 'qualityFailed') {
    return value.readinessReason === 'qualityFailed';
  }
  if (value.deconstructionStatus === 'needsRebuild') {
    return value.readinessReason === 'needsRebuild' ||
      value.readinessReason === 'missingContextSummary';
  }
  return false;
}

function isReferenceProgress(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasOnlyKnownFields(value, [
    'version',
    'referenceId',
    'status',
    'currentStage',
    'nextStage',
    'completedStages',
    'failedStages',
    'stages',
    'resumable',
    'contextEligible',
    'updatedAt',
  ]) &&
    value.version === 2 &&
    isSafeId(value.referenceId) &&
    isPublishedDeconstructionStatus(value.status) &&
    (value.currentStage === null || isReferenceStage(value.currentStage)) &&
    (value.nextStage === null || isReferenceStage(value.nextStage)) &&
    Array.isArray(value.completedStages) &&
    value.completedStages.length <= 10 &&
    value.completedStages.every(isReferenceStage) &&
    new Set(value.completedStages).size === value.completedStages.length &&
    Array.isArray(value.failedStages) &&
    value.failedStages.length <= 10 &&
    value.failedStages.every((item) =>
      isRecord(item) &&
      hasOnlyKnownFields(item, ['stage', 'message', 'failedAt']) &&
      isReferenceStage(item.stage) &&
      isBoundedText(item.message, 2_000) &&
      isTimestamp(item.failedAt)) &&
    isReferenceStageStatusRecord(value.stages) &&
    typeof value.resumable === 'boolean' &&
    typeof value.contextEligible === 'boolean' &&
    isTimestamp(value.updatedAt);
}

function isReferenceSourceManifest(value: unknown): value is ReferenceSourceManifest {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'version',
      'referenceId',
      'originalFile',
      'originalFileName',
      'sourcePath',
      'checksumSha256',
      'structureFingerprint',
      'importedAt',
      'byteLength',
      'charLength',
      'lineCount',
      'detectedStructure',
    ]) ||
    value.version !== 1 ||
    !isSafeId(value.referenceId) ||
    !isBoundedText(value.originalFile, 256) ||
    (value.originalFile as string).includes('/') ||
    (value.originalFile as string).includes('\\') ||
    !isBoundedText(value.originalFileName, 1_024) ||
    (value.sourcePath !== undefined && !isBoundedText(value.sourcePath, 4_096)) ||
    !isSha256(value.checksumSha256) ||
    !isSha256(value.structureFingerprint) ||
    !isTimestamp(value.importedAt) ||
    !isNonNegativeSafeInteger(value.byteLength) ||
    !isNonNegativeSafeInteger(value.charLength) ||
    !isPositiveSafeInteger(value.lineCount) ||
    !isRecord(value.detectedStructure) ||
    !hasOnlyKnownFields(value.detectedStructure, [
      'chapterCount',
      'confidence',
      'chapters',
    ]) ||
    !isPositiveSafeInteger(value.detectedStructure.chapterCount) ||
    !isConfidence(value.detectedStructure.confidence) ||
    !Array.isArray(value.detectedStructure.chapters) ||
    value.detectedStructure.chapters.length > 100_000 ||
    value.detectedStructure.chapters.length !== value.detectedStructure.chapterCount ||
    !value.detectedStructure.chapters.every(isChapterBoundary) ||
    !hasUniqueIds(value.detectedStructure.chapters)
  ) {
    return false;
  }
  return true;
}

function isChapterBoundary(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKnownFields(value, ['id', 'title', 'lineStart', 'lineEnd', 'wordCount']) &&
    isSafeId(value.id) &&
    isBoundedText(value.title, 1_000) &&
    isPositiveSafeInteger(value.lineStart) &&
    isPositiveSafeInteger(value.lineEnd) &&
    (value.lineStart as number) <= (value.lineEnd as number) &&
    isNonNegativeSafeInteger(value.wordCount);
}

function isReferenceContextSelection(value: unknown): value is ReferenceContextSelection {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'tokenBudget',
      'maxReferences',
      'maxEntries',
      'usedTokens',
      'originalSourceRead',
      'noCopyWarnings',
      'differentiationWarnings',
      'profileOmission',
      'included',
      'omitted',
    ]) ||
    !isPositiveSafeInteger(value.tokenBudget) ||
    value.tokenBudget > 100_000 ||
    !isPositiveSafeInteger(value.maxReferences) ||
    value.maxReferences > 20 ||
    !isPositiveSafeInteger(value.maxEntries) ||
    value.maxEntries > 50 ||
    !isNonNegativeSafeInteger(value.usedTokens) ||
    value.usedTokens > value.tokenBudget ||
    value.originalSourceRead !== false ||
    !isBoundedStringArray(value.noCopyWarnings, 32, 2_000) ||
    !isBoundedStringArray(value.differentiationWarnings, 32, 2_000) ||
    (value.profileOmission !== undefined &&
      !isReferenceProfileOmission(value.profileOmission)) ||
    !Array.isArray(value.included) ||
    value.included.length > value.maxEntries ||
    !value.included.every(isIncludedReferenceContext) ||
    !hasUniqueIds(value.included) ||
    new Set((value.included as Array<{ referenceId: string }>)
      .map((entry) => entry.referenceId)).size > value.maxReferences ||
    !Array.isArray(value.omitted) ||
    value.omitted.length > 4_096 ||
    !value.omitted.every(isOmittedReferenceContext) ||
    !hasUniqueReferenceContextOmissions(value.omitted)
  ) {
    return false;
  }
  const included = value.included as Array<{
    id: string;
    referenceId: string;
    estimatedTokens: number;
  }>;
  const omitted = value.omitted as Array<{
    scope: string;
    referenceId: string;
    entryId?: string;
  }>;
  if (included.some((item) => omitted.some((candidate) =>
    candidate.scope === 'entry'
    && candidate.referenceId === item.referenceId
    && candidate.entryId === item.id))) {
    return false;
  }
  const usedTokens = included
    .reduce((sum, item) => sum + item.estimatedTokens, 0);
  return usedTokens === value.usedTokens && usedTokens <= value.tokenBudget;
}

function isReferenceProfileOmission(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKnownFields(value, ['reasonCode', 'reason'])
    && Object.keys(value).length === 2
    && value.reasonCode === 'profileExcludesTechniques'
    && isBoundedText(value.reason, 2_000);
}

function isIncludedReferenceContext(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'id',
      'referenceId',
      'referenceTitle',
      'entryTitle',
      'category',
      'path',
      'tags',
      'capabilityIds',
      'reason',
      'reasonCode',
      'budgetLayer',
      'semanticBoundary',
      'estimatedTokens',
      'content',
    ]) &&
    isSafeId(value.id) &&
    isSafeId(value.referenceId) &&
    isBoundedText(value.referenceTitle, 500) &&
    isBoundedText(value.entryTitle, 500) &&
    isReferenceDistilledCategory(value.category) &&
    value.path === referenceDistilledCategoryPath(
      value.referenceId,
      value.category,
    ) &&
    isBoundedStringArray(value.tags, 32, 200) &&
    Array.isArray(value.capabilityIds) &&
    value.capabilityIds.length > 0 &&
    value.capabilityIds.length <= CAPABILITY_IDS.size &&
    value.capabilityIds.every((id) => CAPABILITY_IDS.has(id)) &&
    new Set(value.capabilityIds).size === value.capabilityIds.length &&
    isBoundedText(value.reason, 2_000) &&
    (value.reasonCode === 'explicitReference' ||
      value.reasonCode === 'capabilityMatch' ||
      value.reasonCode === 'taskMatch' ||
      value.reasonCode === 'fallback') &&
    isBudgetLayer(value.budgetLayer) &&
    value.semanticBoundary === 'compressible' &&
    isPositiveSafeInteger(value.estimatedTokens) &&
    value.estimatedTokens <= MAX_REFERENCE_DISTILLED_ENTRY_TOKENS &&
    isBoundedText(value.content, 400_000);
}

function isOmittedReferenceContext(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'scope',
      'referenceId',
      'referenceTitle',
      'entryId',
      'entryTitle',
      'category',
      'reason',
      'budgetLayer',
      'deconstructionStatus',
      'contextEligible',
      'reasonCode',
      'estimatedTokens',
    ]) ||
    (value.scope !== 'reference' && value.scope !== 'entry') ||
    !isSafeId(value.referenceId) ||
    !isBoundedText(value.referenceTitle, 500) ||
    !isBoundedText(value.reason, 2_000) ||
    !isBudgetLayer(value.budgetLayer) ||
    !isPublishedDeconstructionStatus(value.deconstructionStatus) ||
    value.contextEligible !== false ||
    !isReferenceContextOmissionReason(value.reasonCode) ||
    (value.estimatedTokens !== undefined &&
      (!isPositiveSafeInteger(value.estimatedTokens) ||
        value.estimatedTokens > MAX_REFERENCE_DISTILLED_ENTRY_TOKENS))
  ) {
    return false;
  }
  if (value.scope === 'reference') {
    return value.entryId === undefined
      && value.entryTitle === undefined
      && value.category === undefined
      && !isEntryOmissionReason(value.reasonCode);
  }
  return isSafeId(value.entryId)
    && isBoundedText(value.entryTitle, 500)
    && isReferenceDistilledCategory(value.category)
    && value.deconstructionStatus === 'completed'
    && isEntryOmissionReason(value.reasonCode);
}

function hasUniqueReferenceContextOmissions(values: readonly unknown[]): boolean {
  const identities = values.map((value) => {
    if (!isRecord(value) || typeof value.scope !== 'string' ||
      typeof value.referenceId !== 'string') return undefined;
    return value.scope === 'entry' && typeof value.entryId === 'string'
      ? `entry\u0000${value.referenceId}\u0000${value.entryId}`
      : `reference\u0000${value.referenceId}`;
  });
  return identities.every((identity): identity is string => identity !== undefined)
    && new Set(identities).size === identities.length;
}

function isEntryOmissionReason(value: unknown): boolean {
  return value === 'capabilityMismatch'
    || value === 'taskMismatch'
    || value === 'maxReferenceCountReached'
    || value === 'maxEntryCountReached'
    || value === 'tokenBudgetExceeded';
}

function isReferenceDistilledCategory(
  value: unknown,
): value is ReferenceDistilledCategory {
  return typeof value === 'string' && DISTILLED_CATEGORIES.has(value);
}

function referenceDistilledCategoryPath(
  referenceId: unknown,
  category: unknown,
): string {
  const file = category === 'writingStyle'
    ? 'writing-style.md'
    : category === 'pacing'
      ? 'pacing.md'
      : category === 'hooks'
        ? 'hooks.md'
        : category === 'scene'
          ? 'scene-techniques.md'
          : category === 'character'
            ? 'character-techniques.md'
            : '';
  return `examples/references/${String(referenceId)}/distilled/${file}`;
}

function allEvidenceRefs(
  preview: Record<string, unknown>,
  evidenceIds: ReadonlySet<string>,
): boolean {
  const records = [
    ...(preview.chapterPreviews as Array<{ evidenceRefs: string[] }>),
    ...(preview.findings as Array<{ evidenceRefs: string[] }>),
    ...(preview.borrowablePatterns as Array<{ evidenceRefs: string[] }>),
    ...(preview.diagnostics as Array<{ evidenceRefs: string[] }>),
  ];
  return records.every((record) => record.evidenceRefs.every((id) => evidenceIds.has(id)));
}

function coverageCitationsMatch(preview: Record<string, unknown>): boolean {
  const records = [
    ...(preview.chapterPreviews as Array<{ evidenceRefs: string[] }>),
    ...(preview.findings as Array<{ evidenceRefs: string[] }>),
    ...(preview.borrowablePatterns as Array<{ evidenceRefs: string[] }>),
  ];
  const cited = new Set(records.flatMap((record) => record.evidenceRefs));
  return (preview.coverage as ReferenceQuickPreviewCoverage).citedPointerCount === cited.size;
}

function isEvidenceRefArray(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  maximum: number,
  required: boolean,
): value is string[] {
  return isUniqueSafeIdArray(value, maximum) &&
    (!required || value.length > 0) &&
    value.every((id) => evidenceIds.has(id));
}

function isPublishedDeconstructionStatus(value: unknown): boolean {
  return value === 'notAnalyzed' ||
    value === 'completed' ||
    value === 'stale' ||
    value === 'qualityFailed' ||
    value === 'needsRebuild';
}

function isReferenceReadinessReason(value: unknown): boolean {
  return value === 'ready' ||
    value === 'disabled' ||
    value === 'notAnalyzed' ||
    value === 'stale' ||
    value === 'qualityFailed' ||
    value === 'needsRebuild' ||
    value === 'missingContextSummary' ||
    value === 'invalidContextIndex' ||
    value === 'techniqueTrackNotPublished';
}

function isReferenceContextOmissionReason(value: unknown): boolean {
  return value === 'disabled' ||
    value === 'notExplicitlyRequested' ||
    value === 'maxReferenceCountReached' ||
    value === 'notAnalyzed' ||
    value === 'stale' ||
    value === 'qualityFailed' ||
    value === 'needsRebuild' ||
    value === 'missingContextSummary' ||
    value === 'invalidContextPath' ||
    value === 'invalidContextIndex' ||
    value === 'techniqueTrackNotPublished' ||
    value === 'capabilityMismatch' ||
    value === 'taskMismatch' ||
    value === 'maxEntryCountReached' ||
    value === 'tokenBudgetExceeded';
}

function isReferenceStageStatusRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const stages = Object.keys(value);
  return stages.length >= 2
    && stages.length <= 10
    && stages.includes('detectStructure')
    && stages.includes('quickPreview')
    && stages.every((stage) =>
      isReferenceStage(stage) && isReferenceStageStatus(value[stage]));
}

function isReferenceStageStatus(value: unknown): boolean {
  return value === 'notStarted' || value === 'queued' || value === 'running' ||
    value === 'completed' || value === 'failed' || value === 'cancelled' || value === 'stale';
}

function isReferenceStage(value: unknown): boolean {
  return value === 'detectStructure' ||
    value === 'quickPreview' ||
    value === 'chapterAnalysis' ||
    value === 'aggregateAnalysis' ||
    value === 'styleProfile' ||
    value === 'distillForOan' ||
    value === 'materialChapterAnalysis' ||
    value === 'materialAggregateAnalysis' ||
    value === 'materialProjection' ||
    value === 'qualityGate';
}

function isReferenceSourceType(value: unknown): boolean {
  return value === 'novel' || value === 'chapterSample' || value === 'styleSample' ||
    value === 'settingBible' || value === 'notes';
}

function isReferenceRights(value: unknown): boolean {
  return value === 'owned' || value === 'publicDomain' || value === 'licensed' ||
    value === 'excerpt' || value === 'unknown';
}

function isReferenceAllowedUsage(value: unknown): boolean {
  return value === 'analysisOnly' || value === 'styleInspiration' ||
    value === 'structureReference' || value === 'noDirectQuotation';
}

function isBudgetLayer(value: unknown): boolean {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}

function isRunStatus(value: unknown): value is ReferenceDeconstructionRunStatus {
  return typeof value === 'string' && RUN_STATUSES.has(value);
}

function isWritingProfileId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(value);
}

function isCanonicalWritingProfileOutputs(
  value: unknown,
): value is WritingProfileOutput[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > WRITING_PROFILE_OUTPUTS.length
    || !value.every((output): output is WritingProfileOutput =>
      typeof output === 'string' && WRITING_PROFILE_OUTPUTS.includes(output as WritingProfileOutput))
    || new Set(value).size !== value.length
  ) {
    return false;
  }
  return arraysEqual(
    value,
    WRITING_PROFILE_OUTPUTS.filter((output) => value.includes(output)),
  );
}

function outputsIncludeTechnique(outputs: unknown): boolean {
  return isCanonicalWritingProfileOutputs(outputs) && outputs.includes('techniques');
}

function outputsIncludeStoryMaterial(outputs: unknown): boolean {
  return materialKindsFromOutputs(outputs).length > 0;
}

function materialKindsFromOutputs(
  outputs: unknown,
): ReferenceStoryMaterialKind[] {
  if (!isCanonicalWritingProfileOutputs(outputs)) return [];
  return outputs.filter(isStoryMaterialKind);
}

function trackIdsFromOutputs(outputs: unknown): ReferenceDeconstructionTrackId[] {
  if (!isCanonicalWritingProfileOutputs(outputs)) return [];
  return [
    ...(outputs.includes('techniques') ? ['technique' as const] : []),
    ...(outputs.some(isStoryMaterialKind) ? ['storyMaterial' as const] : []),
  ];
}

function expectedFullStagePairs(outputs: unknown): Array<{
  track: ReferenceDeconstructionTrackId;
  stageId: ReferenceDeconstructionStageId;
}> {
  return trackIdsFromOutputs(outputs).flatMap((track) =>
    (track === 'technique' ? TECHNIQUE_FULL_STAGES : STORY_MATERIAL_FULL_STAGES)
      .map((stageId) => ({ track, stageId })));
}

function isTrackId(value: unknown): value is ReferenceDeconstructionTrackId {
  return typeof value === 'string'
    && TRACK_IDS.includes(value as ReferenceDeconstructionTrackId);
}

function isStoryMaterialKind(value: unknown): value is ReferenceStoryMaterialKind {
  return typeof value === 'string'
    && STORY_MATERIAL_KINDS.includes(value as ReferenceStoryMaterialKind);
}

function isStageOwnedByTrack(
  stageId: unknown,
  track: unknown,
): boolean {
  if (!isTrackId(track)) return false;
  return track === 'technique'
    ? TECHNIQUE_FULL_STAGES.includes(stageId as typeof TECHNIQUE_FULL_STAGES[number])
    : STORY_MATERIAL_FULL_STAGES.includes(
        stageId as typeof STORY_MATERIAL_FULL_STAGES[number],
      );
}

function isConfidence(value: unknown): value is ReferenceDeconstructionConfidence {
  return typeof value === 'string' && CONFIDENCE_VALUES.has(value);
}

function isDefinitelyPostApprovalRunStatus(status: unknown): boolean {
  return status === 'fullApproved' || status === 'fullRunning' || status === 'paused' ||
    status === 'reviewReady' || status === 'publishing' || status === 'completed';
}

function isPreApprovalRunStatus(status: unknown): boolean {
  return status === 'created' ||
    status === 'previewRunning' ||
    status === 'awaitingFullApproval';
}

function requiresPreview(status: unknown, fullApprovedAt: unknown): boolean {
  return status === 'awaitingFullApproval' ||
    isDefinitelyPostApprovalRunStatus(status) ||
    fullApprovedAt !== undefined;
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) &&
    !value.includes('..');
}

function isPendingActionId(value: unknown): value is string {
  return typeof value === 'string' && /^pa_[a-f0-9-]{16,128}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= 128 &&
    !Number.isNaN(Date.parse(value));
}

function isSafeRelativePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.startsWith('/') ||
    value.includes('\\')
  ) return false;
  return value.split('/').every((segment) =>
    segment.length > 0 && segment !== '.' && segment !== '..');
}

function hasUniqueStringField(
  values: readonly unknown[],
  field: string,
): boolean {
  const strings = values.map((value) =>
    isRecord(value) && typeof value[field] === 'string'
      ? value[field] as string
      : undefined,
  );
  return strings.every((value): value is string => value !== undefined)
    && new Set(strings).size === strings.length;
}

function isBoundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' &&
    value.length <= maximum &&
    (allowEmpty || value.trim().length > 0);
}

function isBoundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
): value is string[] {
  return Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => isBoundedText(item, maximumItemLength)) &&
    new Set(value).size === value.length;
}

function isUniqueSafeIdArray(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) &&
    value.length <= maximum &&
    value.every(isSafeId) &&
    new Set(value).size === value.length;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKnownFields(
  value: Record<string, unknown>,
  knownFields: readonly string[],
): boolean {
  const known = new Set(knownFields);
  return Object.keys(value).every((field) => known.has(field));
}

function hasUniqueIds(value: readonly unknown[], key = 'id'): boolean {
  const ids = value.map((item) => isRecord(item) && typeof item[key] === 'string'
    ? item[key]
    : undefined);
  return ids.every((id): id is string => id !== undefined) &&
    new Set(ids).size === ids.length;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
