import { createHash } from 'node:crypto';

import {
  MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
} from './reference-deconstruction.js';
import type {
  ReferenceDeconstructionDiagnostic,
  ReferenceSourcePointer,
} from './reference-deconstruction.js';
import {
  collectReferenceAnalysisFindings,
} from './reference-deconstruction-full.js';
import type {
  ReferenceAggregateAnalysisResult,
  ReferenceChapterAnalysisResult,
  ReferenceChapterWorkUnitWindow,
  ReferenceDeconstructionFinding,
  ReferenceDeconstructionWorkPlan,
  ReferenceDeconstructionWorkUnit,
  ReferenceStyleProfileDimensionResult,
  ReferenceStyleProfileResult,
} from './reference-deconstruction-full.js';

export const REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS = 80 as const;
export const MAX_REFERENCE_ANALYSIS_QUALITY_SOURCE_CHARS = 2_000_000 as const;
export const MAX_REFERENCE_ANALYSIS_QUALITY_OUTPUT_CHARS = 500_000 as const;

export type ReferenceDeconstructionAttemptStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'stale';

export interface ReferenceDeconstructionQualitySelectedAttempt {
  unitId: string;
  attemptId: string;
  status: ReferenceDeconstructionAttemptStatus;
  inputFingerprint: string;
  expectedInputFingerprint: string;
  predecessorOutputHashes: string[];
  outputHash: string;
}

export type ReferenceDeconstructionAnalysisOutput =
  | ReferenceChapterAnalysisResult
  | ReferenceAggregateAnalysisResult
  | ReferenceStyleProfileResult;

export interface EvaluateReferenceDeconstructionAnalysisQualityInput {
  runId: string;
  plan: ReferenceDeconstructionWorkPlan;
  selectedAttempts: readonly ReferenceDeconstructionQualitySelectedAttempt[];
  outputs: readonly ReferenceDeconstructionAnalysisOutput[];
  sourceWindows: readonly ReferenceChapterWorkUnitWindow[];
  evaluatedAt?: string;
}

export interface ReferenceDeconstructionAnalysisCoverage {
  plannedUnitCount: number;
  checkedUnitCount: number;
  plannedChapterUnitCount: number;
  completedChapterUnitCount: number;
  plannedChapterCount: number;
  completedChapterCount: number;
  plannedAggregateUnitCount: number;
  completedAggregateUnitCount: number;
  styleCompleted: boolean;
  percent: number;
}

export interface ReferenceDeconstructionAnalysisQualityReport {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  planId: string;
  referenceId: string;
  sourceChecksumSha256: string;
  status: 'passed' | 'failed';
  coverage: ReferenceDeconstructionAnalysisCoverage;
  checkedUnitIds: string[];
  selectedAttemptIds: string[];
  outputHashes: string[];
  diagnostics: ReferenceDeconstructionDiagnostic[];
  evaluatedAt: string;
}

export interface EvaluateReferenceAnalysisCopyRiskInput {
  outputs: readonly ReferenceDeconstructionAnalysisOutput[];
  sourceWindows: readonly ReferenceChapterWorkUnitWindow[];
  units: readonly ReferenceDeconstructionWorkUnit[];
}

interface QualityCandidate {
  id: string;
  unitId: string;
  text: string;
}

interface RollingHashLocation {
  source: string;
  index: number;
}

export function createReferenceAnalysisOutputHash(
  output: ReferenceDeconstructionAnalysisOutput,
): string {
  return sha256(stableJson(output));
}

export function evaluateReferenceDeconstructionAnalysisQuality(
  input: EvaluateReferenceDeconstructionAnalysisQualityInput,
): ReferenceDeconstructionAnalysisQualityReport {
  const runId = requireSafeIdentifier(input.runId, 'runId');
  const plan = input.plan;
  const evaluatedAt = normalizeDate(input.evaluatedAt);
  const diagnostics: ReferenceDeconstructionDiagnostic[] = [];
  const unitsById = new Map(plan.units.map((unit) => [unit.id, unit]));
  const requiredUnits = plan.units.filter((unit) => unit.kind !== 'analysisQuality');
  const chapterUnits = requiredUnits.filter((unit) => unit.kind === 'chapterChunk');
  const aggregateUnits = requiredUnits.filter((unit) => unit.kind === 'aggregate');
  const styleUnits = requiredUnits.filter((unit) => unit.kind === 'style');

  validatePlanShape(plan, diagnostics);

  const attemptsByUnitId = collectUniqueByUnitId(
    input.selectedAttempts,
    'attempt',
    diagnostics,
  );
  const outputsByUnitId = collectUniqueByUnitId(
    input.outputs,
    'output',
    diagnostics,
  );
  const windowsByPointerId = collectWindows(input.sourceWindows, diagnostics);
  const requiredUnitIds = new Set(requiredUnits.map((unit) => unit.id));
  for (const unitId of attemptsByUnitId.keys()) {
    if (!requiredUnitIds.has(unitId)) {
      diagnostics.push(blockingDiagnostic(
        `quality-attempt-unplanned-${stableToken(unitId)}`,
        'quality.attempt.unplanned',
        `Selected attempt belongs to unplanned work unit ${unitId}.`,
      ));
    }
  }
  for (const unitId of outputsByUnitId.keys()) {
    if (!requiredUnitIds.has(unitId)) {
      diagnostics.push(blockingDiagnostic(
        `quality-output-unplanned-${stableToken(unitId)}`,
        'quality.output.unplanned',
        `Validated output belongs to unplanned work unit ${unitId}.`,
      ));
    }
  }
  const plannedPointerIds = new Set(chapterUnits
    .map((unit) => unit.pointerId)
    .filter((pointerId): pointerId is string => pointerId !== undefined));
  for (const pointerId of windowsByPointerId.keys()) {
    if (!plannedPointerIds.has(pointerId)) {
      diagnostics.push(blockingDiagnostic(
        `quality-source-window-unplanned-${stableToken(pointerId)}`,
        'quality.sourceWindow.unplanned',
        `Source window ${pointerId} does not belong to the current work plan.`,
      ));
    }
  }

  const outputHashesByUnitId = new Map<string, string>();
  for (const unit of requiredUnits) {
    const attempt = attemptsByUnitId.get(unit.id);
    const output = outputsByUnitId.get(unit.id);
    if (!attempt) {
      diagnostics.push(blockingDiagnostic(
        `quality-missing-attempt-${unit.ordinal}`,
        'quality.attempt.missing',
        `Work unit ${unit.id} has no selected attempt.`,
        unit,
      ));
      continue;
    }
    validateAttempt(unit, attempt, attemptsByUnitId, diagnostics);
    if (!output) {
      diagnostics.push(blockingDiagnostic(
        `quality-missing-output-${unit.ordinal}`,
        'quality.output.missing',
        `Selected attempt ${attempt.attemptId} has no validated output.`,
        unit,
      ));
      continue;
    }
    const actualHash = createReferenceAnalysisOutputHash(output);
    outputHashesByUnitId.set(unit.id, actualHash);
    if (!isSha256(attempt.outputHash) || attempt.outputHash !== actualHash) {
      diagnostics.push(blockingDiagnostic(
        `quality-output-hash-${unit.ordinal}`,
        'quality.output.hashMismatch',
        `Selected output hash does not match work unit ${unit.id}.`,
        unit,
      ));
    }
    validateOutputKind(unit, output, diagnostics);
  }

  validatePredecessorClosure(
    requiredUnits,
    attemptsByUnitId,
    outputHashesByUnitId,
    diagnostics,
  );
  validateChapterCoverage(
    plan,
    chapterUnits,
    outputsByUnitId,
    windowsByPointerId,
    diagnostics,
  );
  validateDerivedCoverageAndClosure(
    plan,
    aggregateUnits,
    styleUnits,
    outputsByUnitId,
    diagnostics,
  );
  validateFindingSafety(input.outputs, diagnostics);
  appendUncertaintyDiagnostics(input.outputs, unitsById, diagnostics);
  diagnostics.push(...evaluateReferenceAnalysisCopyRisk({
    outputs: input.outputs,
    sourceWindows: input.sourceWindows,
    units: plan.units,
  }));

  const boundedDiagnostics = boundDiagnostics(diagnostics, plan.analysisQualityUnitId);
  const checkedUnitIds = requiredUnits
    .filter((unit) => {
      const attempt = attemptsByUnitId.get(unit.id);
      const output = outputsByUnitId.get(unit.id);
      return attempt?.status === 'completed'
        && output !== undefined
        && outputMatchesUnit(unit, output)
        && attempt.outputHash === createReferenceAnalysisOutputHash(output);
    })
    .map((unit) => unit.id);
  const completedChapterUnitIds = new Set(checkedUnitIds.filter((unitId) =>
    unitsById.get(unitId)?.kind === 'chapterChunk'));
  const completedChapterIds = new Set(chapterUnits
    .filter((unit) => completedChapterUnitIds.has(unit.id))
    .map((unit) => unit.chapterId)
    .filter((chapterId): chapterId is string => chapterId !== undefined));
  const completedAggregateUnitIds = new Set(checkedUnitIds.filter((unitId) =>
    unitsById.get(unitId)?.kind === 'aggregate'));
  const styleCompleted = styleUnits.length === 1
    && checkedUnitIds.includes(styleUnits[0]!.id);
  const percent = requiredUnits.length
    ? Math.floor((checkedUnitIds.length / requiredUnits.length) * 100)
    : 0;

  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    planId: plan.id,
    referenceId: plan.referenceId,
    sourceChecksumSha256: plan.sourceChecksumSha256,
    status: boundedDiagnostics.some((item) => item.blocking) ? 'failed' : 'passed',
    coverage: {
      plannedUnitCount: requiredUnits.length,
      checkedUnitCount: checkedUnitIds.length,
      plannedChapterUnitCount: chapterUnits.length,
      completedChapterUnitCount: completedChapterUnitIds.size,
      plannedChapterCount: plan.chapterIds.length,
      completedChapterCount: completedChapterIds.size,
      plannedAggregateUnitCount: aggregateUnits.length,
      completedAggregateUnitCount: completedAggregateUnitIds.size,
      styleCompleted,
      percent,
    },
    checkedUnitIds,
    selectedAttemptIds: requiredUnits
      .map((unit) => attemptsByUnitId.get(unit.id)?.attemptId)
      .filter((attemptId): attemptId is string => attemptId !== undefined),
    outputHashes: requiredUnits
      .map((unit) => outputHashesByUnitId.get(unit.id))
      .filter((hash): hash is string => hash !== undefined),
    diagnostics: boundedDiagnostics,
    evaluatedAt,
  };
}

export function evaluateReferenceAnalysisCopyRisk(
  input: EvaluateReferenceAnalysisCopyRiskInput,
): ReferenceDeconstructionDiagnostic[] {
  const diagnostics: ReferenceDeconstructionDiagnostic[] = [];
  appendCopyRiskDiagnostics(
    input.outputs,
    input.sourceWindows,
    new Map(input.units.map((unit) => [unit.id, unit])),
    diagnostics,
  );
  return diagnostics;
}

export function parseReferenceDeconstructionAnalysisQualityReport(
  value: unknown,
): ReferenceDeconstructionAnalysisQualityReport {
  const record = requireRecord(value, 'Stored reference analysis quality report');
  assertOnlyKnownFields(record, [
    'version',
    'runId',
    'planId',
    'referenceId',
    'sourceChecksumSha256',
    'status',
    'coverage',
    'checkedUnitIds',
    'selectedAttemptIds',
    'outputHashes',
    'diagnostics',
    'evaluatedAt',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new Error('Stored reference analysis quality version is unsupported.');
  }
  const coverageRecord = requireRecord(
    record.coverage,
    'Stored reference analysis quality coverage',
  );
  assertOnlyKnownFields(coverageRecord, [
    'plannedUnitCount',
    'checkedUnitCount',
    'plannedChapterUnitCount',
    'completedChapterUnitCount',
    'plannedChapterCount',
    'completedChapterCount',
    'plannedAggregateUnitCount',
    'completedAggregateUnitCount',
    'styleCompleted',
    'percent',
  ]);
  const coverage: ReferenceDeconstructionAnalysisCoverage = {
    plannedUnitCount: requireInteger(
      coverageRecord.plannedUnitCount,
      'coverage.plannedUnitCount',
      1,
      2_047,
    ),
    checkedUnitCount: requireInteger(
      coverageRecord.checkedUnitCount,
      'coverage.checkedUnitCount',
      0,
      2_047,
    ),
    plannedChapterUnitCount: requireInteger(
      coverageRecord.plannedChapterUnitCount,
      'coverage.plannedChapterUnitCount',
      1,
      2_047,
    ),
    completedChapterUnitCount: requireInteger(
      coverageRecord.completedChapterUnitCount,
      'coverage.completedChapterUnitCount',
      0,
      2_047,
    ),
    plannedChapterCount: requireInteger(
      coverageRecord.plannedChapterCount,
      'coverage.plannedChapterCount',
      1,
      100_000,
    ),
    completedChapterCount: requireInteger(
      coverageRecord.completedChapterCount,
      'coverage.completedChapterCount',
      0,
      100_000,
    ),
    plannedAggregateUnitCount: requireInteger(
      coverageRecord.plannedAggregateUnitCount,
      'coverage.plannedAggregateUnitCount',
      1,
      2_047,
    ),
    completedAggregateUnitCount: requireInteger(
      coverageRecord.completedAggregateUnitCount,
      'coverage.completedAggregateUnitCount',
      0,
      2_047,
    ),
    styleCompleted: requireBoolean(coverageRecord.styleCompleted, 'coverage.styleCompleted'),
    percent: requireInteger(coverageRecord.percent, 'coverage.percent', 0, 100),
  };
  const checkedUnitIds = requireUniqueIdentifiers(
    record.checkedUnitIds,
    'checkedUnitIds',
    0,
    2_047,
  );
  const selectedAttemptIds = requireUniqueIdentifiers(
    record.selectedAttemptIds,
    'selectedAttemptIds',
    0,
    2_047,
  );
  const outputHashes = requireUniqueHashes(record.outputHashes, 'outputHashes', 0, 2_047);
  const diagnostics = requireArray(
    record.diagnostics,
    'quality diagnostics',
    0,
    MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  ).map((diagnostic, index) => parseStoredQualityDiagnostic(diagnostic, index));
  const status = requireEnum(record.status, ['passed', 'failed'] as const, 'quality status');
  if (
    coverage.checkedUnitCount !== checkedUnitIds.length
    || selectedAttemptIds.length !== checkedUnitIds.length
    || outputHashes.length !== checkedUnitIds.length
    || coverage.completedChapterUnitCount > coverage.plannedChapterUnitCount
    || coverage.completedChapterCount > coverage.plannedChapterCount
    || coverage.completedAggregateUnitCount > coverage.plannedAggregateUnitCount
    || coverage.plannedUnitCount !== (
      coverage.plannedChapterUnitCount
      + coverage.plannedAggregateUnitCount
      + 1
    )
    || coverage.checkedUnitCount !== (
      coverage.completedChapterUnitCount
      + coverage.completedAggregateUnitCount
      + Number(coverage.styleCompleted)
    )
    || coverage.percent !== Math.floor(
      (coverage.checkedUnitCount / coverage.plannedUnitCount) * 100,
    )
    || status === 'passed' && (
      coverage.percent !== 100
      || diagnostics.some((diagnostic) => diagnostic.blocking)
    )
    || status === 'failed' && !diagnostics.some((diagnostic) => diagnostic.blocking)
  ) {
    throw new Error('Stored reference analysis quality report is internally inconsistent.');
  }
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId: requireSafeIdentifier(record.runId, 'runId'),
    planId: requireSafeIdentifier(record.planId, 'planId'),
    referenceId: requireSafeIdentifier(record.referenceId, 'referenceId'),
    sourceChecksumSha256: requireSha256(record.sourceChecksumSha256, 'sourceChecksumSha256'),
    status,
    coverage,
    checkedUnitIds,
    selectedAttemptIds,
    outputHashes,
    diagnostics,
    evaluatedAt: normalizeDate(
      typeof record.evaluatedAt === 'string' ? record.evaluatedAt : '',
    ),
  };
}

function validatePlanShape(
  plan: ReferenceDeconstructionWorkPlan,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  if (
    plan.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || !isSafeIdentifier(plan.id)
    || !isSafeIdentifier(plan.referenceId)
    || !isSha256(plan.sourceChecksumSha256)
    || !isSha256(plan.structureFingerprint)
  ) {
    diagnostics.push(blockingDiagnostic(
      'quality-plan-identity',
      'quality.plan.invalidIdentity',
      'The work plan identity or source fingerprint is invalid.',
    ));
  }
  if (!plan.units.length || new Set(plan.units.map((unit) => unit.id)).size !== plan.units.length) {
    diagnostics.push(blockingDiagnostic(
      'quality-plan-units',
      'quality.plan.invalidUnits',
      'The work plan must contain unique work units.',
    ));
  }
  const expectedOrdinals = plan.units.every((unit, index) =>
    unit.ordinal === index + 1);
  if (!expectedOrdinals) {
    diagnostics.push(blockingDiagnostic(
      'quality-plan-order',
      'quality.plan.invalidOrder',
      'The work plan unit order is not contiguous.',
    ));
  }
  const unitIds = new Set(plan.units.map((unit) => unit.id));
  for (const unit of plan.units) {
    if (
      !isSafeIdentifier(unit.id)
      || unit.predecessorUnitIds.some((unitId) => !unitIds.has(unitId))
      || unit.predecessorUnitIds.some((unitId) =>
        (plan.units.find((candidate) => candidate.id === unitId)?.ordinal ?? Infinity)
          >= unit.ordinal)
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-plan-predecessor-${unit.ordinal}`,
        'quality.plan.invalidPredecessor',
        `Work unit ${unit.id} has an invalid predecessor closure.`,
        unit,
      ));
    }
  }
  const aggregateRoot = plan.units.find((unit) => unit.id === plan.aggregateRootUnitId);
  const style = plan.units.find((unit) => unit.id === plan.styleUnitId);
  const quality = plan.units.find((unit) => unit.id === plan.analysisQualityUnitId);
  if (
    aggregateRoot?.kind !== 'aggregate'
    || style?.kind !== 'style'
    || quality?.kind !== 'analysisQuality'
  ) {
    diagnostics.push(blockingDiagnostic(
      'quality-plan-terminal-units',
      'quality.plan.invalidTerminalUnits',
      'The aggregate, style, or analysis-quality terminal unit is invalid.',
    ));
  }
}

function collectUniqueByUnitId<T extends { unitId: string }>(
  values: readonly T[],
  label: 'attempt' | 'output',
  diagnostics: ReferenceDeconstructionDiagnostic[],
): Map<string, T> {
  const byUnitId = new Map<string, T>();
  values.forEach((value, index) => {
    if (!isSafeIdentifier(value.unitId)) {
      diagnostics.push(blockingDiagnostic(
        `quality-${label}-identity-${index}`,
        `quality.${label}.invalidIdentity`,
        `A selected ${label} has an invalid work-unit identity.`,
      ));
      return;
    }
    if (byUnitId.has(value.unitId)) {
      diagnostics.push(blockingDiagnostic(
        `quality-${label}-duplicate-${index}`,
        `quality.${label}.duplicate`,
        `Work unit ${value.unitId} has multiple selected ${label}s.`,
      ));
      return;
    }
    byUnitId.set(value.unitId, value);
  });
  return byUnitId;
}

function collectWindows(
  windows: readonly ReferenceChapterWorkUnitWindow[],
  diagnostics: ReferenceDeconstructionDiagnostic[],
): Map<string, ReferenceChapterWorkUnitWindow> {
  const byPointerId = new Map<string, ReferenceChapterWorkUnitWindow>();
  windows.forEach((window, index) => {
    if (
      !isSafeIdentifier(window.pointerId)
      || byPointerId.has(window.pointerId)
      || typeof window.content !== 'string'
      || !window.content.length
      || window.charLength !== window.content.length
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-source-window-${index}`,
        'quality.sourceWindow.invalid',
        'A chapter source window is malformed or duplicated.',
      ));
      return;
    }
    byPointerId.set(window.pointerId, window);
  });
  return byPointerId;
}

function validateAttempt(
  unit: ReferenceDeconstructionWorkUnit,
  attempt: ReferenceDeconstructionQualitySelectedAttempt,
  attemptsByUnitId: ReadonlyMap<string, ReferenceDeconstructionQualitySelectedAttempt>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  if (!isSafeIdentifier(attempt.attemptId)) {
    diagnostics.push(blockingDiagnostic(
      `quality-attempt-id-${unit.ordinal}`,
      'quality.attempt.invalidIdentity',
      `Work unit ${unit.id} has an invalid selected attempt identity.`,
      unit,
    ));
  }
  if (attempt.status !== 'completed') {
    diagnostics.push(blockingDiagnostic(
      `quality-attempt-status-${unit.ordinal}`,
      'quality.attempt.incomplete',
      `Selected attempt for work unit ${unit.id} is ${attempt.status}.`,
      unit,
    ));
  }
  if (
    !isSha256(attempt.inputFingerprint)
    || !isSha256(attempt.expectedInputFingerprint)
    || attempt.inputFingerprint !== attempt.expectedInputFingerprint
  ) {
    diagnostics.push(blockingDiagnostic(
      `quality-input-hash-${unit.ordinal}`,
      'quality.input.hashMismatch',
      `Selected input fingerprint does not match work unit ${unit.id}.`,
      unit,
    ));
  }
  if (
    attempt.predecessorOutputHashes.length !== unit.predecessorUnitIds.length
    || attempt.predecessorOutputHashes.some((hash) => !isSha256(hash))
  ) {
    diagnostics.push(blockingDiagnostic(
      `quality-predecessor-hash-shape-${unit.ordinal}`,
      'quality.predecessor.invalidHashes',
      `Selected attempt for work unit ${unit.id} has invalid predecessor hashes.`,
      unit,
    ));
  }
  if (unit.predecessorUnitIds.some((unitId) => !attemptsByUnitId.has(unitId))) {
    diagnostics.push(blockingDiagnostic(
      `quality-predecessor-attempt-${unit.ordinal}`,
      'quality.predecessor.missingAttempt',
      `Work unit ${unit.id} depends on an unselected predecessor attempt.`,
      unit,
    ));
  }
}

function validatePredecessorClosure(
  units: readonly ReferenceDeconstructionWorkUnit[],
  attemptsByUnitId: ReadonlyMap<string, ReferenceDeconstructionQualitySelectedAttempt>,
  outputHashesByUnitId: ReadonlyMap<string, string>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  for (const unit of units) {
    const attempt = attemptsByUnitId.get(unit.id);
    if (!attempt) continue;
    const expectedHashes = unit.predecessorUnitIds.map((unitId) =>
      outputHashesByUnitId.get(unitId));
    if (
      expectedHashes.some((hash) => hash === undefined)
      || expectedHashes.length !== attempt.predecessorOutputHashes.length
      || expectedHashes.some((hash, index) =>
        hash !== attempt.predecessorOutputHashes[index])
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-predecessor-closure-${unit.ordinal}`,
        'quality.predecessor.closureMismatch',
        `Work unit ${unit.id} was not produced from the selected predecessor outputs.`,
        unit,
      ));
    }
  }
}

function validateOutputKind(
  unit: ReferenceDeconstructionWorkUnit,
  output: ReferenceDeconstructionAnalysisOutput,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  if (!outputMatchesUnit(unit, output)) {
    diagnostics.push(blockingDiagnostic(
      `quality-output-kind-${unit.ordinal}`,
      'quality.output.kindMismatch',
      `Validated output does not match work unit ${unit.id}.`,
      unit,
    ));
  }
}

function outputMatchesUnit(
  unit: ReferenceDeconstructionWorkUnit,
  output: ReferenceDeconstructionAnalysisOutput,
): boolean {
  return unit.kind === 'chapterChunk'
    ? isChapterOutput(output)
    : unit.kind === 'aggregate'
      ? isAggregateOutput(output)
      : unit.kind === 'style'
        ? isStyleOutput(output)
        : false;
}

function validateChapterCoverage(
  plan: ReferenceDeconstructionWorkPlan,
  units: readonly ReferenceDeconstructionWorkUnit[],
  outputsByUnitId: ReadonlyMap<string, ReferenceDeconstructionAnalysisOutput>,
  windowsByPointerId: ReadonlyMap<string, ReferenceChapterWorkUnitWindow>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  const completedChapterIds = new Set<string>();
  for (const unit of units) {
    const output = outputsByUnitId.get(unit.id);
    if (
      !unit.chapterId
      || !unit.chunkId
      || !unit.pointerId
      || !unit.pointer
      || !isChapterOutput(output)
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-chapter-unit-${unit.ordinal}`,
        'quality.chapter.invalidUnit',
        `Chapter work unit ${unit.id} is incomplete.`,
        unit,
      ));
      continue;
    }
    const pointerId = unit.pointerId;
    const window = windowsByPointerId.get(pointerId);
    if (!window || !samePointer(window.pointer, unit.pointer)) {
      diagnostics.push(blockingDiagnostic(
        `quality-pointer-window-${unit.ordinal}`,
        'quality.pointer.missingWindow',
        `Chapter work unit ${unit.id} has no matching source window.`,
        unit,
      ));
    }
    if (
      unit.pointer.referenceId !== plan.referenceId
      || unit.pointer.sourceChecksumSha256 !== plan.sourceChecksumSha256
      || unit.pointer.chapterId !== unit.chapterId
      || unit.pointer.chunkId !== unit.chunkId
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-pointer-identity-${unit.ordinal}`,
        'quality.pointer.identityMismatch',
        `Chapter work unit ${unit.id} points outside the current source identity.`,
        unit,
      ));
    }
    if (
      output.chapterId !== unit.chapterId
      || output.chunkId !== unit.chunkId
      || output.coveredUnitIds.length !== 1
      || output.coveredUnitIds[0] !== unit.id
      || output.coveredChapterIds.length !== 1
      || output.coveredChapterIds[0] !== unit.chapterId
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-chapter-coverage-${unit.ordinal}`,
        'quality.chapter.coverageMismatch',
        `Chapter output coverage does not match work unit ${unit.id}.`,
        unit,
      ));
    }
    const findings = collectReferenceAnalysisFindings(output);
    const evidenceRefs = [
      ...findings.flatMap((finding) => finding.evidenceRefs),
      ...output.rollingContext.evidenceRefs,
    ];
    if (evidenceRefs.some((evidenceRef) => evidenceRef !== pointerId)) {
      diagnostics.push(blockingDiagnostic(
        `quality-chapter-evidence-${unit.ordinal}`,
        'quality.evidence.crossUnit',
        `Chapter output ${unit.id} cites evidence outside its current source window.`,
        unit,
      ));
    }
    if (
      !output.unitSummary.evidenceRefs.includes(pointerId)
      || !output.rollingContext.evidenceRefs.includes(pointerId)
      || output.findings.some((finding) =>
        !finding.generalInference && !finding.evidenceRefs.includes(pointerId))
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-chapter-closure-${unit.ordinal}`,
        'quality.evidence.missingCurrentPointer',
        `Chapter output ${unit.id} is missing current-pointer evidence closure.`,
        unit,
      ));
    }
    if (
      unit.isLastChunkInChapter && !output.chapterSummary
      || !unit.isLastChunkInChapter && output.chapterSummary
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-chapter-summary-${unit.ordinal}`,
        'quality.chapter.summaryMismatch',
        `Chapter summary placement does not match work unit ${unit.id}.`,
        unit,
      ));
    }
    if (unit.isLastChunkInChapter && output.chapterSummary) {
      completedChapterIds.add(unit.chapterId);
    }
  }
  for (const chapterId of plan.chapterIds) {
    if (!completedChapterIds.has(chapterId)) {
      diagnostics.push(blockingDiagnostic(
        `quality-chapter-missing-${stableToken(chapterId)}`,
        'quality.chapter.missingSummary',
        `Chapter ${chapterId} has no completed final summary.`,
        undefined,
        chapterId,
      ));
    }
  }
}

function validateDerivedCoverageAndClosure(
  plan: ReferenceDeconstructionWorkPlan,
  aggregateUnits: readonly ReferenceDeconstructionWorkUnit[],
  styleUnits: readonly ReferenceDeconstructionWorkUnit[],
  outputsByUnitId: ReadonlyMap<string, ReferenceDeconstructionAnalysisOutput>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  const unitsById = new Map(plan.units.map((unit) => [unit.id, unit]));
  for (const unit of aggregateUnits) {
    const output = outputsByUnitId.get(unit.id);
    if (!isAggregateOutput(output)) continue;
    const expectedCoverage = expectedPredecessorCoverage(
      unit,
      unitsById,
      outputsByUnitId,
    );
    if (
      !sameSet(output.coveredUnitIds, expectedCoverage.unitIds)
      || !sameSet(output.coveredChapterIds, expectedCoverage.chapterIds)
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-aggregate-coverage-${unit.ordinal}`,
        'quality.aggregate.coverageMismatch',
        `Aggregate output ${unit.id} does not cover its selected predecessors.`,
        unit,
      ));
    }
    validateFindingClosure(
      unit,
      output.findings,
      collectDirectPredecessorFindings(unit, outputsByUnitId),
      diagnostics,
    );
  }

  if (styleUnits.length !== 1) {
    diagnostics.push(blockingDiagnostic(
      'quality-style-count',
      'quality.style.invalidCount',
      'The work plan must contain exactly one style unit.',
    ));
    return;
  }
  const styleUnit = styleUnits[0]!;
  const styleOutput = outputsByUnitId.get(styleUnit.id);
  if (!isStyleOutput(styleOutput)) return;
  const rootOutput = outputsByUnitId.get(plan.aggregateRootUnitId);
  const rootCoverage = isAggregateOutput(rootOutput)
    ? {
        unitIds: rootOutput.coveredUnitIds,
        chapterIds: rootOutput.coveredChapterIds,
      }
    : { unitIds: [], chapterIds: [] };
  if (
    !sameSet(styleOutput.coveredUnitIds, rootCoverage.unitIds)
    || !sameSet(styleOutput.coveredChapterIds, rootCoverage.chapterIds)
    || !sameSet(styleOutput.coveredChapterIds, plan.chapterIds)
  ) {
    diagnostics.push(blockingDiagnostic(
      `quality-style-coverage-${styleUnit.ordinal}`,
      'quality.style.coverageMismatch',
      'The style profile does not cover the aggregate root and all chapters.',
      styleUnit,
    ));
  }
  validateStyleFindingClosure(
    styleUnit,
    styleOutput.dimensions,
    collectDirectPredecessorFindings(styleUnit, outputsByUnitId),
    diagnostics,
  );
}

function expectedPredecessorCoverage(
  unit: ReferenceDeconstructionWorkUnit,
  unitsById: ReadonlyMap<string, ReferenceDeconstructionWorkUnit>,
  outputsByUnitId: ReadonlyMap<string, ReferenceDeconstructionAnalysisOutput>,
): { unitIds: string[]; chapterIds: string[] } {
  const unitIds = new Set<string>();
  const chapterIds = new Set<string>();
  for (const predecessorUnitId of unit.predecessorUnitIds) {
    const predecessorUnit = unitsById.get(predecessorUnitId);
    const predecessorOutput = outputsByUnitId.get(predecessorUnitId);
    if (predecessorUnit?.kind === 'chapterChunk' && isChapterOutput(predecessorOutput)) {
      unitIds.add(predecessorUnit.id);
      chapterIds.add(predecessorOutput.chapterId);
    } else if (isAggregateOutput(predecessorOutput)) {
      predecessorOutput.coveredUnitIds.forEach((unitId) => unitIds.add(unitId));
      predecessorOutput.coveredChapterIds.forEach((chapterId) => chapterIds.add(chapterId));
    }
  }
  return { unitIds: [...unitIds], chapterIds: [...chapterIds] };
}

function collectDirectPredecessorFindings(
  unit: ReferenceDeconstructionWorkUnit,
  outputsByUnitId: ReadonlyMap<string, ReferenceDeconstructionAnalysisOutput>,
): Map<string, ReferenceDeconstructionFinding> {
  const findings = new Map<string, ReferenceDeconstructionFinding>();
  for (const predecessorUnitId of unit.predecessorUnitIds) {
    const output = outputsByUnitId.get(predecessorUnitId);
    if (isChapterOutput(output) || isAggregateOutput(output)) {
      collectReferenceAnalysisFindings(output).forEach((finding) => {
        findings.set(finding.id, finding);
      });
    }
  }
  return findings;
}

function validateFindingClosure(
  unit: ReferenceDeconstructionWorkUnit,
  findings: readonly ReferenceDeconstructionFinding[],
  allowedFindings: ReadonlyMap<string, ReferenceDeconstructionFinding>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  findings.forEach((finding, index) => {
    const sourceFindingRefs = finding.sourceFindingRefs ?? [];
    const missing = sourceFindingRefs.filter((findingId) => !allowedFindings.has(findingId));
    const expectedEvidence = [...new Set(sourceFindingRefs.flatMap((findingId) =>
      allowedFindings.get(findingId)?.evidenceRefs ?? []))];
    if (
      missing.length
      || (!finding.generalInference && !sourceFindingRefs.length)
      || !sameSet(finding.evidenceRefs, expectedEvidence)
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-finding-closure-${unit.ordinal}-${index}`,
        'quality.finding.closureMismatch',
        `Derived finding ${finding.id} does not close over direct predecessor findings.`,
        unit,
      ));
    }
  });
}

function validateStyleFindingClosure(
  unit: ReferenceDeconstructionWorkUnit,
  dimensions: readonly ReferenceStyleProfileDimensionResult[],
  allowedFindings: ReadonlyMap<string, ReferenceDeconstructionFinding>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  dimensions.forEach((dimension, index) => {
    const missing = dimension.sourceFindingRefs
      .filter((findingId) => !allowedFindings.has(findingId));
    const expectedEvidence = [...new Set(dimension.sourceFindingRefs.flatMap((findingId) =>
      allowedFindings.get(findingId)?.evidenceRefs ?? []))];
    if (
      missing.length
      || (!dimension.generalInference && !dimension.sourceFindingRefs.length)
      || !sameSet(dimension.evidenceRefs, expectedEvidence)
    ) {
      diagnostics.push(blockingDiagnostic(
        `quality-style-closure-${unit.ordinal}-${index}`,
        'quality.style.closureMismatch',
        `Style dimension ${dimension.id} does not close over aggregate findings.`,
        unit,
      ));
    }
  });
}

function validateFindingSafety(
  outputs: readonly ReferenceDeconstructionAnalysisOutput[],
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  const findingIds = new Set<string>();
  for (const output of outputs) {
    const findings = isChapterOutput(output)
      ? collectReferenceAnalysisFindings(output)
      : isAggregateOutput(output)
        ? output.findings
        : [];
    findings.forEach((finding, index) => {
      if (!isSafeIdentifier(finding.id) || findingIds.has(finding.id)) {
        diagnostics.push(blockingDiagnostic(
          `quality-finding-identity-${stableToken(`${output.unitId}-${index}`)}`,
          'quality.finding.invalidIdentity',
          `Finding identity at ${output.unitId}:${index} is invalid or duplicated.`,
        ));
      } else {
        findingIds.add(finding.id);
      }
      if (
        finding.generalInference
        && (!finding.uncertainty || finding.confidence === 'high')
      ) {
        diagnostics.push(blockingDiagnostic(
          `quality-finding-inference-${stableToken(`${output.unitId}-${index}`)}`,
          'quality.finding.invalidInference',
          `General inference at ${output.unitId}:${index} lacks a bounded uncertainty.`,
        ));
      }
    });
    if (isStyleOutput(output)) {
      output.dimensions.forEach((dimension, index) => {
        if (!isSafeIdentifier(dimension.id) || findingIds.has(dimension.id)) {
          diagnostics.push(blockingDiagnostic(
            `quality-style-identity-${stableToken(`${output.unitId}-${index}`)}`,
            'quality.style.invalidIdentity',
            `Style dimension identity at ${output.unitId}:${index} is invalid or duplicated.`,
          ));
        } else {
          findingIds.add(dimension.id);
        }
        if (
          dimension.generalInference
          && (!dimension.uncertainty || dimension.confidence === 'high')
        ) {
          diagnostics.push(blockingDiagnostic(
            `quality-style-inference-${stableToken(`${output.unitId}-${index}`)}`,
            'quality.style.invalidInference',
            `General-inference style dimension at ${output.unitId}:${index} is invalid.`,
          ));
        }
      });
    }
  }
}

function appendUncertaintyDiagnostics(
  outputs: readonly ReferenceDeconstructionAnalysisOutput[],
  unitsById: ReadonlyMap<string, ReferenceDeconstructionWorkUnit>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  for (const output of outputs) {
    const unit = unitsById.get(output.unitId);
    const uncertainties = [
      ...output.uncertainties,
      ...(isChapterOutput(output)
        ? collectReferenceAnalysisFindings(output)
            .flatMap((finding) => finding.uncertainty ? [finding.uncertainty] : [])
        : isAggregateOutput(output)
          ? output.findings.flatMap((finding) =>
              finding.uncertainty ? [finding.uncertainty] : [])
          : output.dimensions.flatMap((dimension) =>
              dimension.uncertainty ? [dimension.uncertainty] : [])),
    ];
    [...new Set(uncertainties)].forEach((uncertainty, index) => {
      diagnostics.push({
        id: `quality-uncertainty-${unit?.ordinal ?? 0}-${index}`,
        code: 'quality.uncertainty',
        severity: 'warning',
        blocking: false,
        message: boundedMessage(uncertainty),
        evidenceRefs: [],
        ...(unit ? { stageId: unit.stageId } : {}),
        ...(unit?.chapterId ? { chapterId: unit.chapterId } : {}),
      });
    });
  }
}

function appendCopyRiskDiagnostics(
  outputs: readonly ReferenceDeconstructionAnalysisOutput[],
  windows: readonly ReferenceChapterWorkUnitWindow[],
  unitsById: ReadonlyMap<string, ReferenceDeconstructionWorkUnit>,
  diagnostics: ReferenceDeconstructionDiagnostic[],
): void {
  const normalizedSources = windows
    .map((window) => normalizeOverlapText(window.content))
    .filter(Boolean);
  const candidates = outputs.flatMap((output) => collectOutputCandidates(output));
  const totalSourceChars = normalizedSources.reduce((total, value) => total + value.length, 0);
  const totalOutputChars = candidates.reduce((total, value) => total + value.text.length, 0);
  if (
    totalSourceChars > MAX_REFERENCE_ANALYSIS_QUALITY_SOURCE_CHARS
    || totalOutputChars > MAX_REFERENCE_ANALYSIS_QUALITY_OUTPUT_CHARS
  ) {
    diagnostics.push(blockingDiagnostic(
      'quality-copy-risk-overflow',
      'quality.copyRisk.scanOverflow',
      'Exact-overlap scanning exceeded its deterministic bound; the analysis cannot pass.',
    ));
    return;
  }
  const sourceIndex = createOverlapIndex(
    normalizedSources,
    REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS,
  );
  for (const candidate of candidates) {
    const normalized = normalizeOverlapText(candidate.text);
    if (
      normalized.length >= REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS
      && containsIndexedOverlap(
        normalized,
        sourceIndex,
        REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS,
      )
    ) {
      const unit = unitsById.get(candidate.unitId);
      diagnostics.push(blockingDiagnostic(
        `quality-copy-risk-${stableToken(candidate.id)}`,
        'quality.copyRisk.exactOverlap',
        `Analysis output ${candidate.id} contains a long exact overlap with source text.`,
        unit,
      ));
    }
  }
}

function collectOutputCandidates(
  output: ReferenceDeconstructionAnalysisOutput,
): QualityCandidate[] {
  const candidates: QualityCandidate[] = [];
  const append = (id: string, text: string | undefined) => {
    if (text) candidates.push({ id, unitId: output.unitId, text });
  };
  if (isChapterOutput(output)) {
    append(`${output.unitId}-unit-summary`, output.unitSummary.observation);
    append(`${output.unitId}-unit-summary-uncertainty`, output.unitSummary.uncertainty);
    append(`${output.unitId}-chapter-summary`, output.chapterSummary?.observation);
    append(
      `${output.unitId}-chapter-summary-uncertainty`,
      output.chapterSummary?.uncertainty,
    );
    append(`${output.unitId}-rolling-summary`, output.rollingContext.summary);
    collectFindingCandidates(output.unitId, output.findings, append);
  } else if (isAggregateOutput(output)) {
    append(`${output.unitId}-summary`, output.summary);
    collectFindingCandidates(output.unitId, output.findings, append);
  } else {
    append(`${output.unitId}-summary`, output.summary);
    output.dimensions.forEach((dimension, index) => {
      append(`${output.unitId}-dimension-${index}-observation`, dimension.observation);
      append(`${output.unitId}-dimension-${index}-technique`, dimension.technique);
      append(`${output.unitId}-dimension-${index}-avoid`, dimension.avoid);
      append(`${output.unitId}-dimension-${index}-uncertainty`, dimension.uncertainty);
    });
    output.transferablePrinciples.forEach((text, index) =>
      append(`${output.unitId}-transferable-${index}`, text));
    output.nonImitationBoundaries.forEach((text, index) =>
      append(`${output.unitId}-non-imitation-${index}`, text));
  }
  output.uncertainties.forEach((text, index) =>
    append(`${output.unitId}-uncertainty-${index}`, text));
  return candidates;
}

function collectFindingCandidates(
  unitId: string,
  findings: readonly ReferenceDeconstructionFinding[],
  append: (id: string, text: string | undefined) => void,
): void {
  findings.forEach((finding, index) => {
    append(`${unitId}-finding-${index}-observation`, finding.observation);
    append(`${unitId}-finding-${index}-technique`, finding.technique);
    append(`${unitId}-finding-${index}-when-useful`, finding.whenUseful);
    append(`${unitId}-finding-${index}-avoid`, finding.avoid);
    append(`${unitId}-finding-${index}-uncertainty`, finding.uncertainty);
  });
}

function createOverlapIndex(
  sources: readonly string[],
  length: number,
): Map<number, RollingHashLocation[]> {
  const index = new Map<number, RollingHashLocation[]>();
  for (const source of sources) {
    if (source.length < length) continue;
    forEachRollingHash(source, length, (hash, offset) => {
      const locations = index.get(hash) ?? [];
      const probe = source.slice(offset, offset + length);
      if (!locations.some((location) =>
        location.source.slice(location.index, location.index + length) === probe)) {
        locations.push({ source, index: offset });
      }
      index.set(hash, locations);
    });
  }
  return index;
}

function containsIndexedOverlap(
  candidate: string,
  sourceIndex: ReadonlyMap<number, readonly RollingHashLocation[]>,
  length: number,
): boolean {
  let found = false;
  forEachRollingHash(candidate, length, (hash, offset) => {
    if (found) return;
    const probe = candidate.slice(offset, offset + length);
    found = (sourceIndex.get(hash) ?? []).some((location) =>
      location.source.slice(location.index, location.index + length) === probe);
  });
  return found;
}

function forEachRollingHash(
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

function boundDiagnostics(
  diagnostics: readonly ReferenceDeconstructionDiagnostic[],
  qualityUnitId: string,
): ReferenceDeconstructionDiagnostic[] {
  const unique = [...new Map(diagnostics.map((diagnostic) => [
    diagnostic.id,
    diagnostic,
  ])).values()];
  if (unique.length <= MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS) return unique;
  const overflow: ReferenceDeconstructionDiagnostic = {
    id: 'quality-diagnostic-overflow',
    code: 'quality.diagnostic.overflow',
    severity: 'error',
    blocking: true,
    message: `Analysis quality produced more than ${MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS} diagnostics; inspect stage artifacts before retrying ${qualityUnitId}.`,
    evidenceRefs: [],
    stageId: 'qualityGate',
  };
  const prioritized = unique
    .filter((diagnostic) => diagnostic.id !== overflow.id)
    .sort((left, right) =>
      Number(right.blocking) - Number(left.blocking)
      || severityRank(right.severity) - severityRank(left.severity)
      || left.id.localeCompare(right.id));
  return [
    ...prioritized.slice(0, MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS - 1),
    overflow,
  ];
}

function blockingDiagnostic(
  id: string,
  code: string,
  message: string,
  unit?: ReferenceDeconstructionWorkUnit,
  chapterId?: string,
): ReferenceDeconstructionDiagnostic {
  return {
    id,
    code,
    severity: 'error',
    blocking: true,
    message: boundedMessage(message),
    evidenceRefs: [],
    ...(unit ? { stageId: unit.stageId } : {}),
    ...(unit?.chapterId || chapterId
      ? { chapterId: unit?.chapterId ?? chapterId }
      : {}),
  };
}

function isChapterOutput(
  value: ReferenceDeconstructionAnalysisOutput | undefined,
): value is ReferenceChapterAnalysisResult {
  return value !== undefined && 'unitSummary' in value;
}

function isAggregateOutput(
  value: ReferenceDeconstructionAnalysisOutput | undefined,
): value is ReferenceAggregateAnalysisResult {
  return value !== undefined && 'findings' in value && !('unitSummary' in value);
}

function isStyleOutput(
  value: ReferenceDeconstructionAnalysisOutput | undefined,
): value is ReferenceStyleProfileResult {
  return value !== undefined && 'dimensions' in value;
}

function samePointer(left: ReferenceSourcePointer, right: ReferenceSourcePointer): boolean {
  return left.referenceId === right.referenceId
    && left.sourceChecksumSha256 === right.sourceChecksumSha256
    && left.chapterId === right.chapterId
    && left.chunkId === right.chunkId
    && left.lineStart === right.lineStart
    && left.lineEnd === right.lineEnd;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

function normalizeOverlapText(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

function parseStoredQualityDiagnostic(
  value: unknown,
  index: number,
): ReferenceDeconstructionDiagnostic {
  const record = requireRecord(value, `quality diagnostics[${index}]`);
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
  const evidenceRefs = requireUniqueIdentifiers(
    record.evidenceRefs,
    `quality diagnostics[${index}].evidenceRefs`,
    0,
    64,
  );
  return {
    id: requireSafeIdentifier(record.id, `quality diagnostics[${index}].id`),
    code: requireCode(record.code, `quality diagnostics[${index}].code`),
    severity: requireEnum(
      record.severity,
      ['info', 'warning', 'error'] as const,
      `quality diagnostics[${index}].severity`,
    ),
    blocking: requireBoolean(
      record.blocking,
      `quality diagnostics[${index}].blocking`,
    ),
    message: requireBoundedText(
      record.message,
      `quality diagnostics[${index}].message`,
      2_000,
    ),
    evidenceRefs,
    ...(record.stageId === undefined
      ? {}
      : {
          stageId: requireEnum(
            record.stageId,
            [
              'quickPreview',
              'chapterAnalysis',
              'aggregateAnalysis',
              'styleProfile',
              'distillForOan',
              'qualityGate',
              'publish',
            ] as const,
            `quality diagnostics[${index}].stageId`,
          ),
        }),
    ...(record.chapterId === undefined
      ? {}
      : {
          chapterId: requireSafeIdentifier(
            record.chapterId,
            `quality diagnostics[${index}].chapterId`,
          ),
        }),
    ...(record.pointerId === undefined
      ? {}
      : {
          pointerId: requireSafeIdentifier(
            record.pointerId,
            `quality diagnostics[${index}].pointerId`,
          ),
        }),
    ...(record.unitId === undefined
      ? {}
      : {
          unitId: requireSafeIdentifier(
            record.unitId,
            `quality diagnostics[${index}].unitId`,
          ),
        }),
    ...(record.attemptId === undefined
      ? {}
      : {
          attemptId: requireSafeIdentifier(
            record.attemptId,
            `quality diagnostics[${index}].attemptId`,
          ),
        }),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`Stored reference quality contains unknown field: ${unknown}.`);
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

function requireInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
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

function requireUniqueIdentifiers(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string[] {
  const identifiers = requireArray(value, label, min, max)
    .map((item) => requireSafeIdentifier(item, label));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error(`${label} must not contain duplicate identifiers.`);
  }
  return identifiers;
}

function requireUniqueHashes(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string[] {
  const hashes = requireArray(value, label, min, max)
    .map((item) => requireSha256(item, label));
  if (new Set(hashes).size !== hashes.length) {
    throw new Error(`${label} must not contain duplicate hashes.`);
  }
  return hashes;
}

function requireSha256(value: unknown, label: string): string {
  if (!isSha256(value)) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}

function requireCode(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireBoundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.replaceAll(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > max || normalized !== value) {
    throw new Error(`${label} must be canonical bounded text.`);
  }
  return normalized;
}

function normalizeDate(value?: string): string {
  const result = value ?? new Date().toISOString();
  if (!result || Number.isNaN(Date.parse(result))) {
    throw new Error('Reference analysis quality evaluatedAt must be an ISO date.');
  }
  return result;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  if (!isSafeIdentifier(value)) {
    throw new Error(`Reference analysis quality ${label} is invalid.`);
  }
  return value;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/u.test(value)
    && !value.includes('..');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function boundedMessage(value: string): string {
  const normalized = value.replaceAll(/\s+/gu, ' ').trim()
    || 'Reference analysis quality validation failed.';
  return normalized.length <= 2_000 ? normalized : `${normalized.slice(0, 1_997)}...`;
}

function severityRank(value: ReferenceDeconstructionDiagnostic['severity']): number {
  return value === 'error' ? 2 : value === 'warning' ? 1 : 0;
}

function stableToken(value: string): string {
  return sha256(value).slice(0, 16);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
