import type {
  PlayEventOrigin,
  PlayEventVisibility,
  PlayWorldEventKind,
} from './play-session.js';

export type PlayFlagValue = string | number | boolean;

export type PlayEventTrigger =
  | { type: 'nextTurn' }
  | { type: 'afterTurns'; turns: number }
  | { type: 'flagEquals'; path: string; value: PlayFlagValue }
  | { type: 'atWorldTime'; value: string }
  | { type: 'manual' };

export type PlayScheduledEventStatus = 'scheduled' | 'occurred' | 'cancelled';

export interface PlayScheduledEventTemplate {
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
}

export interface PlayScheduledEvent {
  id: string;
  label: string;
  trigger: PlayEventTrigger;
  template: PlayScheduledEventTemplate;
  status: PlayScheduledEventStatus;
  scheduledAtTurn: number;
  scheduledAtRevision: number;
  sourceTurnId?: string;
  changeReason?: string;
  priority?: number;
  occurredEventIds?: string[];
  resolvedAtTurnId?: string;
  resolutionReason?: string;
}

export interface EvaluatePlayDueEventsInput {
  scheduledEvents: readonly PlayScheduledEvent[];
  currentTurn: number;
  nextTurn: number;
  playLocalState: Readonly<Record<string, unknown>>;
  currentWorldTime?: string;
  /** Returns a negative value when currentWorldTime is before the target. */
  compareWorldTime?: (currentWorldTime: string, targetWorldTime: string) => number;
}

export interface PlayDueEventEvaluation {
  currentTurn: number;
  nextTurn: number;
  dueEvents: PlayScheduledEvent[];
  pendingEvents: PlayScheduledEvent[];
}

const PLAY_WORLD_EVENT_KINDS: readonly PlayWorldEventKind[] = [
  'environmentChanged',
  'locationChanged',
  'npcActed',
  'factionActed',
  'arrival',
  'departure',
  'deadlineAdvanced',
  'resourceChanged',
  'itemMoved',
  'evidenceChanged',
  'relationshipChanged',
  'informationSpread',
  'ruleConsequence',
  'manual',
];

const PLAY_EVENT_ORIGINS: readonly PlayEventOrigin[] = [
  'player',
  'npc',
  'faction',
  'clock',
  'environment',
  'worldRule',
  'manual',
];

const PLAY_EVENT_VISIBILITIES: readonly PlayEventVisibility[] = [
  'playerVisible',
  'rumor',
  'playerUnknown',
];

const PLAY_SCHEDULED_EVENT_STATUSES: readonly PlayScheduledEventStatus[] = [
  'scheduled',
  'occurred',
  'cancelled',
];

const UNSAFE_STATE_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

export const evaluatePlayDueEvents = (
  input: EvaluatePlayDueEventsInput,
): PlayDueEventEvaluation => {
  const currentTurn = assertNonNegativeSafeInteger(input.currentTurn, 'currentTurn');
  const nextTurn = assertNonNegativeSafeInteger(input.nextTurn, 'nextTurn');
  if (nextTurn <= currentTurn) {
    throw new Error('Play due-event evaluation requires nextTurn after currentTurn.');
  }
  if (!isRecord(input.playLocalState)) {
    throw new Error('Play due-event evaluation requires a Play-local state object.');
  }
  if (
    input.currentWorldTime !== undefined &&
    !normalizeOptionalString(input.currentWorldTime)
  ) {
    throw new Error('Play due-event currentWorldTime must be a non-empty string.');
  }
  if (
    input.compareWorldTime !== undefined &&
    typeof input.compareWorldTime !== 'function'
  ) {
    throw new Error('Play due-event compareWorldTime must be a function.');
  }

  const scheduledEvents = normalizePlayScheduledEvents(input.scheduledEvents)
    .filter((event) => event.status === 'scheduled');
  const dueEvents: PlayScheduledEvent[] = [];
  const pendingEvents: PlayScheduledEvent[] = [];

  for (const event of scheduledEvents) {
    if (isPlayScheduledEventDue(event, input, nextTurn)) {
      dueEvents.push(event);
    } else {
      pendingEvents.push(event);
    }
  }

  dueEvents.sort(compareScheduledEvents);
  pendingEvents.sort(compareScheduledEvents);

  return {
    currentTurn,
    nextTurn,
    dueEvents,
    pendingEvents,
  };
};

export const normalizePlayEventTrigger = (value: unknown): PlayEventTrigger => {
  if (!isRecord(value)) {
    throw new Error('Play event trigger must be an object.');
  }

  switch (value.type) {
    case 'nextTurn':
      assertOnlyKnownFields(value, ['type'], 'Play nextTurn trigger');
      return { type: 'nextTurn' };
    case 'afterTurns':
      assertOnlyKnownFields(value, ['type', 'turns'], 'Play afterTurns trigger');
      return {
        type: 'afterTurns',
        turns: assertPositiveSafeInteger(value.turns, 'trigger.turns'),
      };
    case 'flagEquals':
      assertOnlyKnownFields(
        value,
        ['type', 'path', 'value'],
        'Play flagEquals trigger',
      );
      return {
        type: 'flagEquals',
        path: assertSafePlayStatePath(value.path),
        value: normalizePlayFlagValue(value.value),
      };
    case 'atWorldTime':
      assertOnlyKnownFields(value, ['type', 'value'], 'Play atWorldTime trigger');
      return {
        type: 'atWorldTime',
        value: normalizeRequiredString(value.value, 'trigger.value'),
      };
    case 'manual':
      assertOnlyKnownFields(value, ['type'], 'Play manual trigger');
      return { type: 'manual' };
    default:
      throw new Error(`Unsupported Play event trigger type: ${String(value.type)}.`);
  }
};

export const normalizePlayScheduledEventTemplate = (
  value: unknown,
): PlayScheduledEventTemplate => {
  if (!isRecord(value)) {
    throw new Error('Play scheduled event template must be an object.');
  }
  assertOnlyKnownFields(
    value,
    ['kind', 'origin', 'title', 'summary', 'visibility'],
    'Play scheduled event template',
  );

  return {
    kind: normalizeEnum(
      value.kind,
      PLAY_WORLD_EVENT_KINDS,
      'template.kind',
    ),
    origin: normalizeEnum(
      value.origin,
      PLAY_EVENT_ORIGINS,
      'template.origin',
    ),
    title: normalizeRequiredString(value.title, 'template.title'),
    summary: normalizeRequiredString(value.summary, 'template.summary'),
    visibility: normalizeEnum(
      value.visibility,
      PLAY_EVENT_VISIBILITIES,
      'template.visibility',
    ),
  };
};

export const normalizePlayScheduledEvent = (
  value: unknown,
): PlayScheduledEvent => {
  if (!isRecord(value)) {
    throw new Error('Play scheduled event must be an object.');
  }
  assertOnlyKnownFields(value, [
    'id',
    'label',
    'trigger',
    'template',
    'status',
    'scheduledAtTurn',
    'scheduledAtRevision',
    'sourceTurnId',
    'changeReason',
    'priority',
    'occurredEventIds',
    'resolvedAtTurnId',
    'resolutionReason',
  ], 'Play scheduled event');

  const status = normalizeEnum(
    value.status,
    PLAY_SCHEDULED_EVENT_STATUSES,
    'status',
  );
  const sourceTurnId = value.sourceTurnId === undefined
    ? undefined
    : assertSafePlayFactId(value.sourceTurnId, 'sourceTurnId');
  const priority = value.priority === undefined
    ? undefined
    : assertSafeInteger(value.priority, 'priority');
  const changeReason = value.changeReason === undefined
    ? undefined
    : normalizeRequiredString(value.changeReason, 'changeReason');
  const occurredEventIds = value.occurredEventIds === undefined
    ? undefined
    : normalizeSafeIdList(value.occurredEventIds, 'occurredEventIds');
  const resolvedAtTurnId = value.resolvedAtTurnId === undefined
    ? undefined
    : assertSafePlayFactId(value.resolvedAtTurnId, 'resolvedAtTurnId');
  const resolutionReason = value.resolutionReason === undefined
    ? undefined
    : normalizeRequiredString(value.resolutionReason, 'resolutionReason');

  assertStatusEvidence({
    status,
    occurredEventIds,
    resolvedAtTurnId,
    resolutionReason,
  });

  return {
    id: assertSafePlayScheduledEventId(value.id),
    label: normalizeRequiredString(value.label, 'label'),
    trigger: normalizePlayEventTrigger(value.trigger),
    template: normalizePlayScheduledEventTemplate(value.template),
    status,
    scheduledAtTurn: assertNonNegativeSafeInteger(
      value.scheduledAtTurn,
      'scheduledAtTurn',
    ),
    scheduledAtRevision: assertNonNegativeSafeInteger(
      value.scheduledAtRevision,
      'scheduledAtRevision',
    ),
    ...(sourceTurnId ? { sourceTurnId } : {}),
    ...(changeReason ? { changeReason } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(occurredEventIds ? { occurredEventIds } : {}),
    ...(resolvedAtTurnId ? { resolvedAtTurnId } : {}),
    ...(resolutionReason ? { resolutionReason } : {}),
  };
};

export const normalizePlayScheduledEvents = (
  value: unknown,
): PlayScheduledEvent[] => {
  if (!Array.isArray(value)) {
    throw new Error('Play scheduled events must be an array.');
  }

  const events = value.map(normalizePlayScheduledEvent);
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.id)) {
      throw new Error(`Play scheduled events contain duplicate id: ${event.id}.`);
    }
    ids.add(event.id);
  }
  return events;
};

export const assertPlayScheduledEvent = normalizePlayScheduledEvent;
export const assertPlayScheduledEvents = normalizePlayScheduledEvents;

export const assertSafePlayScheduledEventId = (value: unknown): string =>
  assertSafePlayFactId(value, 'id');

export const assertSafePlayStatePath = (value: unknown): string => {
  const path = normalizeRequiredString(value, 'trigger.path');
  const segments = path.split('.');
  if (
    path.length > 256 ||
    segments.some((segment) =>
      !/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(segment) ||
      UNSAFE_STATE_PATH_SEGMENTS.has(segment))
  ) {
    throw new Error(`Unsafe Play state path: ${path}.`);
  }
  return path;
};

function isPlayScheduledEventDue(
  event: PlayScheduledEvent,
  input: EvaluatePlayDueEventsInput,
  nextTurn: number,
): boolean {
  switch (event.trigger.type) {
    case 'nextTurn':
      return nextTurn > event.scheduledAtTurn;
    case 'afterTurns':
      return nextTurn >= event.scheduledAtTurn + event.trigger.turns;
    case 'flagEquals':
      return readPlayStatePath(input.playLocalState, event.trigger.path) ===
        event.trigger.value;
    case 'atWorldTime': {
      const currentWorldTime = normalizeOptionalString(input.currentWorldTime);
      if (!currentWorldTime || !input.compareWorldTime) {
        return false;
      }
      const comparison = input.compareWorldTime(
        currentWorldTime,
        event.trigger.value,
      );
      if (typeof comparison !== 'number' || !Number.isFinite(comparison)) {
        throw new Error('Play world-time comparator must return a finite number.');
      }
      return comparison >= 0;
    }
    case 'manual':
      return false;
  }
}

function readPlayStatePath(
  state: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  let value: unknown = state;
  for (const segment of path.split('.')) {
    if (!isRecord(value) || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

function compareScheduledEvents(
  left: PlayScheduledEvent,
  right: PlayScheduledEvent,
): number {
  const priorityDifference = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }
  const scheduledTurnDifference = left.scheduledAtTurn - right.scheduledAtTurn;
  if (scheduledTurnDifference !== 0) {
    return scheduledTurnDifference;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function assertStatusEvidence(input: {
  status: PlayScheduledEventStatus;
  occurredEventIds?: string[];
  resolvedAtTurnId?: string;
  resolutionReason?: string;
}): void {
  if (input.status === 'scheduled') {
    if (
      input.occurredEventIds !== undefined ||
      input.resolvedAtTurnId !== undefined ||
      input.resolutionReason !== undefined
    ) {
      throw new Error('A scheduled Play event cannot contain resolution evidence.');
    }
    return;
  }

  if (!input.resolvedAtTurnId) {
    throw new Error(`A ${input.status} Play event requires resolvedAtTurnId.`);
  }
  if (input.status === 'occurred') {
    if (!input.occurredEventIds?.length) {
      throw new Error('An occurred Play event requires occurredEventIds.');
    }
    return;
  }
  if (input.occurredEventIds !== undefined) {
    throw new Error('A cancelled Play event cannot contain occurredEventIds.');
  }
  if (!input.resolutionReason) {
    throw new Error('A cancelled Play event requires resolutionReason.');
  }
}

function normalizePlayFlagValue(value: unknown): PlayFlagValue {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new Error('Play flagEquals trigger value must be a primitive string, number, or boolean.');
}

function normalizeSafeIdList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Play scheduled event ${field} must be an array.`);
  }
  const ids = value.map((id) => assertSafePlayFactId(id, field));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Play scheduled event ${field} must not contain duplicates.`);
  }
  return ids;
}

function assertSafePlayFactId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error(`Invalid Play scheduled event ${field}.`);
  }
  return value;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Invalid Play scheduled event ${field}: ${String(value)}.`);
  }
  return value as T;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  knownFields: readonly string[],
  label: string,
): void {
  const known = new Set(knownFields);
  const unknown = Object.keys(value).filter((field) => !known.has(field));
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`Play scheduled event requires ${field}.`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function assertPositiveSafeInteger(value: unknown, field: string): number {
  const number = assertNonNegativeSafeInteger(value, field);
  if (number < 1) {
    throw new Error(`Play scheduled event ${field} must be at least 1.`);
  }
  return number;
}

function assertNonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Play scheduled event ${field} must be a non-negative safe integer.`);
  }
  return value as number;
}

function assertSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Play scheduled event ${field} must be a safe integer.`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
