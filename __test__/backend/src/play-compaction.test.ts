import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { PlaySession } from '@oh-awesome-novel/core';
describe('Play compaction HTTP flow', () => {
  it('previews, reloads, continues with state and rejects a stale revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-compaction-http-'));
    await mkdir(join(root, '.oan'), { recursive: true }); await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
    const backend = await startNovelHttpBackend({ workspaceRoot: root, runPlayTurn: async ({ session, request }) => {
      if (request.includes('五维剧情存档')) return `<剧情存档>${JSON.stringify({ version: 1, turnsCovered: session.selectedTurnIds.length, characters: [], chronicle: ['The gate remains closed.'], unresolvedThreads: [], currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' }, voiceAndStyle: { pov: 'Third person', rhythm: 'Slow', tonePoints: ['Quiet'] }, resourceState: session.playLocalState })}</剧情存档>`;
      return 'The gate remains closed.\n```oan-play-settlement\n' + JSON.stringify({ events: [], stateDelta: { medicine: 0 }, observations: [], suggestedActions: [] }) + '\n```';
    } });
    const post = async (path: string, body: unknown) => { const response = await fetch(`${backend.url}/api/workspace/play-sessions${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as { session: PlaySession; preview?: unknown; error?: string } }; };
    try {
      const created = await post('', { id: 'archive-http', title: 'Archive', sceneStart: 'Gate', characters: [] }); expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect((await post('/archive-http/world-referee-turn', { userText: 'Wait', baseRevision: 0 })).status).toBe(200);
      const preview = await post('/archive-http/compact', { baseRevision: 1 }); expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      const reloaded = await fetch(`${backend.url}/api/workspace/play-sessions/archive-http`).then(r => r.json()) as {session:PlaySession};
      expect(reloaded.session.metadataExtensions.playCompactionPreview).toBeTruthy();
      const continued = await post('/archive-http/compact/continue', { baseRevision: 1 }); expect(continued.status, JSON.stringify(continued.body)).toBe(200);
      expect(continued.body.session.id).not.toBe('archive-http');
      expect((await post('/archive-http/compact/continue', { baseRevision: 1 })).body.session.id).toBe(continued.body.session.id);
      expect(continued.body.session.metadataExtensions.frozenSystemPrompt).toBe(created.body.session.metadataExtensions.frozenSystemPrompt);
      expect(continued.body.session.playLocalState.medicine).toBe(0);
      expect((await post('/archive-http/world-referee-turn', { userText: 'Again', baseRevision: 1 })).status).toBe(200);
      expect((await post('/archive-http/compact/continue', { baseRevision: 1 })).status).toBe(409);
      expect((await post('/archive-http/compact/continue', { baseRevision: 2 })).status).toBe(422);
    } finally { await backend.close(); await rm(root, { recursive: true, force: true }); }
  });
});

describe('frozen permanent context safety', () => {
  it('rejects linked constitution/profile sources instead of freezing outside bytes', async () => {
    const { freezePlayPermanentContext } = await import('@oh-awesome-novel/backend');
    const { createPlaySessionDraft } = await import('@oh-awesome-novel/core');
    const { symlink, link } = await import('node:fs/promises');
    const root = await mkdtemp(join(tmpdir(), 'oan-prefix-links-'));
    try {
      await mkdir(join(root, 'world')); await writeFile(join(root, 'source.md'), 'source');
      await symlink(join(root, 'source.md'), join(root, 'world/rules.md'));
      const s = createPlaySessionDraft({ id: 'safe', title: 'Safe', sceneStart: 'Gate', characters: [] });
      await expect(freezePlayPermanentContext(root, s)).rejects.toThrow('links are forbidden');
      await rm(join(root, 'world/rules.md')); await link(join(root, 'source.md'), join(root, 'world/rules.md'));
      await expect(freezePlayPermanentContext(root, s)).rejects.toThrow('links are forbidden');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
