import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mergeSummaryDocument, prepareSummaryGeneration } from '@oh-awesome-novel/core';
import { chapterReviewFixture } from './chapter-review';
export const impactPath = 'chapters/0001/0001.md';
export const impactText = '# 城门\n林安到达城门。\n';
export const impactAfter = '# 城门\n林安留在旧屋。\n';
export const impactHash = (text: string) => createHash('sha256').update(text).digest('hex');
export function impactFiles() {
  const sourceHash = impactHash(impactText); const chapterId = '0001/0001';
  const files = [
    { path: impactPath, content: impactText },
    { path: 'state/chapters/0001/0001.yaml', content: JSON.stringify({ version: 1, chapterRef: chapterId, sourceHash, observations: [{ id: 'arrival', category: 'location', subject: '林安', observation: '到达城门', confidence: 'high', evidence: { startLine: 2, endLine: 2, quote: '林安到达城门。' } }] }) },
    { path: 'summaries/chapter/0001/0001.md', content: `<!-- oan:settlement:summary-${sourceHash} -->\n## Evidence snapshot ${sourceHash.slice(0, 12)}\n\nSource SHA-256: ${sourceHash}\n\n- 林安: 到达城门 (lines 2-2)\n<!-- /oan:settlement:summary-${sourceHash} -->\n<!-- oan:settlement:summary-current-0001-0001 -->\nCurrent evidence source SHA-256: ${sourceHash}\nEvidence snapshots preserve accepted history. Only the snapshot matching this hash describes the current settled chapter; other snapshots are historical.\n<!-- /oan:settlement:summary-current-0001-0001 -->\n` },
    { path: 'characters/lin-an/meta.yaml', content: 'name: 林安\nfirstAppearance: 0001/0001\n' },
    { path: 'characters/lin-an/profile.md', content: '# 林安\n谨慎行事。\n' },
    { path: 'chapters/0001/0002.md', content: '---\ncharacters: [lin-an]\n---\n# 第二章\n他隐瞒了自己的来处。\n' },
    { path: 'world/namesake.md', content: '# 地名\n林安是一座无关城市，与角色同名。\n' },
    { path: 'world/unrelated.md', content: '# 海洋\n潮汐往复。\n' },
    { path: 'summaries/chapter/0001/0002.md', content: '尚无来源凭证的作者摘要。\n' },
  ];
  // Only the first chapter has verified evidence: use a fully covered snapshot for its baseline summaries.
  const settled = files.filter(file => !file.path.includes('0001/0002'));
  for (const path of ['summaries/volume/0001.md', 'summaries/global.md']) {
    const source = prepareSummaryGeneration({ files: settled }, path);
    if (!source.ready) throw new Error('Fixture summary is not ready');
    const summary = { path, content: mergeSummaryDocument(undefined, { schemaVersion: 1, targetPath: path, chapterIds: source.chapterIds,
      sources: source.sources.map(({ path, sourceHash, payloadHash }) => ({ path, sourceHash, payloadHash })), sourceFingerprint: source.sourceFingerprint,
      paragraphs: [{ text: '林安到达城门。', sourcePaths: source.sources.map(s => s.path) }] }) };
    settled.push(summary); files.push(summary);
  }
  return files;
}
export async function revisionImpactFixture() {
  const f = await chapterReviewFixture(); const files = impactFiles();
  // Keep the dependency baseline fresh; setting-specific tests add the second chapter separately.
  for (const file of files.filter(file => !file.path.includes('0001/0002'))) { await mkdir(dirname(join(f.root, file.path)), { recursive: true }); await writeFile(join(f.root, file.path), file.content); }
  await f.git('git', ['-C', f.root, 'add', '.']); await f.git('git', ['-C', f.root, 'commit', '-m', 'impact fixture']);
  return { ...f, files };
}
