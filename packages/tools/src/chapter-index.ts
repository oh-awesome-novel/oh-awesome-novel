import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';

import { loadMarkdown, parseSections } from './markdown';

const execFileAsync = promisify(execFile);
const CHAPTER_INDEX_PATH = join('.oan', 'indexes', 'chapters.yaml');

export interface ChapterIndex {
  volumes: ChapterIndexVolume[];
}

export interface ChapterIndexVolume {
  id: string;
  path: string;
  title: string;
  metadataPath: string;
  chapters: ChapterIndexChapter[];
}

export interface ChapterIndexChapter {
  id: string;
  path: string;
  title: string;
  volumeId: string;
  chapterNumber: string;
}

export interface PersistedChapterIndex extends ChapterIndex {
  kind: 'chapter-index';
  version: 1;
  generatedAt: string;
  git: {
    head: string | null;
    dirty: boolean;
  };
  source: {
    root: 'chapters';
  };
}

export type ChapterIndexStatus = 'missing' | 'current' | 'stale' | 'unknown' | 'dirty';

export interface ChapterIndexStatusResult {
  index: PersistedChapterIndex | null;
  status: ChapterIndexStatus;
  currentGitHead: string | null;
  dirty: boolean;
}

export async function buildChapterIndex(options: {
  workspaceRoot: string;
}): Promise<ChapterIndex> {
  const workspaceRoot = await realpath(options.workspaceRoot);
  const chaptersRoot = resolveInsideWorkspace(workspaceRoot, 'chapters');

  if (!(await isDirectory(chaptersRoot))) {
    return { volumes: [] };
  }

  const entries = await readdir(chaptersRoot, { withFileTypes: true });
  const volumeIds = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(left) - Number(right));
  const volumes = await Promise.all(
    volumeIds.map((volumeId) => buildVolumeIndex(workspaceRoot, chaptersRoot, volumeId)),
  );

  return { volumes };
}

export async function writeChapterIndexFile(options: {
  workspaceRoot: string;
}): Promise<PersistedChapterIndex> {
  const workspaceRoot = await realpath(options.workspaceRoot);
  const index = await buildChapterIndex({ workspaceRoot });
  const git = await readGitState(workspaceRoot);
  const persisted: PersistedChapterIndex = {
    kind: 'chapter-index',
    version: 1,
    generatedAt: new Date().toISOString(),
    git,
    source: { root: 'chapters' },
    volumes: index.volumes,
  };
  const indexPath = resolveInsideWorkspace(workspaceRoot, CHAPTER_INDEX_PATH);

  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, stringify(persisted), 'utf-8');

  return persisted;
}

export async function readChapterIndexStatus(options: {
  workspaceRoot: string;
}): Promise<ChapterIndexStatusResult> {
  const workspaceRoot = await realpath(options.workspaceRoot);
  const git = await readGitState(workspaceRoot);
  const indexPath = resolveInsideWorkspace(workspaceRoot, CHAPTER_INDEX_PATH);
  let index: PersistedChapterIndex | null = null;

  try {
    const parsed = parse(await readFile(indexPath, 'utf-8')) as unknown;
    index = isPersistedChapterIndex(parsed) ? parsed : null;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  if (!index) {
    return {
      index: null,
      status: 'missing',
      currentGitHead: git.head,
      dirty: git.dirty,
    };
  }

  if (!git.head || !index.git.head) {
    return {
      index,
      status: 'unknown',
      currentGitHead: git.head,
      dirty: git.dirty,
    };
  }

  if (git.dirty) {
    return {
      index,
      status: 'dirty',
      currentGitHead: git.head,
      dirty: true,
    };
  }

  return {
    index,
    status: git.head === index.git.head ? 'current' : 'stale',
    currentGitHead: git.head,
    dirty: false,
  };
}

async function buildVolumeIndex(
  workspaceRoot: string,
  chaptersRoot: string,
  volumeId: string,
): Promise<ChapterIndexVolume> {
  const volumeRoot = join(chaptersRoot, volumeId);
  const metadataPath = join('chapters', volumeId, '0000.md');
  const title = await readTitle({
    filePath: join(volumeRoot, '0000.md'),
    fallback: `${volumeId} 未命名卷`,
  });
  const entries = await readdir(volumeRoot, { withFileTypes: true });
  const chapterFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^\d{4}\.md$/.test(entry.name) &&
        entry.name !== '0000.md',
    )
    .map((entry) => entry.name)
    .sort((left, right) => Number(basename(left, '.md')) - Number(basename(right, '.md')));
  const chapters = await Promise.all(
    chapterFiles.map(async (chapterFile) => {
      const chapterNumber = basename(chapterFile, '.md');
      const id = `${volumeId}/${chapterNumber}`;
      const path = join('chapters', volumeId, chapterFile);

      return {
        id,
        path,
        title: await readTitle({
          filePath: resolveInsideWorkspace(workspaceRoot, path),
          fallback: `${id} 未命名章节`,
        }),
        volumeId,
        chapterNumber,
      };
    }),
  );

  return {
    id: volumeId,
    path: join('chapters', volumeId),
    title,
    metadataPath,
    chapters,
  };
}

async function readTitle(input: {
  filePath: string;
  fallback: string;
}): Promise<string> {
  try {
    const document = await loadMarkdown(input.filePath);
    const frontmatterTitle = document.frontmatter?.title;

    if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim()) {
      return frontmatterTitle.trim();
    }

    const heading = parseSections(document.body).find((section) => section.level === 1);
    return heading?.title.trim() || input.fallback;
  } catch (error) {
    if (isNotFoundError(error)) {
      return input.fallback;
    }

    throw error;
  }
}

async function readGitState(workspaceRoot: string): Promise<{
  head: string | null;
  dirty: boolean;
}> {
  const head = await readGitHead(workspaceRoot);
  const dirty = head ? await readGitDirty(workspaceRoot) : false;

  return { head, dirty };
}

async function readGitHead(workspaceRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', workspaceRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readGitDirty(workspaceRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', workspaceRoot, 'status', '--porcelain'], {
      encoding: 'utf-8',
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

function resolveInsideWorkspace(workspaceRoot: string, path: string): string {
  if (!path.trim() || isAbsolute(path)) {
    throw new Error(`Invalid workspace path: ${path}`);
  }

  const absolutePath = resolve(workspaceRoot, path);
  const relativePath = relative(workspaceRoot, absolutePath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Path is outside workspace: ${path}`);
  }

  return absolutePath;
}

function isPersistedChapterIndex(value: unknown): value is PersistedChapterIndex {
  return (
    isRecord(value) &&
    value.kind === 'chapter-index' &&
    value.version === 1 &&
    typeof value.generatedAt === 'string' &&
    isRecord(value.git) &&
    (typeof value.git.head === 'string' || value.git.head === null) &&
    typeof value.git.dirty === 'boolean' &&
    isRecord(value.source) &&
    value.source.root === 'chapters' &&
    Array.isArray(value.volumes)
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
