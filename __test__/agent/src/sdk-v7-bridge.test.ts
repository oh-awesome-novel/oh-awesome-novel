import { describe, expect, it, vi } from 'vitest';
import { createUIMessageStreamResponse, jsonSchema, simulateReadableStream, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  createAiSdkRuntimeModelAdapter,
  createNovelAgentRuntime,
  runtimeEventsToUiMessageStream,
} from '@oh-awesome-novel/agent';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';

type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;

const providerConfig = { id: 'v7-test', kind: 'custom' as const, model: 'v7-test' };
const usage = {
  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

describe('installed AI SDK 7 bridge', () => {
  it('preserves Runtime execution ownership, instructions and tool results through a real SDK SSE stream', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        response([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'call-inspect', toolName: 'inspect', input: '{"value":"sample"}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage },
        ]),
        response([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: '检查完成。' },
          { type: 'text-end', id: 'answer' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]),
      ],
    });
    const execute = vi.fn(async ({ value }: { value: string }) => ({ inspected: value }));
    const runtime = createNovelAgentRuntime({
      workspaceRoot: '/not-read-by-this-test', providerConfig, resolveModel: () => model,
      tools: {
        inspect: tool({
          description: 'Inspect a test value.',
          inputSchema: jsonSchema<{ value: string }>({
            type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
          }),
          execute,
        }),
      },
    });
    const wire = await readWire(runtime.streamTurn({
      message: '请检查。', skill: { name: 'test', system: 'TRUSTED_INSTRUCTION' },
    }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0]!.prompt[0]).toMatchObject({ role: 'system', content: expect.stringContaining('TRUSTED_INSTRUCTION') });
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('inspected');
    expect(wire).toContain('tool-input-available');
    expect(wire).toContain('tool-output-available');
    expect(wire).toContain('data-tool-log');
    expect(wire).toContain('检查完成。');
    expect(wire).toContain('[DONE]');
  });

  it('propagates a provider error after partial text instead of completing or finalizing a candidate', async () => {
    const model = new MockLanguageModelV4({ doStream: response([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'partial' },
      { type: 'text-delta', id: 'partial', delta: '未完成' },
      { type: 'error', error: new Error('provider interrupted') },
    ]) });
    const finalizeTurn = vi.fn(async () => []);
    const runtime = createNovelAgentRuntime({
      workspaceRoot: '/not-read-by-this-test', providerConfig, resolveModel: () => model,
      tools: {}, turnFinalizer: { finalizeTurn },
    });
    await expect(runtime.runTurn({ message: 'start' })).rejects.toThrow('provider interrupted');
    expect(finalizeTurn).toHaveBeenCalledWith(expect.objectContaining({ stoppedReason: 'error' }));
    expect(runtime.getState().pendingActions).toEqual([]);
  });

  it('fails on an error finish reason even when the provider has no separate error part', async () => {
    const model = new MockLanguageModelV4({ doStream: response([
      { type: 'stream-start', warnings: [] },
      { type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage },
    ]) });
    const adapter = createAiSdkRuntimeModelAdapter({ providerConfig, resolveModel: () => model });
    await expect(adapter.generate({ messages: [{ role: 'user', content: 'start' }], tools: {} }))
      .rejects.toThrow('Model generation finished with an error.');
  });

  it('retains reviewable text on a length finish instead of treating the output limit as a provider error', async () => {
    const model = new MockLanguageModelV4({ doStream: response([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'limited' },
      { type: 'text-delta', id: 'limited', delta: '可审阅的部分结果' },
      { type: 'text-end', id: 'limited' },
      { type: 'finish', finishReason: { unified: 'length', raw: 'length' }, usage },
    ]) });
    const adapter = createAiSdkRuntimeModelAdapter({ providerConfig, resolveModel: () => model });
    await expect(adapter.generate({ messages: [{ role: 'user', content: 'start' }], tools: {} }))
      .resolves.toMatchObject({ message: { content: '可审阅的部分结果' }, toolCalls: [] });
  });

  it('keeps intentional Runtime errors visible and masks unexpected iterator exceptions', async () => {
    async function* known(): AsyncIterable<RuntimeEvent> {
      yield { type: 'error', error: { code: 'KNOWN', message: 'Refresh the stale candidate.', recoverable: true } };
    }
    expect(await readWire(known())).toContain('Refresh the stale candidate.');
    async function* unexpected(): AsyncIterable<RuntimeEvent> {
      throw new Error('INTERNAL_SECRET_MUST_NOT_LEAK');
    }
    const wire = await readWire(unexpected());
    expect(wire).toContain('An error occurred.');
    expect(wire).not.toContain('INTERNAL_SECRET_MUST_NOT_LEAK');
  });
});

function response(chunks: ProviderPart[]) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
}

function readWire(events: AsyncIterable<RuntimeEvent>) {
  return createUIMessageStreamResponse({ stream: runtimeEventsToUiMessageStream(events) }).text();
}
