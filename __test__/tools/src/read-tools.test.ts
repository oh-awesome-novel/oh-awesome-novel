import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createReadTools } from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

const workspaceRoot = join(process.cwd(), '..', '..', 'examples', 'sample-novel');

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
});

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
