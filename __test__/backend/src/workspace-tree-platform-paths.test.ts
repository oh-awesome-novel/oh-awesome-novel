import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';

// Return Windows relative strings at the producer boundary, while absolute
// paths and filesystem calls continue using the real temporary host fixture.
vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:path')>();
  return { ...original, sep: '\\', relative: (from: string, to: string) => original.relative(from, to).replaceAll('/', '\\') };
});

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('workspace tree portable HTTP paths', () => {
  it('returns nested Windows file tree entries that round-trip through the public viewer', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-tree-paths-')); roots.push(workspaceRoot);
    await mkdir(join(workspaceRoot, 'chapters/0001'), { recursive: true });
    await writeFile(join(workspaceRoot, 'chapters/0001/0001.md'), '# 第一章\n\n正文。\n');
    await mkdir(join(workspaceRoot, '.oan/constitution'), { recursive: true });
    await writeFile(join(workspaceRoot, '.oan/constitution/style.md'), '作者文风。');
    await writeFile(join(workspaceRoot, '.oan/config.yaml'), 'secret: hidden');
    expect(relative(workspaceRoot, join(workspaceRoot, 'chapters/0001/0001.md'))).toBe('chapters\\0001\\0001.md');

    const app = createNovelHonoApp({ workspaceRoot });
    const response = await app.request('/api/workspace/tree');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.tree).toEqual([
      { name: '.oan', path: '.oan', type: 'directory', children: [
        { name: 'constitution', path: '.oan/constitution', type: 'directory', children: [
          { name: 'style.md', path: '.oan/constitution/style.md', type: 'file' },
        ] },
      ] },
      { name: 'chapters', path: 'chapters', type: 'directory', children: [
        { name: '0001', path: 'chapters/0001', type: 'directory', children: [
          { name: '0001.md', path: 'chapters/0001/0001.md', type: 'file' },
        ] },
      ] },
    ]);
    for (const path of ['chapters/0001/0001.md', '.oan/constitution/style.md']) {
      const file = await app.request(`/api/workspace/file?path=${encodeURIComponent(path)}`);
      expect(file.status).toBe(200);
      expect(await file.json()).toMatchObject({ path });
    }
  });
});
