import { describe, expect, it } from 'vitest';

import {
  PLAY_KNOWLEDGE_STATE_KEY,
  addPlayTranscriptTurn,
  applyPlayKnowledgeChanges,
  createEmptyPlayKnowledgeState,
  createPlaySessionDraft,
  formatPlayWorldRefereePrompt,
  listPlayKnowledgeRevealCandidates,
  normalizePlayKnowledgeChanges,
  normalizePlayKnowledgeState,
  preparePlayWorldSettlementRetry,
  projectPlayEventRevealRecord,
  readPlayKnowledgeState,
  resolvePlayKnowledgeEventProjection,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeResponse,
} from '@oh-awesome-novel/core';
import type {
  PlayEventVisibility,
  PlaySession,
  PlayWorldEvent,
} from '@oh-awesome-novel/core';

const createEvent = (input: {
  id: string;
  turnId: string;
  sequence: number;
  visibility: PlayEventVisibility;
  kind?: PlayWorldEvent['kind'];
  sourceEventIds?: string[];
  revision?: number;
}): PlayWorldEvent => ({
  id: input.id,
  turnId: input.turnId,
  sequence: input.sequence,
  kind: input.kind ?? 'npcActed',
  origin: 'npc',
  title: `Title ${input.id}`,
  summary: `Summary ${input.id}`,
  visibility: input.visibility,
  cause: {
    reason: `Reason ${input.id}`,
    ...(input.sourceEventIds ? { sourceEventIds: input.sourceEventIds } : {}),
  },
  worldClock: {
    turn: input.revision ?? 1,
    revision: input.revision ?? 1,
  },
  createdAt: '2026-07-16T00:00:00.000Z',
  canonical: false,
});

const refereeResponse = (input: {
  narrative: string;
  events: Array<{
    kind: PlayWorldEvent['kind'];
    visibility: PlayEventVisibility;
    title: string;
    summary: string;
    sourceEventIds?: string[];
  }>;
  knowledgeChanges?: Array<{
    type: 'revealEvent';
    subjectEventId: string;
    playerProjection: 'rumor' | 'playerVisible';
  }>;
}): string => [
  input.narrative,
  '```oan-play-settlement',
  JSON.stringify({
    events: input.events.map((event) => ({
      kind: event.kind,
      origin: 'npc',
      title: event.title,
      summary: event.summary,
      visibility: event.visibility,
      cause: {
        reason: `Cause for ${event.title}.`,
        ...(event.sourceEventIds
          ? { sourceEventIds: event.sourceEventIds }
          : {}),
      },
    })),
    pressureChanges: [],
    agendaChanges: [],
    scheduledEventChanges: [],
    knowledgeChanges: input.knowledgeChanges ?? [],
    stateDelta: {},
    observations: [],
    suggestedActions: [],
  }),
  '```',
].join('\n');

function createRevealChain(): {
  hidden: PlaySession;
  rumor: PlaySession;
  visible: PlaySession;
} {
  const draft = createPlaySessionDraft({
    id: 'play-knowledge-chain',
    title: 'Knowledge chain',
    sceneStart: 'A quiet station platform.',
    characters: [],
  });
  const hidden = settlePlayWorldRefereeResponse({
    session: draft,
    userText: 'Wait by the platform.',
    actionKind: 'wait',
    createdAt: '2026-07-16T00:01:00.000Z',
    refereeResponse: refereeResponse({
      narrative: 'The platform stays quiet.',
      events: [{
        kind: 'npcActed',
        visibility: 'playerUnknown',
        title: 'Courier changed the signal',
        summary: 'A courier secretly changed the departure signal.',
      }],
    }),
  });
  const hiddenEventId = hidden.events[0]!.id;
  const rumor = settlePlayWorldRefereeResponse({
    session: hidden,
    userText: 'Listen to the porters.',
    actionKind: 'look',
    createdAt: '2026-07-16T00:02:00.000Z',
    refereeResponse: refereeResponse({
      narrative: 'A porter mentions that the signal may have been disturbed.',
      events: [{
        kind: 'informationSpread',
        visibility: 'rumor',
        title: 'A signal rumor spreads',
        summary: 'Porters suspect that someone disturbed the signal.',
        sourceEventIds: [hiddenEventId],
      }],
      knowledgeChanges: [{
        type: 'revealEvent',
        subjectEventId: hiddenEventId,
        playerProjection: 'rumor',
      }],
    }),
  });
  const visible = settlePlayWorldRefereeResponse({
    session: rumor,
    userText: 'Inspect the signal box.',
    actionKind: 'look',
    createdAt: '2026-07-16T00:03:00.000Z',
    refereeResponse: refereeResponse({
      narrative: 'Fresh tool marks confirm that the signal was changed.',
      events: [{
        kind: 'informationSpread',
        visibility: 'playerVisible',
        title: 'The signal change is confirmed',
        summary: 'Fresh marks prove that someone changed the signal.',
        sourceEventIds: [hiddenEventId],
      }],
      knowledgeChanges: [{
        type: 'revealEvent',
        subjectEventId: hiddenEventId,
        playerProjection: 'playerVisible',
      }],
    }),
  });
  return { hidden, rumor, visible };
}

describe('Play branch-local knowledge', () => {
  it('strictly normalizes append-only event reveal state and changes', () => {
    expect(createEmptyPlayKnowledgeState()).toEqual({
      schemaVersion: 1,
      records: [],
    });
    expect(normalizePlayKnowledgeChanges(undefined)).toEqual([]);
    expect(() => normalizePlayKnowledgeChanges([{
      type: 'revealEvent',
      subjectEventId: 'event-1',
      playerProjection: 'rumor',
      providerAssignedId: 'forbidden',
    }])).toThrow('unknown fields');
    expect(() => normalizePlayKnowledgeChanges([
      {
        type: 'revealEvent',
        subjectEventId: 'event-1',
        playerProjection: 'rumor',
      },
      {
        type: 'revealEvent',
        subjectEventId: 'event-1',
        playerProjection: 'playerVisible',
      },
    ])).toThrow('same event more than once');
    expect(() => normalizePlayKnowledgeState({
      schemaVersion: 1,
      records: [{
        id: 'knowledge-1-1',
        kind: 'eventReveal',
        subjectEventId: 'event-1',
        previousPlayerProjection: 'rumor',
        playerProjection: 'playerVisible',
        knownByParticipantRefs: [],
        revealedAtTurnId: 'turn-1-referee',
        revealedByEventId: 'event-reveal-1',
        canonical: false,
      }],
    })).toThrow('does not continue');
  });

  it('materializes an evidence-paired reveal and rejects invalid or ambiguous subjects', () => {
    const hidden = createEvent({
      id: 'hidden-event',
      turnId: 'turn-1-referee',
      sequence: 1,
      visibility: 'playerUnknown',
    });
    const reveal = createEvent({
      id: 'reveal-event',
      turnId: 'turn-2-referee',
      sequence: 1,
      visibility: 'rumor',
      kind: 'informationSpread',
      sourceEventIds: [hidden.id],
      revision: 2,
    });
    const next = applyPlayKnowledgeChanges({
      playLocalState: {},
      selectedAncestorEvents: [hidden],
      currentEvents: [reveal],
      changes: [{
        type: 'revealEvent',
        subjectEventId: hidden.id,
        playerProjection: 'rumor',
      }],
      revision: 2,
      refereeTurnId: reveal.turnId,
    });
    expect(next.records).toEqual([{
      id: 'knowledge-2-1',
      kind: 'eventReveal',
      subjectEventId: hidden.id,
      previousPlayerProjection: 'playerUnknown',
      playerProjection: 'rumor',
      knownByParticipantRefs: [],
      revealedAtTurnId: reveal.turnId,
      revealedByEventId: reveal.id,
      canonical: false,
    }]);

    expect(() => applyPlayKnowledgeChanges({
      playLocalState: {},
      selectedAncestorEvents: [],
      currentEvents: [reveal],
      changes: [{
        type: 'revealEvent',
        subjectEventId: hidden.id,
        playerProjection: 'rumor',
      }],
      revision: 2,
      refereeTurnId: reveal.turnId,
    })).toThrow('non-ancestor');
    const siblingSubject = { ...hidden, id: 'discarded-sibling-event' };
    expect(() => applyPlayKnowledgeChanges({
      playLocalState: {},
      selectedAncestorEvents: [hidden],
      currentEvents: [{
        ...reveal,
        id: 'sibling-reveal-event',
        cause: { ...reveal.cause, sourceEventIds: [siblingSubject.id] },
      }],
      changes: [{
        type: 'revealEvent',
        subjectEventId: siblingSubject.id,
        playerProjection: 'rumor',
      }],
      revision: 2,
      refereeTurnId: reveal.turnId,
    })).toThrow('non-ancestor');
    expect(() => applyPlayKnowledgeChanges({
      playLocalState: {},
      selectedAncestorEvents: [hidden],
      currentEvents: [
        reveal,
        { ...reveal, id: 'reveal-event-duplicate', sequence: 2 },
      ],
      changes: [{
        type: 'revealEvent',
        subjectEventId: hidden.id,
        playerProjection: 'rumor',
      }],
      revision: 2,
      refereeTurnId: reveal.turnId,
    })).toThrow('exactly one');

    const sameTurnSubject = createEvent({
      id: 'same-turn-hidden',
      turnId: reveal.turnId,
      sequence: 3,
      visibility: 'playerUnknown',
      revision: 2,
    });
    const sameTurnReveal = {
      ...reveal,
      id: 'same-turn-reveal',
      cause: {
        ...reveal.cause,
        sourceEventIds: [sameTurnSubject.id],
      },
    };
    expect(() => applyPlayKnowledgeChanges({
      playLocalState: {},
      selectedAncestorEvents: [sameTurnSubject],
      currentEvents: [sameTurnReveal],
      changes: [{
        type: 'revealEvent',
        subjectEventId: sameTurnSubject.id,
        playerProjection: 'rumor',
      }],
      revision: 2,
      refereeTurnId: reveal.turnId,
    })).toThrow('strict ancestor');

    const visibleSubject = { ...hidden, id: 'visible-subject', visibility: 'playerVisible' as const };
    const visibleSubjectReveal = {
      ...reveal,
      id: 'visible-subject-reveal',
      cause: { ...reveal.cause, sourceEventIds: [visibleSubject.id] },
    };
    expect(() => applyPlayKnowledgeChanges({
      playLocalState: {},
      selectedAncestorEvents: [visibleSubject],
      currentEvents: [visibleSubjectReveal],
      changes: [{
        type: 'revealEvent',
        subjectEventId: visibleSubject.id,
        playerProjection: 'rumor',
      }],
      revision: 2,
      refereeTurnId: reveal.turnId,
    })).toThrow('only an originally playerUnknown');

    const secondHidden = { ...hidden, id: 'second-hidden' };
    const sharedReveal = {
      ...reveal,
      id: 'shared-reveal',
      cause: {
        ...reveal.cause,
        sourceEventIds: [hidden.id, secondHidden.id],
      },
    };
    expect(() => applyPlayKnowledgeChanges({
      playLocalState: {},
      selectedAncestorEvents: [hidden, secondHidden],
      currentEvents: [sharedReveal],
      changes: [{
        type: 'revealEvent',
        subjectEventId: hidden.id,
        playerProjection: 'rumor',
      }, {
        type: 'revealEvent',
        subjectEventId: secondHidden.id,
        playerProjection: 'rumor',
      }],
      revision: 2,
      refereeTurnId: reveal.turnId,
    })).toThrow('cannot reveal more than one');
  });

  it('settles unknown -> rumor -> visible without mutating the hidden event', () => {
    const { hidden, rumor, visible } = createRevealChain();
    const originalHiddenEvent = structuredClone(hidden.events[0]!);
    const hiddenEventId = originalHiddenEvent.id;
    const rumorState = readPlayKnowledgeState(rumor.playLocalState);
    const visibleState = readPlayKnowledgeState(visible.playLocalState);

    expect(rumor.events[0]).toEqual(originalHiddenEvent);
    expect(visible.events[0]).toEqual(originalHiddenEvent);
    expect(rumorState.records).toHaveLength(1);
    expect(visibleState.records).toHaveLength(2);
    expect(visibleState.records.map((record) => [
      record.id,
      record.previousPlayerProjection,
      record.playerProjection,
    ])).toEqual([
      ['knowledge-2-1', 'playerUnknown', 'rumor'],
      ['knowledge-3-1', 'rumor', 'playerVisible'],
    ]);
    expect(resolvePlayKnowledgeEventProjection(visibleState, hiddenEventId))
      .toBe('playerVisible');
    expect(visible.playLocalStateVisibility[PLAY_KNOWLEDGE_STATE_KEY])
      .toBe('playerUnknown');
    expect(visible.turnArtifacts[2]!.stateDelta[PLAY_KNOWLEDGE_STATE_KEY])
      .toEqual(visibleState);
    expect(listPlayKnowledgeRevealCandidates({
      playLocalState: visible.playLocalState,
      selectedEvents: visible.events,
    })).toEqual([]);

    const playerProjection = projectPlayEventRevealRecord(
      visibleState.records[1],
      'player',
    );
    expect(playerProjection).toMatchObject({
      lens: 'player',
      causalLabel: 'confirmsEarlierRumor',
      revealedByEventId: visible.events[2]!.id,
    });
    expect(JSON.stringify(playerProjection)).not.toContain(hiddenEventId);
    expect(JSON.stringify(playerProjection)).not.toContain(originalHiddenEvent.title);
    expect(JSON.stringify(playerProjection)).not.toContain(originalHiddenEvent.summary);
    expect(JSON.stringify(playerProjection)).not.toContain(originalHiddenEvent.cause.reason);
  });

  it('restores and retries the exact branch-local knowledge snapshot', () => {
    const { hidden, rumor, visible } = createRevealChain();
    const hiddenArtifactId = hidden.turnArtifacts[0]!.id;
    const restored = restorePlaySessionCheckpoint(visible, hiddenArtifactId);
    expect(restored.selectedTurnIds).toEqual([hiddenArtifactId]);
    expect(restored.playLocalState).not.toHaveProperty(PLAY_KNOWLEDGE_STATE_KEY);

    const branchedRumor = settlePlayWorldRefereeResponse({
      session: restored,
      userText: 'Ask a newly arrived porter.',
      actionKind: 'say',
      createdAt: '2026-07-16T00:04:00.000Z',
      refereeResponse: refereeResponse({
        narrative: 'The porter shares a cautious rumor about the signal.',
        events: [{
          kind: 'informationSpread',
          visibility: 'rumor',
          title: 'Another signal rumor spreads',
          summary: 'A new porter suspects that the signal was disturbed.',
          sourceEventIds: [hidden.events[0]!.id],
        }],
        knowledgeChanges: [{
          type: 'revealEvent',
          subjectEventId: hidden.events[0]!.id,
          playerProjection: 'rumor',
        }],
      }),
    });
    expect(readPlayKnowledgeState(branchedRumor.playLocalState).records)
      .toEqual([
        expect.objectContaining({
          id: `knowledge-${branchedRumor.revision}-1`,
          previousPlayerProjection: 'playerUnknown',
          playerProjection: 'rumor',
        }),
      ]);

    const retry = preparePlayWorldSettlementRetry(
      visible,
      visible.turnArtifacts[2]!.id,
    );
    expect(readPlayKnowledgeState(retry.beforeTurnSession.playLocalState).records)
      .toEqual(readPlayKnowledgeState(rumor.playLocalState).records);
  });

  it('rejects reveal no-ops and downgrades and preserves knowledge on transcript append', () => {
    const { rumor, visible } = createRevealChain();
    const hiddenEventId = rumor.events[0]!.id;
    expect(() => settlePlayWorldRefereeResponse({
      session: rumor,
      userText: 'Ask whether the rumor is still only a rumor.',
      actionKind: 'say',
      refereeResponse: refereeResponse({
        narrative: 'The same unconfirmed story circulates again.',
        events: [{
          kind: 'informationSpread',
          visibility: 'rumor',
          title: 'The same rumor circulates',
          summary: 'Nothing new confirms the signal story.',
          sourceEventIds: [hiddenEventId],
        }],
        knowledgeChanges: [{
          type: 'revealEvent',
          subjectEventId: hiddenEventId,
          playerProjection: 'rumor',
        }],
      }),
    })).toThrow('no-op');
    expect(() => settlePlayWorldRefereeResponse({
      session: visible,
      userText: 'Treat the proof as a rumor again.',
      actionKind: 'say',
      refereeResponse: refereeResponse({
        narrative: 'Someone tries to cast doubt on established proof.',
        events: [{
          kind: 'informationSpread',
          visibility: 'rumor',
          title: 'Proof is recast as rumor',
          summary: 'A speaker tries to downgrade confirmed evidence.',
          sourceEventIds: [hiddenEventId],
        }],
        knowledgeChanges: [{
          type: 'revealEvent',
          subjectEventId: hiddenEventId,
          playerProjection: 'rumor',
        }],
      }),
    })).toThrow('already playerVisible');

    const appended = addPlayTranscriptTurn(rumor, {
      speaker: 'narrator',
      content: 'The rumor hangs in the air.',
      createdAt: '2026-07-16T00:02:30.000Z',
    });
    expect(readPlayKnowledgeState(appended.playLocalState))
      .toEqual(readPlayKnowledgeState(rumor.playLocalState));
    expect(appended.turnArtifacts.at(-1)!.stateDelta).toEqual({});

    const tampered = structuredClone(appended);
    const transcriptArtifact = tampered.turnArtifacts.at(-1)!;
    transcriptArtifact.stateDelta[PLAY_KNOWLEDGE_STATE_KEY] = structuredClone(
      tampered.playLocalState[PLAY_KNOWLEDGE_STATE_KEY],
    );
    expect(() => formatPlayWorldRefereePrompt(tampered)).toThrow(
      /invalid transcript append shape|host-materialized appended records/u,
    );
  });

  it('rejects raw reserved state writes and tampered record history', () => {
    const draft = createPlaySessionDraft({
      id: 'play-knowledge-reserved-write',
      title: 'Reserved state write',
      sceneStart: 'A quiet platform.',
      characters: [],
    });
    expect(() => settlePlayWorldRefereeResponse({
      session: draft,
      userText: 'Wait.',
      actionKind: 'wait',
      refereeResponse: [
        'Nothing visible changes.',
        '```oan-play-settlement',
        JSON.stringify({
          events: [],
          knowledgeChanges: [],
          stateDelta: {
            playKnowledge: { schemaVersion: 1, records: [] },
          },
          observations: [],
          suggestedActions: [],
        }),
        '```',
      ].join('\n'),
    })).toThrow('reserved state');

    const { visible } = createRevealChain();
    const tampered = structuredClone(visible);
    const state = tampered.turnArtifacts[2]!.playLocalStateSnapshot![
      PLAY_KNOWLEDGE_STATE_KEY
    ] as { records: Array<{ subjectEventId: string }> };
    state.records[0]!.subjectEventId = 'forged-sibling-event';
    expect(() => formatPlayWorldRefereePrompt(tampered)).toThrow(
      /does not continue|state snapshot does not match/u,
    );
  });
});
