import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initWorkspace } from '@oh-awesome-novel/core';
import {
  commitFiles,
  prepareGitCommitPreview,
  createChangeMaterializer,
  createPendingActionStore,
  createSandboxEditSession,
  createWorkspaceChangePolicy,
  gitDiff,
  initializeWorkspaceRepository,
  readGitStatus,
  readRepositoryBaseline,
  showGitCommit,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('first workspace Git baseline', () => {
  it('uses the production repository reader from creation through first read, candidate and Accept', async () => {
    authorIdentity();
    const root = await tempRoot();
    await initWorkspace(root);
    expect(await initializeWorkspaceRepository(root)).toMatchObject({ repository: true, status: 'clean', head: expect.any(String) });
    const baseline = await readRepositoryBaseline(root);
    const readOnly = await createSandboxEditSession({
      workspaceRoot: root, policy: createWorkspaceChangePolicy({ capability: 'read-only' }),
    });
    await expect(readOnly.preview()).resolves.toMatchObject({ changes: [] });
    await readOnly.dispose();

    const session = await createSandboxEditSession({
      workspaceRoot: root, policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
    });
    const write = session.tools.writeFile!;
    await write.execute!({ path: 'summaries/global.md', content: '# Global\n\nFirst summary.\n' }, {
      toolCallId: 'first-write', messages: [], context: undefined,
    });
    const candidate = await session.finalizeCandidate({ finalization: 'runtime-fallback' });
    expect(candidate).toBeDefined();
    const store = await createPendingActionStore({ workspaceRoot: root });
    const action = await store.proposeCandidate({
      id: 'first-action', candidate: candidate!, title: 'First summary', description: 'Approve the first summary.',
    });
    await expect(readFile(join(root, 'summaries/global.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    const accepted = await createChangeMaterializer({ store }).accept({ actionId: action.id, autoCommitOnAccept: true });
    expect(accepted.receipt.git.status).toBe('committed');
    expect((await readRepositoryBaseline(root)).head).not.toBe(baseline.head);
    expect(await readGitStatus(root)).toMatchObject({ status: 'clean' });
    await session.dispose();
  });

  it('exposes missing identity and unborn HEAD without inventing a baseline or editing identity', async () => {
    const root = await tempRoot();
    await initWorkspace(root);
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) vi.stubEnv(key, undefined);
    const emptyConfig = join(await tempRoot(), 'gitconfig');
    await writeFile(emptyConfig, '');
    vi.stubEnv('GIT_CONFIG_GLOBAL', emptyConfig);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'user.useConfigOnly');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true');
    expect(await initializeWorkspaceRepository(root)).toMatchObject({ repository: true, error: { code: 'identity_missing' } });
    expect(await git(root, 'config', '--local', '--list')).not.toContain('user.name');
    authorIdentity();
    expect(await readGitStatus(root)).toMatchObject({ error: { code: 'head_missing' } });
    await expect(readRepositoryBaseline(root)).rejects.toMatchObject({ code: 'head_missing' });
  });

  it('reports unavailable Git and preserves generated workspace files', async () => {
    const root = await tempRoot();
    await initWorkspace(root);
    vi.stubEnv('PATH', root);
    expect(await initializeWorkspaceRepository(root)).toMatchObject({ available: false, error: { code: 'git_unavailable' } });
    expect(await readFile(join(root, '.oan/config.yaml'), 'utf8')).toContain('version: 1');
  });

  it('rejects parent repositories and refuses to initialize an existing dirty repository', async () => {
    const root = await repository();
    const nested = join(root, 'nested');
    await mkdir(nested);
    expect(await readGitStatus(nested)).toMatchObject({ repository: false, error: { code: 'not_git_repository' } });
    await expect(readRepositoryBaseline(nested)).rejects.toMatchObject({ code: 'not_git_repository' });
    const head = await git(root, 'rev-parse', 'HEAD');
    await writeFile(join(root, 'baseline.md'), 'author edits\n');
    await expect(initializeWorkspaceRepository(root)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(root, 'baseline.md'), 'utf8')).toBe('author edits\n');
  });
});

describe('Git status and explicit commit preview', () => {
  it('keeps disposable runtime paths out of public status even without a gitignore', async () => {
    const root = await repository();
    for (const path of [
      '.workspace/change-engine/v1/drafts/private/0.txt',
      '.oan/sessions/private/messages.jsonl',
      '.oan/indexes/chapters.yaml',
    ]) await write(root, path, 'private runtime state\n');
    await write(root, '.oan/config.yaml', 'version: 1\n');
    await write(root, 'visible.md', '# Visible\n');
    const status = await readGitStatus(root);
    expect(status.files.map((file) => file.path).sort()).toEqual(['.oan/config.yaml', 'visible.md']);
    expect(JSON.stringify(status)).not.toContain('.workspace/change-engine');
    expect(await gitDiff(root)).toContain('+# Visible');
  });

  it('preserves supported paths byte-for-byte from status through preview and scoped commit', async () => {
    const root = await repository();
    const paths = ['state/中文 名称.yaml', 'state/"quoted".yaml', '-leading.md', 'state/[literal].yaml', 'state/ padded .yaml '];
    for (const [index, path] of paths.entries()) await write(root, path, `value: file-${index}\n`);
    await write(root, 'unrelated.md', 'leave this untracked\n');
    const status = await readGitStatus(root);
    for (const path of paths) expect(status.files.map((file) => file.path)).toContain(path);
    const diff = await gitDiff(root, paths);
    for (const index of paths.keys()) expect(diff).toContain(`+value: file-${index}`);
    expect(diff).not.toContain('leave this untracked');
    expect(await reviewedCommit({ workspaceRoot: root, files: paths, message: 'explicit selected paths' })).toMatchObject({ status: 'committed' });
    const changed = (await git(root, 'diff-tree', '--no-commit-id', '--name-only', '-z', '-r', 'HEAD')).split('\0').filter(Boolean);
    expect(changed.sort()).toEqual([...paths].sort());
    expect((await readGitStatus(root)).files.map((file) => file.path)).toEqual(['unrelated.md']);
  });

  it('previews staged and untracked bytes, including worktree changes after staging, without changing the index', async () => {
    const root = await repository();
    await write(root, 'baseline.md', 'staged old content\n');
    await git(root, 'add', '--', 'baseline.md');
    await write(root, 'baseline.md', 'final worktree content\n');
    await write(root, 'new.md', 'new untracked content\n');
    const indexBefore = await readFile(join(root, '.git/index'));
    const diff = await gitDiff(root, ['baseline.md', 'new.md']);
    expect(diff).toContain('+final worktree content');
    expect(diff).toContain('+new untracked content');
    expect(diff).not.toContain('+staged old content');
    expect(await readFile(join(root, '.git/index'))).toEqual(indexBefore);
    const result = await reviewedCommit({ workspaceRoot: root, files: ['baseline.md', 'new.md'], message: 'previewed commit' });
    expect(result.status).toBe('committed');
    expect(await git(root, 'show', '--format=', 'HEAD')).toBe(diff);
  });

  it('decodes rename source and destination in status and commit details', async () => {
    const root = await repository();
    const oldPath = 'before 中文.md';
    const newPath = 'after "新名".md';
    await write(root, oldPath, 'renamed file\n');
    await git(root, 'add', '--', oldPath);
    await git(root, 'commit', '-m', 'before rename');
    await rename(join(root, oldPath), join(root, newPath));
    await git(root, 'add', '-A', '--', oldPath, newPath);
    const status = await readGitStatus(root);
    expect(status.files).toContainEqual(expect.objectContaining({ path: newPath, originalPath: oldPath, indexStatus: 'R' }));
    expect(await gitDiff(root, [oldPath, newPath])).toContain('rename from');
    expect(await reviewedCommit({ workspaceRoot: root, files: [oldPath, newPath], message: 'rename' })).toMatchObject({ status: 'committed' });
    expect(await showGitCommit(root, (await git(root, 'rev-parse', 'HEAD')).trim())).toMatchObject({
      files: [expect.objectContaining({ path: newPath, originalPath: oldPath, status: 'R100' })],
    });
  });

  it.each(['tab\tname.md', 'line\nbreak.md'])('displays control paths without splitting and refuses operations on %j', async (path) => {
    const root = await repository();
    await write(root, path, 'untrusted path\n');
    const status = await readGitStatus(root);
    expect(status.files).toHaveLength(1);
    expect(status.files[0]?.path).toBe(path);
    expect(status.files[0]?.raw).toContain(JSON.stringify(path));
    await expect(gitDiff(root, [path])).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(reviewedCommit({ workspaceRoot: root, files: [path], message: 'unsupported' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await git(root, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('distinguishes clean previews from errors and blocks symlink traversal', async () => {
    const root = await repository();
    await expect(gitDiff(root, ['baseline.md'])).resolves.toBe('');
    await expect(gitDiff(await tempRoot(), ['baseline.md'])).rejects.toMatchObject({ code: 'not_git_repository' });
    const outside = await tempRoot();
    await write(outside, 'secret.md', 'secret\n');
    await symlink(outside, join(root, 'linked'));
    await expect(gitDiff(root, ['linked/secret.md'])).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('allows an explicit commit of workspace configuration but rejects private runtime paths', async () => {
    authorIdentity();
    const root = await tempRoot();
    await initWorkspace(root);
    await initializeWorkspaceRepository(root);
    await write(root, '.oan/config.yaml', 'version: 1\nnovelName: New title\n');
    expect(await gitDiff(root, ['.oan/config.yaml'])).toContain('+novelName: New title');
    expect(await reviewedCommit({ workspaceRoot: root, files: ['.oan/config.yaml'], message: 'rename novel' })).toMatchObject({ status: 'committed' });
    await expect(gitDiff(root, ['.oan/sessions/messages.json'])).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(gitDiff(root, ['.workspace/internal.json'])).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

function authorIdentity() {
  vi.stubEnv('GIT_AUTHOR_NAME', 'OAN Test');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'oan@example.test');
  vi.stubEnv('GIT_COMMITTER_NAME', 'OAN Test');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'oan@example.test');
}

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'oan-git-first-use-'));
  roots.push(root);
  return root;
}

async function repository() {
  authorIdentity();
  const root = await tempRoot();
  await git(root, 'init', '-b', 'main');
  await write(root, 'baseline.md', 'baseline\n');
  await git(root, 'add', '--', 'baseline.md');
  await git(root, 'commit', '-m', 'baseline');
  return root;
}

async function write(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function git(root: string, ...args: string[]) {
  return (await execFileAsync('git', ['--literal-pathspecs', '-C', root, ...args])).stdout;
}

async function reviewedCommit(input: { workspaceRoot: string; files: string[]; message: string }) {
  const result = await prepareGitCommitPreview(input.workspaceRoot, input.files);
  if (!result.preview) throw new Error('Expected a dirty review preview.');
  return commitFiles({ ...input, previewId: result.preview.id, previewFingerprint: result.preview.fingerprint });
}
