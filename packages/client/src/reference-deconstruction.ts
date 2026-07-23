import type {
  ReferenceContextSelection,
  ReferenceDeconstructionStageId,
  ReferenceImportInput,
  ReferenceImportResult,
  ReferenceSourceManifest,
  ReferenceWorkSummary,
} from './index.js';

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
  version: 1;
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

export interface ReferenceDeconstructionMutationReceipt {
  idempotencyKey: string;
  requestFingerprint: string;
  resultingRunRevision: number;
  resultStatus: ReferenceDeconstructionRunStatus;
}

export interface ReferenceDeconstructionRun {
  schemaVersion: 1;
  id: string;
  referenceId: string;
  runRevision: number;
  status: ReferenceDeconstructionRunStatus;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  pipelineVersion: 1;
  capabilityVersion: string;
  selectedChapterIds: string[];
  evidence: ReferencePreviewEvidence[];
  preview?: ReferenceQuickPreview;
  diagnostics: ReferenceDeconstructionDiagnostic[];
  mutationReceipts: ReferenceDeconstructionMutationReceipt[];
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

export interface ReferenceDeconstructionRunMutationResult {
  run: ReferenceDeconstructionRun;
  receipt: ReferenceDeconstructionMutationReceipt;
  replayed: boolean;
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

export function assertReferenceContextRequest(input: {
  tokenBudget?: number;
  maxReferences?: number;
  capability?: NovelCopilotCapabilityId;
  goal?: string;
  explicitReferenceIds?: string[];
}): void {
  if (
    !isRecord(input) ||
    !hasOnlyKnownFields(input, [
      'tokenBudget',
      'maxReferences',
      'capability',
      'goal',
      'explicitReferenceIds',
    ]) ||
    (input.tokenBudget !== undefined &&
      (!isPositiveSafeInteger(input.tokenBudget) || input.tokenBudget > 100_000)) ||
    (input.maxReferences !== undefined &&
      (!isPositiveSafeInteger(input.maxReferences) || input.maxReferences > 32)) ||
    (input.capability !== undefined && !CAPABILITY_IDS.has(input.capability)) ||
    (input.goal !== undefined && !isBoundedText(input.goal, 4_000, true)) ||
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
    !value.run.mutationReceipts.some((receipt) => deepEqual(receipt, value.receipt))
  ) {
    throw new Error('Reference deconstruction mutation returned an invalid payload.');
  }
  return value as unknown as ReferenceDeconstructionRunMutationResult;
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
      'selectedChapterIds',
      'evidence',
      'preview',
      'diagnostics',
      'mutationReceipts',
      'createdAt',
      'updatedAt',
      'fullApprovedAt',
    ]) ||
    value.schemaVersion !== 1 ||
    !isSafeId(value.id) ||
    !isSafeId(value.referenceId) ||
    !isNonNegativeSafeInteger(value.runRevision) ||
    !isRunStatus(value.status) ||
    !isSha256(value.sourceChecksumSha256) ||
    !isSha256(value.structureFingerprint) ||
    value.pipelineVersion !== 1 ||
    value.capabilityVersion !== 'novel.deconstruct_reference@1' ||
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
      diagnostic.evidenceRefs.every((id) =>
        (value.evidence as ReferencePreviewEvidence[]).some((item) => item.id === id))) ||
    !Array.isArray(value.mutationReceipts) ||
    value.mutationReceipts.length > 256 ||
    !value.mutationReceipts.every(isReferenceDeconstructionMutationReceipt) ||
    !hasUniqueIds(value.mutationReceipts, 'idempotencyKey') ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    (value.fullApprovedAt !== undefined && !isTimestamp(value.fullApprovedAt)) ||
    (value.status === 'fullApproved' && value.fullApprovedAt === undefined) ||
    (value.fullApprovedAt !== undefined && value.status !== 'fullApproved') ||
    (value.preview !== undefined && !isQuickPreview(
      value.preview,
      value.id as string,
      value.referenceId as string,
      value.sourceChecksumSha256 as string,
      new Set((value.evidence as ReferencePreviewEvidence[]).map((item) => item.id)),
      value.selectedChapterIds as string[],
    )) ||
    (value.preview !== undefined && !deepEqual(value.diagnostics, value.preview.diagnostics)) ||
    (requiresPreview(value.status) && value.preview === undefined) ||
    value.mutationReceipts.some((receipt) =>
      receipt.resultingRunRevision > (value.runRevision as number))
  ) {
    return false;
  }

  const receiptRevisions = (value.mutationReceipts as ReferenceDeconstructionMutationReceipt[])
    .map((receipt) => receipt.resultingRunRevision)
    .sort((left, right) => left - right);
  return receiptRevisions.length === (value.runRevision as number) + 1 &&
    receiptRevisions.every((revision, index) => revision === index) &&
    (value.mutationReceipts as ReferenceDeconstructionMutationReceipt[])
      .some((receipt) =>
        receipt.resultingRunRevision === value.runRevision &&
        receipt.resultStatus === value.status);
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
    value.version !== 1 ||
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
    ]) &&
    isSafeId(value.id) &&
    typeof value.severity === 'string' && DIAGNOSTIC_SEVERITIES.has(value.severity) &&
    isBoundedText(value.code, 128) &&
    isBoundedText(value.message, 4_000) &&
    typeof value.blocking === 'boolean' &&
    isUniqueSafeIdArray(value.evidenceRefs, 32) &&
    (value.stageId === undefined || isReferenceStage(value.stageId)) &&
    (value.chapterId === undefined || isSafeId(value.chapterId)) &&
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
    isReferenceSummaryReadinessConsistent(value) &&
    (!value.contextEligible || value.deconstructionStatus === 'completed');
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
  if (value.deconstructionStatus === 'notAnalyzed') {
    return value.readinessReason === 'notAnalyzed';
  }
  if (value.deconstructionStatus === 'stale') {
    return value.readinessReason === 'stale';
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
    value.version === 1 &&
    isSafeId(value.referenceId) &&
    isPublishedDeconstructionStatus(value.status) &&
    (value.currentStage === null || isReferenceStage(value.currentStage)) &&
    (value.nextStage === null || isReferenceStage(value.nextStage)) &&
    Array.isArray(value.completedStages) &&
    value.completedStages.length <= 7 &&
    value.completedStages.every(isReferenceStage) &&
    new Set(value.completedStages).size === value.completedStages.length &&
    Array.isArray(value.failedStages) &&
    value.failedStages.length <= 7 &&
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
      'originalSourceRead',
      'noCopyWarnings',
      'included',
      'omitted',
    ]) ||
    !isPositiveSafeInteger(value.tokenBudget) ||
    value.tokenBudget > 100_000 ||
    value.originalSourceRead !== false ||
    !isBoundedStringArray(value.noCopyWarnings, 32, 2_000) ||
    !Array.isArray(value.included) ||
    value.included.length > 32 ||
    !value.included.every(isIncludedReferenceContext) ||
    !hasUniqueIds(value.included) ||
    !Array.isArray(value.omitted) ||
    value.omitted.length > 1_000 ||
    !value.omitted.every(isOmittedReferenceContext) ||
    !hasUniqueIds(value.omitted)
  ) {
    return false;
  }
  const included = value.included as Array<{ id: string; estimatedTokens: number }>;
  const omitted = value.omitted as Array<{ id: string }>;
  if (included.some((item) => omitted.some((candidate) => candidate.id === item.id))) {
    return false;
  }
  const usedTokens = included
    .reduce((sum, item) => sum + item.estimatedTokens, 0);
  return usedTokens <= value.tokenBudget;
}

function isIncludedReferenceContext(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'id',
      'title',
      'path',
      'reason',
      'budgetLayer',
      'semanticBoundary',
      'estimatedTokens',
      'content',
      'deconstructionStatus',
      'contextEligible',
      'reasonCode',
    ]) &&
    isSafeId(value.id) &&
    isBoundedText(value.title, 500) &&
    value.path === `examples/references/${value.id}/context/reference-summary.md` &&
    isBoundedText(value.reason, 2_000) &&
    isBudgetLayer(value.budgetLayer) &&
    (value.semanticBoundary === 'protected' || value.semanticBoundary === 'compressible') &&
    isPositiveSafeInteger(value.estimatedTokens) &&
    isBoundedText(value.content, 400_000) &&
    value.deconstructionStatus === 'completed' &&
    value.contextEligible === true &&
    value.reasonCode === 'ready';
}

function isOmittedReferenceContext(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'id',
      'title',
      'reason',
      'budgetLayer',
      'deconstructionStatus',
      'contextEligible',
      'reasonCode',
    ]) &&
    isSafeId(value.id) &&
    isBoundedText(value.title, 500) &&
    isBoundedText(value.reason, 2_000) &&
    isBudgetLayer(value.budgetLayer) &&
    isPublishedDeconstructionStatus(value.deconstructionStatus) &&
    value.contextEligible === false &&
    isReferenceContextOmissionReason(value.reasonCode);
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
    value === 'missingContextSummary';
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
    value === 'tokenBudgetExceeded';
}

function isReferenceStageStatusRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const stages = [
    'detectStructure',
    'quickPreview',
    'chapterAnalysis',
    'aggregateAnalysis',
    'styleProfile',
    'distillForOan',
    'qualityGate',
  ];
  return Object.keys(value).length === stages.length &&
    stages.every((stage) => isReferenceStageStatus(value[stage]));
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

function isConfidence(value: unknown): value is ReferenceDeconstructionConfidence {
  return typeof value === 'string' && CONFIDENCE_VALUES.has(value);
}

function requiresPreview(status: unknown): boolean {
  return status === 'awaitingFullApproval' || status === 'fullApproved';
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) &&
    !value.includes('..');
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
