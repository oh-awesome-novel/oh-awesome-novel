import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceTextFile } from '@oh-awesome-novel/core';
import { buildChapterIndex, readChapterIndexStatus, writeChapterIndexFile } from '@oh-awesome-novel/tools';

// Reproduce Windows relative-path producers while retaining real host paths
// for the temporary fixture. Public package calls must keep wire/cache paths POSIX.
vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:path')>();
  return { ...original, join: (...parts: string[]) => parts[0] === 'chapters'
    ? original.win32.join(...parts) : original.join(...parts) };
});

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('chapter index portable paths', () => {
  it('returns and persists chapter paths that the public reader accepts with Windows joins', async () => {
    expect(join('chapters', '0001', '0001.md')).toBe('chapters\\0001\\0001.md');
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-chapter-paths-')); roots.push(workspaceRoot);
    await mkdir(join(workspaceRoot, 'chapters/0001'), { recursive: true });
    await writeFile(join(workspaceRoot, 'chapters/0001/0000.md'), '# 第一卷\n');
    await writeFile(join(workspaceRoot, 'chapters/0001/0001.md'), '# 第一章\n\n正文。\n');

    const index = await buildChapterIndex({ workspaceRoot });
    expect(index.volumes).toEqual([{
      id: '0001', path: 'chapters/0001', title: '第一卷', metadataPath: 'chapters/0001/0000.md',
      chapters: [{ id: '0001/0001', path: 'chapters/0001/0001.md', title: '第一章', volumeId: '0001', chapterNumber: '0001' }],
    }]);
    const chapter = index.volumes[0]!.chapters[0]!;
    await expect(readWorkspaceTextFile(workspaceRoot, chapter.path)).resolves.toEqual({ path: chapter.path, content: '# 第一章\n\n正文。\n' });

    const persisted = await writeChapterIndexFile({ workspaceRoot });
    expect(persisted.volumes).toEqual(index.volumes);
    expect((await readChapterIndexStatus({ workspaceRoot })).index?.volumes).toEqual(index.volumes);
    const yaml = await readFile(join(workspaceRoot, '.oan/indexes/chapters.yaml'), 'utf8');
    expect(yaml).toContain('path: chapters/0001/0001.md');
    expect(yaml).toContain('metadataPath: chapters/0001/0000.md');
    expect(yaml).not.toContain('chapters\\');
  });
});
