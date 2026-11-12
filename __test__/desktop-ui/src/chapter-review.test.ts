// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import { buildChapterReviewReport, newChapterReviewId, normalizeChapterReviewDecisions } from '@oh-awesome-novel/core';
import ChapterReviewWorkbench from '../../../apps/desktop-ui/src/components/editor/ChapterReviewWorkbench.vue';
import { reviewFiles, reviewPath, reviewResponse, reviewText } from '../../core/src/fixtures/chapter-review';
it('isolates late reviews across cancellation and workspace switches while keeping existing decisions', async () => {
  const report = buildChapterReviewReport({ id: newChapterReviewId(), createdAt: new Date().toISOString(), path: reviewPath, content: reviewText, files: reviewFiles, basisPaths: [], contextFingerprint: 'a'.repeat(64), response: reviewResponse() });
  const view = { report, decisions: { reportId: report.id, revision: 1, choices: normalizeChapterReviewDecisions(report, { [report.findings[0]!.id]: 'keep' }) }, stale: false };
  let finish!: (value: unknown) => void;
  const api = { listChapterReviews: vi.fn().mockResolvedValue({ reports: [view], omittedCount: 0 }), generateChapterReview: vi.fn(() => new Promise(resolve => { finish = resolve; })), readChapterReview: vi.fn(), saveChapterReviewDecisions: vi.fn(), reviseChapterReview: vi.fn() };
  const panel = mount(ChapterReviewWorkbench, { props: { workspaceRoot: '/first', path: reviewPath, sourceVersion: reviewText, disabled: false, api: api as never } });
  try {
    await flushPromises(); expect((panel.findAll('.review-finding select')[0]!.element as HTMLSelectElement).value).toBe('keep');
    await panel.findAll('button').find(button => button.text() === '只读审稿')!.trigger('click');
    await panel.findAll('button').find(button => button.text() === '取消')!.trigger('click');
    finish({ ...view, report: { ...report, findings: [] } }); await flushPromises();
    expect(panel.findAll('.review-finding')).toHaveLength(2);
    await panel.findAll('button').find(button => button.text() === '只读审稿')!.trigger('click');
    api.listChapterReviews.mockResolvedValue({ reports: [], omittedCount: 0 });
    await panel.setProps({ workspaceRoot: '/second' }); finish(view); await flushPromises();
    expect(panel.findAll('.review-finding')).toHaveLength(0); expect(api.reviseChapterReview).not.toHaveBeenCalled();
  } finally { panel.unmount(); }
});
