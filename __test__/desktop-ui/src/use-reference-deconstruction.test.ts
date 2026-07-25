import { describe, expect, it, vi } from 'vitest';

import {
  useReferenceDeconstruction,
  type ReferenceDeconstructionClient,
} from '../../../apps/desktop-ui/src/composables/useReferenceDeconstruction';
import type {
  ReferenceDeconstructionFullRun,
  ReferenceDeconstructionMutationReceipt,
  ReferenceDeconstructionRun,
  ReferenceWorkSummary,
} from '@oh-awesome-novel/client';

describe('useReferenceDeconstruction', () => {
  it('creates a run, then advances exactly one bounded preview unit', async () => {
    const keys = ['create-key', 'advance-key'];
    const create = vi.fn(async () => mutation(createdRun(), 'create-key'));
    const advance = vi.fn(async (
      _referenceId: string,
      _runId: string,
      _input: { baseRunRevision: number; idempotencyKey: string },
      options?: { signal?: AbortSignal },
    ) => {
      expect(options?.signal?.aborted).toBe(false);
      return mutation(previewRun(), 'advance-key');
    });
    const flow = useReferenceDeconstruction({
      client: client({ create, advance }),
      createIdempotencyKey: () => keys.shift()!,
    });

    await flow.selectReference(reference());
    await flow.startPreview(['0001'], true);

    expect(create).toHaveBeenCalledWith('reference-1', {
      mode: 'quickPreview',
      baseRunRevision: 0,
      idempotencyKey: 'create-key',
      selectedChapterIds: ['0001'],
      confirmDetectedRange: true,
    });
    expect(advance).toHaveBeenCalledWith(
      'reference-1',
      'run-1',
      { baseRunRevision: 0, idempotencyKey: 'advance-key' },
      { signal: expect.any(AbortSignal) },
    );
    expect(flow.run.value?.status).toBe('awaitingFullApproval');
    expect(flow.canApprove.value).toBe(true);
    expect(flow.advancing.value).toBe(false);
  });

  it('GET-reconciles a lost advance response before exposing terminal truth', async () => {
    const get = vi.fn(async () => ({ run: previewRun() }));
    const flow = useReferenceDeconstruction({
      client: client({
        get,
        async create() {
          return mutation(createdRun(), 'create-key');
        },
        async advance() {
          throw new Error('connection dropped');
        },
      }),
      createIdempotencyKey: (operation) => operation === 'preview-create'
        ? 'create-key'
        : 'advance-key',
    });

    await flow.selectReference(reference());
    await flow.startPreview();

    expect(get).toHaveBeenCalledWith('reference-1', 'run-1');
    expect(flow.run.value?.status).toBe('awaitingFullApproval');
    expect(flow.indeterminate.value).toBe(false);
    expect(flow.error.value).toBe('');
  });

  it('replays a pending low-confidence create with the original confirmation flag', async () => {
    let createAttempt = 0;
    const create = vi.fn(async (
      _referenceId: string,
      input: { idempotencyKey: string },
    ) => {
      createAttempt += 1;
      if (createAttempt === 1) throw new Error('connection dropped');
      return mutation(createdRun(), input.idempotencyKey);
    });
    const flow = useReferenceDeconstruction({
      client: client({ create }),
      createIdempotencyKey: (operation) => operation === 'preview-create'
        ? 'create-key'
        : 'advance-key',
    });

    await flow.selectReference(reference());
    await flow.startPreview(undefined, true);
    expect(flow.indeterminate.value).toBe(true);

    await flow.reconcile();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[1]).toMatchObject({ confirmDetectedRange: true });
    expect(create.mock.calls[1]?.[1]).toEqual(create.mock.calls[0]?.[1]);
    expect(flow.run.value?.status).toBe('awaitingFullApproval');
  });

  it('does not change reference identity while create is pending', async () => {
    const pending = deferred<ReturnType<typeof mutation>>();
    const flow = useReferenceDeconstruction({
      client: client({
        create: async () => pending.promise,
      }),
    });

    await flow.selectReference(reference());
    const start = flow.startPreview();
    await flow.selectReference(otherReference());

    expect(flow.selectedReference.value?.id).toBe('reference-1');
    expect(flow.error.value).toContain('current reference operation');
    pending.resolve(mutation(createdRun(), 'create-key'));
    await start;
  });

  it('stops through server cancellation, then aborts the local request only after proof', async () => {
    let advanceSignal: AbortSignal | undefined;
    let authoritative = runningRun();
    const advanceStarted = deferred<void>();
    const get = vi.fn(async () => ({ run: authoritative }));
    const cancel = vi.fn(async () => {
      expect(advanceSignal?.aborted).toBe(false);
      authoritative = cancelledRun();
      return mutation(authoritative, 'cancel-key');
    });
    const flow = useReferenceDeconstruction({
      client: client({
        get,
        cancel,
        async create() {
          return mutation(createdRun(), 'create-key');
        },
        async advance(_referenceId, _runId, _input, options) {
          advanceSignal = options?.signal;
          advanceStarted.resolve();
          await waitForAbort(options?.signal);
          throw new Error('advance aborted after cancellation');
        },
      }),
      createIdempotencyKey: (operation) => operation === 'preview-create'
        ? 'create-key'
        : operation === 'preview-advance' ? 'advance-key' : 'cancel-key',
    });

    await flow.selectReference(reference());
    const start = flow.startPreview();
    await advanceStarted.promise;
    await flow.cancel();
    await start;

    expect(get).toHaveBeenCalledWith('reference-1', 'run-1');
    expect(cancel).toHaveBeenCalledWith('reference-1', 'run-1', {
      baseRunRevision: 1,
      idempotencyKey: 'cancel-key',
    });
    expect(advanceSignal?.aborted).toBe(true);
    expect(flow.run.value?.status).toBe('cancelled');
    expect(flow.indeterminate.value).toBe(false);
  });

  it('re-reads authority and cancels a full-approved run with its latest revision', async () => {
    const approved = approvedRun();
    const cancelled = {
      ...approved,
      status: 'cancelled' as const,
      runRevision: 3,
      mutationReceipts: [
        ...approved.mutationReceipts,
        receipt('cancel-key', 3, 'cancelled', 'f'),
      ],
      receiptCount: 4,
      updatedAt: '2026-07-22T00:03:00.000Z',
    };
    const cancel = vi.fn(async () => mutation(cancelled, 'cancel-key'));
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: runningRun() }),
        get: async () => ({ run: approved }),
        cancel,
      }),
      createIdempotencyKey: () => 'cancel-key',
    });

    await flow.selectReference(reference());
    await flow.cancel();

    expect(cancel).toHaveBeenCalledWith('reference-1', 'run-1', {
      baseRunRevision: 2,
      idempotencyKey: 'cancel-key',
    });
    expect(flow.run.value?.status).toBe('cancelled');
  });

  it('discovers an interrupted run after restart and resumes only on explicit advance', async () => {
    const interrupted = interruptedRun();
    const active = vi.fn(async () => ({ run: interrupted }));
    const advance = vi.fn(async () => mutation(previewRun(2, [
      ...interrupted.mutationReceipts,
      receipt('resume-key', 2, 'awaitingFullApproval', '9'),
    ]), 'resume-key'));
    const flow = useReferenceDeconstruction({
      client: client({ active, advance }),
      createIdempotencyKey: () => 'resume-key',
    });

    await flow.selectReference(reference());

    expect(active).toHaveBeenCalledWith('reference-1');
    expect(flow.run.value?.status).toBe('interrupted');
    expect(flow.canAdvance.value).toBe(true);
    expect(advance).not.toHaveBeenCalled();

    await flow.advancePreview();
    expect(advance).toHaveBeenCalledWith(
      'reference-1',
      'run-1',
      { baseRunRevision: 1, idempotencyKey: 'resume-key' },
      { signal: expect.any(AbortSignal) },
    );
    expect(flow.run.value?.status).toBe('awaitingFullApproval');
  });

  it('accepts an authoritative same-revision preview settlement during reconciliation', async () => {
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: runningRun() }),
        get: async () => ({ run: interruptedRun() }),
      }),
    });

    await flow.selectReference(reference());
    expect(flow.run.value?.status).toBe('previewRunning');

    await flow.reconcile();

    expect(flow.run.value?.status).toBe('interrupted');
    expect(flow.indeterminate.value).toBe(false);
    expect(flow.error.value).toBe('');
  });

  it('fails closed when reconciliation changes immutable run identity', async () => {
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: runningRun() }),
        get: async () => ({
          run: {
            ...interruptedRun(),
            sourceChecksumSha256: 'f'.repeat(64),
          },
        }),
      }),
    });

    await flow.selectReference(reference());
    await flow.reconcile();

    expect(flow.run.value?.status).toBe('previewRunning');
    expect(flow.indeterminate.value).toBe(true);
    expect(flow.error.value).toContain('immutable run identity');
  });

  it('records full approval and exposes the first unit without starting it', async () => {
    const approve = vi.fn(async () => mutation(approvedRun(), 'approve-key'));
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: previewRun() }),
        approve,
      }),
      createIdempotencyKey: () => 'approve-key',
    });

    await flow.selectReference(reference());
    await flow.approveFull();

    expect(approve).toHaveBeenCalledWith('reference-1', 'run-1', {
      baseRunRevision: 1,
      idempotencyKey: 'approve-key',
    });
    expect(flow.run.value?.status).toBe('fullApproved');
    expect(flow.run.value?.full?.nextUnit?.id).toBe('chapter-0001');
    expect(flow.canAdvanceFull.value).toBe(true);
    expect(flow.canStart.value).toBe(false);
  });

  it('advances exactly one full unit per explicit action', async () => {
    const advance = vi.fn(async () => mutation(fullRunningRun(), 'full-advance-key'));
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: approvedRun() }),
        advance,
      }),
      createIdempotencyKey: () => 'full-advance-key',
    });

    await flow.selectReference(reference());
    expect(advance).not.toHaveBeenCalled();
    await flow.advanceFull();

    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith(
      'reference-1',
      'run-1',
      { baseRunRevision: 2, idempotencyKey: 'full-advance-key' },
      { signal: expect.any(AbortSignal) },
    );
    expect(flow.run.value?.full?.progress.completedUnits).toBe(1);
    expect(flow.canAdvanceFull.value).toBe(true);
  });

  it('does not offer pause while an authoritative full unit is still running', async () => {
    const pause = vi.fn();
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: activeFullUnitRun() }),
        pause,
      }),
    });

    await flow.selectReference(reference());

    expect(flow.run.value?.full?.currentUnit?.status).toBe('running');
    expect(flow.canPause.value).toBe(false);
    await flow.pauseFull();
    expect(pause).not.toHaveBeenCalled();
  });

  it('pauses and resumes full analysis without automatically advancing another unit', async () => {
    const advance = vi.fn();
    const pause = vi.fn(async () => mutation(pausedFullRun(), 'pause-key'));
    const resume = vi.fn(async () => mutation(resumedFullRun(), 'resume-key'));
    const keys = ['pause-key', 'resume-key'];
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: fullRunningRun() }),
        advance,
        pause,
        resume,
      }),
      createIdempotencyKey: () => keys.shift()!,
    });

    await flow.selectReference(reference());
    expect(flow.canPause.value).toBe(true);
    await flow.pauseFull();
    expect(flow.run.value?.status).toBe('paused');
    expect(flow.canResume.value).toBe(true);

    await flow.resumeFull();
    expect(flow.run.value?.status).toBe('fullRunning');
    expect(advance).not.toHaveBeenCalled();
    expect(flow.canAdvanceFull.value).toBe(true);
  });

  it('keeps an unknown pause pending, blocks reference switching, and replays its original key', async () => {
    let pauseAttempt = 0;
    const pause = vi.fn(async (
      _referenceId: string,
      _runId: string,
      input: { baseRunRevision: number; idempotencyKey: string },
    ) => {
      pauseAttempt += 1;
      if (pauseAttempt === 1) throw new Error('pause response lost');
      return mutation(pausedFullRun(), input.idempotencyKey);
    });
    const get = vi.fn(async () => ({ run: fullRunningRun() }));
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: fullRunningRun() }),
        get,
        pause,
      }),
      createIdempotencyKey: () => 'pause-key',
    });

    await flow.selectReference(reference());
    await flow.pauseFull();

    expect(flow.indeterminate.value).toBe(true);
    expect(flow.canPause.value).toBe(false);
    await flow.selectReference(otherReference());
    expect(flow.selectedReference.value?.id).toBe('reference-1');
    expect(flow.error.value).toContain('finish or reconcile');

    await flow.reconcile();

    expect(pause).toHaveBeenCalledTimes(2);
    expect(pause.mock.calls[1]?.[2]).toEqual(pause.mock.calls[0]?.[2]);
    expect(pause.mock.calls[1]?.[2]).toEqual({
      baseRunRevision: 3,
      idempotencyKey: 'pause-key',
    });
    expect(flow.run.value?.status).toBe('paused');
    expect(flow.indeterminate.value).toBe(false);
  });

  it('accepts a lost resume response only after GET proves its receipt and revision', async () => {
    const resume = vi.fn(async () => {
      throw new Error('resume response lost');
    });
    const get = vi.fn(async () => ({ run: resumedFullRun() }));
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: pausedFullRun() }),
        get,
        resume,
      }),
      createIdempotencyKey: () => 'resume-key',
    });

    await flow.selectReference(reference());
    await flow.resumeFull();

    expect(get).toHaveBeenCalledWith('reference-1', 'run-1');
    expect(flow.run.value?.status).toBe('fullRunning');
    expect(flow.indeterminate.value).toBe(false);
    expect(flow.error.value).toBe('');
  });

  it('requeues only the authoritative failed unit and waits for explicit advance', async () => {
    const advance = vi.fn();
    const retry = vi.fn(async () => mutation(retriedFullRun(), 'retry-key'));
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: failedFullRun() }),
        advance,
        retry,
      }),
      createIdempotencyKey: () => 'retry-key',
    });

    await flow.selectReference(reference());
    expect(flow.canRetry.value).toBe(true);
    await flow.retryFailedUnit('chapter-0001');

    expect(retry).toHaveBeenCalledWith('reference-1', 'run-1', {
      baseRunRevision: 3,
      idempotencyKey: 'retry-key',
      unitId: 'chapter-0001',
    });
    expect(flow.run.value?.full?.failedUnit).toBeUndefined();
    expect(flow.run.value?.full?.nextUnit?.id).toBe('chapter-0001');
    expect(advance).not.toHaveBeenCalled();
  });

  it('replays an unknown failed-unit retry with the same unit and idempotency key', async () => {
    let retryAttempt = 0;
    const retry = vi.fn(async (
      _referenceId: string,
      _runId: string,
      input: { baseRunRevision: number; idempotencyKey: string; unitId: string },
    ) => {
      retryAttempt += 1;
      if (retryAttempt === 1) throw new Error('retry response lost');
      return mutation(retriedFullRun(), input.idempotencyKey);
    });
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: failedFullRun() }),
        get: async () => ({ run: failedFullRun() }),
        retry,
      }),
      createIdempotencyKey: () => 'retry-key',
    });

    await flow.selectReference(reference());
    await flow.retryFailedUnit('chapter-0001');
    expect(flow.indeterminate.value).toBe(true);

    await flow.reconcile();

    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry.mock.calls[1]?.[2]).toEqual(retry.mock.calls[0]?.[2]);
    expect(retry.mock.calls[1]?.[2]).toEqual({
      baseRunRevision: 3,
      idempotencyKey: 'retry-key',
      unitId: 'chapter-0001',
    });
    expect(flow.run.value?.status).toBe('fullRunning');
    expect(flow.indeterminate.value).toBe(false);
  });

  it('does not change reference identity while full approval is pending', async () => {
    const pending = deferred<ReturnType<typeof mutation>>();
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: previewRun() }),
        approve: async () => pending.promise,
      }),
      createIdempotencyKey: () => 'approve-key',
    });

    await flow.selectReference(reference());
    const approval = flow.approveFull();
    await flow.selectReference(otherReference());

    expect(flow.selectedReference.value?.id).toBe('reference-1');
    expect(flow.error.value).toContain('current reference operation');
    pending.resolve(mutation(approvedRun(), 'approve-key'));
    await approval;
  });

  it('blocks full approval while preview diagnostics contain a blocking notice', async () => {
    const approve = vi.fn();
    const blocked = previewRun();
    const blockingDiagnostic = {
      id: 'diagnostic-blocking',
      severity: 'error' as const,
      code: 'preview.copy-risk',
      message: 'The preview contains source-overlap risk.',
      blocking: true,
      evidenceRefs: ['pointer-1'],
      pointerId: 'pointer-1',
    };
    blocked.diagnostics = [blockingDiagnostic];
    blocked.preview = {
      ...blocked.preview!,
      diagnostics: [blockingDiagnostic],
    };
    const flow = useReferenceDeconstruction({
      client: client({
        active: async () => ({ run: blocked }),
        approve,
      }),
    });

    await flow.selectReference(reference());
    expect(flow.canApprove.value).toBe(false);
    await flow.approveFull();
    expect(approve).not.toHaveBeenCalled();
  });

  it('aborts the local request on dispose without claiming a server cancellation', async () => {
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    const started = deferred<void>();
    const flow = useReferenceDeconstruction({
      client: client({
        cancel,
        async create() {
          return mutation(createdRun(), 'create-key');
        },
        async advance(_referenceId, _runId, _input, options) {
          signal = options?.signal;
          started.resolve();
          await waitForAbort(options?.signal);
          throw new Error('disposed');
        },
      }),
      createIdempotencyKey: (operation) => operation === 'preview-create'
        ? 'create-key'
        : 'advance-key',
    });

    await flow.selectReference(reference());
    const start = flow.startPreview();
    await started.promise;
    flow.dispose();
    await start;

    expect(signal?.aborted).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(flow.run.value?.status).not.toBe('cancelled');
  });
});

function client(overrides: {
  create?: ReferenceDeconstructionClient['createReferenceDeconstructionRun'];
  get?: ReferenceDeconstructionClient['getReferenceDeconstructionRun'];
  active?: ReferenceDeconstructionClient['getActiveReferenceDeconstructionRun'];
  advance?: ReferenceDeconstructionClient['advanceReferenceDeconstructionRun'];
  pause?: ReferenceDeconstructionClient['pauseReferenceDeconstructionRun'];
  resume?: ReferenceDeconstructionClient['resumeReferenceDeconstructionRun'];
  retry?: ReferenceDeconstructionClient['retryReferenceDeconstructionRun'];
  cancel?: ReferenceDeconstructionClient['cancelReferenceDeconstructionRun'];
  approve?: ReferenceDeconstructionClient['approveFullReferenceDeconstructionRun'];
} = {}): ReferenceDeconstructionClient {
  return {
    createReferenceDeconstructionRun: overrides.create ?? (async () =>
      mutation(createdRun(), 'create-key')),
    getReferenceDeconstructionRun: overrides.get ?? (async () => ({ run: createdRun() })),
    getActiveReferenceDeconstructionRun: overrides.active ?? (async () => ({ run: null })),
    advanceReferenceDeconstructionRun: overrides.advance ?? (async () =>
      mutation(previewRun(), 'advance-key')),
    pauseReferenceDeconstructionRun: overrides.pause ?? (async () =>
      mutation(pausedFullRun(), 'pause-key')),
    resumeReferenceDeconstructionRun: overrides.resume ?? (async () =>
      mutation(resumedFullRun(), 'resume-key')),
    retryReferenceDeconstructionRun: overrides.retry ?? (async () =>
      mutation(retriedFullRun(), 'retry-key')),
    cancelReferenceDeconstructionRun: overrides.cancel ?? (async () =>
      mutation(cancelledRun(), 'cancel-key')),
    approveFullReferenceDeconstructionRun: overrides.approve ?? (async () =>
      mutation(approvedRun(), 'approve-key')),
  };
}

function reference(): ReferenceWorkSummary {
  return {
    id: 'reference-1',
    title: 'Reference One',
    sourceType: 'novel',
    rights: 'owned',
    allowedUsage: ['analysisOnly', 'noDirectQuotation'],
    enabled: true,
    importedAt: '2026-07-22T00:00:00.000Z',
    checksumSha256: 'a'.repeat(64),
    bundlePath: 'examples/references/reference-1',
    summaryPath: 'examples/references/reference-1/context/reference-summary.md',
    distilledPaths: [],
    chapterCount: 2,
    structureConfidence: 'high',
    progress: {
      version: 1,
      referenceId: 'reference-1',
      status: 'notAnalyzed',
      currentStage: null,
      nextStage: 'quickPreview',
      completedStages: ['detectStructure'],
      failedStages: [],
      stages: {
        detectStructure: 'completed',
        quickPreview: 'notStarted',
        chapterAnalysis: 'notStarted',
        aggregateAnalysis: 'notStarted',
        styleProfile: 'notStarted',
        distillForOan: 'notStarted',
        qualityGate: 'notStarted',
      },
      resumable: true,
      contextEligible: false,
      updatedAt: '2026-07-22T00:00:00.000Z',
    },
    deconstructionStatus: 'notAnalyzed',
    contextEligible: false,
    readinessReason: 'notAnalyzed',
  };
}

function otherReference(): ReferenceWorkSummary {
  const base = reference();
  return {
    ...base,
    id: 'reference-2',
    title: 'Reference Two',
    bundlePath: 'examples/references/reference-2',
    summaryPath: 'examples/references/reference-2/context/reference-summary.md',
    progress: { ...base.progress, referenceId: 'reference-2' },
  };
}

function createdRun(): ReferenceDeconstructionRun {
  return baseRun({
    status: 'created',
    runRevision: 0,
    mutationReceipts: [receipt('create-key', 0, 'created', '1')],
  });
}

function runningRun(): ReferenceDeconstructionRun {
  return baseRun({
    status: 'previewRunning',
    runRevision: 1,
    mutationReceipts: [
      receipt('create-key', 0, 'created', '1'),
      receipt('advance-key', 1, 'previewRunning', '2'),
    ],
  });
}

function interruptedRun(): ReferenceDeconstructionRun {
  return baseRun({
    status: 'interrupted',
    runRevision: 1,
    mutationReceipts: [
      receipt('create-key', 0, 'created', '1'),
      receipt('advance-key', 1, 'interrupted', '2'),
    ],
  });
}

function cancelledRun(): ReferenceDeconstructionRun {
  return baseRun({
    status: 'cancelled',
    runRevision: 2,
    mutationReceipts: [
      receipt('create-key', 0, 'created', '1'),
      receipt('advance-key', 1, 'previewRunning', '2'),
      receipt('cancel-key', 2, 'cancelled', '4'),
    ],
  });
}

function previewRun(
  runRevision = 1,
  mutationReceipts = [
    receipt('create-key', 0, 'created', '1'),
    receipt('advance-key', 1, 'awaitingFullApproval', '5'),
  ],
): ReferenceDeconstructionRun {
  const evidence = [{
    id: 'pointer-1',
    pointer: {
      referenceId: 'reference-1',
      sourceChecksumSha256: 'a'.repeat(64),
      chapterId: '0001',
      chunkId: 'chunk-0001-0001',
      lineStart: 1,
      lineEnd: 20,
    },
  }];
  return baseRun({
    status: 'awaitingFullApproval',
    runRevision,
    mutationReceipts,
    evidence,
    preview: {
      version: 1,
      runId: 'run-1',
      referenceId: 'reference-1',
      sourceChecksumSha256: 'a'.repeat(64),
      sourceOverview: 'Bounded opening preview.',
      chapterPreviews: [{
        id: 'chapter-preview-1',
        chapterId: '0001',
        summary: 'Pressure arrives early.',
        evidenceRefs: ['pointer-1'],
        confidence: 'high',
      }],
      findings: [],
      borrowablePatterns: [],
      doNotCopy: ['Do not copy source prose.'],
      differentiationRequirements: ['Change conflict and setting.'],
      differentiationPrompts: ['What belongs to this novel?'],
      canonContaminationWarnings: ['Reference facts are not canon.'],
      confidence: 'high',
      uncertainties: [],
      coverage: {
        selectedChapterIds: ['0001'],
        analyzedChapterIds: ['0001'],
        selectedPointerCount: 1,
        citedPointerCount: 1,
        chapterCoveragePercent: 100,
      },
      diagnostics: [],
    },
  });
}

function approvedRun(): ReferenceDeconstructionRun {
  const preview = previewRun();
  return {
    ...preview,
    status: 'fullApproved',
    runRevision: 2,
    mutationReceipts: [
      ...preview.mutationReceipts,
      receipt('approve-key', 2, 'fullApproved', '6'),
    ],
    receiptCount: 3,
    full: initialFull(),
    updatedAt: '2026-07-22T00:02:00.000Z',
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
  };
}

function fullRunningRun(): ReferenceDeconstructionRun {
  const approved = approvedRun();
  const nextUnit = chapterUnit({
    id: 'chapter-0002',
    ordinal: 1,
    chapterId: '0002',
    chunkId: 'chapter-0002-chunk-0001',
  });
  return {
    ...approved,
    status: 'fullRunning',
    runRevision: 3,
    mutationReceipts: [
      ...approved.mutationReceipts,
      receipt('full-advance-key', 3, 'fullRunning', '7'),
    ],
    receiptCount: 4,
    full: {
      ...initialFull(),
      stages: [
        fullStage('chapterAnalysis', 'running', 2, 1),
        fullStage('aggregateAnalysis', 'notStarted', 1),
        fullStage('styleProfile', 'notStarted', 1),
        fullStage('qualityGate', 'notStarted', 1),
      ],
      progress: fullProgress(1, 0, 1),
      nextUnit,
      recentUnits: [
        chapterUnit({
          status: 'completed',
          attemptCount: 1,
          selectedAttemptId: 'chapter-0001-attempt-0001',
        }),
        nextUnit,
      ],
      recentAttempts: [{
        id: 'chapter-0001-attempt-0001',
        unitId: 'chapter-0001',
        attemptNumber: 1,
        status: 'completed',
        inputFingerprint: 'c'.repeat(64),
        outputHash: 'd'.repeat(64),
        startedAt: '2026-07-22T00:02:01.000Z',
        completedAt: '2026-07-22T00:03:00.000Z',
      }],
    },
    updatedAt: '2026-07-22T00:03:00.000Z',
  };
}

function activeFullUnitRun(): ReferenceDeconstructionRun {
  const running = fullRunningRun();
  const currentUnit = chapterUnit({
    id: 'chapter-0002',
    ordinal: 1,
    chapterId: '0002',
    chunkId: 'chapter-0002-chunk-0001',
    status: 'running',
    attemptCount: 1,
  });
  return {
    ...running,
    full: {
      ...running.full!,
      currentUnit,
      nextUnit: undefined,
      recentUnits: [currentUnit],
      recentAttempts: [{
        id: 'chapter-0002-attempt-0001',
        unitId: currentUnit.id,
        attemptNumber: 1,
        status: 'running',
        inputFingerprint: 'e'.repeat(64),
        startedAt: '2026-07-22T00:03:01.000Z',
      }],
    },
  };
}

function pausedFullRun(): ReferenceDeconstructionRun {
  const running = fullRunningRun();
  return {
    ...running,
    status: 'paused',
    runRevision: 4,
    mutationReceipts: [
      ...running.mutationReceipts,
      receipt('pause-key', 4, 'paused', '8'),
    ],
    receiptCount: 5,
    updatedAt: '2026-07-22T00:04:00.000Z',
  };
}

function resumedFullRun(): ReferenceDeconstructionRun {
  const paused = pausedFullRun();
  const running = fullRunningRun();
  return {
    ...running,
    runRevision: 5,
    mutationReceipts: [
      ...paused.mutationReceipts,
      receipt('resume-key', 5, 'fullRunning', '9'),
    ],
    receiptCount: 6,
    updatedAt: '2026-07-22T00:05:00.000Z',
  };
}

function failedFullRun(): ReferenceDeconstructionRun {
  const approved = approvedRun();
  const failedUnit = chapterUnit({ status: 'failed', attemptCount: 1 });
  return {
    ...approved,
    status: 'failed',
    runRevision: 3,
    diagnostics: [{
      id: 'full-failed',
      severity: 'error',
      code: 'full.provider_failed',
      message: 'The bounded chapter unit failed.',
      blocking: true,
      evidenceRefs: [],
      stageId: 'chapterAnalysis',
      chapterId: '0001',
      unitId: failedUnit.id,
      attemptId: 'chapter-0001-attempt-0001',
    }],
    mutationReceipts: [
      ...approved.mutationReceipts,
      receipt('failed-key', 3, 'failed', 'a'),
    ],
    receiptCount: 4,
    full: {
      ...initialFull(),
      stages: [
        fullStage('chapterAnalysis', 'failed', 2, 0, 1),
        fullStage('aggregateAnalysis', 'notStarted', 1),
        fullStage('styleProfile', 'notStarted', 1),
        fullStage('qualityGate', 'notStarted', 1),
      ],
      progress: fullProgress(0, 1, 0),
      nextUnit: undefined,
      failedUnit,
      recentUnits: [failedUnit],
      recentAttempts: [{
        id: 'chapter-0001-attempt-0001',
        unitId: failedUnit.id,
        attemptNumber: 1,
        status: 'failed',
        inputFingerprint: 'e'.repeat(64),
        startedAt: '2026-07-22T00:02:01.000Z',
        completedAt: '2026-07-22T00:03:00.000Z',
      }],
      analysisQuality: {
        status: 'notEvaluated',
        coveragePercent: 0,
        blockingDiagnosticCount: 1,
        outputHashes: [],
      },
    },
    updatedAt: '2026-07-22T00:03:00.000Z',
  };
}

function retriedFullRun(): ReferenceDeconstructionRun {
  const failed = failedFullRun();
  const nextUnit = chapterUnit({ attemptCount: 1 });
  return {
    ...failed,
    status: 'fullRunning',
    runRevision: 4,
    diagnostics: [],
    mutationReceipts: [
      ...failed.mutationReceipts,
      receipt('retry-key', 4, 'fullRunning', 'b'),
    ],
    receiptCount: 5,
    full: {
      ...failed.full!,
      stages: [
        fullStage('chapterAnalysis', 'queued', 2),
        fullStage('aggregateAnalysis', 'notStarted', 1),
        fullStage('styleProfile', 'notStarted', 1),
        fullStage('qualityGate', 'notStarted', 1),
      ],
      progress: fullProgress(0, 0, 0),
      nextUnit,
      failedUnit: undefined,
      recentUnits: [nextUnit],
      analysisQuality: {
        status: 'notEvaluated',
        coveragePercent: 0,
        blockingDiagnosticCount: 0,
        outputHashes: [],
      },
    },
    updatedAt: '2026-07-22T00:04:00.000Z',
  };
}

function baseRun(
  patch: Partial<ReferenceDeconstructionRun>,
): ReferenceDeconstructionRun {
  const mutationReceipts = patch.mutationReceipts ?? [];
  return {
    schemaVersion: 1,
    id: 'run-1',
    referenceId: 'reference-1',
    runRevision: 0,
    status: 'created',
    sourceChecksumSha256: 'a'.repeat(64),
    structureFingerprint: 'b'.repeat(64),
    pipelineVersion: 1,
    capabilityVersion: 'novel.deconstruct_reference@1',
    selectedChapterIds: ['0001'],
    evidence: [],
    diagnostics: [],
    mutationReceipts,
    receiptCount: mutationReceipts.length,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...patch,
  };
}

function initialFull(): ReferenceDeconstructionFullRun {
  const nextUnit = chapterUnit();
  return {
    stages: [
      fullStage('chapterAnalysis', 'queued', 2),
      fullStage('aggregateAnalysis', 'notStarted', 1),
      fullStage('styleProfile', 'notStarted', 1),
      fullStage('qualityGate', 'notStarted', 1),
    ],
    progress: fullProgress(0, 0, 0),
    nextUnit,
    recentUnits: [nextUnit],
    recentAttempts: [],
    analysisQuality: {
      status: 'notEvaluated',
      coveragePercent: 0,
      blockingDiagnosticCount: 0,
      outputHashes: [],
    },
  };
}

function chapterUnit(
  patch: Partial<ReferenceDeconstructionFullRun['recentUnits'][number]> = {},
): ReferenceDeconstructionFullRun['recentUnits'][number] {
  return {
    id: 'chapter-0001',
    ordinal: 0,
    stageId: 'chapterAnalysis',
    kind: 'chapterChunk',
    chapterId: '0001',
    chunkId: 'chapter-0001-chunk-0001',
    status: 'queued',
    attemptCount: 0,
    ...patch,
  };
}

function fullStage(
  stageId: ReferenceDeconstructionFullRun['stages'][number]['stageId'],
  status: ReferenceDeconstructionFullRun['stages'][number]['status'],
  plannedUnits: number,
  completedUnits = 0,
  failedUnits = 0,
): ReferenceDeconstructionFullRun['stages'][number] {
  return { stageId, status, plannedUnits, completedUnits, failedUnits };
}

function fullProgress(
  completedUnits: number,
  failedUnits: number,
  completedChapters: number,
): ReferenceDeconstructionFullRun['progress'] {
  return {
    plannedUnits: 5,
    completedUnits,
    failedUnits,
    completedChapters,
    totalChapters: 2,
    percent: Math.round((completedUnits / 5) * 100),
  };
}

function receipt(
  idempotencyKey: string,
  resultingRunRevision: number,
  resultStatus: ReferenceDeconstructionRun['status'],
  fingerprintSeed: string,
): ReferenceDeconstructionMutationReceipt {
  return {
    idempotencyKey,
    requestFingerprint: fingerprintSeed.repeat(64),
    resultingRunRevision,
    resultStatus,
  };
}

function mutation(run: ReferenceDeconstructionRun, idempotencyKey: string) {
  return {
    run,
    receipt: run.mutationReceipts.find((item) => item.idempotencyKey === idempotencyKey) ??
      run.mutationReceipts.at(-1)!,
    replayed: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), {
    once: true,
  }));
}
