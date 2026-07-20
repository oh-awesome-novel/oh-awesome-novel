import { isDeepStrictEqual } from 'node:util';

import type {
  PlayEventOrigin,
  PlayEventVisibility,
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldEventKind,
} from './play-types.js';

export const PLAY_KNOWLEDGE_STATE_KEY = 'playKnowledge' as const;
export const PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION = 1 as const;
export const MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN = 8 as const;
export const MAX_PLAY_KNOWLEDGE_RECORDS = 512 as const;
export const DEFAULT_PLAY_KNOWLEDGE_REVEAL_CANDIDATE_LIMIT = 12 as const;
export const MAX_PLAY_KNOWLEDGE_REVEAL_CANDIDATE_LIMIT = 20 as const;

export type PlayKnowledgePlayerProjection =
  | 'playerUnknown'
  | 'rumor'
  | 'playerVisible';

export interface PlayEventRevealRecord {
  id: string;
  kind: 'eventReveal';
  subjectEventId: string;
  previousPlayerProjection: 'playerUnknown' | 'rumor';
  playerProjection: 'rumor' | 'playerVisible';
  knownByParticipantRefs: [];
  revealedAtTurnId: string;
  revealedByEventId: string;
  canonical: false;
}

export interface PlayParticipantKnowledgeGrantRecord {
  id: string;
  kind: 'participantGrant';
  participantRef: string;
  effectiveFromStepRef: string;
  interventionRef: string;
  grant:
    | { kind: 'existingFact'; factRefs: string[] }
    | {
        kind: 'authorProvidedPlayFact';
        summary: string;
        visibility: PlayEventVisibility;
        providedAt: string;
      };
  grantedAtTurnId: string;
  canonical: false;
}

export type PlayKnowledgeRecord =
  | PlayEventRevealRecord
  | PlayParticipantKnowledgeGrantRecord;

export interface PlayKnowledgeState {
  schemaVersion: typeof PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION;
  records: PlayKnowledgeRecord[];
}

export interface PlayRevealEventKnowledgeChange {
  type: 'revealEvent';
  subjectEventId: string;
  playerProjection: 'rumor' | 'playerVisible';
}

export interface PlayGrantParticipantKnowledgeChange {
  type: 'grantParticipantKnowledge';
  participantRef: string;
  effectiveFromStepRef: string;
  interventionRef: string;
  grant: PlayParticipantKnowledgeGrantRecord['grant'];
}

export type PlayKnowledgeChange =
  | PlayRevealEventKnowledgeChange
  | PlayGrantParticipantKnowledgeChange;

export interface PlayKnowledgeRevealCandidate {
  subjectEventId: string;
  currentPlayerProjection: 'playerUnknown' | 'rumor';
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  reason: string;
  worldClock: PlayWorldClock;
}

export type PlayKnowledgeProjection =
  | {
      lens: 'player';
      kind: 'eventReveal';
      playerProjection: 'rumor' | 'playerVisible';
      revealedAtTurnId: string;
      revealedByEventId: string;
      causalLabel: 'revealsEarlierOffscreenChange' | 'confirmsEarlierRumor';
    }
  | {
      lens: 'author';
      record: PlayKnowledgeRecord;
    }
  | {
      lens: 'player';
      kind: 'participantGrant';
      visible: false;
    };

export interface ApplyPlayKnowledgeChangesInput {
  playLocalState: Record<string, unknown>;
  selectedAncestorEvents: readonly PlayWorldEvent[];
  currentEvents: readonly PlayWorldEvent[];
  changes: readonly PlayKnowledgeChange[];
  revision: number;
  refereeTurnId: string;
}

export interface AssertPlayKnowledgeTransitionInput {
  predecessorPlayLocalState: Record<string, unknown>;
  nextPlayLocalState: Record<string, unknown>;
  selectedAncestorEvents: readonly PlayWorldEvent[];
  currentEvents: readonly PlayWorldEvent[];
  revision: number;
  refereeTurnId: string;
  knowledgeDeltaPresent: boolean;
  artifactKind: 'worldSettlement' | 'transcriptAppend';
}

export interface AssertPlayKnowledgeHistoryInput {
  playLocalState: Record<string, unknown>;
  selectedEvents: readonly PlayWorldEvent[];
}

export function createEmptyPlayKnowledgeState(): PlayKnowledgeState {
  return {
    schemaVersion: PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION,
    records: [],
  };
}

export function normalizePlayKnowledgeState(value: unknown): PlayKnowledgeState {
  if (!isRecord(value)) {
    throw new Error('Play knowledge state must be an object.');
  }
  assertOnlyKnownFields(value, ['schemaVersion', 'records'], 'Play knowledge state');
  if (value.schemaVersion !== PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Play knowledge schemaVersion: ${String(value.schemaVersion)}.`,
    );
  }
  if (!Array.isArray(value.records)) {
    throw new Error('Play knowledge state records must be an array.');
  }
  if (value.records.length > MAX_PLAY_KNOWLEDGE_RECORDS) {
    throw new Error(
      `Play knowledge state cannot contain more than ${MAX_PLAY_KNOWLEDGE_RECORDS} records.`,
    );
  }

  const records = value.records.map(normalizePlayKnowledgeRecord);
  const recordIds = new Set<string>();
  const revealingEventIds = new Set<string>();
  const projections = new Map<string, PlayKnowledgePlayerProjection>();
  for (const record of records) {
    if (recordIds.has(record.id)) {
      throw new Error(`Play knowledge state contains duplicate record id: ${record.id}.`);
    }
    recordIds.add(record.id);
    if (record.kind === 'participantGrant') {
      continue;
    }
    if (revealingEventIds.has(record.revealedByEventId)) {
      throw new Error(
        `Play knowledge state reuses revealing event: ${record.revealedByEventId}.`,
      );
    }
    revealingEventIds.add(record.revealedByEventId);
    const previous = projections.get(record.subjectEventId) ?? 'playerUnknown';
    if (record.previousPlayerProjection !== previous) {
      throw new Error(
        `Play knowledge record ${record.id} does not continue its subject projection.`,
      );
    }
    assertAllowedProjectionTransition(
      record.subjectEventId,
      previous,
      record.playerProjection,
    );
    projections.set(record.subjectEventId, record.playerProjection);
  }

  return {
    schemaVersion: PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION,
    records,
  };
}

export function readPlayKnowledgeState(
  playLocalState: Record<string, unknown>,
): PlayKnowledgeState {
  if (!Object.hasOwn(playLocalState, PLAY_KNOWLEDGE_STATE_KEY)) {
    return createEmptyPlayKnowledgeState();
  }
  return normalizePlayKnowledgeState(playLocalState[PLAY_KNOWLEDGE_STATE_KEY]);
}

export function normalizePlayKnowledgeChanges(
  value: unknown,
): PlayKnowledgeChange[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Play settlement knowledgeChanges must be an array.');
  }
  if (value.length > MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN) {
    throw new Error(
      `Play settlement cannot contain more than ` +
      `${MAX_PLAY_KNOWLEDGE_CHANGES_PER_TURN} knowledge changes per turn.`,
    );
  }

  const changes = value.map(normalizePlayKnowledgeChange);
  const changedSubjectIds = new Set<string>();
  const interventionRefs = new Set<string>();
  for (const change of changes) {
    if (change.type === 'grantParticipantKnowledge') {
      if (interventionRefs.has(change.interventionRef)) {
        throw new Error(
          `Play settlement repeats participant knowledge intervention: ${change.interventionRef}.`,
        );
      }
      interventionRefs.add(change.interventionRef);
      continue;
    }
    if (changedSubjectIds.has(change.subjectEventId)) {
      throw new Error(
        `Play settlement changes knowledge for the same event more than once: ` +
        `${change.subjectEventId}.`,
      );
    }
    changedSubjectIds.add(change.subjectEventId);
  }
  return changes;
}

export function resolvePlayKnowledgeEventProjection(
  stateValue: unknown,
  subjectEventId: string,
): PlayKnowledgePlayerProjection {
  const safeSubjectEventId = assertSafePlayKnowledgeId(
    subjectEventId,
    'Play knowledge subjectEventId',
  );
  const state = normalizePlayKnowledgeState(stateValue);
  return state.records.reduce<PlayKnowledgePlayerProjection>(
    (projection, record) => record.kind === 'eventReveal' &&
      record.subjectEventId === safeSubjectEventId
      ? record.playerProjection
      : projection,
    'playerUnknown',
  );
}

export function listPlayKnowledgeRevealCandidates(input: {
  playLocalState: Record<string, unknown>;
  selectedEvents: readonly PlayWorldEvent[];
  limit?: number;
}): PlayKnowledgeRevealCandidate[] {
  const state = readPlayKnowledgeState(input.playLocalState);
  const limit = normalizeCandidateLimit(input.limit);
  const candidates: PlayKnowledgeRevealCandidate[] = [];
  const seenEventIds = new Set<string>();

  for (const event of [...input.selectedEvents].reverse()) {
    if (seenEventIds.has(event.id)) {
      throw new Error(`Selected Play events contain duplicate id: ${event.id}.`);
    }
    seenEventIds.add(event.id);
    if (event.visibility !== 'playerUnknown') {
      continue;
    }
    const currentPlayerProjection = resolveProjectionFromNormalizedState(
      state,
      event.id,
    );
    if (currentPlayerProjection === 'playerVisible') {
      continue;
    }
    candidates.push({
      subjectEventId: event.id,
      currentPlayerProjection,
      kind: event.kind,
      origin: event.origin,
      title: event.title,
      summary: event.summary,
      reason: event.cause.reason,
      worldClock: { ...event.worldClock },
    });
    if (candidates.length === limit) {
      break;
    }
  }

  return candidates;
}

export function applyPlayKnowledgeChanges(
  input: ApplyPlayKnowledgeChangesInput,
): PlayKnowledgeState {
  assertValidRevision(input.revision);
  const refereeTurnId = assertSafePlayKnowledgeId(
    input.refereeTurnId,
    'Play knowledge refereeTurnId',
  );
  const previous = readPlayKnowledgeState(input.playLocalState);
  const changes = normalizePlayKnowledgeChanges(input.changes);
  if (!changes.length) {
    return previous;
  }

  const ancestorEventsById = indexUniqueEvents(
    input.selectedAncestorEvents,
    'selected ancestor',
  );
  const currentEventsById = indexUniqueEvents(input.currentEvents, 'current');
  for (const event of currentEventsById.values()) {
    if (event.turnId !== refereeTurnId) {
      throw new Error(
        `Play knowledge revealing event ${event.id} does not belong to ` +
        `${refereeTurnId}.`,
      );
    }
    if (event.worldClock.revision !== input.revision) {
      throw new Error(
        `Play knowledge current event ${event.id} does not belong to revision ` +
        `${input.revision}.`,
      );
    }
  }

  const records = previous.records.map(clonePlayKnowledgeRecord);
  const usedRevealingEventIds = new Set<string>();
  for (const [changeIndex, change] of changes.entries()) {
    if (change.type === 'grantParticipantKnowledge') {
      records.push({
        id: createPlayKnowledgeRecordId(input.revision, changeIndex + 1),
        kind: 'participantGrant',
        participantRef: change.participantRef,
        effectiveFromStepRef: change.effectiveFromStepRef,
        interventionRef: change.interventionRef,
        grant: structuredClone(change.grant),
        grantedAtTurnId: refereeTurnId,
        canonical: false,
      });
      continue;
    }
    const subject = ancestorEventsById.get(change.subjectEventId);
    if (!subject) {
      throw new Error(
        `Play knowledge change references a non-ancestor event: ` +
        `${change.subjectEventId}.`,
      );
    }
    if (subject.visibility !== 'playerUnknown') {
      throw new Error(
        `Play knowledge can reveal only an originally playerUnknown event: ` +
        `${subject.id}.`,
      );
    }
    if (subject.worldClock.revision >= input.revision) {
      throw new Error(
        `Play knowledge change must reveal a strict ancestor event: ${subject.id}.`,
      );
    }
    const previousPlayerProjection = resolveProjectionFromNormalizedState(
      { schemaVersion: PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION, records },
      subject.id,
    );
    assertAllowedProjectionTransition(
      subject.id,
      previousPlayerProjection,
      change.playerProjection,
    );
    const revealingEvent = requireUniqueRevealingEvent({
      subjectEventId: subject.id,
      playerProjection: change.playerProjection,
      currentEvents: [...currentEventsById.values()],
    });
    if (usedRevealingEventIds.has(revealingEvent.id)) {
      throw new Error(
        `Play informationSpread event ${revealingEvent.id} cannot reveal more than ` +
        'one knowledge subject.',
      );
    }
    usedRevealingEventIds.add(revealingEvent.id);
    records.push({
      id: createPlayKnowledgeRecordId(input.revision, changeIndex + 1),
      kind: 'eventReveal',
      subjectEventId: subject.id,
      previousPlayerProjection,
      playerProjection: change.playerProjection,
      knownByParticipantRefs: [],
      revealedAtTurnId: refereeTurnId,
      revealedByEventId: revealingEvent.id,
      canonical: false,
    });
  }

  return normalizePlayKnowledgeState({
    schemaVersion: PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION,
    records,
  });
}

export function assertPlayKnowledgeTransition(
  input: AssertPlayKnowledgeTransitionInput,
): void {
  assertValidRevision(input.revision);
  const refereeTurnId = assertSafePlayKnowledgeId(
    input.refereeTurnId,
    'Play knowledge refereeTurnId',
  );
  const previous = readPlayKnowledgeState(input.predecessorPlayLocalState);
  const next = readPlayKnowledgeState(input.nextPlayLocalState);
  const previousHadState = Object.hasOwn(
    input.predecessorPlayLocalState,
    PLAY_KNOWLEDGE_STATE_KEY,
  );
  const nextHasState = Object.hasOwn(
    input.nextPlayLocalState,
    PLAY_KNOWLEDGE_STATE_KEY,
  );

  if (previousHadState && !nextHasState) {
    throw new Error('Play knowledge state is append-only and cannot be removed.');
  }
  if (next.records.length < previous.records.length) {
    throw new Error('Play knowledge records are append-only and cannot be removed.');
  }
  for (const [index, record] of previous.records.entries()) {
    if (!isDeepStrictEqual(record, next.records[index])) {
      throw new Error('Play knowledge records are append-only and cannot be changed or reordered.');
    }
  }

  const appended = next.records.slice(previous.records.length);
  if (input.knowledgeDeltaPresent !== (appended.length > 0)) {
    throw new Error(
      'Play knowledge stateDelta must contain only host-materialized appended records.',
    );
  }
  if (input.artifactKind === 'transcriptAppend' && appended.length) {
    throw new Error('Play transcript append cannot change Play knowledge.');
  }
  if (input.artifactKind === 'worldSettlement' && appended.length === 0) {
    return;
  }

  const ancestorEventsById = indexUniqueEvents(
    input.selectedAncestorEvents,
    'selected ancestor',
  );
  const currentEvents = [...indexUniqueEvents(input.currentEvents, 'current').values()];
  for (const event of currentEvents) {
    if (event.turnId !== refereeTurnId) {
      throw new Error(
        `Play knowledge revealing event ${event.id} does not belong to ` +
        `${refereeTurnId}.`,
      );
    }
  }
  const usedSubjectIds = new Set<string>();
  const usedRevealingEventIds = new Set<string>();
  const replayRecords = previous.records.map(clonePlayKnowledgeRecord);

  for (const [index, record] of appended.entries()) {
    const expectedRecordId = createPlayKnowledgeRecordId(input.revision, index + 1);
    if (record.id !== expectedRecordId) {
      throw new Error(
        `Play knowledge record ${record.id} is not host-assigned for revision ` +
        `${input.revision}.`,
      );
    }
    if (record.kind === 'participantGrant') {
      if (record.grantedAtTurnId !== refereeTurnId) {
        throw new Error(
          `Play participant knowledge record ${record.id} does not belong to its referee turn.`,
        );
      }
      replayRecords.push(record);
      continue;
    }
    if (record.revealedAtTurnId !== refereeTurnId) {
      throw new Error(
        `Play knowledge record ${record.id} does not belong to its referee turn.`,
      );
    }
    if (usedSubjectIds.has(record.subjectEventId)) {
      throw new Error(
        `Play turn reveals the same knowledge subject more than once: ` +
        `${record.subjectEventId}.`,
      );
    }
    usedSubjectIds.add(record.subjectEventId);
    const subject = ancestorEventsById.get(record.subjectEventId);
    if (!subject) {
      throw new Error(
        `Play knowledge record ${record.id} references a non-ancestor event: ` +
        `${record.subjectEventId}.`,
      );
    }
    if (subject.visibility !== 'playerUnknown') {
      throw new Error(
        `Play knowledge record ${record.id} can reveal only an originally ` +
        'playerUnknown event.',
      );
    }
    const previousPlayerProjection = resolveProjectionFromNormalizedState(
      { schemaVersion: PLAY_KNOWLEDGE_STATE_SCHEMA_VERSION, records: replayRecords },
      record.subjectEventId,
    );
    if (record.previousPlayerProjection !== previousPlayerProjection) {
      throw new Error(
        `Play knowledge record ${record.id} does not match its predecessor projection.`,
      );
    }
    assertAllowedProjectionTransition(
      record.subjectEventId,
      previousPlayerProjection,
      record.playerProjection,
    );
    const revealingEvent = requireUniqueRevealingEvent({
      subjectEventId: record.subjectEventId,
      playerProjection: record.playerProjection,
      currentEvents,
    });
    if (record.revealedByEventId !== revealingEvent.id) {
      throw new Error(
        `Play knowledge record ${record.id} does not identify its paired ` +
        'informationSpread event.',
      );
    }
    if (usedRevealingEventIds.has(revealingEvent.id)) {
      throw new Error(
        `Play informationSpread event ${revealingEvent.id} cannot reveal more than ` +
        'one knowledge subject.',
      );
    }
    usedRevealingEventIds.add(revealingEvent.id);
    replayRecords.push(record);
  }
}

export function assertPlayKnowledgeHistory(
  input: AssertPlayKnowledgeHistoryInput,
): void {
  const state = readPlayKnowledgeState(input.playLocalState);
  if (!state.records.length) {
    return;
  }
  const selectedEventsById = indexUniqueEvents(input.selectedEvents, 'selected branch');
  const selectedEventIndexes = new Map(
    input.selectedEvents.map((event, index) => [event.id, index]),
  );
  const localRecordCounts = new Map<number, number>();
  let previousRevealRevision = -1;

  for (const record of state.records) {
    if (record.kind === 'participantGrant') {
      const revisionMatch = /^turn-(\d+)-referee$/u.exec(record.grantedAtTurnId);
      const grantRevision = revisionMatch ? Number(revisionMatch[1]) : Number.NaN;
      if (!Number.isSafeInteger(grantRevision) || grantRevision < 1) {
        throw new Error(
          `Play participant knowledge record ${record.id} has invalid turn evidence.`,
        );
      }
      if (grantRevision < previousRevealRevision) {
        throw new Error('Play knowledge records are not in chronology order.');
      }
      previousRevealRevision = grantRevision;
      const localIndex = (localRecordCounts.get(grantRevision) ?? 0) + 1;
      localRecordCounts.set(grantRevision, localIndex);
      if (record.id !== createPlayKnowledgeRecordId(grantRevision, localIndex)) {
        throw new Error(
          `Play participant knowledge record ${record.id} is not host-assigned.`,
        );
      }
      continue;
    }
    const subject = selectedEventsById.get(record.subjectEventId);
    const revealingEvent = selectedEventsById.get(record.revealedByEventId);
    if (!subject || !revealingEvent) {
      throw new Error(
        `Play knowledge record ${record.id} references an event outside its selected branch.`,
      );
    }
    if (subject.visibility !== 'playerUnknown') {
      throw new Error(
        `Play knowledge record ${record.id} can reveal only an originally ` +
        'playerUnknown event.',
      );
    }
    const subjectIndex = selectedEventIndexes.get(subject.id)!;
    const revealingIndex = selectedEventIndexes.get(revealingEvent.id)!;
    if (
      subjectIndex >= revealingIndex ||
      subject.worldClock.revision >= revealingEvent.worldClock.revision
    ) {
      throw new Error(
        `Play knowledge record ${record.id} must reveal a strict ancestor event.`,
      );
    }
    if (
      revealingEvent.kind !== 'informationSpread' ||
      revealingEvent.visibility !== record.playerProjection ||
      !revealingEvent.cause.sourceEventIds?.includes(subject.id) ||
      revealingEvent.turnId !== record.revealedAtTurnId
    ) {
      throw new Error(
        `Play knowledge record ${record.id} has invalid reveal evidence.`,
      );
    }
    const revealRevision = revealingEvent.worldClock.revision;
    if (revealRevision < previousRevealRevision) {
      throw new Error('Play knowledge records are not in reveal chronology order.');
    }
    previousRevealRevision = revealRevision;
    const localIndex = (localRecordCounts.get(revealRevision) ?? 0) + 1;
    localRecordCounts.set(revealRevision, localIndex);
    if (record.id !== createPlayKnowledgeRecordId(revealRevision, localIndex)) {
      throw new Error(
        `Play knowledge record ${record.id} is not host-assigned for its reveal revision.`,
      );
    }
  }
}

export function projectPlayEventRevealRecord(
  value: unknown,
  lens: 'player' | 'author',
): PlayKnowledgeProjection {
  const record = normalizePlayEventRevealRecord(value);
  if (lens === 'author') {
    return { lens, record };
  }
  return {
    lens,
    kind: 'eventReveal',
    playerProjection: record.playerProjection,
    revealedAtTurnId: record.revealedAtTurnId,
    revealedByEventId: record.revealedByEventId,
    causalLabel: record.previousPlayerProjection === 'rumor'
      ? 'confirmsEarlierRumor'
      : 'revealsEarlierOffscreenChange',
  };
}

export function projectPlayKnowledgeRecord(
  value: unknown,
  lens: 'player' | 'author',
): PlayKnowledgeProjection {
  const record = normalizePlayKnowledgeRecord(value);
  if (lens === 'author') return { lens, record };
  if (record.kind === 'participantGrant') {
    return { lens, kind: 'participantGrant', visible: false };
  }
  return projectPlayEventRevealRecord(record, lens);
}

export function listPlayParticipantKnowledgeGrants(
  stateValue: unknown,
  participantRefValue: string,
): PlayParticipantKnowledgeGrantRecord[] {
  const state = normalizePlayKnowledgeState(stateValue);
  const participantRef = assertSafePlayKnowledgeId(
    participantRefValue,
    'Play participant knowledge participantRef',
  );
  return state.records
    .filter(
      (record): record is PlayParticipantKnowledgeGrantRecord =>
        record.kind === 'participantGrant' && record.participantRef === participantRef,
    )
    .map((record) => structuredClone(record));
}

function normalizePlayKnowledgeRecord(value: unknown): PlayKnowledgeRecord {
  if (!isRecord(value)) {
    throw new Error('Every Play knowledge record must be an object.');
  }
  return value.kind === 'participantGrant'
    ? normalizePlayParticipantKnowledgeGrantRecord(value)
    : normalizePlayEventRevealRecord(value);
}

function normalizePlayEventRevealRecord(value: unknown): PlayEventRevealRecord {
  if (!isRecord(value)) {
    throw new Error('Every Play knowledge record must be an object.');
  }
  assertOnlyKnownFields(value, [
    'id',
    'kind',
    'subjectEventId',
    'previousPlayerProjection',
    'playerProjection',
    'knownByParticipantRefs',
    'revealedAtTurnId',
    'revealedByEventId',
    'canonical',
  ], 'Play knowledge record');
  if (value.kind !== 'eventReveal') {
    throw new Error(`Unsupported Play knowledge record kind: ${String(value.kind)}.`);
  }
  if (
    value.previousPlayerProjection !== 'playerUnknown' &&
    value.previousPlayerProjection !== 'rumor'
  ) {
    throw new Error('Play event reveal record has an invalid previous projection.');
  }
  if (value.playerProjection !== 'rumor' && value.playerProjection !== 'playerVisible') {
    throw new Error('Play event reveal record has an invalid Player projection.');
  }
  if (!Array.isArray(value.knownByParticipantRefs) || value.knownByParticipantRefs.length) {
    throw new Error('M3 Play event reveal records cannot grant participant knowledge.');
  }
  if (value.canonical !== false) {
    throw new Error('Play knowledge records must remain non-canonical.');
  }

  return {
    id: assertSafePlayKnowledgeId(value.id, 'Play knowledge record id'),
    kind: 'eventReveal',
    subjectEventId: assertSafePlayKnowledgeId(
      value.subjectEventId,
      'Play knowledge subjectEventId',
    ),
    previousPlayerProjection: value.previousPlayerProjection,
    playerProjection: value.playerProjection,
    knownByParticipantRefs: [],
    revealedAtTurnId: assertSafePlayKnowledgeId(
      value.revealedAtTurnId,
      'Play knowledge revealedAtTurnId',
    ),
    revealedByEventId: assertSafePlayKnowledgeId(
      value.revealedByEventId,
      'Play knowledge revealedByEventId',
    ),
    canonical: false,
  };
}

function normalizePlayParticipantKnowledgeGrantRecord(
  value: unknown,
): PlayParticipantKnowledgeGrantRecord {
  if (!isRecord(value)) {
    throw new Error('Every Play participant knowledge record must be an object.');
  }
  assertOnlyKnownFields(value, [
    'id',
    'kind',
    'participantRef',
    'effectiveFromStepRef',
    'interventionRef',
    'grant',
    'grantedAtTurnId',
    'canonical',
  ], 'Play participant knowledge record');
  if (value.kind !== 'participantGrant' || value.canonical !== false) {
    throw new Error('Play participant knowledge record has invalid identity or canonical status.');
  }
  return {
    id: assertSafePlayKnowledgeId(value.id, 'Play knowledge record id'),
    kind: 'participantGrant',
    participantRef: assertSafePlayKnowledgeId(
      value.participantRef,
      'Play knowledge participantRef',
    ),
    effectiveFromStepRef: assertSafePlayKnowledgeId(
      value.effectiveFromStepRef,
      'Play knowledge effectiveFromStepRef',
    ),
    interventionRef: assertSafePlayKnowledgeId(
      value.interventionRef,
      'Play knowledge interventionRef',
    ),
    grant: normalizeParticipantGrant(value.grant),
    grantedAtTurnId: assertSafePlayKnowledgeId(
      value.grantedAtTurnId,
      'Play knowledge grantedAtTurnId',
    ),
    canonical: false,
  };
}

function normalizePlayKnowledgeChange(value: unknown): PlayKnowledgeChange {
  if (!isRecord(value)) {
    throw new Error('Every Play knowledge change must be an object.');
  }
  if (value.type === 'grantParticipantKnowledge') {
    assertOnlyKnownFields(value, [
      'type',
      'participantRef',
      'effectiveFromStepRef',
      'interventionRef',
      'grant',
    ], 'Play participant knowledge change');
    return {
      type: 'grantParticipantKnowledge',
      participantRef: assertSafePlayKnowledgeId(
        value.participantRef,
        'Play knowledge participantRef',
      ),
      effectiveFromStepRef: assertSafePlayKnowledgeId(
        value.effectiveFromStepRef,
        'Play knowledge effectiveFromStepRef',
      ),
      interventionRef: assertSafePlayKnowledgeId(
        value.interventionRef,
        'Play knowledge interventionRef',
      ),
      grant: normalizeParticipantGrant(value.grant),
    };
  }
  assertOnlyKnownFields(
    value,
    ['type', 'subjectEventId', 'playerProjection'],
    'Play knowledge change',
  );
  if (value.type !== 'revealEvent') {
    throw new Error(`Unsupported Play knowledge change type: ${String(value.type)}.`);
  }
  if (value.playerProjection !== 'rumor' && value.playerProjection !== 'playerVisible') {
    throw new Error('Play revealEvent change has an invalid Player projection.');
  }
  return {
    type: 'revealEvent',
    subjectEventId: assertSafePlayKnowledgeId(
      value.subjectEventId,
      'Play knowledge change subjectEventId',
    ),
    playerProjection: value.playerProjection,
  };
}

function resolveProjectionFromNormalizedState(
  state: PlayKnowledgeState,
  subjectEventId: string,
): PlayKnowledgePlayerProjection {
  return state.records.reduce<PlayKnowledgePlayerProjection>(
    (projection, record) => record.kind === 'eventReveal' &&
      record.subjectEventId === subjectEventId
      ? record.playerProjection
      : projection,
    'playerUnknown',
  );
}

function normalizeParticipantGrant(
  value: unknown,
): PlayParticipantKnowledgeGrantRecord['grant'] {
  if (!isRecord(value)) {
    throw new Error('Play participant knowledge grant must be an object.');
  }
  if (value.kind === 'existingFact') {
    assertOnlyKnownFields(value, ['kind', 'factRefs'], 'Play existing-fact grant');
    if (!Array.isArray(value.factRefs) || !value.factRefs.length) {
      throw new Error('Play existing-fact grant requires stable fact refs.');
    }
    const factRefs = value.factRefs.map((ref) =>
      assertSafePlayKnowledgeId(ref, 'Play knowledge fact ref'));
    if (new Set(factRefs).size !== factRefs.length) {
      throw new Error('Play participant knowledge fact refs must be unique.');
    }
    return { kind: 'existingFact', factRefs };
  }
  if (value.kind === 'authorProvidedPlayFact') {
    assertOnlyKnownFields(
      value,
      ['kind', 'summary', 'visibility', 'providedAt'],
      'Play author-provided participant grant',
    );
    if (
      value.visibility !== 'playerVisible' &&
      value.visibility !== 'rumor' &&
      value.visibility !== 'playerUnknown'
    ) {
      throw new Error('Play participant knowledge grant has invalid visibility.');
    }
    return {
      kind: 'authorProvidedPlayFact',
      summary: normalizeGrantText(value.summary, 'summary', 12_000),
      visibility: value.visibility,
      providedAt: normalizeGrantText(value.providedAt, 'providedAt', 128),
    };
  }
  throw new Error(`Unsupported Play participant knowledge grant: ${String(value.kind)}.`);
}

function assertAllowedProjectionTransition(
  subjectEventId: string,
  previous: PlayKnowledgePlayerProjection,
  next: 'rumor' | 'playerVisible',
): asserts previous is 'playerUnknown' | 'rumor' {
  if (previous === 'playerVisible') {
    throw new Error(`Play event ${subjectEventId} is already playerVisible.`);
  }
  if (previous === next) {
    throw new Error(`Play event ${subjectEventId} knowledge reveal is a no-op.`);
  }
  if (previous === 'rumor' && next !== 'playerVisible') {
    throw new Error(`Play event ${subjectEventId} knowledge projection cannot downgrade.`);
  }
}

function requireUniqueRevealingEvent(input: {
  subjectEventId: string;
  playerProjection: 'rumor' | 'playerVisible';
  currentEvents: readonly PlayWorldEvent[];
}): PlayWorldEvent {
  const matches = input.currentEvents.filter((event) =>
    event.kind === 'informationSpread' &&
    event.visibility === input.playerProjection &&
    event.cause.sourceEventIds?.includes(input.subjectEventId));
  if (matches.length !== 1) {
    throw new Error(
      `Play knowledge change for ${input.subjectEventId} requires exactly one ` +
      `matching current informationSpread event; received ${matches.length}.`,
    );
  }
  return matches[0]!;
}

function createPlayKnowledgeRecordId(revision: number, localIndex: number): string {
  return `knowledge-${revision}-${localIndex}`;
}

function clonePlayKnowledgeRecord(record: PlayKnowledgeRecord): PlayKnowledgeRecord {
  return record.kind === 'eventReveal'
    ? { ...record, knownByParticipantRefs: [] }
    : structuredClone(record);
}

function indexUniqueEvents(
  events: readonly PlayWorldEvent[],
  label: string,
): Map<string, PlayWorldEvent> {
  const indexed = new Map<string, PlayWorldEvent>();
  for (const event of events) {
    if (indexed.has(event.id)) {
      throw new Error(`Play ${label} events contain duplicate id: ${event.id}.`);
    }
    indexed.set(event.id, event);
  }
  return indexed;
}

function normalizeCandidateLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PLAY_KNOWLEDGE_REVEAL_CANDIDATE_LIMIT;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Play knowledge reveal candidate limit must be a positive integer.');
  }
  return Math.min(value, MAX_PLAY_KNOWLEDGE_REVEAL_CANDIDATE_LIMIT);
}

function assertValidRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Play knowledge revision must be a positive integer.');
  }
}

function assertSafePlayKnowledgeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..')
  ) {
    throw new Error(`${label} must be a safe id.`);
  }
  return value;
}

function normalizeGrantText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Play participant knowledge ${label} must be non-empty text.`);
  }
  return value.trim();
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const known = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPlayKnowledgeStateVisibility(
  value: PlayEventVisibility | undefined,
): boolean {
  return value === 'playerUnknown';
}
