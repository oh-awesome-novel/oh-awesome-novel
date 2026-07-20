import { describe, expect, it } from 'vitest';

import {
  addPlayTranscriptTurn,
  addPlayAdoptionCandidate,
  createPlayAdoptionCandidate,
  createPlaySessionDraft,
  projectPlaySessionSelectedDetail,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeSettlement,
  summarizePlaySession,
} from '@oh-awesome-novel/core';

describe('Play session bounded read model', () => {
  it('returns summary metadata without historical arrays and pages the selected transcript', () => {
    let session = createPlaySessionDraft({
      id: 'play-long',
      title: 'Long Play',
      createdAt: '2026-07-20T00:00:00.000Z',
      sceneStart: 'At the gate',
      characters: ['Mira'],
    });
    for (let index = 1; index <= 7; index += 1) {
      session = addPlayTranscriptTurn(session, {
        id: `message-${index}`,
        speaker: 'user',
        content: `Turn ${index}`,
        createdAt: `2026-07-20T00:00:0${index}.000Z`,
      });
    }

    const summary = summarizePlaySession(session);
    expect(summary).toMatchObject({
      id: 'play-long',
      revision: 7,
      selectedTurnCount: 7,
      transcriptCount: 7,
      eventCount: 0,
      selectedArtifactId: session.selectedTurnIds.at(-1),
      latestActivityAt: '2026-07-20T00:00:07.000Z',
      canonical: false,
    });
    expect(summary).not.toHaveProperty('transcript');
    expect(summary).not.toHaveProperty('events');
    expect(summary).not.toHaveProperty('turnArtifacts');

    const latest = projectPlaySessionSelectedDetail(session, { limit: 3 });
    expect(latest.snapshot).not.toHaveProperty('transcript');
    expect(latest.snapshot).not.toHaveProperty('events');
    expect(latest.snapshot).not.toHaveProperty('turnArtifacts');
    expect(latest.transcript).toMatchObject({
      totalCount: 7,
      hasMoreBefore: true,
    });
    expect(latest.transcript.items.map((turn) => turn.id)).toEqual([
      'message-5',
      'message-6',
      'message-7',
    ]);

    const older = projectPlaySessionSelectedDetail(session, {
      limit: 3,
      transcriptCursor: latest.transcript.nextCursor,
    });
    expect(older.transcript.items.map((turn) => turn.id)).toEqual([
      'message-2',
      'message-3',
      'message-4',
    ]);
  });

  it('rejects cursors after revision or selected-head drift', () => {
    const base = addPlayTranscriptTurn(createPlaySessionDraft({
      id: 'play-cursor',
      title: 'Cursor',
      sceneStart: 'Start',
      characters: [],
    }), {
      id: 'message-1',
      speaker: 'user',
      content: 'One',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    const withSecond = addPlayTranscriptTurn(base, {
      id: 'message-2',
      speaker: 'user',
      content: 'Two',
      createdAt: '2026-07-20T00:00:01.000Z',
    });
    const cursor = projectPlaySessionSelectedDetail(withSecond, { limit: 1 })
      .transcript.nextCursor!;
    const advanced = addPlayTranscriptTurn(withSecond, {
      id: 'message-3',
      speaker: 'user',
      content: 'Three',
      createdAt: '2026-07-20T00:00:02.000Z',
    });

    expect(() => projectPlaySessionSelectedDetail(advanced, {
      limit: 1,
      transcriptCursor: cursor,
    })).toThrow('stale or belongs to another selected branch');
    expect(() => projectPlaySessionSelectedDetail(withSecond, {
      limit: 1,
      eventCursor: cursor,
    })).toThrow('stale or belongs to another selected branch');
  });

  it('omits observations and adoption candidates owned by an unselected variant', () => {
    const empty = createPlaySessionDraft({
      id: 'play-selected-detail',
      title: 'Selected detail',
      sceneStart: 'Start',
      characters: [],
    });
    const first = settle(empty, 'First', '2026-07-20T00:00:00.000Z');
    const firstArtifactId = first.selectedTurnIds.at(-1)!;
    const variant = settle(first, 'Variant', '2026-07-20T00:00:01.000Z');
    const variantObservation = variant.observations.at(-1)!;
    const withCandidate = addPlayAdoptionCandidate(
      variant,
      createPlayAdoptionCandidate({
        id: 'candidate-variant',
        target: 'timeline',
        summary: 'Variant-only material',
        evidence: 'Variant observation',
        sourceObservationIds: [variantObservation.id],
        sourceTurnIds: [...variantObservation.sourceTurnIds],
        sourceEventIds: [],
      }),
    );
    const restored = restorePlaySessionCheckpoint(withCandidate, firstArtifactId);

    const detail = projectPlaySessionSelectedDetail(restored);
    expect(restored.observations).toHaveLength(2);
    expect(restored.adoptionCandidates).toHaveLength(1);
    expect(detail.snapshot.observations).toHaveLength(1);
    expect(detail.snapshot.observations[0]?.summary).toBe('First observation');
    expect(detail.snapshot.adoptionCandidates).toEqual([]);
  });

  it('projects bounded event-card evidence without restoring the artifact ledger', () => {
    const session = createPlaySessionDraft({
      id: 'play-event-presentation',
      title: 'Event presentation',
      sceneStart: 'Station',
      characters: ['Inspector'],
      eventPolicy: { density: 'volatile', maxExternalEventsPerTurn: 2 },
      scheduledEvents: [{
        id: 'station-lockdown',
        label: 'Station lockdown',
        trigger: { type: 'nextTurn' },
        template: {
          kind: 'factionActed',
          origin: 'faction',
          title: 'The gates close',
          summary: 'The station gates close.',
          visibility: 'playerVisible',
        },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
      worldMomentum: {
        pressures: [{
          id: 'deadline',
          kind: 'deadline',
          label: 'The final train departs',
          status: 'active',
          level: 1,
          threshold: 2,
          causeRefs: [],
          nextConsequence: 'The platform empties.',
          visibility: 'playerVisible',
        }],
        agendas: [{
          id: 'secret-search',
          ownerEntityId: 'inspector',
          goal: 'Find the courier.',
          nextMove: 'Search the east platform.',
          blockers: [],
          status: 'active',
          visibility: 'playerUnknown',
          updatedAtTurnId: 'seed-turn',
        }],
      },
    });
    const settled = settlePlayWorldRefereeSettlement({
      session,
      userText: 'Wait by the gate.',
      actionKind: 'wait',
      narrative: 'The station moves into lockdown.',
      settlement: {
        events: [{
          kind: 'factionActed',
          origin: 'faction',
          title: 'The gates close',
          summary: 'The station gates close.',
          visibility: 'playerVisible',
          cause: { reason: 'The scheduled lockdown began.', triggerId: 'station-lockdown' },
        }, {
          kind: 'deadlineAdvanced',
          origin: 'clock',
          title: 'The final train departs',
          summary: 'The last train leaves the platform.',
          visibility: 'playerVisible',
          cause: { reason: 'The deadline was reached.', pressureId: 'deadline' },
        }, {
          kind: 'npcActed',
          origin: 'npc',
          title: 'The inspector moves',
          summary: 'The inspector crosses toward the east platform.',
          visibility: 'playerVisible',
          cause: { reason: 'A private search agenda advanced.', agendaId: 'secret-search' },
        }],
        pressureChanges: [{
          pressureId: 'deadline',
          reason: 'The deadline consequence occurred.',
          status: 'resolved',
          level: 2,
          nextConsequence: null,
        }],
        agendaChanges: [{
          agendaId: 'secret-search',
          reason: 'The search moved east.',
          nextMove: 'Inspect the luggage office.',
        }],
        scheduledEventChanges: [],
        knowledgeChanges: [],
        stateDelta: { station: { gates: 'closed' } },
        observations: [],
        suggestedActions: [],
      },
      createdAt: '2026-07-20T01:00:00.000Z',
    });

    const detail = projectPlaySessionSelectedDetail(settled, { limit: 20 });
    expect(detail.snapshot).not.toHaveProperty('turnArtifacts');
    expect(detail.eventPresentation.map((item) => item.eventId))
      .toEqual(detail.events.items.map((event) => event.id));
    expect(detail.eventPresentation[0]).toMatchObject({
      causes: {
        actions: [{ actionKind: 'wait', contentExcerpt: 'Wait by the gate.' }],
        scheduled: { label: 'Station lockdown', trigger: { type: 'nextTurn' } },
      },
      stateImpacts: [{ path: 'station.gates', value: 'closed' }],
    });
    expect(detail.eventPresentation[1]?.causes.pressure)
      .toEqual({ label: 'The final train departs' });
    expect(detail.eventPresentation[2]?.causes).not.toHaveProperty('agenda');
    expect(detail.eventPresentation[2]?.author.hiddenCauses.agenda)
      .toEqual({ ownerEntityId: 'inspector', summary: 'Inspect the luggage office.' });
    expect(detail.selectedArtifactPresentation).toMatchObject({
      id: settled.selectedTurnIds.at(-1),
      revision: 1,
      eventIds: settled.events.map((event) => event.id),
      canonical: false,
    });
  });

  it('keeps hidden reveal content author-only while paging its direct closure', () => {
    const initial = createPlaySessionDraft({
      id: 'play-reveal-presentation',
      title: 'Reveal presentation',
      sceneStart: 'Signal box',
      characters: [],
    });
    const hidden = settlePlayWorldRefereeSettlement({
      session: initial,
      userText: 'Wait outside.',
      actionKind: 'wait',
      narrative: 'Nothing obvious changes.',
      settlement: {
        events: [{
          kind: 'evidenceChanged',
          origin: 'npc',
          title: 'The signal was sabotaged',
          summary: 'Someone secretly altered the signal.',
          visibility: 'playerUnknown',
          cause: { reason: 'A hidden rival reached the mechanism.' },
        }],
        pressureChanges: [],
        agendaChanges: [],
        scheduledEventChanges: [],
        knowledgeChanges: [],
        stateDelta: {},
        observations: [],
        suggestedActions: [],
      },
      createdAt: '2026-07-20T02:00:00.000Z',
    });
    const hiddenEventId = hidden.events[0]!.id;
    const revealed = settlePlayWorldRefereeSettlement({
      session: hidden,
      userText: 'Question the porter.',
      actionKind: 'say',
      narrative: 'A rumor begins to spread.',
      settlement: {
        events: [{
          kind: 'informationSpread',
          origin: 'npc',
          title: 'A signal rumor spreads',
          summary: 'Porters suspect that the signal was disturbed.',
          visibility: 'rumor',
          cause: {
            reason: 'The porter repeats an indirect account.',
            sourceEventIds: [hiddenEventId],
          },
        }],
        pressureChanges: [],
        agendaChanges: [],
        scheduledEventChanges: [],
        knowledgeChanges: [{
          type: 'revealEvent',
          subjectEventId: hiddenEventId,
          playerProjection: 'rumor',
        }],
        stateDelta: {},
        observations: [],
        suggestedActions: [],
      },
      createdAt: '2026-07-20T02:01:00.000Z',
    });

    const latest = projectPlaySessionSelectedDetail(revealed, { limit: 1 });
    expect(latest.events.items).toHaveLength(1);
    expect(latest.eventPresentation).toHaveLength(1);
    expect(latest.eventPresentation[0]).toMatchObject({
      causes: { sourceEvents: [] },
      reveal: { status: 'rumorSurfaced' },
      author: {
        hiddenCauses: { sourceEvents: [{ title: 'The signal was sabotaged' }] },
        reveal: {
          subjectEventId: hiddenEventId,
          subjectTitle: 'The signal was sabotaged',
          subjectReason: 'A hidden rival reached the mechanism.',
        },
      },
    });
    expect(JSON.stringify({
      causes: latest.eventPresentation[0]?.causes,
      reveal: latest.eventPresentation[0]?.reveal,
    })).not.toContain('sabotaged');

    const earlier = projectPlaySessionSelectedDetail(revealed, {
      limit: 1,
      eventCursor: latest.events.nextCursor,
    });
    expect(earlier.eventPresentation.map((item) => item.eventId))
      .toEqual([hiddenEventId]);
  });
});

function settle(
  session: ReturnType<typeof createPlaySessionDraft>,
  label: string,
  createdAt: string,
) {
  return settlePlayWorldRefereeSettlement({
    session,
    userText: label,
    actionKind: 'do',
    narrative: `${label} narrative`,
    settlement: {
      events: [],
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      knowledgeChanges: [],
      stateDelta: {},
      observations: [{
        summary: `${label} observation`,
        evidence: `${label} evidence`,
      }],
      suggestedActions: [],
    },
    createdAt,
  });
}
