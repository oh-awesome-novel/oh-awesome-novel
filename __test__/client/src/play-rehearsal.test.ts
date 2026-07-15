import { describe, expect, it, vi } from 'vitest';

import {
  createOanClient,
  isPlayRehearsalSessionEnvelope,
  OanRequestError,
  type CharacterStepDraft,
  type PlayAttemptMutationReceipt,
  type PlayRehearsalSessionV5,
  type PlayRehearsalStepStreamEvent,
  type PlayTurnAttempt,
} from '@oh-awesome-novel/client';

describe('Play rehearsal client contract', () => {
  it('routes the UI-friendly attempt aliases through strict attempt envelopes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const attempt = createRunningAttempt();
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ attempt });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });

    await expect(client.createPlayRehearsalAttempt('play-1', {
      baseRevision: 0,
    })).resolves.toEqual({ attempt });
    await expect(client.getActivePlayRehearsalAttempt('play-1'))
      .resolves.toEqual({ attempt });
    await expect(client.getPlayRehearsalAttempt('play-1', 'attempt-1'))
      .resolves.toEqual({ attempt });

    expect(calls.map((call) => call.url)).toEqual([
      'http://backend.test/api/workspace/play-sessions/play-1/attempts',
      'http://backend.test/api/workspace/play-sessions/play-1/attempts/active',
      'http://backend.test/api/workspace/play-sessions/play-1/attempts/attempt-1',
    ]);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ baseRevision: 0 });
    expect(calls[1]?.init?.method).toBe('GET');
  });

  it('accepts the explicit null active-attempt envelope but rejects malformed truth', async () => {
    const valid = createOanClient({
      fetch: (async () => jsonResponse({ attempt: null })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(valid.getActivePlayRehearsalAttempt('play-1'))
      .resolves.toEqual({ attempt: null });

    const malformed = structuredClone(createRunningAttempt()) as Record<string, unknown>;
    malformed.unknown = true;
    const invalid = createOanClient({
      fetch: (async () => jsonResponse({ attempt: malformed })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(invalid.getActivePlayRehearsalAttempt('play-1'))
      .rejects.toThrow(/invalid payload/iu);
  });

  it('reports the actor-step commit barrier as too late to stop and fails closed on weaker truth', async () => {
    const committing = createOanClient({
      fetch: (async () => jsonResponse({
        status: 'committing',
        runId: 'step-run-1',
        tooLateToStop: true,
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(committing.cancelPlayActorStep(
      'play-1',
      'attempt-1',
      'step-run-1',
    )).resolves.toEqual({
      status: 'committing',
      runId: 'step-run-1',
      tooLateToStop: true,
    });

    const ambiguous = createOanClient({
      fetch: (async () => jsonResponse({
        status: 'committing',
        runId: 'step-run-1',
        tooLateToStop: false,
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(ambiguous.cancelPlayActorStep(
      'play-1',
      'attempt-1',
      'step-run-1',
    )).rejects.toThrow(/invalid payload/iu);
  });

  it('streams actor-step events with strict run identity and authoritative prepared truth', async () => {
    const attempt = createDraftAttempt();
    const step = attempt.steps[0]!;
    const receipt = attempt.mutationReceipts[0]!;
    const events: PlayRehearsalStepStreamEvent[] = [
      {
        type: 'play.actor.step.started',
        eventId: 'step-run-1:1',
        sequence: 1,
        sessionId: 'play-1',
        attemptId: 'attempt-1',
        stepRunId: 'step-run-1',
        baseAttemptRevision: 0,
        participantRef: 'participant-lin',
        mode: 'next',
      },
      {
        type: 'play.actor.step.delta',
        eventId: 'step-run-1:2',
        sequence: 2,
        sessionId: 'play-1',
        attemptId: 'attempt-1',
        stepRunId: 'step-run-1',
        delta: '林抬起头。',
        provisional: true,
      },
      {
        type: 'play.actor.step.prepared',
        eventId: 'step-run-1:3',
        sequence: 3,
        sessionId: 'play-1',
        attemptId: 'attempt-1',
        stepRunId: 'step-run-1',
        attempt,
        step,
        receipt,
      },
    ];
    const onStepRunId = vi.fn();
    const fetcher = vi.fn(async () => sseResponse(events, 'step-run-1')) as unknown as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });

    const received: PlayRehearsalStepStreamEvent[] = [];
    for await (const event of client.streamNextPlayActorStep(
      'play-1',
      'attempt-1',
      {
        expectedAttemptRevision: 0,
        idempotencyKey: 'step-key',
        mode: 'next',
      },
      { onStepRunId },
    )) {
      received.push(event);
    }

    expect(received).toEqual(events);
    expect(received[2]).toMatchObject({
      type: 'play.actor.step.prepared',
      attempt: { attemptRevision: 1, currentStepRef: 'step-1' },
    });
    expect(onStepRunId).toHaveBeenCalledWith('step-run-1');
    expect(fetcher).toHaveBeenCalledOnce();
    const [, request] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(String((request as RequestInit).body))).toEqual({
      expectedAttemptRevision: 0,
      idempotencyKey: 'step-key',
      mode: 'next',
    });
  });

  it.each([
    {
      name: 'changed run identity',
      mutate(events: PlayRehearsalStepStreamEvent[]) {
        events[1] = { ...events[1]!, stepRunId: 'other-run' };
      },
    },
    {
      name: 'skipped sequence',
      mutate(events: PlayRehearsalStepStreamEvent[]) {
        events[1] = { ...events[1]!, sequence: 4, eventId: 'step-run-1:4' };
      },
    },
    {
      name: 'prepared snapshot without its step receipt',
      mutate(events: PlayRehearsalStepStreamEvent[]) {
        const prepared = events[2] as Extract<
          PlayRehearsalStepStreamEvent,
          { type: 'play.actor.step.prepared' }
        >;
        events[2] = {
          ...prepared,
          attempt: { ...prepared.attempt, mutationReceipts: [] },
        };
      },
    },
    {
      name: 'prepared visible settlement without its deterministic world notice',
      mutate(events: PlayRehearsalStepStreamEvent[]) {
        const prepared = events[2] as Extract<
          PlayRehearsalStepStreamEvent,
          { type: 'play.actor.step.prepared' }
        >;
        const step = structuredClone(prepared.step);
        step.settlementContribution.events.push({
          kind: 'environmentChanged',
          origin: 'environment',
          title: 'The lamp turns red',
          summary: 'The red lamp is visible above the gate.',
          visibility: 'playerVisible',
          cause: { reason: 'The gate sensor changed the lamp.' },
        });
        events[2] = {
          ...prepared,
          step,
          attempt: {
            ...prepared.attempt,
            steps: [structuredClone(step)],
          },
        };
      },
    },
  ])('rejects $name in actor-step streams', async ({ mutate }) => {
    const events = createPreparedStreamEvents();
    mutate(events);
    const client = createOanClient({
      fetch: (async () => sseResponse(events, 'step-run-1')) as typeof fetch,
      systemTheme: () => 'dark',
    });

    await expect(collect(client.streamNextPlayActorStep(
      'play-1',
      'attempt-1',
      {
        expectedAttemptRevision: 0,
        idempotencyKey: 'step-key',
        mode: 'next',
      },
    ))).rejects.toThrow(/stream|prepared/iu);
  });

  it('fails closed when an actor-step stream ends without terminal [DONE]', async () => {
    const started = createPreparedStreamEvents()[0]!;
    const client = createOanClient({
      fetch: (async () => sseResponse([started], 'step-run-1', false)) as typeof fetch,
      systemTheme: () => 'dark',
    });

    await expect(collect(client.streamNextPlayActorStep(
      'play-1',
      'attempt-1',
      {
        expectedAttemptRevision: 0,
        idempotencyKey: 'step-key',
        mode: 'next',
      },
    ))).rejects.toThrow(/without \[DONE\]/iu);
  });

  it('accepts exactly one immediate reset before retry output', async () => {
    const events = createControlStreamEvents('retry', ['reset', 'failed']);
    const client = createOanClient({
      fetch: (async () => sseResponse(events, 'step-run-control')) as typeof fetch,
      systemTheme: () => 'dark',
    });

    await expect(collect(client.streamNextPlayActorStep(
      'play-1',
      'attempt-1',
      {
        expectedAttemptRevision: 0,
        idempotencyKey: 'step-key',
        mode: 'retry',
        sourceStepRef: 'step-1',
      },
    ))).resolves.toEqual(events);
  });

  it.each([
    ['missing retry reset', 'retry', ['failed']],
    ['late retry reset', 'retry', ['delta', 'reset', 'failed']],
    ['duplicate retry reset', 'retry', ['reset', 'reset', 'failed']],
    ['reset during a next step', 'next', ['reset', 'failed']],
  ] as const)('rejects %s', async (_name, mode, controls) => {
    const events = createControlStreamEvents(mode, controls);
    const client = createOanClient({
      fetch: (async () => sseResponse(events, 'step-run-control')) as typeof fetch,
      systemTheme: () => 'dark',
    });
    const input = mode === 'retry'
      ? {
          expectedAttemptRevision: 0,
          idempotencyKey: 'step-key',
          mode,
          sourceStepRef: 'step-1',
        }
      : {
          expectedAttemptRevision: 0,
          idempotencyKey: 'step-key',
          mode,
        };

    await expect(collect(client.streamNextPlayActorStep(
      'play-1',
      'attempt-1',
      input,
    ))).rejects.toThrow(/reset/iu);
  });

  it('accepts an idempotent prepared replay with newer authoritative attempt truth', async () => {
    const firstStep = createStep('selected');
    const secondStep: CharacterStepDraft = {
      ...createStep('draft'),
      id: 'step-2',
      participantRef: 'participant-mei',
      queueIndex: 1,
      beforeStepRef: firstStep.id,
      perceptionRef: 'perception-scene-1-participant-mei-2',
      narrativeBlocks: [{
        ...createStep('draft').narrativeBlocks[0]!,
        id: 'block-2',
        speakerRef: 'participant-mei',
      }],
    };
    const originalReceipt = createReceipt('step-key', 1, firstStep.id);
    const authoritative: PlayTurnAttempt = {
      ...createRunningAttempt(),
      attemptRevision: 3,
      actorOrder: ['participant-lin', 'participant-mei'],
      selectedStepRefs: [firstStep.id],
      selectedHeadRef: firstStep.id,
      currentStepRef: secondStep.id,
      steps: [firstStep, secondStep],
      mutationReceipts: [
        originalReceipt,
        createReceipt('accept-key', 2, firstStep.id),
        createReceipt('second-step-key', 3, secondStep.id),
      ],
    };
    const events: PlayRehearsalStepStreamEvent[] = [{
      type: 'play.actor.step.started',
      eventId: 'step-run-replay:1',
      sequence: 1,
      sessionId: 'play-1',
      attemptId: 'attempt-1',
      stepRunId: 'step-run-replay',
      baseAttemptRevision: 0,
      participantRef: 'participant-lin',
      mode: 'next',
    }, {
      type: 'play.actor.step.prepared',
      eventId: 'step-run-replay:2',
      sequence: 2,
      sessionId: 'play-1',
      attemptId: 'attempt-1',
      stepRunId: 'step-run-replay',
      attempt: authoritative,
      step: firstStep,
      receipt: originalReceipt,
    }];
    const client = createOanClient({
      fetch: (async () => sseResponse(events, 'step-run-replay')) as typeof fetch,
      systemTheme: () => 'dark',
    });

    await expect(collect(client.streamNextPlayActorStep(
      'play-1',
      'attempt-1',
      {
        expectedAttemptRevision: 0,
        idempotencyKey: 'step-key',
        mode: 'next',
      },
    ))).resolves.toEqual(events);
  });

  it('cancels the actor-step response body when the consumer exits early', async () => {
    const cancel = vi.fn();
    const encoded = new TextEncoder();
    const started = createPreparedStreamEvents()[0]!;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.encode(`data: ${JSON.stringify(started)}\n\n`));
      },
      cancel,
    });
    const client = createOanClient({
      fetch: (async () => new Response(body, {
        headers: {
          'content-type': 'text/event-stream',
          'X-OAN-Play-Step-Run-Id': 'step-run-1',
        },
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });

    for await (const _event of client.streamNextPlayActorStep(
      'play-1',
      'attempt-1',
      {
        expectedAttemptRevision: 0,
        idempotencyKey: 'step-key',
        mode: 'next',
      },
    )) break;

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('preserves structured request status, code, details, and message', async () => {
    const client = createOanClient({
      fetch: (async () => jsonResponse({
        error: {
          code: 'attempt_revision_conflict',
          message: 'Attempt revision changed.',
          details: { expected: 1, current: 2 },
        },
      }, 409)) as typeof fetch,
      systemTheme: () => 'dark',
    });

    const error = await client.getWorkspaceStatus().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OanRequestError);
    expect(error).toMatchObject({
      message: 'Attempt revision changed.',
      status: 409,
      code: 'attempt_revision_conflict',
      details: { expected: 1, current: 2 },
    });

    const backendShape = createOanClient({
      fetch: (async () => jsonResponse({
        error: 'Attempt revision changed.',
        code: 'attempt_revision_conflict',
        details: { expected: 1, current: 2 },
      }, 409)) as typeof fetch,
      systemTheme: () => 'dark',
    });
    const backendError = await backendShape.getWorkspaceStatus()
      .catch((caught: unknown) => caught);
    expect(backendError).toMatchObject({
      message: 'Attempt revision changed.',
      status: 409,
      code: 'attempt_revision_conflict',
      details: { expected: 1, current: 2 },
    });
  });

  it('accepts a strictly paired v5 rehearsal session and rejects an orphan sidecar', async () => {
    const session = createEmptyRehearsalSession();
    const client = createOanClient({
      fetch: (async () => jsonResponse({ session })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(client.getPlaySession('play-1')).resolves.toEqual({ session });

    const orphan = structuredClone(session);
    orphan.sceneRehearsal.sessionId = 'other-session';
    const malformed = createOanClient({
      fetch: (async () => jsonResponse({ session: orphan })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(malformed.getPlaySession('play-1')).rejects.toThrow(/invalid payload/iu);
  });

  it('rejects same-id evidence projection tampering and event visibility widening', async () => {
    const projectionTampered = structuredClone(
      createCommittedRehearsalFixture().session,
    );
    const projectionEvidence = projectionTampered.rehearsalScenes[0]!.turns[0]!;
    projectionEvidence.narrativeBlocks = projectionEvidence.narrativeBlocks.map(
      (block, index) => index === 0
        ? {
            ...structuredClone(block),
            content: 'Same id, but hidden replacement content.',
          }
        : structuredClone(block),
    );
    const projectionClient = createOanClient({
      fetch: (async () => jsonResponse({ session: projectionTampered })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(projectionClient.getPlaySession('play-1'))
      .rejects.toThrow(/invalid payload/iu);

    const visibilityTampered = structuredClone(
      createCommittedRehearsalFixture().session,
    );
    const hiddenEvent = {
      id: 'turn-1-event-1',
      turnId: 'turn-1-referee',
      sequence: 1,
      kind: 'informationSpread' as const,
      origin: 'npc' as const,
      title: 'A private warning',
      summary: 'Only the stationmaster knows the warning.',
      visibility: 'playerUnknown' as const,
      cause: { reason: 'The warning remains private.' },
      worldClock: { turn: 1, revision: 1 },
      createdAt: '2026-07-15T00:02:00.000Z',
      canonical: false as const,
    };
    visibilityTampered.events = [hiddenEvent];
    visibilityTampered.turnArtifacts[0]!.eventIds = [hiddenEvent.id];
    const visibilityEvidence = visibilityTampered.rehearsalScenes[0]!.turns[0]!;
    visibilityEvidence.steps[0]!.narrativeBlocks[0] = {
      ...structuredClone(visibilityEvidence.steps[0]!.narrativeBlocks[0]!),
      eventRefs: [hiddenEvent.id],
    };
    visibilityEvidence.steps[0]!.settlementEventRefs = [hiddenEvent.id];
    visibilityEvidence.narrativeBlocks[0] = structuredClone(
      visibilityEvidence.steps[0]!.narrativeBlocks[0]!,
    );
    const visibilityClient = createOanClient({
      fetch: (async () => jsonResponse({ session: visibilityTampered })) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(visibilityClient.getPlaySession('play-1'))
      .rejects.toThrow(/invalid payload/iu);
  });

  it('requires event-derived step and host world notices with exact ownership partitions', () => {
    const stepSession = structuredClone(createCommittedRehearsalFixture().session);
    const stepEvent = {
      id: 'turn-1-event-visible',
      turnId: 'turn-1-referee',
      sequence: 1,
      kind: 'environmentChanged' as const,
      origin: 'environment' as const,
      title: 'The gate lamp turns red',
      summary: 'The red lamp is visible above the gate.',
      visibility: 'playerVisible' as const,
      cause: { reason: 'The gate sensor changed the lamp.' },
      worldClock: { turn: 1, revision: 1 },
      createdAt: '2026-07-15T00:02:00.000Z',
      canonical: false as const,
    };
    stepSession.events = [stepEvent];
    stepSession.turnArtifacts[0]!.eventIds = [stepEvent.id];
    const stepEvidence = stepSession.rehearsalScenes[0]!.turns[0]!;
    const stepNotice = {
      id: 'world-notice-step-1',
      kind: 'worldNotice' as const,
      content: `${stepEvent.title}: ${stepEvent.summary}`,
      visibility: 'playerVisible' as const,
      projection: 'transcript' as const,
      eventRefs: [stepEvent.id],
      sourceRefs: [],
    };
    stepEvidence.steps[0]!.narrativeBlocks = [
      ...stepEvidence.steps[0]!.narrativeBlocks.map((block) => structuredClone(block)),
      stepNotice,
    ];
    stepEvidence.steps[0]!.settlementEventRefs = [stepEvent.id];
    stepEvidence.hostNarrativeBlocks = [];
    stepEvidence.narrativeBlocks = stepEvidence.steps
      .flatMap((step) => step.narrativeBlocks.map((block) => structuredClone(block)));
    expect(isPlayRehearsalSessionEnvelope(
      stepSession,
      stepSession.id,
      undefined,
      () => true,
    )).toBe(true);

    const tamperedContent = structuredClone(stepSession);
    const tamperedEvidence = tamperedContent.rehearsalScenes[0]!.turns[0]!;
    const tamperedStepNotice = tamperedEvidence.steps[0]!.narrativeBlocks.at(-1)!;
    const tamperedTopNotice = tamperedEvidence.narrativeBlocks
      .find((block) => block.id === tamperedStepNotice.id)!;
    tamperedStepNotice.content = 'A hidden stationmaster order is exposed.';
    tamperedTopNotice.content = tamperedStepNotice.content;
    expect(isPlayRehearsalSessionEnvelope(
      tamperedContent,
      tamperedContent.id,
      undefined,
      () => true,
    )).toBe(false);

    const hostSession = structuredClone(createCommittedRehearsalFixture().session);
    const hostEvent = {
      ...stepEvent,
      id: 'turn-1-event-hard-due',
      title: 'The station gate closes',
      summary: 'The gate closes at the appointed time.',
      cause: {
        reason: 'The scheduled gate deadline became due.',
        triggerId: 'scheduled-gate-close',
      },
    };
    hostSession.events = [hostEvent];
    hostSession.turnArtifacts[0]!.eventIds = [hostEvent.id];
    const hostEvidence = hostSession.rehearsalScenes[0]!.turns[0]!;
    const hostNotice = {
      id: `world-notice-host-${hostSession.turnArtifacts[0]!.id}`,
      kind: 'worldNotice' as const,
      content: `${hostEvent.title}: ${hostEvent.summary}`,
      visibility: 'playerVisible' as const,
      projection: 'transcript' as const,
      eventRefs: [hostEvent.id],
      sourceRefs: [],
    };
    hostEvidence.hostNarrativeBlocks = [hostNotice];
    hostEvidence.narrativeBlocks = [
      ...hostEvidence.steps.flatMap((step) =>
        step.narrativeBlocks.map((block) => structuredClone(block))),
      structuredClone(hostNotice),
    ];
    expect(isPlayRehearsalSessionEnvelope(
      hostSession,
      hostSession.id,
      undefined,
      () => true,
    )).toBe(true);

    const omittedHost = structuredClone(hostSession);
    const omittedHostEvidence = omittedHost.rehearsalScenes[0]!.turns[0]!;
    omittedHostEvidence.hostNarrativeBlocks = [];
    omittedHostEvidence.narrativeBlocks = omittedHostEvidence.steps
      .flatMap((step) => step.narrativeBlocks.map((block) => structuredClone(block)));
    expect(isPlayRehearsalSessionEnvelope(
      omittedHost,
      omittedHost.id,
      undefined,
      () => true,
    )).toBe(false);

    const reassignedHost = structuredClone(hostSession);
    const reassignedEvidence = reassignedHost.rehearsalScenes[0]!.turns[0]!;
    reassignedEvidence.steps[0]!.narrativeBlocks.push({
      ...structuredClone(reassignedEvidence.hostNarrativeBlocks[0]!),
      id: 'world-notice-step-1',
    });
    reassignedEvidence.hostNarrativeBlocks = [];
    reassignedEvidence.narrativeBlocks = reassignedEvidence.steps
      .flatMap((step) => step.narrativeBlocks.map((block) => structuredClone(block)));
    expect(isPlayRehearsalSessionEnvelope(
      reassignedHost,
      reassignedHost.id,
      undefined,
      () => true,
    )).toBe(false);
  });

  it('normalizes optional v5 session ids before sending and validating create requests', async () => {
    const session = createEmptyRehearsalSession();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          session,
          files: ['session.yaml', 'scene-rehearsal.yaml'],
        });
      }) as typeof fetch,
      systemTheme: () => 'dark',
    });
    const baseInput = {
      title: session.title,
      sceneStart: session.sceneStart,
      purpose: 'sceneRehearsal' as const,
      startMode: 'guided' as const,
      sceneContract: session.sceneRehearsal.sceneContract,
      participants: session.sceneRehearsal.participants,
      initialKnowledgeEvidence: session.sceneRehearsal.initialKnowledgeEvidence,
    };

    await expect(client.createPlaySession({
      ...baseInput,
      id: ' play-1 ',
    })).resolves.toMatchObject({ session: { id: 'play-1' } });
    await expect(client.createPlaySession({
      ...baseInput,
      id: '   ',
    })).resolves.toMatchObject({ session: { id: 'play-1' } });

    expect(calls.map((call) => call.url)).toEqual([
      'http://backend.test/api/workspace/play-sessions',
      'http://backend.test/api/workspace/play-sessions',
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ id: 'play-1' });
    expect(JSON.parse(String(calls[1]?.init?.body))).not.toHaveProperty('id');
  });

  it('validates finalize as one v3 artifact/evidence/attempt transaction', async () => {
    const { session, attempt, artifact, evidence, receipt } = createCommittedRehearsalFixture();
    const response = { session, attempt, artifact, evidence, receipt, replayed: false };
    const client = createOanClient({
      fetch: (async () => jsonResponse(response)) as typeof fetch,
      systemTheme: () => 'dark',
    });

    await expect(client.finishPlayRehearsalAttempt(
      'play-1',
      'attempt-1',
      {
        baseRevision: 0,
        expectedAttemptRevision: 2,
        selectedHeadRef: 'step-1',
        idempotencyKey: 'finalize-key',
      },
    )).resolves.toEqual(response);

    const replay = { session, artifact, evidence, receipt, replayed: true };
    const replayClient = createOanClient({
      fetch: (async () => jsonResponse(replay)) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(replayClient.finishPlayRehearsalAttempt(
      'play-1',
      'attempt-1',
      {
        baseRevision: 0,
        expectedAttemptRevision: 2,
        selectedHeadRef: 'step-1',
        idempotencyKey: 'finalize-key',
      },
    )).resolves.toEqual(replay);

    const broken = structuredClone(response);
    broken.artifact.rehearsalEvidenceRefs = ['missing-evidence'];
    const invalid = createOanClient({
      fetch: (async () => jsonResponse(broken)) as typeof fetch,
      systemTheme: () => 'dark',
    });
    await expect(invalid.finishPlayRehearsalAttempt(
      'play-1',
      'attempt-1',
      {
        baseRevision: 0,
        expectedAttemptRevision: 2,
        selectedHeadRef: 'step-1',
        idempotencyKey: 'finalize-key',
      },
    )).rejects.toThrow(/evidence|payload/iu);
  });

  it('accepts an idempotent finalize replay with newer authoritative session truth', async () => {
    const { session, artifact, evidence, receipt } = createAdvancedFinalizeReplayFixture();
    const response = { session, artifact, evidence, receipt, replayed: true };
    const client = createOanClient({
      fetch: (async () => jsonResponse(response)) as typeof fetch,
      systemTheme: () => 'dark',
    });

    await expect(client.finishPlayRehearsalAttempt(
      'play-1',
      'attempt-1',
      {
        baseRevision: 0,
        expectedAttemptRevision: 2,
        selectedHeadRef: 'step-1',
        idempotencyKey: 'finalize-key',
      },
    )).resolves.toEqual(response);
  });
});

function createRunningAttempt(): PlayTurnAttempt {
  return {
    schemaVersion: 1,
    id: 'attempt-1',
    sessionId: 'play-1',
    baseRevision: 0,
    attemptRevision: 0,
    sceneBeforeRef: 'scene-1',
    status: 'running',
    actorOrder: ['participant-lin'],
    selectedStepRefs: [],
    dueScheduledEventIds: [],
    steps: [],
    mutationReceipts: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function createDraftAttempt(): PlayTurnAttempt {
  const step = createStep('draft');
  const receipt = createReceipt('step-key', 1, step.id);
  return {
    ...createRunningAttempt(),
    attemptRevision: 1,
    currentStepRef: step.id,
    steps: [step],
    mutationReceipts: [receipt],
    updatedAt: '2026-07-15T00:01:00.000Z',
  };
}

function createStep(status: CharacterStepDraft['status']): CharacterStepDraft {
  return {
    id: 'step-1',
    attemptId: 'attempt-1',
    participantRef: 'participant-lin',
    queueIndex: 0,
    perceptionRef: 'perception-scene-1-participant-lin-0',
    intentSummary: '确认门外的动静',
    narrativeBlocks: [{
      id: 'block-1',
      kind: 'characterAction',
      speakerRef: 'participant-lin',
      content: '林抬起头，侧耳听向门外。',
      visibility: 'playerVisible',
      projection: 'transcript',
      eventRefs: [],
      sourceRefs: ['knowledge-1'],
    }],
    settlementContribution: {
      events: [],
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      stateDelta: {},
      observations: [],
      suggestedActions: [],
    },
    decisionBasisRefs: ['knowledge-1'],
    status,
    createdAt: '2026-07-15T00:01:00.000Z',
  };
}

function createReceipt(
  idempotencyKey: string,
  resultingAttemptRevision: number,
  resultRef: string,
): PlayAttemptMutationReceipt {
  return {
    idempotencyKey,
    requestFingerprint: `${idempotencyKey}-fingerprint`,
    resultingAttemptRevision,
    resultRef,
    responseDigest: `${idempotencyKey}-digest`,
  };
}

function createPreparedStreamEvents(): PlayRehearsalStepStreamEvent[] {
  const attempt = createDraftAttempt();
  return [{
    type: 'play.actor.step.started',
    eventId: 'step-run-1:1',
    sequence: 1,
    sessionId: 'play-1',
    attemptId: 'attempt-1',
    stepRunId: 'step-run-1',
    baseAttemptRevision: 0,
    participantRef: 'participant-lin',
    mode: 'next',
  }, {
    type: 'play.actor.step.delta',
    eventId: 'step-run-1:2',
    sequence: 2,
    sessionId: 'play-1',
    attemptId: 'attempt-1',
    stepRunId: 'step-run-1',
    delta: '林抬起头。',
    provisional: true,
  }, {
    type: 'play.actor.step.prepared',
    eventId: 'step-run-1:3',
    sequence: 3,
    sessionId: 'play-1',
    attemptId: 'attempt-1',
    stepRunId: 'step-run-1',
    attempt,
    step: attempt.steps[0]!,
    receipt: attempt.mutationReceipts[0]!,
  }];
}

function createControlStreamEvents(
  mode: 'next' | 'retry',
  controls: readonly ('reset' | 'delta' | 'failed')[],
): PlayRehearsalStepStreamEvent[] {
  let sequence = 1;
  const eventBase = () => {
    const currentSequence = sequence;
    sequence += 1;
    return {
      eventId: `step-run-control:${currentSequence}`,
      sequence: currentSequence,
      sessionId: 'play-1',
      attemptId: 'attempt-1',
      stepRunId: 'step-run-control',
    };
  };
  const events: PlayRehearsalStepStreamEvent[] = [{
    ...eventBase(),
    type: 'play.actor.step.started',
    baseAttemptRevision: 0,
    participantRef: 'participant-lin',
    mode,
    ...(mode === 'retry' ? { sourceStepRef: 'step-1' } : {}),
  }];
  for (const control of controls) {
    if (control === 'reset') {
      events.push({
        ...eventBase(),
        type: 'play.actor.step.reset',
        reason: 'Retrying the provisional actor step.',
        provisional: true,
      });
    } else if (control === 'delta') {
      events.push({
        ...eventBase(),
        type: 'play.actor.step.delta',
        delta: '替代反应。',
        provisional: true,
      });
    } else {
      events.push({
        ...eventBase(),
        type: 'play.actor.step.failed',
        error: {
          code: 'provider_error',
          message: 'The test stream stopped after validating its control sequence.',
          retryable: true,
        },
      });
    }
  }
  return events;
}

function createEmptyRehearsalSession(): PlayRehearsalSessionV5 {
  return {
    schemaVersion: 5,
    id: 'play-1',
    title: '门外来客',
    createdAt: '2026-07-15T00:00:00.000Z',
    revision: 0,
    sceneStart: '雨声停在门外。',
    characters: ['林'],
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
    sceneRehearsal: {
      schemaVersion: 1,
      sessionId: 'play-1',
      purpose: 'sceneRehearsal',
      startMode: 'guided',
      activeSceneRef: 'scene-1',
      sceneContract: {
        sceneId: 'scene-1',
        worldClock: { turn: 0, revision: 0 },
        clockProvenance: {
          kind: 'newSessionInitial',
          sourceRefs: [],
          authorProvidedAt: '2026-07-15T00:00:00.000Z',
        },
        location: {
          value: '旧宅门厅',
          provenance: {
            kind: 'authorProvided',
            providedAt: '2026-07-15T00:00:00.000Z',
          },
        },
        participantRefs: ['participant-lin'],
        orderStrategy: 'directorFixed',
      },
      participants: [{
        participantRef: 'participant-lin',
        displayName: '林',
        currentGoal: '判断来客身份',
        initialKnowledgeEvidenceRefs: ['knowledge-1'],
      }],
      initialKnowledgeEvidence: [{
        id: 'knowledge-1',
        participantRef: 'participant-lin',
        visibility: 'playerVisible',
        fact: '林知道门外的人刚刚敲了三下。',
        provenance: {
          kind: 'authorProvided',
          providedAt: '2026-07-15T00:00:00.000Z',
        },
      }],
    },
    rehearsalScenes: [{
      schemaVersion: 1,
      sessionId: 'play-1',
      sceneId: 'scene-1',
      turns: [],
    }],
  };
}

function createCommittedRehearsalFixture() {
  const session = createEmptyRehearsalSession();
  const step = { ...createStep('selected') };
  const generateReceipt = createReceipt('step-key', 1, 'step-1');
  const acceptReceipt = createReceipt('accept-key', 2, 'step-1');
  const receipt = {
    idempotencyKey: 'finalize-key',
    requestFingerprint: 'finalize-key-fingerprint',
    attemptRevision: 2,
  };
  const artifact = {
    schemaVersion: 3 as const,
    artifactKind: 'worldSettlement' as const,
    branchSnapshotVersion: 1 as const,
    id: 'turn-artifact-1',
    revision: 1,
    input: { kind: 'do' as const, raw: '继续推演。' },
    messages: [{
      id: 'turn-1-user',
      speaker: 'user',
      content: '继续推演。',
      createdAt: '2026-07-15T00:02:00.000Z',
      actionKind: 'do' as const,
    }, {
      id: 'turn-1-referee',
      speaker: 'world-referee',
      content: '林抬起头，侧耳听向门外。',
      createdAt: '2026-07-15T00:02:00.000Z',
    }],
    worldClock: { turn: 1, revision: 1 },
    eventIds: [],
    dueScheduledEventIds: [],
    scheduledEventIds: [],
    scheduledEventSnapshots: [],
    playLocalStateSnapshot: {},
    playLocalStateVisibilitySnapshot: {},
    observationIds: [],
    rehearsalEvidenceRefs: ['evidence-1'],
    stateDelta: {},
    suggestedActions: [],
    committedAt: '2026-07-15T00:02:00.000Z',
    canonical: false as const,
  };
  session.revision = 1;
  session.worldClock = { turn: 1, revision: 1 };
  session.transcript = artifact.messages;
  session.turnArtifacts = [artifact];
  session.selectedTurnIds = [artifact.id];
  const evidence = {
    id: 'evidence-1',
    owningTurnArtifactId: artifact.id,
    attemptId: 'attempt-1',
    selectedStepRefs: [step.id],
    steps: [{
      stepRef: step.id,
      participantRef: step.participantRef,
      perceptionRef: step.perceptionRef,
      intentSummary: step.intentSummary,
      narrativeBlocks: step.narrativeBlocks,
      settlementEventRefs: [],
      decisionBasisRefs: step.decisionBasisRefs,
    }],
    hostNarrativeBlocks: [],
    narrativeBlocks: step.narrativeBlocks,
    finalizeReceipt: receipt,
    committedAt: artifact.committedAt,
    canonical: false as const,
  };
  session.rehearsalScenes[0]!.turns = [evidence];
  const attempt: PlayTurnAttempt = {
    ...createRunningAttempt(),
    attemptRevision: 2,
    status: 'committed',
    selectedStepRefs: [step.id],
    selectedHeadRef: step.id,
    steps: [step],
    mutationReceipts: [generateReceipt, acceptReceipt],
    committedArtifactRef: artifact.id,
    committedEvidenceRef: 'evidence-1',
    updatedAt: artifact.committedAt,
  };
  return { session, attempt, artifact, evidence, receipt };
}

function createAdvancedFinalizeReplayFixture() {
  const first = createCommittedRehearsalFixture();
  const session = structuredClone(first.session);
  const secondStep: CharacterStepDraft = {
    ...createStep('selected'),
    id: 'step-2',
    attemptId: 'attempt-2',
    perceptionRef: 'perception-scene-1-participant-lin-1',
    narrativeBlocks: [{
      ...createStep('selected').narrativeBlocks[0]!,
      id: 'block-2',
      content: '林走到门边，确认门外的人仍在等待。',
    }],
    createdAt: '2026-07-15T00:03:00.000Z',
  };
  const secondArtifact = {
    ...structuredClone(first.artifact),
    id: 'turn-artifact-2',
    parentTurnId: first.artifact.id,
    revision: 2,
    input: { kind: 'do' as const, raw: '继续确认门外情况。' },
    messages: [{
      id: 'turn-2-user',
      speaker: 'user',
      content: '继续确认门外情况。',
      createdAt: '2026-07-15T00:04:00.000Z',
      actionKind: 'do' as const,
    }, {
      id: 'turn-2-referee',
      speaker: 'world-referee',
      content: '林走到门边，确认门外的人仍在等待。',
      createdAt: '2026-07-15T00:04:00.000Z',
    }],
    worldClock: { turn: 2, revision: 2 },
    rehearsalEvidenceRefs: ['evidence-2'],
    committedAt: '2026-07-15T00:04:00.000Z',
  };
  const secondReceipt = {
    idempotencyKey: 'finalize-key-2',
    requestFingerprint: 'finalize-key-2-fingerprint',
    attemptRevision: 2,
  };
  const secondEvidence = {
    id: 'evidence-2',
    owningTurnArtifactId: secondArtifact.id,
    attemptId: 'attempt-2',
    selectedStepRefs: [secondStep.id],
    steps: [{
      stepRef: secondStep.id,
      participantRef: secondStep.participantRef,
      perceptionRef: secondStep.perceptionRef,
      intentSummary: secondStep.intentSummary,
      narrativeBlocks: secondStep.narrativeBlocks,
      settlementEventRefs: [],
      decisionBasisRefs: secondStep.decisionBasisRefs,
    }],
    hostNarrativeBlocks: [],
    narrativeBlocks: secondStep.narrativeBlocks,
    finalizeReceipt: secondReceipt,
    committedAt: secondArtifact.committedAt,
    canonical: false as const,
  };
  session.revision = 2;
  session.worldClock = { turn: 2, revision: 2 };
  session.transcript = [...first.artifact.messages, ...secondArtifact.messages];
  session.turnArtifacts = [first.artifact, secondArtifact];
  session.selectedTurnIds = [first.artifact.id, secondArtifact.id];
  session.rehearsalScenes[0]!.turns = [first.evidence, secondEvidence];
  return {
    session,
    artifact: first.artifact,
    evidence: first.evidence,
    receipt: first.receipt,
  };
}

function sseResponse(
  events: PlayRehearsalStepStreamEvent[],
  stepRunId: string,
  done = true,
): Response {
  const frames = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
    + (done ? 'data: [DONE]\n\n' : '');
  return new Response(frames, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'X-OAN-Play-Step-Run-Id': stepRunId,
    },
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}
