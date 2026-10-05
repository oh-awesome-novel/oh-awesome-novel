import { describe, expect, it, vi } from 'vitest';
import { createOanClient, parseManuscriptImportPreviewResult, parsePendingActionView } from '@oh-awesome-novel/client';

const id = 'pa_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const hash = 'a'.repeat(64);
const source = '# 第一章 风雪\n归来。\n';
function preview() {
  const bytes = new TextEncoder().encode(source).byteLength;
  return { preview: { id, fingerprint: hash, sourceName: '旧稿.md', sourceHash: hash, sourceBytes: bytes,
    chapters: [{ index: 0, volume: 1, chapter: 1, title: '风雪', path: 'chapters/0001/0001.md', sourceStartLine: 1, sourceEndLine: 2, sourceBytes: bytes }],
    conflicts: [], warnings: [], canPropose: true, diff: '+归来。' } };
}
function proposal() {
  return { pendingAction: { id, title: '导入旧稿', description: 'Create chapters', status: 'pending', createdAt: '2026-10-05T00:00:00.000Z',
    changes: [{ operation: 'create', path: 'chapters/0001/0001.md', newHash: hash }], diff: '+归来。',
    origin: { kind: 'manuscriptImport', previewId: id, sourceHash: hash, mappingHash: hash } } };
}
describe('strict manuscript import client', () => {
  it('sends a bounded source and workspace identity, then promotes exactly the reviewed preview', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(preview())));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    const input = { sourceName: '旧稿.md', text: source, expectedWorkspaceRoot: '/novels/one' };
    expect(await client.previewManuscriptImport(input)).toEqual(preview());
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://test/api/workspace/manuscript/import/preview');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(input);
    fetcher.mockResolvedValue(new Response(JSON.stringify(proposal())));
    expect(await client.proposeManuscriptImport(id, { fingerprint: hash, expectedWorkspaceRoot: '/novels/one' })).toEqual(proposal());
    expect(fetcher.mock.calls[1]?.[0]).toBe(`http://test/api/workspace/manuscript/import/previews/${id}/pending-action`);
  });
  it.each([
    (r: any) => { r.preview.extra = true; },
    (r: any) => { r.preview.content = source; },
    (r: any) => { r.preview.chapters[0].draft = '.workspace/private'; },
    (r: any) => { r.preview.chapters[0].path = '../secret'; },
    (r: any) => { r.preview.chapters[0].volume = 0; },
    (r: any) => { r.preview.chapters[0].chapter = 10_000; },
    (r: any) => { r.preview.chapters[0].index = 1; },
    (r: any) => { r.preview.chapters[0].sourceBytes -= 1; },
    (r: any) => { r.preview.chapters[0].sourceStartLine = 2; },
    (r: any) => { r.preview.chapters[0].sourceEndLine = 0; },
    (r: any) => { r.preview.sourceHash = 'unknown'; },
    (r: any) => { r.preview.id = '../draft'; },
    (r: any) => { r.preview.canPropose = false; },
    (r: any) => { r.preview.conflicts = [{ index: 0, path: 'chapters/0001/0001.md', reason: 'exists' }]; },
    (r: any) => { r.preview.diff = 'a'.repeat(4 * 1024 * 1024 + 1); },
  ])('rejects invalid, incomplete or private preview data', (mutate) => {
    const value = preview(); mutate(value); expect(() => parseManuscriptImportPreviewResult(value)).toThrow();
  });
  it('requires contiguous source coverage and accepts explicit remapping conflicts', () => {
    const first = preview().preview.chapters[0]!;
    const second = { ...first, index: 1, chapter: 2, path: 'chapters/0001/0002.md', sourceStartLine: 3, sourceEndLine: 4 };
    const value = { preview: { ...preview().preview, sourceBytes: first.sourceBytes * 2, chapters: [first, second] } };
    expect(parseManuscriptImportPreviewResult(value)).toEqual(value);
    for (const line of [2, 4]) expect(() => parseManuscriptImportPreviewResult({ preview: { ...value.preview, chapters: [first, { ...second, sourceStartLine: line }] } })).toThrow();
    const conflict = { preview: { ...preview().preview, id: null, fingerprint: null, canPropose: false,
      conflicts: [{ index: 0, path: first.path, reason: 'exists' }] } };
    expect(parseManuscriptImportPreviewResult(conflict)).toEqual(conflict);
  });
  it('rejects unsafe inputs before requesting and mismatched response source or mapping', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(preview())));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    const input = { sourceName: '旧稿.md', text: source, expectedWorkspaceRoot: '/novels/one' };
    await expect(client.previewManuscriptImport({ ...input, text: '字'.repeat(200_000) })).rejects.toThrow();
    await expect(client.previewManuscriptImport({ ...input, sourceName: '../draft.md' })).rejects.toThrow();
    await expect(client.proposeManuscriptImport('../id', { fingerprint: hash, expectedWorkspaceRoot: '/novels/one' })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.previewManuscriptImport({ ...input, sourceName: '另稿.md' })).rejects.toThrow('Mismatched');
    await expect(client.previewManuscriptImport({ ...input, mappings: [{ index: 0, volume: 2, chapter: 1, title: '风雪' }] })).rejects.toThrow('Mismatched');
  });
  it('strictly validates import origins and rejects proposals for another preview or writes outside chapter creation', async () => {
    expect(parsePendingActionView(proposal().pendingAction).origin).toEqual(proposal().pendingAction.origin);
    for (const origin of [
      { ...proposal().pendingAction.origin, text: source },
      { ...proposal().pendingAction.origin, mappingHash: 'bad' },
      { ...proposal().pendingAction.origin, previewId: '../draft' },
    ]) expect(() => parsePendingActionView({ ...proposal().pendingAction, origin })).toThrow();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ pendingAction: { ...proposal().pendingAction, origin: { ...proposal().pendingAction.origin, previewId: 'other' } } })));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    await expect(client.proposeManuscriptImport(id, { fingerprint: hash, expectedWorkspaceRoot: '/novels/one' })).rejects.toThrow('Mismatched');
    fetcher.mockResolvedValue(new Response(JSON.stringify({ pendingAction: { ...proposal().pendingAction, changes: [{ operation: 'create', path: 'world/new.md', newHash: hash }] } })));
    await expect(client.proposeManuscriptImport(id, { fingerprint: hash, expectedWorkspaceRoot: '/novels/one' })).rejects.toThrow('Mismatched');
  });
});
