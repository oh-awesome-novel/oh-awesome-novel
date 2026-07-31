import { createHash } from 'node:crypto';

export const REFERENCE_DECONSTRUCTION_SCHEMA_VERSION = 2 as const;
export const REFERENCE_DECONSTRUCTION_PIPELINE_VERSION = 2 as const;
export const REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION =
  'novel.deconstruct_reference@2' as const;

export const MAX_REFERENCE_QUICK_PREVIEW_CHAPTERS = 3 as const;
export const MAX_REFERENCE_QUICK_PREVIEW_CHARS = 48_000 as const;
export const MAX_REFERENCE_QUICK_PREVIEW_CHUNK_CHARS = 12_000 as const;
export const MAX_REFERENCE_QUICK_PREVIEW_WINDOWS = 24 as const;
export const MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS = 128 as const;
export const MAX_REFERENCE_DECONSTRUCTION_MUTATION_RECEIPTS = 4_096 as const;
export const MAX_REFERENCE_DECONSTRUCTION_TRANSPORT_RECEIPTS = 64 as const;
export const REFERENCE_QUICK_PREVIEW_EXACT_OVERLAP_CHARS = 80 as const;

export const REFERENCE_DECONSTRUCTION_STAGE_IDS = [
  'detectStructure',
  'quickPreview',
  'chapterAnalysis',
  'aggregateAnalysis',
  'styleProfile',
  'distillForOan',
  'materialChapterAnalysis',
  'materialAggregateAnalysis',
  'materialProjection',
  'qualityGate',
] as const;

export type ReferenceDeconstructionStageId =
  typeof REFERENCE_DECONSTRUCTION_STAGE_IDS[number];

export type ReferenceDeconstructionStageStatus =
  | 'notStarted'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';

export type ReferenceDeconstructionRunStatus =
  | 'created'
  | 'previewRunning'
  | 'awaitingFullApproval'
  | 'fullApproved'
  | 'fullRunning'
  | 'paused'
  | 'reviewReady'
  | 'publishing'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'stale';

export type ReferencePublishedDeconstructionStatus =
  | 'notAnalyzed'
  | 'completed'
  | 'stale'
  | 'qualityFailed'
  | 'needsRebuild';

export type ReferenceDeconstructionQualityStatus =
  | 'notEvaluated'
  | 'passed'
  | 'warned'
  | 'failed';

export type ReferenceDeconstructionConfidence = 'low' | 'medium' | 'high';
export type ReferenceDeconstructionDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ReferenceDeconstructionDiagnostic {
  id: string;
  code: string;
  severity: ReferenceDeconstructionDiagnosticSeverity;
  blocking: boolean;
  message: string;
  evidenceRefs: string[];
  stageId?: ReferenceDeconstructionStageId;
  chapterId?: string;
  pointerId?: string;
  unitId?: string;
  attemptId?: string;
}

export interface ReferenceDeconstructionDiagnostics {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  referenceId: string;
  sourceChecksumSha256: string;
  generatedAt: string;
  items: ReferenceDeconstructionDiagnostic[];
}

export interface ReferenceDeconstructionManifestStage {
  status: ReferenceDeconstructionStageStatus;
  selectedAttemptId?: string;
  inputFingerprint?: string;
  completedChapterIds?: string[];
  outputHashes: string[];
}

export type ReferenceDeconstructionManifestStages = Partial<Record<
  ReferenceDeconstructionStageId,
  ReferenceDeconstructionManifestStage
>>;

export type ReferenceDeconstructionOutputKind =
  | 'deconstruction'
  | 'distilled'
  | 'materials'
  | 'context';

export const REFERENCE_DECONSTRUCTION_SELECTED_OUTPUTS = [
  'techniques',
  'world',
  'characters',
  'relationships',
  'outline',
  'timeline',
] as const;

export type ReferenceDeconstructionSelectedOutput =
  typeof REFERENCE_DECONSTRUCTION_SELECTED_OUTPUTS[number];

export interface ReferenceDeconstructionManifestOutput {
  kind: ReferenceDeconstructionOutputKind;
  path: string;
  checksumSha256: string;
  sourceRunId: string;
  sourceChecksumSha256: string;
  stale: boolean;
}

export interface ReferenceDeconstructionWarningSummary {
  count: number;
  codes: string[];
}

export interface ReferenceDeconstructionManifest {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  referenceId: string;
  revision: number;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  pipelineVersion: typeof REFERENCE_DECONSTRUCTION_PIPELINE_VERSION;
  capabilityVersion: typeof REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION;
  status: ReferencePublishedDeconstructionStatus;
  qualityStatus: ReferenceDeconstructionQualityStatus;
  warningSummary: ReferenceDeconstructionWarningSummary;
  profileId?: string;
  selectedOutputs?: ReferenceDeconstructionSelectedOutput[];
  publishedRunId?: string;
  publishedAt?: string;
  stages: ReferenceDeconstructionManifestStages;
  outputs: ReferenceDeconstructionManifestOutput[];
}

export function requiredReferenceDeconstructionStageIds(
  outputs: readonly ReferenceDeconstructionSelectedOutput[],
): ReferenceDeconstructionStageId[] {
  const required: ReferenceDeconstructionStageId[] = [
    'detectStructure',
    'quickPreview',
  ];
  if (outputs.includes('techniques')) {
    required.push(
      'chapterAnalysis',
      'aggregateAnalysis',
      'styleProfile',
      'distillForOan',
    );
  }
  if (outputs.some((output) => output !== 'techniques')) {
    required.push(
      'materialChapterAnalysis',
      'materialAggregateAnalysis',
      'materialProjection',
    );
  }
  required.push('qualityGate');
  return REFERENCE_DECONSTRUCTION_STAGE_IDS.filter((stageId) =>
    required.includes(stageId));
}

function requireReferenceDeconstructionSelectedOutputs(
  value: unknown,
): ReferenceDeconstructionSelectedOutput[] {
  const outputs = requireArray(
    value,
    'selectedOutputs',
    1,
    REFERENCE_DECONSTRUCTION_SELECTED_OUTPUTS.length,
  ).map((output) => requireEnum(
    output,
    REFERENCE_DECONSTRUCTION_SELECTED_OUTPUTS,
    'selected output',
  ));
  if (new Set(outputs).size !== outputs.length) {
    throw new Error('Reference selected outputs must be unique.');
  }
  const canonical = REFERENCE_DECONSTRUCTION_SELECTED_OUTPUTS.filter((output) =>
    outputs.includes(output));
  if (JSON.stringify(canonical) !== JSON.stringify(outputs)) {
    throw new Error('Reference selected outputs are not in canonical order.');
  }
  return canonical;
}

export interface ReferenceProgressFailure {
  stage: ReferenceDeconstructionStageId;
  message: string;
  failedAt: string;
}

export interface ReferenceProgress {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  referenceId: string;
  status: ReferencePublishedDeconstructionStatus;
  currentStage: ReferenceDeconstructionStageId | null;
  nextStage: ReferenceDeconstructionStageId | null;
  completedStages: ReferenceDeconstructionStageId[];
  failedStages: ReferenceProgressFailure[];
  stages: Partial<Record<
    ReferenceDeconstructionStageId,
    ReferenceDeconstructionStageStatus
  >>;
  resumable: boolean;
  contextEligible: boolean;
  updatedAt: string;
}

export interface ReferenceSourcePointer {
  referenceId: string;
  sourceChecksumSha256: string;
  chapterId: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
}

export interface ReferenceQuickPreviewSourceWindow {
  pointerId: string;
  pointer: ReferenceSourcePointer;
  content: string;
  charLength: number;
}

export interface ReferenceQuickPreviewSelection {
  referenceId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  selectedChapterIds: string[];
  windows: ReferenceQuickPreviewSourceWindow[];
  omittedChapterIds: string[];
  totalChars: number;
  maxChapters: number;
  maxChars: number;
}

export interface ReferenceQuickPreviewSelectionSource {
  sourceText: string;
  referenceId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  chapters: Array<{
    id: string;
    title: string;
    lineStart: number;
    lineEnd: number;
  }>;
}

export interface ReferenceQuickPreviewSelectionOptions {
  maxChapters?: number;
  maxChars?: number;
  maxChunkChars?: number;
  selectedChapterIds?: string[];
}

export type ReferenceEvidencePointerMap = Readonly<Record<string, ReferenceSourcePointer>>;

export type ReferenceQuickPreviewFindingKind =
  | 'hook'
  | 'pacing'
  | 'sceneTechnique'
  | 'characterTechnique'
  | 'worldbuildingTechnique';

export interface ReferenceQuickPreviewModelChapter {
  chapterId: string;
  summary: string;
  evidenceRefs: string[];
  confidence: ReferenceDeconstructionConfidence;
  uncertainty?: string | null;
}

export interface ReferenceQuickPreviewModelFinding {
  kind: ReferenceQuickPreviewFindingKind;
  observation: string;
  technique: string;
  whenUseful?: string | null;
  avoid?: string | null;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  generalInference: boolean;
  uncertainty?: string | null;
}

export interface ReferenceQuickPreviewModelBorrowablePattern {
  title: string;
  technique: string;
  whenUseful?: string | null;
  evidenceRefs: string[];
  confidence: ReferenceDeconstructionConfidence;
}

export interface ReferenceQuickPreviewModelOutput {
  sourceOverview: string;
  chapterPreviews: ReferenceQuickPreviewModelChapter[];
  findings: ReferenceQuickPreviewModelFinding[];
  borrowablePatterns: ReferenceQuickPreviewModelBorrowablePattern[];
  doNotCopy: string[];
  differentiationRequirements: string[];
  differentiationPrompts: string[];
  canonContaminationWarnings: string[];
  confidence: ReferenceDeconstructionConfidence;
  uncertainties: string[];
}

export interface ReferenceQuickPreviewChapter
  extends Omit<ReferenceQuickPreviewModelChapter, 'uncertainty'> {
  id: string;
  uncertainty?: string;
}

export interface ReferenceQuickPreviewFinding
  extends Omit<
    ReferenceQuickPreviewModelFinding,
    'whenUseful' | 'avoid' | 'uncertainty'
  > {
  id: string;
  whenUseful?: string;
  avoid?: string;
  uncertainty?: string;
}

export interface ReferenceQuickPreviewBorrowablePattern
  extends Omit<ReferenceQuickPreviewModelBorrowablePattern, 'whenUseful'> {
  id: string;
  whenUseful?: string;
}

export interface ReferenceQuickPreviewCoverage {
  selectedChapterIds: string[];
  analyzedChapterIds: string[];
  selectedPointerCount: number;
  citedPointerCount: number;
  chapterCoveragePercent: number;
}

export interface ReferenceQuickPreview {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  runId: string;
  referenceId: string;
  sourceChecksumSha256: string;
  sourceOverview: string;
  chapterPreviews: ReferenceQuickPreviewChapter[];
  findings: ReferenceQuickPreviewFinding[];
  borrowablePatterns: ReferenceQuickPreviewBorrowablePattern[];
  doNotCopy: string[];
  differentiationRequirements: string[];
  differentiationPrompts: string[];
  canonContaminationWarnings: string[];
  confidence: ReferenceDeconstructionConfidence;
  uncertainties: string[];
  coverage: ReferenceQuickPreviewCoverage;
  diagnostics: ReferenceDeconstructionDiagnostic[];
}

export interface NormalizeReferenceQuickPreviewOptions {
  runId: string;
  referenceId: string;
  sourceChecksumSha256: string;
  selectedChapterIds: readonly string[];
  allowedPointers: ReferenceEvidencePointerMap;
  sourceWindows?: readonly ReferenceQuickPreviewSourceWindow[];
}

const STAGE_STATUS_VALUES: readonly ReferenceDeconstructionStageStatus[] = [
  'notStarted',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'stale',
];
const PUBLISHED_STATUS_VALUES: readonly ReferencePublishedDeconstructionStatus[] = [
  'notAnalyzed',
  'completed',
  'stale',
  'qualityFailed',
  'needsRebuild',
];
const QUALITY_STATUS_VALUES: readonly ReferenceDeconstructionQualityStatus[] = [
  'notEvaluated',
  'passed',
  'warned',
  'failed',
];
const CONFIDENCE_VALUES: readonly ReferenceDeconstructionConfidence[] = [
  'low',
  'medium',
  'high',
];
const FINDING_KIND_VALUES: readonly ReferenceQuickPreviewFindingKind[] = [
  'hook',
  'pacing',
  'sceneTechnique',
  'characterTechnique',
  'worldbuildingTechnique',
];

export function createReferenceStructureFingerprint(structure: {
  chapterCount: number;
  confidence: ReferenceDeconstructionConfidence;
  chapters: ReadonlyArray<{
    id: string;
    title: string;
    lineStart: number;
    lineEnd: number;
    wordCount: number;
  }>;
}): string {
  const normalized = {
    chapterCount: structure.chapterCount,
    confidence: structure.confidence,
    chapters: structure.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      lineStart: chapter.lineStart,
      lineEnd: chapter.lineEnd,
      wordCount: chapter.wordCount,
    })),
  };
  return sha256(JSON.stringify(normalized));
}

export function createNotAnalyzedReferenceManifest(input: {
  referenceId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
}): ReferenceDeconstructionManifest {
  const stages = Object.fromEntries(REFERENCE_DECONSTRUCTION_STAGE_IDS.map((stageId) => [
    stageId,
    {
      status: stageId === 'detectStructure' ? 'completed' : 'notStarted',
      outputHashes: [],
    },
  ])) as unknown as ReferenceDeconstructionManifestStages;

  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: requireSafeIdentifier(input.referenceId, 'referenceId'),
    revision: 0,
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
    status: 'notAnalyzed',
    qualityStatus: 'notEvaluated',
    warningSummary: {
      count: 0,
      codes: [],
    },
    stages,
    outputs: [],
  };
}

export function createReferenceProgressProjection(
  manifest: ReferenceDeconstructionManifest,
  updatedAt: string,
): ReferenceProgress {
  const presentStageIds = REFERENCE_DECONSTRUCTION_STAGE_IDS.filter((stageId) =>
    manifest.stages[stageId] !== undefined);
  const currentStage = presentStageIds.find((stageId) =>
    manifest.stages[stageId]?.status === 'running') ?? null;
  const nextStage = manifest.status === 'completed'
    ? null
    : presentStageIds.find((stageId) =>
      manifest.stages[stageId]?.status === 'notStarted'
      || manifest.stages[stageId]?.status === 'queued') ?? null;
  const completedStages = presentStageIds.filter((stageId) =>
    manifest.stages[stageId]?.status === 'completed');
  const failedStages = presentStageIds
    .filter((stageId) => manifest.stages[stageId]?.status === 'failed')
    .map((stage) => ({
      stage,
      message: 'Stage failed. Inspect diagnostics for details.',
      failedAt: updatedAt,
    }));

  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: manifest.referenceId,
    status: manifest.status,
    currentStage,
    nextStage,
    completedStages,
    failedStages,
    stages: Object.fromEntries(presentStageIds.map((stageId) => [
      stageId,
      manifest.stages[stageId]!.status,
    ])) as ReferenceProgress['stages'],
    resumable: false,
    contextEligible: manifest.status === 'completed'
      && (
        manifest.qualityStatus === 'passed'
        || manifest.qualityStatus === 'warned'
      )
      && manifest.outputs.some((output) =>
        output.kind === 'distilled' && !output.stale),
    updatedAt: requireIsoDate(updatedAt, 'updatedAt'),
  };
}

export function createReferenceDiagnostics(input: {
  referenceId: string;
  sourceChecksumSha256: string;
  generatedAt: string;
  items?: ReferenceDeconstructionDiagnostic[];
}): ReferenceDeconstructionDiagnostics {
  return assertReferenceDeconstructionDiagnostics({
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: input.referenceId,
    sourceChecksumSha256: input.sourceChecksumSha256,
    generatedAt: input.generatedAt,
    items: input.items ?? [],
  });
}

export function createReferenceQuickPreviewSelection(
  input: ReferenceQuickPreviewSelectionSource,
  options: ReferenceQuickPreviewSelectionOptions = {},
): ReferenceQuickPreviewSelection {
  const referenceId = requireSafeIdentifier(input.referenceId, 'referenceId');
  const sourceChecksumSha256 = requireSha256(
    input.sourceChecksumSha256,
    'sourceChecksumSha256',
  );
  const structureFingerprint = requireSha256(
    input.structureFingerprint,
    'structureFingerprint',
  );
  const maxChapters = boundedInteger(
    options.maxChapters ?? MAX_REFERENCE_QUICK_PREVIEW_CHAPTERS,
    1,
    MAX_REFERENCE_QUICK_PREVIEW_CHAPTERS,
    'maxChapters',
  );
  const maxChars = boundedInteger(
    options.maxChars ?? MAX_REFERENCE_QUICK_PREVIEW_CHARS,
    1,
    MAX_REFERENCE_QUICK_PREVIEW_CHARS,
    'maxChars',
  );
  const maxChunkChars = boundedInteger(
    options.maxChunkChars ?? Math.min(MAX_REFERENCE_QUICK_PREVIEW_CHUNK_CHARS, maxChars),
    Math.ceil(maxChars / MAX_REFERENCE_QUICK_PREVIEW_WINDOWS),
    Math.min(MAX_REFERENCE_QUICK_PREVIEW_CHUNK_CHARS, maxChars),
    'maxChunkChars',
  );
  if (typeof input.sourceText !== 'string' || !input.sourceText.length) {
    throw new Error('Reference quick preview sourceText must be non-empty.');
  }
  if (sha256(input.sourceText) !== sourceChecksumSha256) {
    throw new Error('Reference quick preview source checksum does not match sourceText.');
  }

  const lines = input.sourceText.split(/\r?\n/u);
  const requestedChapterIds = options.selectedChapterIds === undefined
    ? undefined
    : requireUniqueIdentifiers(
        options.selectedChapterIds,
        'selectedChapterIds',
        1,
        maxChapters,
      );
  const chaptersById = new Map(input.chapters.map((chapter) => [chapter.id, chapter]));
  if (requestedChapterIds?.some((chapterId) => !chaptersById.has(chapterId))) {
    throw new Error('Reference quick preview selectedChapterIds contain an unknown chapter.');
  }
  const candidateChapters = requestedChapterIds
    ? requestedChapterIds.map((chapterId) => chaptersById.get(chapterId)!)
    : input.chapters.slice(0, maxChapters);
  if (!candidateChapters.length) {
    throw new Error('Reference quick preview requires at least one detected chapter.');
  }

  const windows: ReferenceQuickPreviewSourceWindow[] = [];
  const selectedChapterIds: string[] = [];
  let remainingChars = maxChars;
  let windowOrdinal = 0;

  candidateChapters.forEach((chapter, chapterIndex) => {
    if (remainingChars <= 0) return;
    const chapterId = requireSafeIdentifier(chapter.id, 'chapterId');
    const lineStart = boundedInteger(chapter.lineStart, 1, lines.length, 'lineStart');
    const lineEnd = boundedInteger(chapter.lineEnd, lineStart, lines.length, 'lineEnd');
    const remainingChapters = candidateChapters.length - chapterIndex;
    const chapterBudget = Math.max(1, Math.floor(remainingChars / remainingChapters));
    const chapterLines = lines.slice(lineStart - 1, lineEnd);
    const chunks = chunkChapterLines(
      chapterLines,
      lineStart,
      Math.min(chapterBudget, remainingChars),
      maxChunkChars,
    );

    if (!chunks.length) return;
    selectedChapterIds.push(chapterId);
    chunks.forEach((chunk, chunkIndex) => {
      windowOrdinal += 1;
      const pointerId = `source-window-${String(windowOrdinal).padStart(3, '0')}`;
      windows.push({
        pointerId,
        pointer: {
          referenceId,
          sourceChecksumSha256,
          chapterId,
          chunkId: `${chapterId}-chunk-${String(chunkIndex + 1).padStart(3, '0')}`,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
        },
        content: chunk.content,
        charLength: chunk.content.length,
      });
      remainingChars -= chunk.content.length;
    });
  });

  if (!windows.length || !selectedChapterIds.length) {
    throw new Error('Reference quick preview source selection is empty.');
  }
  if (windows.length > MAX_REFERENCE_QUICK_PREVIEW_WINDOWS) {
    throw new Error(
      `Reference quick preview cannot exceed ${MAX_REFERENCE_QUICK_PREVIEW_WINDOWS} source windows.`,
    );
  }

  const selectedSet = new Set(selectedChapterIds);
  return {
    referenceId,
    sourceChecksumSha256,
    structureFingerprint,
    selectedChapterIds,
    windows,
    omittedChapterIds: input.chapters
      .map((chapter) => chapter.id)
      .filter((chapterId) => !selectedSet.has(chapterId)),
    totalChars: windows.reduce((total, window) => total + window.charLength, 0),
    maxChapters,
    maxChars,
  };
}

export function createReferenceEvidencePointerMap(
  selection: ReferenceQuickPreviewSelection,
): ReferenceEvidencePointerMap {
  const entries = selection.windows.map((window) => [
    requireSafeIdentifier(window.pointerId, 'pointerId'),
    assertReferenceSourcePointer(window.pointer),
  ] as const);
  if (new Set(entries.map(([pointerId]) => pointerId)).size !== entries.length) {
    throw new Error('Reference quick preview pointer ids must be unique.');
  }
  return Object.freeze(Object.fromEntries(entries));
}

export function assertReferenceEvidenceRefs(
  value: unknown,
  allowedPointers: ReferenceEvidencePointerMap,
  options: { required?: boolean; chapterId?: string; max?: number } = {},
): string[] {
  const refs = requireStringArray(value, 'evidenceRefs', {
    min: options.required === false ? 0 : 1,
    max: options.max ?? 16,
    itemMax: 180,
    identifiers: true,
  });
  for (const ref of refs) {
    const pointer = allowedPointers[ref];
    if (!pointer) {
      throw new Error(`Reference quick preview contains unknown evidence ref: ${ref}.`);
    }
    if (options.chapterId && pointer.chapterId !== options.chapterId) {
      throw new Error(`Reference quick preview evidence ref ${ref} belongs to another chapter.`);
    }
  }
  return refs;
}

export function normalizeReferenceQuickPreviewModelOutput(
  value: unknown,
  options: NormalizeReferenceQuickPreviewOptions,
): ReferenceQuickPreview {
  const record = requireRecord(value, 'Reference quick preview model output');
  assertOnlyKnownFields(record, [
    'sourceOverview',
    'chapterPreviews',
    'findings',
    'borrowablePatterns',
    'doNotCopy',
    'differentiationRequirements',
    'differentiationPrompts',
    'canonContaminationWarnings',
    'confidence',
    'uncertainties',
  ]);
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const referenceId = requireSafeIdentifier(options.referenceId, 'referenceId');
  const sourceChecksumSha256 = requireSha256(
    options.sourceChecksumSha256,
    'sourceChecksumSha256',
  );
  const selectedChapterIds = requireUniqueIdentifiers(
    [...options.selectedChapterIds],
    'selectedChapterIds',
    1,
    MAX_REFERENCE_QUICK_PREVIEW_CHAPTERS,
  );
  const selectedChapterSet = new Set(selectedChapterIds);
  const pointers = Object.values(options.allowedPointers);
  if (!pointers.length || pointers.length > MAX_REFERENCE_QUICK_PREVIEW_WINDOWS) {
    throw new Error('Reference quick preview requires an evidence allowlist.');
  }
  for (const pointer of pointers) {
    const normalized = assertReferenceSourcePointer(pointer);
    if (
      normalized.referenceId !== referenceId
      || normalized.sourceChecksumSha256 !== sourceChecksumSha256
      || !selectedChapterSet.has(normalized.chapterId)
    ) {
      throw new Error('Reference quick preview evidence allowlist points outside selection.');
    }
  }

  const chapterRecords = requireArray(
    record.chapterPreviews,
    'chapterPreviews',
    1,
    MAX_REFERENCE_QUICK_PREVIEW_CHAPTERS,
  );
  const chapterPreviews = chapterRecords.map((item, index): ReferenceQuickPreviewChapter => {
    const chapter = requireRecord(item, `chapterPreviews[${index}]`);
    assertOnlyKnownFields(chapter, [
      'chapterId',
      'summary',
      'evidenceRefs',
      'confidence',
      'uncertainty',
    ]);
    const chapterId = requireSafeIdentifier(chapter.chapterId, 'chapterId');
    if (!selectedChapterSet.has(chapterId)) {
      throw new Error(`Reference quick preview contains unselected chapter: ${chapterId}.`);
    }
    const summary = requireText(chapter.summary, 'chapter summary', 4_000);
    const evidenceRefs = assertReferenceEvidenceRefs(
      chapter.evidenceRefs,
      options.allowedPointers,
      { chapterId },
    );
    const uncertainty = optionalText(chapter.uncertainty, 'chapter uncertainty', 2_000);
    return {
      id: stableId('preview-chapter', [runId, chapterId, String(index), summary]),
      chapterId,
      summary,
      evidenceRefs,
      confidence: requireConfidence(chapter.confidence, 'chapter confidence'),
      ...(uncertainty ? { uncertainty } : {}),
    };
  });
  if (new Set(chapterPreviews.map((chapter) => chapter.chapterId)).size
    !== chapterPreviews.length) {
    throw new Error('Reference quick preview chapterPreviews contain duplicate chapters.');
  }

  const findingRecords = requireArray(record.findings, 'findings', 1, 48);
  const findings = findingRecords.map((item, index): ReferenceQuickPreviewFinding => {
    const finding = requireRecord(item, `findings[${index}]`);
    assertOnlyKnownFields(finding, [
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
      finding.kind,
      FINDING_KIND_VALUES,
      'finding kind',
    );
    const observation = requireText(finding.observation, 'finding observation', 4_000);
    const technique = requireText(finding.technique, 'finding technique', 3_000);
    const generalInference = requireBoolean(
      finding.generalInference,
      'finding generalInference',
    );
    const evidenceRefs = assertReferenceEvidenceRefs(
      finding.evidenceRefs,
      options.allowedPointers,
      { required: !generalInference },
    );
    const whenUseful = optionalText(finding.whenUseful, 'finding whenUseful', 2_000);
    const avoid = optionalText(finding.avoid, 'finding avoid', 2_000);
    const uncertainty = optionalText(finding.uncertainty, 'finding uncertainty', 2_000);
    if (generalInference && !uncertainty) {
      throw new Error('General inference findings require an uncertainty boundary.');
    }
    return {
      id: stableId('preview-finding', [
        runId,
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
      confidence: requireConfidence(finding.confidence, 'finding confidence'),
      evidenceRefs,
      generalInference,
      ...(uncertainty ? { uncertainty } : {}),
    };
  });

  const patternRecords = requireArray(
    record.borrowablePatterns,
    'borrowablePatterns',
    1,
    24,
  );
  const borrowablePatterns = patternRecords.map((item, index): ReferenceQuickPreviewBorrowablePattern => {
    const pattern = requireRecord(item, `borrowablePatterns[${index}]`);
    assertOnlyKnownFields(pattern, [
      'title',
      'technique',
      'whenUseful',
      'evidenceRefs',
      'confidence',
    ]);
    const title = requireText(pattern.title, 'borrowable pattern title', 300);
    const technique = requireText(pattern.technique, 'borrowable pattern technique', 3_000);
    const whenUseful = optionalText(
      pattern.whenUseful,
      'borrowable pattern whenUseful',
      2_000,
    );
    return {
      id: stableId('preview-pattern', [runId, String(index), title, technique]),
      title,
      technique,
      ...(whenUseful ? { whenUseful } : {}),
      evidenceRefs: assertReferenceEvidenceRefs(
        pattern.evidenceRefs,
        options.allowedPointers,
      ),
      confidence: requireConfidence(pattern.confidence, 'borrowable pattern confidence'),
    };
  });

  const sourceOverview = requireText(record.sourceOverview, 'sourceOverview', 8_000);
  const doNotCopy = requireStringArray(record.doNotCopy, 'doNotCopy', {
    min: 1,
    max: 32,
    itemMax: 2_000,
  });
  const differentiationRequirements = requireStringArray(
    record.differentiationRequirements,
    'differentiationRequirements',
    { min: 1, max: 32, itemMax: 2_000 },
  );
  const differentiationPrompts = requireStringArray(
    record.differentiationPrompts,
    'differentiationPrompts',
    { min: 1, max: 32, itemMax: 2_000 },
  );
  const canonContaminationWarnings = requireStringArray(
    record.canonContaminationWarnings,
    'canonContaminationWarnings',
    { min: 1, max: 32, itemMax: 2_000 },
  );
  const uncertainties = requireStringArray(record.uncertainties, 'uncertainties', {
    min: 0,
    max: 32,
    itemMax: 2_000,
  });
  const citedPointerIds = new Set([
    ...chapterPreviews.flatMap((chapter) => chapter.evidenceRefs),
    ...findings.flatMap((finding) => finding.evidenceRefs),
    ...borrowablePatterns.flatMap((pattern) => pattern.evidenceRefs),
  ]);
  const analyzedChapterIds = selectedChapterIds.filter((chapterId) =>
    chapterPreviews.some((chapter) => chapter.chapterId === chapterId));
  const copyRiskCandidates = [
    sourceOverview,
    ...chapterPreviews.flatMap((chapter) => [
      chapter.summary,
      ...(chapter.uncertainty ? [chapter.uncertainty] : []),
    ]),
    ...findings.flatMap((finding) => [
      finding.observation,
      finding.technique,
      ...(finding.whenUseful ? [finding.whenUseful] : []),
      ...(finding.avoid ? [finding.avoid] : []),
      ...(finding.uncertainty ? [finding.uncertainty] : []),
    ]),
    ...borrowablePatterns.flatMap((pattern) => [
      pattern.title,
      pattern.technique,
      ...(pattern.whenUseful ? [pattern.whenUseful] : []),
    ]),
    ...doNotCopy,
    ...differentiationRequirements,
    ...differentiationPrompts,
    ...canonContaminationWarnings,
    ...uncertainties,
  ];
  const diagnostics: ReferenceDeconstructionDiagnostic[] = [
    ...detectReferenceQuickPreviewExactOverlap(
      copyRiskCandidates,
      options.sourceWindows ?? [],
    ),
    ...(analyzedChapterIds.length === selectedChapterIds.length
      ? []
      : [{
          id: 'preview-coverage-incomplete',
          code: 'coverage.incomplete',
          severity: 'error' as const,
          blocking: true,
          message: `Quick Preview analyzed ${analyzedChapterIds.length} of ${selectedChapterIds.length} selected chapters; complete every selected chapter before approval.`,
          evidenceRefs: [],
          stageId: 'quickPreview' as const,
        }]),
  ];

  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    runId,
    referenceId,
    sourceChecksumSha256,
    sourceOverview,
    chapterPreviews,
    findings,
    borrowablePatterns,
    doNotCopy,
    differentiationRequirements,
    differentiationPrompts,
    canonContaminationWarnings,
    confidence: requireConfidence(record.confidence, 'confidence'),
    uncertainties,
    coverage: {
      selectedChapterIds,
      analyzedChapterIds,
      selectedPointerCount: Object.keys(options.allowedPointers).length,
      citedPointerCount: citedPointerIds.size,
      chapterCoveragePercent: Math.round(
        (analyzedChapterIds.length / selectedChapterIds.length) * 100,
      ),
    },
    diagnostics,
  };
}

export function formatReferenceQuickPreviewMarkdown(preview: ReferenceQuickPreview): string {
  return [
    '# Reference Quick Preview',
    '',
    `Run: ${preview.runId}`,
    `Reference: ${preview.referenceId}`,
    `Confidence: ${preview.confidence}`,
    `Chapter coverage: ${preview.coverage.analyzedChapterIds.length}/${preview.coverage.selectedChapterIds.length} (${preview.coverage.chapterCoveragePercent}%)`,
    '',
    '## Source Overview',
    '',
    preview.sourceOverview,
    '',
    '## Chapter Previews',
    '',
    ...preview.chapterPreviews.flatMap((chapter) => [
      `### ${chapter.chapterId}`,
      '',
      chapter.summary,
      '',
      `Evidence: ${chapter.evidenceRefs.join(', ')}`,
      `Confidence: ${chapter.confidence}`,
      ...(chapter.uncertainty ? [`Uncertainty: ${chapter.uncertainty}`] : []),
      '',
    ]),
    '## Borrowable Patterns',
    '',
    ...preview.borrowablePatterns.map((pattern) =>
      `- **${pattern.title}**: ${pattern.technique} (evidence: ${pattern.evidenceRefs.join(', ')})`),
    '',
    '## Do Not Copy',
    '',
    ...preview.doNotCopy.map((item) => `- ${item}`),
    '',
    '## Differentiation Requirements',
    '',
    ...preview.differentiationRequirements.map((item) => `- ${item}`),
    '',
    '## Canon Contamination Warnings',
    '',
    ...preview.canonContaminationWarnings.map((item) => `- ${item}`),
    '',
    '## Uncertainties',
    '',
    ...(preview.uncertainties.length
      ? preview.uncertainties.map((item) => `- ${item}`)
      : ['- none']),
    '',
    '## Diagnostics',
    '',
    ...(preview.diagnostics.length
      ? preview.diagnostics.map((item) =>
        `- [${item.severity}] ${item.code}: ${item.message}`)
      : ['- none']),
    '',
  ].join('\n');
}

export function assertReferenceSourcePointer(value: unknown): ReferenceSourcePointer {
  const record = requireRecord(value, 'Reference source pointer');
  assertOnlyKnownFields(record, [
    'referenceId',
    'sourceChecksumSha256',
    'chapterId',
    'chunkId',
    'lineStart',
    'lineEnd',
  ]);
  const lineStart = requireSafeInteger(record.lineStart, 'pointer lineStart', 1);
  const lineEnd = requireSafeInteger(record.lineEnd, 'pointer lineEnd', lineStart);
  return {
    referenceId: requireSafeIdentifier(record.referenceId, 'pointer referenceId'),
    sourceChecksumSha256: requireSha256(
      record.sourceChecksumSha256,
      'pointer sourceChecksumSha256',
    ),
    chapterId: requireSafeIdentifier(record.chapterId, 'pointer chapterId'),
    chunkId: requireSafeIdentifier(record.chunkId, 'pointer chunkId'),
    lineStart,
    lineEnd,
  };
}

export function assertReferenceDeconstructionManifest(
  value: unknown,
): ReferenceDeconstructionManifest {
  const record = requireRecord(value, 'Reference deconstruction manifest');
  assertOnlyKnownFields(record, [
    'version',
    'referenceId',
    'revision',
    'sourceChecksumSha256',
    'structureFingerprint',
    'pipelineVersion',
    'capabilityVersion',
    'status',
    'qualityStatus',
    'warningSummary',
    'profileId',
    'selectedOutputs',
    'publishedRunId',
    'publishedAt',
    'stages',
    'outputs',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new Error('Unsupported reference deconstruction manifest version.');
  }
  if (record.pipelineVersion !== REFERENCE_DECONSTRUCTION_PIPELINE_VERSION) {
    throw new Error('Unsupported reference deconstruction pipeline version.');
  }
  if (record.capabilityVersion !== REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION) {
    throw new Error('Unsupported reference deconstruction capability version.');
  }
  const stagesRecord = requireRecord(record.stages, 'manifest stages');
  assertOnlyKnownFields(stagesRecord, [...REFERENCE_DECONSTRUCTION_STAGE_IDS]);
  const stages = Object.fromEntries(Object.entries(stagesRecord).map(([rawStageId, value]) => {
    const stageId = requireEnum(
      rawStageId,
      REFERENCE_DECONSTRUCTION_STAGE_IDS,
      'manifest stage id',
    );
    const stage = requireRecord(value, `manifest stage ${stageId}`);
    assertOnlyKnownFields(stage, [
      'status',
      'selectedAttemptId',
      'inputFingerprint',
      'completedChapterIds',
      'outputHashes',
    ]);
    return [stageId, {
      status: requireEnum(stage.status, STAGE_STATUS_VALUES, `${stageId} status`),
      ...(stage.selectedAttemptId === undefined
        ? {}
        : { selectedAttemptId: requireSafeIdentifier(stage.selectedAttemptId, 'selectedAttemptId') }),
      ...(stage.inputFingerprint === undefined
        ? {}
        : { inputFingerprint: requireSha256(stage.inputFingerprint, 'inputFingerprint') }),
      ...(stage.completedChapterIds === undefined
        ? {}
        : {
            completedChapterIds: requireUniqueIdentifiers(
              stage.completedChapterIds,
              'completedChapterIds',
              0,
              100_000,
            ),
          }),
      outputHashes: requireHashArray(stage.outputHashes, 'stage outputHashes'),
    }];
  })) as ReferenceDeconstructionManifestStages;
  const outputs = requireArray(record.outputs, 'manifest outputs', 0, 10_000)
    .map((item, index): ReferenceDeconstructionManifestOutput => {
      const output = requireRecord(item, `manifest outputs[${index}]`);
      assertOnlyKnownFields(output, [
        'kind',
        'path',
        'checksumSha256',
        'sourceRunId',
        'sourceChecksumSha256',
        'stale',
      ]);
      return {
        kind: requireEnum(
          output.kind,
          ['deconstruction', 'distilled', 'materials', 'context'] as const,
          'output kind',
        ),
        path: requireRelativeArtifactPath(output.path, 'output path'),
        checksumSha256: requireSha256(output.checksumSha256, 'output checksumSha256'),
        sourceRunId: requireSafeIdentifier(output.sourceRunId, 'output sourceRunId'),
        sourceChecksumSha256: requireSha256(
          output.sourceChecksumSha256,
          'output sourceChecksumSha256',
        ),
        stale: requireBoolean(output.stale, 'output stale'),
      };
    });
  if (new Set(outputs.map((output) => output.path)).size !== outputs.length) {
    throw new Error('Reference manifest output paths must be unique.');
  }
  if (outputs.some((output) => !manifestOutputPathMatchesKind(output))) {
    throw new Error('Reference manifest output path does not match its kind.');
  }
  const manifest: ReferenceDeconstructionManifest = {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: requireSafeIdentifier(record.referenceId, 'referenceId'),
    revision: requireSafeInteger(record.revision, 'manifest revision', 0),
    sourceChecksumSha256: requireSha256(
      record.sourceChecksumSha256,
      'sourceChecksumSha256',
    ),
    structureFingerprint: requireSha256(
      record.structureFingerprint,
      'structureFingerprint',
    ),
    pipelineVersion: REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
    capabilityVersion: REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
    status: requireEnum(record.status, PUBLISHED_STATUS_VALUES, 'manifest status'),
    qualityStatus: requireEnum(record.qualityStatus, QUALITY_STATUS_VALUES, 'qualityStatus'),
    warningSummary: parseReferenceDeconstructionWarningSummary(record.warningSummary),
    ...(record.profileId === undefined
      ? {}
      : { profileId: requireSafeIdentifier(record.profileId, 'profileId') }),
    ...(record.selectedOutputs === undefined
      ? {}
      : {
          selectedOutputs: requireReferenceDeconstructionSelectedOutputs(
            record.selectedOutputs,
          ),
        }),
    ...(record.publishedRunId === undefined
      ? {}
      : { publishedRunId: requireSafeIdentifier(record.publishedRunId, 'publishedRunId') }),
    ...(record.publishedAt === undefined
      ? {}
      : { publishedAt: requireIsoDate(record.publishedAt, 'publishedAt') }),
    stages,
    outputs,
  };
  if (manifest.status === 'completed') {
    if (!manifest.profileId || !manifest.selectedOutputs?.length) {
      throw new Error(
        'Completed reference manifest is missing its Writing Profile output selection.',
      );
    }
    const requiredStages = requiredReferenceDeconstructionStageIds(
      manifest.selectedOutputs,
    );
    const requiredOutputKinds: ReferenceDeconstructionOutputKind[] = [
      'deconstruction',
      'context',
      ...(manifest.selectedOutputs.includes('techniques')
        ? ['distilled' as const]
        : []),
      ...(manifest.selectedOutputs.some((output) => output !== 'techniques')
        ? ['materials' as const]
        : []),
    ];
    const requiredCurrentPaths = [
      ...(manifest.selectedOutputs.includes('techniques')
        ? [
            'distilled/writing-style.md',
            'distilled/pacing.md',
            'distilled/hooks.md',
            'distilled/scene-techniques.md',
            'distilled/character-techniques.md',
            'distilled/do-not-copy.md',
            'context/index.yaml',
            'context/reference-summary.md',
          ]
        : []),
      ...manifest.selectedOutputs
        .filter((output) => output !== 'techniques')
        .map((output) => `materials/${output}.yaml`),
    ];
    if (
      (
        manifest.qualityStatus !== 'passed'
        && manifest.qualityStatus !== 'warned'
      )
      || !manifest.publishedRunId
      || !manifest.publishedAt
      || Object.keys(manifest.stages).length !== requiredStages.length
      || requiredStages.some((stageId) =>
        manifest.stages[stageId]?.status !== 'completed')
      || requiredOutputKinds.some((kind) =>
        !manifest.outputs.some((output) => output.kind === kind && !output.stale))
      || manifest.outputs.some((output) =>
        !output.stale
        && output.sourceChecksumSha256 !== manifest.sourceChecksumSha256)
      || requiredCurrentPaths.some((path) =>
        !manifest.outputs.some((output) =>
          output.path === path
          && !output.stale
          && output.sourceRunId === manifest.publishedRunId
          && output.sourceChecksumSha256 === manifest.sourceChecksumSha256))
    ) {
      throw new Error(
        'Completed reference manifest requires a publishable quality result and completed pipeline.',
      );
    }
  }
  if (
    manifest.qualityStatus === 'warned'
      && manifest.warningSummary.count === 0
    || (
      manifest.qualityStatus === 'passed'
      || manifest.qualityStatus === 'notEvaluated'
    ) && manifest.warningSummary.count !== 0
  ) {
    throw new Error(
      'Reference manifest warning summary does not match its quality status.',
    );
  }
  return manifest;
}

function manifestOutputPathMatchesKind(
  output: ReferenceDeconstructionManifestOutput,
): boolean {
  if (output.kind === 'deconstruction') {
    return output.path.startsWith('deconstruction/') && output.path.endsWith('.md');
  }
  if (output.kind === 'distilled') {
    return output.path.startsWith('distilled/') && output.path.endsWith('.md');
  }
  if (output.kind === 'materials') {
    return REFERENCE_DECONSTRUCTION_SELECTED_OUTPUTS
      .filter((kind) => kind !== 'techniques')
      .some((kind) => output.path === `materials/${kind}.yaml`);
  }
  return output.path === 'context/index.yaml'
    || output.path === 'context/reference-summary.md';
}

export function assertReferenceDeconstructionDiagnostics(
  value: unknown,
): ReferenceDeconstructionDiagnostics {
  const record = requireRecord(value, 'Reference deconstruction diagnostics');
  assertOnlyKnownFields(record, [
    'version',
    'referenceId',
    'sourceChecksumSha256',
    'generatedAt',
    'items',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new Error('Unsupported reference diagnostics version.');
  }
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: requireSafeIdentifier(record.referenceId, 'referenceId'),
    sourceChecksumSha256: requireSha256(
      record.sourceChecksumSha256,
      'sourceChecksumSha256',
    ),
    generatedAt: requireIsoDate(record.generatedAt, 'generatedAt'),
    items: requireArray(
      record.items,
      'diagnostic items',
      0,
      MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
    )
      .map((item, index) => normalizeDiagnostic(item, index)),
  };
}

export function assertReferenceProgress(value: unknown): ReferenceProgress {
  const record = requireRecord(value, 'Reference progress');
  assertOnlyKnownFields(record, [
    'version',
    'referenceId',
    'status',
    'currentStage',
    'nextStage',
    'completedStages',
    'failedStages',
    'stages',
    'resumable',
    'contextEligible',
    'updatedAt',
  ]);
  if (record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION) {
    throw new Error('Unsupported reference progress version.');
  }
  const stagesRecord = requireRecord(record.stages, 'progress stages');
  assertOnlyKnownFields(stagesRecord, [...REFERENCE_DECONSTRUCTION_STAGE_IDS]);
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId: requireSafeIdentifier(record.referenceId, 'referenceId'),
    status: requireEnum(record.status, PUBLISHED_STATUS_VALUES, 'progress status'),
    currentStage: nullableStageId(record.currentStage, 'currentStage'),
    nextStage: nullableStageId(record.nextStage, 'nextStage'),
    completedStages: requireStageIds(record.completedStages, 'completedStages'),
    failedStages: requireArray(record.failedStages, 'failedStages', 0, 100)
      .map((item, index): ReferenceProgressFailure => {
        const failure = requireRecord(item, `failedStages[${index}]`);
        assertOnlyKnownFields(failure, ['stage', 'message', 'failedAt']);
        return {
          stage: requireStageId(failure.stage, 'failed stage'),
          message: requireText(failure.message, 'failed stage message', 1_000),
          failedAt: requireIsoDate(failure.failedAt, 'failedAt'),
        };
      }),
    stages: Object.fromEntries(Object.entries(stagesRecord).map(([stageId, status]) => [
      requireEnum(stageId, REFERENCE_DECONSTRUCTION_STAGE_IDS, 'progress stage id'),
      requireEnum(status, STAGE_STATUS_VALUES, `${stageId} status`),
    ])) as ReferenceProgress['stages'],
    resumable: requireBoolean(record.resumable, 'resumable'),
    contextEligible: requireBoolean(record.contextEligible, 'contextEligible'),
    updatedAt: requireIsoDate(record.updatedAt, 'updatedAt'),
  };
}

function detectReferenceQuickPreviewExactOverlap(
  candidates: readonly string[],
  sourceWindows: readonly ReferenceQuickPreviewSourceWindow[],
): ReferenceDeconstructionDiagnostic[] {
  const sources = sourceWindows
    .map((window) => normalizeOverlapText(window.content))
    .filter((value) => value.length >= REFERENCE_QUICK_PREVIEW_EXACT_OVERLAP_CHARS);
  if (!sources.length) return [];

  const hasOverlap = candidates.some((candidate) => {
    const normalized = normalizeOverlapText(candidate);
    if (normalized.length < REFERENCE_QUICK_PREVIEW_EXACT_OVERLAP_CHARS) return false;
    for (
      let index = 0;
      index <= normalized.length - REFERENCE_QUICK_PREVIEW_EXACT_OVERLAP_CHARS;
      index += 1
    ) {
      const probe = normalized.slice(
        index,
        index + REFERENCE_QUICK_PREVIEW_EXACT_OVERLAP_CHARS,
      );
      if (sources.some((source) => source.includes(probe))) return true;
    }
    return false;
  });
  if (!hasOverlap) return [];

  return [{
    id: 'preview-copy-risk-exact-overlap',
    code: 'copyRisk.exactOverlap',
    severity: 'warning',
    blocking: false,
    message: 'Preview output contains a long exact overlap with the reference source; review or revise it before publication.',
    evidenceRefs: [],
    stageId: 'quickPreview',
  }];
}

function parseReferenceDeconstructionWarningSummary(
  value: unknown,
): ReferenceDeconstructionWarningSummary {
  const record = requireRecord(value, 'warningSummary');
  assertOnlyKnownFields(record, ['count', 'codes']);
  const count = requireSafeInteger(
    record.count,
    'warningSummary count',
    0,
    MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  );
  const codes = requireArray(
    record.codes,
    'warningSummary codes',
    0,
    MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS,
  ).map((code, index) =>
    requireCode(code, `warningSummary codes[${index}]`));
  if (
    new Set(codes).size !== codes.length
    || [...codes].sort((left, right) => left.localeCompare(right))
      .some((code, index) => code !== codes[index])
    || count < codes.length
    || (count === 0) !== (codes.length === 0)
  ) {
    throw new Error('Reference manifest warning summary is internally inconsistent.');
  }
  return { count, codes };
}

function chunkChapterLines(
  lines: readonly string[],
  absoluteLineStart: number,
  chapterBudget: number,
  maxChunkChars: number,
): Array<{ content: string; lineStart: number; lineEnd: number }> {
  const chunks: Array<{ content: string; lineStart: number; lineEnd: number }> = [];
  let remaining = chapterBudget;
  let lineOffset = 0;

  while (lineOffset < lines.length && remaining > 0) {
    const chunkLimit = Math.min(maxChunkChars, remaining);
    const chunkLines: string[] = [];
    const chunkStartOffset = lineOffset;
    let length = 0;

    while (lineOffset < lines.length) {
      const line = lines[lineOffset] ?? '';
      const separatorLength = chunkLines.length ? 1 : 0;
      if (length + separatorLength + line.length <= chunkLimit) {
        chunkLines.push(line);
        length += separatorLength + line.length;
        lineOffset += 1;
        continue;
      }
      if (!chunkLines.length) {
        const slice = line.slice(0, chunkLimit);
        if (slice) {
          chunkLines.push(slice);
          length = slice.length;
        }
        if (slice.length >= line.length) lineOffset += 1;
        else {
          const mutable = [...lines];
          mutable[lineOffset] = line.slice(slice.length);
          return [
            ...chunks,
            {
              content: slice,
              lineStart: absoluteLineStart + lineOffset,
              lineEnd: absoluteLineStart + lineOffset,
            },
            ...chunkChapterLines(
              mutable.slice(lineOffset),
              absoluteLineStart + lineOffset,
              remaining - slice.length,
              maxChunkChars,
            ),
          ];
        }
      }
      break;
    }

    const content = chunkLines.join('\n').slice(0, remaining);
    if (!content.length) break;
    chunks.push({
      content,
      lineStart: absoluteLineStart + chunkStartOffset,
      lineEnd: absoluteLineStart + Math.max(chunkStartOffset, lineOffset - 1),
    });
    remaining -= content.length;
  }

  return chunks;
}

function normalizeDiagnostic(value: unknown, index: number): ReferenceDeconstructionDiagnostic {
  const diagnostic = requireRecord(value, `diagnostic items[${index}]`);
  assertOnlyKnownFields(diagnostic, [
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
  return {
    id: requireSafeIdentifier(diagnostic.id, 'diagnostic id'),
    code: requireCode(diagnostic.code, 'diagnostic code'),
    severity: requireEnum(
      diagnostic.severity,
      ['info', 'warning', 'error'] as const,
      'diagnostic severity',
    ),
    blocking: requireBoolean(diagnostic.blocking, 'diagnostic blocking'),
    message: requireText(diagnostic.message, 'diagnostic message', 2_000),
    evidenceRefs: requireStringArray(diagnostic.evidenceRefs, 'diagnostic evidenceRefs', {
      min: 0,
      max: 32,
      itemMax: 180,
      identifiers: true,
    }),
    ...(diagnostic.stageId === undefined
      ? {}
      : { stageId: requireStageId(diagnostic.stageId, 'diagnostic stageId') }),
    ...(diagnostic.chapterId === undefined
      ? {}
      : { chapterId: requireSafeIdentifier(diagnostic.chapterId, 'diagnostic chapterId') }),
    ...(diagnostic.pointerId === undefined
      ? {}
      : { pointerId: requireSafeIdentifier(diagnostic.pointerId, 'diagnostic pointerId') }),
    ...(diagnostic.unitId === undefined
      ? {}
      : { unitId: requireSafeIdentifier(diagnostic.unitId, 'diagnostic unitId') }),
    ...(diagnostic.attemptId === undefined
      ? {}
      : { attemptId: requireSafeIdentifier(diagnostic.attemptId, 'diagnostic attemptId') }),
  };
}

function nullableStageId(value: unknown, label: string): ReferenceDeconstructionStageId | null {
  if (value === null) return null;
  return requireStageId(value, label);
}

function requireStageId(value: unknown, label: string): ReferenceDeconstructionStageId {
  return requireEnum(value, REFERENCE_DECONSTRUCTION_STAGE_IDS, label);
}

function requireStageIds(value: unknown, label: string): ReferenceDeconstructionStageId[] {
  const values = requireArray(value, label, 0, REFERENCE_DECONSTRUCTION_STAGE_IDS.length)
    .map((item) => requireStageId(item, label));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function requireHashArray(value: unknown, label: string): string[] {
  const values = requireArray(value, label, 0, 10_000)
    .map((item) => requireSha256(item, label));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function requireUniqueIdentifiers(
  value: unknown,
  label: string,
  min = 0,
  max = 10_000,
): string[] {
  const values = requireArray(value, label, min, max)
    .map((item) => requireSafeIdentifier(item, label));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
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
  if (unknown) throw new Error(`Unknown reference deconstruction field: ${unknown}.`);
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
  const normalized = value.trim();
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
  options: {
    min: number;
    max: number;
    itemMax: number;
    identifiers?: boolean;
  },
): string[] {
  const values = requireArray(value, label, options.min, options.max).map((item) =>
    options.identifiers
      ? requireSafeIdentifier(item, label)
      : requireText(item, label, options.itemMax));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value.includes('..')
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireCode(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(value)
    || value.length > 120
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireRelativeArtifactPath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.startsWith('/')
    || value.startsWith('\\')
    || value.includes('\\')
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
    || value.split(/[\\/]+/u).some((part) => !part || part === '.' || part === '..')
    || value.length > 500
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value;
}

function requireIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

function requireSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    throw new Error(`${label} must be a safe integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  return requireSafeInteger(value, label, minimum, maximum);
}

function requireEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T;
}

function requireConfidence(
  value: unknown,
  label: string,
): ReferenceDeconstructionConfidence {
  return requireEnum(value, CONFIDENCE_VALUES, label);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}-${sha256(parts.join('\u001f')).slice(0, 16)}`;
}

function normalizeOverlapText(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}
