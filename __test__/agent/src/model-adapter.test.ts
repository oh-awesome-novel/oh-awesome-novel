import { describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';

const streamText = vi.fn();

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText,
}));

const { createAiSdkRuntimeModelAdapter } = await import('@oh-awesome-novel/agent');

describe('AI SDK RuntimeModelAdapter bridge', () => {
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
      textStream: toAsyncIterable(['你', '好']),
      toolCalls: Promise.resolve([
        {
          toolCallId: 'call_1',
          toolName: 'character.get',
          input: { id: 'heroine' },
        },
      ]),
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
      textStream: toAsyncIterable(['完成']),
      toolCalls: Promise.resolve([]),
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
});

async function* toAsyncIterable(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
