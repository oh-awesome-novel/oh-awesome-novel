import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createUIMessageStreamResponse, jsonSchema, simulateReadableStream, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  createAiSdkProviderResolver,
  createNovelAgentRuntime,
  runtimeEventsToUiMessageStream,
} from '@oh-awesome-novel/agent';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';

type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;

const usage = {
  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 6, text: 2, reasoning: 4 },
};

const inspectTool = () => ({
  inspect: tool({
    description: 'Inspect a test value.',
    inputSchema: jsonSchema<{ value: string }>({
      type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
    }),
    execute: async ({ value }: { value: string }) => ({ inspected: value }),
  }),
});

describe('model reasoning', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams thinking to the UI, replays it inside the tool loop and drops it from later turns', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        response([
          { type: 'stream-start', warnings: [] },
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', delta: '先检查数值。' },
          { type: 'reasoning-end', id: 'r1' },
          { type: 'tool-call', toolCallId: 'call-inspect', toolName: 'inspect', input: '{"value":"sample"}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage },
        ]),
        response([
          { type: 'stream-start', warnings: [] },
          { type: 'reasoning-start', id: 'r2' },
          { type: 'reasoning-delta', id: 'r2', delta: '可以回答了。' },
          { type: 'reasoning-end', id: 'r2' },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: '检查完成。' },
          { type: 'text-end', id: 'answer' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]),
        response([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'next' },
          { type: 'text-delta', id: 'next', delta: '下一轮。' },
          { type: 'text-end', id: 'next' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]),
      ],
    });
    const runtime = createNovelAgentRuntime({
      workspaceRoot: '/not-read-by-this-test',
      providerConfig: {
        id: 'reasoning-test', kind: 'custom', model: 'thinker',
        models: [{ id: 'thinker', reasoningEffort: 'high' }],
      },
      resolveModel: () => model,
      tools: inspectTool(),
    });

    const events: RuntimeEvent[] = [];
    for await (const event of runtime.streamTurn({ message: '请检查。' })) events.push(event);
    const wire = await readWire(toIterable(events));

    expect(model.doStreamCalls[0]!.reasoning).toBe('high');
    expect(model.doStreamCalls[1]!.prompt).toContainEqual(expect.objectContaining({
      role: 'assistant',
      content: expect.arrayContaining([{ type: 'reasoning', text: '先检查数值。' }]),
    }));
    expect(wire).toContain('"type":"reasoning-start"');
    expect(wire).toContain('"type":"reasoning-delta"');
    expect(wire).toContain('先检查数值。');
    expect(wire).toContain('"type":"reasoning-end"');

    const finish = events.find((event) => event.type === 'message_finish');
    if (finish?.type !== 'message_finish') throw new Error('turn did not finish');
    expect(finish.result.assistantMessage).toMatchObject({ content: '检查完成。', reasoning: '可以回答了。' });

    await runtime.runTurn({ message: '继续。', messages: finish.result.messages });
    expect(JSON.stringify(model.doStreamCalls[2]!.prompt)).not.toContain('"type":"reasoning"');
  });

  it('omits the reasoning option when the active model has no configured effort', async () => {
    const model = new MockLanguageModelV4({ doStream: response([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'a' },
      { type: 'text-delta', id: 'a', delta: '好' },
      { type: 'text-end', id: 'a' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]) });
    const runtime = createNovelAgentRuntime({
      workspaceRoot: '/not-read-by-this-test',
      providerConfig: { id: 'plain', kind: 'custom', model: 'plain', models: [{ id: 'plain' }] },
      resolveModel: () => model,
      tools: {},
    });
    await runtime.runTurn({ message: 'hi' });
    expect(model.doStreamCalls[0]!.reasoning).toBeUndefined();
  });

  it('parses and replays reasoning_content for OpenAI-compatible providers such as DeepSeek', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const replies = [
      [
        { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '需要工具。' } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'inspect', arguments: '{"value":"x"}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ],
      [
        { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '完成。' } }] },
        { choices: [{ index: 0, delta: { content: '结果是 x。' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ],
    ];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const chunks = replies.shift() ?? [];
      const sse = `${chunks.map((chunk) => `data: ${JSON.stringify({ id: 'c', created: 0, model: 'deepseek-reasoner', ...chunk })}\n\n`).join('')}data: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }));

    const runtime = createNovelAgentRuntime({
      workspaceRoot: '/not-read-by-this-test',
      providerConfig: {
        id: 'deepseek', kind: 'deepseek', model: 'deepseek-reasoner', baseUrl: 'https://api.deepseek.test', apiKey: 'test-key',
        models: [{ id: 'deepseek-reasoner', reasoningEffort: 'medium' }],
      },
      resolveModel: createAiSdkProviderResolver(),
      tools: inspectTool(),
    });
    const result = await runtime.runTurn({ message: '检查 x' });

    expect(result.stoppedReason).toBe('completed');
    expect(result.assistantMessage).toMatchObject({ content: '结果是 x。', reasoning: '完成。' });
    expect(bodies[0]).toMatchObject({ reasoning_effort: 'medium' });
    expect(bodies[1]!.messages).toContainEqual(expect.objectContaining({
      role: 'assistant',
      reasoning_content: '需要工具。',
    }));
  });
});

function response(chunks: ProviderPart[]) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
}

async function* toIterable(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  yield* events;
}

function readWire(events: AsyncIterable<RuntimeEvent>) {
  return createUIMessageStreamResponse({ stream: runtimeEventsToUiMessageStream(events) }).text();
}
