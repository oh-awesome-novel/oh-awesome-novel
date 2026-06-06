import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, normalize, relative } from 'node:path';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

import { loadMarkdown } from './markdown';
import { loadYaml } from './yaml-engine';

export interface CreateReadToolsOptions {
  workspaceRoot: string;
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
      const characterRoot = resolveWorkspacePath(options.workspaceRoot, 'characters');
      const ids = await listDirectories(characterRoot);
      const characters = await Promise.all(
        ids.map(async (id) => {
          const metaPath = join(characterRoot, id, 'meta.yaml');
          return {
            id,
            meta: await readYamlIfExists(metaPath),
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
        options.workspaceRoot,
        'characters',
        safeSegment(id),
      );
      const files = await readDomainDirectory(characterDir);

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
      const worldRoot = resolveWorkspacePath(options.workspaceRoot, 'world');
      const files = await listFiles(worldRoot, ['.md']);
      const matches = [];

      for (const filePath of files) {
        const rel = relative(worldRoot, filePath);
        if (topic && !rel.startsWith(normalize(topic))) {
          continue;
        }

        const content = await readFile(filePath, 'utf-8');
        if (query && !content.toLowerCase().includes(query) && !rel.toLowerCase().includes(query)) {
          continue;
        }

        matches.push({
          file: relative(options.workspaceRoot, filePath),
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
      const id = expectStringArg(args, 'id');
      const filePath = resolveWorkspacePath(
        options.workspaceRoot,
        'chapters',
        `${safeRelativePath(id)}.md`,
      );
      const document = await loadMarkdown(filePath);

      return {
        id,
        file: relative(options.workspaceRoot, filePath),
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
        const filePath = resolveWorkspacePath(options.workspaceRoot, 'state', safeRelativePath(file));
        const document = await loadYaml(filePath);
        return {
          file: relative(options.workspaceRoot, filePath),
          data: path ? getByPath(document.data, path) : document.data,
        };
      }

      return {
        files: await readYamlDirectory(resolveWorkspacePath(options.workspaceRoot, 'state')),
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
        files: await readYamlDirectory(resolveWorkspacePath(options.workspaceRoot, 'timeline')),
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
        files: await readYamlDirectory(resolveWorkspacePath(options.workspaceRoot, 'foreshadow')),
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
      const filePath = resolveWorkspacePath(options.workspaceRoot, 'summaries', safeRelativePath(file));
      const document = await loadMarkdown(filePath);

      return {
        file: relative(options.workspaceRoot, filePath),
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
      const constitutionRoot = resolveWorkspacePath(options.workspaceRoot, '.oan', 'constitution');

      if (file) {
        const filePath = resolveWorkspacePath(
          options.workspaceRoot,
          '.oan',
          'constitution',
          safeRelativePath(file),
        );
        const document = await loadMarkdown(filePath);
        return {
          file: relative(options.workspaceRoot, filePath),
          content: document.body,
        };
      }

      return {
        files: await readMarkdownDirectory(constitutionRoot, options.workspaceRoot),
      };
    },
  });
}

function workflowGetTool(options: CreateReadToolsOptions) {
  return tool({
    description: 'Read .oan/workflow.yaml.',
    inputSchema: emptyInputSchema(),
    async execute() {
      const filePath = resolveWorkspacePath(options.workspaceRoot, '.oan', 'workflow.yaml');
      const document = await loadYaml(filePath);
      return {
        file: relative(options.workspaceRoot, filePath),
        data: document.data,
      };
    },
  });
}

async function readDomainDirectory(directory: string): Promise<Record<string, unknown>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Record<string, unknown> = {};

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = join(directory, entry.name);
    const extension = extname(entry.name);

    if (extension === '.yaml' || extension === '.yml') {
      files[entry.name] = (await loadYaml(filePath)).data;
    } else if (extension === '.md') {
      const document = await loadMarkdown(filePath);
      files[entry.name] = {
        frontmatter: document.frontmatter,
        content: document.body,
      };
    }
  }

  return files;
}

async function readYamlDirectory(directory: string): Promise<Array<{ file: string; data: unknown }>> {
  const files = await listFiles(directory, ['.yaml', '.yml']);
  return Promise.all(
    files.map(async (filePath) => ({
      file: basename(filePath),
      data: (await loadYaml(filePath)).data,
    })),
  );
}

async function readMarkdownDirectory(
  directory: string,
  workspaceRoot: string,
): Promise<Array<{ file: string; content: string }>> {
  const files = await listFiles(directory, ['.md']);
  return Promise.all(
    files.map(async (filePath) => ({
      file: relative(workspaceRoot, filePath),
      content: (await loadMarkdown(filePath)).body,
    })),
  );
}

async function readYamlIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    return (await loadYaml(filePath)).data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function listDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

async function listFiles(directory: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const filePath = join(directory, entry.name);

    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      files.push(...(await listFiles(filePath, extensions)));
      continue;
    }

    if (entry.isFile() && extensions.includes(extname(entry.name))) {
      files.push(filePath);
    }
  }

  return files.sort();
}

function resolveWorkspacePath(root: string, ...parts: string[]): string {
  const resolvedRoot = normalize(join(root));
  const resolved = normalize(join(root, ...parts));
  const rel = relative(resolvedRoot, resolved);

  if (rel.startsWith('..') || rel === '') {
    throw new Error(`Path is outside workspace: ${parts.join('/')}`);
  }

  return resolved;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid path segment: ${value}`);
  }
  return value;
}

function safeRelativePath(value: string): string {
  const normalized = normalize(value);

  if (
    normalized.startsWith('..') ||
    normalized.includes('/../') ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment.startsWith('.'))
  ) {
    throw new Error(`Invalid workspace relative path: ${value}`);
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
