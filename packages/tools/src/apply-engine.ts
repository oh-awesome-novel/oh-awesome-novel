import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import { parseFrontmatter, parseSections } from './markdown';
import { yamlAppendDraft, yamlDeleteDraft, yamlGet, yamlSetDraft } from './yaml-engine';

export type SemanticPatch = ObjectPatch | CollectionPatch | NarrativePatch;

export interface ObjectPatch {
  kind: 'object';
  domain: 'character' | 'world' | 'constitution';
  entityId: string;
  file: string;
  operation:
    | 'replaceFile'
    | 'appendBlock'
    | 'replaceBlock'
    | 'appendSection'
    | 'replaceSection'
    | 'frontmatterSet'
    | 'frontmatterDelete';
  selector?: {
    section?: string;
    block?: string;
    path?: string;
  };
  value?: string | number | boolean | object;
  instruction?: string;
}

export interface CollectionPatch {
  kind: 'collection';
  domain: 'state' | 'timeline' | 'foreshadow';
  file: string;
  operation: 'yamlSet' | 'yamlDelete' | 'yamlAppend' | 'yamlMove';
  path: string;
  value?: unknown;
}

export interface NarrativePatch {
  kind: 'narrative';
  domain: 'chapter' | 'summary';
  file: string;
  operation:
    | 'replaceFile'
    | 'replaceScene'
    | 'insertScene'
    | 'appendScene'
    | 'replaceChunk'
    | 'appendSection';
  selector?: {
    scene?: string;
    chunkId?: string;
    section?: string;
  };
  instruction?: string;
  value?: string;
}

export interface ShadowWriteReference {
  targetFile: string;
  shadowFile: string;
  originalHash: string;
  draftHash: string;
  targetExisted: boolean;
}

export interface ApplyPreviewCandidate {
  targetFile: string;
  original: string;
  draft: string;
  originalHash: string;
  draftHash: string;
  targetExisted: boolean;
  shadowWrite: ShadowWriteReference;
}

export interface ApplyPreviewResult {
  id: string;
  patches: SemanticPatch[];
  touchedFiles: string[];
  diff: string;
  candidates: ApplyPreviewCandidate[];
  shadowWrites: ShadowWriteReference[];
}

export interface PreviewSemanticPatchesInput {
  workspaceRoot: string;
  patches: SemanticPatch[];
  id?: string;
}

export async function previewSemanticPatches(
  input: PreviewSemanticPatchesInput,
): Promise<ApplyPreviewResult> {
  if (!Array.isArray(input.patches) || input.patches.length === 0) {
    throw new Error('At least one SemanticPatch is required.');
  }

  const workspaceRealpath = await realpath(input.workspaceRoot);
  const id = safeActionId(input.id ?? `ap_${randomUUID()}`);
  const drafts = new Map<string, {
    original: string;
    draft: string;
    targetExisted: boolean;
  }>();

  for (const patch of input.patches) {
    validateSemanticPatch(patch);
    const targetFile = resolvePatchTargetFile(patch);
    const targetPath = await resolvePatchTarget(workspaceRealpath, targetFile);
    const pendingDraft = drafts.get(targetFile);
    const snapshot = pendingDraft
      ? undefined
      : await readFileSnapshot(targetPath.absolutePath);
    const original = pendingDraft?.draft ?? snapshot?.content ?? '';
    const draft = await applyPatchToContent({
      workspaceRoot: workspaceRealpath,
      patch,
      targetPath: targetPath.absolutePath,
      original,
    });
    drafts.set(targetFile, {
      original: pendingDraft?.original ?? original,
      draft,
      targetExisted: pendingDraft?.targetExisted ?? snapshot?.exists ?? false,
    });
  }

  const candidates = await Promise.all(
    [...drafts.entries()].map(async ([targetFile, candidate]) => {
      const originalHash = hashContent(candidate.original);
      const draftHash = hashContent(candidate.draft);
      const metadata = {
        originalHash,
        draftHash,
        targetExisted: candidate.targetExisted,
      };

      return {
        targetFile,
        original: candidate.original,
        draft: candidate.draft,
        ...metadata,
        shadowWrite: await writeShadowFile(
          workspaceRealpath,
          id,
          targetFile,
          candidate.draft,
          metadata,
        ),
      };
    }),
  );

  const diffs = candidates
    .map((candidate) => createUnifiedDiff(
      candidate.targetFile,
      candidate.original,
      candidate.draft,
      candidate.targetExisted,
    ))
    .filter(Boolean);

  return {
    id,
    patches: input.patches,
    touchedFiles: candidates.map((candidate) => candidate.targetFile),
    diff: diffs.join(''),
    candidates,
    shadowWrites: candidates.map((candidate) => candidate.shadowWrite),
  };
}

export function validateSemanticPatch(patch: SemanticPatch): void {
  if (!isRecord(patch)) {
    throw new Error('SemanticPatch must be an object.');
  }

  switch (patch.kind) {
    case 'object':
      validateObjectPatch(patch);
      break;
    case 'collection':
      validateCollectionPatch(patch);
      break;
    case 'narrative':
      validateNarrativePatch(patch);
      break;
    default:
      throw new Error(`Unsupported SemanticPatch kind: ${String(patch.kind)}`);
  }

  safeRelativePath(resolvePatchTargetFile(patch));
}

export function resolvePatchTargetFile(patch: SemanticPatch): string {
  switch (patch.kind) {
    case 'object':
      return resolveObjectPatchTarget(patch);
    case 'collection':
      return safeRelativePath(join(patch.domain, safeRelativePath(patch.file)));
    case 'narrative':
      return resolveNarrativePatchTarget(patch);
    default:
      throw new Error('Unsupported SemanticPatch kind.');
  }
}

function validateObjectPatch(patch: ObjectPatch): void {
  if (!['character', 'world', 'constitution'].includes(patch.domain)) {
    throw new Error(`Unsupported ObjectPatch domain: ${String(patch.domain)}`);
  }
  safeSegment(requireString(patch.entityId, 'ObjectPatch entityId is required.'));
  safeRelativePath(requireString(patch.file, 'ObjectPatch file is required.'));

  switch (patch.operation) {
    case 'replaceFile':
    case 'appendBlock':
      requireObjectPatchValue(patch.value, `ObjectPatch ${patch.operation} value is required.`);
      return;
    case 'replaceBlock':
      requireSelector(patch.selector?.block, 'ObjectPatch selector.block is required.');
      requireObjectPatchValue(patch.value, 'ObjectPatch replaceBlock value is required.');
      return;
    case 'appendSection':
    case 'replaceSection':
      requireSelector(patch.selector?.section, 'ObjectPatch selector.section is required.');
      requireObjectPatchValue(patch.value, `ObjectPatch ${patch.operation} value is required.`);
      return;
    case 'frontmatterSet':
      validateDottedPath(
        requireSelector(patch.selector?.path, 'ObjectPatch selector.path is required.'),
        'Frontmatter path',
      );
      requireObjectPatchValue(patch.value, 'ObjectPatch frontmatterSet value is required.');
      return;
    case 'frontmatterDelete':
      validateDottedPath(
        requireSelector(patch.selector?.path, 'ObjectPatch selector.path is required.'),
        'Frontmatter path',
      );
      return;
    default:
      throw new Error(`Unsupported ObjectPatch operation: ${String(patch.operation)}`);
  }
}

function validateCollectionPatch(patch: CollectionPatch): void {
  if (!['state', 'timeline', 'foreshadow'].includes(patch.domain)) {
    throw new Error(`Unsupported CollectionPatch domain: ${String(patch.domain)}`);
  }
  safeRelativePath(requireString(patch.file, 'CollectionPatch file is required.'));
  validateDottedPath(requireString(patch.path, 'CollectionPatch path is required.'), 'YAML path');

  switch (patch.operation) {
    case 'yamlSet':
    case 'yamlAppend':
      requirePatchValue(patch.value, `CollectionPatch ${patch.operation} value is required.`);
      return;
    case 'yamlDelete':
      return;
    case 'yamlMove':
      if (!isRecord(patch.value) || typeof patch.value.to !== 'string') {
        throw new Error('CollectionPatch yamlMove value must include a string "to" path.');
      }
      validateDottedPath(patch.value.to, 'CollectionPatch yamlMove destination');
      return;
    default:
      throw new Error(`Unsupported CollectionPatch operation: ${String(patch.operation)}`);
  }
}

function validateNarrativePatch(patch: NarrativePatch): void {
  if (!['chapter', 'summary'].includes(patch.domain)) {
    throw new Error(`Unsupported NarrativePatch domain: ${String(patch.domain)}`);
  }
  safeRelativePath(requireString(patch.file, 'NarrativePatch file is required.'));

  switch (patch.operation) {
    case 'replaceFile':
    case 'appendScene':
      requireNarrativeValue(patch.value, `NarrativePatch ${patch.operation} value is required.`);
      return;
    case 'replaceScene':
    case 'insertScene':
      requireSelector(patch.selector?.scene, 'NarrativePatch selector.scene is required.');
      requireNarrativeValue(patch.value, `NarrativePatch ${patch.operation} value is required.`);
      return;
    case 'replaceChunk':
      requireSelector(patch.selector?.chunkId, 'NarrativePatch selector.chunkId is required.');
      requireNarrativeValue(patch.value, 'NarrativePatch replaceChunk value is required.');
      return;
    case 'appendSection':
      requireSelector(patch.selector?.section, 'NarrativePatch selector.section is required.');
      requireNarrativeValue(patch.value, 'NarrativePatch appendSection value is required.');
      return;
    default:
      throw new Error(`Unsupported NarrativePatch operation: ${String(patch.operation)}`);
  }
}

async function applyPatchToContent(input: {
  workspaceRoot: string;
  patch: SemanticPatch;
  targetPath: string;
  original: string;
}): Promise<string> {
  switch (input.patch.kind) {
    case 'object':
      return applyObjectPatch(input.patch, input.original);
    case 'collection':
      return applyCollectionPatch(input.workspaceRoot, input.patch, input.original);
    case 'narrative':
      return applyNarrativePatch(input.patch, input.original);
  }
}

async function applyObjectPatch(
  patch: ObjectPatch,
  original: string,
): Promise<string> {
  const value = stringifyPatchValue(patch.value);

  switch (patch.operation) {
    case 'replaceFile':
      return normalizeMarkdownFile(value);
    case 'replaceSection':
      assertSelector(patch.selector?.section, 'ObjectPatch selector.section is required.');
      return replaceMarkdownSectionContent(original, patch.selector.section, value);
    case 'appendSection':
      assertSelector(patch.selector?.section, 'ObjectPatch selector.section is required.');
      return appendOrCreateMarkdownSection(original, patch.selector.section, value);
    case 'appendBlock':
      return appendBlock(original, value);
    case 'replaceBlock':
      assertSelector(patch.selector?.block, 'ObjectPatch selector.block is required.');
      return replaceDelimitedBlock(original, patch.selector.block, value);
    case 'frontmatterSet':
      assertSelector(patch.selector?.path, 'ObjectPatch selector.path is required.');
      return setFrontmatterValue(original, patch.selector.path, patch.value);
    case 'frontmatterDelete':
      assertSelector(patch.selector?.path, 'ObjectPatch selector.path is required.');
      return deleteFrontmatterValue(original, patch.selector.path);
  }
}

async function applyCollectionPatch(
  workspaceRealpath: string,
  patch: CollectionPatch,
  original: string,
): Promise<string> {
  const tempPath = await writeInternalTempFile(workspaceRealpath, original);
  try {
    switch (patch.operation) {
      case 'yamlSet':
        return (await yamlSetDraft(tempPath, patch.path, patch.value)).draft;
      case 'yamlDelete':
        return (await yamlDeleteDraft(tempPath, patch.path)).draft;
      case 'yamlAppend':
        return (await yamlAppendDraft(tempPath, patch.path, patch.value)).draft;
      case 'yamlMove': {
        if (!isRecord(patch.value) || typeof patch.value.to !== 'string') {
          throw new Error('CollectionPatch yamlMove value must include a string "to" path.');
        }
        const moving = await yamlGet(tempPath, patch.path);
        const afterDelete = await yamlDeleteDraft(tempPath, patch.path);
        await writeFile(tempPath, afterDelete.draft, 'utf-8');
        return (await yamlSetDraft(tempPath, patch.value.to, moving)).draft;
      }
    }
  } finally {
    await rm(tempPath, { force: true });
  }
}

function applyNarrativePatch(patch: NarrativePatch, original: string): string {
  const value = normalizeMarkdownFile(patch.value ?? '');

  switch (patch.operation) {
    case 'replaceFile':
      return value;
    case 'replaceScene':
      assertSelector(patch.selector?.scene, 'NarrativePatch selector.scene is required.');
      return replaceMarkdownSectionContent(original, patch.selector.scene, value);
    case 'insertScene':
      assertSelector(patch.selector?.scene, 'NarrativePatch selector.scene is required.');
      return insertMarkdownSectionBefore(original, patch.selector.scene, value);
    case 'appendScene':
      return appendBlock(original, value);
    case 'replaceChunk':
      assertSelector(patch.selector?.chunkId, 'NarrativePatch selector.chunkId is required.');
      return replaceChunk(original, patch.selector.chunkId, value);
    case 'appendSection':
      assertSelector(patch.selector?.section, 'NarrativePatch selector.section is required.');
      return appendMarkdownSection(original, patch.selector.section, value);
  }
}

function resolveObjectPatchTarget(patch: ObjectPatch): string {
  const file = safeRelativePath(patch.file);

  if (patch.domain === 'character') {
    return safeRelativePath(join('characters', safeSegment(patch.entityId), file));
  }

  if (patch.domain === 'world') {
    return safeRelativePath(join('world', safeSegment(patch.entityId), file));
  }

  return safeRelativePath(join('.oan', 'constitution', file));
}

function resolveNarrativePatchTarget(patch: NarrativePatch): string {
  const file = safeRelativePath(patch.file);

  if (patch.domain === 'chapter') {
    return file.startsWith(`chapters${sep}`) ? file : safeRelativePath(join('chapters', file));
  }

  return file.startsWith(`summaries${sep}`) ? file : safeRelativePath(join('summaries', file));
}

async function resolvePatchTarget(
  workspaceRealpath: string,
  targetFile: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = safeRelativePath(targetFile);
  const absolutePath = resolve(workspaceRealpath, relativePath);
  assertPathInside(workspaceRealpath, absolutePath, 'Path resolves outside the active workspace.');
  await assertTargetDoesNotEscape(workspaceRealpath, absolutePath);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(absolutePath));
  return { absolutePath, relativePath };
}

async function writeShadowFile(
  workspaceRealpath: string,
  actionId: string,
  targetFile: string,
  content: string,
  metadata: Pick<
    ShadowWriteReference,
    'originalHash' | 'draftHash' | 'targetExisted'
  >,
): Promise<ShadowWriteReference> {
  const shadowFile = join(
    '.workspace',
    'shadow-writes',
    safeActionId(actionId),
    `${hashContent(targetFile)}.shadow`,
  );
  const absoluteShadowFile = resolveInternalWorkspacePath(workspaceRealpath, shadowFile);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(absoluteShadowFile));
  await mkdir(dirname(absoluteShadowFile), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(absoluteShadowFile));
  await writeFile(absoluteShadowFile, content, 'utf-8');
  return { targetFile, shadowFile, ...metadata };
}

async function writeInternalTempFile(workspaceRealpath: string, content: string): Promise<string> {
  const tempFile = join('.workspace', 'apply-engine-temp', `${randomUUID()}.yaml`);
  const absoluteTempFile = resolveInternalWorkspacePath(workspaceRealpath, tempFile);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(absoluteTempFile));
  await mkdir(dirname(absoluteTempFile), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(absoluteTempFile));
  await writeFile(absoluteTempFile, content, 'utf-8');
  return absoluteTempFile;
}

function replaceMarkdownSectionContent(markdown: string, sectionTitle: string, content: string): string {
  const section = parseSections(markdown).find((candidate) => candidate.title === sectionTitle);
  if (!section) {
    throw new Error(`Markdown section "${sectionTitle}" does not exist.`);
  }
  return `${markdown.slice(0, section.contentStartOffset)}\n${normalizeSectionContent(content)}${markdown.slice(section.endOffset)}`;
}

function insertMarkdownSectionBefore(markdown: string, sectionTitle: string, content: string): string {
  const section = parseSections(markdown).find((candidate) => candidate.title === sectionTitle);
  if (!section) {
    throw new Error(`Markdown section "${sectionTitle}" does not exist.`);
  }
  return `${markdown.slice(0, section.startOffset)}${normalizeMarkdownFile(content)}\n${markdown.slice(section.startOffset)}`;
}

function appendMarkdownSection(markdown: string, sectionTitle: string, content: string): string {
  const separator = markdown.endsWith('\n') ? '\n' : '\n\n';
  return `${markdown}${separator}# ${sectionTitle}\n\n${normalizeSectionContent(content)}`;
}

function appendOrCreateMarkdownSection(markdown: string, sectionTitle: string, content: string): string {
  const section = parseSections(markdown).find((candidate) => candidate.title === sectionTitle);

  if (!section) {
    return appendMarkdownSection(markdown, sectionTitle, content);
  }

  const existing = markdown.slice(section.contentStartOffset, section.endOffset);
  const separator = existing.endsWith('\n\n') || existing.trim().length === 0 ? '' : '\n';
  return `${markdown.slice(0, section.endOffset)}${separator}${normalizeSectionContent(content)}${markdown.slice(section.endOffset)}`;
}

function replaceChunk(markdown: string, chunkId: string, content: string): string {
  const escaped = escapeRegExp(chunkId);
  const pattern = new RegExp(`(<!--\\s*chunk:${escaped}\\s*-->)\\n?[\\s\\S]*?(?=<!--\\s*/chunk:${escaped}\\s*-->)`);
  if (!pattern.test(markdown)) {
    throw new Error(`Markdown chunk "${chunkId}" does not exist.`);
  }
  return markdown.replace(pattern, `$1\n${normalizeSectionContent(content)}`);
}

function replaceDelimitedBlock(markdown: string, blockId: string, content: string): string {
  const escaped = escapeRegExp(blockId);
  const pattern = new RegExp(`(<!--\\s*block:${escaped}\\s*-->)\\n?[\\s\\S]*?(?=<!--\\s*/block:${escaped}\\s*-->)`);
  if (!pattern.test(markdown)) {
    throw new Error(`Markdown block "${blockId}" does not exist.`);
  }
  return markdown.replace(pattern, `$1\n${normalizeSectionContent(content)}`);
}

function appendBlock(markdown: string, content: string): string {
  const separator = markdown.endsWith('\n') ? '\n' : '\n\n';
  return `${markdown}${separator}${normalizeMarkdownFile(content)}`;
}

function setFrontmatterValue(markdown: string, path: string, value: unknown): string {
  const parsed = parseFrontmatter(markdown);
  const frontmatter = { ...(parsed.frontmatter ?? {}) };
  setByDottedPath(frontmatter, path, value);
  return withFrontmatter(frontmatter, parsed.body);
}

function deleteFrontmatterValue(markdown: string, path: string): string {
  const parsed = parseFrontmatter(markdown);
  const frontmatter = { ...(parsed.frontmatter ?? {}) };
  deleteByDottedPath(frontmatter, path);
  return withFrontmatter(frontmatter, parsed.body);
}

function withFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

function setByDottedPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = validateDottedPath(path, 'Frontmatter path');
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(cursor, part) || !isRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1) as string] = value;
}

function deleteByDottedPath(target: Record<string, unknown>, path: string): void {
  const parts = validateDottedPath(path, 'Frontmatter path');
  let cursor: unknown = target;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(cursor) || !Object.hasOwn(cursor, part)) return;
    cursor = cursor[part];
  }
  if (isRecord(cursor)) delete cursor[parts.at(-1) as string];
}

async function assertRealParentInsideWorkspace(workspaceRealpath: string, parentPath: string): Promise<void> {
  const parentRealpath = await realpath(parentPath);
  assertPathInside(workspaceRealpath, parentRealpath, 'Parent directory resolves outside the active workspace.');
}

async function assertExistingAncestorsInsideWorkspace(workspaceRealpath: string, parentPath: string): Promise<void> {
  const relativeParent = relative(workspaceRealpath, parentPath);
  const parts = relativeParent.split(sep).filter(Boolean);
  let cursor = workspaceRealpath;

  for (const part of parts) {
    cursor = join(cursor, part);
    try {
      const stat = await lstat(cursor);
      const realAncestor = stat.isSymbolicLink() ? await realpath(cursor) : cursor;
      assertPathInside(workspaceRealpath, realAncestor, 'Parent directory resolves outside the active workspace.');
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
  }
}

async function assertTargetDoesNotEscape(workspaceRealpath: string, targetPath: string): Promise<void> {
  try {
    const stat = await lstat(targetPath);
    const targetRealpath = stat.isSymbolicLink() ? await realpath(targetPath) : targetPath;
    assertPathInside(workspaceRealpath, targetRealpath, 'Target path resolves outside the active workspace.');
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

function safeRelativePath(value: string): string {
  const normalized = normalize(value);
  if (!normalized.trim()) throw new Error('Path is required.');
  if (/[\0\r\n\t]/.test(normalized)) {
    throw new Error(`Invalid workspace relative path: ${value}`);
  }
  if (
    isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith(`..${sep}`) ||
    normalized.split(sep).some((segment) => segment === '..' || segment.startsWith('.'))
  ) {
    throw new Error(`Invalid workspace relative path: ${value}`);
  }
  return normalized;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid path segment: ${value}`);
  }
  return value;
}

function safeActionId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ApplyPreview id: ${value}`);
  }
  return value;
}

function resolveInternalWorkspacePath(workspaceRealpath: string, path: string): string {
  const normalized = normalize(path);
  if (normalized.startsWith('..') || isAbsolute(normalized) || !normalized.startsWith(`.workspace${sep}`)) {
    throw new Error(`Invalid internal workspace path: ${path}`);
  }
  const absolutePath = resolve(workspaceRealpath, normalized);
  assertPathInside(workspaceRealpath, absolutePath, 'Internal workspace path escaped workspace.');
  return absolutePath;
}

function assertPathInside(workspaceRealpath: string, path: string, message: string): void {
  const normalizedWorkspace = workspaceRealpath.endsWith(sep) ? workspaceRealpath : `${workspaceRealpath}${sep}`;
  if (path !== workspaceRealpath && !path.startsWith(normalizedWorkspace)) {
    throw new Error(message);
  }
}

function createUnifiedDiff(
  file: string,
  original: string,
  draft: string,
  targetExisted: boolean,
): string {
  if (targetExisted && original === draft) return '';

  const header = [`diff --git a/${file} b/${file}`];
  if (!targetExisted) header.push('new file mode 100644');

  if (original === draft) {
    return `${header.join('\n')}\n`;
  }

  header.push(targetExisted ? `--- a/${file}\t` : '--- /dev/null');
  header.push(`+++ b/${file}\t`);

  const originalLines = splitDiffLines(original);
  const draftLines = splitDiffLines(draft);
  let commonPrefix = 0;
  while (
    commonPrefix < originalLines.length &&
    commonPrefix < draftLines.length &&
    equalDiffLine(originalLines[commonPrefix], draftLines[commonPrefix])
  ) {
    commonPrefix += 1;
  }

  let commonSuffix = 0;
  while (
    commonSuffix < originalLines.length - commonPrefix &&
    commonSuffix < draftLines.length - commonPrefix &&
    equalDiffLine(
      originalLines[originalLines.length - commonSuffix - 1],
      draftLines[draftLines.length - commonSuffix - 1],
    )
  ) {
    commonSuffix += 1;
  }

  const leadingContext = Math.min(3, commonPrefix);
  const trailingContext = Math.min(3, commonSuffix);
  const originalStartIndex = commonPrefix - leadingContext;
  const draftStartIndex = commonPrefix - leadingContext;
  const originalEndIndex = originalLines.length - commonSuffix + trailingContext;
  const draftEndIndex = draftLines.length - commonSuffix + trailingContext;
  const originalCount = originalEndIndex - originalStartIndex;
  const draftCount = draftEndIndex - draftStartIndex;
  const originalStart = originalCount === 0 ? originalStartIndex : originalStartIndex + 1;
  const draftStart = draftCount === 0 ? draftStartIndex : draftStartIndex + 1;
  const hunk = [
    `@@ -${originalStart},${originalCount} +${draftStart},${draftCount} @@`,
  ];

  appendDiffLines(hunk, ' ', originalLines.slice(originalStartIndex, commonPrefix));
  appendDiffLines(
    hunk,
    '-',
    originalLines.slice(commonPrefix, originalLines.length - commonSuffix),
  );
  appendDiffLines(
    hunk,
    '+',
    draftLines.slice(commonPrefix, draftLines.length - commonSuffix),
  );
  appendDiffLines(
    hunk,
    ' ',
    originalLines.slice(originalLines.length - commonSuffix, originalEndIndex),
  );

  return `${[...header, ...hunk].join('\n')}\n`;
}

interface DiffLine {
  text: string;
  terminated: boolean;
}

function splitDiffLines(content: string): DiffLine[] {
  if (content === '') return [];
  const parts = content.split('\n');
  const hasFinalNewline = parts.at(-1) === '';
  if (hasFinalNewline) parts.pop();
  return parts.map((text, index) => ({
    text,
    terminated: index < parts.length - 1 || hasFinalNewline,
  }));
}

function equalDiffLine(left: DiffLine, right: DiffLine): boolean {
  return left.text === right.text && left.terminated === right.terminated;
}

function appendDiffLines(output: string[], prefix: ' ' | '-' | '+', lines: DiffLine[]): void {
  for (const line of lines) {
    output.push(`${prefix}${line.text}`);
    if (!line.terminated) output.push('\\ No newline at end of file');
  }
}

async function readFileSnapshot(filePath: string): Promise<{
  content: string;
  exists: boolean;
}> {
  try {
    return { content: await readFile(filePath, 'utf-8'), exists: true };
  } catch (error) {
    if (isNotFoundError(error)) return { content: '', exists: false };
    throw error;
  }
}

function normalizeMarkdownFile(content: string): string {
  const trimmed = content.trim();
  return trimmed.length ? `${trimmed}\n` : '';
}

function normalizeSectionContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length === 0 ? '\n' : `${trimmed}\n`;
}

function stringifyPatchValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return stringifyYaml(value).trimEnd();
  return String(value);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value;
}

function requirePatchValue(value: unknown, message: string): void {
  if (value === undefined) throw new Error(message);
}

function requireObjectPatchValue(value: unknown, message: string): void {
  if (
    value === null ||
    !['string', 'number', 'boolean', 'object'].includes(typeof value)
  ) {
    throw new Error(message);
  }
}

function requireNarrativeValue(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(message);
}

function requireSelector(value: string | undefined, message: string): string {
  assertSelector(value, message);
  return value;
}

const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function validateDottedPath(path: string, label: string): string[] {
  if (!path.trim()) throw new Error(`${label} is required.`);
  const parts = path.split('.');
  if (parts.some((part) => !part.trim())) {
    throw new Error(`${label} contains an empty segment.`);
  }
  const dangerous = parts.find((part) => DANGEROUS_PATH_SEGMENTS.has(part));
  if (dangerous) {
    throw new Error(`${label} contains forbidden segment "${dangerous}".`);
  }
  return parts;
}

function assertSelector(value: string | undefined, message: string): asserts value is string {
  if (!value?.trim()) throw new Error(message);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}
