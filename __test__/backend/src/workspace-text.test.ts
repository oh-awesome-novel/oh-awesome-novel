import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-search-http-')); roots.push(workspaceRoot);
  await mkdir(join(workspaceRoot, 'chapters/0001'), { recursive: true });
  await writeFile(join(workspaceRoot, 'chapters/0001/0001.md'), '---\ntitle: first\n---\n# 雪夜\n林清越风雪归来');
  await mkdir(join(workspaceRoot, '.oan/constitution'), { recursive: true });
  await writeFile(join(workspaceRoot, '.oan/constitution/style.md'), '风雪文风');
  await writeFile(join(workspaceRoot, '.oan/config.yaml'), 'secret: private');
  return { workspaceRoot, app: createNovelHonoApp({ workspaceRoot }) };
}
describe('workspace search and export HTTP contract', () => {
  it('returns client-valid canonical search and ordered manuscript responses without a provider', async () => {
    const { app } = await fixture();
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch });
    const response = await client.searchWorkspace('清越风雪');
    expect(response.results).toEqual([expect.objectContaining({ path: 'chapters/0001/0001.md', line: 5, snippet: '林清越风雪归来' })]);
    expect((await client.exportManuscript('txt')).content).toBe('雪夜\n林清越风雪归来\n');
    const tree = await (await app.request('/api/workspace/tree')).json();
    expect(JSON.stringify(tree)).toContain('.oan/constitution/style.md');
    expect(JSON.stringify(tree)).not.toContain('config.yaml');
    const file = await app.request('/api/workspace/file?path=.oan/constitution/style.md'); expect(file.status).toBe(200);
    expect(await file.json()).toEqual({ path: '.oan/constitution/style.md', content: '风雪文风' });
  });
  it.each(['/api/workspace/search', '/api/workspace/search?q=abc&root=/tmp', '/api/workspace/manuscript/export?format=pdf', '/api/workspace/manuscript/export?format=md&target=/tmp/a.md'])('rejects invalid parameters %s', async (url) => {
    const { app } = await fixture(); expect((await app.request(url)).status).toBe(400);
  });
  it('rejects hidden configuration and external links across search, viewer and export', async () => {
    const { app, workspaceRoot } = await fixture();
    expect((await app.request('/api/workspace/file?path=.oan/config.yaml')).status).toBe(400);
    await symlink(join(workspaceRoot, '.oan/config.yaml'), join(workspaceRoot, 'chapters/0001/0002.md'));
    for (const url of ['/api/workspace/search?q=secret', '/api/workspace/manuscript/export?format=md']) {
      const response = await app.request(url); expect(response.status).toBe(422); expect(await response.text()).not.toContain('private');
    }
    expect((await app.request('/api/workspace/file?path=chapters/0001/0002.md')).status).toBe(400);
  });
});
