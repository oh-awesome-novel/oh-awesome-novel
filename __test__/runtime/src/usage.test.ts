import { describe, expect, it, vi } from 'vitest';
import { jsonSchema, tool } from 'ai';
import { createRuntime } from '@oh-awesome-novel/runtime';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
describe('Runtime request and usage boundaries', () => {
  it('counts each real model step once and preserves partial per-field coverage', async () => {
    const events: RuntimeEvent[] = []; let calls = 0;
    const runtime = createRuntime({ usageSessionId: 'usage-session',
      tools: { read: tool({ description: 'read', inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ text: 'result' }) }) },
      model: { generate: async () => ++calls === 1
        ? { toolCalls: [{ id: 't1', name: 'read', args: {} }], usage: { availability: 'actual', inputTokens: 10, outputTokens: 2, totalTokens: 12 } }
        : { message: { role: 'assistant', content: 'done' } } },
      onEvent: (event) => { events.push(event); },
    });
    const result = await runtime.runTurn({ message: 'USER_SECRET' });
    expect(result.usage).toMatchObject({ stepCount: 2, actualUsage: { availability: 'partial', totalTokens: 12 }, actualCoverage: 'partial', fieldCoverage: { totalTokens: 1 } });
    const requests = events.filter((event) => event.type === 'model_request_stats');
    expect(requests).toHaveLength(2); expect(requests[1]!.record.request.messageCount).toBeGreaterThan(requests[0]!.record.request.messageCount);
    expect(events.filter((event) => event.type === 'usage_stats')).toHaveLength(3);
    expect(JSON.stringify(events.filter((event) => ['model_request_stats', 'usage_stats'].includes(event.type)))).not.toContain('USER_SECRET');
  });
  it('records a provider failure with unavailable actuals and a failed aggregate', async () => {
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ model: { generate: async () => { throw new Error('provider error'); } }, onEvent: (e) => { events.push(e); } });
    await expect(runtime.runTurn({ message: 'go' })).rejects.toThrow('provider error');
    expect(events.filter((e) => e.type === 'usage_stats').map((e) => e.record)).toEqual([
      expect.objectContaining({ recordType: 'step', outcome: 'failed', actualUsage: { availability: 'unavailable' } }),
      expect.objectContaining({ recordType: 'turn', outcome: 'failed', actualCoverage: 'unavailable' }),
    ]);
  });
  it('fails protected overflow before any provider request and records the preflight estimate', async () => {
    const generate = vi.fn(); const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ model: { generate }, prepareModelRequest: (request) => ({ request, metadata: { sources: [], budget: { status: 'overflow', estimatedRequestTokens: 20, inputTokens: 1 } } }), onEvent: (e) => { events.push(e); } });
    await expect(runtime.runTurn({ message: 'required' })).rejects.toMatchObject({ code: 'CONTEXT_PROTECTED_OVERFLOW' });
    expect(generate).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'model_request_stats')).toBe(true);
  });
  it('records cancellation without inventing zero usage', async () => {
    const abort = new AbortController(); const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ model: { generate: async () => { abort.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } }, onEvent: (e) => { events.push(e); } });
    const result = await runtime.runTurn({ message: 'go', abortSignal: abort.signal });
    expect(result.usage).toMatchObject({ outcome: 'aborted', actualCoverage: 'unavailable', actualUsage: { availability: 'unavailable' } });
    expect(events.filter((e) => e.type === 'usage_stats')).toHaveLength(2);
  });
});
