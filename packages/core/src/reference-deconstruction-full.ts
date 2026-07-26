import { createHash } from 'node:crypto';

import {
  REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
  REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
  REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
  assertReferenceSourcePointer,
} from './reference-deconstruction.js';
import type {
  ReferenceDeconstructionConfidence,
  ReferenceDeconstructionStageId,
  ReferenceEvidencePointerMap,
  ReferenceSourcePointer,
} from './reference-deconstruction.js';

export const MAX_REFERENCE_CHAPTER_ANALYSIS_CHUNK_CHARS = 12_000 as const;
export const MAX_REFERENCE_ROLLING_CONTEXT_CHARS = 6_000 as const;
export const MAX_REFERENCE_DECONSTRUCTION_WORK_UNITS = 2_048 as const;
export const MAX_REFERENCE_AGGREGATE_FAN_IN = 8 as const;
export const MAX_REFERENCE_DECONSTRUCTION_FINDINGS_PER_UNIT = 24 as const;
export const MAX_REFERENCE_DECONSTRUCTION_UNCERTAINTIES = 32 as const;

export type ReferenceDeconstructionWorkUnitKind =
  | 'chapterChunk'
  | 'aggregate'
  | 'style'
  | 'distill'
  | 'analysisQuality';

export interface ReferenceDeconstructionWorkUnit {
  id: string;
  ordinal: number;
  stageId: Extract<
    ReferenceDeconstructionStageId,
    | 'chapterAnalysis'
    | 'aggregateAnalysis'
    | 'styleProfile'
    | 'distillForOan'
    | 'qualityGate'
  >;
  kind: ReferenceDeconstructionWorkUnitKind;
  predecessorUnitIds: string[];
  chapterId?: string;
  chunkId?: string;
  pointerId?: string;
  pointer?: ReferenceSourcePointer;
  isLastChunkInChapter?: boolean;
  lineCharStart?: number;
  lineCharEnd?: number;
  aggregateLevel?: number;
}

export interface ReferenceDeconstructionWorkPlan {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  id: string;
  referenceId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  chapterIds: string[];
  units: ReferenceDeconstructionWorkUnit[];
  aggregateRootUnitId: string;
  styleUnitId: string;
  distillUnitId: string;
  analysisQualityUnitId: string;
}

export interface CreateReferenceDeconstructionWorkPlanInput {
  referenceId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  sourceText: string;
  chapters: ReadonlyArray<{
    id: string;
    title: string;
    lineStart: number;
    lineEnd: number;
  }>;
  maxChunkChars?: number;
  aggregateFanIn?: number;
}

export interface ReferenceChapterWorkUnitWindow {
  pointerId: string;
  pointer: ReferenceSourcePointer;
  content: string;
  charLength: number;
}

export type ReferenceDeconstructionFindingKind =
  | 'chapterSummary'
  | 'plotline'
  | 'pacing'
  | 'hook'
  | 'characterTechnique'
  | 'relationshipTechnique'
  | 'worldbuildingTechnique'
  | 'timelineObservation'
  | 'trope'
  | 'styleTechnique'
  | 'sceneTechnique';

export interface ReferenceDeconstructionFinding {
  id: string;
  kind: ReferenceDeconstructionFindingKind;
  observation: string;
  technique: string;
  whenUseful?: string;
  avoid?: string;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  sourceFindingRefs?: string[];
  generalInference: boolean;
  uncertainty?: string;
}

export interface ReferenceChapterAnalysisModelFinding {
  kind: Exclude<ReferenceDeconstructionFindingKind, 'chapterSummary'>;
  observation: string;
  technique: string;
  whenUseful?: string | null;
  avoid?: string | null;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  generalInference: boolean;
  uncertainty?: string | null;
}

export interface ReferenceEvidenceLinkedSummaryModelOutput {
  text: string;
  evidenceRefs: string[];
  confidence: ReferenceDeconstructionConfidence;
  uncertainty?: string | null;
}

export interface ReferenceChapterAnalysisModelOutput {
  unitSummary: ReferenceEvidenceLinkedSummaryModelOutput;
  chapterSummary?: ReferenceEvidenceLinkedSummaryModelOutput | null;
  findings: ReferenceChapterAnalysisModelFinding[];
  rollingSummary: string;
  rollingEvidenceRefs: string[];
  uncertainties: string[];
}

export interface ReferenceRollingContext {
  summary: string;
  evidenceRefs: string[];
  checksumSha256: string;
  charLength: number;
}

export interface ReferenceChapterAnalysisResult {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  unitId: string;
  chapterId: string;
  chunkId: string;
  unitSummary: ReferenceDeconstructionFinding;
  chapterSummary?: ReferenceDeconstructionFinding;
  findings: ReferenceDeconstructionFinding[];
  rollingContext: ReferenceRollingContext;
  coveredUnitIds: string[];
  coveredChapterIds: string[];
  uncertainties: string[];
}

export type ReferenceDeconstructionVerifiedFindingMap = Readonly<
  Record<string, ReferenceDeconstructionFinding>
>;

export interface ReferenceAggregateAnalysisModelFinding {
  kind: Exclude<ReferenceDeconstructionFindingKind, 'chapterSummary'>;
  observation: string;
  technique: string;
  whenUseful?: string | null;
  avoid?: string | null;
  confidence: ReferenceDeconstructionConfidence;
  sourceFindingRefs: string[];
  generalInference: boolean;
  uncertainty?: string | null;
}

export interface ReferenceAggregateAnalysisModelOutput {
  summary: string;
  findings: ReferenceAggregateAnalysisModelFinding[];
  uncertainties: string[];
}

export interface ReferenceAggregateAnalysisResult {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  unitId: string;
  summary: string;
  findings: ReferenceDeconstructionFinding[];
  coveredUnitIds: string[];
  coveredChapterIds: string[];
  uncertainties: string[];
}

export const REFERENCE_STYLE_PROFILE_DIMENSIONS = [
  'sentenceRhythm',
  'paragraphRhythm',
  'narrativeDistance',
  'pointOfView',
  'dialogueActionDescriptionBalance',
  'sceneOpenings',
  'sceneEndings',
  'informationDensity',
  'turnsAndReaderPromises',
] as const;

export type ReferenceStyleProfileDimension =
  typeof REFERENCE_STYLE_PROFILE_DIMENSIONS[number];

export interface ReferenceStyleProfileModelDimension {
  dimension: ReferenceStyleProfileDimension;
  observation: string;
  technique: string;
  avoid?: string | null;
  confidence: ReferenceDeconstructionConfidence;
  sourceFindingRefs: string[];
  generalInference: boolean;
  uncertainty?: string | null;
}

export interface ReferenceStyleProfileModelOutput {
  summary: string;
  dimensions: ReferenceStyleProfileModelDimension[];
  transferablePrinciples: string[];
  nonImitationBoundaries: string[];
  uncertainties: string[];
}

export interface ReferenceStyleProfileDimensionResult {
  id: string;
  dimension: ReferenceStyleProfileDimension;
  observation: string;
  technique: string;
  avoid?: string;
  confidence: ReferenceDeconstructionConfidence;
  sourceFindingRefs: string[];
  evidenceRefs: string[];
  generalInference: boolean;
  uncertainty?: string;
}

export interface ReferenceStyleProfileResult {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  unitId: string;
  summary: string;
  dimensions: ReferenceStyleProfileDimensionResult[];
  transferablePrinciples: string[];
  nonImitationBoundaries: string[];
  coveredUnitIds: string[];
  coveredChapterIds: string[];
  uncertainties: string[];
}

export interface NormalizeReferenceChapterAnalysisOptions {
  runId: string;
  unit: ReferenceDeconstructionWorkUnit;
  allowedPointers: ReferenceEvidencePointerMap;
}

export interface NormalizeReferenceAggregateAnalysisOptions {
  runId: string;
  unit: ReferenceDeconstructionWorkUnit;
  verifiedFindings: ReferenceDeconstructionVerifiedFindingMap;
  coveredUnitIds: readonly string[];
  coveredChapterIds: readonly string[];
}

export interface NormalizeReferenceStyleProfileOptions {
  runId: string;
  unit: ReferenceDeconstructionWorkUnit;
  verifiedFindings: ReferenceDeconstructionVerifiedFindingMap;
  coveredUnitIds: readonly string[];
  coveredChapterIds: readonly string[];
}

const FINDING_KIND_VALUES: readonly ReferenceDeconstructionFindingKind[] = [
  'chapterSummary',
  'plotline',
  'pacing',
  'hook',
  'characterTechnique',
  'relationshipTechnique',
  'worldbuildingTechnique',
  'timelineObservation',
  'trope',
  'styleTechnique',
  'sceneTechnique',
];

export function createReferenceDeconstructionWorkPlan(
  input: CreateReferenceDeconstructionWorkPlanInput,
): ReferenceDeconstructionWorkPlan {
  const referenceId = requireSafeIdentifier(input.referenceId, 'referenceId');
  const sourceChecksumSha256 = requireSha256(
    input.sourceChecksumSha256,
    'sourceChecksumSha256',
  );
  const structureFingerprint = requireSha256(
    input.structureFingerprint,
    'structureFingerprint',
  );
  if (typeof input.sourceText !== 'string' || !input.sourceText.length) {
    throw new Error('Reference full analysis sourceText must be non-empty.');
  }
  if (sha256(input.sourceText) !== sourceChecksumSha256) {
    throw new Error('Reference full analysis source checksum does not match sourceText.');
  }
  const maxChunkChars = boundedInteger(
    input.maxChunkChars ?? MAX_REFERENCE_CHAPTER_ANALYSIS_CHUNK_CHARS,
    1_000,
    MAX_REFERENCE_CHAPTER_ANALYSIS_CHUNK_CHARS,
    'maxChunkChars',
  );
  const aggregateFanIn = boundedInteger(
    input.aggregateFanIn ?? MAX_REFERENCE_AGGREGATE_FAN_IN,
    2,
    MAX_REFERENCE_AGGREGATE_FAN_IN,
    'aggregateFanIn',
  );
  if (!Array.isArray(input.chapters) || !input.chapters.length) {
    throw new Error('Reference full analysis requires detected chapters.');
  }

  const sourceLines = input.sourceText.split(/\r?\n/u);
  const chapterIds = input.chapters.map((chapter) =>
    requireSafeIdentifier(chapter.id, 'chapterId'));
  if (new Set(chapterIds).size !== chapterIds.length) {
    throw new Error('Reference full analysis chapter ids must be unique.');
  }

  const units: ReferenceDeconstructionWorkUnit[] = [];
  let ordinal = 0;
  let previousChapterUnitId: string | undefined;
  for (const chapter of input.chapters) {
    const chapterId = requireSafeIdentifier(chapter.id, 'chapterId');
    const lineStart = boundedInteger(chapter.lineStart, 1, sourceLines.length, 'lineStart');
    const lineEnd = boundedInteger(chapter.lineEnd, lineStart, sourceLines.length, 'lineEnd');
    const chunks = chunkReferenceChapter(
      sourceLines.slice(lineStart - 1, lineEnd),
      lineStart,
      maxChunkChars,
    );
    if (!chunks.length) {
      throw new Error(`Reference chapter ${chapterId} produced no analysis chunks.`);
    }
    chunks.forEach((chunk, chunkIndex) => {
      ordinal += 1;
      const chunkId = `${chapterId}-full-chunk-${String(chunkIndex + 1).padStart(4, '0')}`;
      const pointer: ReferenceSourcePointer = {
        referenceId,
        sourceChecksumSha256,
        chapterId,
        chunkId,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
      };
      const pointerId = stableId('full-source', [
        referenceId,
        sourceChecksumSha256,
        chapterId,
        chunkId,
        String(chunk.lineStart),
        String(chunk.lineEnd),
        sha256(chunk.content),
      ]);
      const id = stableId('unit-chapter', [referenceId, chapterId, chunkId]);
      units.push({
        id,
        ordinal,
        stageId: 'chapterAnalysis',
        kind: 'chapterChunk',
        predecessorUnitIds: previousChapterUnitId ? [previousChapterUnitId] : [],
        chapterId,
        chunkId,
        pointerId,
        pointer,
        isLastChunkInChapter: chunkIndex === chunks.length - 1,
        ...(chunk.lineCharStart === undefined
          ? {}
          : {
              lineCharStart: chunk.lineCharStart,
              lineCharEnd: chunk.lineCharEnd,
            }),
      });
      previousChapterUnitId = id;
    });
  }

  let aggregateLevel = 0;
  let aggregateInputs = units
    .filter((unit) => unit.kind === 'chapterChunk')
    .map((unit) => unit.id);
  do {
    aggregateLevel += 1;
    const nextLevel: string[] = [];
    for (let index = 0; index < aggregateInputs.length; index += aggregateFanIn) {
      const predecessorUnitIds = aggregateInputs.slice(index, index + aggregateFanIn);
      ordinal += 1;
      const id = stableId('unit-aggregate', [
        referenceId,
        String(aggregateLevel),
        String(Math.floor(index / aggregateFanIn) + 1),
        ...predecessorUnitIds,
      ]);
      units.push({
        id,
        ordinal,
        stageId: 'aggregateAnalysis',
        kind: 'aggregate',
        predecessorUnitIds,
        aggregateLevel,
      });
      nextLevel.push(id);
    }
    aggregateInputs = nextLevel;
  } while (aggregateInputs.length > 1);

  const aggregateRootUnitId = aggregateInputs[0]!;
  ordinal += 1;
  const styleUnitId = stableId('unit-style', [referenceId, aggregateRootUnitId]);
  units.push({
    id: styleUnitId,
    ordinal,
    stageId: 'styleProfile',
    kind: 'style',
    predecessorUnitIds: [aggregateRootUnitId],
  });
  ordinal += 1;
  const distillUnitId = stableId('unit-distill', [
    referenceId,
    aggregateRootUnitId,
    styleUnitId,
  ]);
  units.push({
    id: distillUnitId,
    ordinal,
    stageId: 'distillForOan',
    kind: 'distill',
    predecessorUnitIds: [aggregateRootUnitId, styleUnitId],
  });
  ordinal += 1;
  const analysisQualityUnitId = stableId('unit-analysis-quality', [
    referenceId,
    distillUnitId,
  ]);
  units.push({
    id: analysisQualityUnitId,
    ordinal,
    stageId: 'qualityGate',
    kind: 'analysisQuality',
    predecessorUnitIds: [distillUnitId],
  });

  if (units.length > MAX_REFERENCE_DECONSTRUCTION_WORK_UNITS) {
    throw new Error(
      `Reference full analysis exceeds ${MAX_REFERENCE_DECONSTRUCTION_WORK_UNITS} work units.`,
    );
  }
  const id = stableId('reference-work-plan', [
    referenceId,
    sourceChecksumSha256,
    structureFingerprint,
    String(maxChunkChars),
    String(aggregateFanIn),
    ...units.map((unit) => unit.id),
  ]);
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    id,
    referenceId,
    sourceChecksumSha256,
    structureFingerprint,
    chapterIds,
    units,
    aggregateRootUnitId,
    styleUnitId,
    distillUnitId,
    analysisQualityUnitId,
  };
}

export function resolveReferenceChapterWorkUnitWindow(
  sourceText: string,
  unit: ReferenceDeconstructionWorkUnit,
): ReferenceChapterWorkUnitWindow {
  if (
    unit.kind !== 'chapterChunk'
    || !unit.pointer
    || !unit.pointerId
    || !unit.chapterId
    || !unit.chunkId
  ) {
    throw new Error('Reference work unit is not a chapter source unit.');
  }
  const pointer = assertReferenceSourcePointer(unit.pointer);
  if (sha256(sourceText) !== pointer.sourceChecksumSha256) {
    throw new Error('Reference chapter work unit source checksum is stale.');
  }
  const lines = sourceText.split(/\r?\n/u);
  const lineRange = lines.slice(pointer.lineStart - 1, pointer.lineEnd).join('\n');
  const range = unit.lineCharStart === undefined
    ? lineRange
    : lineRange.slice(unit.lineCharStart, unit.lineCharEnd);
  if (!range.length) {
    throw new Error('Reference chapter work unit source range is empty.');
  }
  const content = range.length <= MAX_REFERENCE_CHAPTER_ANALYSIS_CHUNK_CHARS
    ? range
    : range.slice(0, MAX_REFERENCE_CHAPTER_ANALYSIS_CHUNK_CHARS);
  return {
    pointerId: requireSafeIdentifier(unit.pointerId, 'pointerId'),
    pointer,
    content,
    charLength: content.length,
  };
}

export function createReferenceDeconstructionStageInputFingerprint(input: {
  sourceChecksumSha256: string;
  structureFingerprint: string;
  stageId: ReferenceDeconstructionStageId;
  unitId: string;
  options?: unknown;
  predecessorOutputHashes: readonly string[];
  rollingContextHash?: string;
}): string {
  return sha256(stableJson({
    sourceChecksumSha256: requireSha256(
      input.sourceChecksumSha256,
      'sourceChecksumSha256',
    ),
    structureFingerprint: requireSha256(
      input.structureFingerprint,
      'structureFingerprint',
    ),
    pipelineVersion: REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
    capabilityVersion: REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
    stageId: input.stageId,
    unitId: requireSafeIdentifier(input.unitId, 'unitId'),
    options: input.options ?? null,
    predecessorOutputHashes: input.predecessorOutputHashes.map((value) =>
      requireSha256(value, 'predecessorOutputHash')),
    rollingContextHash: input.rollingContextHash
      ? requireSha256(input.rollingContextHash, 'rollingContextHash')
      : null,
  }));
}

export function normalizeReferenceChapterAnalysisModelOutput(
  value: unknown,
  options: NormalizeReferenceChapterAnalysisOptions,
): ReferenceChapterAnalysisResult {
  const unit = options.unit;
  if (
    unit.kind !== 'chapterChunk'
    || !unit.chapterId
    || !unit.chunkId
    || !unit.pointerId
  ) {
    throw new Error('Reference chapter analysis requires a chapter work unit.');
  }
  const record = requireRecord(value, 'Reference chapter analysis model output');
  assertOnlyKnownFields(record, [
    'unitSummary',
    'chapterSummary',
    'findings',
    'rollingSummary',
    'rollingEvidenceRefs',
    'uncertainties',
  ]);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const unitSummary = normalizeEvidenceLinkedSummary(
    record.unitSummary,
    'unit summary',
    options.allowedPointers,
    unit.pointerId,
    runId,
    unit.id,
    unit.chapterId,
  );
  const chapterSummaryValue = record.chapterSummary === null
    ? undefined
    : record.chapterSummary;
  if (unit.isLastChunkInChapter && chapterSummaryValue === undefined) {
    throw new Error('The last chapter chunk requires a chapter summary.');
  }
  if (!unit.isLastChunkInChapter && chapterSummaryValue !== undefined) {
    throw new Error('Only the last chapter chunk may return a chapter summary.');
  }
  const chapterSummary = chapterSummaryValue === undefined
    ? undefined
    : normalizeEvidenceLinkedSummary(
        chapterSummaryValue,
        'chapter summary',
        options.allowedPointers,
        unit.pointerId,
        runId,
        unit.id,
        unit.chapterId,
      );
  const findings = requireArray(
    record.findings,
    'chapter findings',
    1,
    MAX_REFERENCE_DECONSTRUCTION_FINDINGS_PER_UNIT,
  ).map((item, index) => normalizeChapterFinding(
    item,
    index,
    options.allowedPointers,
    unit.pointerId!,
    runId,
    unit.id,
  ));
  const rollingSummary = requireText(
    record.rollingSummary,
    'rollingSummary',
    MAX_REFERENCE_ROLLING_CONTEXT_CHARS,
  );
  const rollingEvidenceRefs = requireEvidenceRefs(
    record.rollingEvidenceRefs,
    options.allowedPointers,
    { min: 1, max: 32, requiredPointerId: unit.pointerId },
  );
  const uncertainties = requireStringArray(
    record.uncertainties,
    'chapter uncertainties',
    0,
    MAX_REFERENCE_DECONSTRUCTION_UNCERTAINTIES,
    2_000,
  );
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    unitId: unit.id,
    chapterId: unit.chapterId,
    chunkId: unit.chunkId,
    unitSummary,
    ...(chapterSummary ? { chapterSummary } : {}),
    findings,
    rollingContext: {
      summary: rollingSummary,
      evidenceRefs: rollingEvidenceRefs,
      checksumSha256: sha256(stableJson({ rollingSummary, rollingEvidenceRefs })),
      charLength: rollingSummary.length,
    },
    coveredUnitIds: [unit.id],
    coveredChapterIds: [unit.chapterId],
    uncertainties,
  };
}

export function normalizeReferenceAggregateAnalysisModelOutput(
  value: unknown,
  options: NormalizeReferenceAggregateAnalysisOptions,
): ReferenceAggregateAnalysisResult {
  if (options.unit.kind !== 'aggregate') {
    throw new Error('Reference aggregate analysis requires an aggregate work unit.');
  }
  const record = requireRecord(value, 'Reference aggregate analysis model output');
  assertOnlyKnownFields(record, ['summary', 'findings', 'uncertainties']);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const findings = requireArray(
    record.findings,
    'aggregate findings',
    1,
    MAX_REFERENCE_DECONSTRUCTION_FINDINGS_PER_UNIT,
  ).map((item, index) => normalizeDerivedFinding(
    item,
    index,
    options.verifiedFindings,
    runId,
    options.unit.id,
    'aggregate',
  ));
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    unitId: options.unit.id,
    summary: requireText(record.summary, 'aggregate summary', 6_000),
    findings,
    coveredUnitIds: requireUniqueSafeIds(
      [...options.coveredUnitIds],
      'coveredUnitIds',
      1,
      MAX_REFERENCE_DECONSTRUCTION_WORK_UNITS,
    ),
    coveredChapterIds: requireUniqueSafeIds(
      [...options.coveredChapterIds],
      'coveredChapterIds',
      1,
      100_000,
    ),
    uncertainties: requireStringArray(
      record.uncertainties,
      'aggregate uncertainties',
      0,
      MAX_REFERENCE_DECONSTRUCTION_UNCERTAINTIES,
      2_000,
    ),
  };
}

export function normalizeReferenceStyleProfileModelOutput(
  value: unknown,
  options: NormalizeReferenceStyleProfileOptions,
): ReferenceStyleProfileResult {
  if (options.unit.kind !== 'style') {
    throw new Error('Reference style analysis requires a style work unit.');
  }
  const record = requireRecord(value, 'Reference style profile model output');
  assertOnlyKnownFields(record, [
    'summary',
    'dimensions',
    'transferablePrinciples',
    'nonImitationBoundaries',
    'uncertainties',
  ]);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const dimensions = requireArray(record.dimensions, 'style dimensions', 1, 18)
    .map((item, index): ReferenceStyleProfileDimensionResult => {
      const dimension = requireRecord(item, `style dimensions[${index}]`);
      assertOnlyKnownFields(dimension, [
        'dimension',
        'observation',
        'technique',
        'avoid',
        'confidence',
        'sourceFindingRefs',
        'generalInference',
        'uncertainty',
      ]);
      const generalInference = requireBoolean(
        dimension.generalInference,
        'style generalInference',
      );
      const uncertainty = optionalText(dimension.uncertainty, 'style uncertainty', 2_000);
      const confidence = requireConfidence(dimension.confidence, 'style confidence');
      if (generalInference && (!uncertainty || confidence === 'high')) {
        throw new Error(
          'General-inference style dimensions require uncertainty and cannot be high confidence.',
        );
      }
      const sourceFindingRefs = requireSourceFindingRefs(
        dimension.sourceFindingRefs,
        options.verifiedFindings,
        generalInference,
      );
      const evidenceRefs = expandFindingEvidence(
        sourceFindingRefs,
        options.verifiedFindings,
      );
      const dimensionId = requireEnum(
        dimension.dimension,
        REFERENCE_STYLE_PROFILE_DIMENSIONS,
        'style dimension',
      );
      const observation = requireText(dimension.observation, 'style observation', 3_000);
      const technique = requireText(dimension.technique, 'style technique', 3_000);
      const avoid = optionalText(dimension.avoid, 'style avoid', 2_000);
      return {
        id: stableId('style-dimension', [
          runId,
          options.unit.id,
          dimensionId,
          String(index),
          observation,
          technique,
        ]),
        dimension: dimensionId,
        observation,
        technique,
        ...(avoid ? { avoid } : {}),
        confidence,
        sourceFindingRefs,
        evidenceRefs,
        generalInference,
        ...(uncertainty ? { uncertainty } : {}),
      };
    });
  if (new Set(dimensions.map((item) => item.dimension)).size !== dimensions.length) {
    throw new Error('Reference style dimensions must be unique.');
  }
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    unitId: options.unit.id,
    summary: requireText(record.summary, 'style summary', 6_000),
    dimensions,
    transferablePrinciples: requireStringArray(
      record.transferablePrinciples,
      'transferablePrinciples',
      1,
      32,
      2_000,
    ),
    nonImitationBoundaries: requireStringArray(
      record.nonImitationBoundaries,
      'nonImitationBoundaries',
      1,
      32,
      2_000,
    ),
    coveredUnitIds: requireUniqueSafeIds(
      [...options.coveredUnitIds],
      'coveredUnitIds',
      1,
      MAX_REFERENCE_DECONSTRUCTION_WORK_UNITS,
    ),
    coveredChapterIds: requireUniqueSafeIds(
      [...options.coveredChapterIds],
      'coveredChapterIds',
      1,
      100_000,
    ),
    uncertainties: requireStringArray(
      record.uncertainties,
      'style uncertainties',
      0,
      MAX_REFERENCE_DECONSTRUCTION_UNCERTAINTIES,
      2_000,
    ),
  };
}

export function parseReferenceChapterAnalysisResult(
  value: unknown,
  options: NormalizeReferenceChapterAnalysisOptions,
): ReferenceChapterAnalysisResult {
  const record = requireRecord(value, 'Stored reference chapter analysis');
  assertOnlyKnownFields(record, [
    'version',
    'unitId',
    'chapterId',
    'chunkId',
    'unitSummary',
    'chapterSummary',
    'findings',
    'rollingContext',
    'coveredUnitIds',
    'coveredChapterIds',
    'uncertainties',
  ]);
  const rollingContext = requireRecord(
    record.rollingContext,
    'Stored reference chapter rolling context',
  );
  const normalized = normalizeReferenceChapterAnalysisModelOutput({
    unitSummary: projectStoredSummaryToModel(record.unitSummary),
    ...(record.chapterSummary === undefined
      ? {}
      : { chapterSummary: projectStoredSummaryToModel(record.chapterSummary) }),
    findings: projectStoredFindingArrayToModel(record.findings, false),
    rollingSummary: rollingContext.summary,
    rollingEvidenceRefs: rollingContext.evidenceRefs,
    uncertainties: record.uncertainties,
  }, options);
  assertCanonicalStoredOutput(value, normalized, 'chapter analysis');
  return normalized;
}

export function parseReferenceAggregateAnalysisResult(
  value: unknown,
  options: NormalizeReferenceAggregateAnalysisOptions,
): ReferenceAggregateAnalysisResult {
  const record = requireRecord(value, 'Stored reference aggregate analysis');
  assertOnlyKnownFields(record, [
    'version',
    'unitId',
    'summary',
    'findings',
    'coveredUnitIds',
    'coveredChapterIds',
    'uncertainties',
  ]);
  const normalized = normalizeReferenceAggregateAnalysisModelOutput({
    summary: record.summary,
    findings: projectStoredFindingArrayToModel(record.findings, true),
    uncertainties: record.uncertainties,
  }, options);
  assertCanonicalStoredOutput(value, normalized, 'aggregate analysis');
  return normalized;
}

export function parseReferenceStyleProfileResult(
  value: unknown,
  options: NormalizeReferenceStyleProfileOptions,
): ReferenceStyleProfileResult {
  const record = requireRecord(value, 'Stored reference style profile');
  assertOnlyKnownFields(record, [
    'version',
    'unitId',
    'summary',
    'dimensions',
    'transferablePrinciples',
    'nonImitationBoundaries',
    'coveredUnitIds',
    'coveredChapterIds',
    'uncertainties',
  ]);
  const normalized = normalizeReferenceStyleProfileModelOutput({
    summary: record.summary,
    dimensions: projectStoredStyleDimensionArrayToModel(record.dimensions),
    transferablePrinciples: record.transferablePrinciples,
    nonImitationBoundaries: record.nonImitationBoundaries,
    uncertainties: record.uncertainties,
  }, options);
  assertCanonicalStoredOutput(value, normalized, 'style profile');
  return normalized;
}

export function collectReferenceAnalysisFindings(
  output: ReferenceChapterAnalysisResult | ReferenceAggregateAnalysisResult,
): ReferenceDeconstructionFinding[] {
  return 'unitSummary' in output
    ? [
        output.unitSummary,
        ...(output.chapterSummary ? [output.chapterSummary] : []),
        ...output.findings,
      ]
    : [...output.findings];
}

function projectStoredSummaryToModel(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    text: record.observation,
    evidenceRefs: record.evidenceRefs,
    confidence: record.confidence,
    ...(record.uncertainty === undefined ? {} : { uncertainty: record.uncertainty }),
  };
}

function projectStoredFindingArrayToModel(
  value: unknown,
  derived: boolean,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return {
      kind: record.kind,
      observation: record.observation,
      technique: record.technique,
      ...(record.whenUseful === undefined ? {} : { whenUseful: record.whenUseful }),
      ...(record.avoid === undefined ? {} : { avoid: record.avoid }),
      confidence: record.confidence,
      ...(derived
        ? { sourceFindingRefs: record.sourceFindingRefs }
        : { evidenceRefs: record.evidenceRefs }),
      generalInference: record.generalInference,
      ...(record.uncertainty === undefined ? {} : { uncertainty: record.uncertainty }),
    };
  });
}

function projectStoredStyleDimensionArrayToModel(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return {
      dimension: record.dimension,
      observation: record.observation,
      technique: record.technique,
      ...(record.avoid === undefined ? {} : { avoid: record.avoid }),
      confidence: record.confidence,
      sourceFindingRefs: record.sourceFindingRefs,
      generalInference: record.generalInference,
      ...(record.uncertainty === undefined ? {} : { uncertainty: record.uncertainty }),
    };
  });
}

function assertCanonicalStoredOutput(
  value: unknown,
  normalized: unknown,
  label: string,
): void {
  if (stableJson(value) !== stableJson(normalized)) {
    throw new Error(`Stored reference ${label} is not a canonical validated output.`);
  }
}

function normalizeEvidenceLinkedSummary(
  value: unknown,
  label: string,
  allowedPointers: ReferenceEvidencePointerMap,
  requiredPointerId: string,
  runId: string,
  unitId: string,
  chapterId: string,
): ReferenceDeconstructionFinding {
  const record = requireRecord(value, label);
  assertOnlyKnownFields(record, ['text', 'evidenceRefs', 'confidence', 'uncertainty']);
  const observation = requireText(record.text, `${label} text`, 4_000);
  const evidenceRefs = requireEvidenceRefs(record.evidenceRefs, allowedPointers, {
    min: 1,
    max: 32,
    requiredPointerId,
  });
  const uncertainty = optionalText(record.uncertainty, `${label} uncertainty`, 2_000);
  return {
    id: stableId('chapter-summary', [runId, unitId, label, observation]),
    kind: 'chapterSummary',
    observation,
    technique: `Summarize the analyzed function of ${chapterId} without copying source expression.`,
    confidence: requireConfidence(record.confidence, `${label} confidence`),
    evidenceRefs,
    generalInference: false,
    ...(uncertainty ? { uncertainty } : {}),
  };
}

function normalizeChapterFinding(
  value: unknown,
  index: number,
  allowedPointers: ReferenceEvidencePointerMap,
  currentPointerId: string,
  runId: string,
  unitId: string,
): ReferenceDeconstructionFinding {
  const record = requireRecord(value, `chapter findings[${index}]`);
  assertOnlyKnownFields(record, [
    'kind',
    'observation',
    'technique',
    'whenUseful',
    'avoid',
    'confidence',
    'evidenceRefs',
    'generalInference',
    'uncertainty',
  ]);
  const kind = requireEnum(
    record.kind,
    FINDING_KIND_VALUES.filter((item) => item !== 'chapterSummary'),
    'chapter finding kind',
  );
  const observation = requireText(record.observation, 'finding observation', 3_000);
  const technique = requireText(record.technique, 'finding technique', 3_000);
  const generalInference = requireBoolean(record.generalInference, 'generalInference');
  const uncertainty = optionalText(record.uncertainty, 'finding uncertainty', 2_000);
  const confidence = requireConfidence(record.confidence, 'finding confidence');
  if (generalInference && (!uncertainty || confidence === 'high')) {
    throw new Error(
      'General-inference chapter findings require uncertainty and cannot be high confidence.',
    );
  }
  const evidenceRefs = requireEvidenceRefs(record.evidenceRefs, allowedPointers, {
    min: generalInference ? 0 : 1,
    max: 16,
    ...(generalInference ? {} : { requiredPointerId: currentPointerId }),
  });
  const whenUseful = optionalText(record.whenUseful, 'finding whenUseful', 2_000);
  const avoid = optionalText(record.avoid, 'finding avoid', 2_000);
  return {
    id: stableId('chapter-finding', [
      runId,
      unitId,
      kind,
      String(index),
      observation,
      technique,
    ]),
    kind,
    observation,
    technique,
    ...(whenUseful ? { whenUseful } : {}),
    ...(avoid ? { avoid } : {}),
    confidence,
    evidenceRefs,
    generalInference,
    ...(uncertainty ? { uncertainty } : {}),
  };
}

function normalizeDerivedFinding(
  value: unknown,
  index: number,
  verifiedFindings: ReferenceDeconstructionVerifiedFindingMap,
  runId: string,
  unitId: string,
  label: string,
): ReferenceDeconstructionFinding {
  const record = requireRecord(value, `${label} findings[${index}]`);
  assertOnlyKnownFields(record, [
    'kind',
    'observation',
    'technique',
    'whenUseful',
    'avoid',
    'confidence',
    'sourceFindingRefs',
    'generalInference',
    'uncertainty',
  ]);
  const generalInference = requireBoolean(record.generalInference, 'generalInference');
  const uncertainty = optionalText(record.uncertainty, 'finding uncertainty', 2_000);
  const confidence = requireConfidence(record.confidence, 'finding confidence');
  if (generalInference && (!uncertainty || confidence === 'high')) {
    throw new Error(
      'General-inference aggregate findings require uncertainty and cannot be high confidence.',
    );
  }
  const sourceFindingRefs = requireSourceFindingRefs(
    record.sourceFindingRefs,
    verifiedFindings,
    generalInference,
  );
  const evidenceRefs = expandFindingEvidence(sourceFindingRefs, verifiedFindings);
  const kind = requireEnum(
    record.kind,
    FINDING_KIND_VALUES.filter((item) => item !== 'chapterSummary'),
    'aggregate finding kind',
  );
  const observation = requireText(record.observation, 'finding observation', 3_000);
  const technique = requireText(record.technique, 'finding technique', 3_000);
  const whenUseful = optionalText(record.whenUseful, 'finding whenUseful', 2_000);
  const avoid = optionalText(record.avoid, 'finding avoid', 2_000);
  return {
    id: stableId('aggregate-finding', [
      runId,
      unitId,
      kind,
      String(index),
      observation,
      technique,
    ]),
    kind,
    observation,
    technique,
    ...(whenUseful ? { whenUseful } : {}),
    ...(avoid ? { avoid } : {}),
    confidence,
    evidenceRefs,
    sourceFindingRefs,
    generalInference,
    ...(uncertainty ? { uncertainty } : {}),
  };
}

function requireSourceFindingRefs(
  value: unknown,
  findings: ReferenceDeconstructionVerifiedFindingMap,
  generalInference: boolean,
): string[] {
  const refs = requireUniqueSafeIds(
    value,
    'sourceFindingRefs',
    generalInference ? 0 : 1,
    32,
  );
  for (const ref of refs) {
    if (!findings[ref]) {
      throw new Error(`Reference analysis contains unknown source finding ref: ${ref}.`);
    }
  }
  return refs;
}

function expandFindingEvidence(
  refs: readonly string[],
  findings: ReferenceDeconstructionVerifiedFindingMap,
): string[] {
  return [...new Set(refs.flatMap((ref) => findings[ref]?.evidenceRefs ?? []))];
}

function requireEvidenceRefs(
  value: unknown,
  pointers: ReferenceEvidencePointerMap,
  options: { min: number; max: number; requiredPointerId?: string },
): string[] {
  const refs = requireUniqueSafeIds(value, 'evidenceRefs', options.min, options.max);
  for (const ref of refs) {
    if (!pointers[ref]) {
      throw new Error(`Reference analysis contains unknown evidence ref: ${ref}.`);
    }
  }
  if (options.requiredPointerId && !refs.includes(options.requiredPointerId)) {
    throw new Error(
      `Reference analysis evidence must include current pointer ${options.requiredPointerId}.`,
    );
  }
  return refs;
}

function chunkReferenceChapter(
  chapterLines: readonly string[],
  absoluteLineStart: number,
  maxChunkChars: number,
): Array<{
  content: string;
  lineStart: number;
  lineEnd: number;
  lineCharStart?: number;
  lineCharEnd?: number;
}> {
  const chunks: Array<{
    content: string;
    lineStart: number;
    lineEnd: number;
    lineCharStart?: number;
    lineCharEnd?: number;
  }> = [];
  let currentLines: string[] = [];
  let currentStart = absoluteLineStart;

  const flush = (lineEnd: number) => {
    const content = currentLines.join('\n').trimEnd();
    if (content) {
      chunks.push({ content, lineStart: currentStart, lineEnd });
    }
    currentLines = [];
  };

  chapterLines.forEach((line, offset) => {
    const absoluteLine = absoluteLineStart + offset;
    if (line.length > maxChunkChars) {
      if (currentLines.length) flush(absoluteLine - 1);
      for (let index = 0; index < line.length; index += maxChunkChars) {
        chunks.push({
          content: line.slice(index, index + maxChunkChars),
          lineStart: absoluteLine,
          lineEnd: absoluteLine,
          lineCharStart: index,
          lineCharEnd: Math.min(index + maxChunkChars, line.length),
        });
      }
      currentStart = absoluteLine + 1;
      return;
    }
    const candidateLength = currentLines.length
      ? currentLines.join('\n').length + 1 + line.length
      : line.length;
    if (currentLines.length && candidateLength > maxChunkChars) {
      flush(absoluteLine - 1);
      currentStart = absoluteLine;
    }
    if (!currentLines.length) currentStart = absoluteLine;
    currentLines.push(line);
    if (!line.trim() && currentLines.join('\n').length >= Math.floor(maxChunkChars * 0.75)) {
      flush(absoluteLine);
      currentStart = absoluteLine + 1;
    }
  });
  if (currentLines.length) flush(absoluteLineStart + chapterLines.length - 1);
  return chunks;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(record: Record<string, unknown>, fields: readonly string[]): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`Reference analysis contains unknown field: ${unknown}.`);
}

function requireArray(
  value: unknown,
  label: string,
  min: number,
  max: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain from ${min} to ${max} items.`);
  }
  return value;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.replaceAll(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} must contain from 1 to ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireText(value, label, maxLength);
}

function requireStringArray(
  value: unknown,
  label: string,
  min: number,
  max: number,
  itemMax: number,
): string[] {
  const items = requireArray(value, label, min, max).map((item, index) =>
    requireText(item, `${label}[${index}]`, itemMax));
  if (new Set(items).size !== items.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return items;
}

function requireUniqueSafeIds(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string[] {
  const items = requireArray(value, label, min, max).map((item) =>
    requireSafeIdentifier(item, label));
  if (new Set(items).size !== items.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return items;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
    || value.includes('..')
    || value.length > 180
  ) {
    throw new Error(`Reference analysis ${label} is invalid.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value;
}

function requireConfidence(value: unknown, label: string): ReferenceDeconstructionConfidence {
  return requireEnum(value, ['low', 'medium', 'high'] as const, label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

function requireEnum<const T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T;
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}-${sha256(parts.join('\u0000')).slice(0, 24)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
