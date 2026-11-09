import { describe, expect, it, vi } from 'vite-plus/test';
import { jsonSchema, tool } from 'ai';
import { createRuntime, fingerprintRuntimeModelRequest } from '@oh-awesome-novel/runtime';
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
  it('records non-streaming start/completion without manufacturing a first response timestamp', async () => {
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ model: { generate: async () => ({ message: { role: 'assistant', content: 'done' } }) }, onEvent: event => { events.push(event); } });
    await runtime.runTurn({ message: 'go' });
    const step = events.find(event => event.type === 'usage_stats' && event.record.recordType === 'step');
    expect(step).toMatchObject({ record: { timing: { startedAt: expect.any(String), completedAt: expect.any(String) } } });
    if (step?.type !== 'usage_stats' || step.record.recordType !== 'step') throw new Error('Step missing');
    expect(step.record.timing?.firstResponseAt).toBeUndefined();
    const request = events.find(event => event.type === 'model_request_stats');
    expect(request).toMatchObject({ record: { fingerprint: { prefixKind: 'system-messages', prefixHash: expect.stringMatching(/^[a-f0-9]{64}$/u), toolSchemaHash: expect.stringMatching(/^[a-f0-9]{64}$/u) } } });
  });
  it('keeps observed first-response time on streaming failure without inventing actual tokens', async () => {
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ model: { generate: async () => ({}), async *stream() {
      yield { type: 'text_delta', text: 'partial' };
      throw new Error('interrupted provider');
    } }, onEvent: event => { events.push(event); } });
    await expect(runtime.runTurn({ message: 'go' })).rejects.toThrow('interrupted provider');
    const step = events.find(event => event.type === 'usage_stats' && event.record.recordType === 'step');
    expect(step).toMatchObject({ record: { outcome: 'failed', actualUsage: { availability: 'unavailable' }, timing: { startedAt: expect.any(String), firstResponseAt: expect.any(String), completedAt: expect.any(String) } } });
  });
  it('fingerprints the fixed prefix and resolved schema without depending on the user tail or tool function', async () => {
    const tools = { read: tool({ description: 'read', inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => 'one' }) };
    const request = { messages: [{ role: 'system' as const, content: 'prefix' }, { role: 'user' as const, content: 'first tail' }], tools };
    const first = await fingerprintRuntimeModelRequest(request, 'prefix');
    const second = await fingerprintRuntimeModelRequest({ ...request, messages: [{ role: 'user', content: 'second tail' }], tools: { read: { ...tools.read, execute: async () => 'different implementation' } } }, 'prefix');
    expect(second).toEqual(first);
    const changed = await fingerprintRuntimeModelRequest({ ...request, tools: { read: { ...tools.read, description: 'different schema description' } } }, 'prefix');
    expect(changed.prefixHash).toBe(first.prefixHash);
    expect(changed.toolSchemaHash).not.toBe(first.toolSchemaHash);
  });
});
