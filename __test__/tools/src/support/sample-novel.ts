import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface PreparedSampleNovel {
  workspaceRoot: string;
  cleanup(): Promise<void>;
}

export async function prepareSampleNovel(): Promise<PreparedSampleNovel> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-sample-novel-'));

  try {
    await writeFileTree(workspaceRoot, {
      '.oan/constitution/identity.md': '# Identity\n\n这是一部学院奇幻小说。\n',
      '.oan/workflow.yaml': 'name: lightnovel\nsteps:\n  - chapter\n  - review\n',
      'characters/heroine/meta.yaml': [
        'id: heroine',
        'displayName: 女主',
        'importance: main',
        '',
      ].join('\n'),
      'characters/heroine/personality.md': '# 外在人格\n\n冷淡克制。\n',
      'world/magic/overview.md': '# 魔法体系\n\n银纹代表元素系魔法。\n',
      'chapters/0001/0001.md': [
        '---',
        'id: 0001/0001',
        'title: 银座学院',
        '---',
        '',
        '# Scene 1',
        '',
        '女主第一次看见银纹。',
        '',
      ].join('\n'),
      'state/characters.yaml': [
        'characters:',
        '  heroine:',
        '    hp: injured',
        '',
      ].join('\n'),
      'timeline/events.yaml': 'events:\n  - id: event_001\n    title: 女主受伤\n',
      'foreshadow/active.yaml': 'active:\n  - id: black_mark\n',
      'summaries/global.md': '# 全局摘要\n\n女主进入学院。\n',
    });
  } catch (error) {
    await rm(workspaceRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    workspaceRoot,
    cleanup: () => rm(workspaceRoot, { recursive: true, force: true }),
  };
}

async function writeFileTree(root: string, files: Record<string, string>): Promise<void> {
  await Promise.all(Object.entries(files).map(async ([file, content]) => {
    const filePath = join(root, file);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }));
}
