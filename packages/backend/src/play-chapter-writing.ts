import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { normalizePlayChapterIntent } from '@oh-awesome-novel/core';
import { assertPlayChapterWritingFresh, createPlayChapterWritingProposal, preparePlayChapterWritingInput, readRepositoryBaseline, PLAY_CHAPTER_WRITING_PRODUCER } from '@oh-awesome-novel/tools';
import type { PendingActionStore } from '@oh-awesome-novel/tools';
import type { generatePlayChapterDraft } from '@oh-awesome-novel/agent';

export function createPlayChapterWritingHandlers(input: {
  getWorkspaceRoot(): string;
  getStore(root: string): Promise<PendingActionStore>;
  generate(value: Omit<Parameters<typeof generatePlayChapterDraft>[0], 'providerConfig' | 'resolveModel'>): ReturnType<typeof generatePlayChapterDraft>;
}) {
  const assertCurrent = (root: string, expected: unknown) => {
    if (root !== expected || input.getWorkspaceRoot() !== root) throw new Error('工作区已切换，请重新选择转写素材。');
  };
  async function source(context: Context, reviewedTarget = false) {
    const root = input.getWorkspaceRoot();
    const body = await request(context, ['expectedWorkspaceRoot', 'attachmentId', 'lens', 'intent', ...(reviewedTarget ? ['targetPath', 'chapterInventoryHash', 'reportFingerprint'] : [])]);
    assertCurrent(root, body.expectedWorkspaceRoot);
    if (typeof body.attachmentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(body.attachmentId)) throw new Error('写作参考标识无效。');
    const source = await preparePlayChapterWritingInput(root, body.attachmentId, body.lens as 'player' | 'director', body.intent);
    if (reviewedTarget && (body.targetPath !== source.binding.targetPath || body.chapterInventoryHash !== source.binding.chapterInventoryHash || body.reportFingerprint !== source.binding.reportFingerprint)) throw new Error('章节目标或所选报告已变化，请重新查看目标后生成。');
    assertCurrent(root, body.expectedWorkspaceRoot);
    return { root, source };
  }
  return {
    async target(context: Context): Promise<Response> {
      try {
        const { root, source: prepared } = await source(context);
        assertCurrent(root, root);
        return context.json({ targetPath: prepared.binding.targetPath, chapterInventoryHash: prepared.binding.chapterInventoryHash,
          reportFingerprint: prepared.binding.reportFingerprint, items: prepared.items, range: prepared.range });
      } catch (error) { return failure(context, error); }
    },
    async generate(context: Context): Promise<Response> {
      let prepared: Awaited<ReturnType<typeof source>>;
      try { prepared = await source(context, true); } catch (error) { return failure(context, error); }
      const { root, source: frozen } = prepared;
      const repository = await readRepositoryBaseline(root);
      return streamSSE(context, async stream => {
        const controller = new AbortController();
        stream.onAbort(() => controller.abort());
        try {
          await stream.writeSSE({ data: JSON.stringify({ type: 'progress', characters: 0 }) });
          let sent = 0;
          const draft = await input.generate({ workspaceRoot: root, targetPath: frozen.binding.targetPath, intent: frozen.binding.intent,
            items: frozen.items, context: frozen.context, abortSignal: AbortSignal.any([controller.signal, context.req.raw.signal]),
            onProgress: async characters => {
              if (characters - sent >= 512) { sent = characters; await stream.writeSSE({ data: JSON.stringify({ type: 'progress', characters }) }); }
            },
          });
          if (controller.signal.aborted || context.req.raw.signal.aborted) throw new Error('已取消转写。');
          assertCurrent(root, root);
          const now = await preparePlayChapterWritingInput(root, frozen.binding.attachmentId, frozen.binding.lens, frozen.binding.intent);
          if (!isDeepStrictEqual(now.binding, frozen.binding) || !isDeepStrictEqual(await readRepositoryBaseline(root), repository)) throw new Error('生成期间素材、小说上下文或 Git 基线已变化，请重新生成。');
          const id = `pa_${randomUUID()}`;
          const proposal = createPlayChapterWritingProposal({ source: frozen, draft, id, repository });
          const store = await input.getStore(root);
          assertCurrent(root, root);
          if (controller.signal.aborted) throw new Error('已取消转写。');
          const preview = await store.prepareChangePreview({ id, candidate: proposal.candidate, origin: proposal.origin, allowedTargets: proposal.allowedTargets });
          assertCurrent(root, root);
          await stream.writeSSE({ data: JSON.stringify({ type: 'preview', preview: {
            id, fingerprint: preview.candidateFingerprint, targetPath: frozen.binding.targetPath, attachmentId: frozen.binding.attachmentId,
            reportFingerprint: frozen.binding.reportFingerprint, intent: frozen.binding.intent, diff: preview.preview.diff,
            citedItemIds: [...new Set(draft.paragraphs.flatMap(paragraph => paragraph.sourceItemIds))],
          } }) });
        } catch (error) {
          if (!controller.signal.aborted) await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : '转写失败，请重试。' }) });
        }
      });
    },
    async propose(context: Context, id: string): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        const body = await request(context, ['expectedWorkspaceRoot', 'fingerprint', 'intent']);
        assertCurrent(root, body.expectedWorkspaceRoot);
        if (!/^pa_[0-9a-f-]{36}$/u.test(id)) throw new Error('转写预览标识无效。');
        const store = await input.getStore(root);
        const preview = await store.readPreparedChangePreview(id);
        if (preview.origin.kind !== 'playChapterWriting' || preview.candidateFingerprint !== body.fingerprint ||
          !isDeepStrictEqual(preview.origin.intent, normalizePlayChapterIntent(body.intent))) throw new Error('转写要求或预览已变化，请重新生成。');
        await assertPlayChapterWritingFresh(root, preview);
        assertCurrent(root, body.expectedWorkspaceRoot);
        if (context.req.raw.signal.aborted) throw new Error('已取消。');
        const pendingAction = await store.promotePreparedChangePreview({ id, title: '将选中推演写成下一章',
          description: '只创建一章；正文基于作者选中的素材与转写要求。请审阅差异，保存后可显式整理本章。',
          source: { kind: 'deterministic-builder', producer: PLAY_CHAPTER_WRITING_PRODUCER, capability: 'chapter.edit' },
          origin: preview.origin, allowedTargets: preview.allowedTargets });
        return context.json({ pendingAction });
      } catch (error) { return failure(context, error); }
    },
  };
}
async function request(context: Context, keys: string[]): Promise<Record<string, unknown>> {
  const raw = await context.req.text();
  if (raw.length > 16_384) throw new Error('转写请求过长。');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error('转写请求含未知或缺失字段。');
  return value as Record<string, unknown>;
}
function failure(context: Context, error: unknown): Response {
  return context.json({ error: error instanceof Error ? error.message : '转写请求失败。' }, 409);
}
