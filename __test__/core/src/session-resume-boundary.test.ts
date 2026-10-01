import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSessionResumeBoundary, readSessionResumeBoundary, writeSessionRunMetadata } from '@oh-awesome-novel/core';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const boundary = { sessionId: 'resume', capturedAt: '2026-10-01T00:00:00Z', touchedFiles: [{ path: 'chapters/0001/0001.md', hash: 'a'.repeat(64), missing: false, mtimeMs: 1 }] };
async function create() {
 const root = await mkdtemp(join(tmpdir(), 'oan-boundary-')); roots.push(root);
 await writeSessionRunMetadata(root, { sessionId: 'resume', status: 'completed', startedAt: boundary.capturedAt, updatedAt: boundary.capturedAt, inputSources: [], touchedFiles: [], resumeBoundary: boundary });
 return root;
}
describe('bounded resume metadata', () => {
 it('reads saved evidence and compares content hashes without host reads or mtime-only drift', async () => {
  const root = await create();
  expect(await readSessionResumeBoundary(root, 'resume')).toEqual(boundary);
  expect(await checkSessionResumeBoundary('/does-not-exist', boundary, [{ path: boundary.touchedFiles[0].path, hash: 'a'.repeat(64) }])).toMatchObject({ changedFiles: [], missingFiles: [] });
 });
 it('rejects symlinked and oversized metadata', async () => {
  const root = await create(); const file = join(root, '.workspace/sessions/resume/run.yaml');
  await writeFile(file, 'x'.repeat(1_048_577));
  await expect(readSessionResumeBoundary(root, 'resume')).rejects.toThrow('Unsafe');
  await rm(file); await symlink(join(root, 'elsewhere'), file);
  await expect(readSessionResumeBoundary(root, 'resume')).rejects.toThrow('Unsafe');
 });
 it('rejects control characters and traversal in saved paths', async () => {
  const root = await create();
  for (const path of ['chapters/unsafe\npath.md', '../elsewhere']) {
   await writeSessionRunMetadata(root, { sessionId: 'resume', status: 'completed', startedAt: boundary.capturedAt, updatedAt: boundary.capturedAt, inputSources: [], touchedFiles: [], resumeBoundary: { ...boundary, touchedFiles: [{ path, hash: 'a'.repeat(64), missing: false }] } });
   await expect(readSessionResumeBoundary(root, 'resume')).rejects.toThrow();
  }
 });
 it('does not report a still-uncreated candidate as a deletion', async () => {
  expect(await checkSessionResumeBoundary('/unused', { ...boundary, touchedFiles: [{ path: 'chapters/new.md', missing: true }] }, [])).toMatchObject({ changedFiles: [], missingFiles: [] });
 });
});
