import { describe, expect, it, vi } from 'vitest';
import { createOanClient, parseWorkspaceSearchResponse, parseManuscriptExport } from '@oh-awesome-novel/client';
const search = () => ({ schemaVersion: 1, query: '风雪', scannedAt: '2026-10-01T00:00:00.000Z', scannedFiles: 1, sourceFingerprint: 'a'.repeat(64), truncated: false,
  results: [{ path: 'chapters/0001/0001.md', name: '0001.md', domain: 'chapters', line: 2, snippet: '风雪', matchedField: 'content' }] });
const manuscript = () => ({ schemaVersion: 1, format: 'md', fileName: 'manuscript-2026-10-01T00-00-00-000Z.md', content: '# 风雪\n', chapterPaths: ['chapters/0001/0001.md'], generatedAt: '2026-10-01T00:00:00.000Z', sourceFingerprint: 'b'.repeat(64) });
describe('strict workspace text client', () => {
  it('routes UTF-8 queries and explicit export formats and validates responses', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes('/search?') ? search() : manuscript())));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    expect(await client.searchWorkspace('风雪')).toEqual(search());
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://test/api/workspace/search?q=%E9%A3%8E%E9%9B%AA');
    expect(await client.exportManuscript('md')).toEqual(manuscript());
    expect(fetcher.mock.calls[1]?.[0]).toBe('http://test/api/workspace/manuscript/export?format=md');
  });
  it.each([
    (r: any) => { r.extra = true; }, (r: any) => { r.results[0].line = 0; },
    (r: any) => { r.results[0].path = '.workspace/secret.md'; }, (r: any) => { r.results[0].path = 'world/../../secret.md'; },
    (r: any) => { r.results[0].name = 'wrong.md'; }, (r: any) => { r.results.push(r.results[0]); r.scannedFiles = 2; },
    (r: any) => { r.scannedAt = 'yesterday'; }, (r: any) => { r.sourceFingerprint = 'unknown'; },
    (r: any) => { r.results[0].snippet = 'a'.repeat(485); },
  ])('rejects malformed search data', (mutate) => { const response = search(); mutate(response); expect(() => parseWorkspaceSearchResponse(response)).toThrow(); });
  it.each([
    (r: any) => { r.fileName = '../overwrite.md'; }, (r: any) => { r.chapterPaths = ['chapters/0001/0000.md']; },
    (r: any) => { r.chapterPaths = ['chapters/0001/0002.md', 'chapters/0001/0001.md']; },
    (r: any) => { r.format = 'pdf'; }, (r: any) => { r.content = null; }, (r: any) => { r.overwrite = true; },
  ])('rejects unsafe download data', (mutate) => { const response = manuscript(); mutate(response); expect(() => parseManuscriptExport(response)).toThrow(); });
});
