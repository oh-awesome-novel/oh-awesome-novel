import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type ProjectionTarget =
  | 'state'
  | 'foreshadow'
  | 'timeline'
  | 'progress'
  | 'contextSnapshot';

export interface ProjectionDocument {
  target: ProjectionTarget;
  path: string;
  content: string;
}

export const PROJECTION_TARGETS: Record<ProjectionTarget, string> = {
  state: '.oan/indexes/state.md',
  foreshadow: '.oan/indexes/foreshadow.md',
  timeline: '.oan/indexes/timeline.md',
  progress: '.oan/indexes/progress.md',
  contextSnapshot: '.oan/indexes/context-snapshot.md',
};

export const PROJECTION_WARNING =
  '> Generated projection. Rebuild from canonical Object File Tree; do not edit as source of truth.';

export const buildWorkspaceProjectionDocuments = async (
  workspaceRoot: string,
): Promise<ProjectionDocument[]> => {
  const [stateFiles, foreshadowFiles, timelineFiles, summaryFiles, chapterFiles] =
    await Promise.all([
      readTextFiles(resolveWorkspacePath(workspaceRoot, 'state'), ['.yaml', '.yml']),
      readTextFiles(resolveWorkspacePath(workspaceRoot, 'foreshadow'), ['.yaml', '.yml']),
      readTextFiles(resolveWorkspacePath(workspaceRoot, 'timeline'), ['.yaml', '.yml', '.md']),
      readTextFiles(resolveWorkspacePath(workspaceRoot, 'summaries'), ['.md']),
      readTextFiles(resolveWorkspacePath(workspaceRoot, 'chapters'), ['.md']),
    ]);

  return [
    {
      target: 'state',
      path: PROJECTION_TARGETS.state,
      content: renderProjection('State Current View', stateFiles),
    },
    {
      target: 'foreshadow',
      path: PROJECTION_TARGETS.foreshadow,
      content: renderProjection('Foreshadow Ledger', foreshadowFiles),
    },
    {
      target: 'timeline',
      path: PROJECTION_TARGETS.timeline,
      content: renderProjection('Timeline View', timelineFiles),
    },
    {
      target: 'progress',
      path: PROJECTION_TARGETS.progress,
      content: [
        '# Progress Summary',
        '',
        PROJECTION_WARNING,
        '',
        `- chapters: ${chapterFiles.length}`,
        `- summaries: ${summaryFiles.length}`,
        '',
        '## Latest Summary Files',
        formatFileLinks(summaryFiles.map((file) => file.path)),
      ].join('\n'),
    },
    {
      target: 'contextSnapshot',
      path: PROJECTION_TARGETS.contextSnapshot,
      content: [
        '# Context Snapshot',
        '',
        PROJECTION_WARNING,
        '',
        '## Canonical Source Counts',
        '',
        `- state files: ${stateFiles.length}`,
        `- foreshadow files: ${foreshadowFiles.length}`,
        `- timeline files: ${timelineFiles.length}`,
        `- summary files: ${summaryFiles.length}`,
        `- chapter files: ${chapterFiles.length}`,
      ].join('\n'),
    },
  ];
};

export const writeWorkspaceProjections = async (
  workspaceRoot: string,
): Promise<ProjectionDocument[]> => {
  const documents = await buildWorkspaceProjectionDocuments(workspaceRoot);

  for (const document of documents) {
    const filePath = resolveWorkspacePath(workspaceRoot, document.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${document.content}\n`, 'utf-8');
  }

  return documents;
};

function renderProjection(title: string, files: TextFileSnapshot[]): string {
  return [
    `# ${title}`,
    '',
    PROJECTION_WARNING,
    '',
    ...files.flatMap((file) => [
      `## ${file.path}`,
      '',
      '```',
      file.content.trim(),
      '```',
      '',
    ]),
  ].join('\n').trimEnd();
}

interface TextFileSnapshot {
  path: string;
  content: string;
}

async function readTextFiles(
  directory: string,
  extensions: string[],
): Promise<TextFileSnapshot[]> {
  try {
    const entries = await readDirectoryFiles(directory);

    const matchingFiles = entries
      .filter((file) => extensions.some((extension) => file.endsWith(extension)))
      .sort();

    return Promise.all(
      matchingFiles.map(async (file) => ({
        path: relative(directory, file),
        content: await readFile(file, 'utf-8'),
      })),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function readDirectoryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return readDirectoryFiles(absolutePath);
      }

      if (!entry.isFile()) {
        return [];
      }

      return [absolutePath];
    }),
  );

  return files.flat();
}

function resolveWorkspacePath(workspaceRoot: string, ...segments: string[]): string {
  const workspace = resolve(workspaceRoot);
  const target = resolve(workspace, ...segments);
  const targetRelativePath = relative(workspace, target);

  if (
    targetRelativePath.startsWith('..') ||
    targetRelativePath === '' ||
    targetRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Projection path must stay inside workspace.');
  }

  return target;
}

function formatFileLinks(paths: string[]): string {
  return paths.length ? paths.map((path) => `- ${path}`).join('\n') : '- none';
}
