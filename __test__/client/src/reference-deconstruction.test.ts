import { describe, expect, it, vi } from 'vitest';

import {
  createOanClient,
  type ReferenceContextSelection,
  type ReferenceDeconstructionFullRun,
  type ReferenceDeconstructionMutationReceipt,
  type ReferenceDeconstructionPublishResult,
  type ReferenceDeconstructionRun,
  type ReferenceImportResult,
  type ReferenceWorkSummary,
} from '@oh-awesome-novel/client';

describe('reference deconstruction client', () => {
  it('routes strict D0 context and D1 run requests with their typed identities', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url.endsWith('/api/workspace/references')) {
        return json({ references: [referenceSummary()] });
      }
      if (url.endsWith('/api/workspace/references/context')) {
        return json({ selection: contextSelection() });
      }
      if (url.endsWith('/deconstruction-runs/active')) {
        return json({ run: run('created') });
      }
      if (url.endsWith('/deconstruction-runs/run-1')) {
        return json({ run: run('created') });
      }
      if (url.endsWith('/deconstruction-runs')) {
        return json(mutationResult(run('created'), body.idempotencyKey as string));
      }
      if (url.endsWith('/advance')) {
        return json(mutationResult(previewRun(), body.idempotencyKey as string));
      }
      if (url.endsWith('/pause')) {
        return json(mutationResult(fullMutationRun(
          'paused',
          body.idempotencyKey as string,
          body.baseRunRevision as number,
        ), body.idempotencyKey as string));
      }
      if (url.endsWith('/resume')) {
        return json(mutationResult(fullMutationRun(
          'fullRunning',
          body.idempotencyKey as string,
          body.baseRunRevision as number,
        ), body.idempotencyKey as string));
      }
      if (url.endsWith('/retry')) {
        return json(mutationResult(fullMutationRun(
          'fullRunning',
          body.idempotencyKey as string,
          body.baseRunRevision as number,
        ), body.idempotencyKey as string));
      }
      if (url.endsWith('/cancel')) {
        return json(mutationResult(terminalRun(
          'cancelled',
          body.idempotencyKey as string,
          body.baseRunRevision as number,
        ), body.idempotencyKey as string));
      }
      if (url.endsWith('/approve-full')) {
        return json(mutationResult(approvedRun(body.idempotencyKey as string),
          body.idempotencyKey as string));
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const client = createOanClient({ backendBaseUrl: 'http://backend.test', fetch: fetcher });

    await expect(client.listReferences()).resolves.toEqual({
      references: [referenceSummary()],
    });
    await client.selectReferenceContext({
      tokenBudget: 800,
      maxReferences: 2,
      capability: 'novel.write_chapter',
      goal: 'Open with pressure.',
      explicitReferenceIds: ['reference-1'],
    });
    await client.createReferenceDeconstructionRun('reference-1', {
      mode: 'quickPreview',
      baseRunRevision: 0,
      idempotencyKey: 'create-1',
      selectedChapterIds: ['0001'],
      confirmDetectedRange: true,
    });
    await client.getActiveReferenceDeconstructionRun('reference-1');
    await client.getReferenceDeconstructionRun('reference-1', 'run-1');
    const controller = new AbortController();
    await client.advanceReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 0,
      idempotencyKey: 'advance-1',
    }, { signal: controller.signal });
    await client.pauseReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 2,
      idempotencyKey: 'pause-1',
    });
    await client.resumeReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 2,
      idempotencyKey: 'resume-1',
    });
    await client.retryReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 2,
      idempotencyKey: 'retry-1',
      unitId: 'chapter-0001-chunk-001',
    });
    await client.cancelReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 0,
      idempotencyKey: 'cancel-1',
    });
    await client.approveFullReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 1,
      idempotencyKey: 'approve-1',
    });

    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      tokenBudget: 800,
      maxReferences: 2,
      capability: 'novel.write_chapter',
      goal: 'Open with pressure.',
      explicitReferenceIds: ['reference-1'],
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      mode: 'quickPreview',
      baseRunRevision: 0,
      idempotencyKey: 'create-1',
      selectedChapterIds: ['0001'],
      confirmDetectedRange: true,
    });
    expect(calls.map((call) => call.url)).toEqual([
      'http://backend.test/api/workspace/references',
      'http://backend.test/api/workspace/references/context',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/active',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/advance',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/pause',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/resume',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/retry',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/cancel',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/approve-full',
    ]);
    expect(calls[5]?.init?.signal).toBe(controller.signal);
    expect(JSON.parse(String(calls[8]?.init?.body))).toEqual({
      baseRunRevision: 2,
      idempotencyKey: 'retry-1',
      unitId: 'chapter-0001-chunk-001',
    });
  });

  it('strictly validates import identity, manifest version, and source fingerprint', async () => {
    const valid = importResult();
    const responses = [
      valid,
      { ...valid, manifest: { ...valid.manifest, version: 2 } },
      { ...valid, manifest: { ...valid.manifest, referenceId: 'another-reference' } },
      { ...valid, manifest: { ...valid.manifest, structureFingerprint: 'not-a-hash' } },
    ];
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch(responses),
    });
    const input = { title: 'Reference', sourceText: 'Chapter 1\nText.' };

    await expect(client.importReference(input)).resolves.toEqual(valid);
    await expect(client.importReference(input)).rejects.toThrow('invalid payload');
    await expect(client.importReference(input)).rejects.toThrow('inconsistent payload');
    await expect(client.importReference(input)).rejects.toThrow('invalid payload');
  });

  it('routes publish to a strict run-bound PendingAction receipt', async () => {
    const valid = publishResult();
    const wrongOrigin = publishResult();
    wrongOrigin.pendingAction.origin = {
      ...wrongOrigin.pendingAction.origin,
      referenceId: 'reference-other',
    };
    const mismatchedFingerprint = publishResult();
    mismatchedFingerprint.pendingAction.origin = {
      ...mismatchedFingerprint.pendingAction.origin,
      candidateFingerprint: 'd'.repeat(64),
    };
    const oversizedInventory = publishResult();
    oversizedInventory.run.publication!.entryInventory[0] = {
      ...oversizedInventory.run.publication!.entryInventory[0]!,
      estimatedTokens: 2_049,
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [valid, wrongOrigin, mismatchedFingerprint, oversizedInventory];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return json(responses.shift());
    }) as unknown as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
    });
    const input = {
      baseRunRevision: 7,
      idempotencyKey: 'publish-1',
    };

    await expect(client.publishReferenceDeconstructionRun(
      'reference-1',
      'run-1',
      input,
    )).resolves.toEqual(valid);
    await expect(client.publishReferenceDeconstructionRun(
      'reference-1',
      'run-1',
      input,
    )).rejects.toThrow('invalid payload');
    await expect(client.publishReferenceDeconstructionRun(
      'reference-1',
      'run-1',
      input,
    )).rejects.toThrow('inconsistent payload');
    await expect(client.publishReferenceDeconstructionRun(
      'reference-1',
      'run-1',
      input,
    )).rejects.toThrow('invalid payload');
    expect(calls[0]).toMatchObject({
      url:
        'http://backend.test/api/workspace/references/reference-1/' +
        'deconstruction-runs/run-1/publish',
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(input);
  });

  it('requires an exact structure confidence in every reference summary', async () => {
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch([
        { references: [{ ...referenceSummary(), structureConfidence: 'uncertain' }] },
        { references: [{ ...referenceSummary(), structureConfidence: undefined }] },
        {
          references: [{
            ...referenceSummary(),
            summaryPath: 'examples/references/reference-1/sources/original.txt',
          }],
        },
        {
          references: [{
            ...referenceSummary(),
            distilledPaths: ['examples/references/reference-1/sources/original.txt'],
          }],
        },
      ]),
    });

    await expect(client.listReferences()).rejects.toThrow('invalid payload');
    await expect(client.listReferences()).rejects.toThrow('invalid payload');
    await expect(client.listReferences()).rejects.toThrow('invalid payload');
    await expect(client.listReferences()).rejects.toThrow('invalid payload');
  });

  it('accepts stale invalid-index readiness and enforces distilled inventory bounds', async () => {
    const staleBase = referenceSummary();
    const staleInvalidIndex = referenceSummary({
      progress: {
        ...staleBase.progress,
        status: 'stale',
        contextEligible: false,
      },
      deconstructionStatus: 'stale',
      contextEligible: false,
      readinessReason: 'invalidContextIndex',
    });
    const published = publishedReferenceSummary();
    const missingCategoryEntry = publishedReferenceSummary({
      entryCount: 4,
      categoryCounts: {
        writingStyle: 0,
        pacing: 1,
        hooks: 1,
        scene: 1,
        character: 1,
      },
    });
    const oversizedCategory = publishedReferenceSummary({
      entryCount: 17,
      categoryCounts: {
        writingStyle: 13,
        pacing: 1,
        hooks: 1,
        scene: 1,
        character: 1,
      },
    });
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch([
        { references: [staleInvalidIndex] },
        { references: [published] },
        { references: [missingCategoryEntry] },
        { references: [oversizedCategory] },
      ]),
    });

    await expect(client.listReferences()).resolves.toEqual({
      references: [staleInvalidIndex],
    });
    await expect(client.listReferences()).resolves.toEqual({
      references: [published],
    });
    await expect(client.listReferences()).rejects.toThrow('invalid payload');
    await expect(client.listReferences()).rejects.toThrow('invalid payload');
  });

  it('fails closed on unknown schema/status, broken evidence closure, and conflicting receipts', async () => {
    const valid = previewRun();
    const malformed = [
      { ...valid, schemaVersion: 2 },
      { ...valid, status: 'futureStatus' },
      {
        ...valid,
        preview: {
          ...valid.preview,
          findings: [{
            ...valid.preview!.findings[0],
            evidenceRefs: ['unknown-pointer'],
          }],
        },
      },
      {
        ...valid,
        runRevision: 0,
        mutationReceipts: valid.mutationReceipts,
      },
      {
        ...valid,
        runRevision: 2,
        mutationReceipts: [
          valid.mutationReceipts[0]!,
          {
            ...valid.mutationReceipts[1]!,
            resultingRunRevision: 2,
          },
        ],
      },
    ];

    for (const payload of malformed) {
      const client = createOanClient({
        backendBaseUrl: 'http://backend.test',
        fetch: sequenceFetch([{ run: payload }]),
      });
      await expect(client.getReferenceDeconstructionRun('reference-1', 'run-1'))
        .rejects.toThrow('invalid payload');
    }
  });

  it('accepts a bounded D2/D3 full summary and a non-zero receipt window', async () => {
    const valid = reviewReadyRun(70);
    const replayReceipt: ReferenceDeconstructionMutationReceipt = {
      idempotencyKey: 'old-replayed-command',
      requestFingerprint: '9'.repeat(64),
      resultingRunRevision: 2,
      resultStatus: 'fullApproved',
    };
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch([
        { run: valid },
        {
          run: valid,
          receipt: replayReceipt,
          replayed: true,
        },
      ]),
    });

    await expect(client.getReferenceDeconstructionRun('reference-1', 'run-1'))
      .resolves.toEqual({ run: valid });
    await expect(client.pauseReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 70,
      idempotencyKey: 'old-replayed-command',
    })).resolves.toMatchObject({
      run: { status: 'reviewReady', receiptCount: 71 },
      receipt: replayReceipt,
      replayed: true,
    });
    expect(valid.mutationReceipts).toHaveLength(64);
    expect(valid.mutationReceipts[0]?.resultingRunRevision).toBe(7);
    expect(valid.mutationReceipts.at(-1)?.resultingRunRevision).toBe(70);
  });

  it('fails closed on inconsistent full progress, unit, attempt, quality, and receipt windows', async () => {
    const cases: ReferenceDeconstructionRun[] = [];

    const missingFull = reviewReadyRun();
    delete missingFull.full;
    cases.push(missingFull);

    const wrongPercent = reviewReadyRun();
    wrongPercent.full!.progress.percent = 99;
    cases.push(wrongPercent);

    const unknownUnitKind = reviewReadyRun();
    unknownUnitKind.full!.recentUnits[0]!.kind = 'futureUnit' as never;
    cases.push(unknownUnitKind);

    const unknownAttemptStatus = reviewReadyRun();
    unknownAttemptStatus.full!.recentAttempts[0]!.status = 'futureAttempt' as never;
    cases.push(unknownAttemptStatus);

    const unknownQualityStatus = reviewReadyRun();
    unknownQualityStatus.full!.analysisQuality!.status = 'futureQuality' as never;
    cases.push(unknownQualityStatus);

    const failedQualityAtReview = reviewReadyRun();
    failedQualityAtReview.full!.analysisQuality = {
      status: 'failed',
      coveragePercent: 100,
      blockingDiagnosticCount: 0,
      outputHashes: ['1'.repeat(64)],
    };
    cases.push(failedQualityAtReview);

    const inconsistentStageTotals = reviewReadyRun();
    inconsistentStageTotals.full!.stages[0]!.plannedUnits = 3;
    cases.push(inconsistentStageTotals);

    const oversizedRecentWindow = reviewReadyRun();
    oversizedRecentWindow.full!.recentUnits = Array.from({ length: 65 }, (_, index) => ({
      ...oversizedRecentWindow.full!.recentUnits[0]!,
      id: `oversized-unit-${index}`,
      ordinal: index,
      selectedAttemptId: `oversized-attempt-${index}`,
    }));
    cases.push(oversizedRecentWindow);

    const gappedReceiptWindow = reviewReadyRun(70);
    gappedReceiptWindow.mutationReceipts[1] = {
      ...gappedReceiptWindow.mutationReceipts[1]!,
      resultingRunRevision: 9,
    };
    cases.push(gappedReceiptWindow);

    for (const payload of cases) {
      const client = createOanClient({
        backendBaseUrl: 'http://backend.test',
        fetch: sequenceFetch([{ run: payload }]),
      });
      await expect(client.getReferenceDeconstructionRun('reference-1', 'run-1'))
        .rejects.toThrow('invalid payload');
    }
  });

  it('accepts diagnostics without optional location fields', async () => {
    const valid = previewRun();
    const diagnostic = {
      id: 'diagnostic-general',
      severity: 'warning' as const,
      code: 'preview.general_notice',
      message: 'This notice applies to the preview as a whole.',
      blocking: false,
      evidenceRefs: [],
    };
    const payload = {
      ...valid,
      diagnostics: [diagnostic],
      preview: {
        ...valid.preview!,
        diagnostics: [diagnostic],
      },
    };
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch([{ run: payload }]),
    });

    await expect(client.getReferenceDeconstructionRun('reference-1', 'run-1'))
      .resolves.toEqual({ run: payload });
  });

  it('rejects selector payloads that include incomplete references or exceed the hard budget', async () => {
    const incomplete = contextSelection();
    incomplete.included[0] = {
      ...incomplete.included[0]!,
      deconstructionStatus: 'notAnalyzed' as 'completed',
      contextEligible: false as true,
    };
    const overBudget = contextSelection();
    overBudget.tokenBudget = 10;
    const sourcePath = contextSelection();
    sourcePath.included[0] = {
      ...sourcePath.included[0]!,
      path: 'examples/references/reference-1/sources/original.txt',
      content: 'Source text must never pass the distilled context guard.',
    };
    const oversizedEntry = contextSelection();
    oversizedEntry.included[0] = {
      ...oversizedEntry.included[0]!,
      estimatedTokens: 2_049,
    };
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch([
        { selection: incomplete },
        { selection: overBudget },
        { selection: sourcePath },
        { selection: oversizedEntry },
      ]),
    });

    await expect(client.selectReferenceContext()).rejects.toThrow('invalid payload');
    await expect(client.selectReferenceContext()).rejects.toThrow('invalid payload');
    await expect(client.selectReferenceContext()).rejects.toThrow('invalid payload');
    await expect(client.selectReferenceContext()).rejects.toThrow('invalid payload');
  });

  it('accepts entry omissions caused by the max-reference cap', async () => {
    const selection = contextSelection();
    selection.included = [];
    selection.usedTokens = 0;
    selection.omitted = [{
      scope: 'entry',
      referenceId: 'reference-2',
      referenceTitle: 'Reference Two',
      entryId: 'entry-pacing-2',
      entryTitle: 'Pressure-release pacing',
      category: 'pacing',
      reason: 'A higher-ranked reference exhausted the reference cap.',
      budgetLayer: 'L2',
      deconstructionStatus: 'completed',
      contextEligible: false,
      reasonCode: 'maxReferenceCountReached',
      estimatedTokens: 120,
    }];
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch([{ selection }]),
    });

    await expect(client.selectReferenceContext()).resolves.toEqual({ selection });
  });

  it('rejects unsafe request identities before calling fetch', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const client = createOanClient({ backendBaseUrl: 'http://backend.test', fetch: fetcher });

    expect(() => client.createReferenceDeconstructionRun('../escape', {
      mode: 'quickPreview',
      baseRunRevision: 0,
      idempotencyKey: 'create-1',
    })).toThrow('Reference id is invalid');
    expect(() => client.selectReferenceContext({
      explicitReferenceIds: ['reference-1', 'reference-1'],
    })).toThrow('request is invalid');
    expect(() => client.selectReferenceContext({
      maxReferences: 21,
    })).toThrow('request is invalid');
    expect(() => client.selectReferenceContext({
      maxEntries: 51,
    })).toThrow('request is invalid');
    expect(() => client.createReferenceDeconstructionRun('reference-1', {
      mode: 'quickPreview',
      baseRunRevision: 0,
      idempotencyKey: 'create-1',
      confirmDetectedRange: false,
    } as never)).toThrow('create request is invalid');
    expect(() => client.retryReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 2,
      idempotencyKey: 'retry-1',
      unitId: '../escape',
    })).toThrow('retry request is invalid');
    expect(() => client.retryReferenceDeconstructionRun('reference-1', 'run-1', {
      baseRunRevision: 2,
      idempotencyKey: 'retry-1',
      unitId: 'unit-1',
      hidden: true,
    } as never)).toThrow('retry request is invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function referenceSummary(
  overrides: Partial<ReferenceWorkSummary> = {},
): ReferenceWorkSummary {
  const stages = {
    detectStructure: 'completed' as const,
    quickPreview: 'notStarted' as const,
    chapterAnalysis: 'notStarted' as const,
    aggregateAnalysis: 'notStarted' as const,
    styleProfile: 'notStarted' as const,
    distillForOan: 'notStarted' as const,
    qualityGate: 'notStarted' as const,
  };
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
      stages,
      resumable: true,
      contextEligible: false,
      updatedAt: '2026-07-22T00:00:00.000Z',
    },
    deconstructionStatus: 'notAnalyzed',
    contextEligible: false,
    readinessReason: 'notAnalyzed',
    ...overrides,
  };
}

function publishedReferenceSummary(
  publishedContextOverrides: Partial<
    NonNullable<ReferenceWorkSummary['publishedContext']>
  > = {},
): ReferenceWorkSummary {
  const base = referenceSummary();
  return referenceSummary({
    progress: {
      ...base.progress,
      status: 'completed',
      currentStage: null,
      nextStage: null,
      completedStages: [
        'detectStructure',
        'quickPreview',
        'chapterAnalysis',
        'aggregateAnalysis',
        'styleProfile',
        'distillForOan',
        'qualityGate',
      ],
      stages: Object.fromEntries(
        Object.keys(base.progress.stages).map((stage) => [stage, 'completed']),
      ) as ReferenceWorkSummary['progress']['stages'],
      resumable: false,
      contextEligible: true,
    },
    deconstructionStatus: 'completed',
    contextEligible: true,
    readinessReason: 'ready',
    publishedContext: {
      runId: 'run-published-1',
      fingerprint: 'f'.repeat(64),
      entryCount: 5,
      categoryCounts: {
        writingStyle: 1,
        pacing: 1,
        hooks: 1,
        scene: 1,
        character: 1,
      },
      ...publishedContextOverrides,
    },
  });
}

function contextSelection(): ReferenceContextSelection {
  return {
    tokenBudget: 800,
    maxReferences: 2,
    maxEntries: 8,
    usedTokens: 120,
    originalSourceRead: false,
    noCopyWarnings: ['Do not copy source prose.'],
    differentiationWarnings: ['Transform the technique for the current novel.'],
    included: [{
      id: 'entry-pacing-1',
      referenceId: 'reference-1',
      referenceTitle: 'Reference One',
      entryTitle: 'Escalating scene pressure',
      category: 'pacing',
      path: 'examples/references/reference-1/distilled/pacing.md',
      tags: ['pressure', 'escalation'],
      capabilityIds: ['novel.write_chapter'],
      reason: 'Eligible distilled reference.',
      reasonCode: 'explicitReference',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
      estimatedTokens: 120,
      content: 'Abstract technique notes only.',
    }],
    omitted: [],
  };
}

function importResult(): ReferenceImportResult {
  return {
    reference: referenceSummary(),
    manifest: {
      version: 1,
      referenceId: 'reference-1',
      originalFile: 'original.txt',
      originalFileName: 'reference.txt',
      checksumSha256: 'a'.repeat(64),
      structureFingerprint: 'b'.repeat(64),
      importedAt: '2026-07-22T00:00:00.000Z',
      byteLength: 20,
      charLength: 20,
      lineCount: 2,
      detectedStructure: {
        chapterCount: 2,
        confidence: 'high',
        chapters: [
          { id: '0001', title: 'One', lineStart: 1, lineEnd: 1, wordCount: 3 },
          { id: '0002', title: 'Two', lineStart: 2, lineEnd: 2, wordCount: 3 },
        ],
      },
    },
    createdFiles: [
      'examples/references/reference-1/metadata.yaml',
      'examples/references/reference-1/sources/source-manifest.yaml',
      'examples/references.yaml',
    ],
  };
}

function run(status: ReferenceDeconstructionRun['status']): ReferenceDeconstructionRun {
  const receipt: ReferenceDeconstructionMutationReceipt = {
    idempotencyKey: 'create-1',
    requestFingerprint: 'c'.repeat(64),
    resultingRunRevision: 0,
    resultStatus: 'created',
  };
  return {
    schemaVersion: 1,
    id: 'run-1',
    referenceId: 'reference-1',
    runRevision: 0,
    status,
    sourceChecksumSha256: 'a'.repeat(64),
    structureFingerprint: 'b'.repeat(64),
    pipelineVersion: 1,
    capabilityVersion: 'novel.deconstruct_reference@1',
    selectedChapterIds: ['0001'],
    evidence: [{
      id: 'pointer-1',
      pointer: {
        referenceId: 'reference-1',
        sourceChecksumSha256: 'a'.repeat(64),
        chapterId: '0001',
        chunkId: 'chunk-0001-0001',
        lineStart: 1,
        lineEnd: 20,
      },
    }],
    diagnostics: [],
    mutationReceipts: [receipt],
    receiptCount: 1,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function previewRun(): ReferenceDeconstructionRun {
  const advanceReceipt: ReferenceDeconstructionMutationReceipt = {
    idempotencyKey: 'advance-1',
    requestFingerprint: 'd'.repeat(64),
    resultingRunRevision: 1,
    resultStatus: 'awaitingFullApproval',
  };
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
  const diagnostics = [{
    id: 'diagnostic-1',
    severity: 'info' as const,
    code: 'bounded_preview',
    message: 'Only the selected opening was analyzed.',
    blocking: false,
    evidenceRefs: ['pointer-1'],
    stageId: 'quickPreview' as const,
    chapterId: '0001',
    pointerId: 'pointer-1',
  }];
  return {
    ...run('created'),
    runRevision: 1,
    status: 'awaitingFullApproval',
    evidence,
    diagnostics,
    mutationReceipts: [...run('created').mutationReceipts, advanceReceipt],
    receiptCount: 2,
    updatedAt: '2026-07-22T00:01:00.000Z',
    preview: {
      version: 1,
      runId: 'run-1',
      referenceId: 'reference-1',
      sourceChecksumSha256: 'a'.repeat(64),
      sourceOverview: 'A bounded opening preview.',
      chapterPreviews: [{
        id: 'chapter-preview-1',
        chapterId: '0001',
        summary: 'The opening establishes pressure.',
        evidenceRefs: ['pointer-1'],
        confidence: 'high',
      }],
      findings: [{
        id: 'finding-1',
        kind: 'hook',
        observation: 'The deadline appears immediately.',
        technique: 'Surface a bounded external deadline early.',
        confidence: 'high',
        evidenceRefs: ['pointer-1'],
        generalInference: false,
      }],
      borrowablePatterns: [{
        id: 'pattern-1',
        title: 'Early deadline',
        technique: 'Introduce a visible timing constraint.',
        evidenceRefs: ['pointer-1'],
        confidence: 'high',
      }],
      doNotCopy: ['Do not copy the source deadline or wording.'],
      differentiationRequirements: ['Use a different conflict and setting.'],
      differentiationPrompts: ['What pressure belongs uniquely to this novel?'],
      canonContaminationWarnings: ['Reference facts are not OAN canon.'],
      confidence: 'high',
      uncertainties: [],
      coverage: {
        selectedChapterIds: ['0001'],
        analyzedChapterIds: ['0001'],
        selectedPointerCount: 1,
        citedPointerCount: 1,
        chapterCoveragePercent: 100,
      },
      diagnostics,
    },
  };
}

function terminalRun(
  status: 'cancelled' | 'failed' | 'interrupted' | 'stale',
  idempotencyKey: string,
  baseRevision: number,
): ReferenceDeconstructionRun {
  const base = run('created');
  const receipt: ReferenceDeconstructionMutationReceipt = {
    idempotencyKey,
    requestFingerprint: 'e'.repeat(64),
    resultingRunRevision: baseRevision + 1,
    resultStatus: status,
  };
  return {
    ...base,
    runRevision: baseRevision + 1,
    status,
    mutationReceipts: [...base.mutationReceipts, receipt],
    receiptCount: baseRevision + 2,
    updatedAt: '2026-07-22T00:02:00.000Z',
  };
}

function approvedRun(idempotencyKey: string): ReferenceDeconstructionRun {
  const base = previewRun();
  const receipt: ReferenceDeconstructionMutationReceipt = {
    idempotencyKey,
    requestFingerprint: 'f'.repeat(64),
    resultingRunRevision: 2,
    resultStatus: 'fullApproved',
  };
  return {
    ...base,
    runRevision: 2,
    status: 'fullApproved',
    mutationReceipts: [...base.mutationReceipts, receipt],
    receiptCount: 3,
    updatedAt: '2026-07-22T00:02:00.000Z',
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
    full: initialFullRun(),
  };
}

function fullMutationRun(
  status: 'fullRunning' | 'paused',
  idempotencyKey: string,
  baseRevision: number,
): ReferenceDeconstructionRun {
  const resultRevision = baseRevision + 1;
  const receipts = Array.from({ length: resultRevision + 1 }, (_, revision) => ({
    idempotencyKey: revision === resultRevision
      ? idempotencyKey
      : `full-history-${revision}`,
    requestFingerprint: (revision % 16).toString(16).repeat(64),
    resultingRunRevision: revision,
    resultStatus: revision === resultRevision
      ? status
      : revision === 0
        ? 'created' as const
        : revision === 1
          ? 'awaitingFullApproval' as const
          : revision === 2
            ? 'fullApproved' as const
            : 'fullRunning' as const,
  }));
  const preview = previewRun();
  return {
    ...preview,
    runRevision: resultRevision,
    status,
    mutationReceipts: receipts,
    receiptCount: receipts.length,
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
    full: initialFullRun(),
    updatedAt: '2026-07-22T00:03:00.000Z',
  };
}

function initialFullRun(): ReferenceDeconstructionFullRun {
  const nextUnit = {
    id: 'chapter-0001-chunk-001',
    ordinal: 1,
    stageId: 'chapterAnalysis' as const,
    kind: 'chapterChunk' as const,
    chapterId: '0001',
    chunkId: '0001-chunk-001',
    status: 'queued' as const,
    attemptCount: 0,
  };
  return {
    stages: [
      {
        stageId: 'chapterAnalysis',
        status: 'queued',
        plannedUnits: 2,
        completedUnits: 0,
        failedUnits: 0,
      },
      {
        stageId: 'aggregateAnalysis',
        status: 'notStarted',
        plannedUnits: 1,
        completedUnits: 0,
        failedUnits: 0,
      },
      {
        stageId: 'styleProfile',
        status: 'notStarted',
        plannedUnits: 1,
        completedUnits: 0,
        failedUnits: 0,
      },
      {
        stageId: 'distillForOan',
        status: 'notStarted',
        plannedUnits: 1,
        completedUnits: 0,
        failedUnits: 0,
      },
      {
        stageId: 'qualityGate',
        status: 'notStarted',
        plannedUnits: 1,
        completedUnits: 0,
        failedUnits: 0,
      },
    ],
    progress: {
      plannedUnits: 6,
      completedUnits: 0,
      failedUnits: 0,
      completedChapters: 0,
      totalChapters: 2,
      percent: 0,
    },
    nextUnit,
    recentUnits: [nextUnit],
    recentAttempts: [],
  };
}

function reviewReadyRun(runRevision = 7): ReferenceDeconstructionRun {
  const preview = previewRun();
  const units = [
    completedUnit('chapter-0001-chunk-001', 1, 'chapterAnalysis', 'chapterChunk', {
      chapterId: '0001',
      chunkId: '0001-chunk-001',
    }),
    completedUnit('chapter-0002-chunk-001', 2, 'chapterAnalysis', 'chapterChunk', {
      chapterId: '0002',
      chunkId: '0002-chunk-001',
    }),
    completedUnit('aggregate-final', 3, 'aggregateAnalysis', 'aggregate'),
    completedUnit('style-final', 4, 'styleProfile', 'style'),
    completedUnit('distill-final', 5, 'distillForOan', 'distill'),
    completedUnit('quality-final', 6, 'qualityGate', 'analysisQuality'),
  ];
  const attempts = units.map((unit, index) => ({
    id: unit.selectedAttemptId!,
    unitId: unit.id,
    attemptNumber: 1,
    status: 'completed' as const,
    inputFingerprint: ((index + 1) % 10).toString().repeat(64),
    outputHash: (10 + index).toString(16).repeat(64),
    startedAt: `2026-07-22T00:0${index + 3}:00.000Z`,
    completedAt: `2026-07-22T00:0${index + 3}:30.000Z`,
  }));
  const fullDiagnostic = {
    id: 'diagnostic-full-uncertainty',
    severity: 'warning' as const,
    code: 'chapter.uncertainty',
    message: 'A bounded chapter inference remains uncertain.',
    blocking: false,
    evidenceRefs: ['full-pointer-1'],
    stageId: 'chapterAnalysis' as const,
    chapterId: '0001',
    unitId: units[0]!.id,
    attemptId: attempts[0]!.id,
  };
  const firstRevision = Math.max(0, runRevision - 63);
  const receipts = Array.from(
    { length: runRevision - firstRevision + 1 },
    (_, index) => {
      const revision = firstRevision + index;
      return {
        idempotencyKey: `review-history-${revision}`,
        requestFingerprint: (revision % 16).toString(16).repeat(64),
        resultingRunRevision: revision,
        resultStatus: revision === runRevision
          ? 'reviewReady' as const
          : revision === 0
            ? 'created' as const
            : revision === 1
              ? 'awaitingFullApproval' as const
              : revision === 2
                ? 'fullApproved' as const
                : 'fullRunning' as const,
      };
    },
  );
  return {
    ...preview,
    runRevision,
    status: 'reviewReady',
    diagnostics: [...preview.diagnostics, fullDiagnostic],
    mutationReceipts: receipts,
    receiptCount: runRevision + 1,
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
    full: {
      stages: [
        {
          stageId: 'chapterAnalysis',
          status: 'completed',
          plannedUnits: 2,
          completedUnits: 2,
          failedUnits: 0,
        },
        {
          stageId: 'aggregateAnalysis',
          status: 'completed',
          plannedUnits: 1,
          completedUnits: 1,
          failedUnits: 0,
        },
        {
          stageId: 'styleProfile',
          status: 'completed',
          plannedUnits: 1,
          completedUnits: 1,
          failedUnits: 0,
        },
        {
          stageId: 'distillForOan',
          status: 'completed',
          plannedUnits: 1,
          completedUnits: 1,
          failedUnits: 0,
        },
        {
          stageId: 'qualityGate',
          status: 'completed',
          plannedUnits: 1,
          completedUnits: 1,
          failedUnits: 0,
        },
      ],
      progress: {
        plannedUnits: 6,
        completedUnits: 6,
        failedUnits: 0,
        completedChapters: 2,
        totalChapters: 2,
        percent: 100,
      },
      recentUnits: units,
      recentAttempts: attempts,
      analysisQuality: {
        status: 'passed',
        coveragePercent: 100,
        blockingDiagnosticCount: 0,
        outputHashes: attempts.map((attempt) => attempt.outputHash),
      },
    },
    updatedAt: '2026-07-22T00:08:00.000Z',
  };
}

function completedUnit(
  id: string,
  ordinal: number,
  stageId:
    | 'chapterAnalysis'
    | 'aggregateAnalysis'
    | 'styleProfile'
    | 'distillForOan'
    | 'qualityGate',
  kind: 'chapterChunk' | 'aggregate' | 'style' | 'distill' | 'analysisQuality',
  location: { chapterId: string; chunkId: string } | undefined = undefined,
) {
  return {
    id,
    ordinal,
    stageId,
    kind,
    ...(location ?? {}),
    status: 'completed' as const,
    attemptCount: 1,
    selectedAttemptId: `${id}-attempt-1`,
  };
}

function publishResult(): ReferenceDeconstructionPublishResult {
  const base = reviewReadyRun(7);
  const pendingActionId = `pa_${'a'.repeat(64)}`;
  const candidateFingerprint = 'b'.repeat(64);
  const files = [
    {
      path: 'examples/references.yaml',
      checksumSha256: '1'.repeat(64),
      kind: 'index' as const,
    },
    {
      path: 'examples/references/reference-1/deconstruction-manifest.yaml',
      checksumSha256: '2'.repeat(64),
      kind: 'manifest' as const,
    },
    {
      path: 'examples/references/reference-1/diagnostics.yaml',
      checksumSha256: '3'.repeat(64),
      kind: 'diagnostics' as const,
    },
    {
      path: 'examples/references/reference-1/progress.yaml',
      checksumSha256: '4'.repeat(64),
      kind: 'progress' as const,
    },
    {
      path: 'examples/references/reference-1/distilled/writing-style.md',
      checksumSha256: '5'.repeat(64),
      kind: 'distilled' as const,
    },
    {
      path: 'examples/references/reference-1/context/index.yaml',
      checksumSha256: '6'.repeat(64),
      kind: 'context' as const,
    },
  ];
  const entryInventory = ([
    'writingStyle',
    'pacing',
    'hooks',
    'scene',
    'character',
  ] as const).map((category, index) => ({
    id: `entry-${category}`,
    category,
    title: `${category} technique`,
    estimatedTokens: 100 + index,
  }));
  const receipt: ReferenceDeconstructionMutationReceipt = {
    idempotencyKey: 'publish-1',
    requestFingerprint: 'c'.repeat(64),
    resultingRunRevision: 8,
    resultStatus: 'publishing',
  };
  const runValue: ReferenceDeconstructionRun = {
    ...base,
    runRevision: 8,
    status: 'publishing',
    mutationReceipts: [...base.mutationReceipts, receipt],
    receiptCount: 9,
    publication: {
      candidateFingerprint,
      pendingActionId,
      files,
      entryInventory,
      preparedAt: '2026-07-22T00:09:00.000Z',
    },
    updatedAt: '2026-07-22T00:09:00.000Z',
  };
  return {
    run: runValue,
    receipt,
    replayed: false,
    pendingAction: {
      id: pendingActionId,
      title: 'Publish reference reference-1',
      description: 'Publish reviewed deconstruction run run-1.',
      touchedFiles: files.map((file) => file.path),
      diff: 'diff --git a/examples/references.yaml b/examples/references.yaml',
      createdAt: '2026-07-22T00:09:01.000Z',
      status: 'pending',
      origin: {
        kind: 'referenceDeconstructionPublish',
        referenceId: 'reference-1',
        runId: 'run-1',
        runRevision: 7,
        candidateFingerprint,
      },
    },
  };
}

function mutationResult(runValue: ReferenceDeconstructionRun, idempotencyKey: string) {
  const receipt = runValue.mutationReceipts.find((item) =>
    item.idempotencyKey === idempotencyKey) ?? runValue.mutationReceipts.at(-1)!;
  return { run: runValue, receipt, replayed: false };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sequenceFetch(values: unknown[]): typeof fetch {
  let index = 0;
  return vi.fn(async () => json(values[index++])) as unknown as typeof fetch;
}
