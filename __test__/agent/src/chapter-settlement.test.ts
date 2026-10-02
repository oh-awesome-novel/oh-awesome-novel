import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createNovelAgentTurnEditEnvironment, inferNovelAgentCapability } from '@oh-awesome-novel/agent';
import { createChapterSettlementSource } from '@oh-awesome-novel/core';
import { createPendingActionStore } from '@oh-awesome-novel/tools';

const git = promisify(execFile); const roots: string[] = [];
const chapterPath = 'chapters/0001/0001.md';
const content = '# 第一章\n\n林安拿起钥匙。\n';
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-settlement-agent-')); roots.push(root);
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await mkdir(join(root, 'outline'), { recursive: true });
  await writeFile(join(root, chapterPath), content);
  await writeFile(join(root, 'outline/plan.md'), '未发生的后续计划，不能作为正文证据。');
  await git('git', ['init', '-b', 'main', root]); await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  return root;
}
const observations = () => ({ schemaVersion: 1, chapterId: '0001/0001', sourceHash: createChapterSettlementSource('0001/0001', content).sourceHash,
  observations: [{ id: 'key', category: 'item', subject: '林安', observation: '持有钥匙', confidence: 'high', evidence: { startLine: 3, endLine: 3, quote: '林安拿起钥匙。' } }], unresolvedAmbiguities: ['钥匙所有权未说明'] });

describe('production chapter settlement factory', () => {
  it('uses the inferred quick-command capability and exposes only bounded reads and structured proposals', async () => {
    const root = await fixture();
    const environment = await createNovelAgentTurnEditEnvironment({ workspaceRoot: root,
      capability: inferNovelAgentCapability('/整理本章'), exactWritablePaths: [chapterPath] });
    try {
      expect(Object.keys(environment.tools).sort()).toEqual(['readFile', 'settlement.propose']);
      expect(environment.workspace.fixedFileHashes!.some((file) => file.path.startsWith('outline/'))).toBe(false);
      expect(environment.selectedContext![0].content).toContain('3: 林安拿起钥匙。');
      expect(environment.selectedContext![0].provenance).toMatchObject([{ path: chapterPath,
        sourceHash: createChapterSettlementSource('0001/0001', content).sourceHash, semanticBoundary: 'protected' }]);
      const execute = environment.tools['settlement.propose']!.execute!;
      const result = await execute(observations(), { toolCallId: 'settle', messages: [] }) as any;
      expect(result.report).toContain('钥匙所有权未说明');
      expect(result.pendingActions).toHaveLength(1);
      expect(result.pendingActions[0].origin).toMatchObject({ kind: 'chapterSettlement', chapterId: '0001/0001' });
      await expect(readFile(join(root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(root, chapterPath), 'utf8')).toBe(content);
      await expect(execute(observations(), { toolCallId: 'duplicate', messages: [] })).rejects.toThrow('already has a proposal');
    } finally { await environment.dispose(); }
  });
  it('rejects bad evidence and source drift before any proposal can be persisted', async () => {
    const root = await fixture(); const env = await createNovelAgentTurnEditEnvironment({ workspaceRoot: root,
      capability: 'novel.settle_chapter', exactWritablePaths: [chapterPath] });
    try {
      const invalid = observations(); invalid.observations[0]!.evidence.quote = '大纲中的计划';
      await expect(env.tools['settlement.propose']!.execute!(invalid, { toolCallId: 'bad', messages: [] })).rejects.toThrow('quote');
      await writeFile(join(root, chapterPath), `${content}新增正文\n`);
      await expect(env.tools['settlement.propose']!.execute!(observations(), { toolCallId: 'stale', messages: [] })).rejects.toThrow();
      expect(await (await createPendingActionStore({ workspaceRoot: root })).listViews()).toEqual([]);
    } finally { await env.dispose(); }
  });
  it.each([[], ['state/world.yaml'], ['chapters/0001/0000.md'], [chapterPath, 'summaries/chapter/0001/0001.md']])('requires exactly one host-selected narrative chapter: %j', async (exactWritablePaths) => {
    const root = await fixture();
    await expect(createNovelAgentTurnEditEnvironment({ workspaceRoot: root, capability: 'novel.settle_chapter', exactWritablePaths })).rejects.toThrow('已编号的正文文件');
  });
});
