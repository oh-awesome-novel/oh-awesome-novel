import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  CHARACTER_OBJECT_FILES,
  WritingCommandTargetError,
  assembleNovelAgentMessages,
  createBaselineNovelAgentContextPackage,
  createNovelAgentWorkspaceSnapshotFromProjection,
  resolveWritingCommandTargets,
} from '@oh-awesome-novel/agent';
import type { SandboxProjectionSnapshot } from '@oh-awesome-novel/tools';

const roots: string[] = [];

async function workspace(files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-writing-targets-'));
  roots.push(root);
  for (const file of files) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), `# ${file}\n`);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('host-derived writing command targets', () => {
  it('targets the first chapter of an empty workspace', async () => {
    const root = await workspace([]);
    const targets = await resolveWritingCommandTargets({ workspaceRoot: root, request: '/写下一章', selectedPaths: [] });
    expect(targets?.capability).toBe('novel.write_chapter');
    expect(targets?.exactWritablePaths).toEqual(['chapters/0001/0001.md']);
  });

  it('targets the chapter after the latest one, ignoring the open file and volume metadata', async () => {
    const root = await workspace([
      'chapters/0001/0000.md', 'chapters/0001/0001.md', 'chapters/0001/0009.md', 'chapters/0001/0010.md',
      'chapters/0002/0000.md', 'chapters/0002/0001.md', 'chapters/0002/0002.md',
    ]);
    const targets = await resolveWritingCommandTargets({
      workspaceRoot: root, request: '/写下一章 请继续', selectedPaths: ['chapters/0001/0001.md'],
    });
    expect(targets?.exactWritablePaths).toEqual(['chapters/0002/0003.md']);
  });

  it('starts a new volume at chapter one when its directory has only metadata', async () => {
    const root = await workspace(['chapters/0001/0001.md', 'chapters/0002/0000.md']);
    const targets = await resolveWritingCommandTargets({ workspaceRoot: root, request: '/写下一章', selectedPaths: [] });
    expect(targets?.exactWritablePaths).toEqual(['chapters/0002/0001.md']);
  });

  it('leaves keyword-inferred and unrelated requests to the selected file', async () => {
    const root = await workspace(['chapters/0001/0001.md']);
    for (const request of ['帮我改写这一章的对话', '/审稿', '/写下一章节奏怎么样']) {
      await expect(resolveWritingCommandTargets({ workspaceRoot: root, request, selectedPaths: ['chapters/0001/0001.md'] }))
        .resolves.toBeUndefined();
    }
  });

  it('grants the standard files of a named or selected character only', async () => {
    const root = await workspace([]);
    const named = await resolveWritingCommandTargets({ workspaceRoot: root, request: '/生成角色卡 lin-zhao\n十七岁的剑客', selectedPaths: [] });
    expect(named?.exactWritablePaths).toEqual(CHARACTER_OBJECT_FILES.map((file) => `characters/lin-zhao/${file}`));
    const selected = await resolveWritingCommandTargets({
      workspaceRoot: root, request: '/生成角色卡 补充外貌', selectedPaths: ['characters/gu_yuan/summary.md'],
    });
    expect(selected?.exactWritablePaths[0]).toBe('characters/gu_yuan/meta.yaml');
    const prose = await resolveWritingCommandTargets({ workspaceRoot: root, request: '/生成角色卡 林照，十七岁', selectedPaths: [] });
    expect(prose?.exactWritablePaths).toEqual([]);
    await expect(resolveWritingCommandTargets({ workspaceRoot: root, request: '/生成角色卡 -bad', selectedPaths: [] }))
      .rejects.toBeInstanceOf(WritingCommandTargetError);
  });

  it('grants the main and active volume outline for planning, and the next volume for volume planning', async () => {
    const root = await workspace(['chapters/0001/0001.md', 'chapters/0002/0004.md']);
    const chapter = await resolveWritingCommandTargets({ workspaceRoot: root, request: '/规划下一章', selectedPaths: [] });
    expect(chapter?.exactWritablePaths).toEqual(['outline/main.md', 'outline/volumes/0002.md']);
    const selected = await resolveWritingCommandTargets({ workspaceRoot: root, request: '/规划大纲', selectedPaths: ['chapters/0001/0001.md'] });
    expect(selected?.exactWritablePaths).toEqual(['outline/main.md', 'outline/volumes/0001.md']);
    const volume = await resolveWritingCommandTargets({ workspaceRoot: root, request: '/规划下一卷', selectedPaths: [] });
    expect(volume?.exactWritablePaths).toEqual(['outline/main.md', 'outline/volumes/0003.md']);
  });
});

describe('continuation context', () => {
  function projection(files: Record<string, string>): SandboxProjectionSnapshot {
    return { workspaceRoot: '/novel', projectionFingerprint: 'a'.repeat(64), directories: [], files: Object.entries(files)
      .toSorted(([a], [b]) => (a < b ? -1 : 1)).map(([path, content]) => ({ path, content, mtimeMs: 0, mode: 0o644 })) };
  }

  it('loads the outline and the previous chapter ending for the next chapter target', () => {
    const longChapter = `开头不该出现${'。'.repeat(4_000)}结尾的钩子`;
    const snapshot = createNovelAgentWorkspaceSnapshotFromProjection(projection({
      'outline/main.md': '# 主线\n穿越者改变结局',
      'outline/volumes/0001.md': '# 第一卷',
      'outline/volumes/0002.md': '# 第二卷',
      'chapters/0001/0001.md': '第一章',
      'chapters/0001/0002.md': longChapter,
    }), { targetPaths: ['chapters/0001/0003.md'], writableTargets: ['chapters/0001/0003.md'] });
    expect(snapshot.outline).toContain('穿越者改变结局');
    expect(snapshot.outline).toContain('第一卷');
    expect(snapshot.outline).not.toContain('第二卷');
    expect(snapshot.previousChapter).toContain('chapters/0001/0002.md');
    expect(snapshot.previousChapter).toContain('结尾的钩子');
    expect(snapshot.previousChapter).not.toContain('开头不该出现');

    const contextPackage = createBaselineNovelAgentContextPackage({ request: '/写下一章', workspace: snapshot })!;
    expect(contextPackage.selected.map((source) => source.sourceId)).toEqual(expect.arrayContaining(['outline', 'previousChapterText']));
    const assembly = assembleNovelAgentMessages({ request: '/写下一章', workspace: snapshot, contextPackage });
    expect(assembly.messages[0]?.content).toContain('Writable targets granted by the host for this turn: chapters/0001/0003.md');
    expect(assembly.context.map((item) => item.title)).toEqual(expect.arrayContaining(['Outline', 'Previous Chapter Ending']));
  });

  it('tells the model when a turn is read-only', () => {
    const snapshot = createNovelAgentWorkspaceSnapshotFromProjection(projection({}), { writableTargets: [] });
    const assembly = assembleNovelAgentMessages({ request: '聊聊主角', workspace: snapshot });
    expect(assembly.messages[0]?.content).toContain('This turn is read-only');
  });
});
