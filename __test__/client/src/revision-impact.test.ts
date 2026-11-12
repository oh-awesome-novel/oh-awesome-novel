import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { createRevisionImpactReport } from '@oh-awesome-novel/tools';
import { createOanClient } from '@oh-awesome-novel/client';
import { revisionImpactFixture, impactPath, impactAfter } from '../../core/src/fixtures/revision-impact';
it('rejects mismatched report/source identities, contradictory hashes, missing evidence and unbounded results', async () => {
  const f = await revisionImpactFixture();
  try {
    await writeFile(join(f.root, impactPath), impactAfter);
    const view = await createRevisionImpactReport(f.root, { kind: 'git', path: impactPath, ref: 'HEAD' }); let response: unknown = view;
    const api = createOanClient({ backendBaseUrl: 'http://test', fetch: async () => new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } }) });
    expect(await api.readRevisionImpact(view.report.id, f.root)).toEqual(view);
    for (const report of [
      { ...view.report, id: 'impact-other' }, { ...view.report, snapshotFingerprint: 'invalid' },
      { ...view.report, comparisons: [{ ...view.report.comparisons[0], change: 'unchanged' }] },
      { ...view.report, items: [{ ...view.report.items[0], sourcePath: 'world/unrelated.md' }] },
      { ...view.report, items: [{ ...view.report.items[0], evidence: '' }] },
      { ...view.report, items: Array.from({ length: 301 }, () => view.report.items[0]) },
      { ...view.report, counts: { ...view.report.counts, derived: 0 } },
    ]) { response = { ...view, report }; await expect(api.readRevisionImpact(view.report.id, f.root)).rejects.toThrow(); }
    response = view; await expect(api.createRevisionImpact({ expectedWorkspaceRoot: f.root, source: { kind: 'acceptedAction', actionId: 'pa-other' } })).rejects.toThrow('来源');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
