// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
const api = vi.hoisted(() => ({ listAgentUsageSessions: vi.fn(), getAgentGovernanceHistory: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
import AgentUsageInspector from '../../../apps/desktop-ui/src/components/agent-checkpoint/AgentUsageInspector.vue';
const createdAt = '2026-10-01T00:00:00.000Z';
const request = (turnId = 'turn-1') => ({ schemaVersion: 1, recordType: 'request', sessionId: 'session-1', turnId, createdAt, stepIndex: 0,
  request: { messageCount: 1, messages: [{ index: 0, role: 'system', chars: 60, estimatedTokens: 20, sourceRefs: ['constitution:.oan/constitution/style.md'] }], estimatedMessageTokens: 20, estimatedRequestTokens: 30, toolCount: 0, estimator: 'utf8-bytes-div-3-v1', estimationScope: 'messages-tools-json-with-20-percent-margin' },
  sources: [{ sourceId: 'constitution', kind: 'constitution', path: '.oan/constitution/style.md', sourceHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), budgetLayer: 'L0', semanticBoundary: 'protected', outcome: 'selected', reason: 'selected', modelVisibleChars: 60, estimatedTokens: 20, estimator: 'utf8-bytes-div-3-v1', attribution: 'exact' }],
  budget: { status: 'unknown', estimatedRequestTokens: 30 }, egress: { providerId: 'custom', providerKind: 'custom', modelId: 'model', endpointOrigin: 'https://example.test', status: 'prepared' } });
const turn = () => ({ schemaVersion: 1, recordType: 'turn', sessionId: 'session-1', turnId: 'turn-1', createdAt, stepCount: 1, estimatedMessageTokens: 20, estimatedRequestTokens: 30, outcome: 'completed', actualUsage: { availability: 'partial', inputTokens: 9 }, actualCoverage: 'partial', fieldCoverage: { inputTokens: 1, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } });
const messages = (records: unknown[]): UIMessage[] => [{ id: 'a', role: 'assistant', parts: records.map((data) => ({ type: 'data-agent-usage', data })) }];
describe('usage inspector', () => {
  beforeEach(() => { vi.resetAllMocks(); api.listAgentUsageSessions.mockResolvedValue({ sessions: [{ id: 'history-1', updatedAt: createdAt }] }); });
  it('separates estimated/partial actual, shows unknown budget, provenance and safe egress, and routes source links', async () => {
    const wrapper = mount(AgentUsageInspector, { props: { messages: messages([request(), turn()]) } });
    expect(wrapper.text()).toContain('Actual partial');
    expect(api.listAgentUsageSessions).not.toHaveBeenCalled();
    await wrapper.get('.usage-toggle').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('模型上下文预算未知');
    expect(wrapper.text()).toContain('输入 9'); expect(wrapper.text()).toContain('输出 unavailable');
    expect(wrapper.text()).toContain('https://example.test');
    expect(wrapper.text()).toContain('aaaaaaaaaaaa'); expect(wrapper.text()).toContain('bbbbbbbbbbbb');
    await wrapper.get('.source-path').trigger('click');
    expect(wrapper.emitted('openSource')).toEqual([['.oan/constitution/style.md']]); wrapper.unmount();
  });
  it('does not show previous actual usage as the current running turn', async () => {
    const wrapper = mount(AgentUsageInspector, { props: { messages: messages([request(), turn(), request('turn-2')]) } });
    expect(wrapper.get('.usage-toggle').text()).toContain('等待实际用量');
    await wrapper.get('.usage-toggle').trigger('click'); expect(wrapper.find('.usage-total').exists()).toBe(false); wrapper.unmount();
  });
  it('reopens persisted sessions and ignores a stale request after returning to live', async () => {
    let resolveHistory!: (value: unknown) => void;
    api.getAgentGovernanceHistory.mockImplementation(() => new Promise((resolve) => { resolveHistory = resolve; }));
    const wrapper = mount(AgentUsageInspector, { props: { messages: messages([request()]) } });
    await wrapper.get('.usage-toggle').trigger('click'); await flushPromises();
    await wrapper.get('select').setValue('history-1');
    expect(api.getAgentGovernanceHistory).toHaveBeenCalledWith('history-1', 100);
    await wrapper.get('select').setValue('live');
    resolveHistory({ schemaVersion: 1, sessionId: 'history-1', records: [turn()], truncated: false, diagnostics: [] }); await flushPromises();
    expect(wrapper.get('.usage-toggle').text()).toContain('等待实际用量');
    wrapper.unmount();
  });
  it('shows diagnostics for an unsupported future stream schema', async () => {
    const wrapper = mount(AgentUsageInspector, { props: { messages: messages([{ ...request(), schemaVersion: 2 }]) } });
    await wrapper.get('.usage-toggle').trigger('click'); expect(wrapper.text()).toContain('统计格式不受支持'); wrapper.unmount();
  });
});
