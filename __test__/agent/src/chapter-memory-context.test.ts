import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assembleNovelAgentMessages, createBaselineNovelAgentContextPackage, createNovelAgentWorkspaceSnapshotFromProjection } from '@oh-awesome-novel/agent';
import type { SandboxProjectionSnapshot } from '@oh-awesome-novel/tools';
import { evaluateProjectHealth, formatProjectHealthMarkdown } from '@oh-awesome-novel/core';
import { PriorityRuntimeContextBuilder } from '@oh-awesome-novel/runtime';

const hash = (content: string) => createHash('sha256').update(content).digest('hex');
function projection(count: number, revisions = 3): SandboxProjectionSnapshot {
  const files = [{ path: 'state/characters.yaml', content: 'characters:\n  hero:\n    location: 院子\n' }, { path: '.oan/constitution/style.md', content: '保持作者风格。' }];
  for (let i = 1; i <= count; i += 1) {
    const id = `0001/${String(i).padStart(4, '0')}`;
    const chapter = '# 当前章\n他走进院子。\n'; const sourceHash = hash(chapter);
    const evidence = { version: 1, chapterRef: id, sourceHash, observations: [{ id: 'arrive', category: 'location', subject: '主角', observation: '当前观察', confidence: 'high', evidence: { startLine: 2, endLine: 2, quote: '他走进院子。' } }] };
    const state = { ...evidence, authorNotes: '作者备注', settlementRecords: Array.from({ length: revisions }, (_, revision) => ({ ...evidence, sourceHash: hash(`old-${revision}`), observations: [`HISTORICAL_SECRET_${revision}`] })) };
    const old = state.settlementRecords.map((record) => `<!-- oan:settlement:summary-${record.sourceHash} -->\n## Evidence snapshot ${record.sourceHash.slice(0, 12)}\n\nSource SHA-256: ${record.sourceHash}\n\nHISTORICAL_SECRET\n<!-- /oan:settlement:summary-${record.sourceHash} -->`).join('\n');
    const summary = `${old}\n<!-- oan:settlement:summary-${sourceHash} -->\n## Evidence snapshot ${sourceHash.slice(0, 12)}\n\nSource SHA-256: ${sourceHash}\n\n- 主角: 当前观察 (lines 2-2)\n<!-- /oan:settlement:summary-${sourceHash} -->\n<!-- oan:settlement:summary-current-${id.replace('/', '-')} -->\nCurrent evidence source SHA-256: ${sourceHash}\nEvidence snapshots preserve accepted history. Only the snapshot matching this hash describes the current settled chapter; other snapshots are historical.\n<!-- /oan:settlement:summary-current-${id.replace('/', '-')} -->`;
    files.push({ path: `chapters/${id}.md`, content: chapter }, { path: `summaries/chapter/${id}.md`, content: summary }, { path: `state/chapters/${id}.yaml`, content: JSON.stringify(state) });
  }
  return { workspaceRoot: '/novel', projectionFingerprint: 'a'.repeat(64), directories: [], files: files.map((file) => ({ ...file, mtimeMs: 0, mode: 0o644 })) };
}
function assemble(input: SandboxProjectionSnapshot) {
  const workspace = createNovelAgentWorkspaceSnapshotFromProjection(input);
  const contextPackage = createBaselineNovelAgentContextPackage({ workspace, request: '/写下一章' })!;
  const projectHealth = evaluateProjectHealth(input);
  const assembly = assembleNovelAgentMessages({ workspace, request: '/写下一章', contextPackage, projectHealth,
    selectedContext: [{ kind: 'selected', title: 'Project Health Guardrails', content: formatProjectHealthMarkdown(projectHealth) }] });
  return { workspace, contextPackage, assembly };
}
describe('long novel chapter evidence context', () => {
  it('keeps default protected state constant across 100/500 chapters and repeated revisions', () => {
    const small = assemble(projection(100, 1)); const large = assemble(projection(500, 8));
    expect(large.workspace.state).toBe(small.workspace.state);
    expect(large.workspace.state).toContain('characters.yaml');
    expect(large.workspace.contextFiles?.filter((file) => file.sourceId === 'latestState')).toHaveLength(1);
    expect(large.workspace.chapterEvidenceCoverage?.length).toBeLessThan(2400);
    expect(large.workspace.chapterEvidenceCoverage).toContain('Chapters: 500');
    const messages = (value: ReturnType<typeof assemble>) => new PriorityRuntimeContextBuilder().build({ context: value.assembly.context, doneMessages: [], curMessages: value.assembly.messages });
    const sentSmall = JSON.stringify(messages(small)); const sentLarge = JSON.stringify(messages(large));
    expect(sentLarge).not.toContain('HISTORICAL_SECRET'); expect(sentLarge).not.toContain('settlementRecords');
    expect(sentLarge.length).toBeLessThan(sentSmall.length + 3000);
    expect(large.workspace.omittedContextFiles?.filter((file) => file.sourceId === 'latestState')).toHaveLength(500);
    expect(large.contextPackage.omitted.find((file) => file.path === 'state/chapters/0001/0001.yaml')?.reason).toContain('fixed-projection reads');
  });
  it('protects selected chapter current evidence and author fields without its historical records', () => {
    const input = projection(100, 8);
    const workspace = createNovelAgentWorkspaceSnapshotFromProjection(input, { targetPaths: ['chapters/0001/0042.md'] });
    const selected = workspace.contextFiles?.find((file) => file.path === 'state/chapters/0001/0042.yaml')!;
    expect(selected.payload).toContain('当前观察'); expect(selected.payload).toContain('作者备注');
    expect(selected.payload).not.toContain('HISTORICAL_SECRET');
    expect(selected.payload).toContain('not the complete canonical file');
    expect(selected.sourceHash).toBe(hash(input.files.find((file) => file.path === selected.path)!.content));
    expect(selected.payloadHash).toBe(hash(selected.payload!)); expect(selected.sourceHash).not.toBe(selected.payloadHash);
    const context = createBaselineNovelAgentContextPackage({ workspace, request: '/写下一章' })!;
    expect(context.selected.find((source) => source.path === selected.path)?.semanticBoundary).toBe('protected');
    expect(input.files.find((file) => file.path === selected.path)?.content).toContain('HISTORICAL_SECRET');
  });
  it('keeps an explicitly selected state file complete and protected', () => {
    const input = projection(1); const path = 'state/chapters/0001/0001.yaml';
    const workspace = createNovelAgentWorkspaceSnapshotFromProjection(input, { targetPaths: [path] });
    expect(workspace.state).toContain('HISTORICAL_SECRET'); expect(workspace.state).toContain('Explicitly selected complete file');
    expect(workspace.state).toContain(input.files.find((file) => file.path === path)!.content);
  });
  it('preserves explicitly selected original content even when its managed summary is stale', () => {
    const input = projection(1);
    input.files.find((file) => file.path === 'chapters/0001/0001.md')!.content += '正文变化';
    const summary = input.files.find((file) => file.path === 'summaries/chapter/0001/0001.md')!;
    const workspace = createNovelAgentWorkspaceSnapshotFromProjection(input, { targetPaths: [summary.path] });
    expect(workspace.summaries).toBeUndefined();
    const assembly = assembleNovelAgentMessages({ workspace, request: '对比选中的历史摘要', selectedContext: [{ kind: 'selected', title: summary.path, content: summary.content }] });
    const selected = assembly.context.find((item) => item.title === summary.path)!;
    expect(selected.content).toBe(summary.content);
    expect(selected.provenance?.every((source) => source.semanticBoundary === 'protected')).toBe(true);
  });
  it('omits stale/edited managed summaries while retaining labeled manual chapter and upper summaries', () => {
    const input = projection(3);
    input.files.find((file) => file.path === 'chapters/0001/0001.md')!.content += '正文已变。';
    input.files.find((file) => file.path === 'summaries/chapter/0001/0002.md')!.content = '# 手工摘要\n作者参考';
    input.files.find((file) => file.path === 'summaries/chapter/0001/0003.md')!.content = input.files.find((file) => file.path === 'summaries/chapter/0001/0003.md')!.content.replace('当前观察 (lines', '被改过的观察 (lines');
    input.files.push({ path: 'summaries/global.md', content: '作者全书摘要', mode: 0o644, mtimeMs: 0 });
    const workspace = createNovelAgentWorkspaceSnapshotFromProjection(input);
    expect(workspace.summaries?.join('\n')).toContain('unverified author reference');
    expect(workspace.summaries?.join('\n')).toContain('作者参考'); expect(workspace.summaries?.join('\n')).toContain('作者全书摘要');
    expect(workspace.summaries?.join('\n')).not.toContain('chapter/0001/0001.md');
    expect(workspace.summaries?.join('\n')).not.toContain('被改过的观察');
    expect(workspace.omittedContextFiles?.find((file) => file.path === 'summaries/chapter/0001/0001.md')?.selectionReason).toContain('stale');
    expect(workspace.omittedContextFiles?.find((file) => file.path === 'summaries/chapter/0001/0003.md')?.selectionReason).toContain('unverified');
  });
});
