import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  settlePlayWorldRefereeResponse,
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
      schemaVersion: 2,
      id: 'play-1',
      revision: 0,
      sceneStart: '港口雨夜',
      worldClock: { turn: 0, revision: 0 },
      eventPolicy: { simulationMode: 'reactiveWorld' },
      events: [],
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
    expect(prompt).toContain('Recent committed transcript');
    expect(prompt).toContain('oan-play-settlement');
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
            visibility: 'playerVisible',
            sourceTurnIds: [],
            sourceEventIds: [],
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
        join('.workspace', 'play-sessions', 'play-write', 'events.yaml'),
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

  it('settles a structured referee response as one Play-local world turn', () => {
    const session = createPlaySessionDraft({
      id: 'play-settle',
      title: '车站试演',
      createdAt: '2026-06-19T00:00:00.000Z',
      sceneStart: '子夜车站',
      characters: ['heroine'],
    });
    session.playLocalState = { weather: 'rain' };
    session.transcript = [{
      id: 'opening',
      speaker: 'narrator',
      content: '车站尚未封锁。',
      createdAt: '2026-06-19T00:00:00.000Z',
    }];
    const contextualPrompt = formatPlayWorldRefereePrompt(session);
    expect(contextualPrompt).toContain('车站尚未封锁。');
    expect(contextualPrompt).toContain('"weather": "rain"');

    const next = settlePlayWorldRefereeResponse({
      session,
      userText: '等待并观察。',
      actionKind: 'wait',
      createdAt: '2026-06-19T00:35:00.000Z',
      refereeResponse: [
        '远处的铁门落锁。',
        '',
        '```oan-play-settlement',
        JSON.stringify({
          elapsed: '35 minutes',
          worldTimeAnchor: 'midnight',
          events: [{
            kind: 'factionActed',
            origin: 'faction',
            title: '封锁推进',
            summary: '东侧入口被控制',
            visibility: 'playerVisible',
            cause: { reason: '组织原有计划在等待期间推进' },
          }],
          stateDelta: { stationStatus: 'blocked' },
          observations: [{ summary: '封锁已推进', evidence: 'event settlement' }],
          suggestedActions: ['调查东侧入口'],
        }),
        '```',
      ].join('\n'),
    });

    expect(next).toMatchObject({
      schemaVersion: 2,
      revision: 1,
      worldClock: {
        turn: 1,
        revision: 1,
        anchor: 'midnight',
        elapsed: '35 minutes',
      },
      playLocalState: {
        weather: 'rain',
        stationStatus: 'blocked',
      },
      suggestedActions: ['调查东侧入口'],
    });
    expect(next.transcript.slice(-2)).toEqual([
      expect.objectContaining({ speaker: 'user', actionKind: 'wait' }),
      expect.objectContaining({
        speaker: 'world-referee',
        content: '远处的铁门落锁。',
      }),
    ]);
    expect(next.events).toEqual([
      expect.objectContaining({
        id: 'turn-1-event-1',
        sequence: 1,
        kind: 'factionActed',
        worldClock: expect.objectContaining({ turn: 1, revision: 1, anchor: 'midnight' }),
        canonical: false,
        cause: expect.objectContaining({
          reason: '组织原有计划在等待期间推进',
          sourceTurnIds: ['turn-1-user'],
        }),
      }),
    ]);
  });

  it('rejects malformed event causality before mutating the session', () => {
    const session = createPlaySessionDraft({
      id: 'play-invalid-event',
      title: 'Invalid event',
      sceneStart: 'Scene',
      characters: [],
    });

    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: [
        '风声变化。',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'environmentChanged',
            origin: 'environment',
            title: '起风',
            summary: '风变强了',
            visibility: 'playerVisible',
            cause: {},
          }],
        }),
        '```',
      ].join('\n'),
    })).toThrow('cause requires a reason');
    expect(session).toMatchObject({ revision: 0, transcript: [], events: [] });
  });

  it('requires the structured settlement block and rejects unknown cause references', () => {
    const session = createPlaySessionDraft({
      id: 'play-strict-settlement',
      title: 'Strict settlement',
      sceneStart: 'Scene',
      characters: [],
    });

    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: '只有叙事，没有结构化结算。',
    })).toThrow('requires a final oan-play-settlement block');

    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: [
        '远处传来钟声。',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'deadlineAdvanced',
            origin: 'clock',
            title: '钟声',
            summary: '时间继续推进',
            visibility: 'playerVisible',
            cause: { reason: '时间流逝', sourceEventIds: ['missing-event'] },
          }],
        }),
        '```',
      ].join('\n'),
    })).toThrow('references an unknown event');
    expect(session).toMatchObject({ revision: 0, transcript: [], events: [] });
  });

  it('rejects an over-budget or disallowed hidden event as one whole turn', () => {
    const session = createPlaySessionDraft({
      id: 'play-event-policy',
      title: 'Policy',
      sceneStart: 'Scene',
      characters: [],
      eventPolicy: {
        maxExternalEventsPerTurn: 0,
        allowHidden: false,
      },
    });
    const response = [
      '门锁发生变化。',
      '```oan-play-settlement',
      JSON.stringify({
        events: [{
          kind: 'environmentChanged',
          origin: 'environment',
          title: '门锁',
          summary: '门被锁上',
          visibility: 'playerUnknown',
          cause: { reason: '守卫执行例行封锁' },
        }],
        stateDelta: { door: 'locked' },
        observations: [{ summary: '门已锁', evidence: '事件结算' }],
      }),
      '```',
    ].join('\n');

    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: response,
    })).toThrow('exceeds the event budget');
    expect(session).toMatchObject({
      revision: 0,
      playLocalState: {},
      observations: [],
      events: [],
    });
  });

  it('marks hidden turn effects for a unified author-only projection', () => {
    const session = createPlaySessionDraft({
      id: 'play-hidden-projection',
      title: 'Hidden projection',
      sceneStart: 'Scene',
      characters: [],
    });
    const next = settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: [
        '走廊仍然安静。',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'npcActed',
            origin: 'npc',
            title: '暗中落锁',
            summary: '守卫锁上后门',
            visibility: 'playerUnknown',
            cause: { reason: '守卫按计划行动' },
          }],
          stateDelta: { backDoor: 'locked' },
          observations: [{ summary: '后门已锁', evidence: '隐藏事件' }],
          suggestedActions: ['去检查后门'],
        }),
        '```',
      ].join('\n'),
    });

    expect(next.playLocalStateVisibility).toEqual({ backDoor: 'playerUnknown' });
    expect(next.observations).toEqual([
      expect.objectContaining({
        visibility: 'playerUnknown',
        sourceEventIds: ['turn-1-event-1'],
        sourceTurnIds: ['turn-1-referee'],
      }),
    ]);
    expect(next.suggestedActions).toEqual([]);
  });

  it('reads legacy Play sessions with v2 defaults', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-legacy-'));
    const sessionRoot = join(workspaceRoot, '.workspace/play-sessions/legacy-play');

    try {
      await mkdir(sessionRoot, { recursive: true });
      await writeFile(join(sessionRoot, 'session.yaml'), [
        'id: legacy-play',
        'title: Legacy Play',
        'createdAt: 2026-06-19T00:00:00.000Z',
        'sceneStart: Old scene',
        'characters: []',
        'transcript: []',
        '',
      ].join('\n'), 'utf-8');

      await expect(readPlaySessionFiles(workspaceRoot, 'legacy-play'))
        .resolves
        .toMatchObject({
          schemaVersion: 2,
          revision: 0,
          worldClock: { turn: 0, revision: 0 },
          eventPolicy: { simulationMode: 'reactiveWorld', density: 'balanced' },
          events: [],
          suggestedActions: [],
        });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('recovers a complete staged session and rejects future schema versions', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-recovery-'));
    const session = createPlaySessionDraft({
      id: 'play-recovery',
      title: 'Recovery',
      sceneStart: 'Scene',
      characters: [],
    });
    const sessionRoot = join(workspaceRoot, '.workspace/play-sessions/play-recovery');
    const stageRoot = join(
      workspaceRoot,
      '.workspace/play-sessions/.play-recovery.stage.999-test',
    );

    try {
      await writePlaySessionFiles(workspaceRoot, session);
      await rename(sessionRoot, stageRoot);
      await writeFile(join(stageRoot, '.ready'), '0\n', 'utf-8');

      await expect(readPlaySessionFiles(workspaceRoot, 'play-recovery'))
        .resolves
        .toMatchObject({ id: 'play-recovery', revision: 0 });
      await expect(readFile(join(sessionRoot, 'session.yaml'), 'utf-8'))
        .resolves
        .toContain('schemaVersion: 2');

      await writeFile(
        join(sessionRoot, 'session.yaml'),
        [
          'schemaVersion: 999',
          'id: play-recovery',
          'title: Future',
          'createdAt: 2026-06-19T00:00:00.000Z',
          'sceneStart: Future scene',
          '',
        ].join('\n'),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, 'play-recovery'))
        .rejects
        .toThrow('Unsupported Play session schemaVersion');
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
