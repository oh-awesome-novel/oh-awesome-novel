import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createReadTools } from '@oh-awesome-novel/tools';
import type { WorkspaceReader } from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

import { prepareSampleNovel } from './support/sample-novel';

let workspaceRoot = '';
let cleanupSampleNovel: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const sampleNovel = await prepareSampleNovel();
  workspaceRoot = sampleNovel.workspaceRoot;
  cleanupSampleNovel = sampleNovel.cleanup;
});

afterAll(async () => {
  await cleanupSampleNovel?.();
});

describe('read tools', () => {
  it('creates the initial read tool set', () => {
    const ids = Object.keys(createReadTools({ workspaceRoot }));

    expect(ids).toEqual([
      'character.list',
      'character.get',
      'world.search',
      'chapter.get',
      'state.get',
      'timeline.list',
      'foreshadow.list',
      'summary.get',
      'constitution.get',
      'workflow.get',
    ]);
  });

  it('rejects workspace files that resolve through a symlink to the outside', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'oan-read-tool-outside-'));
    const outsideFile = join(outsideRoot, 'secret.yaml');
    const linkName = `outside-${Date.now()}.yaml`;
    const linkPath = join(workspaceRoot, 'state', linkName);

    try {
      await writeFile(outsideFile, 'secret: should-not-leak\n', 'utf-8');
      await symlink(outsideFile, linkPath);

      await expect(executeTool(createReadTools({ workspaceRoot }), 'state.get', {
        file: linkName,
      })).rejects.toThrow('resolves outside workspace');
    } finally {
      await rm(linkPath, { force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('reads structured character and state data', async () => {
    const tools = createReadTools({ workspaceRoot });
    const characterResult = await executeTool(tools, 'character.get', {
      id: 'heroine',
    });
    const stateResult = await executeTool(tools, 'state.get', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
    });

    expect(characterResult).toMatchObject({
      id: 'heroine',
      files: {
        'meta.yaml': {
          id: 'heroine',
        },
      },
    });
    expect(stateResult).toEqual({
      file: 'state/characters.yaml',
      data: 'injured',
    });
  });

  it('reads world, chapter, constitution, workflow and collection domains', async () => {
    const tools = createReadTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'world.search', { query: '银纹' }),
    ).resolves.toMatchObject({ matches: expect.any(Array) });
    await expect(
      executeTool(tools, 'chapter.get', { id: '0001/0001' }),
    ).resolves.toMatchObject({ id: '0001/0001' });
    await expect(
      executeTool(tools, 'timeline.list', {}),
    ).resolves.toMatchObject({ files: expect.any(Array) });
    await expect(
      executeTool(tools, 'foreshadow.list', {}),
    ).resolves.toMatchObject({ files: expect.any(Array) });
    await expect(
      executeTool(tools, 'summary.get', {}),
    ).resolves.toMatchObject({ file: 'summaries/global.md' });
    await expect(
      executeTool(tools, 'constitution.get', {}),
    ).resolves.toMatchObject({ files: expect.any(Array) });
    await expect(
      executeTool(tools, 'workflow.get', {}),
    ).resolves.toMatchObject({ file: '.oan/workflow.yaml' });
  });

  it('rejects volume metadata as a chapter.get target', async () => {
    const tools = createReadTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'chapter.get', { id: '0001/0000' }),
    ).rejects.toThrow(/reserved for volume metadata/);
  });

  it('can read exclusively from an injected fixed projection', async () => {
    const reader = createMemoryReader({
      '/workspace/chapters/0001/0001.md': [
        '---',
        'id: 0001/0001',
        'title: Snapshot title',
        '---',
        '',
        '# Scene',
        '',
        'Snapshot bytes only.',
        '',
      ].join('\n'),
    });
    const tools = createReadTools({ workspaceRoot: '/workspace', reader });

    await expect(executeTool(tools, 'chapter.get', { id: '0001/0001' }))
      .resolves
      .toMatchObject({
        frontmatter: { title: 'Snapshot title' },
        content: expect.stringContaining('Snapshot bytes only.'),
      });
  });
});

async function executeTool(
  tools: ToolSet,
  name: string,
  args: unknown,
): Promise<unknown> {
  const executable = tools[name];

  if (!executable?.execute) {
    throw new Error(`Tool ${name} is not executable.`);
  }

  return executable.execute(args as never, {
    toolCallId: `test-${name}`, messages: [], context: undefined,
  });
}

function createMemoryReader(files: Record<string, string>): WorkspaceReader {
  return {
    async readFile(path) {
      const content = files[path];
      if (content === undefined) throw new Error(`Missing projected file: ${path}`);
      return content;
    },
    async readdir(path) {
      const prefix = `${path.replace(/\/$/u, '')}/`;
      const children = new Map<string, { isFile: boolean; isDirectory: boolean }>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const remainder = file.slice(prefix.length);
        const [name] = remainder.split('/');
        if (!name) continue;
        const isDirectory = remainder.includes('/');
        children.set(name, { isFile: !isDirectory, isDirectory });
      }
      return [...children.entries()].map(([name, type]) => ({
        name,
        ...type,
        isSymbolicLink: false,
      }));
    },
  };
}
