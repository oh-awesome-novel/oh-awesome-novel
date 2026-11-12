import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { buildChapterReviewReport, listChapterReviewReports, newChapterReviewId, readChapterReviewDecisions, readChapterReviewReport, saveChapterReviewDecisions, saveChapterReviewReport, selectedChapterReviewFindingIds } from '@oh-awesome-novel/core';
import type { ChapterReviewReport, ChapterReviewView } from '@oh-awesome-novel/core';
import { assertChapterReviewReportFresh, createChapterReviewProposal, prepareChapterReviewSnapshot, readRepositoryBaseline } from '@oh-awesome-novel/tools';
import type { PendingActionStore } from '@oh-awesome-novel/tools';
import type { generateChapterReview, generateChapterReviewRevision } from '@oh-awesome-novel/agent';

export function createChapterReviewHandlers(input: {
  getWorkspaceRoot(): string; getStore(root: string): Promise<PendingActionStore>;
  review(value: Omit<Parameters<typeof generateChapterReview>[0], 'providerConfig' | 'resolveModel'>): Promise<unknown>;
  revise(value: Omit<Parameters<typeof generateChapterReviewRevision>[0], 'providerConfig' | 'resolveModel'>): Promise<unknown>;
}) {
  async function view(root: string, report: ChapterReviewReport): Promise<ChapterReviewView> {
    const decisions = await readChapterReviewDecisions(root, report);
    try { await assertChapterReviewReportFresh(root, report); return { report, decisions, stale: false }; }
    catch (error) { return { report, decisions, stale: true, staleReason: error instanceof Error ? error.message : '来源需要重新检查。' }; }
  }
  async function request(context: Context, keys: string[]) {
    const root = input.getWorkspaceRoot(); const raw = await context.req.text(); if (raw.length > 64_000) throw new Error('审稿请求过长。');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['expectedWorkspaceRoot', ...keys].includes(key))) throw new Error('审稿请求无效。');
    const body = value as Record<string, unknown>; if (body.expectedWorkspaceRoot !== root) throw new Error('工作区已切换，请重新打开报告。');
    return { root, body };
  }
  function current(root: string, context: Context) { if (input.getWorkspaceRoot() !== root || context.req.raw.signal.aborted) throw new Error('请求已取消或工作区已切换。'); }
  return {
    async list(context: Context): Promise<Response> {
      try {
        const { root, body } = await request(context, ['path']);
        if (typeof body.path !== 'string') throw new Error('请选择章稿。');
        const result = await listChapterReviewReports(root, body.path);
        const reports: ChapterReviewView[] = [];
        for (const report of result.reports) reports.push(await view(root, report));
        current(root, context); return context.json({ reports, omittedCount: result.omittedCount });
      } catch (error) { return failure(context, error); }
    },
    async read(context: Context, id: string): Promise<Response> {
      try { const { root } = await request(context, []); const result = await view(root, await readChapterReviewReport(root, id)); current(root, context); return context.json(result); }
      catch (error) { return failure(context, error); }
    },
    async generate(context: Context): Promise<Response> {
      try {
        const { root, body } = await request(context, ['path', 'basisPaths']);
        if (typeof body.path !== 'string') throw new Error('请选择章稿。');
        const snapshot = await prepareChapterReviewSnapshot(root, body.path, body.basisPaths ?? []);
        const response = await input.review({ workspaceRoot: root, path: body.path, content: snapshot.chapter.content, files: snapshot.files, abortSignal: context.req.raw.signal });
        current(root, context);
        const now = await prepareChapterReviewSnapshot(root, body.path, snapshot.basisPaths);
        if (now.contextFingerprint !== snapshot.contextFingerprint) throw new Error('审稿期间来源已变化，请重新审稿。');
        const report = buildChapterReviewReport({ id: newChapterReviewId(), createdAt: new Date().toISOString(), path: body.path, content: snapshot.chapter.content, files: snapshot.files, basisPaths: snapshot.basisPaths, contextFingerprint: snapshot.contextFingerprint, response });
        current(root, context); await saveChapterReviewReport(root, report);
        return context.json(await view(root, report));
      } catch (error) { return failure(context, error); }
    },
    async decide(context: Context, id: string): Promise<Response> {
      try {
        const { root, body } = await request(context, ['revision', 'choices']);
        if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 0) throw new Error('裁决版本无效。');
        const report = await readChapterReviewReport(root, id); current(root, context);
        await saveChapterReviewDecisions(root, report, body.revision as number, body.choices);
        return context.json(await view(root, report));
      } catch (error) { return failure(context, error); }
    },
    async revise(context: Context, id: string): Promise<Response> {
      try {
        const { root, body } = await request(context, ['decisionRevision']);
        const report = await readChapterReviewReport(root, id); const decisions = await readChapterReviewDecisions(root, report);
        if (decisions.revision !== body.decisionRevision) throw new Error('作者裁决已变化。');
        const findingIds = selectedChapterReviewFindingIds(report, decisions);
        if (!findingIds.length) throw new Error('请选择至少一个要处理的问题。');
        const snapshot = await assertChapterReviewReportFresh(root, report);
        const repository = await readRepositoryBaseline(root);
        const replacements = await input.revise({ workspaceRoot: root, report, findingIds, constraints: snapshot.files.filter(file => file.path.startsWith('.oan/constitution/')), abortSignal: context.req.raw.signal });
        current(root, context); await assertChapterReviewReportFresh(root, report);
        if ((await readChapterReviewDecisions(root, report)).revision !== decisions.revision) throw new Error('修订期间作者裁决已变化，请重新生成。');
        const previewId = `pa_${randomUUID()}`;
        const proposal = createChapterReviewProposal({ id: previewId, report, decisions, source: snapshot, replacements, repository });
        if (!proposal) throw new Error('选中段落与原文相同，没有需要审批的修改。');
        const store = await input.getStore(root); current(root, context);
        await store.prepareChangePreview({ id: previewId, candidate: proposal.candidate, origin: proposal.origin, allowedTargets: proposal.allowedTargets });
        current(root, context);
        const pendingAction = await store.promotePreparedChangePreview({ id: previewId, title: '修订选中的审稿问题', description: '只修改明确选择的正文行，其他内容逐字保持；文学意见不构成写作硬门槛。',
          source: { kind: 'deterministic-builder', producer: 'chapter-review', capability: 'chapter.edit' }, origin: proposal.origin, allowedTargets: proposal.allowedTargets });
        return context.json({ pendingAction });
      } catch (error) { return failure(context, error); }
    },
  };
}
function failure(context: Context, error: unknown): Response { return context.json({ error: error instanceof Error ? error.message : '审稿操作失败。' }, 409); }
