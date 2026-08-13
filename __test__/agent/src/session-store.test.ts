import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';

const streamText = vi.fn();

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText,
}));

const {
  DEFAULT_BASH_COMMAND_PREVIEW_BYTES,
  createAgentSessionStore,
  createBashCommandAudit,
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
  it('rejects symlinks at every internal session-directory segment', async () => {
    const workspaceWithLinkedOan = await createTempWorkspace();
    const externalOan = await createTempWorkspace();
    await symlink(externalOan, join(workspaceWithLinkedOan, '.oan'), 'dir');
    await expect(createAgentSessionStore({
      workspaceRoot: workspaceWithLinkedOan,
    }).createSession()).rejects.toThrow(/directory is unsafe/u);
    expect(await readdir(externalOan)).toEqual([]);

    const workspaceWithLinkedSessions = await createTempWorkspace();
    const externalSessions = await createTempWorkspace();
    await mkdir(join(workspaceWithLinkedSessions, '.oan'));
    await symlink(
      externalSessions,
      join(workspaceWithLinkedSessions, '.oan', 'sessions'),
      'dir',
    );
    await expect(createAgentSessionStore({
      workspaceRoot: workspaceWithLinkedSessions,
    }).createSession()).rejects.toThrow(/directory is unsafe/u);
    expect(await readdir(externalSessions)).toEqual([]);

    const workspaceWithLinkedSession = await createTempWorkspace();
    const externalSession = await createTempWorkspace();
    await mkdir(join(workspaceWithLinkedSession, '.oan', 'sessions'), {
      recursive: true,
    });
    await symlink(
      externalSession,
      join(workspaceWithLinkedSession, '.oan', 'sessions', 'known-session'),
      'dir',
    );
    await expect(createAgentSessionStore({
      workspaceRoot: workspaceWithLinkedSession,
    }).ensureSession('known-session')).rejects.toThrow(/directory is unsafe/u);
    expect(await readdir(externalSession)).toEqual([]);
  });

  it('sanitizes and bounds bash command audit data without persisting raw args', async () => {
    const workspaceRoot = await createTempWorkspace();
    const store = createAgentSessionStore({ workspaceRoot });
    const session = await store.createSession({ title: 'bash audit' });
    const command = `printf "\u001b[31mred\u001b[0m\n${'x'.repeat(4_096)}"`;
    const toolCall = {
      id: 'call_bash',
      name: 'bash',
      args: { command },
    };

    await store.recordRuntimeEvent(session.id, {
      type: 'message_start',
      messages: [],
    });
    await store.recordRuntimeEvent(session.id, {
      type: 'tool_call_start',
      toolCall,
    });
    await store.recordRuntimeEvent(session.id, {
      type: 'tool_call_finish',
      toolCall,
      result: { ok: true, content: { exitCode: 0 } },
    });
    await store.recordRuntimeEvent(session.id, {
      type: 'message_finish',
      result: {
        messages: [{
          role: 'assistant',
          content: '',
          toolCalls: [toolCall],
        }],
        toolLog: [{
          toolCall,
          result: { ok: true, content: { exitCode: 0 } },
        }],
        pendingActions: [],
        stoppedReason: 'completed',
      },
    });
    const runtimeAudit = createBashCommandAudit({ command: 'echo runtime-audited' });
    const auditedToolCall = {
      id: 'call_bash_audited',
      name: 'bash',
      args: runtimeAudit,
    };
    await store.recordRuntimeEvent(session.id, {
      type: 'tool_call_start',
      toolCall: auditedToolCall,
    });
    await store.recordRuntimeEvent(session.id, {
      type: 'tool_call_finish',
      toolCall: auditedToolCall,
      result: { ok: true, content: { exitCode: 0 } },
    });

    const recovered = await store.recoverSession(session.id);
    const persisted = await readFile(
      join(workspaceRoot, '.oan/sessions', session.id, 'tool-log.jsonl'),
      'utf-8',
    );
    const persistedMessages = await readFile(
      join(workspaceRoot, '.oan/sessions', session.id, 'messages.jsonl'),
      'utf-8',
    );
    const start = recovered.toolLog[0];
    const finish = recovered.toolLog[1];

    expect(persisted).not.toContain('"args"');
    expect(persistedMessages).not.toContain(command);
    expect(persistedMessages).toContain('commandPreview');
    expect(persisted).not.toContain('\u001b');
    expect(start?.toolCall).toEqual({ id: 'call_bash', name: 'bash' });
    expect(start && 'commandAudit' in start ? start.commandAudit : undefined)
      .toMatchObject({
        commandHash: createHash('sha256').update(command).digest('hex'),
        commandByteLength: Buffer.byteLength(command),
        truncated: true,
      });
    expect(start && 'commandAudit' in start
      ? start.commandAudit.previewByteLength
      : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      DEFAULT_BASH_COMMAND_PREVIEW_BYTES,
    );
    expect(start && 'commandAudit' in start
      ? start.commandAudit.commandPreview
      : '').toContain('\\n');
    expect(finish && 'commandAudit' in finish ? finish.commandAudit : undefined)
      .toEqual(start && 'commandAudit' in start ? start.commandAudit : undefined);
    const auditedStart = recovered.toolLog[2];
    expect(auditedStart && 'commandAudit' in auditedStart
      ? auditedStart.commandAudit
      : undefined).toEqual(runtimeAudit);

    const spoofedAudit = {
      ...runtimeAudit,
      commandPreview: `safe\u202Egnidliub`,
      previewByteLength: Buffer.byteLength(`safe\u202Egnidliub`),
    };
    await store.recordRuntimeEvent(session.id, {
      type: 'tool_call_start',
      toolCall: { id: 'call_bash_spoofed', name: 'bash', args: spoofedAudit },
    });
    const revalidated = await store.recoverSession(session.id);
    const spoofedStart = revalidated.toolLog.at(-1);
    expect(spoofedStart && 'commandAudit' in spoofedStart
      ? spoofedStart.commandAudit.commandPreview
      : '').toContain('\\u202e');
    expect(spoofedStart && 'commandAudit' in spoofedStart
      ? spoofedStart.commandAudit.truncated
      : false).toBe(true);

    const tinyAudit = createBashCommandAudit(
      { command: 'echo 你好\nnext' },
      { maxPreviewBytes: 24 },
    );
    expect(Buffer.byteLength(tinyAudit.commandPreview)).toBeLessThanOrEqual(24);
    expect(tinyAudit.commandHash).toMatch(/^[a-f0-9]{64}$/u);
  });

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
        name: 'readFile',
        args: { path: 'chapters/0001.md' },
      },
      result: {
        ok: true,
        content: { path: 'chapters/0001.md' },
      },
    });
    await store.recordRuntimeEvent(session.id, {
      type: 'pending_action',
      pendingAction: {
        id: 'action_1',
        title: 'Review chapter',
        description: 'Candidate chapter bytes.',
        status: 'pending',
        createdAt: '2026-08-12T00:00:00.000Z',
        changes: [{
          operation: 'create',
          path: 'chapters/0001.md',
          newHash: 'a'.repeat(64),
        }],
        diff: 'diff --git a/chapters/0001.md b/chapters/0001.md',
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
    expect(recovered?.toolLog[0]?.toolCall.name).toBe('readFile');
    expect(recovered?.recovery.pendingActionIds).toEqual(['action_1']);
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
      inspect: {
        description: 'Inspect a value.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: vi.fn(() => ({ value: 'ok' })),
      },
    } as ToolSet;

    streamText
      .mockReturnValueOnce({
        textStream: toAsyncIterable(['写入中']),
        toolCalls: Promise.resolve([
          {
            toolCallId: 'call_1',
            toolName: 'inspect',
            input: { path: 'chapters/0001.md' },
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
      editEnvironmentFactory: fixedToolEnvironmentFactory(workspaceRoot),
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
    expect(toolLog).toContain('"name":"inspect"');
    expect(recovery).toContain('pendingActionIds: []');
  });

  it('writes session artifacts for PendingAction-producing turns', async () => {
    const workspaceRoot = await createTempWorkspace();
    const tools: ToolSet = {
      'workspace.proposeChanges': {
        description: 'Create a chapter PendingAction.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: vi.fn(() => ({
          pendingActions: [
            {
              id: 'pa_test',
              title: 'Create chapter draft',
              description: 'Draft from test.',
              changes: [{
                operation: 'create',
                path: 'chapters/0001/0002.md',
                newHash: 'a'.repeat(64),
              }],
              diff: 'diff --git a/chapters/0001/0002.md b/chapters/0001/0002.md',
              createdAt: '2026-06-19T00:00:00.000Z',
              status: 'pending',
            },
          ],
        })),
      },
    } as ToolSet;

    streamText
      .mockReturnValueOnce({
        textStream: toAsyncIterable(['准备草稿']),
        toolCalls: Promise.resolve([
          {
            toolCallId: 'call_1',
            toolName: 'workspace.proposeChanges',
            input: { chapterId: '0001/0002', content: '# 第二章\n\n正文' },
          },
        ]),
      })
      .mockReturnValueOnce({
        textStream: toAsyncIterable(['已创建 PendingAction']),
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
      workspace: {
        workspaceRoot,
        constitution: '禁止机械降神。',
        workflow: 'steps:\n  - chapter',
      },
      request: '/写下一章',
      tools,
      editEnvironmentFactory: fixedToolEnvironmentFactory(workspaceRoot),
      session: { metadata: { title: 'artifact turn' } },
    });

    const sessionId = result.session?.id ?? '';
    await expect(
      readFile(join(workspaceRoot, '.workspace/sessions', sessionId, 'run.yaml'), 'utf-8'),
    ).resolves.toContain('capability: novel.write_chapter');
    await expect(
      readFile(join(workspaceRoot, '.workspace/sessions', sessionId, 'context-package.yaml'), 'utf-8'),
    ).resolves.toContain('toolName: workspace.proposeChanges');
    await expect(
      readFile(join(workspaceRoot, '.workspace/sessions', sessionId, 'proposed-changes.yaml'), 'utf-8'),
    ).resolves.toContain('pa_test');
    await expect(
      readFile(join(workspaceRoot, '.workspace/sessions', sessionId, 'outputs.yaml'), 'utf-8'),
    ).resolves.toContain('Author Report');
  });
});

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-agent-session-'));
  tempRoots.push(root);
  return root;
}

function fixedToolEnvironmentFactory(workspaceRoot: string) {
  const projectionFingerprint = createHash('sha256')
    .update('session-store-test-fixed-projection')
    .digest('hex');
  return async (input: { baseTools: ToolSet }) => ({
    tools: input.baseTools,
    workspace: { workspaceRoot, projectionFingerprint },
    async assertFresh() {},
    dispose() {},
  });
}

async function* toAsyncIterable(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
