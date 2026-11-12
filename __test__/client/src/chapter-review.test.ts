import { expect, it } from 'vite-plus/test';
import { buildChapterReviewReport, newChapterReviewId, normalizeChapterReviewDecisions } from '@oh-awesome-novel/core';
import { createOanClient } from '@oh-awesome-novel/client';
import { reviewFiles, reviewPath, reviewResponse, reviewText } from '../../core/src/fixtures/chapter-review';
it('validates report identity, evidence hashes, exact quotations and the advisory boundary', async () => {
  const report = buildChapterReviewReport({ id: newChapterReviewId(), createdAt: '2026-11-12T00:00:00.000Z', path: reviewPath, content: reviewText, files: reviewFiles, basisPaths: [], contextFingerprint: 'a'.repeat(64), response: reviewResponse() });
  const view = { report, decisions: { reportId: report.id, revision: 0, choices: normalizeChapterReviewDecisions(report, {}) }, stale: false };
  let response: unknown = view;
  const api = createOanClient({ backendBaseUrl: 'http://test', fetch: async () => new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } }) });
  await expect(api.readChapterReview(report.id, '/workspace')).resolves.toEqual(view);
  for (const mutated of [
    { ...report, path: 'chapters/0001/0002.md' },
    { ...report, id: 'review-other' }, { ...report, score: 100 }, { ...report, dimensions: [] },
    { ...report, findings: [{ ...report.findings[0], blocking: true }, report.findings[1]] },
    { ...report, findings: [{ ...report.findings[0], quote: '不是原文' }, report.findings[1]] },
    { ...report, findings: [{ ...report.findings[0], evidence: [{ ...report.findings[0]!.evidence[0], sourceHash: 'f'.repeat(64) }] }, report.findings[1]] },
  ]) { response = { ...view, report: mutated }; await expect(api.readChapterReview(report.id, '/workspace')).rejects.toThrow(); }
});
