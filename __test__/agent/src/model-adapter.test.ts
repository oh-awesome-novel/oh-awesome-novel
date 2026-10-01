import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';

const streamText = vi.fn();

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText,
}));

const { createAiSdkRuntimeModelAdapter } = await import('@oh-awesome-novel/agent');

describe('AI SDK RuntimeModelAdapter bridge', () => {
  beforeEach(() => {
    streamText.mockReset();
  });

  it('streams text deltas and returns the final RuntimeModelResponse', async () => {
    const model = { provider: 'mock', modelId: 'mock-model' };
    const resolveModel = vi.fn(() => model);
    const toolSet: ToolSet = {
      'character.get': {
        description: 'Read character.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: vi.fn(),
      },
    } as ToolSet;

    streamText.mockReturnValue({
      stream: toAsyncIterable(['你', '好']),
      get toolCalls() {
        throw new Error('Use finalStep instead of aggregated tool calls.');
      },
      finalStep: Promise.resolve({ toolCalls: [
        {
          toolCallId: 'call_1',
          toolName: 'character.get',
          input: { id: 'heroine' },
        },
      ] }),
    });

    const adapter = createAiSdkRuntimeModelAdapter({
      providerConfig: {
        id: 'mock-provider',
        kind: 'custom',
        model: 'mock-model',
      },
      resolveModel,
    });

    const events = [];
    for await (const event of adapter.stream?.({
      messages: [{ role: 'user', content: '你好' }],
      tools: toolSet,
    }) ?? []) {
      events.push(event);
    }

    expect(resolveModel).toHaveBeenCalledWith({
      id: 'mock-provider',
      kind: 'custom',
      model: 'mock-model',
    });
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        maxRetries: 0,
      }),
    );
    const modelVisibleTools = streamText.mock.calls[0][0].tools;
    expect(modelVisibleTools['character.get'].execute).toBeUndefined();
    expect(events).toEqual([
      { type: 'text_delta', text: '你' },
      { type: 'text_delta', text: '好' },
      {
        type: 'finish',
        response: {
          message: {
            role: 'assistant',
            content: '你好',
          },
          toolCalls: [
            {
              id: 'call_1',
              name: 'character.get',
              args: { id: 'heroine' },
            },
          ],
        },
      },
    ]);
  });

  it('uses the same stream bridge for generate()', async () => {
    streamText.mockReturnValue({
      stream: toAsyncIterable(['完成']),
      finalStep: Promise.resolve({ toolCalls: [] }),
    });

    const adapter = createAiSdkRuntimeModelAdapter({
      providerConfig: {
        id: 'mock-provider',
        kind: 'custom',
        model: 'mock-model',
      },
      resolveModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' })),
    });

    await expect(
      adapter.generate({
        messages: [{ role: 'user', content: '开始' }],
        tools: {},
      }),
    ).resolves.toEqual({
      message: {
        role: 'assistant',
        content: '完成',
      },
      toolCalls: [],
    });
  });

  it('enforces the configured input reserve before every provider call and forwards output limits', async () => {
    streamText.mockReturnValue({ stream: toAsyncIterable(['done']), finalStep: Promise.resolve({ toolCalls: [] }) });
    const resolveModel = vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' }));
    const adapter = createAiSdkRuntimeModelAdapter({
      providerConfig: { id: 'mock-provider', kind: 'custom', model: 'mock-model',
        models: [{ id: 'mock-model', contextWindow: 4096, maxOutputTokens: 1024 }] },
      resolveModel,
    });
    await adapter.generate({ messages: [{ role: 'user', content: 'hello' }], tools: {} });
    expect(streamText.mock.calls[0][0].maxOutputTokens).toBe(1024);
    await expect(adapter.generate({ messages: [
      { role: 'user', content: 'hello' },
      { role: 'tool', content: '中文'.repeat(4000), name: 'read', toolCallId: 'read-1' },
    ], tools: {} })).rejects.toMatchObject({ code: 'CONTEXT_INPUT_OVERFLOW', budgetTokens: 3072 });
    expect(resolveModel).toHaveBeenCalledTimes(1);
  });

  it('does not invent a budget when the output reserve is unknown', async () => {
    streamText.mockReturnValue({ stream: toAsyncIterable(['done']), finalStep: Promise.resolve({ toolCalls: [] }) });
    const adapter = createAiSdkRuntimeModelAdapter({
      providerConfig: { id: 'mock-provider', kind: 'custom', model: 'mock-model',
        models: [{ id: 'mock-model', contextWindow: 32 }] },
      resolveModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' })),
    });
    await adapter.generate({ messages: [{ role: 'user', content: '中文'.repeat(100) }], tools: {} });
    expect(streamText.mock.calls[0][0].maxOutputTokens).toBeUndefined();
  });

  it('maps runtime tool-call history to AI SDK model messages', async () => {
    streamText.mockReturnValue({
      stream: toAsyncIterable(['完成']),
      finalStep: Promise.resolve({ toolCalls: [] }),
    });

    const adapter = createAiSdkRuntimeModelAdapter({
      providerConfig: {
        id: 'mock-provider',
        kind: 'custom',
        model: 'mock-model',
      },
      resolveModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' })),
    });

    await adapter.generate({
      messages: [
        { role: 'user', content: '读取角色' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'character.list',
              args: {},
            },
          ],
        },
        {
          role: 'tool',
          name: 'character.list',
          toolCallId: 'call_1',
          content: JSON.stringify({
            ok: true,
            content: {
              characters: [{ id: 'mira' }],
            },
          }),
        },
      ],
      tools: {},
    });

    expect(streamText.mock.calls[0][0].messages).toMatchObject([
      { role: 'user', content: '读取角色' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'character.list',
            input: {},
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'character.list',
            output: {
              type: 'json',
              value: {
                ok: true,
                content: {
                  characters: [{ id: 'mira' }],
                },
              },
            },
          },
        ],
      },
    ]);
  });

  it('passes runtime system messages through the AI SDK instructions option', async () => {
    streamText.mockReturnValue({
      stream: toAsyncIterable(['完成']),
      finalStep: Promise.resolve({ toolCalls: [] }),
    });

    const adapter = createAiSdkRuntimeModelAdapter({
      providerConfig: {
        id: 'mock-provider',
        kind: 'custom',
        model: 'mock-model',
      },
      resolveModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' })),
    });

    await adapter.generate({
      messages: [
        { role: 'system', content: '你是小说 Copilot。' },
        { role: 'system', content: '遵守审阅保护。' },
        { role: 'user', content: '开始' },
      ],
      tools: {},
    });

    expect(streamText.mock.calls[0][0]).toMatchObject({
      instructions: '你是小说 Copilot。\n\n遵守审阅保护。',
      messages: [{ role: 'user', content: '开始' }],
    });
    expect(streamText.mock.calls[0][0]).not.toHaveProperty('system');
  });
});

async function* toAsyncIterable(chunks: string[]) {
  for (const chunk of chunks) {
    yield { type: 'text-delta', id: 'test-text', text: chunk };
  }
}
