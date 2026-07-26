import { createHash } from 'node:crypto';

import {
  NOVEL_COPILOT_CAPABILITY_IDS,
} from './novel-copilot-skill.js';
import type {
  NovelCopilotCapabilityId,
} from './novel-copilot-skill.js';
import {
  REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
  REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
  REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
} from './reference-deconstruction.js';
import type {
  ReferenceDeconstructionConfidence,
} from './reference-deconstruction.js';
import type {
  ReferenceDeconstructionFinding,
  ReferenceDeconstructionVerifiedFindingMap,
  ReferenceDeconstructionWorkUnit,
  ReferenceStyleProfileResult,
} from './reference-deconstruction-full.js';

export const REFERENCE_DISTILLED_CATEGORIES = [
  'writingStyle',
  'pacing',
  'hooks',
  'scene',
  'character',
] as const;

export type ReferenceDistilledCategory =
  typeof REFERENCE_DISTILLED_CATEGORIES[number];

export const MAX_REFERENCE_DISTILLED_ENTRIES = 50 as const;
export const MAX_REFERENCE_DISTILLED_ENTRIES_PER_CATEGORY = 12 as const;
export const MAX_REFERENCE_DISTILLED_ENTRY_TOKENS = 2_048 as const;
export const MAX_REFERENCE_DISTILLATION_INPUTS = 192 as const;
export const MAX_REFERENCE_DISTILLATION_INPUT_CHARS = 96_000 as const;

const MAX_ENTRY_ARRAY_ITEMS = 16;
const MAX_ENTRY_TEXT_CHARS = 4_000;
const MAX_ENTRY_LIST_ITEM_CHARS = 1_000;
const MAX_ENTRY_TAG_CHARS = 80;
const MAX_DISTILLATION_RULES = 32;
const MAX_DISTILLATION_UNCERTAINTIES = 32;

export interface ReferenceDistillationModelEntry {
  category: ReferenceDistilledCategory;
  title: string;
  technique: string;
  whenUseful: string[];
  constraints: string[];
  differentiationPrompts: string[];
  sourceFindingRefs: string[];
  confidence: ReferenceDeconstructionConfidence;
  tags: string[];
  capabilityIds: NovelCopilotCapabilityId[];
}

export interface ReferenceDistillationModelOutput {
  entries: ReferenceDistillationModelEntry[];
  doNotCopyRules: string[];
  differentiationWarnings: string[];
  uncertainties: string[];
}

export interface ReferenceDistilledEntry
  extends ReferenceDistillationModelEntry {
  id: string;
  estimatedTokens: number;
}

export interface ReferenceDistillationResult {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  unitId: string;
  entries: ReferenceDistilledEntry[];
  doNotCopyRules: string[];
  differentiationWarnings: string[];
  coveredUnitIds: string[];
  coveredChapterIds: string[];
  uncertainties: string[];
}

export interface NormalizeReferenceDistillationOptions {
  runId: string;
  unit: ReferenceDeconstructionWorkUnit;
  verifiedFindings: ReferenceDeconstructionVerifiedFindingMap;
  coveredUnitIds: readonly string[];
  coveredChapterIds: readonly string[];
}

export interface ReferenceContextIndexEntry extends ReferenceDistilledEntry {
  path: string;
  content: string;
  contentChecksumSha256: string;
}

export interface ReferenceContextIndex {
  version: typeof REFERENCE_DECONSTRUCTION_SCHEMA_VERSION;
  referenceId: string;
  publishedRunId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  pipelineVersion: typeof REFERENCE_DECONSTRUCTION_PIPELINE_VERSION;
  capabilityVersion: typeof REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION;
  status: 'completed';
  contextEligible: true;
  originalSourceRead: false;
  summaryPath: 'context/reference-summary.md';
  entries: ReferenceContextIndexEntry[];
  protectedRules: {
    doNotCopy: string[];
    differentiationWarnings: string[];
  };
}

export interface CreateReferenceContextIndexInput {
  referenceId: string;
  publishedRunId: string;
  sourceChecksumSha256: string;
  structureFingerprint: string;
  distillation: ReferenceDistillationResult;
}

export interface AssertReferenceContextIndexIdentity {
  referenceId?: string;
  publishedRunId?: string;
  sourceChecksumSha256?: string;
  structureFingerprint?: string;
}

export function normalizeReferenceDistillationModelOutput(
  value: unknown,
  options: NormalizeReferenceDistillationOptions,
): ReferenceDistillationResult {
  if (
    options.unit.kind !== 'distill'
    || options.unit.stageId !== 'distillForOan'
  ) {
    throw new Error('Reference distillation requires a distill work unit.');
  }
  const runId = requireSafeIdentifier(options.runId, 'runId');
  const record = requireRecord(value, 'Reference distillation model output');
  assertOnlyKnownFields(record, [
    'entries',
    'doNotCopyRules',
    'differentiationWarnings',
    'uncertainties',
  ]);
  const verifiedFindingIds = Object.keys(options.verifiedFindings);
  if (
    !verifiedFindingIds.length
    || verifiedFindingIds.length > MAX_REFERENCE_DISTILLATION_INPUTS
  ) {
    throw new Error('Reference distillation verified finding input is invalid.');
  }
  const verifiedCharacters = verifiedFindingIds.reduce((total, id) =>
    total + stableJson(options.verifiedFindings[id]).length, 0);
  if (verifiedCharacters > MAX_REFERENCE_DISTILLATION_INPUT_CHARS) {
    throw new Error('Reference distillation verified findings exceed the input budget.');
  }

  const rawEntries = requireArray(
    record.entries,
    'distillation entries',
    REFERENCE_DISTILLED_CATEGORIES.length,
    MAX_REFERENCE_DISTILLED_ENTRIES,
  );
  const entries = rawEntries.map((entry, index) =>
    normalizeModelEntry(entry, index, runId, options.verifiedFindings));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new Error('Reference distilled entry ids must be unique.');
  }
  for (const category of REFERENCE_DISTILLED_CATEGORIES) {
    const categoryCount = entries.filter((entry) => entry.category === category).length;
    if (categoryCount < 1) {
      throw new Error(`Reference distillation must include category ${category}.`);
    }
    if (categoryCount > MAX_REFERENCE_DISTILLED_ENTRIES_PER_CATEGORY) {
      throw new Error(`Reference distillation category ${category} has too many entries.`);
    }
  }
  const doNotCopyRules = requireStringArray(
    record.doNotCopyRules,
    'doNotCopyRules',
    1,
    MAX_DISTILLATION_RULES,
    MAX_ENTRY_LIST_ITEM_CHARS,
  );
  const differentiationWarnings = requireStringArray(
    record.differentiationWarnings,
    'differentiationWarnings',
    1,
    MAX_DISTILLATION_RULES,
    MAX_ENTRY_LIST_ITEM_CHARS,
  );
  const uncertainties = requireStringArray(
    record.uncertainties,
    'distillation uncertainties',
    0,
    MAX_DISTILLATION_UNCERTAINTIES,
    MAX_ENTRY_LIST_ITEM_CHARS,
  );

  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    unitId: options.unit.id,
    entries: sortDistilledEntries(entries),
    doNotCopyRules,
    differentiationWarnings,
    coveredUnitIds: requireUniqueSafeIds(
      options.coveredUnitIds,
      'coveredUnitIds',
      1,
      2_048,
    ),
    coveredChapterIds: requireUniqueSafeIds(
      options.coveredChapterIds,
      'coveredChapterIds',
      1,
      100_000,
    ),
    uncertainties,
  };
}

export function parseReferenceDistillationResult(
  value: unknown,
  options: NormalizeReferenceDistillationOptions,
): ReferenceDistillationResult {
  const record = requireRecord(value, 'Stored reference distillation');
  assertOnlyKnownFields(record, [
    'version',
    'unitId',
    'entries',
    'doNotCopyRules',
    'differentiationWarnings',
    'coveredUnitIds',
    'coveredChapterIds',
    'uncertainties',
  ]);
  if (
    record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || record.unitId !== options.unit.id
  ) {
    throw new Error('Stored reference distillation identity is invalid.');
  }
  const normalized = normalizeReferenceDistillationModelOutput({
    entries: requireArray(
      record.entries,
      'stored distillation entries',
      REFERENCE_DISTILLED_CATEGORIES.length,
      MAX_REFERENCE_DISTILLED_ENTRIES,
    ).map((entry) => {
      const entryRecord = requireRecord(entry, 'stored distilled entry');
      const {
        id: _id,
        estimatedTokens: _estimatedTokens,
        ...modelEntry
      } = entryRecord;
      return modelEntry;
    }),
    doNotCopyRules: record.doNotCopyRules,
    differentiationWarnings: record.differentiationWarnings,
    uncertainties: record.uncertainties,
  }, {
    ...options,
    coveredUnitIds: requireUniqueSafeIds(
      record.coveredUnitIds,
      'coveredUnitIds',
      1,
      2_048,
    ),
    coveredChapterIds: requireUniqueSafeIds(
      record.coveredChapterIds,
      'coveredChapterIds',
      1,
      100_000,
    ),
  });
  if (stableJson(normalized) !== stableJson(record)) {
    throw new Error('Stored reference distillation is not canonical.');
  }
  return normalized;
}

export function collectReferenceDistillationFindings(
  aggregateFindings: readonly ReferenceDeconstructionFinding[],
  style: ReferenceStyleProfileResult,
): ReferenceDeconstructionFinding[] {
  const findings = [
    ...aggregateFindings,
    ...style.dimensions.map((dimension): ReferenceDeconstructionFinding => ({
      id: dimension.id,
      kind: 'styleTechnique',
      observation: dimension.observation,
      technique: dimension.technique,
      ...(dimension.avoid ? { avoid: dimension.avoid } : {}),
      confidence: dimension.confidence,
      evidenceRefs: [...dimension.evidenceRefs],
      sourceFindingRefs: [...dimension.sourceFindingRefs],
      generalInference: dimension.generalInference,
      ...(dimension.uncertainty ? { uncertainty: dimension.uncertainty } : {}),
    })),
  ];
  const unique = new Map<string, ReferenceDeconstructionFinding>();
  for (const finding of findings) {
    if (unique.has(finding.id)) {
      throw new Error(`Reference distillation input id is duplicated: ${finding.id}.`);
    }
    unique.set(finding.id, finding);
  }
  return [...unique.values()];
}

export function formatReferenceDistilledEntryContent(
  entry: ReferenceDistilledEntry,
): string {
  return [
    `## ${entry.title}`,
    '',
    `Entry ID: ${entry.id}`,
    `Category: ${entry.category}`,
    `Confidence: ${entry.confidence}`,
    `Tags: ${entry.tags.join(', ') || 'none'}`,
    `Capabilities: ${entry.capabilityIds.join(', ')}`,
    '',
    '### Technique',
    '',
    entry.technique,
    '',
    '### When Useful',
    '',
    ...entry.whenUseful.map((item) => `- ${item}`),
    '',
    '### Constraints',
    '',
    ...entry.constraints.map((item) => `- ${item}`),
    '',
    '### Differentiation Prompts',
    '',
    ...entry.differentiationPrompts.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

export function formatReferenceDistilledCategoryMarkdown(
  category: ReferenceDistilledCategory,
  entries: readonly ReferenceDistilledEntry[],
): string {
  const selected = sortDistilledEntries(
    entries.filter((entry) => entry.category === category),
  );
  if (!selected.length) {
    throw new Error(`Reference distilled category ${category} is empty.`);
  }
  return [
    `# ${formatCategoryTitle(category)}`,
    '',
    'These are transformed writing techniques, not source prose or canon facts.',
    '',
    ...selected.map(formatReferenceDistilledEntryContent),
  ].join('\n');
}

export function createReferenceContextIndex(
  input: CreateReferenceContextIndexInput,
): ReferenceContextIndex {
  const referenceId = requireSafeIdentifier(input.referenceId, 'referenceId');
  const publishedRunId = requireSafeIdentifier(input.publishedRunId, 'publishedRunId');
  const sourceChecksumSha256 = requireSha256(
    input.sourceChecksumSha256,
    'sourceChecksumSha256',
  );
  const structureFingerprint = requireSha256(
    input.structureFingerprint,
    'structureFingerprint',
  );
  const distillation = input.distillation;
  const entries = sortDistilledEntries(distillation.entries).map(
    (entry): ReferenceContextIndexEntry => {
      const content = formatReferenceDistilledEntryContent(entry);
      return {
        ...entry,
        path: distilledCategoryPath(entry.category),
        content,
        contentChecksumSha256: sha256(content),
      };
    },
  );
  return assertReferenceContextIndex({
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId,
    publishedRunId,
    sourceChecksumSha256,
    structureFingerprint,
    pipelineVersion: REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
    capabilityVersion: REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
    status: 'completed',
    contextEligible: true,
    originalSourceRead: false,
    summaryPath: 'context/reference-summary.md',
    entries,
    protectedRules: {
      doNotCopy: [...distillation.doNotCopyRules],
      differentiationWarnings: [...distillation.differentiationWarnings],
    },
  }, {
    referenceId,
    publishedRunId,
    sourceChecksumSha256,
    structureFingerprint,
  });
}

export function assertReferenceContextIndex(
  value: unknown,
  identity: AssertReferenceContextIndexIdentity = {},
): ReferenceContextIndex {
  const record = requireRecord(value, 'Reference context index');
  assertOnlyKnownFields(record, [
    'version',
    'referenceId',
    'publishedRunId',
    'sourceChecksumSha256',
    'structureFingerprint',
    'pipelineVersion',
    'capabilityVersion',
    'status',
    'contextEligible',
    'originalSourceRead',
    'summaryPath',
    'entries',
    'protectedRules',
  ]);
  if (
    record.version !== REFERENCE_DECONSTRUCTION_SCHEMA_VERSION
    || record.pipelineVersion !== REFERENCE_DECONSTRUCTION_PIPELINE_VERSION
    || record.capabilityVersion !== REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION
    || record.status !== 'completed'
    || record.contextEligible !== true
    || record.originalSourceRead !== false
    || record.summaryPath !== 'context/reference-summary.md'
  ) {
    throw new Error('Reference context index lifecycle fields are invalid.');
  }
  const referenceId = requireSafeIdentifier(record.referenceId, 'referenceId');
  const publishedRunId = requireSafeIdentifier(record.publishedRunId, 'publishedRunId');
  const sourceChecksumSha256 = requireSha256(
    record.sourceChecksumSha256,
    'sourceChecksumSha256',
  );
  const structureFingerprint = requireSha256(
    record.structureFingerprint,
    'structureFingerprint',
  );
  if (
    identity.referenceId !== undefined && identity.referenceId !== referenceId
    || identity.publishedRunId !== undefined && identity.publishedRunId !== publishedRunId
    || identity.sourceChecksumSha256 !== undefined
      && identity.sourceChecksumSha256 !== sourceChecksumSha256
    || identity.structureFingerprint !== undefined
      && identity.structureFingerprint !== structureFingerprint
  ) {
    throw new Error('Reference context index identity is stale.');
  }
  const entries = requireArray(
    record.entries,
    'context index entries',
    REFERENCE_DISTILLED_CATEGORIES.length,
    MAX_REFERENCE_DISTILLED_ENTRIES,
  ).map((value, index): ReferenceContextIndexEntry => {
    const entry = requireRecord(value, `context index entries[${index}]`);
    assertOnlyKnownFields(entry, [
      'id',
      'category',
      'title',
      'technique',
      'whenUseful',
      'constraints',
      'differentiationPrompts',
      'sourceFindingRefs',
      'confidence',
      'tags',
      'capabilityIds',
      'estimatedTokens',
      'path',
      'content',
      'contentChecksumSha256',
    ]);
    const normalized = normalizeStoredEntry(entry, publishedRunId);
    const expectedPath = distilledCategoryPath(normalized.category);
    const content = requireCanonicalContent(entry.content, 'entry content', 16_000);
    if (
      entry.path !== expectedPath
      || entry.contentChecksumSha256 !== sha256(content)
      || content !== formatReferenceDistilledEntryContent(normalized)
    ) {
      throw new Error(`Reference context index entry ${normalized.id} is not canonical.`);
    }
    return {
      ...normalized,
      path: expectedPath,
      content,
      contentChecksumSha256: requireSha256(
        entry.contentChecksumSha256,
        'contentChecksumSha256',
      ),
    };
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error('Reference context index entry ids must be unique.');
  }
  for (const category of REFERENCE_DISTILLED_CATEGORIES) {
    if (!entries.some((entry) => entry.category === category)) {
      throw new Error(`Reference context index is missing category ${category}.`);
    }
  }
  if (stableJson(entries) !== stableJson(sortDistilledEntries(entries))) {
    throw new Error('Reference context index entries are not in canonical order.');
  }
  const protectedRules = requireRecord(record.protectedRules, 'protectedRules');
  assertOnlyKnownFields(protectedRules, ['doNotCopy', 'differentiationWarnings']);
  return {
    version: REFERENCE_DECONSTRUCTION_SCHEMA_VERSION,
    referenceId,
    publishedRunId,
    sourceChecksumSha256,
    structureFingerprint,
    pipelineVersion: REFERENCE_DECONSTRUCTION_PIPELINE_VERSION,
    capabilityVersion: REFERENCE_DECONSTRUCTION_CAPABILITY_VERSION,
    status: 'completed',
    contextEligible: true,
    originalSourceRead: false,
    summaryPath: 'context/reference-summary.md',
    entries,
    protectedRules: {
      doNotCopy: requireStringArray(
        protectedRules.doNotCopy,
        'protectedRules.doNotCopy',
        1,
        MAX_DISTILLATION_RULES,
        MAX_ENTRY_LIST_ITEM_CHARS,
      ),
      differentiationWarnings: requireStringArray(
        protectedRules.differentiationWarnings,
        'protectedRules.differentiationWarnings',
        1,
        MAX_DISTILLATION_RULES,
        MAX_ENTRY_LIST_ITEM_CHARS,
      ),
    },
  };
}

export function distilledCategoryPath(
  category: ReferenceDistilledCategory,
): string {
  switch (category) {
    case 'writingStyle':
      return 'distilled/writing-style.md';
    case 'pacing':
      return 'distilled/pacing.md';
    case 'hooks':
      return 'distilled/hooks.md';
    case 'scene':
      return 'distilled/scene-techniques.md';
    case 'character':
      return 'distilled/character-techniques.md';
  }
}

function normalizeModelEntry(
  value: unknown,
  index: number,
  runId: string,
  verifiedFindings: ReferenceDeconstructionVerifiedFindingMap,
): ReferenceDistilledEntry {
  const record = requireRecord(value, `distillation entries[${index}]`);
  assertOnlyKnownFields(record, [
    'category',
    'title',
    'technique',
    'whenUseful',
    'constraints',
    'differentiationPrompts',
    'sourceFindingRefs',
    'confidence',
    'tags',
    'capabilityIds',
  ]);
  const modelEntry = normalizeEntryFields(record);
  if (modelEntry.sourceFindingRefs.some((id) => !verifiedFindings[id])) {
    throw new Error('Reference distilled entry cites an unknown source finding.');
  }
  const normalizedContent = stableJson(modelEntry);
  const id = createDistilledEntryId(runId, modelEntry, normalizedContent);
  const estimatedTokens = estimateTokens(normalizedContent);
  if (estimatedTokens > MAX_REFERENCE_DISTILLED_ENTRY_TOKENS) {
    throw new Error('Reference distilled entry exceeds its token budget.');
  }
  return { id, ...modelEntry, estimatedTokens };
}

function normalizeStoredEntry(
  record: Record<string, unknown>,
  publishedRunId: string,
): ReferenceDistilledEntry {
  const fields = normalizeEntryFields(record);
  const id = requireSafeIdentifier(record.id, 'distilled entry id');
  const normalizedContent = stableJson(fields);
  const expectedId = createDistilledEntryId(
    publishedRunId,
    fields,
    normalizedContent,
  );
  if (id !== expectedId) {
    throw new Error(`Reference distilled entry ${id} has a stale deterministic id.`);
  }
  const estimatedTokens = requireInteger(
    record.estimatedTokens,
    'estimatedTokens',
    1,
    MAX_REFERENCE_DISTILLED_ENTRY_TOKENS,
  );
  if (estimatedTokens !== estimateTokens(normalizedContent)) {
    throw new Error(`Reference distilled entry ${id} has a stale token estimate.`);
  }
  return { id, ...fields, estimatedTokens };
}

function createDistilledEntryId(
  runId: string,
  entry: ReferenceDistillationModelEntry,
  normalizedContent = stableJson(entry),
): string {
  return `distilled-${sha256(stableJson({
    runId,
    category: entry.category,
    sourceFindingRefs: [...entry.sourceFindingRefs].sort(),
    content: normalizedContent,
  })).slice(0, 24)}`;
}

function normalizeEntryFields(
  record: Record<string, unknown>,
): ReferenceDistillationModelEntry {
  const category = requireEnum(
    record.category,
    REFERENCE_DISTILLED_CATEGORIES,
    'distilled category',
  );
  return {
    category,
    title: requireText(record.title, 'distilled title', 240),
    technique: requireText(
      record.technique,
      'distilled technique',
      MAX_ENTRY_TEXT_CHARS,
    ),
    whenUseful: requireStringArray(
      record.whenUseful,
      'whenUseful',
      1,
      MAX_ENTRY_ARRAY_ITEMS,
      MAX_ENTRY_LIST_ITEM_CHARS,
    ),
    constraints: requireStringArray(
      record.constraints,
      'constraints',
      1,
      MAX_ENTRY_ARRAY_ITEMS,
      MAX_ENTRY_LIST_ITEM_CHARS,
    ),
    differentiationPrompts: requireStringArray(
      record.differentiationPrompts,
      'differentiationPrompts',
      1,
      MAX_ENTRY_ARRAY_ITEMS,
      MAX_ENTRY_LIST_ITEM_CHARS,
    ),
    sourceFindingRefs: requireUniqueSafeIds(
      record.sourceFindingRefs,
      'sourceFindingRefs',
      1,
      64,
    ),
    confidence: requireEnum(
      record.confidence,
      ['low', 'medium', 'high'] as const,
      'distilled confidence',
    ),
    tags: requireStringArray(
      record.tags,
      'tags',
      1,
      MAX_ENTRY_ARRAY_ITEMS,
      MAX_ENTRY_TAG_CHARS,
    ).map(normalizeTag),
    capabilityIds: requireCapabilities(record.capabilityIds),
  };
}

function requireCapabilities(value: unknown): NovelCopilotCapabilityId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new Error('Reference distilled capabilityIds are invalid.');
  }
  const capabilities = value.map((item) => requireEnum(
    item,
    NOVEL_COPILOT_CAPABILITY_IDS,
    'distilled capability id',
  ));
  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error('Reference distilled capabilityIds must be unique.');
  }
  return capabilities;
}

function normalizeTag(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, '-');
  if (
    !normalized
    || normalized.length > MAX_ENTRY_TAG_CHARS
    || /[<>{}\r\n]/u.test(normalized)
  ) {
    throw new Error('Reference distilled tag is invalid.');
  }
  return normalized;
}

function sortDistilledEntries<T extends ReferenceDistilledEntry>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((left, right) => {
    const categoryDifference =
      REFERENCE_DISTILLED_CATEGORIES.indexOf(left.category)
      - REFERENCE_DISTILLED_CATEGORIES.indexOf(right.category);
    return categoryDifference || left.id.localeCompare(right.id);
  });
}

function formatCategoryTitle(category: ReferenceDistilledCategory): string {
  switch (category) {
    case 'writingStyle':
      return 'Writing Style Techniques';
    case 'pacing':
      return 'Pacing Techniques';
    case 'hooks':
      return 'Hook Techniques';
    case 'scene':
      return 'Scene Techniques';
    case 'character':
      return 'Character Techniques';
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(record).find((field) => !allowed.has(field));
  if (unknown) throw new Error(`Unknown field ${unknown}.`);
}

function requireArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain from ${minimum} to ${maximum} items.`);
  }
  return value;
}

function requireStringArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  maxItemLength: number,
): string[] {
  const values = requireArray(value, label, minimum, maximum).map((item) =>
    requireText(item, label, maxItemLength));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function requireUniqueSafeIds(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string[] {
  const values = requireArray(value, label, minimum, maximum).map((item) =>
    requireSafeIdentifier(item, label));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[\p{L}\p{N}_:-]{1,160}$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 checksum.`);
  }
  return value;
}

function requireText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > maximum || /\u0000/u.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function requireCanonicalContent(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (
    typeof value !== 'string'
    || !value
    || value.length > maximum
    || /\u0000/u.test(value)
    || value.normalize('NFC') !== value
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
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

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}
