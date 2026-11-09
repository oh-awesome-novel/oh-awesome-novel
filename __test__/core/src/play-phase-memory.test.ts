import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { buildPlayPhaseCatalog, createCompactedPlaySession, createPlayCompactionPreview, readPlaySessionFiles,
  recallPlayPhase, restorePlaySessionCheckpoint, settlePlayWorldSettlementRetry, writePlaySessionFiles } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';

import { longSession } from './fixtures/long-play-phase';

function archive(s: PlaySession, id: string) {
  const preview = createPlayCompactionPreview(s, JSON.stringify({ version: 1, turnsCovered: s.selectedTurnIds.length,
    characters: [], chronicle: ['at the gate 1'], unresolvedThreads: [],
    currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' },
    voiceAndStyle: { pov: 'third', rhythm: 'slow', tonePoints: [] }, resourceState: s.playLocalState }));
  return createCompactedPlaySession(s, preview, id);
}

describe('branch-bound Play phase recall', () => {
  it.each([50, 200, 1000])('reopens a %i-turn archive and searches exactly its selected branch', async count => {
    const root = await mkdtemp(join(tmpdir(), 'oan-phase-'));
    try {
      const source = longSession(count);
      await writePlaySessionFiles(root, source, { expectedAbsent: true });
      const load = (id: string) => readPlaySessionFiles(root, id);
      const next = archive(await load(source.id), 'next-phase');
      await writePlaySessionFiles(root, next, { expectedAbsent: true });
      const reopened = await load(next.id);
      const catalog = await buildPlayPhaseCatalog(reopened, load);
      expect(catalog.gap).toBeUndefined();
      expect(catalog.phases.map(p => [p.firstTurn, p.lastTurn])).toEqual([[1, count], [count + 1, count]]);
      const query = { sessionId: next.id, revision: next.revision, headId: catalog.headId!, phaseSessionId: source.id,
        firstTurn: 1, lastTurn: count, lens: 'player' as const, query: 'at the gate' };
      const result = recallPlayPhase(reopened, catalog, query);
      expect(result.hits).toHaveLength(20);
      expect(result.omittedHits).toBe(count - 20);
      expect(result.hits[0]!.historicalState.medicine).toBe(2);
      const hit = result.hits[0]!;
      expect(hit.quote).toBe(source.transcript.find(m => m.id === hit.messageId)!.content.slice(hit.start, hit.end));
      expect(hit.quoteHash).toBe(createHash('sha256').update(hit.quote).digest('hex'));
      expect(recallPlayPhase(reopened, catalog, { ...query, query: 'SIBLING_ONLY' }).hits).toEqual([]);
      expect(() => recallPlayPhase(reopened, catalog, { ...query, headId: 'stale' })).toThrow();
      expect(() => recallPlayPhase(reopened, catalog, { ...query, lastTurn: count + 1 })).toThrow();
      expect((await buildPlayPhaseCatalog(reopened, async () => { throw new Error('missing source'); })).phases).toHaveLength(1);
      const restored = restorePlaySessionCheckpoint(reopened, source.turnArtifacts.at(-1)!.id);
      expect((await buildPlayPhaseCatalog(restored, load)).phases).toMatchObject([{ current: true, firstTurn: 1, lastTurn: 2 }]);
      expect(reopened.playLocalState).toEqual(source.playLocalState);
      expect(reopened.scheduledEvents).toEqual(source.scheduledEvents);
      expect(reopened.playLocalStateVisibility).toEqual(source.playLocalStateVisibility);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 90_000);
  it('follows repeated compactions and drops the old archive when retry selects a sibling', async () => {
    const source = longSession(5);
    const first = archive(source, 'phase-2');
    const second = archive(first, 'phase-3');
    const load = async (id: string) => [source, first].find(s => s.id === id)!;
    const catalog = await buildPlayPhaseCatalog(second, load);
    expect(catalog.phases.map(p => p.sessionId)).toEqual([source.id, first.id, second.id]);
    expect(catalog.gap).toBeUndefined();
    const retried = settlePlayWorldSettlementRetry({ session: second, sourceArtifactId: second.selectedTurnIds.at(-1)!,
      expectedSessionRevision: second.revision, refereeResponse: 'retry evidence\n```oan-play-settlement\n{"events":[],"stateDelta":{},"observations":[],"suggestedActions":[]}\n```' }).session;
    const fork = await buildPlayPhaseCatalog(retried, load);
    expect(fork.phases.map(p => p.sessionId)).toEqual([second.id]);
    expect(recallPlayPhase(retried, fork, { sessionId: retried.id, headId: fork.headId!, revision: retried.revision, lens: 'director',
      phaseSessionId: second.id, firstTurn: 1, lastTurn: 5, query: 'at the gate 5' }).hits).toEqual([]);
  });
  it('revalidates source hashes, excludes hidden historical state and bounds candidates before searching', async () => {
    const s = longSession(50);
    const t = s.turnArtifacts[0]!;
    t.playLocalStateSnapshot!.secret = 'HIDDEN_STATE';
    t.playLocalStateVisibilitySnapshot!.secret = 'playerUnknown';
    t.messages[0]!.content = 'A'.repeat(300_000);
    const catalog = await buildPlayPhaseCatalog(s, async () => s);
    const q = { sessionId: s.id, revision: s.revision, headId: catalog.headId!, phaseSessionId: s.id,
      firstTurn: 1, lastTurn: 1, lens: 'player' as const, query: 'gate' };
    const player = recallPlayPhase(s, catalog, q);
    expect(player.omittedMessages).toBe(1);
    expect(player.candidateBytes).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.stringify(player)).not.toContain('HIDDEN_STATE');
    expect(recallPlayPhase(s, catalog, { ...q, lens: 'director' }).hits[0]).toMatchObject({ visibility: 'playerUnknown', stateRecorded: true, historicalState: { secret: 'HIDDEN_STATE' } });
    const archived = archive(s, 'child');
    s.turnArtifacts[0]!.messages[1]!.content = 'edited behind the archive';
    expect((await buildPlayPhaseCatalog(archived, async () => s)).gap).toBe('invalid-archive');
  });
});
