import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
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
  syncGit,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

function windowsForbids(relativePath: string): boolean {
  return process.platform === 'win32' && (
    /[<>:"|?*\u0000-\u001f]/u.test(relativePath)
    || relativePath.split('/').some((part) => part.endsWith(' ') || part.endsWith('.'))
  );
}

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
    const paths = ['state/中文 名称.yaml', 'state/"quoted".yaml', '-leading.md', 'state/[literal].yaml', 'state/ padded .yaml ']
      .filter((path) => !windowsForbids(path));
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
    const newPath = windowsForbids('after "新名".md') ? 'after 新名.md' : 'after "新名".md';
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

  it.skipIf(process.platform === 'win32').each(['tab\tname.md', 'line\nbreak.md'])('displays control paths without splitting and refuses operations on %j', async (path) => {
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

  it('preflights Git sync for missing remote, dirty worktree, non-repository, and detached HEAD', async () => {
    const nonRepo = await tempRoot();
    expect(await syncGit(nonRepo)).toMatchObject({
      status: 'failed',
      step: 'preflight',
      error: { code: 'not_git_repository' },
    });

    const root = await repository();
    expect(await readGitStatus(root)).toMatchObject({ branch: 'main', status: 'clean' });
    expect((await readGitStatus(root)).remote).toBeUndefined();
    expect(await syncGit(root)).toMatchObject({
      status: 'failed',
      step: 'preflight',
      branch: 'main',
      error: { code: 'remote_missing' },
    });

    const remoteRoot = await tempRoot();
    await git(remoteRoot, 'init', '--bare', '-b', 'main');
    await git(root, 'remote', 'add', 'origin', remoteRoot);
    expect(await readGitStatus(root)).toMatchObject({
      branch: 'main',
      remote: 'origin',
      status: 'clean',
    });

    await write(root, 'baseline.md', 'uncommitted change\n');
    expect(await syncGit(root)).toMatchObject({
      status: 'failed',
      step: 'preflight',
      remote: 'origin',
      branch: 'main',
      error: { code: 'dirty_worktree' },
    });
    await git(root, 'checkout', '--', 'baseline.md');

    const head = (await git(root, 'rev-parse', 'HEAD')).trim();
    await git(root, 'checkout', '--detach', head);
    expect(await syncGit(root)).toMatchObject({
      status: 'failed',
      step: 'preflight',
      head,
      error: { code: 'invalid_input' },
    });
  });

  it('syncs with a bare remote (first push, fast-forward pull, and diverged conflict without losing local commits)', async () => {
    await windowsLineEndings();
    const remoteRoot = await tempRoot();
    await git(remoteRoot, 'init', '--bare', '-b', 'main');

    const rootA = await repository();
    await git(rootA, 'remote', 'add', 'origin', remoteRoot);
    const firstSync = await syncGit(rootA);
    expect(firstSync).toMatchObject({
      status: 'synced',
      remote: 'origin',
      branch: 'main',
    });

    const rootB = await tempRoot();
    await git(rootB, 'clone', remoteRoot, '.');
    await git(rootB, 'checkout', 'main');
    await write(rootB, 'baseline.md', 'remote update\n');
    await git(rootB, 'add', '--', 'baseline.md');
    await git(rootB, 'commit', '-m', 'remote advance');
    const remoteHead = (await git(rootB, 'rev-parse', 'HEAD')).trim();
    await git(rootB, 'push', 'origin', 'main');

    const pullSync = await syncGit(rootA);
    expect(pullSync).toMatchObject({
      status: 'synced',
      remote: 'origin',
      branch: 'main',
      head: remoteHead,
    });
    expect(await readFile(join(rootA, 'baseline.md'), 'utf8')).toBe('remote update\n');

    await write(rootB, 'baseline.md', 'remote divergent line\n');
    await git(rootB, 'add', '--', 'baseline.md');
    await git(rootB, 'commit', '-m', 'remote divergent');
    await git(rootB, 'push', 'origin', 'main');

    await write(rootA, 'baseline.md', 'local divergent line\n');
    await git(rootA, 'add', '--', 'baseline.md');
    await git(rootA, 'commit', '-m', 'local divergent');
    const localHead = (await git(rootA, 'rev-parse', 'HEAD')).trim();

    const conflictSync = await syncGit(rootA);
    expect(conflictSync).toMatchObject({
      status: 'failed',
      step: 'pull',
      remote: 'origin',
      branch: 'main',
      head: localHead,
      error: { code: 'conflict' },
    });
    expect((await git(rootA, 'rev-parse', 'HEAD')).trim()).toBe(localHead);
    expect(await readFile(join(rootA, 'baseline.md'), 'utf8')).toBe('local divergent line\n');
  });

  it('pulls and pushes the configured upstream when the local branch has a different name', async () => {
    await windowsLineEndings();
    const remote = await tempRoot();
    await git(remote, 'init', '--bare', '-b', 'main');
    const local = await repository();
    await git(local, 'remote', 'add', 'origin', remote);
    await git(local, 'push', '-u', 'origin', 'main');
    await git(local, 'branch', '-m', 'local-novel');
    const peer = await tempRoot();
    await git(peer, 'clone', remote, '.');
    await write(peer, 'baseline.md', 'upstream update\n');
    await git(peer, 'commit', '-am', 'advance upstream');
    await git(peer, 'push');

    expect(await syncGit(local)).toMatchObject({ status: 'synced', branch: 'local-novel' });
    expect(await readFile(join(local, 'baseline.md'), 'utf8')).toBe('upstream update\n');
    expect((await git(local, 'rev-parse', '--abbrev-ref', '@{upstream}')).trim()).toBe('origin/main');
    await write(local, 'baseline.md', 'local update\n');
    await git(local, 'commit', '-am', 'advance local');
    expect(await syncGit(local)).toMatchObject({ status: 'synced' });
    expect((await git(remote, 'show', 'main:baseline.md')).trim()).toBe('local update');
    expect((await git(remote, 'branch', '--format=%(refname:short)')).trim()).toBe('main');
    expect((await git(local, 'config', '--get', 'branch.local-novel.merge')).trim()).toBe('refs/heads/main');
  });

  it('still fast-forwards a checkout that autocrlf already converted to CRLF', async () => {
    await windowsLineEndings();
    const remote = await tempRoot();
    await git(remote, 'init', '--bare', '-b', 'main');
    const writer = await repository();
    await git(writer, 'remote', 'add', 'origin', remote);
    await git(writer, 'push', '-u', 'origin', 'main');
    const reader = await tempRoot();
    await git(reader, 'clone', remote, '.');
    expect(await readFile(join(reader, 'baseline.md'), 'utf8')).toBe('baseline\r\n');
    await write(writer, 'baseline.md', 'remote update\n');
    await git(writer, 'commit', '-am', 'remote advance');
    await git(writer, 'push');

    expect(await readGitStatus(reader)).toMatchObject({ status: 'clean' });
    expect(await syncGit(reader)).toMatchObject({ status: 'synced' });
    expect(await readFile(join(reader, 'baseline.md'), 'utf8')).toBe('remote update\r\n');
    await expect(git(reader, 'config', '--local', '--get', 'core.autocrlf')).rejects.toThrow();
  });

  it('commits a byte-preserving attributes file and keeps LF and CRLF across an autocrlf clone', async () => {
    await windowsLineEndings();
    authorIdentity();
    const root = await tempRoot();
    await initWorkspace(root);
    expect(await initializeWorkspaceRepository(root)).toMatchObject({ repository: true, status: 'clean' });
    expect((await git(root, 'config', '--local', '--get', 'core.autocrlf')).trim()).toBe('false');
    expect(await git(root, 'ls-files')).toContain('.gitattributes');
    await write(root, 'chapters/0001/0001.md', '正文\r\n');
    await git(root, 'add', '--', 'chapters/0001/0001.md');
    await git(root, 'commit', '-m', 'chapter');

    const clone = await tempRoot();
    await git(clone, 'clone', root, '.');
    expect(await readFile(join(clone, '.gitignore'), 'utf8')).toBe(await readFile(join(root, '.gitignore'), 'utf8'));
    expect(await readFile(join(clone, 'chapters/0001/0001.md'), 'utf8')).toBe('正文\r\n');
  });

  it('fails closed when an existing upstream remote is unavailable instead of pushing to origin', async () => {
    const root = await repository();
    const remote = await tempRoot();
    await git(remote, 'init', '--bare', '-b', 'main');
    await git(root, 'remote', 'add', 'origin', remote);
    await git(root, 'config', 'branch.main.remote', 'missing-remote');
    await git(root, 'config', 'branch.main.merge', 'refs/heads/main');
    expect(await syncGit(root)).toMatchObject({ status: 'failed', step: 'preflight', error: { code: 'remote_missing' } });
    expect((await git(remote, 'branch')).trim()).toBe('');
  });

  it.each(['core.sshCommand', 'GIT_SSH_COMMAND'] as const)('preserves %s for authenticated fetch, pull, and push', async (source) => {
    const root = await repository();
    const remote = await tempRoot();
    const transport = await tempRoot();
    await git(remote, 'init', '--bare', '-b', 'main');
    await git(root, 'remote', 'add', 'origin', remote);
    await git(root, 'push', '-u', 'origin', 'main');
    const log = join(transport, 'ssh.jsonl');
    const script = join(transport, 'configured-ssh.cjs');
    await writeFile(script, `
      const { appendFileSync } = require('node:fs');
      const { spawnSync } = require('node:child_process');
      const args = process.argv.slice(2);
      appendFileSync(process.env.OAN_TEST_SSH_LOG, JSON.stringify({ args, prompt: process.env.GIT_TERMINAL_PROMPT }) + '\\n');
      const service = args.at(-1).startsWith('git-receive-pack') ? 'receive-pack' : 'upload-pack';
      const result = spawnSync('git', [service, process.env.OAN_TEST_SSH_REMOTE], { stdio: 'inherit' });
      process.exit(result.status ?? 1);
    `);
    const quote = (value: string) => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
    const command = `${quote(process.execPath)} ${quote(script)} -i configured-identity`;
    vi.stubEnv('GIT_SSH_COMMAND', source === 'GIT_SSH_COMMAND' ? command : undefined);
    vi.stubEnv('GIT_SSH_VARIANT', 'ssh');
    vi.stubEnv('OAN_TEST_SSH_LOG', log);
    vi.stubEnv('OAN_TEST_SSH_REMOTE', remote);
    if (source === 'core.sshCommand') await git(root, 'config', source, command);
    // No network: the configured SSH command serves the local bare repository.
    await git(root, 'remote', 'set-url', 'origin', 'ssh://git@127.0.0.1:1/unused');
    await git(root, 'fetch', 'origin');
    await writeFile(log, '');
    await write(root, 'baseline.md', 'authenticated update\n');
    await git(root, 'commit', '-am', 'local update');

    expect(await syncGit(root)).toMatchObject({ status: 'synced' });
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.args.slice(0, 2)).toEqual(['-i', 'configured-identity']);
      expect(call.prompt).toBe('0');
    }
    expect((await git(remote, 'show', 'main:baseline.md')).trim()).toBe('authenticated update');
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

async function windowsLineEndings() {
  const config = join(await tempRoot(), 'gitconfig');
  await writeFile(config, '[core]\n\tautocrlf = true\n[commit]\n\tgpgsign = false\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
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
