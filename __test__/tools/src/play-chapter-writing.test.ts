import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { createPlayWritingReferenceAttachment, detachPlayWritingReferenceAttachment, readPlaySessionFiles, restorePlaySessionCheckpoint, settlePlayWorldSettlementRetry, writePlaySessionFiles } from '@oh-awesome-novel/core';
import { assertPlayChapterWritingFresh, createChangeMaterializer, createPendingActionStore, createPlayChapterWritingProposal, parsePendingAction, preparePlayChapterWritingInput, readRepositoryBaseline } from '@oh-awesome-novel/tools';
import { chapterIntent, playChapterFixture } from '../../core/src/fixtures/play-chapter';
async function proposal(root: string) {
  const source = await preparePlayChapterWritingInput(root, 'chapter-ref', 'player', chapterIntent);
  const change = createPlayChapterWritingProposal({ source, id: 'pa_chapter', repository: await readRepositoryBaseline(root), draft: { title: '雨夜', paragraphs: [{ text: '她递出伞，两人在雨声里建立了信任。', sourceItemIds: source.items.map(item => item.id) }] } });
  const store = await createPendingActionStore({ workspaceRoot: root, assertOriginFresh: ({ preview }) => assertPlayChapterWritingFresh(root, preview) });
  const preview = await store.prepareChangePreview({ id: 'pa_chapter', candidate: change.candidate, origin: change.origin, allowedTargets: change.allowedTargets });
  const pending = await store.promotePreparedChangePreview({ id: preview.id, title: '雨夜', description: '转写', source: { kind: 'deterministic-builder', producer: 'play-chapter-writing', capability: 'chapter.edit' }, origin: preview.origin, allowedTargets: preview.allowedTargets });
  return { store, pending, source, preview };
}
it.each([false, true])('creates a single chapter only after Accept and honors autoCommit=%s', async autoCommit => {
  const f = await playChapterFixture(autoCommit, autoCommit);
  try {
    const { store, pending, source } = await proposal(f.root);
    const path = autoCommit ? 'chapters/0001/0002.md' : 'chapters/0001/0001.md';
    expect(source.binding.targetPath).toBe(path);
    await expect(readFile(join(f.root, path))).rejects.toMatchObject({ code: 'ENOENT' });
    const before = (await f.git('git', ['-C', f.root, 'rev-parse', 'HEAD'])).stdout;
    // Reopened store and permissive hook: the materializer still owns input revalidation.
    const reopened = await createPendingActionStore({ workspaceRoot: f.root });
    const materializer = createChangeMaterializer({ store: reopened, assertOriginFresh: async () => {} });
    const result = await materializer.accept({ actionId: pending.id, autoCommitOnAccept: autoCommit });
    expect(result.action.status).toBe('accepted');
    expect(await readFile(join(f.root, path), 'utf8')).toContain('她递出伞');
    const after = (await f.git('git', ['-C', f.root, 'rev-parse', 'HEAD'])).stdout;
    expect(after === before).toBe(!autoCommit);
    const action = await store.readAction(pending.id);
    expect(() => parsePendingAction({ ...action, source: { ...action.source, producer: 'other' } })).toThrow();
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it.each(['detach', 'source', 'context', 'slot', 'restore', 'retry'])('refuses stale %s evidence after restart before any canonical write', async reason => {
  const f = await playChapterFixture();
  try {
    const { pending, source } = await proposal(f.root);
    if (reason === 'detach') await detachPlayWritingReferenceAttachment(f.root, f.attachment.id);
    if (reason === 'source') await writeFile(join(f.root, 'world/rules.md'), '# Changed\nchanged');
    if (reason === 'context') { await mkdir(join(f.root, 'outline')); await writeFile(join(f.root, 'outline/main.md'), '# 新大纲\n另有安排'); }
    if (reason === 'slot') { await mkdir(join(f.root, 'chapters/0002'), { recursive: true }); await writeFile(join(f.root, 'chapters/0002/0001.md'), '# 另一卷\n已有章节'); }
    if (reason === 'restore') {
      const current = await readPlaySessionFiles(f.root, f.session.id);
      await writePlaySessionFiles(f.root, restorePlaySessionCheckpoint(current, 'initial-world'), { expectedRevision: current.revision });
    }
    if (reason === 'retry') {
      const current = await readPlaySessionFiles(f.root, f.session.id);
      const retried = settlePlayWorldSettlementRetry({ session: current, sourceArtifactId: current.selectedTurnIds.at(-1)!, expectedSessionRevision: current.revision,
        refereeResponse: '另一结果\n```oan-play-settlement\n{"events":[],"stateDelta":{},"observations":[],"suggestedActions":[]}\n```' }).session;
      await writePlaySessionFiles(f.root, retried, { expectedRevision: current.revision });
    }
    const store = await createPendingActionStore({ workspaceRoot: f.root });
    const materializer = createChangeMaterializer({ store, assertOriginFresh: async () => {} });
    await expect(materializer.accept({ actionId: pending.id, autoCommitOnAccept: false })).rejects.toThrow();
    await expect(readFile(join(f.root, source.binding.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it('excludes siblings, raw transcript and unselected hidden material; Reject never writes the chapter', async () => {
  const f = await playChapterFixture();
  try {
    const { pending, source, store } = await proposal(f.root);
    const input = JSON.stringify({ items: source.items, context: source.context });
    for (const secret of ['SIBLING_ONLY', 'HIDDEN_ONLY', 'RAW_TRANSCRIPT_ONLY', 'DIRECTOR_REASON_ONLY']) expect(input).not.toContain(secret);
    const hidden = f.report.items.find(item => item.visibility === 'playerUnknown')!;
    await createPlayWritingReferenceAttachment(f.root, { id: 'hidden-ref', sessionId: f.session.id, selectedOutcomeItemRefs: [hidden.id] });
    await expect(preparePlayChapterWritingInput(f.root, 'hidden-ref', 'player', chapterIntent)).rejects.toThrow('隐藏');
    await createChangeMaterializer({ store, assertOriginFresh: async () => {} }).reject({ actionId: pending.id });
    await expect(readFile(join(f.root, source.binding.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
