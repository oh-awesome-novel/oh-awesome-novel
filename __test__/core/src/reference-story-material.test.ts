import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  REFERENCE_STORY_MATERIAL_KINDS,
  collectReferenceStoryMaterialFindings,
  createReferenceDeconstructionPublicationCandidate,
  createReferenceDeconstructionWorkPlan,
  createReferenceStoryMaterialOutputHash,
  detectReferenceStoryMaterialCoverageExactOverlap,
  evaluateReferenceStoryMaterialQuality,
  formatReferenceStoryMaterialCoveragePreviewMarkdown,
  formatReferenceStoryMaterialProjectionYaml,
  normalizeReferenceStoryMaterialAggregateModelOutput,
  normalizeReferenceStoryMaterialChapterModelOutput,
  normalizeReferenceStoryMaterialCoverageModelOutput,
  normalizeReferenceStoryMaterialProjectionModelOutput,
  parseReferenceStoryMaterialAggregateResult,
  parseReferenceStoryMaterialChapterResult,
  parseReferenceStoryMaterialCoveragePreview,
  parseReferenceStoryMaterialProjectionResult,
  parseReferenceStoryMaterialQualityReport,
  referenceStoryMaterialKindPath,
  resolveReferenceChapterWorkUnitWindow,
} from '@oh-awesome-novel/core';
import type {
  ReferenceDeconstructionWorkPlan,
  ReferenceDeconstructionWorkUnit,
  ReferenceQuickPreviewSelection,
  ReferenceStoryMaterialFinding,
  ReferenceStoryMaterialKind,
  ReferenceStoryMaterialQualityOutput,
  ReferenceStoryMaterialQualitySelectedAttempt,
} from '@oh-awesome-novel/core';

describe('Reference Story Material typed contracts', () => {
  it('normalizes a strict five-kind coverage preview with stable ids and evidence', () => {
    const model = {
      items: REFERENCE_STORY_MATERIAL_KINDS.map((materialKind) => ({
        materialKind,
        coverage: 'partial' as const,
        summary: `${materialKind} has bounded source coverage.`,
        confidence: 'medium' as const,
        evidenceRefs: ['material-pointer-001'],
        uncertainty: null,
      })),
      uncertainties: ['Only the selected opening window was inspected.'],
    };
    const options = {
      runId: 'material-run-001',
      selection: quickPreviewSelection(),
      materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
    };

    const first = normalizeReferenceStoryMaterialCoverageModelOutput(model, options);
    const second = normalizeReferenceStoryMaterialCoverageModelOutput(model, options);

    expect(first).toEqual(second);
    expect(first.track).toBe('storyMaterial');
    expect(first.items).toHaveLength(5);
    expect(new Set(first.items.map((item) => item.id))).toHaveLength(5);
    expect(first.items.every((item) =>
      item.evidenceRefs.includes('material-pointer-001'))).toBe(true);
    expect(parseReferenceStoryMaterialCoveragePreview(first, options)).toEqual(first);
    expect(formatReferenceStoryMaterialCoveragePreviewMarkdown(first))
      .toContain('not transferable technique analysis');

    expect(() => normalizeReferenceStoryMaterialCoverageModelOutput({
      ...model,
      technique: 'must not be accepted',
    }, options)).toThrow(/unknown field/u);
  });

  it('reports exact source overlap in Material Coverage as a located warning', () => {
    const overlap = 'The bounded source establishes a named city rule and a precise event order. '
      .repeat(2);
    const selection = quickPreviewSelection();
    selection.windows[0] = {
      ...selection.windows[0]!,
      content: overlap,
      charLength: overlap.length,
    };
    selection.totalChars = overlap.length;
    const preview = normalizeReferenceStoryMaterialCoverageModelOutput({
      items: REFERENCE_STORY_MATERIAL_KINDS.map((materialKind) => ({
        materialKind,
        coverage: 'partial' as const,
        summary: materialKind === 'world'
          ? overlap
          : `${materialKind} has bounded source coverage.`,
        confidence: 'medium' as const,
        evidenceRefs: ['material-pointer-001'],
        uncertainty: null,
      })),
      uncertainties: [],
    }, {
      runId: 'material-run-overlap',
      selection,
      materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
    });

    expect(detectReferenceStoryMaterialCoverageExactOverlap(preview, selection))
      .toEqual([expect.objectContaining({
        code: 'quality.copyRisk.exactOverlap',
        severity: 'warning',
        blocking: false,
        stageId: 'quickPreview',
        pointerId: 'material-pointer-001',
        evidenceRefs: ['material-pointer-001'],
      })]);
  });

  it('allows only the five canonical YAML material publication targets', () => {
    const createCandidate = (materialPath: string) =>
      createReferenceDeconstructionPublicationCandidate({
        referenceId: 'reference-material-001',
        runId: 'material-run-publication',
        runRevision: 8,
        files: [
          ['examples/references.yaml', 'index', 'version: 1\nreferences: []'],
          [
            'examples/references/reference-material-001/deconstruction-manifest.yaml',
            'manifest',
            'version: 2',
          ],
          [
            'examples/references/reference-material-001/diagnostics.yaml',
            'diagnostics',
            'version: 2',
          ],
          [
            'examples/references/reference-material-001/progress.yaml',
            'progress',
            'version: 2',
          ],
          [
            `examples/references/reference-material-001/${materialPath}`,
            'materials',
            'version: 2',
          ],
        ].map(([path, kind, content]) => ({
          path: path!,
          kind: kind as 'index' | 'manifest' | 'diagnostics' | 'progress' | 'materials',
          content: content!,
        })),
        entries: [],
        preparedAt: '2026-07-31T12:00:00.000Z',
      });

    expect(createCandidate('materials/world.yaml').files)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'examples/references/reference-material-001/materials/world.yaml',
          kind: 'materials',
        }),
      ]));
    expect(() => createCandidate('materials/world.md')).toThrow(/not allowed/u);
    expect(() => createCandidate('materials/future.yaml')).toThrow(/not allowed/u);
  });

  it('creates chapter findings only from a Story Material chapter unit and current pointer', () => {
    const unit = chapterUnit();
    const options = {
      runId: 'material-run-chapter',
      unit,
      materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
      allowedPointers: {
        'material-pointer-001': unit.pointer!,
      },
    };
    const model = chapterModelOutput();
    const result = normalizeReferenceStoryMaterialChapterModelOutput(model, options);

    expect(result.track).toBe('storyMaterial');
    expect(result.findings).toHaveLength(5);
    expect(result.findings.every((finding) =>
      finding.track === 'storyMaterial'
      && finding.evidenceRefs[0] === 'material-pointer-001'
      && finding.sourceFindingRefs.length === 0)).toBe(true);
    expect(parseReferenceStoryMaterialChapterResult(result, options)).toEqual(result);

    expect(() => normalizeReferenceStoryMaterialChapterModelOutput(model, {
      ...options,
      unit: { ...unit, track: 'technique', stageId: 'chapterAnalysis' },
    })).toThrow(/requires a storyMaterial/u);
    expect(() => normalizeReferenceStoryMaterialChapterModelOutput({
      ...model,
      findings: [{ ...model.findings[0], evidenceRefs: ['forged-pointer'] }],
    }, options)).toThrow(/unknown evidence ref/u);
  });

  it('closes aggregate and projection entries through verified material findings', () => {
    const chapter = normalizeReferenceStoryMaterialChapterModelOutput(
      chapterModelOutput(),
      {
        runId: 'material-run-chain',
        unit: chapterUnit(),
        materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
        allowedPointers: {
          'material-pointer-001': chapterUnit().pointer!,
        },
      },
    );
    const chapterMap = findingMap(chapter.findings);
    const aggregateOptions = {
      runId: 'material-run-chain',
      unit: aggregateUnit(),
      materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
      verifiedFindings: chapterMap,
      coveredUnitIds: [chapterUnit().id],
      coveredChapterIds: ['0001'],
    };
    const aggregate = normalizeReferenceStoryMaterialAggregateModelOutput({
      summary: 'Merged concrete facts from the bounded chapter material.',
      findings: chapter.findings.map((finding) => reductionFinding(finding)),
      uncertainties: [],
    }, aggregateOptions);

    expect(aggregate.findings.every((finding) =>
      finding.sourceFindingRefs.length === 1
      && finding.evidenceRefs.includes('material-pointer-001'))).toBe(true);
    expect(parseReferenceStoryMaterialAggregateResult(aggregate, aggregateOptions))
      .toEqual(aggregate);

    const projectionOptions = {
      ...aggregateOptions,
      unit: projectionUnit(),
      verifiedFindings: findingMap(aggregate.findings),
      coveredUnitIds: [aggregateUnit().id],
    };
    const projection = normalizeReferenceStoryMaterialProjectionModelOutput({
      entries: aggregate.findings.map((finding) => reductionFinding(finding)),
      uncertainties: ['Event ordering remains approximate.'],
    }, projectionOptions);

    expect(collectReferenceStoryMaterialFindings(projection)).toHaveLength(5);
    expect(parseReferenceStoryMaterialProjectionResult(projection, projectionOptions))
      .toEqual(projection);
    for (const kind of REFERENCE_STORY_MATERIAL_KINDS) {
      const yaml = formatReferenceStoryMaterialProjectionYaml(projection, kind);
      expect(yaml).toContain('Specific source-story facts');
      expect(yaml).toContain(`materialKind: ${kind}`);
      expect(yaml).not.toContain('technique:');
      expect(referenceStoryMaterialKindPath(kind)).toBe(`materials/${kind}.yaml`);
    }
  });

  it('rejects Technique findings and broken source-finding closure', () => {
    const verified = chapterFinding('world');
    const options = {
      runId: 'material-run-invalid',
      unit: aggregateUnit(),
      materialKinds: ['world'] as const,
      verifiedFindings: {
        [verified.id]: verified,
      },
      coveredUnitIds: [chapterUnit().id],
      coveredChapterIds: ['0001'],
    };
    const output = {
      summary: 'A bounded aggregate.',
      findings: [reductionFinding(verified)],
      uncertainties: [],
    };

    expect(() => normalizeReferenceStoryMaterialAggregateModelOutput(output, {
      ...options,
      verifiedFindings: {
        [verified.id]: { ...verified, track: 'technique' as 'storyMaterial' },
      },
    })).toThrow(/invalid predecessor/u);
    expect(() => normalizeReferenceStoryMaterialAggregateModelOutput({
      ...output,
      findings: [{ ...output.findings[0], sourceFindingRefs: ['missing-finding'] }],
    }, options)).toThrow(/invalid predecessor/u);
    expect(() => normalizeReferenceStoryMaterialProjectionModelOutput({
      entries: output.findings,
      uncertainties: [],
    }, {
      ...options,
      unit: { ...projectionUnit(), track: 'technique' },
    })).toThrow(/requires a storyMaterial/u);
  });
});

describe('Reference Story Material per-track quality', () => {
  it('evaluates only the Story Material track in a combined work plan', () => {
    const fixture = createMaterialQualityFixture({ includeTechniqueTrack: true });
    const report = evaluateReferenceStoryMaterialQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: fixture.attempts,
      outputs: fixture.outputs,
      sourceWindows: fixture.sourceWindows,
    });

    expect(report.status).toBe('passed');
    expect(report.checkedUnitIds).toEqual(
      fixture.plan.units
        .filter((unit) => unit.track === 'storyMaterial' && unit.kind !== 'analysisQuality')
        .map((unit) => unit.id),
    );
    expect(report.checkedUnitIds.some((unitId) =>
      fixture.plan.units.some((unit) => unit.id === unitId && unit.track === 'technique')))
      .toBe(false);
  });

  it('passes a complete material plan, attempt, hash, predecessor, and evidence closure', () => {
    const fixture = createMaterialQualityFixture();
    const report = evaluateReferenceStoryMaterialQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: fixture.attempts,
      outputs: fixture.outputs,
      sourceWindows: fixture.sourceWindows,
      evaluatedAt: '2026-07-31T12:00:00.000Z',
    });

    expect(report).toMatchObject({
      track: 'storyMaterial',
      status: 'passed',
      coverage: {
        plannedUnitCount: 4,
        checkedUnitCount: 4,
        plannedChapterUnitCount: 2,
        completedChapterUnitCount: 2,
        plannedChapterCount: 2,
        coveredChapterCount: 2,
        plannedAggregateUnitCount: 1,
        completedAggregateUnitCount: 1,
        projectionCompleted: true,
        materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
        coveredMaterialKinds: REFERENCE_STORY_MATERIAL_KINDS,
        percent: 100,
      },
      diagnostics: [],
      evaluatedAt: '2026-07-31T12:00:00.000Z',
    });
    expect(report.checkedUnitIds).toHaveLength(4);
    expect(report.attemptIds).toHaveLength(4);
    expect(report.outputHashes).toEqual(
      fixture.outputs.map((output) => createReferenceStoryMaterialOutputHash(output)),
    );
    expect(parseReferenceStoryMaterialQualityReport(report)).toEqual(report);
  });

  it('keeps incomplete chapter/kind coverage and exact 80-char overlap publishable warnings', () => {
    const fixture = createMaterialQualityFixture({
      coveredChapterIds: ['0001'],
      projectionKinds: ['world'],
      copySourceInProjection: true,
    });
    const report = evaluateReferenceStoryMaterialQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: fixture.attempts,
      outputs: fixture.outputs,
      sourceWindows: fixture.sourceWindows,
    });

    expect(report.status).toBe('warned');
    expect(report.diagnostics.some((diagnostic) => diagnostic.blocking)).toBe(false);
    expect(report.coverage).toMatchObject({
      percent: 100,
      coveredChapterCount: 1,
      coveredMaterialKinds: ['world'],
    });
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'quality.material.coverage.incomplete',
        severity: 'warning',
        blocking: false,
      }),
      expect.objectContaining({
        code: 'quality.material.kindCoverage.insufficient',
        severity: 'warning',
        blocking: false,
      }),
      expect.objectContaining({
        code: 'quality.copyRisk.exactOverlap',
        severity: 'warning',
        blocking: false,
        pointerId: fixture.sourceWindows[0]!.pointerId,
      }),
    ]));
    expect(parseReferenceStoryMaterialQualityReport(report)).toEqual(report);
  });

  it('blocks invalid terminals, missing artifacts, hash drift, predecessor drift, and evidence drift', () => {
    const fixture = createMaterialQualityFixture();
    const projectionUnitId = fixture.plan.tracks.storyMaterial!.projectionUnitId;
    const chapterOutput = fixture.outputs.find((output) => 'chapterId' in output)!;
    if (!('findings' in chapterOutput)) throw new Error('Expected material chapter output.');
    const evidenceOutputs: ReferenceStoryMaterialQualityOutput[] = fixture.outputs.map(
      (output) => output === chapterOutput
        ? {
            ...chapterOutput,
            findings: chapterOutput.findings.map((finding, index) => index
              ? finding
              : { ...finding, evidenceRefs: ['missing-material-pointer'] }),
          }
        : output,
    );
    const cases = [
      {
        code: 'quality.plan.invalidTerminalUnits',
        report: evaluateReferenceStoryMaterialQuality({
          runId: fixture.runId,
          plan: {
            ...fixture.plan,
            tracks: {
              ...fixture.plan.tracks,
              storyMaterial: {
                ...fixture.plan.tracks.storyMaterial!,
                projectionUnitId: 'missing-material-projection',
              },
            },
          },
          selectedAttempts: fixture.attempts,
          outputs: fixture.outputs,
          sourceWindows: fixture.sourceWindows,
        }),
      },
      {
        code: 'quality.attempt.missing',
        report: evaluateReferenceStoryMaterialQuality({
          runId: fixture.runId,
          plan: fixture.plan,
          selectedAttempts: fixture.attempts.slice(1),
          outputs: fixture.outputs,
          sourceWindows: fixture.sourceWindows,
        }),
      },
      {
        code: 'quality.output.hashMismatch',
        report: evaluateReferenceStoryMaterialQuality({
          runId: fixture.runId,
          plan: fixture.plan,
          selectedAttempts: fixture.attempts.map((attempt, index) => index
            ? attempt
            : { ...attempt, outputHash: 'f'.repeat(64) }),
          outputs: fixture.outputs,
          sourceWindows: fixture.sourceWindows,
        }),
      },
      {
        code: 'quality.predecessor.closureMismatch',
        report: evaluateReferenceStoryMaterialQuality({
          runId: fixture.runId,
          plan: fixture.plan,
          selectedAttempts: fixture.attempts.map((attempt) =>
            attempt.unitId === projectionUnitId
              ? { ...attempt, predecessorOutputHashes: ['0'.repeat(64)] }
              : attempt),
          outputs: fixture.outputs,
          sourceWindows: fixture.sourceWindows,
        }),
      },
      {
        code: 'quality.evidence.missingWindow',
        report: evaluateReferenceStoryMaterialQuality({
          runId: fixture.runId,
          plan: fixture.plan,
          selectedAttempts: createMaterialQualityAttempts(fixture.plan, evidenceOutputs),
          outputs: evidenceOutputs,
          sourceWindows: fixture.sourceWindows,
        }),
      },
    ];

    for (const { code, report } of cases) {
      expect(report.status, code).toBe('failed');
      expect(report.diagnostics, code).toContainEqual(expect.objectContaining({
        code,
        severity: 'error',
        blocking: true,
      }));
    }
  });

  it('strictly parses canonical reports and rejects track, fields, or internal drift', () => {
    const fixture = createMaterialQualityFixture();
    const report = evaluateReferenceStoryMaterialQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: fixture.attempts,
      outputs: fixture.outputs,
      sourceWindows: fixture.sourceWindows,
      evaluatedAt: '2026-07-31T12:00:00.000Z',
    });

    expect(parseReferenceStoryMaterialQualityReport(report)).toEqual(report);
    expect(() => parseReferenceStoryMaterialQualityReport({
      ...report,
      track: 'technique',
    })).toThrow(/wrong track/u);
    expect(() => parseReferenceStoryMaterialQualityReport({
      ...report,
      futureField: true,
    })).toThrow(/unknown field/u);
    expect(() => parseReferenceStoryMaterialQualityReport({
      ...report,
      coverage: {
        ...report.coverage,
        coveredMaterialKinds: ['world'],
      },
    })).toThrow(/internally inconsistent/u);
  });
});

function quickPreviewSelection(): ReferenceQuickPreviewSelection {
  return {
    referenceId: 'reference-material-001',
    sourceChecksumSha256: 'a'.repeat(64),
    structureFingerprint: 'b'.repeat(64),
    selectedChapterIds: ['0001'],
    windows: [{
      pointerId: 'material-pointer-001',
      pointer: chapterUnit().pointer!,
      content: 'The city council forbids magic after midnight.',
      charLength: 51,
    }],
    omittedChapterIds: [],
    totalChars: 51,
    maxChapters: 3,
    maxChars: 48_000,
  };
}

function chapterUnit(): ReferenceDeconstructionWorkUnit {
  return {
    id: 'material-chapter-unit-001',
    ordinal: 1,
    track: 'storyMaterial',
    stageId: 'materialChapterAnalysis',
    kind: 'chapterChunk',
    predecessorUnitIds: [],
    chapterId: '0001',
    chunkId: '0001-full-chunk-0001',
    pointerId: 'material-pointer-001',
    pointer: {
      referenceId: 'reference-material-001',
      sourceChecksumSha256: 'a'.repeat(64),
      chapterId: '0001',
      chunkId: '0001-full-chunk-0001',
      lineStart: 1,
      lineEnd: 2,
    },
    isLastChunkInChapter: true,
  };
}

function aggregateUnit(): ReferenceDeconstructionWorkUnit {
  return {
    id: 'material-aggregate-unit-001',
    ordinal: 2,
    track: 'storyMaterial',
    stageId: 'materialAggregateAnalysis',
    kind: 'aggregate',
    predecessorUnitIds: [chapterUnit().id],
    aggregateLevel: 1,
  };
}

function projectionUnit(): ReferenceDeconstructionWorkUnit {
  return {
    id: 'material-projection-unit-001',
    ordinal: 3,
    track: 'storyMaterial',
    stageId: 'materialProjection',
    kind: 'materialProjection',
    predecessorUnitIds: [aggregateUnit().id],
  };
}

function chapterModelOutput() {
  return {
    summary: 'The window establishes concrete setting, cast, conflict, and order.',
    summaryEvidenceRefs: ['material-pointer-001'],
    findings: REFERENCE_STORY_MATERIAL_KINDS.map((materialKind) => ({
      materialKind,
      title: `${materialKind} material`,
      content: `A concrete ${materialKind} fact from the selected source window.`,
      details: [`Structured ${materialKind} detail.`],
      assertionType: materialKind === 'timeline' ? 'uncertain' as const : 'fact' as const,
      confidence: materialKind === 'timeline' ? 'low' as const : 'high' as const,
      evidenceRefs: ['material-pointer-001'],
      uncertainty: materialKind === 'timeline'
        ? 'Only relative order is established.'
        : null,
    })),
    uncertainties: [],
  };
}

function reductionFinding(finding: ReferenceStoryMaterialFinding) {
  return {
    materialKind: finding.materialKind,
    title: finding.title,
    content: finding.content,
    details: [...finding.details],
    assertionType: finding.assertionType,
    confidence: finding.confidence,
    sourceFindingRefs: [finding.id],
    uncertainty: finding.uncertainty ?? null,
  };
}

function findingMap(findings: readonly ReferenceStoryMaterialFinding[]) {
  return Object.fromEntries(findings.map((finding) => [finding.id, finding]));
}

function chapterFinding(materialKind: ReferenceStoryMaterialKind): ReferenceStoryMaterialFinding {
  return normalizeReferenceStoryMaterialChapterModelOutput({
    summary: 'Bounded summary.',
    summaryEvidenceRefs: ['material-pointer-001'],
    findings: [{
      materialKind,
      title: 'Verified material',
      content: 'Verified concrete material content.',
      details: [],
      assertionType: 'fact',
      confidence: 'high',
      evidenceRefs: ['material-pointer-001'],
      uncertainty: null,
    }],
    uncertainties: [],
  }, {
    runId: 'material-run-invalid',
    unit: chapterUnit(),
    materialKinds: [materialKind],
    allowedPointers: { 'material-pointer-001': chapterUnit().pointer! },
  }).findings[0]!;
}

function createMaterialQualityFixture(options: {
  coveredChapterIds?: string[];
  projectionKinds?: ReferenceStoryMaterialKind[];
  copySourceInProjection?: boolean;
  includeTechniqueTrack?: boolean;
} = {}) {
  const runId = 'material-quality-run-001';
  const sourceText = [
    'Chapter One',
    'At midnight the northern gate closes under an old council decree, forcing every late traveler to wait beyond the walls until sunrise while the watch records each name.',
    'Chapter Two',
    'At dawn Mira enters the city, learns why the gate decree exists, and promises to investigate the council archive before the next midnight closure.',
  ].join('\n');
  const plan = createReferenceDeconstructionWorkPlan({
    referenceId: 'material-quality-reference',
    sourceChecksumSha256: sha256(sourceText),
    structureFingerprint: sha256('material-quality-structure'),
    sourceText,
    chapters: [
      { id: '0001', title: 'Chapter One', lineStart: 1, lineEnd: 2 },
      { id: '0002', title: 'Chapter Two', lineStart: 3, lineEnd: 4 },
    ],
    outputs: options.includeTechniqueTrack
      ? ['techniques', ...REFERENCE_STORY_MATERIAL_KINDS]
      : REFERENCE_STORY_MATERIAL_KINDS,
  });
  const chapterUnits = plan.units.filter((unit) =>
    unit.track === 'storyMaterial' && unit.kind === 'chapterChunk');
  const aggregateUnit = plan.units.find((unit) =>
    unit.track === 'storyMaterial' && unit.kind === 'aggregate')!;
  const projectionUnit = plan.units.find((unit) =>
    unit.track === 'storyMaterial' && unit.kind === 'materialProjection')!;
  const sourceWindows = chapterUnits.map((unit) =>
    resolveReferenceChapterWorkUnitWindow(sourceText, unit));
  const allowedPointers = Object.fromEntries(sourceWindows.map((window) => [
    window.pointerId,
    window.pointer,
  ]));
  const chapters = chapterUnits.map((unit, chapterIndex) =>
    normalizeReferenceStoryMaterialChapterModelOutput({
      summary: `Chapter ${chapterIndex + 1} provides bounded source-story material.`,
      summaryEvidenceRefs: [unit.pointerId!],
      findings: REFERENCE_STORY_MATERIAL_KINDS.map((materialKind) => ({
        materialKind,
        title: `${materialKind} chapter ${chapterIndex + 1}`,
        content: `Concrete ${materialKind} material from chapter ${chapterIndex + 1}.`,
        details: [`Bounded ${materialKind} detail ${chapterIndex + 1}.`],
        assertionType: 'fact' as const,
        confidence: 'high' as const,
        evidenceRefs: [unit.pointerId!],
        uncertainty: null,
      })),
      uncertainties: [],
    }, {
      runId,
      unit,
      materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
      allowedPointers,
    }));
  const chapterFindings = chapters.flatMap((chapter) => chapter.findings);
  const aggregate = normalizeReferenceStoryMaterialAggregateModelOutput({
    summary: 'The aggregate preserves concrete material from both planned chapters.',
    findings: chapterFindings.map((finding) => reductionFinding(finding)),
    uncertainties: [],
  }, {
    runId,
    unit: aggregateUnit,
    materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
    verifiedFindings: findingMap(chapterFindings),
    coveredUnitIds: [...aggregateUnit.predecessorUnitIds],
    coveredChapterIds: ['0001', '0002'],
  });
  const projectionKinds = options.projectionKinds ?? [...REFERENCE_STORY_MATERIAL_KINDS];
  const projectionInputs = aggregate.findings
    .filter((finding) => projectionKinds.includes(finding.materialKind))
    .map((finding, index) => ({
      ...reductionFinding(finding),
      ...(options.copySourceInProjection && index === 0
        ? { content: sourceWindows[0]!.content }
        : {}),
    }));
  const projection = normalizeReferenceStoryMaterialProjectionModelOutput({
    entries: projectionInputs,
    uncertainties: [],
  }, {
    runId,
    unit: projectionUnit,
    materialKinds: REFERENCE_STORY_MATERIAL_KINDS,
    verifiedFindings: findingMap(aggregate.findings),
    coveredUnitIds: [aggregateUnit.id],
    coveredChapterIds: options.coveredChapterIds ?? ['0001', '0002'],
  });
  const outputs: ReferenceStoryMaterialQualityOutput[] = [
    ...chapters,
    aggregate,
    projection,
  ];
  return {
    runId,
    plan,
    outputs,
    attempts: createMaterialQualityAttempts(plan, outputs),
    sourceWindows,
  };
}

function createMaterialQualityAttempts(
  plan: ReferenceDeconstructionWorkPlan,
  outputs: readonly ReferenceStoryMaterialQualityOutput[],
): ReferenceStoryMaterialQualitySelectedAttempt[] {
  const hashes = new Map(outputs.map((output) => [
    output.unitId,
    createReferenceStoryMaterialOutputHash(output),
  ]));
  return plan.units
    .filter((unit) => unit.track === 'storyMaterial' && unit.kind !== 'analysisQuality')
    .map((unit) => {
      const fingerprint = sha256(`material-input:${unit.id}`);
      const outputHash = hashes.get(unit.id);
      if (!outputHash) throw new Error(`Missing Story Material output for ${unit.id}.`);
      return {
        unitId: unit.id,
        attemptId: `attempt-${unit.ordinal}`,
        status: 'completed' as const,
        inputFingerprint: fingerprint,
        expectedInputFingerprint: fingerprint,
        predecessorOutputHashes: unit.predecessorUnitIds.map((unitId) => {
          const hash = hashes.get(unitId);
          if (!hash) throw new Error(`Missing predecessor output for ${unitId}.`);
          return hash;
        }),
        outputHash,
      };
    });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
