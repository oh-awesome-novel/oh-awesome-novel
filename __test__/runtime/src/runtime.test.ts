import { describe, expect, it, vi } from 'vitest';

import {
  PriorityRuntimeContextBuilder,
  createRuntime,
} from '@oh-awesome-novel/runtime';

import { createFakeModel, createStreamingFakeModel, createTool } from './helpers';

describe('RuntimeSession', () => {
  it('completes a turn without tool calls', async () => {
    const model = createFakeModel([
      {
        message: {
          role: 'assistant',
          content: 'Done.',
        },
      },
    ]);

    const runtime = createRuntime({
      model,
      tools: {},
    });

    const result = await runtime.runTurn({ message: 'Hello' });

    expect(result.stoppedReason).toBe('completed');
    expect(result.assistantMessage?.content).toBe('Done.');
    expect(result.toolLog).toEqual([]);
    expect(result.pendingActions).toEqual([]);
  });

  it('executes a read tool and appends the tool result', async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      content: { name: 'heroine' },
    }));
    const tools = createTool('character.get', execute);
    const model = createFakeModel([
      {
        toolCalls: [
          {
            id: 'call_1',
            name: 'character.get',
            args: { id: 'heroine' },
          },
        ],
      },
      {
        message: {
          role: 'assistant',
          content: 'The heroine exists.',
        },
      },
    ]);

    const runtime = createRuntime({
      model,
      tools,
    });

    const result = await runtime.runTurn({ message: 'Read heroine' });

    expect(execute).toHaveBeenCalledWith(
      { id: 'heroine' },
      {
        toolCall: {
          id: 'call_1',
          name: 'character.get',
          args: { id: 'heroine' },
        },
      },
    );
    expect(result.stoppedReason).toBe('completed');
    expect(result.toolLog).toHaveLength(1);
    expect(result.messages.some((message) => message.role === 'tool')).toBe(
      true,
    );
    expect(model.requests[1].messages.at(-2)).toMatchObject({
      role: 'assistant',
      toolCalls: [
        {
          id: 'call_1',
          name: 'character.get',
          args: { id: 'heroine' },
        },
      ],
    });
    expect(model.requests[1].messages.at(-1)?.role).toBe('tool');
  });

  it('collects pending actions from proposal tools without applying them', async () => {
    const pendingAction = {
      id: 'action_1',
      title: 'Update state',
      description: 'Preview state update.',
      changes: [{
        operation: 'update' as const,
        path: 'state/characters.yaml',
        oldHash: 'a'.repeat(64),
        newHash: 'b'.repeat(64),
      }],
      diff: '- old\n+ new',
      createdAt: '2026-06-06T00:00:00.000Z',
      status: 'pending' as const,
    };
    const tools = createTool('example.updateState', async () => ({
      actionId: pendingAction.id,
      pendingActions: [pendingAction],
    }));
    const model = createFakeModel([
      {
        toolCalls: [
          {
            id: 'call_1',
            name: 'example.updateState',
            args: { path: 'characters.heroine.hp', value: 'injured' },
          },
        ],
      },
      {
        message: {
          role: 'assistant',
          content: 'I prepared a pending action.',
        },
      },
    ]);

    const runtime = createRuntime({
      model,
      tools,
    });

    const result = await runtime.runTurn({ message: 'Mark heroine injured' });

    expect(result.pendingActions).toEqual([pendingAction]);
    expect(result.messages.map((message) => message.content).join('\n')).toContain(
      'action_1',
    );
  });

  it('returns a recoverable error for unknown tools and continues', async () => {
    const model = createFakeModel([
      {
        toolCalls: [
          {
            id: 'call_1',
            name: 'missing.tool',
            args: {},
          },
        ],
      },
      {
        message: {
          role: 'assistant',
          content: 'The tool was missing.',
        },
      },
    ]);

    const runtime = createRuntime({
      model,
      tools: {},
    });

    const result = await runtime.runTurn({ message: 'Use missing tool' });

    expect(result.stoppedReason).toBe('completed');
    expect(result.toolLog[0]?.result.ok).toBe(false);
    expect(
      result.toolLog[0]?.result.ok === false
        ? result.toolLog[0].result.error.code
        : undefined,
    ).toBe('TOOL_NOT_FOUND');
    expect(model.requests).toHaveLength(2);
  });

  it('turns tool exceptions into recoverable errors', async () => {
    const tools = createTool('chapter.get', async () => {
      throw new Error('Chapter not found');
    });
    const model = createFakeModel([
      {
        toolCalls: [
          {
            id: 'call_1',
            name: 'chapter.get',
            args: { id: '404' },
          },
        ],
      },
      {
        message: {
          role: 'assistant',
          content: 'The chapter was not found.',
        },
      },
    ]);

    const runtime = createRuntime({
      model,
      tools,
    });

    const result = await runtime.runTurn({ message: 'Read missing chapter' });

    expect(result.stoppedReason).toBe('completed');
    expect(
      result.toolLog[0]?.result.ok === false
        ? result.toolLog[0].result.error
        : undefined,
    ).toMatchObject({
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Chapter not found',
      recoverable: true,
    });
  });

  it('stops when max tool loops is reached', async () => {
    const tools = createTool('state.get', async () => ({ value: 'loop' }));
    const model = createFakeModel([
      {
        toolCalls: [{ id: 'call_1', name: 'state.get', args: {} }],
      },
      {
        toolCalls: [{ id: 'call_2', name: 'state.get', args: {} }],
      },
    ]);

    const runtime = createRuntime({
      model,
      tools,
      maxToolLoops: 2,
    });

    const result = await runtime.runTurn({ message: 'Loop' });

    expect(result.stoppedReason).toBe('max_tool_loops');
    expect(result.toolLog).toHaveLength(2);
  });

  it('finalizes a dirty completed turn before message_finish', async () => {
    const events: string[] = [];
    const fallbackAction = {
      id: 'fallback_1',
      title: 'Fallback proposal',
      description: 'Finalized at the turn boundary.',
      changes: [{
        operation: 'update' as const,
        path: 'state/value.yaml',
        oldHash: 'a'.repeat(64),
        newHash: 'b'.repeat(64),
      }],
      diff: '+value: new',
      createdAt: '2026-08-12T00:00:00.000Z',
      status: 'pending' as const,
    };
    const finalizeTurn = vi.fn(async () => [fallbackAction]);
    const runtime = createRuntime({
      model: createFakeModel([{
        message: { role: 'assistant', content: 'Done.' },
      }]),
      tools: {},
      turnFinalizer: { finalizeTurn },
      onEvent(event) {
        events.push(event.type);
      },
    });

    const result = await runtime.runTurn({ message: 'Edit' });

    expect(finalizeTurn).toHaveBeenCalledWith(expect.objectContaining({
      stoppedReason: 'completed',
      pendingActions: [],
    }));
    expect(result.pendingActions).toEqual([fallbackAction]);
    expect(events.slice(-2)).toEqual(['pending_action', 'message_finish']);
  });

  it('calls the finalizer on max-loop and aborted turns without duplicating actions', async () => {
    const pendingAction = {
      id: 'action_1',
      title: 'Existing',
      description: 'Already proposed.',
      changes: [{
        operation: 'update' as const,
        path: 'state/value.yaml',
        oldHash: 'a'.repeat(64),
        newHash: 'b'.repeat(64),
      }],
      diff: '',
      createdAt: '2026-08-12T00:00:00.000Z',
      status: 'pending' as const,
    };
    const finalizeTurn = vi.fn(async ({ pendingActions }) => pendingActions);
    const tools = createTool('state.get', async () => ({ pendingActions: [pendingAction] }));
    const runtime = createRuntime({
      model: createFakeModel([{
        toolCalls: [{ id: 'call_1', name: 'state.get', args: {} }],
      }]),
      tools,
      maxToolLoops: 1,
      turnFinalizer: { finalizeTurn },
    });

    const maxLoopResult = await runtime.runTurn({ message: 'Loop' });
    expect(maxLoopResult.pendingActions).toEqual([pendingAction]);
    expect(finalizeTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      stoppedReason: 'max_tool_loops',
    }));

    const controller = new AbortController();
    controller.abort();
    const abortedResult = await runtime.runTurn({
      message: 'Abort',
      abortSignal: controller.signal,
    });
    expect(abortedResult.stoppedReason).toBe('aborted');
    expect(finalizeTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      stoppedReason: 'aborted',
    }));
  });

  it('fails closed without message_finish when the finalizer fails', async () => {
    const events: string[] = [];
    const runtime = createRuntime({
      model: createFakeModel([{
        message: { role: 'assistant', content: 'Done.' },
      }]),
      tools: {},
      turnFinalizer: {
        async finalizeTurn() {
          throw new Error('proposal persistence failed');
        },
      },
      onEvent(event) {
        events.push(event.type);
      },
    });

    await expect(runtime.runTurn({ message: 'Edit' })).rejects.toThrow(
      'proposal persistence failed',
    );
    expect(events).toContain('error');
    expect(events).not.toContain('message_finish');
  });

  it('emits observable runtime events', async () => {
    const events: string[] = [];
    const pendingAction = {
      id: 'action_1',
      title: 'Update',
      description: 'Update preview.',
      changes: [{
        operation: 'update' as const,
        path: 'state/value.yaml',
        oldHash: 'a'.repeat(64),
        newHash: 'b'.repeat(64),
      }],
      diff: '',
      createdAt: '2026-06-06T00:00:00.000Z',
      status: 'pending' as const,
    };
    const tools = createTool('example.updateState', async () => ({
      pendingActions: [pendingAction],
    }));
    const model = createFakeModel([
      {
        toolCalls: [{ id: 'call_1', name: 'example.updateState', args: {} }],
      },
      {
        message: { role: 'assistant', content: 'Done.' },
      },
    ]);

    const runtime = createRuntime({
      model,
      tools,
      onEvent: (event) => {
        events.push(event.type);
      },
    });

    await runtime.runTurn({ message: 'Update state' });

    expect(events).toEqual([
      'message_start',
      'tool_call_start',
      'tool_call_finish',
      'pending_action',
      'message_finish',
    ]);
  });

  it('never retains or emits raw bash command arguments', async () => {
    const rawCommand = "cat <<'EOF' > summaries/private.md\nsecret body\nEOF";
    const observed: unknown[] = [];
    const tools = createTool('bash', async () => ({ exitCode: 0 }));
    const runtime = createRuntime({
      model: createFakeModel([
        {
          toolCalls: [{ id: 'bash_1', name: 'bash', args: { command: rawCommand } }],
        },
        { message: { role: 'assistant', content: 'Done.' } },
      ]),
      tools,
      onEvent(event) {
        observed.push(event);
      },
    });

    const result = await runtime.runTurn({ message: 'Edit' });

    expect(result.toolLog[0]?.toolCall).toMatchObject({
      id: 'bash_1',
      name: 'bash',
      args: {
        commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        commandPreview: expect.any(String),
      },
    });
    expect(JSON.stringify(result.toolLog)).not.toContain('"command"');
    expect(JSON.stringify(observed)).not.toContain('"command"');
  });

  it('audits bash calls embedded in the model response message before retaining or emitting it', async () => {
    const rawCommand = "printf 'response-message-secret\u202Egnidliub'";
    const observed: unknown[] = [];
    const runtime = createRuntime({
      model: createFakeModel([{
        message: {
          role: 'assistant',
          content: 'Done.',
          toolCalls: [{
            id: 'bash_in_message',
            name: 'bash',
            args: { command: rawCommand },
          }],
        },
      }]),
      tools: {},
      onEvent(event) {
        observed.push(event);
      },
    });

    const result = await runtime.runTurn({ message: 'Finish' });

    expect(result.assistantMessage?.toolCalls?.[0]).toMatchObject({
      id: 'bash_in_message',
      name: 'bash',
      args: {
        commandHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        commandPreview: expect.any(String),
      },
    });
    expect(JSON.stringify(result)).not.toContain('"command"');
    expect(JSON.stringify(runtime.getState())).not.toContain('"command"');
    expect(JSON.stringify(observed)).not.toContain('"command"');
    expect(JSON.stringify(result)).toContain('\\\\u202e');
  });

  it('streams assistant message deltas before finish', async () => {
    const model = createStreamingFakeModel([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      {
        type: 'finish',
        response: {
          message: {
            role: 'assistant',
            content: 'Hello',
          },
        },
      },
    ]);
    const runtime = createRuntime({
      model,
      tools: {},
    });

    const events = [];
    for await (const event of runtime.streamTurn({ message: 'Hi' })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'message_delta',
      'message_delta',
      'message_finish',
    ]);
    expect(
      events
        .filter((event) => event.type === 'message_delta')
        .map((event) => event.text)
        .join(''),
    ).toBe('Hello');
  });
});

describe('AI SDK ToolSet filtering', () => {
  it('filters active tools by skill allowedTools', async () => {
    const model = createFakeModel([
      {
        message: {
          role: 'assistant',
          content: 'Done.',
        },
      },
    ]);
    const runtime = createRuntime({
      model,
      tools: {
        ...createTool('character.get', async () => ({})),
        ...createTool('example.updateState', async () => ({})),
      },
    });

    await runtime.runTurn({
      message: 'Read only',
      skill: { name: 'read', allowedTools: ['character.get'] },
    });

    expect(Object.keys(model.requests[0].tools)).toEqual(['character.get']);
  });
});

describe('PriorityRuntimeContextBuilder', () => {
  it('orders context by document priority and does not add unprovided context', () => {
    const builder = new PriorityRuntimeContextBuilder();

    const messages = builder.build({
      doneMessages: [],
      curMessages: [{ role: 'user', content: 'Current request' }],
      context: [
        { kind: 'state', content: 'State data' },
        { kind: 'constitution', content: 'Constitution data' },
        { kind: 'selected', title: 'Chapter 1', content: 'Selected data' },
      ],
      skill: {
        name: 'rewrite',
        system: 'Preserve voice.',
      },
    });

    expect(messages.map((message) => message.content)).toEqual([
      '# Novel Constitution\n\nConstitution data',
      '# Skill Prompt: rewrite\n\nPreserve voice.',
      '# Selected Context: Chapter 1\n\nSelected data',
      '# State\n\nState data',
      'Current request',
    ]);
    expect(messages.some((message) => message.content.includes('Timeline'))).toBe(
      false,
    );
  });

  it('places Writing reminders after the shared skill and before selected context', () => {
    const builder = new PriorityRuntimeContextBuilder();
    const messages = builder.build({
      doneMessages: [],
      curMessages: [{ role: 'user', content: 'Write' }],
      skill: {
        name: 'novel-copilot',
        system: 'Shared skill once.',
      },
      context: [
        { kind: 'selected', content: 'Accepted project truth.' },
        { kind: 'reminder', content: 'Character consistency.' },
      ],
    });

    expect(messages.map((message) => message.content)).toEqual([
      '# Skill Prompt: novel-copilot\n\nShared skill once.',
      '# Writing Reminders\n\nCharacter consistency.',
      '# Selected Context\n\nAccepted project truth.',
      'Write',
    ]);
  });
});
