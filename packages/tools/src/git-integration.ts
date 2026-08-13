import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RepositoryBaseline {
  repositoryId: string;
  branch: string;
  head: string;
}

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

export interface PendingActionGitBaselineFile {
  path: string;
  exists: boolean;
  sha256?: string;
  mode?: number;
}

export interface PendingActionGitPreflight {
  branch: string;
  head: string;
  stagedFiles: string[];
  unrelatedStagedFiles: string[];
  dirtyBaselineFiles: string[];
}

export type PendingActionScopedCommitResult =
  | { status: 'committed'; commit: string; branch: string }
  | { status: 'staged-not-committed'; branch: string; errorCode: string }
  | { status: 'failed'; errorCode: string };

export interface PendingActionHeadCommit {
  commit: string;
  branch: string;
}

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

export async function readRepositoryBaseline(
  workspaceRoot: string,
): Promise<RepositoryBaseline> {
  const [root, branch, head] = await Promise.all([
    runGit(workspaceRoot, ['rev-parse', '--show-toplevel']),
    runGit(workspaceRoot, ['branch', '--show-current']),
    runGit(workspaceRoot, ['rev-parse', 'HEAD']),
  ]);
  if (!root.ok) throw gitResultError(root.error);
  if (!branch.ok) throw gitResultError(branch.error);
  if (!head.ok) throw gitResultError(head.error);

  const repositoryRoot = await realpath(root.stdout.trim());
  const branchName = branch.stdout.trim();
  return {
    repositoryId: createHash('sha256').update(repositoryRoot).digest('hex'),
    branch: branchName || `detached:${head.stdout.trim()}`,
    head: head.stdout.trim(),
  };
}

export async function assertRepositoryBaseline(
  workspaceRoot: string,
  expected: RepositoryBaseline,
): Promise<void> {
  const actual = await readRepositoryBaseline(workspaceRoot);
  if (
    actual.repositoryId !== expected.repositoryId
    || actual.branch !== expected.branch
    || actual.head !== expected.head
  ) {
    const error = new Error('Repository baseline is stale.');
    Object.assign(error, { code: 'STALE_REPOSITORY_BASELINE' });
    throw error;
  }
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

  const stagedBefore = await runGit(input.workspaceRoot, [
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '-z',
  ]);
  if (!stagedBefore.ok) {
    return failedCommit(message, stagedBefore.error);
  }

  const stagedFiles = parseNulPaths(stagedBefore.stdout);
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

/**
 * Revalidates the Git boundary used by ChangeMaterializer. The baseline check
 * is against the proposal HEAD, not the current worktree: this detects user
 * edits that already existed before the accepted candidate was materialized.
 */
export async function inspectPendingActionGitPreflight(input: {
  workspaceRoot: string;
  expected: RepositoryBaseline;
  files: readonly PendingActionGitBaselineFile[];
}): Promise<PendingActionGitPreflight> {
  await assertRepositoryBaseline(input.workspaceRoot, input.expected);
  const paths = validateWorkspaceRelativePaths(
    input.workspaceRoot,
    input.files.map((file) => file.path),
  );
  if (paths.length !== input.files.length) {
    throw Object.assign(new Error('PendingAction Git paths contain duplicates.'), {
      code: 'invalid_input',
    });
  }

  const staged = await runGit(input.workspaceRoot, [
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '-z',
  ]);
  if (!staged.ok) throw gitResultError(staged.error);
  const stagedFiles = parseNulPaths(staged.stdout);
  const acceptedPaths = new Set(paths);
  const unrelatedStagedFiles = stagedFiles.filter((file) => !acceptedPaths.has(file));

  const dirtyBaselineFiles: string[] = [];
  for (const file of input.files) {
    const headEntry = await readHeadFile(input.workspaceRoot, input.expected.head, file.path);
    if (!file.exists) {
      if (headEntry !== undefined) dirtyBaselineFiles.push(file.path);
      continue;
    }
    if (
      headEntry === undefined
      || headEntry.sha256 !== file.sha256
      || headEntry.mode !== file.mode
    ) {
      dirtyBaselineFiles.push(file.path);
    }
  }

  return {
    branch: input.expected.branch,
    head: input.expected.head,
    stagedFiles,
    unrelatedStagedFiles,
    dirtyBaselineFiles,
  };
}

/**
 * Stages and commits only an already accepted action's paths. `onStaged` is
 * awaited after `git add` so the caller can durably record the recovery point.
 */
export async function commitPendingActionFiles(input: {
  workspaceRoot: string;
  files: readonly string[];
  message: string;
  onStaged?: () => Promise<void>;
}): Promise<PendingActionScopedCommitResult> {
  const files = validateWorkspaceRelativePaths(input.workspaceRoot, [...input.files]);
  if (files.length === 0) return { status: 'failed', errorCode: 'invalid_input' };

  const branch = await runGit(input.workspaceRoot, ['branch', '--show-current']);
  if (!branch.ok) return { status: 'failed', errorCode: branch.error.code };
  const branchName = branch.stdout.trim();
  if (!branchName) return { status: 'failed', errorCode: 'detached_head' };

  const stagedBefore = await runGit(input.workspaceRoot, [
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '-z',
  ]);
  if (!stagedBefore.ok) return { status: 'failed', errorCode: stagedBefore.error.code };
  const acceptedPaths = new Set(files);
  const unrelated = parseNulPaths(stagedBefore.stdout)
    .filter((file) => !acceptedPaths.has(file));
  if (unrelated.length > 0) {
    return { status: 'failed', errorCode: 'unrelated_staged_files' };
  }

  // An accepted path may already be staged with bytes that differ from the
  // approved final state. Always rebuild every accepted index entry from the
  // canonical files that ChangeMaterializer just revalidated.
  // `git add -A -- deleted-path` fails when that deletion is already staged,
  // because the path exists in neither the worktree nor the index. update-index
  // provides the equivalent exact-path refresh and is idempotent for staged
  // deletions while still replacing pre-existing staged create/update bytes.
  const add = await runGit(input.workspaceRoot, [
    'update-index',
    '--add',
    '--remove',
    '--',
    ...files,
  ]);
  if (!add.ok) return { status: 'failed', errorCode: add.error.code };
  const stagedAfter = await runGit(input.workspaceRoot, [
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '-z',
  ]);
  if (!stagedAfter.ok) return { status: 'failed', errorCode: stagedAfter.error.code };
  const stagedAfterFiles = parseNulPaths(stagedAfter.stdout);
  if (
    stagedAfterFiles.length !== files.length
    || stagedAfterFiles.some((file) => !acceptedPaths.has(file))
  ) {
    return { status: 'failed', errorCode: 'incomplete_staged_action' };
  }
  try {
    await input.onStaged?.();
  } catch (error) {
    return {
      status: 'staged-not-committed',
      branch: branchName,
      errorCode: safeErrorCode(error, 'after_git_add_failed'),
    };
  }

  const commit = await runGit(input.workspaceRoot, ['commit', '-m', input.message]);
  if (!commit.ok) {
    return {
      status: 'staged-not-committed',
      branch: branchName,
      errorCode: commit.error.code,
    };
  }
  const head = await runGit(input.workspaceRoot, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    return {
      status: 'staged-not-committed',
      branch: branchName,
      errorCode: head.error.code,
    };
  }
  return { status: 'committed', commit: head.stdout.trim(), branch: branchName };
}

/** Finds the crash window where Git committed but the decision receipt did not. */
export async function readPendingActionCommitAtHead(input: {
  workspaceRoot: string;
  actionId: string;
  files: readonly string[];
}): Promise<PendingActionHeadCommit | undefined> {
  const files = validateWorkspaceRelativePaths(input.workspaceRoot, [...input.files]).sort();
  const [head, branch, body, changed] = await Promise.all([
    runGit(input.workspaceRoot, ['rev-parse', 'HEAD']),
    runGit(input.workspaceRoot, ['branch', '--show-current']),
    runGit(input.workspaceRoot, ['show', '-s', '--format=%B', 'HEAD']),
    runGit(input.workspaceRoot, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '--no-renames',
      '-z',
      '-r',
      'HEAD',
    ]),
  ]);
  if (!head.ok || !branch.ok || !body.ok || !changed.ok) return undefined;
  if (!body.stdout.split('\n').some((line) => line.trim() === `Pending-Action-Id: ${input.actionId}`)) {
    return undefined;
  }
  const committedFiles = parseNulPaths(changed.stdout).sort();
  if (
    committedFiles.length !== files.length
    || committedFiles.some((file, index) => file !== files[index])
  ) {
    return undefined;
  }
  const branchName = branch.stdout.trim();
  if (!branchName) return undefined;
  return { commit: head.stdout.trim(), branch: branchName };
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
    '',
    `Pending-Action-Id: ${input.pendingActionId}`,
  ].join('\n');
}

async function readHeadFile(
  workspaceRoot: string,
  head: string,
  path: string,
): Promise<{ sha256: string; mode: number } | undefined> {
  const tree = await runGit(workspaceRoot, ['ls-tree', '-z', head, '--', path]);
  if (!tree.ok) throw gitResultError(tree.error);
  const records = tree.stdout.split('\0').filter((record) => record.length > 0);
  if (records.length === 0) return undefined;
  if (records.length !== 1) {
    throw Object.assign(new Error(`Git tree returned multiple entries for ${path}.`), {
      code: 'git_failed',
    });
  }
  const match = /^(\d+)\s+blob\s+([0-9a-f]{40,64})\t([\s\S]+)$/u.exec(records[0]!);
  if (!match || match[3] !== path) {
    throw Object.assign(new Error(`Git tree entry is invalid for ${path}.`), {
      code: 'git_failed',
    });
  }
  const blob = await runGit(workspaceRoot, ['cat-file', 'blob', match[2]!]);
  if (!blob.ok) throw gitResultError(blob.error);
  return {
    sha256: createHash('sha256').update(blob.stdout, 'utf8').digest('hex'),
    mode: Number.parseInt(match[1]!, 8) & 0o777,
  };
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

function parseNulPaths(stdout: string): string[] {
  if (stdout.length === 0) return [];
  const fields = stdout.split('\0');
  if (fields.at(-1) !== '') {
    throw Object.assign(new Error('Git path output was not NUL terminated.'), {
      code: 'git_failed',
    });
  }
  fields.pop();
  return fields;
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

function safeErrorCode(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof code === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(code)
    ? code
    : fallback;
}

function gitResultError(error: GitCommandError): Error {
  const result = new Error(error.message);
  Object.assign(result, { code: error.code, stderr: error.stderr });
  return result;
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
