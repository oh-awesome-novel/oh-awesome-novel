import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acceptPendingAction,
  createWriteIntentTools,
  listPendingActions,
  rejectPendingAction,
} from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('write intent tools and human approval', () => {
  it('returns a PendingAction with a shadow write instead of materializing state.set', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    const result = await executeTool(tools, 'state.set', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    });

    const action = expectSinglePendingAction(result);
    expect(action).toMatchObject({
      title: 'Set state characters.heroine.hp',
      touchedFiles: ['state/characters.yaml'],
      status: 'pending',
    });
    expect(action.diff).toContain('-    hp: injured');
    expect(action.diff).toContain('+    hp: recovering');
    expect(action.shadowWrites[0]).toMatchObject({
      targetFile: 'state/characters.yaml',
    });

    await expect(
      readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'),
    ).resolves.toContain('hp: injured');
    await expect(
      readFile(join(workspaceRoot, action.shadowWrites[0].shadowFile), 'utf-8'),
    ).resolves.toContain('hp: recovering');
    await expect(listPendingActions({ workspaceRoot })).resolves.toHaveLength(1);
  });

  it('accepts a PendingAction, writes the real file, and auto-commits touched files by default', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    await initGitRepo(workspaceRoot);
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'character.updatePersonality', {
      characterId: 'heroine',
      section: '外在人格',
      content: '她在人前更加冷淡克制，但会默默保护同伴。',
    });
    const action = expectSinglePendingAction(result);

    const accepted = await acceptPendingAction({
      workspaceRoot,
      id: action.id,
    });

    expect(accepted).toMatchObject({
      id: action.id,
      status: 'accepted',
      appliedFiles: ['characters/heroine/personality.md'],
      gitCommit: {
        status: 'committed',
        message: expect.stringContaining('chore(novel): apply pending action'),
      },
    });
    expect(accepted.gitDiff).toBe('');
    expect(accepted.dirtyStatus).toBe('');
    await expect(
      readFile(join(workspaceRoot, 'characters/heroine/personality.md'), 'utf-8'),
    ).resolves.toContain('更加冷淡克制');
    await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
    await expect(git(workspaceRoot, ['show', '--name-only', '--format=', 'HEAD']))
      .resolves
      .toContain('characters/heroine/personality.md');
  });

  it('can accept a PendingAction without auto-committing', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    await initGitRepo(workspaceRoot);
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'state.set', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    });
    const action = expectSinglePendingAction(result);

    const accepted = await acceptPendingAction({
      workspaceRoot,
      id: action.id,
      autoCommitOnAccept: false,
    });

    expect(accepted.gitCommit).toMatchObject({
      status: 'skipped',
      reason: 'auto_commit_disabled',
    });
    expect(accepted.gitDiff).toContain('hp: recovering');
    expect(accepted.dirtyStatus).toContain('state/characters.yaml');
  });

  it('rejects a PendingAction without writing the target and marks the shadow write rejected', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'timeline.add', {
      event: {
        id: 'event_002',
        chapter: '0001/0002',
        title: '拒绝的事件',
        description: '不应该写入真实文件。',
      },
    });
    const action = expectSinglePendingAction(result);
    const shadowFile = join(workspaceRoot, action.shadowWrites[0].shadowFile);

    const rejected = await rejectPendingAction({
      workspaceRoot,
      id: action.id,
    });

    expect(rejected).toMatchObject({
      id: action.id,
      status: 'rejected',
    });
    await expect(
      readFile(join(workspaceRoot, 'timeline/events.yaml'), 'utf-8'),
    ).resolves.not.toContain('拒绝的事件');
    await expect(stat(shadowFile)).rejects.toThrow();
    await expect(
      readFile(join(workspaceRoot, '.workspace', 'rejected-actions', `${action.id}.json`), 'utf-8'),
    ).resolves.toContain('"status": "rejected"');
  });

  it('creates all initial M6 write intent tools', () => {
    const tools = createWriteIntentTools({ workspaceRoot: '/tmp/unused' });

    expect(Object.keys(tools)).toEqual([
      'chapter.createDraft',
      'character.updatePersonality',
      'state.set',
      'timeline.add',
      'foreshadow.create',
      'summary.generateChapter',
    ]);
  });

  it('creates a chapter draft PendingAction and materializes it only on accept', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    const result = await executeTool(tools, 'chapter.createDraft', {
      chapterId: '0001/0001',
      title: '第一章',
      content: '她推开门，看见雨停在半空。',
    });
    const action = expectSinglePendingAction(result);

    expect(action).toMatchObject({
      title: 'Create chapter 0001/0001 draft',
      touchedFiles: ['chapters/0001/0001.md'],
      status: 'pending',
    });
    expect(action.diff).toContain('+# 第一章');
    await expect(
      readFile(join(workspaceRoot, 'chapters/0001/0001.md'), 'utf-8'),
    ).rejects.toThrow();

    await acceptPendingAction({ workspaceRoot, id: action.id });

    await expect(
      readFile(join(workspaceRoot, 'chapters/0001/0001.md'), 'utf-8'),
    ).resolves.toContain('她推开门');
  });

  it('uses the stable numbered chapter summary path by default', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    const result = await executeTool(tools, 'summary.generateChapter', {
      chapterId: '0001/0001',
      content: '# Chapter 0001\n\n新摘要。',
    });

    const action = expectSinglePendingAction(result);
    expect(action.touchedFiles).toEqual(['summaries/chapter/0001/0001.md']);
    expect(action.shadowWrites[0]).toMatchObject({
      targetFile: 'summaries/chapter/0001/0001.md',
    });
    await expect(
      readFile(join(workspaceRoot, 'summaries/chapter/0001/0001.md'), 'utf-8'),
    ).resolves.toContain('旧摘要');
    await expect(
      readFile(join(workspaceRoot, action.shadowWrites[0].shadowFile), 'utf-8'),
    ).resolves.toContain('新摘要');
  });

  it('blocks formal write tools from targeting hidden files or directories', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0001',
        file: '../.hidden.md',
        content: 'blocked',
      }),
    ).rejects.toThrow(/Invalid workspace relative path/);
  });

  it('rejects generating a chapter summary for volume metadata 0000', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0000',
        content: 'not a chapter',
      }),
    ).rejects.toThrow(/reserved for volume metadata/);
  });

  it('rejects chapter summary file overrides that target volume metadata 0000', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0001',
        file: 'chapter/0001/0000.md',
        content: 'not a chapter summary target',
      }),
    ).rejects.toThrow(/reserved for volume metadata/);
  });

  it('rejects chapter summary file overrides that do not match the chapter id', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0001',
        file: 'chapter/0001/0002.md',
        content: 'wrong chapter summary target',
      }),
    ).rejects.toThrow(/must match chapter id 0001\/0001/);
  });

  it('rejects shadow writes when internal .workspace points outside', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const outsideRoot = await createTempRoot();
    await symlink(outsideRoot, join(workspaceRoot, '.workspace'));
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'state.set', {
        file: 'characters.yaml',
        path: 'characters.heroine.hp',
        value: 'blocked',
      }),
    ).rejects.toThrow(/outside the active workspace/);
    await expect(readdir(outsideRoot)).resolves.toEqual([]);
  });
});

interface TestPendingAction {
  id: string;
  title: string;
  touchedFiles: string[];
  diff: string;
  status: 'pending';
  shadowWrites: Array<{
    targetFile: string;
    shadowFile: string;
  }>;
}

async function createTempNovelWorkspace(): Promise<string> {
  const root = await createTempRoot();

  await mkdir(join(root, 'characters/heroine'), { recursive: true });
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await mkdir(join(root, 'state'), { recursive: true });
  await mkdir(join(root, 'timeline'), { recursive: true });
  await mkdir(join(root, 'foreshadow'), { recursive: true });
  await mkdir(join(root, 'summaries/chapter/0001'), { recursive: true });
  await writeFile(
    join(root, 'characters/heroine/personality.md'),
    `---
id: heroine
---

# 外在人格

冷淡克制。

# 内在人格

温柔但隐藏。
`,
    'utf-8',
  );
  await writeFile(
    join(root, 'state/characters.yaml'),
    `characters:
  heroine:
    hp: injured
`,
    'utf-8',
  );
  await writeFile(
    join(root, 'timeline/events.yaml'),
    `events:
  - id: event_001
    chapter: '0001/0001'
    title: 已有事件
    description: 已存在。
`,
    'utf-8',
  );
  await writeFile(join(root, 'foreshadow/active.yaml'), 'active: []\n', 'utf-8');
  await writeFile(
    join(root, 'summaries/chapter/0001/0001.md'),
    '# Chapter 0001\n\n旧摘要。\n',
    'utf-8',
  );

  return root;
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-write-intent-'));
  tempRoots.push(root);
  return root;
}

async function initGitRepo(workspaceRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: workspaceRoot });
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
}

async function git(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: workspaceRoot });
  return stdout;
}

async function executeTool(
  tools: ToolSet,
  name: string,
  args: unknown,
): Promise<unknown> {
  const executable = tools[name] as {
    execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
  };

  if (!executable?.execute) {
    throw new Error(`Tool ${name} is not executable.`);
  }

  return executable.execute(args, {});
}

function expectSinglePendingAction(result: unknown): TestPendingAction {
  expect(result).toMatchObject({
    pendingActions: [expect.any(Object)],
  });

  const action = (result as { pendingActions: TestPendingAction[] }).pendingActions[0];
  expect(action.shadowWrites).toHaveLength(1);
  return action;
}
