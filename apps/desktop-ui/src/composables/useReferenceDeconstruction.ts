import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
} from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import type {
  MutateReferenceDeconstructionRunInput,
  ReferenceDeconstructionPublication,
  ReferenceDeconstructionPublishPendingAction,
  ReferenceDeconstructionRun,
  ReferenceWorkSummary,
  RetryReferenceDeconstructionRunInput,
} from './useWorkspaceApi';

type WorkspaceApi = ReturnType<typeof useWorkspaceApi>;

export type ReferenceDeconstructionPublicationView =
  ReferenceDeconstructionPublication;
export type ReferencePublishPendingActionView =
  ReferenceDeconstructionPublishPendingAction;

export type ReferenceDeconstructionClient = Pick<WorkspaceApi,
  | 'createReferenceDeconstructionRun'
  | 'getReferenceDeconstructionRun'
  | 'getActiveReferenceDeconstructionRun'
  | 'advanceReferenceDeconstructionRun'
  | 'pauseReferenceDeconstructionRun'
  | 'resumeReferenceDeconstructionRun'
  | 'retryReferenceDeconstructionRun'
  | 'cancelReferenceDeconstructionRun'
  | 'approveFullReferenceDeconstructionRun'
  | 'publishReferenceDeconstructionRun'
>;

export interface UseReferenceDeconstructionOptions {
  client?: ReferenceDeconstructionClient;
  createIdempotencyKey?: (operation: string) => string;
}

interface PendingCreate {
  referenceId: string;
  idempotencyKey: string;
  selectedChapterIds?: string[];
  confirmDetectedRange?: true;
}

interface PendingAdvance {
  referenceId: string;
  runId: string;
  input: MutateReferenceDeconstructionRunInput;
  phase: 'preview' | 'full';
}

interface PendingPublish {
  referenceId: string;
  runId: string;
  input: MutateReferenceDeconstructionRunInput;
}

interface PendingControlBase<
  Kind extends 'pause' | 'resume' | 'retry',
  Input extends MutateReferenceDeconstructionRunInput,
> {
  referenceId: string;
  runId: string;
  kind: Kind;
  input: Input;
}

type PendingPauseControl = PendingControlBase<'pause', MutateReferenceDeconstructionRunInput>;
type PendingResumeControl = PendingControlBase<'resume', MutateReferenceDeconstructionRunInput>;
type PendingRetryControl = PendingControlBase<'retry', RetryReferenceDeconstructionRunInput>;
type PendingControl = PendingPauseControl | PendingResumeControl | PendingRetryControl;

const ACTIVE_RUN_STATUSES: ReadonlySet<ReferenceDeconstructionRun['status']> = new Set([
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
]);

const CANCELLABLE_RUN_STATUSES: ReadonlySet<ReferenceDeconstructionRun['status']> = new Set([
  'created',
  'previewRunning',
  'awaitingFullApproval',
  'fullApproved',
  'fullRunning',
  'paused',
  'reviewReady',
  'failed',
  'interrupted',
]);

export function useReferenceDeconstruction(
  options: UseReferenceDeconstructionOptions = {},
) {
  const client = options.client ?? useWorkspaceApi();
  const selectedReference = shallowRef<ReferenceWorkSummary>();
  const currentRun = shallowRef<ReferenceDeconstructionRun>();
  const loadingActiveRun = shallowRef(false);
  const creating = shallowRef(false);
  const advancing = shallowRef(false);
  const cancelling = shallowRef(false);
  const approving = shallowRef(false);
  const pausing = shallowRef(false);
  const resuming = shallowRef(false);
  const retrying = shallowRef(false);
  const publishing = shallowRef(false);
  const reconciling = shallowRef(false);
  const indeterminate = shallowRef(false);
  const error = shallowRef('');
  const publishPendingAction = shallowRef<ReferencePublishPendingActionView>();
  const activeAdvanceConnection = shallowRef<{
    runId: string;
    controller: AbortController;
  }>();
  let selectionGeneration = 0;
  let operationSequence = 0;
  let disposed = false;
  let pendingCreate: PendingCreate | undefined;
  let pendingAdvance: PendingAdvance | undefined;
  let pendingPublish: PendingPublish | undefined;
  let pendingControl: PendingControl | undefined;

  const busy = computed(() =>
    loadingActiveRun.value || creating.value || advancing.value ||
    cancelling.value || approving.value || pausing.value || resuming.value ||
    retrying.value || publishing.value || reconciling.value || indeterminate.value,
  );
  const canStart = computed(() => Boolean(
    selectedReference.value &&
    !busy.value &&
    !ACTIVE_RUN_STATUSES.has(currentRun.value?.status ?? 'cancelled'),
  ));
  const canAdvance = computed(() => Boolean(
    (
      currentRun.value?.status === 'created' ||
      (
        currentRun.value?.status === 'interrupted' &&
        currentRun.value.full === undefined
      )
    ) &&
    !busy.value,
  ));
  const canAdvanceFull = computed(() => Boolean(
    currentRun.value?.full?.nextUnit &&
    (
      currentRun.value.status === 'fullApproved' ||
      currentRun.value.status === 'fullRunning'
    ) &&
    !busy.value,
  ));
  const canPause = computed(() => Boolean(
    currentRun.value?.full &&
    currentRun.value.status === 'fullRunning' &&
    !currentRun.value.full.currentUnit &&
    !busy.value,
  ));
  const canResume = computed(() => Boolean(
    currentRun.value?.full &&
    (
      currentRun.value.status === 'paused' ||
      currentRun.value.status === 'interrupted'
    ) &&
    !busy.value,
  ));
  const canRetry = computed(() => Boolean(
    currentRun.value?.status === 'failed' &&
    currentRun.value.full?.failedUnit &&
    !busy.value,
  ));
  const canCancel = computed(() => Boolean(
    currentRun.value &&
    (
      advancing.value ||
      CANCELLABLE_RUN_STATUSES.has(currentRun.value.status)
    ) &&
    !loadingActiveRun.value &&
    !creating.value &&
    !reconciling.value &&
    !cancelling.value &&
    !approving.value &&
    !pausing.value &&
    !resuming.value &&
    !retrying.value &&
    !publishing.value,
  ));
  const canApprove = computed(() => Boolean(
    currentRun.value?.status === 'awaitingFullApproval' &&
    !currentRun.value.diagnostics.some((diagnostic) => diagnostic.blocking) &&
    !busy.value,
  ));
  const publication = computed(() => readPublication(currentRun.value));
  const canPublish = computed(() => Boolean(
    currentRun.value?.status === 'reviewReady' &&
    (
      currentRun.value.full?.analysisQuality?.status === 'passed'
      || currentRun.value.full?.analysisQuality?.status === 'warned'
    ) &&
    !currentRun.value.diagnostics.some((diagnostic) => diagnostic.blocking) &&
    !busy.value,
  ));
  const needsReconcile = computed(() =>
    indeterminate.value || Boolean(
      currentRun.value &&
      !advancing.value &&
      (currentRun.value.status === 'previewRunning' ||
        (
          currentRun.value.status === 'interrupted' &&
          currentRun.value.full === undefined
        )),
    ),
  );
  const selectedReferenceView = computed(() => selectedReference.value);
  const currentRunView = computed(() => currentRun.value);

  async function selectReference(reference?: ReferenceWorkSummary): Promise<void> {
    if (disposed) return;
    const sameReference = reference?.id === selectedReference.value?.id;
    const hasPendingMutation = Boolean(
      pendingCreate || pendingAdvance || pendingPublish || pendingControl,
    );
    if (
      !sameReference &&
      (busy.value || hasPendingMutation)
    ) {
      error.value =
        'Wait for the current reference operation to finish or reconcile it before selecting another reference.';
      return;
    }

    selectedReference.value = reference;
    if (sameReference && (busy.value || hasPendingMutation)) return;
    error.value = '';
    indeterminate.value = false;
    if (!sameReference) {
      pendingCreate = undefined;
      pendingAdvance = undefined;
      pendingPublish = undefined;
      pendingControl = undefined;
      publishPendingAction.value = undefined;
      currentRun.value = undefined;
    }
    const generation = ++selectionGeneration;
    if (reference) {
      await discoverActiveRun(reference.id, generation);
    }
  }

  async function syncReferences(references: readonly ReferenceWorkSummary[]): Promise<void> {
    const selected = selectedReference.value
      ? references.find((reference) => reference.id === selectedReference.value?.id)
      : references[0];
    await selectReference(selected);
  }

  async function startPreview(
    selectedChapterIds?: string[],
    confirmDetectedRange?: true,
  ): Promise<void> {
    const reference = selectedReference.value;
    if (!reference || !canStart.value || disposed) return;
    error.value = '';
    indeterminate.value = false;
    const idempotencyKey = nextIdempotencyKey('preview-create');
    pendingCreate = {
      referenceId: reference.id,
      idempotencyKey,
      ...(selectedChapterIds?.length ? { selectedChapterIds: [...selectedChapterIds] } : {}),
      ...(confirmDetectedRange ? { confirmDetectedRange } : {}),
    };
    creating.value = true;
    try {
      const result = await client.createReferenceDeconstructionRun(reference.id, {
        mode: 'quickPreview',
        baseRunRevision: 0,
        idempotencyKey,
        ...(selectedChapterIds?.length ? { selectedChapterIds: [...selectedChapterIds] } : {}),
        ...(confirmDetectedRange ? { confirmDetectedRange } : {}),
      });
      applyRun(result.run);
      pendingCreate = undefined;
    } catch (caught) {
      await recoverAfterUnknownMutation(caught);
      if (!currentRun.value) pendingCreate = {
        referenceId: reference.id,
        idempotencyKey,
        ...(selectedChapterIds?.length ? { selectedChapterIds: [...selectedChapterIds] } : {}),
        ...(confirmDetectedRange ? { confirmDetectedRange } : {}),
      };
      return;
    } finally {
      creating.value = false;
    }

    if (currentRun.value?.status === 'created') {
      await advancePreview();
    }
  }

  async function advancePreview(
    replay?: PendingAdvance,
  ): Promise<void> {
    await advanceOneUnit('preview', replay);
  }

  async function advanceFull(
    replay?: PendingAdvance,
  ): Promise<void> {
    await advanceOneUnit('full', replay);
  }

  async function advanceOneUnit(
    phase: PendingAdvance['phase'],
    replay?: PendingAdvance,
  ): Promise<void> {
    const reference = selectedReference.value;
    const run = currentRun.value;
    if (
      !reference || !run || run.referenceId !== reference.id || disposed ||
      (!replay && !(phase === 'preview' ? canAdvance.value : canAdvanceFull.value)) ||
      (
        replay &&
        (
          replay.phase !== phase ||
          replay.referenceId !== reference.id ||
          replay.runId !== run.id
        )
      )
    ) return;

    const input = replay?.input ?? {
      baseRunRevision: run.runRevision,
      idempotencyKey: nextIdempotencyKey(`${phase}-advance`),
    };
    pendingAdvance = {
      referenceId: reference.id,
      runId: run.id,
      input,
      phase,
    };
    advancing.value = true;
    error.value = '';
    indeterminate.value = false;
    const controller = new AbortController();
    activeAdvanceConnection.value = { runId: run.id, controller };

    try {
      const result = await client.advanceReferenceDeconstructionRun(
        reference.id,
        run.id,
        input,
        { signal: controller.signal },
      );
      applyRun(result.run);
      pendingAdvance = undefined;
    } catch (caught) {
      if (!disposed) await recoverAfterUnknownMutation(caught);
    } finally {
      if (activeAdvanceConnection.value?.controller === controller) {
        activeAdvanceConnection.value = undefined;
      }
      advancing.value = false;
    }
  }

  async function cancel(): Promise<void> {
    const reference = selectedReference.value;
    const run = currentRun.value;
    if (!reference || !run || !canCancel.value || disposed) return;
    cancelling.value = true;
    error.value = '';
    try {
      const latest = await client.getReferenceDeconstructionRun(reference.id, run.id);
      applyRun(latest.run);
      const authoritative = currentRun.value;
      if (!authoritative || !CANCELLABLE_RUN_STATUSES.has(authoritative.status)) return;
      const result = await client.cancelReferenceDeconstructionRun(
        reference.id,
        authoritative.id,
        {
          baseRunRevision: authoritative.runRevision,
          idempotencyKey: nextIdempotencyKey(
            authoritative.full ? 'full-cancel' : 'preview-cancel',
          ),
        },
      );
      applyRun(result.run);
      indeterminate.value = false;
      if (result.run.status === 'cancelled') {
        abortAdvanceConnection(result.run.id, 'reference-deconstruction-cancelled');
        pendingAdvance = undefined;
        pendingControl = undefined;
      }
    } catch (caught) {
      await recoverAfterUnknownMutation(caught);
    } finally {
      cancelling.value = false;
    }
  }

  async function approveFull(): Promise<void> {
    const reference = selectedReference.value;
    const run = currentRun.value;
    if (!reference || !run || !canApprove.value || disposed) return;
    approving.value = true;
    error.value = '';
    try {
      const result = await client.approveFullReferenceDeconstructionRun(
        reference.id,
        run.id,
        {
          baseRunRevision: run.runRevision,
          idempotencyKey: nextIdempotencyKey('full-approve'),
        },
      );
      applyRun(result.run);
      indeterminate.value = false;
    } catch (caught) {
      await recoverAfterUnknownMutation(caught);
    } finally {
      approving.value = false;
    }
  }

  async function pauseFull(replay?: PendingPauseControl): Promise<void> {
    const reference = selectedReference.value;
    const run = currentRun.value;
    if (
      !reference || !run || disposed ||
      (!replay && !canPause.value) ||
      (replay && !canReplayPendingControl(replay, reference.id, run))
    ) return;
    const pending = replay ?? {
      referenceId: reference.id,
      runId: run.id,
      kind: 'pause' as const,
      input: {
        baseRunRevision: run.runRevision,
        idempotencyKey: nextIdempotencyKey('full-pause'),
      },
    };
    pendingControl = pending;
    pausing.value = true;
    error.value = '';
    indeterminate.value = false;
    try {
      const result = await client.pauseReferenceDeconstructionRun(
        reference.id,
        run.id,
        pending.input,
      );
      applyRun(result.run);
      provePendingControlMutation(result.run, pending);
    } catch (caught) {
      await recoverAfterUnknownMutation(caught);
    } finally {
      pausing.value = false;
    }
  }

  async function resumeFull(replay?: PendingResumeControl): Promise<void> {
    const reference = selectedReference.value;
    const run = currentRun.value;
    if (
      !reference || !run || disposed ||
      (!replay && !canResume.value) ||
      (replay && !canReplayPendingControl(replay, reference.id, run))
    ) return;
    const pending = replay ?? {
      referenceId: reference.id,
      runId: run.id,
      kind: 'resume' as const,
      input: {
        baseRunRevision: run.runRevision,
        idempotencyKey: nextIdempotencyKey('full-resume'),
      },
    };
    pendingControl = pending;
    resuming.value = true;
    error.value = '';
    indeterminate.value = false;
    try {
      const result = await client.resumeReferenceDeconstructionRun(
        reference.id,
        run.id,
        pending.input,
      );
      applyRun(result.run);
      provePendingControlMutation(result.run, pending);
    } catch (caught) {
      await recoverAfterUnknownMutation(caught);
    } finally {
      resuming.value = false;
    }
  }

  async function retryFailedUnit(
    unitId?: string,
    replay?: PendingRetryControl,
  ): Promise<void> {
    const reference = selectedReference.value;
    const run = currentRun.value;
    const failedUnit = run?.full?.failedUnit;
    if (
      !reference || !run || !failedUnit || disposed ||
      (!replay && !canRetry.value) ||
      (replay && !canReplayPendingControl(replay, reference.id, run)) ||
      (unitId !== undefined && unitId !== failedUnit.id)
    ) return;
    const pending = replay ?? {
      referenceId: reference.id,
      runId: run.id,
      kind: 'retry' as const,
      input: {
        baseRunRevision: run.runRevision,
        idempotencyKey: nextIdempotencyKey('full-retry'),
        unitId: failedUnit.id,
      },
    };
    pendingControl = pending;
    retrying.value = true;
    error.value = '';
    indeterminate.value = false;
    try {
      const result = await client.retryReferenceDeconstructionRun(
        reference.id,
        run.id,
        pending.input,
      );
      applyRun(result.run);
      provePendingControlMutation(result.run, pending);
    } catch (caught) {
      await recoverAfterUnknownMutation(caught);
    } finally {
      retrying.value = false;
    }
  }

  async function publish(
    replay?: PendingPublish,
  ): Promise<void> {
    const reference = selectedReference.value;
    const run = currentRun.value;
    if (
      !reference || !run || disposed ||
      (!replay && !canPublish.value) ||
      (
        replay &&
        (
          replay.referenceId !== reference.id ||
          replay.runId !== run.id ||
          run.runRevision !== replay.input.baseRunRevision ||
          run.status !== 'reviewReady'
        )
      )
    ) return;

    const pending = replay ?? {
      referenceId: reference.id,
      runId: run.id,
      input: {
        baseRunRevision: run.runRevision,
        idempotencyKey: nextIdempotencyKey('publish'),
      },
    };
    pendingPublish = pending;
    publishing.value = true;
    error.value = '';
    indeterminate.value = false;

    try {
      const result = await client.publishReferenceDeconstructionRun(
        reference.id,
        run.id,
        pending.input,
      );
      applyRun(result.run);
      const pendingActionId = readPublication(result.run)?.pendingActionId;
      if (
        result.pendingAction.id !== pendingActionId ||
        result.receipt.idempotencyKey !== pending.input.idempotencyKey
      ) {
        indeterminate.value = true;
        throw new Error(
          'Reference publish response did not prove its PendingAction and mutation receipt.',
        );
      }
      publishPendingAction.value = result.pendingAction;
      pendingPublish = undefined;
      indeterminate.value = false;
    } catch (caught) {
      await recoverAfterUnknownMutation(caught);
    } finally {
      publishing.value = false;
    }
  }

  async function reconcile(): Promise<void> {
    const reference = selectedReference.value;
    if (!reference || disposed || reconciling.value) return;
    reconciling.value = true;
    error.value = '';
    try {
      if (currentRun.value) {
        const result = await client.getReferenceDeconstructionRun(
          reference.id,
          currentRun.value.id,
        );
        applyRun(result.run);
      } else {
        const result = await client.getActiveReferenceDeconstructionRun(reference.id);
        if (result.run) applyRun(result.run);
      }
      if (!currentRun.value && pendingCreate) {
        await replayPendingCreate(pendingCreate);
      } else if (currentRun.value && pendingAdvance) {
        const receipt = currentRun.value.mutationReceipts.find((candidate) =>
          candidate.idempotencyKey === pendingAdvance?.input.idempotencyKey);
        if (receipt) {
          pendingAdvance = undefined;
          indeterminate.value = hasActiveProviderUnit(currentRun.value);
        } else if (
          currentRun.value.runRevision === pendingAdvance.input.baseRunRevision &&
          canReplayAdvance(currentRun.value, pendingAdvance.phase)
        ) {
          if (pendingAdvance.phase === 'preview') {
            await advancePreview(pendingAdvance);
          } else {
            await advanceFull(pendingAdvance);
          }
        } else {
          pendingAdvance = undefined;
        }
      } else if (currentRun.value && pendingPublish) {
        const pending = pendingPublish;
        const currentPublication = readPublication(currentRun.value);
        if (
          currentRun.value.status === 'publishing' &&
          currentPublication?.pendingActionId
        ) {
          pendingPublish = undefined;
          indeterminate.value = false;
        } else if (
          currentRun.value.status === 'reviewReady' &&
          currentRun.value.runRevision === pending.input.baseRunRevision
        ) {
          await publish(pending);
        } else if (currentRun.value.runRevision !== pending.input.baseRunRevision) {
          pendingPublish = undefined;
          indeterminate.value = false;
        } else {
          indeterminate.value = true;
        }
      } else if (currentRun.value && pendingControl) {
        const pending = pendingControl;
        const receipt = findPendingControlReceipt(
          currentRun.value,
          pending,
        );
        if (receipt) {
          pendingControl = undefined;
          indeterminate.value = false;
        } else if (
          currentRun.value.runRevision === pending.input.baseRunRevision &&
          canReplayControlMutation(currentRun.value, pending)
        ) {
          await replayPendingControl(pending);
        } else if (currentRun.value.runRevision !== pending.input.baseRunRevision) {
          pendingControl = undefined;
          indeterminate.value = false;
        } else {
          indeterminate.value = true;
        }
      } else {
        indeterminate.value = false;
      }
    } catch (caught) {
      indeterminate.value = true;
      error.value = toErrorMessage(caught);
    } finally {
      reconciling.value = false;
    }
  }

  async function replayPendingCreate(pending: PendingCreate): Promise<void> {
    const result = await client.createReferenceDeconstructionRun(pending.referenceId, {
      mode: 'quickPreview',
      baseRunRevision: 0,
      idempotencyKey: pending.idempotencyKey,
      ...(pending.selectedChapterIds
        ? { selectedChapterIds: [...pending.selectedChapterIds] }
        : {}),
      ...(pending.confirmDetectedRange
        ? { confirmDetectedRange: pending.confirmDetectedRange }
        : {}),
    });
    applyRun(result.run);
    pendingCreate = undefined;
    if (result.run.status === 'created') {
      await advancePreview({
        referenceId: pending.referenceId,
        runId: result.run.id,
        input: {
          baseRunRevision: result.run.runRevision,
          idempotencyKey: nextIdempotencyKey('preview-advance'),
        },
        phase: 'preview',
      });
    }
  }

  async function discoverActiveRun(referenceId: string, generation: number): Promise<void> {
    loadingActiveRun.value = true;
    try {
      const result = await client.getActiveReferenceDeconstructionRun(referenceId);
      if (
        generation === selectionGeneration &&
        selectedReference.value?.id === referenceId &&
        result.run
      ) {
        applyRun(result.run);
      }
    } catch (caught) {
      if (generation === selectionGeneration) {
        error.value = toErrorMessage(caught);
      }
    } finally {
      if (generation === selectionGeneration) loadingActiveRun.value = false;
    }
  }

  async function recoverAfterUnknownMutation(cause: unknown): Promise<void> {
    const reference = selectedReference.value;
    if (!reference) return;
    try {
      const result = currentRun.value
        ? await client.getReferenceDeconstructionRun(reference.id, currentRun.value.id)
        : await client.getActiveReferenceDeconstructionRun(reference.id);
      if (result.run) {
        applyRun(result.run);
        const pendingReceipt = pendingAdvance
          ? result.run.mutationReceipts.find((receipt) =>
              receipt.idempotencyKey === pendingAdvance?.input.idempotencyKey)
          : undefined;
        if (pendingReceipt && !hasActiveProviderUnit(result.run)) {
          pendingAdvance = undefined;
        } else if (
          pendingAdvance &&
          !pendingReceipt &&
          result.run.runRevision !== pendingAdvance.input.baseRunRevision
        ) {
          pendingAdvance = undefined;
        }
        const pendingControlReceipt = pendingControl
          ? findPendingControlReceipt(result.run, pendingControl)
          : undefined;
        if (pendingControlReceipt) {
          pendingControl = undefined;
        } else if (
          pendingControl &&
          result.run.runRevision !== pendingControl.input.baseRunRevision
        ) {
          pendingControl = undefined;
        }
        const currentPublication = readPublication(result.run);
        if (
          pendingPublish &&
          result.run.status === 'publishing' &&
          currentPublication?.pendingActionId
        ) {
          pendingPublish = undefined;
        } else if (
          pendingPublish &&
          result.run.runRevision !== pendingPublish.input.baseRunRevision
        ) {
          pendingPublish = undefined;
        }
        indeterminate.value = hasActiveProviderUnit(result.run) || Boolean(
          pendingAdvance &&
          !pendingReceipt &&
          result.run.runRevision === pendingAdvance.input.baseRunRevision,
        ) || Boolean(pendingControl) || Boolean(pendingPublish);
        error.value = indeterminate.value
          ? `${toErrorMessage(cause)} Run completion is not yet proven; reconcile or cancel before continuing.`
          : '';
        return;
      }
    } catch (reconcileError) {
      error.value = `${toErrorMessage(cause)} Reconciliation failed: ${toErrorMessage(reconcileError)}`;
      indeterminate.value = true;
      return;
    }
    error.value = toErrorMessage(cause);
    indeterminate.value = true;
  }

  function applyRun(next: ReferenceDeconstructionRun): void {
    const reference = selectedReference.value;
    if (!reference || next.referenceId !== reference.id) {
      throw new Error('Reference deconstruction changed reference identity.');
    }
    const previous = currentRun.value;
    if (previous && previous.id !== next.id) {
      if (ACTIVE_RUN_STATUSES.has(previous.status)) {
        throw new Error('Reference deconstruction changed active run identity.');
      }
      currentRun.value = next;
      return;
    }
    if (previous && !hasSameImmutableRunIdentity(previous, next)) {
      indeterminate.value = true;
      throw new Error('Reference deconstruction changed immutable run identity.');
    }
    if (previous && next.runRevision < previous.runRevision) return;
    if (
      previous &&
      next.runRevision === previous.runRevision &&
      JSON.stringify(previous) !== JSON.stringify(next) &&
      !isSameRevisionAdvanceSettlement(previous, next)
    ) {
      indeterminate.value = true;
      throw new Error('Reference deconstruction returned conflicting truth for the same revision.');
    }
    currentRun.value = next;
  }

  function provePendingControlMutation(
    run: ReferenceDeconstructionRun,
    pending: PendingControl,
  ): void {
    if (!findPendingControlReceipt(run, pending)) {
      indeterminate.value = true;
      throw new Error(
        `Reference ${pending.kind} response did not prove its mutation receipt.`,
      );
    }
    if (pendingControl?.input.idempotencyKey === pending.input.idempotencyKey) {
      pendingControl = undefined;
    }
    indeterminate.value = false;
  }

  function canReplayPendingControl(
    replay: PendingControl,
    referenceId: string,
    run: ReferenceDeconstructionRun,
  ): boolean {
    return pendingControl?.kind === replay.kind &&
      pendingControl.input.idempotencyKey === replay.input.idempotencyKey &&
      replay.referenceId === referenceId &&
      replay.runId === run.id &&
      run.referenceId === referenceId &&
      run.runRevision === replay.input.baseRunRevision &&
      canReplayControlMutation(run, replay);
  }

  async function replayPendingControl(pending: PendingControl): Promise<void> {
    if (pending.kind === 'pause') {
      await pauseFull(pending);
    } else if (pending.kind === 'resume') {
      await resumeFull(pending);
    } else {
      await retryFailedUnit(pending.input.unitId, pending);
    }
  }

  function nextIdempotencyKey(operation: string): string {
    const key = options.createIdempotencyKey?.(operation) ??
      `reference-${operation}-${Date.now().toString(36)}-${(++operationSequence).toString(36)}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(key)) {
      throw new Error('Reference deconstruction idempotency key generator returned an invalid key.');
    }
    return key;
  }

  function abortAdvanceConnection(runId: string, reason: string): void {
    const connection = activeAdvanceConnection.value;
    if (connection?.runId === runId && !connection.controller.signal.aborted) {
      connection.controller.abort(reason);
    }
  }

  function dispose(): void {
    disposed = true;
    activeAdvanceConnection.value?.controller.abort('reference-deconstruction-composable-disposed');
    activeAdvanceConnection.value = undefined;
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    selectedReference: selectedReferenceView,
    run: currentRunView,
    loadingActiveRun: readonly(loadingActiveRun),
    creating: readonly(creating),
    advancing: readonly(advancing),
    cancelling: readonly(cancelling),
    approving: readonly(approving),
    pausing: readonly(pausing),
    resuming: readonly(resuming),
    retrying: readonly(retrying),
    publishing: readonly(publishing),
    reconciling: readonly(reconciling),
    indeterminate: readonly(indeterminate),
    error: readonly(error),
    busy,
    canStart,
    canAdvance,
    canAdvanceFull,
    canPause,
    canResume,
    canRetry,
    canCancel,
    canApprove,
    canPublish,
    publication,
    publishPendingAction: readonly(publishPendingAction),
    needsReconcile,
    selectReference,
    syncReferences,
    startPreview,
    advancePreview,
    advanceFull,
    cancel,
    approveFull,
    pauseFull,
    resumeFull,
    retryFailedUnit,
    publish,
    reconcile,
    dispose,
  };
}

function readPublication(
  run: ReferenceDeconstructionRun | undefined,
): ReferenceDeconstructionPublicationView | undefined {
  return run?.publication;
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isSameRevisionAdvanceSettlement(
  previous: ReferenceDeconstructionRun,
  next: ReferenceDeconstructionRun,
): boolean {
  if (!hasActiveProviderUnit(previous)) return false;
  const previousReceipt = previous.mutationReceipts.find((receipt) =>
    receipt.resultingRunRevision === previous.runRevision);
  const nextReceipt = next.mutationReceipts.find((receipt) =>
    receipt.resultingRunRevision === next.runRevision);
  return Boolean(
    previousReceipt &&
    nextReceipt &&
    previousReceipt.idempotencyKey === nextReceipt.idempotencyKey &&
    previousReceipt.requestFingerprint === nextReceipt.requestFingerprint,
  );
}

function hasActiveProviderUnit(run: ReferenceDeconstructionRun): boolean {
  return run.status === 'previewRunning' ||
    Boolean(run.status === 'fullRunning' && run.full?.currentUnit);
}

function findPendingControlReceipt(
  run: ReferenceDeconstructionRun,
  pending: PendingControl,
): ReferenceDeconstructionRun['mutationReceipts'][number] | undefined {
  const validResultStatuses: ReadonlySet<ReferenceDeconstructionRun['status']> =
    pending.kind === 'pause'
      ? new Set(['paused', 'stale'])
      : new Set(['fullRunning', 'stale']);
  return run.mutationReceipts.find((receipt) =>
    receipt.idempotencyKey === pending.input.idempotencyKey &&
    receipt.resultingRunRevision === pending.input.baseRunRevision + 1 &&
    validResultStatuses.has(receipt.resultStatus));
}

function canReplayControlMutation(
  run: ReferenceDeconstructionRun,
  pending: PendingControl,
): boolean {
  if (!run.full || run.id !== pending.runId || run.referenceId !== pending.referenceId) {
    return false;
  }
  if (pending.kind === 'pause') {
    return run.status === 'fullRunning' && !run.full.currentUnit;
  }
  if (pending.kind === 'resume') {
    return run.status === 'paused' || run.status === 'interrupted';
  }
  return run.status === 'failed' &&
    run.full.failedUnit?.id === pending.input.unitId;
}

function canReplayAdvance(
  run: ReferenceDeconstructionRun,
  phase: PendingAdvance['phase'],
): boolean {
  if (phase === 'preview') {
    return run.status === 'created' ||
      (run.status === 'interrupted' && run.full === undefined);
  }
  return Boolean(
    run.full?.nextUnit &&
    (run.status === 'fullApproved' || run.status === 'fullRunning'),
  );
}

function hasSameImmutableRunIdentity(
  previous: ReferenceDeconstructionRun,
  next: ReferenceDeconstructionRun,
): boolean {
  return previous.id === next.id &&
    previous.referenceId === next.referenceId &&
    previous.sourceChecksumSha256 === next.sourceChecksumSha256 &&
    previous.structureFingerprint === next.structureFingerprint &&
    previous.pipelineVersion === next.pipelineVersion &&
    previous.capabilityVersion === next.capabilityVersion &&
    previous.createdAt === next.createdAt &&
    previous.selectedChapterIds.length === next.selectedChapterIds.length &&
    previous.selectedChapterIds.every((chapterId, index) =>
      chapterId === next.selectedChapterIds[index]);
}
