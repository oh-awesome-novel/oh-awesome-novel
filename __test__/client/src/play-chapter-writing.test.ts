import { expect, it, vi } from 'vite-plus/test';
import { createOanClient } from '@oh-awesome-novel/client';
import { chapterIntent } from '../../core/src/fixtures/play-chapter';
const input = { expectedWorkspaceRoot: '/novel', attachmentId: 'ref-1', lens: 'player' as const, intent: chapterIntent,
  targetPath: 'chapters/0001/0001.md', chapterInventoryHash: 'a'.repeat(64), reportFingerprint: 'b'.repeat(64) };
const preview = { id: 'pa_test', fingerprint: 'c'.repeat(64), targetPath: input.targetPath, attachmentId: input.attachmentId, reportFingerprint: input.reportFingerprint, intent: chapterIntent, diff: '+# 送伞', citedItemIds: ['item-1'] };
function client(events: unknown[]) {
  const fetcher = vi.fn(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }));
  return createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
}
it('parses only a complete, bound progress/preview stream', async () => {
  const output = [];
  for await (const event of client([{ type: 'progress', characters: 0 }, { type: 'preview', preview }]).generatePlayChapter(input)) output.push(event);
  expect(output.at(-1)).toEqual({ type: 'preview', preview });
});
it('rejects late/mismatched previews, extra fields, errors and incomplete streams', async () => {
  const cases = [
    [], [{ type: 'progress', characters: 3 }], [{ type: 'error', message: 'stale source' }],
    [{ type: 'preview', preview: { ...preview, attachmentId: 'other' } }],
    [{ type: 'preview', preview: { ...preview, targetPath: 'chapters/0001/0002.md' } }],
    [{ type: 'preview', preview: { ...preview, intent: { ...chapterIntent, goal: 'different' } } }],
    [{ type: 'preview', preview: { ...preview, internalDraftPath: '/private' } }],
    [{ type: 'preview', preview }, { type: 'preview', preview }],
  ];
  for (const events of cases) await expect(async () => { for await (const _event of client(events).generatePlayChapter(input)) {} }).rejects.toThrow();
});
