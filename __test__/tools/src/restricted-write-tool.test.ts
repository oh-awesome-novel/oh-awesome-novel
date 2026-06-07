import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { createRestrictedWriteTools } from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('restricted workspace write tool', () => {
  it('writes an ordinary workspace file and stores a crash recovery shadow file', async () => {
    const workspaceRoot = await createTempWorkspace();
    const tools = createRestrictedWriteTools({ workspaceRoot });

    const result = await executeTool(tools, 'workspace.writeFile', {
      path: 'chapters/0001/draft.md',
      content: 'hello',
    });

    expect(result).toMatchObject({
      file: 'chapters/0001/draft.md',
      bytes: 5,
      materialized: true,
    });
    expect((result as { shadowFile: string }).shadowFile).toMatch(
      /^\.workspace\/shadow-writes\/.+\/chapters\/0001\/draft\.md$/,
    );
    await expect(
      readFile(join(workspaceRoot, 'chapters/0001/draft.md'), 'utf-8'),
    ).resolves.toBe('hello');
    await expect(
      readFile(join(workspaceRoot, (result as { shadowFile: string }).shadowFile), 'utf-8'),
    ).resolves.toBe('hello');
  });

  it.each([
    ['/tmp/outside.md'],
    ['../outside.md'],
    ['.hidden.md'],
    ['characters/.hidden/file.md'],
    ['.oan/session.json'],
    ['.workspace/shadow.md'],
  ])('rejects unsafe user path %s', async (path) => {
    const workspaceRoot = await createTempWorkspace();
    const tools = createRestrictedWriteTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'workspace.writeFile', {
        path,
        content: 'blocked',
      }),
    ).rejects.toThrow();
  });

  it('rejects writing through a workspace symlink that points outside', async () => {
    const workspaceRoot = await createTempWorkspace();
    const outsideRoot = await createTempRoot();
    await symlink(outsideRoot, join(workspaceRoot, 'linked-outside'));
    const tools = createRestrictedWriteTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'workspace.writeFile', {
        path: 'linked-outside/escape.md',
        content: 'blocked',
      }),
    ).rejects.toThrow(/outside the active workspace/);
    await expect(readFile(join(outsideRoot, 'escape.md'), 'utf-8')).rejects.toThrow();
  });

  it('rejects shadow writing when internal .workspace points outside', async () => {
    const workspaceRoot = await createTempRoot();
    const outsideRoot = await createTempRoot();
    await symlink(outsideRoot, join(workspaceRoot, '.workspace'));
    const tools = createRestrictedWriteTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'workspace.writeFile', {
        path: 'chapters/0001.md',
        content: 'blocked',
      }),
    ).rejects.toThrow(/outside the active workspace/);
  });
});

async function createTempWorkspace(): Promise<string> {
  const root = await createTempRoot();
  await mkdir(join(root, '.oan'), { recursive: true });
  return root;
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-write-tool-'));
  tempRoots.push(root);
  return root;
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
