// @vitest-environment happy-dom
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNovelHonoApp, type NovelBackendAgentInput } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
const api = vi.hoisted(() => ({ createAgentChatTransport: vi.fn(), listAgentUsageSessions: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
import AgentUsageInspector from '../../../apps/desktop-ui/src/components/agent-checkpoint/AgentUsageInspector.vue';
import { useAgentConversationSessions } from '../../../apps/desktop-ui/src/composables/useAgentConversationSessions';
const createdAt = '2026-10-01T00:00:00.000Z';
const roots: string[] = []; const wrappers: VueWrapper[] = []; const closers: Array<() => void> = [];
afterEach(async () => { for (const end of closers.splice(0)) end(); for (const wrapper of wrappers.splice(0)) wrapper.unmount(); vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
function requestRecord(sessionId: string, turnId: string) {
  return { schemaVersion: 1, recordType: 'request', sessionId, turnId, createdAt, stepIndex: 0,
    request: { messageCount: 1, messages: [{ index: 0, role: 'system', chars: 6, estimatedTokens: 6, sourceRefs: ['chapter:chapters/0001/0001.md'] }], estimatedMessageTokens: 6, estimatedRequestTokens: 12, toolCount: 0, estimator: 'utf8-bytes-div-3-v1', estimationScope: 'messages-tools-json-with-20-percent-margin' },
    sources: [{ sourceId: 'chapter', kind: 'chapter', path: 'chapters/0001/0001.md', sourceHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), budgetLayer: 'L0', semanticBoundary: 'protected', outcome: 'selected', reason: 'selected', modelVisibleChars: 6, estimatedTokens: 6, estimator: 'utf8-bytes-div-3-v1', attribution: 'exact' }],
    budget: { status: 'within', inputTokens: 100, estimatedRequestTokens: 12 }, egress: { providerId: 'custom', providerKind: 'custom', modelId: 'test-model', endpointOrigin: 'https://provider.example', status: 'prepared' } };
}
function usageRecords(sessionId: string, turnId: string, partial: boolean) {
  const actualUsage = partial ? { availability: 'partial', inputTokens: 7 } : { availability: 'unavailable' };
  return [
    { schemaVersion: 1, recordType: 'step', sessionId, turnId, createdAt, stepIndex: 0, outcome: 'completed', actualUsage },
    { schemaVersion: 1, recordType: 'turn', sessionId, turnId, createdAt, stepCount: 1, estimatedMessageTokens: 6, estimatedRequestTokens: 12, actualUsage,
      actualCoverage: partial ? 'partial' : 'unavailable', fieldCoverage: { inputTokens: partial ? 1 : 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, outcome: 'completed' },
  ];
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-sdk-usage-')); roots.push(root);
  const runs: Array<{ input: NovelBackendAgentInput; event(event: RuntimeEvent): void; close(): void }> = [];
  const app = createNovelHonoApp({ workspaceRoot: root, globalConfigDir: join(root, 'config'), runAgent(input) {
    const queue: RuntimeEvent[] = []; let ended = false; let wake: (() => void) | undefined;
    const close = () => { ended = true; wake?.(); }; closers.push(close);
    runs.push({ input, event(event) { queue.push(event); wake?.(); }, close });
    return { async *[Symbol.asyncIterator]() { while (true) { if (queue.length) { yield queue.shift()!; continue; } if (ended) return; await new Promise<void>((resolve) => { wake = resolve; }); } } };
  } });
  // Backend routes, runtime→UI formatter, client transport and useChat are real.
  // Split every SSE frame at the network boundary, including UTF-8 and JSON.
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await app.request(String(input), init);
    const reader = response.body!.getReader();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      let ended = false;
      const abort = () => { if (!ended) { ended = true; controller.error(new DOMException('Aborted', 'AbortError')); void reader.cancel(); } };
      init?.signal?.addEventListener('abort', abort, { once: true });
      void (async () => { try { while (!ended) { const next = await reader.read(); if (ended) break; if (next.done) { ended = true; controller.close(); break; } for (let offset = 0; offset < next.value.length; offset += 7) controller.enqueue(next.value.subarray(offset, offset + 7)); } }
        catch (error) { if (!ended) { ended = true; controller.error(error); } }
        finally { init?.signal?.removeEventListener('abort', abort); } })();
    } });
    return new Response(body, { status: response.status, headers: response.headers });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = createOanClient({ backendBaseUrl: 'http://sdk-usage.test', fetch: fetcher });
  api.createAgentChatTransport.mockImplementation(() => client.createAgentChatTransport());
  api.listAgentUsageSessions.mockResolvedValue({ sessions: [] });
  let state!: ReturnType<typeof useAgentConversationSessions>;
  const wrapper = mount(defineComponent({ setup() { state = useAgentConversationSessions(); return () => h(AgentUsageInspector, { messages: state.activeMessages.value }); } })); wrappers.push(wrapper);
  const send = (text: string) => { state.activeInput.value = text; return state.sendCurrentInput(); };
  const run = async (index: number) => { await vi.waitFor(() => expect(runs.length).toBeGreaterThan(index)); return runs[index]!; };
  return { state, wrapper, send, run };
}
describe('installed SDK usage stream to production inspector', () => {
  it.each([false, true])('shows provider usage availability without inventing totals (partial=%s)', async (partial) => {
    const { state, wrapper, send, run } = await fixture();
    const sending = send('Continue the saved chapter'); const stream = await run(0); const sessionId = stream.input.sessionId!;
    expect(sessionId).toBe(state.activeConversationId.value); expect(stream.input.abortSignal?.aborted).toBe(false);
    stream.event({ type: 'model_request_stats', record: requestRecord(sessionId, 'turn-1') } as RuntimeEvent);
    await vi.waitFor(() => expect(wrapper.text()).toContain('等待实际用量'));
    await wrapper.get('.usage-toggle').trigger('click');
    expect(wrapper.text()).toContain('https://provider.example'); expect(wrapper.text()).toContain('chapters/0001/0001.md');
    for (const record of usageRecords(sessionId, 'turn-1', partial)) stream.event({ type: 'usage_stats', record } as RuntimeEvent);
    await vi.waitFor(() => expect(wrapper.get('.usage-total').text()).toContain(`Actual ${partial ? 'partial' : 'unavailable'}`));
    expect(wrapper.text()).toContain(partial ? '输入 7' : '输入 unavailable'); expect(wrapper.text()).toContain('总计 unavailable');
    expect(state.activeStatus.value).toBe('streaming'); stream.close(); await sending;
    expect(state.activeStatus.value).toBe('ready');
    expect(wrapper.text()).not.toContain('统计格式不受支持'); // SDK exposes reactive Proxy data.
  });
  it('rejects raw provider metadata and request bodies carried by malformed stream records', async () => {
    const { wrapper, send, run } = await fixture(); const sending = send('Continue'); const stream = await run(0); const sessionId = stream.input.sessionId!;
    const record = requestRecord(sessionId, 'turn-secret');
    stream.event({ type: 'model_request_stats', record: { ...record, requestBody: 'PRIVATE_PROMPT_SENTINEL', providerMetadata: { authorization: 'SECRET_API_KEY_SENTINEL' } } } as unknown as RuntimeEvent);
    stream.event({ type: 'model_request_stats', record: { ...record, egress: { ...record.egress, endpointOrigin: 'https://user:SECRET_PASSWORD@provider.example?token=SECRET_QUERY' } } } as RuntimeEvent);
    stream.close(); await sending; await wrapper.get('.usage-toggle').trigger('click');
    expect(wrapper.text()).toContain('统计格式不受支持');
    for (const secret of ['PRIVATE_PROMPT_SENTINEL', 'SECRET_API_KEY_SENTINEL', 'SECRET_PASSWORD', 'SECRET_QUERY']) expect(wrapper.html()).not.toContain(secret);
    expect(wrapper.find('.usage-step').exists()).toBe(false);
  });
  it('retains the backend session ID on follow-up and forwards stop without mixing conversations', async () => {
    const { state, send, run } = await fixture();
    const firstSending = send('First'); const first = await run(0); first.event({ type: 'message_delta', text: 'First answer' }); first.close(); await firstSending;
    const secondSending = send('Follow up'); const second = await run(1);
    expect(second.input.sessionId).toBe(first.input.sessionId);
    expect(second.input.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    second.event({ type: 'model_request_stats', record: requestRecord(second.input.sessionId!, 'turn-2') } as RuntimeEvent);
    await vi.waitFor(() => expect(state.activeStatus.value).toBe('streaming'));
    state.stop(); await secondSending; expect(second.input.abortSignal?.aborted).toBe(true); second.close();
    state.createConversation(); const thirdSending = send('Separate'); const third = await run(2);
    expect(third.input.sessionId).not.toBe(first.input.sessionId); expect(third.input.messages).toHaveLength(1); third.close(); await thirdSending;
  });
});
