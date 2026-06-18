import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { promisify } from 'node:util';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

import { replaceSection } from './markdown';
import { yamlAppendDraft, yamlSetDraft } from './yaml-engine';

const execFileAsync = promisify(execFile);

export interface CreateWriteIntentToolsOptions {
  workspaceRoot: string;
}

export interface ShadowWriteReference {
  targetFile: string;
  shadowFile: string;
}

export interface WriteIntentPendingAction {
  id: string;
  title: string;
  description: string;
  patches: SemanticPatch[];
  touchedFiles: string[];
  diff: string;
  createdAt: string;
  status: 'pending';
  shadowWrites: ShadowWriteReference[];
}

export interface StoredWriteIntentAction
  extends Omit<WriteIntentPendingAction, 'status'> {
  status: 'pending' | 'accepted' | 'rejected';
  acceptedAt?: string;
  rejectedAt?: string;
}

export interface AcceptPendingActionInput {
  workspaceRoot: string;
  id: string;
}

export interface RejectPendingActionInput {
  workspaceRoot: string;
  id: string;
}

export interface PendingActionDecision {
  id: string;
  status: 'accepted' | 'rejected';
}

export interface AcceptedPendingAction extends PendingActionDecision {
  status: 'accepted';
  appliedFiles: string[];
  gitDiff: string;
}

export interface RejectedPendingAction extends PendingActionDecision {
  status: 'rejected';
}

export type SemanticPatch = ObjectPatch | CollectionPatch | NarrativePatch;

export interface ObjectPatch {
  kind: 'object';
  domain: 'character';
  entityId: string;
  file: string;
  operation: 'replaceSection';
  selector: {
    section: string;
  };
  value: string;
}

export interface CollectionPatch {
  kind: 'collection';
  domain: 'state' | 'timeline' | 'foreshadow';
  file: string;
  operation: 'yamlSet' | 'yamlAppend';
  path: string;
  value: unknown;
}

export interface NarrativePatch {
  kind: 'narrative';
  domain: 'summary';
  file: string;
  operation: 'replaceFile';
  selector?: {
    chapterId?: string;
  };
  value: string;
}

interface CandidateFile {
  targetFile: string;
  original: string;
  draft: string;
}

export function createWriteIntentTools(
  options: CreateWriteIntentToolsOptions,
): ToolSet {
  return {
    'character.updatePersonality': characterUpdatePersonalityTool(options),
    'state.set': stateSetTool(options),
    'timeline.add': timelineAddTool(options),
    'foreshadow.create': foreshadowCreateTool(options),
    'summary.generateChapter': summaryGenerateChapterTool(options),
  };
}

export async function listPendingActions(input: {
  workspaceRoot: string;
}): Promise<WriteIntentPendingAction[]> {
  const workspaceRealpath = await realpath(input.workspaceRoot);
  const pendingRoot = join(workspaceRealpath, '.workspace', 'pending-actions');

  try {
    const entries = await readdir(pendingRoot, { withFileTypes: true });
    const actions = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => readStoredAction(workspaceRealpath, basename(entry.name, '.json'))),
    );

    return actions
      .filter((action): action is WriteIntentPendingAction => action.status === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

export async function acceptPendingAction(
  input: AcceptPendingActionInput,
): Promise<AcceptedPendingAction> {
  const workspaceRealpath = await realpath(input.workspaceRoot);
  const action = await readStoredAction(workspaceRealpath, input.id);

  if (action.status !== 'pending') {
    throw new Error(`PendingAction ${input.id} is already ${action.status}.`);
  }

  for (const write of action.shadowWrites) {
    const target = await resolveWritableTarget(workspaceRealpath, write.targetFile);
    const shadowPath = resolveInternalWorkspacePath(workspaceRealpath, write.shadowFile);
    await assertTargetDoesNotEscape(workspaceRealpath, target.absolutePath);
    await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(target.absolutePath));
    await mkdir(dirname(target.absolutePath), { recursive: true });
    await assertRealParentInsideWorkspace(workspaceRealpath, dirname(target.absolutePath));
    await copyFile(shadowPath, target.absolutePath);
  }

  const acceptedAction: StoredWriteIntentAction = {
    ...action,
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
  };
  await archiveStoredAction(workspaceRealpath, acceptedAction, 'accepted-actions');

  return {
    id: action.id,
    status: 'accepted',
    appliedFiles: action.touchedFiles,
    gitDiff: await gitDiff(workspaceRealpath, action.touchedFiles),
  };
}

export async function rejectPendingAction(
  input: RejectPendingActionInput,
): Promise<RejectedPendingAction> {
  const workspaceRealpath = await realpath(input.workspaceRoot);
  const action = await readStoredAction(workspaceRealpath, input.id);

  if (action.status !== 'pending') {
    throw new Error(`PendingAction ${input.id} is already ${action.status}.`);
  }

  for (const write of action.shadowWrites) {
    const shadowPath = resolveInternalWorkspacePath(workspaceRealpath, write.shadowFile);
    await rm(dirname(shadowPath), { recursive: true, force: true });
  }

  await archiveStoredAction(
    workspaceRealpath,
    {
      ...action,
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
    },
    'rejected-actions',
  );

  return {
    id: action.id,
    status: 'rejected',
  };
}

function characterUpdatePersonalityTool(options: CreateWriteIntentToolsOptions) {
  return tool({
    description:
      'Create a PendingAction to update one section of a character personality Markdown file.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        characterId: { type: 'string' },
        section: { type: 'string' },
        content: { type: 'string' },
        file: { type: 'string' },
      },
      required: ['characterId', 'section', 'content'],
      additionalProperties: false,
    }),
    async execute(args) {
      const characterId = safeSegment(expectStringArg(args, 'characterId'));
      const section = expectStringArg(args, 'section');
      const content = expectStringArg(args, 'content');
      const file = getOptionalStringArg(args, 'file') ?? 'personality.md';
      const targetFile = safeRelativePath(join('characters', characterId, safeRelativePath(file)));
      const absolutePath = await resolveReadableTarget(options.workspaceRoot, targetFile);
      const draft = await replaceSection(absolutePath, section, content);
      const patch: ObjectPatch = {
        kind: 'object',
        domain: 'character',
        entityId: characterId,
        file: targetFile,
        operation: 'replaceSection',
        selector: { section },
        value: content,
      };

      return pendingActionResult(
        await createPendingAction(options.workspaceRoot, {
          title: `Update ${characterId} personality`,
          description: `Replace section "${section}" in ${targetFile}.`,
          patches: [patch],
          candidates: [{
            targetFile,
            original: draft.original,
            draft: draft.draft,
          }],
        }),
      );
    },
  });
}

function stateSetTool(options: CreateWriteIntentToolsOptions) {
  return tool({
    description: 'Create a PendingAction to set one YAML state path.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        file: { type: 'string' },
        path: { type: 'string' },
        value: {},
      },
      required: ['file', 'path', 'value'],
      additionalProperties: false,
    }),
    async execute(args) {
      const file = expectStringArg(args, 'file');
      const path = expectStringArg(args, 'path');
      const value = expectArg(args, 'value');
      const targetFile = safeRelativePath(join('state', safeRelativePath(file)));
      const absolutePath = await resolveReadableTarget(options.workspaceRoot, targetFile);
      const draft = await yamlSetDraft(absolutePath, path, value);
      const patch: CollectionPatch = {
        kind: 'collection',
        domain: 'state',
        file: targetFile,
        operation: 'yamlSet',
        path,
        value,
      };

      return pendingActionResult(
        await createPendingAction(options.workspaceRoot, {
          title: `Set state ${path}`,
          description: `Set ${path} in ${targetFile}.`,
          patches: [patch],
          candidates: [{
            targetFile,
            original: draft.original,
            draft: draft.draft,
          }],
        }),
      );
    },
  });
}

function timelineAddTool(options: CreateWriteIntentToolsOptions) {
  return collectionAppendTool({
    options,
    name: 'timeline.add',
    description: 'Create a PendingAction to append one timeline event.',
    domain: 'timeline',
    defaultFile: 'events.yaml',
    defaultPath: 'events',
    valueArg: 'event',
    title(value) {
      return `Add timeline event ${getRecordId(value) ?? ''}`.trim();
    },
  });
}

function foreshadowCreateTool(options: CreateWriteIntentToolsOptions) {
  return collectionAppendTool({
    options,
    name: 'foreshadow.create',
    description: 'Create a PendingAction to append one active foreshadow item.',
    domain: 'foreshadow',
    defaultFile: 'active.yaml',
    defaultPath: 'active',
    valueArg: 'item',
    title(value) {
      return `Create foreshadow ${getRecordId(value) ?? ''}`.trim();
    },
  });
}

function summaryGenerateChapterTool(options: CreateWriteIntentToolsOptions) {
  return tool({
    description: 'Create a PendingAction to create or replace one chapter summary Markdown file.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        chapterId: { type: 'string' },
        file: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['chapterId', 'content'],
      additionalProperties: false,
    }),
    async execute(args) {
      const chapterId = safeNarrativeChapterId(expectStringArg(args, 'chapterId'));
      const content = normalizeMarkdownFile(expectStringArg(args, 'content'));
      const file = safeChapterSummaryFile(
        getOptionalStringArg(args, 'file') ?? `chapter/${chapterId}.md`,
        chapterId,
      );
      const targetFile = safeRelativePath(join('summaries', safeRelativePath(file)));
      const absolutePath = await resolveWritableReadTarget(options.workspaceRoot, targetFile);
      const original = await readFileIfExists(absolutePath);
      const patch: NarrativePatch = {
        kind: 'narrative',
        domain: 'summary',
        file: targetFile,
        operation: 'replaceFile',
        selector: { chapterId },
        value: content,
      };

      return pendingActionResult(
        await createPendingAction(options.workspaceRoot, {
          title: `Generate chapter ${chapterId} summary`,
          description: `Replace ${targetFile} with generated chapter summary.`,
          patches: [patch],
          candidates: [{
            targetFile,
            original,
            draft: content,
          }],
        }),
      );
    },
  });
}

function collectionAppendTool(input: {
  options: CreateWriteIntentToolsOptions;
  name: string;
  description: string;
  domain: 'timeline' | 'foreshadow';
  defaultFile: string;
  defaultPath: string;
  valueArg: string;
  title(value: unknown): string;
}) {
  return tool({
    description: input.description,
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        file: { type: 'string' },
        path: { type: 'string' },
        [input.valueArg]: {},
      },
      required: [input.valueArg],
      additionalProperties: false,
    }),
    async execute(args) {
      const file = getOptionalStringArg(args, 'file') ?? input.defaultFile;
      const path = getOptionalStringArg(args, 'path') ?? input.defaultPath;
      const value = expectArg(args, input.valueArg);
      const targetFile = safeRelativePath(join(input.domain, safeRelativePath(file)));
      const absolutePath = await resolveReadableTarget(input.options.workspaceRoot, targetFile);
      const draft = await yamlAppendDraft(absolutePath, path, value);
      const patch: CollectionPatch = {
        kind: 'collection',
        domain: input.domain,
        file: targetFile,
        operation: 'yamlAppend',
        path,
        value,
      };

      return pendingActionResult(
        await createPendingAction(input.options.workspaceRoot, {
          title: input.title(value),
          description: `Append to ${path} in ${targetFile}.`,
          patches: [patch],
          candidates: [{
            targetFile,
            original: draft.original,
            draft: draft.draft,
          }],
        }),
      );
    },
  });
}

async function createPendingAction(
  workspaceRoot: string,
  input: {
    title: string;
    description: string;
    patches: SemanticPatch[];
    candidates: CandidateFile[];
  },
): Promise<WriteIntentPendingAction> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const id = `pa_${randomUUID()}`;
  const shadowWrites = await Promise.all(
    input.candidates.map((candidate) =>
      writeShadowFile(workspaceRealpath, id, candidate.targetFile, candidate.draft),
    ),
  );
  const action: WriteIntentPendingAction = {
    id,
    title: input.title,
    description: input.description,
    patches: input.patches,
    touchedFiles: input.candidates.map((candidate) => candidate.targetFile),
    diff: input.candidates
      .map((candidate) =>
        createUnifiedDiff(candidate.targetFile, candidate.original, candidate.draft),
      )
      .join('\n'),
    createdAt: new Date().toISOString(),
    status: 'pending',
    shadowWrites,
  };

  await writeStoredAction(workspaceRealpath, action);
  return action;
}

function pendingActionResult(action: WriteIntentPendingAction): {
  pendingActions: WriteIntentPendingAction[];
} {
  return { pendingActions: [action] };
}

async function writeShadowFile(
  workspaceRealpath: string,
  actionId: string,
  targetFile: string,
  content: string,
): Promise<ShadowWriteReference> {
  const shadowFile = join(
    '.workspace',
    'shadow-writes',
    actionId,
    sanitizeShadowPath(targetFile),
  );
  const absoluteShadowFile = resolveInternalWorkspacePath(workspaceRealpath, shadowFile);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(absoluteShadowFile));
  await mkdir(dirname(absoluteShadowFile), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(absoluteShadowFile));
  await writeFile(absoluteShadowFile, content, 'utf-8');

  return {
    targetFile,
    shadowFile,
  };
}

async function writeStoredAction(
  workspaceRealpath: string,
  action: StoredWriteIntentAction,
): Promise<void> {
  const pendingFile = pendingActionPath(workspaceRealpath, action.id);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(pendingFile));
  await mkdir(dirname(pendingFile), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(pendingFile));
  await writeFile(pendingFile, `${JSON.stringify(action, null, 2)}\n`, 'utf-8');
}

async function readStoredAction(
  workspaceRealpath: string,
  id: string,
): Promise<StoredWriteIntentAction> {
  if (!/^pa_[0-9a-f-]+$/i.test(id)) {
    throw new Error(`Invalid PendingAction id: ${id}`);
  }

  const raw = await readFile(pendingActionPath(workspaceRealpath, id), 'utf-8');
  const parsed = JSON.parse(raw) as unknown;

  if (!isStoredAction(parsed)) {
    throw new Error(`Invalid PendingAction record: ${id}`);
  }

  return parsed;
}

async function archiveStoredAction(
  workspaceRealpath: string,
  action: StoredWriteIntentAction,
  archiveDirectory: 'accepted-actions' | 'rejected-actions',
): Promise<void> {
  const pendingFile = pendingActionPath(workspaceRealpath, action.id);
  const archiveFile = join(workspaceRealpath, '.workspace', archiveDirectory, `${action.id}.json`);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(archiveFile));
  await mkdir(dirname(archiveFile), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(archiveFile));
  await writeFile(archiveFile, `${JSON.stringify(action, null, 2)}\n`, 'utf-8');
  await rm(pendingFile, { force: true });
}

function pendingActionPath(workspaceRealpath: string, id: string): string {
  return join(workspaceRealpath, '.workspace', 'pending-actions', `${id}.json`);
}

async function resolveReadableTarget(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const target = await resolveWritableTarget(workspaceRealpath, relativePath);
  await assertTargetDoesNotEscape(workspaceRealpath, target.absolutePath);
  return target.absolutePath;
}

async function resolveWritableReadTarget(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const target = await resolveWritableTarget(workspaceRealpath, relativePath);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(target.absolutePath));
  return target.absolutePath;
}

async function resolveWritableTarget(
  workspaceRealpath: string,
  requestedPath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = safeRelativePath(requestedPath);
  const absolutePath = resolve(workspaceRealpath, relativePath);
  assertPathInside(workspaceRealpath, absolutePath, 'Path resolves outside the active workspace.');

  return {
    absolutePath,
    relativePath,
  };
}

function resolveInternalWorkspacePath(workspaceRealpath: string, path: string): string {
  const normalized = normalize(path);

  if (
    normalized.startsWith('..') ||
    isAbsolute(normalized) ||
    !normalized.startsWith(`.workspace${sep}`)
  ) {
    throw new Error(`Invalid internal workspace path: ${path}`);
  }

  const absolutePath = resolve(workspaceRealpath, normalized);
  assertPathInside(workspaceRealpath, absolutePath, 'Internal workspace path escaped workspace.');
  return absolutePath;
}

function safeRelativePath(value: string): string {
  const normalized = normalize(value);

  if (!normalized.trim()) {
    throw new Error('Path is required.');
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

function safeNarrativeChapterId(value: string): string {
  const normalized = safeRelativePath(value);
  const parts = normalized.split(sep);

  if (
    parts.length !== 2 ||
    !/^\d{4}$/.test(parts[0]) ||
    !/^\d{4}$/.test(parts[1])
  ) {
    throw new Error(`Invalid chapter id: ${value}`);
  }

  if (parts[1] === '0000') {
    throw new Error('Chapter id 0000 is reserved for volume metadata.');
  }

  return normalized;
}

function safeChapterSummaryFile(value: string, chapterId: string): string {
  const normalized = safeRelativePath(value);
  const prefix = `chapter${sep}`;

  if (!normalized.startsWith(prefix) || !normalized.endsWith('.md')) {
    throw new Error(`Invalid chapter summary file: ${value}`);
  }

  const fileChapterId = safeNarrativeChapterId(
    normalized.slice(prefix.length, -'.md'.length),
  );

  if (fileChapterId !== chapterId) {
    throw new Error(`Chapter summary file must match chapter id ${chapterId}.`);
  }

  return normalized;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid path segment: ${value}`);
  }

  return value;
}

async function assertRealParentInsideWorkspace(
  workspaceRealpath: string,
  parentPath: string,
): Promise<void> {
  const parentRealpath = await realpath(parentPath);
  assertPathInside(
    workspaceRealpath,
    parentRealpath,
    'Parent directory resolves outside the active workspace.',
  );
}

async function assertExistingAncestorsInsideWorkspace(
  workspaceRealpath: string,
  parentPath: string,
): Promise<void> {
  const relativeParent = relative(workspaceRealpath, parentPath);
  const parts = relativeParent.split(sep).filter(Boolean);
  let cursor = workspaceRealpath;

  for (const part of parts) {
    cursor = join(cursor, part);

    try {
      const stat = await lstat(cursor);
      const realAncestor = stat.isSymbolicLink() ? await realpath(cursor) : cursor;
      assertPathInside(
        workspaceRealpath,
        realAncestor,
        'Parent directory resolves outside the active workspace.',
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }

      throw error;
    }
  }
}

async function assertTargetDoesNotEscape(
  workspaceRealpath: string,
  targetPath: string,
): Promise<void> {
  try {
    const stat = await lstat(targetPath);
    const targetRealpath = stat.isSymbolicLink()
      ? await realpath(targetPath)
      : targetPath;

    assertPathInside(
      workspaceRealpath,
      targetRealpath,
      'Target path resolves outside the active workspace.',
    );
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

function assertPathInside(workspaceRealpath: string, path: string, message: string): void {
  const normalizedWorkspace = workspaceRealpath.endsWith(sep)
    ? workspaceRealpath
    : `${workspaceRealpath}${sep}`;

  if (path !== workspaceRealpath && !path.startsWith(normalizedWorkspace)) {
    throw new Error(message);
  }
}

function sanitizeShadowPath(requestedPath: string): string {
  const parts = requestedPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => part.replaceAll(/[^a-zA-Z0-9._-]/g, '_'));

  return parts.length ? join(...parts) : 'write.txt';
}

function createUnifiedDiff(file: string, original: string, draft: string): string {
  const originalLines = original.split('\n');
  const draftLines = draft.split('\n');
  const lines = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@'];
  const max = Math.max(originalLines.length, draftLines.length);

  for (let index = 0; index < max; index += 1) {
    const before = originalLines[index];
    const after = draftLines[index];

    if (before === after) {
      if (before !== undefined && before !== '') {
        lines.push(` ${before}`);
      }
      continue;
    }

    if (before !== undefined && before !== '') {
      lines.push(`-${before}`);
    }

    if (after !== undefined && after !== '') {
      lines.push(`+${after}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function gitDiff(workspaceRealpath: string, files: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workspaceRealpath, 'diff', '--', ...files],
      { encoding: 'utf-8' },
    );
    return stdout;
  } catch (error) {
    if (isExecError(error)) {
      return error.stdout || error.stderr || '';
    }

    throw error;
  }
}

async function readFileIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if (isNotFoundError(error)) {
      return '';
    }

    throw error;
  }
}

function normalizeMarkdownFile(content: string): string {
  const trimmed = content.trim();
  return trimmed.length ? `${trimmed}\n` : '';
}

function expectStringArg(args: unknown, name: string): string {
  const value = getOptionalStringArg(args, name);

  if (!value) {
    throw new Error(`Tool argument "${name}" is required.`);
  }

  return value;
}

function getOptionalStringArg(args: unknown, name: string): string | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[name];
  return typeof value === 'string' ? value : undefined;
}

function expectArg(args: unknown, name: string): unknown {
  if (!isRecord(args) || !(name in args)) {
    throw new Error(`Tool argument "${name}" is required.`);
  }

  return args[name];
}

function getRecordId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
}

function isStoredAction(value: unknown): value is StoredWriteIntentAction {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    Array.isArray(value.patches) &&
    Array.isArray(value.touchedFiles) &&
    typeof value.diff === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.status === 'pending' ||
      value.status === 'accepted' ||
      value.status === 'rejected') &&
    Array.isArray(value.shadowWrites)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function isExecError(error: unknown): error is { stdout?: string; stderr?: string } {
  return typeof error === 'object' && error !== null;
}
