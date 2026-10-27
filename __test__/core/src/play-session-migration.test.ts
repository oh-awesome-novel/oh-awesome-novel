import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { addPlayTranscriptTurn, confirmPlaySessionMigration, previewPlaySessionMigration, readPlaySessionFiles, writePlaySessionFiles } from '@oh-awesome-novel/core';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function legacy() {
  const root = await mkdtemp(join(tmpdir(), 'oan-migration-confirm-')); roots.push(root);
  const directory = join(root, '.workspace/play-sessions/legacy'); await mkdir(directory, { recursive: true });
  const path = join(directory, 'session.yaml');
  const bytes = 'schemaVersion: 2\nid: legacy\ntitle: Old session\ncreatedAt: 2026-06-19T00:00:00.000Z\nsceneStart: Station\ncharacters: []\ntranscript: []\ncustomField: preserve\n';
  await writeFile(path, bytes);
  return { root, directory, path, bytes };
}
it('keeps preview read-only and requires explicit approval before any ordinary mutation', async () => {
  const f = await legacy();
  const preview = (await previewPlaySessionMigration(f.root, 'legacy'))!;
  const session = await readPlaySessionFiles(f.root, 'legacy');
  await expect(writePlaySessionFiles(f.root, session)).rejects.toThrow('explicit migration');
  await expect(writePlaySessionFiles(f.root, addPlayTranscriptTurn(session, { speaker: 'user', content: 'Hello' }), { migrationConfirmation: preview })).rejects.toThrow('cannot be combined');
  expect(await readFile(f.path, 'utf8')).toBe(f.bytes);
  await confirmPlaySessionMigration(f.root, 'legacy', preview);
  expect(await readFile(join(f.directory, preview.backupRelativePath, 'session.yaml'), 'utf8')).toBe(f.bytes);
  expect(await readFile(f.path, 'utf8')).toContain('schemaVersion: 4');
  await expect(confirmPlaySessionMigration(f.root, 'legacy', preview)).rejects.toThrow('no longer requires');
});
it('rejects a stale byte fingerprint even when revision and parsed content are unchanged', async () => {
  const f = await legacy();
  const preview = (await previewPlaySessionMigration(f.root, 'legacy'))!;
  await writeFile(f.path, f.bytes + '\n# changed after review\n');
  await expect(confirmPlaySessionMigration(f.root, 'legacy', preview)).rejects.toThrow('stale');
  expect(await readFile(f.path, 'utf8')).toContain('schemaVersion: 2');
});
