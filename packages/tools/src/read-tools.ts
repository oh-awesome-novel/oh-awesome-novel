import { realpathSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import * as hostPath from 'node:path';
import { basename, extname, isAbsolute, posix, relative, sep } from 'node:path';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import { parse as parseYaml } from 'yaml';

import { parseFrontmatter } from './markdown';

export interface WorkspaceReaderDirectoryEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface WorkspaceReader {
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<WorkspaceReaderDirectoryEntry[]>;
}

export interface CreateReadToolsOptions {
  workspaceRoot: string;
  reader?: WorkspaceReader;
}

export function createReadTools(options: CreateReadToolsOptions): ToolSet {
  return {
    'character.list': characterListTool(options),
    'character.get': characterGetTool(options),
    'world.search': worldSearchTool(options),
    'chapter.get': chapterGetTool(options),
    'state.get': stateGetTool(options),
    'timeline.list': timelineListTool(options),
    'foreshadow.list': foreshadowListTool(options),
    'summary.get': summaryGetTool(options),
    'constitution.get': constitutionGetTool(options),
    'workflow.get': workflowGetTool(options),
  };
}

function characterListTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'List character ids and metadata from the workspace.',
    inputSchema: emptyInputSchema(),
    async execute() {
      const characterRoot = resolveWorkspacePath(options, 'characters');
      const ids = await listDirectories(options, characterRoot);
      const characters = await Promise.all(
        ids.map(async (id) => {
          const metaPath = resolveWorkspacePath(
            options,
            'characters',
            safeSegment(id),
            'meta.yaml',
          );
          return {
            id,
            meta: await readYamlIfExists(options, metaPath),
          };
        }),
      );
      return { characters };
    },
  });
}

function characterGetTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Read one character object directory by id.',
    inputSchema: objectInputSchema({
      id: { type: 'string' },
    }, ['id']),
    async execute(args) {
      const id = expectStringArg(args, 'id');
      const characterDir = resolveWorkspacePath(
        options,
        'characters',
        safeSegment(id),
      );
      const files = await readDomainDirectory(options, characterDir);

      return { id, files };
    },
  });
}

function worldSearchTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Search Markdown world files by topic or text query.',
    inputSchema: objectInputSchema({
      query: { type: 'string' },
      topic: { type: 'string' },
    }),
    async execute(args) {
      const query = getOptionalStringArg(args, 'query')?.toLowerCase();
      const topic = getOptionalStringArg(args, 'topic');
      const worldRoot = resolveWorkspacePath(options, 'world');
      const files = await listFiles(options, worldRoot, ['.md']);
      const matches = [];

      for (const filePath of files) {
        const rel = workspacePaths(options).relative(worldRoot, filePath).replaceAll('\\', '/');
        if (topic && !rel.startsWith(safeRelativePath(topic))) {
          continue;
        }

        const content = await readWorkspaceFile(options, filePath);
        if (query && !content.toLowerCase().includes(query) && !rel.toLowerCase().includes(query)) {
          continue;
        }

        matches.push({
          file: workspaceRelativePath(options, filePath),
          content,
        });
      }

      return { matches };
    },
  });
}

function chapterGetTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Read a chapter Markdown file by stable id, for example 0001/0001.',
    inputSchema: objectInputSchema({
      id: { type: 'string' },
    }, ['id']),
    async execute(args) {
      const id = safeNarrativeChapterId(expectStringArg(args, 'id'));
      const filePath = resolveWorkspacePath(
        options,
        'chapters',
        `${id}.md`,
      );
      const document = await loadWorkspaceMarkdown(options, filePath);

      return {
        id,
        file: workspaceRelativePath(options, filePath),
        frontmatter: document.frontmatter,
        content: document.body,
      };
    },
  });
}

function stateGetTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Read state YAML, optionally selecting a file and path.',
    inputSchema: objectInputSchema({
      file: { type: 'string' },
      path: { type: 'string' },
    }),
    async execute(args) {
      const file = getOptionalStringArg(args, 'file');
      const path = getOptionalStringArg(args, 'path');

      if (file) {
        const filePath = resolveWorkspacePath(options, 'state', safeRelativePath(file));
        const document = await loadWorkspaceYaml(options, filePath);
        return {
          file: workspaceRelativePath(options, filePath),
          data: path ? getByPath(document.data, path) : document.data,
        };
      }

      return {
        files: await readYamlDirectory(options, resolveWorkspacePath(options, 'state')),
      };
    },
  });
}

function timelineListTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'List timeline YAML collections.',
    inputSchema: emptyInputSchema(),
    async execute() {
      return {
        files: await readYamlDirectory(options, resolveWorkspacePath(options, 'timeline')),
      };
    },
  });
}

function foreshadowListTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'List foreshadow YAML collections.',
    inputSchema: emptyInputSchema(),
    async execute() {
      return {
        files: await readYamlDirectory(options, resolveWorkspacePath(options, 'foreshadow')),
      };
    },
  });
}

function summaryGetTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Read a summary Markdown file by file path under summaries.',
    inputSchema: objectInputSchema({
      file: { type: 'string' },
    }),
    async execute(args) {
      const file = getOptionalStringArg(args, 'file') ?? 'global.md';
      const filePath = resolveWorkspacePath(options, 'summaries', safeRelativePath(file));
      const document = await loadWorkspaceMarkdown(options, filePath);

      return {
        file: workspaceRelativePath(options, filePath),
        frontmatter: document.frontmatter,
        content: document.body,
      };
    },
  });
}

function constitutionGetTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Read constitution Markdown files from .oan/constitution.',
    inputSchema: objectInputSchema({
      file: { type: 'string' },
    }),
    async execute(args) {
      const file = getOptionalStringArg(args, 'file');
      const constitutionRoot = resolveWorkspacePath(options, '.oan', 'constitution');

      if (file) {
        const filePath = resolveWorkspacePath(
          options,
          '.oan',
          'constitution',
          safeRelativePath(file),
        );
        const document = await loadWorkspaceMarkdown(options, filePath);
        return {
          file: workspaceRelativePath(options, filePath),
          content: document.body,
        };
      }

      return {
        files: await readMarkdownDirectory(options, constitutionRoot),
      };
    },
  });
}

function workflowGetTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Read .oan/workflow.yaml.',
    inputSchema: emptyInputSchema(),
    async execute() {
      const filePath = resolveWorkspacePath(options, '.oan', 'workflow.yaml');
      const document = await loadWorkspaceYaml(options, filePath);
      return {
        file: workspaceRelativePath(options, filePath),
        data: document.data,
      };
    },
  });
}

async function readDomainDirectory(
  options: CreateReadToolsOptions,
  directory: string,
): Promise<Record<string, unknown>> {
  const entries = await readWorkspaceDirectory(options, directory);
  const files: Record<string, unknown> = {};

  for (const entry of entries) {
    if (!entry.isFile) {
      continue;
    }

    const filePath = workspacePaths(options).join(directory, entry.name);
    const extension = extname(entry.name);

    if (extension === '.yaml' || extension === '.yml') {
      files[entry.name] = (await loadWorkspaceYaml(options, filePath)).data;
    } else if (extension === '.md') {
      const document = await loadWorkspaceMarkdown(options, filePath);
      files[entry.name] = {
        frontmatter: document.frontmatter,
        content: document.body,
      };
    }
  }

  return files;
}

async function readYamlDirectory(
  options: CreateReadToolsOptions,
  directory: string,
): Promise<Array<{ file: string; data: unknown }>> {
  const files = await listFiles(options, directory, ['.yaml', '.yml']);
  return Promise.all(
    files.map(async (filePath) => ({
      file: basename(filePath),
      data: (await loadWorkspaceYaml(options, filePath)).data,
    })),
  );
}

async function readMarkdownDirectory(
  options: CreateReadToolsOptions,
  directory: string,
): Promise<Array<{ file: string; content: string }>> {
  const files = await listFiles(options, directory, ['.md']);
  return Promise.all(
    files.map(async (filePath) => ({
      file: workspaceRelativePath(options, filePath),
      content: (await loadWorkspaceMarkdown(options, filePath)).body,
    })),
  );
}

async function readYamlIfExists(
  options: CreateReadToolsOptions,
  filePath: string,
): Promise<unknown | undefined> {
  try {
    return (await loadWorkspaceYaml(options, filePath)).data;
  } catch (error) {
    // if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    //   return undefined;
    // }
    throw error;
  }
}

async function listDirectories(
  options: CreateReadToolsOptions,
  directory: string,
): Promise<string[]> {
  const entries = await readWorkspaceDirectory(options, directory);
  return entries
    .filter((entry) => entry.isDirectory && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

async function listFiles(
  options: CreateReadToolsOptions,
  directory: string,
  extensions: string[],
): Promise<string[]> {
  const entries = await readWorkspaceDirectory(options, directory);
  const files: string[] = [];

  for (const entry of entries) {
    const filePath = workspacePaths(options).join(directory, entry.name);

    if (entry.isDirectory && !entry.name.startsWith('.')) {
      files.push(...(await listFiles(options, filePath, extensions)));
      continue;
    }

    if (entry.isFile && extensions.includes(extname(entry.name))) {
      files.push(filePath);
    }
  }

  return files.sort();
}

// The fixed in-memory projection uses POSIX paths even on a Windows host.
function workspacePaths(options: CreateReadToolsOptions) {
  return options.reader ? posix : hostPath;
}

function workspaceRelativePath(options: CreateReadToolsOptions, filePath: string): string {
  return workspacePaths(options).relative(options.workspaceRoot, filePath).replaceAll('\\', '/');
}

function resolveWorkspacePath(options: CreateReadToolsOptions, ...parts: string[]): string {
  const root = options.workspaceRoot;
  const paths = workspacePaths(options);
  const resolvedRoot = paths.normalize(root);
  const resolved = paths.join(root, ...parts);
  const rel = paths.relative(resolvedRoot, resolved);

  if (rel.startsWith('..') || rel === '') {
    throw new Error(`Path is outside workspace: ${parts.join('/')}`);
  }

  if (options.reader) {
    return resolved;
  }

  const realRoot = realpathSync(resolvedRoot);
  const realResolved = realpathSync(resolved);
  const realRelativePath = relative(realRoot, realResolved);
  if (
    realRelativePath === '..' ||
    realRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(realRelativePath)
  ) {
    throw new Error(`Path resolves outside workspace: ${parts.join('/')}`);
  }

  return resolved;
}

async function readWorkspaceFile(
  options: CreateReadToolsOptions,
  filePath: string,
): Promise<string> {
  if (options.reader) {
    return options.reader.readFile(filePath);
  }
  return readFile(filePath, 'utf-8');
}

async function readWorkspaceDirectory(
  options: CreateReadToolsOptions,
  directory: string,
): Promise<WorkspaceReaderDirectoryEntry[]> {
  if (options.reader) {
    return options.reader.readdir(directory);
  }
  const entries: Dirent[] = await readdir(directory, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
    isSymbolicLink: entry.isSymbolicLink(),
  }));
}

async function loadWorkspaceMarkdown(
  options: CreateReadToolsOptions,
  filePath: string,
): Promise<{ frontmatter?: Record<string, unknown>; body: string }> {
  return parseFrontmatter(await readWorkspaceFile(options, filePath));
}

async function loadWorkspaceYaml(
  options: CreateReadToolsOptions,
  filePath: string,
): Promise<{ data: unknown }> {
  return { data: parseYaml(await readWorkspaceFile(options, filePath)) };
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid path segment: ${value}`);
  }
  return value;
}

function safeRelativePath(value: string): string {
  const normalized = posix.normalize(value);

  if (
    !value || value.includes('\\') || value.includes(':') || value.includes('\0') ||
    normalized.startsWith('..') ||
    normalized.includes('/../') ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment.startsWith('.'))
  ) {
    throw new Error(`Invalid workspace relative path: ${value}`);
  }

  return normalized;
}

function safeNarrativeChapterId(value: string): string {
  const normalized = safeRelativePath(value);
  const parts = normalized.split('/');

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

function getByPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }

    if (isRecord(current)) {
      return current[segment];
    }

    return undefined;
  }, value);
}

function emptyInputSchema() {
  return objectInputSchema({});
}

function objectInputSchema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
) {
  return jsonSchema({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
