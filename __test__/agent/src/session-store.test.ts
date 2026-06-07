import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';

const streamText = vi.fn();

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText,
}));

const {
  createAgentSessionStore,
  runNovelAgentTurn,
} = await import('@oh-awesome-novel/agent');

const tempRoots: string[] = [];

afterEach(async () => {
  streamText.mockReset();

  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('agent session persistence', () => {
  it('stores metadata, messages, tool log and recovery information under .oan/sessions', async () => {
    const workspaceRoot = await createTempWorkspace();
    const store = createAgentSessionStore({ workspaceRoot });
    const session = await store.createSession({ title: 'manual session' });

    await store.appendMessage(session.id, {
      role: 'user',
      content: 'hello',
    });
    await store.appendToolLog(session.id, {
      toolCall: {
        id: 'call_1',
        name: 'workspace.writeFile',
        args: { path: 'chapters/0001.md' },
      },
      result: {
        ok: true,
        content: {
          shadowFile: '.workspace/shadow-writes/call_1/chapters/0001.md',
        },
      },
    });

    const recovered = await store.recoverLatestSession();

    expect(recovered?.metadata).toMatchObject({
      id: session.id,
      title: 'manual session',
    });
    expect(recovered?.messages).toEqual([
      {
        role: 'user',
        content: 'hello',
      },
    ]);
    expect(recovered?.toolLog[0]?.toolCall.name).toBe('workspace.writeFile');
    expect(recovered?.recovery.shadowWrites).toEqual([
      '.workspace/shadow-writes/call_1/chapters/0001.md',
    ]);
    await expect(
      readFile(
        join(workspaceRoot, '.oan/sessions', session.id, 'messages.jsonl'),
        'utf-8',
      ),
    ).resolves.toContain('"role":"user"');
  });

  it('persists runtime events from an agent turn when session is enabled', async () => {
    const workspaceRoot = await createTempWorkspace();
    const tools: ToolSet = {
      'workspace.writeFile': {
        description: 'Write a file.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: vi.fn(() => ({
          shadowFile: '.workspace/shadow-writes/call_1/chapters/0001.md',
        })),
      },
    } as ToolSet;

    streamText
      .mockReturnValueOnce({
        textStream: toAsyncIterable(['写入中']),
        toolCalls: Promise.resolve([
          {
            toolCallId: 'call_1',
            toolName: 'workspace.writeFile',
            input: { path: 'chapters/0001.md', content: '正文' },
          },
        ]),
      })
      .mockReturnValueOnce({
        textStream: toAsyncIterable(['完成']),
        toolCalls: Promise.resolve([]),
      });

    const result = await runNovelAgentTurn({
      providerConfig: {
        id: 'mock-provider',
        kind: 'custom',
        model: 'mock-model',
      },
      resolveModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' })),
      workspaceRoot,
      workspace: { workspaceRoot },
      request: '写一段正文',
      tools,
      session: { metadata: { title: 'agent turn' } },
    });

    expect(result.session?.id).toEqual(expect.any(String));
    const sessionId = result.session?.id ?? '';
    const messages = await readFile(
      join(workspaceRoot, '.oan/sessions', sessionId, 'messages.jsonl'),
      'utf-8',
    );
    const toolLog = await readFile(
      join(workspaceRoot, '.oan/sessions', sessionId, 'tool-log.jsonl'),
      'utf-8',
    );
    const recovery = await readFile(
      join(workspaceRoot, '.oan/sessions', sessionId, 'recovery.yaml'),
      'utf-8',
    );

    expect(messages).toContain('"role":"user"');
    expect(messages).toContain('"role":"assistant"');
    expect(toolLog).toContain('"name":"workspace.writeFile"');
    expect(recovery).toContain('.workspace/shadow-writes/call_1/chapters/0001.md');
  });
});

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-agent-session-'));
  tempRoots.push(root);
  return root;
}

async function* toAsyncIterable(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
