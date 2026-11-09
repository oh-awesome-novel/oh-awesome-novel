import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vite-plus/test';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import { readPlaySessionFiles, writePlaySessionFiles } from '@oh-awesome-novel/core';
import { longSession } from '../../core/src/fixtures/long-play-phase';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(count: number) {
  const root = await mkdtemp(join(tmpdir(), 'oan-phase-api-')); roots.push(root);
  await mkdir(join(root, '.oan')); await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Phase\n');
  const session = longSession(count);
  await mkdir(join(root, 'world'));
  await writeFile(join(root, 'world/rules.md'), 'rules');
  session.activatedSources = [{ sourceId: 'rules', role: 'world', reason: 'fixture', budgetLayer: 'L1', semanticBoundary: 'protected', trust: 'canonical', path: 'world/rules.md',
    contentHash: createHash('sha256').update('rules').digest('hex') }];
  await writePlaySessionFiles(root, session, { expectedAbsent: true });
  return { root, session, path: '/api/workspace/play-sessions/' + session.id };
}
const post = (revision: number, signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: revision }), signal });

describe('phase budget and archive isolation', () => {
  it.each([50, 200, 1000])('uses configured limits at %i turns and refuses to truncate protected input', async count => {
    const { root, path, session } = await fixture(count);
    const runPlayTurn = vi.fn();
    const provider = { id: 'model', kind: 'custom' as const, model: 'model', models: [{ id: 'model', maxOutputTokens: 32, contextWindow: 40 }] };
    const app = createNovelHonoApp({ workspaceRoot: root, providerConfig: provider, runPlayTurn });
    const budget = (await (await app.request(path + '/phases')).json()).budget;
    expect(budget).toMatchObject({ status: 'protected-overflow', inputTokens: 8, outputReserve: 32 });
    expect(budget.protectedTokens).toBeGreaterThan(8);
    expect((await app.request(path + '/compact', post(session.revision))).status).toBe(422);
    expect(runPlayTurn).not.toHaveBeenCalled();
    const unknown = createNovelHonoApp({ workspaceRoot: root, globalConfigDir: join(root, 'empty-global') });
    expect((await (await unknown.request(path + '/phases')).json()).budget.status).toBe('unknown');
  }, 90_000);

  it('drops previews on abort or mid-generation source drift and blocks competing generation', async () => {
    const { root, path, session } = await fixture(3);
    for (const abort of [true, false]) {
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const app = createNovelHonoApp({ workspaceRoot: root, runPlayTurn: async () => {
        entered(); await gate;
        return JSON.stringify({ version: 1, turnsCovered: 3, characters: [], chronicle: ['at the gate 1'], unresolvedThreads: [],
          currentScene: { timeAndPlace: '未记录', atmosphere: '未记录', immediateCrisis: '未记录', presentCharacters: [] },
          voiceAndStyle: { pov: 'third', rhythm: 'slow', tonePoints: [] }, resourceState: session.playLocalState });
      } });
      const controller = new AbortController();
      const preview = app.request(path + '/compact', post(session.revision, controller.signal));
      try {
        await started;
        expect((await app.request(path + '/compact', post(session.revision))).status).toBe(409);
        expect((await app.request(path + '/world-referee-turn', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userText: 'competing action', baseRevision: session.revision }) })).status).toBe(409);
        if (abort) controller.abort(); else await writeFile(join(root, 'world/rules.md'), 'changed source');
      } finally { release(); }
      expect((await preview).status).toBe(abort ? 409 : 422);
      const active = await readPlaySessionFiles(root, session.id);
      expect(active.metadataExtensions.playCompactionPreview).toBeUndefined();
      expect(active.selectedTurnIds).toEqual(session.selectedTurnIds);
    }
  });
});
