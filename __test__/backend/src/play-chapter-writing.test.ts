import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { chapterModel } from '../../agent/src/fixtures/play-chapter-model';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import { chapterIntent, playChapterFixture } from '../../core/src/fixtures/play-chapter';

it.each([false, true])('generates via default SDK/SSE, binds intent, restarts and Accepts one chapter (existing=%s)', async existing => {
  const f = await playChapterFixture(false, existing); let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const model = chapterModel();
    backend = await startNovelHttpBackend({ workspaceRoot: f.root, globalConfigDir: join(f.root, 'global'), providerConfig: { id: 'controlled', kind: 'custom', model: 'controlled', baseUrl: 'https://provider.example/v1' }, resolveModel: () => model });
    let client = createOanClient({ backendBaseUrl: backend.url });
    const request = { expectedWorkspaceRoot: f.root, attachmentId: f.attachment.id, lens: 'player' as const, intent: chapterIntent };
    const target = await client.getPlayChapterTarget(request); let preview;
    for await (const event of client.generatePlayChapter({ ...request, targetPath: target.targetPath, chapterInventoryHash: target.chapterInventoryHash, reportFingerprint: target.reportFingerprint })) if (event.type === 'preview') preview = event.preview;
    expect(preview?.diff).toContain('雨夜送伞');
    const prompt = JSON.stringify(model.doStreamCalls);
    for (const secret of ['HIDDEN_ONLY', 'SIBLING_ONLY', 'RAW_TRANSCRIPT_ONLY', 'DIRECTOR_REASON_ONLY']) expect(prompt).not.toContain(secret);
    expect(prompt).toContain(chapterIntent.goal);
    if (existing) expect(prompt).toContain('她来到车站');
    await expect(readFile(join(f.root, target.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(client.proposePlayChapter(preview!.id, { expectedWorkspaceRoot: f.root, fingerprint: preview!.fingerprint, intent: { ...chapterIntent, goal: '新目标' } })).rejects.toThrow();
    const { pendingAction } = await client.proposePlayChapter(preview!.id, { expectedWorkspaceRoot: f.root, fingerprint: preview!.fingerprint, intent: chapterIntent });
    await backend.close(); backend = await startNovelHttpBackend({ workspaceRoot: f.root }); client = createOanClient({ backendBaseUrl: backend.url });
    const accepted = await client.acceptPendingAction(pendingAction.id);
    expect(accepted.pendingAction.status).toBe('accepted');
    expect(await readFile(join(f.root, target.targetPath), 'utf8')).toContain('她把伞递了过去');
  } finally { await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 15_000);
it('cancels a real generation without a PendingAction or canonical chapter', async () => {
  const f = await playChapterFixture(); let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    backend = await startNovelHttpBackend({ workspaceRoot: f.root, globalConfigDir: join(f.root, 'global'), providerConfig: { id: 'controlled', kind: 'custom', model: 'controlled', baseUrl: 'https://provider.example/v1' }, resolveModel: () => chapterModel() });
    const client = createOanClient({ backendBaseUrl: backend.url });
    const request = { expectedWorkspaceRoot: f.root, attachmentId: f.attachment.id, lens: 'player' as const, intent: chapterIntent };
    const target = await client.getPlayChapterTarget(request); const controller = new AbortController();
    for await (const _event of client.generatePlayChapter({ ...request, targetPath: target.targetPath, chapterInventoryHash: target.chapterInventoryHash, reportFingerprint: target.reportFingerprint }, controller.signal)) { controller.abort(); break; }
    expect((await client.listPendingActions()).pendingActions).toEqual([]);
    await expect(readFile(join(f.root, target.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
}, 15_000);
it('does not silently move to a different chapter slot after the target was reviewed', async () => {
  const f = await playChapterFixture(); let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const model = chapterModel(); backend = await startNovelHttpBackend({ workspaceRoot: f.root, resolveModel: () => model });
    const client = createOanClient({ backendBaseUrl: backend.url });
    const request = { expectedWorkspaceRoot: f.root, attachmentId: f.attachment.id, lens: 'player' as const, intent: chapterIntent };
    const target = await client.getPlayChapterTarget(request);
    await mkdir(join(f.root, 'chapters/0001'), { recursive: true }); await writeFile(join(f.root, target.targetPath), '# 作者新章\n\n自己写的正文。');
    await expect(async () => { for await (const _event of client.generatePlayChapter({ ...request, targetPath: target.targetPath, chapterInventoryHash: target.chapterInventoryHash, reportFingerprint: target.reportFingerprint })) {} }).rejects.toThrow('目标');
    expect(model.doStreamCalls).toHaveLength(0);
    await expect(readFile(join(f.root, 'chapters/0001/0002.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await backend?.close(); await rm(f.root, { recursive: true, force: true }); }
});
