import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addPlayAdoptionCandidate,
  addPlayObservation,
  addPlayTranscriptTurn,
  createPlayAdoptionCandidate,
  createPlaySessionDraft,
  formatPlayWorldRefereePrompt,
  listPlaySessions,
  readPlaySessionFiles,
  resolvePlaySessionPath,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';

describe('Play session filesystem slice', () => {
  it('creates play sessions separate from canonical truth', () => {
    const session = createPlaySessionDraft({
      id: 'play-1',
      title: '雨夜试跑',
      createdAt: '2026-06-19T00:00:00.000Z',
      userPersona: 'reader',
      sceneStart: '港口雨夜',
      characters: ['heroine', 'hero'],
      activatedSources: [
        {
          sourceId: 'characters.heroine.interaction',
          path: 'characters/heroine/interaction.md',
          reason: 'voice and reaction hints for Play only',
          budgetLayer: 'L1',
          semanticBoundary: 'compressible',
          trust: 'interactionHint',
        },
      ],
    });

    expect(session).toMatchObject({
      id: 'play-1',
      sceneStart: '港口雨夜',
      observations: [],
      adoptionCandidates: [],
    });
    expect(session.activatedSources[0]).toMatchObject({
      trust: 'interactionHint',
    });

    const prompt = formatPlayWorldRefereePrompt(session);

    expect(prompt).toContain('Play Mode World Referee');
    expect(prompt).toContain('one world referee');
    expect(prompt).toContain('not canonical truth');
  });

  it('writes play session files under .workspace/play-sessions', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-'));

    try {
      const baseSession = createPlaySessionDraft({
        id: 'play-write',
        title: 'Roleplay Sandbox',
        createdAt: '2026-06-19T00:00:00.000Z',
        sceneStart: '训练室',
        characters: ['heroine'],
      });
      const session = addPlayAdoptionCandidate(
        addPlayObservation(
          addPlayTranscriptTurn(baseSession, {
            speaker: 'heroine',
            content: '她没有立刻回答。',
            createdAt: '2026-06-19T00:01:00.000Z',
          }),
          {
            id: 'obs-1',
            summary: '女主面对压力时先沉默观察。',
            evidence: '她没有立刻回答。',
            canonical: false,
          },
        ),
        createPlayAdoptionCandidate({
          id: 'adopt-1',
          target: 'chapterDraft',
          summary: '可转成下一章对话草稿。',
          evidence: 'Play transcript turn obs-1',
        }),
      );
      const paths = await writePlaySessionFiles(workspaceRoot, session);

      expect(paths.map((path) => relative(workspaceRoot, path)).sort()).toEqual([
        join('.workspace', 'play-sessions', 'play-write', 'activated-sources.yaml'),
        join('.workspace', 'play-sessions', 'play-write', 'adoption-candidates.yaml'),
        join('.workspace', 'play-sessions', 'play-write', 'observations.yaml'),
        join('.workspace', 'play-sessions', 'play-write', 'play-local-state.yaml'),
        join('.workspace', 'play-sessions', 'play-write', 'session.yaml'),
        join('.workspace', 'play-sessions', 'play-write', 'transcript.md'),
      ].sort());
      await expect(readFile(paths.find((path) => path.endsWith('transcript.md')) ?? '', 'utf-8'))
        .resolves
        .toContain('她没有立刻回答。');
      await expect(readFile(paths.find((path) => path.endsWith('adoption-candidates.yaml')) ?? '', 'utf-8'))
        .resolves
        .toContain('requiresPendingAction: true');
      await expect(readPlaySessionFiles(workspaceRoot, 'play-write'))
        .resolves
        .toMatchObject({
          id: 'play-write',
          transcript: [
            expect.objectContaining({ speaker: 'heroine' }),
          ],
          adoptionCandidates: [
            expect.objectContaining({ id: 'adopt-1' }),
          ],
        });
      await expect(listPlaySessions(workspaceRoot))
        .resolves
        .toEqual([
          expect.objectContaining({ id: 'play-write' }),
        ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsafe play session ids', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-safe-'));

    try {
      expect(() =>
        resolvePlaySessionPath(workspaceRoot, '../escape', 'transcript.md'),
      ).toThrow('Invalid Play session id');
      expect(() =>
        createPlaySessionDraft({
          id: '.hidden',
          title: 'bad',
          sceneStart: 'bad',
          characters: [],
        }),
      ).toThrow('Invalid Play session id');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
