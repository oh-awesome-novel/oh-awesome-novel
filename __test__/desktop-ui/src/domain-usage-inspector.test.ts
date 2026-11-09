// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { projectUsageCalls } from '@oh-awesome-novel/client';
import type { AgentGovernanceHistory, UsageInspectorEnvelope, UsageInspectorScope } from '@oh-awesome-novel/client';
import DomainUsageInspector from '../../../apps/desktop-ui/src/components/usage/DomainUsageInspector.vue';

const api = vi.hoisted(() => ({ getPlayUsageInspector: vi.fn(), getReferenceUsageInspector: vi.fn(), getUsageProbeOptions: vi.fn(), createUsageProbe: vi.fn(), runUsageProbe: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
const scope: UsageInspectorScope = { domain: 'play', sessionId: 'play-one' };
const time = '2026-11-06T00:00:00.000Z';
function data(currentScope: UsageInspectorScope = scope, lens: 'player' | 'director' = 'director'): UsageInspectorEnvelope {
  const history: AgentGovernanceHistory = { schemaVersion: 1, sessionId: currentScope.domain === 'play' ? `play-${currentScope.sessionId}` : currentScope.runId, truncated: true, diagnostics: [], records: [] };
  for (const [index, operationId] of ['operation-old', 'operation-new'].entries()) {
    const turnId = `usage-call-${index}`;
    const source = { sourceId: lens === 'director' ? 'secretCharacter' : 'context-0', kind: lens === 'director' ? 'character' : 'context', budgetLayer: 'L1' as const, semanticBoundary: 'protected' as const, outcome: 'selected' as const, reason: 'selected' as const, modelVisibleChars: 60, estimatedTokens: 0, estimator: 'utf8-bytes-div-3-v1' as const, attribution: 'derived' as const };
    const request = { schemaVersion: 1 as const, recordType: 'request' as const, sessionId: history.sessionId, turnId, createdAt: time, stepIndex: 0,
      operation: { domain: currentScope.domain, operationId, stage: 'world-referee', ...(currentScope.domain === 'play' ? { sessionId: currentScope.sessionId } : { referenceId: currentScope.referenceId, runId: currentScope.runId, unitId: 'unit-one' }) },
      fingerprint: { prefixHash: 'a'.repeat(64), prefixKind: 'frozen-system' as const, toolSchemaHash: 'b'.repeat(64) },
      request: { messageCount: 1, messages: [{ index: 0, role: 'system' as const, chars: 60, estimatedTokens: 20, sourceRefs: [source.sourceId] }], estimatedMessageTokens: 20, estimatedRequestTokens: 24, toolCount: 0, estimator: 'utf8-bytes-div-3-v1' as const, estimationScope: 'messages-tools-json-with-20-percent-margin' as const },
      sources: [source], budget: { status: 'unknown' as const, estimatedRequestTokens: 24 },
      egress: { providerId: 'test', providerKind: 'custom', modelId: 'model-one', status: 'prepared' as const, endpointOrigin: 'https://provider.test' },
    };
    history.records.push(request, { schemaVersion: 1, recordType: 'step', sessionId: history.sessionId, turnId, createdAt: time, stepIndex: 0,
      actualUsage: { availability: 'actual', inputTokens: index ? 150 : 100, outputTokens: 25, totalTokens: index ? 175 : 125, cacheReadTokens: 0 },
      outcome: 'completed', timing: { startedAt: time, firstResponseAt: '2026-11-06T00:00:01.000Z', completedAt: '2026-11-06T00:00:02.000Z' },
    });
    if (index === 1) history.records.push(request);
  }
  return { schemaVersion: 1, scope: currentScope, ...(currentScope.domain === 'play' ? { lens } : {}), history, projection: projectUsageCalls(history), presentation: [{ schemaVersion: 1, operationId: 'operation-new', elapsedMs: 1800, source: 'client-observed', observedAt: '2026-11-06T00:00:03.000Z' }] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe('Play/Reference usage inspector', () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
  it('shows current operation, bounded totals, exact availability and separate provider/presentation timing', async () => {
    api.getPlayUsageInspector.mockResolvedValue(data());
    const wrapper = mount(DomainUsageInspector, { props: { workspaceKey: 'workspace-one', scope, lens: 'director', operationId: 'operation-new' } });
    try {
      expect(api.getPlayUsageInspector).not.toHaveBeenCalled();
      await wrapper.get('[aria-label="打开用量与上下文"]').trigger('click'); await flushPromises();
      expect(api.getPlayUsageInspector).toHaveBeenCalledWith('play-one', { limit: 100, lens: 'director', signal: expect.any(AbortSignal) });
      expect(wrapper.findAll('.usage-call')).toHaveLength(1);
      expect(wrapper.text()).toContain('输入 150');
      expect(wrapper.text()).toContain('缓存读取 0');
      expect(wrapper.text()).toContain('缓存写入 未提供');
      expect(wrapper.text()).toContain('模型输入预算未知');
      expect(wrapper.text()).toContain('1,000 ms'); expect(wrapper.text()).toContain('1,800 ms');
      expect(wrapper.text()).toContain('前缀与工具定义未变');
      expect(wrapper.text()).toContain('不是全会话累计');
      expect(wrapper.text()).toContain('派生来源，token 计入整体消息，无法精确分摊');
      await wrapper.get('[aria-label="用量查看范围"]').setValue('history');
      expect(wrapper.findAll('.usage-call')).toHaveLength(2);
      expect(wrapper.get('.usage-summary').text()).toContain('250');
      expect(wrapper.text()).toContain('重复记录已去重');
      expect(api.getUsageProbeOptions).not.toHaveBeenCalled();
      expect(api.runUsageProbe).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('clears Director evidence synchronously and ignores a late request after switching to Player', async () => {
    const late = deferred<UsageInspectorEnvelope>(); const player = deferred<UsageInspectorEnvelope>();
    api.getPlayUsageInspector.mockResolvedValueOnce(data()).mockImplementationOnce(() => late.promise).mockImplementationOnce(() => player.promise);
    const wrapper = mount(DomainUsageInspector, { props: { workspaceKey: 'workspace-one', scope, lens: 'director' } });
    try {
      await wrapper.get('[aria-label="打开用量与上下文"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('secretCharacter');
      await wrapper.findAll('button').find(button => button.text() === '刷新统计')!.trigger('click');
      const oldSignal = api.getPlayUsageInspector.mock.calls[1]![1].signal as AbortSignal;
      await wrapper.setProps({ lens: 'player' });
      expect(oldSignal.aborted).toBe(true);
      expect(wrapper.text()).not.toContain('secretCharacter');
      late.resolve(data()); await flushPromises();
      expect(wrapper.text()).not.toContain('secretCharacter');
      player.resolve(data(scope, 'player')); await flushPromises();
      expect(wrapper.text()).toContain('Player 视角');
      expect(wrapper.text()).not.toContain('secretCharacter');
      expect(wrapper.find('.usage-technical').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('does not show an old workspace response after the same session id is reused', async () => {
    const old = deferred<UsageInspectorEnvelope>(); const current = data();
    current.history.records = []; current.projection = projectUsageCalls(current.history);
    api.getPlayUsageInspector.mockImplementationOnce(() => old.promise).mockResolvedValueOnce(current);
    const wrapper = mount(DomainUsageInspector, { props: { workspaceKey: 'first-workspace', scope, lens: 'director' } });
    try {
      await wrapper.get('[aria-label="打开用量与上下文"]').trigger('click');
      await wrapper.setProps({ workspaceKey: 'second-workspace' }); await flushPromises();
      old.resolve(data()); await flushPromises();
      expect(api.getPlayUsageInspector).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).not.toContain('secretCharacter');
    } finally { wrapper.unmount(); }
  });

  it('loads Reference run history and isolates a late previous reference', async () => {
    const firstScope: UsageInspectorScope = { domain: 'reference', referenceId: 'ref-a', runId: 'run-a' };
    const nextScope: UsageInspectorScope = { domain: 'reference', referenceId: 'ref-b', runId: 'run-b' };
    const old = deferred<UsageInspectorEnvelope>();
    api.getReferenceUsageInspector.mockImplementationOnce(() => old.promise).mockResolvedValueOnce(data(nextScope));
    const wrapper = mount(DomainUsageInspector, { props: { workspaceKey: 'workspace-one', scope: firstScope } });
    try {
      await wrapper.get('[aria-label="打开用量与上下文"]').trigger('click');
      await wrapper.setProps({ scope: nextScope }); await flushPromises();
      old.resolve(data(firstScope)); await flushPromises();
      expect(api.getReferenceUsageInspector).toHaveBeenLastCalledWith('ref-b', 'run-b', { limit: 100, signal: expect.any(AbortSignal) });
      expect(wrapper.text()).toContain('拆解单元 unit-one');
      expect(wrapper.text()).toContain('结果可见 · 客户端观测');
    } finally { wrapper.unmount(); }
  });
});
