import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addPlayTranscriptTurn,
  createPlaySessionDraft,
  createPlayTurnContextTrace,
  listPlayContextTraces,
  resolvePlayContextTracePath,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';

describe('Play turn context trace', () => {
  it('commits host-owned context evidence atomically with its selected artifact', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-context-'));
    const before = createPlaySessionDraft({
      id: 'play-trace',
      title: 'Trace',
      sceneStart: 'Start',
      characters: [],
    });
    await writePlaySessionFiles(workspaceRoot, before, { expectedAbsent: true });
    const next = addPlayTranscriptTurn(before, {
      id: 'message-1',
      speaker: 'user',
      content: 'Proceed',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    const artifactId = next.selectedTurnIds.at(-1)!;
    const trace = createPlayTurnContextTrace({
      session: before,
      artifactId,
      sessionRevision: next.revision,
      createdAt: '2026-07-20T00:00:00.000Z',
      transcriptLimit: 20,
      eventLimit: 12,
      sources: [{
        sourceId: 'world',
        path: 'world/rules.md',
        trust: 'canonical',
        budgetLayer: 'L1',
        semanticBoundary: 'protected',
        expectedContentHash: 'a'.repeat(64),
        actualContentHash: 'a'.repeat(64),
        driftState: 'current',
        outcome: 'selected',
        selectedCharacterCount: 120,
      }],
    });

    await writePlaySessionFiles(workspaceRoot, next, {
      expectedCurrentSession: before,
      contextTrace: trace,
    });

    await expect(listPlayContextTraces(workspaceRoot, before.id)).resolves
      .toEqual([trace]);
    expect(await readFile(
      resolvePlayContextTracePath(workspaceRoot, before.id, artifactId),
      'utf-8',
    )).not.toContain('reasoning');

    await expect(writePlaySessionFiles(workspaceRoot, next, {
      expectedCurrentSession: next,
      contextTrace: {
        ...trace,
        sources: trace.sources.map((source) => ({
          ...source,
          selectedCharacterCount: 121,
        })),
      },
    })).rejects.toThrow('Play context trace is immutable');
    await expect(listPlayContextTraces(workspaceRoot, before.id)).resolves
      .toEqual([trace]);
  });

  it('rejects a mismatched trace before publishing any trace file', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-context-fail-'));
    const before = createPlaySessionDraft({
      id: 'play-trace-fail',
      title: 'Trace failure',
      sceneStart: 'Start',
      characters: [],
    });
    await writePlaySessionFiles(workspaceRoot, before, { expectedAbsent: true });
    const next = addPlayTranscriptTurn(before, {
      id: 'message-1',
      speaker: 'user',
      content: 'Proceed',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    const trace = createPlayTurnContextTrace({
      session: before,
      artifactId: next.selectedTurnIds.at(-1)!,
      sessionRevision: next.revision + 1,
      transcriptLimit: 20,
      eventLimit: 12,
      sources: [],
    });

    await expect(writePlaySessionFiles(workspaceRoot, next, {
      expectedCurrentSession: before,
      contextTrace: trace,
    })).rejects.toThrow('must match the committed selected turn artifact');
    await expect(listPlayContextTraces(workspaceRoot, before.id)).resolves.toEqual([]);
  });
});
