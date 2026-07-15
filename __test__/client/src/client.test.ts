import { describe, expect, it, vi } from 'vitest';

import {
  createOanClient,
  type OanDesktopBridge,
  type PlayAdoptionCandidate,
  type PlayObservation,
  type PlayScheduledEvent,
  type PlayTurnStreamEvent,
  type PlayWorldEvent,
} from '@oh-awesome-novel/client';

describe('createOanClient', () => {
  it('routes workspace requests through the configured HTTP base URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = url.endsWith('/api/workspace/play-sessions')
        ? { session: createEmptyPlaySessionEnvelope(), files: [] }
        : url.endsWith('/world-referee-turn')
          ? { session: createEmptyPlaySessionEnvelope() }
          : { workspaces: [], providerConfigured: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test/',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });

    await client.listWorkspaces();
    await client.importWorkspace('/novels/demo');
    await client.rebuildProjections();
    await client.createPlaySession({
      title: 'Play',
      sceneStart: 'Scene',
    });
    await client.runPlayWorldRefereeTurn('play-1', {
      userText: '等待两小时',
      actionKind: 'wait',
      baseRevision: 0,
    });
    await client.createPlayAdoptionPendingAction('play-1', 'adopt-1', {
      chapterId: '0001/0002',
      content: '正文',
    });

    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspaces',
      init: { method: 'GET' },
    });
    expect(calls[1]).toMatchObject({
      url: 'http://backend.test/api/workspaces/import',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      path: '/novels/demo',
    });
    expect(calls[2]).toMatchObject({
      url: 'http://backend.test/api/workspace/projections/rebuild',
      init: { method: 'POST' },
    });
    expect(calls[3]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions',
      init: { method: 'POST' },
    });
    expect(calls[4]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/world-referee-turn',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[4]?.init?.body))).toEqual({
      userText: '等待两小时',
      actionKind: 'wait',
      baseRevision: 0,
    });
    expect(calls[5]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/adoption-candidates/adopt-1/pending-action',
      init: { method: 'POST' },
    });
  });

  it('routes Play checkpoint list and restore through typed client methods', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const restorePayload = createPlayCheckpointRestorePayload();
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = url.endsWith('/restore')
        ? restorePayload
        : { checkpoints: restorePayload.checkpoints };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });

    await expect(client.listPlayCheckpoints('play-1')).resolves.toEqual({
      checkpoints: restorePayload.checkpoints,
    });
    await expect(client.restorePlayCheckpoint(
      'play-1',
      'turn-artifact-1',
      { baseRevision: 1 },
    )).resolves.toEqual(restorePayload);

    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/checkpoints',
      init: { method: 'GET' },
    });
    expect(calls[1]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/checkpoints/turn-artifact-1/restore',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ baseRevision: 1 });
  });

  it('surfaces backend error messages from JSON error responses', async () => {
    const client = createOanClient({
      fetch: createFetchMock([], { error: 'Workspace missing.' }, 404),
      systemTheme: () => 'dark',
    });

    await expect(client.getWorkspaceStatus()).rejects.toThrow('Workspace missing.');
  });

  it('parses typed Play turn SSE events without treating provisional text as a session', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const onTurnId = vi.fn();
    const encoded = new TextEncoder();
    const frames = [
      'event: play.turn.started\n',
      'data: {"type":"play.turn.started","eventId":"run-1:1","sequence":1,"sessionId":"play-1","turnId":"run-1","baseRevision":0,"expectedArtifactId":"turn-artifact-1"}\n\n',
      'event: play.narrative.delta\n',
      'data: {"type":"play.narrative.delta","eventId":"run-1:2","sequence":2,"sessionId":"play-1","turnId":"run-1","delta":"雨声逼近。","provisional":true}\n\n',
      'event: play.turn.cancelled\n',
      'data: {"type":"play.turn.cancelled","eventId":"run-1:3","sequence":3,"sessionId":"play-1","turnId":"run-1","committed":false,"revision":0,"reason":"user"}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.encode(frames.slice(0, 37)));
          controller.enqueue(encoded.encode(frames.slice(37, 149)));
          controller.enqueue(encoded.encode(frames.slice(149)));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'X-OAN-Play-Turn-Id': 'run-1',
        },
      });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });
    const events: PlayTurnStreamEvent[] = [];

    for await (const event of client.streamPlayWorldRefereeTurn('play-1', {
      userText: '等待',
      actionKind: 'wait',
      baseRevision: 0,
    }, { onTurnId })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'play.turn.started',
      'play.narrative.delta',
      'play.turn.cancelled',
    ]);
    expect(events[1]).toMatchObject({ delta: '雨声逼近。', provisional: true });
    expect(onTurnId).toHaveBeenCalledOnce();
    expect(onTurnId).toHaveBeenCalledWith('run-1');
    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/turns/stream',
      init: { method: 'POST' },
    });
  });

  it('rejects malformed variant payloads in typed Play turn events', async () => {
    const encoded = new TextEncoder();
    const client = createOanClient({
      fetch: (async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.encode(
            'data: {"type":"play.turn.committed","eventId":"run-1:3","sequence":3,"sessionId":"play-1","turnId":"run-1","revision":1}\n\n',
          ));
          controller.close();
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });

    const consume = async () => {
      for await (const _event of client.streamPlayWorldRefereeTurn('play-1', {
        userText: '等待',
        baseRevision: 0,
      })) {
        // The parser must reject before yielding the malformed terminal event.
      }
    };

    await expect(consume()).rejects.toThrow('invalid play.turn.committed event');
  });

  it('parses committed world-event notifications with strict event enums', async () => {
    const encoded = new TextEncoder();
    const event = {
      type: 'play.event.occurred',
      eventId: 'run-1:6',
      sequence: 6,
      sessionId: 'play-1',
      turnId: 'run-1',
      revision: 1,
      event: {
        id: 'turn-1-event-1',
        turnId: 'turn-1-referee',
        sequence: 1,
        kind: 'factionActed',
        origin: 'faction',
        title: '封锁开始',
        summary: '站台出口关闭',
        visibility: 'playerVisible',
        cause: { reason: '计划到期', triggerId: 'deadline-lockdown' },
        worldClock: { turn: 1, revision: 1 },
        createdAt: '2026-07-15T01:00:00.000Z',
        canonical: false,
      },
    };
    const client = createOanClient({
      fetch: (async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.encode(
            `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,
          ));
          controller.close();
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    const events: PlayTurnStreamEvent[] = [];

    for await (const item of client.streamPlayWorldRefereeTurn('play-1', {
      userText: '等待',
      baseRevision: 0,
    })) {
      events.push(item);
    }

    expect(events).toEqual([event]);

    const malformedClient = createOanClient({
      fetch: (async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.encode(
            `data: ${JSON.stringify({
              ...event,
              event: { ...event.event, kind: 'inventedEventKind' },
            })}\n\n`,
          ));
          controller.close();
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });

    const consumeMalformed = async () => {
      for await (const _item of malformedClient.streamPlayWorldRefereeTurn('play-1', {
        userText: '等待',
        baseRevision: 0,
      })) {
        // Invalid enums must be rejected before the event reaches consumers.
      }
    };
    await expect(consumeMalformed()).rejects.toThrow('invalid play.event.occurred event');
  });

  it('rejects unsafe or internally inconsistent committed world events', async () => {
    const valid = createPlayOccurredPayload();
    const malformedPayloads = [
      {
        ...valid,
        revision: valid.revision + 1,
      },
      {
        ...valid,
        diagnostic: 'must not cross the network boundary',
      },
      {
        ...valid,
        event: { ...valid.event, sequence: 0 },
      },
      {
        ...valid,
        event: { ...valid.event, unexpected: true },
      },
      {
        ...valid,
        event: {
          ...valid.event,
          cause: {
            reason: '重复引用',
            sourceEventIds: ['event-1', 'event-1'],
          },
        },
      },
      {
        ...valid,
        event: {
          ...valid.event,
          cause: {
            reason: '不安全触发器',
            triggerId: '../deadline-lockdown',
          },
        },
      },
    ];

    for (const payload of malformedPayloads) {
      await expect(consumePlaySsePayload(payload))
        .rejects
        .toThrow('invalid play.event.occurred event');
    }
  });

  it('validates scheduled event ids, triggers, fields and uniqueness in committed sessions', async () => {
    const scheduledEvent = createScheduledPlayEvent();
    const valid = createPlayCommittedPayload([scheduledEvent]);

    await expect(consumePlaySsePayload(valid)).resolves.toEqual([valid]);

    const malformedSchedules = [
      [
        {
          ...scheduledEvent,
          trigger: {
            type: 'flagEquals',
            path: 'world.__proto__.ready',
            value: true,
          },
        },
      ],
      [
        {
          ...scheduledEvent,
          trigger: { type: 'nextTurn', command: 'override' },
        },
      ],
      [
        {
          ...scheduledEvent,
          extraField: true,
        },
      ],
      [
        {
          ...scheduledEvent,
          id: '../deadline-lockdown',
        },
      ],
      [scheduledEvent, { ...scheduledEvent }],
      [
        {
          ...scheduledEvent,
          status: 'occurred',
          occurredEventIds: ['turn-2-event-1', 'turn-2-event-1'],
          resolvedAtTurnId: 'turn-2-referee',
        },
      ],
    ];

    for (const scheduledEvents of malformedSchedules) {
      await expect(consumePlaySsePayload(createPlayCommittedPayload(scheduledEvents)))
        .rejects
        .toThrow('invalid play.turn.committed event');
    }
  });

  it('rejects a hard-due schedule resolved by a second distinct event', async () => {
    const valid = createOccurredScheduledPlayCommittedPayload();
    await expect(consumePlaySsePayload(valid)).resolves.toEqual([valid]);

    const malformed = structuredClone(valid);
    const secondEvent = {
      ...malformed.session.events[0],
      id: 'turn-1-event-2',
      sequence: 2,
    };
    malformed.session.events.push(secondEvent);
    malformed.session.turnArtifacts[0].eventIds.push(secondEvent.id);
    const occurredSchedule = malformed.session.turnArtifacts[0]
      .scheduledEventSnapshots[0] as {
        occurredEventIds: string[];
      };
    occurredSchedule.occurredEventIds.push(secondEvent.id);

    await expect(consumePlaySsePayload(malformed))
      .rejects
      .toThrow('invalid play.turn.committed event');
  });

  it('rejects a child schedule head that deletes a pending predecessor', async () => {
    const malformed = createPlayCommittedPayload([createScheduledPlayEvent()]);
    malformed.session.turnArtifacts[0].scheduledEventIds = [];
    malformed.session.turnArtifacts[0].scheduledEventSnapshots = [];
    malformed.session.scheduledEvents = [];

    await expect(consumePlaySsePayload(malformed))
      .rejects
      .toThrow('invalid play.turn.committed event');
  });

  it('requires current referee evidence for schedule creation and rescheduling', async () => {
    const validCreation = createCurrentTurnScheduleCreationPayload();
    const validReschedule = createCurrentTurnReschedulePayload();
    await expect(consumePlaySsePayload(validCreation))
      .resolves
      .toEqual([validCreation]);
    await expect(consumePlaySsePayload(validReschedule))
      .resolves
      .toEqual([validReschedule]);

    const sourceLess = structuredClone(validCreation);
    delete (sourceLess.session.turnArtifacts[0]
      .scheduledEventSnapshots[0] as Record<string, unknown>).sourceTurnId;
    delete (sourceLess.session.scheduledEvents[0] as Record<string, unknown>)
      .sourceTurnId;

    const changedLabel = structuredClone(validReschedule);
    (changedLabel.session.turnArtifacts[0]
      .scheduledEventSnapshots[0] as { label: string }).label = '伪造标题';
    (changedLabel.session.scheduledEvents[0] as { label: string }).label =
      '伪造标题';

    const changedTemplate = structuredClone(validReschedule);
    (changedTemplate.session.turnArtifacts[0]
      .scheduledEventSnapshots[0] as { template: { title: string } })
      .template.title = '伪造后果';
    (changedTemplate.session.scheduledEvents[0] as {
      template: { title: string };
    }).template.title = '伪造后果';

    for (const malformed of [sourceLess, changedLabel, changedTemplate]) {
      await expect(consumePlaySsePayload(malformed))
        .rejects
        .toThrow('invalid play.turn.committed event');
    }
  });

  it('keeps occurred and cancelled schedule plans immutable and referee-owned', async () => {
    const validOccurred = createOccurredScheduledPlayCommittedPayload();
    const validCancelled = createCancelledScheduledPlayCommittedPayload();
    await expect(consumePlaySsePayload(validOccurred))
      .resolves
      .toEqual([validOccurred]);
    await expect(consumePlaySsePayload(validCancelled))
      .resolves
      .toEqual([validCancelled]);

    const changedOccurredTrigger = structuredClone(validOccurred);
    (changedOccurredTrigger.session.turnArtifacts[0]
      .scheduledEventSnapshots[0] as { trigger: { type: string } }).trigger = {
      type: 'manual',
    };
    (changedOccurredTrigger.session.scheduledEvents[0] as {
      trigger: { type: string };
    }).trigger = { type: 'manual' };

    const changedCancelledTemplate = structuredClone(validCancelled);
    (changedCancelledTemplate.session.turnArtifacts[0]
      .scheduledEventSnapshots[0] as { template: { title: string } })
      .template.title = '伪造取消目标';
    (changedCancelledTemplate.session.scheduledEvents[0] as {
      template: { title: string };
    }).template.title = '伪造取消目标';

    const ghostCancellation = structuredClone(validCancelled);
    (ghostCancellation.session.turnArtifacts[0]
      .scheduledEventSnapshots[0] as { resolvedAtTurnId: string })
      .resolvedAtTurnId = 'ghost-referee';
    (ghostCancellation.session.scheduledEvents[0] as {
      resolvedAtTurnId: string;
    }).resolvedAtTurnId = 'ghost-referee';

    for (const malformed of [
      changedOccurredTrigger,
      changedCancelledTemplate,
      ghostCancellation,
    ]) {
      await expect(consumePlaySsePayload(malformed))
        .rejects
        .toThrow('invalid play.turn.committed event');
    }
  });

  it('validates observation and adoption provenance and candidate ids', async () => {
    const valid = createPlayFactProvenancePayload();
    await expect(consumePlaySsePayload(valid)).resolves.toEqual([valid]);

    const visibleObservation = structuredClone(valid);
    visibleObservation.session.observations[0].visibility = 'playerVisible';
    await expect(consumePlaySsePayload(visibleObservation))
      .resolves
      .toEqual([visibleObservation]);

    const visibleCandidate = structuredClone(valid);
    visibleCandidate.session.adoptionCandidates[0].visibility = 'playerVisible';
    await expect(consumePlaySsePayload(visibleCandidate))
      .resolves
      .toEqual([visibleCandidate]);

    const unknownObservationSource = structuredClone(valid);
    unknownObservationSource.session.adoptionCandidates[0]
      .sourceObservationIds = ['missing-observation'];

    const unknownEventSource = structuredClone(valid);
    unknownEventSource.session.observations[0].sourceEventIds = ['missing-event'];

    const duplicateCandidate = structuredClone(valid);
    duplicateCandidate.session.adoptionCandidates.push(structuredClone(
      duplicateCandidate.session.adoptionCandidates[0],
    ));

    for (const malformed of [
      unknownObservationSource,
      unknownEventSource,
      duplicateCandidate,
    ]) {
      await expect(consumePlaySsePayload(malformed))
        .rejects
        .toThrow('invalid play.turn.committed event');
    }
  });

  it('accepts only pristine scheduled seeds in branch bases', async () => {
    const pending = createScheduledPlayEvent();
    const valid = createEmptyPlayCommittedPayload([pending]);
    await expect(consumePlaySsePayload(valid)).resolves.toEqual([valid]);

    const occurredSeed = {
      ...pending,
      status: 'occurred',
      occurredEventIds: ['ghost-event'],
      resolvedAtTurnId: 'ghost-referee',
    } as PlayScheduledEvent;
    const cancelledSeed = {
      ...pending,
      status: 'cancelled',
      resolvedAtTurnId: 'ghost-referee',
      resolutionReason: '伪造的历史取消',
    } as PlayScheduledEvent;
    const sourcedSeed = {
      ...pending,
      sourceTurnId: 'ghost-referee',
      changeReason: '伪造的创建证据',
    };

    for (const scheduledEvents of [[occurredSeed], [cancelledSeed], [sourcedSeed]]) {
      await expect(consumePlaySsePayload(
        createEmptyPlayCommittedPayload(scheduledEvents),
      ))
        .rejects
        .toThrow('invalid play.turn.committed event');
    }

    const migrated = createEmptyPlayCommittedPayload([cancelledSeed], 1);
    await expect(consumePlaySsePayload(migrated))
      .rejects
      .toThrow('invalid play.turn.committed event');

    const migratedPending = createEmptyPlayCommittedPayload([pending], 1);
    await expect(consumePlaySsePayload(migratedPending))
      .resolves
      .toEqual([migratedPending]);
  });

  it('validates v2 branch snapshots and preserves explicit v1 compatibility', async () => {
    const valid = createPlayCommittedPayload([]);
    await expect(consumePlaySsePayload(valid)).resolves.toEqual([valid]);

    const missingKind = structuredClone(valid);
    delete (missingKind.session.turnArtifacts[0] as Record<string, unknown>)
      .artifactKind;
    await expect(consumePlaySsePayload(missingKind))
      .rejects
      .toThrow('invalid play.turn.committed event');

    const revisionMismatch = structuredClone(valid);
    revisionMismatch.session.worldClock.revision = 99;
    await expect(consumePlaySsePayload(revisionMismatch))
      .rejects
      .toThrow('invalid play.turn.committed event');

    const nonAdvancingRevision = structuredClone(valid);
    nonAdvancingRevision.revision = 0;
    nonAdvancingRevision.session.revision = 0;
    nonAdvancingRevision.session.worldClock.revision = 0;
    nonAdvancingRevision.session.turnArtifacts[0].revision = 0;
    nonAdvancingRevision.session.turnArtifacts[0].worldClock.revision = 0;
    await expect(consumePlaySsePayload(nonAdvancingRevision))
      .rejects
      .toThrow('invalid play.turn.committed event');

    const missingBase = structuredClone(valid);
    delete (missingBase.session as Record<string, unknown>).branchBaseSnapshot;
    await expect(consumePlaySsePayload(missingBase))
      .rejects
      .toThrow('invalid play.turn.committed event');

    const downgraded = structuredClone(valid);
    const downgradedArtifact = downgraded.session.turnArtifacts[0] as
      Record<string, unknown>;
    downgradedArtifact.schemaVersion = 1;
    delete downgradedArtifact.artifactKind;
    delete downgradedArtifact.branchSnapshotVersion;
    delete downgradedArtifact.playLocalStateSnapshot;
    delete downgradedArtifact.playLocalStateVisibilitySnapshot;
    await expect(consumePlaySsePayload(downgraded))
      .rejects
      .toThrow('invalid play.turn.committed event');

    const legacy = structuredClone(downgraded);
    legacy.session.branchSnapshotRequiredFromRevision = 1;
    legacy.session.branchBaseSnapshot = {
      parentTurnId: 'turn-artifact-1',
      worldClock: { turn: 1, revision: 1 },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    };

    const unanchoredLegacy = structuredClone(legacy);
    delete unanchoredLegacy.session.branchBaseSnapshot.parentTurnId;
    await expect(consumePlaySsePayload(unanchoredLegacy))
      .rejects
      .toThrow('invalid play.turn.committed event');

    await expect(consumePlaySsePayload(legacy)).resolves.toEqual([legacy]);
  });

  it('applies Play session guards to ordinary JSON APIs', async () => {
    const malformed = createEmptyPlaySessionEnvelope();
    malformed.worldClock.revision = 99;
    const listClient = createOanClient({
      fetch: createFetchMock([], { sessions: [malformed] }),
      systemTheme: () => 'dark',
    });
    await expect(listClient.listPlaySessions())
      .rejects
      .toThrow('Play session list returned an invalid payload');

    const getClient = createOanClient({
      fetch: createFetchMock([], { session: malformed }),
      systemTheme: () => 'dark',
    });
    await expect(getClient.getPlaySession('play-1'))
      .rejects
      .toThrow('Play session request returned an invalid payload');
  });

  it('rejects malformed Play checkpoint summaries at the network boundary', async () => {
    const valid = createPlayCheckpointRestorePayload().checkpoints[0]!;
    const malformed = [
      { ...valid, unexpected: true },
      { ...valid, artifactId: '../unsafe', selectedTurnIds: ['../unsafe'] },
      { ...valid, selectedTurnIds: [valid.artifactId, valid.artifactId] },
      { ...valid, parentArtifactId: 'not-the-path-parent' },
      { ...valid, revision: -1 },
      { ...valid, worldTurn: -1 },
      { ...valid, status: 'stale' },
      { ...valid, canonical: true },
      { ...valid, restorable: true },
    ];

    for (const checkpoint of malformed) {
      const client = createOanClient({
        fetch: createFetchMock([], { checkpoints: [checkpoint] }),
        systemTheme: () => 'dark',
      });
      await expect(client.listPlayCheckpoints('play-1'))
        .rejects
        .toThrow('Play checkpoint list returned an invalid payload');
    }

    for (const checkpoints of [
      [valid, structuredClone(valid)],
      [{ ...valid, status: 'variant', restorable: true }],
    ]) {
      const client = createOanClient({
        fetch: createFetchMock([], { checkpoints }),
        systemTheme: () => 'dark',
      });
      await expect(client.listPlayCheckpoints('play-1'))
        .rejects
        .toThrow('Play checkpoint list returned an invalid payload');
    }
  });

  it('rejects a Play checkpoint restore that disagrees with the returned session path', async () => {
    const payload = createPlayCheckpointRestorePayload();
    payload.checkpoints[0]!.selectedTurnIds = ['different-artifact'];
    payload.checkpoints[0]!.artifactId = 'different-artifact';
    const client = createOanClient({
      fetch: createFetchMock([], payload),
      systemTheme: () => 'dark',
    });

    await expect(client.restorePlayCheckpoint(
      'play-1',
      'turn-artifact-1',
      { baseRevision: 1 },
    ))
      .rejects
      .toThrow('Play checkpoint restore returned an inconsistent payload');

    const metadataMismatch = createPlayCheckpointRestorePayload();
    metadataMismatch.checkpoints[0]!.committedAt = '2026-07-15T02:00:00.000Z';
    const metadataClient = createOanClient({
      fetch: createFetchMock([], metadataMismatch),
      systemTheme: () => 'dark',
    });
    await expect(metadataClient.restorePlayCheckpoint(
      'play-1',
      'turn-artifact-1',
      { baseRevision: 1 },
    ))
      .rejects
      .toThrow('Play checkpoint restore returned an inconsistent payload');

    const nonIncrementing = createPlayCheckpointRestorePayload();
    nonIncrementing.session.revision = 1;
    nonIncrementing.session.worldClock.revision = 1;
    const revisionClient = createOanClient({
      fetch: createFetchMock([], nonIncrementing),
      systemTheme: () => 'dark',
    });
    await expect(revisionClient.restorePlayCheckpoint(
      'play-1',
      'turn-artifact-1',
      { baseRevision: 1 },
    ))
      .rejects
      .toThrow('Play checkpoint restore returned an inconsistent payload');
  });

  it('routes Play stop through the explicit server cancellation endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: createFetchMock(calls, {
        status: 'cancelled',
        committed: false,
        turnId: 'run-1',
      }),
      systemTheme: () => 'dark',
    });

    await expect(client.cancelPlayWorldRefereeTurn('play-1', 'run-1')).resolves.toEqual({
      status: 'cancelled',
      committed: false,
      turnId: 'run-1',
    });
    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/turns/run-1/cancel',
      init: { method: 'POST' },
    });
  });

  it('rejects malformed Play cancellation results at the network boundary', async () => {
    const client = createOanClient({
      fetch: createFetchMock([], {
        status: 'committed',
        committed: true,
        turnId: 'run-1',
      }),
      systemTheme: () => 'dark',
    });

    await expect(client.cancelPlayWorldRefereeTurn('play-1', 'run-1'))
      .rejects
      .toThrow('invalid result');
  });

  it('cancels the response body when a Play stream consumer exits early', async () => {
    let bodyCancelled = false;
    const encoded = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.encode(
          'data: {"type":"play.turn.started","eventId":"run-1:1","sequence":1,"sessionId":"play-1","turnId":"run-1","baseRevision":0,"expectedArtifactId":"turn-artifact-1"}\n\n',
        ));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const client = createOanClient({
      fetch: (async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });

    for await (const _event of client.streamPlayWorldRefereeTurn('play-1', {
      userText: '等待',
      baseRevision: 0,
    })) {
      break;
    }

    expect(bodyCancelled).toBe(true);
  });

  it('uses the desktop bridge for app, theme, directory picker and backend URL', async () => {
    const bridge: OanDesktopBridge = {
      backendBaseUrl: 'http://desktop-backend',
      app: {
        getVersion: vi.fn(async () => '1.2.3'),
      },
      appConfig: {
        get: vi.fn(async () => ({ composerSubmitShortcut: 'meta-enter' })),
        set: vi.fn(async (config) => config),
      },
      theme: {
        get: vi.fn(async () => 'light'),
        set: vi.fn(async (theme) => theme),
      },
      workspace: {
        selectDirectory: vi.fn(async () => '/workspace'),
      },
    };
    const client = createOanClient({
      backendBaseUrl: 'http://browser-backend',
      bridge,
      fetch: createFetchMock([], {}),
      systemTheme: () => 'dark',
    });

    expect(client.backendBaseUrl).toBe('http://desktop-backend');
    expect(client.getAgentChatApi()).toBe('http://desktop-backend/api/agent/chat');
    expect(client.createAgentChatTransport()).toBeTruthy();
    await expect(client.getAppVersion()).resolves.toBe('1.2.3');
    await expect(client.getThemePreference()).resolves.toBe('light');
    await expect(client.setThemePreference('dark')).resolves.toBe('dark');
    await expect(client.getComposerSubmitShortcutPreference()).resolves.toBe('meta-enter');
    await expect(client.setComposerSubmitShortcutPreference('ctrl-enter')).resolves.toBe('ctrl-enter');
    expect(client.isDirectoryPickerAvailable()).toBe(true);
    await expect(client.selectDirectory()).resolves.toBe('/workspace');
  });

  it('reads and writes app config through the HTTP backend when no desktop bridge exists', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });

      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({
          config: JSON.parse(String(init.body)),
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        config: {
          theme: 'light',
          composerSubmitShortcut: 'meta-enter',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });

    await expect(client.getAppConfig()).resolves.toEqual({
      theme: 'light',
      composerSubmitShortcut: 'meta-enter',
    });
    await expect(client.getThemePreference()).resolves.toBe('light');
    await expect(client.getComposerSubmitShortcutPreference()).resolves.toBe('meta-enter');
    await expect(client.setComposerSubmitShortcutPreference('ctrl-enter')).resolves.toBe('ctrl-enter');

    expect(calls.map((call) => call.url)).toEqual([
      'http://backend.test/api/app-config',
      'http://backend.test/api/app-config',
      'http://backend.test/api/app-config',
      'http://backend.test/api/app-config',
    ]);
    expect(calls[3]?.init).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      composerSubmitShortcut: 'ctrl-enter',
    });
  });

  it('falls back to injected browser capabilities when no desktop bridge exists', async () => {
    const client = createOanClient({
      fetch: createFetchMock([], {}),
      systemTheme: () => 'dark',
    });

    expect(client.backendBaseUrl).toBe('');
    expect(client.getSystemThemePreference()).toBe('dark');
    await expect(client.getThemePreference()).resolves.toBe('dark');
    await expect(client.setThemePreference('light')).resolves.toBe('light');
    expect(client.isDirectoryPickerAvailable()).toBe(false);
    await expect(client.selectDirectory()).resolves.toBeUndefined();
  });
});

function createFetchMock(
  calls: Array<{ url: string; init?: RequestInit }>,
  body: unknown,
  status = 200,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      init,
    });

    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof fetch;
}

function createPlayOccurredPayload() {
  return {
    type: 'play.event.occurred',
    eventId: 'run-1:6',
    sequence: 6,
    sessionId: 'play-1',
    turnId: 'run-1',
    revision: 1,
    event: {
      id: 'turn-1-event-1',
      turnId: 'turn-1-referee',
      sequence: 1,
      kind: 'factionActed',
      origin: 'faction',
      title: '封锁开始',
      summary: '站台出口关闭',
      visibility: 'playerVisible',
      cause: { reason: '计划到期', triggerId: 'deadline-lockdown' },
      worldClock: { turn: 1, revision: 1 },
      createdAt: '2026-07-15T01:00:00.000Z',
      canonical: false,
    },
  };
}

function createScheduledPlayEvent(): PlayScheduledEvent {
  return {
    id: 'deadline-lockdown',
    label: '封锁倒计时',
    trigger: { type: 'afterTurns', turns: 2 },
    template: {
      kind: 'factionActed',
      origin: 'faction',
      title: '封锁开始',
      summary: '站台出口关闭',
      visibility: 'playerVisible',
    },
    status: 'scheduled',
    scheduledAtTurn: 0,
    scheduledAtRevision: 0,
  };
}

function createEmptyPlayCommittedPayload(
  scheduledEvents: PlayScheduledEvent[],
  revision = 0,
) {
  const session = createEmptyPlaySessionEnvelope();
  session.revision = revision;
  session.worldClock = { turn: revision, revision };
  session.branchSnapshotRequiredFromRevision = revision;
  session.branchBaseSnapshot.worldClock = { turn: revision, revision };
  session.branchBaseSnapshot.scheduledEvents = scheduledEvents;
  session.scheduledEvents = scheduledEvents;
  return {
    type: 'play.turn.committed',
    eventId: 'run-empty:1',
    sequence: 1,
    sessionId: session.id,
    turnId: 'run-empty',
    revision,
    session,
  };
}

function createOccurredScheduledPlayCommittedPayload() {
  const pendingSchedule = {
    ...createScheduledPlayEvent(),
    trigger: { type: 'nextTurn' },
  };
  const payload = createPlayCommittedPayload([pendingSchedule]);
  const event = createPlayOccurredPayload().event;
  const occurredSchedule = {
    ...pendingSchedule,
    template: structuredClone(pendingSchedule.template),
    status: 'occurred',
    occurredEventIds: [event.id],
    resolvedAtTurnId: event.turnId,
  };
  const artifact = payload.session.turnArtifacts[0];

  payload.session.events.push(event);
  payload.session.scheduledEvents = [occurredSchedule];
  artifact.eventIds.push(event.id);
  artifact.dueScheduledEventIds.push(pendingSchedule.id);
  artifact.scheduledEventSnapshots = [occurredSchedule];

  return payload;
}

function createCancelledScheduledPlayCommittedPayload() {
  const pendingSchedule = createScheduledPlayEvent();
  const payload = createPlayCommittedPayload([pendingSchedule]);
  const cancelledSchedule = {
    ...pendingSchedule,
    template: structuredClone(pendingSchedule.template),
    status: 'cancelled',
    resolvedAtTurnId: 'turn-1-referee',
    resolutionReason: '守卫撤销封锁命令',
  };
  payload.session.turnArtifacts[0].scheduledEventSnapshots = [cancelledSchedule];
  payload.session.scheduledEvents = [cancelledSchedule];
  return payload;
}

function createCurrentTurnScheduleCreationPayload() {
  const payload = createPlayCommittedPayload([]);
  const schedule = {
    ...createScheduledPlayEvent(),
    id: 'new-arrival',
    label: '增援抵达',
    scheduledAtTurn: 1,
    scheduledAtRevision: 1,
    sourceTurnId: 'turn-1-referee',
    changeReason: '守卫发出求援信号',
  };
  const artifact = payload.session.turnArtifacts[0];
  artifact.scheduledEventIds = [schedule.id];
  artifact.scheduledEventSnapshots = [schedule];
  payload.session.scheduledEvents = [schedule];
  return payload;
}

function createCurrentTurnReschedulePayload() {
  const pendingSchedule = createScheduledPlayEvent();
  const payload = createPlayCommittedPayload([pendingSchedule]);
  const rescheduled = {
    ...pendingSchedule,
    template: structuredClone(pendingSchedule.template),
    trigger: { type: 'afterTurns', turns: 3 },
    scheduledAtTurn: 1,
    scheduledAtRevision: 1,
    sourceTurnId: 'turn-1-referee',
    changeReason: '列车临时晚点',
  };
  payload.session.turnArtifacts[0].scheduledEventSnapshots = [rescheduled];
  payload.session.scheduledEvents = [rescheduled];
  return payload;
}

function createPlayFactProvenancePayload() {
  const payload = createPlayCommittedPayload([]);
  const event = {
    ...createPlayOccurredPayload().event,
    visibility: 'playerUnknown',
    cause: { reason: '守卫秘密调动' },
  } as PlayWorldEvent;
  const observation = {
    id: 'observation-hidden-guard',
    summary: '守卫正在调动',
    evidence: '内部事件记录',
    visibility: 'playerUnknown',
    sourceTurnIds: ['turn-1-referee'],
    sourceEventIds: [event.id],
    canonical: false,
  } as PlayObservation;
  const candidate = {
    id: 'candidate-hidden-guard',
    target: 'timeline',
    summary: '记录守卫调动',
    evidence: '沙盘观察',
    visibility: 'playerUnknown',
    sourceObservationIds: [observation.id],
    sourceTurnIds: ['turn-1-referee'],
    sourceEventIds: [event.id],
    requiresPendingAction: true,
  } as PlayAdoptionCandidate;

  payload.session.events.push(event);
  payload.session.turnArtifacts[0].eventIds.push(event.id);
  payload.session.observations = [observation];
  payload.session.adoptionCandidates = [candidate];
  return payload;
}

function createPlayCommittedPayload(scheduledEvents: unknown[]) {
  return {
    type: 'play.turn.committed',
    eventId: 'run-1:7',
    sequence: 7,
    sessionId: 'play-1',
    turnId: 'run-1',
    revision: 1,
    session: {
      schemaVersion: 4,
      id: 'play-1',
      title: '雨夜车站',
      createdAt: '2026-07-15T00:00:00.000Z',
      revision: 1,
      sceneStart: '雨落在空站台上。',
      characters: [],
      transcript: [{
        id: 'turn-1-user',
        speaker: 'user',
        content: '等待。',
        createdAt: '2026-07-15T01:00:00.000Z',
        actionKind: 'wait',
      }, {
        id: 'turn-1-referee',
        speaker: 'world-referee',
        content: '时间继续流动。',
        createdAt: '2026-07-15T01:00:00.000Z',
      }],
      turnArtifacts: [{
        schemaVersion: 2,
        artifactKind: 'worldSettlement',
        branchSnapshotVersion: 1,
        id: 'turn-artifact-1',
        revision: 1,
        input: { kind: 'wait', raw: '等待。' },
        messages: [{
          id: 'turn-1-user',
          speaker: 'user',
          content: '等待。',
          createdAt: '2026-07-15T01:00:00.000Z',
          actionKind: 'wait',
        }, {
          id: 'turn-1-referee',
          speaker: 'world-referee',
          content: '时间继续流动。',
          createdAt: '2026-07-15T01:00:00.000Z',
        }],
        worldClock: { turn: 1, revision: 1 },
        eventIds: [] as string[],
        dueScheduledEventIds: [] as string[],
        scheduledEventIds: scheduledEvents.map((event) =>
          typeof event === 'object' && event !== null && 'id' in event
            ? (event as { id: unknown }).id
            : ''),
        scheduledEventSnapshots: scheduledEvents,
        playLocalStateSnapshot: {},
        playLocalStateVisibilitySnapshot: {},
        observationIds: [],
        stateDelta: {},
        suggestedActions: [],
        committedAt: '2026-07-15T01:00:00.000Z',
        canonical: false,
      }],
      selectedTurnIds: ['turn-artifact-1'],
      branchSnapshotRequiredFromRevision: 0,
      branchBaseSnapshot: {
        worldClock: { turn: 0, revision: 0 },
        playLocalState: {},
        playLocalStateVisibility: {},
        scheduledEvents,
        suggestedActions: [],
      },
      metadataExtensions: {},
      playLocalState: {},
      playLocalStateVisibility: {},
      worldClock: { turn: 1, revision: 1 },
      eventPolicy: {
        simulationMode: 'activeWorld',
        density: 'balanced',
        allowOffscreen: true,
        allowHidden: true,
        maxExternalEventsPerTurn: 2,
      },
      events: [] as PlayWorldEvent[],
      scheduledEvents,
      suggestedActions: [],
      activatedSources: [],
      observations: [] as PlayObservation[],
      adoptionCandidates: [] as PlayAdoptionCandidate[],
    },
  };
}

function createPlayCheckpointRestorePayload() {
  const session = structuredClone(createPlayCommittedPayload([]).session);
  session.revision = 2;
  session.worldClock.revision = 2;
  const checkpoint = {
    artifactId: 'turn-artifact-1',
    selectedTurnIds: ['turn-artifact-1'],
    revision: 1,
    worldTurn: 1,
    committedAt: '2026-07-15T01:00:00.000Z',
    preview: '时间继续流动。',
    status: 'current' as const,
    restorable: false,
    canonical: false as const,
  };

  return {
    session,
    checkpoints: [checkpoint],
    restoredArtifactId: checkpoint.artifactId,
  };
}

function createEmptyPlaySessionEnvelope() {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Play',
    createdAt: '2026-07-15T00:00:00.000Z',
    revision: 0,
    sceneStart: 'Scene',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock: { turn: 0, revision: 0 },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [],
    scheduledEvents: [],
    suggestedActions: [],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}

async function consumePlaySsePayload(payload: unknown): Promise<PlayTurnStreamEvent[]> {
  const encoded = new TextEncoder();
  const client = createOanClient({
    fetch: (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.encode(
          `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
        ));
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch,
    systemTheme: () => 'dark',
  });
  const events: PlayTurnStreamEvent[] = [];

  for await (const event of client.streamPlayWorldRefereeTurn('play-1', {
    userText: '等待',
    baseRevision: 0,
  })) {
    events.push(event);
  }

  return events;
}
