import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryRuntimeToolRegistry,
  PriorityRuntimeContextBuilder,
  createRuntime,
} from '@oh-awesome-novel/runtime';

import { createFakeModel, createTool } from './helpers';

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
      tools: new InMemoryRuntimeToolRegistry(),
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
    const tool = createTool('character.get', execute);
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
      tools: new InMemoryRuntimeToolRegistry([tool]),
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
    expect(model.requests[1].messages.at(-1)?.role).toBe('tool');
  });

  it('collects pending actions from write intent tools without applying them', async () => {
    const pendingAction = {
      id: 'action_1',
      title: 'Update state',
      description: 'Preview state update.',
      patches: [{ kind: 'collection', operation: 'yamlSet' }],
      touchedFiles: ['state/characters.yaml'],
      diff: '- old\n+ new',
      createdAt: '2026-06-06T00:00:00.000Z',
      status: 'pending' as const,
    };
    const tool = createTool('state.set', async () => ({
      ok: true,
      content: { actionId: pendingAction.id },
      pendingActions: [pendingAction],
    }));
    const model = createFakeModel([
      {
        toolCalls: [
          {
            id: 'call_1',
            name: 'state.set',
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
      tools: new InMemoryRuntimeToolRegistry([tool]),
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
      tools: new InMemoryRuntimeToolRegistry(),
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
    const tool = createTool('chapter.get', async () => {
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
      tools: new InMemoryRuntimeToolRegistry([tool]),
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
    const tool = createTool('state.get', async () => ({
      ok: true,
      content: { value: 'loop' },
    }));
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
      tools: new InMemoryRuntimeToolRegistry([tool]),
      maxToolLoops: 2,
    });

    const result = await runtime.runTurn({ message: 'Loop' });

    expect(result.stoppedReason).toBe('max_tool_loops');
    expect(result.toolLog).toHaveLength(2);
  });

  it('emits observable runtime events', async () => {
    const events: string[] = [];
    const pendingAction = {
      id: 'action_1',
      title: 'Update',
      description: 'Update preview.',
      patches: [],
      touchedFiles: ['state.yaml'],
      diff: '',
      createdAt: '2026-06-06T00:00:00.000Z',
      status: 'pending' as const,
    };
    const tool = createTool('state.set', async () => ({
      ok: true,
      content: {},
      pendingActions: [pendingAction],
    }));
    const model = createFakeModel([
      {
        toolCalls: [{ id: 'call_1', name: 'state.set', args: {} }],
      },
      {
        message: { role: 'assistant', content: 'Done.' },
      },
    ]);

    const runtime = createRuntime({
      model,
      tools: new InMemoryRuntimeToolRegistry([tool]),
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
});

describe('InMemoryRuntimeToolRegistry', () => {
  it('registers, resolves, lists, and filters tools by skill', () => {
    const characterTool = createTool('character.get', async () => ({
      ok: true,
      content: {},
    }));
    const stateTool = createTool('state.set', async () => ({
      ok: true,
      content: {},
    }));

    const registry = new InMemoryRuntimeToolRegistry([characterTool]);
    registry.register(stateTool);

    expect(registry.get('character.get')).toBe(characterTool);
    expect(registry.list().map((tool) => tool.id)).toEqual([
      'character.get',
      'state.set',
    ]);
    expect(
      registry
        .listForSkill({ name: 'read', allowedTools: ['character.get'] })
        .map((tool) => tool.id),
    ).toEqual(['character.get']);
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
});
