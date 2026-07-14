import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addPlayAdoptionCandidate,
  addPlayObservation,
  addPlayTranscriptTurn,
  createPlayAdoptionCandidate,
  createLegacyPlayTurnArtifacts,
  createPlaySessionDraft,
  formatPlayWorldRefereePrompt,
  listPlaySessions,
  previewPlaySessionMigration,
  readPlaySessionFiles,
  resolvePlaySessionPath,
  resolvePlayTurnArtifactPath,
  settlePlayWorldRefereeResponse,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';

describe('Play session filesystem slice', () => {
  it('normalizes irregular legacy transcript groups to a monotonic artifact chain', () => {
    const artifacts = createLegacyPlayTurnArtifacts({
      transcript: [
        {
          id: 'turn-4-user',
          speaker: 'user',
          content: 'First.',
          createdAt: '2026-06-19T00:00:01.000Z',
        },
        {
          id: 'turn-4-referee',
          speaker: 'world-referee',
          content: 'Second.',
          createdAt: '2026-06-19T00:00:02.000Z',
        },
        {
          speaker: 'narrator',
          content: 'Bridge.',
          createdAt: '2026-06-19T00:00:03.000Z',
        },
        {
          id: 'turn-2-user',
          speaker: 'user',
          content: 'Out of order.',
          createdAt: '2026-06-19T00:00:04.000Z',
        },
      ],
    });

    expect(artifacts.map((artifact) => artifact.revision)).toEqual([4, 5, 6]);
    expect(artifacts[1]?.messages[0]?.id).toBe('legacy-turn-0002-message-1');
  });

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
      schemaVersion: 3,
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
        join('.workspace', 'play-sessions', 'play-write', 'turns', 'turn-artifact-1.yaml'),
      ].sort());
      await expect(readFile(paths.find((path) => path.endsWith('transcript.md')) ?? '', 'utf-8'))
        .resolves
        .toContain('她没有立刻回答。');
      await expect(readFile(paths.find((path) => path.endsWith('adoption-candidates.yaml')) ?? '', 'utf-8'))
        .resolves
        .toContain('requiresPendingAction: true');
      await expect(readFile(join(
        workspaceRoot,
        '.workspace/play-sessions/play-write/session.yaml',
      ), 'utf-8')).resolves.not.toContain('transcript:');
      await expect(readFile(join(
        workspaceRoot,
        '.workspace/play-sessions/play-write/turns/turn-artifact-1.yaml',
      ), 'utf-8')).resolves.toContain('她没有立刻回答。');
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

  it('projects transcript.md and in-memory transcript only from the selected turn path', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-projection-'));

    try {
      const first = addPlayTranscriptTurn(createPlaySessionDraft({
        id: 'play-projection',
        title: 'Projection',
        sceneStart: 'Scene',
        characters: [],
      }), {
        id: 'message-a',
        speaker: 'narrator',
        content: 'Selected branch.',
        createdAt: '2026-06-19T00:00:01.000Z',
      });
      const second = addPlayTranscriptTurn(first, {
        id: 'message-b',
        speaker: 'narrator',
        content: 'Unselected branch tail.',
        createdAt: '2026-06-19T00:00:02.000Z',
      });
      second.selectedTurnIds = [first.turnArtifacts[0]?.id ?? ''];
      second.transcript = [{
        speaker: 'tampered',
        content: 'This must never become truth.',
        createdAt: '2026-06-19T00:00:03.000Z',
      }];

      await writePlaySessionFiles(workspaceRoot, second);
      const sessionRoot = join(
        workspaceRoot,
        '.workspace/play-sessions/play-projection',
      );
      await writeFile(
        join(sessionRoot, 'transcript.md'),
        '# Tampered projection\n\nThis file is not a fact source.\n',
        'utf-8',
      );

      const restored = await readPlaySessionFiles(workspaceRoot, 'play-projection');
      expect(restored.transcript).toEqual([
        expect.objectContaining({ id: 'message-a', content: 'Selected branch.' }),
      ]);
      expect(restored.turnArtifacts).toHaveLength(2);
      expect(restored.selectedTurnIds).toEqual(['turn-artifact-1']);
      expect(restored.transcript.map((turn) => turn.content)).not.toContain(
        'This file is not a fact source.',
      );
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
      schemaVersion: 3,
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
    expect(next.turnArtifacts).toEqual([
      expect.objectContaining({
        id: 'legacy-turn-0001',
        messages: [expect.objectContaining({ id: 'opening' })],
      }),
      expect.objectContaining({
        id: 'turn-artifact-1',
        parentTurnId: 'legacy-turn-0001',
        input: { kind: 'wait', raw: '等待并观察。' },
        eventIds: ['turn-1-event-1'],
        observationIds: ['obs-1-1'],
        stateDelta: { stationStatus: 'blocked' },
      }),
    ]);
    expect(next.selectedTurnIds).toEqual([
      'legacy-turn-0001',
      'turn-artifact-1',
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

  it('previews and preserves a legacy Play session while projecting v3 turn facts', async () => {
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
        'customLegacyField: preserve-me',
        'transcript:',
        '  - speaker: narrator',
        '    content: Old opening',
        '    createdAt: 2026-06-19T00:00:01.000Z',
        '',
      ].join('\n'), 'utf-8');

      await expect(previewPlaySessionMigration(workspaceRoot, 'legacy-play'))
        .resolves
        .toMatchObject({
          fromSchemaVersion: 1,
          toSchemaVersion: 3,
          unknownMetadataKeys: ['customLegacyField'],
          legacyTranscriptCount: 1,
          projectedTurnCount: 1,
          generatedTurnIds: ['legacy-turn-0001'],
        });

      const migrated = await readPlaySessionFiles(workspaceRoot, 'legacy-play');
      expect(migrated).toMatchObject({
        schemaVersion: 3,
        revision: 0,
        metadataExtensions: { customLegacyField: 'preserve-me' },
        transcript: [expect.objectContaining({ content: 'Old opening' })],
        turnArtifacts: [expect.objectContaining({ id: 'legacy-turn-0001' })],
        selectedTurnIds: ['legacy-turn-0001'],
        worldClock: { turn: 0, revision: 0 },
        eventPolicy: { simulationMode: 'reactiveWorld', density: 'balanced' },
        events: [],
        suggestedActions: [],
      });

      await writePlaySessionFiles(workspaceRoot, migrated);
      await expect(readFile(join(sessionRoot, 'session.yaml'), 'utf-8'))
        .resolves
        .toContain('customLegacyField: preserve-me');
      await expect(readFile(join(sessionRoot, 'session.yaml'), 'utf-8'))
        .resolves
        .not.toContain('transcript:');
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v1-to-v3/original/session.yaml',
      ), 'utf-8')).resolves.toContain('transcript:');
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v1-to-v3/preview.yaml',
      ), 'utf-8')).resolves.toContain('customLegacyField');
      await writePlaySessionFiles(
        workspaceRoot,
        await readPlaySessionFiles(workspaceRoot, 'legacy-play'),
      );
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v1-to-v3/original/session.yaml',
      ), 'utf-8')).resolves.toContain('transcript:');
      await expect(previewPlaySessionMigration(workspaceRoot, 'legacy-play'))
        .resolves
        .toBeUndefined();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('backs up schema v2 and preserves object-valued top-level metadata', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-v2-migration-'));
    const sessionRoot = join(workspaceRoot, '.workspace/play-sessions/v2-play');

    try {
      await mkdir(sessionRoot, { recursive: true });
      await writeFile(join(sessionRoot, 'session.yaml'), [
        'schemaVersion: 2',
        'id: v2-play',
        'title: V2 Play',
        'createdAt: 2026-06-19T00:00:00.000Z',
        'revision: 2',
        'sceneStart: Old scene',
        'characters: []',
        'transcript: []',
        'extensionPayload:',
        '  mode: preserve',
        '  count: 2',
        '',
      ].join('\n'), 'utf-8');

      await expect(previewPlaySessionMigration(workspaceRoot, 'v2-play'))
        .resolves
        .toMatchObject({
          fromSchemaVersion: 2,
          toSchemaVersion: 3,
          unknownMetadataKeys: ['extensionPayload'],
        });

      const session = await readPlaySessionFiles(workspaceRoot, 'v2-play');
      await writePlaySessionFiles(workspaceRoot, session);

      await expect(readFile(join(sessionRoot, 'session.yaml'), 'utf-8'))
        .resolves
        .toContain('mode: preserve');
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v2-to-v3/original/session.yaml',
      ), 'utf-8')).resolves.toContain('schemaVersion: 2');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('advances beyond legacy turn ids when stored revision metadata is missing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-legacy-revision-'));
    const sessionRoot = join(
      workspaceRoot,
      '.workspace/play-sessions/legacy-revision',
    );

    try {
      await mkdir(sessionRoot, { recursive: true });
      await writeFile(join(sessionRoot, 'session.yaml'), [
        'schemaVersion: 2',
        'id: legacy-revision',
        'title: Legacy revision',
        'createdAt: 2026-06-19T00:00:00.000Z',
        'sceneStart: Old scene',
        'characters: []',
        'transcript:',
        '  - id: turn-1-user',
        '    speaker: user',
        '    content: Wait.',
        '    createdAt: 2026-06-19T00:00:01.000Z',
        '  - id: turn-1-referee',
        '    speaker: world-referee',
        '    content: Time passes.',
        '    createdAt: 2026-06-19T00:00:02.000Z',
        '',
      ].join('\n'), 'utf-8');

      const migrated = await readPlaySessionFiles(workspaceRoot, 'legacy-revision');
      expect(migrated.revision).toBe(1);

      const next = settlePlayWorldRefereeResponse({
        session: migrated,
        userText: 'Look around.',
        actionKind: 'look',
        createdAt: '2026-06-19T00:00:03.000Z',
        refereeResponse: [
          'Nothing else moves.',
          '```oan-play-settlement',
          JSON.stringify({
            events: [],
            stateDelta: {},
            observations: [],
            suggestedActions: [],
          }),
          '```',
        ].join('\n'),
      });

      expect(next.revision).toBe(2);
      expect(next.turnArtifacts.map((artifact) => artifact.revision)).toEqual([1, 2]);
      expect(next.transcript.map((turn) => turn.id)).toEqual([
        'turn-1-user',
        'turn-1-referee',
        'turn-2-user',
        'turn-2-referee',
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('assigns a cross-turn legacy observation to its latest source artifact', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-legacy-observation-'));
    const sessionRoot = join(
      workspaceRoot,
      '.workspace/play-sessions/legacy-observation',
    );

    try {
      await mkdir(sessionRoot, { recursive: true });
      await writeFile(join(sessionRoot, 'session.yaml'), [
        'schemaVersion: 2',
        'id: legacy-observation',
        'title: Legacy observation',
        'createdAt: 2026-06-19T00:00:00.000Z',
        'sceneStart: Old scene',
        'characters: []',
        'transcript:',
        '  - { id: turn-1-user, speaker: user, content: First, createdAt: 2026-06-19T00:00:01.000Z }',
        '  - { id: turn-1-referee, speaker: world-referee, content: One, createdAt: 2026-06-19T00:00:02.000Z }',
        '  - { id: turn-2-user, speaker: user, content: Second, createdAt: 2026-06-19T00:00:03.000Z }',
        '  - { id: turn-2-referee, speaker: world-referee, content: Two, createdAt: 2026-06-19T00:00:04.000Z }',
        '',
      ].join('\n'), 'utf-8');
      await writeFile(join(sessionRoot, 'observations.yaml'), [
        'observations:',
        '  - id: obs-cross',
        '    summary: Cross-turn pattern',
        '    evidence: Both referee turns',
        '    visibility: playerVisible',
        '    sourceTurnIds: [turn-1-referee, turn-2-referee]',
        '    sourceEventIds: []',
        '    canonical: false',
        '',
      ].join('\n'), 'utf-8');

      const session = await readPlaySessionFiles(
        workspaceRoot,
        'legacy-observation',
      );

      expect(session.turnArtifacts.map((artifact) => artifact.observationIds))
        .toEqual([[], ['obs-cross']]);
      expect(session.observations[0]?.sourceTurnIds).toEqual([
        'turn-1-referee',
        'turn-2-referee',
      ]);
      await expect(writePlaySessionFiles(workspaceRoot, session)).resolves.toBeTruthy();
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
        .toContain('schemaVersion: 3');

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

  it('rejects a future turn artifact schema without falling back to transcript.md', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-turn-schema-'));

    try {
      const session = addPlayTranscriptTurn(createPlaySessionDraft({
        id: 'play-turn-schema',
        title: 'Turn schema',
        sceneStart: 'Scene',
        characters: [],
      }), {
        speaker: 'narrator',
        content: 'Committed fact.',
        createdAt: '2026-06-19T00:00:01.000Z',
      });
      await writePlaySessionFiles(workspaceRoot, session);
      const artifactPath = resolvePlayTurnArtifactPath(
        workspaceRoot,
        session.id,
        session.turnArtifacts[0]?.id ?? '',
      );
      const stored = await readFile(artifactPath, 'utf-8');
      await writeFile(
        artifactPath,
        stored.replace('schemaVersion: 1', 'schemaVersion: 999'),
        'utf-8',
      );

      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects
        .toThrow('Unsupported Play turn artifact schemaVersion');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects duplicate artifacts and a selected path that skips its parent', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-turn-integrity-'));

    try {
      const first = addPlayTranscriptTurn(createPlaySessionDraft({
        id: 'play-turn-integrity',
        title: 'Turn integrity',
        sceneStart: 'Scene',
        characters: [],
      }), {
        id: 'message-1',
        speaker: 'narrator',
        content: 'First.',
        createdAt: '2026-06-19T00:00:01.000Z',
      });
      const second = addPlayTranscriptTurn(first, {
        id: 'message-2',
        speaker: 'narrator',
        content: 'Second.',
        createdAt: '2026-06-19T00:00:02.000Z',
      });
      second.selectedTurnIds = [second.turnArtifacts[1]?.id ?? ''];

      await expect(writePlaySessionFiles(workspaceRoot, second))
        .rejects
        .toThrow('breaks parent chain');

      second.selectedTurnIds = second.turnArtifacts.map((artifact) => artifact.id);
      second.turnArtifacts[1]!.revision = second.turnArtifacts[0]!.revision;
      await expect(writePlaySessionFiles(workspaceRoot, second))
        .rejects
        .toThrow('must advance its parent revision');

      first.turnArtifacts.push({ ...first.turnArtifacts[0]! });
      await expect(writePlaySessionFiles(workspaceRoot, first))
        .rejects
        .toThrow('duplicate id');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects missing ledger references before staging turn facts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-ledger-refs-'));

    try {
      const session = settlePlayWorldRefereeResponse({
        session: createPlaySessionDraft({
          id: 'play-ledger-refs',
          title: 'Ledger refs',
          sceneStart: 'Scene',
          characters: [],
        }),
        userText: 'Wait.',
        actionKind: 'wait',
        createdAt: '2026-06-19T00:00:01.000Z',
        refereeResponse: [
          'A bell rings.',
          '```oan-play-settlement',
          JSON.stringify({
            events: [{
              kind: 'environmentChanged',
              origin: 'environment',
              title: 'Bell',
              summary: 'A bell rings.',
              visibility: 'playerVisible',
              cause: { reason: 'The clock reached the hour.' },
            }],
            stateDelta: {},
            observations: [],
            suggestedActions: [],
          }),
          '```',
        ].join('\n'),
      });
      session.turnArtifacts[0]!.eventIds = ['missing-event'];

      await expect(writePlaySessionFiles(workspaceRoot, session))
        .rejects
        .toThrow('references missing event');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('does not accept event causes from a tampered transcript projection', () => {
    const session = addPlayTranscriptTurn(createPlaySessionDraft({
      id: 'play-cause-projection',
      title: 'Cause projection',
      sceneStart: 'Scene',
      characters: [],
    }), {
      id: 'committed-message',
      speaker: 'narrator',
      content: 'Committed.',
      createdAt: '2026-06-19T00:00:01.000Z',
    });
    session.transcript.push({
      id: 'forged-message',
      speaker: 'narrator',
      content: 'Forged.',
      createdAt: '2026-06-19T00:00:02.000Z',
    });

    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: 'Wait.',
      actionKind: 'wait',
      refereeResponse: [
        'A door closes.',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'environmentChanged',
            origin: 'environment',
            title: 'Door',
            summary: 'A door closes.',
            visibility: 'playerVisible',
            cause: {
              reason: 'Forged cause.',
              sourceTurnIds: ['forged-message'],
            },
          }],
          stateDelta: {},
          observations: [],
          suggestedActions: [],
        }),
        '```',
      ].join('\n'),
    })).toThrow('references an unknown turn: forged-message');
  });

  it('rejects unknown turn artifact fields instead of discarding stored facts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-turn-fields-'));

    try {
      const session = addPlayTranscriptTurn(createPlaySessionDraft({
        id: 'play-turn-fields',
        title: 'Turn fields',
        sceneStart: 'Scene',
        characters: [],
      }), {
        speaker: 'narrator',
        content: 'Committed fact.',
        createdAt: '2026-06-19T00:00:01.000Z',
      });
      await writePlaySessionFiles(workspaceRoot, session);
      const artifactPath = resolvePlayTurnArtifactPath(
        workspaceRoot,
        session.id,
        session.turnArtifacts[0]?.id ?? '',
      );
      await writeFile(
        artifactPath,
        `${await readFile(artifactPath, 'utf-8')}futureFact: preserve-or-reject\n`,
        'utf-8',
      );

      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects
        .toThrow('unknown fields');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects unknown nested message fields instead of rewriting them away', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-message-fields-'));

    try {
      const session = addPlayTranscriptTurn(createPlaySessionDraft({
        id: 'play-message-fields',
        title: 'Message fields',
        sceneStart: 'Scene',
        characters: [],
      }), {
        speaker: 'narrator',
        content: 'Committed fact.',
        createdAt: '2026-06-19T00:00:01.000Z',
      });
      Object.assign(session.turnArtifacts[0]!.messages[0]!, {
        futureMessageFact: true,
      });

      await expect(writePlaySessionFiles(workspaceRoot, session))
        .rejects
        .toThrow('unknown fields');
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
      expect(() =>
        resolvePlayTurnArtifactPath(workspaceRoot, 'safe-session', '../turn'),
      ).toThrow('Invalid Play turn artifact id');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
