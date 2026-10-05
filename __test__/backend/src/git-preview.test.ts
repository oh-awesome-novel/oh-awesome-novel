import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
const exec = promisify(execFile); const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function git(root: string, ...args: string[]) { return (await exec('git', ['-C', root, ...args])).stdout; }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-git-preview-http-')); roots.push(root);
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.name', 'Test'); await git(root, 'config', 'user.email', 'test@example.invalid');
  await mkdir(join(root, '.oan')); await mkdir(join(root, 'chapters'));
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: git-preview\n'); await writeFile(join(root, '.oan/workflow.yaml'), 'name: chapter\nsteps: [chapter]\n');
  await writeFile(join(root, 'chapter.md'), '# old\n'); await git(root, 'add', '.'); await git(root, 'commit', '-m', 'baseline');
  await writeFile(join(root, 'chapter.md'), '# reviewed\n');
  const app = createNovelHonoApp({ workspaceRoot: root, globalConfigDir: join(root, '.workspace/global') });
  return { root, app };
}
function body(value: unknown) { return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }; }
describe('review-bound Git HTTP routes', () => {
  it('requires an opaque preview credential and returns the same commit on retries', async () => {
    const { root, app } = await fixture();
    expect((await app.request('/api/git/commit', body({ files: ['chapter.md'], message: 'unreviewed' }))).status).toBe(400);
    const response = await app.request('/api/git/diff?file=chapter.md'); expect(response.status).toBe(200);
    const { preview, diff } = await response.json(); expect(diff).toContain('+# reviewed'); expect(preview).not.toHaveProperty('tree');
    const request = { files: preview.files, message: 'reviewed', previewId: preview.id, previewFingerprint: preview.fingerprint };
    const committed = await app.request('/api/git/commit', body(request)); expect(committed.status, await committed.clone().text()).toBe(200);
    const result = await committed.json();
    const retried = await app.request('/api/git/commit', body(request)); expect(retried.status).toBe(200); expect((await retried.json()).hash).toBe(result.hash);
    expect(await git(root, 'rev-list', '--count', 'HEAD')).toBe('2\n');
  });
  it('rejects post-preview edits without staging unseen bytes', async () => {
    const { root, app } = await fixture(); const { preview } = await (await app.request('/api/git/diff?file=chapter.md')).json();
    const index = await readFile(join(root, '.git/index')); await writeFile(join(root, 'chapter.md'), '# unseen\n');
    const response = await app.request('/api/git/commit', body({ files: preview.files, message: 'reviewed', previewId: preview.id, previewFingerprint: preview.fingerprint }));
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('stale_preview');
    expect(await readFile(join(root, '.git/index'))).toEqual(index); expect(await git(root, 'rev-list', '--count', 'HEAD')).toBe('1\n');
  });
  it('cannot use a prior workspace preview after the active workspace switches', async () => {
    const first = await fixture(); const second = await fixture(); const { preview } = await (await first.app.request('/api/git/diff?file=chapter.md')).json();
    expect((await first.app.request('/api/workspaces/open', body({ path: second.root }))).status).toBe(200);
    const response = await first.app.request('/api/git/commit', body({ files: preview.files, message: 'old workspace', previewId: preview.id, previewFingerprint: preview.fingerprint }));
    expect(response.status).toBe(409); expect(await git(second.root, 'rev-list', '--count', 'HEAD')).toBe('1\n'); expect(await git(first.root, 'rev-list', '--count', 'HEAD')).toBe('1\n');
  });
});
