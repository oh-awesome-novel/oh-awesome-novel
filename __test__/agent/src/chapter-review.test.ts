import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { generateChapterReview, generateChapterReviewRevision } from '@oh-awesome-novel/agent';
import { buildChapterReviewReport, newChapterReviewId } from '@oh-awesome-novel/core';
import { chapterReviewFixture, reviewFiles, reviewPath, reviewText } from '../../core/src/fixtures/chapter-review';
import { reviewModel } from './fixtures/chapter-review-model';
it('makes separate read-only and explicit revision calls, sending only selected revision ranges', async () => {
  const f = await chapterReviewFixture();
  try {
    const model = reviewModel(); const common = { workspaceRoot: f.root, providerConfig: { id: 'test', kind: 'custom' as const, model: 'test', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model, abortSignal: new AbortController().signal };
    const response = await generateChapterReview({ ...common, path: reviewPath, content: reviewText, files: reviewFiles });
    expect(model.doGenerateCalls).toHaveLength(1);
    const report = buildChapterReviewReport({ id: newChapterReviewId(), createdAt: new Date().toISOString(), path: reviewPath, content: reviewText, files: reviewFiles, basisPaths: [], contextFingerprint: 'a'.repeat(64), response });
    const revisions = await generateChapterReviewRevision({ ...common, report, findingIds: [report.findings[1]!.id], constraints: [{ path: '.oan/constitution/style.md', content: '避免华丽比喻。' }] });
    expect(revisions).toEqual([{ anchorId: report.findings[1]!.anchor.id, text: '她犹豫片刻，才露出微笑。' }]);
    const prompt = JSON.stringify(model.doGenerateCalls[1]);
    expect(prompt).not.toContain('最后一句必须保留'); expect(prompt).toContain('避免华丽比喻');
    expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(reviewText);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
