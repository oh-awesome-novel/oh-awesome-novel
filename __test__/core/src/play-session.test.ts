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
  createPlayNarrativeStreamFilter,
  createPlaySessionDraft,
  evaluatePlaySessionDueEvents,
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
  it('keeps the settlement fence out of provisional narrative across every chunk boundary', () => {
    const expected = '雨声压低了站台上的谈话。\n';
    for (const fence of [
      '```oan-play-settlement',
      '```OAN-PLAY-SETTLEMENT',
      '``` oan-play-settlement',
      '```',
      '~~~oan-play-settlement',
      'oan-play-settlement',
    ]) {
      const raw = [
        expected,
        fence,
        '\n{"events":[]}\n```',
      ].join('');

      for (let split = 0; split <= raw.length; split += 1) {
        const filter = createPlayNarrativeStreamFilter();
        const narrative = [
          filter.push(raw.slice(0, split)),
          filter.push(raw.slice(split)),
          filter.finish(),
        ].join('');

        expect(narrative).toBe(expected);
        expect(filter.settlementStarted).toBe(true);
      }
    }
  });

  it('can reset provisional narrative after an intermediate tool response', () => {
    const filter = createPlayNarrativeStreamFilter();

    filter.push('I will inspect the source first.');
    filter.reset();

    expect([
      filter.push('门外传来脚步声。\n```oan-play-settlement'),
      filter.finish(),
    ].join('')).toBe('门外传来脚步声。\n');
  });

  it('does not release an unfenced response or raw settlement JSON as provisional text', () => {
    for (const raw of [
      '只有一段未结算的叙事。',
      '走廊安静。\n{"events":[{"visibility":"playerUnknown","summary":"刺客在阁楼"}]}',
      'Settlement: {"events":[{"visibility":"playerUnknown"}]}',
    ]) {
      for (let split = 0; split <= raw.length; split += 1) {
        const filter = createPlayNarrativeStreamFilter();
        expect([
          filter.push(raw.slice(0, split)),
          filter.push(raw.slice(split)),
          filter.finish(),
        ].join('')).toBe('');
        expect(filter.settlementStarted).toBe(false);
      }
    }
  });

  it('does not release raw structured data before a later valid settlement fence', () => {
    const raw = [
      '走廊安静。',
      '{"events":[{"visibility":"playerUnknown","summary":"刺客在阁楼"}]}',
      '```oan-play-settlement',
      '{"events":[],"stateDelta":{},"observations":[],"suggestedActions":[]}',
      '```',
    ].join('\n');

    for (let split = 0; split <= raw.length; split += 1) {
      const filter = createPlayNarrativeStreamFilter();
      expect([
        filter.push(raw.slice(0, split)),
        filter.push(raw.slice(split)),
        filter.finish(),
      ].join('')).toBe('');
      expect(filter.settlementStarted).toBe(true);
    }
  });

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
      schemaVersion: 4,
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
        join('.workspace', 'play-sessions', 'play-write', 'event-schedule.yaml'),
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

  it('requires complete visibility metadata when reading or writing schema v4', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-v4-visibility-'));
    const sessionRoot = join(
      workspaceRoot,
      '.workspace/play-sessions/play-v4-visibility',
    );

    try {
      const settled = settlePlayWorldRefereeResponse({
        session: createPlaySessionDraft({
          id: 'play-v4-visibility',
          title: 'V4 visibility',
          sceneStart: 'Scene',
          characters: [],
        }),
        userText: '检查信号灯。',
        actionKind: 'look',
        refereeResponse: [
          '信号灯亮起。',
          '```oan-play-settlement',
          JSON.stringify({
            events: [{
              kind: 'environmentChanged',
              origin: 'environment',
              title: '信号灯',
              summary: '信号灯亮起',
              visibility: 'playerVisible',
              cause: { reason: '电路恢复' },
            }],
            stateDelta: { signalReady: true },
            observations: [{ summary: '信号可用', evidence: '信号灯事件' }],
          }),
          '```',
        ].join('\n'),
      });
      const session = addPlayAdoptionCandidate(
        settled,
        createPlayAdoptionCandidate({
          id: 'adopt-signal',
          target: 'state',
          summary: '采用信号状态',
          evidence: 'Play observation',
          visibility: 'playerVisible',
          sourceObservationIds: [settled.observations[0]!.id],
        }),
      );
      await writePlaySessionFiles(workspaceRoot, session);

      const validMetadata = await readFile(join(sessionRoot, 'session.yaml'), 'utf-8');
      await writeFile(
        join(sessionRoot, 'session.yaml'),
        validMetadata.replace(
          /^playLocalStateVisibility:\n(?: {2}.*\n)*/mu,
          '',
        ),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('Play session v4 state visibility must be present');

      await writeFile(
        join(sessionRoot, 'session.yaml'),
        validMetadata.replace(
          /^playLocalStateVisibility:\n(?: {2}.*\n)*/mu,
          'playLocalStateVisibility: {}\n',
        ),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('keys must exactly match Play-local state keys');

      await writePlaySessionFiles(workspaceRoot, session);
      const observationPath = join(sessionRoot, 'observations.yaml');
      const validObservations = await readFile(observationPath, 'utf-8');
      await writeFile(
        observationPath,
        validObservations.replace(/^    visibility: playerVisible\n/mu, ''),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('observation obs-1-1 requires a valid visibility');

      await writePlaySessionFiles(workspaceRoot, session);
      const candidatePath = join(sessionRoot, 'adoption-candidates.yaml');
      const validCandidates = await readFile(candidatePath, 'utf-8');
      await writeFile(
        candidatePath,
        validCandidates.replace(/^    visibility: playerVisible\n/mu, ''),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('candidate adopt-signal requires a valid visibility');

      await writeFile(
        candidatePath,
        validCandidates.replace(
          /^    sourceObservationIds:\n(?: {6}.*\n)*/mu,
          '',
        ),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('sourceObservationIds must be an array');

      const invalidInMemory = structuredClone(session);
      invalidInMemory.adoptionCandidates[0]!.visibility = 'secret' as never;
      await expect(writePlaySessionFiles(workspaceRoot, invalidInMemory))
        .rejects.toThrow('candidate adopt-signal requires a valid visibility');

      const duplicateInMemory = structuredClone(session);
      duplicateInMemory.adoptionCandidates.push(structuredClone(
        duplicateInMemory.adoptionCandidates[0]!,
      ));
      await expect(writePlaySessionFiles(workspaceRoot, duplicateInMemory))
        .rejects.toThrow('duplicate id: adopt-signal');

      const candidateListBody = validCandidates.slice(
        validCandidates.indexOf('\n') + 1,
      );
      await writeFile(
        candidatePath,
        `${validCandidates}${candidateListBody}`,
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('duplicate id: adopt-signal');

      await writePlaySessionFiles(workspaceRoot, session);
      const invalidMetadata = (await readFile(join(sessionRoot, 'session.yaml'), 'utf-8'))
        .replace(
          /^(playLocalStateVisibility:\n  signalReady: )playerVisible$/mu,
          '$1secret',
        );
      await writeFile(join(sessionRoot, 'session.yaml'), invalidMetadata, 'utf-8');
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('contains invalid visibility for signalReady');
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
    session.playLocalStateVisibility = { weather: 'playerVisible' };
    session.transcript = [{
      id: 'opening',
      speaker: 'narrator',
      content: '车站尚未封锁。',
      createdAt: '2026-06-19T00:00:00.000Z',
    }];
    session.branchBaseSnapshot = {
      parentTurnId: 'legacy-turn-0001',
      worldClock: { ...session.worldClock },
      playLocalState: structuredClone(session.playLocalState),
      playLocalStateVisibility: { ...session.playLocalStateVisibility },
      scheduledEvents: [],
      suggestedActions: [],
    };
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
      schemaVersion: 4,
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

  it('forces hard-due events outside the spontaneous budget and persists schedule truth', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-hard-due-'));
    try {
      const session = createPlaySessionDraft({
        id: 'play-hard-due',
        title: 'Hard due',
        sceneStart: 'Station',
        characters: [],
        eventPolicy: { maxExternalEventsPerTurn: 0 },
        scheduledEvents: [{
          id: 'deadline-lockdown',
          label: 'Station lockdown',
          trigger: { type: 'nextTurn' },
          template: {
            kind: 'factionActed',
            origin: 'faction',
            title: '封锁开始',
            summary: '站台出口按计划关闭',
            visibility: 'playerVisible',
          },
          status: 'scheduled',
          scheduledAtTurn: 0,
          scheduledAtRevision: 0,
          priority: 10,
        }],
      });

      expect(formatPlayWorldRefereePrompt(session)).toContain(
        'deadline-lockdown [priority 10/playerVisible]',
      );

      const next = settlePlayWorldRefereeResponse({
        session,
        userText: '继续等待。',
        actionKind: 'wait',
        createdAt: '2026-07-15T01:00:00.000Z',
        refereeResponse: [
          '铁门依次落下，广播要求旅客留在原地。',
          '```oan-play-settlement',
          JSON.stringify({
            events: [{
              kind: 'factionActed',
              origin: 'faction',
              title: '封锁开始',
              summary: '站台出口已经关闭',
              visibility: 'playerVisible',
              cause: {
                reason: '预定封锁时间已到',
                triggerId: 'deadline-lockdown',
              },
            }],
            scheduledEventChanges: [{
              type: 'schedule',
              label: '巡逻队抵达',
              trigger: { type: 'afterTurns', turns: 2 },
              template: {
                kind: 'arrival',
                origin: 'npc',
                title: '巡逻队抵达',
                summary: '增援巡逻队进入站台',
                visibility: 'playerVisible',
              },
              reason: '封锁协议要求增援',
              priority: 5,
            }],
          }),
          '```',
        ].join('\n'),
      });

      expect(next.events).toEqual([
        expect.objectContaining({
          id: 'turn-1-event-1',
          cause: expect.objectContaining({ triggerId: 'deadline-lockdown' }),
        }),
      ]);
      expect(next.scheduledEvents).toEqual([
        expect.objectContaining({
          id: 'deadline-lockdown',
          status: 'occurred',
          occurredEventIds: ['turn-1-event-1'],
          resolvedAtTurnId: 'turn-1-referee',
        }),
        expect.objectContaining({
          id: 'scheduled-1-1',
          status: 'scheduled',
          scheduledAtTurn: 1,
          scheduledAtRevision: 1,
          sourceTurnId: 'turn-1-referee',
          changeReason: '封锁协议要求增援',
        }),
      ]);
      expect(next.turnArtifacts.at(-1)?.scheduledEventIds).toEqual([
        'deadline-lockdown',
        'scheduled-1-1',
      ]);
      expect(next.turnArtifacts.at(-1)?.scheduledEventSnapshots).toEqual([
        expect.objectContaining({ id: 'deadline-lockdown', status: 'occurred' }),
        expect.objectContaining({ id: 'scheduled-1-1', status: 'scheduled' }),
      ]);

      await writePlaySessionFiles(workspaceRoot, next);
      const restored = await readPlaySessionFiles(workspaceRoot, session.id);
      expect(restored.scheduledEvents).toEqual(next.scheduledEvents);
      expect(evaluatePlaySessionDueEvents(restored).dueEvents).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('keeps branch-base schedule seeds pending, host-owned, and turn-safe', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-schedule-seed-'));
    const scheduledSeed = {
      id: 'host-seed',
      label: 'Host seed',
      trigger: { type: 'manual' as const },
      template: {
        kind: 'arrival' as const,
        origin: 'npc' as const,
        title: 'Host arrival',
        summary: 'A host-seeded arrival remains pending.',
        visibility: 'playerVisible' as const,
      },
      status: 'scheduled' as const,
      scheduledAtTurn: 0,
      scheduledAtRevision: 0,
    };
    const create = (scheduledEvents: typeof scheduledSeed[]) =>
      createPlaySessionDraft({
        id: 'play-schedule-seed',
        title: 'Schedule seed',
        sceneStart: 'Station',
        characters: [],
        scheduledEvents,
      });

    expect(() => create([{
      ...scheduledSeed,
      status: 'occurred',
      occurredEventIds: ['ghost-event'],
      resolvedAtTurnId: 'ghost-turn',
    } as never])).toThrow('cannot start terminal');
    expect(() => create([{
      ...scheduledSeed,
      status: 'cancelled',
      resolvedAtTurnId: 'ghost-turn',
      resolutionReason: 'Ghost cancellation',
    } as never])).toThrow('cannot start terminal');
    expect(() => create([{
      ...scheduledSeed,
      sourceTurnId: 'ghost-turn',
      changeReason: 'Unverifiable seed source',
    } as never])).toThrow('unverifiable source or resolution evidence');

    try {
      const session = create([scheduledSeed]);
      await writePlaySessionFiles(workspaceRoot, session);
      const restored = await readPlaySessionFiles(workspaceRoot, session.id);
      expect(restored.scheduledEvents).toEqual([scheduledSeed]);
      const next = settlePlayWorldRefereeResponse({
        session: restored,
        userText: '等待一轮。',
        actionKind: 'wait',
        refereeResponse: [
          '站台没有新的动静。',
          '```oan-play-settlement',
          JSON.stringify({}),
          '```',
        ].join('\n'),
      });
      expect(next).toMatchObject({
        revision: 1,
        scheduledEvents: [expect.objectContaining({
          id: 'host-seed',
          status: 'scheduled',
        })],
      });

      const ghostInMemory = structuredClone(session);
      Object.assign(ghostInMemory.branchBaseSnapshot.scheduledEvents[0]!, {
        status: 'occurred',
        occurredEventIds: ['ghost-event'],
        resolvedAtTurnId: 'ghost-turn',
      });
      await expect(writePlaySessionFiles(workspaceRoot, ghostInMemory))
        .rejects.toThrow('cannot start terminal');

      await writePlaySessionFiles(workspaceRoot, session);
      const metadataPath = join(
        workspaceRoot,
        '.workspace/play-sessions/play-schedule-seed/session.yaml',
      );
      const metadata = await readFile(metadataPath, 'utf-8');
      await writeFile(
        metadataPath,
        metadata.replace(
          /^(\s*)status: scheduled$/mu,
          [
            '$1status: occurred',
            '$1occurredEventIds:',
            '$1  - ghost-event',
            '$1resolvedAtTurnId: ghost-turn',
          ].join('\n'),
        ),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('cannot start terminal');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('keeps scheduled event heads scoped to the selected sibling branch', () => {
    const seed = createPlaySessionDraft({
      id: 'play-schedule-branches',
      title: 'Schedule branches',
      sceneStart: 'Station',
      characters: [],
      scheduledEvents: [{
        id: 'branch-deadline',
        label: 'Branch deadline',
        trigger: { type: 'nextTurn' },
        template: {
          kind: 'deadlineAdvanced',
          origin: 'clock',
          title: 'Deadline arrives',
          summary: 'The branch-local deadline arrives.',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }, {
        id: 'branch-flag',
        label: 'Branch flag',
        trigger: { type: 'flagEquals', path: 'flags.ready', value: true },
        template: {
          kind: 'environmentChanged',
          origin: 'environment',
          title: 'Flagged change',
          summary: 'A branch-local flag activates a change.',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
    });
    const root = addPlayTranscriptTurn(seed, {
      id: 'branch-root-message',
      speaker: 'narrator',
      content: 'The branches share this point.',
      createdAt: '2026-07-15T02:00:00.000Z',
    });
    const legacyArtifactSession = structuredClone(root);
    const legacyArtifact = legacyArtifactSession.turnArtifacts[0] as unknown as
      Record<string, unknown>;
    legacyArtifact.schemaVersion = 1;
    delete legacyArtifact.artifactKind;
    delete legacyArtifact.branchSnapshotVersion;
    delete legacyArtifact.scheduledEventIds;
    delete legacyArtifact.scheduledEventSnapshots;
    delete legacyArtifact.playLocalStateSnapshot;
    delete legacyArtifact.playLocalStateVisibilitySnapshot;
    legacyArtifactSession.branchSnapshotRequiredFromRevision = 1;
    legacyArtifactSession.branchBaseSnapshot = {
      parentTurnId: root.turnArtifacts[0]!.id,
      worldClock: structuredClone(root.turnArtifacts[0]!.worldClock!),
      playLocalState: structuredClone(
        root.turnArtifacts[0]!.playLocalStateSnapshot!,
      ),
      playLocalStateVisibility: structuredClone(
        root.turnArtifacts[0]!.playLocalStateVisibilitySnapshot!,
      ),
      scheduledEvents: structuredClone(
        root.turnArtifacts[0]!.scheduledEventSnapshots,
      ),
      suggestedActions: [...root.turnArtifacts[0]!.suggestedActions],
    };
    expect(evaluatePlaySessionDueEvents(legacyArtifactSession).dueEvents.map(
      (event) => event.id,
    )).toEqual(['branch-deadline']);

    const downgradedArtifactSession = structuredClone(root);
    const downgradedArtifact = downgradedArtifactSession.turnArtifacts[0] as
      unknown as Record<string, unknown>;
    downgradedArtifact.schemaVersion = 1;
    delete downgradedArtifact.artifactKind;
    delete downgradedArtifact.branchSnapshotVersion;
    delete downgradedArtifact.scheduledEventIds;
    delete downgradedArtifact.scheduledEventSnapshots;
    delete downgradedArtifact.playLocalStateSnapshot;
    delete downgradedArtifact.playLocalStateVisibilitySnapshot;
    expect(() => evaluatePlaySessionDueEvents(downgradedArtifactSession)).toThrow(
      'cannot downgrade below the branch snapshot watermark',
    );

    const nonAdvancingRoot = structuredClone(root);
    nonAdvancingRoot.revision = 0;
    nonAdvancingRoot.worldClock.revision = 0;
    nonAdvancingRoot.turnArtifacts[0]!.revision = 0;
    nonAdvancingRoot.turnArtifacts[0]!.worldClock!.revision = 0;
    expect(() => evaluatePlaySessionDueEvents(nonAdvancingRoot)).toThrow(
      'revision does not advance its predecessor',
    );

    const occurredBranch = settlePlayWorldRefereeResponse({
      session: root,
      userText: 'Wait on branch A.',
      actionKind: 'wait',
      createdAt: '2026-07-15T02:01:00.000Z',
      refereeResponse: [
        'The deadline bell rings.',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'deadlineAdvanced',
            origin: 'clock',
            title: 'Deadline arrives',
            summary: 'The branch-local deadline arrives.',
            visibility: 'playerVisible',
            cause: { reason: 'The deadline is due.', triggerId: 'branch-deadline' },
          }],
          stateDelta: { flags: { ready: true } },
        }),
        '```',
      ].join('\n'),
    });
    const pendingBranch = addPlayTranscriptTurn(root, {
      id: 'branch-b-message',
      speaker: 'narrator',
      content: 'Branch B has not advanced world time.',
      createdAt: '2026-07-15T02:01:30.000Z',
    });
    const pendingHead = pendingBranch.turnArtifacts.at(-1)!;
    pendingHead.id = 'turn-artifact-2b';
    pendingBranch.selectedTurnIds = ['turn-artifact-1', pendingHead.id];

    const selectedPendingBranch = {
      ...pendingBranch,
      turnArtifacts: [
        root.turnArtifacts[0]!,
        occurredBranch.turnArtifacts.at(-1)!,
        pendingHead,
      ],
      events: occurredBranch.events,
      scheduledEvents: structuredClone(pendingHead.scheduledEventSnapshots),
    };

    expect(evaluatePlaySessionDueEvents(selectedPendingBranch).dueEvents.map(
      (event) => event.id,
    )).toEqual(['branch-deadline']);
    expect(formatPlayWorldRefereePrompt(selectedPendingBranch)).toContain(
      'branch-deadline [priority 0/playerVisible]',
    );

    const pollutedBySibling = structuredClone(selectedPendingBranch);
    pollutedBySibling.scheduledEvents = structuredClone(
      occurredBranch.scheduledEvents,
    );
    expect(() => evaluatePlaySessionDueEvents(pollutedBySibling)).toThrow(
      'does not match the selected turn artifact head',
    );

    const siblingClock = structuredClone(selectedPendingBranch);
    siblingClock.worldClock = structuredClone(occurredBranch.worldClock);
    expect(() => evaluatePlaySessionDueEvents(siblingClock)).toThrow(
      'world clock does not match the selected turn artifact head',
    );

    const siblingState = structuredClone(selectedPendingBranch);
    siblingState.playLocalState = structuredClone(occurredBranch.playLocalState);
    expect(() => evaluatePlaySessionDueEvents(siblingState)).toThrow(
      'Play-local state does not match the selected turn artifact head',
    );

    const siblingSuggestions = structuredClone(selectedPendingBranch);
    siblingSuggestions.suggestedActions = ['Follow the sibling branch.'];
    expect(() => evaluatePlaySessionDueEvents(siblingSuggestions)).toThrow(
      'suggested actions do not match the selected turn artifact head',
    );
  });

  it('preserves reschedule and cancellation history as full artifact schedule heads', () => {
    const session = createPlaySessionDraft({
      id: 'play-schedule-history',
      title: 'Schedule history',
      sceneStart: 'Station',
      characters: [],
      scheduledEvents: [{
        id: 'manual-inspection',
        label: 'Manual inspection',
        trigger: { type: 'manual' },
        template: {
          kind: 'arrival',
          origin: 'npc',
          title: 'Inspector arrives',
          summary: 'An inspector enters the station.',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
    });
    const rescheduled = settlePlayWorldRefereeResponse({
      session,
      userText: 'Set a later time.',
      actionKind: 'do',
      createdAt: '2026-07-15T03:00:00.000Z',
      refereeResponse: [
        'The inspection is moved to a later watch.',
        '```oan-play-settlement',
        JSON.stringify({
          scheduledEventChanges: [{
            type: 'reschedule',
            scheduledEventId: 'manual-inspection',
            trigger: { type: 'afterTurns', turns: 2 },
            reason: 'The inspector was delayed.',
          }],
        }),
        '```',
      ].join('\n'),
    });
    const cancelled = settlePlayWorldRefereeResponse({
      session: rescheduled,
      userText: 'Cancel the visit.',
      actionKind: 'do',
      createdAt: '2026-07-15T03:01:00.000Z',
      refereeResponse: [
        'The visit is formally withdrawn.',
        '```oan-play-settlement',
        JSON.stringify({
          scheduledEventChanges: [{
            type: 'cancel',
            scheduledEventId: 'manual-inspection',
            reason: 'The inspection order was withdrawn.',
          }],
        }),
        '```',
      ].join('\n'),
    });

    expect(rescheduled.turnArtifacts.at(-1)?.scheduledEventSnapshots[0])
      .toMatchObject({
        status: 'scheduled',
        trigger: { type: 'afterTurns', turns: 2 },
        sourceTurnId: 'turn-1-referee',
        scheduledAtRevision: 1,
      });
    expect(cancelled.turnArtifacts.at(-1)?.scheduledEventSnapshots[0])
      .toMatchObject({
        status: 'cancelled',
        resolvedAtTurnId: 'turn-2-referee',
        resolutionReason: 'The inspection order was withdrawn.',
      });
    expect(cancelled.turnArtifacts[0]?.scheduledEventSnapshots[0]?.status)
      .toBe('scheduled');
    expect(evaluatePlaySessionDueEvents(cancelled).dueEvents).toEqual([]);
  });

  it('keeps v2 branch state deeply isolated and rejects forged artifact kinds', () => {
    const settled = settlePlayWorldRefereeResponse({
      session: createPlaySessionDraft({
        id: 'play-state-isolation',
        title: 'State isolation',
        sceneStart: 'Station',
        characters: [],
        scheduledEvents: [{
          id: 'state-flag',
          label: 'State flag',
          trigger: { type: 'flagEquals', path: 'flags.ready', value: true },
          template: {
            kind: 'environmentChanged',
            origin: 'environment',
            title: 'Flag change',
            summary: 'The flag changes the station.',
            visibility: 'playerVisible',
          },
          status: 'scheduled',
          scheduledAtTurn: 0,
          scheduledAtRevision: 0,
        }],
      }),
      userText: 'Check the flag.',
      actionKind: 'look',
      createdAt: '2026-07-15T03:20:00.000Z',
      refereeResponse: [
        'The flag remains lowered.',
        '```oan-play-settlement',
        JSON.stringify({ stateDelta: { flags: { ready: false } } }),
        '```',
      ].join('\n'),
    });
    const artifact = settled.turnArtifacts.at(-1)!;
    const sessionFlags = settled.playLocalState.flags as Record<string, unknown>;
    const snapshotFlags = artifact.playLocalStateSnapshot!.flags as
      Record<string, unknown>;
    const deltaFlags = artifact.stateDelta.flags as Record<string, unknown>;

    expect(sessionFlags).not.toBe(snapshotFlags);
    expect(sessionFlags).not.toBe(deltaFlags);
    expect(snapshotFlags).not.toBe(deltaFlags);
    sessionFlags.ready = true;
    expect(snapshotFlags.ready).toBe(false);
    expect(deltaFlags.ready).toBe(false);
    expect(() => evaluatePlaySessionDueEvents(settled)).toThrow(
      'Play-local state does not match the selected turn artifact head',
    );

    const visibilityMismatch = structuredClone(settled);
    (visibilityMismatch.playLocalState.flags as Record<string, unknown>).ready = false;
    visibilityMismatch.playLocalStateVisibility.flags = 'playerUnknown';
    expect(() => evaluatePlaySessionDueEvents(visibilityMismatch)).toThrow(
      'state visibility does not match the selected turn artifact head',
    );

    const root = addPlayTranscriptTurn(createPlaySessionDraft({
      id: 'play-artifact-kind',
      title: 'Artifact kind',
      sceneStart: 'Station',
      characters: [],
    }), {
      speaker: 'narrator',
      content: 'Root.',
      createdAt: '2026-07-15T03:21:00.000Z',
    });
    const forgedInput = addPlayTranscriptTurn(root, {
      speaker: 'narrator',
      content: 'Child.',
      createdAt: '2026-07-15T03:22:00.000Z',
    });
    forgedInput.turnArtifacts.at(-1)!.input = {
      kind: 'wait',
      raw: 'Forged action.',
    };
    expect(() => evaluatePlaySessionDueEvents(forgedInput)).toThrow(
      'invalid transcript append shape',
    );

    const forgedState = addPlayTranscriptTurn(root, {
      speaker: 'narrator',
      content: 'Another child.',
      createdAt: '2026-07-15T03:23:00.000Z',
    });
    forgedState.turnArtifacts.at(-1)!.stateDelta = { ready: true };
    forgedState.turnArtifacts.at(-1)!.playLocalStateSnapshot = { ready: true };
    forgedState.turnArtifacts.at(-1)!.playLocalStateVisibilitySnapshot = {
      ready: 'playerVisible',
    };
    forgedState.playLocalState = { ready: true };
    forgedState.playLocalStateVisibility = { ready: 'playerVisible' };
    expect(() => evaluatePlaySessionDueEvents(forgedState)).toThrow(
      'invalid transcript append shape',
    );
  });

  it('replays hard-due evidence from the predecessor snapshot', () => {
    const seed = createPlaySessionDraft({
      id: 'play-persisted-due-evidence',
      title: 'Persisted due evidence',
      sceneStart: 'Station',
      characters: [],
      scheduledEvents: [{
        id: 'slow-arrival',
        label: 'Slow arrival',
        trigger: { type: 'afterTurns', turns: 5 },
        template: {
          kind: 'arrival',
          origin: 'npc',
          title: 'Courier arrives',
          summary: 'The courier reaches the station.',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
    });
    const root = addPlayTranscriptTurn(seed, {
      speaker: 'narrator',
      content: 'The courier is still far away.',
      createdAt: '2026-07-15T03:40:00.000Z',
    });
    const valid = settlePlayWorldRefereeResponse({
      session: root,
      userText: 'Wait once.',
      actionKind: 'wait',
      createdAt: '2026-07-15T03:41:00.000Z',
      refereeResponse: [
        'One quiet watch passes.',
        '```oan-play-settlement',
        JSON.stringify({}),
        '```',
      ].join('\n'),
    });
    expect(() => formatPlayWorldRefereePrompt(valid)).not.toThrow();

    const forgedEarlyOccurrence = structuredClone(valid);
    const artifact = forgedEarlyOccurrence.turnArtifacts.at(-1)!;
    const forgedEvent = {
      id: 'turn-2-event-1',
      turnId: 'turn-2-referee',
      sequence: 1,
      kind: 'arrival' as const,
      origin: 'npc' as const,
      title: 'Courier arrives',
      summary: 'The courier reaches the station.',
      visibility: 'playerVisible' as const,
      cause: { reason: 'Forged early arrival.', triggerId: 'slow-arrival' },
      worldClock: structuredClone(artifact.worldClock!),
      createdAt: '2026-07-15T03:41:00.000Z',
      canonical: false as const,
    };
    forgedEarlyOccurrence.events.push(forgedEvent);
    artifact.eventIds.push(forgedEvent.id);
    artifact.dueScheduledEventIds.push('slow-arrival');
    Object.assign(artifact.scheduledEventSnapshots[0]!, {
      status: 'occurred',
      occurredEventIds: [forgedEvent.id],
      resolvedAtTurnId: 'turn-2-referee',
    });
    forgedEarlyOccurrence.scheduledEvents = structuredClone(
      artifact.scheduledEventSnapshots,
    );
    expect(() => formatPlayWorldRefereePrompt(forgedEarlyOccurrence)).toThrow(
      'hard-due evidence does not match its predecessor snapshot',
    );

    const forgedOmission = structuredClone(valid);
    forgedOmission.branchBaseSnapshot.scheduledEvents[0]!.trigger = {
      type: 'nextTurn',
    };
    forgedOmission.turnArtifacts[0]!.scheduledEventSnapshots[0]!.trigger = {
      type: 'nextTurn',
    };
    forgedOmission.turnArtifacts[1]!.scheduledEventSnapshots[0]!.trigger = {
      type: 'nextTurn',
    };
    forgedOmission.scheduledEvents = structuredClone(
      forgedOmission.turnArtifacts[1]!.scheduledEventSnapshots,
    );
    expect(() => formatPlayWorldRefereePrompt(forgedOmission)).toThrow(
      'hard-due evidence does not match its predecessor snapshot',
    );
  });

  it('rejects source-less schedule injection into complete empty branch heads', () => {
    const root = addPlayTranscriptTurn(createPlaySessionDraft({
      id: 'play-empty-schedule-head',
      title: 'Empty schedule head',
      sceneStart: 'Station',
      characters: [],
    }), {
      id: 'empty-head-root',
      speaker: 'narrator',
      content: 'No schedule exists.',
      createdAt: '2026-07-15T03:30:00.000Z',
    });
    const injectedSeed = {
      id: 'injected-seed',
      label: 'Injected seed',
      trigger: { type: 'manual' as const },
      template: {
        kind: 'manual' as const,
        origin: 'manual' as const,
        title: 'Injected',
        summary: 'This record was not created by a Play turn.',
        visibility: 'playerVisible' as const,
      },
      status: 'scheduled' as const,
      scheduledAtTurn: 0,
      scheduledAtRevision: 0,
    };

    const ledgerOnly = structuredClone(root);
    ledgerOnly.scheduledEvents = [structuredClone(injectedSeed)];
    expect(() => evaluatePlaySessionDueEvents(ledgerOnly)).toThrow(
      'does not match the selected turn artifact head',
    );

    const child = addPlayTranscriptTurn(root, {
      id: 'empty-head-child',
      speaker: 'narrator',
      content: 'The child also has no schedule.',
      createdAt: '2026-07-15T03:31:00.000Z',
    });
    child.turnArtifacts.at(-1)!.scheduledEventIds = [injectedSeed.id];
    child.turnArtifacts.at(-1)!.scheduledEventSnapshots = [
      structuredClone(injectedSeed),
    ];
    child.scheduledEvents = [structuredClone(injectedSeed)];
    expect(() => evaluatePlaySessionDueEvents(child)).toThrow(
      'transcript append changes the schedule head',
    );
  });

  it('rejects tampered scheduled event lifecycle evidence', () => {
    const seed = createPlaySessionDraft({
      id: 'play-schedule-tamper',
      title: 'Schedule tamper',
      sceneStart: 'Station',
      characters: [],
      scheduledEvents: [{
        id: 'tamper-deadline',
        label: 'Tamper deadline',
        trigger: { type: 'nextTurn' },
        template: {
          kind: 'deadlineAdvanced',
          origin: 'clock',
          title: 'Deadline arrives',
          summary: 'The deadline arrives.',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
    });
    const root = addPlayTranscriptTurn(seed, {
      id: 'tamper-root-message',
      speaker: 'narrator',
      content: 'Before the deadline.',
      createdAt: '2026-07-15T04:00:00.000Z',
    });
    const valid = settlePlayWorldRefereeResponse({
      session: root,
      userText: 'Wait.',
      actionKind: 'wait',
      createdAt: '2026-07-15T04:01:00.000Z',
      refereeResponse: [
        'The deadline arrives.',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'deadlineAdvanced',
            origin: 'clock',
            title: 'Deadline arrives',
            summary: 'The deadline arrives.',
            visibility: 'playerVisible',
            cause: { reason: 'Time advanced.', triggerId: 'tamper-deadline' },
          }],
        }),
        '```',
      ].join('\n'),
    });
    expect(() => formatPlayWorldRefereePrompt(valid)).not.toThrow();

    const changedPlan = structuredClone(valid);
    changedPlan.turnArtifacts.at(-1)!.scheduledEventSnapshots[0]!.trigger = {
      type: 'manual',
    };
    changedPlan.scheduledEvents = structuredClone(
      changedPlan.turnArtifacts.at(-1)!.scheduledEventSnapshots,
    );
    expect(() => formatPlayWorldRefereePrompt(changedPlan)).toThrow(
      'invalid occurred transition',
    );

    const unrelatedResolution = structuredClone(valid);
    unrelatedResolution.turnArtifacts.at(-1)!
      .scheduledEventSnapshots[0]!.resolvedAtTurnId = 'tamper-root-message';
    unrelatedResolution.scheduledEvents = structuredClone(
      unrelatedResolution.turnArtifacts.at(-1)!.scheduledEventSnapshots,
    );
    expect(() => formatPlayWorldRefereePrompt(unrelatedResolution)).toThrow(
      'out-of-branch resolution turn',
    );

    const futureRevision = structuredClone(valid);
    futureRevision.turnArtifacts.at(-1)!
      .scheduledEventSnapshots[0]!.scheduledAtRevision = 99;
    futureRevision.scheduledEvents = structuredClone(
      futureRevision.turnArtifacts.at(-1)!.scheduledEventSnapshots,
    );
    expect(() => formatPlayWorldRefereePrompt(futureRevision)).toThrow(
      'future scheduledAtRevision',
    );

    const artifactClockMismatch = structuredClone(valid);
    artifactClockMismatch.turnArtifacts.at(-1)!.worldClock!.revision = 99;
    expect(() => formatPlayWorldRefereePrompt(artifactClockMismatch)).toThrow(
      'world clock revision does not match artifact revision',
    );

    const eventClockMismatch = structuredClone(valid);
    eventClockMismatch.events[0]!.worldClock.turn = 99;
    expect(() => formatPlayWorldRefereePrompt(eventClockMismatch)).toThrow(
      'world clock does not match artifact',
    );

    const templateMismatch = structuredClone(valid);
    templateMismatch.events[0]!.title = 'Forged deadline title';
    expect(() => formatPlayWorldRefereePrompt(templateMismatch)).toThrow(
      'does not match its host template',
    );

    const duplicateOccurrence = structuredClone(valid);
    const duplicateEvent = structuredClone(duplicateOccurrence.events[0]!);
    duplicateEvent.id = 'turn-2-event-2';
    duplicateEvent.sequence = 2;
    duplicateOccurrence.events.push(duplicateEvent);
    duplicateOccurrence.turnArtifacts.at(-1)!.eventIds.push(duplicateEvent.id);
    duplicateOccurrence.turnArtifacts.at(-1)!
      .scheduledEventSnapshots[0]!.occurredEventIds.push(duplicateEvent.id);
    duplicateOccurrence.scheduledEvents = structuredClone(
      duplicateOccurrence.turnArtifacts.at(-1)!.scheduledEventSnapshots,
    );
    expect(() => formatPlayWorldRefereePrompt(duplicateOccurrence)).toThrow(
      'must resolve to exactly one occurred event',
    );
  });

  it('rejects omitted, duplicate, or not-due scheduled triggers without mutation', () => {
    const session = createPlaySessionDraft({
      id: 'play-hard-due-validation',
      title: 'Hard due validation',
      sceneStart: 'Station',
      characters: [],
      scheduledEvents: [{
        id: 'due-alarm',
        label: 'Alarm',
        trigger: { type: 'nextTurn' },
        template: {
          kind: 'environmentChanged',
          origin: 'environment',
          title: '警报响起',
          summary: '警报按计划启动',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
    });
    const response = (events: unknown[]) => [
      '警报声穿过走廊。',
      '```oan-play-settlement',
      JSON.stringify({ events }),
      '```',
    ].join('\n');
    const dueEvent = {
      kind: 'environmentChanged',
      origin: 'environment',
      title: '警报响起',
      summary: '警报按计划启动',
      visibility: 'playerVisible',
      cause: { reason: '时点已到', triggerId: 'due-alarm' },
    };

    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: response([]),
    })).toThrow('omitted hard-due event: due-alarm');
    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: response([dueEvent, dueEvent]),
    })).toThrow('more than once: due-alarm');
    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: response([{
        ...dueEvent,
        cause: { reason: '伪造计划', triggerId: 'unknown-trigger' },
      }]),
    })).toThrow('not due: unknown-trigger');
    expect(session).toMatchObject({ revision: 0, transcript: [], events: [] });
    expect(session.scheduledEvents[0]).toMatchObject({ status: 'scheduled' });
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
        '走廊安静。',
        '{"events":[{"visibility":"playerUnknown","summary":"刺客在阁楼"}]}',
        '```oan-play-settlement',
        JSON.stringify({
          events: [],
          stateDelta: {},
          observations: [],
          suggestedActions: [],
        }),
        '```',
      ].join('\n'),
    })).toThrow('must not contain structured settlement data');
    expect(session).toMatchObject({ revision: 0, transcript: [], events: [] });

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

    const responseWithCause = (cause: Record<string, unknown>) => [
      '远处传来钟声。',
      '```oan-play-settlement',
      JSON.stringify({
        events: [{
          kind: 'deadlineAdvanced',
          origin: 'clock',
          title: '钟声',
          summary: '时间继续推进',
          visibility: 'playerVisible',
          cause: { reason: '时间流逝', ...cause },
        }],
      }),
      '```',
    ].join('\n');
    expect(() => settlePlayWorldRefereeResponse({
      session,
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: responseWithCause({
        sourceTurnIds: ['turn-1-user', 'turn-1-user'],
      }),
    })).toThrow('sourceTurnIds must not contain duplicates');
    for (const cause of [
      { pressureId: 'guard pressure' },
      { agendaId: 'npc:alice' },
    ]) {
      expect(() => settlePlayWorldRefereeResponse({
        session,
        userText: '等待。',
        actionKind: 'wait',
        refereeResponse: responseWithCause(cause),
      })).toThrow('Invalid Play event cause');
    }
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

  it('allows visible consequences to cite hidden author-only causes', () => {
    const hidden = settlePlayWorldRefereeResponse({
      session: createPlaySessionDraft({
        id: 'play-hidden-provenance',
        title: 'Hidden provenance',
        sceneStart: 'Scene',
        characters: [],
      }),
      userText: '等待。',
      actionKind: 'wait',
      refereeResponse: [
        '走廊仍然安静。',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'npcActed',
            origin: 'npc',
            title: '暗中换岗',
            summary: '守卫在玩家视野外换岗',
            visibility: 'playerUnknown',
            cause: { reason: '例行安排' },
          }],
          observations: [{ summary: '守卫已换岗', evidence: '隐藏事件' }],
        }),
        '```',
      ].join('\n'),
    });
    const hiddenEventId = hidden.events[0]!.id;

    const visibleConsequence = settlePlayWorldRefereeResponse({
      session: hidden,
      userText: '继续等待。',
      actionKind: 'wait',
      refereeResponse: [
        '钟声响起。',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'informationSpread',
            origin: 'environment',
            title: '换岗消息',
            summary: '玩家直接得知守卫已经换岗',
            visibility: 'playerVisible',
            cause: {
              reason: '引用隐藏事件但没有显式揭示证据',
              sourceEventIds: [hiddenEventId],
            },
          }],
        }),
        '```',
      ].join('\n'),
    });
    expect(visibleConsequence.events.at(-1)).toMatchObject({
      visibility: 'playerVisible',
      cause: { sourceEventIds: [hiddenEventId] },
    });

    const withManualObservation = addPlayObservation(hidden, {
      id: 'manual-visible-observation',
      summary: '守卫已经换岗',
      evidence: '直接引用隐藏事件',
      visibility: 'playerVisible',
      sourceTurnIds: [],
      sourceEventIds: [hiddenEventId],
      canonical: false,
    });
    expect(withManualObservation.observations.at(-1)?.visibility)
      .toBe('playerVisible');

    const withVisibleCandidate = addPlayAdoptionCandidate(
      hidden,
      createPlayAdoptionCandidate({
      id: 'visible-hidden-adoption',
      target: 'chapterDraft',
      summary: '公开隐藏换岗',
      evidence: '引用隐藏 observation',
      visibility: 'playerVisible',
      sourceObservationIds: [hidden.observations[0]!.id],
      }),
    );
    expect(withVisibleCandidate.adoptionCandidates.at(-1)?.visibility)
      .toBe('playerVisible');
  });

  it('scopes manual observations and adoption candidates to the selected branch', () => {
    const root = addPlayTranscriptTurn(createPlaySessionDraft({
      id: 'play-manual-provenance-branch',
      title: 'Manual provenance branch',
      sceneStart: 'Scene',
      characters: [],
    }), {
      id: 'branch-root-message',
      speaker: 'narrator',
      content: 'Root.',
      createdAt: '2026-07-15T04:00:00.000Z',
    });
    const selectedBranch = addPlayTranscriptTurn(root, {
      id: 'branch-a-message',
      speaker: 'narrator',
      content: 'Selected branch.',
      createdAt: '2026-07-15T04:01:00.000Z',
    });
    selectedBranch.turnArtifacts.at(-1)!.id = 'turn-artifact-2a';
    selectedBranch.selectedTurnIds = ['turn-artifact-1', 'turn-artifact-2a'];
    const siblingBranch = settlePlayWorldRefereeResponse({
      session: root,
      userText: '走向另一条路。',
      actionKind: 'move',
      createdAt: '2026-07-15T04:02:00.000Z',
      refereeResponse: [
        '另一条路上传来脚步声。',
        '```oan-play-settlement',
        JSON.stringify({
          events: [{
            kind: 'arrival',
            origin: 'npc',
            title: '陌生人抵达',
            summary: '陌生人抵达另一条分支',
            visibility: 'playerVisible',
            cause: { reason: '沿路赶来' },
          }],
          observations: [{ summary: '陌生人已抵达', evidence: '分支事件' }],
        }),
        '```',
      ].join('\n'),
    });
    const siblingArtifact = siblingBranch.turnArtifacts.at(-1)!;
    const siblingWithManualObservation = addPlayObservation(siblingBranch, {
      id: 'historical-sibling-observation',
      summary: 'Historical sibling observation',
      evidence: 'Sibling event',
      visibility: 'playerVisible',
      sourceTurnIds: [],
      sourceEventIds: [siblingBranch.events[0]!.id],
      canonical: false,
    });
    const siblingWithCandidate = addPlayAdoptionCandidate(
      siblingWithManualObservation,
      createPlayAdoptionCandidate({
        id: 'historical-sibling-candidate',
        target: 'chapterDraft',
        summary: 'Historical sibling fact',
        evidence: 'Sibling observation',
        sourceObservationIds: ['historical-sibling-observation'],
      }),
    );
    const combined = {
      ...selectedBranch,
      turnArtifacts: [
        selectedBranch.turnArtifacts[0]!,
        selectedBranch.turnArtifacts[1]!,
        siblingArtifact,
      ],
      events: siblingBranch.events,
      observations: siblingWithManualObservation.observations,
      adoptionCandidates: siblingWithCandidate.adoptionCandidates,
    };
    const manualObservation = (sources: {
      sourceTurnIds?: string[];
      sourceEventIds?: string[];
    }) => ({
      id: `manual-${sources.sourceTurnIds?.length ? 'turn' : 'event'}`,
      summary: 'Sibling fact',
      evidence: 'Sibling branch',
      visibility: 'playerVisible' as const,
      sourceTurnIds: sources.sourceTurnIds ?? [],
      sourceEventIds: sources.sourceEventIds ?? [],
      canonical: false as const,
    });

    expect(() => evaluatePlaySessionDueEvents(combined)).not.toThrow();
    const mixedBranches = structuredClone(combined);
    mixedBranches.observations.push({
      id: 'mixed-branch-observation',
      summary: 'Mixed branches',
      evidence: 'Invalid cross-branch provenance',
      visibility: 'playerVisible',
      sourceTurnIds: ['branch-a-message'],
      sourceEventIds: [siblingBranch.events[0]!.id],
      canonical: false,
    });
    expect(() => evaluatePlaySessionDueEvents(mixedBranches))
      .toThrow('mixes facts from incompatible Play branches');

    expect(() => addPlayObservation(combined, manualObservation({
      sourceTurnIds: ['turn-2-referee'],
    }))).toThrow('out-of-branch turn');
    expect(() => addPlayObservation(combined, manualObservation({
      sourceEventIds: [siblingBranch.events[0]!.id],
    }))).toThrow('out-of-branch event');

    for (const candidate of [
      createPlayAdoptionCandidate({
        id: 'sibling-turn-candidate',
        target: 'chapterDraft',
        summary: 'Sibling turn',
        evidence: 'Sibling branch',
        sourceTurnIds: ['turn-2-referee'],
      }),
      createPlayAdoptionCandidate({
        id: 'sibling-event-candidate',
        target: 'chapterDraft',
        summary: 'Sibling event',
        evidence: 'Sibling branch',
        sourceEventIds: [siblingBranch.events[0]!.id],
      }),
      createPlayAdoptionCandidate({
        id: 'sibling-observation-candidate',
        target: 'chapterDraft',
        summary: 'Sibling observation',
        evidence: 'Sibling branch',
        sourceObservationIds: [siblingBranch.observations[0]!.id],
      }),
    ]) {
      expect(() => addPlayAdoptionCandidate(combined, candidate))
        .toThrow('out-of-branch');
    }
  });

  it('rejects missing or duplicate in-memory candidate visibility evidence', () => {
    const session = createPlaySessionDraft({
      id: 'play-candidate-integrity',
      title: 'Candidate integrity',
      sceneStart: 'Scene',
      characters: [],
    });
    expect(() => addPlayAdoptionCandidate(session, {
      id: 'missing-visibility',
      target: 'chapterDraft',
      summary: 'Missing visibility',
      evidence: 'Malformed caller payload',
      sourceObservationIds: [],
      sourceTurnIds: [],
      sourceEventIds: [],
      requiresPendingAction: true,
    } as never)).toThrow('requires a valid visibility');

    expect(() => addPlayAdoptionCandidate(session, createPlayAdoptionCandidate({
      id: 'duplicate-provenance',
      target: 'chapterDraft',
      summary: 'Duplicate provenance',
      evidence: 'Malformed caller payload',
      sourceObservationIds: ['obs-duplicate', 'obs-duplicate'],
    }))).toThrow('sourceObservationIds must not contain duplicates');
    expect(session).toMatchObject({
      revision: 0,
      adoptionCandidates: [],
    });

    expect(() => addPlayObservation(session, {
      id: 'invalid-canonical-observation',
      summary: 'Invalid boundary',
      evidence: 'Malformed caller payload',
      visibility: 'playerVisible',
      sourceTurnIds: [],
      sourceEventIds: [],
      canonical: true,
    } as never)).toThrow('must remain non-canonical');
    expect(() => addPlayAdoptionCandidate(session, {
      id: 'invalid-pending-candidate',
      target: 'chapterDraft',
      summary: 'Invalid boundary',
      evidence: 'Malformed caller payload',
      visibility: 'playerVisible',
      sourceObservationIds: [],
      sourceTurnIds: [],
      sourceEventIds: [],
      requiresPendingAction: false,
    } as never)).toThrow('must require a PendingAction');

    const first = addPlayAdoptionCandidate(session, createPlayAdoptionCandidate({
      id: 'duplicate-candidate',
      target: 'chapterDraft',
      summary: 'First',
      evidence: 'First evidence',
    }));
    expect(() => addPlayAdoptionCandidate(first, createPlayAdoptionCandidate({
      id: 'duplicate-candidate',
      target: 'state',
      summary: 'Second',
      evidence: 'Second evidence',
    }))).toThrow('duplicate id: duplicate-candidate');
  });

  it('previews and preserves a legacy Play session while projecting v4 turn facts', async () => {
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
          toSchemaVersion: 4,
          unknownMetadataKeys: ['customLegacyField'],
          legacyTranscriptCount: 1,
          projectedTurnCount: 1,
          generatedTurnIds: ['legacy-turn-0001'],
        });

      const migrated = await readPlaySessionFiles(workspaceRoot, 'legacy-play');
      expect(migrated).toMatchObject({
        schemaVersion: 4,
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
        '.migrations/v1-to-v4/original/session.yaml',
      ), 'utf-8')).resolves.toContain('transcript:');
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v1-to-v4/preview.yaml',
      ), 'utf-8')).resolves.toContain('customLegacyField');
      await writePlaySessionFiles(
        workspaceRoot,
        await readPlaySessionFiles(workspaceRoot, 'legacy-play'),
      );
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v1-to-v4/original/session.yaml',
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
          toSchemaVersion: 4,
          unknownMetadataKeys: ['extensionPayload'],
        });

      const session = await readPlaySessionFiles(workspaceRoot, 'v2-play');
      await writePlaySessionFiles(workspaceRoot, session);

      await expect(readFile(join(sessionRoot, 'session.yaml'), 'utf-8'))
        .resolves
        .toContain('mode: preserve');
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v2-to-v4/original/session.yaml',
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
        '    sourceTurnIds: [turn-1-referee, turn-2-referee]',
        '    sourceEventIds: []',
        '    canonical: false',
        '',
      ].join('\n'), 'utf-8');
      await writeFile(join(sessionRoot, 'play-local-state.yaml'), [
        'mood: calm',
        '',
      ].join('\n'), 'utf-8');
      await writeFile(join(sessionRoot, 'adoption-candidates.yaml'), [
        'adoptionCandidates:',
        '  - id: adopt-cross',
        '    target: chapterDraft',
        '    summary: Adopt cross-turn pattern',
        '    evidence: Legacy observation',
        '    sourceObservationIds: [obs-cross]',
        '    sourceTurnIds: []',
        '    sourceEventIds: []',
        '    requiresPendingAction: true',
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
      expect(session.observations[0]?.visibility).toBe('playerVisible');
      expect(session.playLocalStateVisibility).toEqual({ mood: 'playerVisible' });
      expect(session.adoptionCandidates[0]).toMatchObject({
        id: 'adopt-cross',
        visibility: 'playerVisible',
      });
      await expect(writePlaySessionFiles(workspaceRoot, session)).resolves.toBeTruthy();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('backs up schema v3 before adding the required branch base snapshot', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-v3-migration-'));
    const sessionRoot = join(workspaceRoot, '.workspace/play-sessions/v3-play');

    try {
      await mkdir(sessionRoot, { recursive: true });
      await writeFile(join(sessionRoot, 'session.yaml'), [
        'schemaVersion: 3',
        'id: v3-play',
        'title: V3 Play',
        'createdAt: 2026-06-19T00:00:00.000Z',
        'revision: 0',
        'sceneStart: Old scene',
        'characters: []',
        'selectedTurnIds: []',
        'worldClock:',
        '  turn: 0',
        '  revision: 0',
        '',
      ].join('\n'), 'utf-8');

      await expect(previewPlaySessionMigration(workspaceRoot, 'v3-play'))
        .resolves
        .toMatchObject({
          fromSchemaVersion: 3,
          toSchemaVersion: 4,
          projectedTurnCount: 0,
          backupRelativePath: '.migrations/v3-to-v4/original',
        });

      const session = await readPlaySessionFiles(workspaceRoot, 'v3-play');
      expect(session).toMatchObject({
        schemaVersion: 4,
        branchSnapshotRequiredFromRevision: 0,
        branchBaseSnapshot: {
          worldClock: { turn: 0, revision: 0 },
          scheduledEvents: [],
        },
      });
      await writePlaySessionFiles(workspaceRoot, session);
      await expect(readFile(join(
        sessionRoot,
        '.migrations/v3-to-v4/original/session.yaml',
      ), 'utf-8')).resolves.toContain('schemaVersion: 3');
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
        .toContain('schemaVersion: 4');

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
        stored.replace(/schemaVersion: \d+/, 'schemaVersion: 999'),
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
