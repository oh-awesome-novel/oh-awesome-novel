import { describe, expect, it, vi } from 'vitest';
import { createOanClient } from '@oh-awesome-novel/client';
const preview = { id: 'git_00000000-0000-4000-8000-000000000000', fingerprint: 'a'.repeat(64), files: ['中文.md'], head: 'b'.repeat(40), expiresAt: '2030-01-01T00:00:00.000Z' };
describe('reviewed Git client contract', () => {
  it('sends the reviewed credential and preserves committed index warnings', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).includes('/diff') ? { diff: '+reviewed', preview } : {
      status: 'committed', hash: 'c'.repeat(40), message: 'reviewed', warning: { code: 'index_recovery_required', message: 'Commit saved; repair index' },
    })));
    const api = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    expect(await api.getGitDiff(['中文.md'])).toEqual({ diff: '+reviewed', preview });
    expect(await api.quickCommit({ files: preview.files, message: 'reviewed', previewId: preview.id, previewFingerprint: preview.fingerprint })).toMatchObject({ warning: { code: 'index_recovery_required' } });
    expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ previewId: preview.id, previewFingerprint: preview.fingerprint });
  });
  it.each([
    { diff: '+text' }, { diff: '+text', preview: null }, { diff: '+text', preview: { ...preview, tree: 'untrusted' } },
    { diff: '+text', preview: { ...preview, files: ['../outside.md'] } }, { diff: '+text', preview: { ...preview, fingerprint: 'invalid' } },
    { diff: '+text', preview: { ...preview, head: 'b'.repeat(41) } },
  ])('rejects malformed or unbound preview %#', async (value) => {
    const api = createOanClient({ backendBaseUrl: 'http://test', fetch: async () => new Response(JSON.stringify(value)) });
    await expect(api.getGitDiff()).rejects.toThrow(/Invalid reviewed/u);
  });
  it('rejects commit requests without an exact reviewed credential before sending HTTP', async () => {
    const fetcher = vi.fn(); const api = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    await expect(api.quickCommit({ files: ['中文.md'], message: 'unreviewed' } as Parameters<typeof api.quickCommit>[0])).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ status: 'committed' }, { status: 'committed', hash: 'c'.repeat(41), message: 'saved' }, { status: 'committed', hash: 'c'.repeat(40), message: 'saved', warning: { code: 'unknown', message: 'bad' } }])('rejects malformed success instead of reporting a completed commit', async (response) => {
    const api = createOanClient({ backendBaseUrl: 'http://test', fetch: async () => new Response(JSON.stringify(response)) });
    await expect(api.quickCommit({ files: preview.files, message: 'reviewed', previewId: preview.id, previewFingerprint: preview.fingerprint })).rejects.toThrow(/Invalid reviewed/u);
  });
});
