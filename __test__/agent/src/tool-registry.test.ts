import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createNovelAgentReadTools,
  createNovelAgentRuntime,
  createNovelAgentToolSet,
} from '@oh-awesome-novel/agent';
import type { ToolSet } from 'ai';

const workspaceRoot = join(process.cwd(), '..', '..', 'examples', 'sample-novel');

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

  it('assembles M6 write intent tools into the default agent tool set', () => {
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
      'character.updatePersonality',
      'state.set',
      'timeline.add',
      'foreshadow.create',
      'summary.generateChapter',
    ]);
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
