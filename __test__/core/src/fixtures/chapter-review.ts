import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chapterReviewBasis, chapterReviewSource } from '@oh-awesome-novel/core';
export const reviewPath = 'chapters/0001/0001.md';
export const reviewText = '# 雨夜\r\n\r\n她笑了。\r\n\r\n她笑了。\r\n\r\n最后一句必须保留。\r\n';
export const reviewRules = '# 世界规则\n她面对陌生人保持戒备。\n';
export const reviewFiles = [{ path: reviewPath, content: reviewText }, { path: 'world/rules.md', content: reviewRules }];
export function reviewResponse(source = chapterReviewSource(reviewPath, reviewText), basis = chapterReviewBasis(reviewFiles)) {
  const anchors = source.anchors.filter(anchor => anchor.text === '她笑了。');
  const rule = basis.find(file => file.path === 'world/rules.md')!.anchors[1]!;
  return { dimensions: [{ category: 'style', status: 'issues', summary: '注意重复表达。' }], findings: anchors.map((anchor, i) => ({ category: 'style', severity: i === 0 ? 'blocking' : 'medium', blocking: true,
    anchorId: anchor.id, quote: anchor.text, offset: 0, issue: i === 0 ? '态度转变缺乏铺垫。' : '重复表达，可用动作展现态度。', suggestedFix: '增加犹豫动作。',
    evidence: i === 0 ? [{ path: 'world/rules.md', anchorId: rule.id, quote: rule.text, offset: 0, role: 'fact' }] : [] })) };
}
export async function chapterReviewFixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-review-')); const git = promisify(execFile);
  await mkdir(join(root, '.oan')); await mkdir(join(root, 'chapters/0001'), { recursive: true }); await mkdir(join(root, 'world'));
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Review\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, '.gitignore'), '.workspace/\n.oan/sessions/\nglobal/\n');
  for (const file of reviewFiles) await writeFile(join(root, file.path), file.content);
  await git('git', ['init', '-b', 'main', root]);
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false']]) await git('git', ['-C', root, 'config', key!, value!]);
  await git('git', ['-C', root, 'add', '.']); await git('git', ['-C', root, 'commit', '-m', 'baseline']);
  return { root, git };
}
