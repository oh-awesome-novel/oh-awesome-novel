import type { PlaySession } from './play-session.js';
import type { PlayActivatedSource } from './play-types.js';

export const PLAY_SOURCE_DRIFT_RESOLUTION_METADATA_KEY =
  'playSourceDriftResolution' as const;
export const PLAY_SOURCE_DRIFT_RESOLUTION_SCHEMA_VERSION = 1 as const;

export type PlaySourceDriftState = 'current' | 'changed' | 'missing' | 'invalid';
export type PlaySourceDriftOverall = 'current' | 'drifted' | 'unavailable';
export type PlaySourceDriftDecisionKind =
  | 'continueFrozen'
  | 'reassemble'
  | 'fork';

export interface PlaySourceDriftSourceStatus {
  sourceId: string;
  path?: string;
  expectedContentHash?: string;
  actualContentHash?: string;
  state: PlaySourceDriftState;
}

export interface PlaySourceDriftResolution {
  schemaVersion: typeof PLAY_SOURCE_DRIFT_RESOLUTION_SCHEMA_VERSION;
  kind: PlaySourceDriftDecisionKind;
  decidedAt: string;
  sourceSessionId: string;
  sourceRevision: number;
  snapshots: PlaySourceDriftSourceStatus[];
  excludedSourceIds: string[];
  canonical: false;
}

export interface PlaySourceDriftStatus {
  sessionId: string;
  sessionRevision: number;
  overall: PlaySourceDriftOverall;
  sources: PlaySourceDriftSourceStatus[];
  activeResolution?: PlaySourceDriftResolution;
  availableDecisions: PlaySourceDriftDecisionKind[];
  canonical: false;
}

export type PlaySourceDriftDecision =
  | { kind: 'continueFrozen'; baseRevision: number }
  | { kind: 'reassemble'; baseRevision: number }
  | {
      kind: 'fork';
      baseRevision: number;
      newSessionId: string;
      title?: string;
    };

export interface ResolvePlaySourceDriftDecisionInput {
  session: PlaySession;
  status: PlaySourceDriftStatus;
  decision: PlaySourceDriftDecision;
  decidedAt?: string;
}

export interface ResolvePlaySourceDriftDecisionResult {
  session: PlaySession;
  resolution: PlaySourceDriftResolution;
  sourceSessionId: string;
  createdSessionId?: string;
}

export function createPlaySourceDriftStatus(
  session: PlaySession,
  sources: PlaySourceDriftSourceStatus[],
): PlaySourceDriftStatus {
  const normalizedSources = normalizeSourceStatuses(session, sources);
  const unavailable = normalizedSources.some((source) =>
    source.state === 'missing' || source.state === 'invalid');
  const drifted = normalizedSources.some((source) => source.state === 'changed');
  const overall: PlaySourceDriftOverall = unavailable
    ? 'unavailable'
    : drifted
      ? 'drifted'
      : 'current';
  const storedResolution = readPlaySourceDriftResolution(session);
  const activeResolution = storedResolution &&
      isResolutionForStatus(storedResolution, normalizedSources)
    ? storedResolution
    : undefined;
  const canRefresh = normalizedSources.every((source) =>
    source.state === 'current' || source.state === 'changed');

  return {
    sessionId: session.id,
    sessionRevision: session.revision,
    overall,
    sources: normalizedSources,
    ...(activeResolution ? { activeResolution } : {}),
    availableDecisions: overall === 'current'
      ? []
      : [
          'continueFrozen',
          ...(canRefresh ? ['reassemble', 'fork'] as const : []),
        ],
    canonical: false,
  };
}

export function resolvePlaySourceDriftDecision(
  input: ResolvePlaySourceDriftDecisionInput,
): ResolvePlaySourceDriftDecisionResult {
  assertStatusMatchesSession(input.session, input.status);
  if (input.decision.baseRevision !== input.session.revision) {
    throw new Error(
      `Play source drift revision conflict: expected ${input.decision.baseRevision}, current ${input.session.revision}.`,
    );
  }
  if (!input.status.availableDecisions.includes(input.decision.kind)) {
    throw new Error(`Play source drift decision is unavailable: ${input.decision.kind}.`);
  }
  const decidedAt = normalizeTimestamp(input.decidedAt ?? new Date().toISOString());
  const excludedSourceIds = input.decision.kind === 'continueFrozen'
    ? input.status.sources
      .filter((source) => source.state !== 'current')
      .map((source) => source.sourceId)
    : [];
  const resolution: PlaySourceDriftResolution = {
    schemaVersion: PLAY_SOURCE_DRIFT_RESOLUTION_SCHEMA_VERSION,
    kind: input.decision.kind,
    decidedAt,
    sourceSessionId: input.session.id,
    sourceRevision: input.session.revision,
    snapshots: structuredClone(input.status.sources),
    excludedSourceIds,
    canonical: false,
  };
  const activatedSources = input.decision.kind === 'continueFrozen'
    ? structuredClone(input.session.activatedSources)
    : refreshActivatedSources(input.session.activatedSources, input.status.sources);
  const revision = input.session.revision + 1;
  const updated: PlaySession = {
    ...input.session,
    revision,
    activatedSources,
    metadataExtensions: {
      ...structuredClone(input.session.metadataExtensions),
      [PLAY_SOURCE_DRIFT_RESOLUTION_METADATA_KEY]: resolution,
      ...(input.decision.kind === 'fork'
        ? {
            playSourceFork: {
              sourceSessionId: input.session.id,
              sourceRevision: input.session.revision,
              forkedAt: decidedAt,
              canonical: false,
            },
          }
        : {}),
    },
    worldClock: {
      ...input.session.worldClock,
      revision,
    },
  };

  if (input.decision.kind !== 'fork') {
    return {
      session: updated,
      resolution,
      sourceSessionId: input.session.id,
    };
  }

  const newSessionId = assertSafeId(
    input.decision.newSessionId,
    'Play source drift fork session id',
  );
  if (newSessionId === input.session.id) {
    throw new Error('Play source drift fork requires a new session id.');
  }
  const title = input.decision.title === undefined
    ? `${input.session.title} (fork)`
    : normalizeTitle(input.decision.title);
  return {
    session: {
      ...updated,
      id: newSessionId,
      title,
      createdAt: decidedAt,
      // Adoption closures and stored reports are session-identity bound. A
      // source fork preserves Play history but intentionally requires fresh
      // adoption review in the new session instead of carrying stale evidence.
      adoptionCandidates: [],
      ...(updated.sceneRehearsal
        ? {
            sceneRehearsal: {
              ...structuredClone(updated.sceneRehearsal),
              sessionId: newSessionId,
            },
          }
        : {}),
      ...(updated.rehearsalScenes
        ? {
            rehearsalScenes: updated.rehearsalScenes.map((scene) => ({
              ...structuredClone(scene),
              sessionId: newSessionId,
            })),
          }
        : {}),
    },
    resolution,
    sourceSessionId: input.session.id,
    createdSessionId: newSessionId,
  };
}

export function readPlaySourceDriftResolution(
  session: Pick<PlaySession, 'metadataExtensions'>,
): PlaySourceDriftResolution | undefined {
  const value = session.metadataExtensions[PLAY_SOURCE_DRIFT_RESOLUTION_METADATA_KEY];
  if (value === undefined) return undefined;
  const record = requireRecord(value, 'Play source drift resolution');
  const known = [
    'schemaVersion',
    'kind',
    'decidedAt',
    'sourceSessionId',
    'sourceRevision',
    'snapshots',
    'excludedSourceIds',
    'canonical',
  ];
  const unknown = Object.keys(record).find((field) => !known.includes(field));
  if (unknown) {
    throw new Error(`Play source drift resolution contains unknown field: ${unknown}.`);
  }
  if (record.schemaVersion !== PLAY_SOURCE_DRIFT_RESOLUTION_SCHEMA_VERSION) {
    throw new Error('Unsupported Play source drift resolution schemaVersion.');
  }
  if (!['continueFrozen', 'reassemble', 'fork'].includes(record.kind as string)) {
    throw new Error('Play source drift resolution kind is invalid.');
  }
  if (record.canonical !== false) {
    throw new Error('Play source drift resolution must remain non-canonical.');
  }
  if (!Array.isArray(record.snapshots) || !Array.isArray(record.excludedSourceIds)) {
    throw new Error('Play source drift resolution arrays are invalid.');
  }
  const snapshots = record.snapshots.map(normalizeSourceStatus);
  const excludedSourceIds = record.excludedSourceIds.map((sourceId) =>
    normalizeSourceId(sourceId));
  if (new Set(excludedSourceIds).size !== excludedSourceIds.length) {
    throw new Error('Play source drift excluded source ids must be unique.');
  }
  if (excludedSourceIds.some((sourceId) =>
    !snapshots.some((source) => source.sourceId === sourceId))) {
    throw new Error('Play source drift resolution excludes an unknown source.');
  }
  return {
    schemaVersion: PLAY_SOURCE_DRIFT_RESOLUTION_SCHEMA_VERSION,
    kind: record.kind as PlaySourceDriftDecisionKind,
    decidedAt: normalizeTimestamp(record.decidedAt),
    sourceSessionId: assertSafeId(
      record.sourceSessionId,
      'Play source drift sourceSessionId',
    ),
    sourceRevision: requireNonNegativeInteger(
      record.sourceRevision,
      'Play source drift sourceRevision',
    ),
    snapshots,
    excludedSourceIds,
    canonical: false,
  };
}

function normalizeSourceStatuses(
  session: PlaySession,
  values: PlaySourceDriftSourceStatus[],
): PlaySourceDriftSourceStatus[] {
  if (values.length !== session.activatedSources.length) {
    throw new Error('Play source drift status must inspect every activated source.');
  }
  const normalized = values.map(normalizeSourceStatus);
  if (new Set(normalized.map((source) => source.sourceId)).size !== normalized.length) {
    throw new Error('Play source drift source ids must be unique.');
  }
  for (const source of session.activatedSources) {
    const status = normalized.find((candidate) => candidate.sourceId === source.sourceId);
    if (!status) {
      throw new Error(`Play source drift status is missing source: ${source.sourceId}.`);
    }
    if (
      status.path !== source.path ||
      status.expectedContentHash !== source.contentHash
    ) {
      throw new Error(`Play source drift evidence does not match source: ${source.sourceId}.`);
    }
  }
  return normalized;
}

function normalizeSourceStatus(value: unknown): PlaySourceDriftSourceStatus {
  const record = requireRecord(value, 'Play source drift source');
  const known = [
    'sourceId', 'path', 'expectedContentHash', 'actualContentHash', 'state',
  ];
  if (Object.keys(record).some((field) => !known.includes(field))) {
    throw new Error('Play source drift source contains unknown fields.');
  }
  if (!['current', 'changed', 'missing', 'invalid'].includes(record.state as string)) {
    throw new Error('Play source drift source state is invalid.');
  }
  const expectedContentHash = record.expectedContentHash === undefined
    ? undefined
    : normalizeHash(record.expectedContentHash);
  const actualContentHash = record.actualContentHash === undefined
    ? undefined
    : normalizeHash(record.actualContentHash);
  if (
    (record.state === 'current' && expectedContentHash !== actualContentHash) ||
    (record.state === 'changed' &&
      (!expectedContentHash || !actualContentHash || expectedContentHash === actualContentHash)) ||
    ((record.state === 'missing' || record.state === 'invalid') && actualContentHash)
  ) {
    throw new Error('Play source drift source hash evidence is inconsistent.');
  }
  return {
    sourceId: normalizeSourceId(record.sourceId),
    ...(record.path === undefined
      ? {}
      : { path: normalizePath(record.path) }),
    ...(expectedContentHash ? { expectedContentHash } : {}),
    ...(actualContentHash ? { actualContentHash } : {}),
    state: record.state as PlaySourceDriftState,
  };
}

function refreshActivatedSources(
  sources: PlayActivatedSource[],
  statuses: PlaySourceDriftSourceStatus[],
): PlayActivatedSource[] {
  return sources.map((source) => {
    const status = statuses.find((candidate) => candidate.sourceId === source.sourceId)!;
    if (!status.actualContentHash) {
      throw new Error(`Play source cannot be reassembled: ${source.sourceId}.`);
    }
    return {
      ...structuredClone(source),
      contentHash: status.actualContentHash,
    };
  });
}

function assertStatusMatchesSession(
  session: PlaySession,
  status: PlaySourceDriftStatus,
): void {
  if (
    status.sessionId !== session.id ||
    status.sessionRevision !== session.revision ||
    status.canonical !== false
  ) {
    throw new Error('Play source drift status is stale for the session.');
  }
  normalizeSourceStatuses(session, status.sources);
}

function isResolutionForStatus(
  resolution: PlaySourceDriftResolution,
  sources: PlaySourceDriftSourceStatus[],
): boolean {
  return JSON.stringify(resolution.snapshots) === JSON.stringify(sources);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function normalizePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error('Play source drift path is invalid.');
  }
  return value;
}

function normalizeSourceId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 256
  ) {
    throw new Error('Play source drift sourceId is invalid.');
  }
  return value;
}

function normalizeHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Play source drift hash must be a SHA-256 digest.');
  }
  return value;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error('Play source drift decision timestamp is invalid.');
  }
  return value;
}

function normalizeTitle(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 160
  ) {
    throw new Error('Play source drift fork title is invalid.');
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value as number;
}
