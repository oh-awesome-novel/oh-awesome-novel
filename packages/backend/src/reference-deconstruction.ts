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
  cancelReferenceDeconstructionRun,
  completeReferenceQuickPreview,
  createReferenceQuickPreviewSelection,
  createReferenceDeconstructionRun,
  failReferenceQuickPreview,
  interruptReferenceQuickPreview,
  listReferenceDeconstructionRuns,
  projectReferenceDeconstructionRunForTransport,
  readReferenceDeconstructionRun,
  readReferenceDeconstructionRunRequest,
  readReferencePreviewSource,
  reserveReferenceQuickPreview,
} from '@oh-awesome-novel/core';
import type {
  LlmProviderConfig,
  ReferenceDeconstructionMutationReceipt,
  ReferenceDeconstructionMutationResult,
  ReferenceDeconstructionRun,
  ReferenceDeconstructionRunRequest,
  ReferenceDeconstructionRunStatus,
  ReferenceDeconstructionRunTransport,
} from '@oh-awesome-novel/core';
import {
  generateReferenceQuickPreview,
} from '@oh-awesome-novel/agent';
import type {
  GenerateReferenceQuickPreviewInput,
  ReferenceDeconstructionModelResolver,
  ReferenceQuickPreviewGenerationResult,
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

export interface ReferenceDeconstructionMutationTransportResult {
  readonly run: ReferenceDeconstructionRunTransport;
  readonly receipt: ReferenceDeconstructionMutationReceipt;
  readonly replayed: boolean;
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
  cancelRun(
    referenceId: string,
    runId: string,
    input: MutateReferenceDeconstructionRunCommand,
  ): Promise<ReferenceDeconstructionMutationTransportResult>;
  hasActivePreview(workspaceRoot?: string): boolean;
}

interface ActiveReferencePreview {
  readonly workspaceRoot: string;
  readonly referenceId: string;
  readonly runId: string;
  readonly reservationId: string;
  readonly idempotencyKey: string;
  readonly abortController: AbortController;
}

interface PreparedReferencePreview {
  readonly kind: 'prepared';
  readonly active: ActiveReferencePreview;
  readonly providerLease: ReferencePreviewProviderLease;
  readonly request: ReferenceDeconstructionRunRequest;
  readonly reserved: ReferenceDeconstructionMutationResult;
  readonly unlinkRequestAbort: () => void;
}

interface ReferencePreviewProviderLeaseOwner {
  readonly pid: number;
  readonly instanceId: string;
  readonly startedAt: string;
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
  | PreparedReferencePreview;

const ACTIVE_REFERENCE_PREVIEW_STATUSES: readonly ReferenceDeconstructionRunStatus[] = [
  'created',
  'previewRunning',
  'awaitingFullApproval',
  'fullApproved',
  'interrupted',
];
const REFERENCE_PREVIEW_PROVIDER_LEASE_FILE = 'provider-lease.json';
const REFERENCE_PREVIEW_PROVIDER_LEASE_MAX_ATTEMPTS = 5;
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
  const activePreviews = new Map<string, ActiveReferencePreview>();
  const locks = new Map<string, Promise<void>>();
  const runQuickPreview = options.runQuickPreview ?? generateReferenceQuickPreview;

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
      const run = await shouldReconcileRun(workspaceRoot, current)
        ? await readReferenceDeconstructionRun(
            workspaceRoot,
            referenceId,
            runId,
            { reconcile: true },
          )
        : current;
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
        ACTIVE_REFERENCE_PREVIEW_STATUSES.includes(run.status));
      if (candidates.length > 1) {
        throw new ReferenceDeconstructionValidationError(
          `Reference ${referenceId} has multiple active deconstruction runs.`,
        );
      }
      const candidate = candidates[0] ?? null;
      if (!candidate) return { run: null };
      const run = await shouldReconcileRun(workspaceRoot, candidate)
        ? await readReferenceDeconstructionRun(
            workspaceRoot,
            referenceId,
            candidate.runId,
            { reconcile: true },
          )
        : candidate;
      return { run: projectRun(run) };
    });
  }

  async function shouldReconcileRun(
    workspaceRoot: string,
    run: ReferenceDeconstructionRun,
  ): Promise<boolean> {
    if (run.status !== 'previewRunning') return true;
    if (activePreviews.has(activeKey(workspaceRoot, run.runId))) return false;
    return !await hasLiveProviderLease(
      workspaceRoot,
      run.runId,
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
    const reservation: ReferencePreviewReservation = await withReferenceLock(
      workspaceRoot,
      referenceId,
      async () => {
        if (activePreviews.has(key)) {
          return {
            kind: 'immediate',
            result: projectMutationResult(await reserveReferenceQuickPreview({
              workspaceRoot,
              referenceId,
              runId,
              baseRunRevision: input.baseRunRevision,
              idempotencyKey: input.idempotencyKey,
            })),
          } as const;
        }

        const providerLease = await acquireReferencePreviewProviderLease(
          workspaceRoot,
          runId,
          instanceId,
        );
        let keepProviderLease = false;
        try {
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

          const activeReservation = readActiveReservation(reserved.run);
          let request: ReferenceDeconstructionRunRequest;
          try {
            request = await readReferenceDeconstructionRunRequest(
              workspaceRoot,
              referenceId,
              runId,
            );
          } catch {
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
          }

          const abortController = new AbortController();
          const active: ActiveReferencePreview = {
            workspaceRoot,
            referenceId,
            runId,
            reservationId: activeReservation.id,
            idempotencyKey: input.idempotencyKey,
            abortController,
          };
          activePreviews.set(key, active);
          const unlinkRequestAbort = linkAbortSignal(requestSignal, abortController);
          keepProviderLease = true;

          return {
            kind: 'prepared',
            active,
            providerLease,
            request,
            reserved,
            unlinkRequestAbort,
          } as const;
        } finally {
          if (!keepProviderLease) await providerLease.release();
        }
      },
    );

    if (reservation.kind === 'immediate') return reservation.result;

    try {
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
        );
        if (current.status !== 'previewRunning') {
          throw new ReferenceDeconstructionRequestError(
            `Reference quick preview was superseded by status ${current.status}.`,
            'advanceSuperseded',
          );
        }

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
    } finally {
      reservation.unlinkRequestAbort();
      activePreviews.delete(key);
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
      activePreviews.get(activeKey(workspaceRoot, runId))?.abortController.abort(
        'Reference quick preview cancelled by the user.',
      );
      return projectMutationResult(result);
    });
  }

  function hasActivePreview(workspaceRoot?: string): boolean {
    return [...activePreviews.values()].some((active) =>
      workspaceRoot === undefined || active.workspaceRoot === workspaceRoot,
    );
  }

  return {
    createRun,
    readRun,
    readActiveRun,
    advanceRun,
    approveFull,
    cancelRun,
    hasActivePreview,
  };
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
    const runtime = await options.getModelRuntime();
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

interface ReferencePreviewProviderLeaseObservation {
  readonly path: string;
  readonly raw: string;
  readonly owner?: ReferencePreviewProviderLeaseOwner;
}

async function acquireReferencePreviewProviderLease(
  workspaceRoot: string,
  runId: string,
  instanceId: string,
): Promise<ReferencePreviewProviderLease> {
  const owner: ReferencePreviewProviderLeaseOwner = {
    pid: process.pid,
    instanceId,
    startedAt: new Date().toISOString(),
  };
  const serializedOwner = `${JSON.stringify(owner)}\n`;

  for (
    let attempt = 0;
    attempt < REFERENCE_PREVIEW_PROVIDER_LEASE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const observation = await readReferencePreviewProviderLease(workspaceRoot, runId);
    if (observation) {
      if (
        observation.owner
        && isReferencePreviewProviderLeaseOwnerLive(observation)
      ) {
        throw new ReferenceDeconstructionRequestError(
          'Reference quick preview is already running in another backend instance.',
          'advanceSuperseded',
        );
      }
      await removeObservedReferencePreviewProviderLease(
        workspaceRoot,
        runId,
        observation,
      );
      continue;
    }

    const path = await resolveReferencePreviewProviderLeasePath(workspaceRoot, runId);
    const temporary = `${path}.${instanceId}.${randomUUID()}.tmp`;
    try {
      await assertReferencePreviewLeaseTarget(temporary, true);
      await writeFile(temporary, serializedOwner, {
        encoding: 'utf-8',
        flag: 'wx',
      });
      await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
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
            );
          } finally {
            LOCALLY_LIVE_REFERENCE_PREVIEW_PROVIDER_LEASES.delete(localLeaseKey);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
      await unlinkReferencePreviewLeaseTarget(temporary);
    }
  }

  throw new ReferenceDeconstructionRequestError(
    'Reference quick preview provider lease did not stabilize.',
    'advanceSuperseded',
  );
}

async function hasLiveProviderLease(
  workspaceRoot: string,
  runId: string,
): Promise<boolean> {
  for (
    let attempt = 0;
    attempt < REFERENCE_PREVIEW_PROVIDER_LEASE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const observation = await readReferencePreviewProviderLease(workspaceRoot, runId);
    if (!observation) return false;
    if (
      observation.owner
      && isReferencePreviewProviderLeaseOwnerLive(observation)
    ) {
      return true;
    }
    if (await removeObservedReferencePreviewProviderLease(
      workspaceRoot,
      runId,
      observation,
    )) {
      return false;
    }
  }

  // Ambiguous lease ownership must not turn a live provider run into interrupted.
  return true;
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

function createLocalReferencePreviewProviderLeaseKey(
  path: string,
  owner: ReferencePreviewProviderLeaseOwner,
): string {
  return `${path}\u0000${owner.pid}\u0000${owner.instanceId}\u0000${owner.startedAt}`;
}

async function readReferencePreviewProviderLease(
  workspaceRoot: string,
  runId: string,
): Promise<ReferencePreviewProviderLeaseObservation | undefined> {
  const path = await resolveReferencePreviewProviderLeasePath(workspaceRoot, runId);
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
): Promise<boolean> {
  const path = await resolveReferencePreviewProviderLeasePath(workspaceRoot, runId);
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
    await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
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
        await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
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
    await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
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
    await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
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
      await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
      await unlinkReferencePreviewLeaseTarget(quarantine);
    }
  }
}

async function resolveReferencePreviewProviderLeasePath(
  workspaceRoot: string,
  runId: string,
): Promise<string> {
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

  return resolve(parent, REFERENCE_PREVIEW_PROVIDER_LEASE_FILE);
}

async function assertReferencePreviewLeaseParentUnchanged(
  workspaceRoot: string,
  runId: string,
  expectedPath: string,
): Promise<void> {
  const currentPath = await resolveReferencePreviewProviderLeasePath(
    workspaceRoot,
    runId,
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
): Promise<void> {
  const path = await resolveReferencePreviewProviderLeasePath(workspaceRoot, runId);
  const initial = await assertReferencePreviewLeaseTarget(path, true);
  if (!initial) return;
  const current = await readFile(path, 'utf-8');
  if (current !== serializedOwner) return;
  await assertReferencePreviewLeaseParentUnchanged(workspaceRoot, runId, path);
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
    if (
      typeof value !== 'object'
      || value === null
      || Array.isArray(value)
      || Object.keys(value).some((key) =>
        !['pid', 'instanceId', 'startedAt'].includes(key))
      || Object.keys(value).length !== 3
      || !Number.isSafeInteger(value.pid)
      || (value.pid as number) <= 0
      || typeof value.instanceId !== 'string'
      || value.instanceId.length === 0
      || typeof value.startedAt !== 'string'
      || !Number.isFinite(Date.parse(value.startedAt))
    ) {
      return undefined;
    }
    return value as ReferencePreviewProviderLeaseOwner;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function readActiveReservation(run: ReferenceDeconstructionRun): { id: string } {
  const value = (run as ReferenceDeconstructionRun & {
    activeReservation?: { id?: unknown };
  }).activeReservation;
  if (!value || typeof value.id !== 'string' || !value.id.trim()) {
    throw new ReferenceDeconstructionRequestError(
      'Reference quick preview reservation is missing.',
      'advanceSuperseded',
    );
  }
  return { id: value.id };
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
