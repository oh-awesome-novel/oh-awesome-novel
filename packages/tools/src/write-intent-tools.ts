import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
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
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

import {
  commitFiles,
  createPendingActionCommitMessage,
  gitDiff,
  gitStatusShort,
} from './git-integration';
import type { GitCommitResult } from './git-integration';
import {
  previewSemanticPatches,
  resolvePatchTargetFile,
  validateSemanticPatch,
} from './apply-engine';
import type {
  CollectionPatch,
  NarrativePatch,
  ObjectPatch,
  SemanticPatch,
  ShadowWriteReference,
} from './apply-engine';

export interface CreateWriteIntentToolsOptions {
  workspaceRoot: string;
}

export const WRITE_INTENT_PREVIEW_SCHEMA_VERSION = 1 as const;

export type PreviewableWriteIntentToolName =
  | 'chapter.createDraft'
  | 'state.set'
  | 'timeline.add'
  | 'foreshadow.create';

export interface PreparedWriteIntentPreview {
  schemaVersion: typeof WRITE_INTENT_PREVIEW_SCHEMA_VERSION;
  id: string;
  toolName: PreviewableWriteIntentToolName;
  args: Record<string, unknown>;
  title: string;
  description: string;
  patches: SemanticPatch[];
  touchedFiles: string[];
  diff: string;
  preparedAt: string;
  shadowWrites: ShadowWriteReference[];
  fingerprint: string;
}

export interface PrepareWriteIntentPreviewInput {
  workspaceRoot: string;
  toolName: PreviewableWriteIntentToolName;
  args: unknown;
}

export interface PromoteWriteIntentPreviewInput {
  workspaceRoot: string;
  preview: PreparedWriteIntentPreview;
}

export type ValidateWriteIntentPreviewInput = PromoteWriteIntentPreviewInput;

interface NormalizedWriteIntentPlan {
  toolName: PreviewableWriteIntentToolName;
  args: Record<string, unknown>;
  title: string;
  description: string;
  patches: SemanticPatch[];
}

interface StoredPreparedPreviewManifest {
  schemaVersion: typeof WRITE_INTENT_PREVIEW_SCHEMA_VERSION;
  id: string;
  toolName: PreviewableWriteIntentToolName;
  fingerprint: string;
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
  autoCommitOnAccept?: boolean;
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
  gitCommit: GitCommitResult;
  dirtyStatus: string;
}

export interface RejectedPendingAction extends PendingActionDecision {
  status: 'rejected';
}

interface PreparedShadowWrite {
  actionId: string;
  targetFile: string;
  targetPath: string;
  draft: string;
  originalHash: string;
  draftHash: string;
  targetExisted: boolean;
  targetMode?: number;
}

interface MaterializedWrite {
  targetPath: string;
  targetExisted: boolean;
  stagePath?: string;
  backupPath?: string;
  backupCreated: boolean;
  applied: boolean;
}

interface MaterializationTransaction {
  cleanup(): Promise<void>;
  rollback(): Promise<void>;
}

export function createWriteIntentTools(
  options: CreateWriteIntentToolsOptions,
): ToolSet {
  return {
    'chapter.createDraft': chapterCreateDraftTool(options),
    'character.updatePersonality': characterUpdatePersonalityTool(options),
    'state.set': stateSetTool(options),
    'timeline.add': timelineAddTool(options),
    'foreshadow.create': foreshadowCreateTool(options),
    'summary.generateChapter': summaryGenerateChapterTool(options),
  };
}

export async function prepareWriteIntentPreview(
  input: PrepareWriteIntentPreviewInput,
): Promise<PreparedWriteIntentPreview> {
  const workspaceRealpath = await realpath(input.workspaceRoot);
  const plan = normalizeWriteIntentPlan(input.toolName, input.args);
  const id = `pa_${randomUUID()}`;
  const semanticPreview = await previewSemanticPatches({
    workspaceRoot: workspaceRealpath,
    patches: plan.patches,
    id,
  });
  const previewCore = {
    schemaVersion: WRITE_INTENT_PREVIEW_SCHEMA_VERSION,
    id,
    toolName: plan.toolName,
    args: structuredClone(plan.args),
    title: plan.title,
    description: plan.description,
    patches: structuredClone(plan.patches),
    touchedFiles: [...semanticPreview.touchedFiles],
    diff: semanticPreview.diff,
    preparedAt: new Date().toISOString(),
    shadowWrites: structuredClone(semanticPreview.shadowWrites),
  };
  const preview: PreparedWriteIntentPreview = {
    ...previewCore,
    fingerprint: fingerprintValue(previewCore),
  };

  await writePreparedPreviewManifest(workspaceRealpath, preview);
  return preview;
}

export async function promoteWriteIntentPreview(
  input: PromoteWriteIntentPreviewInput,
): Promise<WriteIntentPendingAction> {
  const validated = await validateWriteIntentPreviewForPromotion(input);
  await writeStoredAction(validated.workspaceRealpath, validated.action, true);
  return validated.action;
}

export async function validateWriteIntentPreview(
  input: ValidateWriteIntentPreviewInput,
): Promise<void> {
  await validateWriteIntentPreviewForPromotion(input);
}

async function validateWriteIntentPreviewForPromotion(
  input: PromoteWriteIntentPreviewInput,
): Promise<{
  workspaceRealpath: string;
  action: WriteIntentPendingAction;
}> {
  const workspaceRealpath = await realpath(input.workspaceRoot);
  const preview = assertPreparedWriteIntentPreview(input.preview);
  await assertPreviewHasNotBeenPromoted(workspaceRealpath, preview.id);
  const manifest = await readPreparedPreviewManifest(workspaceRealpath, preview.id);
  const expectedFingerprint = fingerprintPreparedWriteIntentPreview(preview);
  if (
    preview.fingerprint !== expectedFingerprint ||
    manifest.id !== preview.id ||
    manifest.toolName !== preview.toolName ||
    manifest.fingerprint !== preview.fingerprint
  ) {
    throw new Error(`Prepared write-intent preview ${preview.id} fingerprint is invalid.`);
  }

  const plan = normalizeWriteIntentPlan(preview.toolName, preview.args);
  if (
    plan.title !== preview.title ||
    plan.description !== preview.description ||
    stableSerialize(plan.args) !== stableSerialize(preview.args) ||
    stableSerialize(plan.patches) !== stableSerialize(preview.patches)
  ) {
    throw new Error(
      `Prepared write-intent preview ${preview.id} does not match its normalized tool arguments.`,
    );
  }
  const expectedTouchedFiles = plan.patches.map(resolvePatchTargetFile);
  if (stableSerialize(expectedTouchedFiles) !== stableSerialize(preview.touchedFiles)) {
    throw new Error(
      `Prepared write-intent preview ${preview.id} has inconsistent patch targets.`,
    );
  }

  const action: WriteIntentPendingAction = {
    id: preview.id,
    title: plan.title,
    description: plan.description,
    patches: structuredClone(plan.patches),
    touchedFiles: [...preview.touchedFiles],
    diff: preview.diff,
    createdAt: new Date().toISOString(),
    status: 'pending',
    shadowWrites: structuredClone(preview.shadowWrites),
  };
  await preflightShadowWrites(workspaceRealpath, action);
  return { workspaceRealpath, action };
}

async function executePreviewableWriteIntent(
  workspaceRoot: string,
  toolName: PreviewableWriteIntentToolName,
  args: unknown,
): Promise<WriteIntentPendingAction> {
  const preview = await prepareWriteIntentPreview({
    workspaceRoot,
    toolName,
    args,
  });
  return promoteWriteIntentPreview({ workspaceRoot, preview });
}

function chapterCreateDraftTool(options: CreateWriteIntentToolsOptions) {
  return tool({
    description:
      'Create a PendingAction to create or replace one narrative chapter Markdown file.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        chapterId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        file: { type: 'string' },
        mode: { type: 'string', enum: ['create', 'replace'] },
      },
      required: ['chapterId', 'content'],
      additionalProperties: false,
    }),
    async execute(args) {
      return pendingActionResult(
        await executePreviewableWriteIntent(
          options.workspaceRoot,
          'chapter.createDraft',
          args,
        ),
      );
    },
  });
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
  const autoCommitOnAccept = input.autoCommitOnAccept ?? true;

  if (action.status !== 'pending') {
    throw new Error(`PendingAction ${input.id} is already ${action.status}.`);
  }

  const preparedWrites = await preflightShadowWrites(workspaceRealpath, action);
  const transaction = await materializePreparedWrites(workspaceRealpath, preparedWrites);

  const acceptedAction: StoredWriteIntentAction = {
    ...action,
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
  };

  try {
    await archiveStoredAction(workspaceRealpath, acceptedAction, 'accepted-actions');
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  await transaction.cleanup();
  const message = createPendingActionCommitMessage({
    pendingActionId: action.id,
    title: action.title,
  });
  const gitDiffBeforeCommit = await gitDiff(workspaceRealpath, action.touchedFiles);
  const gitCommit: GitCommitResult = autoCommitOnAccept
    ? await commitFiles({
        workspaceRoot: workspaceRealpath,
        files: action.touchedFiles,
        message,
      })
    : {
        status: 'skipped',
        reason: 'auto_commit_disabled',
        message,
      };

  return {
    id: action.id,
    status: 'accepted',
    appliedFiles: action.touchedFiles,
    gitDiff: gitCommit.status === 'committed' ? '' : gitDiffBeforeCommit,
    gitCommit,
    dirtyStatus: await gitStatusShort(workspaceRealpath, action.touchedFiles),
  };
}

async function preflightShadowWrites(
  workspaceRealpath: string,
  action: StoredWriteIntentAction,
): Promise<PreparedShadowWrite[]> {
  if (
    action.touchedFiles.length === 0 ||
    action.shadowWrites.length !== action.touchedFiles.length
  ) {
    throw new Error(`PendingAction ${action.id} has inconsistent touched file mappings.`);
  }

  const touchedFiles = action.touchedFiles.map((file) => {
    if (typeof file !== 'string') {
      throw new Error(`PendingAction ${action.id} has an invalid touched file mapping.`);
    }

    return safeRelativePath(file);
  });

  if (new Set(touchedFiles).size !== touchedFiles.length) {
    throw new Error(`PendingAction ${action.id} has duplicate touched file mappings.`);
  }

  const expectedShadowRoot = join(
    workspaceRealpath,
    '.workspace',
    'shadow-writes',
    action.id,
  );
  const shadowPaths = new Set<string>();
  const preparedWrites: PreparedShadowWrite[] = [];

  for (const [index, rawWrite] of action.shadowWrites.entries()) {
    if (!isShadowWriteWithBaseline(rawWrite)) {
      throw new Error(
        `PendingAction ${action.id} is missing required baseline metadata for shadow write ${index + 1}.`,
      );
    }

    const targetFile = safeRelativePath(rawWrite.targetFile);
    if (targetFile !== touchedFiles[index]) {
      throw new Error(`PendingAction ${action.id} has inconsistent touched file mappings.`);
    }

    const target = await resolveWritableTarget(workspaceRealpath, targetFile);
    const shadowPath = resolveInternalWorkspacePath(workspaceRealpath, rawWrite.shadowFile);
    assertPathInside(
      expectedShadowRoot,
      shadowPath,
      `PendingAction ${action.id} shadow write is outside its expected action directory.`,
    );

    if (shadowPaths.has(shadowPath)) {
      throw new Error(`PendingAction ${action.id} has duplicate shadow write mappings.`);
    }
    shadowPaths.add(shadowPath);

    await assertPathContainsNoSymlinks(workspaceRealpath, shadowPath);
    const shadowStat = await lstat(shadowPath);
    if (shadowStat.isSymbolicLink() || !shadowStat.isFile()) {
      throw new Error(`PendingAction ${action.id} shadow write must be a regular file.`);
    }

    const shadowRealpath = await realpath(shadowPath);
    assertPathInside(
      expectedShadowRoot,
      shadowRealpath,
      `PendingAction ${action.id} shadow write is outside its expected action directory.`,
    );
    const draft = await readFile(shadowRealpath, 'utf-8');
    if (sha256(draft) !== rawWrite.draftHash) {
      throw new Error(
        `PendingAction ${action.id} shadow content changed since preview: ${targetFile}.`,
      );
    }

    await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(target.absolutePath));
    const targetMode = await assertTargetMatchesBaseline(
      workspaceRealpath,
      target.absolutePath,
      targetFile,
      rawWrite,
      action.id,
    );

    preparedWrites.push({
      actionId: action.id,
      targetFile,
      targetPath: target.absolutePath,
      draft,
      originalHash: rawWrite.originalHash,
      draftHash: rawWrite.draftHash,
      targetExisted: rawWrite.targetExisted,
      targetMode,
    });
  }

  return preparedWrites;
}

async function materializePreparedWrites(
  workspaceRealpath: string,
  preparedWrites: PreparedShadowWrite[],
): Promise<MaterializationTransaction> {
  const materializedWrites: MaterializedWrite[] = [];

  try {
    for (const prepared of preparedWrites) {
      const targetParent = dirname(prepared.targetPath);
      await assertExistingAncestorsInsideWorkspace(workspaceRealpath, targetParent);
      await mkdir(targetParent, { recursive: true });
      const realTargetParent = await realpath(targetParent);
      assertPathInside(
        workspaceRealpath,
        realTargetParent,
        'Parent directory resolves outside the active workspace.',
      );

      const targetPath = join(realTargetParent, basename(prepared.targetPath));
      await assertTargetMatchesBaseline(
        workspaceRealpath,
        targetPath,
        prepared.targetFile,
        prepared,
        prepared.actionId,
      );

      const token = randomUUID();
      const write: MaterializedWrite = {
        targetPath,
        targetExisted: prepared.targetExisted,
        stagePath: join(realTargetParent, `.oan-stage-${token}`),
        backupPath: prepared.targetExisted
          ? join(realTargetParent, `.oan-backup-${token}`)
          : undefined,
        backupCreated: false,
        applied: false,
      };
      materializedWrites.push(write);

      await writeFile(write.stagePath, prepared.draft, {
        encoding: 'utf-8',
        flag: 'wx',
      });
      if (prepared.targetMode !== undefined) {
        await chmod(write.stagePath, prepared.targetMode);
      }

      if (write.backupPath) {
        await rename(write.targetPath, write.backupPath);
        write.backupCreated = true;
        await assertBackupMatchesBaseline(
          write.backupPath,
          prepared.targetFile,
          prepared.originalHash,
          prepared.actionId,
        );
      }

      await rename(write.stagePath, write.targetPath);
      write.applied = true;
      write.stagePath = undefined;
    }
  } catch (error) {
    try {
      await rollbackMaterializedWrites(materializedWrites);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'PendingAction materialization failed and rollback was incomplete.',
      );
    }

    throw error;
  }

  let closed = false;
  return {
    async cleanup() {
      if (closed) {
        return;
      }
      closed = true;

      for (const write of materializedWrites) {
        if (write.stagePath) {
          await rm(write.stagePath, { force: true });
        }
        if (write.backupCreated && write.backupPath) {
          await rm(write.backupPath, { force: true });
          write.backupCreated = false;
        }
      }
    },
    async rollback() {
      if (closed) {
        return;
      }
      closed = true;
      await rollbackMaterializedWrites(materializedWrites);
    },
  };
}

async function rollbackMaterializedWrites(
  writes: MaterializedWrite[],
): Promise<void> {
  const errors: unknown[] = [];

  for (const write of [...writes].reverse()) {
    if (write.applied) {
      try {
        await rm(write.targetPath, { force: true });
        write.applied = false;
      } catch (error) {
        errors.push(error);
      }
    }

    if (write.backupCreated && write.backupPath) {
      try {
        await rename(write.backupPath, write.targetPath);
        write.backupCreated = false;
      } catch (error) {
        errors.push(error);
      }
    }

    if (write.stagePath) {
      try {
        await rm(write.stagePath, { force: true });
      } catch (error) {
        errors.push(error);
      }
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Could not completely roll back PendingAction writes.');
  }
}

async function assertTargetMatchesBaseline(
  workspaceRealpath: string,
  targetPath: string,
  targetFile: string,
  baseline: Pick<PreparedShadowWrite, 'originalHash' | 'targetExisted'>,
  actionId: string,
): Promise<number | undefined> {
  try {
    const targetStat = await lstat(targetPath);
    if (targetStat.isSymbolicLink()) {
      throw new Error(`PendingAction target cannot be a symbolic link: ${targetFile}.`);
    }
    if (!targetStat.isFile()) {
      throw new Error(`PendingAction target must be a regular file: ${targetFile}.`);
    }

    await assertTargetDoesNotEscape(workspaceRealpath, targetPath);
    if (!baseline.targetExisted) {
      throw pendingActionConflict(actionId, targetFile);
    }

    const current = await readFile(targetPath, 'utf-8');
    if (sha256(current) !== baseline.originalHash) {
      throw pendingActionConflict(actionId, targetFile);
    }

    return targetStat.mode;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    if (baseline.targetExisted || baseline.originalHash !== sha256('')) {
      throw pendingActionConflict(actionId, targetFile);
    }

    return undefined;
  }
}

async function assertBackupMatchesBaseline(
  backupPath: string,
  targetFile: string,
  originalHash: string,
  actionId: string,
): Promise<void> {
  const backupStat = await lstat(backupPath);
  if (backupStat.isSymbolicLink() || !backupStat.isFile()) {
    throw new Error(`PendingAction target cannot be replaced safely: ${targetFile}.`);
  }

  const content = await readFile(backupPath, 'utf-8');
  if (sha256(content) !== originalHash) {
    throw pendingActionConflict(actionId, targetFile);
  }
}

function pendingActionConflict(actionId: string, targetFile: string): Error {
  return new Error(
    `PendingAction ${actionId} target changed since preview: ${targetFile}.`,
  );
}

async function assertPathContainsNoSymlinks(
  workspaceRealpath: string,
  path: string,
): Promise<void> {
  const relativePath = relative(workspaceRealpath, path);
  let cursor = workspaceRealpath;

  for (const part of relativePath.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`Internal workspace path cannot contain symbolic links: ${path}`);
    }
  }
}

function isShadowWriteWithBaseline(value: unknown): value is {
  targetFile: string;
  shadowFile: string;
  originalHash: string;
  draftHash: string;
  targetExisted: boolean;
} {
  return (
    isRecord(value) &&
    typeof value.targetFile === 'string' &&
    typeof value.shadowFile === 'string' &&
    isSha256(value.originalHash) &&
    isSha256(value.draftHash) &&
    typeof value.targetExisted === 'boolean'
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
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
      const patch: ObjectPatch = {
        kind: 'object',
        domain: 'character',
        entityId: characterId,
        file,
        operation: 'replaceSection',
        selector: { section },
        value: content,
      };
      const targetFile = safeRelativePath(join('characters', characterId, safeRelativePath(file)));

      return pendingActionResult(
        await createPendingAction(options.workspaceRoot, {
          title: `Update ${characterId} personality`,
          description: `Replace section "${section}" in ${targetFile}.`,
          patches: [patch],
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
      return pendingActionResult(
        await executePreviewableWriteIntent(
          options.workspaceRoot,
          'state.set',
          args,
        ),
      );
    },
  });
}

function timelineAddTool(options: CreateWriteIntentToolsOptions) {
  return collectionAppendTool({
    options,
    name: 'timeline.add',
    description: 'Create a PendingAction to append one timeline event.',
    valueArg: 'event',
  });
}

function foreshadowCreateTool(options: CreateWriteIntentToolsOptions) {
  return collectionAppendTool({
    options,
    name: 'foreshadow.create',
    description: 'Create a PendingAction to append one active foreshadow item.',
    valueArg: 'item',
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
      const patch: NarrativePatch = {
        kind: 'narrative',
        domain: 'summary',
        file: targetFile,
        operation: 'replaceFile',
        value: content,
      };

      return pendingActionResult(
        await createPendingAction(options.workspaceRoot, {
          title: `Generate chapter ${chapterId} summary`,
          description: `Replace ${targetFile} with generated chapter summary.`,
          patches: [patch],
        }),
      );
    },
  });
}

function collectionAppendTool(input: {
  options: CreateWriteIntentToolsOptions;
  name: 'timeline.add' | 'foreshadow.create';
  description: string;
  valueArg: string;
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
      return pendingActionResult(
        await executePreviewableWriteIntent(
          input.options.workspaceRoot,
          input.name,
          args,
        ),
      );
    },
  });
}

function normalizeWriteIntentPlan(
  toolName: PreviewableWriteIntentToolName,
  args: unknown,
): NormalizedWriteIntentPlan {
  switch (toolName) {
    case 'chapter.createDraft':
      return normalizeChapterCreateDraftPlan(args);
    case 'state.set':
      return normalizeStateSetPlan(args);
    case 'timeline.add':
      return normalizeCollectionAppendPlan({
        args,
        toolName,
        domain: 'timeline',
        defaultFile: 'events.yaml',
        defaultPath: 'events',
        valueArg: 'event',
      });
    case 'foreshadow.create':
      return normalizeCollectionAppendPlan({
        args,
        toolName,
        domain: 'foreshadow',
        defaultFile: 'active.yaml',
        defaultPath: 'active',
        valueArg: 'item',
      });
    default:
      throw new Error(`Unsupported previewable write-intent tool: ${String(toolName)}.`);
  }
}

function normalizeChapterCreateDraftPlan(args: unknown): NormalizedWriteIntentPlan {
  const values = expectToolArgs(args, [
    'chapterId',
    'title',
    'content',
    'file',
    'mode',
  ]);
  const chapterId = safeNarrativeChapterId(expectStringArg(values, 'chapterId'));
  const title = getOptionalStrictStringArg(values, 'title')?.trim();
  const content = normalizeMarkdownFile(expectStringArg(values, 'content'));
  const requestedFile = getOptionalStrictStringArg(values, 'file') ?? `${chapterId}.md`;
  const targetFile = safeChapterDraftFile(requestedFile, chapterId);
  const mode = getOptionalStrictStringArg(values, 'mode');
  if (mode !== undefined && mode !== 'create' && mode !== 'replace') {
    throw new Error('Tool argument "mode" must be create or replace.');
  }
  const draft = title && !content.startsWith('# ')
    ? normalizeMarkdownFile(`# ${title}\n\n${content}`)
    : content;
  const normalizedArgs: Record<string, unknown> = {
    chapterId,
    content,
    file: targetFile,
  };
  if (title !== undefined) normalizedArgs.title = title;
  if (mode !== undefined) normalizedArgs.mode = mode;
  const patch: NarrativePatch = {
    kind: 'narrative',
    domain: 'chapter',
    file: targetFile,
    operation: 'replaceFile',
    value: draft,
  };
  return {
    toolName: 'chapter.createDraft',
    args: normalizedArgs,
    title: `Create chapter ${chapterId} draft`,
    description: `Replace ${targetFile} with a proposed chapter draft.`,
    patches: [patch],
  };
}

function normalizeStateSetPlan(args: unknown): NormalizedWriteIntentPlan {
  const values = expectToolArgs(args, ['file', 'path', 'value']);
  const file = safeRelativePath(expectStringArg(values, 'file'));
  const path = expectStringArg(values, 'path');
  const value = cloneJsonToolValue(expectArg(values, 'value'), 'state.set value');
  const targetFile = safeRelativePath(join('state', file));
  const patch: CollectionPatch = {
    kind: 'collection',
    domain: 'state',
    file,
    operation: 'yamlSet',
    path,
    value: structuredClone(value),
  };
  return {
    toolName: 'state.set',
    args: { file, path, value },
    title: `Set state ${path}`,
    description: `Set ${path} in ${targetFile}.`,
    patches: [patch],
  };
}

function normalizeCollectionAppendPlan(input: {
  args: unknown;
  toolName: 'timeline.add' | 'foreshadow.create';
  domain: 'timeline' | 'foreshadow';
  defaultFile: string;
  defaultPath: string;
  valueArg: 'event' | 'item';
}): NormalizedWriteIntentPlan {
  const values = expectToolArgs(input.args, ['file', 'path', input.valueArg]);
  const file = safeRelativePath(
    getOptionalStrictStringArg(values, 'file') ?? input.defaultFile,
  );
  const path = getOptionalStrictStringArg(values, 'path') ?? input.defaultPath;
  const value = cloneJsonToolValue(
    expectArg(values, input.valueArg),
    `${input.toolName} ${input.valueArg}`,
  );
  const targetFile = safeRelativePath(join(input.domain, file));
  const patch: CollectionPatch = {
    kind: 'collection',
    domain: input.domain,
    file,
    operation: 'yamlAppend',
    path,
    value: structuredClone(value),
  };
  const title = input.toolName === 'timeline.add'
    ? `Add timeline event ${getRecordId(value) ?? ''}`.trim()
    : `Create foreshadow ${getRecordId(value) ?? ''}`.trim();
  return {
    toolName: input.toolName,
    args: {
      file,
      path,
      [input.valueArg]: value,
    },
    title,
    description: `Append to ${path} in ${targetFile}.`,
    patches: [patch],
  };
}

async function createPendingAction(
  workspaceRoot: string,
  input: {
    title: string;
    description: string;
    patches: SemanticPatch[];
  },
): Promise<WriteIntentPendingAction> {
  const workspaceRealpath = await realpath(workspaceRoot);
  const id = `pa_${randomUUID()}`;
  const preview = await previewSemanticPatches({
    workspaceRoot: workspaceRealpath,
    patches: input.patches,
    id,
  });
  const action: WriteIntentPendingAction = {
    id,
    title: input.title,
    description: input.description,
    patches: input.patches,
    touchedFiles: preview.touchedFiles,
    diff: preview.diff,
    createdAt: new Date().toISOString(),
    status: 'pending',
    shadowWrites: preview.shadowWrites,
  };

  await writeStoredAction(workspaceRealpath, action);
  return action;
}

function pendingActionResult(action: WriteIntentPendingAction): {
  pendingActions: WriteIntentPendingAction[];
} {
  return { pendingActions: [action] };
}

async function writeStoredAction(
  workspaceRealpath: string,
  action: StoredWriteIntentAction,
  rejectDuplicate = false,
): Promise<void> {
  const pendingFile = pendingActionPath(workspaceRealpath, action.id);
  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(pendingFile));
  await mkdir(dirname(pendingFile), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(pendingFile));
  try {
    await writeFile(pendingFile, `${JSON.stringify(action, null, 2)}\n`, {
      encoding: 'utf-8',
      flag: rejectDuplicate ? 'wx' : 'w',
    });
  } catch (error) {
    if (rejectDuplicate && isAlreadyExistsError(error)) {
      throw new Error(`Prepared write-intent preview ${action.id} was already promoted.`);
    }
    throw error;
  }
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

async function writePreparedPreviewManifest(
  workspaceRealpath: string,
  preview: PreparedWriteIntentPreview,
): Promise<void> {
  const manifest: StoredPreparedPreviewManifest = {
    schemaVersion: WRITE_INTENT_PREVIEW_SCHEMA_VERSION,
    id: preview.id,
    toolName: preview.toolName,
    fingerprint: preview.fingerprint,
  };
  const manifestPath = preparedPreviewManifestPath(workspaceRealpath, preview.id);
  await assertExistingAncestorsInsideWorkspace(
    workspaceRealpath,
    dirname(manifestPath),
  );
  await mkdir(dirname(manifestPath), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(manifestPath));
  try {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf-8',
      flag: 'wx',
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(`Prepared write-intent preview id already exists: ${preview.id}.`);
    }
    throw error;
  }
}

async function readPreparedPreviewManifest(
  workspaceRealpath: string,
  id: string,
): Promise<StoredPreparedPreviewManifest> {
  const safeId = safePendingActionId(id);
  const manifestPath = preparedPreviewManifestPath(workspaceRealpath, safeId);
  await assertPathContainsNoSymlinks(workspaceRealpath, manifestPath);
  const manifestStat = await lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error(`Prepared write-intent preview ${safeId} manifest is invalid.`);
  }
  const realManifestPath = await realpath(manifestPath);
  assertPathInside(
    join(workspaceRealpath, '.workspace', 'shadow-writes', safeId),
    realManifestPath,
    `Prepared write-intent preview ${safeId} manifest escaped its shadow directory.`,
  );
  const parsed = JSON.parse(await readFile(realManifestPath, 'utf-8')) as unknown;
  if (
    !isRecord(parsed) ||
    !hasOnlyKnownFields(parsed, [
      'schemaVersion',
      'id',
      'toolName',
      'fingerprint',
    ]) ||
    parsed.schemaVersion !== WRITE_INTENT_PREVIEW_SCHEMA_VERSION ||
    parsed.id !== safeId ||
    !isPreviewableWriteIntentToolName(parsed.toolName) ||
    !isSha256(parsed.fingerprint)
  ) {
    throw new Error(`Prepared write-intent preview ${safeId} manifest is invalid.`);
  }
  return parsed as unknown as StoredPreparedPreviewManifest;
}

function preparedPreviewManifestPath(
  workspaceRealpath: string,
  id: string,
): string {
  return resolveInternalWorkspacePath(
    workspaceRealpath,
    join('.workspace', 'shadow-writes', safePendingActionId(id), 'prepared-preview.json'),
  );
}

async function assertPreviewHasNotBeenPromoted(
  workspaceRealpath: string,
  id: string,
): Promise<void> {
  const safeId = safePendingActionId(id);
  const actionFiles = [
    pendingActionPath(workspaceRealpath, safeId),
    join(workspaceRealpath, '.workspace', 'accepted-actions', `${safeId}.json`),
    join(workspaceRealpath, '.workspace', 'rejected-actions', `${safeId}.json`),
  ];
  for (const actionFile of actionFiles) {
    try {
      await lstat(actionFile);
      throw new Error(`Prepared write-intent preview ${safeId} was already promoted.`);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }
}

function assertPreparedWriteIntentPreview(
  value: unknown,
): PreparedWriteIntentPreview {
  if (
    !isRecord(value) ||
    !hasOnlyKnownFields(value, [
      'schemaVersion',
      'id',
      'toolName',
      'args',
      'title',
      'description',
      'patches',
      'touchedFiles',
      'diff',
      'preparedAt',
      'shadowWrites',
      'fingerprint',
    ]) ||
    value.schemaVersion !== WRITE_INTENT_PREVIEW_SCHEMA_VERSION ||
    !isPreviewableWriteIntentToolName(value.toolName) ||
    !isRecord(value.args) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    !Array.isArray(value.patches) ||
    value.patches.length === 0 ||
    !Array.isArray(value.touchedFiles) ||
    value.touchedFiles.length === 0 ||
    value.touchedFiles.some((file) => typeof file !== 'string') ||
    new Set(value.touchedFiles).size !== value.touchedFiles.length ||
    typeof value.diff !== 'string' ||
    typeof value.preparedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    !Array.isArray(value.shadowWrites) ||
    value.shadowWrites.length !== value.touchedFiles.length ||
    !value.shadowWrites.every(isStrictShadowWriteWithBaseline) ||
    !isSha256(value.fingerprint)
  ) {
    throw new Error('Prepared write-intent preview is invalid.');
  }
  safePendingActionId(value.id);
  for (const patch of value.patches) {
    validateSemanticPatch(patch as SemanticPatch);
  }
  for (const file of value.touchedFiles) {
    safeRelativePath(file as string);
  }
  stableSerialize(value.args);
  return value as unknown as PreparedWriteIntentPreview;
}

function fingerprintPreparedWriteIntentPreview(
  preview: PreparedWriteIntentPreview,
): string {
  const {
    fingerprint: _fingerprint,
    ...previewCore
  } = preview;
  return fingerprintValue(previewCore);
}

function fingerprintValue(value: unknown): string {
  return sha256(stableSerialize(value));
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value, new Set<object>()));
}

function toStableJsonValue(value: unknown, ancestors: Set<object>): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Write-intent values must contain only finite JSON numbers.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new Error('Write-intent values must be JSON-compatible.');
  }
  if (ancestors.has(value)) {
    throw new Error('Write-intent values cannot contain cycles.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => toStableJsonValue(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Write-intent values must contain only plain JSON objects.');
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, toStableJsonValue(record[key], ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonToolValue(value: unknown, label: string): unknown {
  if (value === undefined) {
    throw new Error(`${label} is required.`);
  }
  stableSerialize(value);
  return structuredClone(value);
}

function expectToolArgs(
  value: unknown,
  knownFields: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Write-intent tool arguments must be an object.');
  }
  if (!hasOnlyKnownFields(value, knownFields)) {
    throw new Error('Write-intent tool arguments contain unknown fields.');
  }
  return value;
}

function getOptionalStrictStringArg(
  args: Record<string, unknown>,
  name: string,
): string | undefined {
  if (!Object.hasOwn(args, name)) return undefined;
  const value = args[name];
  if (typeof value !== 'string') {
    throw new Error(`Tool argument "${name}" must be a string.`);
  }
  return value;
}

function hasOnlyKnownFields(
  value: Record<string, unknown>,
  knownFields: readonly string[],
): boolean {
  const known = new Set(knownFields);
  return Object.keys(value).every((field) => known.has(field));
}

function isPreviewableWriteIntentToolName(
  value: unknown,
): value is PreviewableWriteIntentToolName {
  return value === 'chapter.createDraft' ||
    value === 'state.set' ||
    value === 'timeline.add' ||
    value === 'foreshadow.create';
}

function isStrictShadowWriteWithBaseline(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKnownFields(value, [
      'targetFile',
      'shadowFile',
      'originalHash',
      'draftHash',
      'targetExisted',
    ]) &&
    isShadowWriteWithBaseline(value);
}

function safePendingActionId(value: unknown): string {
  if (typeof value !== 'string' || !/^pa_[0-9a-f-]+$/i.test(value)) {
    throw new Error(`Invalid PendingAction id: ${String(value)}`);
  }
  return value;
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

function safeChapterDraftFile(value: string, chapterId: string): string {
  const normalized = safeRelativePath(value);

  if (!normalized.endsWith('.md')) {
    throw new Error(`Invalid chapter draft file: ${value}`);
  }

  const expectedFile = join('chapters', `${chapterId}.md`);
  const normalizedWithRoot = normalized.startsWith(`chapters${sep}`)
    ? normalized
    : join('chapters', normalized);
  const fileChapterId = safeNarrativeChapterId(
    normalizedWithRoot.slice(`chapters${sep}`.length, -'.md'.length),
  );

  if (fileChapterId !== chapterId || normalizedWithRoot !== expectedFile) {
    throw new Error(`Chapter draft file must match chapter id ${chapterId}.`);
  }

  return normalizedWithRoot;
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

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'EEXIST'
  );
}
