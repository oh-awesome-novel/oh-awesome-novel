import { expect, it, vi } from 'vite-plus/test';
import { createOanClient, parsePlayMigrationPreview } from '@oh-awesome-novel/client';
const preview = { sessionId: 'legacy', baseRevision: 0, sourceFingerprint: 'a'.repeat(64), fromSchemaVersion: 2, toSchemaVersion: 4, unknownMetadataKeys: [], legacyTranscriptCount: 0, projectedTurnCount: 0, generatedTurnIds: [], backupRelativePath: '.migrations/v2-to-v4/original' };
it('strictly validates migration identity, fingerprint, counts and backup path', () => {
  expect(parsePlayMigrationPreview({ preview }, 'legacy')).toEqual({ preview });
  expect(parsePlayMigrationPreview({ preview: null }, 'legacy')).toEqual({ preview: null });
  for (const changed of [{ sessionId: 'other' }, { baseRevision: -1 }, { sourceFingerprint: 'bad' }, { backupRelativePath: '../escape' }, { projectedTurnCount: 2 }, { extra: true }]) {
    expect(() => parsePlayMigrationPreview({ preview: { ...preview, ...changed } }, 'legacy')).toThrow('Invalid');
  }
});
it('posts explicit confirmation as an object and retains the reviewed fingerprint', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 409 }));
  const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
  const input = { confirmed: true as const, baseRevision: 0, sourceFingerprint: preview.sourceFingerprint };
  await expect(client.confirmPlaySessionMigration('legacy', input)).rejects.toThrow();
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(input);
  expect(fetcher.mock.calls[0]?.[0]).toBe('http://test/api/workspace/play-sessions/legacy/migration');
});
