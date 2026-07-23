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
  ReferenceDeconstructionRun,
  ReferenceWorkSummary,
} from './useWorkspaceApi';

type WorkspaceApi = ReturnType<typeof useWorkspaceApi>;

export type ReferenceDeconstructionClient = Pick<WorkspaceApi,
  | 'createReferenceDeconstructionRun'
  | 'getReferenceDeconstructionRun'
  | 'getActiveReferenceDeconstructionRun'
  | 'advanceReferenceDeconstructionRun'
  | 'cancelReferenceDeconstructionRun'
  | 'approveFullReferenceDeconstructionRun'
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
}

const ACTIVE_RUN_STATUSES: ReadonlySet<ReferenceDeconstructionRun['status']> = new Set([
  'created',
  'previewRunning',
  'awaitingFullApproval',
  'fullApproved',
  'interrupted',
]);

const CANCELLABLE_RUN_STATUSES: ReadonlySet<ReferenceDeconstructionRun['status']> = new Set([
  'created',
  'previewRunning',
  'awaitingFullApproval',
  'interrupted',
]);

const PREVIEW_SETTLEMENT_STATUSES: ReadonlySet<ReferenceDeconstructionRun['status']> = new Set([
  'awaitingFullApproval',
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
  const reconciling = shallowRef(false);
  const indeterminate = shallowRef(false);
  const error = shallowRef('');
  const activeAdvanceConnection = shallowRef<{
    runId: string;
    controller: AbortController;
  }>();
  let selectionGeneration = 0;
  let operationSequence = 0;
  let disposed = false;
  let pendingCreate: PendingCreate | undefined;
  let pendingAdvance: PendingAdvance | undefined;

  const busy = computed(() =>
    loadingActiveRun.value || creating.value || advancing.value ||
    cancelling.value || approving.value || reconciling.value,
  );
  const canStart = computed(() => Boolean(
    selectedReference.value &&
    !busy.value &&
    !ACTIVE_RUN_STATUSES.has(currentRun.value?.status ?? 'cancelled'),
  ));
  const canAdvance = computed(() => Boolean(
    (currentRun.value?.status === 'created' || currentRun.value?.status === 'interrupted') &&
    !busy.value,
  ));
  const canCancel = computed(() => Boolean(
    currentRun.value &&
    (
      advancing.value ||
      currentRun.value.status === 'created' ||
      currentRun.value.status === 'previewRunning' ||
      currentRun.value.status === 'awaitingFullApproval' ||
      currentRun.value.status === 'interrupted'
    ) &&
    !loadingActiveRun.value &&
    !creating.value &&
    !reconciling.value &&
    !cancelling.value &&
    !approving.value,
  ));
  const canApprove = computed(() => Boolean(
    currentRun.value?.status === 'awaitingFullApproval' &&
    !currentRun.value.diagnostics.some((diagnostic) => diagnostic.blocking) &&
    !busy.value,
  ));
  const needsReconcile = computed(() =>
    indeterminate.value || Boolean(
      currentRun.value &&
      !advancing.value &&
      (currentRun.value.status === 'previewRunning' ||
        currentRun.value.status === 'interrupted'),
    ),
  );
  const selectedReferenceView = computed(() => selectedReference.value);
  const currentRunView = computed(() => currentRun.value);

  async function selectReference(reference?: ReferenceWorkSummary): Promise<void> {
    if (disposed) return;
    if (
      reference?.id !== selectedReference.value?.id &&
      busy.value
    ) {
      error.value = 'Wait for the current reference operation to finish before selecting another reference.';
      return;
    }

    const sameReference = reference?.id === selectedReference.value?.id;
    selectedReference.value = reference;
    error.value = '';
    indeterminate.value = false;
    if (!sameReference) {
      pendingCreate = undefined;
      pendingAdvance = undefined;
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
    const reference = selectedReference.value;
    const run = currentRun.value;
    if (
      !reference || !run || run.referenceId !== reference.id || disposed ||
      (!replay && !canAdvance.value)
    ) return;

    const input = replay?.input ?? {
      baseRunRevision: run.runRevision,
      idempotencyKey: nextIdempotencyKey('preview-advance'),
    };
    pendingAdvance = {
      referenceId: reference.id,
      runId: run.id,
      input,
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
          idempotencyKey: nextIdempotencyKey('preview-cancel'),
        },
      );
      applyRun(result.run);
      indeterminate.value = false;
      if (result.run.status === 'cancelled') {
        abortAdvanceConnection(result.run.id, 'reference-preview-cancelled');
        pendingAdvance = undefined;
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
      indeterminate.value = false;

      if (!currentRun.value && pendingCreate) {
        await replayPendingCreate(pendingCreate);
      } else if (currentRun.value?.status === 'created' && pendingAdvance) {
        await advancePreview(pendingAdvance);
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
        indeterminate.value = result.run.status === 'previewRunning';
        error.value = indeterminate.value
          ? `${toErrorMessage(cause)} Preview is still running; reconcile or cancel before continuing.`
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
      throw new Error('Reference preview changed reference identity.');
    }
    const previous = currentRun.value;
    if (previous && previous.id !== next.id) {
      if (ACTIVE_RUN_STATUSES.has(previous.status)) {
        throw new Error('Reference preview changed active run identity.');
      }
      currentRun.value = next;
      return;
    }
    if (previous && !hasSameImmutableRunIdentity(previous, next)) {
      indeterminate.value = true;
      throw new Error('Reference preview changed immutable run identity.');
    }
    if (previous && next.runRevision < previous.runRevision) return;
    if (
      previous &&
      next.runRevision === previous.runRevision &&
      JSON.stringify(previous) !== JSON.stringify(next) &&
      !isSameRevisionPreviewSettlement(previous, next)
    ) {
      indeterminate.value = true;
      throw new Error('Reference preview returned conflicting truth for the same revision.');
    }
    currentRun.value = next;
  }

  function nextIdempotencyKey(operation: string): string {
    const key = options.createIdempotencyKey?.(operation) ??
      `reference-${operation}-${Date.now().toString(36)}-${(++operationSequence).toString(36)}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(key)) {
      throw new Error('Reference preview idempotency key generator returned an invalid key.');
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
    activeAdvanceConnection.value?.controller.abort('reference-preview-composable-disposed');
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
    reconciling: readonly(reconciling),
    indeterminate: readonly(indeterminate),
    error: readonly(error),
    busy,
    canStart,
    canAdvance,
    canCancel,
    canApprove,
    needsReconcile,
    selectReference,
    syncReferences,
    startPreview,
    advancePreview,
    cancel,
    approveFull,
    reconcile,
    dispose,
  };
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isSameRevisionPreviewSettlement(
  previous: ReferenceDeconstructionRun,
  next: ReferenceDeconstructionRun,
): boolean {
  if (
    previous.status !== 'previewRunning' ||
    !PREVIEW_SETTLEMENT_STATUSES.has(next.status)
  ) return false;

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
