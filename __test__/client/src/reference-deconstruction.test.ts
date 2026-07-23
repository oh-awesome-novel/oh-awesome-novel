import { describe, expect, it, vi } from 'vitest';

import {
  createOanClient,
  type ReferenceContextSelection,
  type ReferenceDeconstructionMutationReceipt,
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
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/cancel',
      'http://backend.test/api/workspace/references/reference-1/deconstruction-runs/run-1/approve-full',
    ]);
    expect(calls[5]?.init?.signal).toBe(controller.signal);
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
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: sequenceFetch([
        { selection: incomplete },
        { selection: overBudget },
        { selection: sourcePath },
      ]),
    });

    await expect(client.selectReferenceContext()).rejects.toThrow('invalid payload');
    await expect(client.selectReferenceContext()).rejects.toThrow('invalid payload');
    await expect(client.selectReferenceContext()).rejects.toThrow('invalid payload');
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
    expect(() => client.createReferenceDeconstructionRun('reference-1', {
      mode: 'quickPreview',
      baseRunRevision: 0,
      idempotencyKey: 'create-1',
      confirmDetectedRange: false,
    } as never)).toThrow('create request is invalid');
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

function contextSelection(): ReferenceContextSelection {
  return {
    tokenBudget: 800,
    originalSourceRead: false,
    noCopyWarnings: ['Do not copy source prose.'],
    included: [{
      id: 'reference-1',
      title: 'Reference One',
      path: 'examples/references/reference-1/context/reference-summary.md',
      reason: 'Eligible distilled reference.',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
      estimatedTokens: 120,
      content: 'Abstract technique notes only.',
      deconstructionStatus: 'completed',
      contextEligible: true,
      reasonCode: 'ready',
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
    updatedAt: '2026-07-22T00:02:00.000Z',
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
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
