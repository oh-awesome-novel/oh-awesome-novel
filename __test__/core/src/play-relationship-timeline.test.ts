import { describe, expect, it } from 'vite-plus/test';

import {
  PLAY_RELATIONSHIP_PROTAGONIST,
  createPlaySessionDraft,
  projectPlayRelationshipTimeline,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeSettlement,
} from '@oh-awesome-novel/core';
import type { PlaySession, PlayWorldRefereeSettlementEvent } from '@oh-awesome-novel/core';

const HIDDEN_REASON = 'Lin secretly read the forged letter.';

function relationshipEvent(
  title: string,
  summary: string,
  overrides: Partial<PlayWorldRefereeSettlementEvent> = {},
): PlayWorldRefereeSettlementEvent {
  return {
    kind: 'relationshipChanged',
    origin: 'npc',
    title,
    summary,
    visibility: 'playerVisible',
    cause: { reason: HIDDEN_REASON },
    ...overrides,
  };
}

function settle(
  session: PlaySession,
  userText: string,
  events: PlayWorldRefereeSettlementEvent[],
  extra: Partial<Parameters<typeof settlePlayWorldRefereeSettlement>[0]['settlement']> = {},
): PlaySession {
  return settlePlayWorldRefereeSettlement({
    session,
    userText,
    actionKind: 'say',
    narrative: 'The scene moves on.',
    createdAt: `2026-11-10T00:0${session.revision + 1}:00.000Z`,
    settlement: {
      events,
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      knowledgeChanges: [],
      stateDelta: {},
      observations: [],
      suggestedActions: [],
      ...extra,
    },
  });
}

function baseSession(): PlaySession {
  return createPlaySessionDraft({
    id: 'play-relationships',
    title: 'Relationships',
    createdAt: '2026-11-10T00:00:00.000Z',
    sceneStart: 'A quiet station.',
    characters: ['Lin', 'Mara'],
    eventPolicy: { simulationMode: 'activeWorld', density: 'volatile', maxExternalEventsPerTurn: 4 },
    worldMomentum: {
      pressures: [{
        id: 'trust-lin',
        kind: 'relationship',
        label: 'Lin is deciding whether to trust you',
        status: 'active',
        causeRefs: ['branch-base'],
        nextConsequence: 'Lin stops answering questions.',
        visibility: 'playerVisible',
      }, {
        id: 'grudge-mara',
        kind: 'relationship',
        label: 'Mara nurses a hidden grudge',
        status: 'latent',
        causeRefs: ['branch-base'],
        visibility: 'playerUnknown',
      }, {
        id: 'train',
        kind: 'deadline',
        label: 'Lin must catch the train',
        status: 'active',
        causeRefs: ['branch-base'],
        visibility: 'playerVisible',
      }],
      agendas: [],
    },
  });
}

describe('Play relationship timeline', () => {
  it('groups changes by the people named and keeps them in turn order', () => {
    let session = settle(baseSession(), 'I greet Lin.', [
      relationshipEvent('Lin warms up', 'Lin relaxes around you.'),
      relationshipEvent('Old friends', 'Lin and Mara share a look.'),
      { ...relationshipEvent('Rain', 'It rains on Lin.'), kind: 'environmentChanged' },
    ]);
    session = settle(session, 'I lie to Lin.', [
      relationshipEvent('Lin doubts you', 'Lin stops meeting your eyes.'),
    ]);

    const timeline = projectPlayRelationshipTimeline(session, 'director');

    expect(timeline).toMatchObject({
      sessionId: 'play-relationships',
      revision: 2,
      selectedHead: 'turn-artifact-2',
      lens: 'director',
      canonical: false,
    });
    const withYou = timeline.threads.find((thread) =>
      thread.participants.join('|') === `Lin|${PLAY_RELATIONSHIP_PROTAGONIST}`)!;
    expect(withYou.entries.map((entry) => [entry.turn, entry.source, entry.title])).toEqual([
      [0, 'pressure', 'Lin is deciding whether to trust you'],
      [1, 'event', 'Lin warms up'],
      [2, 'event', 'Lin doubts you'],
    ]);
    expect(withYou.entries[1]).toMatchObject({
      artifactId: 'turn-artifact-1',
      eventId: 'turn-1-event-1',
      reason: HIDDEN_REASON,
    });
    const pair = timeline.threads.find((thread) => thread.participants.join('|') === 'Lin|Mara')!;
    expect(pair.entries.map((entry) => entry.title)).toEqual(['Old friends']);
    // Non-relationship events and non-relationship pressures never enter the panel.
    const titles = timeline.threads.flatMap((thread) => thread.entries.map((entry) => entry.title));
    expect(titles).not.toContain('Rain');
    expect(titles).not.toContain('Lin must catch the train');
  });

  it('records qualitative pressure movement without any numeric meter', () => {
    const session = settle(baseSession(), 'I press Lin.', [{
      kind: 'npcActed',
      origin: 'npc',
      title: 'Lin walks away',
      summary: 'Lin turns towards the exit.',
      visibility: 'playerVisible',
      cause: { reason: 'Trust ran out.', pressureId: 'trust-lin' },
    }], {
      pressureChanges: [{ pressureId: 'trust-lin', reason: 'Trust ran out.', status: 'resolved' }],
    });

    const entries = projectPlayRelationshipTimeline(session, 'player')
      .threads.flatMap((thread) => thread.entries);
    const moved = entries.find((entry) => entry.id === 'pressure:trust-lin:turn-artifact-1')!;

    expect(moved).toMatchObject({
      source: 'pressure',
      turn: 1,
      eventId: 'turn-1-event-1',
      pressureStatus: { from: 'active', to: 'resolved' },
    });
    expect(JSON.stringify(entries)).not.toMatch(/level|threshold/u);
  });

  it('reflects only the selected branch after a Restore', () => {
    const first = settle(baseSession(), 'I greet Lin.', [
      relationshipEvent('Lin warms up', 'Lin relaxes around you.'),
    ]);
    const abandoned = settle(first, 'I insult Lin.', [
      relationshipEvent('Lin is furious', 'Lin will not forgive you.'),
    ]);
    const restored = restorePlaySessionCheckpoint(abandoned, 'turn-artifact-1', {
      baseRevision: abandoned.revision,
    });
    const sibling = settle(restored, 'I thank Lin.', [
      relationshipEvent('Lin trusts you', 'Lin hands you the key.'),
    ]);

    const titles = (session: PlaySession) => projectPlayRelationshipTimeline(session, 'director')
      .threads.flatMap((thread) => thread.entries.map((entry) => entry.title));

    expect(titles(abandoned)).toContain('Lin is furious');
    expect(titles(sibling)).toContain('Lin warms up');
    expect(titles(sibling)).toContain('Lin trusts you');
    // The sibling branch's event still exists in the ledger but is off the selected path.
    expect(sibling.events.map((event) => event.title)).toContain('Lin is furious');
    expect(titles(sibling)).not.toContain('Lin is furious');
  });

  it('never leaks hidden events, hidden pressures or cause reasons to the Player lens', () => {
    const session = settle(baseSession(), 'I greet Lin.', [
      relationshipEvent('Lin warms up', 'Lin relaxes around you.'),
      relationshipEvent('Mara turns on Lin', 'Mara decides to betray Lin tonight.', {
        visibility: 'playerUnknown',
      }),
      relationshipEvent('Whispers', 'People say Mara and Lin quarrelled.', { visibility: 'rumor' }),
    ]);

    const player = projectPlayRelationshipTimeline(session, 'player');
    const director = projectPlayRelationshipTimeline(session, 'director');
    const playerJson = JSON.stringify(player);

    expect(playerJson).not.toContain('Mara turns on Lin');
    expect(playerJson).not.toContain('betray');
    expect(playerJson).not.toContain('hidden grudge');
    expect(playerJson).not.toContain(HIDDEN_REASON);
    expect(playerJson).not.toContain('"reason"');
    expect(playerJson).not.toContain('playerUnknown');
    expect(playerJson).toContain('Lin warms up');
    expect(playerJson).toContain('Whispers');

    const directorJson = JSON.stringify(director);
    expect(directorJson).toContain('Mara turns on Lin');
    expect(directorJson).toContain('Mara nurses a hidden grudge');
    expect(directorJson).toContain(HIDDEN_REASON);
  });
});
