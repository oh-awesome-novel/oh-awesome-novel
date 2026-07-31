import type {
  ReferenceDeconstructionFullRun,
  ReferenceContextSelection,
  ReferenceDeconstructionMutationReceipt,
  ReferenceDeconstructionRun,
  ReferenceWorkSummary,
} from '@oh-awesome-novel/client';
import type {
  ReferenceDeconstructionPublicationView,
  ReferencePublishPendingActionView,
} from '../../../../apps/desktop-ui/src/composables/useReferenceDeconstruction';

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

export function publishedReferenceFixture(): ReferenceWorkSummary {
  const reference = referenceFixture({
    distilledPaths: [
      'examples/references/reference-1/distilled/writing-style.md',
      'examples/references/reference-1/distilled/pacing.md',
      'examples/references/reference-1/distilled/hooks.md',
      'examples/references/reference-1/distilled/scene-techniques.md',
      'examples/references/reference-1/distilled/character-techniques.md',
    ],
    deconstructionStatus: 'completed',
    contextEligible: true,
    readinessReason: 'ready',
  });
  return {
    ...reference,
    progress: {
      ...reference.progress,
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
      stages: {
        detectStructure: 'completed',
        quickPreview: 'completed',
        chapterAnalysis: 'completed',
        aggregateAnalysis: 'completed',
        styleProfile: 'completed',
        distillForOan: 'completed',
        qualityGate: 'completed',
      },
      contextEligible: true,
    },
    publishedContext: {
      runId: 'run-1',
      fingerprint: 'e'.repeat(64),
      entryCount: 5,
      categoryCounts: {
        writingStyle: 1,
        pacing: 1,
        hooks: 1,
        scene: 1,
        character: 1,
      },
    },
  } as ReferenceWorkSummary;
}

export function referenceContextFixture(): ReferenceContextSelection {
  return {
    tokenBudget: 1500,
    maxReferences: 3,
    maxEntries: 8,
    usedTokens: 0,
    originalSourceRead: false,
    noCopyWarnings: ['Use technique abstractions only; never copy source prose.'],
    differentiationWarnings: ['Change canon-specific causes, roles, and imagery.'],
    included: [],
    omitted: [{
      scope: 'reference',
      referenceId: 'reference-1',
      referenceTitle: 'Reference One',
      reason: 'Deep deconstruction has not been published.',
      budgetLayer: 'L2',
      deconstructionStatus: 'notAnalyzed',
      contextEligible: false,
      reasonCode: 'notAnalyzed',
    }],
  };
}

export function entryReferenceContextFixture(): ReferenceContextSelection {
  return {
    tokenBudget: 240,
    maxReferences: 2,
    maxEntries: 4,
    usedTokens: 142,
    originalSourceRead: false,
    noCopyWarnings: [
      'Use technique abstractions only; never copy source prose.',
      'Change canon-specific causes, roles, and imagery.',
    ],
    differentiationWarnings: [
      'Change the setting, causality, role assignment, and image system.',
    ],
    included: [{
      id: 'hooks-1',
      referenceId: 'reference-1',
      referenceTitle: 'Reference One',
      entryTitle: 'Consequence-first hook',
      category: 'hooks',
      path: 'examples/references/reference-1/distilled/hooks.md',
      tags: ['opening', 'consequence'],
      capabilityIds: ['novel.write_chapter'],
      reason: 'Hook intent and capability matched.',
      reasonCode: 'capabilityMatch',
      estimatedTokens: 68,
      content: 'Frame the hook around a consequence that demands a choice.',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
    }, {
      id: 'scene-1',
      referenceId: 'reference-1',
      referenceTitle: 'Reference One',
      entryTitle: 'Scene value turn',
      category: 'scene',
      path: 'examples/references/reference-1/distilled/scene-techniques.md',
      tags: ['scene', 'turn'],
      capabilityIds: ['novel.write_chapter'],
      reason: 'Scene goal tokens matched.',
      reasonCode: 'taskMatch',
      estimatedTokens: 74,
      content: 'Give the scene a visible value change caused by a character choice.',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
    }],
    omitted: [{
      scope: 'entry',
      referenceId: 'reference-1',
      referenceTitle: 'Reference One',
      entryId: 'pacing-1',
      entryTitle: 'Pressure-release pacing',
      category: 'pacing',
      reason: 'Hard token budget would be exceeded.',
      reasonCode: 'tokenBudgetExceeded',
      estimatedTokens: 74,
      budgetLayer: 'L2',
      deconstructionStatus: 'completed',
      contextEligible: false,
    }, {
      scope: 'reference',
      referenceId: 'reference-2',
      referenceTitle: 'Disabled Reference',
      reason: 'Reference preference is disabled.',
      reasonCode: 'disabled',
      budgetLayer: 'L3',
      deconstructionStatus: 'completed',
      contextEligible: false,
    }],
  };
}

export function referencePublicationFixture(
  patch: Partial<ReferenceDeconstructionPublicationView> = {},
): ReferenceDeconstructionPublicationView {
  return {
    candidateFingerprint: 'f'.repeat(64),
    files: [
      {
        path: 'examples/references.yaml',
        checksumSha256: '1'.repeat(64),
        kind: 'index',
      },
      {
        path: 'examples/references/reference-1/deconstruction-manifest.yaml',
        checksumSha256: '2'.repeat(64),
        kind: 'manifest',
      },
      {
        path: 'examples/references/reference-1/distilled/hooks.md',
        checksumSha256: '3'.repeat(64),
        kind: 'distilled',
      },
      {
        path: 'examples/references/reference-1/context/index.yaml',
        checksumSha256: '4'.repeat(64),
        kind: 'context',
      },
    ],
    entryInventory: [
      distilledEntry('writing-style-1', 'writingStyle', 'Controlled sentence contrast', 82),
      distilledEntry('pacing-1', 'pacing', 'Pressure-release pacing', 74),
      distilledEntry('hooks-1', 'hooks', 'Consequence-first hook', 68),
      distilledEntry('scene-1', 'scene', 'Scene value turn', 76),
      distilledEntry('character-1', 'character', 'Choice-led characterization', 80),
    ],
    preparedAt: '2026-07-22T00:08:30.000Z',
    ...patch,
  };
}

export function referencePublishPendingActionFixture(): ReferencePublishPendingActionView {
  return {
    id: 'pending-reference-publish-1',
    title: 'Publish Reference One deconstruction',
    description: 'Publish the accepted deep-deconstruction candidate.',
    touchedFiles: referencePublicationFixture().files.map((file) => file.path),
    diff: 'diff --git a/examples/references.yaml b/examples/references.yaml',
    createdAt: '2026-07-22T00:09:00.000Z',
    status: 'pending',
    origin: {
      kind: 'referenceDeconstructionPublish',
      referenceId: 'reference-1',
      runId: 'run-1',
      runRevision: 8,
      candidateFingerprint: 'f'.repeat(64),
    },
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
    receiptCount: 3,
    full: fullReferenceFixture(),
    updatedAt: '2026-07-22T00:02:00.000Z',
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
  };
}

export function runningFullReferenceRun(
  fullAdvanceKey = 'full-advance-key',
): ReferenceDeconstructionRun {
  const approved = approvedReferenceRun();
  const completedUnit = chapterUnit({
    status: 'completed',
    attemptCount: 1,
    selectedAttemptId: 'chapter-0001-attempt-0001',
  });
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
      receipt(fullAdvanceKey, 3, 'fullRunning', '4'),
    ],
    receiptCount: 4,
    full: {
      ...fullReferenceFixture(),
      stages: [
        stage('chapterAnalysis', 'running', 2, 1),
        stage('aggregateAnalysis', 'notStarted', 1),
        stage('styleProfile', 'notStarted', 1),
        stage('qualityGate', 'notStarted', 1),
      ],
      progress: progress(1, 0, 1),
      nextUnit,
      recentUnits: [completedUnit, nextUnit],
      recentAttempts: [completedAttempt()],
    },
    updatedAt: '2026-07-22T00:03:00.000Z',
  };
}

export function pausedFullReferenceRun(
  pauseKey = 'pause-key',
): ReferenceDeconstructionRun {
  const running = runningFullReferenceRun();
  return {
    ...running,
    status: 'paused',
    runRevision: 4,
    mutationReceipts: [
      ...running.mutationReceipts,
      receipt(pauseKey, 4, 'paused', '5'),
    ],
    receiptCount: 5,
    updatedAt: '2026-07-22T00:04:00.000Z',
  };
}

export function failedFullReferenceRun(
  fullAdvanceKey = 'full-failed-key',
): ReferenceDeconstructionRun {
  const approved = approvedReferenceRun();
  const failedUnit = chapterUnit({
    status: 'failed',
    attemptCount: 1,
  });
  const failedAttempt = {
    id: 'chapter-0001-attempt-0001',
    unitId: failedUnit.id,
    attemptNumber: 1,
    status: 'failed' as const,
    inputFingerprint: 'd'.repeat(64),
    startedAt: '2026-07-22T00:03:00.000Z',
    completedAt: '2026-07-22T00:03:30.000Z',
  };
  const diagnostic = {
    id: 'full-unit-failed-chapter-0001-1',
    severity: 'error' as const,
    code: 'full.provider_failed',
    message: 'The bounded chapter unit failed.',
    blocking: true,
    evidenceRefs: [],
    stageId: 'chapterAnalysis' as const,
    chapterId: '0001',
    unitId: failedUnit.id,
    attemptId: failedAttempt.id,
  };
  return {
    ...approved,
    status: 'failed',
    runRevision: 3,
    diagnostics: [...approved.diagnostics, diagnostic],
    mutationReceipts: [
      ...approved.mutationReceipts,
      receipt(fullAdvanceKey, 3, 'failed', '6'),
    ],
    receiptCount: 4,
    full: {
      ...fullReferenceFixture(),
      stages: [
        stage('chapterAnalysis', 'failed', 2, 0, 1),
        stage('aggregateAnalysis', 'notStarted', 1),
        stage('styleProfile', 'notStarted', 1),
        stage('qualityGate', 'notStarted', 1),
      ],
      progress: progress(0, 1, 0),
      nextUnit: undefined,
      failedUnit,
      recentUnits: [failedUnit],
      recentAttempts: [failedAttempt],
      analysisQuality: {
        status: 'notEvaluated',
        coveragePercent: 0,
        blockingDiagnosticCount: 1,
        outputHashes: [],
      },
    },
    updatedAt: '2026-07-22T00:03:30.000Z',
  };
}

export function retriedFullReferenceRun(
  retryKey = 'retry-key',
): ReferenceDeconstructionRun {
  const failed = failedFullReferenceRun();
  const nextUnit = chapterUnit({ attemptCount: 1 });
  return {
    ...failed,
    status: 'fullRunning',
    runRevision: 4,
    diagnostics: [],
    mutationReceipts: [
      ...failed.mutationReceipts,
      receipt(retryKey, 4, 'fullRunning', '7'),
    ],
    receiptCount: 5,
    full: {
      ...failed.full!,
      stages: [
        stage('chapterAnalysis', 'queued', 2),
        stage('aggregateAnalysis', 'notStarted', 1),
        stage('styleProfile', 'notStarted', 1),
        stage('qualityGate', 'notStarted', 1),
      ],
      progress: progress(0, 0, 0),
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

export function reviewReadyReferenceRun(): ReferenceDeconstructionRun {
  const approved = approvedReferenceRun();
  const units = [
    chapterUnit({
      status: 'completed',
      attemptCount: 1,
      selectedAttemptId: 'chapter-0001-attempt-0001',
    }),
    chapterUnit({
      id: 'chapter-0002',
      ordinal: 1,
      chapterId: '0002',
      chunkId: 'chapter-0002-chunk-0001',
      status: 'completed',
      attemptCount: 1,
      selectedAttemptId: 'chapter-0002-attempt-0001',
    }),
    nonChapterUnit('aggregate-root', 2, 'aggregateAnalysis', 'aggregate'),
    nonChapterUnit('style-profile', 3, 'styleProfile', 'style'),
    nonChapterUnit('distill-for-oan', 4, 'distillForOan', 'distill'),
    nonChapterUnit('analysis-quality', 5, 'qualityGate', 'analysisQuality'),
  ];
  const attempts = units.map((unit, index) => ({
    id: unit.selectedAttemptId!,
    unitId: unit.id,
    attemptNumber: 1,
    status: 'completed' as const,
    inputFingerprint: String(index + 1).repeat(64),
    outputHash: String(index + 5).repeat(64),
    startedAt: `2026-07-22T00:0${index + 3}:00.000Z`,
    completedAt: `2026-07-22T00:0${index + 3}:30.000Z`,
  }));
  const fullReceipts = units.map((_, index) =>
    receipt(
      `full-advance-${index + 1}`,
      index + 3,
      index === units.length - 1 ? 'reviewReady' : 'fullRunning',
      ['8', '9', 'a', 'b', 'c', 'd'][index]!,
    ));
  return {
    ...approved,
    status: 'reviewReady',
    runRevision: 8,
    mutationReceipts: [...approved.mutationReceipts, ...fullReceipts],
    receiptCount: 9,
    full: {
      stages: [
        stage('chapterAnalysis', 'completed', 2, 2),
        stage('aggregateAnalysis', 'completed', 1, 1),
        stage('styleProfile', 'completed', 1, 1),
        stage('distillForOan', 'completed', 1, 1),
        stage('qualityGate', 'completed', 1, 1),
      ],
      progress: progress(6, 0, 2),
      recentUnits: units,
      recentAttempts: attempts,
      analysisQuality: {
        status: 'warned',
        coveragePercent: 100,
        blockingDiagnosticCount: 0,
        outputHashes: attempts.map((attempt) => attempt.outputHash),
      },
    },
    updatedAt: '2026-07-22T00:08:30.000Z',
  };
}

export function publishingReferenceRun(
  publishKey = 'publish-key',
): ReferenceDeconstructionRun {
  const reviewReady = reviewReadyReferenceRun();
  return {
    ...reviewReady,
    status: 'publishing',
    runRevision: reviewReady.runRevision + 1,
    mutationReceipts: [
      ...reviewReady.mutationReceipts,
      receipt(
        publishKey,
        reviewReady.runRevision + 1,
        'publishing',
        'e',
      ),
    ],
    receiptCount: reviewReady.receiptCount + 1,
    publication: referencePublicationFixture({
      pendingActionId: 'pending-reference-publish-1',
    }),
    updatedAt: '2026-07-22T00:09:00.000Z',
  } as ReferenceDeconstructionRun;
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

function fullReferenceFixture(): ReferenceDeconstructionFullRun {
  const nextUnit = chapterUnit();
  return {
    stages: [
      stage('chapterAnalysis', 'queued', 2),
      stage('aggregateAnalysis', 'notStarted', 1),
      stage('styleProfile', 'notStarted', 1),
      stage('qualityGate', 'notStarted', 1),
    ],
    progress: progress(0, 0, 0),
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

function nonChapterUnit(
  id: string,
  ordinal: number,
  stageId: 'aggregateAnalysis' | 'styleProfile' | 'qualityGate',
  kind: 'aggregate' | 'style' | 'analysisQuality',
): ReferenceDeconstructionFullRun['recentUnits'][number] {
  return {
    id,
    ordinal,
    stageId,
    kind,
    status: 'completed',
    attemptCount: 1,
    selectedAttemptId: `${id}-attempt-0001`,
  };
}

function completedAttempt(): ReferenceDeconstructionFullRun['recentAttempts'][number] {
  return {
    id: 'chapter-0001-attempt-0001',
    unitId: 'chapter-0001',
    attemptNumber: 1,
    status: 'completed',
    inputFingerprint: 'c'.repeat(64),
    outputHash: 'e'.repeat(64),
    startedAt: '2026-07-22T00:02:01.000Z',
    completedAt: '2026-07-22T00:03:00.000Z',
  };
}

function stage(
  stageId: ReferenceDeconstructionFullRun['stages'][number]['stageId'],
  status: ReferenceDeconstructionFullRun['stages'][number]['status'],
  plannedUnits: number,
  completedUnits = 0,
  failedUnits = 0,
): ReferenceDeconstructionFullRun['stages'][number] {
  return { stageId, status, plannedUnits, completedUnits, failedUnits };
}

function progress(
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

function distilledEntry(
  id: string,
  category: ReferenceDeconstructionPublicationView['entryInventory'][number]['category'],
  title: string,
  estimatedTokens: number,
): ReferenceDeconstructionPublicationView['entryInventory'][number] {
  return { id, category, title, estimatedTokens };
}
