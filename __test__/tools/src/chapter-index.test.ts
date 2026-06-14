import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildChapterIndex,
  readChapterIndexStatus,
  writeChapterIndexFile,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('chapter index', () => {
  it('builds a semantic chapter index from stable numbered paths', async () => {
    const workspaceRoot = await createChapterWorkspace();

    const index = await buildChapterIndex({ workspaceRoot });

    expect(index.volumes.map((volume) => volume.id)).toEqual(['0001', '0002']);
    expect(index.volumes[0]).toMatchObject({
      id: '0001',
      title: '第一卷 黑纹初现',
      metadataPath: 'chapters/0001/0000.md',
    });
    expect(index.volumes[0].chapters.map((chapter) => chapter.id)).toEqual([
      '0001/0001',
      '0001/0002',
    ]);
    expect(index.volumes[0].chapters.map((chapter) => chapter.title)).toEqual([
      '入学日',
      '0001/0002 未命名章节',
    ]);
    expect(index.volumes.flatMap((volume) => volume.chapters))
      .not
      .toContainEqual(expect.objectContaining({ id: '0001/0000' }));
  });

  it('writes and validates the derived chapter index file', async () => {
    const workspaceRoot = await createChapterWorkspace();
    await initGitRepo(workspaceRoot);

    const persisted = await writeChapterIndexFile({ workspaceRoot });
    const raw = await readFile(join(workspaceRoot, '.oan/indexes/chapters.yaml'), 'utf-8');
    const status = await readChapterIndexStatus({ workspaceRoot });

    expect(raw).toContain('kind: chapter-index');
    expect(persisted).toMatchObject({
      kind: 'chapter-index',
      version: 1,
      git: { dirty: false },
      source: { root: 'chapters' },
    });
    expect(persisted.git.head).toEqual(expect.any(String));
    expect(status).toMatchObject({
      status: 'dirty',
      currentGitHead: persisted.git.head,
      dirty: true,
    });
  });

  it('marks an index dirty when workspace content changes after scanning', async () => {
    const workspaceRoot = await createChapterWorkspace();
    await initGitRepo(workspaceRoot);
    await writeChapterIndexFile({ workspaceRoot });
    await writeFile(
      join(workspaceRoot, 'chapters/0001/0003.md'),
      '# 第三章\n\n新增章节。\n',
      'utf-8',
    );

    await expect(readChapterIndexStatus({ workspaceRoot }))
      .resolves
      .toMatchObject({ status: 'dirty', dirty: true });
  });

  it('reports missing status when no derived index exists', async () => {
    const workspaceRoot = await createChapterWorkspace();

    await expect(readChapterIndexStatus({ workspaceRoot }))
      .resolves
      .toMatchObject({ status: 'missing', index: null });
  });
});

async function createChapterWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-chapter-index-'));
  tempRoots.push(root);

  await mkdir(join(root, '.oan/indexes'), { recursive: true });
  await mkdir(join(root, 'chapters/0002'), { recursive: true });
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(
    join(root, 'chapters/0001/0000.md'),
    `---
title: 第一卷 黑纹初现
---

# 不应优先用这个标题
`,
    'utf-8',
  );
  await writeFile(
    join(root, 'chapters/0001/0002.md'),
    '没有标题的章节正文。\n',
    'utf-8',
  );
  await writeFile(
    join(root, 'chapters/0001/0001.md'),
    '# 入学日\n\n她第一次看见银纹。\n',
    'utf-8',
  );
  await writeFile(
    join(root, 'chapters/0002/0000.md'),
    '# 第二卷 遗迹\n\n卷说明。\n',
    'utf-8',
  );
  await writeFile(
    join(root, 'chapters/0002/0001.md'),
    `---
title: 遗迹入口
---

正文。
`,
    'utf-8',
  );

  return root;
}

async function initGitRepo(workspaceRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: workspaceRoot });
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
}
