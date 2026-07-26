import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  ReferenceDeconstructionConflictError,
  ReferenceDeconstructionNotFoundError,
  ReferenceDeconstructionValidationError,
  approveReferenceFullDeconstruction,
  assertReferenceDeconstructionPublishCurrent,
  beginReferenceDeconstructionPublish,
  cancelReferenceDeconstructionRun,
  completeReferenceDeconstructionPublish,
  completeReferenceFullDeconstructionUnit,
  completeReferenceQuickPreview,
  createReferenceQuickPreviewSelection,
  createReferenceDeconstructionRun,
  evaluateReservedReferenceFullDeconstructionQuality,
  failReferenceFullDeconstructionUnit,
  failReferenceQuickPreview,
  interruptReferenceFullDeconstructionUnit,
  interruptReferenceQuickPreview,
  listReferenceDeconstructionRuns,
  pauseReferenceDeconstructionRun,
  projectReferenceDeconstructionRunForTransport,
  readReferenceDeconstructionRun,
  readReferenceDeconstructionRunRequest,
  readReferencePreviewSource,
  prepareReferenceDeconstructionPublicationCandidate,
  reconcileReferenceDeconstructionPublish,
  rejectReferenceDeconstructionPublish,
  reserveReferenceFullDeconstructionUnit,
  reserveReferenceQuickPreview,
  resumeReferenceDeconstructionRun,
  retryReferenceDeconstructionUnit,
} from '@oh-awesome-novel/core';
import type {
  LlmProviderConfig,
  ReferenceDeconstructionMutationReceipt,
  ReferenceDeconstructionMutationResult,
  ReferenceDeconstructionPublicationCandidate,
  ReferenceDeconstructionPublicationCandidateFile,
  ReferenceDeconstructionRun,
  ReferenceDeconstructionRunRequest,
  ReferenceDeconstructionRunStatus,
  ReferenceDeconstructionRunTransport,
  ReferenceFullDeconstructionExecution,
  ReferenceFullDeconstructionOutput,
  ReferenceFullDeconstructionReservation,
  ReferenceFullDeconstructionReservationResult,
} from '@oh-awesome-novel/core';
import {
  acceptPendingAction,
  createPendingAction,
  readPendingAction,
  rejectPendingAction,
} from '@oh-awesome-novel/tools';
import type {
  AcceptedPendingAction,
  RejectedPendingAction,
  ReferenceArtifactPatch,
  ReferenceDeconstructionPublishPendingActionOrigin,
  StoredWriteIntentAction,
} from '@oh-awesome-novel/tools';
import {
  generateReferenceAggregateAnalysis,
  generateReferenceChapterAnalysis,
  generateReferenceDistillation,
  generateReferenceQuickPreview,
  generateReferenceStyleProfile,
} from '@oh-awesome-novel/agent';
import type {
  GenerateReferenceAggregateAnalysisInput,
  GenerateReferenceChapterAnalysisInput,
  GenerateReferenceDistillationInput,
  GenerateReferenceQuickPreviewInput,
  GenerateReferenceStyleProfileInput,
  ReferenceAggregateAnalysisOutput,
  ReferenceChapterAnalysisOutput,
  ReferenceDeconstructionModelResolver,
  ReferenceDistillationOutput,
  ReferenceFullDeconstructionGenerationResult,
  ReferenceQuickPreviewGenerationResult,
  ReferenceStyleProfileOutput,
} from '@oh-awesome-novel/agent';

export interface ReferenceDeconstructionModelRuntime {
  readonly providerConfig: LlmProviderConfig;
  readonly resolveModel: ReferenceDeconstructionModelResolver;
}

export interface CreateReferenceDeconstructionBackendControllerOptions {
  getWorkspaceRoot(): string;
  getModelRuntime(): Promise<ReferenceDeconstructionModelRuntime>;
  runQuickPreview?: (
    input: GenerateReferenceQuickPreviewInput,
  ) => Promise<ReferenceQuickPreviewGenerationResult>;
  runChapterAnalysis?: (
    input: GenerateReferenceChapterAnalysisInput,
  ) => Promise<ReferenceFullDeconstructionGenerationResult<ReferenceChapterAnalysisOutput>>;
  runAggregateAnalysis?: (
    input: GenerateReferenceAggregateAnalysisInput,
  ) => Promise<ReferenceFullDeconstructionGenerationResult<ReferenceAggregateAnalysisOutput>>;
  runStyleProfile?: (
    input: GenerateReferenceStyleProfileInput,
  ) => Promise<ReferenceFullDeconstructionGenerationResult<ReferenceStyleProfileOutput>>;
  runDistillation?: (
    input: GenerateReferenceDistillationInput,
  ) => Promise<ReferenceFullDeconstructionGenerationResult<ReferenceDistillationOutput>>;
}

export interface CreateReferenceDeconstructionRunCommand {
  readonly mode: 'quickPreview';
  readonly baseRunRevision: 0;
  readonly idempotencyKey: string;
  readonly selectedChapterIds?: readonly string[];
  readonly confirmDetectedRange?: true;
}

export interface MutateReferenceDeconstructionRunCommand {
  readonly baseRunRevision: number;
  readonly idempotencyKey: string;
}

export interface RetryReferenceDeconstructionUnitCommand
  extends MutateReferenceDeconstructionRunCommand {
  readonly unitId: string;
}

export interface ReferenceDeconstructionMutationTransportResult {
  readonly run: ReferenceDeconstructionRunTransport;
  readonly receipt: ReferenceDeconstructionMutationReceipt;
  readonly replayed: boolean;
}

export interface ReferenceDeconstructionPublishPendingActionReceipt {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly touchedFiles: string[];
  readonly diff: string;
  readonly createdAt: string;
  readonly status: 'pending' | 'accepted' | 'rejected';
  readonly acceptedAt?: string;
  readonly rejectedAt?: string;
  readonly origin: ReferenceDeconstructionPublishPendingActionOrigin;
}

export interface ReferenceDeconstructionPublishTransportResult
  extends ReferenceDeconstructionMutationTransportResult {
  readonly pendingAction: ReferenceDeconstructionPublishPendingActionReceipt;
}

export interface ReferenceDeconstructionBackendController {
  createRun(
    referenceId: string,
    input: CreateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  readRun(
    referenceId: string,
    runId: string,
  ): Promise<{ run: ReferenceDeconstructionRunTransport }>;
  readActiveRun(
    referenceId: string,
  ): Promise<{ run: ReferenceDeconstructionRunTransport | null }>;
  advanceRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
    requestSignal?: AbortSignal,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  approveFull(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  pauseRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  resumeRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  retryUnit(
    referenceId: string,
    runId: string,
    input: RetryReferenceDeconstructionUnitCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  cancelRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  publishRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionPublishTransportResult>;
  assertPublishPendingActionCurrent(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
  ): Promise<void>;
  decidePublishPendingAction(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
    decision: 'accept' | 'reject',
    autoCommitOnAccept: boolean,
  ): Promise<{
    action: AcceptedPendingAction | RejectedPendingAction;
    referencePublish: ReferenceDeconstructionMutationTransportResult;
  }>;
  completePublishPendingAction(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  rejectPublishPendingAction(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  hasActiveExecution(workspaceRoot?: string): boolean;
}

interface ActiveReferenceExecution {
  readonly workspaceRoot: string;
  readonly referenceId: string;
  readonly runId: string;
  readonly reservationKind: 'preview' | 'fullUnit';
  readonly reservationId: string;
  readonly idempotencyKey: string;
  readonly unitId?: string;
  readonly attemptId?: string;
  readonly abortController: AbortController;
}

interface ActiveReferencePreparation {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly referenceId: string;
  readonly runId: string;
}

interface PreparedReferencePreview {
  readonly kind: 'preview';
  readonly active: ActiveReferenceExecution;
  readonly providerLease: ReferencePreviewProviderLease;
  readonly request: ReferenceDeconstructionRunRequest;
  readonly reserved: ReferenceDeconstructionMutationResult;
  readonly unlinkRequestAbort: () => void;
}

interface PreparedReferenceFullUnit {
  readonly kind: 'fullUnit';
  readonly active: ActiveReferenceExecution;
  readonly providerLease: ReferencePreviewProviderLease;
  readonly reservation: ReferenceFullDeconstructionReservation;
  readonly execution: ReferenceFullDeconstructionExecution;
  readonly reserved: ReferenceFullDeconstructionReservationResult;
  readonly unlinkRequestAbort: () => void;
}

interface ReferenceProviderLeaseReservationIdentity {
  readonly reservationKind: 'preview' | 'fullUnit';
  readonly reservationId: string;
  readonly idempotencyKey: string;
  readonly unitId?: string;
  readonly attemptId?: string;
}

interface ReferenceProviderPreparingLeaseIdentity {
  readonly preparingKind: 'preview' | 'fullUnit';
  readonly referenceId: string;
  readonly baseRunRevision: number;
  readonly idempotencyKey: string;
}

interface ReferencePreviewProviderLeaseOwner {
  readonly pid: number;
  readonly instanceId: string;
  readonly startedAt: string;
  readonly reservationKind?: 'preparing' | 'preview' | 'fullUnit';
  readonly preparingKind?: 'preview' | 'fullUnit';
  readonly referenceId?: string;
  readonly baseRunRevision?: number;
  readonly reservationId?: string;
  readonly idempotencyKey?: string;
  readonly unitId?: string;
  readonly attemptId?: string;
}

interface ReferencePreviewProviderLease {
  readonly owner: ReferencePreviewProviderLeaseOwner;
  release(): Promise<void>;
}

type ReferencePreviewReservation =
  | {
      readonly kind: 'immediate';
      readonly result: ReferenceDeconstructionMutationTransportResult;
    }
  | PreparedReferencePreview
  | PreparedReferenceFullUnit;

type ReferenceFullProviderGenerationResult =
  ReferenceFullDeconstructionGenerationResult<ReferenceFullDeconstructionOutput>;

const ACTIVE_REFERENCE_DECONSTRUCTION_STATUSES: readonly ReferenceDeconstructionRunStatus[] = [
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
const REFERENCE_PREVIEW_PROVIDER_LEASE_FILE = 'provider-lease.json';
const REFERENCE_PREVIEW_PROVIDER_PREPARING_LEASE_FILE =
  'provider-lease.preparing.json';
const REFERENCE_PREVIEW_PROVIDER_LEASE_MAX_ATTEMPTS = 5;
const REFERENCE_PUBLISH_PENDING_ACTION_GRACE_MS = 30_000;
const LOCALLY_LIVE_REFERENCE_PREVIEW_PROVIDER_LEASES = new Set<string>();

export class ReferenceDeconstructionRequestError extends Error {
  readonly code:
    | 'invalidRequest'
    | 'rangeConfirmationRequired'
    | 'providerNotConfigured'
    | 'advanceSuperseded';

  constructor(
    message: string,
    code:
      | 'invalidRequest'
      | 'rangeConfirmationRequired'
      | 'providerNotConfigured'
      | 'advanceSuperseded',
  ) {
    super(message);
    this.name = 'ReferenceDeconstructionRequestError';
    this.code = code;
  }
}

export function createReferenceDeconstructionBackendController(
  options: CreateReferenceDeconstructionBackendControllerOptions,
): ReferenceDeconstructionBackendController {
  const instanceId = randomUUID();
  const activeExecutions = new Map<string, ActiveReferenceExecution>();
  const activePreparations = new Map<string, ActiveReferencePreparation>();
  const locks = new Map<string, Promise<void>>();
  const runQuickPreview = options.runQuickPreview ?? generateReferenceQuickPreview;
  const runChapterAnalysis =
    options.runChapterAnalysis ?? generateReferenceChapterAnalysis;
  const runAggregateAnalysis =
    options.runAggregateAnalysis ?? generateReferenceAggregateAnalysis;
  const runStyleProfile = options.runStyleProfile ?? generateReferenceStyleProfile;
  const runDistillation = options.runDistillation ?? generateReferenceDistillation;

  async function withReferenceLock<T>(
    workspaceRoot: string,
    referenceId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${workspaceRoot}\u0000${referenceId}`;
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const tail = previous.then(() => current);
    locks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(key) === tail) locks.delete(key);
    }
  }

  function activeKey(workspaceRoot: string, runId: string): string {
    return `${workspaceRoot}\u0000${runId}`;
  }

  async function createRun(
    referenceId: string,
    input: CreateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    if (input.mode !== 'quickPreview' || input.baseRunRevision !== 0) {
      throw new ReferenceDeconstructionRequestError(
        'Reference deconstruction runs must begin in quickPreview mode at revision 0.',
        'invalidRequest',
      );
    }

    return withReferenceLock(workspaceRoot, referenceId, async () => {
      const source = await readReferencePreviewSource(workspaceRoot, referenceId);
      const structureConfidence = source.sourceManifest.detectedStructure.confidence;
      const rangeConfirmed = input.selectedChapterIds !== undefined
        || input.confirmDetectedRange === true;
      if (structureConfidence === 'low' && !rangeConfirmed) {
        throw new ReferenceDeconstructionRequestError(
          'Chapter boundary confidence is low; confirm the detected preview range before analysis.',
          'rangeConfirmationRequired',
        );
      }
      let selection;
      try {
        selection = createReferenceQuickPreviewSelection({
          referenceId,
          sourceText: source.sourceText,
          sourceChecksumSha256: source.sourceManifest.checksumSha256,
          structureFingerprint: source.sourceManifest.structureFingerprint,
          chapters: source.sourceManifest.detectedStructure.chapters,
        }, input.selectedChapterIds
          ? { selectedChapterIds: [...input.selectedChapterIds] }
          : undefined);
      } catch (error) {
        throw new ReferenceDeconstructionValidationError(
          error instanceof Error
            ? error.message
            : 'Reference quick preview selection is invalid.',
        );
      }
      const result = await createReferenceDeconstructionRun({
        workspaceRoot,
        referenceId,
        sourceChecksumSha256: selection.sourceChecksumSha256,
        structureFingerprint: selection.structureFingerprint,
        structureConfidence,
        rangeConfirmed,
        selection,
        idempotencyKey: input.idempotencyKey,
        baseRunRevision: input.baseRunRevision,
      });
      return projectMutationResult(result);
    });
  }

  async function readRun(
    referenceId: string,
    runId: string,
  ): Promise<{ run: ReferenceDeconstructionRunTransport }> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () => {
      const current = await readReferenceDeconstructionRun(
        workspaceRoot,
        referenceId,
        runId,
        { reconcile: false },
      );
      const run = await reconcileRunForRead(workspaceRoot, current);
      return { run: projectRun(run) };
    });
  }

  async function readActiveRun(
    referenceId: string,
  ): Promise<{ run: ReferenceDeconstructionRunTransport | null }> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () => {
      const runs = await listReferenceDeconstructionRuns(workspaceRoot, referenceId);
      const candidates = runs.filter((run) =>
        ACTIVE_REFERENCE_DECONSTRUCTION_STATUSES.includes(run.status));
      if (candidates.length > 1) {
        throw new ReferenceDeconstructionValidationError(
          `Reference ${referenceId} has multiple active deconstruction runs.`,
        );
      }
      const candidate = candidates[0] ?? null;
      if (!candidate) return { run: null };
      const run = await reconcileRunForRead(workspaceRoot, candidate);
      return { run: projectRun(run) };
    });
  }

  async function reconcileRunForRead(
    workspaceRoot: string,
    run: ReferenceDeconstructionRun,
  ): Promise<ReferenceDeconstructionRun> {
    if (run.status === 'publishing') {
      const pendingActionId = run.publication?.pendingActionId;
      if (!pendingActionId) {
        throw new ReferenceDeconstructionValidationError(
          'Publishing reference run is missing its PendingAction identity.',
        );
      }
      let pendingActionStatus: 'pending' | 'accepted' | 'rejected';
      try {
        pendingActionStatus = (await readPendingAction({
          workspaceRoot,
          id: pendingActionId,
        })).status;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const reservedAt = Date.parse(run.updatedAt);
        if (
          Number.isFinite(reservedAt)
          && Date.now() - reservedAt < REFERENCE_PUBLISH_PENDING_ACTION_GRACE_MS
        ) {
          // Another backend may have committed the publishing reservation and
          // still be materializing the stable PendingAction record.
          return run;
        }
        // No approval record after the bounded preparation window means no
        // materialization can still occur. Returning to reviewReady is the
        // only fail-closed recovery.
        pendingActionStatus = 'rejected';
      }
      return reconcileReferenceDeconstructionPublish({
        workspaceRoot,
        referenceId: run.referenceId,
        runId: run.runId,
        pendingActionStatus,
      });
    }
    if (run.status === 'completed') return run;
    const hasProviderReservation =
      run.status === 'previewRunning'
      || run.status === 'fullRunning'
        && run.activeReservation?.kind === 'fullUnit';
    if (hasProviderReservation) {
      const identity = readProviderLeaseReservationIdentity(run);
      const local = activeExecutions.get(activeKey(workspaceRoot, run.runId));
      if (local && activeExecutionHasIdentity(local, identity)) return run;
      const providerLeaseState = await inspectLiveProviderLease(
        workspaceRoot,
        run.runId,
        identity,
      );
      if (
        providerLeaseState === 'matching'
        || providerLeaseState === 'ambiguous'
      ) return run;
      if (
        providerLeaseState === 'absent'
        && await hasLiveProviderPreparingLease(workspaceRoot, run)
      ) return run;
      return readReferenceDeconstructionRun(
        workspaceRoot,
        run.referenceId,
        run.runId,
        { reconcile: true },
      );
    }
    if (run.status === 'fullRunning') {
      // Core reconciliation preserves request-driven idle Full runs while
      // still detecting source drift.
      return readReferenceDeconstructionRun(
        workspaceRoot,
        run.referenceId,
        run.runId,
        { reconcile: true },
      );
    }
    return readReferenceDeconstructionRun(
      workspaceRoot,
      run.referenceId,
      run.runId,
      { reconcile: true },
    );
  }

  async function advanceRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
    requestSignal?: AbortSignal,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    const key = activeKey(workspaceRoot, runId);
    const preparation: ActiveReferencePreparation = {
      id: randomUUID(),
      workspaceRoot,
      referenceId,
      runId,
    };
    activePreparations.set(preparation.id, preparation);
    let reservation: ReferencePreviewReservation;
    try {
      reservation = await withReferenceLock(
        workspaceRoot,
        referenceId,
        async () => {
          const current = await readReferenceDeconstructionRun(
            workspaceRoot,
            referenceId,
            runId,
            { reconcile: false },
          );
          const fullPhase = Boolean(current.full);
          // Validate the lease containment before Core mutates the reservation.
          await Promise.all([
            resolveReferencePreviewProviderLeasePath(workspaceRoot, runId),
            resolveReferencePreviewProviderLeasePath(
              workspaceRoot,
              runId,
              REFERENCE_PREVIEW_PROVIDER_PREPARING_LEASE_FILE,
            ),
          ]);

          // A replay never owns provider work. Let Core validate the original
          // request fingerprint without competing with its live preparing lease.
          if (current.mutationReceipts.some((receipt) =>
            receipt.idempotencyKey === input.idempotencyKey)) {
            const replayed = fullPhase
              ? await reserveReferenceFullDeconstructionUnit({
                  workspaceRoot,
                  referenceId,
                  runId,
                  baseRunRevision: input.baseRunRevision,
                  idempotencyKey: input.idempotencyKey,
                })
              : await reserveReferenceQuickPreview({
                  workspaceRoot,
                  referenceId,
                  runId,
                  baseRunRevision: input.baseRunRevision,
                  idempotencyKey: input.idempotencyKey,
                });
            return {
              kind: 'immediate',
              result: projectMutationResult(replayed),
            } as const;
          }

          const preparingLease = await acquireReferenceProviderPreparingLease(
            workspaceRoot,
            runId,
            instanceId,
            {
              preparingKind: fullPhase ? 'fullUnit' : 'preview',
              referenceId,
              baseRunRevision: input.baseRunRevision,
              idempotencyKey: input.idempotencyKey,
            },
          );
          let preparingLeaseReleased = false;
          const releasePreparingLease = async (): Promise<void> => {
            if (preparingLeaseReleased) return;
            preparingLeaseReleased = true;
            await preparingLease.release();
          };

          try {
          if (!fullPhase) {
            const reserved = await reserveReferenceQuickPreview({
              workspaceRoot,
              referenceId,
              runId,
              baseRunRevision: input.baseRunRevision,
              idempotencyKey: input.idempotencyKey,
            });

            if (reserved.replayed || reserved.run.status !== 'previewRunning') {
              return {
                kind: 'immediate',
                result: projectMutationResult(reserved),
              } as const;
            }

            const activeReservation = readActiveReservation(
              reserved.run,
              'preview',
            );
            const providerLease = await acquireReferencePreviewProviderLease(
              workspaceRoot,
              runId,
              instanceId,
              {
                reservationKind: 'preview',
                reservationId: activeReservation.id,
                idempotencyKey: input.idempotencyKey,
              },
            ).catch(async (error: unknown) => {
              await interruptReferenceQuickPreview({
                workspaceRoot,
                referenceId,
                runId,
                baseRunRevision: reserved.run.revision,
                reservationId: activeReservation.id,
              });
              throw error;
            });
            let request: ReferenceDeconstructionRunRequest;
            try {
              request = await readReferenceDeconstructionRunRequest(
                workspaceRoot,
                referenceId,
                runId,
              );
            } catch {
              try {
                const reconciled = await reserveReferenceQuickPreview({
                  workspaceRoot,
                  referenceId,
                  runId,
                  baseRunRevision: input.baseRunRevision,
                  idempotencyKey: input.idempotencyKey,
                });
                if (reconciled.run.status === 'stale') {
                  return {
                    kind: 'immediate',
                    result: mutationResultForCommand(
                      reconciled.run,
                      input.idempotencyKey,
                      false,
                    ),
                  } as const;
                }
                const failed = await failReferenceQuickPreview({
                  workspaceRoot,
                  referenceId,
                  runId,
                  baseRunRevision: reserved.run.revision,
                  reservationId: activeReservation.id,
                  errorCode: 'request_invalid',
                  errorMessage: 'Reference Quick Preview request artifact is invalid.',
                });
                return {
                  kind: 'immediate',
                  result: mutationResultForCommand(
                    failed,
                    input.idempotencyKey,
                    false,
                  ),
                } as const;
              } finally {
                await providerLease.release();
              }
            }

            try {
              await releasePreparingLease();
            } catch (error) {
              try {
                await providerLease.release();
              } finally {
                await interruptReferenceQuickPreview({
                  workspaceRoot,
                  referenceId,
                  runId,
                  baseRunRevision: reserved.run.revision,
                  reservationId: activeReservation.id,
                });
              }
              throw error;
            }
            const abortController = new AbortController();
            const active: ActiveReferenceExecution = {
              workspaceRoot,
              referenceId,
              runId,
              reservationKind: 'preview',
              reservationId: activeReservation.id,
              idempotencyKey: input.idempotencyKey,
              abortController,
            };
            activeExecutions.set(key, active);
            const unlinkRequestAbort = linkAbortSignal(requestSignal, abortController);

            return {
              kind: 'preview',
              active,
              providerLease,
              request,
              reserved,
              unlinkRequestAbort,
            } as const;
          }

          const reserved = await reserveReferenceFullDeconstructionUnit({
            workspaceRoot,
            referenceId,
            runId,
            baseRunRevision: input.baseRunRevision,
            idempotencyKey: input.idempotencyKey,
          });
          if (reserved.replayed || !reserved.reservation || !reserved.execution) {
            return {
              kind: 'immediate',
              result: projectMutationResult(reserved),
            } as const;
          }

          const fullReservation = reserved.reservation;
          const providerLease = await acquireReferencePreviewProviderLease(
            workspaceRoot,
            runId,
            instanceId,
            {
              reservationKind: 'fullUnit',
              reservationId: fullReservation.id,
              idempotencyKey: input.idempotencyKey,
              unitId: fullReservation.unitId,
              attemptId: fullReservation.attemptId,
            },
          ).catch(async (error: unknown) => {
            await interruptReferenceFullDeconstructionUnit({
              workspaceRoot,
              referenceId,
              runId,
              baseRunRevision: reserved.run.revision,
              reservationId: fullReservation.id,
            });
            throw error;
          });
          try {
            await releasePreparingLease();
          } catch (error) {
            try {
              await providerLease.release();
            } finally {
              await interruptReferenceFullDeconstructionUnit({
                workspaceRoot,
                referenceId,
                runId,
                baseRunRevision: reserved.run.revision,
                reservationId: fullReservation.id,
              });
            }
            throw error;
          }
          const abortController = new AbortController();
          const active: ActiveReferenceExecution = {
            workspaceRoot,
            referenceId,
            runId,
            reservationKind: 'fullUnit',
            reservationId: fullReservation.id,
            idempotencyKey: input.idempotencyKey,
            unitId: fullReservation.unitId,
            attemptId: fullReservation.attemptId,
            abortController,
          };
          activeExecutions.set(key, active);
          const unlinkRequestAbort = linkAbortSignal(requestSignal, abortController);
          return {
            kind: 'fullUnit',
            active,
            providerLease,
            reservation: fullReservation,
            execution: reserved.execution,
            reserved,
            unlinkRequestAbort,
          } as const;
          } finally {
            await releasePreparingLease();
          }
        },
      );
    } finally {
      activePreparations.delete(preparation.id);
    }

    if (reservation.kind === 'immediate') return reservation.result;

    try {
      if (reservation.kind === 'preview') {
        const generation = await runReferenceQuickPreviewProvider(
          options,
          runQuickPreview,
          reservation,
        );

        return await withReferenceLock(workspaceRoot, referenceId, async () => {
          const current = await readReferenceDeconstructionRun(
            workspaceRoot,
            referenceId,
            runId,
            { reconcile: false },
          );
          assertActiveExecutionMatches(current, reservation.active);

          let settled: ReferenceDeconstructionRun;
          if (generation.status === 'completed') {
            settled = await completeReferenceQuickPreview({
              workspaceRoot,
              referenceId,
              runId,
              baseRunRevision: reservation.reserved.run.revision,
              reservationId: reservation.active.reservationId,
              preview: generation.preview,
            });
          } else if (generation.status === 'failed') {
            settled = await failReferenceQuickPreview({
              workspaceRoot,
              referenceId,
              runId,
              baseRunRevision: reservation.reserved.run.revision,
              reservationId: reservation.active.reservationId,
              errorCode: generation.error.code,
              errorMessage: generation.error.code === 'invalid_output'
                ? 'Reference Quick Preview output did not pass strict validation.'
                : 'Reference Quick Preview provider request failed.',
            });
          } else {
            settled = await interruptReferenceQuickPreview({
              workspaceRoot,
              referenceId,
              runId,
              baseRunRevision: reservation.reserved.run.revision,
              reservationId: reservation.active.reservationId,
            });
          }

          return mutationResultForCommand(settled, input.idempotencyKey, false);
        });
      }

      const generation = await runReferenceFullUnitProvider(
        options,
        {
          runChapterAnalysis,
          runAggregateAnalysis,
          runStyleProfile,
          runDistillation,
        },
        reservation,
      );
      return await withReferenceLock(workspaceRoot, referenceId, async () => {
        const current = await readReferenceDeconstructionRun(
          workspaceRoot,
          referenceId,
          runId,
          { reconcile: false },
        );
        assertActiveExecutionMatches(current, reservation.active);
        let settled: ReferenceDeconstructionRun;
        if (generation.status === 'completed') {
          settled = await completeReferenceFullDeconstructionUnit({
            workspaceRoot,
            referenceId,
            runId,
            baseRunRevision: reservation.reserved.run.revision,
            reservationId: reservation.reservation.id,
            output: generation.output,
          });
        } else if (generation.status === 'failed') {
          settled = await failReferenceFullDeconstructionUnit({
            workspaceRoot,
            referenceId,
            runId,
            baseRunRevision: reservation.reserved.run.revision,
            reservationId: reservation.reservation.id,
            errorCode: generation.error.code,
            errorMessage: generation.error.code === 'invalid_output'
              ? 'Reference full-deconstruction output did not pass strict validation.'
              : 'Reference full-deconstruction provider request failed.',
          });
        } else {
          settled = await interruptReferenceFullDeconstructionUnit({
            workspaceRoot,
            referenceId,
            runId,
            baseRunRevision: reservation.reserved.run.revision,
            reservationId: reservation.reservation.id,
          });
        }
        return mutationResultForCommand(settled, input.idempotencyKey, false);
      });
    } finally {
      reservation.unlinkRequestAbort();
      activeExecutions.delete(key);
      await reservation.providerLease.release();
    }
  }

  async function approveFull(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () => projectMutationResult(
      await approveReferenceFullDeconstruction({
        workspaceRoot,
        referenceId,
        runId,
        baseRunRevision: input.baseRunRevision,
        idempotencyKey: input.idempotencyKey,
      }),
    ));
  }

  async function pauseRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () =>
      projectMutationResult(await pauseReferenceDeconstructionRun({
        workspaceRoot,
        referenceId,
        runId,
        baseRunRevision: input.baseRunRevision,
        idempotencyKey: input.idempotencyKey,
      })));
  }

  async function resumeRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () =>
      projectMutationResult(await resumeReferenceDeconstructionRun({
        workspaceRoot,
        referenceId,
        runId,
        baseRunRevision: input.baseRunRevision,
        idempotencyKey: input.idempotencyKey,
      })));
  }

  async function retryUnit(
    referenceId: string,
    runId: string,
    input: RetryReferenceDeconstructionUnitCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () =>
      projectMutationResult(await retryReferenceDeconstructionUnit({
        workspaceRoot,
        referenceId,
        runId,
        baseRunRevision: input.baseRunRevision,
        idempotencyKey: input.idempotencyKey,
        unitId: input.unitId,
      })));
  }

  async function cancelRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () => {
      const result = await cancelReferenceDeconstructionRun({
        workspaceRoot,
        referenceId,
        runId,
        baseRunRevision: input.baseRunRevision,
        idempotencyKey: input.idempotencyKey,
      });
      activeExecutions.get(activeKey(workspaceRoot, runId))?.abortController.abort(
        'Reference deconstruction cancelled by the user.',
      );
      return projectMutationResult(result);
    });
  }

  async function projectReferencePublishResult(
    workspaceRoot: string,
    mutation: ReferenceDeconstructionMutationResult,
    pendingAction: StoredWriteIntentAction,
  ): Promise<ReferenceDeconstructionPublishTransportResult> {
    if (pendingAction.status === 'rejected') {
      await reconcileReferenceDeconstructionPublish({
        workspaceRoot,
        referenceId: mutation.run.referenceId,
        runId: mutation.run.runId,
        pendingActionStatus: 'rejected',
      });
      throw new ReferenceDeconstructionConflictError(
        'Reference publish PendingAction was rejected; use a new idempotency key.',
      );
    }
    const run = pendingAction.status === 'accepted'
      ? await reconcileReferenceDeconstructionPublish({
          workspaceRoot,
          referenceId: mutation.run.referenceId,
          runId: mutation.run.runId,
          pendingActionStatus: 'accepted',
        })
      : mutation.run;
    return {
      run: projectRun(run),
      receipt: { ...mutation.receipt },
      replayed: mutation.replayed,
      pendingAction: projectReferencePublishPendingAction(pendingAction),
    };
  }

  async function publishRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionPublishTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, referenceId, async () => {
      const stablePendingActionId = referencePublishPendingActionId(
        referenceId,
        runId,
        input.idempotencyKey,
      );
      try {
        const terminalReplay = await readPendingAction({
          workspaceRoot,
          id: stablePendingActionId,
        });
        if (terminalReplay.status === 'rejected') {
          if (
            !isReferencePublishPendingActionOrigin(terminalReplay.origin)
            || terminalReplay.origin.referenceId !== referenceId
            || terminalReplay.origin.runId !== runId
          ) {
            throw new ReferenceDeconstructionValidationError(
              `PendingAction ${terminalReplay.id} is not owned by this reference run.`,
            );
          }
          throw new ReferenceDeconstructionConflictError(
            'Reference publish PendingAction was rejected; use a new idempotency key.',
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const current = await readReferenceDeconstructionRun(
        workspaceRoot,
        referenceId,
        runId,
        { reconcile: false },
      );
      const priorReceipt = current.mutationReceipts.find((receipt) =>
        receipt.idempotencyKey === input.idempotencyKey);
      if (priorReceipt) {
        const publication = current.publication;
        if (!publication?.pendingActionId) {
          throw new ReferenceDeconstructionConflictError(
            'Reference publish command was already rejected; use a new idempotency key.',
          );
        }
        let storedAction: StoredWriteIntentAction | undefined;
        try {
          storedAction = await readPendingAction({
            workspaceRoot,
            id: publication.pendingActionId,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (storedAction && storedAction.status !== 'pending') {
          if (!isReferencePublishPendingActionOrigin(storedAction.origin)) {
            throw new ReferenceDeconstructionValidationError(
              `PendingAction ${storedAction.id} is not a reference publication.`,
            );
          }
          assertStoredReferencePublishActionOwnership(
            storedAction,
            storedAction.origin,
            current,
            { allowCompleted: true },
          );
          return projectReferencePublishResult(
            workspaceRoot,
            {
              run: current,
              receipt: priorReceipt,
              replayed: true,
            },
            storedAction,
          );
        }
        const replayed = await beginReferenceDeconstructionPublish({
          workspaceRoot,
          referenceId,
          runId,
          baseRunRevision: input.baseRunRevision,
          idempotencyKey: input.idempotencyKey,
          candidateFingerprint: publication.candidateFingerprint,
          pendingActionId: publication.pendingActionId,
        });
        const candidate = await prepareReferenceDeconstructionPublicationCandidate({
          workspaceRoot,
          referenceId,
          runId,
        });
        if (candidate.candidateFingerprint !== publication.candidateFingerprint) {
          throw new ReferenceDeconstructionValidationError(
            'Stored reference publication candidate fingerprint changed.',
          );
        }
        const { action: pendingAction } = await createOrReadReferencePublishPendingAction({
          workspaceRoot,
          referenceId,
          runId,
          runRevision: input.baseRunRevision,
          pendingActionId: publication.pendingActionId,
          candidate,
        });
        assertStoredReferencePublishAction(pendingAction, pendingAction.origin as
          ReferenceDeconstructionPublishPendingActionOrigin, replayed.run, candidate);
        return projectReferencePublishResult(workspaceRoot, replayed, pendingAction);
      }

      const candidate = await prepareReferenceDeconstructionPublicationCandidate({
        workspaceRoot,
        referenceId,
        runId,
      });
      if (candidate.runRevision !== input.baseRunRevision) {
        throw new ReferenceDeconstructionConflictError(
          `Reference run revision conflict: expected ${input.baseRunRevision}, current ${candidate.runRevision}.`,
        );
      }
      const patches = referencePublicationPatches(referenceId, candidate.files);
      const pendingActionId = stablePendingActionId;
      let begun: ReferenceDeconstructionMutationResult | undefined;
      let createdPendingAction = false;
      try {
        begun = await beginReferenceDeconstructionPublish({
          workspaceRoot,
          referenceId,
          runId,
          baseRunRevision: input.baseRunRevision,
          idempotencyKey: input.idempotencyKey,
          candidateFingerprint: candidate.candidateFingerprint,
          pendingActionId,
        });
        const pending = await createOrReadReferencePublishPendingAction({
          workspaceRoot,
          referenceId,
          runId,
          runRevision: candidate.runRevision,
          pendingActionId,
          candidate,
          patches,
        });
        const pendingAction = pending.action;
        createdPendingAction = pending.created;
        assertStoredReferencePublishAction(
          pendingAction,
          pendingAction.origin as ReferenceDeconstructionPublishPendingActionOrigin,
          begun.run,
          candidate,
        );
        return projectReferencePublishResult(workspaceRoot, begun, pendingAction);
      } catch (error) {
        if (begun) {
          let canReleaseReservation = !createdPendingAction;
          if (createdPendingAction) {
            await rejectPendingAction({
              workspaceRoot,
              id: pendingActionId,
            }).then(
              () => {
                canReleaseReservation = true;
              },
              () => undefined,
            );
          }
          if (canReleaseReservation) {
            await rejectReferenceDeconstructionPublish({
              workspaceRoot,
              referenceId,
              runId,
              baseRunRevision: begun.run.revision,
              idempotencyKey: `abort-${pendingActionId}`,
              pendingActionId,
            }).catch(() => undefined);
          }
        }
        throw error;
      }
    });
  }

  async function assertPublishPendingActionCurrent(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
  ): Promise<void> {
    const workspaceRoot = options.getWorkspaceRoot();
    await withReferenceLock(workspaceRoot, origin.referenceId, async () => {
      const current = await assertReferenceDeconstructionPublishCurrent({
        workspaceRoot,
        referenceId: origin.referenceId,
        runId: origin.runId,
        candidateFingerprint: origin.candidateFingerprint,
        pendingActionId,
      });
      const action = await readPendingAction({ workspaceRoot, id: pendingActionId });
      const candidate = await prepareReferenceDeconstructionPublicationCandidate({
        workspaceRoot,
        referenceId: origin.referenceId,
        runId: origin.runId,
      });
      assertStoredReferencePublishAction(action, origin, current, candidate);
      if (action.status !== 'pending') {
        throw new ReferenceDeconstructionConflictError(
          `Reference publish PendingAction ${pendingActionId} is already ${action.status}.`,
        );
      }
    });
  }

  async function completePublishPendingAction(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, origin.referenceId, async () => {
      const current = await assertReferenceDeconstructionPublishCurrent({
        workspaceRoot,
        referenceId: origin.referenceId,
        runId: origin.runId,
        candidateFingerprint: origin.candidateFingerprint,
        pendingActionId,
      });
      assertStoredReferencePublishAction(
        await readPendingAction({ workspaceRoot, id: pendingActionId }),
        origin,
        current,
        await prepareReferenceDeconstructionPublicationCandidate({
          workspaceRoot,
          referenceId: origin.referenceId,
          runId: origin.runId,
        }),
      );
      return projectMutationResult(await completeReferenceDeconstructionPublish({
        workspaceRoot,
        referenceId: origin.referenceId,
        runId: origin.runId,
        baseRunRevision: current.revision,
        idempotencyKey: `accept-${pendingActionId}`,
        candidateFingerprint: origin.candidateFingerprint,
        pendingActionId,
      }));
    });
  }

  async function decidePublishPendingAction(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
    decision: 'accept' | 'reject',
    autoCommitOnAccept: boolean,
  ): Promise<{
    action: AcceptedPendingAction | RejectedPendingAction;
    referencePublish: ReferenceDeconstructionMutationTransportResult;
  }> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, origin.referenceId, async () => {
      if (decision === 'accept') {
        const current = await assertReferenceDeconstructionPublishCurrent({
          workspaceRoot,
          referenceId: origin.referenceId,
          runId: origin.runId,
          candidateFingerprint: origin.candidateFingerprint,
          pendingActionId,
        }).catch((error) => {
          if (error instanceof ReferenceDeconstructionValidationError) {
            throw new ReferenceDeconstructionConflictError(error.message);
          }
          throw error;
        });
        const candidate = await prepareReferenceDeconstructionPublicationCandidate({
          workspaceRoot,
          referenceId: origin.referenceId,
          runId: origin.runId,
        });
        const stored = await readPendingAction({
          workspaceRoot,
          id: pendingActionId,
        });
        assertStoredReferencePublishAction(stored, origin, current, candidate);
        if (stored.status !== 'pending') {
          throw new ReferenceDeconstructionConflictError(
            `Reference publish PendingAction ${pendingActionId} is already ${stored.status}.`,
          );
        }
        const action = await acceptPendingAction({
          workspaceRoot,
          id: pendingActionId,
          autoCommitOnAccept,
        }).catch((error) => {
          throw new ReferenceDeconstructionConflictError(
            error instanceof Error ? error.message : String(error),
          );
        });
        const referencePublish = projectMutationResult(
          await completeReferenceDeconstructionPublish({
            workspaceRoot,
            referenceId: origin.referenceId,
            runId: origin.runId,
            baseRunRevision: current.revision,
            idempotencyKey: `accept-${pendingActionId}`,
            candidateFingerprint: origin.candidateFingerprint,
            pendingActionId,
          }),
        );
        return { action, referencePublish };
      }

      const current = await readReferenceDeconstructionRun(
        workspaceRoot,
        origin.referenceId,
        origin.runId,
        { reconcile: false },
      );
      const stored = await readPendingAction({
        workspaceRoot,
        id: pendingActionId,
      });
      assertStoredReferencePublishActionOwnership(stored, origin, current);
      if (stored.status !== 'pending') {
        throw new ReferenceDeconstructionConflictError(
          `Reference publish PendingAction ${pendingActionId} is already ${stored.status}.`,
        );
      }
      const action = await rejectPendingAction({
        workspaceRoot,
        id: pendingActionId,
      });
      const referencePublish = projectMutationResult(
        await rejectReferenceDeconstructionPublish({
          workspaceRoot,
          referenceId: origin.referenceId,
          runId: origin.runId,
          baseRunRevision: current.revision,
          idempotencyKey: `reject-${pendingActionId}`,
          pendingActionId,
        }),
      );
      return { action, referencePublish };
    });
  }

  async function rejectPublishPendingAction(
    pendingActionId: string,
    origin: ReferenceDeconstructionPublishPendingActionOrigin,
  ): Promise<ReferenceDeconstructionMutationTransportResult> {
    const workspaceRoot = options.getWorkspaceRoot();
    return withReferenceLock(workspaceRoot, origin.referenceId, async () => {
      const current = await readReferenceDeconstructionRun(
        workspaceRoot,
        origin.referenceId,
        origin.runId,
        { reconcile: false },
      );
      assertStoredReferencePublishActionOwnership(
        await readPendingAction({ workspaceRoot, id: pendingActionId }),
        origin,
        current,
      );
      return projectMutationResult(await rejectReferenceDeconstructionPublish({
        workspaceRoot,
        referenceId: origin.referenceId,
        runId: origin.runId,
        baseRunRevision: current.revision,
        idempotencyKey: `reject-${pendingActionId}`,
        pendingActionId,
      }));
    });
  }

  function hasActiveExecution(workspaceRoot?: string): boolean {
    return [...activeExecutions.values(), ...activePreparations.values()]
      .some((active) =>
        workspaceRoot === undefined || active.workspaceRoot === workspaceRoot,
      );
  }

  return {
    createRun,
    readRun,
    readActiveRun,
    advanceRun,
    approveFull,
    pauseRun,
    resumeRun,
    retryUnit,
    cancelRun,
    publishRun,
    assertPublishPendingActionCurrent,
    decidePublishPendingAction,
    completePublishPendingAction,
    rejectPublishPendingAction,
    hasActiveExecution,
  };
}

function referencePublicationPatches(
  referenceId: string,
  files: readonly ReferenceDeconstructionPublicationCandidateFile[],
): ReferenceArtifactPatch[] {
  const bundlePrefix = `examples/references/${referenceId}/`;
  const patches = files.map((file): ReferenceArtifactPatch => {
    const patchFile = file.path === 'examples/references.yaml'
      ? 'references.yaml'
      : file.path.startsWith(bundlePrefix)
        ? file.path.slice(bundlePrefix.length)
        : '';
    if (!patchFile) {
      throw new ReferenceDeconstructionValidationError(
        `Reference publication candidate escaped its bundle: ${file.path}.`,
      );
    }
    return {
      kind: 'referenceArtifact',
      referenceId,
      file: patchFile,
      operation: 'replaceFile',
      value: file.content,
    };
  });
  if (new Set(patches.map((patch) => patch.file)).size !== patches.length) {
    throw new ReferenceDeconstructionValidationError(
      'Reference publication candidate contains duplicate target files.',
    );
  }
  return patches.sort((left, right) => {
    const leftManifest = left.file === 'deconstruction-manifest.yaml';
    const rightManifest = right.file === 'deconstruction-manifest.yaml';
    return Number(leftManifest) - Number(rightManifest);
  });
}

async function createOrReadReferencePublishPendingAction(input: {
  workspaceRoot: string;
  referenceId: string;
  runId: string;
  runRevision: number;
  pendingActionId: string;
  candidate: ReferenceDeconstructionPublicationCandidate;
  patches?: ReferenceArtifactPatch[];
}): Promise<{ action: StoredWriteIntentAction; created: boolean }> {
  const origin: ReferenceDeconstructionPublishPendingActionOrigin = {
    kind: 'referenceDeconstructionPublish',
    referenceId: input.referenceId,
    runId: input.runId,
    runRevision: input.runRevision,
    candidateFingerprint: input.candidate.candidateFingerprint,
  };
  try {
    return {
      action: await createPendingAction(input.workspaceRoot, {
      id: input.pendingActionId,
      title: `Publish reference ${input.referenceId}`,
      description:
        `Publish reviewed deconstruction run ${input.runId} as one atomic reference bundle update.`,
      patches: input.patches
        ?? referencePublicationPatches(input.referenceId, input.candidate.files),
      origin,
      }),
      created: true,
    };
  } catch (createError) {
    try {
      return {
        action: await readPendingAction({
          workspaceRoot: input.workspaceRoot,
          id: input.pendingActionId,
        }),
        created: false,
      };
    } catch {
      throw createError;
    }
  }
}

function referencePublishPendingActionId(
  referenceId: string,
  runId: string,
  idempotencyKey: string,
): string {
  return `pa_${createHash('sha256')
    .update(`${referenceId}\u0000${runId}\u0000${idempotencyKey}`, 'utf-8')
    .digest('hex')}`;
}

function projectReferencePublishPendingAction(
  action: StoredWriteIntentAction,
): ReferenceDeconstructionPublishPendingActionReceipt {
  const origin = action.origin;
  if (!isReferencePublishPendingActionOrigin(origin)) {
    throw new ReferenceDeconstructionValidationError(
      `PendingAction ${action.id} is not a reference publication.`,
    );
  }
  return {
    id: action.id,
    title: action.title,
    description: action.description,
    touchedFiles: [...action.touchedFiles],
    diff: action.diff,
    createdAt: action.createdAt,
    status: action.status,
    ...(action.acceptedAt ? { acceptedAt: action.acceptedAt } : {}),
    ...(action.rejectedAt ? { rejectedAt: action.rejectedAt } : {}),
    origin: structuredClone(origin),
  };
}

function assertStoredReferencePublishAction(
  action: StoredWriteIntentAction,
  origin: ReferenceDeconstructionPublishPendingActionOrigin,
  run: ReferenceDeconstructionRun,
  candidate: ReferenceDeconstructionPublicationCandidate,
): void {
  const expectedPatches = referencePublicationPatches(
    run.referenceId,
    candidate.files,
  );
  const expectedTouchedFiles = expectedPatches.map((patch) =>
    patch.file === 'references.yaml'
      ? 'examples/references.yaml'
      : `examples/references/${run.referenceId}/${patch.file}`);
  if (
    action.id !== run.publication?.pendingActionId
    || !isReferencePublishPendingActionOrigin(action.origin)
    || JSON.stringify(action.origin) !== JSON.stringify(origin)
    || action.origin.referenceId !== run.referenceId
    || action.origin.runId !== run.runId
    || action.origin.candidateFingerprint !==
      run.publication.candidateFingerprint
    || candidate.candidateFingerprint !== run.publication.candidateFingerprint
    || action.origin.runRevision !== candidate.runRevision
    || action.origin.runRevision + 1 !== run.revision
    || JSON.stringify(action.patches) !== JSON.stringify(expectedPatches)
    || JSON.stringify(action.touchedFiles) !== JSON.stringify(expectedTouchedFiles)
    || action.shadowWrites.length !== expectedPatches.length
    || action.shadowWrites.some((write, index) =>
      write.targetFile !== expectedTouchedFiles[index]
      || write.draftHash !== sha256Text(expectedPatches[index]!.value))
  ) {
    throw new ReferenceDeconstructionValidationError(
      `Reference publish PendingAction ${action.id} no longer matches its run.`,
    );
  }
}

function assertStoredReferencePublishActionOwnership(
  action: StoredWriteIntentAction,
  origin: ReferenceDeconstructionPublishPendingActionOrigin,
  run: ReferenceDeconstructionRun,
  options: {
    allowCompleted?: boolean;
  } = {},
): void {
  if (
    action.id !== run.publication?.pendingActionId
    || (
      run.status !== 'publishing'
      && !(options.allowCompleted === true && run.status === 'completed')
    )
    || !isReferencePublishPendingActionOrigin(action.origin)
    || JSON.stringify(action.origin) !== JSON.stringify(origin)
    || origin.referenceId !== run.referenceId
    || origin.runId !== run.runId
    || origin.candidateFingerprint !== run.publication.candidateFingerprint
    || origin.runRevision + (run.status === 'completed' ? 2 : 1) !== run.revision
    || action.patches.some((patch) =>
      patch.kind !== 'referenceArtifact'
      || patch.referenceId !== run.referenceId)
  ) {
    throw new ReferenceDeconstructionValidationError(
      `Reference publish PendingAction ${action.id} is not owned by its run.`,
    );
  }
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

function isReferencePublishPendingActionOrigin(
  value: unknown,
): value is ReferenceDeconstructionPublishPendingActionOrigin {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const origin = value as Record<string, unknown>;
  return Object.keys(origin).length === 5
    && origin.kind === 'referenceDeconstructionPublish'
    && typeof origin.referenceId === 'string'
    && typeof origin.runId === 'string'
    && Number.isSafeInteger(origin.runRevision)
    && (origin.runRevision as number) >= 0
    && typeof origin.candidateFingerprint === 'string'
    && /^[a-f0-9]{64}$/u.test(origin.candidateFingerprint);
}

export function toReferenceDeconstructionErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  const message = error instanceof Error ? error.message : 'Reference deconstruction request failed.';
  if (error instanceof ReferenceDeconstructionNotFoundError) {
    return { status: 404, body: { error: message, code: error.code } };
  }
  if (error instanceof ReferenceDeconstructionConflictError) {
    return { status: 409, body: { error: message, code: error.code } };
  }
  if (error instanceof ReferenceDeconstructionValidationError) {
    return { status: 422, body: { error: message, code: error.code } };
  }
  if (error instanceof ReferenceDeconstructionRequestError) {
    return {
      status: error.code === 'invalidRequest'
        ? 400
        : error.code === 'rangeConfirmationRequired'
          ? 422
          : 409,
      body: { error: message, code: error.code },
    };
  }
  return {
    status: 500,
    body: {
      error: 'Reference deconstruction request failed.',
      code: 'internalError',
    },
  };
}

async function runReferenceQuickPreviewProvider(
  options: CreateReferenceDeconstructionBackendControllerOptions,
  runQuickPreview: NonNullable<
    CreateReferenceDeconstructionBackendControllerOptions['runQuickPreview']
  >,
  reservation: PreparedReferencePreview,
): Promise<ReferenceQuickPreviewGenerationResult> {
  try {
    assertReferenceWorkspaceUnchanged(options, reservation.active.workspaceRoot);
    const runtime = await options.getModelRuntime();
    assertReferenceWorkspaceUnchanged(options, reservation.active.workspaceRoot);
    return await runQuickPreview({
      runId: reservation.active.runId,
      providerConfig: runtime.providerConfig,
      resolveModel: runtime.resolveModel,
      selection: reservation.request.selection,
      abortSignal: reservation.active.abortController.signal,
    });
  } catch {
    return reservation.active.abortController.signal.aborted
      ? {
          status: 'aborted',
          reason: 'Reference quick preview request was interrupted.',
        }
      : {
          status: 'failed',
          error: {
            code: 'provider_error',
            message: 'Reference Quick Preview provider request failed.',
            retryable: true,
          },
        };
  }
}

async function runReferenceFullUnitProvider(
  options: CreateReferenceDeconstructionBackendControllerOptions,
  runners: {
    runChapterAnalysis: NonNullable<
      CreateReferenceDeconstructionBackendControllerOptions['runChapterAnalysis']
    >;
    runAggregateAnalysis: NonNullable<
      CreateReferenceDeconstructionBackendControllerOptions['runAggregateAnalysis']
    >;
    runStyleProfile: NonNullable<
      CreateReferenceDeconstructionBackendControllerOptions['runStyleProfile']
    >;
    runDistillation: NonNullable<
      CreateReferenceDeconstructionBackendControllerOptions['runDistillation']
    >;
  },
  prepared: PreparedReferenceFullUnit,
): Promise<ReferenceFullProviderGenerationResult> {
  try {
    assertReferenceWorkspaceUnchanged(options, prepared.active.workspaceRoot);
    const { execution } = prepared;
    if (execution.unit.kind === 'analysisQuality') {
      const output = await evaluateReservedReferenceFullDeconstructionQuality(
        prepared.active.workspaceRoot,
        prepared.active.referenceId,
        prepared.active.runId,
        prepared.active.reservationId,
      );
      return {
        status: 'completed',
        output,
        finishReason: 'stop',
      };
    }

    const runtime = await options.getModelRuntime();
    assertReferenceWorkspaceUnchanged(options, prepared.active.workspaceRoot);
    const shared = {
      runId: prepared.active.runId,
      providerConfig: runtime.providerConfig,
      resolveModel: runtime.resolveModel,
      unit: execution.unit,
      abortSignal: prepared.active.abortController.signal,
    };
    if (execution.unit.kind === 'chapterChunk') {
      if (!execution.sourceWindows?.length) {
        throw new ReferenceDeconstructionValidationError(
          'Reference chapter execution is missing its bounded source window.',
        );
      }
      return runners.runChapterAnalysis({
        ...shared,
        sourceWindows: execution.sourceWindows,
        ...(execution.rollingContext
          ? { rollingContext: execution.rollingContext }
          : {}),
      });
    }
    const reductionInput = {
      ...shared,
      verifiedSourceFindings: execution.verifiedSourceFindings ?? [],
      coveredUnitIds: execution.coveredUnitIds ?? [],
      coveredChapterIds: execution.coveredChapterIds ?? [],
    };
    if (execution.unit.kind === 'aggregate') {
      return runners.runAggregateAnalysis(reductionInput);
    }
    if (execution.unit.kind === 'style') {
      return runners.runStyleProfile(reductionInput);
    }
    if (execution.unit.kind === 'distill') {
      return runners.runDistillation(reductionInput);
    }
    throw new ReferenceDeconstructionValidationError(
      `Unsupported reference work unit kind: ${execution.unit.kind}.`,
    );
  } catch {
    return prepared.active.abortController.signal.aborted
      ? {
          status: 'aborted',
          reason: 'Reference full-deconstruction request was interrupted.',
        }
      : {
          status: 'failed',
          error: {
            code: 'provider_error',
            message: 'Reference full-deconstruction provider request failed.',
            retryable: true,
          },
        };
  }
}

function assertReferenceWorkspaceUnchanged(
  options: CreateReferenceDeconstructionBackendControllerOptions,
  expectedWorkspaceRoot: string,
): void {
  if (options.getWorkspaceRoot() !== expectedWorkspaceRoot) {
    throw new ReferenceDeconstructionRequestError(
      'The active workspace changed before reference analysis could start.',
      'advanceSuperseded',
    );
  }
}

interface ReferencePreviewProviderLeaseObservation {
  readonly path: string;
  readonly raw: string;
  readonly owner?: ReferencePreviewProviderLeaseOwner;
}

async function acquireReferencePreviewProviderLease(
  workspaceRoot: string,
  runId: string,
  instanceId: string,
  identity: ReferenceProviderLeaseReservationIdentity,
): Promise<ReferencePreviewProviderLease> {
  const owner: ReferencePreviewProviderLeaseOwner = {
    pid: process.pid,
    instanceId,
    startedAt: new Date().toISOString(),
    reservationKind: identity.reservationKind,
    reservationId: identity.reservationId,
    idempotencyKey: identity.idempotencyKey,
    ...(identity.unitId ? { unitId: identity.unitId } : {}),
    ...(identity.attemptId ? { attemptId: identity.attemptId } : {}),
  };
  return acquireReferenceProviderLease(
    workspaceRoot,
    runId,
    instanceId,
    owner,
    REFERENCE_PREVIEW_PROVIDER_LEASE_FILE,
  );
}

async function acquireReferenceProviderPreparingLease(
  workspaceRoot: string,
  runId: string,
  instanceId: string,
  identity: ReferenceProviderPreparingLeaseIdentity,
): Promise<ReferencePreviewProviderLease> {
  const owner: ReferencePreviewProviderLeaseOwner = {
    pid: process.pid,
    instanceId,
    startedAt: new Date().toISOString(),
    reservationKind: 'preparing',
    preparingKind: identity.preparingKind,
    referenceId: identity.referenceId,
    baseRunRevision: identity.baseRunRevision,
    idempotencyKey: identity.idempotencyKey,
  };
  return acquireReferenceProviderLease(
    workspaceRoot,
    runId,
    instanceId,
    owner,
    REFERENCE_PREVIEW_PROVIDER_PREPARING_LEASE_FILE,
  );
}

async function acquireReferenceProviderLease(
  workspaceRoot: string,
  runId: string,
  instanceId: string,
  owner: ReferencePreviewProviderLeaseOwner,
  leaseFile: string,
): Promise<ReferencePreviewProviderLease> {
  const serializedOwner = `${JSON.stringify(owner)}\n`;

  for (
    let attempt = 0;
    attempt < REFERENCE_PREVIEW_PROVIDER_LEASE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const observation = await readReferencePreviewProviderLease(
      workspaceRoot,
      runId,
      leaseFile,
    );
    if (observation) {
      if (
        observation.owner
        && isReferencePreviewProviderLeaseOwnerLive(observation)
      ) {
        throw new ReferenceDeconstructionRequestError(
          'Reference deconstruction is already running in another backend instance.',
          'advanceSuperseded',
        );
      }
      await removeObservedReferencePreviewProviderLease(
        workspaceRoot,
        runId,
        observation,
        leaseFile,
      );
      continue;
    }

    const path = await resolveReferencePreviewProviderLeasePath(
      workspaceRoot,
      runId,
      leaseFile,
    );
    const temporary = `${path}.${instanceId}.${randomUUID()}.tmp`;
    try {
      await assertReferencePreviewLeaseTarget(temporary, true);
      await writeFile(temporary, serializedOwner, {
        encoding: 'utf-8',
        flag: 'wx',
      });
      await assertReferencePreviewLeaseParentUnchanged(
        workspaceRoot,
        runId,
        path,
        leaseFile,
      );
      await assertReferencePreviewLeaseTarget(temporary, false);
      await assertReferencePreviewLeaseTarget(path, true);
      await link(temporary, path);
      await assertReferencePreviewLeaseTarget(path, false);
      const localLeaseKey = createLocalReferencePreviewProviderLeaseKey(path, owner);
      LOCALLY_LIVE_REFERENCE_PREVIEW_PROVIDER_LEASES.add(localLeaseKey);
      return {
        owner,
        release: async () => {
          try {
            await releaseReferencePreviewProviderLease(
              workspaceRoot,
              runId,
              serializedOwner,
              leaseFile,
            );
          } finally {
            LOCALLY_LIVE_REFERENCE_PREVIEW_PROVIDER_LEASES.delete(localLeaseKey);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      await assertReferencePreviewLeaseParentUnchanged(
        workspaceRoot,
        runId,
        path,
        leaseFile,
      );
      await unlinkReferencePreviewLeaseTarget(temporary);
    }
  }

  throw new ReferenceDeconstructionRequestError(
    'Reference deconstruction provider lease did not stabilize.',
    'advanceSuperseded',
  );
}

type ReferenceProviderLeaseInspection =
  | 'absent'
  | 'matching'
  | 'mismatch'
  | 'ambiguous';

async function inspectLiveProviderLease(
  workspaceRoot: string,
  runId: string,
  expectedIdentity?: ReferenceProviderLeaseReservationIdentity,
): Promise<ReferenceProviderLeaseInspection> {
  return inspectLiveReferenceProviderLease(
    workspaceRoot,
    runId,
    REFERENCE_PREVIEW_PROVIDER_LEASE_FILE,
    (owner) => providerLeaseOwnerHasIdentity(owner, expectedIdentity),
  );
}

async function hasLiveProviderPreparingLease(
  workspaceRoot: string,
  run: ReferenceDeconstructionRun,
): Promise<boolean> {
  const reservation = run.activeReservation;
  if (!reservation) return false;
  const receipt = run.mutationReceipts.find((candidate) =>
    candidate.idempotencyKey === reservation.idempotencyKey);
  const expectedStatus = reservation.kind === 'preview'
    ? 'previewRunning'
    : 'fullRunning';
  if (
    !receipt
    || receipt.resultingRunRevision !== run.revision
    || receipt.resultStatus !== expectedStatus
  ) return false;
  const inspection = await inspectLiveReferenceProviderLease(
    workspaceRoot,
    run.runId,
    REFERENCE_PREVIEW_PROVIDER_PREPARING_LEASE_FILE,
    (owner) =>
      owner.reservationKind === 'preparing'
      && owner.preparingKind === reservation.kind
      && owner.referenceId === run.referenceId
      && owner.idempotencyKey === reservation.idempotencyKey
      && owner.baseRunRevision === run.revision - 1,
  );
  return inspection === 'matching' || inspection === 'ambiguous';
}

async function inspectLiveReferenceProviderLease(
  workspaceRoot: string,
  runId: string,
  leaseFile: string,
  ownerMatches: (owner: ReferencePreviewProviderLeaseOwner) => boolean,
): Promise<ReferenceProviderLeaseInspection> {
  for (
    let attempt = 0;
    attempt < REFERENCE_PREVIEW_PROVIDER_LEASE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const observation = await readReferencePreviewProviderLease(
      workspaceRoot,
      runId,
      leaseFile,
    );
    if (!observation) return 'absent';
    if (
      observation.owner
      && isReferencePreviewProviderLeaseOwnerLive(observation)
    ) {
      return ownerMatches(observation.owner) ? 'matching' : 'mismatch';
    }
    if (await removeObservedReferencePreviewProviderLease(
      workspaceRoot,
      runId,
      observation,
      leaseFile,
    )) {
      return 'absent';
    }
  }

  // Ambiguous lease ownership must not turn a live provider run into interrupted.
  return 'ambiguous';
}

function isReferencePreviewProviderLeaseOwnerLive(
  observation: ReferencePreviewProviderLeaseObservation,
): boolean {
  const owner = observation.owner;
  if (!owner) return false;
  if (owner.pid !== process.pid) return isProcessAlive(owner.pid);
  return LOCALLY_LIVE_REFERENCE_PREVIEW_PROVIDER_LEASES.has(
    createLocalReferencePreviewProviderLeaseKey(observation.path, owner),
  );
}

function providerLeaseOwnerHasIdentity(
  owner: ReferencePreviewProviderLeaseOwner,
  expected: ReferenceProviderLeaseReservationIdentity | undefined,
): boolean {
  if (!expected) return true;
  if (owner.reservationKind === 'preparing') return false;
  if (!owner.reservationKind || !owner.reservationId || !owner.idempotencyKey) {
    // Keep D1 Preview leases readable while the provider-lease format evolves.
    return expected.reservationKind === 'preview';
  }
  return owner.reservationKind === expected.reservationKind
    && owner.reservationId === expected.reservationId
    && owner.idempotencyKey === expected.idempotencyKey
    && owner.unitId === expected.unitId
    && owner.attemptId === expected.attemptId;
}

function createLocalReferencePreviewProviderLeaseKey(
  path: string,
  owner: ReferencePreviewProviderLeaseOwner,
): string {
  return [
    path,
    owner.pid,
    owner.instanceId,
    owner.startedAt,
    owner.reservationKind ?? '',
    owner.preparingKind ?? '',
    owner.referenceId ?? '',
    owner.baseRunRevision ?? '',
    owner.reservationId ?? '',
    owner.idempotencyKey ?? '',
    owner.unitId ?? '',
    owner.attemptId ?? '',
  ].join('\u0000');
}

async function readReferencePreviewProviderLease(
  workspaceRoot: string,
  runId: string,
  leaseFile = REFERENCE_PREVIEW_PROVIDER_LEASE_FILE,
): Promise<ReferencePreviewProviderLeaseObservation | undefined> {
  const path = await resolveReferencePreviewProviderLeasePath(
    workspaceRoot,
    runId,
    leaseFile,
  );
  try {
    await assertReferencePreviewLeaseTarget(path, true);
    const raw = await readFile(path, 'utf-8');
    return {
      path,
      raw,
      owner: parseReferencePreviewProviderLeaseOwner(raw),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function removeObservedReferencePreviewProviderLease(
  workspaceRoot: string,
  runId: string,
  observation: ReferencePreviewProviderLeaseObservation,
  leaseFile = REFERENCE_PREVIEW_PROVIDER_LEASE_FILE,
): Promise<boolean> {
  const path = await resolveReferencePreviewProviderLeasePath(
    workspaceRoot,
    runId,
    leaseFile,
  );
  if (path !== observation.path) {
    throw new ReferenceDeconstructionValidationError(
      'Reference preview provider lease path changed unexpectedly.',
    );
  }
  await assertReferencePreviewLeaseTarget(path, true);
  const identity = createHash('sha256').update(observation.raw).digest('hex').slice(0, 24);
  const quarantine = `${path}.stale-${identity}`;
  await assertReferencePreviewLeaseTarget(quarantine, true);
  let claimed = false;
  try {
    await assertReferencePreviewLeaseParentUnchanged(
      workspaceRoot,
      runId,
      path,
      leaseFile,
    );
    await link(path, quarantine);
    claimed = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    if (code === 'EEXIST') {
      let sameFile = false;
      try {
        const [currentStat, quarantineStat] = await Promise.all([
          assertReferencePreviewLeaseTarget(path, false),
          assertReferencePreviewLeaseTarget(quarantine, false),
        ]);
        sameFile = Boolean(
          currentStat
          && quarantineStat
          && currentStat.dev === quarantineStat.dev
          && currentStat.ino === quarantineStat.ino,
        );
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      }
      if (!sameFile) {
        await assertReferencePreviewLeaseParentUnchanged(
          workspaceRoot,
          runId,
          path,
          leaseFile,
        );
        await unlinkReferencePreviewLeaseTarget(quarantine);
        return false;
      }
      // Adopt a cleanup claim left between link() and unlink() by a crashed owner.
      claimed = true;
    } else {
      throw error;
    }
  }

  try {
    await assertReferencePreviewLeaseParentUnchanged(
      workspaceRoot,
      runId,
      path,
      leaseFile,
    );
    const [current, currentStat, quarantineStat] = await Promise.all([
      readFile(path, 'utf-8'),
      assertReferencePreviewLeaseTarget(path, false),
      assertReferencePreviewLeaseTarget(quarantine, false),
    ]);
    if (
      current !== observation.raw
      || !currentStat
      || !quarantineStat
      || currentStat.dev !== quarantineStat.dev
      || currentStat.ino !== quarantineStat.ino
    ) {
      return false;
    }
    await assertReferencePreviewLeaseParentUnchanged(
      workspaceRoot,
      runId,
      path,
      leaseFile,
    );
    const verified = await assertReferencePreviewLeaseTarget(path, false);
    if (
      !verified
      || verified.dev !== currentStat.dev
      || verified.ino !== currentStat.ino
    ) {
      return false;
    }
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        await assertReferencePreviewLeaseTarget(path, false);
        return false;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') return true;
        throw statError;
      }
    }
    throw error;
  } finally {
    if (claimed) {
      await assertReferencePreviewLeaseParentUnchanged(
        workspaceRoot,
        runId,
        path,
        leaseFile,
      );
      await unlinkReferencePreviewLeaseTarget(quarantine);
    }
  }
}

async function resolveReferencePreviewProviderLeasePath(
  workspaceRoot: string,
  runId: string,
  leaseFile = REFERENCE_PREVIEW_PROVIDER_LEASE_FILE,
): Promise<string> {
  if (
    leaseFile !== REFERENCE_PREVIEW_PROVIDER_LEASE_FILE
    && leaseFile !== REFERENCE_PREVIEW_PROVIDER_PREPARING_LEASE_FILE
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference provider lease file is invalid.',
    );
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)
    || runId.includes('..')
  ) {
    throw new ReferenceDeconstructionValidationError('runId is invalid.');
  }
  const workspacePath = resolve(workspaceRoot);
  let workspaceRealpath: string;
  try {
    workspaceRealpath = await realpath(workspacePath);
  } catch {
    throw new ReferenceDeconstructionValidationError(
      'Reference preview provider lease workspace is unavailable.',
    );
  }

  let parent = workspacePath;
  for (const segment of [
    '.workspace',
    'sessions',
    runId,
    'reference-deconstruction',
  ]) {
    parent = resolve(parent, segment);
    let info: Awaited<ReturnType<typeof lstat>>;
    let actual: string;
    try {
      info = await lstat(parent);
      actual = await realpath(parent);
    } catch {
      throw new ReferenceDeconstructionValidationError(
        'Reference preview provider lease directory is unavailable.',
      );
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new ReferenceDeconstructionValidationError(
        'Reference preview provider lease directory must not be a symlink.',
      );
    }
    assertReferencePreviewLeaseContained(workspaceRealpath, actual);
  }

  return resolve(parent, leaseFile);
}

async function assertReferencePreviewLeaseParentUnchanged(
  workspaceRoot: string,
  runId: string,
  expectedPath: string,
  leaseFile = REFERENCE_PREVIEW_PROVIDER_LEASE_FILE,
): Promise<void> {
  const currentPath = await resolveReferencePreviewProviderLeasePath(
    workspaceRoot,
    runId,
    leaseFile,
  );
  if (currentPath !== expectedPath) {
    throw new ReferenceDeconstructionValidationError(
      'Reference preview provider lease path changed unexpectedly.',
    );
  }
}

async function assertReferencePreviewLeaseTarget(
  path: string,
  allowMissing: boolean,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new ReferenceDeconstructionValidationError(
        'Reference preview provider lease target must be a regular file.',
      );
    }
    return info;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function unlinkReferencePreviewLeaseTarget(path: string): Promise<void> {
  const info = await assertReferencePreviewLeaseTarget(path, true);
  if (!info) return;
  await unlink(path);
}

async function releaseReferencePreviewProviderLease(
  workspaceRoot: string,
  runId: string,
  serializedOwner: string,
  leaseFile = REFERENCE_PREVIEW_PROVIDER_LEASE_FILE,
): Promise<void> {
  const path = await resolveReferencePreviewProviderLeasePath(
    workspaceRoot,
    runId,
    leaseFile,
  );
  const initial = await assertReferencePreviewLeaseTarget(path, true);
  if (!initial) return;
  const current = await readFile(path, 'utf-8');
  if (current !== serializedOwner) return;
  await assertReferencePreviewLeaseParentUnchanged(
    workspaceRoot,
    runId,
    path,
    leaseFile,
  );
  const verified = await assertReferencePreviewLeaseTarget(path, false);
  if (
    !verified
    || verified.dev !== initial.dev
    || verified.ino !== initial.ino
  ) {
    return;
  }
  await unlink(path);
}

function assertReferencePreviewLeaseContained(root: string, path: string): void {
  const candidate = relative(root, path);
  if (
    candidate === ''
    || candidate === '..'
    || candidate.startsWith(`..${sep}`)
    || isAbsolute(candidate)
  ) {
    throw new ReferenceDeconstructionValidationError(
      'Reference preview provider lease directory escapes its workspace.',
    );
  }
}

function parseReferencePreviewProviderLeaseOwner(
  raw: string,
): ReferencePreviewProviderLeaseOwner | undefined {
  try {
    const value = JSON.parse(raw) as Partial<ReferencePreviewProviderLeaseOwner>;
    const keys = Object.keys(value);
    const allowedKeys = [
      'pid',
      'instanceId',
      'startedAt',
      'reservationKind',
      'preparingKind',
      'referenceId',
      'baseRunRevision',
      'reservationId',
      'idempotencyKey',
      'unitId',
      'attemptId',
    ];
    if (
      typeof value !== 'object'
      || value === null
      || Array.isArray(value)
      || keys.some((key) => !allowedKeys.includes(key))
      || !Number.isSafeInteger(value.pid)
      || (value.pid as number) <= 0
      || typeof value.instanceId !== 'string'
      || value.instanceId.length === 0
      || typeof value.startedAt !== 'string'
      || !Number.isFinite(Date.parse(value.startedAt))
    ) {
      return undefined;
    }
    if (value.reservationKind === undefined) {
      return keys.length === 3
        ? value as ReferencePreviewProviderLeaseOwner
        : undefined;
    }
    if (value.reservationKind === 'preparing') {
      if (
        keys.length !== 8
        || !['preview', 'fullUnit'].includes(value.preparingKind ?? '')
        || !isReferenceLeaseIdentifier(value.referenceId)
        || !Number.isSafeInteger(value.baseRunRevision)
        || (value.baseRunRevision as number) < 0
        || !isReferenceLeaseIdentifier(value.idempotencyKey)
        || value.reservationId !== undefined
        || value.unitId !== undefined
        || value.attemptId !== undefined
      ) return undefined;
      return value as ReferencePreviewProviderLeaseOwner;
    }
    if (
      !['preview', 'fullUnit'].includes(value.reservationKind)
      || !isReferenceLeaseIdentifier(value.reservationId)
      || !isReferenceLeaseIdentifier(value.idempotencyKey)
      || value.preparingKind !== undefined
      || value.referenceId !== undefined
      || value.baseRunRevision !== undefined
      || (value.reservationKind === 'preview' && (
        keys.length !== 6
        || value.unitId !== undefined
        || value.attemptId !== undefined
      ))
      || (value.reservationKind === 'fullUnit' && (
        keys.length !== 8
        || !isReferenceLeaseIdentifier(value.unitId)
        || !isReferenceLeaseIdentifier(value.attemptId)
      ))
    ) return undefined;
    return value as ReferencePreviewProviderLeaseOwner;
  } catch {
    return undefined;
  }
}

function isReferenceLeaseIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    && !value.includes('..');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function readActiveReservation(
  run: ReferenceDeconstructionRun,
  expectedKind: 'preview' | 'fullUnit',
): { id: string } {
  const value = run.activeReservation;
  if (
    !value
    || value.kind !== expectedKind
    || typeof value.id !== 'string'
    || !value.id.trim()
  ) {
    throw new ReferenceDeconstructionRequestError(
      'Reference deconstruction reservation is missing.',
      'advanceSuperseded',
    );
  }
  return { id: value.id };
}

function readProviderLeaseReservationIdentity(
  run: ReferenceDeconstructionRun,
): ReferenceProviderLeaseReservationIdentity {
  const reservation = run.activeReservation;
  if (!reservation) {
    throw new ReferenceDeconstructionRequestError(
      'Reference deconstruction reservation is missing.',
      'advanceSuperseded',
    );
  }
  return {
    reservationKind: reservation.kind,
    reservationId: reservation.id,
    idempotencyKey: reservation.idempotencyKey,
    ...(reservation.kind === 'fullUnit'
      ? {
          unitId: reservation.unitId,
          attemptId: reservation.attemptId,
        }
      : {}),
  };
}

function activeExecutionHasIdentity(
  active: ActiveReferenceExecution,
  expected: ReferenceProviderLeaseReservationIdentity,
): boolean {
  return active.reservationKind === expected.reservationKind
    && active.reservationId === expected.reservationId
    && active.idempotencyKey === expected.idempotencyKey
    && active.unitId === expected.unitId
    && active.attemptId === expected.attemptId;
}

function assertActiveExecutionMatches(
  run: ReferenceDeconstructionRun,
  active: ActiveReferenceExecution,
): void {
  const reservation = run.activeReservation;
  const expectedStatus = active.reservationKind === 'preview'
    ? 'previewRunning'
    : 'fullRunning';
  if (
    run.status !== expectedStatus
    || reservation?.kind !== active.reservationKind
    || reservation.id !== active.reservationId
    || active.reservationKind === 'fullUnit'
      && (
        reservation.kind !== 'fullUnit'
        || reservation.unitId !== active.unitId
        || reservation.attemptId !== active.attemptId
      )
  ) {
    throw new ReferenceDeconstructionRequestError(
      `Reference deconstruction advance was superseded by status ${run.status}.`,
      'advanceSuperseded',
    );
  }
}

function mutationResultForCommand(
  run: ReferenceDeconstructionRun,
  idempotencyKey: string,
  replayed: boolean,
): ReferenceDeconstructionMutationTransportResult {
  const receipt = [...run.mutationReceipts]
    .reverse()
    .find((item) => item.idempotencyKey === idempotencyKey);
  if (!receipt) {
    throw new ReferenceDeconstructionRequestError(
      'Reference deconstruction mutation receipt is missing.',
      'advanceSuperseded',
    );
  }
  return projectMutationResult({ run, receipt, replayed });
}

function projectMutationResult(
  result: ReferenceDeconstructionMutationResult,
): ReferenceDeconstructionMutationTransportResult {
  return {
    run: projectRun(result.run),
    receipt: { ...result.receipt },
    replayed: result.replayed,
  };
}

function projectRun(run: ReferenceDeconstructionRun): ReferenceDeconstructionRunTransport {
  return projectReferenceDeconstructionRunForTransport(run);
}

function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => undefined;
  const abort = (): void => target.abort(source.reason);
  if (source.aborted) {
    abort();
    return () => undefined;
  }
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

export type { ReferenceDeconstructionRunStatus };
