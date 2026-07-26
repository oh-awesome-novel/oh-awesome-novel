import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { parse, stringify } from 'yaml';

import {
  MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  MAX_REFERENCE_DECONSTRUCTION_MUTATION_RECEIPTS,
  MAX_REFERENCE_DECONSTRUCTION_TRANSPORT_RECEIPTS,
  MAX_REFERENCE_QUICK_PREVIEW_WINDOWS,
  REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
  REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
  REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
  REFERENCE_DECONSTRUCTION_STAGE_IDS,
  assertReferenceDeconstructionDiagnostics,
  assertReferenceDeconstructionManifest,
  assertReferenceProgress,
  assertReferenceSourcePointer,
  createReferenceEvidencePointerMap,
  createReferenceProgressProjection,
  createReferenceStructureFingerprint,
  formatReferenceQuickPreviewMarkdown,
  normalizeReferenceQuickPreviewModelOutput,
} from './reference-deconstruction.js';
import type {
  ReferenceDeconstructionDiagnostic,
  ReferenceDeconstructionDiagnostics,
  ReferenceDeconstructionManifest,
  ReferenceDeconstructionRunStatus,
  ReferenceDeconstructionStageId,
  ReferencePublishedDeconstructionStatus,
  ReferenceQuickPreview,
  ReferenceQuickPreviewSelection,
  ReferenceSourcePointer,
} from './reference-deconstruction.js';
import type {
  ReferenceMetadata,
  ReferenceSourceManifest,
} from './reference-work.js';
import {
  assertReferencesIndexValue,
} from './reference-work.js';
import {
  MAX_REFERENCE_DECONSTRUCTION_WORK_UNITS,
  collectReferenceAnalysisFindings,
  createReferenceDeconstructionStageInputFingerprint,
  createReferenceDeconstructionWorkPlan,
  parseReferenceAggregateAnalysisResult,
  parseReferenceChapterAnalysisResult,
  parseReferenceStyleProfileResult,
  resolveReferenceChapterWorkUnitWindow,
} from './reference-deconstruction-full.js';
import type {
  ReferenceAggregateAnalysisResult,
  ReferenceChapterAnalysisResult,
  ReferenceChapterWorkUnitWindow,
  ReferenceDeconstructionFinding,
  ReferenceDeconstructionWorkPlan,
  ReferenceDeconstructionWorkUnit,
  ReferenceRollingContext,
  ReferenceStyleProfileResult,
} from './reference-deconstruction-full.js';
import {
  assertReferenceContextIndex,
  collectReferenceDistillationFindings,
  createReferenceContextIndex,
  formatReferenceDistilledCategoryMarkdown,
  parseReferenceDistillationResult,
} from './reference-deconstruction-distill.js';
import type {
  ReferenceContextIndex,
  ReferenceDistillationResult,
  ReferenceDistilledCategory,
} from './reference-deconstruction-distill.js';
import {
  evaluateReferenceAnalysisCopyRisk,
  evaluateReferenceDeconstructionAnalysisQuality,
  parseReferenceDeconstructionAnalysisQualityReport,
} from './reference-deconstruction-quality.js';
import type {
  ReferenceDeconstructionAnalysisOutput,
  ReferenceDeconstructionAnalysisQualityReport,
  ReferenceDeconstructionQualitySelectedAttempt,
} from './reference-deconstruction-quality.js';
import {
  assertReferenceDeconstructionPublicationCandidate,
  candidateTargetPath,
  createReferenceDeconstructionPublicationCandidate,
} from './reference-deconstruction-publication.js';
import type {
  ReferenceDeconstructionPublicationCandidate,
  ReferenceDeconstructionPublicationCandidateFile,
  ReferenceDeconstructionPublicationEntryInventoryItem,
} from './reference-deconstruction-publication.js';

export type ReferenceReadinessReason =
  | 'ready'
  | 'disabled'
  | 'notAnalyzed'
  | 'stale'
  | 'qualityFailed'
  | 'needsRebuild'
  | 'missingContextSummary'
  | 'invalidContextIndex';

export interface ReferenceReadinessInspection {
  status: ReferencePublishedDeconstructionStatus;
  contextEligible: boolean;
  reason: ReferenceReadinessReason;
  diagnostics: ReferenceDeconstructionDiagnostic[];
  summaryPath?: string;
  summaryContent?: string;
  contextIndexPath?: string;
  contextIndex?: ReferenceContextIndex;
  publishedContext?: {
    runId: string;
    fingerprint: string;
    entryCount: number;
    categoryCounts: Record<ReferenceDistilledCategory, number>;
  };
  metadata?: ReferenceMetadata;
  sourceManifest?: ReferenceSourceManifest;
  deconstructionManifest?: ReferenceDeconstructionManifest;
  progress?: import('./reference-deconstruction.js').ReferenceProgress;
}

export interface ReferencePreviewSource {
  metadata: ReferenceMetadata;
  sourceManifest: ReferenceSourceManifest;
  deconstructionManifest: ReferenceDeconstructionManifest;
  sourceText: string;
}

export type ReferenceDeconstructionConflictCode =
  | 'revisionConflict'
  | 'idempotencyConflict'
  | 'activeRunExists'
  | 'invalidTransition'
  | 'reservationConflict';

export class ReferenceDeconstructionError extends Error {
  readonly code: string;

  constructor(
    message: string,
    code: string,
  ) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class ReferenceDeconstructionNotFoundError extends ReferenceDeconstructionError {
  constructor(message: string) {
    super(message, 'notFound');
  }
}

export class ReferenceDeconstructionConflictError extends ReferenceDeconstructionError {
  readonly conflictCode: ReferenceDeconstructionConflictCode;
  readonly details?: {
    expectedRevision?: number;
    actualRevision?: number;
    activeRunId?: string;
  };

  constructor(
    message: string,
    conflictCode: ReferenceDeconstructionConflictCode,
    details?: {
      expectedRevision?: number;
      actualRevision?: number;
      activeRunId?: string;
    },
  ) {
    super(message, conflictCode);
    this.conflictCode = conflictCode;
    this.details = details;
  }
}

export class ReferenceDeconstructionValidationError extends ReferenceDeconstructionError {
  constructor(message: string) {
    super(message, 'validationFailed');
  }
}

export interface ReferenceDeconstructionMutationReceipt {
  idempotencyKey: string;
  requestFingerprint: string;
  resultingRunRevision: number;
  resultStatus: ReferenceDeconstructionRunStatus;
}

export interface ReferenceQuickPreviewSelectionSummary {
  selectedChapterIds: string[];
  omittedChapterIds: string[];
  selectedWindowCount: number;
  selectedCharacterCount: number;
  maxChapters: number;
  maxChars: number;
}

export interface ReferenceQuickPreviewEvidence {
  id: string;
  pointer: ReferenceSourcePointer;
}

export interface ReferenceQuickPreviewReservation {
  kind: 'preview';
  id: string;
  idempotencyKey: string;
  startedAt: string;
}

export type ReferenceDeconstructionUnitStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'stale';

export type ReferenceDeconstructionAttemptStatus = Exclude<
  ReferenceDeconstructionUnitStatus,
  'queued'
>;

export interface ReferenceDeconstructionStoredUnit extends ReferenceDeconstructionWorkUnit {
  status: ReferenceDeconstructionUnitStatus;
  attemptIds: string[];
  selectedAttemptId?: string;
}

export interface ReferenceDeconstructionAttemptSummary {
  id: string;
  unitId: string;
  attemptNumber: number;
  status: ReferenceDeconstructionAttemptStatus;
  inputFingerprint: string;
  predecessorOutputHashes: string[];
  outputHash?: string;
  startedAt: string;
  completedAt?: string;
  failure?: ReferenceDeconstructionRunFailure;
}

export interface ReferenceDeconstructionAnalysisQualitySummary {
  status: 'notEvaluated' | 'passed' | 'failed';
  coveragePercent: number;
  blockingDiagnosticCount: number;
  outputHashes: string[];
}

export interface ReferenceFullDeconstructionState {
  plan: ReferenceDeconstructionWorkPlan;
  units: ReferenceDeconstructionStoredUnit[];
  attempts: ReferenceDeconstructionAttemptSummary[];
  analysisQuality?: ReferenceDeconstructionAnalysisQualitySummary;
}

export interface ReferenceDeconstructionPublicationState {
  candidateFingerprint: string;
  pendingActionId: string;
  files: Array<Omit<ReferenceDeconstructionPublicationCandidateFile, 'content'>>;
  entryInventory: ReferenceDeconstructionPublicationEntryInventoryItem[];
  preparedAt: string;
}

export interface ReferenceFullDeconstructionReservation {
  kind: 'fullUnit';
  id: string;
  idempotencyKey: string;
  unitId: string;
  attemptId: string;
  inputFingerprint: string;
  startedAt: string;
}

export type ReferenceDeconstructionReservation =
  | ReferenceQuickPreviewReservation
  | ReferenceFullDeconstructionReservation;

export type ReferenceFullDeconstructionOutput =
  | ReferenceChapterAnalysisResult
  | ReferenceAggregateAnalysisResult
  | ReferenceStyleProfileResult
  | ReferenceDistillationResult
  | ReferenceDeconstructionAnalysisQualityReport;

export interface ReferenceFullDeconstructionExecution {
  unit: ReferenceDeconstructionWorkUnit;
  sourceWindows?: ReferenceChapterWorkUnitWindow[];
  rollingContext?: ReferenceRollingContext;
  verifiedSourceFindings?: ReferenceDeconstructionFinding[];
  coveredUnitIds?: string[];
  coveredChapterIds?: string[];
}

export interface ReferenceFullDeconstructionReservationResult
  extends ReferenceDeconstructionMutationResult {
  reservation?: ReferenceFullDeconstructionReservation;
  execution?: ReferenceFullDeconstructionExecution;
}

export interface ReferenceDeconstructionRunFailure {
  code: string;
  message: string;
  failedAt: string;
}

export interface ReferenceDeconstructionRun {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  referenceId: string;
  revision: number;
  status: ReferenceDeconstructionRunStatus;
  mode: 'quickPreview';
  sourceChecksumSha256: string;
  structureFingerprint: string;
  selection: ReferenceQuickPreviewSelectionSummary;
  evidence: ReferenceQuickPreviewEvidence[];
  preview?: ReferenceQuickPreview;
  diagnostics: ReferenceDeconstructionDiagnostic[];
  mutationReceipts: ReferenceDeconstructionMutationReceipt[];
  full?: ReferenceFullDeconstructionState;
  publication?: ReferenceDeconstructionPublicationState;
  activeReservation?: ReferenceDeconstructionReservation;
  failure?: ReferenceDeconstructionRunFailure;
  createdAt: string;
  updatedAt: string;
  fullApprovedAt?: string;
  cancelledAt?: string;
}

export interface ReferenceDeconstructionRunTransport {
  schemaVersion: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  id: string;
  referenceId: string;
  runRevision: number;
  status: ReferenceDeconstructionRunStatus;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  pipelineVersion: typeof REFERENCE_DECONSTRUCTION_PIPELINE_VERSION;
  capabilityVersion: typeof REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION;
  selectedChapterIds: string[];
  evidence: ReferenceQuickPreviewEvidence[];
  preview?: ReferenceQuickPreview;
  diagnostics: ReferenceDeconstructionDiagnostic[];
  mutationReceipts: ReferenceDeconstructionMutationReceipt[];
  receiptCount: number;
  full?: ReferenceFullDeconstructionTransport;
  publication?: ReferenceDeconstructionPublicationState;
  createdAt: string;
  updatedAt: string;
  fullApprovedAt?: string;
}

export interface ReferenceFullDeconstructionStageSummary {
  stageId: Extract<
    ReferenceDeconstructionStageId,
    | 'chapterAnalysis'
    | 'aggregateAnalysis'
    | 'styleProfile'
    | 'distillForOan'
    | 'qualityGate'
  >;
  status: 'notStarted' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'stale';
  plannedUnits: number;
  completedUnits: number;
  failedUnits: number;
}

export interface ReferenceFullDeconstructionTransport {
  stages: ReferenceFullDeconstructionStageSummary[];
  progress: {
    plannedUnits: number;
    completedUnits: number;
    failedUnits: number;
    completedChapters: number;
    totalChapters: number;
    percent: number;
  };
  nextUnit?: ReferenceDeconstructionUnitTransport;
  currentUnit?: ReferenceDeconstructionUnitTransport;
  failedUnit?: ReferenceDeconstructionUnitTransport;
  recentUnits: ReferenceDeconstructionUnitTransport[];
  recentAttempts: ReferenceDeconstructionAttemptTransport[];
  analysisQuality?: ReferenceDeconstructionAnalysisQualitySummary;
}

export interface ReferenceDeconstructionUnitTransport {
  id: string;
  ordinal: number;
  stageId: ReferenceDeconstructionWorkUnit['stageId'];
  kind: ReferenceDeconstructionWorkUnit['kind'];
  chapterId?: string;
  chunkId?: string;
  status: ReferenceDeconstructionUnitStatus;
  attemptCount: number;
  selectedAttemptId?: string;
}

export type ReferenceDeconstructionAttemptTransport = Omit<
  ReferenceDeconstructionAttemptSummary,
  'predecessorOutputHashes' | 'failure'
>;

export interface ReferenceDeconstructionRunRequest {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  referenceId: string;
  mode: 'quickPreview';
  sourceChecksumSha256: string;
  structureFingerprint: string;
  structureConfidence: ReferenceSourceManifest['detectedStructure']['confidence'];
  rangeConfirmed: boolean;
  selection: ReferenceQuickPreviewSelection;
  createdAt: string;
}

export interface ResolveReferenceDeconstructionRunArtifactOptions {
  createDirectory?: boolean;
  requireExistingArtifact?: boolean;
}

export interface ReferenceDeconstructionMutationResult {
  run: ReferenceDeconstructionRun;
  receipt: ReferenceDeconstructionMutationReceipt;
  replayed: boolean;
}

export interface CreateReferenceDeconstructionRunInput {
  workspaceRoot: string;
  referenceId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  structureConfidence: ReferenceSourceManifest['detectedStructure']['confidence'];
  rangeConfirmed: boolean;
  selection: ReferenceQuickPreviewSelection;
  idempotencyKey: string;
  baseRunRevision: 0;
  runId?: string;
  now?: string;
}

export interface MutateReferenceDeconstructionRunInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  baseRunRevision: number;
  idempotencyKey: string;
  now?: string;
}

export interface CompleteReferenceQuickPreviewInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  baseRunRevision: number;
  reservationId: string;
  preview: ReferenceQuickPreview;
  now?: string;
}

export interface FailReferenceQuickPreviewInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  baseRunRevision: number;
  reservationId: string;
  errorCode: string;
  errorMessage: string;
  diagnostics?: ReferenceDeconstructionDiagnostic[];
  now?: string;
}

export interface InterruptReferenceQuickPreviewInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  baseRunRevision: number;
  reservationId?: string;
  now?: string;
}

export interface CompleteReferenceFullDeconstructionUnitInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  baseRunRevision: number;
  reservationId: string;
  output: ReferenceFullDeconstructionOutput;
  now?: string;
}

export interface FailReferenceFullDeconstructionUnitInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  baseRunRevision: number;
  reservationId: string;
  errorCode: string;
  errorMessage: string;
  now?: string;
}

export interface InterruptReferenceFullDeconstructionUnitInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  baseRunRevision: number;
  reservationId?: string;
  now?: string;
}

export interface RetryReferenceDeconstructionUnitInput
  extends MutateReferenceDeconstructionRunInput {
  unitId: string;
}

export interface BeginReferenceDeconstructionPublishInput
  extends MutateReferenceDeconstructionRunInput {
  candidateFingerprint: string;
  pendingActionId: string;
}

export interface AssertReferenceDeconstructionPublishCurrentInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  candidateFingerprint: string;
  pendingActionId: string;
}

export interface CompleteReferenceDeconstructionPublishInput
  extends BeginReferenceDeconstructionPublishInput {}

export interface RejectReferenceDeconstructionPublishInput
  extends MutateReferenceDeconstructionRunInput {
  pendingActionId: string;
}

export interface ReconcileReferenceDeconstructionPublishInput {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  pendingActionStatus: 'pending' | 'accepted' | 'rejected';
  now?: string;
}

const ACTIVE_RUN_STATUSES: readonly ReferenceDeconstructionRunStatus[] = [
  'created',
  'previewRunning',
  'awaitingFullApproval',
  'fullApproved',
  'fullRunning',
  'paused',
  'reviewReady',
  'publishing',
  'failed',
  'interrupted',
];
const CANCELLABLE_RUN_STATUSES: readonly ReferenceDeconstructionRunStatus[] = [
  'created',
  'previewRunning',
  'awaitingFullApproval',
  'fullApproved',
  'fullRunning',
  'paused',
  'reviewReady',
  'failed',
  'interrupted',
];
const RUN_STATUS_VALUES: readonly ReferenceDeconstructionRunStatus[] = [
  ...ACTIVE_RUN_STATUSES,
  'cancelled',
  'completed',
  'stale',
];
const lockTails = new Map<string, Promise<void>>();
const REFERENCE_LOCK_STALE_MS = 30_000;
const REFERENCE_LOCK_RETRY_MS = 25;
const REFERENCE_LOCK_MAX_ATTEMPTS = 160;

export async function createReferenceDeconstructionRun(
  input: CreateReferenceDeconstructionRunInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    if (input.baseRunRevision !== 0) {
      throw new ReferenceDeconstructionValidationError(
        'Reference deconstruction run creation requires baseRunRevision 0.',
      );
    }
    const referenceId = assertSafeIdentifier(input.referenceId, 'referenceId');
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const sourceChecksumSha256 = assertSha256(
      input.sourceChecksumSha256,
      'sourceChecksumSha256',
    );
    const structureFingerprint = assertSha256(
      input.structureFingerprint,
      'structureFingerprint',
    );
    const structureConfidence = requireEnum(
      input.structureConfidence,
      ['low', 'medium', 'high'] as const,
      'structureConfidence',
    );
    if (typeof input.rangeConfirmed !== 'boolean') {
      throw new ReferenceDeconstructionValidationError(
        'rangeConfirmed must be boolean.',
      );
    }
    const rangeConfirmed = input.rangeConfirmed;
    if (structureConfidence === 'low' && !rangeConfirmed) {
      throw new ReferenceDeconstructionValidationError(
        'Low-confidence chapter boundaries require explicit range confirmation.',
      );
    }
    const selection = assertQuickPreviewSelection(input.selection, {
      referenceId,
      sourceChecksumSha256,
      structureFingerprint,
    });
    const requestFingerprint = fingerprintCreateRequest({
      referenceId,
      sourceChecksumSha256,
      structureFingerprint,
      structureConfidence,
      rangeConfirmed,
      selection,
    });
    const existingRuns = await listReferenceDeconstructionRunsUnlocked(
      input.workspaceRoot,
      referenceId,
    );
    for (const existing of existingRuns) {
      const receipt = existing.mutationReceipts.find((candidate) =>
        candidate.idempotencyKey === idempotencyKey);
      if (!receipt) continue;
      if (receipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      if (
        ACTIVE_RUN_STATUSES.includes(existing.status)
        && existing.mutationReceipts.at(-1)?.idempotencyKey === idempotencyKey
      ) {
        const drift = await detectRunSourceDrift(input.workspaceRoot, existing);
        if (drift) {
          const stale = await persistStaleRun(
            input.workspaceRoot,
            existing,
            normalizeNow(input.now),
            drift,
            idempotencyKey,
            false,
          );
          return {
            run: stale,
            receipt: stale.mutationReceipts.at(-1)!,
            replayed: true,
          };
        }
      }
      return { run: existing, receipt, replayed: true };
    }
    const active = existingRuns.find((run) => ACTIVE_RUN_STATUSES.includes(run.status));
    if (active) {
      throw new ReferenceDeconstructionConflictError(
        `Reference ${referenceId} already has active run ${active.runId}.`,
        'activeRunExists',
        { activeRunId: active.runId },
      );
    }

    const runId = assertSafeIdentifier(
      input.runId ?? `reference-preview-${randomUUID()}`,
      'runId',
    );
    const now = normalizeNow(input.now);
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: 0,
      resultStatus: 'created',
    };
    const request: ReferenceDeconstructionRunRequest = {
      version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
      runId,
      referenceId,
      mode: 'quickPreview',
      sourceChecksumSha256,
      structureFingerprint,
      structureConfidence,
      rangeConfirmed,
      selection,
      createdAt: now,
    };
    const run: ReferenceDeconstructionRun = {
      version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
      runId,
      referenceId,
      revision: 0,
      status: 'created',
      mode: 'quickPreview',
      sourceChecksumSha256,
      structureFingerprint,
      selection: summarizeSelection(selection),
      evidence: selection.windows.map((window) => ({
        id: window.pointerId,
        pointer: window.pointer,
      })),
      diagnostics: [],
      mutationReceipts: [receipt],
      createdAt: now,
      updatedAt: now,
    };

    await validateRunRequestAgainstCurrentSource(input.workspaceRoot, request);
    await writeRunRequest(input.workspaceRoot, request);
    await writeRunState(input.workspaceRoot, run);
    await writeRunDiagnostics(input.workspaceRoot, run);
    return { run, receipt, replayed: false };
  });
}

export async function readReferenceDeconstructionRun(
  workspaceRoot: string,
  referenceId: string,
  runId: string,
  options: { reconcile?: boolean; now?: string } = {},
): Promise<ReferenceDeconstructionRun> {
  if (options.reconcile) {
    return reconcileReferenceDeconstructionRun(
      workspaceRoot,
      referenceId,
      runId,
      options.now,
    );
  }
  const projected = await readRunStateArtifact(workspaceRoot, referenceId, runId);
  if (projected.status === 'publishing' || projected.status === 'completed') {
    return projected;
  }
  return readRunState(workspaceRoot, referenceId, runId);
}

export async function readReferenceDeconstructionRunRequest(
  workspaceRoot: string,
  referenceId: string,
  runId: string,
): Promise<ReferenceDeconstructionRunRequest> {
  return readRunRequestArtifact(workspaceRoot, referenceId, runId, true);
}

async function readRunRequestArtifact(
  workspaceRoot: string,
  referenceId: string,
  runId: string,
  validateCurrentSource: boolean,
): Promise<ReferenceDeconstructionRunRequest> {
  const safeReferenceId = assertSafeIdentifier(referenceId, 'referenceId');
  const safeRunId = assertSafeIdentifier(runId, 'runId');
  const filePath = await resolveReferenceDeconstructionRunArtifactPath(
    workspaceRoot,
    safeRunId,
    'request.yaml',
  );
  const value = await readYamlOrNotFound(filePath, `Reference run request not found: ${safeRunId}.`);
  let request: ReferenceDeconstructionRunRequest;
  try {
    request = assertRunRequest(value, safeReferenceId, safeRunId);
  } catch (error) {
    throw validationFrom(error);
  }
  if (validateCurrentSource) {
    await validateRunRequestAgainstCurrentSource(workspaceRoot, request);
  }
  const run = await readRunStateArtifact(
    workspaceRoot,
    safeReferenceId,
    safeRunId,
  );
  assertRunRequestMatchesAuthoritativeRun(request, run);
  return request;
}

export async function reserveReferenceQuickPreview(
  input: MutateReferenceDeconstructionRunInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return mutateWithReceipt(input, 'advance', ['created', 'interrupted'], (run, receipt, now) => {
    const reservationId = `preview-reservation-${run.revision + 1}-${randomUUID()}`;
    return {
      ...run,
      revision: run.revision + 1,
      status: 'previewRunning',
      activeReservation: {
        kind: 'preview',
        id: reservationId,
        idempotencyKey: receipt.idempotencyKey,
        startedAt: now,
      },
      failure: undefined,
      updatedAt: now,
    };
  });
}

export async function completeReferenceQuickPreview(
  input: CompleteReferenceQuickPreviewInput,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    assertRevision(run, input.baseRunRevision);
    const reservation = assertReservation(run, input.reservationId);
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) {
      return persistStaleRun(
        input.workspaceRoot,
        run,
        normalizeNow(input.now),
        drift,
        reservation.idempotencyKey,
        false,
      );
    }
    await assertPreviewMatchesRun(input.workspaceRoot, input.preview, run, false);
    const now = normalizeNow(input.now);
    const next: ReferenceDeconstructionRun = {
      ...run,
      status: 'awaitingFullApproval',
      preview: input.preview,
      diagnostics: [...input.preview.diagnostics],
      mutationReceipts: updateReceiptStatus(
        run.mutationReceipts,
        reservation.idempotencyKey,
        run.revision,
        'awaitingFullApproval',
      ),
      activeReservation: undefined,
      failure: undefined,
      updatedAt: now,
    };
    await writePreviewArtifacts(input.workspaceRoot, next, input.preview);
    await writeRunState(input.workspaceRoot, next);
    await writeRunDiagnostics(input.workspaceRoot, next);
    return next;
  });
}

export async function failReferenceQuickPreview(
  input: FailReferenceQuickPreviewInput,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    assertRevision(run, input.baseRunRevision);
    const reservation = assertReservation(run, input.reservationId);
    const now = normalizeNow(input.now);
    const code = assertCode(input.errorCode, 'errorCode');
    const message = boundedText(input.errorMessage, 'errorMessage', 1_000);
    if ((input.diagnostics?.length ?? 0) > MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS) {
      throw new ReferenceDeconstructionValidationError(
        'Reference run diagnostics exceed the transport limit.',
      );
    }
    const diagnostics = (input.diagnostics?.length
      ? input.diagnostics
      : [{
          id: `preview-failed-${run.revision}`,
          code: `preview.${code}`,
          severity: 'error' as const,
          blocking: true,
          message,
          evidenceRefs: [],
          stageId: 'quickPreview' as const,
        }]).map((item) => normalizeStoreDiagnostic(item));
    const next: ReferenceDeconstructionRun = {
      ...run,
      status: 'failed',
      diagnostics,
      mutationReceipts: updateReceiptStatus(
        run.mutationReceipts,
        reservation.idempotencyKey,
        run.revision,
        'failed',
      ),
      activeReservation: undefined,
      failure: { code, message, failedAt: now },
      updatedAt: now,
    };
    await writeRunState(input.workspaceRoot, next);
    await writeRunDiagnostics(input.workspaceRoot, next);
    return next;
  });
}

export async function interruptReferenceQuickPreview(
  input: InterruptReferenceQuickPreviewInput,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    assertRevision(run, input.baseRunRevision);
    if (run.status !== 'previewRunning' || !run.activeReservation) {
      throw invalidTransition(run.status, 'interrupted');
    }
    if (input.reservationId && run.activeReservation.id !== input.reservationId) {
      throw reservationConflict();
    }
    return persistInterruptedRun(input.workspaceRoot, run, normalizeNow(input.now));
  });
}

export async function approveReferenceFullDeconstruction(
  input: MutateReferenceDeconstructionRunInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = fingerprintMutation({
      command: 'approve-full',
      referenceId: run.referenceId,
      runId: run.runId,
      baseRunRevision: input.baseRunRevision,
    });
    const previousReceipt = run.mutationReceipts.find((candidate) =>
      candidate.idempotencyKey === idempotencyKey);
    if (previousReceipt) {
      if (previousReceipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      return { run, receipt: previousReceipt, replayed: true };
    }
    assertRevision(run, input.baseRunRevision);
    if (run.status !== 'awaitingFullApproval' || !run.preview) {
      throw invalidTransition(run.status, 'fullApproved');
    }
    if (run.diagnostics.some((diagnostic) => diagnostic.blocking)) {
      throw new ReferenceDeconstructionValidationError(
        'Reference Quick Preview has blocking diagnostics and cannot be approved.',
      );
    }
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) {
      return persistNewStaleMutation(
        input,
        run,
        requestFingerprint,
        drift,
      );
    }
    assertReceiptCapacity(run);
    const source = await readReferencePreviewSource(input.workspaceRoot, run.referenceId);
    let plan: ReferenceDeconstructionWorkPlan;
    try {
      plan = createReferenceDeconstructionWorkPlan({
        referenceId: run.referenceId,
        sourceChecksumSha256: run.sourceChecksumSha256,
        structureFingerprint: run.structureFingerprint,
        sourceText: source.sourceText,
        chapters: source.sourceManifest.detectedStructure.chapters,
      });
    } catch (error) {
      throw validationFrom(error, 'Reference full work plan is invalid.');
    }
    const now = normalizeNow(input.now);
    const revision = run.revision + 1;
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: revision,
      resultStatus: 'fullApproved',
    };
    const full: ReferenceFullDeconstructionState = {
      plan,
      units: plan.units.map((unit) => ({
        ...unit,
        status: 'queued',
        attemptIds: [],
      })),
      attempts: [],
      analysisQuality: {
        status: 'notEvaluated',
        coveragePercent: 0,
        blockingDiagnosticCount: 0,
        outputHashes: [],
      },
    };
    const next: ReferenceDeconstructionRun = {
      ...run,
      revision,
      status: 'fullApproved',
      full,
      fullApprovedAt: now,
      mutationReceipts: [...run.mutationReceipts, receipt],
      failure: undefined,
      updatedAt: now,
    };
    await writeRunYamlAtomic(input.workspaceRoot, run.runId, 'work-plan.yaml', plan);
    await writeRunState(input.workspaceRoot, next);
    await writeRunDiagnostics(input.workspaceRoot, next);
    return { run: next, receipt, replayed: false };
  });
}

export async function reserveReferenceFullDeconstructionUnit(
  input: MutateReferenceDeconstructionRunInput,
): Promise<ReferenceFullDeconstructionReservationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = fingerprintMutation({
      command: 'advance-full',
      referenceId: run.referenceId,
      runId: run.runId,
      baseRunRevision: input.baseRunRevision,
    });
    const previousReceipt = run.mutationReceipts.find((candidate) =>
      candidate.idempotencyKey === idempotencyKey);
    if (previousReceipt) {
      if (previousReceipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      return { run, receipt: previousReceipt, replayed: true };
    }
    assertRevision(run, input.baseRunRevision);
    if (!['fullApproved', 'fullRunning'].includes(run.status) || !run.full) {
      throw invalidTransition(run.status, 'fullRunning');
    }
    if (run.activeReservation) throw reservationConflict();
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) {
      return persistNewStaleMutation(input, run, requestFingerprint, drift);
    }
    assertReceiptCapacity(run);

    const unit = run.full.units.find((candidate) =>
      candidate.status === 'queued'
      && candidate.predecessorUnitIds.every((predecessorId) => {
        const predecessor = run.full!.units.find((item) => item.id === predecessorId);
        return predecessor?.status === 'completed' && Boolean(predecessor.selectedAttemptId);
      }));
    if (!unit) {
      throw new ReferenceDeconstructionConflictError(
        'Reference full deconstruction has no ready work unit.',
        'invalidTransition',
      );
    }

    const predecessorAttempts = unit.predecessorUnitIds.map((predecessorId) =>
      requireSelectedAttempt(run.full!, predecessorId));
    const rollingContext = unit.kind === 'chapterChunk' && predecessorAttempts.length
      ? await readRollingContextFromAttempt(
          input.workspaceRoot,
          run.runId,
          predecessorAttempts.at(-1)!,
        )
      : undefined;
    const predecessorOutputHashes = predecessorAttempts.map((attempt) =>
      requireAttemptOutputHash(attempt));
    const inputFingerprint = createReferenceDeconstructionStageInputFingerprint({
      sourceChecksumSha256: run.sourceChecksumSha256,
      structureFingerprint: run.structureFingerprint,
      stageId: unit.stageId,
      unitId: unit.id,
      options: {
        kind: unit.kind,
        chapterId: unit.chapterId ?? null,
        chunkId: unit.chunkId ?? null,
      },
      predecessorOutputHashes,
      ...(rollingContext ? { rollingContextHash: rollingContext.checksumSha256 } : {}),
    });
    const execution = await prepareReferenceFullExecution(input.workspaceRoot, run, unit);
    const attemptNumber = unit.attemptIds.length + 1;
    const attemptId = `${unit.id}-attempt-${String(attemptNumber).padStart(4, '0')}`;
    const now = await ensureReferenceAttemptInputManifest(
      input.workspaceRoot,
      run,
      unit,
      attemptId,
      inputFingerprint,
      predecessorOutputHashes,
      normalizeNow(input.now),
    );
    const reservation: ReferenceFullDeconstructionReservation = {
      kind: 'fullUnit',
      id: `full-reservation-${run.revision + 1}-${randomUUID()}`,
      idempotencyKey,
      unitId: unit.id,
      attemptId,
      inputFingerprint,
      startedAt: now,
    };
    const attempt: ReferenceDeconstructionAttemptSummary = {
      id: attemptId,
      unitId: unit.id,
      attemptNumber,
      status: 'running',
      inputFingerprint,
      predecessorOutputHashes,
      startedAt: now,
    };
    const revision = run.revision + 1;
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: revision,
      resultStatus: 'fullRunning',
    };
    const full: ReferenceFullDeconstructionState = {
      ...run.full,
      units: run.full.units.map((candidate) => candidate.id === unit.id
        ? {
            ...candidate,
            status: 'running',
            attemptIds: [...candidate.attemptIds, attemptId],
          }
        : candidate),
      attempts: [...run.full.attempts, attempt],
    };
    const next: ReferenceDeconstructionRun = {
      ...run,
      revision,
      status: 'fullRunning',
      full,
      activeReservation: reservation,
      failure: undefined,
      mutationReceipts: [...run.mutationReceipts, receipt],
      updatedAt: now,
    };
    await writeRunState(input.workspaceRoot, next);
    return { run: next, receipt, replayed: false, reservation, execution };
  });
}

export async function completeReferenceFullDeconstructionUnit(
  input: CompleteReferenceFullDeconstructionUnitInput,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    assertRevision(run, input.baseRunRevision);
    const reservation = assertFullReservation(run, input.reservationId);
    const full = run.full!;
    const unit = requireStoredUnit(full, reservation.unitId);
    const attempt = requireAttempt(full, reservation.attemptId);
    if (attempt.status !== 'running' || unit.status !== 'running') {
      throw reservationConflict();
    }
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) {
      return persistStaleRun(
        input.workspaceRoot,
        run,
        normalizeNow(input.now),
        drift,
        reservation.idempotencyKey,
        false,
      );
    }
    let output: ReferenceFullDeconstructionOutput;
    try {
      output = await parseStoredFullOutput(
        input.workspaceRoot,
        run,
        unit,
        input.output,
        createStoredOutputValidationContext(),
      );
    } catch (error) {
      const now = normalizeNow(input.now);
      return settleFullAttemptFailure(
        input.workspaceRoot,
        run,
        unit,
        attempt,
        reservation,
        {
          code: 'invalid_output',
          message: boundedText(
            sanitizeErrorMessage(error),
            'invalid output message',
            1_000,
          ),
          failedAt: now,
        },
        now,
      );
    }
    const outputHash = sha256(stableJson(output));
    const now = normalizeNow(input.now);
    try {
      await writeReferenceAttemptYaml(
        input.workspaceRoot,
        run.runId,
        unit,
        attempt.id,
        'findings.yaml',
        output,
      );
      await writeReferenceAttemptYaml(
        input.workspaceRoot,
        run.runId,
        unit,
        attempt.id,
        'receipt.yaml',
        {
          version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
          runId: run.runId,
          unitId: unit.id,
          attemptId: attempt.id,
          status: 'completed',
          inputFingerprint: attempt.inputFingerprint,
          outputHash,
          completedAt: now,
        },
      );
    } catch (error) {
      return settleFullAttemptFailure(
        input.workspaceRoot,
        run,
        unit,
        attempt,
        reservation,
        {
          code: 'artifact_conflict',
          message: boundedText(
            sanitizeErrorMessage(error),
            'attempt artifact failure message',
            1_000,
          ),
          failedAt: now,
        },
        now,
      );
    }
    const qualityReport = unit.kind === 'analysisQuality'
      ? output as ReferenceDeconstructionAnalysisQualityReport
      : undefined;
    const quality = qualityReport
      ? {
          status: qualityReport.status,
          coveragePercent: qualityReport.coverage.percent,
          blockingDiagnosticCount: qualityReport.diagnostics.filter((item) =>
            item.blocking).length,
          outputHashes: [...qualityReport.outputHashes],
        } satisfies ReferenceDeconstructionAnalysisQualitySummary
      : full.analysisQuality;
    const resultStatus: ReferenceDeconstructionRunStatus = unit.kind === 'analysisQuality'
      ? quality?.status === 'passed' ? 'reviewReady' : 'failed'
      : 'fullRunning';
    const nextFull: ReferenceFullDeconstructionState = {
      ...full,
      units: full.units.map((candidate) => candidate.id === unit.id
        ? { ...candidate, status: 'completed', selectedAttemptId: attempt.id }
        : candidate),
      attempts: full.attempts.map((candidate) => candidate.id === attempt.id
        ? { ...candidate, status: 'completed', outputHash, completedAt: now }
        : candidate),
      ...(quality ? { analysisQuality: quality } : {}),
    };
    const diagnostics = qualityReport
      ? mergeRunDiagnostics(run.diagnostics, qualityReport.diagnostics)
      : run.diagnostics;
    const next: ReferenceDeconstructionRun = {
      ...run,
      status: resultStatus,
      full: nextFull,
      diagnostics,
      mutationReceipts: updateReceiptStatus(
        run.mutationReceipts,
        reservation.idempotencyKey,
        run.revision,
        resultStatus,
      ),
      activeReservation: undefined,
      ...(resultStatus === 'failed'
        ? {
            failure: {
              code: 'analysis_quality_failed',
              message: 'Reference analysis quality gate failed.',
              failedAt: now,
            },
          }
        : { failure: undefined }),
      updatedAt: now,
    };
    await writeRunState(input.workspaceRoot, next);
    await writeRunDiagnostics(input.workspaceRoot, next);
    return next;
  });
}

export async function failReferenceFullDeconstructionUnit(
  input: FailReferenceFullDeconstructionUnitInput,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    assertRevision(run, input.baseRunRevision);
    const reservation = assertFullReservation(run, input.reservationId);
    const full = run.full!;
    const unit = requireStoredUnit(full, reservation.unitId);
    const attempt = requireAttempt(full, reservation.attemptId);
    const now = normalizeNow(input.now);
    const failure: ReferenceDeconstructionRunFailure = {
      code: assertCode(input.errorCode, 'errorCode'),
      message: boundedText(input.errorMessage, 'errorMessage', 1_000),
      failedAt: now,
    };
    return settleFullAttemptFailure(
      input.workspaceRoot,
      run,
      unit,
      attempt,
      reservation,
      failure,
      now,
    );
  });
}

async function settleFullAttemptFailure(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  unit: ReferenceDeconstructionStoredUnit,
  attempt: ReferenceDeconstructionAttemptSummary,
  reservation: ReferenceFullDeconstructionReservation,
  failure: ReferenceDeconstructionRunFailure,
  completedAt: string,
): Promise<ReferenceDeconstructionRun> {
  await writeReferenceAttemptYaml(
    workspaceRoot,
    run.runId,
    unit,
    attempt.id,
    'receipt.yaml',
    {
      version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
      runId: run.runId,
      unitId: unit.id,
      attemptId: attempt.id,
      status: 'failed',
      inputFingerprint: attempt.inputFingerprint,
      failure,
      completedAt,
    },
  );
  return adoptFailedFullAttempt(
    workspaceRoot,
    run,
    unit,
    attempt,
    reservation,
    failure,
    completedAt,
  );
}

export async function interruptReferenceFullDeconstructionUnit(
  input: InterruptReferenceFullDeconstructionUnitInput,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    assertRevision(run, input.baseRunRevision);
    if (
      run.status !== 'fullRunning'
      || run.activeReservation?.kind !== 'fullUnit'
      || input.reservationId && run.activeReservation.id !== input.reservationId
    ) {
      throw reservationConflict();
    }
    return persistInterruptedFullRun(input.workspaceRoot, run, normalizeNow(input.now));
  });
}

export async function pauseReferenceDeconstructionRun(
  input: MutateReferenceDeconstructionRunInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return mutateFullControl(input, 'pause', ['fullRunning'], 'paused', (run) => {
    if (run.activeReservation) {
      throw new ReferenceDeconstructionConflictError(
        'A running provider unit must settle before the run can be paused.',
        'reservationConflict',
      );
    }
    return run;
  });
}

export async function resumeReferenceDeconstructionRun(
  input: MutateReferenceDeconstructionRunInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return mutateFullControl(
    input,
    'resume',
    ['paused', 'interrupted'],
    'fullRunning',
    (run) => ({
      ...run,
      full: run.full
        ? {
            ...run.full,
            units: run.full.units.map((unit) => unit.status === 'interrupted'
              ? { ...unit, status: 'queued' }
              : unit),
          }
        : undefined,
    }),
  );
}

export async function retryReferenceDeconstructionUnit(
  input: RetryReferenceDeconstructionUnitInput,
): Promise<ReferenceDeconstructionMutationResult> {
  const unitId = assertSafeIdentifier(input.unitId, 'unitId');
  return mutateFullControl(
    input,
    'retry',
    ['failed', 'fullRunning', 'paused', 'interrupted'],
    'fullRunning',
    (run) => {
      if (!run.full || run.activeReservation) throw reservationConflict();
      const selected = requireStoredUnit(run.full, unitId);
      if (!['failed', 'completed', 'interrupted'].includes(selected.status)) {
        throw new ReferenceDeconstructionConflictError(
          `Reference unit ${unitId} is not retryable from ${selected.status}.`,
          'invalidTransition',
        );
      }
      const invalidated = collectDependentUnitIds(run.full, unitId);
      return {
        ...run,
        full: {
          ...run.full,
          units: run.full.units.map((unit) => invalidated.has(unit.id)
            ? { ...unit, status: 'queued', selectedAttemptId: undefined }
            : unit),
          analysisQuality: {
            status: 'notEvaluated',
            coveragePercent: 0,
            blockingDiagnosticCount: 0,
            outputHashes: [],
          },
        },
        diagnostics: run.diagnostics.filter((diagnostic) =>
          !diagnostic.code.startsWith('quality.')
          && diagnostic.stageId !== 'qualityGate'
          && (!diagnostic.unitId || !invalidated.has(diagnostic.unitId))),
      };
    },
    { unitId },
  );
}

export async function cancelReferenceDeconstructionRun(
  input: MutateReferenceDeconstructionRunInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return mutateWithReceipt(
    input,
    'cancel',
    CANCELLABLE_RUN_STATUSES,
    (run, _receipt, now) => {
      const reservation = run.activeReservation;
      return {
        ...run,
        revision: run.revision + 1,
        status: 'cancelled',
        ...(run.full
          ? {
              full: {
                ...run.full,
                units: run.full.units.map((unit) =>
                  reservation?.kind === 'fullUnit' && unit.id === reservation.unitId
                    ? { ...unit, status: 'cancelled' as const }
                    : unit),
                attempts: run.full.attempts.map((attempt) =>
                  reservation?.kind === 'fullUnit' && attempt.id === reservation.attemptId
                    ? { ...attempt, status: 'cancelled' as const, completedAt: now }
                    : attempt),
              },
            }
          : {}),
        activeReservation: undefined,
        failure: undefined,
        cancelledAt: now,
        updatedAt: now,
      };
    },
  );
}

export async function reconcileReferenceDeconstructionRun(
  workspaceRoot: string,
  referenceId: string,
  runId: string,
  now?: string,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(workspaceRoot, referenceId, async () => {
    const run = await readRunState(workspaceRoot, referenceId, runId);
    if (ACTIVE_RUN_STATUSES.includes(run.status)) {
      const drift = await detectRunSourceDrift(workspaceRoot, run);
      if (drift) {
        const receipt = run.mutationReceipts.at(-1);
        if (!receipt) {
          throw new ReferenceDeconstructionValidationError(
            'Reference run mutation receipt is missing.',
          );
        }
        return persistStaleRun(
          workspaceRoot,
          run,
          normalizeNow(now),
          drift,
          receipt.idempotencyKey,
          false,
        );
      }
    }
    if (run.status === 'previewRunning') {
      return persistInterruptedRun(workspaceRoot, run, normalizeNow(now));
    }
    if (run.status === 'fullRunning' && run.activeReservation?.kind === 'fullUnit') {
      const adopted = await tryAdoptTerminalFullAttempt(
        workspaceRoot,
        run,
        normalizeNow(now),
      );
      if (adopted) return adopted;
      return persistInterruptedFullRun(workspaceRoot, run, normalizeNow(now));
    }
    return run;
  });
}

async function tryAdoptTerminalFullAttempt(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  now: string,
): Promise<ReferenceDeconstructionRun | undefined> {
  if (!run.full || run.activeReservation?.kind !== 'fullUnit') return undefined;
  const reservation = run.activeReservation;
  const unit = requireStoredUnit(run.full, reservation.unitId);
  const attempt = requireAttempt(run.full, reservation.attemptId);
  let receiptValue: unknown;
  try {
    const receiptPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      workspaceRoot,
      run.runId,
      unit.stageId,
      attempt.id,
      'receipt.yaml',
      { requireExistingArtifact: true },
    );
    receiptValue = await readYamlOrValidation(
      receiptPath,
      'Reference attempt receipt is invalid.',
    );
  } catch (error) {
    if (error instanceof ReferenceDeconstructionNotFoundError) return undefined;
    return undefined;
  }
  const receipt = isRecord(receiptValue) ? receiptValue : undefined;
  if (!receipt) return undefined;
  try {
    if (
      receipt.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
      || receipt.runId !== run.runId
      || receipt.unitId !== unit.id
      || receipt.attemptId !== attempt.id
      || receipt.inputFingerprint !== reservation.inputFingerprint
      || receipt.inputFingerprint !== attempt.inputFingerprint
    ) return undefined;
    if (receipt.status === 'failed') {
      assertOnlyKnownFields(receipt, [
        'version',
        'runId',
        'unitId',
        'attemptId',
        'status',
        'inputFingerprint',
        'failure',
        'completedAt',
      ]);
      const failure = assertStoredFailure(receipt.failure);
      const completedAt = assertIsoDate(receipt.completedAt, 'attempt receipt completedAt');
      if (failure.failedAt !== completedAt) return undefined;
      return adoptFailedFullAttempt(
        workspaceRoot,
        run,
        unit,
        attempt,
        reservation,
        failure,
        completedAt,
      );
    }
    assertOnlyKnownFields(receipt, [
      'version',
      'runId',
      'unitId',
      'attemptId',
      'status',
      'inputFingerprint',
      'outputHash',
      'completedAt',
    ]);
    if (receipt.status !== 'completed') return undefined;
    const outputHash = assertSha256(receipt.outputHash, 'attempt receipt outputHash');
    const completedAt = assertIsoDate(receipt.completedAt, 'attempt receipt completedAt');
    const findingsPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      workspaceRoot,
      run.runId,
      unit.stageId,
      attempt.id,
      'findings.yaml',
      { requireExistingArtifact: true },
    );
    const storedOutput = await readYamlOrValidation(
      findingsPath,
      'Reference attempt findings are invalid.',
    );
    if (sha256(stableJson(storedOutput)) !== outputHash) return undefined;
    const output = await parseStoredFullOutput(
      workspaceRoot,
      run,
      unit,
      storedOutput,
      createStoredOutputValidationContext(),
    );
    const qualityReport = unit.kind === 'analysisQuality'
      ? output as ReferenceDeconstructionAnalysisQualityReport
      : undefined;
    const quality = qualityReport
      ? {
          status: qualityReport.status,
          coveragePercent: qualityReport.coverage.percent,
          blockingDiagnosticCount: qualityReport.diagnostics.filter((item) =>
            item.blocking).length,
          outputHashes: [...qualityReport.outputHashes],
        } satisfies ReferenceDeconstructionAnalysisQualitySummary
      : run.full.analysisQuality;
    const diagnostics = qualityReport
      ? mergeRunDiagnostics(run.diagnostics, qualityReport.diagnostics)
      : run.diagnostics;
    const resultStatus: ReferenceDeconstructionRunStatus = unit.kind === 'analysisQuality'
      ? quality?.status === 'passed' ? 'reviewReady' : 'failed'
      : 'fullRunning';
    const next: ReferenceDeconstructionRun = {
      ...run,
      status: resultStatus,
      full: {
        ...run.full,
        units: run.full.units.map((candidate) => candidate.id === unit.id
          ? { ...candidate, status: 'completed', selectedAttemptId: attempt.id }
          : candidate),
        attempts: run.full.attempts.map((candidate) => candidate.id === attempt.id
          ? { ...candidate, status: 'completed', outputHash, completedAt }
          : candidate),
        ...(quality ? { analysisQuality: quality } : {}),
      },
      diagnostics,
      mutationReceipts: updateReceiptStatus(
        run.mutationReceipts,
        reservation.idempotencyKey,
        run.revision,
        resultStatus,
      ),
      activeReservation: undefined,
      ...(resultStatus === 'failed'
        ? {
            failure: {
              code: 'analysis_quality_failed',
              message: 'Reference analysis quality gate failed.',
              failedAt: now,
            },
          }
        : { failure: undefined }),
      updatedAt: now,
    };
    await writeRunState(workspaceRoot, next);
    await writeRunDiagnostics(workspaceRoot, next);
    return next;
  } catch {
    return undefined;
  }
}

async function adoptFailedFullAttempt(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  unit: ReferenceDeconstructionStoredUnit,
  attempt: ReferenceDeconstructionAttemptSummary,
  reservation: ReferenceFullDeconstructionReservation,
  failure: ReferenceDeconstructionRunFailure,
  completedAt: string,
): Promise<ReferenceDeconstructionRun> {
  const diagnostic = normalizeStoreDiagnostic({
    id: `full-unit-failed-${unit.id}-${attempt.attemptNumber}`,
    code: `full.${failure.code}`,
    severity: 'error',
    blocking: true,
    message: failure.message,
    evidenceRefs: [],
    stageId: unit.stageId,
    unitId: unit.id,
    attemptId: attempt.id,
  });
  const diagnostics = appendLifecycleDiagnostic(run.diagnostics, diagnostic);
  const next: ReferenceDeconstructionRun = {
    ...run,
    status: 'failed',
    full: {
      ...run.full!,
      units: run.full!.units.map((candidate) => candidate.id === unit.id
        ? { ...candidate, status: 'failed' }
        : candidate),
      attempts: run.full!.attempts.map((candidate) => candidate.id === attempt.id
        ? { ...candidate, status: 'failed', completedAt, failure }
        : candidate),
      analysisQuality: {
        ...(run.full!.analysisQuality ?? {
          status: 'notEvaluated',
          coveragePercent: 0,
          outputHashes: [],
        }),
        blockingDiagnosticCount: diagnostics.filter((item) => item.blocking).length,
      },
    },
    diagnostics,
    mutationReceipts: updateReceiptStatus(
      run.mutationReceipts,
      reservation.idempotencyKey,
      run.revision,
      'failed',
    ),
    activeReservation: undefined,
    failure,
    updatedAt: completedAt,
  };
  await writeRunState(workspaceRoot, next);
  await writeRunDiagnostics(workspaceRoot, next);
  return next;
}

export async function listReferenceDeconstructionRuns(
  workspaceRoot: string,
  referenceId?: string,
): Promise<ReferenceDeconstructionRun[]> {
  return listReferenceDeconstructionRunsUnlocked(workspaceRoot, referenceId);
}

export function projectReferenceDeconstructionRunForTransport(
  run: ReferenceDeconstructionRun,
): ReferenceDeconstructionRunTransport {
  return {
    schemaVersion: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    id: run.runId,
    referenceId: run.referenceId,
    runRevision: run.revision,
    status: run.status,
    sourceChecksumSha256: run.sourceChecksumSha256,
    structureFingerprint: run.structureFingerprint,
    pipelineVersion: REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
    capabilityVersion: REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
    selectedChapterIds: [...run.selection.selectedChapterIds],
    evidence: run.evidence.map((item) => ({
      id: item.id,
      pointer: { ...item.pointer },
    })),
    ...(run.preview ? { preview: run.preview } : {}),
    diagnostics: [...run.diagnostics],
    mutationReceipts: run.mutationReceipts.slice(
      -MAX_REFERENCE_DECONSTRUCTION_TRANSPORT_RECEIPTS,
    ),
    receiptCount: run.mutationReceipts.length,
    ...(run.full ? { full: projectReferenceFullDeconstruction(run.full) } : {}),
    ...(run.publication
      ? {
          publication: {
            ...run.publication,
            files: run.publication.files.map((file) => ({ ...file })),
            entryInventory: run.publication.entryInventory.map((entry) => ({ ...entry })),
          },
        }
      : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.fullApprovedAt ? { fullApprovedAt: run.fullApprovedAt } : {}),
  };
}

function projectReferenceFullDeconstruction(
  full: ReferenceFullDeconstructionState,
): ReferenceFullDeconstructionTransport {
  const stageIds: ReferenceFullDeconstructionStageSummary['stageId'][] = [
    'chapterAnalysis',
    'aggregateAnalysis',
    'styleProfile',
    'distillForOan',
    'qualityGate',
  ];
  const stages = stageIds.map((stageId): ReferenceFullDeconstructionStageSummary => {
    const units = full.units.filter((unit) => unit.stageId === stageId);
    const completedUnits = units.filter((unit) => unit.status === 'completed').length;
    const failedUnits = units.filter((unit) =>
      unit.status === 'failed' || unit.status === 'interrupted').length;
    const status: ReferenceFullDeconstructionStageSummary['status'] = units.every((unit) =>
      unit.status === 'completed')
      ? 'completed'
      : units.some((unit) => unit.status === 'stale')
        ? 'stale'
        : units.some((unit) => unit.status === 'cancelled')
          ? 'cancelled'
          : failedUnits
            ? 'failed'
            : units.some((unit) => unit.status === 'running' || unit.status === 'completed')
              ? 'running'
              : 'queued';
    return {
      stageId,
      status,
      plannedUnits: units.length,
      completedUnits,
      failedUnits,
    };
  });
  const completedUnits = full.units.filter((unit) => unit.status === 'completed').length;
  const failedUnits = full.units.filter((unit) =>
    unit.status === 'failed' || unit.status === 'interrupted').length;
  const completedChapters = new Set(full.units.filter((unit) =>
    unit.kind === 'chapterChunk'
    && unit.isLastChunkInChapter
    && unit.status === 'completed')
    .map((unit) => unit.chapterId)).size;
  const ready = (unit: ReferenceDeconstructionStoredUnit) =>
    unit.status === 'queued'
    && unit.predecessorUnitIds.every((predecessorId) => {
      const predecessor = full.units.find((candidate) => candidate.id === predecessorId);
      return predecessor?.status === 'completed' && Boolean(predecessor.selectedAttemptId);
    });
  const nextUnit = full.units.find(ready);
  const currentUnit = full.units.find((unit) => unit.status === 'running');
  const failedUnit = full.units.find((unit) =>
    unit.status === 'failed' || unit.status === 'interrupted');
  return {
    stages,
    progress: {
      plannedUnits: full.units.length,
      completedUnits,
      failedUnits,
      completedChapters,
      totalChapters: full.plan.chapterIds.length,
      percent: Math.round((completedUnits / full.units.length) * 100),
    },
    ...(nextUnit ? { nextUnit: projectReferenceFullUnit(nextUnit) } : {}),
    ...(currentUnit ? { currentUnit: projectReferenceFullUnit(currentUnit) } : {}),
    ...(failedUnit ? { failedUnit: projectReferenceFullUnit(failedUnit) } : {}),
    recentUnits: full.units.slice(-64).map(projectReferenceFullUnit),
    recentAttempts: full.attempts.slice(-64).map((attempt) => ({
      id: attempt.id,
      unitId: attempt.unitId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      inputFingerprint: attempt.inputFingerprint,
      ...(attempt.outputHash ? { outputHash: attempt.outputHash } : {}),
      startedAt: attempt.startedAt,
      ...(attempt.completedAt ? { completedAt: attempt.completedAt } : {}),
    })),
    ...(full.analysisQuality ? { analysisQuality: { ...full.analysisQuality } } : {}),
  };
}

function projectReferenceFullUnit(
  unit: ReferenceDeconstructionStoredUnit,
): ReferenceDeconstructionUnitTransport {
  return {
    id: unit.id,
    ordinal: unit.ordinal,
    stageId: unit.stageId,
    kind: unit.kind,
    ...(unit.chapterId ? { chapterId: unit.chapterId } : {}),
    ...(unit.chunkId ? { chunkId: unit.chunkId } : {}),
    status: unit.status,
    attemptCount: unit.attemptIds.length,
    ...(unit.selectedAttemptId ? { selectedAttemptId: unit.selectedAttemptId } : {}),
  };
}

export async function readReferencePreviewSource(
  workspaceRoot: string,
  referenceId: string,
): Promise<ReferencePreviewSource> {
  const identity = await readReferenceBundleIdentity(workspaceRoot, referenceId);
  const {
    safeReferenceId,
    bundleRoot,
    metadata,
    sourceManifest,
    deconstructionManifest,
  } = identity;
  const sourcePath = await resolveContainedExistingPath(
    bundleRoot,
    join('sources', sourceManifest.originalFile),
  );
  const sourceText = await readFile(sourcePath, 'utf-8');
  const actualChecksum = sha256(sourceText);
  if (metadata.checksumSha256 !== actualChecksum) {
    throw new ReferenceDeconstructionValidationError(
      'Reference source checksum is stale.',
    );
  }
  return { metadata, sourceManifest, deconstructionManifest, sourceText };
}

async function readReferenceBundleIdentity(
  workspaceRoot: string,
  referenceId: string,
): Promise<{
  safeReferenceId: string;
  bundleRoot: string;
  metadata: ReferenceMetadata;
  sourceManifest: ReferenceSourceManifest;
  deconstructionManifest: ReferenceDeconstructionManifest;
}> {
  const safeReferenceId = assertSafeIdentifier(referenceId, 'referenceId');
  const bundleRoot = resolveReferenceBundleRoot(workspaceRoot, safeReferenceId);
  await assertRealBundleInsideWorkspace(workspaceRoot, bundleRoot);
  const [metadataPath, sourceManifestPath, deconstructionPath] = await Promise.all([
    resolveContainedExistingPath(bundleRoot, 'metadata.yaml'),
    resolveContainedExistingPath(bundleRoot, join('sources', 'source-manifest.yaml')),
    resolveContainedExistingPath(bundleRoot, 'deconstruction-manifest.yaml'),
  ]);
  const [metadataValue, sourceManifestValue, deconstructionValue] = await Promise.all([
    readYamlOrValidation(metadataPath, 'Reference metadata is missing.'),
    readYamlOrValidation(
      sourceManifestPath,
      'Reference source manifest is missing.',
    ),
    readYamlOrValidation(
      deconstructionPath,
      'Reference deconstruction manifest is missing.',
    ),
  ]);
  const metadata = assertReferenceMetadata(metadataValue);
  const sourceManifest = assertReferenceSourceManifest(sourceManifestValue);
  let deconstructionManifest: ReferenceDeconstructionManifest;
  try {
    deconstructionManifest = assertReferenceDeconstructionManifest(deconstructionValue);
  } catch (error) {
    throw validationFrom(error);
  }
  if (
    metadata.id !== safeReferenceId
    || sourceManifest.referenceId !== safeReferenceId
    || deconstructionManifest.referenceId !== safeReferenceId
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference bundle identities do not match.',
    );
  }
  const expectedStructureFingerprint = createReferenceStructureFingerprint(
    sourceManifest.detectedStructure,
  );
  if (
    metadata.checksumSha256 !== sourceManifest.checksumSha256
    || deconstructionManifest.sourceChecksumSha256 !== sourceManifest.checksumSha256
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference source checksum identity is stale.',
    );
  }
  if (
    sourceManifest.structureFingerprint !== expectedStructureFingerprint
    || deconstructionManifest.structureFingerprint !== expectedStructureFingerprint
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference structure fingerprint is stale.',
    );
  }
  return {
    safeReferenceId,
    bundleRoot,
    metadata,
    sourceManifest,
    deconstructionManifest,
  };
}

async function readPublishedReferenceBundleIdentity(
  workspaceRoot: string,
  referenceId: string,
): Promise<{
  safeReferenceId: string;
  bundleRoot: string;
  metadata: ReferenceMetadata;
  sourceManifest?: ReferenceSourceManifest;
  deconstructionManifest: ReferenceDeconstructionManifest;
}> {
  const safeReferenceId = assertSafeIdentifier(referenceId, 'referenceId');
  const bundleRoot = resolveReferenceBundleRoot(workspaceRoot, safeReferenceId);
  await assertRealBundleInsideWorkspace(workspaceRoot, bundleRoot);
  const [metadataPath, deconstructionPath] = await Promise.all([
    resolveContainedExistingPath(bundleRoot, 'metadata.yaml'),
    resolveContainedExistingPath(bundleRoot, 'deconstruction-manifest.yaml'),
  ]);
  const [metadataValue, deconstructionValue] = await Promise.all([
    readYamlOrValidation(metadataPath, 'Reference metadata is missing.'),
    readYamlOrValidation(
      deconstructionPath,
      'Reference deconstruction manifest is missing.',
    ),
  ]);
  const metadata = assertReferenceMetadata(metadataValue);
  const deconstructionManifest = assertReferenceDeconstructionManifest(
    deconstructionValue,
  );
  if (
    metadata.id !== safeReferenceId
    || deconstructionManifest.referenceId !== safeReferenceId
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference published bundle identities do not match.',
    );
  }
  if (metadata.checksumSha256 !== deconstructionManifest.sourceChecksumSha256) {
    throw new ReferenceDeconstructionValidationError(
      'Reference published source checksum identity is stale.',
    );
  }
  return {
    safeReferenceId,
    bundleRoot,
    metadata,
    deconstructionManifest,
  };
}

export async function inspectReferenceWorkReadiness(
  workspaceRoot: string,
  referenceId: string,
): Promise<ReferenceReadinessInspection> {
  return inspectReferenceWorkReadinessInternal(workspaceRoot, referenceId, true);
}

export async function inspectPublishedReferenceWorkReadiness(
  workspaceRoot: string,
  referenceId: string,
): Promise<ReferenceReadinessInspection> {
  return inspectReferenceWorkReadinessInternal(workspaceRoot, referenceId, false);
}

async function inspectReferenceWorkReadinessInternal(
  workspaceRoot: string,
  referenceId: string,
  verifyOriginalSource: boolean,
): Promise<ReferenceReadinessInspection> {
  const safeReferenceId = assertSafeIdentifier(referenceId, 'referenceId');
  let source: Awaited<ReturnType<typeof readPublishedReferenceBundleIdentity>>;
  try {
    source = verifyOriginalSource
      ? {
          ...(await readReferencePreviewSource(workspaceRoot, safeReferenceId)),
          safeReferenceId,
          bundleRoot: resolveReferenceBundleRoot(workspaceRoot, safeReferenceId),
        }
      : await readPublishedReferenceBundleIdentity(
          workspaceRoot,
          safeReferenceId,
        );
  } catch (error) {
    const stale = error instanceof ReferenceDeconstructionValidationError
      && /checksum|fingerprint/u.test(error.message);
    return failedReadiness(
      stale ? 'stale' : 'needsRebuild',
      stale ? 'stale' : 'needsRebuild',
      error,
    );
  }
  const { metadata, sourceManifest, deconstructionManifest } = source;
  const bundleRoot = resolveReferenceBundleRoot(workspaceRoot, safeReferenceId);
  let progress: import('./reference-deconstruction.js').ReferenceProgress;
  let persistedDiagnostics: ReferenceDeconstructionDiagnostics;
  try {
    const [diagnosticsPath, progressPath] = await Promise.all([
      resolveContainedExistingPath(bundleRoot, 'diagnostics.yaml'),
      resolveContainedExistingPath(bundleRoot, 'progress.yaml'),
    ]);
    persistedDiagnostics = assertReferenceDeconstructionDiagnostics(
      await readYamlOrValidation(diagnosticsPath, 'Reference diagnostics are missing.'),
    );
    progress = assertReferenceProgress(
      await readYamlOrValidation(progressPath, 'Reference progress projection is missing.'),
    );
    const expectedProgress = createReferenceProgressProjection(
      deconstructionManifest,
      progress.updatedAt,
    );
    if (
      persistedDiagnostics.referenceId !== safeReferenceId
      || persistedDiagnostics.sourceChecksumSha256
        !== deconstructionManifest.sourceChecksumSha256
      || progress.referenceId !== safeReferenceId
      || stableJson(progress) !== stableJson(expectedProgress)
      || REFERENCE_DECONSTRUCTION_STAGE_IDS.some((stageId) =>
        progress.stages[stageId] !== deconstructionManifest.stages[stageId].status)
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference projections do not match bundle identity.',
      );
    }
  } catch (error) {
    return failedReadiness('needsRebuild', 'needsRebuild', error, {
      metadata,
      sourceManifest,
      deconstructionManifest,
    });
  }

  if (deconstructionManifest.status !== 'completed') {
    const reason: ReferenceReadinessReason = !metadata.enabled
      ? 'disabled'
      : deconstructionManifest.status === 'qualityFailed'
        ? 'qualityFailed'
        : deconstructionManifest.status === 'stale'
          ? 'stale'
          : deconstructionManifest.status === 'needsRebuild'
            ? 'needsRebuild'
            : 'notAnalyzed';
    return {
      status: deconstructionManifest.status,
      contextEligible: false,
      reason,
      diagnostics: persistedDiagnostics.items,
      metadata,
      sourceManifest,
      deconstructionManifest,
      progress,
    };
  }
  if (deconstructionManifest.qualityStatus !== 'passed') {
    return {
      status: 'qualityFailed',
      contextEligible: false,
      reason: 'qualityFailed',
      diagnostics: persistedDiagnostics.items,
      metadata,
      sourceManifest,
      deconstructionManifest,
      progress,
    };
  }
  if (persistedDiagnostics.items.some((item) => item.blocking)) {
    return {
      status: 'qualityFailed',
      contextEligible: false,
      reason: 'qualityFailed',
      diagnostics: persistedDiagnostics.items,
      metadata,
      sourceManifest,
      deconstructionManifest,
      progress,
    };
  }

  const summaryOutput = deconstructionManifest.outputs.find((output) =>
    output.kind === 'context' && output.path === 'context/reference-summary.md');
  const contextIndexOutput = deconstructionManifest.outputs.find((output) =>
    output.kind === 'context' && output.path === 'context/index.yaml');
  if (!summaryOutput || !contextIndexOutput) {
    return {
      status: 'needsRebuild',
      contextEligible: false,
      reason: summaryOutput ? 'invalidContextIndex' : 'missingContextSummary',
      diagnostics: persistedDiagnostics.items,
      metadata,
      sourceManifest,
      deconstructionManifest,
      progress,
    };
  }
  try {
    if (
      new Set(deconstructionManifest.outputs.map((output) => output.path)).size
        !== deconstructionManifest.outputs.length
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference published output paths must be unique.',
      );
    }
    const readVerifiedOutput = async (
      output: ReferenceDeconstructionManifest['outputs'][number],
    ) => {
      const absolutePath = await resolveContainedExistingPath(bundleRoot, output.path);
      const content = await readFile(absolutePath, 'utf-8');
      if (sha256(content) !== output.checksumSha256) {
        throw new ReferenceDeconstructionValidationError(
          `Reference published output checksum is stale: ${output.path}.`,
        );
      }
      return [output.path, content] as const;
    };
    const contextOutputs = await Promise.all([
      readVerifiedOutput(summaryOutput),
      readVerifiedOutput(contextIndexOutput),
    ]);
    const contextOutputMap = new Map(contextOutputs);
    const contextIndexContent = contextOutputMap.get(contextIndexOutput.path);
    if (contextIndexContent === undefined) {
      throw new ReferenceDeconstructionValidationError(
        'Reference context index was not verified.',
      );
    }
    const contextIndex = assertReferenceContextIndex(
      parse(contextIndexContent) as unknown,
      {
        referenceId: safeReferenceId,
        publishedRunId: deconstructionManifest.publishedRunId,
        sourceChecksumSha256: deconstructionManifest.sourceChecksumSha256,
        structureFingerprint: deconstructionManifest.structureFingerprint,
      },
    );
    const distilledOutputs = [...new Set(
      contextIndex.entries.map((entry) => entry.path),
    )].map((path) => {
      const matches = deconstructionManifest.outputs.filter((output) =>
        output.kind === 'distilled' && output.path === path);
      if (matches.length !== 1) {
        throw new ReferenceDeconstructionValidationError(
          `Reference context entry path is not a unique distilled output: ${path}.`,
        );
      }
      return matches[0]!;
    });
    const outputsToVerify = verifyOriginalSource
      ? deconstructionManifest.outputs
      : distilledOutputs;
    const verifiedOutputs = verifyOriginalSource
      ? await Promise.all(outputsToVerify.map(readVerifiedOutput))
      : [
          ...contextOutputs,
          ...await Promise.all(outputsToVerify.map(readVerifiedOutput)),
        ];
    const verifiedOutputMap = new Map(verifiedOutputs);
    const summaryContent = verifiedOutputMap.get(summaryOutput.path);
    if (summaryContent === undefined) {
      throw new ReferenceDeconstructionValidationError(
        'Reference context outputs were not verified.',
      );
    }
    for (const entry of contextIndex.entries) {
      if (!verifiedOutputMap.has(entry.path)) {
        throw new ReferenceDeconstructionValidationError(
          `Reference context entry path is not a verified distilled output: ${entry.path}.`,
        );
      }
    }
    const categoryCounts = Object.fromEntries(
      (['writingStyle', 'pacing', 'hooks', 'scene', 'character'] as const)
        .map((category) => [
          category,
          contextIndex.entries.filter((entry) => entry.category === category).length,
        ]),
    ) as Record<ReferenceDistilledCategory, number>;
    return {
      status: 'completed',
      contextEligible: metadata.enabled,
      reason: metadata.enabled ? 'ready' : 'disabled',
      diagnostics: persistedDiagnostics.items,
      summaryPath: `examples/references/${safeReferenceId}/${summaryOutput.path}`,
      summaryContent,
      contextIndexPath: `examples/references/${safeReferenceId}/${contextIndexOutput.path}`,
      contextIndex,
      publishedContext: {
        runId: contextIndex.publishedRunId,
        fingerprint: sha256(contextIndexContent),
        entryCount: contextIndex.entries.length,
        categoryCounts,
      },
      metadata,
      sourceManifest,
      deconstructionManifest,
      progress,
    };
  } catch (error) {
    return failedReadiness('stale', 'invalidContextIndex', error, {
      metadata,
      sourceManifest,
      deconstructionManifest,
      progress,
    });
  }
}

export function assertReferenceMetadata(value: unknown): ReferenceMetadata {
  const record = requireRecord(value, 'Reference metadata');
  assertOnlyKnownFields(record, [
    'version',
    'id',
    'title',
    'sourceType',
    'rights',
    'allowedUsage',
    'enabled',
    'importedAt',
    'checksumSha256',
    'sourcePath',
    'notes',
  ]);
  if (record.version !== 1) {
    throw new ReferenceDeconstructionValidationError(
      'Unsupported reference metadata version.',
    );
  }
  const allowedUsage = requireArray(record.allowedUsage, 'allowedUsage', 1, 4)
    .map((item) => requireEnum(item, [
      'analysisOnly',
      'styleInspiration',
      'structureReference',
      'noDirectQuotation',
    ] as const, 'allowedUsage'));
  if (new Set(allowedUsage).size !== allowedUsage.length) {
    throw new ReferenceDeconstructionValidationError('allowedUsage contains duplicates.');
  }
  return {
    version: 1,
    id: assertSafeIdentifier(record.id, 'metadata id'),
    title: boundedText(record.title, 'metadata title', 300),
    sourceType: requireEnum(record.sourceType, [
      'novel',
      'chapterSample',
      'styleSample',
      'settingBible',
      'notes',
    ] as const, 'sourceType'),
    rights: requireEnum(record.rights, [
      'owned',
      'publicDomain',
      'licensed',
      'excerpt',
      'unknown',
    ] as const, 'rights'),
    allowedUsage,
    enabled: requireBoolean(record.enabled, 'enabled'),
    importedAt: assertIsoDate(record.importedAt, 'importedAt'),
    checksumSha256: assertSha256(record.checksumSha256, 'checksumSha256'),
    ...(record.sourcePath === undefined
      ? {}
      : { sourcePath: boundedText(record.sourcePath, 'sourcePath', 2_000) }),
    ...(record.notes === undefined
      ? {}
      : { notes: boundedText(record.notes, 'notes', 4_000) }),
  };
}

export function assertReferenceSourceManifest(value: unknown): ReferenceSourceManifest {
  const record = requireRecord(value, 'Reference source manifest');
  assertOnlyKnownFields(record, [
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
  ]);
  if (record.version !== 1) {
    throw new ReferenceDeconstructionValidationError(
      'Unsupported reference source manifest version.',
    );
  }
  const originalFile = boundedText(record.originalFile, 'originalFile', 200);
  if (basename(originalFile) !== originalFile || originalFile === '.' || originalFile === '..') {
    throw new ReferenceDeconstructionValidationError('originalFile is invalid.');
  }
  const structure = requireRecord(record.detectedStructure, 'detectedStructure');
  assertOnlyKnownFields(structure, ['chapterCount', 'chapters', 'confidence']);
  const lineCount = safeInteger(record.lineCount, 'lineCount', 1);
  const chapters = requireArray(structure.chapters, 'chapters', 1, 100_000)
    .map((item, index) => {
      const chapter = requireRecord(item, `chapters[${index}]`);
      assertOnlyKnownFields(chapter, [
        'id',
        'title',
        'lineStart',
        'lineEnd',
        'wordCount',
      ]);
      const lineStart = safeInteger(chapter.lineStart, 'chapter lineStart', 1, lineCount);
      const lineEnd = safeInteger(chapter.lineEnd, 'chapter lineEnd', lineStart, lineCount);
      return {
        id: assertSafeIdentifier(chapter.id, 'chapter id'),
        title: boundedText(chapter.title, 'chapter title', 500),
        lineStart,
        lineEnd,
        wordCount: safeInteger(chapter.wordCount, 'chapter wordCount', 0),
      };
    });
  if (
    new Set(chapters.map((chapter) => chapter.id)).size !== chapters.length
    || chapters.some((chapter, index) =>
      index > 0 && chapter.lineStart <= (chapters[index - 1]?.lineEnd ?? 0))
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference chapter boundaries must be unique, ordered, and non-overlapping.',
    );
  }
  const chapterCount = safeInteger(structure.chapterCount, 'chapterCount', 1);
  if (chapterCount !== chapters.length) {
    throw new ReferenceDeconstructionValidationError(
      'Reference chapterCount does not match chapters.',
    );
  }
  return {
    version: 1,
    referenceId: assertSafeIdentifier(record.referenceId, 'referenceId'),
    originalFile,
    originalFileName: boundedText(record.originalFileName, 'originalFileName', 500),
    ...(record.sourcePath === undefined
      ? {}
      : { sourcePath: boundedText(record.sourcePath, 'sourcePath', 2_000) }),
    checksumSha256: assertSha256(record.checksumSha256, 'checksumSha256'),
    structureFingerprint: assertSha256(
      record.structureFingerprint,
      'structureFingerprint',
    ),
    importedAt: assertIsoDate(record.importedAt, 'importedAt'),
    byteLength: safeInteger(record.byteLength, 'byteLength', 0),
    charLength: safeInteger(record.charLength, 'charLength', 0),
    lineCount,
    detectedStructure: {
      chapterCount,
      chapters,
      confidence: requireEnum(
        structure.confidence,
        ['high', 'medium', 'low'] as const,
        'structure confidence',
      ),
    },
  };
}

async function mutateFullControl(
  input: MutateReferenceDeconstructionRunInput,
  command: 'pause' | 'resume' | 'retry',
  allowedStatuses: readonly ReferenceDeconstructionRunStatus[],
  resultStatus: ReferenceDeconstructionRunStatus,
  transform: (run: ReferenceDeconstructionRun) => ReferenceDeconstructionRun = (run) => run,
  fingerprintExtra: Record<string, unknown> = {},
): Promise<ReferenceDeconstructionMutationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = fingerprintMutation({
      command,
      referenceId: run.referenceId,
      runId: run.runId,
      baseRunRevision: input.baseRunRevision,
      ...fingerprintExtra,
    });
    const previousReceipt = run.mutationReceipts.find((candidate) =>
      candidate.idempotencyKey === idempotencyKey);
    if (previousReceipt) {
      if (previousReceipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      return { run, receipt: previousReceipt, replayed: true };
    }
    assertRevision(run, input.baseRunRevision);
    if (!run.full || !allowedStatuses.includes(run.status)) {
      throw invalidTransition(run.status, resultStatus);
    }
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) {
      return persistNewStaleMutation(input, run, requestFingerprint, drift);
    }
    assertReceiptCapacity(run);
    const transformed = transform(run);
    const now = normalizeNow(input.now);
    const revision = run.revision + 1;
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: revision,
      resultStatus,
    };
    const next: ReferenceDeconstructionRun = {
      ...transformed,
      revision,
      status: resultStatus,
      mutationReceipts: [...run.mutationReceipts, receipt],
      activeReservation: undefined,
      failure: undefined,
      updatedAt: now,
    };
    await writeRunState(input.workspaceRoot, next);
    await writeRunDiagnostics(input.workspaceRoot, next);
    return { run: next, receipt, replayed: false };
  });
}

async function persistNewStaleMutation(
  input: MutateReferenceDeconstructionRunInput,
  run: ReferenceDeconstructionRun,
  requestFingerprint: string,
  message: string,
): Promise<ReferenceDeconstructionMutationResult> {
  assertReceiptCapacity(run);
  const receipt: ReferenceDeconstructionMutationReceipt = {
    idempotencyKey: assertIdempotencyKey(input.idempotencyKey),
    requestFingerprint,
    resultingRunRevision: run.revision + 1,
    resultStatus: 'stale',
  };
  const stale = await persistStaleRun(
    input.workspaceRoot,
    { ...run, mutationReceipts: [...run.mutationReceipts, receipt] },
    normalizeNow(input.now),
    message,
    receipt.idempotencyKey,
    true,
  );
  return { run: stale, receipt, replayed: false };
}

function assertReceiptCapacity(run: ReferenceDeconstructionRun): void {
  if (run.mutationReceipts.length >= MAX_REFERENCE_DECONSTRUCTION_MUTATION_RECEIPTS) {
    throw new ReferenceDeconstructionValidationError(
      'Reference mutation receipt limit reached.',
    );
  }
}

async function mutateWithReceipt(
  input: MutateReferenceDeconstructionRunInput,
  command: 'advance' | 'approve-full' | 'cancel',
  allowedStatuses: readonly ReferenceDeconstructionRunStatus[],
  mutate: (
    run: ReferenceDeconstructionRun,
    receipt: ReferenceDeconstructionMutationReceipt,
    now: string,
  ) => ReferenceDeconstructionRun,
): Promise<ReferenceDeconstructionMutationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = fingerprintMutation({
      command,
      referenceId: run.referenceId,
      runId: run.runId,
      baseRunRevision: input.baseRunRevision,
    });
    const previousReceipt = run.mutationReceipts.find((receipt) =>
      receipt.idempotencyKey === idempotencyKey);
    if (previousReceipt) {
      if (previousReceipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      if (
        ACTIVE_RUN_STATUSES.includes(run.status)
        && run.mutationReceipts.at(-1)?.idempotencyKey === idempotencyKey
      ) {
        const drift = await detectRunSourceDrift(input.workspaceRoot, run);
        if (drift) {
          const stale = await persistStaleRun(
            input.workspaceRoot,
            run,
            normalizeNow(input.now),
            drift,
            idempotencyKey,
            false,
          );
          const staleReceipt = stale.mutationReceipts.find((receipt) =>
            receipt.idempotencyKey === idempotencyKey);
          if (!staleReceipt) {
            throw new ReferenceDeconstructionValidationError(
              'Reference mutation receipt is missing after stale reconciliation.',
            );
          }
          return { run: stale, receipt: staleReceipt, replayed: true };
        }
      }
      return { run, receipt: previousReceipt, replayed: true };
    }
    assertRevision(run, input.baseRunRevision);
    if (!allowedStatuses.includes(run.status)) {
      throw invalidTransition(run.status, command === 'advance'
        ? 'previewRunning'
        : command === 'approve-full'
          ? 'fullApproved'
          : 'cancelled');
    }
    if (run.mutationReceipts.length >= MAX_REFERENCE_DECONSTRUCTION_MUTATION_RECEIPTS) {
      throw new ReferenceDeconstructionValidationError(
        'Reference mutation receipt limit reached.',
      );
    }
    const nextRevision = run.revision + 1;
    if (command !== 'cancel') {
      const drift = await detectRunSourceDrift(input.workspaceRoot, run);
      if (drift) {
        const staleReceipt: ReferenceDeconstructionMutationReceipt = {
          idempotencyKey,
          requestFingerprint,
          resultingRunRevision: nextRevision,
          resultStatus: 'stale',
        };
        const stale = await persistStaleRun(
          input.workspaceRoot,
          { ...run, mutationReceipts: [...run.mutationReceipts, staleReceipt] },
          normalizeNow(input.now),
          drift,
          idempotencyKey,
          true,
        );
        return { run: stale, receipt: staleReceipt, replayed: false };
      }
    }
    if (
      command === 'approve-full'
      && run.diagnostics.some((diagnostic) => diagnostic.blocking)
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference Quick Preview has blocking diagnostics and cannot be approved.',
      );
    }
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: nextRevision,
      resultStatus: command === 'advance'
        ? 'previewRunning'
        : command === 'approve-full'
          ? 'fullApproved'
          : 'cancelled',
    };
    const mutated = mutate(run, receipt, normalizeNow(input.now));
    const next = {
      ...mutated,
      mutationReceipts: [...run.mutationReceipts, receipt],
    };
    await writeRunState(input.workspaceRoot, next);
    await writeRunDiagnostics(input.workspaceRoot, next);
    return { run: next, receipt, replayed: false };
  });
}

async function detectRunSourceDrift(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
): Promise<string | undefined> {
  try {
    const source = await readReferencePreviewSource(workspaceRoot, run.referenceId);
    if (
      source.sourceManifest.checksumSha256 !== run.sourceChecksumSha256
      || source.sourceManifest.structureFingerprint !== run.structureFingerprint
    ) {
      return 'Reference source identity changed after the preview run was created.';
    }
    return undefined;
  } catch (error) {
    return sanitizeErrorMessage(error);
  }
}

async function persistStaleRun(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  now: string,
  message: string,
  idempotencyKey: string,
  incrementRevision: boolean,
): Promise<ReferenceDeconstructionRun> {
  const revision = incrementRevision ? run.revision + 1 : run.revision;
  const diagnostic: ReferenceDeconstructionDiagnostic = {
    id: `source-stale-${revision}`,
    code: 'source.stale',
    severity: 'error',
    blocking: true,
    message: boundedText(message, 'source drift message', 1_000),
    evidenceRefs: [],
    stageId: 'quickPreview',
  };
  const diagnostics = appendLifecycleDiagnostic(run.diagnostics, diagnostic);
  const next: ReferenceDeconstructionRun = {
    ...run,
    revision,
    status: 'stale',
    diagnostics,
    ...(run.preview
      ? {
          preview: {
            ...run.preview,
            diagnostics: appendLifecycleDiagnostic(run.preview.diagnostics, diagnostic),
          },
        }
      : {}),
    mutationReceipts: updateReceiptStatus(
      run.mutationReceipts,
      idempotencyKey,
      revision,
      'stale',
    ),
    ...(run.full
      ? {
          full: {
            ...run.full,
            units: run.full.units.map((unit) =>
              run.activeReservation?.kind === 'fullUnit'
                && unit.id === run.activeReservation.unitId
                ? { ...unit, status: 'stale' as const }
                : unit),
            attempts: run.full.attempts.map((attempt) =>
              run.activeReservation?.kind === 'fullUnit'
                && attempt.id === run.activeReservation.attemptId
                ? { ...attempt, status: 'stale' as const, completedAt: now }
                : attempt),
            analysisQuality: {
              ...(run.full.analysisQuality ?? {
                status: 'notEvaluated',
                coveragePercent: 0,
                outputHashes: [],
              }),
              blockingDiagnosticCount: diagnostics.filter((item) => item.blocking).length,
            },
          },
        }
      : {}),
    activeReservation: undefined,
    failure: undefined,
    updatedAt: now,
  };
  await writeRunState(workspaceRoot, next);
  await writeRunDiagnostics(workspaceRoot, next);
  return next;
}

async function persistInterruptedRun(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  now: string,
): Promise<ReferenceDeconstructionRun> {
  const reservation = run.activeReservation;
  const diagnostic: ReferenceDeconstructionDiagnostic = {
    id: `preview-interrupted-${run.revision}`,
    code: 'preview.interrupted',
    severity: 'warning',
    blocking: false,
    message: 'The preview provider call was interrupted. It will not resume automatically.',
    evidenceRefs: [],
    stageId: 'quickPreview',
  };
  const next: ReferenceDeconstructionRun = {
    ...run,
    status: 'interrupted',
    diagnostics: appendLifecycleDiagnostic(run.diagnostics, diagnostic),
    mutationReceipts: reservation
      ? updateReceiptStatus(
          run.mutationReceipts,
          reservation.idempotencyKey,
          run.revision,
          'interrupted',
        )
      : run.mutationReceipts,
    activeReservation: undefined,
    updatedAt: now,
  };
  await writeRunState(workspaceRoot, next);
  await writeRunDiagnostics(workspaceRoot, next);
  return next;
}

async function persistInterruptedFullRun(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  now: string,
): Promise<ReferenceDeconstructionRun> {
  if (!run.full || run.activeReservation?.kind !== 'fullUnit') {
    throw reservationConflict();
  }
  const reservation = run.activeReservation;
  const diagnostic = normalizeStoreDiagnostic({
    id: `full-interrupted-${reservation.unitId}-${run.revision}`,
    code: 'full.interrupted',
    severity: 'warning',
    blocking: false,
    message: 'The full-deconstruction unit was interrupted and will not resume automatically.',
    evidenceRefs: [],
    stageId: requireStoredUnit(run.full, reservation.unitId).stageId,
    unitId: reservation.unitId,
    attemptId: reservation.attemptId,
  });
  const next: ReferenceDeconstructionRun = {
    ...run,
    status: 'interrupted',
    full: {
      ...run.full,
      units: run.full.units.map((unit) => unit.id === reservation.unitId
        ? { ...unit, status: 'interrupted' }
        : unit),
      attempts: run.full.attempts.map((attempt) => attempt.id === reservation.attemptId
        ? { ...attempt, status: 'interrupted', completedAt: now }
        : attempt),
    },
    diagnostics: appendLifecycleDiagnostic(run.diagnostics, diagnostic),
    mutationReceipts: updateReceiptStatus(
      run.mutationReceipts,
      reservation.idempotencyKey,
      run.revision,
      'interrupted',
    ),
    activeReservation: undefined,
    updatedAt: now,
  };
  await writeRunState(workspaceRoot, next);
  await writeRunDiagnostics(workspaceRoot, next);
  return next;
}

function updateReceiptStatus(
  receipts: readonly ReferenceDeconstructionMutationReceipt[],
  idempotencyKey: string,
  revision: number,
  status: ReferenceDeconstructionRunStatus,
): ReferenceDeconstructionMutationReceipt[] {
  let found = false;
  const updated = receipts.map((receipt) => {
    if (receipt.idempotencyKey !== idempotencyKey) return receipt;
    found = true;
    return {
      ...receipt,
      resultingRunRevision: revision,
      resultStatus: status,
    };
  });
  if (!found) {
    throw new ReferenceDeconstructionValidationError(
      'Reference preview reservation receipt is missing.',
    );
  }
  return updated;
}

function appendLifecycleDiagnostic(
  diagnostics: readonly ReferenceDeconstructionDiagnostic[],
  diagnostic: ReferenceDeconstructionDiagnostic,
): ReferenceDeconstructionDiagnostic[] {
  return diagnostics.length < MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS
    ? [...diagnostics, diagnostic]
    : [...diagnostics.slice(0, MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS - 1), diagnostic];
}

function mergeRunDiagnostics(
  current: readonly ReferenceDeconstructionDiagnostic[],
  additions: readonly ReferenceDeconstructionDiagnostic[],
): ReferenceDeconstructionDiagnostic[] {
  const byId = new Map(current.map((diagnostic) => [diagnostic.id, diagnostic]));
  for (const diagnostic of additions) byId.set(diagnostic.id, normalizeStoreDiagnostic(diagnostic));
  const values = [...byId.values()];
  if (values.length <= MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS) return values;
  return [
    ...values.slice(0, MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS - 1),
    normalizeStoreDiagnostic({
      id: 'quality-diagnostics-overflow',
      code: 'quality.diagnostics.overflow',
      severity: 'error',
      blocking: true,
      message: 'Reference analysis produced more diagnostics than can be reviewed safely.',
      evidenceRefs: [],
      stageId: 'qualityGate',
    }),
  ];
}

function requireStoredUnit(
  full: ReferenceFullDeconstructionState,
  unitId: string,
): ReferenceDeconstructionStoredUnit {
  const unit = full.units.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw new ReferenceDeconstructionValidationError(
      `Reference full work unit is missing: ${unitId}.`,
    );
  }
  return unit;
}

function requireAttempt(
  full: ReferenceFullDeconstructionState,
  attemptId: string,
): ReferenceDeconstructionAttemptSummary {
  const attempt = full.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) {
    throw new ReferenceDeconstructionValidationError(
      `Reference full attempt is missing: ${attemptId}.`,
    );
  }
  return attempt;
}

function requireSelectedAttempt(
  full: ReferenceFullDeconstructionState,
  unitId: string,
): ReferenceDeconstructionAttemptSummary {
  const unit = requireStoredUnit(full, unitId);
  if (!unit.selectedAttemptId) {
    throw new ReferenceDeconstructionValidationError(
      `Reference predecessor unit is not selected: ${unitId}.`,
    );
  }
  const attempt = requireAttempt(full, unit.selectedAttemptId);
  if (attempt.status !== 'completed' || !attempt.outputHash) {
    throw new ReferenceDeconstructionValidationError(
      `Reference predecessor attempt is incomplete: ${attempt.id}.`,
    );
  }
  return attempt;
}

function requireAttemptOutputHash(
  attempt: ReferenceDeconstructionAttemptSummary,
): string {
  if (!attempt.outputHash) {
    throw new ReferenceDeconstructionValidationError(
      `Reference attempt output hash is missing: ${attempt.id}.`,
    );
  }
  return assertSha256(attempt.outputHash, 'attempt outputHash');
}

function assertFullReservation(
  run: ReferenceDeconstructionRun,
  reservationId: string,
): ReferenceFullDeconstructionReservation {
  if (
    run.status !== 'fullRunning'
    || !run.full
    || run.activeReservation?.kind !== 'fullUnit'
    || run.activeReservation.id !== reservationId
  ) {
    throw reservationConflict();
  }
  return run.activeReservation;
}

function assertFullOutputMatchesUnit(
  output: ReferenceFullDeconstructionOutput,
  unit: ReferenceDeconstructionStoredUnit,
): void {
  if (!isRecord(output)) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full output must be an object.',
    );
  }
  if (unit.kind === 'analysisQuality') {
    const report = output as ReferenceDeconstructionAnalysisQualityReport;
    if (
      report.planId !== undefined
      && report.planId
      && report.status !== undefined
      && report.coverage !== undefined
    ) return;
    throw new ReferenceDeconstructionValidationError(
      'Reference analysis quality output is invalid.',
    );
  }
  const candidate = output as ReferenceDeconstructionAnalysisOutput;
  if (candidate.unitId !== unit.id) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full output does not match its reserved work unit.',
    );
  }
  const matchesKind = unit.kind === 'chapterChunk'
    ? 'unitSummary' in candidate
    : unit.kind === 'aggregate'
      ? 'findings' in candidate && !('unitSummary' in candidate) && !('dimensions' in candidate)
      : unit.kind === 'style'
        ? 'dimensions' in candidate
        : unit.kind === 'distill'
          ? 'entries' in candidate
        : false;
  if (!matchesKind) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full output kind does not match its reserved work unit.',
    );
  }
}

interface StoredOutputValidationContext {
  outputsByAttemptId: Map<string, ReferenceFullDeconstructionOutput>;
  validatingAttemptIds: Set<string>;
  source?: ReferencePreviewSource;
}

function createStoredOutputValidationContext(): StoredOutputValidationContext {
  return {
    outputsByAttemptId: new Map(),
    validatingAttemptIds: new Set(),
  };
}

async function parseStoredFullOutput(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  unit: ReferenceDeconstructionStoredUnit,
  value: unknown,
  context: StoredOutputValidationContext,
): Promise<ReferenceFullDeconstructionOutput> {
  assertFullOutputMatchesUnit(value as ReferenceFullDeconstructionOutput, unit);
  if (unit.kind === 'chapterChunk') {
    if (!unit.pointerId || !unit.pointer) {
      throw new ReferenceDeconstructionValidationError(
        'Reference chapter work unit pointer is missing.',
      );
    }
    let output: ReferenceChapterAnalysisResult;
    try {
      output = parseReferenceChapterAnalysisResult(value, {
        runId: run.runId,
        unit,
        allowedPointers: { [unit.pointerId]: unit.pointer },
      });
    } catch (error) {
      throw validationFrom(error, 'Stored reference chapter analysis is invalid.');
    }
    const source = await readValidationSource(workspaceRoot, run, context);
    const sourceWindow = resolveReferenceChapterWorkUnitWindow(source.sourceText, unit);
    assertNoCopyRisk([output], [sourceWindow], [unit]);
    return output;
  }
  if (
    unit.kind === 'aggregate'
    || unit.kind === 'style'
    || unit.kind === 'distill'
  ) {
    const predecessorOutputs: ReferenceFullDeconstructionOutput[] = [];
    for (const predecessorUnitId of unit.predecessorUnitIds) {
      predecessorOutputs.push(await readReferenceAttemptOutputFromRun(
        workspaceRoot,
        run,
        requireSelectedAttempt(run.full!, predecessorUnitId),
        context,
      ));
    }
    const aggregateOutput = predecessorOutputs.find(
      (output): output is ReferenceAggregateAnalysisResult =>
        'findings' in output && !('unitSummary' in output),
    );
    const styleOutput = predecessorOutputs.find(
      (output): output is ReferenceStyleProfileResult => 'dimensions' in output,
    );
    const verifiedSourceFindings = unit.kind === 'distill'
      && aggregateOutput
      && styleOutput
      ? collectReferenceDistillationFindings(aggregateOutput.findings, styleOutput)
      : selectBoundedVerifiedFindings(
          predecessorOutputs.map((output) =>
            'dimensions' in output || 'entries' in output
              ? []
              : collectReferenceAnalysisFindings(output)),
        );
    const verifiedFindings = Object.fromEntries(
      verifiedSourceFindings.map((finding) => [finding.id, finding]),
    );
    const coveredUnitIds = uniqueStrings(predecessorOutputs.flatMap((output) =>
      output.coveredUnitIds));
    const coveredChapterIds = uniqueStrings(predecessorOutputs.flatMap((output) =>
      output.coveredChapterIds));
    try {
      if (unit.kind === 'aggregate') {
        const output = parseReferenceAggregateAnalysisResult(value, {
          runId: run.runId,
          unit,
          verifiedFindings,
          coveredUnitIds,
          coveredChapterIds,
        });
        const source = await readValidationSource(workspaceRoot, run, context);
        const coveredUnitSet = new Set(output.coveredUnitIds);
        const sourceUnits = run.full!.units.filter((candidate) =>
          candidate.kind === 'chapterChunk' && coveredUnitSet.has(candidate.id));
        const sourceWindows = sourceUnits.map((candidate) =>
          resolveReferenceChapterWorkUnitWindow(source.sourceText, candidate));
        assertNoCopyRisk([output], sourceWindows, [unit]);
        return output;
      }
      if (unit.kind === 'distill') {
        if (!aggregateOutput || !styleOutput) {
          throw new ReferenceDeconstructionValidationError(
            'Reference distillation predecessors are invalid.',
          );
        }
        const output = parseReferenceDistillationResult(value, {
          runId: run.runId,
          unit,
          verifiedFindings,
          coveredUnitIds: aggregateOutput.coveredUnitIds,
          coveredChapterIds: aggregateOutput.coveredChapterIds,
        });
        const source = await readValidationSource(workspaceRoot, run, context);
        const sourceWindows = run.full!.units
          .filter((candidate) => candidate.kind === 'chapterChunk')
          .map((candidate) =>
            resolveReferenceChapterWorkUnitWindow(source.sourceText, candidate));
        assertNoCopyRisk([output], sourceWindows, [unit]);
        return output;
      }
      return parseReferenceStyleProfileResult(value, {
        runId: run.runId,
        unit,
        verifiedFindings,
        coveredUnitIds,
        coveredChapterIds,
      });
    } catch (error) {
      throw validationFrom(error, `Stored reference ${unit.kind} analysis is invalid.`);
    }
  }
  let report: ReferenceDeconstructionAnalysisQualityReport;
  try {
    report = parseReferenceDeconstructionAnalysisQualityReport(value);
  } catch (error) {
    throw validationFrom(error, 'Stored reference analysis quality report is invalid.');
  }
  assertQualityReportMatchesRun(report, run);
  return report;
}

async function readValidationSource(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  context: StoredOutputValidationContext,
): Promise<ReferencePreviewSource> {
  if (!context.source) {
    context.source = await readReferencePreviewSource(workspaceRoot, run.referenceId);
  }
  if (
    context.source.sourceManifest.checksumSha256 !== run.sourceChecksumSha256
    || context.source.sourceManifest.structureFingerprint !== run.structureFingerprint
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference source identity changed while validating attempt output.',
    );
  }
  return context.source;
}

function assertNoCopyRisk(
  outputs: readonly ReferenceDeconstructionAnalysisOutput[],
  sourceWindows: readonly ReferenceChapterWorkUnitWindow[],
  units: readonly ReferenceDeconstructionWorkUnit[],
): void {
  const diagnostic = evaluateReferenceAnalysisCopyRisk({
    outputs,
    sourceWindows,
    units,
  }).find((candidate) => candidate.blocking);
  if (diagnostic) {
    throw new ReferenceDeconstructionValidationError(diagnostic.message);
  }
}

function assertQualityReportMatchesRun(
  report: ReferenceDeconstructionAnalysisQualityReport,
  run: ReferenceDeconstructionRun,
): void {
  if (!run.full) {
    throw new ReferenceDeconstructionValidationError('Reference full state is missing.');
  }
  const requiredUnits = run.full.units.filter((unit) => unit.kind !== 'analysisQuality');
  const selectedAttempts = requiredUnits.map((unit) =>
    requireSelectedAttempt(run.full!, unit.id));
  if (
    report.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || report.runId !== run.runId
    || report.planId !== run.full.plan.id
    || report.referenceId !== run.referenceId
    || report.sourceChecksumSha256 !== run.sourceChecksumSha256
    || report.coverage.plannedUnitCount !== requiredUnits.length
    || report.coverage.checkedUnitCount !== report.checkedUnitIds.length
    || stableJson(report.checkedUnitIds) !== stableJson(requiredUnits.map((unit) => unit.id))
    || stableJson(report.selectedAttemptIds)
      !== stableJson(selectedAttempts.map((attempt) => attempt.id))
    || stableJson(report.outputHashes)
      !== stableJson(selectedAttempts.map(requireAttemptOutputHash))
    || report.status === 'passed'
      && (
        report.coverage.percent !== 100
        || report.diagnostics.some((diagnostic) => diagnostic.blocking)
      )
    || report.status === 'failed'
      && !report.diagnostics.some((diagnostic) => diagnostic.blocking)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference analysis quality report does not match selected attempt closure.',
    );
  }
  report.diagnostics.forEach((diagnostic) => normalizeStoreDiagnostic(diagnostic));
  assertIsoDate(report.evaluatedAt, 'quality evaluatedAt');
}

function collectDependentUnitIds(
  full: ReferenceFullDeconstructionState,
  rootUnitId: string,
): Set<string> {
  const selected = new Set([rootUnitId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of full.units) {
      if (!selected.has(unit.id) && unit.predecessorUnitIds.some((id) => selected.has(id))) {
        selected.add(unit.id);
        changed = true;
      }
    }
  }
  return selected;
}

async function readRollingContextFromAttempt(
  workspaceRoot: string,
  runId: string,
  attempt: ReferenceDeconstructionAttemptSummary,
): Promise<ReferenceRollingContext | undefined> {
  const output = await readReferenceAttemptOutput(workspaceRoot, runId, attempt);
  return 'rollingContext' in output ? output.rollingContext : undefined;
}

async function prepareReferenceFullExecution(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  unit: ReferenceDeconstructionStoredUnit,
): Promise<ReferenceFullDeconstructionExecution> {
  const full = run.full!;
  if (unit.kind === 'chapterChunk') {
    const source = await readReferencePreviewSource(workspaceRoot, run.referenceId);
    const sourceWindow = resolveReferenceChapterWorkUnitWindow(source.sourceText, unit);
    const predecessor = unit.predecessorUnitIds.at(-1);
    const rollingContext = predecessor
      ? await readRollingContextFromAttempt(
          workspaceRoot,
          run.runId,
          requireSelectedAttempt(full, predecessor),
        )
      : undefined;
    return {
      unit,
      sourceWindows: [sourceWindow],
      ...(rollingContext ? { rollingContext } : {}),
    };
  }
  if (
    unit.kind === 'aggregate'
    || unit.kind === 'style'
    || unit.kind === 'distill'
  ) {
    const outputs = await Promise.all(unit.predecessorUnitIds.map((predecessorId) =>
      readReferenceAttemptOutput(
        workspaceRoot,
        run.runId,
        requireSelectedAttempt(full, predecessorId),
      )));
    const aggregateOutput = outputs.find(
      (output): output is ReferenceAggregateAnalysisResult =>
        'findings' in output && !('unitSummary' in output),
    );
    const styleOutput = outputs.find(
      (output): output is ReferenceStyleProfileResult => 'dimensions' in output,
    );
    const verifiedSourceFindings = unit.kind === 'distill'
      && aggregateOutput
      && styleOutput
      ? collectReferenceDistillationFindings(aggregateOutput.findings, styleOutput)
      : selectBoundedVerifiedFindings(outputs.map((output) =>
          'dimensions' in output || 'entries' in output
            ? []
            : collectReferenceAnalysisFindings(output)));
    const coveredUnitIds = uniqueStrings(outputs.flatMap((output) =>
      'coveredUnitIds' in output ? output.coveredUnitIds : []));
    const coveredChapterIds = uniqueStrings(outputs.flatMap((output) =>
      'coveredChapterIds' in output ? output.coveredChapterIds : []));
    return {
      unit,
      verifiedSourceFindings,
      coveredUnitIds,
      coveredChapterIds,
    };
  }
  return { unit };
}

function selectBoundedVerifiedFindings(
  groups: readonly (readonly ReferenceDeconstructionFinding[])[],
): ReferenceDeconstructionFinding[] {
  const maximumFindings = 160;
  const maximumCharacters = 72_000;
  const selected: ReferenceDeconstructionFinding[] = [];
  let characters = 0;
  const append = (finding: ReferenceDeconstructionFinding | undefined): boolean => {
    if (!finding || selected.some((candidate) => candidate.id === finding.id)) return true;
    const size = stableJson(finding).length;
    if (selected.length >= maximumFindings || characters + size > maximumCharacters) {
      return false;
    }
    selected.push(finding);
    characters += size;
    return true;
  };
  for (const group of groups) {
    if (!append(group[0])) {
      throw new ReferenceDeconstructionValidationError(
        'Reference reduction input cannot include one verified finding per predecessor.',
      );
    }
  }
  const maximumGroupLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 1; index < maximumGroupLength; index += 1) {
    for (const group of groups) {
      if (!append(group[index])) return selected;
    }
  }
  return selected;
}

export async function evaluateReservedReferenceFullDeconstructionQuality(
  workspaceRoot: string,
  referenceId: string,
  runId: string,
  reservationId: string,
  evaluatedAt?: string,
): Promise<ReferenceDeconstructionAnalysisQualityReport> {
  const run = await readReferenceDeconstructionRun(workspaceRoot, referenceId, runId);
  const reservation = assertFullReservation(run, reservationId);
  const qualityUnit = requireStoredUnit(run.full!, reservation.unitId);
  if (qualityUnit.kind !== 'analysisQuality') {
    throw new ReferenceDeconstructionValidationError(
      'Reserved work unit is not the analysis quality gate.',
    );
  }
  const requiredUnits = run.full!.units.filter((unit) => unit.kind !== 'analysisQuality');
  const selectedAttempts = await Promise.all(requiredUnits.map(async (unit) => {
    const attempt = requireSelectedAttempt(run.full!, unit.id);
    return {
      unitId: unit.id,
      attemptId: attempt.id,
      status: attempt.status,
      inputFingerprint: attempt.inputFingerprint,
      expectedInputFingerprint: await recomputeAttemptInputFingerprint(
        workspaceRoot,
        run,
        unit,
      ),
      predecessorOutputHashes: [...attempt.predecessorOutputHashes],
      outputHash: requireAttemptOutputHash(attempt),
    } satisfies ReferenceDeconstructionQualitySelectedAttempt;
  }));
  const outputs = await Promise.all(requiredUnits.map((unit) =>
    readReferenceAttemptOutput(
      workspaceRoot,
      run.runId,
      requireSelectedAttempt(run.full!, unit.id),
    )));
  const source = await readReferencePreviewSource(workspaceRoot, referenceId);
  const sourceWindows = requiredUnits
    .filter((unit) => unit.kind === 'chapterChunk')
    .map((unit) => resolveReferenceChapterWorkUnitWindow(source.sourceText, unit));
  return evaluateReferenceDeconstructionAnalysisQuality({
    runId,
    plan: run.full!.plan,
    selectedAttempts,
    outputs,
    sourceWindows,
    evaluatedAt,
  });
}

export async function prepareReferenceDeconstructionPublicationCandidate(
  input: {
    workspaceRoot: string;
    referenceId: string;
    runId: string;
    now?: string;
  },
): Promise<ReferenceDeconstructionPublicationCandidate> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    if (!['reviewReady', 'publishing', 'completed'].includes(run.status)) {
      throw invalidTransition(run.status, 'publishing');
    }
    const existing = await readPublicationCandidate(input.workspaceRoot, run.runId);
    if (existing) {
      if (run.status !== 'reviewReady' || existing.runRevision === run.revision) {
        assertPublicationCandidateMatchesRun(existing, run);
        return existing;
      }
    }
    if (run.status !== 'reviewReady') {
      throw new ReferenceDeconstructionValidationError(
        'Reference publication candidate is missing for an active publication.',
      );
    }
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) {
      throw new ReferenceDeconstructionValidationError(drift);
    }
    assertReviewReadyForPublication(run);
    const candidate = await buildPublicationCandidate(
      input.workspaceRoot,
      run,
      normalizeNow(input.now),
    );
    await writePublicationCandidate(input.workspaceRoot, candidate);
    return candidate;
  });
}

export async function beginReferenceDeconstructionPublish(
  input: BeginReferenceDeconstructionPublishInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const candidateFingerprint = assertSha256(
      input.candidateFingerprint,
      'candidateFingerprint',
    );
    const pendingActionId = assertSafeIdentifier(input.pendingActionId, 'pendingActionId');
    const requestFingerprint = fingerprintMutation({
      command: 'begin-publish',
      referenceId: run.referenceId,
      runId: run.runId,
      baseRunRevision: input.baseRunRevision,
      candidateFingerprint,
      pendingActionId,
    });
    const previousReceipt = run.mutationReceipts.find((receipt) =>
      receipt.idempotencyKey === idempotencyKey);
    if (previousReceipt) {
      if (previousReceipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      return { run, receipt: previousReceipt, replayed: true };
    }
    assertRevision(run, input.baseRunRevision);
    if (run.status !== 'reviewReady' || run.publication) {
      throw invalidTransition(run.status, 'publishing');
    }
    const candidate = await requirePublicationCandidate(
      input.workspaceRoot,
      run,
      candidateFingerprint,
    );
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) {
      return persistNewStaleMutation(input, run, requestFingerprint, drift);
    }
    assertReceiptCapacity(run);
    const revision = run.revision + 1;
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: revision,
      resultStatus: 'publishing',
    };
    const next: ReferenceDeconstructionRun = {
      ...run,
      revision,
      status: 'publishing',
      publication: {
        candidateFingerprint,
        pendingActionId,
        files: candidate.files.map(({ content: _content, ...file }) => file),
        entryInventory: candidate.entryInventory.map((entry) => ({ ...entry })),
        preparedAt: candidate.preparedAt,
      },
      mutationReceipts: [...run.mutationReceipts, receipt],
      updatedAt: normalizeNow(input.now),
    };
    await writeRunState(input.workspaceRoot, next);
    return { run: next, receipt, replayed: false };
  });
}

export async function assertReferenceDeconstructionPublishCurrent(
  input: AssertReferenceDeconstructionPublishCurrentInput,
): Promise<ReferenceDeconstructionRun> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunState(input.workspaceRoot, input.referenceId, input.runId);
    if (
      run.status !== 'publishing'
      || !run.publication
      || run.publication.pendingActionId !== input.pendingActionId
      || run.publication.candidateFingerprint !== input.candidateFingerprint
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference publication is not the current pending action.',
      );
    }
    const drift = await detectRunSourceDrift(input.workspaceRoot, run);
    if (drift) throw new ReferenceDeconstructionValidationError(drift);
    await requirePublicationCandidate(
      input.workspaceRoot,
      run,
      input.candidateFingerprint,
    );
    return run;
  });
}

export async function completeReferenceDeconstructionPublish(
  input: CompleteReferenceDeconstructionPublishInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunStateArtifact(
      input.workspaceRoot,
      input.referenceId,
      input.runId,
    );
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const candidateFingerprint = assertSha256(
      input.candidateFingerprint,
      'candidateFingerprint',
    );
    const pendingActionId = assertSafeIdentifier(input.pendingActionId, 'pendingActionId');
    const requestFingerprint = fingerprintMutation({
      command: 'complete-publish',
      referenceId: run.referenceId,
      runId: run.runId,
      baseRunRevision: input.baseRunRevision,
      candidateFingerprint,
      pendingActionId,
    });
    const previousReceipt = run.mutationReceipts.find((receipt) =>
      receipt.idempotencyKey === idempotencyKey);
    if (previousReceipt) {
      if (previousReceipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      return { run, receipt: previousReceipt, replayed: true };
    }
    assertRevision(run, input.baseRunRevision);
    if (
      run.status !== 'publishing'
      || !run.publication
      || run.publication.pendingActionId !== pendingActionId
      || run.publication.candidateFingerprint !== candidateFingerprint
    ) {
      throw invalidTransition(run.status, 'completed');
    }
    await assertPublicationStateMaterialized(input.workspaceRoot, run);
    const readiness = await inspectPublishedReferenceWorkReadiness(
      input.workspaceRoot,
      run.referenceId,
    );
    if (
      readiness.status !== 'completed'
      || readiness.deconstructionManifest?.status !== 'completed'
      || readiness.deconstructionManifest.qualityStatus !== 'passed'
      || readiness.deconstructionManifest.publishedRunId !== run.runId
      || readiness.publishedContext?.runId !== run.runId
      || (!readiness.contextEligible && readiness.reason !== 'disabled')
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Accepted reference publication is not current or valid.',
      );
    }
    assertReceiptCapacity(run);
    const revision = run.revision + 1;
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: revision,
      resultStatus: 'completed',
    };
    const next: ReferenceDeconstructionRun = {
      ...run,
      revision,
      status: 'completed',
      mutationReceipts: [...run.mutationReceipts, receipt],
      updatedAt: normalizeNow(input.now),
    };
    await writeRunState(input.workspaceRoot, next);
    return { run: next, receipt, replayed: false };
  });
}

export async function rejectReferenceDeconstructionPublish(
  input: RejectReferenceDeconstructionPublishInput,
): Promise<ReferenceDeconstructionMutationResult> {
  return withReferenceLock(input.workspaceRoot, input.referenceId, async () => {
    const run = await readRunStateArtifact(
      input.workspaceRoot,
      input.referenceId,
      input.runId,
    );
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const pendingActionId = assertSafeIdentifier(input.pendingActionId, 'pendingActionId');
    const requestFingerprint = fingerprintMutation({
      command: 'reject-publish',
      referenceId: run.referenceId,
      runId: run.runId,
      baseRunRevision: input.baseRunRevision,
      pendingActionId,
    });
    const previousReceipt = run.mutationReceipts.find((receipt) =>
      receipt.idempotencyKey === idempotencyKey);
    if (previousReceipt) {
      if (previousReceipt.requestFingerprint !== requestFingerprint) {
        throw idempotencyConflict(idempotencyKey);
      }
      return { run, receipt: previousReceipt, replayed: true };
    }
    assertRevision(run, input.baseRunRevision);
    if (
      run.status !== 'publishing'
      || run.publication?.pendingActionId !== pendingActionId
    ) {
      throw invalidTransition(run.status, 'reviewReady');
    }
    assertReceiptCapacity(run);
    const revision = run.revision + 1;
    const receipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey,
      requestFingerprint,
      resultingRunRevision: revision,
      resultStatus: 'reviewReady',
    };
    const next: ReferenceDeconstructionRun = {
      ...run,
      revision,
      status: 'reviewReady',
      publication: undefined,
      mutationReceipts: [...run.mutationReceipts, receipt],
      updatedAt: normalizeNow(input.now),
    };
    await writeRunState(input.workspaceRoot, next);
    return { run: next, receipt, replayed: false };
  });
}

export async function reconcileReferenceDeconstructionPublish(
  input: ReconcileReferenceDeconstructionPublishInput,
): Promise<ReferenceDeconstructionRun> {
  const run = input.pendingActionStatus === 'accepted'
    ? await readRunStateArtifact(
        input.workspaceRoot,
        input.referenceId,
        input.runId,
      )
    : await readReferenceDeconstructionRun(
        input.workspaceRoot,
        input.referenceId,
        input.runId,
      );
  if (run.status === 'completed' || run.status === 'reviewReady') return run;
  if (run.status !== 'publishing' || !run.publication) {
    throw invalidTransition(run.status, 'publishing');
  }
  if (input.pendingActionStatus === 'pending') {
    return assertReferenceDeconstructionPublishCurrent({
      workspaceRoot: input.workspaceRoot,
      referenceId: input.referenceId,
      runId: input.runId,
      candidateFingerprint: run.publication.candidateFingerprint,
      pendingActionId: run.publication.pendingActionId,
    });
  }
  const mutation = input.pendingActionStatus === 'accepted'
    ? await completeReferenceDeconstructionPublish({
        workspaceRoot: input.workspaceRoot,
        referenceId: input.referenceId,
        runId: input.runId,
        baseRunRevision: run.revision,
        idempotencyKey: `publish-reconcile-accepted-${run.publication.pendingActionId}`,
        candidateFingerprint: run.publication.candidateFingerprint,
        pendingActionId: run.publication.pendingActionId,
        now: input.now,
      })
    : await rejectReferenceDeconstructionPublish({
        workspaceRoot: input.workspaceRoot,
        referenceId: input.referenceId,
        runId: input.runId,
        baseRunRevision: run.revision,
        idempotencyKey: `publish-reconcile-rejected-${run.publication.pendingActionId}`,
        pendingActionId: run.publication.pendingActionId,
        now: input.now,
      });
  return mutation.run;
}

async function buildPublicationCandidate(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  preparedAt: string,
): Promise<ReferenceDeconstructionPublicationCandidate> {
  assertReviewReadyForPublication(run);
  const full = run.full!;
  const selectedOutputs = new Map<string, ReferenceFullDeconstructionOutput>();
  for (const unit of full.units) {
    const attempt = requireSelectedAttempt(full, unit.id);
    selectedOutputs.set(
      unit.id,
      await readReferenceAttemptOutputFromRun(
        workspaceRoot,
        run,
        attempt,
        createStoredOutputValidationContext(),
      ),
    );
  }
  const aggregate = selectedOutputs.get(full.plan.aggregateRootUnitId);
  const style = selectedOutputs.get(full.plan.styleUnitId);
  const distillation = selectedOutputs.get(full.plan.distillUnitId);
  const quality = selectedOutputs.get(full.plan.analysisQualityUnitId);
  if (
    !aggregate
    || !('findings' in aggregate)
    || 'unitSummary' in aggregate
    || !style
    || !('dimensions' in style)
    || !distillation
    || !('entries' in distillation)
    || !quality
    || !('planId' in quality)
    || quality.status !== 'passed'
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication terminal outputs are invalid.',
    );
  }
  const contextIndex = createReferenceContextIndex({
    referenceId: run.referenceId,
    publishedRunId: run.runId,
    sourceChecksumSha256: run.sourceChecksumSha256,
    structureFingerprint: run.structureFingerprint,
    distillation,
  });
  const bundlePrefix = `examples/references/${run.referenceId}`;
  const outputFiles: Array<{
    path: string;
    content: string;
    kind: ReferenceDeconstructionPublicationCandidateFile['kind'];
    outputKind: 'deconstruction' | 'distilled' | 'context';
  }> = [];
  const pushOutput = (
    relativePath: string,
    content: string,
    kind: ReferenceDeconstructionPublicationCandidateFile['kind'],
    outputKind: 'deconstruction' | 'distilled' | 'context',
  ) => {
    outputFiles.push({
      path: `${bundlePrefix}/${relativePath}`,
      content,
      kind,
      outputKind,
    });
  };

  pushOutput(
    'deconstruction/quick-preview.md',
    formatReferenceQuickPreviewMarkdown(run.preview!),
    'deconstruction',
    'deconstruction',
  );
  for (const chapterId of full.plan.chapterIds) {
    const chapterOutputs = full.units
      .filter((unit) => unit.kind === 'chapterChunk' && unit.chapterId === chapterId)
      .map((unit) => selectedOutputs.get(unit.id))
      .filter((output): output is ReferenceChapterAnalysisResult =>
        Boolean(output && 'unitSummary' in output));
    pushOutput(
      `deconstruction/chapters/${chapterId}-summary.md`,
      formatPublishedChapterAnalysis(chapterId, chapterOutputs),
      'deconstruction',
      'deconstruction',
    );
  }
  const aggregateFiles: Array<{
    path: string;
    title: string;
    kinds: ReferenceDeconstructionFinding['kind'][];
  }> = [
    { path: 'plotlines.md', title: 'Plotlines', kinds: ['plotline', 'pacing', 'hook'] },
    { path: 'characters.md', title: 'Character Techniques', kinds: ['characterTechnique'] },
    {
      path: 'relationships.md',
      title: 'Relationship Techniques',
      kinds: ['relationshipTechnique'],
    },
    {
      path: 'worldbuilding.md',
      title: 'Worldbuilding Techniques',
      kinds: ['worldbuildingTechnique'],
    },
    {
      path: 'timeline.md',
      title: 'Timeline Observations',
      kinds: ['timelineObservation'],
    },
    { path: 'tropes.md', title: 'Trope Observations', kinds: ['trope', 'sceneTechnique'] },
  ];
  aggregateFiles.forEach((file) => pushOutput(
    `deconstruction/${file.path}`,
    formatPublishedFindings(file.title, aggregate.findings.filter((finding) =>
      file.kinds.includes(finding.kind))),
    'deconstruction',
    'deconstruction',
  ));
  pushOutput(
    'deconstruction/style-profile.md',
    formatPublishedStyleProfile(style),
    'deconstruction',
    'deconstruction',
  );

  const categoryFiles: Array<{
    category: ReferenceDistilledCategory;
    path: string;
  }> = [
    { category: 'writingStyle', path: 'distilled/writing-style.md' },
    { category: 'pacing', path: 'distilled/pacing.md' },
    { category: 'hooks', path: 'distilled/hooks.md' },
    { category: 'scene', path: 'distilled/scene-techniques.md' },
    { category: 'character', path: 'distilled/character-techniques.md' },
  ];
  categoryFiles.forEach(({ category, path }) => pushOutput(
    path,
    formatReferenceDistilledCategoryMarkdown(category, distillation.entries),
    'distilled',
    'distilled',
  ));
  pushOutput(
    'distilled/do-not-copy.md',
    formatPublishedDoNotCopy(distillation),
    'distilled',
    'distilled',
  );
  const contextIndexContent = stringify(contextIndex);
  pushOutput(
    'context/index.yaml',
    contextIndexContent,
    'context',
    'context',
  );
  pushOutput(
    'context/reference-summary.md',
    formatPublishedReferenceSummary(run, distillation),
    'context',
    'context',
  );

  const outputs = outputFiles.map((file) => ({
    kind: file.outputKind,
    path: file.path.slice(bundlePrefix.length + 1),
    checksumSha256: sha256(ensureTrailingNewline(file.content)),
  }));
  const previous = (await readReferencePreviewSource(workspaceRoot, run.referenceId))
    .deconstructionManifest;
  const manifest = assertReferenceDeconstructionManifest({
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: run.referenceId,
    revision: previous.revision + 1,
    sourceChecksumSha256: run.sourceChecksumSha256,
    structureFingerprint: run.structureFingerprint,
    pipelineVersion: REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
    capabilityVersion: REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
    status: 'completed',
    qualityStatus: 'passed',
    publishedRunId: run.runId,
    publishedAt: preparedAt,
    stages: createPublishedManifestStages(run),
    outputs,
  });
  const diagnostics = assertReferenceDeconstructionDiagnostics({
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: run.referenceId,
    sourceChecksumSha256: run.sourceChecksumSha256,
    generatedAt: preparedAt,
    items: run.diagnostics,
  });
  const progress = createReferenceProgressProjection(manifest, preparedAt);
  const referencesIndex = await createPublishedReferencesIndex(
    workspaceRoot,
    run,
    progress,
    contextIndex,
    sha256(ensureTrailingNewline(contextIndexContent)),
  );
  const files = [
    ...outputFiles.map(({ outputKind: _outputKind, ...file }) => file),
    {
      path: `${bundlePrefix}/deconstruction-manifest.yaml`,
      content: stringify(manifest),
      kind: 'manifest' as const,
    },
    {
      path: `${bundlePrefix}/diagnostics.yaml`,
      content: stringify(diagnostics),
      kind: 'diagnostics' as const,
    },
    {
      path: `${bundlePrefix}/progress.yaml`,
      content: stringify(progress),
      kind: 'progress' as const,
    },
    {
      path: 'examples/references.yaml',
      content: stringify(referencesIndex),
      kind: 'index' as const,
    },
  ];
  return createReferenceDeconstructionPublicationCandidate({
    referenceId: run.referenceId,
    runId: run.runId,
    runRevision: run.revision,
    files,
    entries: distillation.entries,
    preparedAt,
  });
}

function createPublishedManifestStages(
  run: ReferenceDeconstructionRun,
): ReferenceDeconstructionManifest['stages'] {
  const full = run.full!;
  const stageAttempts = (stageId: ReferenceDeconstructionStageId) => full.units
    .filter((unit) => unit.stageId === stageId)
    .map((unit) => requireSelectedAttempt(full, unit.id));
  const stage = (
    stageId: ReferenceDeconstructionStageId,
  ): ReferenceDeconstructionManifest['stages'][ReferenceDeconstructionStageId] => {
    if (stageId === 'detectStructure') {
      return { status: 'completed', outputHashes: [run.structureFingerprint] };
    }
    if (stageId === 'quickPreview') {
      return {
        status: 'completed',
        outputHashes: [sha256(stableJson(run.preview))],
      };
    }
    const attempts = stageAttempts(stageId);
    return {
      status: 'completed',
      ...(attempts.at(-1)
        ? {
            selectedAttemptId: attempts.at(-1)!.id,
            inputFingerprint: attempts.at(-1)!.inputFingerprint,
          }
        : {}),
      ...(stageId === 'chapterAnalysis'
        ? { completedChapterIds: [...full.plan.chapterIds] }
        : {}),
      outputHashes: attempts.map(requireAttemptOutputHash),
    };
  };
  return Object.fromEntries(
    REFERENCE_DECONSTRUCTION_STAGE_IDS.map((stageId) => [stageId, stage(stageId)]),
  ) as ReferenceDeconstructionManifest['stages'];
}

async function createPublishedReferencesIndex(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  progress: import('./reference-deconstruction.js').ReferenceProgress,
  contextIndex: ReferenceContextIndex,
  contextFingerprint: string,
): Promise<unknown> {
  const indexPath = join(resolve(workspaceRoot), 'examples', 'references.yaml');
  let value: unknown;
  try {
    value = parse(await readFile(indexPath, 'utf-8')) as unknown;
  } catch (error) {
    throw validationFrom(error, 'Reference project index is missing.');
  }
  let projectIndex: ReturnType<typeof assertReferencesIndexValue>;
  try {
    projectIndex = assertReferencesIndexValue(value, { requireCanonical: true });
  } catch (error) {
    throw validationFrom(error, 'Reference project index is invalid.');
  }
  let matched = false;
  const references = projectIndex.references.map((entry) => {
    if (entry.id !== run.referenceId) return entry;
    matched = true;
    return {
      ...entry,
      summaryPath: `examples/references/${run.referenceId}/context/reference-summary.md`,
      distilledPaths: [
        'writing-style.md',
        'pacing.md',
        'hooks.md',
        'scene-techniques.md',
        'character-techniques.md',
        'do-not-copy.md',
      ].map((file) => `examples/references/${run.referenceId}/distilled/${file}`),
      deconstructionStatus: 'completed',
      contextEligible: entry.enabled !== false,
      readinessReason: entry.enabled === false ? 'disabled' : 'ready',
      progress: {
        ...progress,
        contextEligible: entry.enabled !== false,
      },
      publishedContext: {
        runId: run.runId,
        fingerprint: contextFingerprint,
        entryCount: contextIndex.entries.length,
        categoryCounts: Object.fromEntries(
          (['writingStyle', 'pacing', 'hooks', 'scene', 'character'] as const)
            .map((category) => [
              category,
              contextIndex.entries.filter((item) => item.category === category).length,
            ]),
        ),
      },
    };
  });
  if (!matched) {
    throw new ReferenceDeconstructionValidationError(
      'Reference project index does not contain the current reference.',
    );
  }
  return { version: 1, references };
}

function formatPublishedChapterAnalysis(
  chapterId: string,
  outputs: readonly ReferenceChapterAnalysisResult[],
): string {
  if (!outputs.length) {
    throw new ReferenceDeconstructionValidationError(
      `Reference chapter ${chapterId} has no selected outputs.`,
    );
  }
  const summary = outputs.at(-1)?.chapterSummary;
  const findings = outputs.flatMap((output) => output.findings);
  return [
    `# Chapter ${chapterId} Analysis`,
    '',
    '## Summary',
    '',
    summary?.observation ?? outputs.at(-1)!.unitSummary.observation,
    '',
    '## Transferable Findings',
    '',
    ...formatFindingList(findings),
    '',
  ].join('\n');
}

function formatPublishedFindings(
  title: string,
  findings: readonly ReferenceDeconstructionFinding[],
): string {
  return [
    `# ${title}`,
    '',
    ...(findings.length ? formatFindingList(findings) : ['- No verified finding in this category.']),
    '',
  ].join('\n');
}

function formatFindingList(
  findings: readonly ReferenceDeconstructionFinding[],
): string[] {
  return findings.flatMap((finding) => [
    `## ${finding.kind}: ${finding.id}`,
    '',
    finding.observation,
    '',
    `Technique: ${finding.technique}`,
    `Confidence: ${finding.confidence}`,
    ...(finding.whenUseful ? [`When useful: ${finding.whenUseful}`] : []),
    ...(finding.avoid ? [`Avoid: ${finding.avoid}`] : []),
    `Evidence refs: ${finding.evidenceRefs.join(', ') || 'general inference'}`,
    ...(finding.uncertainty ? [`Uncertainty: ${finding.uncertainty}`] : []),
    '',
  ]);
}

function formatPublishedStyleProfile(style: ReferenceStyleProfileResult): string {
  return [
    '# Style Profile',
    '',
    style.summary,
    '',
    ...style.dimensions.flatMap((dimension) => [
      `## ${dimension.dimension}`,
      '',
      dimension.observation,
      '',
      `Technique: ${dimension.technique}`,
      `Confidence: ${dimension.confidence}`,
      ...(dimension.avoid ? [`Avoid: ${dimension.avoid}`] : []),
      '',
    ]),
    '## Transferable Principles',
    '',
    ...style.transferablePrinciples.map((item) => `- ${item}`),
    '',
    '## Non-Imitation Boundaries',
    '',
    ...style.nonImitationBoundaries.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

function formatPublishedDoNotCopy(
  distillation: ReferenceDistillationResult,
): string {
  return [
    '# Do Not Copy',
    '',
    '## Protected Rules',
    '',
    ...distillation.doNotCopyRules.map((rule) => `- ${rule}`),
    '',
    '## Differentiation Warnings',
    '',
    ...distillation.differentiationWarnings.map((warning) => `- ${warning}`),
    '',
  ].join('\n');
}

function formatPublishedReferenceSummary(
  run: ReferenceDeconstructionRun,
  distillation: ReferenceDistillationResult,
): string {
  const maximumEntries = 12;
  return [
    '# Distilled Reference Summary',
    '',
    `Published run: ${run.runId}`,
    `Source checksum: ${run.sourceChecksumSha256}`,
    'Context eligible: yes after accepted publication',
    'Original source read by writing selector: no',
    '',
    '## Entry Inventory',
    '',
    ...distillation.entries.slice(0, maximumEntries).map((entry) =>
      `- ${entry.id} [${entry.category}]: ${entry.title}`),
    ...(distillation.entries.length > maximumEntries
      ? [`- ${distillation.entries.length - maximumEntries} additional entries are indexed.`]
      : []),
    '',
    '## Protected Boundary',
    '',
    ...distillation.doNotCopyRules.slice(0, 8).map((rule) => `- ${rule}`),
    '',
  ].join('\n');
}

function assertReviewReadyForPublication(run: ReferenceDeconstructionRun): void {
  if (
    run.status !== 'reviewReady'
    || !run.full
    || run.full.units.some((unit) => unit.status !== 'completed')
    || run.full.analysisQuality?.status !== 'passed'
    || run.full.analysisQuality.coveragePercent !== 100
    || run.diagnostics.some((diagnostic) => diagnostic.blocking)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run is not ready for publication.',
    );
  }
}

async function readPublicationCandidate(
  workspaceRoot: string,
  runId: string,
): Promise<ReferenceDeconstructionPublicationCandidate | undefined> {
  const path = await resolveReferenceDeconstructionRunArtifactPath(
    workspaceRoot,
    runId,
    'publication-candidate.yaml',
  );
  try {
    return assertReferenceDeconstructionPublicationCandidate(
      parse(await readFile(path, 'utf-8')) as unknown,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw validationFrom(error, 'Reference publication candidate is invalid.');
  }
}

async function requirePublicationCandidate(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  fingerprint: string,
): Promise<ReferenceDeconstructionPublicationCandidate> {
  const candidate = await readPublicationCandidate(workspaceRoot, run.runId);
  if (!candidate || candidate.candidateFingerprint !== fingerprint) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication candidate fingerprint is stale.',
    );
  }
  assertPublicationCandidateMatchesRun(candidate, run);
  await assertPublicationCandidateArtifacts(workspaceRoot, candidate);
  return candidate;
}

function assertPublicationCandidateMatchesRun(
  candidate: ReferenceDeconstructionPublicationCandidate,
  run: ReferenceDeconstructionRun,
): void {
  const expectedCandidateRevision = run.status === 'reviewReady'
    ? run.revision
    : run.status === 'publishing'
      ? run.revision - 1
      : run.status === 'completed'
        ? run.revision - 2
        : -1;
  if (
    candidate.referenceId !== run.referenceId
    || candidate.runId !== run.runId
    || candidate.runRevision !== expectedCandidateRevision
    || run.publication
      && run.publication.candidateFingerprint !== candidate.candidateFingerprint
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication candidate does not match its run.',
    );
  }
}

async function writePublicationCandidate(
  workspaceRoot: string,
  candidate: ReferenceDeconstructionPublicationCandidate,
): Promise<void> {
  for (const file of candidate.files) {
    const path = await resolvePublicationCandidateFile(
      workspaceRoot,
      candidate.runId,
      file.path,
      true,
    );
    await writeTextAtomic(path, file.content);
  }
  await writeRunYamlAtomic(
    workspaceRoot,
    candidate.runId,
    'publication-candidate.yaml',
    candidate,
  );
}

async function assertPublicationCandidateArtifacts(
  workspaceRoot: string,
  candidate: ReferenceDeconstructionPublicationCandidate,
): Promise<void> {
  for (const file of candidate.files) {
    const path = await resolvePublicationCandidateFile(
      workspaceRoot,
      candidate.runId,
      file.path,
      false,
    );
    const content = await readFile(path, 'utf-8');
    if (content !== file.content || sha256(content) !== file.checksumSha256) {
      throw new ReferenceDeconstructionValidationError(
        `Reference publication candidate artifact is stale: ${file.path}.`,
      );
    }
  }
}

async function assertPublicationStateMaterialized(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
): Promise<void> {
  if (run.status !== 'publishing' || !run.publication) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication state is not materialized.',
    );
  }
  const publication = run.publication;
  const expectedFingerprint = sha256(stableJson({
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: run.referenceId,
    runId: run.runId,
    runRevision: run.revision - 1,
    files: publication.files,
    entryInventory: publication.entryInventory,
  }));
  if (expectedFingerprint !== publication.candidateFingerprint) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication state fingerprint is stale.',
    );
  }
  const realWorkspaceRoot = await realpath(resolve(workspaceRoot));
  const materialized = new Map<string, string>();
  for (const file of publication.files) {
    const safePath = candidateTargetPath(
      file.path,
      run.referenceId,
    );
    if (file.kind !== publicationFileKindForPath(safePath, run.referenceId)) {
      throw new ReferenceDeconstructionValidationError(
        `Accepted reference publication kind is invalid: ${file.path}.`,
      );
    }
    const target = resolve(realWorkspaceRoot, safePath);
    const realTarget = await realpath(target).catch(() => undefined);
    if (!realTarget) {
      throw new ReferenceDeconstructionValidationError(
        `Accepted reference publication is missing ${file.path}.`,
      );
    }
    assertContained(
      realWorkspaceRoot,
      realTarget,
      'Accepted reference publication escaped the workspace.',
    );
    const content = await readFile(realTarget, 'utf-8');
    // The project index is a shared registry. A later reference import or
    // publication may legitimately add another entry after this PendingAction
    // was accepted but before this run reconciles to completed. Its current
    // reference projection is validated semantically below; every
    // reference-scoped target remains byte-for-byte bound to the accepted
    // candidate.
    if (
      safePath !== 'examples/references.yaml'
      && sha256(content) !== file.checksumSha256
    ) {
      throw new ReferenceDeconstructionValidationError(
        `Accepted reference publication is stale: ${file.path}.`,
      );
    }
    materialized.set(file.path, content);
  }

  const bundlePrefix = `examples/references/${run.referenceId}`;
  const manifestPath = `${bundlePrefix}/deconstruction-manifest.yaml`;
  const indexPath = 'examples/references.yaml';
  const manifestContent = materialized.get(manifestPath);
  const indexContent = materialized.get(indexPath);
  if (!manifestContent || !indexContent) {
    throw new ReferenceDeconstructionValidationError(
      'Accepted reference publication is missing its manifest or project index.',
    );
  }
  const manifest = assertReferenceDeconstructionManifest(
    parse(manifestContent) as unknown,
  );
  if (
    manifest.referenceId !== run.referenceId
    || manifest.status !== 'completed'
    || manifest.qualityStatus !== 'passed'
    || manifest.publishedRunId !== run.runId
    || manifest.sourceChecksumSha256 !== run.sourceChecksumSha256
    || manifest.structureFingerprint !== run.structureFingerprint
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Accepted reference publication manifest does not match its run.',
    );
  }
  const requiredControlFile = (
    path: string,
    kind: ReferenceDeconstructionPublicationCandidateFile['kind'],
  ) => {
    const file = publication.files.find((item) => item.path === path);
    if (!file || file.kind !== kind) {
      throw new ReferenceDeconstructionValidationError(
        `Accepted reference publication is missing ${path}.`,
      );
    }
    return { checksumSha256: file.checksumSha256, kind };
  };
  const expectedPaths = new Map<string, {
    checksumSha256: string;
    kind: ReferenceDeconstructionPublicationCandidateFile['kind'];
  }>([
    [indexPath, requiredControlFile(indexPath, 'index')],
    [manifestPath, requiredControlFile(manifestPath, 'manifest')],
    [`${bundlePrefix}/diagnostics.yaml`, requiredControlFile(
      `${bundlePrefix}/diagnostics.yaml`,
      'diagnostics',
    )],
    [`${bundlePrefix}/progress.yaml`, requiredControlFile(
      `${bundlePrefix}/progress.yaml`,
      'progress',
    )],
    ...manifest.outputs.map((output) => [
      `${bundlePrefix}/${output.path}`,
      {
        checksumSha256: output.checksumSha256,
        kind: output.kind,
      },
    ] as const),
  ]);
  if (
    expectedPaths.size !== publication.files.length
    || publication.files.some((file) => {
      const expected = expectedPaths.get(file.path);
      return !expected
        || expected.checksumSha256 !== file.checksumSha256
        || expected.kind !== file.kind;
    })
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Accepted reference publication file closure is invalid.',
    );
  }

  let referencesIndex: ReturnType<typeof assertReferencesIndexValue>;
  try {
    referencesIndex = assertReferencesIndexValue(
      parse(indexContent) as unknown,
      { requireCanonical: true },
    );
  } catch (error) {
    throw validationFrom(error, 'Accepted reference project index is invalid.');
  }
  const publishedReference = referencesIndex.references.find((reference) =>
    reference.id === run.referenceId);
  const contextIndexPath = `${bundlePrefix}/context/index.yaml`;
  const contextIndexContent = materialized.get(contextIndexPath);
  if (
    !publishedReference
    || publishedReference.deconstructionStatus !== 'completed'
    || publishedReference.publishedContext?.runId !== run.runId
    || !contextIndexContent
    || publishedReference.publishedContext.fingerprint
      !== sha256(contextIndexContent)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Accepted reference project index does not match the published context.',
    );
  }
  const contextIndex = assertReferenceContextIndex(
    parse(contextIndexContent) as unknown,
    {
      referenceId: run.referenceId,
      publishedRunId: run.runId,
      sourceChecksumSha256: run.sourceChecksumSha256,
      structureFingerprint: run.structureFingerprint,
    },
  );
  if (
    contextIndex.entries.length !== publication.entryInventory.length
    || contextIndex.entries.some((entry) => {
      const inventory = publication.entryInventory.find((item) =>
        item.id === entry.id);
      return !inventory
        || inventory.category !== entry.category
        || inventory.title !== entry.title
        || inventory.estimatedTokens !== entry.estimatedTokens;
    })
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Accepted reference publication inventory is stale.',
    );
  }
}

function publicationFileKindForPath(
  path: string,
  referenceId: string,
): ReferenceDeconstructionPublicationCandidateFile['kind'] {
  if (path === 'examples/references.yaml') return 'index';
  const relativePath = path.slice(`examples/references/${referenceId}/`.length);
  if (relativePath === 'deconstruction-manifest.yaml') return 'manifest';
  if (relativePath === 'diagnostics.yaml') return 'diagnostics';
  if (relativePath === 'progress.yaml') return 'progress';
  if (relativePath.startsWith('deconstruction/')) return 'deconstruction';
  if (relativePath.startsWith('distilled/')) return 'distilled';
  if (relativePath.startsWith('context/')) return 'context';
  throw new ReferenceDeconstructionValidationError(
    `Accepted reference publication path is invalid: ${path}.`,
  );
}

async function resolvePublicationCandidateFile(
  workspaceRoot: string,
  runId: string,
  targetPath: string,
  create: boolean,
): Promise<string> {
  const pathSegments = targetPath.split('/');
  const safeTarget = candidateTargetPath(
    targetPath,
    targetPath === 'examples/references.yaml'
      ? 'unused'
      : pathSegments[2],
  );
  const segments = safeTarget.split('/');
  const file = segments.pop()!;
  const directory = await ensureSafeDirectoryChain(workspaceRoot, [
    '.workspace',
    'sessions',
    assertSafeIdentifier(runId, 'runId'),
    'reference-deconstruction',
    'candidate',
    ...segments,
  ], create);
  if (!directory.exists) {
    throw new ReferenceDeconstructionNotFoundError(
      `Reference publication candidate path is missing: ${targetPath}.`,
    );
  }
  const path = join(directory.path, file);
  try {
    const information = await lstat(path);
    if (information.isSymbolicLink() || !information.isFile()) {
      throw new ReferenceDeconstructionValidationError(
        'Reference publication candidate artifact must be a regular file.',
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
  }
  return path;
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: 'utf-8', flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

async function recomputeAttemptInputFingerprint(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  unit: ReferenceDeconstructionStoredUnit,
): Promise<string> {
  const predecessorAttempts = unit.predecessorUnitIds.map((unitId) =>
    requireSelectedAttempt(run.full!, unitId));
  const rollingContext = unit.kind === 'chapterChunk' && predecessorAttempts.length
    ? await readRollingContextFromAttempt(
        workspaceRoot,
        run.runId,
        predecessorAttempts.at(-1)!,
      )
    : undefined;
  return createReferenceDeconstructionStageInputFingerprint({
    sourceChecksumSha256: run.sourceChecksumSha256,
    structureFingerprint: run.structureFingerprint,
    stageId: unit.stageId,
    unitId: unit.id,
    options: {
      kind: unit.kind,
      chapterId: unit.chapterId ?? null,
      chunkId: unit.chunkId ?? null,
    },
    predecessorOutputHashes: predecessorAttempts.map(requireAttemptOutputHash),
    ...(rollingContext ? { rollingContextHash: rollingContext.checksumSha256 } : {}),
  });
}

function assertReservation(
  run: ReferenceDeconstructionRun,
  reservationId: string,
): ReferenceQuickPreviewReservation {
  if (
    run.status !== 'previewRunning'
    || run.activeReservation?.kind !== 'preview'
    || run.activeReservation.id !== reservationId
  ) {
    throw reservationConflict();
  }
  return run.activeReservation;
}

async function assertPreviewMatchesRun(
  workspaceRoot: string,
  preview: ReferenceQuickPreview,
  run: ReferenceDeconstructionRun,
  allowLifecycleDiagnostics: boolean,
): Promise<void> {
  if (
    preview.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || preview.runId !== run.runId
    || preview.referenceId !== run.referenceId
    || preview.sourceChecksumSha256 !== run.sourceChecksumSha256
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference quick preview does not match its reserved run.',
    );
  }
  const request = await readRunRequestArtifact(
    workspaceRoot,
    run.referenceId,
    run.runId,
    false,
  );
  const normalized = normalizeReferenceQuickPreviewModelOutput({
    sourceOverview: preview.sourceOverview,
    chapterPreviews: preview.chapterPreviews.map(({ id: _id, ...chapter }) => chapter),
    findings: preview.findings.map(({ id: _id, ...finding }) => finding),
    borrowablePatterns: preview.borrowablePatterns.map(({ id: _id, ...pattern }) => pattern),
    doNotCopy: preview.doNotCopy,
    differentiationRequirements: preview.differentiationRequirements,
    differentiationPrompts: preview.differentiationPrompts,
    canonContaminationWarnings: preview.canonContaminationWarnings,
    confidence: preview.confidence,
    uncertainties: preview.uncertainties,
  }, {
    runId: run.runId,
    referenceId: run.referenceId,
    sourceChecksumSha256: run.sourceChecksumSha256,
    selectedChapterIds: request.selection.selectedChapterIds,
    allowedPointers: createReferenceEvidencePointerMap(request.selection),
    sourceWindows: request.selection.windows,
  });
  const { diagnostics: normalizedDiagnostics, ...normalizedContent } = normalized;
  const { diagnostics: previewDiagnostics, ...previewContent } = preview;
  const normalizedStoredDiagnostics = previewDiagnostics.map((diagnostic) =>
    normalizeStoreDiagnostic(diagnostic));
  const diagnosticsAreValid = allowLifecycleDiagnostics
    ? normalizedDiagnostics.every((diagnostic) =>
        normalizedStoredDiagnostics.some((candidate) =>
          stableJson(candidate) === stableJson(diagnostic)))
      && normalizedStoredDiagnostics.every((diagnostic) =>
        normalizedDiagnostics.some((candidate) =>
          stableJson(candidate) === stableJson(diagnostic))
        || diagnostic.code === 'source.stale')
    : stableJson(normalizedDiagnostics) === stableJson(normalizedStoredDiagnostics);
  if (
    stableJson(normalizedContent) !== stableJson(previewContent)
    || !diagnosticsAreValid
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference quick preview failed persisted-output validation.',
    );
  }
}

function summarizeSelection(
  selection: ReferenceQuickPreviewSelection,
): ReferenceQuickPreviewSelectionSummary {
  return {
    selectedChapterIds: [...selection.selectedChapterIds],
    omittedChapterIds: [...selection.omittedChapterIds],
    selectedWindowCount: selection.windows.length,
    selectedCharacterCount: selection.totalChars,
    maxChapters: selection.maxChapters,
    maxChars: selection.maxChars,
  };
}

function assertQuickPreviewSelection(
  value: unknown,
  expected: {
    referenceId: string;
    sourceChecksumSha256: string;
    structureFingerprint: string;
  },
): ReferenceQuickPreviewSelection {
  const record = requireRecord(value, 'Reference quick preview selection');
  assertOnlyKnownFields(record, [
    'referenceId',
    'sourceChecksumSha256',
    'structureFingerprint',
    'selectedChapterIds',
    'windows',
    'omittedChapterIds',
    'totalChars',
    'maxChapters',
    'maxChars',
  ]);
  const maxChapters = safeInteger(record.maxChapters, 'maxChapters', 1, 3);
  const maxChars = safeInteger(record.maxChars, 'maxChars', 1, 48_000);
  const selectedChapterIds = identifierArray(
    record.selectedChapterIds,
    'selectedChapterIds',
    1,
    maxChapters,
  );
  const omittedChapterIds = identifierArray(
    record.omittedChapterIds,
    'omittedChapterIds',
    0,
    100_000,
  );
  const windows = requireArray(
    record.windows,
    'selection windows',
    1,
    MAX_REFERENCE_QUICK_PREVIEW_WINDOWS,
  ).map((item, index): ReferenceQuickPreviewSelection['windows'][number] => {
    const window = requireRecord(item, `selection windows[${index}]`);
    assertOnlyKnownFields(window, ['pointerId', 'pointer', 'content', 'charLength']);
    if (typeof window.content !== 'string' || !window.content.length) {
      throw new ReferenceDeconstructionValidationError(
        'Reference quick preview source window is invalid.',
      );
    }
    return {
      pointerId: assertSafeIdentifier(window.pointerId, 'pointerId'),
      pointer: assertReferenceSourcePointer(window.pointer),
      content: window.content,
      charLength: safeInteger(window.charLength, 'window charLength', 1, maxChars),
    };
  });
  const selection: ReferenceQuickPreviewSelection = {
    referenceId: assertSafeIdentifier(record.referenceId, 'referenceId'),
    sourceChecksumSha256: assertSha256(
      record.sourceChecksumSha256,
      'sourceChecksumSha256',
    ),
    structureFingerprint: assertSha256(
      record.structureFingerprint,
      'structureFingerprint',
    ),
    selectedChapterIds,
    windows,
    omittedChapterIds,
    totalChars: safeInteger(record.totalChars, 'totalChars', 1, maxChars),
    maxChapters,
    maxChars,
  };
  if (
    selection.referenceId !== expected.referenceId
    || selection.sourceChecksumSha256 !== expected.sourceChecksumSha256
    || selection.structureFingerprint !== expected.structureFingerprint
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference quick preview selection identity is invalid.',
    );
  }
  if (
    selection.windows.length > MAX_REFERENCE_QUICK_PREVIEW_WINDOWS
    || new Set(selection.windows.map((window) => window.pointerId)).size
      !== selection.windows.length
    || selection.selectedChapterIds.some((chapterId) =>
      selection.omittedChapterIds.includes(chapterId))
    || selection.selectedChapterIds.some((chapterId) =>
      !selection.windows.some((window) => window.pointer.chapterId === chapterId))
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference quick preview selection exceeds its bounds.',
    );
  }
  const pointerMap = createReferenceEvidencePointerMap(selection);
  let totalChars = 0;
  for (const window of selection.windows) {
    if (
      typeof window.content !== 'string'
      || !window.content.length
      || window.charLength !== window.content.length
      || !pointerMap[window.pointerId]
      || window.pointer.referenceId !== selection.referenceId
      || window.pointer.sourceChecksumSha256 !== selection.sourceChecksumSha256
      || !selection.selectedChapterIds.includes(window.pointer.chapterId)
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference quick preview source window is invalid.',
      );
    }
    totalChars += window.charLength;
  }
  if (totalChars !== selection.totalChars) {
    throw new ReferenceDeconstructionValidationError(
      'Reference quick preview character total is invalid.',
    );
  }
  return selection;
}

async function listReferenceDeconstructionRunsUnlocked(
  workspaceRoot: string,
  referenceId?: string,
): Promise<ReferenceDeconstructionRun[]> {
  const sessionsDirectory = await ensureSafeDirectoryChain(
    resolve(workspaceRoot),
    ['.workspace', 'sessions'],
    false,
  );
  if (!sessionsDirectory.exists) return [];
  const sessionsRoot = sessionsDirectory.path;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const runs: ReferenceDeconstructionRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let run: ReferenceDeconstructionRun;
    try {
      const projected = await readRunStateArtifact(
        workspaceRoot,
        undefined,
        entry.name,
      );
      if (
        projected.status === 'publishing'
        || projected.status === 'completed'
      ) {
        run = projected;
      } else {
        run = await readRunState(workspaceRoot, undefined, entry.name);
      }
    } catch (error) {
      if (error instanceof ReferenceDeconstructionNotFoundError) continue;
      throw error;
    }
    if (!referenceId || run.referenceId === referenceId) runs.push(run);
  }
  return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function readRunState(
  workspaceRoot: string,
  referenceId: string | undefined,
  runId: string,
): Promise<ReferenceDeconstructionRun> {
  const run = await readRunStateArtifact(workspaceRoot, referenceId, runId);
  if (run.preview) {
    await assertPreviewMatchesRun(workspaceRoot, run.preview, run, true);
  }
  if (run.full) {
    const planPath = await resolveReferenceDeconstructionRunArtifactPath(
      workspaceRoot,
      run.runId,
      'work-plan.yaml',
      { requireExistingArtifact: true },
    );
    const planArtifact = await readYamlOrValidation(
      planPath,
      'Reference full work plan artifact is invalid.',
    );
    if (stableJson(planArtifact) !== stableJson(run.full.plan)) {
      throw new ReferenceDeconstructionValidationError(
        'Reference full work plan artifact does not match authoritative run state.',
      );
    }
    await assertSelectedFullAttemptArtifacts(workspaceRoot, run);
  }
  return run;
}

async function assertSelectedFullAttemptArtifacts(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
): Promise<void> {
  const validationContext = createStoredOutputValidationContext();
  for (const unit of run.full!.units) {
    if (!unit.selectedAttemptId) continue;
    const attempt = requireAttempt(run.full!, unit.selectedAttemptId);
    const [findingsPath, receiptPath] = await Promise.all([
      resolveReferenceDeconstructionAttemptArtifactPath(
        workspaceRoot,
        run.runId,
        unit.stageId,
        attempt.id,
        'findings.yaml',
        { requireExistingArtifact: true },
      ),
      resolveReferenceDeconstructionAttemptArtifactPath(
        workspaceRoot,
        run.runId,
        unit.stageId,
        attempt.id,
        'receipt.yaml',
        { requireExistingArtifact: true },
      ),
    ]);
    const [output, receiptValue] = await Promise.all([
      readYamlOrValidation(findingsPath, 'Reference selected attempt output is invalid.'),
      readYamlOrValidation(receiptPath, 'Reference selected attempt receipt is invalid.'),
    ]);
    const receipt = requireRecord(receiptValue, 'selected attempt receipt');
    assertOnlyKnownFields(receipt, [
      'version',
      'runId',
      'unitId',
      'attemptId',
      'status',
      'inputFingerprint',
      'outputHash',
      'completedAt',
    ]);
    if (
      receipt.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
      || receipt.runId !== run.runId
      || receipt.unitId !== unit.id
      || receipt.attemptId !== attempt.id
      || receipt.status !== 'completed'
      || receipt.inputFingerprint !== attempt.inputFingerprint
      || receipt.outputHash !== attempt.outputHash
      || receipt.completedAt !== attempt.completedAt
      || sha256(stableJson(output)) !== attempt.outputHash
    ) {
      throw new ReferenceDeconstructionValidationError(
        `Reference selected attempt artifact is stale: ${attempt.id}.`,
      );
    }
    const parsedOutput = await parseStoredFullOutput(
      workspaceRoot,
      run,
      unit,
      output,
      validationContext,
    );
    validationContext.outputsByAttemptId.set(attempt.id, parsedOutput);
  }
}

async function readRunStateArtifact(
  workspaceRoot: string,
  referenceId: string | undefined,
  runId: string,
): Promise<ReferenceDeconstructionRun> {
  const safeRunId = assertSafeIdentifier(runId, 'runId');
  const filePath = await resolveReferenceDeconstructionRunArtifactPath(
    workspaceRoot,
    safeRunId,
    'run-state.yaml',
  );
  const value = await readYamlOrNotFound(filePath, `Reference run not found: ${safeRunId}.`);
  return assertRunState(value, referenceId, safeRunId);
}

function assertRunState(
  value: unknown,
  expectedReferenceId: string | undefined,
  expectedRunId: string,
): ReferenceDeconstructionRun {
  const record = requireRecord(value, 'Reference run state');
  assertOnlyKnownFields(record, [
    'version',
    'runId',
    'referenceId',
    'revision',
    'status',
    'mode',
    'sourceChecksumSha256',
    'structureFingerprint',
    'selection',
    'evidence',
    'preview',
    'diagnostics',
    'mutationReceipts',
    'full',
    'publication',
    'activeReservation',
    'failure',
    'createdAt',
    'updatedAt',
    'fullApprovedAt',
    'cancelledAt',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new ReferenceDeconstructionValidationError(
      'Unsupported reference run version.',
    );
  }
  const runId = assertSafeIdentifier(record.runId, 'runId');
  const referenceId = assertSafeIdentifier(record.referenceId, 'referenceId');
  if (
    runId !== expectedRunId
    || (expectedReferenceId && referenceId !== expectedReferenceId)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run identity does not match its path.',
    );
  }
  const selection = assertSelectionSummary(record.selection);
  const evidence = requireArray(
    record.evidence,
    'run evidence',
    1,
    MAX_REFERENCE_QUICK_PREVIEW_WINDOWS,
  )
    .map((item) => assertStoredEvidence(item));
  const diagnostics = requireArray(
    record.diagnostics,
    'run diagnostics',
    0,
    MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  )
    .map((item) => normalizeStoreDiagnostic(item));
  const mutationReceipts = requireArray(
    record.mutationReceipts,
    'mutationReceipts',
    1,
    MAX_REFERENCE_DECONSTRUCTION_MUTATION_RECEIPTS,
  ).map((item) => assertMutationReceipt(item));
  const run: ReferenceDeconstructionRun = {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    referenceId,
    revision: safeInteger(record.revision, 'run revision', 0),
    status: requireEnum(record.status, RUN_STATUS_VALUES, 'run status'),
    mode: requireLiteral(record.mode, 'quickPreview', 'run mode'),
    sourceChecksumSha256: assertSha256(
      record.sourceChecksumSha256,
      'sourceChecksumSha256',
    ),
    structureFingerprint: assertSha256(
      record.structureFingerprint,
      'structureFingerprint',
    ),
    selection,
    evidence,
    ...(record.preview === undefined
      ? {}
      : { preview: assertStoredPreview(record.preview, runId, referenceId) }),
    diagnostics,
    mutationReceipts,
    ...(record.full === undefined
      ? {}
      : { full: assertStoredFullState(record.full, referenceId) }),
    ...(record.publication === undefined
      ? {}
      : { publication: assertStoredPublication(record.publication) }),
    ...(record.activeReservation === undefined
      ? {}
      : { activeReservation: assertStoredReservation(record.activeReservation) }),
    ...(record.failure === undefined
      ? {}
      : { failure: assertStoredFailure(record.failure) }),
    createdAt: assertIsoDate(record.createdAt, 'createdAt'),
    updatedAt: assertIsoDate(record.updatedAt, 'updatedAt'),
    ...(record.fullApprovedAt === undefined
      ? {}
      : { fullApprovedAt: assertIsoDate(record.fullApprovedAt, 'fullApprovedAt') }),
    ...(record.cancelledAt === undefined
      ? {}
      : { cancelledAt: assertIsoDate(record.cancelledAt, 'cancelledAt') }),
  };
  if (
    run.status === 'previewRunning'
      && run.activeReservation?.kind !== 'preview'
    || run.status !== 'previewRunning'
      && run.activeReservation?.kind === 'preview'
    || run.activeReservation?.kind === 'fullUnit'
      && run.status !== 'fullRunning'
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run reservation does not match status.',
    );
  }
  if (
    Boolean(run.full) !== Boolean(run.fullApprovedAt)
    || run.full
      && ['created', 'previewRunning', 'awaitingFullApproval'].includes(run.status)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run approval timestamp does not match status.',
    );
  }
  if (
    (run.status === 'awaitingFullApproval' || Boolean(run.full))
      && !run.preview
    || run.preview
      && !run.full
      && ['created', 'previewRunning', 'interrupted', 'failed'].includes(run.status)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run preview does not match status.',
    );
  }
  if (
    run.status === 'failed' && !run.failure
    || run.status !== 'failed' && run.failure
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run failure details do not match status.',
    );
  }
  if (run.full) assertFullStateMatchesRun(run);
  if (
    (run.status === 'publishing' || run.status === 'completed')
      !== Boolean(run.publication)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication state does not match run status.',
    );
  }
  if (
    run.status === 'cancelled' && !run.cancelledAt
    || run.status !== 'cancelled' && run.cancelledAt
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run cancellation timestamp does not match status.',
    );
  }
  if (
    run.preview
    && !run.preview.diagnostics.every((diagnostic) =>
      run.diagnostics.some((candidate) => stableJson(candidate) === stableJson(diagnostic)))
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run diagnostics do not match preview diagnostics.',
    );
  }
  if (
    new Set(run.evidence.map((item) => item.id)).size !== run.evidence.length
    || run.evidence.some((item) =>
      item.pointer.referenceId !== run.referenceId
      || item.pointer.sourceChecksumSha256 !== run.sourceChecksumSha256
      || !run.selection.selectedChapterIds.includes(item.pointer.chapterId))
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run evidence does not match its selection.',
    );
  }
  if (
    new Set(run.mutationReceipts.map((receipt) => receipt.idempotencyKey)).size
      !== run.mutationReceipts.length
    || run.revision !== run.mutationReceipts.length - 1
    || run.mutationReceipts.some((receipt, index) =>
      receipt.resultingRunRevision !== index)
    || run.mutationReceipts.at(-1)?.resultStatus !== run.status
    || run.activeReservation
      && run.activeReservation.idempotencyKey
        !== run.mutationReceipts.at(-1)?.idempotencyKey
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run mutation receipts do not match lifecycle state.',
    );
  }
  return run;
}

function assertFullStateMatchesRun(run: ReferenceDeconstructionRun): void {
  const full = run.full!;
  if (
    full.plan.referenceId !== run.referenceId
    || full.plan.sourceChecksumSha256 !== run.sourceChecksumSha256
    || full.plan.structureFingerprint !== run.structureFingerprint
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full state does not match the run source identity.',
    );
  }
  if (
    full.analysisQuality?.blockingDiagnosticCount
      !== run.diagnostics.filter((diagnostic) => diagnostic.blocking).length
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference analysis quality summary does not match run diagnostics.',
    );
  }
  const runningUnits = full.units.filter((unit) => unit.status === 'running');
  const runningAttempts = full.attempts.filter((attempt) => attempt.status === 'running');
  if (run.activeReservation?.kind === 'fullUnit') {
    if (
      runningUnits.length !== 1
      || runningAttempts.length !== 1
      || runningUnits[0]?.id !== run.activeReservation.unitId
      || runningAttempts[0]?.id !== run.activeReservation.attemptId
      || runningAttempts[0]?.unitId !== runningUnits[0]?.id
      || runningAttempts[0]?.inputFingerprint !== run.activeReservation.inputFingerprint
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference full reservation does not match its running unit and attempt.',
      );
    }
  } else if (runningUnits.length || runningAttempts.length) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full state contains an unreserved running unit.',
    );
  }
  if (
    run.status === 'fullApproved'
      && full.units.some((unit) => unit.status !== 'queued')
    || run.status === 'reviewReady'
      && (
        full.units.some((unit) => unit.status !== 'completed')
        || full.analysisQuality?.status !== 'passed'
        || full.analysisQuality.coveragePercent !== 100
        || full.analysisQuality.blockingDiagnosticCount !== 0
        || run.diagnostics.some((diagnostic) => diagnostic.blocking)
      )
    || run.status === 'failed'
      && !full.units.some((unit) => unit.status === 'failed' || (
        unit.kind === 'analysisQuality'
        && unit.status === 'completed'
        && full.analysisQuality?.status === 'failed'
      ))
    || run.status === 'interrupted'
      && !full.units.some((unit) => unit.status === 'interrupted')
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full work state does not match its run status.',
    );
  }
}

function assertRunRequest(
  value: unknown,
  expectedReferenceId: string,
  expectedRunId: string,
): ReferenceDeconstructionRunRequest {
  const record = requireRecord(value, 'Reference run request');
  assertOnlyKnownFields(record, [
    'version',
    'runId',
    'referenceId',
    'mode',
    'sourceChecksumSha256',
    'structureFingerprint',
    'structureConfidence',
    'rangeConfirmed',
    'selection',
    'createdAt',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new ReferenceDeconstructionValidationError(
      'Unsupported reference run request version.',
    );
  }
  const referenceId = assertSafeIdentifier(record.referenceId, 'referenceId');
  const runId = assertSafeIdentifier(record.runId, 'runId');
  const sourceChecksumSha256 = assertSha256(
    record.sourceChecksumSha256,
    'sourceChecksumSha256',
  );
  const structureFingerprint = assertSha256(
    record.structureFingerprint,
    'structureFingerprint',
  );
  const structureConfidence = requireEnum(
    record.structureConfidence,
    ['low', 'medium', 'high'] as const,
    'structureConfidence',
  );
  if (typeof record.rangeConfirmed !== 'boolean') {
    throw new ReferenceDeconstructionValidationError(
      'rangeConfirmed must be boolean.',
    );
  }
  const rangeConfirmed = record.rangeConfirmed;
  if (structureConfidence === 'low' && !rangeConfirmed) {
    throw new ReferenceDeconstructionValidationError(
      'Low-confidence chapter boundaries require explicit range confirmation.',
    );
  }
  if (referenceId !== expectedReferenceId || runId !== expectedRunId) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run request identity does not match its path.',
    );
  }
  const selection = assertQuickPreviewSelection(record.selection, {
    referenceId,
    sourceChecksumSha256,
    structureFingerprint,
  });
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    referenceId,
    mode: requireLiteral(record.mode, 'quickPreview', 'run mode'),
    sourceChecksumSha256,
    structureFingerprint,
    structureConfidence,
    rangeConfirmed,
    selection,
    createdAt: assertIsoDate(record.createdAt, 'createdAt'),
  };
}

async function validateRunRequestAgainstCurrentSource(
  workspaceRoot: string,
  request: ReferenceDeconstructionRunRequest,
): Promise<void> {
  const source = await readReferencePreviewSource(workspaceRoot, request.referenceId);
  if (
    source.sourceManifest.checksumSha256 !== request.sourceChecksumSha256
    || source.sourceManifest.structureFingerprint !== request.structureFingerprint
    || source.sourceManifest.detectedStructure.confidence !== request.structureConfidence
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run request source identity is stale.',
    );
  }
  const chapters = new Map(source.sourceManifest.detectedStructure.chapters.map((chapter) => [
    chapter.id,
    chapter,
  ]));
  const expectedOmittedChapterIds = source.sourceManifest.detectedStructure.chapters
    .map((chapter) => chapter.id)
    .filter((chapterId) => !request.selection.selectedChapterIds.includes(chapterId));
  if (
    stableJson(request.selection.omittedChapterIds)
      !== stableJson(expectedOmittedChapterIds)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run request chapter partition is invalid.',
    );
  }
  const lines = source.sourceText.split(/\r?\n/u);
  const chunkOrdinals = new Map<string, number>();
  request.selection.windows.forEach((window, index) => {
    const expectedPointerId = `source-window-${String(index + 1).padStart(3, '0')}`;
    if (window.pointerId !== expectedPointerId) {
      throw new ReferenceDeconstructionValidationError(
        'Reference run request evidence order is invalid.',
      );
    }
    const chapter = chapters.get(window.pointer.chapterId);
    if (
      !chapter
      || window.pointer.lineStart < chapter.lineStart
      || window.pointer.lineEnd > chapter.lineEnd
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference run request pointer is outside its chapter boundary.',
      );
    }
    const ordinal = (chunkOrdinals.get(chapter.id) ?? 0) + 1;
    chunkOrdinals.set(chapter.id, ordinal);
    if (
      window.pointer.chunkId
      !== `${chapter.id}-chunk-${String(ordinal).padStart(3, '0')}`
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference run request chunk identity is invalid.',
      );
    }
    const rangeText = lines
      .slice(window.pointer.lineStart - 1, window.pointer.lineEnd)
      .join('\n');
    if (!rangeText.includes(window.content)) {
      throw new ReferenceDeconstructionValidationError(
        'Reference run request source window is not backed by its pointer range.',
      );
    }
  });
}

function assertRunRequestMatchesAuthoritativeRun(
  request: ReferenceDeconstructionRunRequest,
  run: ReferenceDeconstructionRun,
): void {
  const expectedEvidence: ReferenceQuickPreviewEvidence[] = request.selection.windows
    .map((window) => ({
      id: window.pointerId,
      pointer: window.pointer,
    }));
  const createReceipt = run.mutationReceipts[0];
  const expectedFingerprint = fingerprintCreateRequest(request);
  if (
    request.createdAt !== run.createdAt
    || stableJson(summarizeSelection(request.selection)) !== stableJson(run.selection)
    || stableJson(expectedEvidence) !== stableJson(run.evidence)
    || !createReceipt
    || createReceipt.resultingRunRevision !== 0
    || createReceipt.requestFingerprint !== expectedFingerprint
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run request does not match authoritative run state.',
    );
  }
}

function assertSelectionSummary(value: unknown): ReferenceQuickPreviewSelectionSummary {
  const record = requireRecord(value, 'selection summary');
  assertOnlyKnownFields(record, [
    'selectedChapterIds',
    'omittedChapterIds',
    'selectedWindowCount',
    'selectedCharacterCount',
    'maxChapters',
    'maxChars',
  ]);
  return {
    selectedChapterIds: identifierArray(record.selectedChapterIds, 'selectedChapterIds', 1, 3),
    omittedChapterIds: identifierArray(record.omittedChapterIds, 'omittedChapterIds', 0, 100_000),
    selectedWindowCount: safeInteger(
      record.selectedWindowCount,
      'selectedWindowCount',
      1,
      MAX_REFERENCE_QUICK_PREVIEW_WINDOWS,
    ),
    selectedCharacterCount: safeInteger(
      record.selectedCharacterCount,
      'selectedCharacterCount',
      1,
      48_000,
    ),
    maxChapters: safeInteger(record.maxChapters, 'maxChapters', 1, 3),
    maxChars: safeInteger(record.maxChars, 'maxChars', 1, 48_000),
  };
}

function assertMutationReceipt(value: unknown): ReferenceDeconstructionMutationReceipt {
  const record = requireRecord(value, 'mutation receipt');
  assertOnlyKnownFields(record, [
    'idempotencyKey',
    'requestFingerprint',
    'resultingRunRevision',
    'resultStatus',
  ]);
  return {
    idempotencyKey: assertIdempotencyKey(record.idempotencyKey),
    requestFingerprint: assertSha256(record.requestFingerprint, 'requestFingerprint'),
    resultingRunRevision: safeInteger(
      record.resultingRunRevision,
      'resultingRunRevision',
      0,
    ),
    resultStatus: requireEnum(record.resultStatus, RUN_STATUS_VALUES, 'resultStatus'),
  };
}

function assertStoredFullState(
  value: unknown,
  referenceId: string,
): ReferenceFullDeconstructionState {
  const record = requireRecord(value, 'full deconstruction state');
  assertOnlyKnownFields(record, ['plan', 'units', 'attempts', 'analysisQuality']);
  const plan = assertStoredWorkPlan(record.plan, referenceId);
  const units = requireArray(
    record.units,
    'full work units',
    1,
    plan.units.length,
  ).map((item) => assertStoredWorkUnit(item));
  if (
    units.length !== plan.units.length
    || units.some((unit, index) => stableJson(stripStoredUnit(unit))
      !== stableJson(plan.units[index]))
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full units do not match their deterministic work plan.',
    );
  }
  const attempts = requireArray(
    record.attempts,
    'full attempts',
    0,
    MAX_REFERENCE_DECONSTRUCTION_MUTATION_RECEIPTS,
  ).map((item) => assertStoredAttempt(item));
  if (new Set(attempts.map((attempt) => attempt.id)).size !== attempts.length) {
    throw new ReferenceDeconstructionValidationError('Reference full attempt ids must be unique.');
  }
  const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  for (const unit of units) {
    const unitAttempts = attempts.filter((attempt) => attempt.unitId === unit.id);
    if (
      stableJson(unit.attemptIds) !== stableJson(unitAttempts.map((attempt) => attempt.id))
      || unitAttempts.some((attempt, index) => attempt.attemptNumber !== index + 1)
      || unit.selectedAttemptId
        && (
          !unit.attemptIds.includes(unit.selectedAttemptId)
          || attemptById.get(unit.selectedAttemptId)?.status !== 'completed'
          || !attemptById.get(unit.selectedAttemptId)?.outputHash
        )
      || unit.status === 'completed' && !unit.selectedAttemptId
      || unit.status !== 'completed' && unit.selectedAttemptId
    ) {
      throw new ReferenceDeconstructionValidationError(
        `Reference full unit attempt selection is invalid: ${unit.id}.`,
      );
    }
  }
  if (attempts.some((attempt) => !units.some((unit) => unit.id === attempt.unitId))) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full attempt points to an unknown work unit.',
    );
  }
  if (record.analysisQuality === undefined) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full analysis quality summary is missing.',
    );
  }
  const analysisQuality = assertStoredAnalysisQuality(record.analysisQuality);
  return {
    plan,
    units,
    attempts,
    analysisQuality,
  };
}

function assertStoredWorkPlan(
  value: unknown,
  referenceId: string,
): ReferenceDeconstructionWorkPlan {
  const record = requireRecord(value, 'full work plan');
  assertOnlyKnownFields(record, [
    'version',
    'id',
    'referenceId',
    'sourceChecksumSha256',
    'structureFingerprint',
    'chapterIds',
    'units',
    'aggregateRootUnitId',
    'styleUnitId',
    'distillUnitId',
    'analysisQualityUnitId',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new ReferenceDeconstructionValidationError('Unsupported full work plan version.');
  }
  const parsedReferenceId = assertSafeIdentifier(record.referenceId, 'plan referenceId');
  if (parsedReferenceId !== referenceId) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full work plan identity does not match its run.',
    );
  }
  const units = requireArray(record.units, 'planned units', 1, 2_048)
    .map((item) => assertPlannedWorkUnit(item));
  if (
    new Set(units.map((unit) => unit.id)).size !== units.length
    || units.some((unit, index) => unit.ordinal !== index + 1)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full work plan units must be unique and contiguous.',
    );
  }
  const unitIds = new Set(units.map((unit) => unit.id));
  if (units.some((unit) => unit.predecessorUnitIds.some((id) => {
    const predecessor = units.find((candidate) => candidate.id === id);
    return !unitIds.has(id) || !predecessor || predecessor.ordinal >= unit.ordinal;
  }))) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full work plan predecessor closure is invalid.',
    );
  }
  const chapterIds = identifierArray(record.chapterIds, 'plan chapterIds', 1, 100_000);
  const aggregateRootUnitId = assertSafeIdentifier(
    record.aggregateRootUnitId,
    'aggregateRootUnitId',
  );
  const styleUnitId = assertSafeIdentifier(record.styleUnitId, 'styleUnitId');
  const distillUnitId = assertSafeIdentifier(record.distillUnitId, 'distillUnitId');
  const analysisQualityUnitId = assertSafeIdentifier(
    record.analysisQualityUnitId,
    'analysisQualityUnitId',
  );
  if (
    units.find((unit) => unit.id === aggregateRootUnitId)?.kind !== 'aggregate'
    || units.find((unit) => unit.id === styleUnitId)?.kind !== 'style'
    || units.find((unit) => unit.id === distillUnitId)?.kind !== 'distill'
    || units.find((unit) => unit.id === analysisQualityUnitId)?.kind !== 'analysisQuality'
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full work plan terminal units are invalid.',
    );
  }
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    id: assertSafeIdentifier(record.id, 'plan id'),
    referenceId: parsedReferenceId,
    sourceChecksumSha256: assertSha256(record.sourceChecksumSha256, 'plan sourceChecksumSha256'),
    structureFingerprint: assertSha256(record.structureFingerprint, 'plan structureFingerprint'),
    chapterIds,
    units,
    aggregateRootUnitId,
    styleUnitId,
    distillUnitId,
    analysisQualityUnitId,
  };
}

function assertPlannedWorkUnit(value: unknown): ReferenceDeconstructionWorkUnit {
  const record = requireRecord(value, 'planned work unit');
  assertOnlyKnownFields(record, [
    'id',
    'ordinal',
    'stageId',
    'kind',
    'predecessorUnitIds',
    'chapterId',
    'chunkId',
    'pointerId',
    'pointer',
    'isLastChunkInChapter',
    'lineCharStart',
    'lineCharEnd',
    'aggregateLevel',
  ]);
  const kind = requireEnum(record.kind, [
    'chapterChunk',
    'aggregate',
    'style',
    'distill',
    'analysisQuality',
  ] as const, 'work unit kind');
  const stageId = requireEnum(record.stageId, [
    'chapterAnalysis',
    'aggregateAnalysis',
    'styleProfile',
    'distillForOan',
    'qualityGate',
  ] as const, 'work unit stageId');
  const expectedStage = kind === 'chapterChunk'
    ? 'chapterAnalysis'
    : kind === 'aggregate'
      ? 'aggregateAnalysis'
      : kind === 'style'
        ? 'styleProfile'
        : kind === 'distill'
          ? 'distillForOan'
          : 'qualityGate';
  if (stageId !== expectedStage) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full work unit kind and stage do not match.',
    );
  }
  const base: ReferenceDeconstructionWorkUnit = {
    id: assertSafeIdentifier(record.id, 'unit id'),
    ordinal: safeInteger(record.ordinal, 'unit ordinal', 1, 2_048),
    stageId,
    kind,
    predecessorUnitIds: identifierArray(
      record.predecessorUnitIds,
      'predecessorUnitIds',
      0,
      2_048,
    ),
  };
  if (kind === 'chapterChunk') {
    if (record.aggregateLevel !== undefined) {
      throw new ReferenceDeconstructionValidationError(
        'Reference chapter work unit contains aggregate metadata.',
      );
    }
    if (typeof record.isLastChunkInChapter !== 'boolean') {
      throw new ReferenceDeconstructionValidationError(
        'Chapter work unit final-chunk marker is invalid.',
      );
    }
    if (base.predecessorUnitIds.length > 1) {
      throw new ReferenceDeconstructionValidationError(
        'Reference chapter work unit has too many predecessors.',
      );
    }
    const lineCharStart = record.lineCharStart === undefined
      ? undefined
      : safeInteger(record.lineCharStart, 'unit lineCharStart', 0);
    const lineCharEnd = record.lineCharEnd === undefined
      ? undefined
      : safeInteger(record.lineCharEnd, 'unit lineCharEnd', 1);
    if (
      (lineCharStart === undefined) !== (lineCharEnd === undefined)
      || lineCharStart !== undefined && lineCharEnd! <= lineCharStart
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Chapter work unit character slice is invalid.',
      );
    }
    return {
      ...base,
      chapterId: assertSafeIdentifier(record.chapterId, 'unit chapterId'),
      chunkId: assertSafeIdentifier(record.chunkId, 'unit chunkId'),
      pointerId: assertSafeIdentifier(record.pointerId, 'unit pointerId'),
      pointer: assertReferenceSourcePointer(record.pointer),
      isLastChunkInChapter: record.isLastChunkInChapter,
      ...(lineCharStart === undefined ? {} : { lineCharStart, lineCharEnd }),
    };
  }
  if (kind === 'aggregate') {
    if (
      record.chapterId !== undefined
      || record.chunkId !== undefined
      || record.pointerId !== undefined
      || record.pointer !== undefined
      || record.isLastChunkInChapter !== undefined
      || record.lineCharStart !== undefined
      || record.lineCharEnd !== undefined
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference aggregate work unit contains unexpected source metadata.',
      );
    }
    if (
      base.predecessorUnitIds.length < 1
      || base.predecessorUnitIds.length > 8
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference aggregate work unit predecessor fan-in is invalid.',
      );
    }
    return {
      ...base,
      aggregateLevel: safeInteger(record.aggregateLevel, 'aggregateLevel', 1, 2_048),
    };
  }
  if (
    record.chapterId !== undefined
    || record.chunkId !== undefined
    || record.pointerId !== undefined
    || record.pointer !== undefined
    || record.isLastChunkInChapter !== undefined
    || record.lineCharStart !== undefined
    || record.lineCharEnd !== undefined
    || record.aggregateLevel !== undefined
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference terminal work unit contains unexpected source metadata.',
    );
  }
  const expectedTerminalPredecessors = kind === 'distill' ? 2 : 1;
  if (base.predecessorUnitIds.length !== expectedTerminalPredecessors) {
    throw new ReferenceDeconstructionValidationError(
      'Reference terminal work unit has an invalid predecessor count.',
    );
  }
  return base;
}

function assertStoredWorkUnit(value: unknown): ReferenceDeconstructionStoredUnit {
  const record = requireRecord(value, 'stored work unit');
  const planned = assertPlannedWorkUnit(Object.fromEntries(
    Object.entries(record).filter(([key]) => ![
      'status',
      'attemptIds',
      'selectedAttemptId',
    ].includes(key)),
  ));
  const allowed = new Set([
    'id', 'ordinal', 'stageId', 'kind', 'predecessorUnitIds', 'chapterId', 'chunkId',
    'pointerId', 'pointer', 'isLastChunkInChapter', 'lineCharStart', 'lineCharEnd',
    'aggregateLevel', 'status',
    'attemptIds', 'selectedAttemptId',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ReferenceDeconstructionValidationError('Stored work unit has unknown fields.');
  }
  return {
    ...planned,
    status: requireEnum(record.status, [
      'queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled', 'stale',
    ] as const, 'unit status'),
    attemptIds: identifierArray(record.attemptIds, 'unit attemptIds', 0, 4_096),
    ...(record.selectedAttemptId === undefined
      ? {}
      : { selectedAttemptId: assertSafeIdentifier(record.selectedAttemptId, 'selectedAttemptId') }),
  };
}

function stripStoredUnit(unit: ReferenceDeconstructionStoredUnit): ReferenceDeconstructionWorkUnit {
  const {
    status: _status,
    attemptIds: _attemptIds,
    selectedAttemptId: _selectedAttemptId,
    ...planned
  } = unit;
  return planned;
}

function assertStoredAttempt(value: unknown): ReferenceDeconstructionAttemptSummary {
  const record = requireRecord(value, 'stored attempt');
  assertOnlyKnownFields(record, [
    'id',
    'unitId',
    'attemptNumber',
    'status',
    'inputFingerprint',
    'predecessorOutputHashes',
    'outputHash',
    'startedAt',
    'completedAt',
    'failure',
  ]);
  const status = requireEnum(record.status, [
    'running', 'completed', 'failed', 'interrupted', 'cancelled', 'stale',
  ] as const, 'attempt status');
  const outputHash = record.outputHash === undefined
    ? undefined
    : assertSha256(record.outputHash, 'attempt outputHash');
  const completedAt = record.completedAt === undefined
    ? undefined
    : assertIsoDate(record.completedAt, 'attempt completedAt');
  const failure = record.failure === undefined
    ? undefined
    : assertStoredFailure(record.failure);
  if (
    status === 'running' && (outputHash || completedAt || failure)
    || status === 'completed' && (!outputHash || !completedAt || failure)
    || status === 'failed' && (!completedAt || !failure || outputHash)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference full attempt completion metadata does not match status.',
    );
  }
  return {
    id: assertSafeIdentifier(record.id, 'attempt id'),
    unitId: assertSafeIdentifier(record.unitId, 'attempt unitId'),
    attemptNumber: safeInteger(record.attemptNumber, 'attemptNumber', 1, 4_096),
    status,
    inputFingerprint: assertSha256(record.inputFingerprint, 'attempt inputFingerprint'),
    predecessorOutputHashes: requireArray(
      record.predecessorOutputHashes,
      'predecessorOutputHashes',
      0,
      2_048,
    ).map((hash) => assertSha256(hash, 'predecessorOutputHash')),
    ...(outputHash ? { outputHash } : {}),
    startedAt: assertIsoDate(record.startedAt, 'attempt startedAt'),
    ...(completedAt ? { completedAt } : {}),
    ...(failure ? { failure } : {}),
  };
}

function assertStoredAnalysisQuality(
  value: unknown,
): ReferenceDeconstructionAnalysisQualitySummary {
  const record = requireRecord(value, 'analysis quality summary');
  assertOnlyKnownFields(record, [
    'status', 'coveragePercent', 'blockingDiagnosticCount', 'outputHashes',
  ]);
  const outputHashes = requireArray(record.outputHashes, 'quality outputHashes', 0, 2_048)
    .map((hash) => assertSha256(hash, 'quality outputHash'));
  if (new Set(outputHashes).size !== outputHashes.length) {
    throw new ReferenceDeconstructionValidationError(
      'Reference quality output hashes must be unique.',
    );
  }
  const status = requireEnum(
    record.status,
    ['notEvaluated', 'passed', 'failed'] as const,
    'analysis quality status',
  );
  const coveragePercent = safeInteger(record.coveragePercent, 'coveragePercent', 0, 100);
  const blockingDiagnosticCount = safeInteger(
      record.blockingDiagnosticCount,
      'blockingDiagnosticCount',
      0,
      MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
    );
  if (
    status === 'passed'
      && (coveragePercent !== 100 || blockingDiagnosticCount !== 0 || !outputHashes.length)
    || status === 'failed' && blockingDiagnosticCount === 0
    || status === 'notEvaluated' && (coveragePercent !== 0 || outputHashes.length)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference analysis quality summary is internally inconsistent.',
    );
  }
  return {
    status,
    coveragePercent,
    blockingDiagnosticCount,
    outputHashes,
  };
}

function assertStoredPublication(
  value: unknown,
): ReferenceDeconstructionPublicationState {
  const record = requireRecord(value, 'publication state');
  assertOnlyKnownFields(record, [
    'candidateFingerprint',
    'pendingActionId',
    'files',
    'entryInventory',
    'preparedAt',
  ]);
  const files = requireArray(record.files, 'publication files', 1, 10_000)
    .map((value): ReferenceDeconstructionPublicationState['files'][number] => {
      const file = requireRecord(value, 'publication file');
      assertOnlyKnownFields(file, ['path', 'checksumSha256', 'kind']);
      const kind = requireEnum(file.kind, [
        'index',
        'manifest',
        'diagnostics',
        'progress',
        'deconstruction',
        'distilled',
        'context',
      ] as const, 'publication file kind');
      return {
        path: boundedText(file.path, 'publication file path', 1_000),
        checksumSha256: assertSha256(
          file.checksumSha256,
          'publication file checksumSha256',
        ),
        kind,
      };
    });
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication file paths must be unique.',
    );
  }
  const entryInventory = requireArray(
    record.entryInventory,
    'publication entry inventory',
    1,
    50,
  ).map((value): ReferenceDeconstructionPublicationEntryInventoryItem => {
    const entry = requireRecord(value, 'publication entry inventory item');
    assertOnlyKnownFields(entry, ['id', 'category', 'title', 'estimatedTokens']);
    return {
      id: assertSafeIdentifier(entry.id, 'publication entry id'),
      category: requireEnum(entry.category, [
        'writingStyle',
        'pacing',
        'hooks',
        'scene',
        'character',
      ] as const, 'publication entry category'),
      title: boundedText(entry.title, 'publication entry title', 240),
      estimatedTokens: safeInteger(
        entry.estimatedTokens,
        'publication entry estimatedTokens',
        1,
        2_048,
      ),
    };
  });
  if (new Set(entryInventory.map((entry) => entry.id)).size !== entryInventory.length) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication entry ids must be unique.',
    );
  }
  return {
    candidateFingerprint: assertSha256(
      record.candidateFingerprint,
      'candidateFingerprint',
    ),
    pendingActionId: assertSafeIdentifier(record.pendingActionId, 'pendingActionId'),
    files,
    entryInventory,
    preparedAt: assertIsoDate(record.preparedAt, 'publication preparedAt'),
  };
}

function assertStoredReservation(value: unknown): ReferenceDeconstructionReservation {
  const record = requireRecord(value, 'active reservation');
  const kind = requireEnum(record.kind, ['preview', 'fullUnit'] as const, 'reservation kind');
  if (kind === 'preview') {
    assertOnlyKnownFields(record, ['kind', 'id', 'idempotencyKey', 'startedAt']);
    return {
      kind,
      id: assertSafeIdentifier(record.id, 'reservation id'),
      idempotencyKey: assertIdempotencyKey(record.idempotencyKey),
      startedAt: assertIsoDate(record.startedAt, 'reservation startedAt'),
    };
  }
  assertOnlyKnownFields(record, [
    'kind',
    'id',
    'idempotencyKey',
    'unitId',
    'attemptId',
    'inputFingerprint',
    'startedAt',
  ]);
  return {
    kind,
    id: assertSafeIdentifier(record.id, 'reservation id'),
    idempotencyKey: assertIdempotencyKey(record.idempotencyKey),
    unitId: assertSafeIdentifier(record.unitId, 'reservation unitId'),
    attemptId: assertSafeIdentifier(record.attemptId, 'reservation attemptId'),
    inputFingerprint: assertSha256(record.inputFingerprint, 'reservation inputFingerprint'),
    startedAt: assertIsoDate(record.startedAt, 'reservation startedAt'),
  };
}

function assertStoredEvidence(value: unknown): ReferenceQuickPreviewEvidence {
  const record = requireRecord(value, 'run evidence');
  assertOnlyKnownFields(record, ['id', 'pointer']);
  return {
    id: assertSafeIdentifier(record.id, 'evidence id'),
    pointer: assertReferenceSourcePointer(record.pointer),
  };
}

function assertStoredFailure(value: unknown): ReferenceDeconstructionRunFailure {
  const record = requireRecord(value, 'run failure');
  assertOnlyKnownFields(record, ['code', 'message', 'failedAt']);
  return {
    code: assertCode(record.code, 'failure code'),
    message: boundedText(record.message, 'failure message', 1_000),
    failedAt: assertIsoDate(record.failedAt, 'failedAt'),
  };
}

function assertStoredPreview(
  value: unknown,
  runId: string,
  referenceId: string,
): ReferenceQuickPreview {
  const record = requireRecord(value, 'stored preview');
  if (
    record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || record.runId !== runId
    || record.referenceId !== referenceId
    || typeof record.sourceOverview !== 'string'
    || !Array.isArray(record.chapterPreviews)
    || !Array.isArray(record.findings)
    || !Array.isArray(record.borrowablePatterns)
    || !Array.isArray(record.doNotCopy)
    || !Array.isArray(record.differentiationRequirements)
    || !Array.isArray(record.differentiationPrompts)
    || !Array.isArray(record.canonContaminationWarnings)
    || !Array.isArray(record.uncertainties)
    || !Array.isArray(record.diagnostics)
    || !isRecord(record.coverage)
  ) {
    throw new ReferenceDeconstructionValidationError('Stored reference preview is invalid.');
  }
  return value as ReferenceQuickPreview;
}

function normalizeStoreDiagnostic(
  value: ReferenceDeconstructionDiagnostic | unknown,
): ReferenceDeconstructionDiagnostic {
  const wrapper: ReferenceDeconstructionDiagnostics = {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: 'validation-reference',
    sourceChecksumSha256: '0'.repeat(64),
    generatedAt: new Date(0).toISOString(),
    items: [value as ReferenceDeconstructionDiagnostic],
  };
  try {
    return assertReferenceDeconstructionDiagnostics(wrapper).items[0]!;
  } catch (error) {
    throw validationFrom(error);
  }
}

async function writeRunRequest(
  workspaceRoot: string,
  request: ReferenceDeconstructionRunRequest,
): Promise<void> {
  await writeRunYamlAtomic(
    workspaceRoot,
    request.runId,
    'request.yaml',
    request,
  );
}

async function writeRunState(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
): Promise<void> {
  await writeRunYamlAtomic(
    workspaceRoot,
    run.runId,
    'run-state.yaml',
    run,
  );
}

async function writeRunDiagnostics(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
): Promise<void> {
  const diagnostics: ReferenceDeconstructionDiagnostics = {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: run.referenceId,
    sourceChecksumSha256: run.sourceChecksumSha256,
    generatedAt: run.updatedAt,
    items: run.diagnostics,
  };
  await writeRunYamlAtomic(
    workspaceRoot,
    run.runId,
    'diagnostics.yaml',
    diagnostics,
  );
}

async function writePreviewArtifacts(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  preview: ReferenceQuickPreview,
): Promise<void> {
  await Promise.all([
    writeRunYamlAtomic(
      workspaceRoot,
      run.runId,
      'preview.yaml',
      preview,
    ),
    writeRunTextAtomic(
      workspaceRoot,
      run.runId,
      'preview.md',
      formatReferenceQuickPreviewMarkdown(preview),
    ),
  ]);
}

export async function resolveReferenceDeconstructionRunArtifactPath(
  workspaceRoot: string,
  runId: string,
  file: string,
  options: ResolveReferenceDeconstructionRunArtifactOptions = {},
): Promise<string> {
  const safeRunId = assertSafeIdentifier(runId, 'runId');
  const safeFile = assertSafeArtifactFileName(file);
  const root = resolve(workspaceRoot);
  const directory = await ensureSafeDirectoryChain(
    root,
    ['.workspace', 'sessions', safeRunId, 'reference-deconstruction'],
    options.createDirectory === true,
  );
  const path = resolve(directory.path, safeFile);
  assertContained(root, path, 'Reference run artifact path escapes workspace.');
  if (directory.exists) {
    let information: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      information = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw validationFrom(error);
    }
    if (information) {
      if (information.isSymbolicLink() || !information.isFile()) {
        throw new ReferenceDeconstructionValidationError(
          'Reference run artifact must be a regular non-symlink file.',
        );
      }
      let realArtifact: string;
      try {
        realArtifact = await realpath(path);
      } catch (error) {
        throw validationFrom(error, 'Reference run artifact is inaccessible.');
      }
      assertContained(
        directory.realPath!,
        realArtifact,
        'Reference run artifact resolves outside its run directory.',
      );
    } else if (options.requireExistingArtifact) {
      throw new ReferenceDeconstructionNotFoundError(
        `Reference run artifact not found: ${safeFile}.`,
      );
    }
  } else if (options.requireExistingArtifact) {
    throw new ReferenceDeconstructionNotFoundError(
      `Reference run artifact not found: ${safeFile}.`,
    );
  }
  return path;
}

export async function resolveReferenceDeconstructionAttemptArtifactPath(
  workspaceRoot: string,
  runId: string,
  stageId: ReferenceDeconstructionWorkUnit['stageId'],
  attemptId: string,
  file: 'input-manifest.yaml' | 'findings.yaml' | 'receipt.yaml',
  options: ResolveReferenceDeconstructionRunArtifactOptions = {},
): Promise<string> {
  const safeRunId = assertSafeIdentifier(runId, 'runId');
  const safeStageId = assertSafeIdentifier(stageId, 'stageId');
  const safeAttemptId = assertSafeIdentifier(attemptId, 'attemptId');
  const safeFile = assertSafeArtifactFileName(file);
  const root = resolve(workspaceRoot);
  const directory = await ensureSafeDirectoryChain(root, [
    '.workspace',
    'sessions',
    safeRunId,
    'reference-deconstruction',
    'stages',
    safeStageId,
    'attempts',
    safeAttemptId,
  ], options.createDirectory === true);
  const path = resolve(directory.path, safeFile);
  assertContained(root, path, 'Reference attempt artifact path escapes workspace.');
  if (directory.exists) {
    let information: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      information = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw validationFrom(error);
    }
    if (information) {
      if (information.isSymbolicLink() || !information.isFile()) {
        throw new ReferenceDeconstructionValidationError(
          'Reference attempt artifact must be a regular non-symlink file.',
        );
      }
      const realArtifact = await realpath(path).catch((error) => {
        throw validationFrom(error, 'Reference attempt artifact is inaccessible.');
      });
      assertContained(
        directory.realPath!,
        realArtifact,
        'Reference attempt artifact resolves outside its attempt directory.',
      );
    } else if (options.requireExistingArtifact) {
      throw new ReferenceDeconstructionNotFoundError(
        `Reference attempt artifact not found: ${safeFile}.`,
      );
    }
  } else if (options.requireExistingArtifact) {
    throw new ReferenceDeconstructionNotFoundError(
      `Reference attempt artifact not found: ${safeFile}.`,
    );
  }
  return path;
}

async function ensureReferenceAttemptInputManifest(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  unit: ReferenceDeconstructionWorkUnit,
  attemptId: string,
  inputFingerprint: string,
  predecessorOutputHashes: readonly string[],
  proposedStartedAt: string,
): Promise<string> {
  let existingPath: string | undefined;
  try {
    existingPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      workspaceRoot,
      run.runId,
      unit.stageId,
      attemptId,
      'input-manifest.yaml',
      { requireExistingArtifact: true },
    );
  } catch (error) {
    if (!(error instanceof ReferenceDeconstructionNotFoundError)) throw error;
  }
  if (existingPath) {
    const value = await readYamlOrValidation(
      existingPath,
      'Reference orphan attempt input manifest is invalid.',
    );
    const record = requireRecord(value, 'attempt input manifest');
    assertOnlyKnownFields(record, [
      'version',
      'runId',
      'referenceId',
      'unitId',
      'attemptId',
      'inputFingerprint',
      'predecessorOutputHashes',
      'sourceChecksumSha256',
      'structureFingerprint',
      'startedAt',
    ]);
    const storedPredecessorHashes = requireArray(
      record.predecessorOutputHashes,
      'attempt input predecessorOutputHashes',
      0,
      MAX_REFERENCE_DECONSTRUCTION_WORK_UNITS,
    ).map((hash) => assertSha256(hash, 'attempt input predecessorOutputHash'));
    if (
      record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
      || record.runId !== run.runId
      || record.referenceId !== run.referenceId
      || record.unitId !== unit.id
      || record.attemptId !== attemptId
      || record.inputFingerprint !== inputFingerprint
      || record.sourceChecksumSha256 !== run.sourceChecksumSha256
      || record.structureFingerprint !== run.structureFingerprint
      || stableJson(storedPredecessorHashes) !== stableJson(predecessorOutputHashes)
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference orphan attempt input manifest does not match the reserved work identity.',
      );
    }
    return assertIsoDate(record.startedAt, 'attempt input startedAt');
  }

  await writeReferenceAttemptYaml(
    workspaceRoot,
    run.runId,
    unit,
    attemptId,
    'input-manifest.yaml',
    {
      version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
      runId: run.runId,
      referenceId: run.referenceId,
      unitId: unit.id,
      attemptId,
      inputFingerprint,
      predecessorOutputHashes: [...predecessorOutputHashes],
      sourceChecksumSha256: run.sourceChecksumSha256,
      structureFingerprint: run.structureFingerprint,
      startedAt: proposedStartedAt,
    },
  );
  return proposedStartedAt;
}

async function writeReferenceAttemptYaml(
  workspaceRoot: string,
  runId: string,
  unit: ReferenceDeconstructionWorkUnit,
  attemptId: string,
  file: 'input-manifest.yaml' | 'findings.yaml' | 'receipt.yaml',
  value: unknown,
): Promise<void> {
  const path = await resolveReferenceDeconstructionAttemptArtifactPath(
    workspaceRoot,
    runId,
    unit.stageId,
    attemptId,
    file,
    { createDirectory: true },
  );
  const temporary = `${path}.tmp-${randomUUID()}`;
  const serializedValue = stringify(value);
  const serialized = serializedValue.endsWith('\n')
    ? serializedValue
    : `${serializedValue}\n`;
  try {
    await writeFile(temporary, serialized, {
      encoding: 'utf-8',
      flag: 'wx',
    });
    await resolveReferenceDeconstructionAttemptArtifactPath(
      workspaceRoot,
      runId,
      unit.stageId,
      attemptId,
      file,
    );
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existingPath = await resolveReferenceDeconstructionAttemptArtifactPath(
        workspaceRoot,
        runId,
        unit.stageId,
        attemptId,
        file,
        { requireExistingArtifact: true },
      );
      const existing = await readFile(existingPath, 'utf-8');
      if (existing !== serialized) {
        throw new ReferenceDeconstructionValidationError(
          `Reference attempt artifact is append-only and already differs: ${file}.`,
        );
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readReferenceAttemptOutput(
  workspaceRoot: string,
  runId: string,
  attempt: ReferenceDeconstructionAttemptSummary,
): Promise<ReferenceDeconstructionAnalysisOutput> {
  const run = await readRunStateArtifact(workspaceRoot, undefined, runId);
  const output = await readReferenceAttemptOutputFromRun(
    workspaceRoot,
    run,
    attempt,
    createStoredOutputValidationContext(),
  );
  if ('planId' in output) {
    throw new ReferenceDeconstructionValidationError(
      'Reference analysis-quality output cannot be used as a stage predecessor.',
    );
  }
  return output;
}

async function readReferenceAttemptOutputFromRun(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
  attempt: ReferenceDeconstructionAttemptSummary,
  context: StoredOutputValidationContext,
): Promise<ReferenceFullDeconstructionOutput> {
  const cached = context.outputsByAttemptId.get(attempt.id);
  if (cached) return cached;
  if (!run.full) {
    throw new ReferenceDeconstructionValidationError('Reference full run state is missing.');
  }
  const unit = requireStoredUnit(run.full, attempt.unitId);
  if (
    unit.selectedAttemptId !== attempt.id
    || attempt.status !== 'completed'
    || !attempt.outputHash
  ) {
    throw new ReferenceDeconstructionValidationError(
      `Reference attempt is not the completed selection for unit ${unit.id}.`,
    );
  }
  if (context.validatingAttemptIds.has(attempt.id)) {
    throw new ReferenceDeconstructionValidationError(
      `Reference attempt dependency cycle detected: ${attempt.id}.`,
    );
  }
  context.validatingAttemptIds.add(attempt.id);
  const path = await resolveReferenceDeconstructionAttemptArtifactPath(
    workspaceRoot,
    run.runId,
    unit.stageId,
    attempt.id,
    'findings.yaml',
    { requireExistingArtifact: true },
  );
  try {
    const value = await readYamlOrValidation(path, 'Reference attempt output is missing.');
    if (
      !isRecord(value)
      || (
        unit.kind === 'analysisQuality'
          ? value.runId !== run.runId || value.planId !== run.full.plan.id
          : value.unitId !== unit.id
      )
    ) {
      throw new ReferenceDeconstructionValidationError(
        'Reference attempt output identity is invalid.',
      );
    }
    const actualHash = sha256(stableJson(value));
    if (actualHash !== requireAttemptOutputHash(attempt)) {
      throw new ReferenceDeconstructionValidationError(
        `Reference attempt output hash is stale: ${attempt.id}.`,
      );
    }
    const output = await parseStoredFullOutput(
      workspaceRoot,
      run,
      unit,
      value,
      context,
    );
    context.outputsByAttemptId.set(attempt.id, output);
    return output;
  } finally {
    context.validatingAttemptIds.delete(attempt.id);
  }
}

async function ensureSafeDirectoryChain(
  workspaceRoot: string,
  segments: readonly string[],
  create: boolean,
): Promise<{ path: string; realPath?: string; exists: boolean }> {
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = await realpath(workspaceRoot);
  } catch (error) {
    throw validationFrom(error, 'Workspace root is missing.');
  }
  let current = workspaceRoot;
  let currentRealPath = realWorkspaceRoot;
  let exists = true;
  for (const segment of segments) {
    current = join(current, segment);
    if (!exists && !create) continue;
    let information: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      information = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw validationFrom(error);
      if (!create) {
        exists = false;
        continue;
      }
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw validationFrom(mkdirError);
        }
      }
      try {
        information = await lstat(current);
      } catch (lstatError) {
        throw validationFrom(lstatError, 'Reference run directory could not be created safely.');
      }
    }
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new ReferenceDeconstructionValidationError(
        'Reference run directory chain must contain only non-symlink directories.',
      );
    }
    try {
      currentRealPath = await realpath(current);
    } catch (error) {
      throw validationFrom(error, 'Reference run directory is inaccessible.');
    }
    assertContained(
      realWorkspaceRoot,
      currentRealPath,
      'Reference run directory resolves outside workspace.',
    );
  }
  return {
    path: current,
    ...(exists || create ? { realPath: currentRealPath } : {}),
    exists: exists || create,
  };
}

function assertSafeArtifactFileName(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value.includes('..')
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference run artifact file name is invalid.',
    );
  }
  return value;
}

function resolveReferenceBundleRoot(workspaceRoot: string, referenceId: string): string {
  const root = resolve(workspaceRoot);
  const bundle = resolve(root, 'examples', 'references', referenceId);
  assertContained(root, bundle, 'Reference bundle escapes workspace.');
  return bundle;
}

async function resolveContainedExistingPath(
  root: string,
  relativePath: string,
): Promise<string> {
  if (
    !relativePath
    || isAbsolute(relativePath)
    || relativePath.split(/[\\/]+/u).some((part) => !part || part === '.' || part === '..')
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference artifact path is invalid.',
    );
  }
  const lexical = resolve(root, relativePath);
  assertContained(root, lexical, 'Reference artifact path escapes its bundle.');
  let realRoot: string;
  let realFile: string;
  try {
    [realRoot, realFile] = await Promise.all([realpath(root), realpath(lexical)]);
  } catch (error) {
    throw validationFrom(error, 'Reference artifact is missing.');
  }
  assertContained(realRoot, realFile, 'Reference artifact resolves outside its bundle.');
  return realFile;
}

async function assertRealBundleInsideWorkspace(
  workspaceRoot: string,
  bundleRoot: string,
): Promise<void> {
  let realWorkspaceRoot: string;
  let realBundleRoot: string;
  try {
    [realWorkspaceRoot, realBundleRoot] = await Promise.all([
      realpath(resolve(workspaceRoot)),
      realpath(bundleRoot),
    ]);
  } catch (error) {
    throw validationFrom(error, 'Reference bundle is missing.');
  }
  assertContained(
    realWorkspaceRoot,
    realBundleRoot,
    'Reference bundle resolves outside its workspace.',
  );
}

function assertContained(root: string, path: string, message: string): void {
  const candidate = relative(root, path);
  if (
    candidate === ''
    || candidate === '..'
    || candidate.startsWith(`..${sep}`)
    || isAbsolute(candidate)
  ) {
    throw new ReferenceDeconstructionValidationError(message);
  }
}

async function writeRunYamlAtomic(
  workspaceRoot: string,
  runId: string,
  file: string,
  value: unknown,
): Promise<void> {
  await writeRunTextAtomic(workspaceRoot, runId, file, stringify(value));
}

async function writeRunTextAtomic(
  workspaceRoot: string,
  runId: string,
  file: string,
  value: string,
): Promise<void> {
  const path = await resolveReferenceDeconstructionRunArtifactPath(
    workspaceRoot,
    runId,
    file,
    { createDirectory: true },
  );
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, value.endsWith('\n') ? value : `${value}\n`, {
      encoding: 'utf-8',
      flag: 'wx',
    });
    await resolveReferenceDeconstructionRunArtifactPath(
      workspaceRoot,
      runId,
      file,
      { createDirectory: false },
    );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readYamlOrNotFound(path: string, message: string): Promise<unknown> {
  try {
    return parse(await readFile(path, 'utf-8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ReferenceDeconstructionNotFoundError(message);
    }
    throw validationFrom(error);
  }
}

async function readYamlOrValidation(path: string, message: string): Promise<unknown> {
  try {
    return parse(await readFile(path, 'utf-8')) as unknown;
  } catch (error) {
    throw validationFrom(error, message);
  }
}

function failedReadiness(
  status: ReferencePublishedDeconstructionStatus,
  reason: ReferenceReadinessReason,
  error: unknown,
  context: Partial<Pick<
    ReferenceReadinessInspection,
    'metadata' | 'sourceManifest' | 'deconstructionManifest' | 'progress'
  >> = {},
): ReferenceReadinessInspection {
  return {
    status,
    contextEligible: false,
    reason,
    diagnostics: [{
      id: `readiness-${reason}`,
      code: `readiness.${reason}`,
      severity: 'error',
      blocking: true,
      message: sanitizeErrorMessage(error),
      evidenceRefs: [],
    }],
    ...context,
  };
}

function validationFrom(error: unknown, fallback?: string): ReferenceDeconstructionValidationError {
  if (error instanceof ReferenceDeconstructionValidationError) return error;
  return new ReferenceDeconstructionValidationError(
    fallback ?? sanitizeErrorMessage(error),
  );
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replaceAll(/\s+/gu, ' ').trim();
  if (!message) return 'Reference bundle validation failed.';
  return message.length <= 500 ? message : `${message.slice(0, 497)}...`;
}

function assertRevision(run: ReferenceDeconstructionRun, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new ReferenceDeconstructionValidationError('baseRunRevision is invalid.');
  }
  if (run.revision !== expectedRevision) {
    throw new ReferenceDeconstructionConflictError(
      `Reference run revision conflict: expected ${expectedRevision}, current ${run.revision}.`,
      'revisionConflict',
      { expectedRevision, actualRevision: run.revision },
    );
  }
}

function idempotencyConflict(key: string): ReferenceDeconstructionConflictError {
  return new ReferenceDeconstructionConflictError(
    `Idempotency key ${key} was already used with a different request.`,
    'idempotencyConflict',
  );
}

function invalidTransition(
  from: ReferenceDeconstructionRunStatus,
  to: ReferenceDeconstructionRunStatus,
): ReferenceDeconstructionConflictError {
  return new ReferenceDeconstructionConflictError(
    `Reference run cannot transition from ${from} to ${to}.`,
    'invalidTransition',
  );
}

function reservationConflict(): ReferenceDeconstructionConflictError {
  return new ReferenceDeconstructionConflictError(
    'Reference preview reservation is no longer current.',
    'reservationConflict',
  );
}

function fingerprintMutation(value: unknown): string {
  return sha256(stableJson(value));
}

function fingerprintCreateRequest(input: Pick<
  ReferenceDeconstructionRunRequest,
  | 'referenceId'
  | 'sourceChecksumSha256'
  | 'structureFingerprint'
  | 'structureConfidence'
  | 'rangeConfirmed'
  | 'selection'
>): string {
  return fingerprintMutation({
    command: 'create',
    referenceId: input.referenceId,
    baseRunRevision: 0,
    sourceChecksumSha256: input.sourceChecksumSha256,
    structureFingerprint: input.structureFingerprint,
    structureConfidence: input.structureConfidence,
    rangeConfirmed: input.rangeConfirmed,
    selection: input.selection,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeNow(value?: string): string {
  return value === undefined
    ? new Date().toISOString()
    : assertIsoDate(value, 'now');
}

function assertIdempotencyKey(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 8
    || value.length > 180
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value.includes('..')
  ) {
    throw new ReferenceDeconstructionValidationError('idempotencyKey is invalid.');
  }
  return value;
}

function assertSafeIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value.includes('..')
  ) {
    throw new ReferenceDeconstructionValidationError(`${label} is invalid.`);
  }
  return value;
}

function assertSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new ReferenceDeconstructionValidationError(`${label} must be SHA-256.`);
  }
  return value;
}

function assertCode(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(value)
    || value.length > 120
  ) {
    throw new ReferenceDeconstructionValidationError(`${label} is invalid.`);
  }
  return value;
}

function assertIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    throw new ReferenceDeconstructionValidationError(`${label} must be an ISO date.`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ReferenceDeconstructionValidationError(`${label} must be text.`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new ReferenceDeconstructionValidationError(`${label} is out of bounds.`);
  }
  return text;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    throw new ReferenceDeconstructionValidationError(`${label} is invalid.`);
  }
  return value as number;
}

function identifierArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string[] {
  const values = requireArray(value, label, minimum, maximum)
    .map((item) => assertSafeIdentifier(item, label));
  if (new Set(values).size !== values.length) {
    throw new ReferenceDeconstructionValidationError(`${label} contains duplicates.`);
  }
  return values;
}

function requireArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ReferenceDeconstructionValidationError(`${label} is out of bounds.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ReferenceDeconstructionValidationError(`${label} must be an object.`);
  }
  return value;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new ReferenceDeconstructionValidationError(`Unknown field: ${unknown}.`);
  }
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ReferenceDeconstructionValidationError(`${label} must be boolean.`);
  }
  return value;
}

function requireLiteral<const T extends string>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw new ReferenceDeconstructionValidationError(`${label} is invalid.`);
  }
  return expected;
}

function requireEnum<const T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ReferenceDeconstructionValidationError(`${label} is invalid.`);
  }
  return value as T;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function withReferenceLock<T>(
  workspaceRoot: string,
  referenceId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${resolve(workspaceRoot)}\u0000${assertSafeIdentifier(referenceId, 'referenceId')}`;
  const previous = lockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  const tail = previous.then(() => current);
  lockTails.set(key, tail);
  await previous;
  let releaseFilesystemLock: (() => Promise<void>) | undefined;
  try {
    releaseFilesystemLock = await acquireReferenceFilesystemLock(
      workspaceRoot,
      referenceId,
    );
    return await operation();
  } finally {
    await releaseFilesystemLock?.();
    release();
    if (lockTails.get(key) === tail) lockTails.delete(key);
  }
}

async function acquireReferenceFilesystemLock(
  workspaceRoot: string,
  referenceId: string,
): Promise<() => Promise<void>> {
  const root = resolve(workspaceRoot);
  const locksRoot = (await ensureSafeDirectoryChain(
    root,
    ['.workspace', 'reference-deconstruction-locks'],
    true,
  )).path;
  const lockPath = join(locksRoot, `${sha256(referenceId).slice(0, 24)}.lock`);
  const ownerPath = join(lockPath, 'owner');
  const ownerToken = randomUUID();

  for (let attempt = 0; attempt < REFERENCE_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(ownerPath, ownerToken, 'utf-8');
      return async () => {
        try {
          const currentOwner = await readFile(ownerPath, 'utf-8');
          if (currentOwner === ownerToken) {
            await rm(lockPath, { recursive: true, force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > REFERENCE_LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, REFERENCE_LOCK_RETRY_MS);
      });
    }
  }
  throw new ReferenceDeconstructionConflictError(
    'Reference deconstruction state is locked by another backend instance.',
    'revisionConflict',
  );
}
