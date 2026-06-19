import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

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

export type ReferenceProgressStage =
  | 'importSource'
  | 'detectStructure'
  | 'quickPreview'
  | 'distillForOan';

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
  originalFile: string;
  originalFileName: string;
  sourcePath?: string;
  checksumSha256: string;
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

export interface ReferenceProgress {
  currentStage: ReferenceProgressStage;
  completedStages: ReferenceProgressStage[];
  failedStages: Array<{
    stage: ReferenceProgressStage;
    message: string;
    failedAt: string;
  }>;
  resumable: boolean;
  updatedAt: string;
}

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
  progress: ReferenceProgress;
}

export interface ReferenceImportResult {
  reference: ReferenceWorkSummary;
  manifest: ReferenceSourceManifest;
  createdFiles: string[];
}

export interface ReferenceContextSelectionInput {
  workspaceRoot: string;
  tokenBudget?: number;
  maxReferences?: number;
}

export interface ReferenceContextSelection {
  tokenBudget: number;
  included: Array<{
    id: string;
    title: string;
    path: string;
    reason: string;
    estimatedTokens: number;
    content: string;
  }>;
  omitted: Array<{
    id: string;
    title: string;
    reason: string;
  }>;
}

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
  const referenceId = await createUniqueReferenceId(workspaceRoot, title, checksumSha256);
  const bundlePath = join(workspaceRoot, 'examples', 'references', referenceId);
  const originalExtension = sanitizeExtension(extname(source.originalFileName)) || '.txt';
  const originalFile = `original${originalExtension}`;
  const originalRelativePath = `examples/references/${referenceId}/sources/${originalFile}`;
  const detectedStructure = detectReferenceStructure(source.content);
  const manifest: ReferenceSourceManifest = {
    originalFile,
    originalFileName: source.originalFileName,
    sourcePath: source.sourcePath,
    checksumSha256,
    importedAt,
    byteLength: Buffer.byteLength(source.content, 'utf-8'),
    charLength: source.content.length,
    lineCount: source.content.split(/\r?\n/u).length,
    detectedStructure,
  };
  const metadata: ReferenceMetadata = {
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
  };
  const progress: ReferenceProgress = {
    currentStage: 'distillForOan',
    completedStages: ['importSource', 'detectStructure', 'quickPreview', 'distillForOan'],
    failedStages: [],
    resumable: true,
    updatedAt: importedAt,
  };
  const createdFiles: string[] = [];

  await mkdir(join(bundlePath, 'sources'), { recursive: true });
  await mkdir(join(bundlePath, 'deconstruction', 'chapters'), { recursive: true });
  await mkdir(join(bundlePath, 'distilled'), { recursive: true });
  await mkdir(join(bundlePath, 'context'), { recursive: true });

  await writeReferenceFile(
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
  await writeInitialDeconstructionFiles(workspaceRoot, metadata, manifest, createdFiles);
  await writeInitialDistilledFiles(workspaceRoot, metadata, manifest, createdFiles);
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

  const reference = createReferenceSummary(metadata, manifest, progress);
  await upsertReferencesIndex(workspaceRoot, reference);

  return {
    reference,
    manifest,
    createdFiles,
  };
}

export async function listReferenceWorks(workspaceRoot: string): Promise<ReferenceWorkSummary[]> {
  return (await readReferencesIndex(resolve(workspaceRoot))).references;
}

export async function setReferenceEnabled(
  workspaceRoot: string,
  id: string,
  enabled: boolean,
): Promise<ReferenceWorkSummary> {
  const root = resolve(workspaceRoot);
  const index = await readReferencesIndex(root);
  const reference = index.references.find((item) => item.id === id);

  if (!reference) {
    throw new Error(`Reference not found: ${id}`);
  }

  reference.enabled = enabled;
  await writeReferencesIndex(root, index);

  const metadataPath = join(root, reference.bundlePath, 'metadata.yaml');
  const metadata = parse(await readFile(metadataPath, 'utf-8')) as ReferenceMetadata;
  metadata.enabled = enabled;
  await writeFile(metadataPath, stringify(metadata), 'utf-8');

  return reference;
}

export async function selectReferenceContext(
  input: ReferenceContextSelectionInput,
): Promise<ReferenceContextSelection> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const tokenBudget = input.tokenBudget ?? 1_500;
  const maxReferences = input.maxReferences ?? 3;
  const references = await listReferenceWorks(workspaceRoot);
  const included: ReferenceContextSelection['included'] = [];
  const omitted: ReferenceContextSelection['omitted'] = [];
  let usedTokens = 0;

  for (const reference of references) {
    if (!reference.enabled) {
      omitted.push({ id: reference.id, title: reference.title, reason: 'disabled' });
      continue;
    }

    if (included.length >= maxReferences) {
      omitted.push({ id: reference.id, title: reference.title, reason: 'max reference count reached' });
      continue;
    }

    const summaryPath = join(workspaceRoot, reference.summaryPath);
    let content = '';
    try {
      content = await readFile(summaryPath, 'utf-8');
    } catch {
      omitted.push({ id: reference.id, title: reference.title, reason: 'missing context summary' });
      continue;
    }

    const estimatedTokens = estimateTokens(content);
    if (usedTokens + estimatedTokens > tokenBudget && included.length > 0) {
      omitted.push({ id: reference.id, title: reference.title, reason: 'token budget exceeded' });
      continue;
    }

    included.push({
      id: reference.id,
      title: reference.title,
      path: reference.summaryPath,
      reason: 'enabled reference summary selected; original source not read',
      estimatedTokens,
      content,
    });
    usedTokens += estimatedTokens;
  }

  return {
    tokenBudget,
    included,
    omitted,
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

async function writeInitialDeconstructionFiles(
  workspaceRoot: string,
  metadata: ReferenceMetadata,
  manifest: ReferenceSourceManifest,
  createdFiles: string[],
): Promise<void> {
  const prefix = `examples/references/${metadata.id}/deconstruction`;
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/quick-preview.md`,
    formatQuickPreview(metadata, manifest),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/plotlines.md`,
    formatPendingAnalysis('Plotlines', metadata),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/characters.md`,
    formatPendingAnalysis('Characters', metadata),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/relationships.md`,
    formatPendingAnalysis('Relationships', metadata),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/worldbuilding.md`,
    formatPendingAnalysis('Worldbuilding', metadata),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/timeline.md`,
    formatPendingAnalysis('Timeline', metadata),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/tropes.md`,
    formatPendingAnalysis('Tropes', metadata),
    createdFiles,
  );
  await writeReferenceFile(
    workspaceRoot,
    `${prefix}/style-profile.md`,
    formatPendingAnalysis('Style Profile', metadata),
    createdFiles,
  );

  for (const chapter of manifest.detectedStructure.chapters.slice(0, 12)) {
    await writeReferenceFile(
      workspaceRoot,
      `${prefix}/chapters/${chapter.id}-summary.md`,
      formatChapterStub(metadata, chapter),
      createdFiles,
    );
  }
}

async function writeInitialDistilledFiles(
  workspaceRoot: string,
  metadata: ReferenceMetadata,
  manifest: ReferenceSourceManifest,
  createdFiles: string[],
): Promise<void> {
  const prefix = `examples/references/${metadata.id}/distilled`;
  const files: Record<string, string> = {
    'writing-style.md': formatDistilledStub('Writing Style', metadata, manifest),
    'pacing.md': formatDistilledStub('Pacing', metadata, manifest),
    'hooks.md': formatDistilledStub('Hooks', metadata, manifest),
    'scene-techniques.md': formatDistilledStub('Scene Techniques', metadata, manifest),
    'character-techniques.md': formatDistilledStub('Character Techniques', metadata, manifest),
    'do-not-copy.md': formatDoNotCopy(metadata),
  };

  for (const [fileName, content] of Object.entries(files)) {
    await writeReferenceFile(workspaceRoot, `${prefix}/${fileName}`, content, createdFiles);
  }
}

function createReferenceContextIndex(referenceId: string): Record<string, unknown> {
  return {
    version: 1,
    referenceId,
    defaultContext: [
      'context/reference-summary.md',
      'distilled/writing-style.md',
      'distilled/pacing.md',
      'distilled/hooks.md',
      'distilled/scene-techniques.md',
      'distilled/character-techniques.md',
      'distilled/do-not-copy.md',
    ],
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
    distilledPaths: DISTILLED_FILES.map((file) => `examples/references/${metadata.id}/distilled/${file}`),
    chapterCount: manifest.detectedStructure.chapterCount,
    progress,
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
    const parsed = parse(await readFile(filePath, 'utf-8')) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.references)) {
      return { version: 1, references: [] };
    }

    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      references: parsed.references as ReferenceWorkSummary[],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, references: [] };
    }

    throw error;
  }
}

async function writeReferencesIndex(
  workspaceRoot: string,
  index: ReferencesIndex,
): Promise<void> {
  await mkdir(join(workspaceRoot, 'examples'), { recursive: true });
  await writeFile(
    join(workspaceRoot, 'examples', 'references.yaml'),
    stringify(index),
    'utf-8',
  );
}

async function writeExamplesReadme(workspaceRoot: string, createdFiles: string[]): Promise<void> {
  const relativePath = 'examples/README.md';
  const absolutePath = resolveWorkspaceOutputPath(workspaceRoot, relativePath);

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

Default writing context should use each reference bundle's \`context/reference-summary.md\`
and \`distilled/*\` files. Original source files under \`sources/\` are retained for
review, checksum verification, and explicit re-deconstruction only.
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
  await writeFile(absolutePath, ensureTrailingNewline(content), 'utf-8');
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
  title: string,
  checksumSha256: string,
): Promise<string> {
  const base = `${slugify(title)}-${checksumSha256.slice(0, 8)}`;
  const index = await readReferencesIndex(workspaceRoot);

  if (!index.references.some((item) => item.id === base)) {
    return base;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!index.references.some((item) => item.id === candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to create a unique reference id for: ${title}`);
}

function formatReferenceSummary(
  metadata: ReferenceMetadata,
  manifest: ReferenceSourceManifest,
): string {
  return `# ${metadata.title} Reference Summary

Source type: ${metadata.sourceType}
Rights: ${metadata.rights}
Allowed usage: ${metadata.allowedUsage.join(', ')}
Enabled: ${metadata.enabled ? 'yes' : 'no'}
Checksum: ${manifest.checksumSha256}

## Context Boundary

- Default writing context may read this summary and \`distilled/*\`.
- Original source is retained at \`sources/${manifest.originalFile}\` but is not read by default.
- This reference is for transformed technique analysis only; do not copy text, scenes, or recognizable expression.
- Any adoption into OAN truth files must be proposed through PendingAction review.

## Imported Structure

- Chapters detected: ${manifest.detectedStructure.chapterCount}
- Detection confidence: ${manifest.detectedStructure.confidence}
- Source length: ${manifest.charLength} chars, ${manifest.lineCount} lines

## Initial Use Guidance

This bundle has completed deterministic import and quick preview. Deep deconstruction files are placeholders until the author runs a reference deconstruction pass.
Use it only as light technique context for style, pacing, hooks, scene construction, and character technique.
`;
}

function formatQuickPreview(
  metadata: ReferenceMetadata,
  manifest: ReferenceSourceManifest,
): string {
  const chapters = manifest.detectedStructure.chapters.slice(0, 6)
    .map((chapter) =>
      `- ${chapter.id}: ${chapter.title} (lines ${chapter.lineStart}-${chapter.lineEnd}, approx ${chapter.wordCount} words)`,
    )
    .join('\n');

  return `# Quick Preview

Reference: ${metadata.title}
Imported at: ${metadata.importedAt}

## Detected Structure

- Chapter count: ${manifest.detectedStructure.chapterCount}
- Confidence: ${manifest.detectedStructure.confidence}
- Original source: \`sources/${manifest.originalFile}\`

${chapters || '- No chapter-like headings detected; treat this as a single source block.'}

## Suitability

- Suitable for: structure, pacing, scene technique, hook handling, and high-level style analysis after deconstruction.
- Not suitable for: direct quotation, close paraphrase, or importing facts into the current novel truth files.

## Next Gate

Run a full deconstruction pass only if this quick preview matches the intended benchmark. Keep the original source out of default prompts.
`;
}

function formatChapterStub(
  metadata: ReferenceMetadata,
  chapter: ReferenceChapterBoundary,
): string {
  return `# ${chapter.id} ${chapter.title}

Reference: ${metadata.title}
Source pointer: lines ${chapter.lineStart}-${chapter.lineEnd}

Status: Pending AI deconstruction.

Expected future content:

- Chapter-level summary in transformed language.
- Key technique observations.
- Hooks opened, delayed, paid, or reframed.
- Character / world / timeline pointers with confidence.
`;
}

function formatPendingAnalysis(title: string, metadata: ReferenceMetadata): string {
  return `# ${title}

Reference: ${metadata.title}

Status: Pending AI deconstruction.

This file should contain transformed analysis only. Do not paste source text here.
`;
}

function formatDistilledStub(
  title: string,
  metadata: ReferenceMetadata,
  manifest: ReferenceSourceManifest,
): string {
  return `# ${title}

Reference: ${metadata.title}
Source checksum: ${manifest.checksumSha256}

Status: Initial import placeholder.

Use this file for distilled, transformed technique notes after deconstruction. It must not contain copied source prose or close paraphrase.
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
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, '-')
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

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
