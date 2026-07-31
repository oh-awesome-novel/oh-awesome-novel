import { createHash } from 'node:crypto';

import { stringify } from 'yaml';

import {
  MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  REFERENCE_DECONSTRUCTION_STAGE_IDS,
  REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
  assertReferenceEvidenceRefs,
} from './reference-deconstruction.js';
import type {
  ReferenceDeconstructionConfidence,
  ReferenceDeconstructionDiagnostic,
  ReferenceEvidencePointerMap,
  ReferenceQuickPreviewSelection,
  ReferenceSourcePointer,
} from './reference-deconstruction.js';
import type {
  ReferenceChapterWorkUnitWindow,
  ReferenceDeconstructionWorkPlan,
  ReferenceDeconstructionWorkUnit,
  ReferenceStoryMaterialKind,
} from './reference-deconstruction-full.js';
import {
  MAX_REFERENCE_ANALYSIS_QUALITY_OUTPUT_CHARS,
  MAX_REFERENCE_ANALYSIS_QUALITY_SOURCE_CHARS,
  REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS,
} from './reference-deconstruction-quality.js';

export const REFERENCE_STORY_MATERIAL_KINDS = [
  'world',
  'characters',
  'relationships',
  'outline',
  'timeline',
] as const satisfies readonly ReferenceStoryMaterialKind[];

export const REFERENCE_STORY_MATERIAL_ASSERTION_TYPES = [
  'fact',
  'interpretation',
  'uncertain',
] as const;

export const REFERENCE_STORY_MATERIAL_COVERAGE_LEVELS = [
  'none',
  'partial',
  'substantial',
] as const;

export const MAX_REFERENCE_STORY_MATERIAL_FINDINGS = 64 as const;
export const MAX_REFERENCE_STORY_MATERIAL_DETAILS = 16 as const;
export const MAX_REFERENCE_STORY_MATERIAL_UNCERTAINTIES = 32 as const;

export type ReferenceStoryMaterialAssertionType =
  typeof REFERENCE_STORY_MATERIAL_ASSERTION_TYPES[number];
export type ReferenceStoryMaterialCoverageLevel =
  typeof REFERENCE_STORY_MATERIAL_COVERAGE_LEVELS[number];

export interface ReferenceStoryMaterialCoverageModelItem {
  materialKind: ReferenceStoryMaterialKind;
  coverage: ReferenceStoryMaterialCoverageLevel;
  summary: string;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  uncertainty?: string | null;
}

export interface ReferenceStoryMaterialCoverageModelOutput {
  items: ReferenceStoryMaterialCoverageModelItem[];
  uncertainties: string[];
}

export interface ReferenceStoryMaterialCoverageItem
  extends Omit<ReferenceStoryMaterialCoverageModelItem, 'uncertainty'> {
  id: string;
  uncertainty?: string;
}

export interface ReferenceStoryMaterialCoveragePreview {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  referenceId: string;
  sourceChecksumSha256: string;
  track: 'storyMaterial';
  materialKinds: ReferenceStoryMaterialKind[];
  items: ReferenceStoryMaterialCoverageItem[];
  uncertainties: string[];
}

export interface ReferenceStoryMaterialModelFinding {
  materialKind: ReferenceStoryMaterialKind;
  title: string;
  content: string;
  details: string[];
  assertionType: ReferenceStoryMaterialAssertionType;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  uncertainty?: string | null;
}

export interface ReferenceStoryMaterialChapterModelOutput {
  summary: string;
  summaryEvidenceRefs: string[];
  findings: ReferenceStoryMaterialModelFinding[];
  uncertainties: string[];
}

export interface ReferenceStoryMaterialReductionModelFinding {
  materialKind: ReferenceStoryMaterialKind;
  title: string;
  content: string;
  details: string[];
  assertionType: ReferenceStoryMaterialAssertionType;
  confidence: ReferenceDeconstructionConfidence;
  sourceFindingRefs: string[];
  uncertainty?: string | null;
}

export interface ReferenceStoryMaterialAggregateModelOutput {
  summary: string;
  findings: ReferenceStoryMaterialReductionModelFinding[];
  uncertainties: string[];
}

export interface ReferenceStoryMaterialProjectionModelOutput {
  entries: ReferenceStoryMaterialReductionModelFinding[];
  uncertainties: string[];
}

export interface ReferenceStoryMaterialFinding {
  id: string;
  unitId: string;
  track: 'storyMaterial';
  materialKind: ReferenceStoryMaterialKind;
  title: string;
  content: string;
  details: string[];
  assertionType: ReferenceStoryMaterialAssertionType;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  sourceFindingRefs: string[];
  uncertainty?: string;
}

export type ReferenceStoryMaterialVerifiedFindingMap = Readonly<
  Record<string, ReferenceStoryMaterialFinding>
>;

export interface ReferenceStoryMaterialChapterResult {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  unitId: string;
  track: 'storyMaterial';
  chapterId: string;
  chunkId: string;
  materialKinds: ReferenceStoryMaterialKind[];
  summary: string;
  summaryEvidenceRefs: string[];
  findings: ReferenceStoryMaterialFinding[];
  uncertainties: string[];
  coveredUnitIds: string[];
  coveredChapterIds: string[];
}

export interface ReferenceStoryMaterialAggregateResult {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  unitId: string;
  track: 'storyMaterial';
  materialKinds: ReferenceStoryMaterialKind[];
  summary: string;
  findings: ReferenceStoryMaterialFinding[];
  uncertainties: string[];
  coveredUnitIds: string[];
  coveredChapterIds: string[];
}

export interface ReferenceStoryMaterialProjectionResult {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  unitId: string;
  track: 'storyMaterial';
  materialKinds: ReferenceStoryMaterialKind[];
  entries: ReferenceStoryMaterialFinding[];
  uncertainties: string[];
  coveredUnitIds: string[];
  coveredChapterIds: string[];
}

export interface NormalizeReferenceStoryMaterialCoverageOptions {
  runId: string;
  selection: ReferenceQuickPreviewSelection;
  materialKinds: readonly ReferenceStoryMaterialKind[];
}

export interface NormalizeReferenceStoryMaterialChapterOptions {
  runId: string;
  unit: ReferenceDeconstructionWorkUnit;
  materialKinds: readonly ReferenceStoryMaterialKind[];
  allowedPointers: ReferenceEvidencePointerMap;
}

export interface NormalizeReferenceStoryMaterialReductionOptions {
  runId: string;
  unit: ReferenceDeconstructionWorkUnit;
  materialKinds: readonly ReferenceStoryMaterialKind[];
  verifiedFindings: ReferenceStoryMaterialVerifiedFindingMap;
  coveredUnitIds: readonly string[];
  coveredChapterIds: readonly string[];
}

export type ReferenceStoryMaterialQualityAttemptStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'stale';

export interface ReferenceStoryMaterialQualitySelectedAttempt {
  unitId: string;
  attemptId: string;
  status: ReferenceStoryMaterialQualityAttemptStatus;
  inputFingerprint: string;
  expectedInputFingerprint: string;
  predecessorOutputHashes: string[];
  outputHash: string;
}

export type ReferenceStoryMaterialQualityOutput =
  | ReferenceStoryMaterialChapterResult
  | ReferenceStoryMaterialAggregateResult
  | ReferenceStoryMaterialProjectionResult;

export interface EvaluateReferenceStoryMaterialQualityInput {
  runId: string;
  plan: ReferenceDeconstructionWorkPlan;
  selectedAttempts: readonly ReferenceStoryMaterialQualitySelectedAttempt[];
  outputs: readonly ReferenceStoryMaterialQualityOutput[];
  sourceWindows: readonly ReferenceChapterWorkUnitWindow[];
  evaluatedAt?: string;
}

export interface ReferenceStoryMaterialQualityCoverage {
  plannedUnitCount: number;
  checkedUnitCount: number;
  plannedChapterUnitCount: number;
  completedChapterUnitCount: number;
  plannedChapterCount: number;
  coveredChapterCount: number;
  plannedAggregateUnitCount: number;
  completedAggregateUnitCount: number;
  projectionCompleted: boolean;
  materialKinds: ReferenceStoryMaterialKind[];
  coveredMaterialKinds: ReferenceStoryMaterialKind[];
  percent: number;
}

export interface ReferenceStoryMaterialQualityReport {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  planId: string;
  referenceId: string;
  sourceChecksumSha256: string;
  track: 'storyMaterial';
  status: 'passed' | 'warned' | 'failed';
  coverage: ReferenceStoryMaterialQualityCoverage;
  checkedUnitIds: string[];
  attemptIds: string[];
  outputHashes: string[];
  diagnostics: ReferenceDeconstructionDiagnostic[];
  evaluatedAt: string;
}

export function normalizeReferenceStoryMaterialCoverageModelOutput(
  value: unknown,
  options: NormalizeReferenceStoryMaterialCoverageOptions,
): ReferenceStoryMaterialCoveragePreview {
  const record = requireRecord(value, 'Story Material coverage output');
  assertOnlyKnownFields(record, ['items', 'uncertainties']);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const materialKinds = normalizeMaterialKinds(options.materialKinds);
  const allowedPointers = pointerMapFromSelection(options.selection);
  const rawItems = requireArray(
    record.items,
    'Story Material coverage items',
    materialKinds.length,
    materialKinds.length,
  );
  const items = rawItems.map((item, index): ReferenceStoryMaterialCoverageItem => {
    const candidate = requireRecord(item, `Story Material coverage item ${index}`);
    assertOnlyKnownFields(candidate, [
      'materialKind',
      'coverage',
      'summary',
      'confidence',
      'evidenceRefs',
      'uncertainty',
    ]);
    const materialKind = requireMaterialKind(candidate.materialKind, 'materialKind');
    if (!materialKinds.includes(materialKind)) {
      throw new Error(`Story Material coverage includes unselected kind ${materialKind}.`);
    }
    const coverage = requireEnum(
      candidate.coverage,
      REFERENCE_STORY_MATERIAL_COVERAGE_LEVELS,
      'coverage',
    );
    const evidenceRefs = uniqueStrings(assertReferenceEvidenceRefs(
      candidate.evidenceRefs,
      allowedPointers,
      { required: coverage !== 'none', max: 16 },
    ));
    const uncertainty = optionalText(candidate.uncertainty, 'uncertainty', 2_000);
    if (coverage === 'none' && !uncertainty) {
      throw new Error('Story Material coverage level none requires an uncertainty explanation.');
    }
    const summary = requireText(candidate.summary, 'coverage summary', 4_000);
    const confidence = requireConfidence(candidate.confidence, 'coverage confidence');
    return {
      id: stableId('material-coverage', [
        runId,
        materialKind,
        coverage,
        summary,
        ...evidenceRefs,
      ]),
      materialKind,
      coverage,
      summary,
      confidence,
      evidenceRefs,
      ...(uncertainty ? { uncertainty } : {}),
    };
  });
  assertExactKindCoverage(items.map((item) => item.materialKind), materialKinds);
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    referenceId: requireSafeIdentifier(options.selection.referenceId, 'referenceId'),
    sourceChecksumSha256: requireSha256(
      options.selection.sourceChecksumSha256,
      'sourceChecksumSha256',
    ),
    track: 'storyMaterial',
    materialKinds,
    items: sortByMaterialKind(items),
    uncertainties: requireTextArray(
      record.uncertainties,
      'coverage uncertainties',
      0,
      MAX_REFERENCE_STORY_MATERIAL_UNCERTAINTIES,
      2_000,
    ),
  };
}

export function detectReferenceStoryMaterialCoverageExactOverlap(
  preview: ReferenceStoryMaterialCoveragePreview,
  selection: ReferenceQuickPreviewSelection,
): ReferenceDeconstructionDiagnostic[] {
  if (
    preview.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || preview.track !== 'storyMaterial'
    || preview.referenceId !== selection.referenceId
    || preview.sourceChecksumSha256 !== selection.sourceChecksumSha256
  ) {
    throw new Error('Story Material coverage preview does not match its source selection.');
  }
  const sourceByProbe = new Map<string, string>();
  for (const window of selection.windows) {
    const source = qualityNormalizeOverlapText(window.content);
    for (
      let index = 0;
      index <= source.length - REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS;
      index += 1
    ) {
      const probe = source.slice(index, index + REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS);
      if (!sourceByProbe.has(probe)) sourceByProbe.set(probe, window.pointerId);
    }
  }
  if (!sourceByProbe.size) return [];

  return preview.items.flatMap((item) => {
    const candidate = qualityNormalizeOverlapText([
      item.summary,
      item.uncertainty ?? '',
    ].join(' '));
    let pointerId: string | undefined;
    for (
      let index = 0;
      index <= candidate.length - REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS;
      index += 1
    ) {
      pointerId = sourceByProbe.get(
        candidate.slice(index, index + REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS),
      );
      if (pointerId) break;
    }
    if (!pointerId) return [];
    return [{
      id: stableId('material-preview-copy-risk', [item.id, pointerId]),
      code: 'quality.copyRisk.exactOverlap',
      severity: 'warning' as const,
      blocking: false,
      message: `Story Material coverage for ${item.materialKind} contains an exact source overlap of at least ${REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS} characters; review the wording before publication.`,
      evidenceRefs: [pointerId],
      stageId: 'quickPreview' as const,
      pointerId,
    }];
  });
}

export function normalizeReferenceStoryMaterialChapterModelOutput(
  value: unknown,
  options: NormalizeReferenceStoryMaterialChapterOptions,
): ReferenceStoryMaterialChapterResult {
  const unit = assertReferenceStoryMaterialUnit(options.unit, 'chapter');
  const record = requireRecord(value, 'Story Material chapter output');
  assertOnlyKnownFields(record, [
    'summary',
    'summaryEvidenceRefs',
    'findings',
    'uncertainties',
  ]);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const materialKinds = normalizeMaterialKinds(options.materialKinds);
  if (!unit.chapterId || !unit.chunkId || !unit.pointerId || !unit.pointer) {
    throw new Error('Story Material chapter unit is missing its source identity.');
  }
  const summaryEvidenceRefs = uniqueStrings(assertReferenceEvidenceRefs(
    record.summaryEvidenceRefs,
    options.allowedPointers,
    { chapterId: unit.chapterId, max: 16 },
  ));
  if (!summaryEvidenceRefs.includes(unit.pointerId)) {
    throw new Error('Story Material chapter summary must cite its current source pointer.');
  }
  const findings = requireArray(
    record.findings,
    'Story Material chapter findings',
    0,
    MAX_REFERENCE_STORY_MATERIAL_FINDINGS,
  ).map((finding, index) => normalizeChapterFinding(finding, index, {
    runId,
    unit,
    materialKinds,
    allowedPointers: options.allowedPointers,
  }));
  assertUniqueFindingIds(findings, 'chapter findings');
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    unitId: unit.id,
    track: 'storyMaterial',
    chapterId: unit.chapterId,
    chunkId: unit.chunkId,
    materialKinds,
    summary: requireText(record.summary, 'chapter summary', 8_000),
    summaryEvidenceRefs,
    findings: sortFindings(findings),
    uncertainties: requireTextArray(
      record.uncertainties,
      'chapter uncertainties',
      0,
      MAX_REFERENCE_STORY_MATERIAL_UNCERTAINTIES,
      2_000,
    ),
    coveredUnitIds: [unit.id],
    coveredChapterIds: [unit.chapterId],
  };
}

export function normalizeReferenceStoryMaterialAggregateModelOutput(
  value: unknown,
  options: NormalizeReferenceStoryMaterialReductionOptions,
): ReferenceStoryMaterialAggregateResult {
  const unit = assertReferenceStoryMaterialUnit(options.unit, 'aggregate');
  const record = requireRecord(value, 'Story Material aggregate output');
  assertOnlyKnownFields(record, ['summary', 'findings', 'uncertainties']);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const materialKinds = normalizeMaterialKinds(options.materialKinds);
  const findings = normalizeReductionFindings(record.findings, {
    runId,
    unit,
    materialKinds,
    verifiedFindings: options.verifiedFindings,
    prefix: 'material-aggregate',
    label: 'aggregate finding',
  });
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    unitId: unit.id,
    track: 'storyMaterial',
    materialKinds,
    summary: requireText(record.summary, 'aggregate summary', 12_000),
    findings,
    uncertainties: requireTextArray(
      record.uncertainties,
      'aggregate uncertainties',
      0,
      MAX_REFERENCE_STORY_MATERIAL_UNCERTAINTIES,
      2_000,
    ),
    coveredUnitIds: requireIdentifierArray(options.coveredUnitIds, 'coveredUnitIds'),
    coveredChapterIds: requireIdentifierArray(
      options.coveredChapterIds,
      'coveredChapterIds',
    ),
  };
}

export function normalizeReferenceStoryMaterialProjectionModelOutput(
  value: unknown,
  options: NormalizeReferenceStoryMaterialReductionOptions,
): ReferenceStoryMaterialProjectionResult {
  const unit = assertReferenceStoryMaterialUnit(options.unit, 'projection');
  const record = requireRecord(value, 'Story Material projection output');
  assertOnlyKnownFields(record, ['entries', 'uncertainties']);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const materialKinds = normalizeMaterialKinds(options.materialKinds);
  const entries = normalizeReductionFindings(record.entries, {
    runId,
    unit,
    materialKinds,
    verifiedFindings: options.verifiedFindings,
    prefix: 'material-entry',
    label: 'projection entry',
  });
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    unitId: unit.id,
    track: 'storyMaterial',
    materialKinds,
    entries,
    uncertainties: requireTextArray(
      record.uncertainties,
      'projection uncertainties',
      0,
      MAX_REFERENCE_STORY_MATERIAL_UNCERTAINTIES,
      2_000,
    ),
    coveredUnitIds: requireIdentifierArray(options.coveredUnitIds, 'coveredUnitIds'),
    coveredChapterIds: requireIdentifierArray(
      options.coveredChapterIds,
      'coveredChapterIds',
    ),
  };
}

export function parseReferenceStoryMaterialCoveragePreview(
  value: unknown,
  options: NormalizeReferenceStoryMaterialCoverageOptions,
): ReferenceStoryMaterialCoveragePreview {
  const record = requireRecord(value, 'Stored Story Material coverage preview');
  const items = requireArray(record.items, 'stored coverage items', 0, 100).map((item) => {
    const entry = requireRecord(item, 'stored coverage item');
    return {
      materialKind: entry.materialKind,
      coverage: entry.coverage,
      summary: entry.summary,
      confidence: entry.confidence,
      evidenceRefs: entry.evidenceRefs,
      ...(entry.uncertainty === undefined ? {} : { uncertainty: entry.uncertainty }),
    };
  });
  const normalized = normalizeReferenceStoryMaterialCoverageModelOutput({
    items,
    uncertainties: record.uncertainties,
  }, options);
  return assertCanonicalStoredValue(value, normalized, 'Story Material coverage preview');
}

export function parseReferenceStoryMaterialChapterResult(
  value: unknown,
  options: NormalizeReferenceStoryMaterialChapterOptions,
): ReferenceStoryMaterialChapterResult {
  const record = requireRecord(value, 'Stored Story Material chapter result');
  const normalized = normalizeReferenceStoryMaterialChapterModelOutput({
    summary: record.summary,
    summaryEvidenceRefs: record.summaryEvidenceRefs,
    findings: stripStoredFindings(record.findings, false),
    uncertainties: record.uncertainties,
  }, options);
  return assertCanonicalStoredValue(value, normalized, 'Story Material chapter result');
}

export function parseReferenceStoryMaterialAggregateResult(
  value: unknown,
  options: NormalizeReferenceStoryMaterialReductionOptions,
): ReferenceStoryMaterialAggregateResult {
  const record = requireRecord(value, 'Stored Story Material aggregate result');
  const normalized = normalizeReferenceStoryMaterialAggregateModelOutput({
    summary: record.summary,
    findings: stripStoredFindings(record.findings, true),
    uncertainties: record.uncertainties,
  }, options);
  return assertCanonicalStoredValue(value, normalized, 'Story Material aggregate result');
}

export function parseReferenceStoryMaterialProjectionResult(
  value: unknown,
  options: NormalizeReferenceStoryMaterialReductionOptions,
): ReferenceStoryMaterialProjectionResult {
  const record = requireRecord(value, 'Stored Story Material projection result');
  const normalized = normalizeReferenceStoryMaterialProjectionModelOutput({
    entries: stripStoredFindings(record.entries, true),
    uncertainties: record.uncertainties,
  }, options);
  return assertCanonicalStoredValue(value, normalized, 'Story Material projection result');
}

export function collectReferenceStoryMaterialFindings(
  output:
    | ReferenceStoryMaterialChapterResult
    | ReferenceStoryMaterialAggregateResult
    | ReferenceStoryMaterialProjectionResult,
): ReferenceStoryMaterialFinding[] {
  return ('entries' in output ? output.entries : output.findings).map((finding) => ({
    ...finding,
    details: [...finding.details],
    evidenceRefs: [...finding.evidenceRefs],
    sourceFindingRefs: [...finding.sourceFindingRefs],
  }));
}

export function formatReferenceStoryMaterialCoveragePreviewMarkdown(
  preview: ReferenceStoryMaterialCoveragePreview,
): string {
  return ensureTrailingNewline([
    '# Story Material Coverage Preview',
    '',
    '> Specific source-story material coverage; not transferable technique analysis.',
    '',
    ...preview.items.flatMap((item) => [
      `## ${materialKindTitle(item.materialKind)}`,
      '',
      `- Coverage: ${item.coverage}`,
      `- Confidence: ${item.confidence}`,
      `- Evidence: ${item.evidenceRefs.join(', ') || 'none'}`,
      `- Summary: ${item.summary}`,
      ...(item.uncertainty ? [`- Uncertainty: ${item.uncertainty}`] : []),
      '',
    ]),
  ].join('\n'));
}

export function formatReferenceStoryMaterialChapterMarkdown(
  result: ReferenceStoryMaterialChapterResult,
): string {
  return formatFindingsMarkdown(
    `Story Material Chapter ${result.chapterId}`,
    result.summary,
    result.findings,
    result.uncertainties,
  );
}

export function formatReferenceStoryMaterialAggregateMarkdown(
  result: ReferenceStoryMaterialAggregateResult,
): string {
  return formatFindingsMarkdown(
    'Story Material Aggregate',
    result.summary,
    result.findings,
    result.uncertainties,
  );
}

export function formatReferenceStoryMaterialProjectionYaml(
  result: ReferenceStoryMaterialProjectionResult,
  materialKind: ReferenceStoryMaterialKind,
): string {
  const kind = requireMaterialKind(materialKind, 'materialKind');
  if (
    result.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || result.track !== 'storyMaterial'
    || result.entries.some((entry) =>
      entry.track !== 'storyMaterial'
      || !result.materialKinds.includes(entry.materialKind)
      || !entry.evidenceRefs.length
      || !entry.sourceFindingRefs.length)
  ) {
    throw new Error('Story Material projection is invalid for formatting.');
  }
  assertUniqueFindingIds(result.entries, 'projection entries');
  if (!result.materialKinds.includes(kind)) {
    throw new Error(`Story Material projection did not select ${kind}.`);
  }
  const document = {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    track: 'storyMaterial',
    runId: requireSafeIdentifier(result.runId, 'runId'),
    unitId: requireSafeIdentifier(result.unitId, 'unitId'),
    materialKind: kind,
    entries: result.entries
      .filter((entry) => entry.materialKind === kind)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        content: entry.content,
        details: [...entry.details],
        assertionType: entry.assertionType,
        confidence: entry.confidence,
        evidenceRefs: [...entry.evidenceRefs],
        sourceFindingRefs: [...entry.sourceFindingRefs],
        ...(entry.uncertainty ? { uncertainty: entry.uncertainty } : {}),
      })),
    uncertainties: [...result.uncertainties],
  };
  return ensureTrailingNewline(
    `# Specific source-story facts; not transferable technique observations.\n${stringify(document)}`,
  );
}

export function referenceStoryMaterialKindPath(
  materialKind: ReferenceStoryMaterialKind,
): `materials/${ReferenceStoryMaterialKind}.yaml` {
  const kind = requireMaterialKind(materialKind, 'materialKind');
  return `materials/${kind}.yaml`;
}

export function assertReferenceStoryMaterialUnit(
  value: ReferenceDeconstructionWorkUnit,
  phase: 'chapter' | 'aggregate' | 'projection',
): ReferenceDeconstructionWorkUnit {
  const expected = phase === 'chapter'
    ? { stageId: 'materialChapterAnalysis', kind: 'chapterChunk' }
    : phase === 'aggregate'
      ? { stageId: 'materialAggregateAnalysis', kind: 'aggregate' }
      : { stageId: 'materialProjection', kind: 'materialProjection' };
  if (
    !value
    || value.track !== 'storyMaterial'
    || value.stageId !== expected.stageId
    || value.kind !== expected.kind
  ) {
    throw new Error(
      `Story Material ${phase} requires a storyMaterial ${expected.stageId}/${expected.kind} unit.`,
    );
  }
  requireSafeIdentifier(value.id, 'unitId');
  return value;
}

export function createReferenceStoryMaterialOutputHash(
  output: ReferenceStoryMaterialQualityOutput,
): string {
  return createHash('sha256').update(stableJson(output)).digest('hex');
}

export function evaluateReferenceStoryMaterialQuality(
  input: EvaluateReferenceStoryMaterialQualityInput,
): ReferenceStoryMaterialQualityReport {
  const runId = requireSafeIdentifier(input.runId, 'runId');
  const evaluatedAt = qualityIsoDate(input.evaluatedAt);
  const plan = input.plan;
  const diagnostics: ReferenceDeconstructionDiagnostic[] = [];
  const storyUnits = plan.units.filter((unit) => unit.track === 'storyMaterial');
  const requiredUnits = storyUnits.filter((unit) => unit.kind !== 'analysisQuality');
  const chapterUnits = requiredUnits.filter((unit) => unit.kind === 'chapterChunk');
  const aggregateUnits = requiredUnits.filter((unit) => unit.kind === 'aggregate');
  const projectionUnits = requiredUnits.filter((unit) =>
    unit.kind === 'materialProjection');
  const materialKinds = qualityPlanMaterialKinds(plan, diagnostics);

  qualityValidatePlan(plan, storyUnits, diagnostics);
  const attemptsByUnitId = qualityCollectUniqueByUnitId(
    input.selectedAttempts,
    'attempt',
    diagnostics,
  );
  const outputsByUnitId = qualityCollectUniqueByUnitId(
    input.outputs,
    'output',
    diagnostics,
  );
  const windowsByPointerId = qualityCollectWindows(input.sourceWindows, diagnostics);
  const requiredUnitIds = new Set(requiredUnits.map((unit) => unit.id));
  const plannedPointerIds = new Set(chapterUnits
    .map((unit) => unit.pointerId)
    .filter((pointerId): pointerId is string => pointerId !== undefined));

  for (const unitId of attemptsByUnitId.keys()) {
    if (!requiredUnitIds.has(unitId)) {
      diagnostics.push(qualityBlocking(
        `quality-material-attempt-unplanned-${qualityStableToken(unitId)}`,
        'quality.attempt.unplanned',
        `Selected Story Material attempt belongs to unplanned work unit ${unitId}.`,
      ));
    }
  }
  for (const unitId of outputsByUnitId.keys()) {
    if (!requiredUnitIds.has(unitId)) {
      diagnostics.push(qualityBlocking(
        `quality-material-output-unplanned-${qualityStableToken(unitId)}`,
        'quality.output.unplanned',
        `Validated Story Material output belongs to unplanned work unit ${unitId}.`,
      ));
    }
  }
  for (const pointerId of windowsByPointerId.keys()) {
    if (!plannedPointerIds.has(pointerId)) {
      diagnostics.push(qualityBlocking(
        `quality-material-window-unplanned-${qualityStableToken(pointerId)}`,
        'quality.sourceWindow.unplanned',
        `Source window ${pointerId} does not belong to the Story Material plan.`,
      ));
    }
  }

  const outputHashesByUnitId = new Map<string, string>();
  for (const unit of requiredUnits) {
    const attempt = attemptsByUnitId.get(unit.id);
    const output = outputsByUnitId.get(unit.id);
    if (!attempt) {
      diagnostics.push(qualityBlocking(
        `quality-material-attempt-missing-${unit.ordinal}`,
        'quality.attempt.missing',
        `Story Material work unit ${unit.id} has no selected attempt.`,
        unit,
      ));
    } else {
      qualityValidateAttempt(unit, attempt, attemptsByUnitId, diagnostics);
    }
    if (!output) {
      diagnostics.push(qualityBlocking(
        `quality-material-output-missing-${unit.ordinal}`,
        'quality.output.missing',
        `Story Material work unit ${unit.id} has no validated output.`,
        unit,
      ));
      continue;
    }
    let actualHash: string | undefined;
    try {
      actualHash = createReferenceStoryMaterialOutputHash(output);
      outputHashesByUnitId.set(unit.id, actualHash);
    } catch {
      diagnostics.push(qualityBlocking(
        `quality-material-output-serialization-${unit.ordinal}`,
        'quality.output.invalidStructure',
        `Story Material output for work unit ${unit.id} is not serializable.`,
        unit,
      ));
    }
    if (!attempt || !actualHash || !qualityIsSha256(attempt.outputHash)
      || attempt.outputHash !== actualHash) {
      diagnostics.push(qualityBlocking(
        `quality-material-output-hash-${unit.ordinal}`,
        'quality.output.hashMismatch',
        `Selected Story Material output hash does not match work unit ${unit.id}.`,
        unit,
      ));
    }
    if (!qualityOutputMatchesUnit(unit, output, runId)) {
      diagnostics.push(qualityBlocking(
        `quality-material-output-kind-${unit.ordinal}`,
        'quality.output.kindMismatch',
        `Validated Story Material output does not match work unit ${unit.id}.`,
        unit,
      ));
    }
  }

  qualityValidatePredecessorHashes(
    requiredUnits,
    attemptsByUnitId,
    outputHashesByUnitId,
    diagnostics,
  );
  const outputCoverage = qualityValidateOutputs({
    runId,
    plan,
    materialKinds,
    chapterUnits,
    aggregateUnits,
    projectionUnits,
    outputsByUnitId,
    windowsByPointerId,
    diagnostics,
  });
  qualityAppendCopyRiskDiagnostics(
    input.outputs,
    input.sourceWindows,
    new Map(storyUnits.map((unit) => [unit.id, unit])),
    diagnostics,
  );

  const boundedDiagnostics = qualityBoundDiagnostics(
    diagnostics,
    plan.tracks.storyMaterial?.analysisQualityUnitId
      ?? 'missing-story-material-quality-unit',
  );
  const checkedUnits = requiredUnits.filter((unit) => {
    const attempt = attemptsByUnitId.get(unit.id);
    const output = outputsByUnitId.get(unit.id);
    const hash = outputHashesByUnitId.get(unit.id);
    return attempt?.status === 'completed'
      && qualityIsSafeIdentifier(attempt.attemptId)
      && attempt.inputFingerprint === attempt.expectedInputFingerprint
      && qualityIsSha256(attempt.inputFingerprint)
      && output !== undefined
      && qualityOutputMatchesUnit(unit, output, runId)
      && hash !== undefined
      && attempt.outputHash === hash;
  });
  const checkedUnitIds = checkedUnits.map((unit) => unit.id);
  const checkedChapterUnitIds = new Set(checkedUnits
    .filter((unit) => unit.kind === 'chapterChunk')
    .map((unit) => unit.id));
  const checkedAggregateUnitIds = new Set(checkedUnits
    .filter((unit) => unit.kind === 'aggregate')
    .map((unit) => unit.id));
  const projectionCompleted = checkedUnits.some((unit) =>
    unit.kind === 'materialProjection');
  const percent = requiredUnits.length
    ? Math.floor((checkedUnits.length / requiredUnits.length) * 100)
    : 0;

  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    planId: plan.id,
    referenceId: plan.referenceId,
    sourceChecksumSha256: plan.sourceChecksumSha256,
    track: 'storyMaterial',
    status: boundedDiagnostics.some((diagnostic) => diagnostic.blocking)
      ? 'failed'
      : boundedDiagnostics.length
        ? 'warned'
        : 'passed',
    coverage: {
      plannedUnitCount: requiredUnits.length,
      checkedUnitCount: checkedUnits.length,
      plannedChapterUnitCount: chapterUnits.length,
      completedChapterUnitCount: checkedChapterUnitIds.size,
      plannedChapterCount: plan.chapterIds.length,
      coveredChapterCount: outputCoverage.coveredChapterIds.length,
      plannedAggregateUnitCount: aggregateUnits.length,
      completedAggregateUnitCount: checkedAggregateUnitIds.size,
      projectionCompleted,
      materialKinds,
      coveredMaterialKinds: outputCoverage.coveredMaterialKinds,
      percent,
    },
    checkedUnitIds,
    attemptIds: checkedUnits.map((unit) => attemptsByUnitId.get(unit.id)!.attemptId),
    outputHashes: checkedUnits.map((unit) => outputHashesByUnitId.get(unit.id)!),
    diagnostics: boundedDiagnostics,
    evaluatedAt,
  };
}

export function parseReferenceStoryMaterialQualityReport(
  value: unknown,
): ReferenceStoryMaterialQualityReport {
  const record = requireRecord(value, 'Stored Story Material quality report');
  assertOnlyKnownFields(record, [
    'version',
    'runId',
    'planId',
    'referenceId',
    'sourceChecksumSha256',
    'track',
    'status',
    'coverage',
    'checkedUnitIds',
    'attemptIds',
    'outputHashes',
    'diagnostics',
    'evaluatedAt',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new Error('Stored Story Material quality version is unsupported.');
  }
  if (record.track !== 'storyMaterial') {
    throw new Error('Stored Story Material quality report has the wrong track.');
  }
  const coverageRecord = requireRecord(
    record.coverage,
    'Stored Story Material quality coverage',
  );
  assertOnlyKnownFields(coverageRecord, [
    'plannedUnitCount',
    'checkedUnitCount',
    'plannedChapterUnitCount',
    'completedChapterUnitCount',
    'plannedChapterCount',
    'coveredChapterCount',
    'plannedAggregateUnitCount',
    'completedAggregateUnitCount',
    'projectionCompleted',
    'materialKinds',
    'coveredMaterialKinds',
    'percent',
  ]);
  const materialKinds = qualityParseMaterialKinds(
    coverageRecord.materialKinds,
    'coverage.materialKinds',
    1,
  );
  const coveredMaterialKinds = qualityParseMaterialKinds(
    coverageRecord.coveredMaterialKinds,
    'coverage.coveredMaterialKinds',
    0,
  );
  if (coveredMaterialKinds.some((kind) => !materialKinds.includes(kind))) {
    throw new Error('Stored Story Material quality kind coverage is inconsistent.');
  }
  const coverage: ReferenceStoryMaterialQualityCoverage = {
    plannedUnitCount: qualityInteger(
      coverageRecord.plannedUnitCount,
      'coverage.plannedUnitCount',
      1,
      2_047,
    ),
    checkedUnitCount: qualityInteger(
      coverageRecord.checkedUnitCount,
      'coverage.checkedUnitCount',
      0,
      2_047,
    ),
    plannedChapterUnitCount: qualityInteger(
      coverageRecord.plannedChapterUnitCount,
      'coverage.plannedChapterUnitCount',
      1,
      2_047,
    ),
    completedChapterUnitCount: qualityInteger(
      coverageRecord.completedChapterUnitCount,
      'coverage.completedChapterUnitCount',
      0,
      2_047,
    ),
    plannedChapterCount: qualityInteger(
      coverageRecord.plannedChapterCount,
      'coverage.plannedChapterCount',
      1,
      100_000,
    ),
    coveredChapterCount: qualityInteger(
      coverageRecord.coveredChapterCount,
      'coverage.coveredChapterCount',
      0,
      100_000,
    ),
    plannedAggregateUnitCount: qualityInteger(
      coverageRecord.plannedAggregateUnitCount,
      'coverage.plannedAggregateUnitCount',
      1,
      2_047,
    ),
    completedAggregateUnitCount: qualityInteger(
      coverageRecord.completedAggregateUnitCount,
      'coverage.completedAggregateUnitCount',
      0,
      2_047,
    ),
    projectionCompleted: qualityBoolean(
      coverageRecord.projectionCompleted,
      'coverage.projectionCompleted',
    ),
    materialKinds,
    coveredMaterialKinds,
    percent: qualityInteger(coverageRecord.percent, 'coverage.percent', 0, 100),
  };
  const checkedUnitIds = requireIdentifierArray(
    record.checkedUnitIds,
    'checkedUnitIds',
    0,
    2_047,
  );
  const attemptIds = requireIdentifierArray(record.attemptIds, 'attemptIds', 0, 2_047);
  const outputHashes = qualityHashes(record.outputHashes, 'outputHashes', 0, 2_047);
  const diagnostics = requireArray(
    record.diagnostics,
    'Story Material quality diagnostics',
    0,
    MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  ).map((diagnostic, index) => qualityParseDiagnostic(diagnostic, index));
  if (new Set(diagnostics.map((diagnostic) => diagnostic.id)).size !== diagnostics.length) {
    throw new Error('Stored Story Material quality diagnostics contain duplicate ids.');
  }
  const status = requireEnum(
    record.status,
    ['passed', 'warned', 'failed'] as const,
    'Story Material quality status',
  );
  const expectedPercent = Math.floor(
    (coverage.checkedUnitCount / coverage.plannedUnitCount) * 100,
  );
  if (
    coverage.checkedUnitCount !== checkedUnitIds.length
    || attemptIds.length !== checkedUnitIds.length
    || outputHashes.length !== checkedUnitIds.length
    || coverage.completedChapterUnitCount > coverage.plannedChapterUnitCount
    || coverage.coveredChapterCount > coverage.plannedChapterCount
    || coverage.completedAggregateUnitCount > coverage.plannedAggregateUnitCount
    || coverage.plannedUnitCount !== (
      coverage.plannedChapterUnitCount + coverage.plannedAggregateUnitCount + 1
    )
    || coverage.checkedUnitCount !== (
      coverage.completedChapterUnitCount
      + coverage.completedAggregateUnitCount
      + Number(coverage.projectionCompleted)
    )
    || coverage.percent !== expectedPercent
    || status === 'passed' && (
      diagnostics.length !== 0
      || coverage.percent !== 100
      || coverage.coveredChapterCount !== coverage.plannedChapterCount
      || coverage.coveredMaterialKinds.length !== coverage.materialKinds.length
    )
    || status === 'warned' && (
      diagnostics.length === 0
      || diagnostics.some((diagnostic) => diagnostic.blocking)
    )
    || status === 'failed' && !diagnostics.some((diagnostic) => diagnostic.blocking)
  ) {
    throw new Error('Stored Story Material quality report is internally inconsistent.');
  }
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId: requireSafeIdentifier(record.runId, 'runId'),
    planId: requireSafeIdentifier(record.planId, 'planId'),
    referenceId: requireSafeIdentifier(record.referenceId, 'referenceId'),
    sourceChecksumSha256: requireSha256(
      record.sourceChecksumSha256,
      'sourceChecksumSha256',
    ),
    track: 'storyMaterial',
    status,
    coverage,
    checkedUnitIds,
    attemptIds,
    outputHashes,
    diagnostics,
    evaluatedAt: qualityIsoDate(record.evaluatedAt),
  };
}

function qualityPlanMaterialKinds(
  plan: ReferenceDeconstructionWorkPlan,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): ReferenceStoryMaterialKind[] {
  const raw = plan.tracks.storyMaterial?.materialKinds;
  if (
    !Array.isArray(raw)
    || !raw.length
    || new Set(raw).size !== raw.length
    || raw.some((kind) => !REFERENCE_STORY_MATERIAL_KINDS.includes(kind))
  ) {
    diagnostics.push(qualityBlocking(
      'quality-material-plan-kinds',
      'quality.plan.invalidMaterialKinds',
      'The Story Material work plan has invalid material kinds.',
    ));
  }
  return REFERENCE_STORY_MATERIAL_KINDS.filter((kind) => raw?.includes(kind));
}

function qualityValidatePlan(
  plan: ReferenceDeconstructionWorkPlan,
  storyUnits: readonly ReferenceDeconstructionWorkUnit[],
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  if (
    plan.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || !qualityIsSafeIdentifier(plan.id)
    || !qualityIsSafeIdentifier(plan.referenceId)
    || !qualityIsSha256(plan.sourceChecksumSha256)
    || !qualityIsSha256(plan.structureFingerprint)
    || !Array.isArray(plan.chapterIds)
    || !plan.chapterIds.length
    || new Set(plan.chapterIds).size !== plan.chapterIds.length
    || plan.chapterIds.some((chapterId) => !qualityIsSafeIdentifier(chapterId))
  ) {
    diagnostics.push(qualityBlocking(
      'quality-material-plan-identity',
      'quality.plan.invalidIdentity',
      'The Story Material work plan identity or source fingerprint is invalid.',
    ));
  }
  const allIdCounts = new Map<string, number>();
  for (const unit of plan.units) {
    allIdCounts.set(unit.id, (allIdCounts.get(unit.id) ?? 0) + 1);
  }
  if (
    !storyUnits.length
    || storyUnits.some((unit) => allIdCounts.get(unit.id) !== 1)
  ) {
    diagnostics.push(qualityBlocking(
      'quality-material-plan-units',
      'quality.plan.invalidUnits',
      'The Story Material work plan must contain unique work units.',
    ));
  }
  const storyUnitIds = new Set(storyUnits.map((unit) => unit.id));
  for (const unit of storyUnits) {
    const planIndex = plan.units.indexOf(unit);
    const expectedShape = unit.kind === 'chapterChunk'
      ? unit.stageId === 'materialChapterAnalysis'
      : unit.kind === 'aggregate'
        ? unit.stageId === 'materialAggregateAnalysis'
        : unit.kind === 'materialProjection'
          ? unit.stageId === 'materialProjection'
          : unit.kind === 'analysisQuality' && unit.stageId === 'qualityGate';
    if (
      !qualityIsSafeIdentifier(unit.id)
      || !Number.isSafeInteger(unit.ordinal)
      || unit.ordinal !== planIndex + 1
      || !expectedShape
    ) {
      diagnostics.push(qualityBlocking(
        `quality-material-plan-unit-${qualityStableToken(String(unit.id))}`,
        'quality.plan.invalidUnits',
        `Story Material work unit ${unit.id} has an invalid identity, order, or stage.`,
        unit,
      ));
    }
    if (
      !Array.isArray(unit.predecessorUnitIds)
      || new Set(unit.predecessorUnitIds).size !== unit.predecessorUnitIds.length
      || unit.predecessorUnitIds.some((unitId) => !storyUnitIds.has(unitId))
      || unit.predecessorUnitIds.some((unitId) => {
        const predecessor = storyUnits.find((candidate) => candidate.id === unitId);
        return !predecessor || predecessor.ordinal >= unit.ordinal;
      })
    ) {
      diagnostics.push(qualityBlocking(
        `quality-material-plan-predecessor-${unit.ordinal}`,
        'quality.plan.invalidPredecessor',
        `Story Material work unit ${unit.id} has an invalid predecessor closure.`,
        unit,
      ));
    }
  }

  const track = plan.tracks.storyMaterial;
  const root = storyUnits.find((unit) => unit.id === track?.aggregateRootUnitId);
  const projection = storyUnits.find((unit) => unit.id === track?.projectionUnitId);
  const quality = storyUnits.find((unit) => unit.id === track?.analysisQualityUnitId);
  const projectionUnits = storyUnits.filter((unit) => unit.kind === 'materialProjection');
  const qualityUnits = storyUnits.filter((unit) => unit.kind === 'analysisQuality');
  if (
    !track
    || root?.kind !== 'aggregate'
    || root.stageId !== 'materialAggregateAnalysis'
    || projection?.kind !== 'materialProjection'
    || projection.stageId !== 'materialProjection'
    || quality?.kind !== 'analysisQuality'
    || quality.stageId !== 'qualityGate'
    || projectionUnits.length !== 1
    || qualityUnits.length !== 1
    || !qualitySameSet(projection.predecessorUnitIds, [root.id])
    || !qualitySameSet(quality.predecessorUnitIds, [projection.id])
  ) {
    diagnostics.push(qualityBlocking(
      'quality-material-plan-terminal',
      'quality.plan.invalidTerminalUnits',
      'The Story Material aggregate, projection, or quality terminal is invalid.',
    ));
  }
  const selectedKinds = Array.isArray(plan.outputs)
    ? REFERENCE_STORY_MATERIAL_KINDS.filter((kind) => plan.outputs.includes(kind))
    : [];
  const trackKinds = REFERENCE_STORY_MATERIAL_KINDS.filter((kind) =>
    track?.materialKinds.includes(kind));
  if (!qualitySameSet(selectedKinds, trackKinds)) {
    diagnostics.push(qualityBlocking(
      'quality-material-plan-output-selection',
      'quality.plan.outputSelectionMismatch',
      'The Story Material track does not match the selected plan outputs.',
    ));
  }
  const plannedChapterIds = new Set(storyUnits
    .filter((unit) => unit.kind === 'chapterChunk')
    .map((unit) => unit.chapterId)
    .filter((chapterId): chapterId is string => chapterId !== undefined));
  if (plan.chapterIds.some((chapterId) => !plannedChapterIds.has(chapterId))) {
    diagnostics.push(qualityBlocking(
      'quality-material-plan-chapters',
      'quality.plan.invalidChapterUnits',
      'The Story Material work plan does not contain units for every planned chapter.',
    ));
  }
}

function qualityCollectUniqueByUnitId<T extends { unitId: string }>(
  values: readonly T[],
  label: 'attempt' | 'output',
  diagnostics: ReferenceDeconstructionDiagnostic[],
): Map<string, T> {
  const result = new Map<string, T>();
  values.forEach((value, index) => {
    if (!qualityIsSafeIdentifier(value.unitId)) {
      diagnostics.push(qualityBlocking(
        `quality-material-${label}-identity-${index}`,
        `quality.${label}.invalidIdentity`,
        `A Story Material ${label} has an invalid work-unit identity.`,
      ));
      return;
    }
    if (result.has(value.unitId)) {
      diagnostics.push(qualityBlocking(
        `quality-material-${label}-duplicate-${index}`,
        `quality.${label}.duplicate`,
        `Story Material work unit ${value.unitId} has duplicate ${label}s.`,
      ));
      return;
    }
    result.set(value.unitId, value);
  });
  return result;
}

function qualityCollectWindows(
  windows: readonly ReferenceChapterWorkUnitWindow[],
  diagnostics: ReferenceDeconstructionDiagnostic[],
): Map<string, ReferenceChapterWorkUnitWindow> {
  const result = new Map<string, ReferenceChapterWorkUnitWindow>();
  windows.forEach((window, index) => {
    if (
      !qualityIsSafeIdentifier(window.pointerId)
      || result.has(window.pointerId)
      || typeof window.content !== 'string'
      || !window.content.length
      || window.charLength !== window.content.length
      || !qualityValidPointer(window.pointer)
    ) {
      diagnostics.push(qualityBlocking(
        `quality-material-source-window-${index}`,
        'quality.sourceWindow.invalid',
        'A Story Material source window is malformed or duplicated.',
      ));
      return;
    }
    result.set(window.pointerId, window);
  });
  return result;
}

function qualityValidateAttempt(
  unit: ReferenceDeconstructionWorkUnit,
  attempt: ReferenceStoryMaterialQualitySelectedAttempt,
  attemptsByUnitId: ReadonlyMap<string, ReferenceStoryMaterialQualitySelectedAttempt>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  if (!qualityIsSafeIdentifier(attempt.attemptId)) {
    diagnostics.push(qualityBlocking(
      `quality-material-attempt-id-${unit.ordinal}`,
      'quality.attempt.invalidIdentity',
      `Story Material work unit ${unit.id} has an invalid attempt id.`,
      unit,
    ));
  }
  if (attempt.status !== 'completed') {
    diagnostics.push(qualityBlocking(
      `quality-material-attempt-status-${unit.ordinal}`,
      'quality.attempt.incomplete',
      `Selected attempt for Story Material work unit ${unit.id} is incomplete.`,
      unit,
    ));
  }
  if (
    !qualityIsSha256(attempt.inputFingerprint)
    || !qualityIsSha256(attempt.expectedInputFingerprint)
    || attempt.inputFingerprint !== attempt.expectedInputFingerprint
  ) {
    diagnostics.push(qualityBlocking(
      `quality-material-input-hash-${unit.ordinal}`,
      'quality.input.hashMismatch',
      `Selected input fingerprint does not match Story Material work unit ${unit.id}.`,
      unit,
    ));
  }
  if (
    !Array.isArray(attempt.predecessorOutputHashes)
    || attempt.predecessorOutputHashes.length !== unit.predecessorUnitIds.length
    || attempt.predecessorOutputHashes.some((hash) => !qualityIsSha256(hash))
  ) {
    diagnostics.push(qualityBlocking(
      `quality-material-predecessor-hash-shape-${unit.ordinal}`,
      'quality.predecessor.invalidHashes',
      `Story Material work unit ${unit.id} has invalid predecessor hashes.`,
      unit,
    ));
  }
  if (unit.predecessorUnitIds.some((unitId) => !attemptsByUnitId.has(unitId))) {
    diagnostics.push(qualityBlocking(
      `quality-material-predecessor-attempt-${unit.ordinal}`,
      'quality.predecessor.missingAttempt',
      `Story Material work unit ${unit.id} has an unselected predecessor attempt.`,
      unit,
    ));
  }
}

function qualityValidatePredecessorHashes(
  units: readonly ReferenceDeconstructionWorkUnit[],
  attemptsByUnitId: ReadonlyMap<string, ReferenceStoryMaterialQualitySelectedAttempt>,
  outputHashesByUnitId: ReadonlyMap<string, string>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  for (const unit of units) {
    const attempt = attemptsByUnitId.get(unit.id);
    if (!attempt) continue;
    const expected = unit.predecessorUnitIds.map((unitId) =>
      outputHashesByUnitId.get(unitId));
    if (
      expected.some((hash) => hash === undefined)
      || expected.length !== attempt.predecessorOutputHashes.length
      || expected.some((hash, index) => hash !== attempt.predecessorOutputHashes[index])
    ) {
      diagnostics.push(qualityBlocking(
        `quality-material-predecessor-closure-${unit.ordinal}`,
        'quality.predecessor.closureMismatch',
        `Story Material work unit ${unit.id} was not produced from selected predecessors.`,
        unit,
      ));
    }
  }
}

function qualityOutputMatchesUnit(
  unit: ReferenceDeconstructionWorkUnit,
  output: ReferenceStoryMaterialQualityOutput,
  runId: string,
): boolean {
  if (
    !qualityIsRecord(output)
    ||
    output.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || output.runId !== runId
    || output.unitId !== unit.id
    || output.track !== 'storyMaterial'
  ) return false;
  return unit.kind === 'chapterChunk' && unit.stageId === 'materialChapterAnalysis'
    ? qualityIsChapterOutput(output)
    : unit.kind === 'aggregate' && unit.stageId === 'materialAggregateAnalysis'
      ? qualityIsAggregateOutput(output)
      : unit.kind === 'materialProjection' && unit.stageId === 'materialProjection'
        ? qualityIsProjectionOutput(output)
        : false;
}

function qualityValidateOutputs(input: {
  runId: string;
  plan: ReferenceDeconstructionWorkPlan;
  materialKinds: readonly ReferenceStoryMaterialKind[];
  chapterUnits: readonly ReferenceDeconstructionWorkUnit[];
  aggregateUnits: readonly ReferenceDeconstructionWorkUnit[];
  projectionUnits: readonly ReferenceDeconstructionWorkUnit[];
  outputsByUnitId: ReadonlyMap<string, ReferenceStoryMaterialQualityOutput>;
  windowsByPointerId: ReadonlyMap<string, ReferenceChapterWorkUnitWindow>;
  diagnostics: ReferenceDeconstructionDiagnostic[];
}): {
  coveredChapterIds: string[];
  coveredMaterialKinds: ReferenceStoryMaterialKind[];
} {
  const allowedPointers = Object.freeze(Object.fromEntries(
    [...input.windowsByPointerId].map(([pointerId, window]) => [pointerId, window.pointer]),
  )) as ReferenceEvidencePointerMap;
  const unitsById = new Map(input.plan.units.map((unit) => [unit.id, unit]));
  const allFindingIds = new Set<string>();

  for (const unit of input.chapterUnits) {
    const output = input.outputsByUnitId.get(unit.id);
    if (!qualityIsChapterOutput(output)) continue;
    if (
      !unit.chapterId
      || !unit.chunkId
      || !unit.pointerId
      || !unit.pointer
      || output.chapterId !== unit.chapterId
      || output.chunkId !== unit.chunkId
    ) {
      input.diagnostics.push(qualityBlocking(
        `quality-material-chapter-identity-${unit.ordinal}`,
        'quality.chapter.invalidUnit',
        `Story Material chapter output ${unit.id} has invalid source identity.`,
        unit,
      ));
      continue;
    }
    const window = input.windowsByPointerId.get(unit.pointerId);
    if (!window || !qualitySamePointer(window.pointer, unit.pointer)) {
      input.diagnostics.push(qualityBlocking(
        `quality-material-pointer-window-${unit.ordinal}`,
        'quality.pointer.missingWindow',
        `Story Material chapter unit ${unit.id} has no matching source window.`,
        unit,
      ));
    }
    if (
      unit.pointer.referenceId !== input.plan.referenceId
      || unit.pointer.sourceChecksumSha256 !== input.plan.sourceChecksumSha256
      || unit.pointer.chapterId !== unit.chapterId
      || unit.pointer.chunkId !== unit.chunkId
    ) {
      input.diagnostics.push(qualityBlocking(
        `quality-material-pointer-identity-${unit.ordinal}`,
        'quality.pointer.identityMismatch',
        `Story Material chapter unit ${unit.id} points outside the selected source.`,
        unit,
      ));
    }
    qualityValidateCoverageSet(
      output.coveredUnitIds,
      [unit.id],
      unit,
      'units',
      input.diagnostics,
    );
    qualityValidateCoverageSet(
      output.coveredChapterIds,
      [unit.chapterId],
      unit,
      'chapters',
      input.diagnostics,
    );
    const evidenceOwners: Array<{ id: string; refs: readonly string[] }> = [
      { id: `${unit.id}-summary`, refs: output.summaryEvidenceRefs },
      ...output.findings.map((finding) => ({ id: finding.id, refs: finding.evidenceRefs })),
    ];
    for (const owner of evidenceOwners) {
      qualityValidateEvidenceRefs(
        owner.id,
        owner.refs,
        unit,
        unit.pointerId,
        input.windowsByPointerId,
        input.diagnostics,
      );
    }
    qualityTrackFindingIds(output.findings, allFindingIds, unit, input.diagnostics);
    try {
      parseReferenceStoryMaterialChapterResult(output, {
        runId: input.runId,
        unit,
        materialKinds: input.materialKinds,
        allowedPointers,
      });
    } catch {
      input.diagnostics.push(qualityBlocking(
        `quality-material-output-structure-${unit.ordinal}`,
        'quality.output.invalidStructure',
        `Story Material chapter output ${unit.id} is not canonical.`,
        unit,
      ));
    }
  }

  for (const unit of [...input.aggregateUnits].sort((left, right) =>
    left.ordinal - right.ordinal)) {
    const output = input.outputsByUnitId.get(unit.id);
    if (!qualityIsAggregateOutput(output)) continue;
    const predecessors = qualityDirectPredecessorFindings(
      unit,
      input.outputsByUnitId,
    );
    qualityValidateDerivedFindings(
      output.findings,
      predecessors,
      unit,
      input.windowsByPointerId,
      input.diagnostics,
    );
    qualityTrackFindingIds(output.findings, allFindingIds, unit, input.diagnostics);
    const expectedCoverage = qualityExpectedDirectCoverage(
      unit,
      unitsById,
      input.outputsByUnitId,
    );
    qualityValidateCoverageSet(
      output.coveredUnitIds,
      expectedCoverage.unitIds,
      unit,
      'units',
      input.diagnostics,
    );
    qualityValidateCoverageSet(
      output.coveredChapterIds,
      expectedCoverage.chapterIds,
      unit,
      'chapters',
      input.diagnostics,
    );
    try {
      parseReferenceStoryMaterialAggregateResult(output, {
        runId: input.runId,
        unit,
        materialKinds: input.materialKinds,
        verifiedFindings: Object.fromEntries(predecessors),
        coveredUnitIds: output.coveredUnitIds,
        coveredChapterIds: output.coveredChapterIds,
      });
    } catch {
      input.diagnostics.push(qualityBlocking(
        `quality-material-output-structure-${unit.ordinal}`,
        'quality.output.invalidStructure',
        `Story Material aggregate output ${unit.id} is not canonical.`,
        unit,
      ));
    }
  }

  let finalProjection: ReferenceStoryMaterialProjectionResult | undefined;
  for (const unit of input.projectionUnits) {
    const output = input.outputsByUnitId.get(unit.id);
    if (!qualityIsProjectionOutput(output)) continue;
    const predecessors = qualityDirectPredecessorFindings(
      unit,
      input.outputsByUnitId,
    );
    qualityValidateDerivedFindings(
      output.entries,
      predecessors,
      unit,
      input.windowsByPointerId,
      input.diagnostics,
    );
    qualityTrackFindingIds(output.entries, allFindingIds, unit, input.diagnostics);
    const expectedCoverage = qualityExpectedDirectCoverage(
      unit,
      unitsById,
      input.outputsByUnitId,
    );
    qualityValidateCoverageSet(
      output.coveredUnitIds,
      expectedCoverage.unitIds,
      unit,
      'units',
      input.diagnostics,
    );
    qualityValidateCoverageSet(
      output.coveredChapterIds,
      expectedCoverage.chapterIds,
      unit,
      'chapters',
      input.diagnostics,
    );
    try {
      parseReferenceStoryMaterialProjectionResult(output, {
        runId: input.runId,
        unit,
        materialKinds: input.materialKinds,
        verifiedFindings: Object.fromEntries(predecessors),
        coveredUnitIds: output.coveredUnitIds,
        coveredChapterIds: output.coveredChapterIds,
      });
    } catch {
      input.diagnostics.push(qualityBlocking(
        `quality-material-output-structure-${unit.ordinal}`,
        'quality.output.invalidStructure',
        `Story Material projection output ${unit.id} is not canonical.`,
        unit,
      ));
    }
    if (unit.id === input.plan.tracks.storyMaterial?.projectionUnitId) {
      finalProjection = output;
    }
  }

  const coveredChapterIds = input.plan.chapterIds.filter((chapterId) =>
    finalProjection?.coveredChapterIds.includes(chapterId));
  if (coveredChapterIds.length !== input.plan.chapterIds.length) {
    input.diagnostics.push(qualityWarning(
      'quality-material-final-chapter-coverage',
      'quality.material.coverage.incomplete',
      `Story Material projection covers ${coveredChapterIds.length} of ${input.plan.chapterIds.length} planned chapters.`,
      input.projectionUnits[0],
    ));
  }
  const coveredMaterialKinds = REFERENCE_STORY_MATERIAL_KINDS.filter((kind) =>
    finalProjection?.entries.some((entry) => entry.materialKind === kind));
  for (const kind of input.materialKinds) {
    if (!coveredMaterialKinds.includes(kind)) {
      input.diagnostics.push(qualityWarning(
        `quality-material-kind-coverage-${kind}`,
        'quality.material.kindCoverage.insufficient',
        `Story Material projection has no entry for selected material kind ${kind}.`,
        input.projectionUnits[0],
      ));
    }
  }
  return { coveredChapterIds, coveredMaterialKinds };
}

function qualityValidateCoverageSet(
  actual: readonly string[],
  expected: readonly string[],
  unit: ReferenceDeconstructionWorkUnit,
  dimension: 'units' | 'chapters',
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  if (
    !Array.isArray(actual)
    || new Set(actual).size !== actual.length
    || actual.some((value) => !qualityIsSafeIdentifier(value))
  ) {
    diagnostics.push(qualityBlocking(
      `quality-material-coverage-shape-${unit.ordinal}-${dimension}`,
      'quality.predecessor.coverageMismatch',
      `Story Material output ${unit.id} has malformed ${dimension} coverage.`,
      unit,
    ));
    return;
  }
  const unexpected = actual.filter((value) => !expected.includes(value));
  if (unexpected.length) {
    diagnostics.push(qualityBlocking(
      `quality-material-coverage-closure-${unit.ordinal}-${dimension}`,
      'quality.predecessor.coverageMismatch',
      `Story Material output ${unit.id} claims ${dimension} outside predecessor closure.`,
      unit,
    ));
  }
  const missing = expected.filter((value) => !actual.includes(value));
  if (missing.length) {
    diagnostics.push(qualityWarning(
      `quality-material-coverage-incomplete-${unit.ordinal}-${dimension}`,
      'quality.material.coverage.incomplete',
      `Story Material output ${unit.id} has incomplete ${dimension} coverage.`,
      unit,
    ));
  }
}

function qualityValidateEvidenceRefs(
  ownerId: string,
  refs: readonly string[],
  unit: ReferenceDeconstructionWorkUnit,
  requiredPointerId: string | undefined,
  windowsByPointerId: ReadonlyMap<string, ReferenceChapterWorkUnitWindow>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  if (
    !Array.isArray(refs)
    || !refs.length
    || new Set(refs).size !== refs.length
    || refs.some((ref) => !windowsByPointerId.has(ref))
  ) {
    diagnostics.push(qualityBlocking(
      `quality-material-evidence-window-${qualityStableToken(ownerId)}`,
      'quality.evidence.missingWindow',
      `Story Material output ${ownerId} has an invalid evidence-window closure.`,
      unit,
    ));
  }
  if (requiredPointerId && !refs.includes(requiredPointerId)) {
    diagnostics.push(qualityBlocking(
      `quality-material-evidence-current-${qualityStableToken(ownerId)}`,
      'quality.evidence.missingCurrentPointer',
      `Story Material output ${ownerId} does not cite its current source window.`,
      unit,
    ));
  }
}

function qualityValidateDerivedFindings(
  findings: readonly ReferenceStoryMaterialFinding[],
  allowedFindings: ReadonlyMap<string, ReferenceStoryMaterialFinding>,
  unit: ReferenceDeconstructionWorkUnit,
  windowsByPointerId: ReadonlyMap<string, ReferenceChapterWorkUnitWindow>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  findings.forEach((finding, index) => {
    const sources = finding.sourceFindingRefs
      .map((findingId) => allowedFindings.get(findingId));
    const expectedEvidence = uniqueStrings(sources
      .filter((source): source is ReferenceStoryMaterialFinding => source !== undefined)
      .flatMap((source) => source.evidenceRefs));
    if (
      finding.track !== 'storyMaterial'
      || !finding.sourceFindingRefs.length
      || new Set(finding.sourceFindingRefs).size !== finding.sourceFindingRefs.length
      || sources.some((source) => source === undefined)
      || sources.some((source) => source?.materialKind !== finding.materialKind)
      || !qualitySameSet(finding.evidenceRefs, expectedEvidence)
    ) {
      diagnostics.push(qualityBlocking(
        `quality-material-finding-closure-${unit.ordinal}-${index}`,
        'quality.finding.closureMismatch',
        `Story Material finding ${finding.id} has invalid predecessor or evidence closure.`,
        unit,
      ));
    }
    qualityValidateEvidenceRefs(
      finding.id,
      finding.evidenceRefs,
      unit,
      undefined,
      windowsByPointerId,
      diagnostics,
    );
  });
}

function qualityTrackFindingIds(
  findings: readonly ReferenceStoryMaterialFinding[],
  known: Set<string>,
  unit: ReferenceDeconstructionWorkUnit,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  findings.forEach((finding, index) => {
    if (!qualityIsSafeIdentifier(finding.id) || known.has(finding.id)) {
      diagnostics.push(qualityBlocking(
        `quality-material-finding-id-${unit.ordinal}-${index}`,
        'quality.finding.invalidIdentity',
        `Story Material finding at ${unit.id}:${index} has a duplicate or invalid id.`,
        unit,
      ));
    }
    known.add(finding.id);
  });
}

function qualityDirectPredecessorFindings(
  unit: ReferenceDeconstructionWorkUnit,
  outputsByUnitId: ReadonlyMap<string, ReferenceStoryMaterialQualityOutput>,
): Map<string, ReferenceStoryMaterialFinding> {
  const result = new Map<string, ReferenceStoryMaterialFinding>();
  for (const predecessorUnitId of unit.predecessorUnitIds) {
    const output = outputsByUnitId.get(predecessorUnitId);
    if (qualityIsChapterOutput(output) || qualityIsAggregateOutput(output)) {
      collectReferenceStoryMaterialFindings(output).forEach((finding) =>
        result.set(finding.id, finding));
    }
  }
  return result;
}

function qualityExpectedDirectCoverage(
  unit: ReferenceDeconstructionWorkUnit,
  unitsById: ReadonlyMap<string, ReferenceDeconstructionWorkUnit>,
  outputsByUnitId: ReadonlyMap<string, ReferenceStoryMaterialQualityOutput>,
): { unitIds: string[]; chapterIds: string[] } {
  const unitIds: string[] = [];
  const chapterIds = new Set<string>();
  for (const predecessorUnitId of unit.predecessorUnitIds) {
    const predecessorUnit = unitsById.get(predecessorUnitId);
    const predecessorOutput = outputsByUnitId.get(predecessorUnitId);
    if (!predecessorUnit || !predecessorOutput) continue;
    unitIds.push(predecessorUnitId);
    if (qualityIsChapterOutput(predecessorOutput)) {
      chapterIds.add(predecessorOutput.chapterId);
    } else {
      predecessorOutput.coveredChapterIds.forEach((chapterId) =>
        chapterIds.add(chapterId));
    }
  }
  return { unitIds, chapterIds: [...chapterIds] };
}

interface StoryMaterialQualityCandidate {
  id: string;
  unitId: string;
  text: string;
}

interface StoryMaterialOverlapSource {
  pointerId: string;
  source: string;
}

interface StoryMaterialRollingHashLocation {
  pointerId: string;
  source: string;
  index: number;
}

function qualityAppendCopyRiskDiagnostics(
  outputs: readonly ReferenceStoryMaterialQualityOutput[],
  windows: readonly ReferenceChapterWorkUnitWindow[],
  unitsById: ReadonlyMap<string, ReferenceDeconstructionWorkUnit>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  const sources = windows
    .filter((window) =>
      qualityIsSafeIdentifier(window.pointerId)
      && typeof window.content === 'string')
    .map((window) => ({
      pointerId: window.pointerId,
      source: qualityNormalizeOverlapText(window.content),
    }))
    .filter((source) => Boolean(source.source));
  const candidates = outputs.flatMap((output) => qualityOutputCandidates(output));
  const totalSourceChars = sources.reduce((total, value) => total + value.source.length, 0);
  const totalOutputChars = candidates.reduce((total, value) => total + value.text.length, 0);
  if (
    totalSourceChars > MAX_REFERENCE_ANALYSIS_QUALITY_SOURCE_CHARS
    || totalOutputChars > MAX_REFERENCE_ANALYSIS_QUALITY_OUTPUT_CHARS
  ) {
    diagnostics.push(qualityBlocking(
      'quality-material-copy-risk-overflow',
      'quality.copyRisk.scanOverflow',
      'Story Material exact-overlap scanning exceeded its deterministic bound.',
    ));
    return;
  }
  const index = qualityCreateOverlapIndex(sources, REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS);
  for (const candidate of candidates) {
    const normalized = qualityNormalizeOverlapText(candidate.text);
    const pointerId = normalized.length >= REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS
      ? qualityFindOverlapPointer(
          normalized,
          index,
          REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS,
        )
      : undefined;
    if (!pointerId) continue;
    diagnostics.push(qualityWarning(
      `quality-material-copy-risk-${qualityStableToken(candidate.id)}`,
      'quality.copyRisk.exactOverlap',
      `Story Material output ${candidate.id} contains an 80-character exact source overlap.`,
      unitsById.get(candidate.unitId),
      pointerId,
    ));
  }
}

function qualityOutputCandidates(
  output: ReferenceStoryMaterialQualityOutput,
): StoryMaterialQualityCandidate[] {
  const result: StoryMaterialQualityCandidate[] = [];
  const append = (id: string, text: unknown) => {
    if (typeof text === 'string' && text) {
      result.push({ id, unitId: output.unitId, text });
    }
  };
  if (qualityIsChapterOutput(output) || qualityIsAggregateOutput(output)) {
    append(`${output.unitId}-summary`, output.summary);
    output.findings.forEach((finding, index) =>
      qualityAppendFindingCandidates(output.unitId, finding, index, append));
  } else if (qualityIsProjectionOutput(output)) {
    output.entries.forEach((finding, index) =>
      qualityAppendFindingCandidates(output.unitId, finding, index, append));
  }
  if (Array.isArray(output.uncertainties)) {
    output.uncertainties.forEach((uncertainty, index) =>
      append(`${output.unitId}-uncertainty-${index}`, uncertainty));
  }
  return result;
}

function qualityAppendFindingCandidates(
  unitId: string,
  finding: ReferenceStoryMaterialFinding,
  index: number,
  append: (id: string, text: unknown) => void,
): void {
  append(`${unitId}-finding-${index}-title`, finding.title);
  append(`${unitId}-finding-${index}-content`, finding.content);
  if (Array.isArray(finding.details)) {
    finding.details.forEach((detail, detailIndex) =>
      append(`${unitId}-finding-${index}-detail-${detailIndex}`, detail));
  }
  append(`${unitId}-finding-${index}-uncertainty`, finding.uncertainty);
}

function qualityCreateOverlapIndex(
  sources: readonly StoryMaterialOverlapSource[],
  length: number,
): Map<number, StoryMaterialRollingHashLocation[]> {
  const result = new Map<number, StoryMaterialRollingHashLocation[]>();
  for (const { pointerId, source } of sources) {
    if (source.length < length) continue;
    qualityForEachRollingHash(source, length, (hash, offset) => {
      const locations = result.get(hash) ?? [];
      const probe = source.slice(offset, offset + length);
      if (!locations.some((location) =>
        location.pointerId === pointerId
        && location.source.slice(location.index, location.index + length) === probe)) {
        locations.push({ pointerId, source, index: offset });
      }
      result.set(hash, locations);
    });
  }
  return result;
}

function qualityFindOverlapPointer(
  candidate: string,
  index: ReadonlyMap<number, readonly StoryMaterialRollingHashLocation[]>,
  length: number,
): string | undefined {
  let pointerId: string | undefined;
  qualityForEachRollingHash(candidate, length, (hash, offset) => {
    if (pointerId) return;
    const probe = candidate.slice(offset, offset + length);
    pointerId = (index.get(hash) ?? []).find((location) =>
      location.source.slice(location.index, location.index + length) === probe)
      ?.pointerId;
  });
  return pointerId;
}

function qualityForEachRollingHash(
  value: string,
  length: number,
  visit: (hash: number, offset: number) => void,
): void {
  if (value.length < length) return;
  const base = 16777619;
  let power = 1;
  for (let index = 1; index < length; index += 1) {
    power = Math.imul(power, base) >>> 0;
  }
  let hash = 0;
  for (let index = 0; index < length; index += 1) {
    hash = (Math.imul(hash, base) + value.charCodeAt(index)) >>> 0;
  }
  visit(hash, 0);
  for (let offset = 1; offset <= value.length - length; offset += 1) {
    const outgoing = Math.imul(value.charCodeAt(offset - 1), power) >>> 0;
    hash = (hash - outgoing) >>> 0;
    hash = (Math.imul(hash, base) + value.charCodeAt(offset + length - 1)) >>> 0;
    visit(hash, offset);
  }
}

function qualityBoundDiagnostics(
  diagnostics: readonly ReferenceDeconstructionDiagnostic[],
  qualityUnitId: string,
): ReferenceDeconstructionDiagnostic[] {
  const unique = [...new Map(diagnostics.map((diagnostic) => [
    diagnostic.id,
    diagnostic,
  ])).values()];
  if (unique.length <= MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS) return unique;
  const overflow: ReferenceDeconstructionDiagnostic = {
    id: 'quality-material-diagnostic-overflow',
    code: 'quality.diagnostic.overflow',
    severity: 'error',
    blocking: true,
    message: `Story Material quality exceeded its diagnostic bound; inspect ${qualityUnitId}.`,
    evidenceRefs: [],
    stageId: 'qualityGate',
  };
  const prioritized = unique
    .filter((diagnostic) => diagnostic.id !== overflow.id)
    .sort((left, right) =>
      Number(right.blocking) - Number(left.blocking)
      || qualitySeverityRank(right.severity) - qualitySeverityRank(left.severity)
      || left.id.localeCompare(right.id));
  return [
    ...prioritized.slice(0, MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS - 1),
    overflow,
  ];
}

function qualityBlocking(
  id: string,
  code: string,
  message: string,
  unit?: ReferenceDeconstructionWorkUnit,
): ReferenceDeconstructionDiagnostic {
  return {
    id,
    code,
    severity: 'error',
    blocking: true,
    message: qualityBoundedMessage(message),
    evidenceRefs: [],
    ...(unit ? { stageId: unit.stageId, unitId: unit.id } : {}),
    ...(unit?.chapterId ? { chapterId: unit.chapterId } : {}),
  };
}

function qualityWarning(
  id: string,
  code: string,
  message: string,
  unit?: ReferenceDeconstructionWorkUnit,
  pointerId = unit?.pointerId,
): ReferenceDeconstructionDiagnostic {
  return {
    id,
    code,
    severity: 'warning',
    blocking: false,
    message: qualityBoundedMessage(message),
    evidenceRefs: pointerId ? [pointerId] : [],
    ...(unit ? { stageId: unit.stageId, unitId: unit.id } : {}),
    ...(unit?.chapterId ? { chapterId: unit.chapterId } : {}),
    ...(pointerId ? { pointerId } : {}),
  };
}

function qualityParseDiagnostic(
  value: unknown,
  index: number,
): ReferenceDeconstructionDiagnostic {
  const record = requireRecord(value, `Story Material quality diagnostic ${index}`);
  assertOnlyKnownFields(record, [
    'id',
    'code',
    'severity',
    'blocking',
    'message',
    'evidenceRefs',
    'stageId',
    'chapterId',
    'pointerId',
    'unitId',
    'attemptId',
  ]);
  const severity = requireEnum(
    record.severity,
    ['info', 'warning', 'error'] as const,
    `diagnostics[${index}].severity`,
  );
  const blocking = qualityBoolean(record.blocking, `diagnostics[${index}].blocking`);
  if (blocking !== (severity === 'error')) {
    throw new Error('Stored Story Material diagnostic severity is inconsistent.');
  }
  return {
    id: requireSafeIdentifier(record.id, `diagnostics[${index}].id`),
    code: qualityCode(record.code, `diagnostics[${index}].code`),
    severity,
    blocking,
    message: qualityBoundedText(record.message, `diagnostics[${index}].message`, 2_000),
    evidenceRefs: requireIdentifierArray(
      record.evidenceRefs,
      `diagnostics[${index}].evidenceRefs`,
      0,
      64,
    ),
    ...(record.stageId === undefined
      ? {}
      : {
          stageId: requireEnum(
            record.stageId,
            REFERENCE_DECONSTRUCTION_STAGE_IDS,
            `diagnostics[${index}].stageId`,
          ),
        }),
    ...(record.chapterId === undefined
      ? {}
      : { chapterId: requireSafeIdentifier(record.chapterId, 'diagnostic chapterId') }),
    ...(record.pointerId === undefined
      ? {}
      : { pointerId: requireSafeIdentifier(record.pointerId, 'diagnostic pointerId') }),
    ...(record.unitId === undefined
      ? {}
      : { unitId: requireSafeIdentifier(record.unitId, 'diagnostic unitId') }),
    ...(record.attemptId === undefined
      ? {}
      : { attemptId: requireSafeIdentifier(record.attemptId, 'diagnostic attemptId') }),
  };
}

function qualityParseMaterialKinds(
  value: unknown,
  label: string,
  minimum: number,
): ReferenceStoryMaterialKind[] {
  const kinds = requireArray(value, label, minimum, REFERENCE_STORY_MATERIAL_KINDS.length)
    .map((kind) => requireMaterialKind(kind, label));
  if (new Set(kinds).size !== kinds.length) {
    throw new Error(`${label} must contain unique kinds.`);
  }
  const canonical = REFERENCE_STORY_MATERIAL_KINDS.filter((kind) => kinds.includes(kind));
  if (stableJson(kinds) !== stableJson(canonical)) {
    throw new Error(`${label} must use canonical order.`);
  }
  return kinds;
}

function qualityHashes(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string[] {
  const hashes = requireArray(value, label, minimum, maximum)
    .map((hash) => requireSha256(hash, label));
  if (new Set(hashes).size !== hashes.length) {
    throw new Error(`${label} must contain unique hashes.`);
  }
  return hashes;
}

function qualityInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum
    || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function qualityBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

function qualityCode(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function qualityBoundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.replaceAll(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maximum || normalized !== value) {
    throw new Error(`${label} must be canonical bounded text.`);
  }
  return normalized;
}

function qualityIsoDate(value?: unknown): string {
  const result = value === undefined ? new Date().toISOString() : value;
  if (typeof result !== 'string' || Number.isNaN(Date.parse(result))) {
    throw new Error('Story Material quality evaluatedAt must be an ISO date.');
  }
  const canonical = new Date(result).toISOString();
  if (canonical !== result) {
    throw new Error('Story Material quality evaluatedAt must be canonical ISO text.');
  }
  return result;
}

function qualityValidPointer(value: ReferenceSourcePointer): boolean {
  return Boolean(value)
    && qualityIsSafeIdentifier(value.referenceId)
    && qualityIsSha256(value.sourceChecksumSha256)
    && qualityIsSafeIdentifier(value.chapterId)
    && qualityIsSafeIdentifier(value.chunkId)
    && Number.isSafeInteger(value.lineStart)
    && Number.isSafeInteger(value.lineEnd)
    && value.lineStart >= 1
    && value.lineEnd >= value.lineStart;
}

function qualitySamePointer(left: ReferenceSourcePointer, right: ReferenceSourcePointer): boolean {
  return left.referenceId === right.referenceId
    && left.sourceChecksumSha256 === right.sourceChecksumSha256
    && left.chapterId === right.chapterId
    && left.chunkId === right.chunkId
    && left.lineStart === right.lineStart
    && left.lineEnd === right.lineEnd;
}

function qualityIsChapterOutput(
  value: unknown,
): value is ReferenceStoryMaterialChapterResult {
  return qualityIsRecord(value)
    && 'chapterId' in value
    && Array.isArray(value.findings)
    && Array.isArray(value.summaryEvidenceRefs)
    && Array.isArray(value.coveredUnitIds)
    && Array.isArray(value.coveredChapterIds)
    && Array.isArray(value.uncertainties);
}

function qualityIsAggregateOutput(
  value: unknown,
): value is ReferenceStoryMaterialAggregateResult {
  return qualityIsRecord(value)
    && !('chapterId' in value)
    && Array.isArray(value.findings)
    && Array.isArray(value.coveredUnitIds)
    && Array.isArray(value.coveredChapterIds)
    && Array.isArray(value.uncertainties);
}

function qualityIsProjectionOutput(
  value: unknown,
): value is ReferenceStoryMaterialProjectionResult {
  return qualityIsRecord(value)
    && Array.isArray(value.entries)
    && Array.isArray(value.coveredUnitIds)
    && Array.isArray(value.coveredChapterIds)
    && Array.isArray(value.uncertainties);
}

function qualityIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function qualitySameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

function qualityIsSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && /^[\p{L}\p{N}_:.-]{1,180}$/u.test(value)
    && !value.includes('..');
}

function qualityIsSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function qualityBoundedMessage(value: string): string {
  const normalized = value.replaceAll(/\s+/gu, ' ').trim()
    || 'Story Material quality validation failed.';
  return normalized.length <= 2_000 ? normalized : `${normalized.slice(0, 1_997)}...`;
}

function qualityNormalizeOverlapText(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

function qualitySeverityRank(
  value: ReferenceDeconstructionDiagnostic['severity'],
): number {
  return value === 'error' ? 2 : value === 'warning' ? 1 : 0;
}

function qualityStableToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function normalizeChapterFinding(
  value: unknown,
  index: number,
  options: {
    runId: string;
    unit: ReferenceDeconstructionWorkUnit;
    materialKinds: readonly ReferenceStoryMaterialKind[];
    allowedPointers: ReferenceEvidencePointerMap;
  },
): ReferenceStoryMaterialFinding {
  const record = requireRecord(value, `Story Material chapter finding ${index}`);
  assertOnlyKnownFields(record, [
    'materialKind',
    'title',
    'content',
    'details',
    'assertionType',
    'confidence',
    'evidenceRefs',
    'uncertainty',
  ]);
  const materialKind = requireSelectedMaterialKind(record.materialKind, options.materialKinds);
  const assertionType = requireEnum(
    record.assertionType,
    REFERENCE_STORY_MATERIAL_ASSERTION_TYPES,
    'assertionType',
  );
  const uncertainty = validateAssertionUncertainty(
    assertionType,
    record.uncertainty,
  );
  const evidenceRefs = uniqueStrings(assertReferenceEvidenceRefs(
    record.evidenceRefs,
    options.allowedPointers,
    { chapterId: options.unit.chapterId, max: 16 },
  ));
  if (!options.unit.pointerId || !evidenceRefs.includes(options.unit.pointerId)) {
    throw new Error('Story Material chapter finding must cite its current source pointer.');
  }
  return createFinding({
    prefix: 'material-chapter',
    runId: options.runId,
    unitId: options.unit.id,
    materialKind,
    title: requireText(record.title, 'finding title', 300),
    content: requireText(record.content, 'finding content', 6_000),
    details: requireTextArray(
      record.details,
      'finding details',
      0,
      MAX_REFERENCE_STORY_MATERIAL_DETAILS,
      1_000,
    ),
    assertionType,
    confidence: requireConfidence(record.confidence, 'finding confidence'),
    evidenceRefs,
    sourceFindingRefs: [],
    uncertainty,
  });
}

function normalizeReductionFindings(
  value: unknown,
  options: {
    runId: string;
    unit: ReferenceDeconstructionWorkUnit;
    materialKinds: readonly ReferenceStoryMaterialKind[];
    verifiedFindings: ReferenceStoryMaterialVerifiedFindingMap;
    prefix: string;
    label: string;
  },
): ReferenceStoryMaterialFinding[] {
  const findings = requireArray(
    value,
    `Story Material ${options.label}s`,
    0,
    MAX_REFERENCE_STORY_MATERIAL_FINDINGS,
  ).map((item, index): ReferenceStoryMaterialFinding => {
    const record = requireRecord(item, `Story Material ${options.label} ${index}`);
    assertOnlyKnownFields(record, [
      'materialKind',
      'title',
      'content',
      'details',
      'assertionType',
      'confidence',
      'sourceFindingRefs',
      'uncertainty',
    ]);
    const materialKind = requireSelectedMaterialKind(
      record.materialKind,
      options.materialKinds,
    );
    const sourceFindingRefs = uniqueStrings(requireIdentifierArray(
      record.sourceFindingRefs,
      'sourceFindingRefs',
      1,
      32,
    ));
    const predecessors = sourceFindingRefs.map((findingId) => {
      const finding = options.verifiedFindings[findingId];
      if (
        !finding
        || finding.track !== 'storyMaterial'
        || finding.materialKind !== materialKind
      ) {
        throw new Error(
          `Story Material ${options.label} references an invalid predecessor ${findingId}.`,
        );
      }
      return finding;
    });
    const evidenceRefs = uniqueStrings(
      predecessors.flatMap((finding) => finding.evidenceRefs),
    );
    if (!evidenceRefs.length) {
      throw new Error(`Story Material ${options.label} has no evidence closure.`);
    }
    const assertionType = requireEnum(
      record.assertionType,
      REFERENCE_STORY_MATERIAL_ASSERTION_TYPES,
      'assertionType',
    );
    if (
      assertionType === 'fact'
      && predecessors.some((finding) => finding.assertionType !== 'fact')
    ) {
      throw new Error(
        `Story Material ${options.label} cannot promote interpretation or uncertainty to fact.`,
      );
    }
    return createFinding({
      prefix: options.prefix,
      runId: options.runId,
      unitId: options.unit.id,
      materialKind,
      title: requireText(record.title, `${options.label} title`, 300),
      content: requireText(record.content, `${options.label} content`, 6_000),
      details: requireTextArray(
        record.details,
        `${options.label} details`,
        0,
        MAX_REFERENCE_STORY_MATERIAL_DETAILS,
        1_000,
      ),
      assertionType,
      confidence: requireConfidence(record.confidence, `${options.label} confidence`),
      evidenceRefs,
      sourceFindingRefs,
      uncertainty: validateAssertionUncertainty(
        assertionType,
        record.uncertainty,
      ),
    });
  });
  assertUniqueFindingIds(findings, `${options.label}s`);
  return sortFindings(findings);
}

function createFinding(input: {
  prefix: string;
  runId: string;
  unitId: string;
  materialKind: ReferenceStoryMaterialKind;
  title: string;
  content: string;
  details: string[];
  assertionType: ReferenceStoryMaterialAssertionType;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  sourceFindingRefs: string[];
  uncertainty?: string;
}): ReferenceStoryMaterialFinding {
  const id = stableId(input.prefix, [
    input.runId,
    input.unitId,
    input.materialKind,
    input.title,
    input.content,
    input.assertionType,
    ...input.details,
    ...input.evidenceRefs,
    ...input.sourceFindingRefs,
  ]);
  return {
    id,
    unitId: input.unitId,
    track: 'storyMaterial',
    materialKind: input.materialKind,
    title: input.title,
    content: input.content,
    details: input.details,
    assertionType: input.assertionType,
    confidence: input.confidence,
    evidenceRefs: input.evidenceRefs,
    sourceFindingRefs: input.sourceFindingRefs,
    ...(input.uncertainty ? { uncertainty: input.uncertainty } : {}),
  };
}

function pointerMapFromSelection(
  selection: ReferenceQuickPreviewSelection,
): ReferenceEvidencePointerMap {
  const entries = selection.windows.map((window) => [window.pointerId, window.pointer] as const);
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    throw new Error('Story Material coverage pointer ids must be unique.');
  }
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeMaterialKinds(
  value: readonly ReferenceStoryMaterialKind[],
): ReferenceStoryMaterialKind[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Story Material kinds must be non-empty.');
  }
  const kinds = value.map((kind) => requireMaterialKind(kind, 'materialKind'));
  if (new Set(kinds).size !== kinds.length) {
    throw new Error('Story Material kinds must be unique.');
  }
  return REFERENCE_STORY_MATERIAL_KINDS.filter((kind) => kinds.includes(kind));
}

function requireSelectedMaterialKind(
  value: unknown,
  selected: readonly ReferenceStoryMaterialKind[],
): ReferenceStoryMaterialKind {
  const kind = requireMaterialKind(value, 'materialKind');
  if (!selected.includes(kind)) {
    throw new Error(`Story Material output includes unselected kind ${kind}.`);
  }
  return kind;
}

function requireMaterialKind(value: unknown, label: string): ReferenceStoryMaterialKind {
  return requireEnum(value, REFERENCE_STORY_MATERIAL_KINDS, label);
}

function validateAssertionUncertainty(
  assertionType: ReferenceStoryMaterialAssertionType,
  value: unknown,
): string | undefined {
  const uncertainty = optionalText(value, 'uncertainty', 2_000);
  if (assertionType === 'uncertain' && !uncertainty) {
    throw new Error('An uncertain Story Material entry requires an uncertainty explanation.');
  }
  return uncertainty;
}

function stripStoredFindings(value: unknown, reduction: boolean): unknown[] {
  return requireArray(value, 'stored Story Material findings', 0, 100).map((item) => {
    const record = requireRecord(item, 'stored Story Material finding');
    return {
      materialKind: record.materialKind,
      title: record.title,
      content: record.content,
      details: record.details,
      assertionType: record.assertionType,
      confidence: record.confidence,
      ...(reduction
        ? { sourceFindingRefs: record.sourceFindingRefs }
        : { evidenceRefs: record.evidenceRefs }),
      ...(record.uncertainty === undefined ? {} : { uncertainty: record.uncertainty }),
    };
  });
}

function assertCanonicalStoredValue<T>(value: unknown, normalized: T, label: string): T {
  if (stableJson(value) !== stableJson(normalized)) {
    throw new Error(`${label} is not canonical or contains unknown fields.`);
  }
  return normalized;
}

function formatFindingsMarkdown(
  title: string,
  summary: string,
  findings: readonly ReferenceStoryMaterialFinding[],
  uncertainties: readonly string[],
): string {
  return ensureTrailingNewline([
    `# ${title}`,
    '',
    '> Specific source-story facts; not transferable technique observations.',
    '',
    summary,
    '',
    ...findings.flatMap((finding) => [
      `## ${finding.title}`,
      '',
      `- Kind: ${finding.materialKind}`,
      `- Assertion: ${finding.assertionType}`,
      `- Confidence: ${finding.confidence}`,
      `- Evidence: ${finding.evidenceRefs.join(', ')}`,
      `- Source findings: ${finding.sourceFindingRefs.join(', ') || 'direct evidence'}`,
      '',
      finding.content,
      ...(finding.details.length ? ['', ...finding.details.map((detail) => `- ${detail}`)] : []),
      ...(finding.uncertainty ? ['', `Uncertainty: ${finding.uncertainty}`] : []),
      '',
    ]),
    ...(uncertainties.length
      ? ['## Uncertainties', '', ...uncertainties.map((item) => `- ${item}`), '']
      : []),
  ].join('\n'));
}

function sortFindings<T extends ReferenceStoryMaterialFinding>(values: T[]): T[] {
  return [...values].sort((left, right) =>
    materialKindIndex(left.materialKind) - materialKindIndex(right.materialKind)
    || left.id.localeCompare(right.id));
}

function sortByMaterialKind<T extends { materialKind: ReferenceStoryMaterialKind }>(
  values: T[],
): T[] {
  return [...values].sort((left, right) =>
    materialKindIndex(left.materialKind) - materialKindIndex(right.materialKind));
}

function materialKindIndex(kind: ReferenceStoryMaterialKind): number {
  return REFERENCE_STORY_MATERIAL_KINDS.indexOf(kind);
}

function materialKindTitle(kind: ReferenceStoryMaterialKind): string {
  return kind[0]!.toUpperCase() + kind.slice(1);
}

function assertExactKindCoverage(
  actual: readonly ReferenceStoryMaterialKind[],
  expected: readonly ReferenceStoryMaterialKind[],
): void {
  if (
    actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || expected.some((kind) => !actual.includes(kind))
  ) {
    throw new Error('Story Material coverage must contain every selected kind exactly once.');
  }
}

function assertUniqueFindingIds(
  findings: readonly ReferenceStoryMaterialFinding[],
  label: string,
): void {
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length) {
    throw new Error(`Story Material ${label} contain duplicate stable ids.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) throw new Error(`Story Material output contains unknown field ${unknown}.`);
}

function requireArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain ${minimum}-${maximum} items.`);
  }
  return value;
}

function requireText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireText(value, label, maximum);
}

function requireTextArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  itemMaximum: number,
): string[] {
  const items = requireArray(value, label, minimum, maximum)
    .map((item, index) => requireText(item, `${label}[${index}]`, itemMaximum));
  if (new Set(items).size !== items.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return items;
}

function requireIdentifierArray(
  value: unknown,
  label: string,
  minimum = 1,
  maximum = 10_000,
): string[] {
  const items = requireArray(value, label, minimum, maximum)
    .map((item) => requireSafeIdentifier(item, label));
  if (new Set(items).size !== items.length) {
    throw new Error(`${label} must contain unique identifiers.`);
  }
  return items;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_:.-]{1,180}$/u.test(value)) {
    throw new Error(`${label} must be a safe identifier.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash.`);
  }
  return value;
}

function requireConfidence(
  value: unknown,
  label: string,
): ReferenceDeconstructionConfidence {
  return requireEnum(value, ['low', 'medium', 'high'] as const, label);
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T[number];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableId(prefix: string, values: readonly string[]): string {
  return `${prefix}-${createHash('sha256').update(stableJson(values)).digest('hex').slice(0, 24)}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

export type { ReferenceStoryMaterialKind } from './reference-deconstruction-full.js';
