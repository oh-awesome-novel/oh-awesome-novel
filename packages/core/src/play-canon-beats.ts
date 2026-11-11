import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';

import type { PlayEventVisibility } from './play-types.js';

/** Reserved Play-local state key. Present from session creation or never. */
export const PLAY_CANON_BEATS_STATE_KEY = 'canonBeats' as const;
export const PLAY_CANON_BEATS_SCHEMA_VERSION = 1 as const;
export const MAX_PLAY_CANON_BEATS = 24;
export const MAX_PLAY_CANON_BEAT_CHANGE_RECORDS = 96;
export const MAX_PLAY_CANON_BEAT_QUOTE_LENGTH = 240;
export const MAX_PLAY_CANON_BEAT_CANDIDATES = 200;
export const PLAY_CANON_BEATS_PROTOCOL_MARKER = '## 原作节点 (canon beats protocol)';
/** Speaker of the transcriptAppend artifact that carries an author-side correction. */
export const PLAY_DIRECTOR_NOTE_SPEAKER = 'director' as const;

const MAX_LABEL_LENGTH = 200;
const MAX_EXPECTED_WHEN_LENGTH = 120;
const MAX_REASON_LENGTH = 500;

export type PlayCanonBeatStatus =
  | 'pending'
  | 'occurredAsCanon'
  | 'altered'
  | 'prevented'
  | 'obsolete';

export type PlayCanonBeatTerminalStatus = Exclude<PlayCanonBeatStatus, 'pending'>;

export type PlayCanonBeatChangeOrigin = 'referee' | 'manual';

export type PlayCanonBeatSource =
  | {
      kind: 'sourceBacked';
      sourceId: string;
      path: string;
      contentHash: string;
      /** Verbatim text found in the source when the opening was frozen. */
      quote: string;
    }
  | { kind: 'authorProvided'; providedAt: string };

/** A beat as frozen by the launch package, before any session exists. */
export interface PlayCanonBeatSeed {
  id: string;
  label: string;
  expectedWhen?: string;
  source: PlayCanonBeatSource;
}

export interface PlayCanonBeat extends PlayCanonBeatSeed {
  status: PlayCanonBeatStatus;
  visibility: PlayEventVisibility;
  changedAtTurnId?: string;
  causeEventIds: string[];
  note?: string;
  /** Set once when the author turns this pending beat into a scheduled event. */
  scheduledEventId?: string;
}

export interface PlayCanonBeatChangeRecord {
  id: string;
  beatId: string;
  from: PlayCanonBeatStatus;
  to: PlayCanonBeatTerminalStatus;
  reason: string;
  origin: PlayCanonBeatChangeOrigin;
  turnId: string;
  eventIds: string[];
  revision: number;
}

export interface PlayCanonBeatTable {
  schemaVersion: typeof PLAY_CANON_BEATS_SCHEMA_VERSION;
  protagonistKnowsCanon: boolean;
  beats: PlayCanonBeat[];
  changes: PlayCanonBeatChangeRecord[];
}

/** One referee proposal inside a turn settlement. */
export interface PlayCanonBeatChange {
  beatId: string;
  status: PlayCanonBeatTerminalStatus;
  reason: string;
  /** 1-based positions in this turn's settlement `events` array. */
  eventRefs: number[];
}

export interface PlayCanonBeatProjection {
  /** False when the lens may not learn anything about the table's content. */
  contentVisible: boolean;
  protagonistKnowsCanon?: boolean;
  beats: PlayCanonBeat[];
  changes: PlayCanonBeatChangeRecord[];
}

export interface PlayCanonBeatCandidate {
  label: string;
  quote: string;
  expectedWhen?: string;
}

const STATUSES: readonly PlayCanonBeatStatus[] = [
  'pending',
  'occurredAsCanon',
  'altered',
  'prevented',
  'obsolete',
];

export function createPlayCanonBeatTable(input: {
  protagonistKnowsCanon: boolean;
  beats: readonly PlayCanonBeatSeed[];
}): PlayCanonBeatTable {
  const visibility: PlayEventVisibility = input.protagonistKnowsCanon
    ? 'playerVisible'
    : 'playerUnknown';
  return normalizePlayCanonBeatTable({
    schemaVersion: PLAY_CANON_BEATS_SCHEMA_VERSION,
    protagonistKnowsCanon: input.protagonistKnowsCanon,
    beats: input.beats.map((seed) => ({
      ...normalizePlayCanonBeatSeed(seed),
      status: 'pending',
      visibility,
      causeEventIds: [],
    })),
    changes: [],
  });
}

export function readPlayCanonBeatTable(
  playLocalState: Readonly<Record<string, unknown>>,
): PlayCanonBeatTable | undefined {
  return Object.hasOwn(playLocalState, PLAY_CANON_BEATS_STATE_KEY)
    ? normalizePlayCanonBeatTable(playLocalState[PLAY_CANON_BEATS_STATE_KEY])
    : undefined;
}

export function normalizePlayCanonBeatSeeds(value: unknown): PlayCanonBeatSeed[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAY_CANON_BEATS) {
    throw new Error(`Play canon beats must contain 1-${MAX_PLAY_CANON_BEATS} beats.`);
  }
  const seeds = value.map(normalizePlayCanonBeatSeed);
  assertUnique(seeds.map((seed) => seed.id), 'beat id');
  return seeds;
}

export function normalizePlayCanonBeatSeed(value: unknown): PlayCanonBeatSeed {
  const record = requireRecord(value, 'Play canon beat');
  assertOnlyKnownFields(record, ['id', 'label', 'expectedWhen', 'source'], 'Play canon beat');
  return normalizeSeedFields(record);
}

export function normalizePlayCanonBeatTable(value: unknown): PlayCanonBeatTable {
  const record = requireRecord(value, 'Play canon beat table');
  assertOnlyKnownFields(
    record,
    ['schemaVersion', 'protagonistKnowsCanon', 'beats', 'changes'],
    'Play canon beat table',
  );
  if (record.schemaVersion !== PLAY_CANON_BEATS_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Play canon beat table schemaVersion: ${String(record.schemaVersion)}.`,
    );
  }
  if (typeof record.protagonistKnowsCanon !== 'boolean') {
    throw new Error('Play canon beat table requires protagonistKnowsCanon.');
  }
  if (
    !Array.isArray(record.beats) ||
    record.beats.length === 0 ||
    record.beats.length > MAX_PLAY_CANON_BEATS
  ) {
    throw new Error(`Play canon beat table must contain 1-${MAX_PLAY_CANON_BEATS} beats.`);
  }
  if (
    !Array.isArray(record.changes) ||
    record.changes.length > MAX_PLAY_CANON_BEAT_CHANGE_RECORDS
  ) {
    throw new Error(
      `Play canon beat table supports at most ${MAX_PLAY_CANON_BEAT_CHANGE_RECORDS} change records.`,
    );
  }
  const expectedVisibility: PlayEventVisibility = record.protagonistKnowsCanon
    ? 'playerVisible'
    : 'playerUnknown';
  const beats = record.beats.map((item) => {
    const beat = normalizeBeat(item);
    if (beat.visibility !== expectedVisibility) {
      throw new Error(
        `Play canon beat ${beat.id} visibility does not match protagonistKnowsCanon.`,
      );
    }
    return beat;
  });
  assertUnique(beats.map((beat) => beat.id), 'beat id');
  const beatIds = new Set(beats.map((beat) => beat.id));
  const changes = record.changes.map(normalizeChangeRecord);
  assertUnique(changes.map((change) => change.id), 'change record id');
  for (const change of changes) {
    if (!beatIds.has(change.beatId)) {
      throw new Error(`Play canon beat change record references unknown beat: ${change.beatId}.`);
    }
  }
  return {
    schemaVersion: PLAY_CANON_BEATS_SCHEMA_VERSION,
    protagonistKnowsCanon: record.protagonistKnowsCanon,
    beats,
    changes,
  };
}

export function normalizePlayCanonBeatChanges(value: unknown): PlayCanonBeatChange[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PLAY_CANON_BEATS) {
    throw new Error(
      `Play settlement canonBeatChanges must be an array of at most ${MAX_PLAY_CANON_BEATS} items.`,
    );
  }
  const changes = value.map((item) => {
    const record = requireRecord(item, 'Play canon beat change');
    assertOnlyKnownFields(
      record,
      ['beatId', 'status', 'reason', 'eventRefs'],
      'Play canon beat change',
    );
    const beatId = assertSafeId(record.beatId, 'canon beat change beatId');
    if (
      !Array.isArray(record.eventRefs) ||
      record.eventRefs.length === 0 ||
      record.eventRefs.length > 12 ||
      record.eventRefs.some((ref) => !Number.isSafeInteger(ref) || (ref as number) < 1)
    ) {
      throw new Error(
        `Play canon beat change ${beatId} must cite this turn's events by 1-based position.`,
      );
    }
    const eventRefs = record.eventRefs as number[];
    if (new Set(eventRefs).size !== eventRefs.length) {
      throw new Error(`Play canon beat change ${beatId} repeats an event reference.`);
    }
    return {
      beatId,
      status: normalizeTerminalStatus(record.status),
      reason: normalizeText(record.reason, 'canon beat change reason', MAX_REASON_LENGTH),
      eventRefs: [...eventRefs],
    };
  });
  assertUnique(changes.map((change) => change.beatId), 'canonBeatChanges beatId');
  return changes;
}

/**
 * A referee may only settle a pending beat. An author correction may also move
 * a settled beat to another settled status. Nothing returns to pending.
 */
export function isLegalPlayCanonBeatTransition(
  from: PlayCanonBeatStatus,
  to: PlayCanonBeatStatus,
  origin: PlayCanonBeatChangeOrigin,
): boolean {
  if (to === 'pending' || from === to) return false;
  return from === 'pending' || origin === 'manual';
}

/** Applies one turn's referee proposals. Throws before anything is written. */
export function applyPlayCanonBeatChanges(input: {
  table: PlayCanonBeatTable | undefined;
  changes: readonly PlayCanonBeatChange[];
  /** Host-assigned ids of this turn's events, in settlement order. */
  eventIds: readonly string[];
  refereeTurnId: string;
  revision: number;
}): PlayCanonBeatTable | undefined {
  const changes = normalizePlayCanonBeatChanges([...input.changes]);
  if (!changes.length) return input.table;
  if (!input.table) {
    throw new Error('Play settlement proposes canonBeatChanges but this session has no canon beat table.');
  }
  let table = normalizePlayCanonBeatTable(input.table);
  for (const change of changes) {
    const outOfRange = change.eventRefs.find((ref) => ref > input.eventIds.length);
    if (outOfRange !== undefined) {
      throw new Error(
        `Play canon beat change ${change.beatId} cites event ${outOfRange}, which is not one of this turn's events.`,
      );
    }
    table = appendChangeRecord(table, {
      beatId: change.beatId,
      to: change.status,
      reason: change.reason,
      origin: 'referee',
      turnId: input.refereeTurnId,
      eventIds: change.eventRefs.map((ref) => input.eventIds[ref - 1]!),
      revision: input.revision,
    });
  }
  return table;
}

/** An author correction recorded as a `manual` change. */
export function applyPlayCanonBeatManualCorrection(input: {
  table: PlayCanonBeatTable | undefined;
  beatId: string;
  status: PlayCanonBeatTerminalStatus;
  reason: string;
  turnId: string;
  revision: number;
}): PlayCanonBeatTable {
  if (!input.table) throw new Error('This Play session has no canon beat table.');
  return appendChangeRecord(normalizePlayCanonBeatTable(input.table), {
    beatId: assertSafeId(input.beatId, 'canon beat id'),
    to: normalizeTerminalStatus(input.status),
    reason: normalizeText(input.reason, 'canon beat correction reason', MAX_REASON_LENGTH),
    origin: 'manual',
    turnId: input.turnId,
    eventIds: [],
    revision: input.revision,
  });
}

/** Records that a pending beat now has a scheduled event standing in for it. */
export function linkPlayCanonBeatScheduledEvent(input: {
  table: PlayCanonBeatTable | undefined;
  beatId: string;
  scheduledEventId: string;
}): PlayCanonBeatTable {
  if (!input.table) throw new Error('This Play session has no canon beat table.');
  const table = normalizePlayCanonBeatTable(input.table);
  const beat = table.beats.find((candidate) => candidate.id === input.beatId);
  if (!beat) throw new Error(`Unknown Play canon beat: ${input.beatId}.`);
  if (beat.status !== 'pending') {
    throw new Error(`Only a pending Play canon beat can become a scheduled event: ${beat.id}.`);
  }
  if (beat.scheduledEventId) {
    throw new Error(`Play canon beat ${beat.id} already has a scheduled event.`);
  }
  beat.scheduledEventId = assertSafeId(input.scheduledEventId, 'scheduled event id');
  return normalizePlayCanonBeatTable(table);
}

/**
 * Stored-history check between one artifact's predecessor state and its own
 * snapshot. The table may only move by appending change records that belong to
 * this artifact, and each beat must equal the replay of those records.
 */
export function assertPlayCanonBeatTransition(input: {
  previous: unknown;
  next: unknown;
  artifactKind: 'worldSettlement' | 'transcriptAppend';
  /** True for a transcriptAppend authored by the director speaker. */
  directorNote: boolean;
  /** Referee message id for a settlement; the single message id otherwise. */
  turnId: string;
  revision: number;
  currentEventIds: readonly string[];
}): void {
  const previous = normalizePlayCanonBeatTable(input.previous);
  const next = normalizePlayCanonBeatTable(input.next);
  if (
    previous.protagonistKnowsCanon !== next.protagonistKnowsCanon ||
    previous.beats.length !== next.beats.length ||
    next.changes.length < previous.changes.length ||
    !isDeepStrictEqual(next.changes.slice(0, previous.changes.length), previous.changes)
  ) {
    throw new Error('Play canon beat table identity or history cannot be rewritten.');
  }
  const appended = next.changes.slice(previous.changes.length);
  const currentEventIds = new Set(input.currentEventIds);
  let replayed = previous;
  for (const record of appended) {
    if (record.revision !== input.revision || record.turnId !== input.turnId) {
      throw new Error(`Play canon beat change ${record.id} does not belong to its turn artifact.`);
    }
    if (record.origin === 'referee') {
      if (
        input.artifactKind !== 'worldSettlement' ||
        record.eventIds.length === 0 ||
        record.eventIds.some((eventId) => !currentEventIds.has(eventId))
      ) {
        throw new Error(
          `Play canon beat change ${record.id} must cite events of its own world settlement.`,
        );
      }
    } else if (!input.directorNote || record.eventIds.length !== 0) {
      throw new Error(`Play canon beat change ${record.id} is not a valid author correction.`);
    }
    replayed = appendChangeRecord(replayed, record);
  }
  if (!isDeepStrictEqual(replayed.changes, next.changes)) {
    throw new Error('Play canon beat change records do not replay from their predecessor.');
  }
  for (const [index, beat] of next.beats.entries()) {
    const expected = replayed.beats[index]!;
    const before = previous.beats[index]!;
    const { scheduledEventId, ...rest } = beat;
    const { scheduledEventId: expectedScheduledEventId, ...expectedRest } = expected;
    if (!isDeepStrictEqual(rest, expectedRest)) {
      throw new Error(`Play canon beat ${beat.id} does not match its recorded changes.`);
    }
    if (scheduledEventId !== expectedScheduledEventId) {
      if (
        expectedScheduledEventId !== undefined ||
        !input.directorNote ||
        before.status !== 'pending'
      ) {
        throw new Error(`Play canon beat ${beat.id} has an invalid scheduled event link.`);
      }
    }
  }
}

/**
 * The Player lens learns the table's content only when the protagonist knows
 * canon. Otherwise it gets an empty projection: no labels, quotes, reasons,
 * statuses or counts.
 */
export function projectPlayCanonBeats(
  table: PlayCanonBeatTable | undefined,
  lens: 'player' | 'director',
): PlayCanonBeatProjection | undefined {
  if (!table) return undefined;
  const normalized = normalizePlayCanonBeatTable(table);
  if (lens === 'player' && !normalized.protagonistKnowsCanon) {
    return { contentVisible: false, beats: [], changes: [] };
  }
  return {
    contentVisible: true,
    protagonistKnowsCanon: normalized.protagonistKnowsCanon,
    beats: normalized.beats,
    changes: normalized.changes,
  };
}

/** Appended once to the frozen prefix of a session created with canon beats. */
export function formatPlayCanonBeatsFrozenProtocol(protagonistKnowsCanon: boolean): string {
  return [
    PLAY_CANON_BEATS_PROTOCOL_MARKER,
    'This session tracks canon beats: events the source work says happen after the entry point. The newest user message lists every beat with its id and current status.',
    'Canon is a reference, not a script. Never force a pending beat to happen and never advance one on your own; a beat changes only when this turn\'s own events settle it.',
    'When this turn\'s events make a pending beat happen as in canon, happen differently, become impossible because of what was done, or lose its premise, add one settlement canonBeatChanges item: { beatId, status, reason, eventRefs }. status is occurredAsCanon, altered, prevented or obsolete. eventRefs lists 1-based positions in this turn\'s events array and needs at least one.',
    'Use only listed beat ids. Change only beats listed as pending, at most once per beat per turn. Leave canonBeatChanges out when nothing qualifies. Never write canonBeats through stateDelta.',
    'Consequences of a prevented or altered beat are ordinary events or pressure changes within the normal event budget; the host creates none for you.',
    protagonistKnowsCanon
      ? 'The player character knows these beats and may act on that knowledge.'
      : 'The player character does not know canon. Never mention the beats, their labels, or that a canon exists in player-visible narrative, suggestedActions, or playerVisible/rumor event text.',
  ].join('\n');
}

export function hasPlayCanonBeatsFrozenProtocol(frozenSystemPrompt: string): boolean {
  return frozenSystemPrompt.includes(PLAY_CANON_BEATS_PROTOCOL_MARKER);
}

/** Per-turn referee facts. Empty for a session without a table. */
export function formatPlayCanonBeatPromptLines(
  table: PlayCanonBeatTable | undefined,
): string[] {
  if (!table) return [];
  return [
    '',
    `Canon beats (referee knowledge; player character ${table.protagonistKnowsCanon ? 'knows canon' : 'does NOT know canon'}):`,
    ...table.beats.map((beat) =>
      `- ${beat.id} [${beat.status}] ${beat.label}` +
      (beat.expectedWhen ? `; expected: ${beat.expectedWhen}` : '') +
      (beat.source.kind === 'sourceBacked' ? `; canon: ${JSON.stringify(beat.source.quote)}` : '; author-provided') +
      (beat.scheduledEventId ? `; scheduled as ${beat.scheduledEventId}` : '') +
      (beat.note ? `; note: ${beat.note}` : '')),
  ];
}

export function isPlayCanonBeatQuoteVerbatim(content: string, quote: string): boolean {
  return quote.length > 0 && normalizeNewlines(content).includes(normalizeNewlines(quote));
}

/**
 * Offers the author beats to tick from one timeline source. Every quote is a
 * verbatim substring of the content; the host never paraphrases canon.
 */
export function listPlayCanonBeatCandidates(content: string): PlayCanonBeatCandidate[] {
  const text = normalizeNewlines(content);
  const candidates: PlayCanonBeatCandidate[] = [];
  const seen = new Set<string>();
  const add = (label: string, expectedWhen?: string): void => {
    const quote = label.trim().slice(0, MAX_PLAY_CANON_BEAT_QUOTE_LENGTH).trim();
    if (
      !quote ||
      seen.has(quote) ||
      !text.includes(quote) ||
      candidates.length >= MAX_PLAY_CANON_BEAT_CANDIDATES
    ) return;
    seen.add(quote);
    const when = expectedWhen?.trim().slice(0, MAX_EXPECTED_WHEN_LENGTH);
    candidates.push({
      label: quote.slice(0, MAX_LABEL_LENGTH),
      quote,
      ...(when ? { expectedWhen: when } : {}),
    });
  };

  for (const entry of readStructuredTimelineEntries(text)) {
    add(entry.title, entry.when);
  }
  if (candidates.length) return candidates;

  let fenced = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line || line === '---' || line.startsWith('#')) continue;
    add(line.replace(/^(?:[-*+]|\d+[.)])\s+/u, ''));
  }
  return candidates;
}

function readStructuredTimelineEntries(
  text: string,
): Array<{ title: string; when?: string }> {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const list = [parsed.events, parsed.timeline].find(Array.isArray);
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.title !== 'string') return [];
    const when = [entry.date, entry.when, entry.chapter, entry.order]
      .find((value) => typeof value === 'string' || typeof value === 'number');
    return [{
      title: entry.title,
      ...(when === undefined ? {} : { when: String(when) }),
    }];
  });
}

function appendChangeRecord(
  table: PlayCanonBeatTable,
  change: Omit<PlayCanonBeatChangeRecord, 'id' | 'from'> & { id?: string; from?: PlayCanonBeatStatus },
): PlayCanonBeatTable {
  const beatIndex = table.beats.findIndex((beat) => beat.id === change.beatId);
  const beat = table.beats[beatIndex];
  if (!beat) {
    throw new Error(`Play canon beat change references unknown beat: ${change.beatId}.`);
  }
  if (!isLegalPlayCanonBeatTransition(beat.status, change.to, change.origin)) {
    throw new Error(
      `Illegal Play canon beat transition for ${beat.id}: ${beat.status} -> ${change.to} (${change.origin}).`,
    );
  }
  if (change.from !== undefined && change.from !== beat.status) {
    throw new Error(`Play canon beat change for ${beat.id} does not start from its recorded status.`);
  }
  if (table.changes.length >= MAX_PLAY_CANON_BEAT_CHANGE_RECORDS) {
    throw new Error('Play canon beat table has reached its change record limit.');
  }
  const sameRevision = table.changes.filter((record) =>
    record.revision === change.revision).length;
  const record: PlayCanonBeatChangeRecord = {
    id: change.id ?? `canon-change-${change.revision}-${sameRevision + 1}`,
    beatId: beat.id,
    from: beat.status,
    to: change.to,
    reason: change.reason,
    origin: change.origin,
    turnId: change.turnId,
    eventIds: [...change.eventIds],
    revision: change.revision,
  };
  const beats = table.beats.map((candidate, index) => index === beatIndex
    ? {
        ...candidate,
        status: change.to,
        changedAtTurnId: change.turnId,
        causeEventIds: [...change.eventIds],
        note: change.reason,
      }
    : candidate);
  return normalizePlayCanonBeatTable({
    ...table,
    beats,
    changes: [...table.changes, record],
  });
}

function normalizeSeedFields(record: Record<string, unknown>): PlayCanonBeatSeed {
  const expectedWhen = record.expectedWhen === undefined
    ? undefined
    : normalizeText(record.expectedWhen, 'canon beat expectedWhen', MAX_EXPECTED_WHEN_LENGTH);
  return {
    id: assertSafeId(record.id, 'canon beat id'),
    label: normalizeText(record.label, 'canon beat label', MAX_LABEL_LENGTH),
    ...(expectedWhen ? { expectedWhen } : {}),
    source: normalizeSource(record.source),
  };
}

function normalizeBeat(value: unknown): PlayCanonBeat {
  const record = requireRecord(value, 'Play canon beat');
  assertOnlyKnownFields(record, [
    'id',
    'label',
    'expectedWhen',
    'source',
    'status',
    'visibility',
    'changedAtTurnId',
    'causeEventIds',
    'note',
    'scheduledEventId',
  ], 'Play canon beat');
  if (!Array.isArray(record.causeEventIds) || record.causeEventIds.length > 12) {
    throw new Error('Play canon beat causeEventIds must be an array of at most 12 ids.');
  }
  const status = normalizeStatus(record.status);
  const changedAtTurnId = record.changedAtTurnId === undefined
    ? undefined
    : assertSafeId(record.changedAtTurnId, 'canon beat changedAtTurnId');
  if ((status === 'pending') !== (changedAtTurnId === undefined)) {
    throw new Error('A Play canon beat records changedAtTurnId exactly when it is not pending.');
  }
  if (
    record.visibility !== 'playerVisible' &&
    record.visibility !== 'rumor' &&
    record.visibility !== 'playerUnknown'
  ) {
    throw new Error('Play canon beat visibility is invalid.');
  }
  return {
    ...normalizeSeedFields(record),
    status,
    visibility: record.visibility,
    ...(changedAtTurnId ? { changedAtTurnId } : {}),
    causeEventIds: record.causeEventIds.map((id) => assertSafeId(id, 'canon beat cause event id')),
    ...(record.note === undefined
      ? {}
      : { note: normalizeText(record.note, 'canon beat note', MAX_REASON_LENGTH) }),
    ...(record.scheduledEventId === undefined
      ? {}
      : { scheduledEventId: assertSafeId(record.scheduledEventId, 'scheduled event id') }),
  };
}

function normalizeChangeRecord(value: unknown): PlayCanonBeatChangeRecord {
  const record = requireRecord(value, 'Play canon beat change record');
  assertOnlyKnownFields(record, [
    'id',
    'beatId',
    'from',
    'to',
    'reason',
    'origin',
    'turnId',
    'eventIds',
    'revision',
  ], 'Play canon beat change record');
  if (record.origin !== 'referee' && record.origin !== 'manual') {
    throw new Error('Play canon beat change record origin is invalid.');
  }
  if (!Array.isArray(record.eventIds) || record.eventIds.length > 12) {
    throw new Error('Play canon beat change record eventIds must be an array of at most 12 ids.');
  }
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new Error('Play canon beat change record revision is invalid.');
  }
  const from = normalizeStatus(record.from);
  const to = normalizeTerminalStatus(record.to);
  if (!isLegalPlayCanonBeatTransition(from, to, record.origin)) {
    throw new Error(`Play canon beat change record has an illegal transition: ${from} -> ${to}.`);
  }
  return {
    id: assertSafeId(record.id, 'canon beat change record id'),
    beatId: assertSafeId(record.beatId, 'canon beat change record beatId'),
    from,
    to,
    reason: normalizeText(record.reason, 'canon beat change reason', MAX_REASON_LENGTH),
    origin: record.origin,
    turnId: assertSafeId(record.turnId, 'canon beat change record turnId'),
    eventIds: record.eventIds.map((id) => assertSafeId(id, 'canon beat change event id')),
    revision: record.revision as number,
  };
}

function normalizeSource(value: unknown): PlayCanonBeatSource {
  const record = requireRecord(value, 'Play canon beat source');
  if (record.kind === 'authorProvided') {
    assertOnlyKnownFields(record, ['kind', 'providedAt'], 'Play canon beat source');
    return {
      kind: 'authorProvided',
      providedAt: normalizeText(record.providedAt, 'canon beat providedAt', 128),
    };
  }
  if (record.kind !== 'sourceBacked') {
    throw new Error('Play canon beat source kind is invalid.');
  }
  assertOnlyKnownFields(
    record,
    ['kind', 'sourceId', 'path', 'contentHash', 'quote'],
    'Play canon beat source',
  );
  if (typeof record.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(record.contentHash)) {
    throw new Error('Play canon beat source contentHash must be a SHA-256 hex digest.');
  }
  return {
    kind: 'sourceBacked',
    sourceId: assertSafeId(record.sourceId, 'canon beat source id'),
    path: normalizeText(record.path, 'canon beat source path', 1_000),
    contentHash: record.contentHash,
    quote: normalizeText(record.quote, 'canon beat quote', MAX_PLAY_CANON_BEAT_QUOTE_LENGTH),
  };
}

function normalizeStatus(value: unknown): PlayCanonBeatStatus {
  if (typeof value !== 'string' || !STATUSES.includes(value as PlayCanonBeatStatus)) {
    throw new Error(`Invalid Play canon beat status: ${String(value)}.`);
  }
  return value as PlayCanonBeatStatus;
}

function normalizeTerminalStatus(value: unknown): PlayCanonBeatTerminalStatus {
  const status = normalizeStatus(value);
  if (status === 'pending') {
    throw new Error('A Play canon beat cannot return to pending.');
  }
  return status;
}

function normalizeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`Play ${label} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Play ${label} must contain 1-${maximum} characters.`);
  }
  return normalized;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.length > 200
  ) {
    throw new Error(`Invalid Play ${label}.`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Play canon beats contain a duplicate ${label}.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const known = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !known.has(field));
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  }
}
