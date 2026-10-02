import { mkdtemp, mkdir, writeFile, rm, rename, symlink, link, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { searchWorkspaceText, exportManuscript, readWorkspaceTextFile } from '@oh-awesome-novel/core';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), 'oan-text-')); roots.push(value); return value; }
async function put(root: string, path: string, content: string | Buffer) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); }

describe('safe canonical workspace search', () => {
  it('finds continuous Chinese, role names and mixed English with snippets and line numbers', async () => {
    const r = await root(); await put(r, 'chapters/0001/0001.md', '# 黎明\n林清越穿过长夜风雪，进入BeiJing车站。\n尾声');
    for (const query of ['清越穿过', '长夜风雪', 'beijing车站']) {
      const response = await searchWorkspaceText(r, query);
      expect(response.results).toEqual([expect.objectContaining({ line: 2, snippet: '林清越穿过长夜风雪，进入BeiJing车站。', matchedField: 'content' })]);
      expect(response.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect((await searchWorkspaceText(r, '0001.md')).results[0]).toMatchObject({ matchedField: 'path', line: 1 });
  });
  it('only scans novel roots and the two explicit hidden control namespaces', async () => {
    const r = await root();
    for (const path of ['outline/a.md', '.oan/constitution/style.md', '.oan/workflow.yaml', '.oan/config.yaml', '.oan/sessions/a.md', '.workspace/a.md', '.git/a.md', 'references/a.md', 'node_modules/a.md', 'world/.secret.md']) await put(r, path, '风雪');
    expect((await searchWorkspaceText(r, '风雪')).results.map((hit) => hit.path)).toEqual(['.oan/constitution/style.md', '.oan/workflow.yaml', 'outline/a.md']);
    expect((await readWorkspaceTextFile(r, '.oan/constitution/style.md')).content).toBe('风雪');
    await expect(readWorkspaceTextFile(r, '.oan/config.yaml')).rejects.toThrow();
  });
  it('re-reads edits, renames and deletes instead of retaining a stale index', async () => {
    const r = await root(); await put(r, 'characters/a.md', '旧名');
    const first = await searchWorkspaceText(r, '旧名');
    await put(r, 'characters/a.md', '新名');
    expect((await searchWorkspaceText(r, '旧名')).results).toEqual([]);
    await rename(join(r, 'characters/a.md'), join(r, 'characters/b.md'));
    const next = await searchWorkspaceText(r, '新名'); expect(next.results[0]?.path).toBe('characters/b.md'); expect(next.sourceFingerprint).not.toBe(first.sourceFingerprint);
    await rm(join(r, 'characters/b.md')); expect((await searchWorkspaceText(r, '新名')).results).toEqual([]);
  });
  it.each(['leaf', 'directory', 'hardlink'])('rejects %s links instead of returning external content', async (kind) => {
    const r = await root(); const outside = await root(); await put(outside, 'secret.md', '私密'); await mkdir(join(r, 'world'));
    if (kind === 'directory') await symlink(outside, join(r, 'world/location'));
    else if (kind === 'hardlink') await link(join(outside, 'secret.md'), join(r, 'world/secret.md'));
    else await symlink(join(outside, 'secret.md'), join(r, 'world/secret.md'));
    await expect(searchWorkspaceText(r, '私密')).rejects.toThrow();
    await expect(readWorkspaceTextFile(r, kind === 'directory' ? 'world/location/secret.md' : 'world/secret.md')).rejects.toThrow();
  });
  it.each(['../secret.md', '/etc/passwd', 'world/../secret.md', 'world/.hidden/a.md', 'world\\a.md', '.oan/constitution/.oan/secret.md'])('rejects unsafe viewer path %s', async (path) => {
    await expect(readWorkspaceTextFile(await root(), path)).rejects.toThrow();
  });
  it.each([Buffer.from([255]), Buffer.from('a\0b'), Buffer.alloc(2 * 1024 * 1024 + 1, 97)])('rejects non-text or oversized source', async (content) => {
    const r = await root(); await put(r, 'world/a.md', content); await expect(searchWorkspaceText(r, 'a')).rejects.toThrow();
  });
  it('bounds snippets and reports truncated results', async () => {
    const r = await root(); await Promise.all(Array.from({ length: 101 }, (_, i) => put(r, `world/${i}.md`, `${'前'.repeat(500)}风雪${'后'.repeat(500)}`)));
    const response = await searchWorkspaceText(r, '风雪'); expect(response.results).toHaveLength(100); expect(response.truncated).toBe(true);
    expect(response.results[0]?.snippet).toContain('风雪'); expect(Array.from(response.results[0]!.snippet).length).toBeLessThanOrEqual(242);
  });
  it.each(['', ' ', 'a\nb', 'a'.repeat(161)])('rejects invalid query', async (query) => { await expect(searchWorkspaceText(await root(), query)).rejects.toThrow(); });
});

describe('readable manuscript export', () => {
  it('exports only canonical chapter bodies in stable volume/chapter order without writing files', async () => {
    const r = await root();
    const files = { 'chapters/0002/0001.md': '# 第三章\n终章', 'chapters/0001/0002.md': '# 第二章\n中段', 'chapters/0001/0001.md': '---\ntitle: 元数据\n---\n# 第一章\n正文', 'chapters/0001/0000.md': '卷摘要', 'chapters/flat.md': '旧稿', 'summaries/a.md': '摘要', '.workspace/draft.md': '未接受', 'references/a.md': '参考' };
    for (const [p, content] of Object.entries(files)) await put(r, p, content);
    const before = await readdir(r, { recursive: true });
    const md = await exportManuscript(r, 'md');
    expect(md.chapterPaths).toEqual(['chapters/0001/0001.md', 'chapters/0001/0002.md', 'chapters/0002/0001.md']);
    expect(md.content).toBe('# 第一章\n正文\n\n---\n\n# 第二章\n中段\n\n---\n\n# 第三章\n终章\n');
    expect((await exportManuscript(r, 'txt')).content).toBe('第一章\n正文\n\n第二章\n中段\n\n第三章\n终章\n');
    expect(await readdir(r, { recursive: true })).toEqual(before);
    for (const [p, content] of Object.entries(files)) expect(await readFile(join(r, p), 'utf8')).toBe(content);
  });
  it('rejects absent chapters and malformed frontmatter', async () => {
    const r = await root(); await expect(exportManuscript(r, 'md')).rejects.toThrow('No canonical');
    await put(r, 'chapters/0001/0001.md', '---\nsecret: metadata'); await expect(exportManuscript(r, 'txt')).rejects.toThrow('Unterminated');
  });
});
