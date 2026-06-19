import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';

export type ProjectHealthSeverity = 'info' | 'warning' | 'error';

export interface ProjectHealthIssue {
  id: string;
  severity: ProjectHealthSeverity;
  title: string;
  detail: string;
  path?: string;
}

export interface ProjectHealth {
  generatedAt: string;
  missingCharacterCards: string[];
  chaptersWithoutSummaries: string[];
  activeHookCount: number;
  latestStateStale: boolean;
  timelineGapCount: number;
  pendingActionCount: number;
  issues: ProjectHealthIssue[];
}

export interface ReadProjectHealthOptions {
  generatedAt?: string;
  pendingActionCount?: number;
}

export const readProjectHealth = async (
  workspaceRoot: string,
  options: ReadProjectHealthOptions = {},
): Promise<ProjectHealth> => {
  const [
    missingCharacterCards,
    chapters,
    chapterSummaries,
    activeHookCount,
    latestStateStale,
    timelineChapters,
  ] = await Promise.all([
    findMissingCharacterCards(workspaceRoot),
    listChapterIds(workspaceRoot),
    listChapterSummaryIds(workspaceRoot),
    countActiveHooks(workspaceRoot),
    detectLatestStateStale(workspaceRoot),
    listTimelineChapterIds(workspaceRoot),
  ]);

  const chaptersWithoutSummaries = chapters.filter(
    (chapterId) => !chapterSummaries.includes(chapterId),
  );
  const timelineGaps = chapters.filter(
    (chapterId) => !timelineChapters.includes(chapterId),
  );
  const issues: ProjectHealthIssue[] = [
    ...missingCharacterCards.map((characterId) => ({
      id: `missing-character-card:${characterId}`,
      severity: 'warning' as const,
      title: 'Missing character card file',
      detail: `${characterId} is missing meta.yaml or summary.md.`,
      path: `characters/${characterId}`,
    })),
    ...chaptersWithoutSummaries.map((chapterId) => ({
      id: `chapter-summary:${chapterId}`,
      severity: 'warning' as const,
      title: 'Chapter has no summary',
      detail: `${chapterId} has no matching summaries/chapter file.`,
      path: `chapters/${chapterId}.md`,
    })),
    ...timelineGaps.map((chapterId) => ({
      id: `timeline-gap:${chapterId}`,
      severity: 'info' as const,
      title: 'No timeline event for chapter',
      detail: `${chapterId} has chapter text but no timeline event.`,
      path: `chapters/${chapterId}.md`,
    })),
  ];

  if (latestStateStale) {
    issues.push({
      id: 'latest-state-stale',
      severity: 'warning',
      title: 'Latest state may be stale',
      detail: 'A chapter file is newer than the latest state YAML file.',
      path: 'state',
    });
  }

  if (options.pendingActionCount && options.pendingActionCount > 0) {
    issues.push({
      id: 'pending-actions',
      severity: 'info',
      title: 'PendingAction exists',
      detail: `${options.pendingActionCount} pending action(s) need review.`,
    });
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    missingCharacterCards,
    chaptersWithoutSummaries,
    activeHookCount,
    latestStateStale,
    timelineGapCount: timelineGaps.length,
    pendingActionCount: options.pendingActionCount ?? 0,
    issues,
  };
};

export const formatProjectHealthMarkdown = (health: ProjectHealth): string => [
  '## Project Health',
  '',
  `Generated: ${health.generatedAt}`,
  '',
  `- missing character cards: ${health.missingCharacterCards.length}`,
  `- chapters without summaries: ${health.chaptersWithoutSummaries.length}`,
  `- active hooks: ${health.activeHookCount}`,
  `- latest state stale: ${health.latestStateStale ? 'yes' : 'no'}`,
  `- timeline gaps: ${health.timelineGapCount}`,
  `- pending actions: ${health.pendingActionCount}`,
  '',
  '### Issues',
  health.issues.length
    ? health.issues.map((issue) => `- [${issue.severity}] ${issue.title}: ${issue.detail}`).join('\n')
    : '- none',
].join('\n');

async function findMissingCharacterCards(workspaceRoot: string): Promise<string[]> {
  const charactersRoot = resolveWorkspacePath(workspaceRoot, 'characters');

  try {
    const entries = await readdir(charactersRoot, { withFileTypes: true });
    const characterIds = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const missing = await Promise.all(
      characterIds.map(async (characterId) => {
        const hasMeta = await exists(join(charactersRoot, characterId, 'meta.yaml'));
        const hasSummary = await exists(join(charactersRoot, characterId, 'summary.md'));

        return hasMeta && hasSummary ? undefined : characterId;
      }),
    );

    return missing.filter((characterId): characterId is string => Boolean(characterId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function listChapterIds(workspaceRoot: string): Promise<string[]> {
  const chaptersRoot = resolveWorkspacePath(workspaceRoot, 'chapters');
  const files = await readFilesIfExists(chaptersRoot, ['.md']);

  return files
    .filter((file) => !file.endsWith('/0000.md'))
    .map((file) => file.replace(/\.md$/, ''))
    .sort();
}

async function listChapterSummaryIds(workspaceRoot: string): Promise<string[]> {
  const summariesRoot = resolveWorkspacePath(workspaceRoot, 'summaries', 'chapter');
  const files = await readFilesIfExists(summariesRoot, ['.md']);

  return files.map((file) => file.replace(/\.md$/, '')).sort();
}

async function countActiveHooks(workspaceRoot: string): Promise<number> {
  const activePath = resolveWorkspacePath(workspaceRoot, 'foreshadow', 'active.yaml');

  try {
    const parsed = parse(await readFile(activePath, 'utf-8')) as unknown;

    if (isRecord(parsed) && Array.isArray(parsed.active)) {
      return parsed.active.length;
    }

    return 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

async function listTimelineChapterIds(workspaceRoot: string): Promise<string[]> {
  const eventsPath = resolveWorkspacePath(workspaceRoot, 'timeline', 'events.yaml');

  try {
    const parsed = parse(await readFile(eventsPath, 'utf-8')) as unknown;

    if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
      return [];
    }

    return [
      ...new Set(
        parsed.events
          .filter(isRecord)
          .map((event) => event.chapter)
          .filter((chapter): chapter is string => typeof chapter === 'string'),
      ),
    ].sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function detectLatestStateStale(workspaceRoot: string): Promise<boolean> {
  const [chapterFiles, stateFiles] = await Promise.all([
    readFilesWithMtimeIfExists(resolveWorkspacePath(workspaceRoot, 'chapters'), ['.md']),
    readFilesWithMtimeIfExists(resolveWorkspacePath(workspaceRoot, 'state'), ['.yaml', '.yml']),
  ]);
  const latestChapter = Math.max(
    0,
    ...chapterFiles
      .filter((file) => !file.path.endsWith('/0000.md'))
      .map((file) => file.mtimeMs),
  );
  const latestState = Math.max(0, ...stateFiles.map((file) => file.mtimeMs));

  return latestChapter > latestState;
}

async function readFilesIfExists(
  directory: string,
  extensions: string[],
): Promise<string[]> {
  try {
    const files = await readDirectoryFiles(directory);

    return files
      .filter((file) => extensions.some((extension) => file.endsWith(extension)))
      .map((file) => relative(directory, file))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function readFilesWithMtimeIfExists(
  directory: string,
  extensions: string[],
): Promise<Array<{ path: string; mtimeMs: number }>> {
  try {
    const files = await readDirectoryFiles(directory);
    const matchingFiles = files
      .filter((file) => extensions.some((extension) => file.endsWith(extension)))
      .sort();

    return Promise.all(
      matchingFiles.map(async (file) => ({
        path: relative(directory, file),
        mtimeMs: (await stat(file)).mtimeMs,
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
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
    throw new Error('Project health path must stay inside workspace.');
  }

  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
