import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';
import type { RuntimeTurnFinalizer } from '@oh-awesome-novel/runtime';

const streamText = vi.fn();

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText,
}));

const {
  createSandboxNovelAgentEditEnvironmentFactory,
  createNovelAgentTurnEditEnvironment,
  runNovelAgentTurn,
  streamNovelAgentTurn,
} = await import('@oh-awesome-novel/agent');

const workspaceRoot = join(process.cwd(), '..', '..', 'examples', 'simple-novel');
const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

beforeEach(() => {
  streamText.mockReset();
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('turn-scoped agent edit environment injection', () => {
  it('does not let explicit tools bypass fixed-projection environment creation', async () => {
    const tools = {} as ToolSet;
    await expect(createNovelAgentTurnEditEnvironment({
      workspaceRoot,
      tools,
    })).rejects.toThrow('require an editEnvironmentFactory with a fixed projection');
  });

  it('combines projection guardrails with fingerprinted external context', async () => {
    const environment = await createNovelAgentTurnEditEnvironment({
      workspaceRoot,
      editEnvironmentFactory: async () => ({
        tools: {} as ToolSet,
        workspace: { workspaceRoot, projectionFingerprint: '0'.repeat(64) },
        selectedContext: [{
          kind: 'selected',
          title: 'Project Health Guardrails',
          content: 'projection-owned health context',
        }],
        assertFresh: vi.fn(async () => {}),
        dispose() {},
      }),
      externalContext: {
        selectedContext: [{
          kind: 'selected',
          title: 'Reference Context Selection',
          content: 'fingerprinted reference context',
        }],
        assertFresh: vi.fn(async () => {}),
      },
    });

    expect(environment.selectedContext?.map((item) => item.title)).toEqual([
      'Project Health Guardrails',
      'Reference Context Selection',
    ]);
    await environment.dispose();
  });

  it('creates one environment for a run turn and shares its tools until disposal', async () => {
    const order: string[] = [];
    const execute = vi.fn(() => {
      order.push('tool');
      return { value: 'inspected' };
    });
    const tools = {
      inspect: {
        description: 'Inspect the fixed turn environment.',
        inputSchema: { type: 'object', properties: {} },
        execute,
      },
    } as ToolSet;
    const finalizer: RuntimeTurnFinalizer = {
      async finalizeTurn(input) {
        order.push(`finalize:${input.stoppedReason}`);
        return input.pendingActions;
      },
    };
    const editEnvironmentFactory = vi.fn(async (input) => {
      order.push('factory');
      expect(input.baseTools).toBe(tools);
      return {
        tools: input.baseTools,
        workspace: { workspaceRoot, projectionFingerprint: 'a'.repeat(64) },
        assertFresh: vi.fn(async () => {}),
        finalizer,
        dispose: vi.fn(async () => {
          order.push('dispose');
        }),
      };
    });

    streamText
      .mockReturnValueOnce(modelStream({
        toolCalls: [
          {
            toolCallId: 'call_inspect_1',
            toolName: 'inspect',
            input: {},
          },
          {
            toolCallId: 'call_inspect_2',
            toolName: 'inspect',
            input: {},
          },
        ],
      }))
      .mockReturnValueOnce(modelStream({ text: ['done'] }));

    const result = await runNovelAgentTurn({
      ...baseTurnInput(),
      tools,
      editEnvironmentFactory,
    });

    expect(result.stoppedReason).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(editEnvironmentFactory).toHaveBeenCalledOnce();
    expect(order).toEqual([
      'factory',
      'tool',
      'tool',
      'finalize:completed',
      'dispose',
    ]);
  });

  it('preserves an explicit skill and context package through run-turn assembly', async () => {
    const editEnvironmentFactory = vi.fn(async () => ({
      tools: {} as ToolSet,
      workspace: { workspaceRoot, projectionFingerprint: 'f'.repeat(64) },
      assertFresh: vi.fn(async () => {}),
      dispose() {},
    }));
    streamText.mockReturnValueOnce(modelStream({ text: ['done'] }));

    await runNovelAgentTurn({
      ...baseTurnInput(),
      skill: {
        name: 'explicit-skill',
        system: 'CUSTOM_SKILL_SENTINEL',
      },
      contextPackage: {
        id: 'ctx-explicit',
        capability: 'novel.update_state',
        createdAt: '2026-08-13T00:00:00.000Z',
        selected: [],
        omitted: [],
        trace: [],
        minimalMemory: {
          characters: [],
          hooks: [],
          worldRules: [],
          recentFacts: [],
          styleNotes: [],
        },
        ruleStack: [],
      },
      editEnvironmentFactory,
    });

    const modelRequest = JSON.stringify(streamText.mock.calls[0]?.[0]);
    expect(modelRequest).toContain('CUSTOM_SKILL_SENTINEL');
    expect(modelRequest).toContain('Context Package: ctx-explicit');
  });

  it('disposes the environment after a streamed turn finishes', async () => {
    const order: string[] = [];
    const editEnvironmentFactory = vi.fn(async () => ({
      tools: {} as ToolSet,
      workspace: { workspaceRoot, projectionFingerprint: 'b'.repeat(64) },
      assertFresh: vi.fn(async () => {}),
      finalizer: {
        async finalizeTurn(input) {
          order.push(`finalize:${input.stoppedReason}`);
          return input.pendingActions;
        },
      } satisfies RuntimeTurnFinalizer,
      async dispose() {
        order.push('dispose');
      },
    }));
    streamText.mockReturnValueOnce(modelStream({ text: ['streamed'] }));

    const events = [];
    for await (const event of streamNovelAgentTurn({
      ...baseTurnInput(),
      editEnvironmentFactory,
    })) {
      events.push(event.type);
    }

    expect(events).toContain('message_finish');
    expect(editEnvironmentFactory).toHaveBeenCalledOnce();
    expect(order).toEqual(['finalize:completed', 'dispose']);
  });

  it('passes the turn abort signal into the factory and still disposes', async () => {
    const controller = new AbortController();
    controller.abort();
    const order: string[] = [];
    const editEnvironmentFactory = vi.fn(async (input) => {
      expect(input.abortSignal).toBe(controller.signal);
      return {
        tools: {} as ToolSet,
        workspace: { workspaceRoot, projectionFingerprint: 'c'.repeat(64) },
        assertFresh: vi.fn(async () => {}),
        finalizer: {
          async finalizeTurn(finalizeInput) {
            order.push(`finalize:${finalizeInput.stoppedReason}`);
            return finalizeInput.pendingActions;
          },
        } satisfies RuntimeTurnFinalizer,
        async dispose() {
          order.push('dispose');
        },
      };
    });

    const result = await runNovelAgentTurn({
      ...baseTurnInput(),
      abortSignal: controller.signal,
      editEnvironmentFactory,
    });

    expect(result.stoppedReason).toBe('aborted');
    expect(streamText).not.toHaveBeenCalled();
    expect(order).toEqual(['finalize:aborted', 'dispose']);
  });

  it('discards dirty native sandbox bytes on abort without proposing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-agent-abort-discard-'));
    tempRoots.push(root);
    await mkdir(join(root, 'state'));
    await writeFile(join(root, 'state/value.yaml'), 'value: old\n');
    await execFileAsync('git', ['-C', root, 'init', '-b', 'main']);
    await execFileAsync('git', ['-C', root, 'config', 'user.name', 'OAN Test']);
    await execFileAsync('git', ['-C', root, 'config', 'user.email', 'oan@example.test']);
    await execFileAsync('git', ['-C', root, 'add', '--', 'state/value.yaml']);
    await execFileAsync('git', ['-C', root, 'commit', '-m', 'baseline']);
    const environment = await createNovelAgentTurnEditEnvironment({
      workspaceRoot: root,
      capability: 'novel.update_state',
      exactWritablePaths: ['state/value.yaml'],
      sessionId: 'abort-session',
      turnId: 'abort-turn',
    });

    try {
      const writeTool = environment.tools.writeFile as unknown as {
        execute(input: unknown, options: unknown): Promise<unknown> | unknown;
      };
      await writeTool.execute({
        path: 'state/value.yaml',
        content: 'value: virtual\n',
      }, {});
      await expect(environment.finalizer?.finalizeTurn({
        stoppedReason: 'aborted',
        pendingActions: [],
      })).resolves.toEqual([]);

      expect(await readFile(join(root, 'state/value.yaml'), 'utf8')).toBe('value: old\n');
      const actionFiles = await readdir(
        join(root, '.workspace/change-engine/v1/actions'),
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      expect(actionFiles).toEqual([]);
    } finally {
      await environment.dispose();
    }
  });

  it('keeps prompt and domain reads on one projection and fails closed on host drift', async () => {
    const root = await createGitWorkspace({
      'summaries/global.md': '# Global\n\nPROJECTION_A\n',
      '.oan/workflow.yaml': 'name: projection-a\n',
    });
    const nativeFactory = createSandboxNovelAgentEditEnvironmentFactory({
      capability: 'read-only',
    });
    const editEnvironmentFactory = vi.fn(async (input) => {
      const environment = await nativeFactory(input);
      await writeFile(
        join(root, 'summaries/global.md'),
        '# Global\n\nHOST_B_AFTER_PROJECTION\n',
      );
      return environment;
    });
    streamText
      .mockReturnValueOnce(modelStream({
        toolCalls: [{
          toolCallId: 'call_summary',
          toolName: 'summary.get',
          input: {},
        }],
      }))
      .mockReturnValueOnce(modelStream({ text: ['done'] }));

    await expect(runNovelAgentTurn({
      ...baseTurnInput(),
      workspaceRoot: root,
      workspace: {
        workspaceRoot: root,
        summaries: ['PRELOADED_HOST_CONTEXT_MUST_NOT_BE_USED'],
      },
      request: 'inspect summary',
      editEnvironmentFactory,
    })).rejects.toMatchObject({ code: 'WORKSPACE_PROJECTION_STALE' });

    const modelMessages = JSON.stringify(streamText.mock.calls.map((call) => (
      (call[0] as { messages?: unknown }).messages
    )));
    expect(modelMessages).toContain('PROJECTION_A');
    expect(modelMessages).not.toContain('PRELOADED_HOST_CONTEXT_MUST_NOT_BE_USED');
    expect(modelMessages).not.toContain('HOST_B_AFTER_PROJECTION');
    expect(editEnvironmentFactory).toHaveBeenCalledOnce();
  });

  it('disposes the environment when a run turn fails fatally', async () => {
    const order: string[] = [];
    const editEnvironmentFactory = vi.fn(async () => ({
      tools: {} as ToolSet,
      workspace: { workspaceRoot, projectionFingerprint: 'd'.repeat(64) },
      assertFresh: vi.fn(async () => {}),
      finalizer: {
        async finalizeTurn(input) {
          order.push(`finalize:${input.stoppedReason}`);
          return input.pendingActions;
        },
      } satisfies RuntimeTurnFinalizer,
      async dispose() {
        order.push('dispose');
      },
    }));

    await expect(runNovelAgentTurn({
      ...baseTurnInput(),
      resolveModel: vi.fn(async () => {
        throw new Error('provider failed');
      }),
      editEnvironmentFactory,
    })).rejects.toThrow('provider failed');

    expect(order).toEqual(['finalize:error', 'dispose']);
  });

  it('disposes the environment when a streamed turn fails fatally', async () => {
    const order: string[] = [];
    const editEnvironmentFactory = vi.fn(async () => ({
      tools: {} as ToolSet,
      workspace: { workspaceRoot, projectionFingerprint: 'e'.repeat(64) },
      assertFresh: vi.fn(async () => {}),
      finalizer: {
        async finalizeTurn(input) {
          order.push(`finalize:${input.stoppedReason}`);
          return input.pendingActions;
        },
      } satisfies RuntimeTurnFinalizer,
      async dispose() {
        order.push('dispose');
      },
    }));

    const consume = async () => {
      for await (const event of streamNovelAgentTurn({
        ...baseTurnInput(),
        resolveModel: vi.fn(async () => {
          throw new Error('stream provider failed');
        }),
        editEnvironmentFactory,
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toThrow('stream provider failed');
    expect(order).toEqual(['finalize:error', 'dispose']);
  });
});

async function createGitWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-agent-fixed-projection-'));
  tempRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content, 'utf8');
  }
  await execFileAsync('git', ['-C', root, 'init', '-b', 'main']);
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'OAN Test']);
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'oan@example.test']);
  await execFileAsync('git', ['-C', root, 'add', '--', '.']);
  await execFileAsync('git', ['-C', root, 'commit', '-m', 'baseline']);
  return root;
}

function baseTurnInput() {
  return {
    providerConfig: {
      id: 'mock-provider',
      kind: 'custom' as const,
      model: 'mock-model',
    },
    resolveModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' })),
    workspaceRoot,
    workspace: { workspaceRoot },
    request: 'inspect this turn',
  };
}

function modelStream(input: {
  text?: string[];
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
}) {
  return {
    stream: toAsyncIterable(input.text ?? []),
    finalStep: Promise.resolve({ toolCalls: input.toolCalls ?? [] }),
  };
}

async function* toAsyncIterable(chunks: string[]) {
  for (const chunk of chunks) {
    yield { type: 'text-delta', id: 'test-text', text: chunk };
  }
}
