import { execFile } from 'node:child_process';
import { isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitCommandError {
  code:
    | 'git_unavailable'
    | 'not_git_repository'
    | 'identity_missing'
    | 'remote_missing'
    | 'auth_failed'
    | 'conflict'
    | 'invalid_input'
    | 'git_failed';
  message: string;
  stderr?: string;
}

export interface GitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  raw: string;
}

export interface GitWorkspaceStatus {
  available: boolean;
  source: 'global';
  version?: string;
  repository: boolean;
  branch?: string;
  head?: string;
  status: 'clean' | 'dirty' | 'unknown';
  dirty: boolean | null;
  files: GitFileStatus[];
  error?: GitCommandError;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  authorName?: string;
  authorEmail?: string;
  authoredAt?: string;
}

export interface GitCommitDetail extends GitCommitSummary {
  body: string;
  files: Array<{
    path: string;
    status: string;
  }>;
  diff: string;
}

export type GitCommitResult =
  | { status: 'committed'; hash: string; message: string }
  | { status: 'skipped'; reason: 'auto_commit_disabled'; message: string }
  | { status: 'failed'; message: string; error: GitCommandError };

export type GitSyncResult =
  | { status: 'synced'; fetch: string; pull: string; push: string }
  | { status: 'failed'; step: 'fetch' | 'pull' | 'push'; error: GitCommandError };

export async function readGitStatus(workspaceRoot: string): Promise<GitWorkspaceStatus> {
  const version = await readGitVersion();
  if (!version.available) {
    return {
      available: false,
      source: 'global',
      repository: false,
      status: 'unknown',
      dirty: null,
      files: [],
      error: version.error,
    };
  }

  const root = await runGit(workspaceRoot, ['rev-parse', '--show-toplevel']);
  if (!root.ok) {
    return {
      available: true,
      source: 'global',
      version: version.version,
      repository: false,
      status: 'unknown',
      dirty: null,
      files: [],
      error: root.error,
    };
  }

  const [branch, head, status] = await Promise.all([
    runGit(workspaceRoot, ['branch', '--show-current']),
    runGit(workspaceRoot, ['rev-parse', 'HEAD']),
    runGit(workspaceRoot, ['status', '--porcelain']),
  ]);

  if (!status.ok) {
    return {
      available: true,
      source: 'global',
      version: version.version,
      repository: true,
      branch: branch.ok ? branch.stdout.trim() || undefined : undefined,
      head: head.ok ? head.stdout.trim() || undefined : undefined,
      status: 'unknown',
      dirty: null,
      files: [],
      error: status.error,
    };
  }

  const files = parseStatusPorcelain(status.stdout);
  const dirty = files.length > 0;

  return {
    available: true,
    source: 'global',
    version: version.version,
    repository: true,
    branch: branch.ok ? branch.stdout.trim() || undefined : undefined,
    head: head.ok ? head.stdout.trim() || undefined : undefined,
    status: dirty ? 'dirty' : 'clean',
    dirty,
    files,
  };
}

export async function gitDiff(workspaceRoot: string, files?: string[]): Promise<string> {
  const args = ['diff'];
  const safeFiles = files?.length ? validateWorkspaceRelativePaths(workspaceRoot, files) : [];
  if (safeFiles.length) {
    args.push('--', ...safeFiles);
  }

  const result = await runGit(workspaceRoot, args);
  if (!result.ok) {
    return '';
  }

  return result.stdout;
}

export async function gitStatusShort(workspaceRoot: string, files?: string[]): Promise<string> {
  const args = ['status', '--short'];
  const safeFiles = files?.length ? validateWorkspaceRelativePaths(workspaceRoot, files) : [];
  if (safeFiles.length) {
    args.push('--', ...safeFiles);
  }

  const result = await runGit(workspaceRoot, args);
  return result.ok ? result.stdout : '';
}

export async function listGitCommits(
  workspaceRoot: string,
  input: { maxCount?: number } = {},
): Promise<{ commits: GitCommitSummary[]; error?: GitCommandError }> {
  const maxCount = Math.min(Math.max(input.maxCount ?? 30, 1), 100);
  const result = await runGit(workspaceRoot, [
    'log',
    `--max-count=${maxCount}`,
    '--date=iso-strict',
    '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s',
  ]);

  if (!result.ok) {
    return { commits: [], error: result.error };
  }

  return {
    commits: result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseLogLine),
  };
}

export async function showGitCommit(
  workspaceRoot: string,
  hash: string,
): Promise<GitCommitDetail | { error: GitCommandError }> {
  if (!/^[0-9a-f]{7,40}$/iu.test(hash)) {
    return {
      error: {
        code: 'invalid_input',
        message: 'Commit hash is invalid.',
      },
    };
  }

  const [metadata, files, diff] = await Promise.all([
    runGit(workspaceRoot, [
      'show',
      '--quiet',
      '--date=iso-strict',
      '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b',
      hash,
    ]),
    runGit(workspaceRoot, ['show', '--name-status', '--format=', hash]),
    runGit(workspaceRoot, ['show', '--format=', '--patch', hash]),
  ]);

  if (!metadata.ok) {
    return { error: metadata.error };
  }

  const summary = parseLogLine(metadata.stdout);
  return {
    ...summary,
    body: metadata.stdout.split('\x1f').slice(6).join('\x1f').trim(),
    files: files.ok ? parseNameStatus(files.stdout) : [],
    diff: diff.ok ? diff.stdout : '',
  };
}

export async function commitFiles(input: {
  workspaceRoot: string;
  files: string[];
  message: string;
}): Promise<GitCommitResult> {
  const files = validateWorkspaceRelativePaths(input.workspaceRoot, input.files);
  const message = input.message.trim();

  if (!files.length) {
    return failedCommit(message, {
      code: 'invalid_input',
      message: 'No files selected for commit.',
    });
  }

  if (!message) {
    return failedCommit(message, {
      code: 'invalid_input',
      message: 'Commit message is required.',
    });
  }

  const stagedBefore = await runGit(input.workspaceRoot, ['diff', '--cached', '--name-only']);
  if (!stagedBefore.ok) {
    return failedCommit(message, stagedBefore.error);
  }

  const stagedFiles = stagedBefore.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const unrelatedStaged = stagedFiles.filter((file) => !files.includes(file));
  if (unrelatedStaged.length > 0) {
    return failedCommit(message, {
      code: 'invalid_input',
      message: `There are staged files outside this commit scope: ${unrelatedStaged.join(', ')}`,
    });
  }

  const statusBefore = await runGit(input.workspaceRoot, ['status', '--porcelain', '--', ...files]);
  if (!statusBefore.ok) {
    return failedCommit(message, statusBefore.error);
  }

  if (!statusBefore.stdout.trim() && stagedFiles.length === 0) {
    return failedCommit(message, {
      code: 'invalid_input',
      message: 'Selected files have no changes to commit.',
    });
  }

  const add = await runGit(input.workspaceRoot, ['add', '--', ...files]);
  if (!add.ok) {
    return failedCommit(message, add.error);
  }

  const commit = await runGit(input.workspaceRoot, ['commit', '-m', message]);
  if (!commit.ok) {
    return failedCommit(message, commit.error);
  }

  const head = await runGit(input.workspaceRoot, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    return failedCommit(message, head.error);
  }

  return {
    status: 'committed',
    hash: head.stdout.trim(),
    message,
  };
}

export async function syncGit(workspaceRoot: string): Promise<GitSyncResult> {
  const fetch = await runGit(workspaceRoot, ['fetch']);
  if (!fetch.ok) {
    return { status: 'failed', step: 'fetch', error: fetch.error };
  }

  const pull = await runGit(workspaceRoot, ['pull', '--ff-only']);
  if (!pull.ok) {
    return { status: 'failed', step: 'pull', error: pull.error };
  }

  const push = await runGit(workspaceRoot, ['push']);
  if (!push.ok) {
    return { status: 'failed', step: 'push', error: push.error };
  }

  return {
    status: 'synced',
    fetch: fetch.stdout,
    pull: pull.stdout,
    push: push.stdout,
  };
}

export function createPendingActionCommitMessage(input: {
  pendingActionId: string;
  title: string;
}): string {
  const shortId = input.pendingActionId.replace(/^pa_/, '').slice(0, 8);
  return [
    `chore(novel): apply pending action ${shortId}`,
    '',
    input.title.trim(),
  ].join('\n');
}

async function readGitVersion(): Promise<
  | { available: true; version: string }
  | { available: false; error: GitCommandError }
> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return { available: true, version: stdout.trim() };
  } catch (error) {
    return {
      available: false,
      error: toGitCommandError(error),
    };
  }
}

async function runGit(
  workspaceRoot: string,
  args: string[],
): Promise<
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; error: GitCommandError }
> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', workspaceRoot, ...args], {
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      error: toGitCommandError(error),
    };
  }
}

function parseStatusPorcelain(stdout: string): GitFileStatus[] {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      path: line.slice(3).trim(),
      indexStatus: line.slice(0, 1).trim() || ' ',
      worktreeStatus: line.slice(1, 2).trim() || ' ',
      raw: line,
    }));
}

function parseLogLine(line: string): GitCommitSummary {
  const [hash = '', shortHash = '', authorName, authorEmail, authoredAt, subject = ''] =
    line.split('\x1f');

  return {
    hash,
    shortHash,
    subject,
    authorName,
    authorEmail,
    authoredAt,
  };
}

function parseNameStatus(stdout: string): Array<{ path: string; status: string }> {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status = '', ...paths] = line.split(/\s+/u);
      return {
        status,
        path: paths.join(' -> '),
      };
    });
}

function validateWorkspaceRelativePaths(workspaceRoot: string, files: string[]): string[] {
  const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))];

  for (const file of uniqueFiles) {
    if (isAbsolute(file)) {
      throw new Error(`Invalid workspace relative path: ${file}`);
    }

    const parts = file.split(/[\\/]+/u).filter(Boolean);
    if (parts.some((part) => part === '..' || part.startsWith('.'))) {
      throw new Error(`Invalid workspace relative path: ${file}`);
    }

    const relativePath = relative(workspaceRoot, `${workspaceRoot}${sep}${file}`);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(`Path is outside workspace: ${file}`);
    }
  }

  return uniqueFiles;
}

function failedCommit(message: string, error: GitCommandError): GitCommitResult {
  return {
    status: 'failed',
    message,
    error,
  };
}

function toGitCommandError(error: unknown): GitCommandError {
  const stderr = readProcessStderr(error);
  const message = stderr || (error instanceof Error ? error.message : String(error));
  const normalized = message.toLowerCase();

  if (normalized.includes('not a git repository')) {
    return { code: 'not_git_repository', message: 'Workspace is not a Git repository.', stderr };
  }

  if (normalized.includes('unable to auto-detect email address') || normalized.includes('please tell me who you are')) {
    return { code: 'identity_missing', message: 'Git user identity is not configured.', stderr };
  }

  if (normalized.includes('no configured push destination') || normalized.includes('does not appear to be a git repository')) {
    return { code: 'remote_missing', message: 'Git remote is not configured.', stderr };
  }

  if (normalized.includes('authentication failed') || normalized.includes('permission denied')) {
    return { code: 'auth_failed', message: 'Git authentication failed.', stderr };
  }

  if (normalized.includes('would be overwritten') || normalized.includes('conflict')) {
    return { code: 'conflict', message: 'Git operation cannot continue because of conflicts.', stderr };
  }

  if (
    normalized.includes('enoent') ||
    normalized.includes('spawn git') ||
    normalized.includes('command not found')
  ) {
    return { code: 'git_unavailable', message: 'Global git command is not available.', stderr };
  }

  return { code: 'git_failed', message: message || 'Git command failed.', stderr };
}

function readProcessStderr(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof (error as { stderr?: unknown }).stderr === 'string'
  ) {
    const stderr = (error as { stderr: string }).stderr.trim();
    return stderr || undefined;
  }

  return undefined;
}
