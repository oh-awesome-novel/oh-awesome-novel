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
      version: 2,
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

export function materialOnlyPublishedReferenceFixture(): ReferenceWorkSummary {
  const reference = referenceFixture({
    deconstructionStatus: 'completed',
    contextEligible: false,
    readinessReason: 'techniqueTrackNotPublished',
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
        'materialChapterAnalysis',
        'materialAggregateAnalysis',
        'materialProjection',
        'qualityGate',
      ],
      stages: {
        detectStructure: 'completed',
        quickPreview: 'completed',
        materialChapterAnalysis: 'completed',
        materialAggregateAnalysis: 'completed',
        materialProjection: 'completed',
        qualityGate: 'completed',
      },
      resumable: false,
      contextEligible: false,
    },
    publishedContext: {
      runId: 'run-material-1',
      fingerprint: 'f'.repeat(64),
      entryCount: 0,
      categoryCounts: {
        writingStyle: 0,
        pacing: 0,
        hooks: 0,
        scene: 0,
        character: 0,
      },
    },
  };
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

export function materialPublicationFixture(): ReferenceDeconstructionPublicationView {
  return {
    candidateFingerprint: 'a'.repeat(64),
    files: [{
      path: 'examples/references.yaml',
      checksumSha256: '1'.repeat(64),
      kind: 'index',
    }, {
      path: 'examples/references/reference-1/deconstruction-manifest.yaml',
      checksumSha256: '2'.repeat(64),
      kind: 'manifest',
    }, {
      path: 'examples/references/reference-1/deconstruction/material-aggregate.md',
      checksumSha256: '3'.repeat(64),
      kind: 'deconstruction',
    }, {
      path: 'examples/references/reference-1/materials/world.yaml',
      checksumSha256: '4'.repeat(64),
      kind: 'materials',
    }, {
      path: 'examples/references/reference-1/materials/characters.yaml',
      checksumSha256: '5'.repeat(64),
      kind: 'materials',
    }],
    entryInventory: [],
    materialInventory: [{
      id: 'material-world-gate',
      materialKind: 'world',
      title: 'The winter gate opens once each solstice',
      assertionType: 'fact',
      confidence: 'high',
      path: 'materials/world.yaml',
    }, {
      id: 'material-world-cost',
      materialKind: 'world',
      title: 'Opening the gate consumes a keeper memory',
      assertionType: 'interpretation',
      confidence: 'medium',
      path: 'materials/world.yaml',
    }, {
      id: 'material-character-courier',
      materialKind: 'characters',
      title: 'The courier wants to expose the hidden council',
      assertionType: 'uncertain',
      confidence: 'low',
      path: 'materials/characters.yaml',
    }],
    preparedAt: '2026-07-22T00:08:30.000Z',
  };
}

export function referencePublishPendingActionFixture(): ReferencePublishPendingActionView {
  return {
    id: 'pending-reference-publish-1',
    title: 'Publish Reference One deconstruction',
    description: 'Publish the accepted deep-deconstruction candidate.',
    changes: referencePublicationFixture().files
      .map((file) => ({
        operation: 'update' as const,
        path: file.path,
        oldHash: '0'.repeat(64),
        newHash: file.checksumSha256,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
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
      version: 2,
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

export function materialPreviewReferenceRun(): ReferenceDeconstructionRun {
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
  return baseReferenceRun({
    status: 'awaitingFullApproval',
    profileId: 'fanfictionWriting',
    outputs: ['world', 'characters'],
    runRevision: 1,
    evidence,
    mutationReceipts: [
      receipt('create-key', 0, 'created', '1'),
      receipt('material-preview-key', 1, 'awaitingFullApproval', '2'),
    ],
    materialPreview: {
      version: 2,
      runId: 'run-1',
      referenceId: 'reference-1',
      sourceChecksumSha256: 'a'.repeat(64),
      track: 'storyMaterial',
      materialKinds: ['world', 'characters'],
      items: [{
        id: 'coverage-world-1',
        materialKind: 'world',
        coverage: 'substantial',
        summary: 'The opening establishes a concrete rule and its cost.',
        confidence: 'high',
        evidenceRefs: ['pointer-1'],
      }, {
        id: 'coverage-characters-1',
        materialKind: 'characters',
        coverage: 'partial',
        summary: 'One character goal is visible, while later development is unknown.',
        confidence: 'medium',
        evidenceRefs: ['pointer-1'],
        uncertainty: 'Only the opening window was inspected.',
      }],
      uncertainties: ['Relationship and timeline coverage were not selected.'],
    },
  });
}

export function materialReviewReadyReferenceRun(): ReferenceDeconstructionRun {
  const preview = materialPreviewReferenceRun();
  const units: ReferenceDeconstructionFullRun['recentUnits'] = [{
    id: 'material-chapter-0001',
    ordinal: 1,
    track: 'storyMaterial',
    stageId: 'materialChapterAnalysis',
    kind: 'chapterChunk',
    chapterId: '0001',
    chunkId: 'chunk-0001-0001',
    status: 'completed',
    attemptCount: 1,
    selectedAttemptId: 'material-chapter-0001-attempt-1',
  }, {
    id: 'material-aggregate',
    ordinal: 2,
    track: 'storyMaterial',
    stageId: 'materialAggregateAnalysis',
    kind: 'aggregate',
    status: 'completed',
    attemptCount: 1,
    selectedAttemptId: 'material-aggregate-attempt-1',
  }, {
    id: 'material-projection',
    ordinal: 3,
    track: 'storyMaterial',
    stageId: 'materialProjection',
    kind: 'materialProjection',
    status: 'completed',
    attemptCount: 1,
    selectedAttemptId: 'material-projection-attempt-1',
  }, {
    id: 'material-quality',
    ordinal: 4,
    track: 'storyMaterial',
    stageId: 'qualityGate',
    kind: 'analysisQuality',
    status: 'completed',
    attemptCount: 1,
    selectedAttemptId: 'material-quality-attempt-1',
  }];
  const attempts: ReferenceDeconstructionFullRun['recentAttempts'] = units.map(
    (unit, index) => ({
      id: unit.selectedAttemptId!,
      unitId: unit.id,
      attemptNumber: 1,
      status: 'completed',
      inputFingerprint: (index + 1).toString(16).repeat(64),
      outputHash: (index + 10).toString(16).repeat(64),
      startedAt: `2026-07-22T00:0${index + 2}:00.000Z`,
      completedAt: `2026-07-22T00:0${index + 2}:30.000Z`,
    }),
  );
  const fullReceipts = units.map((_, index) => receipt(
    `material-full-${index + 1}`,
    index + 3,
    index === units.length - 1 ? 'reviewReady' : 'fullRunning',
    ['4', '5', '6', '7'][index]!,
  ));
  return {
    ...preview,
    status: 'reviewReady',
    runRevision: 6,
    mutationReceipts: [
      ...preview.mutationReceipts,
      receipt('material-approve', 2, 'fullApproved', '3'),
      ...fullReceipts,
    ],
    receiptCount: 7,
    full: {
      stages: [{
        track: 'storyMaterial',
        stageId: 'materialChapterAnalysis',
        status: 'completed',
        plannedUnits: 1,
        completedUnits: 1,
        failedUnits: 0,
      }, {
        track: 'storyMaterial',
        stageId: 'materialAggregateAnalysis',
        status: 'completed',
        plannedUnits: 1,
        completedUnits: 1,
        failedUnits: 0,
      }, {
        track: 'storyMaterial',
        stageId: 'materialProjection',
        status: 'completed',
        plannedUnits: 1,
        completedUnits: 1,
        failedUnits: 0,
      }, {
        track: 'storyMaterial',
        stageId: 'qualityGate',
        status: 'completed',
        plannedUnits: 1,
        completedUnits: 1,
        failedUnits: 0,
      }],
      progress: {
        plannedUnits: 4,
        completedUnits: 4,
        failedUnits: 0,
        completedChapters: 1,
        totalChapters: 1,
        percent: 100,
      },
      recentUnits: units,
      recentAttempts: attempts,
      analysisQuality: {
        storyMaterial: {
          status: 'passed',
          coveragePercent: 100,
          blockingDiagnosticCount: 0,
          outputHashes: attempts.map((attempt) => attempt.outputHash!),
        },
      },
    },
    fullApprovedAt: '2026-07-22T00:02:00.000Z',
    updatedAt: '2026-07-22T00:05:30.000Z',
  };
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
    ordinal: 2,
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
        stage('distillForOan', 'notStarted', 1),
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
        stage('distillForOan', 'notStarted', 1),
        stage('qualityGate', 'notStarted', 1),
      ],
      progress: progress(0, 1, 0),
      nextUnit: undefined,
      failedUnit,
      recentUnits: [failedUnit],
      recentAttempts: [failedAttempt],
      analysisQuality: {
        technique: {
          status: 'notEvaluated',
          coveragePercent: 0,
          blockingDiagnosticCount: 1,
          outputHashes: [],
        },
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
        stage('distillForOan', 'notStarted', 1),
        stage('qualityGate', 'notStarted', 1),
      ],
      progress: progress(0, 0, 0),
      nextUnit,
      failedUnit: undefined,
      recentUnits: [nextUnit],
      analysisQuality: {
        technique: {
          status: 'notEvaluated',
          coveragePercent: 0,
          blockingDiagnosticCount: 0,
          outputHashes: [],
        },
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
      ordinal: 2,
      chapterId: '0002',
      chunkId: 'chapter-0002-chunk-0001',
      status: 'completed',
      attemptCount: 1,
      selectedAttemptId: 'chapter-0002-attempt-0001',
    }),
    nonChapterUnit('aggregate-root', 3, 'aggregateAnalysis', 'aggregate'),
    nonChapterUnit('style-profile', 4, 'styleProfile', 'style'),
    nonChapterUnit('distill-for-oan', 5, 'distillForOan', 'distill'),
    nonChapterUnit('analysis-quality', 6, 'qualityGate', 'analysisQuality'),
  ];
  const attempts = units.map((unit, index) => ({
    id: unit.selectedAttemptId!,
    unitId: unit.id,
    attemptNumber: 1,
    status: 'completed' as const,
    inputFingerprint: (index + 1).toString(16).repeat(64),
    outputHash: (index + 10).toString(16).repeat(64),
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
        technique: {
          status: 'warned',
          coveragePercent: 100,
          blockingDiagnosticCount: 0,
          outputHashes: attempts.map((attempt) => attempt.outputHash),
        },
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
    schemaVersion: 2,
    id: 'run-1',
    referenceId: 'reference-1',
    runRevision: 0,
    status: 'created',
    sourceChecksumSha256: 'a'.repeat(64),
    structureFingerprint: 'b'.repeat(64),
    pipelineVersion: 2,
    capabilityVersion: 'novel.deconstruct_reference@2',
    profileId: 'commercialWriting',
    outputs: ['techniques'],
    selectedChapterIds: ['0001'],
    evidence: [{
      id: 'pointer-1',
      pointer: {
        referenceId: 'reference-1',
        sourceChecksumSha256: 'a'.repeat(64),
        chapterId: '0001',
        chunkId: 'chunk-0001-0001',
        lineStart: 4,
        lineEnd: 22,
      },
    }],
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
      stage('distillForOan', 'notStarted', 1),
      stage('qualityGate', 'notStarted', 1),
    ],
    progress: progress(0, 0, 0),
    nextUnit,
    recentUnits: [nextUnit],
    recentAttempts: [],
    analysisQuality: {
      technique: {
        status: 'notEvaluated',
        coveragePercent: 0,
        blockingDiagnosticCount: 0,
        outputHashes: [],
      },
    },
  };
}

function chapterUnit(
  patch: Partial<ReferenceDeconstructionFullRun['recentUnits'][number]> = {},
): ReferenceDeconstructionFullRun['recentUnits'][number] {
  return {
    id: 'chapter-0001',
    ordinal: 1,
    track: 'technique',
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
  stageId: 'aggregateAnalysis' | 'styleProfile' | 'distillForOan' | 'qualityGate',
  kind: 'aggregate' | 'style' | 'distill' | 'analysisQuality',
): ReferenceDeconstructionFullRun['recentUnits'][number] {
  return {
    id,
    ordinal,
    track: 'technique',
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
  return {
    track: 'technique',
    stageId,
    status,
    plannedUnits,
    completedUnits,
    failedUnits,
  };
}

function progress(
  completedUnits: number,
  failedUnits: number,
  completedChapters: number,
): ReferenceDeconstructionFullRun['progress'] {
  return {
    plannedUnits: 6,
    completedUnits,
    failedUnits,
    completedChapters,
    totalChapters: 2,
    percent: Math.round((completedUnits / 6) * 100),
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
