import type {
  PlayActionKind,
  PlayEventVisibility,
  PlayObservation,
  PlayRelativeTimeAdvance,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
} from './play-types.js';
import { normalizePlayRelativeTimeAdvance } from './play-world-momentum.js';
import { normalizePlayScheduledEvents } from './play-event-schedule.js';
import type { PlayScheduledEvent } from './play-event-schedule.js';

export const PLAY_TURN_ARTIFACT_SCHEMA_VERSION = 2 as const;
export const PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION = 3 as const;
export const LEGACY_PLAY_TURN_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type PlayTurnArtifactSchemaVersion =
  | typeof LEGACY_PLAY_TURN_ARTIFACT_SCHEMA_VERSION
  | typeof PLAY_TURN_ARTIFACT_SCHEMA_VERSION
  | typeof PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION;
export type PlayTurnArtifactKind = 'worldSettlement' | 'transcriptAppend';

export interface PlayTurnArtifact {
  schemaVersion: PlayTurnArtifactSchemaVersion;
  artifactKind?: PlayTurnArtifactKind;
  branchSnapshotVersion?: 1;
  id: string;
  revision: number;
  parentTurnId?: string;
  input?: {
    kind: PlayActionKind;
    raw: string;
    timeAdvance?: PlayRelativeTimeAdvance;
  };
  messages: PlayTranscriptTurn[];
  worldClock?: PlayWorldClock;
  eventIds: string[];
  dueScheduledEventIds: string[];
  scheduledEventIds: string[];
  scheduledEventSnapshots: PlayScheduledEvent[];
  playLocalStateSnapshot?: Record<string, unknown>;
  playLocalStateVisibilitySnapshot?: Record<string, PlayEventVisibility>;
  observationIds: string[];
  rehearsalEvidenceRefs?: string[];
  stateDelta: Record<string, unknown>;
  suggestedActions: string[];
  committedAt: string;
  canonical: false;
}

export interface LegacyPlayTurnArtifactInput {
  transcript: PlayTranscriptTurn[];
  events?: PlayWorldEvent[];
  observations?: PlayObservation[];
}

export const createLegacyPlayTurnArtifacts = (
  input: LegacyPlayTurnArtifactInput,
): PlayTurnArtifact[] => {
  const groups: Array<{
    legacyTurnNumber?: number;
    messages: PlayTranscriptTurn[];
  }> = [];

  for (const rawMessage of input.transcript) {
    const message = normalizeTranscriptTurn(rawMessage, {
      allowUnknownFields: true,
      requireId: false,
    });
    const legacyTurnNumber = readLegacyWorldTurnNumber(message.id);
    const previous = groups.at(-1);

    if (
      legacyTurnNumber !== undefined &&
      previous?.legacyTurnNumber === legacyTurnNumber
    ) {
      previous.messages.push(message);
      continue;
    }

    groups.push({
      ...(legacyTurnNumber !== undefined ? { legacyTurnNumber } : {}),
      messages: [message],
    });
  }

  const groupMessageIds = groups.map((group) => new Set(
    group.messages
      .map((message) => message.id)
      .filter((messageId): messageId is string => Boolean(messageId)),
  ));
  const observationOwnerIndexes = new Map<string, number>();
  for (const observation of input.observations ?? []) {
    for (let index = groupMessageIds.length - 1; index >= 0; index -= 1) {
      if (observation.sourceTurnIds.some((turnId) =>
        groupMessageIds[index]!.has(turnId))) {
        observationOwnerIndexes.set(observation.id, index);
        break;
      }
    }
  }

  let previousRevision = -1;
  return groups.map((group, index) => {
    const id = `legacy-turn-${String(index + 1).padStart(4, '0')}`;
    const revision = Math.max(
      group.legacyTurnNumber ?? index,
      previousRevision + 1,
    );
    previousRevision = revision;
    const messageIds = new Set(
      group.messages
        .map((message) => message.id)
        .filter((messageId): messageId is string => Boolean(messageId)),
    );
    const eventIds = (input.events ?? [])
      .filter((event) => messageIds.has(event.turnId))
      .map((event) => event.id);
    const observationIds = (input.observations ?? [])
      .filter((observation) => observationOwnerIndexes.get(observation.id) === index)
      .map((observation) => observation.id);

    return {
      schemaVersion: LEGACY_PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
      id,
      revision,
      ...(index > 0
        ? { parentTurnId: `legacy-turn-${String(index).padStart(4, '0')}` }
        : {}),
      messages: group.messages.map((message, messageIndex) => ({
        ...message,
        id: message.id ?? `${id}-message-${messageIndex + 1}`,
      })),
      eventIds,
      dueScheduledEventIds: [],
      scheduledEventIds: [],
      scheduledEventSnapshots: [],
      observationIds,
      stateDelta: {},
      suggestedActions: [],
      committedAt: group.messages.at(-1)?.createdAt ?? new Date(0).toISOString(),
      canonical: false,
    };
  });
};

export const normalizePlayTurnArtifact = (value: unknown): PlayTurnArtifact => {
  if (!isRecord(value)) {
    throw new Error('Stored Play turn artifact must be an object.');
  }
  if (
    value.schemaVersion !== LEGACY_PLAY_TURN_ARTIFACT_SCHEMA_VERSION &&
    value.schemaVersion !== PLAY_TURN_ARTIFACT_SCHEMA_VERSION &&
    value.schemaVersion !== PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION
  ) {
    throw new Error(
      `Unsupported Play turn artifact schemaVersion: ${String(value.schemaVersion)}.`,
    );
  }
  assertOnlyKnownFields(value, [
    'schemaVersion',
    'artifactKind',
    'branchSnapshotVersion',
    'id',
    'revision',
    'parentTurnId',
    'input',
    'messages',
    'worldClock',
    'eventIds',
    'dueScheduledEventIds',
    'scheduledEventIds',
    'scheduledEventSnapshots',
    'playLocalStateSnapshot',
    'playLocalStateVisibilitySnapshot',
    'observationIds',
    'rehearsalEvidenceRefs',
    'stateDelta',
    'suggestedActions',
    'committedAt',
    'canonical',
  ]);

  const id = assertSafePlayTurnArtifactId(value.id);
  const revision = assertNonNegativeInteger(value.revision, 'revision');
  const parentTurnId = value.parentTurnId === undefined
    ? undefined
    : assertSafePlayTurnArtifactId(value.parentTurnId);
  if (!Array.isArray(value.messages)) {
    throw new Error(`Play turn artifact ${id} requires messages.`);
  }
  const messages = value.messages.map((message) => normalizeTranscriptTurn(message, {
    allowUnknownFields: false,
    requireId: true,
  }));
  const committedAt = normalizeRequiredString(value.committedAt, 'committedAt');
  const schemaVersion = value.schemaVersion;
  const artifactKind = value.artifactKind;
  if (
    artifactKind !== undefined &&
    artifactKind !== 'worldSettlement' &&
    artifactKind !== 'transcriptAppend'
  ) {
    throw new Error(`Play turn artifact ${id} has invalid artifactKind.`);
  }
  const branchSnapshotVersion = value.branchSnapshotVersion;
  if (branchSnapshotVersion !== undefined && branchSnapshotVersion !== 1) {
    throw new Error(
      `Play turn artifact ${id} has unsupported branchSnapshotVersion.`,
    );
  }

  if (!messages.length) {
    throw new Error(`Play turn artifact ${id} requires at least one message.`);
  }
  if (value.input !== undefined && !isRecord(value.input)) {
    throw new Error(`Play turn artifact ${id} has invalid input.`);
  }
  if (isRecord(value.input)) {
    assertOnlyKnownFields(value.input, ['kind', 'raw', 'timeAdvance']);
  }
  if (value.worldClock !== undefined && !isRecord(value.worldClock)) {
    throw new Error(`Play turn artifact ${id} has invalid worldClock.`);
  }
  if (!isRecord(value.stateDelta)) {
    throw new Error(`Play turn artifact ${id} requires stateDelta.`);
  }
  if (value.canonical !== false) {
    throw new Error(`Play turn artifact ${id} must remain non-canonical.`);
  }

  const scheduledEventIds = value.scheduledEventIds === undefined
    ? []
    : normalizeRequiredIdList(
        value.scheduledEventIds,
        'scheduledEventIds',
      );
  const scheduledEventSnapshots = value.scheduledEventSnapshots === undefined
    ? []
    : normalizePlayScheduledEvents(value.scheduledEventSnapshots);
  if (
    scheduledEventIds.length !== scheduledEventSnapshots.length ||
    scheduledEventIds.some((scheduledEventId, index) =>
      scheduledEventSnapshots[index]?.id !== scheduledEventId)
  ) {
    throw new Error(
      `Play turn artifact ${id} scheduledEventIds must match scheduledEventSnapshots.`,
    );
  }
  const playLocalStateSnapshot = value.playLocalStateSnapshot;
  if (
    playLocalStateSnapshot !== undefined &&
    !isRecord(playLocalStateSnapshot)
  ) {
    throw new Error(
      `Play turn artifact ${id} has invalid playLocalStateSnapshot.`,
    );
  }
  const playLocalStateVisibilitySnapshot = normalizeVisibilitySnapshot(
    value.playLocalStateVisibilitySnapshot,
    id,
  );
  if (
    (
      schemaVersion === PLAY_TURN_ARTIFACT_SCHEMA_VERSION ||
      schemaVersion === PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION
    ) &&
    (
      artifactKind === undefined ||
      branchSnapshotVersion !== 1 ||
      !Object.hasOwn(value, 'scheduledEventIds') ||
      !Object.hasOwn(value, 'scheduledEventSnapshots') ||
      !Object.hasOwn(value, 'dueScheduledEventIds') ||
      value.worldClock === undefined ||
      playLocalStateSnapshot === undefined ||
      playLocalStateVisibilitySnapshot === undefined
    )
  ) {
    throw new Error(
      `Play turn artifact ${id} requires a complete branch snapshot.`,
    );
  }

  const rehearsalEvidenceRefs = value.rehearsalEvidenceRefs === undefined
    ? undefined
    : normalizeRequiredIdList(
        value.rehearsalEvidenceRefs,
        'rehearsalEvidenceRefs',
      );
  if (
    schemaVersion === PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION &&
    (
      artifactKind !== 'worldSettlement' ||
      !rehearsalEvidenceRefs?.length
    )
  ) {
    throw new Error(
      `Play rehearsal turn artifact ${id} requires committed rehearsal evidence.`,
    );
  }
  if (
    schemaVersion !== PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION &&
    rehearsalEvidenceRefs !== undefined
  ) {
    throw new Error(
      `Play turn artifact ${id} cannot carry rehearsal evidence before schema v3.`,
    );
  }

  return {
    schemaVersion,
    ...(artifactKind ? { artifactKind } : {}),
    ...(branchSnapshotVersion === 1 ? { branchSnapshotVersion } : {}),
    id,
    revision,
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(value.input
      ? { input: normalizePlayTurnArtifactInput(value.input) }
      : {}),
    messages,
    ...(value.worldClock
      ? { worldClock: normalizeWorldClock(value.worldClock) }
      : {}),
    eventIds: normalizeRequiredIdList(value.eventIds, 'eventIds'),
    dueScheduledEventIds: value.dueScheduledEventIds === undefined
      ? []
      : normalizeRequiredIdList(
          value.dueScheduledEventIds,
          'dueScheduledEventIds',
        ),
    scheduledEventIds,
    scheduledEventSnapshots,
    ...(playLocalStateSnapshot
      ? { playLocalStateSnapshot: structuredClone(playLocalStateSnapshot) }
      : {}),
    ...(playLocalStateVisibilitySnapshot
      ? {
          playLocalStateVisibilitySnapshot: {
            ...playLocalStateVisibilitySnapshot,
          },
        }
      : {}),
    observationIds: normalizeRequiredIdList(
      value.observationIds,
      'observationIds',
    ),
    ...(rehearsalEvidenceRefs ? { rehearsalEvidenceRefs } : {}),
    stateDelta: structuredClone(value.stateDelta),
    suggestedActions: normalizeRequiredStringList(
      value.suggestedActions,
      'suggestedActions',
    ),
    committedAt,
    canonical: false,
  };
};

const normalizePlayTurnArtifactInput = (
  value: Record<string, unknown>,
): NonNullable<PlayTurnArtifact['input']> => {
  const kind = normalizeActionKind(value.kind);
  const timeAdvance = value.timeAdvance === undefined
    ? undefined
    : normalizePlayRelativeTimeAdvance(value.timeAdvance);
  if (timeAdvance && kind !== 'wait') {
    throw new Error('Play turn artifact timeAdvance requires a wait action.');
  }
  return {
    kind,
    raw: normalizeRequiredString(value.raw, 'input.raw'),
    ...(timeAdvance ? { timeAdvance } : {}),
  };
};

export const projectPlayTranscript = (
  artifacts: PlayTurnArtifact[],
  selectedTurnIds: string[],
): PlayTranscriptTurn[] => {
  const byId = indexPlayTurnArtifacts(artifacts);
  const seen = new Set<string>();
  const projected: PlayTranscriptTurn[] = [];
  let previousId: string | undefined;

  for (const selectedTurnId of selectedTurnIds) {
    const id = assertSafePlayTurnArtifactId(selectedTurnId);
    if (seen.has(id)) {
      throw new Error(`Play selected turn path contains duplicate artifact: ${id}.`);
    }
    seen.add(id);

    const artifact = byId.get(id);
    if (!artifact) {
      throw new Error(`Play selected turn path references a missing artifact: ${id}.`);
    }
    if (artifact.parentTurnId !== previousId) {
      throw new Error(
        `Play selected turn path breaks parent chain at artifact: ${id}.`,
      );
    }
    projected.push(...artifact.messages.map(cloneTranscriptTurn));
    previousId = id;
  }

  return projected;
};

export const selectDefaultPlayTurnPath = (
  artifacts: PlayTurnArtifact[],
): string[] => {
  const byId = indexPlayTurnArtifacts(artifacts);
  if (!artifacts.length) {
    return [];
  }

  const parentIds = new Set(
    artifacts
      .map((artifact) => artifact.parentTurnId)
      .filter((id): id is string => Boolean(id)),
  );
  const head = artifacts
    .filter((artifact) => !parentIds.has(artifact.id))
    .toSorted((left, right) =>
      right.revision - left.revision ||
      right.committedAt.localeCompare(left.committedAt) ||
      right.id.localeCompare(left.id),
    )[0];
  if (!head) {
    throw new Error('Play turn artifact graph requires a leaf head.');
  }

  const path: string[] = [];
  let current: PlayTurnArtifact | undefined = head;
  while (current) {
    path.push(current.id);
    current = current.parentTurnId ? byId.get(current.parentTurnId) : undefined;
  }
  return path.reverse();
};

export const createPlayTurnArtifactId = (
  revision: number,
  existingIds: Iterable<string>,
): string => {
  const existing = new Set(existingIds);
  const base = `turn-artifact-${assertNonNegativeInteger(revision, 'revision')}`;
  if (!existing.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
};

export const assertSafePlayTurnArtifactId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error('Invalid Play turn artifact id.');
  }
  return value;
};

const readLegacyWorldTurnNumber = (messageId?: string): number | undefined => {
  const match = /^turn-(\d+)-(?:user|referee)$/u.exec(messageId ?? '');
  if (!match?.[1]) {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
};

const normalizeTranscriptTurn = (
  value: unknown,
  options: {
    allowUnknownFields: boolean;
    requireId: boolean;
  },
): PlayTranscriptTurn => {
  if (!isRecord(value)) {
    throw new Error('Stored Play turn message must be an object.');
  }
  if (!options.allowUnknownFields) {
    assertOnlyKnownFields(value, [
      'id',
      'speaker',
      'content',
      'createdAt',
      'actionKind',
    ]);
  }

  const id = value.id === undefined
    ? undefined
    : assertSafePlayFactReferenceId(value.id, 'messages[].id');
  if (options.requireId && !id) {
    throw new Error('Stored Play turn artifact requires messages[].id.');
  }
  const actionKind = value.actionKind === undefined
    ? undefined
    : normalizeActionKind(value.actionKind);

  return {
    ...(id ? { id } : {}),
    speaker: normalizeRequiredString(value.speaker, 'speaker'),
    content: normalizeRequiredString(value.content, 'content'),
    createdAt: normalizeRequiredString(value.createdAt, 'createdAt'),
    ...(actionKind ? { actionKind } : {}),
  };
};

const cloneTranscriptTurn = (turn: PlayTranscriptTurn): PlayTranscriptTurn => ({
  ...turn,
});

const normalizeActionKind = (value: unknown): PlayActionKind => {
  if (
    value !== 'say' &&
    value !== 'look' &&
    value !== 'move' &&
    value !== 'do' &&
    value !== 'wait'
  ) {
    throw new Error(`Invalid Play action kind: ${String(value)}.`);
  }
  return value;
};

const normalizeWorldClock = (value: Record<string, unknown>): PlayWorldClock => {
  assertOnlyKnownFields(value, ['turn', 'revision', 'anchor', 'elapsed']);
  const anchor = value.anchor === undefined
    ? undefined
    : normalizeRequiredString(value.anchor, 'worldClock.anchor');
  const elapsed = value.elapsed === undefined
    ? undefined
    : normalizeRequiredString(value.elapsed, 'worldClock.elapsed');
  return {
    turn: assertNonNegativeInteger(value.turn, 'worldClock.turn'),
    revision: assertNonNegativeInteger(value.revision, 'worldClock.revision'),
    ...(anchor ? { anchor } : {}),
    ...(elapsed ? { elapsed } : {}),
  };
};

const normalizeVisibilitySnapshot = (
  value: unknown,
  artifactId: string,
): Record<string, PlayEventVisibility> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(
      `Play turn artifact ${artifactId} has invalid playLocalStateVisibilitySnapshot.`,
    );
  }

  return Object.fromEntries(Object.entries(value).map(([key, visibility]) => {
    if (
      visibility !== 'playerVisible' &&
      visibility !== 'rumor' &&
      visibility !== 'playerUnknown'
    ) {
      throw new Error(
        `Play turn artifact ${artifactId} has invalid state visibility for ${key}.`,
      );
    }
    return [key, visibility];
  }));
};

const normalizeRequiredStringList = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Stored Play turn artifact requires ${field}.`);
  }
  const normalized = value.map((item, index) =>
    normalizeRequiredString(item, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Play turn artifact ${field} must not contain duplicates.`);
  }
  return normalized;
};

const normalizeRequiredIdList = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Stored Play turn artifact requires ${field}.`);
  }
  const ids = value.map((item) => assertSafePlayFactReferenceId(item, field));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Play turn artifact ${field} must not contain duplicates.`);
  }
  return ids;
};

const assertSafePlayFactReferenceId = (value: unknown, field: string): string => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error(`Play turn artifact ${field} contains an invalid id.`);
  }
  return value;
};

const normalizeRequiredString = (value: unknown, field: string): string => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`Stored Play turn artifact requires ${field}.`);
  }
  return normalized;
};

const normalizeOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const assertNonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Stored Play turn artifact requires non-negative ${field}.`);
  }
  return value;
};

const assertOnlyKnownFields = (
  value: Record<string, unknown>,
  knownFields: readonly string[],
): void => {
  const known = new Set(knownFields);
  const unknown = Object.keys(value).filter((field) => !known.has(field));
  if (unknown.length) {
    throw new Error(`Play turn artifact contains unknown fields: ${unknown.join(', ')}.`);
  }
};

const indexPlayTurnArtifacts = (
  artifacts: PlayTurnArtifact[],
): Map<string, PlayTurnArtifact> => {
  const byId = new Map<string, PlayTurnArtifact>();
  const messageIds = new Set<string>();

  for (const artifact of artifacts) {
    if (byId.has(artifact.id)) {
      throw new Error(`Play turn artifacts contain duplicate id: ${artifact.id}.`);
    }
    byId.set(artifact.id, artifact);

    for (const message of artifact.messages) {
      if (!message.id) {
        continue;
      }
      if (messageIds.has(message.id)) {
        throw new Error(`Play turn artifacts contain duplicate message id: ${message.id}.`);
      }
      messageIds.add(message.id);
    }
  }

  const roots = artifacts.filter((artifact) => !artifact.parentTurnId);
  if (artifacts.length && roots.length === 0) {
    throw new Error('Play turn artifact graph requires at least one root.');
  }

  for (const artifact of artifacts) {
    if (artifact.parentTurnId && !byId.has(artifact.parentTurnId)) {
      throw new Error(
        `Play turn artifact ${artifact.id} references missing parent: ${artifact.parentTurnId}.`,
      );
    }
    if (artifact.parentTurnId === artifact.id) {
      throw new Error(`Play turn artifact ${artifact.id} cannot parent itself.`);
    }
    if (artifact.parentTurnId) {
      const parent = byId.get(artifact.parentTurnId)!;
      if (artifact.revision <= parent.revision) {
        throw new Error(
          `Play turn artifact ${artifact.id} must advance its parent revision.`,
        );
      }
    }
  }

  for (const artifact of artifacts) {
    const visited = new Set<string>([artifact.id]);
    let current = artifact;
    while (current.parentTurnId) {
      if (visited.has(current.parentTurnId)) {
        throw new Error(`Play turn artifact graph contains a cycle at: ${artifact.id}.`);
      }
      visited.add(current.parentTurnId);
      current = byId.get(current.parentTurnId)!;
    }
  }

  return byId;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
