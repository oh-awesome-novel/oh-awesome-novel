import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createNovelAgentReadTools,
  createNovelAgentRuntime,
  createNovelAgentToolSet,
  createNovelAgentTurnEditEnvironment,
  selectNovelAgentSandboxPolicy,
} from '@oh-awesome-novel/agent';
import type { ToolSet } from 'ai';

const workspaceRoot = join(process.cwd(), '..', '..', 'examples', 'simple-novel');

describe('Novel agent tool assembly', () => {
  it('creates a runtime with the agent-assembled AI SDK ToolSet', () => {
    const runtime = createNovelAgentRuntime({
      workspaceRoot,
      providerConfig: {
        id: 'test',
        kind: 'custom',
        model: 'test-model',
      },
      resolveModel() {
        throw new Error('Model resolution is not needed for construction.');
      },
    });

    expect(runtime.getState()).toMatchObject({
      doneMessages: [],
      curMessages: [],
      toolLog: [],
      pendingActions: [],
    });
  });

  it('assembles AI SDK read tools in agent, not runtime', async () => {
    const tools = createNovelAgentToolSet({ workspaceRoot });

    expect(Object.keys(tools)).toContain('character.get');

    const result = await executeTool(tools, 'workflow.get', {});

    expect(result).toMatchObject({
      file: '.oan/workflow.yaml',
      data: {
        name: 'lightnovel',
      },
    });
  });

  it('can create runtime-compatible read tools', () => {
    const tools = createNovelAgentReadTools(workspaceRoot);

    expect(Object.keys(tools)).toEqual([
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

  it('keeps the synchronous default tool set read-only', () => {
    const tools = createNovelAgentToolSet({ workspaceRoot });

    expect(Object.keys(tools)).toEqual([
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

  it('maps host capabilities only when exact targets are present', () => {
    expect(selectNovelAgentSandboxPolicy({
      capability: 'novel.write_chapter',
    })).toEqual({ capability: 'read-only', exactWritablePaths: [] });
    expect(selectNovelAgentSandboxPolicy({
      capability: 'novel.write_chapter',
      exactWritablePaths: ['chapters/0001/0002.md'],
    })).toEqual({
      capability: 'chapter.edit',
      exactWritablePaths: ['chapters/0001/0002.md'],
    });
    expect(selectNovelAgentSandboxPolicy({
      capability: 'novel.play_scene',
      exactWritablePaths: ['state/play.yaml'],
    })).toEqual({ capability: 'read-only', exactWritablePaths: [] });
  });

  it('uses a read-only sandbox when the host did not select an exact target', async () => {
    const environment = await createNovelAgentTurnEditEnvironment({
      workspaceRoot,
      capability: 'novel.write_chapter',
    });

    try {
      expect(Object.keys(environment.tools)).toEqual(expect.arrayContaining([
        'bash',
        'readFile',
        'writeFile',
        'workspace.previewChanges',
        'workspace.proposeChanges',
      ]));
      await expect(executeTool(environment.tools, 'writeFile', {
        path: 'chapters/0001/0002.md',
        content: '# Changed\n',
      })).rejects.toThrow(/not writable|read-only|forbidden|denied/iu);
    } finally {
      await environment.dispose();
    }
  });

  it('does not expose future tools in the default agent tool set', () => {
    const tools = createNovelAgentToolSet({ workspaceRoot });

    expect(tools).not.toHaveProperty('chapter.rewriteScene');
    expect(tools).not.toHaveProperty('foreshadow.resolve');
    expect(tools).not.toHaveProperty('constitution.proposeUpdate');
    expect(tools).not.toHaveProperty('constitution.search');
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
