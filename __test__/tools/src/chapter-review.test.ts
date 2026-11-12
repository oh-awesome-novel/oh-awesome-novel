import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { buildChapterReviewReport, newChapterReviewId, readChapterReviewDecisions, saveChapterReviewDecisions, saveChapterReviewReport } from '@oh-awesome-novel/core';
import { assertChapterReviewActionFresh, createChangeMaterializer, createChapterReviewProposal, createPendingActionStore, prepareChapterReviewSnapshot, readRepositoryBaseline } from '@oh-awesome-novel/tools';
import { chapterReviewFixture, reviewPath, reviewResponse, reviewText } from '../../core/src/fixtures/chapter-review';
async function pending() {
  const f = await chapterReviewFixture(); const snapshot = await prepareChapterReviewSnapshot(f.root, reviewPath);
  const report = buildChapterReviewReport({ id: newChapterReviewId(), createdAt: new Date().toISOString(), path: reviewPath, content: snapshot.chapter.content, files: snapshot.files, basisPaths: snapshot.basisPaths, contextFingerprint: snapshot.contextFingerprint, response: reviewResponse() });
  await saveChapterReviewReport(f.root, report); const finding = report.findings[1]!;
  const decisions = await saveChapterReviewDecisions(f.root, report, 0, { [finding.id]: 'process' });
  const proposal = createChapterReviewProposal({ id: 'pa_review', report, decisions, source: snapshot, replacements: [{ anchorId: finding.anchor.id, text: '她迟疑片刻。' }], repository: await readRepositoryBaseline(f.root) })!;
  const store = await createPendingActionStore({ workspaceRoot: f.root, assertOriginFresh: ({ preview }) => assertChapterReviewActionFresh(f.root, preview) });
  await store.prepareChangePreview({ id: 'pa_review', candidate: proposal.candidate, origin: proposal.origin, allowedTargets: proposal.allowedTargets });
  const action = await store.promotePreparedChangePreview({ id: 'pa_review', title: '局部修订', description: '选中第二处', source: { kind: 'deterministic-builder', producer: 'chapter-review', capability: 'chapter.edit' }, origin: proposal.origin, allowedTargets: proposal.allowedTargets });
  return { ...f, report, decisions, action };
}
it('materializes only the selected line after restarting and preserves author decisions after Reject', async () => {
  for (const accept of [false, true]) {
    const f = await pending();
    try {
      const store = await createPendingActionStore({ workspaceRoot: f.root }); const materializer = createChangeMaterializer({ store, assertOriginFresh: async () => {} });
      expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(reviewText);
      if (accept) await materializer.accept({ actionId: f.action.id, autoCommitOnAccept: false }); else await materializer.reject({ actionId: f.action.id });
      expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(accept ? reviewText.slice(0, f.report.findings[1]!.anchor.start) + '她迟疑片刻。' + reviewText.slice(f.report.findings[1]!.anchor.end) : reviewText);
      expect(await readChapterReviewDecisions(f.root, f.report)).toEqual(f.decisions);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
it.each(['source', 'basis', 'decision', 'report'])('refuses %s drift before any canonical write even with a permissive host hook', async reason => {
  const f = await pending();
  try {
    if (reason === 'source') await writeFile(join(f.root, reviewPath), `${reviewText}作者新句`);
    if (reason === 'basis') await writeFile(join(f.root, 'world/rules.md'), '# 规则\n作者改了设定。');
    if (reason === 'decision') await saveChapterReviewDecisions(f.root, f.report, f.decisions.revision, {});
    if (reason === 'report') await rm(join(f.root, '.workspace/chapter-reviews', `${f.report.id}.json`));
    const before = await readFile(join(f.root, reviewPath), 'utf8');
    const store = await createPendingActionStore({ workspaceRoot: f.root });
    await expect(createChangeMaterializer({ store, assertOriginFresh: async () => {} }).accept({ actionId: f.action.id, autoCommitOnAccept: false })).rejects.toThrow();
    expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
