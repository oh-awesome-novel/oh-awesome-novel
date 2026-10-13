import { describe, expect, it } from 'vitest';
import { createOanClient } from '@oh-awesome-novel/client';
import { createPlaySessionDraft, settlePlayWorldRefereeResponse, type PlaySession } from '@oh-awesome-novel/core';

function fixture() {
  const session = createPlaySessionDraft({
    id: 'play-event-evidence', title: 'Evidence', sceneStart: 'Station', characters: [],
    scheduledEvents: [{ id: 'midnight', label: 'Midnight',
      trigger: { type: 'atWorldTime', format: 'iso8601', value: '2026-10-07T00:00:00Z' },
      template: { kind: 'deadlineAdvanced', origin: 'clock', title: 'Gates close', summary: 'The gates close.', visibility: 'playerVisible' },
      status: 'scheduled', scheduledAtTurn: 0, scheduledAtRevision: 0 }],
  });
  session.worldClock.anchor = session.branchBaseSnapshot.worldClock.anchor = '2026-10-07T08:00:00+08:00';
  session.playLocalState = { station: { gates: 'open', lights: true } };
  session.playLocalStateVisibility = { station: 'playerVisible' };
  session.branchBaseSnapshot.playLocalState = structuredClone(session.playLocalState);
  session.branchBaseSnapshot.playLocalStateVisibility = { ...session.playLocalStateVisibility };
  return settlePlayWorldRefereeResponse({ session, userText: 'Watch.', actionKind: 'look',
    refereeResponse: ['The gates close.', '```oan-play-settlement', JSON.stringify({
      events: [{ ...session.scheduledEvents[0]!.template,
        cause: { reason: 'The clock reached midnight.', triggerId: 'midnight' }, stateDeltaRefs: ['station.gates'] }],
      stateDelta: { station: { gates: 'closed', lights: true } },
    }), '```'].join('\n') });
}

function readSession(session: PlaySession) {
  return createOanClient({
    fetch: (async () => new Response(JSON.stringify({ session }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
  }).getPlaySession(session.id);
}

describe('Play ISO clock and event state reference transport', () => {
  it('accepts the host settlement after independently replaying its before-clock', async () => {
    const session = fixture();
    await expect(readSession(session)).resolves.toEqual({ session });
  });

  it.each([
    ['station.missing'], ['station'], ['station.lights'],
    ['station.gates', 'station.gates'], ['worldMomentum.pressures'], ['__proto__.polluted'],
  ])('rejects unverifiable explicit leaf refs %j', async (...refs) => {
    const session = fixture();
    session.events[0]!.stateDeltaRefs = refs;
    await expect(readSession(session)).rejects.toThrow(/invalid payload/iu);
  });

  it('rejects changing the before-clock or dropping the explicit time format', async () => {
    const earlier = fixture();
    earlier.branchBaseSnapshot.worldClock.anchor = '2026-10-06T23:59:00Z';
    await expect(readSession(earlier)).rejects.toThrow(/invalid payload/iu);
    const legacy = fixture();
    delete (legacy.branchBaseSnapshot.scheduledEvents[0]!.trigger as { format?: string }).format;
    await expect(readSession(legacy)).rejects.toThrow(/invalid payload/iu);
  });
});
