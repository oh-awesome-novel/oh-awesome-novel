// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { projectUsageCalls } from '@oh-awesome-novel/client';
import type { UsageProbe, UsageProbeResult } from '@oh-awesome-novel/client';
import UsageProbePanel from '../../../apps/desktop-ui/src/components/usage/UsageProbePanel.vue';

const api = vi.hoisted(() => ({ getUsageProbeOptions: vi.fn(), createUsageProbe: vi.fn(), runUsageProbe: vi.fn(), getUsageProbe: vi.fn(), cancelUsageProbe: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
const scope = { domain: 'play' as const, sessionId: 'play-one' };
const provider = { providerId: 'custom', providerKind: 'custom', modelId: 'model-one', status: 'prepared' as const };
function probe(status: UsageProbe['status'] = 'ready'): UsageProbe {
  return { id: 'probe_one', scope, provider, maxCalls: 2, completedCalls: status === 'completed' ? 2 : 0, createdAt: '2026-11-06T00:00:00.000Z', status };
}
function result(status: UsageProbe['status']): UsageProbeResult {
  const history = { schemaVersion: 1 as const, sessionId: 'probe_one', records: [], truncated: false, diagnostics: [] };
  return { probe: probe(status), status, history, projection: projectUsageCalls(history) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function button(wrapper: ReturnType<typeof mount>, label: string) { return wrapper.findAll('button').find(item => item.text() === label)!; }

describe('explicit bounded model comparison', () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear();
    api.getUsageProbeOptions.mockResolvedValue({ provider, maxCalls: 2, syntheticOnly: true });
    api.createUsageProbe.mockResolvedValue(probe());
    api.runUsageProbe.mockResolvedValue(result('completed'));
    api.cancelUsageProbe.mockResolvedValue({ status: 'aborted' });
    api.getUsageProbe.mockResolvedValue(result('aborted'));
  });
  it('opens options without spending, then binds the displayed model on an explicit two-call start', async () => {
    const wrapper = mount(UsageProbePanel, { props: { workspaceKey: 'workspace-one', scope } });
    try {
      expect(api.getUsageProbeOptions).not.toHaveBeenCalled();
      await button(wrapper, '打开模型对照').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('model-one'); expect(wrapper.text()).toContain('最多顺序调用当前模型 2 次');
      expect(api.createUsageProbe).not.toHaveBeenCalled(); expect(api.runUsageProbe).not.toHaveBeenCalled();
      await button(wrapper, '运行 2 次合成样例').trigger('click'); await flushPromises();
      expect(api.createUsageProbe).toHaveBeenCalledWith(scope, { expectedProviderId: 'custom', expectedModelId: 'model-one' });
      expect(api.runUsageProbe).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('两次调用已完成');
      expect(wrapper.text()).toContain('缓存读取 未提供');
    } finally { wrapper.unmount(); }
  });

  it('stops during preparation without starting model requests after the create response arrives', async () => {
    const created = deferred<UsageProbe>(); api.createUsageProbe.mockImplementation(() => created.promise);
    const wrapper = mount(UsageProbePanel, { props: { workspaceKey: 'workspace-one', scope } });
    try {
      await button(wrapper, '打开模型对照').trigger('click'); await flushPromises();
      await button(wrapper, '运行 2 次合成样例').trigger('click');
      await button(wrapper, '停止对照').trigger('click');
      created.resolve(probe()); await flushPromises();
      expect(api.runUsageProbe).not.toHaveBeenCalled();
      expect(api.cancelUsageProbe).toHaveBeenCalledWith('probe_one');
      expect(wrapper.text()).toContain('没有启动模型对照调用');
    } finally { wrapper.unmount(); }
  });

  it('reopens an unknown probe for inspection without replaying it', async () => {
    localStorage.setItem(`oan:usage-probe:${JSON.stringify({ workspace: 'workspace-one', scope })}`, 'probe_one');
    api.getUsageProbe.mockResolvedValue(result('unknown'));
    const wrapper = mount(UsageProbePanel, { props: { workspaceKey: 'workspace-one', scope } });
    try {
      await button(wrapper, '打开模型对照').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('结果未知');
      expect(button(wrapper, '运行 2 次合成样例').attributes('disabled')).toBeDefined();
      await button(wrapper, '刷新对照记录').trigger('click'); await flushPromises();
      expect(api.createUsageProbe).not.toHaveBeenCalled(); expect(api.runUsageProbe).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('aborts a running request and does not display its result in another workspace', async () => {
    const running = deferred<UsageProbeResult>(); api.runUsageProbe.mockImplementation(() => running.promise);
    const wrapper = mount(UsageProbePanel, { props: { workspaceKey: 'workspace-one', scope } });
    try {
      await button(wrapper, '打开模型对照').trigger('click'); await flushPromises();
      await button(wrapper, '运行 2 次合成样例').trigger('click'); await flushPromises();
      const signal = api.runUsageProbe.mock.calls[0]![1].signal as AbortSignal;
      await wrapper.setProps({ workspaceKey: 'workspace-two' });
      expect(signal.aborted).toBe(true);
      running.resolve(result('completed')); await flushPromises();
      expect(wrapper.text()).not.toContain('两次调用已完成');
      expect(wrapper.text()).not.toContain('model-one');
    } finally { wrapper.unmount(); }
  });
});
