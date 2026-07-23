import type {
  ReferenceContextSelection,
  ReferenceDeconstructionMutationReceipt,
  ReferenceDeconstructionRun,
  ReferenceWorkSummary,
} from '@oh-awesome-novel/client';

export function referenceFixture(
  patch: Partial<ReferenceWorkSummary> = {},
): ReferenceWorkSummary {
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
    ...patch,
  };
}

export function referenceContextFixture(): ReferenceContextSelection {
  return {
    tokenBudget: 1500,
    originalSourceRead: false,
    noCopyWarnings: ['Use technique abstractions only; never copy source prose.'],
    included: [],
    omitted: [{
      id: 'reference-1',
      title: 'Reference One',
      reason: 'Deep deconstruction has not been published.',
      budgetLayer: 'L2',
      deconstructionStatus: 'notAnalyzed',
      contextEligible: false,
      reasonCode: 'notAnalyzed',
    }],
  };
}

export function createdReferenceRun(
  createKey = 'create-key',
): ReferenceDeconstructionRun {
  return baseReferenceRun({
    status: 'created',
    mutationReceipts: [receipt(createKey, 0, 'created', '1')],
  });
}

export function previewReferenceRun(
  createKey = 'create-key',
  advanceKey = 'advance-key',
): ReferenceDeconstructionRun {
  const evidence = [{
    id: 'pointer-1',
    pointer: {
      referenceId: 'reference-1',
      sourceChecksumSha256: 'a'.repeat(64),
      chapterId: '0001',
      chunkId: 'chunk-0001-0001',
      lineStart: 4,
      lineEnd: 22,
    },
  }];
  const diagnostics = [{
    id: 'diagnostic-1',
    code: 'preview.low-sample',
    severity: 'warning' as const,
    blocking: false,
    message: 'Only the bounded opening sample was analyzed.',
    evidenceRefs: ['pointer-1'],
    stageId: 'quickPreview' as const,
    chapterId: '0001',
    pointerId: 'pointer-1',
  }];
  return baseReferenceRun({
    status: 'awaitingFullApproval',
    runRevision: 1,
    evidence,
    diagnostics,
    mutationReceipts: [
      receipt(createKey, 0, 'created', '1'),
      receipt(advanceKey, 1, 'awaitingFullApproval', '2'),
    ],
    preview: {
      version: 1,
      runId: 'run-1',
      referenceId: 'reference-1',
      sourceChecksumSha256: 'a'.repeat(64),
      sourceOverview: 'A bounded preview of the opening pressure and scene movement.',
      chapterPreviews: [{
        id: 'chapter-preview-1',
        chapterId: '0001',
        summary: 'The opening establishes pressure before expanding the situation.',
        evidenceRefs: ['pointer-1'],
        confidence: 'high',
        uncertainty: 'Later chapters may change the apparent pattern.',
      }],
      findings: [{
        id: 'finding-1',
        kind: 'hook',
        observation: 'A concrete disruption arrives before exposition broadens.',
        technique: 'Lead with a bounded disturbance, then layer context around its consequences.',
        whenUseful: 'When an opening needs immediate forward pressure.',
        avoid: 'Do not reproduce the source situation or phrasing.',
        confidence: 'medium',
        evidenceRefs: ['pointer-1'],
        generalInference: false,
        uncertainty: 'The small sample cannot establish a whole-book rule.',
      }],
      borrowablePatterns: [{
        id: 'pattern-1',
        title: 'Pressure before explanation',
        technique: 'Introduce an actionable disturbance before backstory.',
        whenUseful: 'Opening a chapter with a clear change in state.',
        evidenceRefs: ['pointer-1'],
        confidence: 'high',
      }],
      doNotCopy: ['Do not copy source wording, names, scenes, or dialogue.'],
      differentiationRequirements: ['Change the conflict, setting, causality, and character roles.'],
      differentiationPrompts: ['What pressure can only arise from the current novel canon?'],
      canonContaminationWarnings: ['Reference facts are evidence, never current novel canon.'],
      confidence: 'medium',
      uncertainties: ['Only one bounded chapter window was analyzed.'],
      coverage: {
        selectedChapterIds: ['0001'],
        analyzedChapterIds: ['0001'],
        selectedPointerCount: 1,
        citedPointerCount: 1,
        chapterCoveragePercent: 100,
      },
      diagnostics,
    },
  });
}

export function approvedReferenceRun(
  createKey = 'create-key',
  advanceKey = 'advance-key',
  approveKey = 'approve-key',
): ReferenceDeconstructionRun {
  const preview = previewReferenceRun(createKey, advanceKey);
  return {
    ...preview,
    status: 'fullApproved',
    runRevision: 2,
    mutationReceipts: [
      ...preview.mutationReceipts,
      receipt(approveKey, 2, 'fullApproved', '3'),
    ],
    updatedAt: '2026-07-22T00:02:00.000Z',
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
  };
}

export function mutationResult(
  run: ReferenceDeconstructionRun,
  idempotencyKey: string,
) {
  return {
    run,
    receipt: run.mutationReceipts.find((item) => item.idempotencyKey === idempotencyKey) ??
      run.mutationReceipts.at(-1)!,
    replayed: false,
  };
}

function baseReferenceRun(
  patch: Partial<ReferenceDeconstructionRun>,
): ReferenceDeconstructionRun {
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
    mutationReceipts: [],
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...patch,
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
