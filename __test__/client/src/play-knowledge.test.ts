import { describe, expect, it } from 'vitest';

import {
  createOanClient,
  MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN,
  MAX_PLAY_KNOWLEDGE_RECORDS,
  PLAY_KNOWLEDGE_STATE_KEY,
  PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION,
  type PlayEventRevealRecord,
  type PlayKnowledgeChange,
  type PlayKnowledgeState,
  type PlaySessionV4,
  type PlayTurnArtifact,
  type PlayWorldEvent,
} from '@oh-awesome-novel/client';

describe('Play branch-local knowledge client contract', () => {
  it('exports the frozen contract and accepts unknown -> rumor -> visible', async () => {
    const change: PlayKnowledgeChange = {
      type: 'revealEvent',
      subjectEventId: 'event-hidden',
      playerProjection: 'rumor',
    };
    expect(change.type).toBe('revealEvent');
    expect(PLAY_KNOWLEDGE_STATE_KEY).toBe('playKnowledge');
    expect(PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION).toBe(1);
    expect(MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN).toBe(8);
    expect(MAX_PLAY_KNOWLEDGE_RECORDS).toBe(512);

    const rumorSession = createRumorRevealSession();
    await expect(readSession(rumorSession)).resolves.toEqual({
      session: rumorSession,
    });

    const visibleSession = appendVisibleReveal(rumorSession);
    await expect(readSession(visibleSession)).resolves.toEqual({
      session: visibleSession,
    });
  });

  it.each([
    {
      name: 'non-hidden reserved visibility',
      mutate(session: PlaySessionV4) {
        session.playLocalStateVisibility.playKnowledge = 'playerVisible';
        session.turnArtifacts[1]!.playLocalStateVisibilitySnapshot!.playKnowledge =
          'playerVisible';
      },
    },
    {
      name: 'unknown record field',
      mutate(session: PlaySessionV4) {
        for (const state of currentKnowledgeStates(session)) {
          (state.records[0] as unknown as Record<string, unknown>).forged = true;
        }
      },
    },
    {
      name: 'non-host record id',
      mutate(session: PlaySessionV4) {
        for (const state of currentKnowledgeStates(session)) {
          state.records[0]!.id = 'forged-record';
        }
      },
    },
    {
      name: 'unknown projection enum',
      mutate(session: PlaySessionV4) {
        for (const state of currentKnowledgeStates(session)) {
          (state.records[0] as unknown as { playerProjection: string })
            .playerProjection = 'directorVisible';
        }
      },
    },
    {
      name: 'participant grant in M3',
      mutate(session: PlaySessionV4) {
        for (const state of currentKnowledgeStates(session)) {
          (state.records[0]!.knownByParticipantRefs as string[]).push('character-lin');
        }
      },
    },
    {
      name: 'canonical knowledge record',
      mutate(session: PlaySessionV4) {
        for (const state of currentKnowledgeStates(session)) {
          (state.records[0] as unknown as { canonical: boolean }).canonical = true;
        }
      },
    },
  ])('rejects $name', async ({ mutate }) => {
    const session = createRumorRevealSession();
    mutate(session);
    await expect(readSession(session)).rejects.toThrow(/invalid payload/iu);
  });

  it('rejects edited predecessor prefixes and a selected-head projection mismatch', async () => {
    const editedPrefix = appendVisibleReveal(createRumorRevealSession());
    const head = editedPrefix.turnArtifacts[2]!;
    const changedTurnId = 'forged-prior-turn';
    knowledgeStateFromDelta(head).records[0]!.revealedAtTurnId = changedTurnId;
    knowledgeStateFromSnapshot(head).records[0]!.revealedAtTurnId = changedTurnId;
    knowledgeStateFromSession(editedPrefix).records[0]!.revealedAtTurnId = changedTurnId;
    await expect(readSession(editedPrefix)).rejects.toThrow(/invalid payload/iu);

    const mismatchedHead = createRumorRevealSession();
    knowledgeStateFromSession(mismatchedHead).records[0]!.revealedAtTurnId =
      'forged-selected-projection';
    await expect(readSession(mismatchedHead)).rejects.toThrow(/invalid payload/iu);
  });

  it.each([
    {
      name: 'unknown subject',
      mutate(session: PlaySessionV4) {
        replaceCurrentSubject(session, 'event-does-not-exist');
      },
    },
    {
      name: 'same-turn subject',
      mutate(session: PlaySessionV4) {
        const artifact = session.turnArtifacts[1]!;
        const currentHidden = createEvent({
          id: 'event-hidden-current',
          turnId: artifact.messages[1]!.id!,
          sequence: 2,
          visibility: 'playerUnknown',
          kind: 'npcActed',
          worldClock: artifact.worldClock!,
          cause: { reason: 'A current hidden event.' },
        });
        session.events.push(currentHidden);
        artifact.eventIds.unshift(currentHidden.id);
        replaceCurrentSubject(session, currentHidden.id);
      },
    },
    {
      name: 'sibling subject',
      mutate(session: PlaySessionV4) {
        addSiblingSubject(session);
      },
    },
    {
      name: 'wrong reveal event kind',
      mutate(session: PlaySessionV4) {
        session.events.find((event) => event.id === 'event-reveal-rumor')!.kind =
          'manual';
      },
    },
    {
      name: 'ambiguous reveal event pair',
      mutate(session: PlaySessionV4) {
        const artifact = session.turnArtifacts[1]!;
        const duplicate = createEvent({
          id: 'event-reveal-rumor-duplicate',
          turnId: artifact.messages[1]!.id!,
          sequence: 2,
          visibility: 'rumor',
          kind: 'informationSpread',
          worldClock: artifact.worldClock!,
          cause: {
            reason: 'A second rumor repeats the same reveal.',
            sourceEventIds: ['event-hidden'],
          },
        });
        session.events.push(duplicate);
        artifact.eventIds.push(duplicate.id);
      },
    },
  ])('rejects $name', async ({ mutate }) => {
    const session = createRumorRevealSession();
    mutate(session);
    await expect(readSession(session)).rejects.toThrow(/invalid payload/iu);
  });

  it('rejects duplicate same-turn subject changes and a rumor no-op', async () => {
    const duplicate = createRumorRevealSession();
    const artifact = duplicate.turnArtifacts[1]!;
    const visibleEvent = createEvent({
      id: 'event-reveal-visible-same-turn',
      turnId: artifact.messages[1]!.id!,
      sequence: 2,
      visibility: 'playerVisible',
      kind: 'informationSpread',
      worldClock: artifact.worldClock!,
      cause: {
        reason: 'The same source is confirmed immediately.',
        sourceEventIds: ['event-hidden'],
      },
    });
    const secondRecord: PlayEventRevealRecord = {
      id: 'knowledge-2-2',
      kind: 'eventReveal',
      subjectEventId: 'event-hidden',
      previousPlayerProjection: 'rumor',
      playerProjection: 'playerVisible',
      knownByParticipantRefs: [],
      revealedAtTurnId: artifact.messages[1]!.id!,
      revealedByEventId: visibleEvent.id,
      canonical: false,
    };
    for (const state of currentKnowledgeStates(duplicate)) {
      state.records.push(structuredClone(secondRecord));
    }
    duplicate.events.push(visibleEvent);
    artifact.eventIds.push(visibleEvent.id);
    await expect(readSession(duplicate)).rejects.toThrow(/invalid payload/iu);

    const noOp = appendVisibleReveal(createRumorRevealSession());
    const noOpArtifact = noOp.turnArtifacts[2]!;
    for (const state of currentKnowledgeStates(noOp, 2)) {
      state.records[1]!.playerProjection = 'rumor';
    }
    noOp.events.find((event) =>
      event.id === 'event-reveal-visible')!.visibility = 'rumor';
    await expect(readSession(noOp)).rejects.toThrow(/invalid payload/iu);
  });

  it('rejects transcript-only mutation of the reserved knowledge state', async () => {
    const session = createRumorRevealSession();
    const predecessor = session.turnArtifacts[1]!;
    const nextState = structuredClone(knowledgeStateFromSnapshot(predecessor));
    const transcriptArtifact: PlayTurnArtifact = {
      schemaVersion: 2,
      artifactKind: 'transcriptAppend',
      branchSnapshotVersion: 1,
      id: 'artifact-transcript-3',
      revision: 3,
      parentTurnId: predecessor.id,
      messages: [{
        id: 'turn-3-transcript',
        speaker: 'narrator',
        content: 'A transcript-only continuation.',
        createdAt: '2026-07-16T00:03:00.000Z',
      }],
      worldClock: { turn: 2, revision: 3 },
      eventIds: [],
      dueScheduledEventIds: [],
      scheduledEventIds: [],
      scheduledEventSnapshots: [],
      playLocalStateSnapshot: { playKnowledge: structuredClone(nextState) },
      playLocalStateVisibilitySnapshot: { playKnowledge: 'playerUnknown' },
      observationIds: [],
      stateDelta: { playKnowledge: structuredClone(nextState) },
      suggestedActions: [],
      committedAt: '2026-07-16T00:03:00.000Z',
      canonical: false,
    };
    session.turnArtifacts.push(transcriptArtifact);
    session.selectedTurnIds.push(transcriptArtifact.id);
    session.transcript.push(...transcriptArtifact.messages);
    session.revision = 3;
    session.worldClock = { turn: 2, revision: 3 };
    session.playLocalState = { playKnowledge: structuredClone(nextState) };
    await expect(readSession(session)).rejects.toThrow(/invalid payload/iu);
  });
});

function createRumorRevealSession(): PlaySessionV4 {
  const firstMessages = createMessagePair(1);
  const secondMessages = createMessagePair(2);
  const hiddenEvent = createEvent({
    id: 'event-hidden',
    turnId: firstMessages[1]!.id!,
    sequence: 1,
    visibility: 'playerUnknown',
    kind: 'npcActed',
    worldClock: { turn: 1, revision: 1 },
    cause: { reason: 'The courier moved out of sight.' },
  });
  const revealEvent = createEvent({
    id: 'event-reveal-rumor',
    turnId: secondMessages[1]!.id!,
    sequence: 1,
    visibility: 'rumor',
    kind: 'informationSpread',
    worldClock: { turn: 2, revision: 2 },
    cause: {
      reason: 'A witness shares a partial account.',
      sourceEventIds: [hiddenEvent.id],
    },
  });
  const record: PlayEventRevealRecord = {
    id: 'knowledge-2-1',
    kind: 'eventReveal',
    subjectEventId: hiddenEvent.id,
    previousPlayerProjection: 'playerUnknown',
    playerProjection: 'rumor',
    knownByParticipantRefs: [],
    revealedAtTurnId: secondMessages[1]!.id!,
    revealedByEventId: revealEvent.id,
    canonical: false,
  };
  const knowledge: PlayKnowledgeState = {
    schemaVersion: 1,
    records: [record],
  };
  const firstArtifact = createWorldArtifact({
    id: 'artifact-hidden-1',
    revision: 1,
    messages: firstMessages,
    eventIds: [hiddenEvent.id],
    stateSnapshot: {},
    visibilitySnapshot: {},
    stateDelta: {},
  });
  const secondArtifact = createWorldArtifact({
    id: 'artifact-reveal-2',
    revision: 2,
    parentTurnId: firstArtifact.id,
    messages: secondMessages,
    eventIds: [revealEvent.id],
    stateSnapshot: { playKnowledge: structuredClone(knowledge) },
    visibilitySnapshot: { playKnowledge: 'playerUnknown' },
    stateDelta: { playKnowledge: structuredClone(knowledge) },
  });

  return {
    schemaVersion: 4,
    id: 'play-knowledge',
    title: 'Branch-local reveal',
    createdAt: '2026-07-16T00:00:00.000Z',
    revision: 2,
    sceneStart: 'A courier crosses the station after dark.',
    characters: [],
    transcript: [...firstMessages, ...secondMessages],
    turnArtifacts: [firstArtifact, secondArtifact],
    selectedTurnIds: [firstArtifact.id, secondArtifact.id],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: { playKnowledge: structuredClone(knowledge) },
    playLocalStateVisibility: { playKnowledge: 'playerUnknown' },
    worldClock: { turn: 2, revision: 2 },
    eventPolicy: {
      simulationMode: 'activeWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [hiddenEvent, revealEvent],
    scheduledEvents: [],
    suggestedActions: [],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}

function appendVisibleReveal(source: PlaySessionV4): PlaySessionV4 {
  const session = structuredClone(source);
  const parent = session.turnArtifacts[1]!;
  const messages = createMessagePair(3);
  const event = createEvent({
    id: 'event-reveal-visible',
    turnId: messages[1]!.id!,
    sequence: 1,
    visibility: 'playerVisible',
    kind: 'informationSpread',
    worldClock: { turn: 3, revision: 3 },
    cause: {
      reason: 'The courier confirms the earlier rumor.',
      sourceEventIds: ['event-hidden'],
    },
  });
  const previous = knowledgeStateFromSnapshot(parent);
  const next: PlayKnowledgeState = {
    schemaVersion: 1,
    records: [
      ...structuredClone(previous.records),
      {
        id: 'knowledge-3-1',
        kind: 'eventReveal',
        subjectEventId: 'event-hidden',
        previousPlayerProjection: 'rumor',
        playerProjection: 'playerVisible',
        knownByParticipantRefs: [],
        revealedAtTurnId: messages[1]!.id!,
        revealedByEventId: event.id,
        canonical: false,
      },
    ],
  };
  const artifact = createWorldArtifact({
    id: 'artifact-reveal-3',
    revision: 3,
    parentTurnId: parent.id,
    messages,
    eventIds: [event.id],
    stateSnapshot: { playKnowledge: structuredClone(next) },
    visibilitySnapshot: { playKnowledge: 'playerUnknown' },
    stateDelta: { playKnowledge: structuredClone(next) },
  });
  session.revision = 3;
  session.turnArtifacts.push(artifact);
  session.selectedTurnIds.push(artifact.id);
  session.transcript.push(...messages);
  session.playLocalState = { playKnowledge: structuredClone(next) };
  session.worldClock = { turn: 3, revision: 3 };
  session.events.push(event);
  return session;
}

function createWorldArtifact(input: {
  id: string;
  revision: number;
  parentTurnId?: string;
  messages: ReturnType<typeof createMessagePair>;
  eventIds: string[];
  stateSnapshot: Record<string, unknown>;
  visibilitySnapshot: PlayTurnArtifact['playLocalStateVisibilitySnapshot'];
  stateDelta: Record<string, unknown>;
}): PlayTurnArtifact {
  return {
    schemaVersion: 2,
    artifactKind: 'worldSettlement',
    branchSnapshotVersion: 1,
    id: input.id,
    revision: input.revision,
    ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
    input: { kind: 'wait', raw: `Wait ${input.revision}.` },
    messages: input.messages,
    worldClock: { turn: input.revision, revision: input.revision },
    eventIds: input.eventIds,
    dueScheduledEventIds: [],
    scheduledEventIds: [],
    scheduledEventSnapshots: [],
    playLocalStateSnapshot: input.stateSnapshot,
    playLocalStateVisibilitySnapshot: input.visibilitySnapshot,
    observationIds: [],
    stateDelta: input.stateDelta,
    suggestedActions: [],
    committedAt: `2026-07-16T00:0${input.revision}:00.000Z`,
    canonical: false,
  };
}

function createMessagePair(revision: number) {
  return [{
    id: `turn-${revision}-user`,
    speaker: 'user',
    content: `Wait ${revision}.`,
    createdAt: `2026-07-16T00:0${revision}:00.000Z`,
    actionKind: 'wait' as const,
  }, {
    id: `turn-${revision}-referee`,
    speaker: 'world-referee',
    content: `The world advances at turn ${revision}.`,
    createdAt: `2026-07-16T00:0${revision}:00.000Z`,
  }];
}

function createEvent(input: {
  id: string;
  turnId: string;
  sequence: number;
  visibility: PlayWorldEvent['visibility'];
  kind: PlayWorldEvent['kind'];
  worldClock: PlayWorldEvent['worldClock'];
  cause: PlayWorldEvent['cause'];
}): PlayWorldEvent {
  return {
    id: input.id,
    turnId: input.turnId,
    sequence: input.sequence,
    kind: input.kind,
    origin: 'npc',
    title: `Event ${input.id}`,
    summary: `Summary for ${input.id}`,
    visibility: input.visibility,
    cause: input.cause,
    worldClock: structuredClone(input.worldClock),
    createdAt: '2026-07-16T00:00:00.000Z',
    canonical: false,
  };
}

function replaceCurrentSubject(session: PlaySessionV4, subjectEventId: string): void {
  for (const state of currentKnowledgeStates(session)) {
    state.records[0]!.subjectEventId = subjectEventId;
  }
  const reveal = session.events.find((event) => event.id === 'event-reveal-rumor')!;
  reveal.cause.sourceEventIds = [subjectEventId];
}

function addSiblingSubject(session: PlaySessionV4): void {
  const parent = session.turnArtifacts[0]!;
  const messages = createMessagePair(3);
  const event = createEvent({
    id: 'event-hidden-sibling',
    turnId: messages[1]!.id!,
    sequence: 1,
    visibility: 'playerUnknown',
    kind: 'npcActed',
    worldClock: { turn: 2, revision: 3 },
    cause: { reason: 'This event belongs to a sibling branch.' },
  });
  const sibling = createWorldArtifact({
    id: 'artifact-sibling-3',
    revision: 3,
    parentTurnId: parent.id,
    messages,
    eventIds: [event.id],
    stateSnapshot: {},
    visibilitySnapshot: {},
    stateDelta: {},
  });
  sibling.worldClock = { turn: 2, revision: 3 };
  session.turnArtifacts.push(sibling);
  session.events.push(event);
  session.revision = 3;
  session.worldClock.revision = 3;
  replaceCurrentSubject(session, event.id);
}

function currentKnowledgeStates(
  session: PlaySessionV4,
  artifactIndex = 1,
): PlayKnowledgeState[] {
  const artifact = session.turnArtifacts[artifactIndex]!;
  return [
    knowledgeStateFromDelta(artifact),
    knowledgeStateFromSnapshot(artifact),
    knowledgeStateFromSession(session),
  ];
}

function knowledgeStateFromDelta(artifact: PlayTurnArtifact): PlayKnowledgeState {
  return artifact.stateDelta.playKnowledge as PlayKnowledgeState;
}

function knowledgeStateFromSnapshot(artifact: PlayTurnArtifact): PlayKnowledgeState {
  return artifact.playLocalStateSnapshot!.playKnowledge as PlayKnowledgeState;
}

function knowledgeStateFromSession(session: PlaySessionV4): PlayKnowledgeState {
  return session.playLocalState.playKnowledge as PlayKnowledgeState;
}

async function readSession(session: PlaySessionV4) {
  const client = createOanClient({
    fetch: (async () => new Response(JSON.stringify({ session }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    systemTheme: () => 'dark',
  });
  return client.getPlaySession(session.id);
}
