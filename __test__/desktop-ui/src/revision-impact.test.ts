// @vitest-environment happy-dom
vi.hoisted(async () => { const http = await import('undici'); for (const key of ['Headers', 'Request', 'Response', 'fetch'] as const) vi.stubGlobal(key, http[key]); });
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import RevisionImpactPanel from '../../../apps/desktop-ui/src/components/workspace/RevisionImpactPanel.vue';
import { revisionImpactFixture, impactPath, impactAfter } from '../../core/src/fixtures/revision-impact';
const button = (panel: VueWrapper, label: string) => panel.findAll('button').find(b => b.text() === label)!;
it('groups a real report, opens evidence and hands explicit repairs to existing workflows; stale reports stop repair handoffs', async () => {
  const f = await revisionImpactFixture(); let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined; let panel: VueWrapper | undefined;
  try {
    await writeFile(join(f.root, impactPath), impactAfter);
    backend = await startNovelHttpBackend({ workspaceRoot: f.root, globalConfigDir: join(f.root, 'global') }); const api = createOanClient({ backendBaseUrl: backend.url });
    panel = mount(RevisionImpactPanel, { props: { workspaceRoot: f.root, api, request: { source: { kind: 'git', path: impactPath, ref: 'HEAD' }, nonce: 1 } } });
    await vi.waitFor(() => expect(button(panel!, '只读分析').attributes('disabled')).toBeUndefined());
    await button(panel, '只读分析').trigger('click');
    await vi.waitFor(() => expect(panel!.text()).toContain('确定的派生依赖 · 4'), { timeout: 5000 });
    expect(panel.text()).toContain('current → stale'); expect(panel.text()).toContain('覆盖不足');
    await button(panel, '打开文件').trigger('click'); expect(panel.emitted('repair')?.[0]?.[0]).toMatchObject({ kind: 'open', path: 'summaries/chapter/0001/0001.md' });
    await button(panel, '重新审稿').trigger('click');
    await vi.waitFor(() => expect(panel!.emitted('repair')?.[1]?.[0]).toEqual({ kind: 'review', path: impactPath }));
    await button(panel, '整理本卷').trigger('click');
    await vi.waitFor(() => expect(panel!.emitted('repair')?.[2]?.[0]).toEqual({ kind: 'summarizeVolume', path: 'summaries/volume/0001.md' }));
    expect((await api.listPendingActions()).pendingActions).toEqual([]);
    await writeFile(join(f.root, impactPath), `${impactAfter}后来又改变了想法。`);
    await button(panel, '整理全书').trigger('click');
    await vi.waitFor(() => expect(panel!.text()).toContain('报告已过期'));
    expect(panel.emitted('repair')).toHaveLength(3); expect(button(panel, '整理全书').attributes('disabled')).toBeDefined();
    panel.unmount(); panel = mount(RevisionImpactPanel, { props: { workspaceRoot: f.root, api } });
    await vi.waitFor(() => expect(panel!.findAll('.report-link')).toHaveLength(1));
    await panel.find('.report-link').trigger('click'); await vi.waitFor(() => expect(panel!.text()).toContain('报告已过期'));
  } finally { panel?.unmount(); await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 20_000);
it('discards a delayed response when switching workspaces', async () => {
  let resolve!: (v: { reports: [] }) => void;
  const api = { listRevisionImpacts: vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ reports: [] }), createRevisionImpact: vi.fn(), readRevisionImpact: vi.fn() };
  const panel = mount(RevisionImpactPanel, { props: { workspaceRoot: '/first', api } });
  await panel.setProps({ workspaceRoot: '/second' }); resolve({ reports: [] });
  await vi.waitFor(() => expect(api.listRevisionImpacts).toHaveBeenLastCalledWith('/second', expect.any(AbortSignal)));
  expect(panel.findAll('.report-link')).toEqual([]); panel.unmount();
});
