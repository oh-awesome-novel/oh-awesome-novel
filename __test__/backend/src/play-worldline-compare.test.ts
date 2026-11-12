import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
import { comparePlayWorldlines, createPlaySessionDraft, restorePlaySessionCheckpoint, settlePlayWorldRefereeResponse, writePlaySessionFiles } from '@oh-awesome-novel/core';

async function manifest(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const result: Record<string, string> = {};
  for (const entry of entries.filter(e => e.isFile())) {
    const path = join(entry.parentPath, entry.name);
    result[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return result;
}
it('HTTP/client comparison is deterministic, survives restart, and leaves every session file byte unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oan-worldline-http-'));
  let backend: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    await mkdir(join(root, '.oan')); await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
    const first = settlePlayWorldRefereeResponse({ session: createPlaySessionDraft({ id: 'compare', title: '比较', sceneStart: '路口', characters: [] }),
      actionKind: 'do', userText: '往左', refereeResponse: '向左\n```oan-play-settlement\n{"events":[],"stateDelta":{"scene":"left"},"observations":[],"suggestedActions":[]}\n```' });
    const fork = settlePlayWorldRefereeResponse({ session: restorePlaySessionCheckpoint(first, 'initial-world'),
      actionKind: 'do', userText: '往右', refereeResponse: '向右\n```oan-play-settlement\n{"events":[],"stateDelta":{"scene":"right"},"observations":[],"suggestedActions":[]}\n```' });
    await writePlaySessionFiles(root, fork, { expectedAbsent: true });
    const sessionRoot = join(root, '.workspace/play-sessions/compare');
    const before = await manifest(sessionRoot);
    const query = { left: 'turn-artifact-1', right: 'turn-artifact-3', lens: 'player' as const };
    const expected = comparePlayWorldlines(fork, query);
    for (let i = 0; i < 2; i++) {
      backend = await startNovelHttpBackend({ workspaceRoot: root });
      const api = createOanClient({ backendBaseUrl: backend.url });
      expect(await api.comparePlayWorldlines('compare', query)).toEqual(expected);
      expect(await manifest(sessionRoot)).toEqual(before);
      const bad = await fetch(`${backend.url}/api/workspace/play-sessions/compare/worldline-comparison?left=initial-world&right=turn-artifact-3&lens=other`);
      expect(bad.status).toBe(400);
      await expect(api.comparePlayWorldlines('compare', { ...query, right: 'missing' })).rejects.toThrow();
      expect(await manifest(sessionRoot)).toEqual(before);
      await backend.close(); backend = undefined;
    }
  } finally { await backend?.close(); await rm(root, { recursive: true, force: true }); }
});
