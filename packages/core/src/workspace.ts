import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceInitOptions {
  /** Override the default global OAN config directory (`~/.oan/`). */
  globalConfigDir?: string;
  /** Persist the initialized workspace to the user's workspace list. */
  saveToWorkspaceList?: boolean;
  /** Human-readable name used when saving to the workspace list. */
  workspaceName?: string;
}

export interface WorkspaceConfig {
  /** Absolute path to the workspace root directory. */
  rootDir: string;
}

export interface WorkspaceEntry {
  /** Human-readable name for the workspace. */
  name: string;
  /** Absolute path to the workspace root directory. */
  path: string;
}

export interface WorkspaceList {
  workspaces: WorkspaceEntry[];
}

export interface ChapterPathParts {
  volumeDir: string;
  chapterFile: string;
  relativePath: string;
  absolutePath: string;
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `targetDir` is an empty directory.
 *
 * Returns `true` when the directory exists and contains no entries
 * (excluding hidden entries such as `.DS_Store`).
 * Throws if the path does not exist or is not a directory.
 */
export async function isEmptyDirectory(targetDir: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${targetDir}`);
    }
    if (code === 'ENOTDIR') {
      throw new Error(`Path is not a directory: ${targetDir}`);
    }
    throw err;
  }

  // Ignore common macOS metadata files
  const visible = entries.filter((e) => e !== '.DS_Store');
  return visible.length === 0;
}

// ---------------------------------------------------------------------------
// resolveGlobalOanConfigDir
// ---------------------------------------------------------------------------

/**
 * Resolve the global OAN configuration directory.
 *
 * Default: `~/.oan/`
 * Can be overridden via `options.globalConfigDir`.
 */
export function resolveGlobalOanConfigDir(
  options?: WorkspaceInitOptions,
): string {
  if (options?.globalConfigDir) {
    return options.globalConfigDir;
  }
  return join(homedir(), '.oan');
}

// ---------------------------------------------------------------------------
// Workspace list
// ---------------------------------------------------------------------------

const WORKSPACE_LIST_FILENAME = 'workspace-list.json';

function workspaceListPath(globalConfigDir: string): string {
  return join(globalConfigDir, WORKSPACE_LIST_FILENAME);
}

/**
 * Load the workspace list from the global config directory.
 *
 * Returns an empty list if the file does not exist yet.
 */
export async function loadWorkspaceList(
  globalConfigDir: string,
): Promise<WorkspaceList> {
  const filePath = workspaceListPath(globalConfigDir);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return assertWorkspaceList(parsed, filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { workspaces: [] };
    }
    throw err;
  }
}

/**
 * Save the workspace list to the global config directory.
 *
 * The directory is created if it does not exist.
 */
export async function saveWorkspaceList(
  globalConfigDir: string,
  workspaces: WorkspaceList,
): Promise<void> {
  assertWorkspaceList(workspaces, 'workspace list');
  await mkdir(globalConfigDir, { recursive: true });
  const filePath = workspaceListPath(globalConfigDir);
  await writeFile(filePath, JSON.stringify(workspaces, null, 2), 'utf-8');
}

function assertWorkspaceList(value: unknown, source: string): WorkspaceList {
  if (!isRecord(value) || !Array.isArray(value.workspaces)) {
    throw new Error(`Invalid workspace list: ${source}`);
  }

  for (const workspace of value.workspaces) {
    if (
      !isRecord(workspace) ||
      typeof workspace.name !== 'string' ||
      typeof workspace.path !== 'string'
    ) {
      throw new Error(`Invalid workspace entry in: ${source}`);
    }
  }

  return { workspaces: value.workspaces };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---------------------------------------------------------------------------
// initWorkspace
// ---------------------------------------------------------------------------

/** Directories created inside the workspace root. */
const WORKSPACE_SUBDIRS = [
  'chapters',
  'characters',
  'world',
  'state',
  'timeline',
  'foreshadow',
  'summaries',
  'schemas',
] as const;

/** Directories created inside `.oan/`. */
const OAN_SUBDIRS = ['constitution', 'prompts', 'skills', 'extensions'] as const;

const NOVEL_BODY_NUMBER_WIDTH = 4;

export function formatVolumeDirectoryName(volumeNumber: number): string {
  return formatPositiveOrdinal(volumeNumber, 'volumeNumber');
}

export function formatChapterFileName(chapterNumber: number): string {
  return `${formatNonNegativeOrdinal(chapterNumber, 'chapterNumber')}.md`;
}

export function resolveChapterFilePath(
  rootDir: string,
  volumeNumber: number,
  chapterNumber: number,
): ChapterPathParts {
  const volumeDir = formatVolumeDirectoryName(volumeNumber);
  const chapterFile = formatChapterFileName(chapterNumber);
  const relativePath = join('chapters', volumeDir, chapterFile);

  return {
    volumeDir,
    chapterFile,
    relativePath,
    absolutePath: join(resolve(rootDir), relativePath),
  };
}

function formatPositiveOrdinal(value: number, fieldName: string): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return value.toString().padStart(NOVEL_BODY_NUMBER_WIDTH, '0');
}

function formatNonNegativeOrdinal(value: number, fieldName: string): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return value.toString().padStart(NOVEL_BODY_NUMBER_WIDTH, '0');
}

/**
 * Initialise a new novel workspace in `targetDir`.
 *
 * - `targetDir` **must** be an empty directory (`.DS_Store` ignored).
 * - Creates the full directory tree under `.oan/` for runtime config
 *   plus all content directories.
 * - Writes a default `.oan/workflow.yaml` and `.oan/config.yaml`.
 *
 * Returns a `WorkspaceConfig` with the absolute root path.
 */
export async function initWorkspace(
  targetDir: string,
  options?: WorkspaceInitOptions,
): Promise<WorkspaceConfig> {
  // Validate emptiness
  const empty = await isEmptyDirectory(targetDir);
  if (!empty) {
    throw new Error(
      `Cannot initialise workspace: directory is not empty: ${targetDir}`,
    );
  }

  const rootDir = resolve(targetDir);

  // --- Content directories -----------------------------------------------
  for (const dir of WORKSPACE_SUBDIRS) {
    await mkdir(join(rootDir, dir), { recursive: true });
  }

  // --- .oan runtime config directories -----------------------------------
  const oanDir = join(rootDir, '.oan');
  await mkdir(oanDir, { recursive: true });

  for (const dir of OAN_SUBDIRS) {
    await mkdir(join(oanDir, dir), { recursive: true });
  }

  // --- Default workflow.yaml --------------------------------------------
  const defaultWorkflow = `name: lightnovel
steps:
  - constitution
  - world
  - character
  - outline
  - chapter
  - summary
  - review
`;
  await writeFile(join(oanDir, 'workflow.yaml'), defaultWorkflow, 'utf-8');

  // --- Default config.yaml ----------------------------------------------
  const defaultConfig = `# oh-awesome-novel workspace config
# Edit this file to customise your workspace settings.
version: 1
`;
  await writeFile(join(oanDir, 'config.yaml'), defaultConfig, 'utf-8');

  if (options?.saveToWorkspaceList) {
    const globalConfigDir = resolveGlobalOanConfigDir(options);
    const list = await loadWorkspaceList(globalConfigDir);
    const workspaceName = options.workspaceName ?? basename(rootDir);
    const workspaces = [
      ...list.workspaces.filter((workspace) => workspace.path !== rootDir),
      { name: workspaceName, path: rootDir },
    ];

    await saveWorkspaceList(globalConfigDir, { workspaces });
  }

  return { rootDir };
}
