import { rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vite-plus/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import { readRevisionImpactSnapshot } from '@oh-awesome-novel/tools';
import { revisionImpactFixture, impactPath, impactAfter } from '../../core/src/fixtures/revision-impact';
it('analyzes and reopens after host restart without a model or canonical writes, then detects evidence drift', async () => {
  const f = await revisionImpactFixture(); let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const resolveModel = vi.fn(() => { throw new Error('Impact must not call a model'); }); const options = { workspaceRoot: f.root, resolveModel, globalConfigDir: join(f.root, 'global') };
    backend = await startNovelHttpBackend(options); let api = createOanClient({ backendBaseUrl: backend.url });
    const source = { kind: 'git' as const, path: impactPath, ref: 'HEAD' };
    await utimes(join(f.root, impactPath), new Date(), new Date());
    const unchanged = await api.createRevisionImpact({ expectedWorkspaceRoot: f.root, source }); expect(unchanged.report.items).toEqual([]);
    await writeFile(join(f.root, impactPath), impactAfter); const before = await readRevisionImpactSnapshot(f.root, []);
    const view = await api.createRevisionImpact({ expectedWorkspaceRoot: f.root, source });
    expect(view.report.items.filter(i => i.kind === 'derived')).toHaveLength(4); expect(view.stale).toBe(false);
    expect(view.report.comparisons[0]!.beforeRef).toMatch(/^[a-f0-9]{40}$/u);
    await backend.close(); backend = await startNovelHttpBackend(options); api = createOanClient({ backendBaseUrl: backend.url });
    expect((await api.listRevisionImpacts(f.root)).reports.map(r => r.id)).toContain(view.report.id);
    expect(await api.readRevisionImpact(view.report.id, f.root)).toEqual(view);
    expect((await api.listPendingActions()).pendingActions).toEqual([]); expect(resolveModel).not.toHaveBeenCalled();
    expect((await readRevisionImpactSnapshot(f.root, [])).fingerprint).toBe(before.fingerprint);
    await writeFile(join(f.root, 'world/new-evidence.md'), '# 新证据\n新设定。');
    expect((await api.readRevisionImpact(view.report.id, f.root)).stale).toBe(true);
    await expect(api.createRevisionImpact({ expectedWorkspaceRoot: '/other', source })).rejects.toThrow('工作区');
    await expect(api.createRevisionImpact({ expectedWorkspaceRoot: f.root, source: { ...source, ref: 'missing-ref' } })).rejects.toThrow('commit');
    await expect(api.createRevisionImpact({ expectedWorkspaceRoot: f.root, source: { kind: 'acceptedAction', actionId: 'cleaned-action' } })).rejects.toThrow();
  } finally { await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 20_000);
