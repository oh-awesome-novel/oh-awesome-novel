import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createNovelHonoApp, startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { NovelHonoApp } from '@oh-awesome-novel/backend';

const git = promisify(execFile); const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(autoCommit = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-own-import-')); roots.push(root);
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'characters'));
  await writeFile(join(root, '.oan/config.yaml'), `version: 1\nnovelName: manuscript\ngit:\n  autoCommitOnAccept: ${autoCommit}\n`);
  await writeFile(join(root, '.oan/workflow.yaml'), 'name: manuscript\nsteps:\n  - chapter\n');
  await writeFile(join(root, '.gitignore'), '.workspace/\n');
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, 'config', 'user.name', 'Test']); await git('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  await git('git', ['-C', root, 'add', '.']); await git('git', ['-C', root, 'commit', '-m', 'baseline']);
  return { root, app: createNovelHonoApp({ workspaceRoot: root }) };
}
const prefix = '/api/workspace/manuscript/import';
const text = '前言不丢失。\r\n第一章 雪\r\n她来了。  \r\n第二章 雨\r\n他走了。\r\n';
async function post(app: NovelHonoApp, path: string, body?: unknown) {
  return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function preview(app: NovelHonoApp, root: string, extra: Record<string, unknown> = {}) {
  const response = await post(app, `${prefix}/preview`, { sourceName: '旧稿.md', text, expectedWorkspaceRoot: root, ...extra });
  expect(response.status, await response.clone().text()).toBe(200); return (await response.json()).preview;
}
async function propose(app: NovelHonoApp, root: string, prepared: { id: string; fingerprint: string }) {
  return post(app, `${prefix}/previews/${prepared.id}/pending-action`, { fingerprint: prepared.fingerprint, expectedWorkspaceRoot: root });
}
async function absent(root: string) {
  await expect(readFile(join(root, 'chapters/0001/0001.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(root, 'chapters/0001/0002.md'))).rejects.toMatchObject({ code: 'ENOENT' });
}
describe('author Markdown import HTTP approval journey', () => {
  it('persists only immutable preview/proposal before approval, survives restart, then accepts through materializer with autoCommit off', async () => {
    const { root, app } = await fixture();
    const before = (await git('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout;
    const prepared = await preview(app, root);
    expect(prepared).toMatchObject({ canPropose: true, conflicts: [], sourceBytes: Buffer.byteLength(text) });
    expect(JSON.stringify(prepared)).not.toContain('.workspace'); expect(prepared).not.toHaveProperty('files');
    expect(prepared.chapters).toHaveLength(2); await absent(root);
    const proposed = await propose(app, root, prepared); expect(proposed.status, await proposed.clone().text()).toBe(200);
    const { pendingAction } = await proposed.json();
    expect(pendingAction.origin.kind).toBe('manuscriptImport'); expect(pendingAction.changes.every((item: { operation: string }) => item.operation === 'create')).toBe(true);
    await absent(root);
    const restarted = createNovelHonoApp({ workspaceRoot: root });
    const accepted = await post(restarted, `/api/workspace/pending-actions/${pendingAction.id}/accept`);
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect((await accepted.json()).pendingAction.status).toBe('accepted');
    const first = await readFile(join(root, 'chapters/0001/0001.md'), 'utf8'); const second = await readFile(join(root, 'chapters/0001/0002.md'), 'utf8');
    expect(first).toContain('前言不丢失。\r\n第一章 雪\r\n她来了。  \r\n'); expect(second).toContain('第二章 雨\r\n他走了。\r\n');
    expect((await git('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout).toBe(before);
  });
  it('rejects without writing canonical files or committing', async () => {
    const { root, app } = await fixture(true); const prepared = await preview(app, root);
    const { pendingAction } = await (await propose(app, root, prepared)).json();
    const response = await post(app, `/api/workspace/pending-actions/${pendingAction.id}/reject`);
    expect(response.status).toBe(200); await absent(root);
    expect((await git('git', ['-C', root, 'rev-list', '--count', 'HEAD'])).stdout.trim()).toBe('1');
  });
  it('reports existing and duplicate target conflicts and permits explicit remapping only', async () => {
    const { root, app } = await fixture(); await mkdir(join(root, 'chapters/0001'), { recursive: true });
    await writeFile(join(root, 'chapters/0001/0001.md'), '# 作者原文\n保留');
    const conflicted = await preview(app, root, { mappings: [{ index: 0, volume: 1, chapter: 1, title: 'A' }, { index: 1, volume: 1, chapter: 1, title: 'B' }] });
    expect(conflicted).toMatchObject({ id: null, fingerprint: null, canPropose: false, diff: '', conflicts: [{ reason: 'exists' }, { reason: 'duplicate' }] });
    const mapped = await preview(app, root, { mappings: [{ index: 0, volume: 2, chapter: 3, title: 'A' }, { index: 1, volume: 2, chapter: 4, title: 'B' }] });
    expect(mapped.canPropose).toBe(true); expect(mapped.chapters[0].path).toBe('chapters/0002/0003.md');
    expect(await readFile(join(root, 'chapters/0001/0001.md'), 'utf8')).toBe('# 作者原文\n保留');
  });
  it('rejects fingerprint tampering, source overrides and workspace mismatch', async () => {
    const { root, app } = await fixture(); const prepared = await preview(app, root);
    expect((await propose(app, root, { ...prepared, fingerprint: '0'.repeat(64) })).status).toBe(409);
    expect((await propose(app, `${root}-other`, prepared)).status).toBe(409);
    expect((await post(app, `${prefix}/previews/${prepared.id}/pending-action`, { fingerprint: prepared.fingerprint, expectedWorkspaceRoot: root, text: '替换稿件' })).status).toBe(400);
    expect((await post(app, `${prefix}/preview`, { sourceName: '/tmp/book.md', text, expectedWorkspaceRoot: root })).status).toBe(422);
    expect((await post(app, `${prefix}/preview`, { sourceName: 'book.md', text, expectedWorkspaceRoot: root, workspaceRoot: root })).status).toBe(400);
    await absent(root);
  });
  it('promotes the same reviewed preview idempotently after restarting the backend', async () => {
    const { root, app } = await fixture(); const prepared = await preview(app, root);
    const reopened = createNovelHonoApp({ workspaceRoot: root });
    const first = await propose(reopened, root, prepared); expect(first.status).toBe(200);
    const second = await propose(reopened, root, prepared); expect(second.status).toBe(200);
    expect((await second.json()).pendingAction.id).toBe((await first.json()).pendingAction.id);
    expect((await (await app.request('/api/workspace/pending-actions')).json()).pendingActions).toHaveLength(1);
    await absent(root);
  });
  it('isolates an old preview and an in-flight upload when the active workspace really changes', async () => {
    const first = await fixture(); const second = await fixture();
    const app = createNovelHonoApp({ workspaceRoot: first.root, globalConfigDir: join(first.root, '.workspace/global-config') });
    const prepared = await preview(app, first.root);
    let release!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ sourceName: 'old.md', text, expectedWorkspaceRoot: first.root }))); controller.close(); };
    } });
    const inFlight = app.request(`${prefix}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    const switched = await post(app, '/api/workspaces/open', { path: second.root });
    expect(switched.status, await switched.clone().text()).toBe(200);
    release(); expect((await inFlight).status).toBe(409);
    expect((await propose(app, first.root, prepared)).status).toBe(409);
    expect((await (await app.request('/api/workspace/pending-actions')).json()).pendingActions).toHaveLength(0);
    await absent(first.root); await absent(second.root);
  });
  it('rejects target or repository drift at promotion, and target drift again at Accept', async () => {
    const { root, app } = await fixture(); const prepared = await preview(app, root);
    await git('git', ['-C', root, 'commit', '--allow-empty', '-m', 'advanced']);
    expect((await propose(app, root, prepared)).status).toBe(409);
    const refreshed = await preview(app, root); const proposed = await propose(app, root, refreshed);
    expect(proposed.status).toBe(200); const { pendingAction } = await proposed.json();
    await mkdir(join(root, 'chapters/0001'), { recursive: true }); await writeFile(join(root, 'chapters/0001/0001.md'), '# 外部新稿\n不能覆盖');
    expect((await post(app, `/api/workspace/pending-actions/${pendingAction.id}/accept`)).status).not.toBe(200);
    expect(await readFile(join(root, 'chapters/0001/0001.md'), 'utf8')).toBe('# 外部新稿\n不能覆盖');
    await expect(readFile(join(root, 'chapters/0001/0002.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await propose(app, root, refreshed)).status).toBe(409);
  });
  it('rejects symlink destinations and oversized source before canonical writes', async () => {
    const { root, app } = await fixture(); const external = await mkdtemp(join(tmpdir(), 'oan-import-external-')); roots.push(external);
    await symlink(external, join(root, 'chapters'));
    expect((await post(app, `${prefix}/preview`, { sourceName: 'book.md', text, expectedWorkspaceRoot: root })).status).toBe(422);
    expect((await post(app, `${prefix}/preview`, { sourceName: 'book.md', text: 'x'.repeat(512 * 1024 + 1), expectedWorkspaceRoot: root })).status).toBe(422);
    await expect(readFile(join(external, '0001/0001.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('uses real HTTP and Git auto-commit for approved imported chapters', async () => {
    const { root } = await fixture(true); const backend = await startNovelHttpBackend({ workspaceRoot: root }); servers.push(backend);
    const request = (path: string, body?: unknown) => fetch(`${backend.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await request(`${prefix}/preview`, { sourceName: 'book.md', text: '正文保留', expectedWorkspaceRoot: root }); expect(response.status).toBe(200);
    const { preview: prepared } = await response.json();
    const proposed = await request(`${prefix}/previews/${prepared.id}/pending-action`, { fingerprint: prepared.fingerprint, expectedWorkspaceRoot: root }); expect(proposed.status).toBe(200);
    const { pendingAction } = await proposed.json();
    const accepted = await request(`/api/workspace/pending-actions/${pendingAction.id}/accept`); expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect((await accepted.json()).pendingAction.git.status).toBe('committed');
    expect((await git('git', ['-C', root, 'show', '--format=', '--name-only', 'HEAD'])).stdout.trim()).toBe('chapters/0001/0001.md');
  });
});
