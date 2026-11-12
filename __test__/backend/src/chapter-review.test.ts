import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import { chapterReviewFixture, reviewPath, reviewText } from '../../core/src/fixtures/chapter-review';
import { reviewModel } from '../../agent/src/fixtures/chapter-review-model';
it('persists a read-only report and author choices, then revises only the chosen line after restart', async () => {
  const f = await chapterReviewFixture(); let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const model = reviewModel(); const options = { workspaceRoot: f.root, globalConfigDir: join(f.root, 'global'), providerConfig: { id: 'controlled', kind: 'custom' as const, model: 'controlled', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model };
    backend = await startNovelHttpBackend(options); let api = createOanClient({ backendBaseUrl: backend.url });
    const view = await api.generateChapterReview({ expectedWorkspaceRoot: f.root, path: reviewPath, basisPaths: [] });
    expect(view.report.dimensions.filter(d => d.status === 'notChecked')).toHaveLength(7);
    expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(reviewText);
    expect((await api.listPendingActions()).pendingActions).toEqual([]); expect(model.doGenerateCalls).toHaveLength(1);
    const choices = { ...view.decisions.choices, [view.report.findings[0]!.id]: 'keep' as const, [view.report.findings[1]!.id]: 'process' as const };
    const saved = await api.saveChapterReviewDecisions(view.report.id, { expectedWorkspaceRoot: f.root, revision: 0, choices });
    await backend.close(); backend = await startNovelHttpBackend(options); api = createOanClient({ backendBaseUrl: backend.url });
    expect((await api.readChapterReview(view.report.id, f.root)).decisions).toEqual(saved.decisions);
    const { pendingAction } = await api.reviseChapterReview(view.report.id, { expectedWorkspaceRoot: f.root, decisionRevision: 1 });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1])).not.toContain('最后一句必须保留');
    expect(JSON.stringify(model.doGenerateCalls[1])).not.toContain(view.report.findings[0]!.issue);
    expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(reviewText);
    await api.acceptPendingAction(pendingAction.id);
    expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe('# 雨夜\r\n\r\n她笑了。\r\n\r\n她犹豫片刻，才露出微笑。\r\n\r\n最后一句必须保留。\r\n');
    const stale = await api.readChapterReview(view.report.id, f.root);
    expect(stale.stale).toBe(true); expect(stale.decisions.choices).toEqual(choices);
  } finally { await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 15_000);
it('does not call the revision model for stale evidence, unselected problems or another workspace', async () => {
  const f = await chapterReviewFixture(); let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const model = reviewModel(); backend = await startNovelHttpBackend({ workspaceRoot: f.root, providerConfig: { id: 'test', kind: 'custom', model: 'test', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model });
    const api = createOanClient({ backendBaseUrl: backend.url });
    const view = await api.generateChapterReview({ expectedWorkspaceRoot: f.root, path: reviewPath, basisPaths: [] });
    await expect(api.reviseChapterReview(view.report.id, { expectedWorkspaceRoot: f.root, decisionRevision: 0 })).rejects.toThrow();
    const selected = await api.saveChapterReviewDecisions(view.report.id, { expectedWorkspaceRoot: f.root, revision: 0, choices: { [view.report.findings[1]!.id]: 'process' } });
    await expect(api.reviseChapterReview(view.report.id, { expectedWorkspaceRoot: '/other', decisionRevision: 1 })).rejects.toThrow();
    await writeFile(join(f.root, 'world/rules.md'), '# 新规则\n本次依据已经变化。');
    await expect(api.reviseChapterReview(view.report.id, { expectedWorkspaceRoot: f.root, decisionRevision: 1 })).rejects.toThrow('变化');
    expect(model.doGenerateCalls).toHaveLength(1); expect((await api.readChapterReview(view.report.id, f.root)).decisions).toEqual(selected.decisions);
    expect(await readFile(join(f.root, reviewPath), 'utf8')).toBe(reviewText);
  } finally { await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 15_000);
