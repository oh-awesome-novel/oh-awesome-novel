import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  collectReferenceAnalysisFindings,
  collectReferenceDistillationFindings,
  createReferenceAnalysisOutputHash,
  createReferenceDeconstructionWorkPlan,
  evaluateReferenceDeconstructionAnalysisQuality,
  normalizeReferenceAggregateAnalysisModelOutput,
  normalizeReferenceChapterAnalysisModelOutput,
  normalizeReferenceDistillationModelOutput,
  normalizeReferenceStyleProfileModelOutput,
  parseReferenceAggregateAnalysisResult,
  parseReferenceChapterAnalysisResult,
  parseReferenceDeconstructionAnalysisQualityReport,
  parseReferenceDistillationResult,
  parseReferenceStyleProfileResult,
  resolveReferenceChapterWorkUnitWindow,
} from '@oh-awesome-novel/core';
import type {
  ReferenceDeconstructionAnalysisOutput,
  ReferenceDeconstructionQualitySelectedAttempt,
  ReferenceDeconstructionWorkPlan,
} from '@oh-awesome-novel/core';

describe('reference deconstruction analysis quality', () => {
  it('passes only a complete selected-attempt and evidence closure', () => {
    const fixture = createQualityFixture();
    const report = evaluateReferenceDeconstructionAnalysisQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: fixture.attempts,
      outputs: fixture.outputs,
      sourceWindows: [fixture.sourceWindow],
      evaluatedAt: '2026-07-23T00:00:00.000Z',
    });

    expect(report).toMatchObject({
      status: 'passed',
      coverage: {
        plannedUnitCount: 4,
        checkedUnitCount: 4,
        plannedChapterUnitCount: 1,
        completedChapterUnitCount: 1,
        plannedChapterCount: 1,
        completedChapterCount: 1,
        plannedAggregateUnitCount: 1,
        completedAggregateUnitCount: 1,
        styleCompleted: true,
        distillCompleted: true,
        percent: 100,
      },
      diagnostics: [],
    });
    expect(report.checkedUnitIds).toHaveLength(4);
    expect(report.outputHashes).toEqual(
      fixture.outputs.map((output) => createReferenceAnalysisOutputHash(output)),
    );
  });

  it('fails closed on missing attempts, hash drift, and predecessor drift', () => {
    const fixture = createQualityFixture();
    const styleAttempt = fixture.attempts.find((attempt) =>
      attempt.unitId === fixture.plan.styleUnitId)!;
    const attempts = fixture.attempts
      .filter((attempt) => attempt.unitId !== fixture.plan.aggregateRootUnitId)
      .map((attempt) => attempt === styleAttempt
        ? {
            ...attempt,
            inputFingerprint: sha256('tampered input'),
            predecessorOutputHashes: [sha256('tampered predecessor')],
          }
        : attempt);
    const report = evaluateReferenceDeconstructionAnalysisQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: attempts,
      outputs: fixture.outputs,
      sourceWindows: [fixture.sourceWindow],
    });

    expect(report.status).toBe('failed');
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'quality.attempt.missing', blocking: true }),
      expect.objectContaining({ code: 'quality.input.hashMismatch', blocking: true }),
      expect.objectContaining({ code: 'quality.predecessor.closureMismatch', blocking: true }),
    ]));
  });

  it('revalidates chapter pointers and derived finding closure', () => {
    const fixture = createQualityFixture();
    const chapterOutput = fixture.outputs[0]!;
    const aggregateOutput = fixture.outputs[1]!;
    if (!('unitSummary' in chapterOutput) || !('findings' in aggregateOutput)) {
      throw new Error('Unexpected quality fixture output order.');
    }
    const outputs: ReferenceDeconstructionAnalysisOutput[] = [
      {
        ...chapterOutput,
        findings: chapterOutput.findings.map((finding, index) => index
          ? finding
          : { ...finding, evidenceRefs: ['forged-pointer'] }),
      },
      {
        ...aggregateOutput,
        findings: aggregateOutput.findings.map((finding, index) => index
          ? finding
          : {
              ...finding,
              sourceFindingRefs: ['forged-finding'],
              evidenceRefs: [],
            }),
      },
      fixture.outputs[2]!,
      fixture.outputs[3]!,
    ];
    const attempts = createAttempts(fixture.plan, outputs);
    const report = evaluateReferenceDeconstructionAnalysisQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: attempts,
      outputs,
      sourceWindows: [fixture.sourceWindow],
    });

    expect(report.status).toBe('failed');
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'quality.evidence.crossUnit', blocking: true }),
      expect.objectContaining({ code: 'quality.finding.closureMismatch', blocking: true }),
    ]));
  });

  it('blocks long exact source overlap after all structural gates pass', () => {
    const fixture = createQualityFixture();
    const copied = fixture.sourceWindow.content;
    expect(copied.length).toBeGreaterThanOrEqual(80);
    const aggregateOutput = fixture.outputs[1]!;
    if (!('findings' in aggregateOutput)) {
      throw new Error('Unexpected aggregate fixture output.');
    }
    const outputs: ReferenceDeconstructionAnalysisOutput[] = [
      fixture.outputs[0]!,
      { ...aggregateOutput, summary: copied },
      fixture.outputs[2]!,
      fixture.outputs[3]!,
    ];
    const report = evaluateReferenceDeconstructionAnalysisQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: createAttempts(fixture.plan, outputs),
      outputs,
      sourceWindows: [fixture.sourceWindow],
    });

    expect(report.status).toBe('failed');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'quality.copyRisk.exactOverlap',
      blocking: true,
    }));
    expect(JSON.stringify(report.diagnostics)).not.toContain(copied);
  });

  it('turns diagnostic overflow into a bounded blocking failure', () => {
    const fixture = createQualityFixture();
    const chapterOutput = fixture.outputs[0]!;
    if (!('unitSummary' in chapterOutput)) {
      throw new Error('Unexpected chapter fixture output.');
    }
    const outputs: ReferenceDeconstructionAnalysisOutput[] = [
      {
        ...chapterOutput,
        uncertainties: Array.from(
          { length: 160 },
          (_, index) => `Bounded uncertainty ${index + 1}.`,
        ),
      },
      fixture.outputs[1]!,
      fixture.outputs[2]!,
      fixture.outputs[3]!,
    ];
    const report = evaluateReferenceDeconstructionAnalysisQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: createAttempts(fixture.plan, outputs),
      outputs,
      sourceWindows: [fixture.sourceWindow],
    });

    expect(report.status).toBe('failed');
    expect(report.diagnostics).toHaveLength(128);
    expect(report.diagnostics.at(-1)).toMatchObject({
      code: 'quality.diagnostic.overflow',
      blocking: true,
    });
  });

  it('strictly reparses canonical stored outputs and rejects unknown fields or broken closure', () => {
    const fixture = createQualityFixture();
    const [chapter, aggregate, style, distillation] = fixture.outputs;
    if (
      !chapter
      || !aggregate
      || !style
      || !distillation
      || !('unitSummary' in chapter)
      || !('findings' in aggregate)
      || !('dimensions' in style)
      || !('entries' in distillation)
    ) {
      throw new Error('Unexpected strict-parser fixture outputs.');
    }
    const chapterUnit = fixture.plan.units.find((unit) => unit.kind === 'chapterChunk')!;
    const aggregateUnit = fixture.plan.units.find((unit) => unit.kind === 'aggregate')!;
    const styleUnit = fixture.plan.units.find((unit) => unit.kind === 'style')!;
    const distillUnit = fixture.plan.units.find((unit) => unit.kind === 'distill')!;
    const chapterFindings = Object.fromEntries(
      collectReferenceAnalysisFindings(chapter).map((finding) => [finding.id, finding]),
    );
    const aggregateFindings = Object.fromEntries(
      aggregate.findings.map((finding) => [finding.id, finding]),
    );
    expect(parseReferenceChapterAnalysisResult(chapter, {
      runId: fixture.runId,
      unit: chapterUnit,
      allowedPointers: {
        [fixture.sourceWindow.pointerId]: fixture.sourceWindow.pointer,
      },
    })).toEqual(chapter);
    expect(parseReferenceAggregateAnalysisResult(aggregate, {
      runId: fixture.runId,
      unit: aggregateUnit,
      verifiedFindings: chapterFindings,
      coveredUnitIds: chapter.coveredUnitIds,
      coveredChapterIds: chapter.coveredChapterIds,
    })).toEqual(aggregate);
    expect(parseReferenceStyleProfileResult(style, {
      runId: fixture.runId,
      unit: styleUnit,
      verifiedFindings: aggregateFindings,
      coveredUnitIds: aggregate.coveredUnitIds,
      coveredChapterIds: aggregate.coveredChapterIds,
    })).toEqual(style);
    expect(parseReferenceDistillationResult(distillation, {
      runId: fixture.runId,
      unit: distillUnit,
      verifiedFindings: Object.fromEntries(
        collectReferenceDistillationFindings(aggregate.findings, style)
          .map((finding) => [finding.id, finding]),
      ),
      coveredUnitIds: aggregate.coveredUnitIds,
      coveredChapterIds: aggregate.coveredChapterIds,
    })).toEqual(distillation);
    const report = evaluateReferenceDeconstructionAnalysisQuality({
      runId: fixture.runId,
      plan: fixture.plan,
      selectedAttempts: fixture.attempts,
      outputs: fixture.outputs,
      sourceWindows: [fixture.sourceWindow],
      evaluatedAt: '2026-07-23T00:00:00.000Z',
    });
    expect(parseReferenceDeconstructionAnalysisQualityReport(report)).toEqual(report);

    expect(() => parseReferenceAggregateAnalysisResult({
      ...aggregate,
      findings: aggregate.findings.map((finding, index) => index
        ? finding
        : { ...finding, sourceFindingRefs: ['unknown-finding'] }),
    }, {
      runId: fixture.runId,
      unit: aggregateUnit,
      verifiedFindings: chapterFindings,
      coveredUnitIds: chapter.coveredUnitIds,
      coveredChapterIds: chapter.coveredChapterIds,
    })).toThrow('unknown source finding');
    expect(() => parseReferenceStyleProfileResult({
      ...style,
      dimensions: style.dimensions.map((dimension, index) => index
        ? dimension
        : { ...dimension, futureField: true }),
    }, {
      runId: fixture.runId,
      unit: styleUnit,
      verifiedFindings: aggregateFindings,
      coveredUnitIds: aggregate.coveredUnitIds,
      coveredChapterIds: aggregate.coveredChapterIds,
    })).toThrow('canonical validated output');
    expect(() => parseReferenceDeconstructionAnalysisQualityReport({
      ...report,
      futureField: true,
    })).toThrow('unknown field');
  });
});

function createQualityFixture() {
  const runId = 'quality-run-001';
  const sourceText = [
    'Chapter 1',
    'A source passage establishes a concrete question, delays the answer, and raises pressure through a sequence of visible choices and consequences.',
  ].join('\n');
  const plan = createReferenceDeconstructionWorkPlan({
    referenceId: 'quality-reference',
    sourceChecksumSha256: sha256(sourceText),
    structureFingerprint: sha256('quality-structure'),
    sourceText,
    chapters: [{
      id: '0001',
      title: 'Chapter 1',
      lineStart: 1,
      lineEnd: 2,
    }],
  });
  const chapterUnit = plan.units.find((unit) => unit.kind === 'chapterChunk')!;
  const aggregateUnit = plan.units.find((unit) => unit.kind === 'aggregate')!;
  const styleUnit = plan.units.find((unit) => unit.kind === 'style')!;
  const distillUnit = plan.units.find((unit) => unit.kind === 'distill')!;
  const sourceWindow = resolveReferenceChapterWorkUnitWindow(sourceText, chapterUnit);
  const chapter = normalizeReferenceChapterAnalysisModelOutput({
    unitSummary: {
      text: 'The unit establishes and escalates one bounded reader question.',
      evidenceRefs: [sourceWindow.pointerId],
      confidence: 'high',
      uncertainty: null,
    },
    chapterSummary: {
      text: 'The chapter turns delayed explanation into controlled forward pressure.',
      evidenceRefs: [sourceWindow.pointerId],
      confidence: 'high',
      uncertainty: null,
    },
    findings: [{
      kind: 'hook',
      observation: 'A visible uncertainty is introduced before its answer.',
      technique: 'Frame a concrete question and attach a near-term consequence.',
      whenUseful: null,
      avoid: null,
      confidence: 'high',
      evidenceRefs: [sourceWindow.pointerId],
      generalInference: false,
      uncertainty: null,
    }],
    rollingSummary: 'A bounded question now carries visible pressure and an implied answer.',
    rollingEvidenceRefs: [sourceWindow.pointerId],
    uncertainties: [],
  }, {
    runId,
    unit: chapterUnit,
    allowedPointers: { [sourceWindow.pointerId]: sourceWindow.pointer },
  });
  const chapterFindings = Object.fromEntries(
    collectReferenceAnalysisFindings(chapter).map((finding) => [finding.id, finding]),
  );
  const aggregate = normalizeReferenceAggregateAnalysisModelOutput({
    summary: 'The analyzed opening uses delayed answers to shape a rising pressure phase.',
    findings: [{
      kind: 'pacing',
      observation: 'Pressure rises while the initial question remains active.',
      technique: 'Advance consequences before resolving the initiating uncertainty.',
      whenUseful: null,
      avoid: null,
      confidence: 'high',
      sourceFindingRefs: [chapter.findings[0]!.id],
      generalInference: false,
      uncertainty: null,
    }],
    uncertainties: [],
  }, {
    runId,
    unit: aggregateUnit,
    verifiedFindings: chapterFindings,
    coveredUnitIds: chapter.coveredUnitIds,
    coveredChapterIds: chapter.coveredChapterIds,
  });
  const aggregateFindings = Object.fromEntries(
    aggregate.findings.map((finding) => [finding.id, finding]),
  );
  const style = normalizeReferenceStyleProfileModelOutput({
    summary: 'The sample favors functional escalation over decorative imitation.',
    dimensions: [{
      dimension: 'turnsAndReaderPromises',
      observation: 'Each turn keeps the initiating promise legible.',
      technique: 'Connect local consequences to the unresolved reader question.',
      avoid: null,
      confidence: 'high',
      sourceFindingRefs: [aggregate.findings[0]!.id],
      generalInference: false,
      uncertainty: null,
    }],
    transferablePrinciples: ['Keep the active reader promise visible across scene turns.'],
    nonImitationBoundaries: ['Do not reuse source names, prose, dialogue, or event order.'],
    uncertainties: [],
  }, {
    runId,
    unit: styleUnit,
    verifiedFindings: aggregateFindings,
    coveredUnitIds: aggregate.coveredUnitIds,
    coveredChapterIds: aggregate.coveredChapterIds,
  });
  const distillationFindings = collectReferenceDistillationFindings(
    aggregate.findings,
    style,
  );
  const distillation = normalizeReferenceDistillationModelOutput({
    entries: [
      createDistillationEntry(
        'writingStyle',
        'Functional escalation',
        aggregate.findings[0]!.id,
      ),
      createDistillationEntry(
        'pacing',
        'Delayed answer pressure',
        aggregate.findings[0]!.id,
      ),
      createDistillationEntry(
        'hooks',
        'Visible reader question',
        aggregate.findings[0]!.id,
      ),
      createDistillationEntry(
        'scene',
        'Consequence-led turn',
        aggregate.findings[0]!.id,
      ),
      createDistillationEntry(
        'character',
        'Choice reveals pressure',
        style.dimensions[0]!.id,
      ),
    ],
    doNotCopyRules: ['Do not reuse source names, prose, dialogue, or event order.'],
    differentiationWarnings: ['Change motive, setting, stakes, and consequence structure.'],
    uncertainties: [],
  }, {
    runId,
    unit: distillUnit,
    verifiedFindings: Object.fromEntries(
      distillationFindings.map((finding) => [finding.id, finding]),
    ),
    coveredUnitIds: aggregate.coveredUnitIds,
    coveredChapterIds: aggregate.coveredChapterIds,
  });
  const outputs: ReferenceDeconstructionAnalysisOutput[] = [
    chapter,
    aggregate,
    style,
    distillation,
  ];
  return {
    runId,
    plan,
    sourceWindow,
    outputs,
    attempts: createAttempts(plan, outputs),
  };
}

function createDistillationEntry(
  category: 'writingStyle' | 'pacing' | 'hooks' | 'scene' | 'character',
  title: string,
  sourceFindingRef: string,
) {
  return {
    category,
    title,
    technique: `Transform ${title.toLocaleLowerCase('en-US')} into an original planning constraint.`,
    whenUseful: ['Use when a writing task needs this structural effect.'],
    constraints: ['Change all story-specific expression and causal details.'],
    differentiationPrompts: ['What original motive and consequence can replace this pattern?'],
    sourceFindingRefs: [sourceFindingRef],
    confidence: 'high' as const,
    tags: [category],
    capabilityIds: ['novel.write_chapter' as const],
  };
}

function createAttempts(
  plan: ReferenceDeconstructionWorkPlan,
  outputs: readonly ReferenceDeconstructionAnalysisOutput[],
): ReferenceDeconstructionQualitySelectedAttempt[] {
  const outputsByUnitId = new Map(outputs.map((output) => [output.unitId, output]));
  const outputHashes = new Map(outputs.map((output) => [
    output.unitId,
    createReferenceAnalysisOutputHash(output),
  ]));
  return plan.units
    .filter((unit) => unit.kind !== 'analysisQuality')
    .map((unit, index) => {
      const output = outputsByUnitId.get(unit.id);
      if (!output) throw new Error(`Missing fixture output for ${unit.id}.`);
      const inputFingerprint = sha256(`quality-input-${unit.id}`);
      return {
        unitId: unit.id,
        attemptId: `quality-attempt-${index + 1}`,
        status: 'completed',
        inputFingerprint,
        expectedInputFingerprint: inputFingerprint,
        predecessorOutputHashes: unit.predecessorUnitIds.map((unitId) => {
          const hash = outputHashes.get(unitId);
          if (!hash) throw new Error(`Missing predecessor hash for ${unitId}.`);
          return hash;
        }),
        outputHash: createReferenceAnalysisOutputHash(output),
      };
    });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
