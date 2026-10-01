import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNovelAgentWorkspaceSnapshotFromProjection, createBaselineNovelAgentContextPackage } from '@oh-awesome-novel/agent';
import type { SandboxProjectionSnapshot } from '@oh-awesome-novel/tools';

function projection(paths: string[]): SandboxProjectionSnapshot {
  return { workspaceRoot: '/novel', projectionFingerprint: 'a'.repeat(64), directories: [], files: paths.toSorted().map((path) => ({
    path, content: `content of ${path}`, mtimeMs: 0, mode: 0o644,
  })) };
}
const chapters = Array.from({ length: 30 }, (_, i) => `summaries/chapter/0001/${String(i + 1).padStart(4, '0')}.md`);

describe('fixed projection context selection', () => {
  it('selects target-near summaries and retains global/volume anchors and every constitution file', () => {
    const rules = Array.from({ length: 15 }, (_, i) => `.oan/constitution/${i}.md`);
    const snapshot = createNovelAgentWorkspaceSnapshotFromProjection(projection([
      ...rules, ...chapters, 'summaries/global.md', 'summaries/volume/0001.md',
    ]), { targetPaths: ['chapters/0001/0028.md'] });
    expect(snapshot.contextFiles?.filter((f) => f.sourceId === 'constitution')).toHaveLength(15);
    expect(snapshot.summaries?.join('\n')).toContain('0028.md');
    expect(snapshot.summaries?.join('\n')).toContain('global.md');
    expect(snapshot.summaries?.join('\n')).toContain('volume/0001.md');
    expect(snapshot.summaries?.join('\n')).not.toContain('chapter/0001/0001.md');
    expect(snapshot.omittedContextFiles?.some((f) => f.path.endsWith('/0001.md'))).toBe(true);
  });

  it('does not load every historical volume when no target is selected', () => {
    const volumes = Array.from({ length: 100 }, (_, i) => `summaries/volume/${String(i + 1).padStart(4, '0')}.md`);
    const snapshot = createNovelAgentWorkspaceSnapshotFromProjection(projection([
      ...volumes, 'summaries/chapter/0100/0001.md', 'summaries/global.md',
    ]));
    expect(snapshot.summaries).toHaveLength(3);
    expect(snapshot.summaries?.join('\n')).toContain('volume/0100.md');
    expect(snapshot.omittedContextFiles).toHaveLength(99);
  });

  it('defaults to the latest numbered summaries and records per-file hashes and omission evidence', () => {
    const snapshot = createNovelAgentWorkspaceSnapshotFromProjection(projection(chapters));
    expect(snapshot.summaries?.[0]).toContain('0030.md');
    const context = createBaselineNovelAgentContextPackage({ request: '/写下一章', workspace: snapshot });
    const first = context?.selected.find((s) => s.path?.endsWith('0030.md'));
    expect(first?.sourceHash).toBe(createHash('sha256').update('content of summaries/chapter/0001/0030.md').digest('hex'));
    expect(first?.payloadHash).toBe(createHash('sha256').update(snapshot.summaries![0]).digest('hex'));
    expect(context?.omitted.find((s) => s.path === chapters[0])).toMatchObject({ outcome: 'omitted', estimatedTokens: 0, modelVisibleChars: 0 });
  });
});
