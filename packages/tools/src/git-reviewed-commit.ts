import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readGitStatus, readRepositoryBaseline, reviewedGitHelpers } from './git-integration';
import type { GitCommitResult, RepositoryBaseline } from './git-integration';

const { runGit, validateWorkspaceRelativePaths, assertGitFilePaths, gitResultError } = reviewedGitHelpers;
const TTL = 15 * 60_000;
const MAX_PREVIEWS = 64;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_RECOVERY_INDEX_BYTES = 64 * 1024 * 1024;
const previews = new Map<string, Snapshot>();
export interface GitCommitPreview {
  id: string;
  fingerprint: string;
  files: string[];
  head: string;
  expiresAt: string;
}
export interface GitDiffPreview { diff: string; preview: GitCommitPreview | null }
export interface ReviewedGitCommitInput {
  workspaceRoot: string;
  files: string[];
  message: string;
  previewId: string;
  previewFingerprint: string;
  /** Fault/concurrency seam for host tests only; never supplied by HTTP. */
  faultInjector?: (point: 'after-validation' | 'after-ref-prepare' | 'after-ref-update' | 'after-index-rename') => Promise<void>;
}
interface FileEvidence { path: string; sha256: string | null; mode: number | null; bytes: number }
interface Snapshot {
  public: GitCommitPreview;
  root: string;
  repository: RepositoryBaseline;
  indexPath: string;
  indexHash: string | null;
  files: FileEvidence[];
  tree: string;
  expires: number;
  committed?: { hash: string; message: string; indexHash: string; indexBytes?: Buffer; finalized: boolean; warning?: string };
}

/** The diff and tree use the same captured raw bytes. No clean filters,
 * autocrlf, hooks or rereads can substitute content after author review. */
export async function prepareGitCommitPreview(workspaceRoot: string, requestedFiles?: string[]): Promise<GitDiffPreview> {
  const root = await realpath(workspaceRoot);
  const repository = await readRepositoryBaseline(root);
  if (repository.branch.startsWith('detached:')) throw invalid('Use a named branch for an in-app commit.');
  const status = await readGitStatus(root);
  if (!status.repository || status.status === 'unknown') throw invalid('Git status is unavailable.');
  const dirtyPaths = status.files.flatMap((file) => file.originalPath ? [file.originalPath, file.path] : [file.path]);
  const files = validateWorkspaceRelativePaths(root, requestedFiles?.length ? requestedFiles : dirtyPaths, true).sort();
  if (files.length > 256) throw invalid('Preview at most 256 files at a time.');
  if (!files.length) return { diff: '', preview: null };
  if (files.some((file) => !dirtyPaths.includes(file))) throw invalid('Choose files from the current dirty status.');
  const indexPath = resolve(root, await git(root, ['rev-parse', '--git-path', 'index']));
  const indexHash = await hashIndex(indexPath);
  await assertSelectedIndex(root, files);
  const directory = await mkdtemp(join(tmpdir(), 'oan-reviewed-git-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index') };
  try {
    await git(root, ['read-tree', repository.head], env);
    const evidence = await captureFiles(root, files, async (file, bytes, mode) => {
      const blobPath = join(directory, 'blob');
      await writeFile(blobPath, bytes, { mode: 0o600 });
      const oid = await git(root, ['hash-object', '-w', '--no-filters', '--', blobPath]);
      await git(root, ['update-index', '--add', '--cacheinfo', mode & 0o111 ? '100755' : '100644', oid, file], env);
    }, async (file) => { await git(root, ['update-index', '--force-remove', '--', file], env); });
    const tree = await git(root, ['write-tree'], env);
    const result = await runGit(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', repository.head, '--', ...files], env);
    if (!result.ok) throw gitResultError(result.error);
    if (!isDeepStrictEqual(repository, await readRepositoryBaseline(root)) || indexHash !== await hashIndex(indexPath)
      || !isDeepStrictEqual(evidence, await captureFiles(root, files))) throw stale();
    if (!result.stdout) return { diff: '', preview: null };
    const id = `git_${randomUUID()}`;
    const expires = Date.now() + TTL;
    const fingerprint = hash(JSON.stringify({ repository, indexHash, files: evidence, tree, diff: result.stdout }));
    const publicPreview: GitCommitPreview = { id, fingerprint, files, head: repository.head, expiresAt: new Date(expires).toISOString() };
    prune();
    if (previews.size >= MAX_PREVIEWS) {
      const disposable = [...previews].find(([, value]) => !value.committed?.warning)?.[0];
      if (!disposable) throw invalid('Finish the pending Git index recoveries before creating another preview.');
      previews.delete(disposable);
    }
    previews.set(id, { public: publicPreview, root, repository, indexPath, indexHash, files: evidence, tree, expires });
    return { diff: result.stdout, preview: structuredClone(publicPreview) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function commitReviewedGitFiles(input: ReviewedGitCommitInput): Promise<GitCommitResult> {
  const files = validateWorkspaceRelativePaths(input.workspaceRoot, input.files, true).sort();
  const message = input.message.trim();
  const snapshot = previews.get(input.previewId);
  if (!snapshot || snapshot.public.fingerprint !== input.previewFingerprint || snapshot.root !== await realpath(input.workspaceRoot)
    || !isDeepStrictEqual(files, snapshot.public.files) || (!snapshot.committed && snapshot.expires <= Date.now())) return failed(message, 'stale_preview', stale().message);
  if (!message || message.length > 4000 || message.includes('\0')) return failed(message, 'invalid_input', 'Use a non-empty commit message of at most 4000 characters.');
  if (snapshot.committed?.finalized) return committedResult(snapshot.committed);
  const root = snapshot.root;
  const indexLock = `${snapshot.indexPath}.lock`;
  let indexHandle: Awaited<ReturnType<typeof open>> | undefined;
  let directory: string | undefined;
  let published = Boolean(snapshot.committed);
  let ownsIndexLock = false;
  try {
    // The index lock excludes add/checkout. The native ref transaction below
    // acquires HEAD and its referent together before we verify the branch.
    indexHandle = await open(indexLock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    ownsIndexLock = true;
    await assertUnsignedCommit(root);
    if (snapshot.committed) {
      const existing = snapshot.committed;
      const current = await readRepositoryBaseline(root);
      const currentIndexHash = await hashIndex(snapshot.indexPath);
      if (current.head !== existing.hash || current.branch !== snapshot.repository.branch
        || (currentIndexHash !== snapshot.indexHash && currentIndexHash !== existing.indexHash)) {
        return committedResult(existing, 'The reviewed commit already exists. The index changed afterwards; inspect it in your external Git editor.');
      }
      if (currentIndexHash !== existing.indexHash) {
        if (!existing.indexBytes) throw invalid('The saved Git index is unavailable; inspect the committed result in your external Git editor.');
        await indexHandle.writeFile(existing.indexBytes); await indexHandle.sync(); await indexHandle.close(); indexHandle = undefined;
        await rename(indexLock, snapshot.indexPath); ownsIndexLock = false;
        await input.faultInjector?.('after-index-rename');
      }
      await syncDirectory(dirname(snapshot.indexPath));
      existing.warning = undefined;
      existing.finalized = true; existing.indexBytes = undefined;
      return committedResult(existing);
    }
    if (!isDeepStrictEqual(snapshot.repository, await readRepositoryBaseline(root)) || snapshot.indexHash !== await hashIndex(snapshot.indexPath)
      || !isDeepStrictEqual(snapshot.files, await captureFiles(root, files))) throw stale();
    await assertSelectedIndex(root, files);
    directory = await mkdtemp(join(tmpdir(), 'oan-reviewed-commit-'));
    const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index') };
    await git(root, ['read-tree', snapshot.tree], env);
    const indexBytes = await readBoundedRegularFile(env.GIT_INDEX_FILE, MAX_INDEX_BYTES);
    if (!indexBytes) throw invalid('The reviewed Git index is unavailable.');
    const recoveryBytes = [...previews.values()].reduce((sum, value) => sum + (value.committed?.indexBytes?.byteLength ?? 0), 0);
    if (recoveryBytes + indexBytes.byteLength > MAX_RECOVERY_INDEX_BYTES) throw invalid('Finish the pending Git index recoveries before committing again.');
    await indexHandle.writeFile(indexBytes); await indexHandle.sync();
    await input.faultInjector?.('after-validation');
    // commit-tree intentionally skips hooks: their edits cannot alter reviewed
    // content. Signing is rejected explicitly above, never silently disabled.
    const commit = await git(root, ['commit-tree', snapshot.tree, '-p', snapshot.repository.head, '-m', message]);
    if (!isDeepStrictEqual(snapshot.repository, await readRepositoryBaseline(root))) throw stale();
    try {
      await publishReviewedCommit(root, snapshot.repository, commit, join(directory, 'empty-hooks'), input.faultInjector);
    } catch (error) {
      // A lost child-process acknowledgement is not proof that the ref failed.
      // Resolve exact commit truth before allowing a retry to create anything.
      const actual = await runGit(root, ['rev-parse', `refs/heads/${snapshot.repository.branch}`]);
      if (actual.ok && actual.stdout.trim() === commit) {
        published = true;
        snapshot.committed = { hash: commit, message, indexHash: hash(indexBytes), indexBytes, finalized: false };
      }
      throw error;
    }
    published = true;
    snapshot.committed = { hash: commit, message, indexHash: hash(indexBytes), indexBytes, finalized: false };
    await input.faultInjector?.('after-ref-update');
    await indexHandle.close(); indexHandle = undefined;
    await rename(indexLock, snapshot.indexPath); ownsIndexLock = false;
    await input.faultInjector?.('after-index-rename');
    await syncDirectory(dirname(snapshot.indexPath));
    snapshot.committed.finalized = true; snapshot.committed.indexBytes = undefined;
    return committedResult(snapshot.committed);
  } catch (error) {
    if (published && snapshot.committed) {
      snapshot.committed.warning = 'The commit was saved, but its Git index could not be finalized. Retry this same reviewed commit or inspect the index in your external Git editor.';
      return committedResult(snapshot.committed, snapshot.committed.warning);
    }
    const code = (error as { code?: string }).code;
    return failed(message, code === 'stale_preview' ? 'stale_preview' : 'invalid_input',
      code === 'stale_preview' ? stale().message : code === 'EEXIST' ? 'Git is busy with another operation. Wait, then refresh and review again.'
        : error instanceof Error ? error.message : 'The reviewed commit could not be created.');
  } finally {
    // Only remove lock files this invocation actually acquired.
    if (indexHandle) await indexHandle.close().catch(() => undefined);
    if (ownsIndexLock) await rm(indexLock, { force: true }).catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Explicit HEAD update makes Git lock HEAD itself before its symbolic referent.
 * Verify the branch only AFTER prepare, while both native locks remain held.
 * Unsupported transactional Git versions fail closed before publishing a ref. */
async function publishReviewedCommit(root: string, expected: RepositoryBaseline, commit: string, hooksPath: string,
  fault?: ReviewedGitCommitInput['faultInjector']): Promise<void> {
  const child = spawn('git', ['--no-optional-locks', '--literal-pathspecs', '-C', root, '-c', `core.hooksPath=${hooksPath}`,
    'update-ref', '-m', 'OAN reviewed commit', '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let stderr = ''; let committed = false; let didPrepare = false; let didClose = false;
  let recordedFailure: Error | undefined;
  let resolvePrepared!: () => void; let rejectPrepared!: (error: Error) => void;
  let resolveClosed!: () => void;
  const prepared = new Promise<void>((resolve, reject) => { resolvePrepared = resolve; rejectPrepared = reject; });
  // Only the actual process close event settles this promise. Sending a kill
  // signal is not sufficient evidence that Git has released its ref locks.
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const failure = () => invalid('Git could not complete a locked reference transaction. Refresh and review again, or use your external Git editor.');
  const fail = (error: Error) => {
    recordedFailure ??= error; rejectPrepared(error);
    if (!didClose) child.kill('SIGKILL');
  };
  const timer = setTimeout(() => fail(failure()), 30_000);
  child.on('error', () => fail(failure()));
  child.stdin.on('error', () => fail(failure()));
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8'); if (output.length > 8192) { fail(failure()); return; }
    if (output.includes('prepare: ok\n')) { didPrepare = true; resolvePrepared(); }
    if (output.includes('commit: ok\n')) committed = true;
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); if (stderr.length > 8192) fail(failure()); });
  child.on('close', () => {
    didClose = true; clearTimeout(timer);
    if (!didPrepare) rejectPrepared(recordedFailure ?? failure());
    resolveClosed();
  });
  try {
    child.stdin.write(`start\nupdate HEAD ${commit} ${expected.head}\nprepare\n`);
    await prepared;
    await fault?.('after-ref-prepare');
    if (!isDeepStrictEqual(expected, await readRepositoryBaseline(root))) {
      child.stdin.end('abort\n'); await closed; throw stale();
    }
    child.stdin.end('commit\n'); await closed;
    // commit: ok is authoritative even if the process exits abnormally later.
    if (!committed) throw recordedFailure ?? failure();
  } finally {
    if (!didClose) {
      if (!child.stdin.writableEnded) child.stdin.end(); // EOF aborts; never sends commit.
      await closed;
    }
    clearTimeout(timer);
  }
}

async function captureFiles(root: string, files: string[],
  present?: (file: string, bytes: Buffer, mode: number) => Promise<void>, absent?: (file: string) => Promise<void>): Promise<FileEvidence[]> {
  await assertGitFilePaths(root, files);
  const output: FileEvidence[] = []; let total = 0;
  for (const path of files) {
    let handle;
    try { handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      output.push({ path, sha256: null, mode: null, bytes: 0 }); await absent?.(path); continue;
    }
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) throw invalid('Selected files must be private regular files; preview at most 16 MiB total.');
      const bytes = await readExactBounded(handle, Number(before.size)); total += bytes.byteLength;
      if (total > MAX_BYTES) throw invalid('Preview at most 16 MiB of selected content.');
      const after = await handle.stat({ bigint: true }); const current = await lstat(join(root, path), { bigint: true });
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) throw stale();
      const mode = Number(before.mode & 0o777n);
      output.push({ path, sha256: hash(bytes), mode, bytes: bytes.byteLength }); await present?.(path, bytes, mode);
    } finally { await handle.close(); }
  }
  await assertGitFilePaths(root, files);
  return output;
}
async function hashIndex(path: string): Promise<string | null> {
  const bytes = await readBoundedRegularFile(path, MAX_INDEX_BYTES);
  return bytes === null ? null : hash(bytes);
}
async function readBoundedRegularFile(path: string, limit: number): Promise<Buffer | null> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(limit)) throw invalid('Git index is unsafe or exceeds the 16 MiB limit.');
    const bytes = await readExactBounded(handle, Number(before.size));
    const after = await handle.stat({ bigint: true }); const current = await lstat(path, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.mode !== after.mode
      || before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) throw stale();
    return bytes;
  }
  finally { await handle.close(); }
}
async function readExactBounded(handle: Awaited<ReturnType<typeof open>>, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size + 1); let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (!bytesRead) break; offset += bytesRead;
  }
  if (offset !== size) throw stale();
  return buffer.subarray(0, size);
}
async function assertSelectedIndex(root: string, files: string[]) {
  const sparse = await runGit(root, ['config', '--default', 'false', '--type=bool', '--get', 'core.sparseCheckout']);
  if (!sparse.ok || sparse.stdout.trim() === 'true') throw invalid('Sparse checkouts require your external Git editor.');
  const entries = (await git(root, ['ls-files', '-v', '-z'], undefined, false)).split('\0').filter(Boolean);
  if (entries.some((entry) => !entry.startsWith('H '))) throw invalid('Special Git index flags (skip-worktree or assume-unchanged) require your external Git editor.');
  const staged = (await git(root, ['diff', '--cached', '--name-only', '--no-renames', '-z'], undefined, false)).split('\0').filter(Boolean);
  if (staged.some((file) => !files.includes(file))) throw invalid('There are staged files outside this commit scope. Review them separately.');
  const tracked = new Set((await git(root, ['ls-tree', '-rz', '--name-only', 'HEAD'], undefined, false)).split('\0').filter(Boolean));
  if (entries.some((entry) => !tracked.has(entry.slice(2)) && !files.includes(entry.slice(2)))) throw invalid('Unselected intent-to-add entries require your external Git editor.');
}
async function assertUnsignedCommit(root: string) {
  const signed = await runGit(root, ['config', '--default', 'false', '--type=bool', '--get', 'commit.gpgsign']);
  if (!signed.ok) throw invalid('Git signing configuration could not be validated. Correct it in your external Git editor.');
  if (signed.stdout.trim() === 'true') throw invalid('Signed commits are enabled. Commit with your external Git editor; OAN will not silently disable signing.');
}
async function git(root: string, args: string[], env?: NodeJS.ProcessEnv, trim = true): Promise<string> {
  const result = await runGit(root, args, env); if (!result.ok) throw gitResultError(result.error); return trim ? result.stdout.trim() : result.stdout;
}
async function syncDirectory(path: string) {
  // Windows does not expose POSIX directory fsync through Node. File fsync and
  // atomic rename still run; unsupported directory handles are platform-specific.
  let handle;
  try { handle = await open(path, constants.O_RDONLY); await handle.sync(); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  finally { await handle?.close(); }
}
function hash(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
function invalid(message: string) { return gitResultError({ code: 'invalid_input', message }); }
function stale() { return gitResultError({ code: 'stale_preview', message: 'Files, permissions, the Git index or branch changed after preview. Refresh and review the new diff before committing.' }); }
function failed(message: string, code: 'stale_preview' | 'invalid_input', error: string): GitCommitResult { return { status: 'failed', message, error: { code, message: error } }; }
function committedResult(value: NonNullable<Snapshot['committed']>, warning?: string): GitCommitResult {
  return { status: 'committed', hash: value.hash, message: value.message, ...(warning ? { warning: { code: 'index_recovery_required' as const, message: warning } } : {}) };
}
function prune() { for (const [id, snapshot] of previews) if (snapshot.expires <= Date.now() && !snapshot.committed?.warning) previews.delete(id); }
