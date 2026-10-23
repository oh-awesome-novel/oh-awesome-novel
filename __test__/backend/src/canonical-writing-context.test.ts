import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNovelHonoApp, loadCanonicalWritingContext, readCanonicalWritingSources, saveCanonicalWritingSources } from '@oh-awesome-novel/backend';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'forge-writing-')); roots.push(root); await mkdir(join(root, 'characters/lead'), { recursive: true }); await writeFile(join(root, 'characters/lead/profile.md'), '角色的约定：明天归还三枚铜钱。'); return root; }
describe('explicit canonical Writing context', () => {
  it('loads exact approved source bytes with evidence and detects drift', async () => {
    const root = await fixture(); const context = await loadCanonicalWritingContext(root, ['characters/lead/profile.md']);
    expect(context.items[0]?.content).toContain('三枚铜钱'); expect(context.items[0]?.provenance?.[0]).toMatchObject({ path: 'characters/lead/profile.md', attribution: 'exact', sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await context.assertFresh(); await writeFile(join(root, 'characters/lead/profile.md'), 'changed'); await expect(context.assertFresh()).rejects.toThrow();
  });
  it('rejects hidden, escaped, missing, duplicate and symlink sources', async () => {
    const root = await fixture(); for (const paths of [['.workspace/secrets.yaml'], ['characters/../secrets'], ['world/rules.md'], ['characters/lead/profile.md', 'characters/lead/profile.md']]) await expect(loadCanonicalWritingContext(root, paths)).rejects.toThrow();
    await mkdir(join(root, 'world')); await symlink(join(root, 'characters/lead/profile.md'), join(root, 'world/rules.md')); await expect(loadCanonicalWritingContext(root, ['world/rules.md'])).rejects.toThrow();
  });
  it('persists project selection and removals through a fresh backend instance', async () => {
    const root = await fixture();
    const before = await import('node:fs/promises').then(fs => fs.readFile(join(root, 'characters/lead/profile.md'), 'utf8'));
    const app = createNovelHonoApp({ workspaceRoot: root });
    const put = await app.request('/api/workspace/writing-sources', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspacePath: root, sourcePaths: ['characters/lead/profile.md'] }) });
    expect(put.status).toBe(200);
    const restarted = createNovelHonoApp({ workspaceRoot: root });
    const loaded = await restarted.request(`/api/workspace/writing-sources?workspacePath=${encodeURIComponent(root)}`);
    expect(await loaded.json()).toEqual({ sourcePaths: ['characters/lead/profile.md'] });
    const removed = await restarted.request('/api/workspace/writing-sources', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspacePath: root, sourcePaths: [] }) });
    expect(removed.status).toBe(200);
    expect(await readCanonicalWritingSources(root)).toEqual([]);
    expect(await import('node:fs/promises').then(fs => fs.readFile(join(root, 'characters/lead/profile.md'), 'utf8'))).toBe(before);
  });
  it('isolates workspaces and rejects stale workspace mutations and unsafe metadata', async () => {
    const root = await fixture(); const other = await fixture();
    await saveCanonicalWritingSources(root, ['characters/lead/profile.md']);
    expect(await readCanonicalWritingSources(other)).toEqual([]);
    const app = createNovelHonoApp({ workspaceRoot: other });
    const stale = await app.request('/api/workspace/writing-sources', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspacePath: root, sourcePaths: [] }) });
    expect(stale.status).toBe(409);
    expect(await readCanonicalWritingSources(root)).toEqual(['characters/lead/profile.md']);
    await expect(saveCanonicalWritingSources(root, ['.workspace/provider.yaml'])).rejects.toThrow();
    await rm(join(other, '.workspace/writing'), { recursive: true });
    await symlink(join(root, '.workspace/writing'), join(other, '.workspace/writing'));
    await expect(readCanonicalWritingSources(other)).rejects.toThrow('Unsafe');
  });
  it('allows a canonical workspace reached through an aliased parent directory', async () => {
    const root = await fixture();
    const holder = await mkdtemp(join(tmpdir(), 'writing-parent-alias-')); roots.push(holder);
    const alias = join(holder, 'parent');
    await symlink(dirname(root), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const viaParent = join(alias, basename(root));
    await saveCanonicalWritingSources(viaParent, ['characters/lead/profile.md']);
    expect(await readCanonicalWritingSources(root)).toEqual(['characters/lead/profile.md']);
    expect(await readCanonicalWritingSources(viaParent)).toEqual(['characters/lead/profile.md']);
  });
  it('injects selected sources into chat while keeping writable targets independent', async () => {
    const root = await fixture(); let received: unknown;
    const app = createNovelHonoApp({ workspaceRoot: root, runAgent: async function* (input) { received = input; } });
    const response = await app.request('/api/agent/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: '请根据这些设定讨论开场', canonicalWritingSourcePaths: ['characters/lead/profile.md'] }) });
    await response.text(); expect(response.status).toBe(200); expect(received).toMatchObject({ exactWritablePaths: [], canonicalWritingContext: { items: [{ content: '角色的约定：明天归还三枚铜钱。' }] } });
  });
});
