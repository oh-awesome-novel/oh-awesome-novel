import { expect, it, vi } from 'vitest';
import { createOanClient, parseTavernImportPreview, parsePendingActionView } from '@oh-awesome-novel/client';
const id = 'pa_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const hash = 'a'.repeat(64);
const targets = ['meta.yaml', 'summary.md', 'personality.md', 'interaction.md', 'lorebook.yaml', 'assets.yaml', 'imports/tavern-card.yaml'].map((name) => `characters/lin/${name}`);
const origin = { kind: 'tavernImport', previewId: id, sourceHash: hash, mappingHash: hash, mode: 'create', characterId: 'lin', baselineFiles: targets.map((path) => ({ path, sha256: null })) };
function preview() { return { preview: { id, fingerprint: hash, sourceName: 'lin.json', sourceHash: hash, displayName: 'Lin', characterId: 'lin', mode: 'create', files: [{ path: targets[0], operation: 'create' }], warnings: [], conflicts: [], diff: '+Lin', canPropose: true } }; }
function pendingAction() { return { id, title: 'Import Lin', description: 'Imported character', status: 'pending', createdAt: '2026-10-07T00:00:00.000Z', changes: [{ path: targets[0], operation: 'create', newHash: hash }], diff: '+Lin', origin }; }
it('sends source/workspace JSON exactly once and promotes only the reviewed preview', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(preview())));
  const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
  const input = { sourceName: 'lin.json', format: 'json' as const, content: '{"name":"Lin"}', mode: 'create' as const, characterId: 'lin', expectedWorkspaceRoot: '/novel' };
  expect(await client.previewTavernImport(input)).toEqual(preview());
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(input);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ pendingAction: pendingAction() })));
  expect((await client.proposeTavernImport(id, { fingerprint: hash, expectedWorkspaceRoot: '/novel' })).pendingAction.origin).toEqual(origin);
  expect(fetcher.mock.calls[1]?.[0]).toBe(`http://test/api/workspace/tavern-imports/${id}/propose`);
});
it('accepts play-only and preserving merge previews, and rejects unsafe targets and source identities', () => {
  expect(parseTavernImportPreview({ preview: { ...preview().preview, id: id.replace('pa_', 'tp_'), mode: 'playOnly', files: [] } }).preview.mode).toBe('playOnly');
  expect(parseTavernImportPreview({ preview: { ...preview().preview, mode: 'merge', conflicts: ['Existing facts preserved.'] } }).preview.canPropose).toBe(true);
  for (const changed of [{ files: [{ path: 'characters/lin/../../outside', operation: 'create' }] }, { files: [{ path: 'characters/other/meta.yaml', operation: 'create' }] }, { sourceName: '../lin.json' }, { sourceHash: 'bad' }, { mode: 'preview' }, { extra: true }]) {
    expect(() => parseTavernImportPreview({ preview: { ...preview().preview, ...changed } })).toThrow();
  }
});
it('requires the exact seven-file origin read set and rejects embedded private fields', () => {
  expect(parsePendingActionView(pendingAction()).origin).toEqual(origin);
  for (const changed of [{ baselineFiles: origin.baselineFiles.slice(1) }, { baselineFiles: origin.baselineFiles.map(() => origin.baselineFiles[0]) }, { baselineFiles: origin.baselineFiles.map((file, index) => index ? file : { ...file, sha256: hash }) }, { mode: 'merge' }, { artifactPath: '/private/draft' }]) {
    expect(() => parsePendingActionView({ ...pendingAction(), origin: { ...origin, ...changed } })).toThrow();
  }
});
it('rejects invalid uploads and mismatched canonical/Play preview kinds before sending', async () => {
  const fetcher = vi.fn(); const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
  await expect(client.previewTavernImport({ sourceName: 'a.png', format: 'png', content: '<html>', mode: 'playOnly', expectedWorkspaceRoot: '/novel' })).rejects.toThrow();
  await expect(client.proposeTavernImport(id.replace('pa_', 'tp_'), { fingerprint: hash, expectedWorkspaceRoot: '/novel' })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
