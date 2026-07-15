import { describe, expect, it, vi } from 'vitest';

import {
  assertSafePlayScheduledEventId,
  assertSafePlayStatePath,
  evaluatePlayDueEvents,
  normalizePlayEventTrigger,
  normalizePlayScheduledEventTemplate,
  normalizePlayScheduledEvents,
} from '@oh-awesome-novel/core';
import type { PlayScheduledEvent } from '@oh-awesome-novel/core';

describe('Play scheduled event evaluator', () => {
  it('evaluates deterministic triggers and ignores terminal records', () => {
    const evaluation = evaluatePlayDueEvents({
      scheduledEvents: [
        scheduledEvent({
          id: 'next',
          scheduledAtTurn: 4,
          trigger: { type: 'nextTurn' },
        }),
        scheduledEvent({
          id: 'after-due',
          scheduledAtTurn: 2,
          trigger: { type: 'afterTurns', turns: 3 },
        }),
        scheduledEvent({
          id: 'after-pending',
          scheduledAtTurn: 3,
          trigger: { type: 'afterTurns', turns: 3 },
        }),
        scheduledEvent({
          id: 'flag-due',
          trigger: {
            type: 'flagEquals',
            path: 'station.eastGate.locked',
            value: true,
          },
        }),
        scheduledEvent({
          id: 'flag-pending',
          trigger: {
            type: 'flagEquals',
            path: 'station.westGate.locked',
            value: true,
          },
        }),
        scheduledEvent({ id: 'manual', trigger: { type: 'manual' } }),
        scheduledEvent({
          id: 'already-occurred',
          status: 'occurred',
          occurredEventIds: ['turn-4-event-1'],
          resolvedAtTurnId: 'turn-4-referee',
        }),
      ],
      currentTurn: 4,
      nextTurn: 5,
      playLocalState: {
        station: {
          eastGate: { locked: true },
          westGate: { locked: false },
        },
      },
    });

    expect(evaluation).toMatchObject({ currentTurn: 4, nextTurn: 5 });
    expect(evaluation.dueEvents.map((event) => event.id)).toEqual([
      'flag-due',
      'after-due',
      'next',
    ]);
    expect(evaluation.pendingEvents.map((event) => event.id)).toEqual([
      'flag-pending',
      'manual',
      'after-pending',
    ]);
    expect([
      ...evaluation.dueEvents,
      ...evaluation.pendingEvents,
    ].map((event) => event.id)).not.toContain('already-occurred');
  });

  it('sorts by descending priority, scheduled turn, then stable id', () => {
    const evaluation = evaluatePlayDueEvents({
      scheduledEvents: [
        scheduledEvent({ id: 'z-low', priority: -1, scheduledAtTurn: 0 }),
        scheduledEvent({ id: 'z-new', priority: 5, scheduledAtTurn: 3 }),
        scheduledEvent({ id: 'z-old', priority: 5, scheduledAtTurn: 1 }),
        scheduledEvent({ id: 'a-old', priority: 5, scheduledAtTurn: 1 }),
        scheduledEvent({ id: 'default', scheduledAtTurn: 0 }),
      ],
      currentTurn: 3,
      nextTurn: 4,
      playLocalState: {},
    });

    expect(evaluation.dueEvents.map((event) => event.id)).toEqual([
      'a-old',
      'z-old',
      'z-new',
      'default',
      'z-low',
    ]);
  });

  it('does not modify schedule records or Play-local state', () => {
    const event = scheduledEvent({
      id: 'immutable',
      trigger: { type: 'flagEquals', path: 'flags.ready', value: true },
    });
    const events = Object.freeze([
      Object.freeze({
        ...event,
        trigger: Object.freeze({ ...event.trigger }),
        template: Object.freeze({ ...event.template }),
      }),
    ]);
    const state = Object.freeze({ flags: Object.freeze({ ready: true }) });
    const before = JSON.stringify({ events, state });

    const evaluation = evaluatePlayDueEvents({
      scheduledEvents: events,
      currentTurn: 0,
      nextTurn: 1,
      playLocalState: state,
    });

    expect(evaluation.dueEvents).toEqual([event]);
    expect(JSON.stringify({ events, state })).toBe(before);
    expect(evaluation.dueEvents).not.toBe(events);
    expect(evaluation.dueEvents[0]).not.toBe(events[0]);
  });

  it('gates world-time triggers behind an explicit deterministic comparator', () => {
    const event = scheduledEvent({
      id: 'midnight',
      trigger: { type: 'atWorldTime', value: '2026-07-15T00:00' },
    });
    const base = {
      scheduledEvents: [event],
      currentTurn: 7,
      nextTurn: 8,
      playLocalState: {},
      currentWorldTime: '2026-07-15T00:00',
    } as const;

    expect(evaluatePlayDueEvents(base).pendingEvents).toHaveLength(1);

    const compareWorldTime = vi.fn((current: string, target: string) =>
      current < target ? -1 : current > target ? 1 : 0);
    expect(evaluatePlayDueEvents({
      ...base,
      compareWorldTime,
    }).dueEvents.map((item) => item.id)).toEqual(['midnight']);
    expect(compareWorldTime).toHaveBeenCalledWith(
      '2026-07-15T00:00',
      '2026-07-15T00:00',
    );

    expect(evaluatePlayDueEvents({
      ...base,
      currentWorldTime: '2026-07-14T23:59',
      compareWorldTime,
    }).pendingEvents.map((item) => item.id)).toEqual(['midnight']);
    expect(() => evaluatePlayDueEvents({
      ...base,
      compareWorldTime: () => Number.NaN,
    })).toThrow('finite number');
  });

  it('enforces evaluator turn and state boundaries', () => {
    expect(() => evaluatePlayDueEvents({
      scheduledEvents: [],
      currentTurn: 2,
      nextTurn: 2,
      playLocalState: {},
    })).toThrow('nextTurn after currentTurn');
    expect(() => evaluatePlayDueEvents({
      scheduledEvents: [],
      currentTurn: -1,
      nextTurn: 0,
      playLocalState: {},
    })).toThrow('non-negative safe integer');
  });
});

describe('Play scheduled event normalization', () => {
  it('normalizes a strict schedule list and preserves primitive flag values', () => {
    const normalized = normalizePlayScheduledEvents([
      {
        ...scheduledEvent({
          id: 'flag-ready',
          label: '  Gate ready  ',
          trigger: { type: 'flagEquals', path: 'world.车站.ready', value: false },
        }),
      },
      scheduledEvent({
        id: 'cancelled',
        status: 'cancelled',
        resolvedAtTurnId: 'turn-2-referee',
        resolutionReason: 'The deadline was explicitly withdrawn.',
      }),
    ]);

    expect(normalized[0]).toMatchObject({
      id: 'flag-ready',
      label: 'Gate ready',
      trigger: { type: 'flagEquals', path: 'world.车站.ready', value: false },
    });
    expect(normalized[1]).toMatchObject({
      status: 'cancelled',
      resolvedAtTurnId: 'turn-2-referee',
    });
  });

  it('rejects unknown fields, duplicate ids, unsafe ids and unsafe dotted paths', () => {
    expect(() => normalizePlayScheduledEvents([
      { ...scheduledEvent(), extra: true },
    ])).toThrow('unknown fields');
    expect(() => normalizePlayScheduledEvents([
      scheduledEvent({ id: 'same' }),
      scheduledEvent({ id: 'same' }),
    ])).toThrow('duplicate id');
    expect(() => assertSafePlayScheduledEventId('../escape')).toThrow('Invalid');
    expect(() => assertSafePlayStatePath('world.__proto__.ready')).toThrow('Unsafe');
    expect(() => assertSafePlayStatePath('world[0].ready')).toThrow('Unsafe');
    expect(() => normalizePlayEventTrigger({
      type: 'flagEquals',
      path: 'safe.path',
      value: true,
      script: 'run()',
    })).toThrow('unknown fields');
  });

  it('rejects invalid trigger values and template enums', () => {
    expect(() => normalizePlayEventTrigger({
      type: 'afterTurns',
      turns: 0,
    })).toThrow('at least 1');
    expect(() => normalizePlayEventTrigger({
      type: 'flagEquals',
      path: 'flags.ready',
      value: { nested: true },
    })).toThrow('primitive string, number, or boolean');
    expect(() => normalizePlayEventTrigger({
      type: 'flagEquals',
      path: 'flags.ready',
      value: Number.POSITIVE_INFINITY,
    })).toThrow('primitive string, number, or boolean');
    expect(() => normalizePlayScheduledEventTemplate({
      ...scheduledEvent().template,
      kind: 'freeformDrama',
    })).toThrow('template.kind');
    expect(() => normalizePlayScheduledEventTemplate({
      ...scheduledEvent().template,
      origin: 'backgroundAgent',
    })).toThrow('template.origin');
  });

  it('rejects status and resolution evidence contradictions', () => {
    expect(() => normalizePlayScheduledEvents([
      scheduledEvent({
        status: 'scheduled',
        resolvedAtTurnId: 'turn-1-referee',
      }),
    ])).toThrow('cannot contain resolution evidence');
    expect(() => normalizePlayScheduledEvents([
      scheduledEvent({ status: 'occurred' }),
    ])).toThrow('requires resolvedAtTurnId');
    expect(() => normalizePlayScheduledEvents([
      scheduledEvent({
        status: 'occurred',
        resolvedAtTurnId: 'turn-1-referee',
      }),
    ])).toThrow('requires occurredEventIds');
    expect(() => normalizePlayScheduledEvents([
      scheduledEvent({
        status: 'cancelled',
        resolvedAtTurnId: 'turn-1-referee',
      }),
    ])).toThrow('requires resolutionReason');
    expect(() => normalizePlayScheduledEvents([
      scheduledEvent({
        status: 'cancelled',
        occurredEventIds: ['turn-1-event-1'],
        resolvedAtTurnId: 'turn-1-referee',
        resolutionReason: 'Cancelled.',
      }),
    ])).toThrow('cannot contain occurredEventIds');
    expect(() => normalizePlayScheduledEvents([
      { ...scheduledEvent(), status: 'unknown' },
    ])).toThrow('Invalid Play scheduled event status');
  });
});

function scheduledEvent(
  overrides: Partial<PlayScheduledEvent> = {},
): PlayScheduledEvent {
  return {
    id: 'scheduled-1',
    label: 'Scheduled event',
    trigger: { type: 'nextTurn' },
    template: {
      kind: 'deadlineAdvanced',
      origin: 'clock',
      title: 'Deadline advances',
      summary: 'The existing deadline reaches its next consequence.',
      visibility: 'playerVisible',
    },
    status: 'scheduled',
    scheduledAtTurn: 0,
    scheduledAtRevision: 0,
    ...overrides,
  };
}
