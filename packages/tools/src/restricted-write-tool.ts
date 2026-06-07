import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

export interface CreateRestrictedWriteToolsOptions {
  workspaceRoot: string;
}

export interface RestrictedWriteResult {
  file: string;
  shadowFile: string;
  bytes: number;
  materialized: true;
}

export function createRestrictedWriteTools(
  options: CreateRestrictedWriteToolsOptions,
): ToolSet {
  return {
    'workspace.writeFile': workspaceWriteFileTool(options),
  };
}

export function createWorkspaceWriteFileTool(
  options: CreateRestrictedWriteToolsOptions,
): ToolSet[string] {
  return workspaceWriteFileTool(options);
}

function workspaceWriteFileTool(options: CreateRestrictedWriteToolsOptions) {
  return tool({
    description:
      'Write a normal non-hidden file inside the active workspace for early agent loop validation.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    }),
    async execute(args) {
      const path = expectStringArg(args, 'path');
      const content = expectStringArg(args, 'content');
      return writeRestrictedWorkspaceFile({
        workspaceRoot: options.workspaceRoot,
        path,
        content,
      });
    },
  });
}

export async function writeRestrictedWorkspaceFile(input: {
  workspaceRoot: string;
  path: string;
  content: string;
}): Promise<RestrictedWriteResult> {
  const workspaceRealpath = await realpath(input.workspaceRoot);
  const target = await resolveWritableTarget(workspaceRealpath, input.path);
  const shadowFile = await writeShadowFile({
    workspaceRealpath,
    requestedPath: input.path,
    content: input.content,
  });

  await assertExistingAncestorsInsideWorkspace(workspaceRealpath, dirname(target.absolutePath));
  await mkdir(dirname(target.absolutePath), { recursive: true });
  await assertRealParentInsideWorkspace(workspaceRealpath, dirname(target.absolutePath));
  await assertTargetDoesNotEscape(workspaceRealpath, target.absolutePath);
  await writeFile(target.absolutePath, input.content, 'utf-8');

  return {
    file: target.relativePath,
    shadowFile: relative(workspaceRealpath, shadowFile),
    bytes: Buffer.byteLength(input.content, 'utf-8'),
    materialized: true,
  };
}

async function resolveWritableTarget(
  workspaceRealpath: string,
  requestedPath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  assertSafeUserPath(requestedPath);

  const absolutePath = resolve(workspaceRealpath, requestedPath);
  assertPathInside(workspaceRealpath, absolutePath, 'Path resolves outside the active workspace.');

  const relativePath = relative(workspaceRealpath, absolutePath);
  assertSafeUserPath(relativePath);

  await assertTargetDoesNotEscape(workspaceRealpath, absolutePath);

  return {
    absolutePath,
    relativePath,
  };
}

function assertSafeUserPath(requestedPath: string): void {
  if (!requestedPath.trim()) {
    throw new Error('Path is required.');
  }

  if (isAbsolute(requestedPath)) {
    throw new Error('Absolute paths are not allowed.');
  }

  const parts = requestedPath.split(/[\\/]+/).filter(Boolean);

  if (parts.includes('..')) {
    throw new Error('Path traversal is not allowed.');
  }

  for (const part of parts) {
    if (part === '.workspace') {
      throw new Error('User paths cannot target workspace/.workspace.');
    }

    if (part === '.oan') {
      throw new Error('User paths cannot target workspace/.oan.');
    }

    if (part.startsWith('.')) {
      throw new Error('Hidden files and hidden directories are not writable.');
    }
  }
}

async function writeShadowFile(input: {
  workspaceRealpath: string;
  requestedPath: string;
  content: string;
}): Promise<string> {
  const shadowRoot = join(input.workspaceRealpath, '.workspace', 'shadow-writes');
  const shadowFile = join(
    shadowRoot,
    randomUUID(),
    sanitizeShadowPath(input.requestedPath),
  );

  assertPathInside(input.workspaceRealpath, shadowFile, 'Shadow path escaped workspace.');
  await assertExistingAncestorsInsideWorkspace(input.workspaceRealpath, dirname(shadowFile));
  await mkdir(dirname(shadowFile), { recursive: true });
  await assertRealParentInsideWorkspace(input.workspaceRealpath, dirname(shadowFile));
  await writeFile(shadowFile, input.content, 'utf-8');

  return shadowFile;
}

function sanitizeShadowPath(requestedPath: string): string {
  const parts = requestedPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => part.replaceAll(/[^a-zA-Z0-9._-]/g, '_'));

  return parts.length ? join(...parts) : 'write.txt';
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

function expectStringArg(args: unknown, name: string): string {
  if (
    typeof args !== 'object' ||
    args === null ||
    typeof (args as Record<string, unknown>)[name] !== 'string'
  ) {
    throw new Error(`Expected string argument "${name}".`);
  }

  return (args as Record<string, string>)[name];
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
