import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

import type {
  ContextBudgetLayer,
  ContextSourceRef,
  SemanticBoundary,
} from './agent-context-package.js';
import type { NovelCopilotCapabilityId } from './novel-copilot-skill.js';
import {
  createNotAnalyzedReferenceManifest,
  createReferenceDiagnostics,
  createReferenceProgressProjection,
  createReferenceStructureFingerprint,
  assertReferenceProgress,
} from './reference-deconstruction.js';
import type {
  ReferenceDeconstructionStageId,
  ReferenceProgress as DeconstructionReferenceProgress,
  ReferencePublishedDeconstructionStatus,
} from './reference-deconstruction.js';
import {
  assertReferenceMetadata,
  assertReferenceSourceManifest,
  inspectReferenceWorkReadiness,
} from './reference-deconstruction-store.js';
import type {
  ReferenceReadinessReason,
} from './reference-deconstruction-store.js';

export type ReferenceSourceType =
  | 'novel'
  | 'chapterSample'
  | 'styleSample'
  | 'settingBible'
  | 'notes';

export type ReferenceRights =
  | 'owned'
  | 'publicDomain'
  | 'licensed'
  | 'excerpt'
  | 'unknown';

export type ReferenceAllowedUsage =
  | 'analysisOnly'
  | 'styleInspiration'
  | 'structureReference'
  | 'noDirectQuotation';

export type ReferenceProgressStage = ReferenceDeconstructionStageId;

export interface ReferenceImportInput {
  workspaceRoot: string;
  title: string;
  sourcePath?: string;
  sourceText?: string;
  originalFileName?: string;
  sourceType?: ReferenceSourceType;
  rights?: ReferenceRights;
  allowedUsage?: ReferenceAllowedUsage[];
  enabled?: boolean;
  notes?: string;
}

export interface ReferenceChapterBoundary {
  id: string;
  title: string;
  lineStart: number;
  lineEnd: number;
  wordCount: number;
}

export interface ReferenceSourceManifest {
  version: 1;
  referenceId: string;
  originalFile: string;
  originalFileName: string;
  sourcePath?: string;
  checksumSha256: string;
  structureFingerprint: string;
  importedAt: string;
  byteLength: number;
  charLength: number;
  lineCount: number;
  detectedStructure: {
    chapterCount: number;
    chapters: ReferenceChapterBoundary[];
    confidence: 'high' | 'medium' | 'low';
  };
}

export interface ReferenceMetadata {
  version: 1;
  id: string;
  title: string;
  sourceType: ReferenceSourceType;
  rights: ReferenceRights;
  allowedUsage: ReferenceAllowedUsage[];
  enabled: boolean;
  importedAt: string;
  checksumSha256: string;
  sourcePath?: string;
  notes?: string;
}

export type ReferenceProgress = DeconstructionReferenceProgress;

export interface ReferenceWorkSummary {
  id: string;
  title: string;
  sourceType: ReferenceSourceType;
  rights: ReferenceRights;
  allowedUsage: ReferenceAllowedUsage[];
  enabled: boolean;
  importedAt: string;
  checksumSha256: string;
  bundlePath: string;
  summaryPath: string;
  distilledPaths: string[];
  chapterCount: number;
  structureConfidence: ReferenceSourceManifest['detectedStructure']['confidence'];
  deconstructionStatus: ReferencePublishedDeconstructionStatus;
  contextEligible: boolean;
  readinessReason: ReferenceReadinessReason;
  progress: ReferenceProgress;
}

export interface ReferenceImportResult {
  reference: ReferenceWorkSummary;
  manifest: ReferenceSourceManifest;
  createdFiles: string[];
}

export interface ReferenceContextSelectionInput {
  workspaceRoot: string;
  capability?: NovelCopilotCapabilityId;
  goal?: string;
  explicitReferenceIds?: string[];
  tokenBudget?: number;
  maxReferences?: number;
}

export interface ReferenceContextSelection {
  tokenBudget: number;
  originalSourceRead: boolean;
  noCopyWarnings: string[];
  included: Array<{
    id: string;
    title: string;
    path: string;
    reason: string;
    budgetLayer: ContextBudgetLayer;
    semanticBoundary: SemanticBoundary;
    estimatedTokens: number;
    content: string;
    deconstructionStatus: 'completed';
    contextEligible: true;
    reasonCode: 'ready';
  }>;
  omitted: Array<{
    id: string;
    title: string;
    reason: string;
    budgetLayer: ContextBudgetLayer;
    deconstructionStatus: ReferencePublishedDeconstructionStatus;
    contextEligible: false;
    reasonCode: ReferenceContextOmissionReason;
  }>;
}

export type ReferenceContextOmissionReason =
  | 'disabled'
  | 'notExplicitlyRequested'
  | 'maxReferenceCountReached'
  | 'notAnalyzed'
  | 'stale'
  | 'qualityFailed'
  | 'needsRebuild'
  | 'missingContextSummary'
  | 'invalidContextPath'
  | 'tokenBudgetExceeded';

interface ReferencesIndex {
  version: number;
  references: ReferenceWorkSummary[];
}

const DEFAULT_ALLOWED_USAGE: ReferenceAllowedUsage[] = [
  'analysisOnly',
  'styleInspiration',
  'structureReference',
  'noDirectQuotation',
];
const DISTILLED_FILES = [
  'writing-style.md',
  'pacing.md',
  'hooks.md',
  'scene-techniques.md',
  'character-techniques.md',
  'do-not-copy.md',
];
const REFERENCE_NO_COPY_WARNINGS = [
  'Reference context is analysis-only inspiration; do not copy prose, scenes, character identities, or protected expression.',
  'Use differentiation: preserve OAN canon, transform techniques, and avoid importing reference facts as truth.',
  'Original source content is not read by default in writing context selection.',
];

export async function importReferenceWork(
  input: ReferenceImportInput,
): Promise<ReferenceImportResult> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const title = input.title.trim();

  if (!title) {
    throw new Error('Reference title is required.');
  }

  const source = await readReferenceSource(input);
  const importedAt = new Date().toISOString();
  const checksumSha256 = createHash('sha256').update(source.content).digest('hex');
  const referencesRoot = await ensureSafeReferencesRoot(workspaceRoot);
  const referenceId = await createUniqueReferenceId(
    workspaceRoot,
    referencesRoot,
    title,
    checksumSha256,
  );
  const bundlePath = join(referencesRoot, referenceId);
  const originalExtension = sanitizeExtension(extname(source.originalFileName)) || '.txt';
  const originalFile = `original${originalExtension}`;
  const originalRelativePath = `examples/references/${referenceId}/sources/${originalFile}`;
  const detectedStructure = detectReferenceStructure(source.content);
  const structureFingerprint = createReferenceStructureFingerprint(detectedStructure);
  const manifest = assertReferenceSourceManifest({
    version: 1,
    referenceId,
    originalFile,
    originalFileName: source.originalFileName,
    sourcePath: source.sourcePath,
    checksumSha256,
    structureFingerprint,
    importedAt,
    byteLength: Buffer.byteLength(source.content, 'utf-8'),
    charLength: source.content.length,
    lineCount: source.content.split(/\r?\n/u).length,
    detectedStructure,
  });
  const metadata = assertReferenceMetadata({
    version: 1,
    id: referenceId,
    title,
    sourceType: input.sourceType ?? 'novel',
    rights: input.rights ?? 'unknown',
    allowedUsage: normalizeAllowedUsage(input.allowedUsage),
    enabled: input.enabled ?? true,
    importedAt,
    checksumSha256,
    sourcePath: source.sourcePath,
    notes: normalizeOptionalString(input.notes),
  });
  const deconstructionManifest = createNotAnalyzedReferenceManifest({
    referenceId,
    sourceChecksumSha256: checksumSha256,
    structureFingerprint,
  });
  const progress = createReferenceProgressProjection(deconstructionManifest, importedAt);
  const diagnostics = createReferenceDiagnostics({
    referenceId,
    sourceChecksumSha256: checksumSha256,
    generatedAt: importedAt,
    items: detectedStructure.confidence === 'low'
      ? [{
          id: 'structure-low-confidence',
          code: 'structure.lowConfidence',
          severity: 'warning',
          blocking: false,
          message: 'Chapter structure confidence is low; confirm the preview range before analysis.',
          evidenceRefs: [],
          stageId: 'detectStructure',
        }]
      : [],
  });
  const createdFiles: string[] = [];

  try {
    await mkdir(bundlePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Reference bundle already exists: ${referenceId}`);
    }
    throw error;
  }
  await mkdir(join(bundlePath, 'sources'));
  await mkdir(join(bundlePath, 'distilled'));
  await mkdir(join(bundlePath, 'context'));

  await writeReferenceRawFile(
    workspaceRoot,
    originalRelativePath,
    source.content,
    createdFiles,
  );
  await writeReferenceYaml(
    workspaceRoot,
    `examples/references/${referenceId}/metadata.yaml`,
    metadata,
    createdFiles,
  );
  await writeReferenceYaml(
    workspaceRoot,
    `examples/references/${referenceId}/sources/source-manifest.yaml`,
    manifest,
    createdFiles,
  );
  await writeReferenceYaml(
    workspaceRoot,
    `examples/references/${referenceId}/progress.yaml`,
    progress,
    createdFiles,
  );
  await writeReferenceYaml(
    workspaceRoot,
    `examples/references/${referenceId}/deconstruction-manifest.yaml`,
    deconstructionManifest,
    createdFiles,
  );
  await writeReferenceYaml(
    workspaceRoot,
    `examples/references/${referenceId}/diagnostics.yaml`,
    diagnostics,
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `examples/references/${referenceId}/distilled/do-not-copy.md`,
    formatDoNotCopy(metadata),
    createdFiles,
  );
  await writeReferenceYaml(
    workspaceRoot,
    `examples/references/${referenceId}/context/index.yaml`,
    createReferenceContextIndex(referenceId),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `examples/references/${referenceId}/context/reference-summary.md`,
    formatReferenceSummary(metadata, manifest),
    createdFiles,
  );
  await writeExamplesReadme(workspaceRoot, createdFiles);

  const reference = createReferenceSummary(
    metadata,
    manifest,
    progress,
    'notAnalyzed',
    false,
    'notAnalyzed',
  );
  await upsertReferencesIndex(workspaceRoot, reference);

  return {
    reference,
    manifest,
    createdFiles,
  };
}

export async function listReferenceWorks(workspaceRoot: string): Promise<ReferenceWorkSummary[]> {
  const root = resolve(workspaceRoot);
  const index = await readReferencesIndex(root);
  return Promise.all(index.references.map(async (indexed) => {
    const inspection = await inspectReferenceWorkReadiness(root, indexed.id);
    const metadata = inspection.metadata;
    const manifest = inspection.sourceManifest;
    if (!metadata || !manifest) {
      return {
        ...indexed,
        deconstructionStatus: inspection.status,
        contextEligible: false,
        readinessReason: inspection.reason,
        progress: {
          ...indexed.progress,
          status: inspection.status,
          contextEligible: false,
        },
      };
    }
    return createReferenceSummary(
      metadata,
      manifest,
      inspection.progress ?? indexed.progress,
      inspection.status,
      inspection.contextEligible,
      inspection.reason,
    );
  }));
}

export async function setReferenceEnabled(
  workspaceRoot: string,
  id: string,
  enabled: boolean,
): Promise<ReferenceWorkSummary> {
  const root = resolve(workspaceRoot);
  const safeId = assertSafeReferenceId(id);
  const index = await readReferencesIndex(root);
  const reference = index.references.find((item) => item.id === safeId);

  if (!reference) {
    throw new Error(`Reference not found: ${safeId}`);
  }
  await assertSafeExistingReferenceBundle(root, safeId);

  const metadataPath = join(
    root,
    'examples',
    'references',
    safeId,
    'metadata.yaml',
  );
  await assertPathIsNotSymlink(metadataPath);
  const metadata = assertReferenceMetadata(parse(await readFile(metadataPath, 'utf-8')) as unknown);
  if (reference.id !== safeId || metadata.id !== safeId) {
    throw new Error('Reference identities do not match the requested bundle.');
  }
  if (typeof enabled !== 'boolean') throw new Error('Reference enabled must be boolean.');
  metadata.enabled = enabled;
  await writeFile(metadataPath, stringify(metadata), 'utf-8');
  const inspection = await inspectReferenceWorkReadiness(root, safeId);
  const next = {
    ...reference,
    enabled,
    structureConfidence:
      inspection.sourceManifest?.detectedStructure.confidence
      ?? reference.structureConfidence,
    deconstructionStatus: inspection.status,
    contextEligible: inspection.contextEligible,
    readinessReason: inspection.reason,
    progress: {
      ...(inspection.progress ?? reference.progress),
      contextEligible: inspection.contextEligible,
      status: inspection.status,
    },
  };
  index.references = index.references.map((item) => item.id === safeId ? next : item);
  await writeReferencesIndex(root, index);
  return next;
}

export async function selectReferenceContext(
  input: ReferenceContextSelectionInput,
): Promise<ReferenceContextSelection> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const tokenBudget = normalizeSelectionBound(input.tokenBudget, 1_500, 1, 100_000, 'tokenBudget');
  const maxReferences = normalizeSelectionBound(input.maxReferences, 3, 1, 20, 'maxReferences');
  const explicitReferenceIds = new Set(input.explicitReferenceIds ?? []);
  const references = await listReferenceWorks(workspaceRoot);
  const included: ReferenceContextSelection['included'] = [];
  const omitted: ReferenceContextSelection['omitted'] = [];
  let usedTokens = 0;

  for (const reference of references) {
    if (!reference.enabled) {
      omitted.push({
        id: reference.id,
        title: reference.title,
        reason: 'disabled',
        budgetLayer: 'L3',
        deconstructionStatus: reference.deconstructionStatus,
        contextEligible: false,
        reasonCode: 'disabled',
      });
      continue;
    }

    if (explicitReferenceIds.size > 0 && !explicitReferenceIds.has(reference.id)) {
      omitted.push({
        id: reference.id,
        title: reference.title,
        reason: 'not explicitly requested for this turn',
        budgetLayer: 'L3',
        deconstructionStatus: reference.deconstructionStatus,
        contextEligible: false,
        reasonCode: 'notExplicitlyRequested',
      });
      continue;
    }

    if (!reference.contextEligible || reference.deconstructionStatus !== 'completed') {
      const reasonCode = readinessToOmissionReason(reference.readinessReason);
      omitted.push({
        id: reference.id,
        title: reference.title,
        reason: formatReadinessOmissionReason(reasonCode),
        budgetLayer: 'L3',
        deconstructionStatus: reference.deconstructionStatus,
        contextEligible: false,
        reasonCode,
      });
      continue;
    }

    if (included.length >= maxReferences) {
      omitted.push({
        id: reference.id,
        title: reference.title,
        reason: 'max reference count reached',
        budgetLayer: 'L3',
        deconstructionStatus: reference.deconstructionStatus,
        contextEligible: false,
        reasonCode: 'maxReferenceCountReached',
      });
      continue;
    }

    const inspection = await inspectReferenceWorkReadiness(workspaceRoot, reference.id);
    if (!inspection.contextEligible || !inspection.summaryPath || inspection.summaryContent === undefined) {
      const reasonCode = readinessToOmissionReason(inspection.reason);
      omitted.push({
        id: reference.id,
        title: reference.title,
        reason: formatReadinessOmissionReason(reasonCode),
        budgetLayer: 'L3',
        deconstructionStatus: inspection.status,
        contextEligible: false,
        reasonCode,
      });
      continue;
    }
    const content = inspection.summaryContent;
    const estimatedTokens = estimateTokens(content);
    if (usedTokens + estimatedTokens > tokenBudget) {
      omitted.push({
        id: reference.id,
        title: reference.title,
        reason: 'token budget exceeded',
        budgetLayer: 'L3',
        deconstructionStatus: reference.deconstructionStatus,
        contextEligible: false,
        reasonCode: 'tokenBudgetExceeded',
      });
      continue;
    }

    included.push({
      id: reference.id,
      title: reference.title,
      path: inspection.summaryPath,
      reason: formatReferenceSelectionReason(input, reference),
      budgetLayer: referenceBudgetLayer(input.capability),
      semanticBoundary: 'compressible',
      estimatedTokens,
      content,
      deconstructionStatus: 'completed',
      contextEligible: true,
      reasonCode: 'ready',
    });
    usedTokens += estimatedTokens;
  }

  return {
    tokenBudget,
    originalSourceRead: false,
    noCopyWarnings: [...REFERENCE_NO_COPY_WARNINGS],
    included,
    omitted,
  };
}

export function formatReferenceContextSelectionMarkdown(
  selection: ReferenceContextSelection,
): string {
  return [
    '## Reference Context Selection',
    '',
    `Original source read: ${selection.originalSourceRead ? 'yes' : 'no'}`,
    `Token budget: ${selection.tokenBudget}`,
    '',
    '### No-Copy Warnings',
    selection.noCopyWarnings.map((warning) => `- ${warning}`).join('\n'),
    '',
    '### Included Distilled Entries',
    selection.included.length
      ? selection.included.map((entry) => [
          `#### ${entry.title}`,
          '',
          `- path: ${entry.path}`,
          `- reason: ${entry.reason}`,
          `- budget: ${entry.budgetLayer}/${entry.semanticBoundary}`,
          '',
          entry.content.trim(),
        ].join('\n')).join('\n\n')
      : '- none',
    '',
    '### Omitted References',
    selection.omitted.length
      ? selection.omitted.map((entry) =>
          `- ${entry.title} [${entry.budgetLayer}]: ${entry.reason}`,
        ).join('\n')
      : '- none',
  ].join('\n');
}

export function referenceSelectionToContextSources(
  selection: ReferenceContextSelection,
): { selected: ContextSourceRef[]; omitted: ContextSourceRef[] } {
  return {
    selected: selection.included.map((entry) => ({
      sourceId: 'referenceDistilled',
      reason: entry.reason,
      budgetLayer: entry.budgetLayer,
      semanticBoundary: entry.semanticBoundary,
      path: entry.path,
      title: entry.title,
    })),
    omitted: selection.omitted.map((entry) => ({
      sourceId: 'referenceDistilled',
      reason: entry.reason,
      budgetLayer: entry.budgetLayer,
      semanticBoundary: 'excluded',
      title: entry.title,
    })),
  };
}

async function readReferenceSource(input: ReferenceImportInput): Promise<{
  content: string;
  originalFileName: string;
  sourcePath?: string;
}> {
  if (input.sourceText?.trim()) {
    return {
      content: input.sourceText,
      originalFileName: input.originalFileName?.trim() || 'pasted-reference.txt',
    };
  }

  const sourcePath = input.sourcePath?.trim();
  if (!sourcePath) {
    throw new Error('Reference sourcePath or sourceText is required.');
  }

  const absolutePath = resolve(sourcePath);
  const content = await readFile(absolutePath, 'utf-8');

  return {
    content,
    originalFileName: input.originalFileName?.trim() || basename(absolutePath),
    sourcePath: absolutePath,
  };
}

function detectReferenceStructure(content: string): ReferenceSourceManifest['detectedStructure'] {
  const lines = content.split(/\r?\n/u);
  const headings = lines
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((item) => isChapterHeading(item.line));
  const boundaryHeadings = headings.length > 0
    ? headings
    : [{ line: 'Full source', lineNumber: 1 }];
  const chapters = boundaryHeadings.map((heading, index): ReferenceChapterBoundary => {
    const next = boundaryHeadings[index + 1];
    const lineEnd = next ? next.lineNumber - 1 : lines.length;
    const body = lines.slice(heading.lineNumber - 1, lineEnd).join('\n');

    return {
      id: String(index + 1).padStart(4, '0'),
      title: normalizeChapterTitle(heading.line, index + 1),
      lineStart: heading.lineNumber,
      lineEnd,
      wordCount: countWords(body),
    };
  });

  return {
    chapterCount: chapters.length,
    chapters,
    confidence: headings.length >= 3 ? 'high' : headings.length > 0 ? 'medium' : 'low',
  };
}

function isChapterHeading(line: string): boolean {
  return /^#{1,3}\s+.+/u.test(line)
    || /^第\s*[0-9零一二三四五六七八九十百千万]+\s*[章节卷回](?:\s|$|[：:、.-])/u.test(line)
    || /^chapter\s+\d+\b/i.test(line)
    || /^\d+\s*[.、]\s+\S+/u.test(line);
}

function normalizeChapterTitle(line: string, index: number): string {
  const title = line.replace(/^#{1,3}\s+/u, '').trim();
  return title || `Chapter ${index}`;
}

function createReferenceContextIndex(referenceId: string): Record<string, unknown> {
  return {
    version: 1,
    referenceId,
    status: 'notAnalyzed',
    contextEligible: false,
    defaultContext: [],
    excludedByDefault: [
      'sources/original.*',
      'deconstruction/chapters/*-summary.md',
      'deconstruction/chapters/*-deep-dive.md',
    ],
    rules: [
      'Use distilled technique notes only unless the user explicitly requests source inspection.',
      'Do not quote, paraphrase closely, or copy recognizable expression from the original source.',
      'Reference-derived changes to OAN truth files must go through PendingAction review.',
    ],
  };
}

function createReferenceSummary(
  metadata: ReferenceMetadata,
  manifest: ReferenceSourceManifest,
  progress: ReferenceProgress,
  deconstructionStatus: ReferencePublishedDeconstructionStatus,
  contextEligible: boolean,
  readinessReason: ReferenceReadinessReason,
): ReferenceWorkSummary {
  return {
    id: metadata.id,
    title: metadata.title,
    sourceType: metadata.sourceType,
    rights: metadata.rights,
    allowedUsage: metadata.allowedUsage,
    enabled: metadata.enabled,
    importedAt: metadata.importedAt,
    checksumSha256: metadata.checksumSha256,
    bundlePath: `examples/references/${metadata.id}`,
    summaryPath: `examples/references/${metadata.id}/context/reference-summary.md`,
    distilledPaths: deconstructionStatus === 'completed'
      ? DISTILLED_FILES.map((file) => `examples/references/${metadata.id}/distilled/${file}`)
      : [`examples/references/${metadata.id}/distilled/do-not-copy.md`],
    chapterCount: manifest.detectedStructure.chapterCount,
    structureConfidence: manifest.detectedStructure.confidence,
    deconstructionStatus,
    contextEligible,
    readinessReason,
    progress: {
      ...progress,
      status: deconstructionStatus,
      contextEligible,
    },
  };
}

async function upsertReferencesIndex(
  workspaceRoot: string,
  reference: ReferenceWorkSummary,
): Promise<void> {
  const index = await readReferencesIndex(workspaceRoot);
  index.references = [
    ...index.references.filter((item) => item.id !== reference.id),
    reference,
  ].sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  await writeReferencesIndex(workspaceRoot, index);
}

async function readReferencesIndex(workspaceRoot: string): Promise<ReferencesIndex> {
  const filePath = join(workspaceRoot, 'examples', 'references.yaml');

  try {
    await assertExistingDirectoryChainSafe(workspaceRoot, ['examples']);
    await assertPathIsNotSymlink(filePath);
    const parsed = parse(await readFile(filePath, 'utf-8')) as unknown;
    if (
      !isRecord(parsed)
      || parsed.version !== 1
      || !Array.isArray(parsed.references)
    ) {
      throw new Error('Unsupported or invalid references index.');
    }
    const references = parsed.references.map((value, index) =>
      assertReferenceIndexEntry(value, index));
    if (new Set(references.map((reference) => reference.id)).size !== references.length) {
      throw new Error('References index contains duplicate reference ids.');
    }
    return {
      version: 1,
      references,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, references: [] };
    }

    throw error;
  }
}

async function assertExistingDirectoryChainSafe(
  workspaceRoot: string,
  segments: readonly string[],
): Promise<void> {
  const root = resolve(workspaceRoot);
  const realWorkspaceRoot = await realpath(root);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let information: Awaited<ReturnType<typeof lstat>>;
    try {
      information = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error(`Reference directory is not a safe directory: ${current}`);
    }
    assertRealPathContained(
      realWorkspaceRoot,
      await realpath(current),
      'Reference directory resolves outside workspace.',
    );
  }
}

async function writeReferencesIndex(
  workspaceRoot: string,
  index: ReferencesIndex,
): Promise<void> {
  await ensureSafeReferencesRoot(workspaceRoot);
  await assertPathIsNotSymlink(join(workspaceRoot, 'examples', 'references.yaml'));
  await writeFile(
    join(workspaceRoot, 'examples', 'references.yaml'),
    stringify(index),
    'utf-8',
  );
}

async function writeExamplesReadme(workspaceRoot: string, createdFiles: string[]): Promise<void> {
  const relativePath = 'examples/README.md';
  const absolutePath = resolveWorkspaceOutputPath(workspaceRoot, relativePath);
  await assertPathIsNotSymlink(absolutePath);

  try {
    await readFile(absolutePath, 'utf-8');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await writeReferenceFile(
    workspaceRoot,
    relativePath,
    `# Project References

\`examples/\` stores external reference material for analysis, technique extraction, and benchmarking.
It is not the active novel workspace and should not become a hidden source of story truth.

Default writing context must omit imported-only, preview-only, stale, incomplete, or
quality-failed bundles. Only an enabled, accepted, current, quality-passed published
deconstruction may expose its \`context/reference-summary.md\` and \`distilled/*\` files.
Original source files under \`sources/\` are retained for checksum verification and
explicit deconstruction only; they are never placed in ordinary writing context.
`,
    createdFiles,
  );
}

async function writeReferenceYaml(
  workspaceRoot: string,
  relativePath: string,
  value: unknown,
  createdFiles: string[],
): Promise<void> {
  await writeReferenceFile(workspaceRoot, relativePath, stringify(value), createdFiles);
}

async function writeReferenceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
  createdFiles: string[],
): Promise<void> {
  const absolutePath = resolveWorkspaceOutputPath(workspaceRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await assertPathIsNotSymlink(absolutePath);
  await writeFile(absolutePath, ensureTrailingNewline(content), 'utf-8');
  createdFiles.push(relativePath);
}

async function writeReferenceRawFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
  createdFiles: string[],
): Promise<void> {
  const absolutePath = resolveWorkspaceOutputPath(workspaceRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await assertPathIsNotSymlink(absolutePath);
  await writeFile(absolutePath, content, 'utf-8');
  createdFiles.push(relativePath);
}

function resolveWorkspaceOutputPath(workspaceRoot: string, relativePath: string): string {
  if (!relativePath.trim() || isAbsolute(relativePath)) {
    throw new Error(`Invalid reference output path: ${relativePath}`);
  }

  const parts = relativePath.split(/[\\/]+/u).filter(Boolean);
  if (parts.some((part) => part === '..' || part.startsWith('.'))) {
    throw new Error(`Invalid reference output path: ${relativePath}`);
  }

  const absolutePath = resolve(workspaceRoot, relativePath);
  const outputRelativePath = relative(workspaceRoot, absolutePath);

  if (
    outputRelativePath === '..' ||
    outputRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(outputRelativePath)
  ) {
    throw new Error(`Reference output path is outside workspace: ${relativePath}`);
  }

  return absolutePath;
}

async function createUniqueReferenceId(
  workspaceRoot: string,
  referencesRoot: string,
  title: string,
  checksumSha256: string,
): Promise<string> {
  const base = `${slugify(title)}-${checksumSha256.slice(0, 8)}`;
  const index = await readReferencesIndex(workspaceRoot);

  if (
    !index.references.some((item) => item.id === base)
    && !await pathExists(join(referencesRoot, base))
  ) {
    return base;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (
      !index.references.some((item) => item.id === candidate)
      && !await pathExists(join(referencesRoot, candidate))
    ) {
      return candidate;
    }
  }

  throw new Error(`Unable to create a unique reference id for: ${title}`);
}

async function ensureSafeReferencesRoot(workspaceRoot: string): Promise<string> {
  const root = resolve(workspaceRoot);
  await mkdir(root, { recursive: true });
  const realWorkspaceRoot = await realpath(root);
  let current = root;
  for (const segment of ['examples', 'references']) {
    current = join(current, segment);
    try {
      const information = await lstat(current);
      if (information.isSymbolicLink() || !information.isDirectory()) {
        throw new Error(`Reference directory is not a safe directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current);
    }
    const realCurrent = await realpath(current);
    assertRealPathContained(
      realWorkspaceRoot,
      realCurrent,
      'Reference directory resolves outside workspace.',
    );
  }
  return current;
}

async function assertSafeExistingReferenceBundle(
  workspaceRoot: string,
  referenceId: string,
): Promise<void> {
  const referencesRoot = await ensureSafeReferencesRoot(workspaceRoot);
  const bundlePath = join(referencesRoot, referenceId);
  const information = await lstat(bundlePath);
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw new Error('Reference bundle is not a safe directory.');
  }
  assertRealPathContained(
    await realpath(workspaceRoot),
    await realpath(bundlePath),
    'Reference bundle resolves outside workspace.',
  );
}

async function assertPathIsNotSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertRealPathContained(root: string, candidatePath: string, message: string): void {
  const candidate = relative(root, candidatePath);
  if (
    candidate === ''
    || candidate === '..'
    || candidate.startsWith(`..${sep}`)
    || isAbsolute(candidate)
  ) {
    throw new Error(message);
  }
}

function formatReferenceSummary(
  metadata: ReferenceMetadata,
  manifest: ReferenceSourceManifest,
): string {
  return `# ${metadata.title} Reference Summary

Source type: ${metadata.sourceType}
Rights: ${metadata.rights}
Allowed usage: ${metadata.allowedUsage.join(', ')}
Checksum: ${manifest.checksumSha256}

Deconstruction status: Not analyzed
Context eligible: no

## Context Boundary

- Default writing context must omit this bundle until an accepted, current, quality-passed deconstruction is published.
- Original source is retained at \`sources/${manifest.originalFile}\` but is not read by default.
- This reference is for transformed technique analysis only; do not copy text, scenes, or recognizable expression.
- Any adoption into OAN truth files must be proposed through PendingAction review.

## Imported Structure

- Chapters detected: ${manifest.detectedStructure.chapterCount}
- Detection confidence: ${manifest.detectedStructure.confidence}
- Source length: ${manifest.charLength} chars, ${manifest.lineCount} lines

## Next Step

This bundle has completed deterministic source import only. It has not completed an AI Quick Preview or deep deconstruction and is not eligible for writing context.
Quick Preview candidates are stored under \`.workspace/sessions/<run-id>/reference-deconstruction/\`; they do not publish or modify this reference bundle.
`;
}

function formatDoNotCopy(metadata: ReferenceMetadata): string {
  return `# Do Not Copy

Reference: ${metadata.title}

Hard rules:

- Do not copy original prose, dialogue, scene execution, or distinctive expression.
- Do not ask the model to imitate the reference as a named work or author.
- Do not convert reference plot facts into OAN truth files.
- Do not include original source files in default writing context.
- Use only transformed technique notes such as pacing, structure, escalation, viewpoint control, and scene mechanics.
`;
}

function normalizeAllowedUsage(value?: ReferenceAllowedUsage[]): ReferenceAllowedUsage[] {
  if (!value?.length) {
    return [...DEFAULT_ALLOWED_USAGE];
  }

  return Array.from(new Set(value));
}

function sanitizeExtension(value: string): string {
  return /^\.[a-z0-9]{1,12}$/iu.test(value) ? value.toLowerCase() : '';
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-+|-+$/gu, '');

  return slug || 'reference';
}

function countWords(value: string): number {
  const asciiWords = value.match(/[A-Za-z0-9_]+/gu)?.length ?? 0;
  const cjkChars = value.match(/[\u4e00-\u9fa5]/gu)?.length ?? 0;
  return asciiWords + cjkChars;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function formatReferenceSelectionReason(
  input: ReferenceContextSelectionInput,
  reference: ReferenceWorkSummary,
): string {
  const capability = input.capability ? ` for ${input.capability}` : '';
  const goal = input.goal?.trim() ? ` (${input.goal.trim()})` : '';
  return `enabled distilled reference summary "${reference.title}" selected${capability}${goal}; original source not read`;
}

function referenceBudgetLayer(
  capability: NovelCopilotCapabilityId | undefined,
): ContextBudgetLayer {
  if (
    capability === 'novel.review_chapter'
    || capability === 'novel.revise_chapter'
    || capability === 'novel.de_ai'
  ) {
    return 'L2';
  }

  if (capability === 'novel.deconstruct_reference') {
    return 'L1';
  }

  return 'L2';
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function assertReferenceIndexEntry(value: unknown, index: number): ReferenceWorkSummary {
  if (!isRecord(value)) {
    throw new Error(`Reference index entry ${index} must be an object.`);
  }
  const allowedFields = new Set([
    'id',
    'title',
    'sourceType',
    'rights',
    'allowedUsage',
    'enabled',
    'importedAt',
    'checksumSha256',
    'bundlePath',
    'summaryPath',
    'distilledPaths',
    'chapterCount',
    'structureConfidence',
    'deconstructionStatus',
    'contextEligible',
    'readinessReason',
    'progress',
  ]);
  const unknownField = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unknownField) {
    throw new Error(`Reference index entry contains unknown field: ${unknownField}.`);
  }
  const id = assertSafeReferenceId(value.id);
  const canonicalBundlePath = `examples/references/${id}`;
  const canonicalSummaryPath = `${canonicalBundlePath}/context/reference-summary.md`;
  if (
    value.bundlePath !== canonicalBundlePath
    || value.summaryPath !== canonicalSummaryPath
  ) {
    throw new Error(`Reference index entry ${id} contains a non-canonical path.`);
  }
  if (!Array.isArray(value.allowedUsage) || !Array.isArray(value.distilledPaths)) {
    throw new Error(`Reference index entry ${id} contains invalid arrays.`);
  }
  const allowedUsage = value.allowedUsage.map((item) => {
    if (
      item !== 'analysisOnly'
      && item !== 'styleInspiration'
      && item !== 'structureReference'
      && item !== 'noDirectQuotation'
    ) {
      throw new Error(`Reference index entry ${id} contains invalid allowed usage.`);
    }
    return item;
  });
  const sourceType = value.sourceType;
  if (
    sourceType !== 'novel'
    && sourceType !== 'chapterSample'
    && sourceType !== 'styleSample'
    && sourceType !== 'settingBible'
    && sourceType !== 'notes'
  ) {
    throw new Error(`Reference index entry ${id} contains invalid source type.`);
  }
  const rights = value.rights;
  if (
    rights !== 'owned'
    && rights !== 'publicDomain'
    && rights !== 'licensed'
    && rights !== 'excerpt'
    && rights !== 'unknown'
  ) {
    throw new Error(`Reference index entry ${id} contains invalid rights.`);
  }
  if (
    typeof value.title !== 'string'
    || !value.title.trim()
    || value.title.length > 300
    || typeof value.enabled !== 'boolean'
    || typeof value.importedAt !== 'string'
    || Number.isNaN(Date.parse(value.importedAt))
    || typeof value.checksumSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.checksumSha256)
    || !Number.isSafeInteger(value.chapterCount)
    || (value.chapterCount as number) < 1
  ) {
    throw new Error(`Reference index entry ${id} contains invalid scalar fields.`);
  }
  const distilledPaths = value.distilledPaths.map((item) => {
    if (
      typeof item !== 'string'
      || !item.startsWith(`${canonicalBundlePath}/distilled/`)
      || item.split(/[\\/]+/u).some((part) => part === '..' || part === '.')
    ) {
      throw new Error(`Reference index entry ${id} contains invalid distilled path.`);
    }
    return item;
  });
  let progress: ReferenceProgress;
  try {
    progress = assertReferenceProgress(value.progress);
    if (progress.referenceId !== id) throw new Error('progress identity mismatch');
  } catch {
    progress = createNeedsRebuildProgress(id, value.importedAt);
  }
  const deconstructionStatus = isPublishedStatus(value.deconstructionStatus)
    ? value.deconstructionStatus
    : 'needsRebuild';
  const readinessReason = isReadinessReason(value.readinessReason)
    ? value.readinessReason
    : 'needsRebuild';
  const structureConfidence = value.structureConfidence === undefined
    ? 'low'
    : assertStructureConfidence(value.structureConfidence, id);
  return {
    id,
    title: value.title.trim(),
    sourceType,
    rights,
    allowedUsage,
    enabled: value.enabled,
    importedAt: value.importedAt,
    checksumSha256: value.checksumSha256,
    bundlePath: canonicalBundlePath,
    summaryPath: canonicalSummaryPath,
    distilledPaths,
    chapterCount: value.chapterCount as number,
    structureConfidence,
    deconstructionStatus,
    contextEligible: false,
    readinessReason,
    progress: { ...progress, contextEligible: false },
  };
}

function assertStructureConfidence(
  value: unknown,
  referenceId: string,
): ReferenceSourceManifest['detectedStructure']['confidence'] {
  if (value !== 'low' && value !== 'medium' && value !== 'high') {
    throw new Error(
      `Reference index entry ${referenceId} contains invalid structure confidence.`,
    );
  }
  return value;
}

function createNeedsRebuildProgress(
  referenceId: string,
  updatedAt: string,
): ReferenceProgress {
  return {
    version: 1,
    referenceId,
    status: 'needsRebuild',
    currentStage: null,
    nextStage: 'quickPreview',
    completedStages: [],
    failedStages: [],
    stages: {
      detectStructure: 'stale',
      quickPreview: 'notStarted',
      chapterAnalysis: 'notStarted',
      aggregateAnalysis: 'notStarted',
      styleProfile: 'notStarted',
      distillForOan: 'notStarted',
      qualityGate: 'notStarted',
    },
    resumable: false,
    contextEligible: false,
    updatedAt,
  };
}

function isPublishedStatus(value: unknown): value is ReferencePublishedDeconstructionStatus {
  return value === 'notAnalyzed'
    || value === 'completed'
    || value === 'stale'
    || value === 'qualityFailed'
    || value === 'needsRebuild';
}

function isReadinessReason(value: unknown): value is ReferenceReadinessReason {
  return value === 'ready'
    || value === 'disabled'
    || value === 'notAnalyzed'
    || value === 'stale'
    || value === 'qualityFailed'
    || value === 'needsRebuild'
    || value === 'missingContextSummary';
}

function readinessToOmissionReason(
  reason: ReferenceReadinessReason,
): ReferenceContextOmissionReason {
  return reason === 'ready' ? 'needsRebuild' : reason;
}

function formatReadinessOmissionReason(reason: ReferenceContextOmissionReason): string {
  switch (reason) {
    case 'notAnalyzed': return 'reference has not been analyzed';
    case 'stale': return 'reference analysis is stale';
    case 'qualityFailed': return 'reference analysis failed its quality gate';
    case 'missingContextSummary': return 'missing current context summary';
    case 'invalidContextPath': return 'invalid context summary path';
    case 'needsRebuild': return 'reference bundle needs rebuild';
    case 'tokenBudgetExceeded': return 'token budget exceeded';
    case 'notExplicitlyRequested': return 'not explicitly requested for this turn';
    case 'maxReferenceCountReached': return 'max reference count reached';
    case 'disabled': return 'disabled';
  }
}

function normalizeSelectionBound(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new Error(`${label} must be a safe integer from ${minimum} to ${maximum}.`);
  }
  return normalized;
}

function assertSafeReferenceId(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    || value.includes('..')
  ) {
    throw new Error('Reference id is invalid.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
