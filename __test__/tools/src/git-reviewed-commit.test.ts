import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitFiles, prepareGitCommitPreview } from '@oh-awesome-novel/tools';
const exec = promisify(execFile); const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function git(root: string, ...args: string[]) { return (await exec('git', ['-C', root, ...args])).stdout; }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-reviewed-git-test-')); roots.push(root);
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.name', 'Test'); await git(root, 'config', 'user.email', 'test@example.invalid');
  await writeFile(join(root, 'chapter.md'), '# 旧稿\n'); await git(root, 'add', '.'); await git(root, 'commit', '-m', 'baseline');
  await writeFile(join(root, 'chapter.md'), '# 已审阅\n'); return root;
}
async function reviewed(root: string, files = ['chapter.md']) {
  const { preview, diff } = await prepareGitCommitPreview(root, files); expect(preview).not.toBeNull();
  return { workspaceRoot: root, files, message: 'reviewed change', previewId: preview!.id, previewFingerprint: preview!.fingerprint, diff };
}
describe('reviewed explicit Git commit', () => {
  it.each(['content', 'mode', 'index', 'head', 'branch'] as const)('rejects %s drift without changing HEAD or the index', async (kind) => {
    const root = await fixture(); const input = await reviewed(root);
    if (kind === 'content') await writeFile(join(root, 'chapter.md'), '# 未审阅\n');
    if (kind === 'mode') await chmod(join(root, 'chapter.md'), 0o755);
    if (kind === 'index') await git(root, 'add', 'chapter.md');
    if (kind === 'head') await git(root, 'commit', '--allow-empty', '-m', 'another commit');
    if (kind === 'branch') await git(root, 'checkout', '-b', 'other');
    const head = await git(root, 'rev-parse', 'HEAD'); const index = await readFile(join(root, '.git/index'));
    expect(await commitFiles(input)).toMatchObject({ status: 'failed', error: { code: 'stale_preview' } });
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head); expect(await readFile(join(root, '.git/index'))).toEqual(index);
  });
  it('commits only the reviewed blob when an edit arrives after the final validation and protects the index from concurrent Git', async () => {
    const root = await fixture(); const input = await reviewed(root);
    const result = await commitFiles({ ...input, faultInjector: async (point) => {
      if (point !== 'after-validation') return;
      await writeFile(join(root, 'chapter.md'), '# 晚到的编辑\n');
      await expect(git(root, 'add', 'chapter.md')).rejects.toThrow(/index.lock/u);
    } });
    expect(result.status).toBe('committed'); expect(await git(root, 'show', 'HEAD:chapter.md')).toBe('# 已审阅\n');
    expect(await readFile(join(root, 'chapter.md'), 'utf8')).toBe('# 晚到的编辑\n');
    expect(await git(root, 'diff')).toContain('晚到的编辑'); expect(await git(root, 'diff', '--cached')).toBe('');
  });
  it('preserves raw CRLF bytes and does not run clean filters or hooks that could alter reviewed content', async () => {
    const root = await fixture();
    await git(root, 'config', 'core.autocrlf', 'true'); await git(root, 'config', 'filter.upper.clean', 'tr a-z A-Z');
    await writeFile(join(root, '.gitattributes'), 'chapter.md filter=upper\n');
    await writeFile(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nprintf changed > hook-ran\n', { mode: 0o755 });
    await writeFile(join(root, 'chapter.md'), '# reviewed lower case\r\nraw bytes\r\n');
    const input = await reviewed(root); expect(input.diff).toContain('reviewed lower case\r');
    expect((await commitFiles(input)).status).toBe('committed');
    expect(await git(root, 'show', 'HEAD:chapter.md')).toBe('# reviewed lower case\r\nraw bytes\r\n');
    await expect(readFile(join(root, 'hook-ran'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports committed truth after index-finalization failure and retries only finalization without a second commit', async () => {
    const root = await fixture(); const input = await reviewed(root);
    const result = await commitFiles({ ...input, faultInjector: async (point) => { if (point === 'after-ref-update') throw new Error('index failure'); } });
    expect(result).toMatchObject({ status: 'committed', warning: { code: 'index_recovery_required' } });
    const head = await git(root, 'rev-parse', 'HEAD');
    expect(await commitFiles(input)).toMatchObject({ status: 'committed' });
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head); expect(await git(root, 'diff', '--cached')).toBe('');
    expect(await git(root, 'rev-list', '--count', 'HEAD')).toBe('2\n');
  });
  it('does not remove an external index lock acquired after its own index has been installed', async () => {
    const root = await fixture(); const input = await reviewed(root);
    const result = await commitFiles({ ...input, faultInjector: async (point) => {
      if (point === 'after-index-rename') await writeFile(join(root, '.git/index.lock'), 'external Git lock', { flag: 'wx' });
    } });
    expect(result.status).toBe('committed'); expect(await readFile(join(root, '.git/index.lock'), 'utf8')).toBe('external Git lock');
  });
  it('preserves special index flags by refusing unsupported index configurations', async () => {
    const root = await fixture(); await writeFile(join(root, 'untouched.md'), 'keep these index flags');
    await git(root, 'add', 'untouched.md'); await git(root, 'commit', '-m', 'unselected clean file');
    await git(root, 'update-index', '--assume-unchanged', 'untouched.md');
    const index = await readFile(join(root, '.git/index'));
    await expect(prepareGitCommitPreview(root, ['chapter.md'])).rejects.toThrow(/Special Git index flags/u);
    expect(await readFile(join(root, '.git/index'))).toEqual(index);
    await git(root, 'update-index', '--no-assume-unchanged', 'untouched.md');
    await git(root, 'update-index', '--skip-worktree', 'untouched.md');
    await expect(prepareGitCommitPreview(root, ['chapter.md'])).rejects.toThrow(/Special Git index flags/u);
    expect(await git(root, 'ls-files', '-v')).toContain('S untouched.md');
  });
  it('holds native HEAD and referent locks while verifying the reviewed branch', async () => {
    const root = await fixture(); await git(root, 'branch', 'other'); const other = await git(root, 'rev-parse', 'other');
    const input = await reviewed(root);
    const result = await commitFiles({ ...input, faultInjector: async (point) => {
      if (point === 'after-ref-prepare') {
        await expect(git(root, 'symbolic-ref', 'HEAD', 'refs/heads/other')).rejects.toThrow(/HEAD.lock/u);
      }
    } });
    expect(result.status).toBe('committed'); expect(await git(root, 'rev-parse', 'other')).toBe(other);
    expect(await git(root, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main\n');
  });
  it('aborts the prepared HEAD update if a same-OID branch switch happened before Git acquired its locks', async () => {
    const root = await fixture(); await git(root, 'branch', 'other'); const head = await git(root, 'rev-parse', 'HEAD'); const input = await reviewed(root);
    const result = await commitFiles({ ...input, faultInjector: async (point) => {
      if (point === 'after-validation') await git(root, 'symbolic-ref', 'HEAD', 'refs/heads/other');
    } });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'stale_preview' } });
    expect(await git(root, 'rev-parse', 'main')).toBe(head); expect(await git(root, 'rev-parse', 'other')).toBe(head);
    await expect(readFile(join(root, '.git/HEAD.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects expired, wrong-scope and cross-workspace credentials, and refuses to bypass signing configuration', async () => {
    const root = await fixture(); const other = await fixture(); const input = await reviewed(root);
    expect(await commitFiles({ ...input, workspaceRoot: other })).toMatchObject({ status: 'failed', error: { code: 'stale_preview' } });
    expect(await commitFiles({ ...input, files: ['other.md'] })).toMatchObject({ status: 'failed', error: { code: 'stale_preview' } });
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60_000);
    expect(await commitFiles(input)).toMatchObject({ status: 'failed', error: { code: 'stale_preview' } }); vi.restoreAllMocks();
    await git(root, 'config', 'commit.gpgsign', 'true');
    const signedPreview = await reviewed(root);
    expect(await commitFiles(signedPreview)).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('Signed commits') } });
    await git(root, 'config', 'commit.gpgsign', 'invalid-boolean');
    expect(await commitFiles(signedPreview)).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('signing configuration') } });
  });
  it('commits reviewed deletes and executable modes without adding unrelated files', async () => {
    const root = await fixture(); await writeFile(join(root, 'new 中文.md'), '# new\n'); await chmod(join(root, 'new 中文.md'), 0o755);
    await rm(join(root, 'chapter.md')); await mkdir(join(root, 'notes')); await writeFile(join(root, 'notes/unrelated.md'), 'keep untracked');
    const input = await reviewed(root, ['chapter.md', 'new 中文.md']); expect((await commitFiles(input)).status).toBe('committed');
    expect(await git(root, 'ls-tree', 'HEAD', 'new 中文.md')).toContain('100755');
    await expect(git(root, 'show', 'HEAD:chapter.md')).rejects.toThrow();
    expect(await git(root, 'status', '--porcelain')).toContain('notes/');
  });
});
