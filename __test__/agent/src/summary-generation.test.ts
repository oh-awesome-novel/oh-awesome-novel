import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createNovelAgentTurnEditEnvironment, createNovelAgentWorkspaceSnapshotFromProjection, inferNovelAgentCapability } from '@oh-awesome-novel/agent';
import { createPendingActionStore } from '@oh-awesome-novel/tools';
import { NOVEL_COPILOT_QUICK_COMMANDS } from '@oh-awesome-novel/core';
import { settledSummaryFiles, summaryDraft, appendSummary, fixtureFingerprint } from '../../fixtures/summary-generation';

const git = promisify(execFile); const roots: string[] = []; const targetPath = 'summaries/volume/0001.md';
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(incomplete = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-summary-agent-')); roots.push(root);
  const files = settledSummaryFiles();
  files.find((file) => file.path.startsWith('summaries/chapter'))!.content += '\nAUTHOR_SECRET\n';
  files.push({ path: targetPath, content: '# 旧手工卷摘要\nOLD_SUMMARY_SECRET\n' });
  if (incomplete) files.push({ path: 'chapters/0001/0002.md', content: '没有结算的章节' });
  for (const file of files) { await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), file.content); }
  await git('git', ['init', '-b', 'main', root]); await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  return { root, files };
}
describe('default summary generation environment', () => {
  it('routes explicit workflows, supplies only protected verified inputs and creates one proposal', async () => {
    const f = await fixture();
    expect(inferNovelAgentCapability('/整理本卷')).toBe('novel.summarize_volume');
    expect(inferNovelAgentCapability('/整理全书')).toBe('novel.summarize_global');
    const env = await createNovelAgentTurnEditEnvironment({ workspaceRoot: f.root, capability: inferNovelAgentCapability('/整理本卷'), exactWritablePaths: ['chapters/0001/0001.md'] });
    try {
      expect(Object.keys(env.tools)).toEqual(['summary.propose']);
      expect(env.workspace.summaries).toBeUndefined(); expect(env.workspace.state).toBeUndefined();
      expect(JSON.stringify(env.selectedContext)).not.toMatch(/AUTHOR_SECRET|OLD_SUMMARY_SECRET/);
      expect(env.selectedContext!.find((item) => item.title?.includes('Verified summary input'))!.provenance).toMatchObject([{ semanticBoundary: 'protected', path: 'summaries/chapter/0001/0001.md' }]);
      const execute = env.tools['summary.propose']!.execute!;
      const result = await execute(summaryDraft(f.files, targetPath), { toolCallId: 'summary', messages: [] }) as { pendingActions: unknown[] };
      expect(result.pendingActions).toHaveLength(1);
      expect(await readFile(join(f.root, targetPath), 'utf8')).toContain('OLD_SUMMARY_SECRET');
      await expect(execute(summaryDraft(f.files, targetPath), { toolCallId: 'duplicate', messages: [] })).rejects.toThrow('already proposed');
    } finally { await env.dispose(); }
  });
  it('reports missing evidence without exposing a proposal tool or partial fact inputs', async () => {
    const f = await fixture(true);
    const env = await createNovelAgentTurnEditEnvironment({ workspaceRoot: f.root, capability: 'novel.summarize_volume', exactWritablePaths: ['chapters/0001/0001.md'] });
    try {
      expect(Object.keys(env.tools)).toEqual([]); expect(env.selectedContext).toHaveLength(1);
      expect(env.selectedContext![0].content).toContain('summaries/chapter/0001/0002.md: missing');
      expect(await (await createPendingActionStore({ workspaceRoot: f.root })).listViews()).toEqual([]);
    } finally { await env.dispose(); }
  });
  it.each(['inventory', 'abort'])('rejects %s before persisting a proposal from a frozen turn', async (change) => {
    const f = await fixture(); const controller = new AbortController();
    const env = await createNovelAgentTurnEditEnvironment({ workspaceRoot: f.root, capability: 'novel.summarize_volume', exactWritablePaths: ['chapters/0001/0001.md'], abortSignal: controller.signal });
    try {
      if (change === 'inventory') await writeFile(join(f.root, 'chapters/0001/0002.md'), '新章'); else controller.abort();
      await expect(env.tools['summary.propose']!.execute!(summaryDraft(f.files, targetPath), { toolCallId: 'stale', messages: [] })).rejects.toThrow();
      expect(await (await createPendingActionStore({ workspaceRoot: f.root })).listViews()).toEqual([]);
    } finally { await env.dispose(); }
  });
  it('includes verified aggregate context and omits recursively stale managed prose', () => {
    const files = settledSummaryFiles(); appendSummary(files, targetPath); appendSummary(files, 'summaries/global.md');
    const projection = { workspaceRoot: '/fixture', projectionFingerprint: fixtureFingerprint, files: files.map((file) => ({ ...file, mode: 0o644, mtimeMs: 0 })), directories: [] };
    const current = createNovelAgentWorkspaceSnapshotFromProjection(projection, { targetPaths: [targetPath] });
    expect(current.contextFiles?.find((file) => file.path === targetPath)?.selectionReason).toContain('current summary');
    expect(current.contextFiles?.find((file) => file.path === 'summaries/global.md')?.payload).toContain('current summary');
    projection.files[0]!.content += '修改';
    const stale = createNovelAgentWorkspaceSnapshotFromProjection(projection);
    expect(stale.summaries).toBeUndefined();
    expect(stale.omittedContextFiles?.find((file) => file.path === 'summaries/global.md')?.selectionReason).toContain('stale');
    expect(stale.chapterEvidenceCoverage).toContain('summaries/global.md: stale');
  });

  it.each(['帮我看看怎么整理第一卷摘要，先别写', '不要整理本卷，只解释流程', '整理本卷怎么用？', '/整理本卷说明', '如何生成全书摘要？'])('does not turn a mention into aggregate generation: %s', (request) => {
    expect(['novel.summarize_volume', 'novel.summarize_global']).not.toContain(inferNovelAgentCapability(request));
  });
  it('preserves explicit command priority and routes catalog prompts and planning correctly', () => {
    expect(inferNovelAgentCapability('/整理本卷\n全书中的这一卷')).toBe('novel.summarize_volume');
    expect(inferNovelAgentCapability('/整理全书：请简练')).toBe('novel.summarize_global');
    expect(inferNovelAgentCapability('规划下一卷并整理卷摘要')).toBe('novel.plan_volume');
    expect(inferNovelAgentCapability('/规划下一章请延续当前主线')).toBe('novel.plan_chapter');
    for (const command of NOVEL_COPILOT_QUICK_COMMANDS.filter((command) => command.id.startsWith('summary.'))) expect(inferNovelAgentCapability(command.prompt)).toBe(command.capabilityId);
  });
  it('withholds generation inputs and tools when the existing target is damaged', async () => {
    const f = await fixture();
    await writeFile(join(f.root, targetPath), '# 摘要\n<!-- oan:summary:v1\n损坏区块');
    const env = await createNovelAgentTurnEditEnvironment({ workspaceRoot: f.root, capability: 'novel.summarize_volume', exactWritablePaths: ['chapters/0001/0001.md'] });
    try {
      expect(Object.keys(env.tools)).toEqual([]); expect(env.selectedContext).toHaveLength(1);
      expect(env.selectedContext![0].content).toContain('target-invalid');
      expect(env.selectedContext![0].content).toContain('系统不会覆盖损坏内容');
      expect(await (await createPendingActionStore({ workspaceRoot: f.root })).listViews()).toEqual([]);
    } finally { await env.dispose(); }
  });
  it('unions chapter and volume selections and explains non-active volumes accurately', () => {
    const files = [...settledSummaryFiles(), ...settledSummaryFiles('0002/0001'), ...settledSummaryFiles('0003/0001')];
    for (const id of ['0001', '0002', '0003']) appendSummary(files, `summaries/volume/${id}.md`);
    const projection = { workspaceRoot: '/fixture', projectionFingerprint: fixtureFingerprint, files: files.map((file) => ({ ...file, mode: 0o644, mtimeMs: 0 })), directories: [] };
    const context = createNovelAgentWorkspaceSnapshotFromProjection(projection, { targetPaths: ['chapters/0001/0001.md', 'summaries/volume/0002.md'] });
    expect(context.contextFiles?.filter((file) => file.path.startsWith('summaries/volume/')).map((file) => file.path).sort()).toEqual(['summaries/volume/0001.md', 'summaries/volume/0002.md']);
    expect(context.omittedContextFiles?.find((file) => file.path === 'summaries/volume/0003.md')?.selectionReason).toBe('non-active volume summary; available through fixed-projection tools');
  });
});
