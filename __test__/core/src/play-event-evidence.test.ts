import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vite-plus/test';
import {
  comparePlayIsoWorldTime, normalizePlayIsoWorldTime, normalizePlayEventTrigger,
  createPlaySessionDraft, settlePlayWorldRefereeResponse,
  evaluatePlaySessionDueEvents, formatPlayWorldRefereePrompt,
  projectPlaySessionSelectedDetail, readPlaySessionFiles, writePlaySessionFiles,
  restorePlaySessionCheckpoint, resolvePlaySessionPath,
  type PlaySession,
} from '@oh-awesome-novel/core';

function createSession() {
  const session = createPlaySessionDraft({
    id: 'event-evidence', title: 'Event evidence', sceneStart: 'The station', characters: [],
    scheduledEvents: [{
      id: 'midnight', label: 'Midnight',
      trigger: { type: 'atWorldTime', value: '2026-10-07T00:00:00Z', format: 'iso8601' },
      template: { kind: 'deadlineAdvanced', origin: 'clock', title: 'Gates close', summary: 'The gates close.', visibility: 'playerVisible' },
      status: 'scheduled', scheduledAtTurn: 0, scheduledAtRevision: 0,
    }],
  });
  session.worldClock.anchor = session.branchBaseSnapshot.worldClock.anchor = '2026-10-07T08:00:00+08:00';
  session.playLocalState = { station: { gates: 'open', lights: true } };
  session.playLocalStateVisibility = { station: 'playerVisible' };
  session.branchBaseSnapshot.playLocalState = structuredClone(session.playLocalState);
  session.branchBaseSnapshot.playLocalStateVisibility = { ...session.playLocalStateVisibility };
  return session;
}

function settle(session: PlaySession, refs: unknown = ['station.gates'], delta: unknown = { station: { gates: 'closed', lights: true } }) {
  return settlePlayWorldRefereeResponse({
    session, userText: 'Watch the gates.', actionKind: 'look',
    refereeResponse: ['The gates close.', '```oan-play-settlement', JSON.stringify({
      events: [{ ...session.scheduledEvents[0]!.template, cause: { reason: 'Midnight has arrived.', triggerId: 'midnight' }, stateDeltaRefs: refs }],
      stateDelta: delta,
    }), '```'].join('\n'),
  });
}

describe('Explicit Play event time and state evidence', () => {
  it('compares declared ISO dates by instant, including fractions and calendar boundaries', () => {
    expect(comparePlayIsoWorldTime('2026-10-07T08:00+08:00', '2026-10-07T00:00:00Z')).toBe(0);
    expect(comparePlayIsoWorldTime('2026-10-07T00:00:00.01Z', '2026-10-07T00:00:00.009Z')).toBe(1);
    expect(comparePlayIsoWorldTime('2024-02-29T23:59:59Z', '2024-03-01T00:00Z')).toBe(-1);
    expect(normalizePlayIsoWorldTime('0000-02-29T00:00Z')).toBe('0000-02-29T00:00:00.000Z');
  });

  it.each(['dawn', '2026-10-07T00:00', '2026-02-29T00:00Z', '1900-02-29T00:00Z',
    '2026-04-31T00:00Z', '2026-10-07T24:00Z', '2026-10-07T00:00:60Z',
    '2026-10-07T00:00-00:00', '2026-10-07T00:00+24:00'])('does not infer an instant from %s', (value) => {
    expect(comparePlayIsoWorldTime(value, '2026-10-07T00:00Z')).toBeUndefined();
    expect(() => normalizePlayEventTrigger({ type: 'atWorldTime', format: 'iso8601', value })).toThrow();
  });

  it('only enables explicitly formatted schedules, never rewrites legacy due evidence', () => {
    expect(evaluatePlaySessionDueEvents(createSession()).dueEvents.map((event) => event.id)).toEqual(['midnight']);
    const legacy = createSession();
    delete (legacy.scheduledEvents[0]!.trigger as { format?: string }).format;
    delete (legacy.branchBaseSnapshot.scheduledEvents[0]!.trigger as { format?: string }).format;
    expect(evaluatePlaySessionDueEvents(legacy).dueEvents).toEqual([]);
    const natural = createSession();
    natural.worldClock.anchor = natural.branchBaseSnapshot.worldClock.anchor = 'dawn';
    expect(evaluatePlaySessionDueEvents(natural).dueEvents).toEqual([]);
    expect(formatPlayWorldRefereePrompt(createSession())).toContain('trigger.format iso8601');
    expect(() => settlePlayWorldRefereeResponse({ session: createSession(), userText: 'Wait.', actionKind: 'wait',
      refereeResponse: 'Nothing changes.\n```oan-play-settlement\n{}\n```' })).toThrow(/hard-due/iu);
  });

  it('persists ISO hard-due and leaf evidence, restores the base and creates a sibling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-event-evidence-'));
    try {
      const first = settle(createSession());
      await writePlaySessionFiles(root, first);
      const loaded = await readPlaySessionFiles(root, first.id);
      expect(loaded.events[0]!.stateDeltaRefs).toEqual(['station.gates']);
      expect(loaded.turnArtifacts[0]!.dueScheduledEventIds).toEqual(['midnight']);
      const detail = projectPlaySessionSelectedDetail(loaded);
      expect(detail.eventPresentation[0]!.author!.stateImpacts.map((item) => item.path)).toEqual(['station.gates']);
      const base = restorePlaySessionCheckpoint(loaded, 'initial-world');
      expect(evaluatePlaySessionDueEvents(base).dueEvents.map((event) => event.id)).toEqual(['midnight']);
      const sibling = settle(base);
      await writePlaySessionFiles(root, sibling);
      expect((await readPlaySessionFiles(root, first.id)).turnArtifacts).toHaveLength(2);

      const eventsPath = resolvePlaySessionPath(root, first.id, 'events.yaml');
      const events = parse(await readFile(eventsPath, 'utf8'));
      events.events[0].stateDeltaRefs = ['station.lights'];
      await writeFile(eventsPath, stringify(events));
      await expect(readPlaySessionFiles(root, first.id)).rejects.toThrow(/unchanged state/iu);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([
    ['station.missing'], ['station'], ['station.gates', 'station.gates'],
    ['station.__proto__'], ['worldMomentum.pressures'], ['station.lights'],
  ])('rejects invalid or unchanged leaf references %j atomically', (...refs) => {
    const session = createSession();
    const before = structuredClone(session);
    expect(() => settle(session, refs)).toThrow(/stateDeltaRefs/iu);
    expect(session).toEqual(before);
  });

  it('keeps unannotated published events readable without inventing causal ownership', () => {
    const next = settle(createSession());
    delete next.events[0]!.stateDeltaRefs;
    expect(() => projectPlaySessionSelectedDetail(next)).not.toThrow();
  });
});
