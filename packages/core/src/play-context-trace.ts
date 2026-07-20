import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

import { assertSafePlayTurnArtifactId } from './play-turn-artifact.js';
import { materializePlayTurnFacts } from './play-session-facts.js';
import type { PlaySession } from './play-session.js';
import type {
  ContextBudgetLayer,
  SemanticBoundary,
} from './agent-context-package.js';
import type { PlaySourceTrust } from './play-types.js';
import type { PlaySourceDriftState } from './play-source-drift.js';

export const PLAY_CONTEXT_TRACE_SCHEMA_VERSION = 1 as const;
export const PLAY_CONTEXT_TRACES_DIRECTORY = 'traces' as const;
export const PLAY_CONTEXT_TRACE_SUFFIX = '.context.yaml' as const;

export type PlayContextWindowKind = 'transcript' | 'event';
export type PlayContextWindowOmissionReason = 'windowLimit';
export type PlayContextSourceOutcome = 'selected' | 'omitted';
export type PlayContextSourceOmissionReason =
  | 'sourceCountLimit'
  | 'excerptCharacterLimit'
  | 'canonicalDrift'
  | 'missing'
  | 'invalid'
  | 'empty'
  | 'notSelected'
  | 'unsafe';

export interface PlayContextWindowTrace {
  kind: PlayContextWindowKind;
  availableCount: number;
  selectedCount: number;
  selectedIds: string[];
  omittedCount: number;
  limit: number;
  omissionReason?: PlayContextWindowOmissionReason;
}

export interface PlayContextSourceTrace {
  sourceId: string;
  path?: string;
  role?: 'chapter' | 'character' | 'world' | 'timeline' | 'state' | 'other';
  trust: PlaySourceTrust;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: SemanticBoundary;
  expectedContentHash?: string;
  actualContentHash?: string;
  driftState?: PlaySourceDriftState;
  outcome: PlayContextSourceOutcome;
  selectedCharacterCount?: number;
  omissionReason?: PlayContextSourceOmissionReason;
}

export interface PlayTurnContextTrace {
  schemaVersion: typeof PLAY_CONTEXT_TRACE_SCHEMA_VERSION;
  sessionId: string;
  sessionRevision: number;
  artifactId: string;
  createdAt: string;
  transcriptWindow: PlayContextWindowTrace;
  eventWindow: PlayContextWindowTrace;
  sources: PlayContextSourceTrace[];
  canonical: false;
}

export interface CreatePlayTurnContextTraceInput {
  session: PlaySession;
  artifactId: string;
  sessionRevision: number;
  createdAt?: string;
  transcriptLimit: number;
  eventLimit: number;
  sources: PlayContextSourceTrace[];
}

export function createPlayTurnContextTrace(
  input: CreatePlayTurnContextTraceInput,
): PlayTurnContextTrace {
  const facts = materializePlayTurnFacts(input.session);
  const selectedEvents = input.session.events.filter((event) =>
    facts.selectedEventIds.has(event.id));
  const transcript = facts.transcript.slice(-input.transcriptLimit);
  const events = selectedEvents.slice(-input.eventLimit);
  return normalizePlayTurnContextTrace({
    schemaVersion: PLAY_CONTEXT_TRACE_SCHEMA_VERSION,
    sessionId: input.session.id,
    sessionRevision: input.sessionRevision,
    artifactId: input.artifactId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    transcriptWindow: createWindowTrace(
      'transcript',
      facts.transcript.length,
      transcript.map((turn, index) =>
        turn.id ?? `transcript-${facts.transcript.length - transcript.length + index + 1}`),
      input.transcriptLimit,
    ),
    eventWindow: createWindowTrace(
      'event',
      selectedEvents.length,
      events.map((event) => event.id),
      input.eventLimit,
    ),
    sources: input.sources,
    canonical: false,
  });
}

export function normalizePlayTurnContextTrace(value: unknown): PlayTurnContextTrace {
  const record = requireRecord(value, 'Play context trace');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'sessionId',
    'sessionRevision',
    'artifactId',
    'createdAt',
    'transcriptWindow',
    'eventWindow',
    'sources',
    'canonical',
  ], 'Play context trace');
  if (record.schemaVersion !== PLAY_CONTEXT_TRACE_SCHEMA_VERSION) {
    throw new Error('Unsupported Play context trace schemaVersion.');
  }
  if (record.canonical !== false) {
    throw new Error('Play context trace must remain non-canonical.');
  }
  if (!Array.isArray(record.sources)) {
    throw new Error('Play context trace sources must be an array.');
  }
  const transcriptWindow = normalizeWindow(record.transcriptWindow, 'transcript');
  const eventWindow = normalizeWindow(record.eventWindow, 'event');
  const sources = record.sources.map(normalizeSourceTrace);
  assertUnique(sources.map((source) => source.sourceId), 'Play context source id');

  return {
    schemaVersion: PLAY_CONTEXT_TRACE_SCHEMA_VERSION,
    sessionId: assertSafeId(record.sessionId, 'Play context trace sessionId'),
    sessionRevision: requireNonNegativeInteger(
      record.sessionRevision,
      'Play context trace sessionRevision',
    ),
    artifactId: assertSafePlayTurnArtifactId(
      requireString(record.artifactId, 'Play context trace artifactId'),
    ),
    createdAt: requireIsoTimestamp(record.createdAt, 'Play context trace createdAt'),
    transcriptWindow,
    eventWindow,
    sources,
    canonical: false,
  };
}

export function resolvePlayContextTracePath(
  workspaceRoot: string,
  sessionId: string,
  artifactId: string,
): string {
  const safeSessionId = assertSafeId(sessionId, 'Play context trace sessionId');
  const safeArtifactId = assertSafePlayTurnArtifactId(artifactId);
  const workspace = resolve(workspaceRoot);
  const path = resolve(
    workspace,
    '.workspace',
    'play-sessions',
    safeSessionId,
    PLAY_CONTEXT_TRACES_DIRECTORY,
    `${safeArtifactId}${PLAY_CONTEXT_TRACE_SUFFIX}`,
  );
  assertPathWithin(workspace, path);
  return path;
}

export async function listPlayContextTraces(
  workspaceRoot: string,
  sessionId: string,
  options: { limit?: number } = {},
): Promise<PlayTurnContextTrace[]> {
  const safeSessionId = assertSafeId(sessionId, 'Play context trace sessionId');
  const limit = options.limit === undefined
    ? 20
    : requirePositiveInteger(options.limit, 'Play context trace limit', 100);
  const directory = dirname(resolvePlayContextTracePath(
    workspaceRoot,
    safeSessionId,
    'trace-placeholder',
  ));
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const traces = await Promise.all(entries
      .filter((entry) =>
        entry.isFile() && entry.name.endsWith(PLAY_CONTEXT_TRACE_SUFFIX))
      .map(async (entry) => {
        const artifactId = assertSafePlayTurnArtifactId(
          entry.name.slice(0, -PLAY_CONTEXT_TRACE_SUFFIX.length),
        );
        const trace = normalizePlayTurnContextTrace(
          parse(await readFile(join(directory, entry.name), 'utf-8')),
        );
        if (trace.sessionId !== safeSessionId || trace.artifactId !== artifactId) {
          throw new Error(`Play context trace identity does not match: ${entry.name}.`);
        }
        return trace;
      }));
    return traces
      .sort((left, right) =>
        right.sessionRevision - left.sessionRevision ||
        right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** @internal Called only while the session sibling stage is being assembled. */
export async function writePlayContextTraceToStage(
  stageRoot: string,
  trace: PlayTurnContextTrace,
): Promise<string> {
  const normalized = normalizePlayTurnContextTrace(trace);
  const path = resolve(
    stageRoot,
    PLAY_CONTEXT_TRACES_DIRECTORY,
    `${normalized.artifactId}${PLAY_CONTEXT_TRACE_SUFFIX}`,
  );
  assertPathWithin(resolve(stageRoot), path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stringify(normalized).trimEnd()}\n`, 'utf-8');
  return path;
}

function createWindowTrace(
  kind: PlayContextWindowKind,
  availableCount: number,
  selectedIds: string[],
  limit: number,
): PlayContextWindowTrace {
  requirePositiveInteger(limit, `Play ${kind} context limit`, 10_000);
  const omittedCount = availableCount - selectedIds.length;
  return {
    kind,
    availableCount,
    selectedCount: selectedIds.length,
    selectedIds,
    omittedCount,
    limit,
    ...(omittedCount > 0 ? { omissionReason: 'windowLimit' as const } : {}),
  };
}

function normalizeWindow(
  value: unknown,
  expectedKind: PlayContextWindowKind,
): PlayContextWindowTrace {
  const record = requireRecord(value, `Play ${expectedKind} context window`);
  assertOnlyKnownFields(record, [
    'kind',
    'availableCount',
    'selectedCount',
    'selectedIds',
    'omittedCount',
    'limit',
    'omissionReason',
  ], `Play ${expectedKind} context window`);
  if (record.kind !== expectedKind) {
    throw new Error(`Play context window must be ${expectedKind}.`);
  }
  if (!Array.isArray(record.selectedIds) ||
      !record.selectedIds.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error('Play context window selectedIds must be non-empty strings.');
  }
  const availableCount = requireNonNegativeInteger(
    record.availableCount,
    'Play context availableCount',
  );
  const selectedCount = requireNonNegativeInteger(
    record.selectedCount,
    'Play context selectedCount',
  );
  const omittedCount = requireNonNegativeInteger(
    record.omittedCount,
    'Play context omittedCount',
  );
  const limit = requirePositiveInteger(record.limit, 'Play context limit', 10_000);
  if (
    selectedCount !== record.selectedIds.length ||
    availableCount !== selectedCount + omittedCount ||
    selectedCount > limit ||
    (omittedCount > 0) !== (record.omissionReason === 'windowLimit')
  ) {
    throw new Error('Play context window counts or omission reason are inconsistent.');
  }
  return {
    kind: expectedKind,
    availableCount,
    selectedCount,
    selectedIds: [...record.selectedIds] as string[],
    omittedCount,
    limit,
    ...(omittedCount > 0 ? { omissionReason: 'windowLimit' } : {}),
  };
}

function normalizeSourceTrace(value: unknown): PlayContextSourceTrace {
  const record = requireRecord(value, 'Play context source trace');
  assertOnlyKnownFields(record, [
    'sourceId',
    'path',
    'role',
    'trust',
    'budgetLayer',
    'semanticBoundary',
    'expectedContentHash',
    'actualContentHash',
    'driftState',
    'outcome',
    'selectedCharacterCount',
    'omissionReason',
  ], 'Play context source trace');
  const outcome = record.outcome;
  if (outcome !== 'selected' && outcome !== 'omitted') {
    throw new Error('Play context source outcome is invalid.');
  }
  const omissionReason = record.omissionReason;
  const validOmissionReasons: PlayContextSourceOmissionReason[] = [
    'sourceCountLimit',
    'excerptCharacterLimit',
    'canonicalDrift',
    'missing',
    'invalid',
    'empty',
    'notSelected',
    'unsafe',
  ];
  if (
    (outcome === 'selected' && omissionReason !== undefined) ||
    (outcome === 'omitted' && !validOmissionReasons.includes(
      omissionReason as PlayContextSourceOmissionReason,
    ))
  ) {
    throw new Error('Play context source omission reason is inconsistent.');
  }
  const trust = record.trust;
  if (!['canonical', 'interactionHint', 'playLocal', 'modelImprovisation'].includes(
    trust as string,
  )) {
    throw new Error('Play context source trust is invalid.');
  }
  const budgetLayer = record.budgetLayer;
  if (!['L0', 'L1', 'L2', 'L3'].includes(budgetLayer as string)) {
    throw new Error('Play context source budgetLayer is invalid.');
  }
  const semanticBoundary = record.semanticBoundary;
  if (!['protected', 'compressible', 'excluded'].includes(semanticBoundary as string)) {
    throw new Error('Play context source semanticBoundary is invalid.');
  }
  return {
    sourceId: requireString(record.sourceId, 'Play context sourceId'),
    ...(record.path === undefined
      ? {}
      : { path: requireString(record.path, 'Play context source path') }),
    ...(record.role === undefined ? {} : { role: normalizeRole(record.role) }),
    trust: trust as PlaySourceTrust,
    budgetLayer: budgetLayer as ContextBudgetLayer,
    semanticBoundary: semanticBoundary as SemanticBoundary,
    ...(record.expectedContentHash === undefined
      ? {}
      : { expectedContentHash: requireHash(record.expectedContentHash) }),
    ...(record.actualContentHash === undefined
      ? {}
      : { actualContentHash: requireHash(record.actualContentHash) }),
    ...(record.driftState === undefined
      ? {}
      : { driftState: normalizeDriftState(record.driftState) }),
    outcome,
    ...(record.selectedCharacterCount === undefined
      ? {}
      : {
          selectedCharacterCount: requireNonNegativeInteger(
            record.selectedCharacterCount,
            'Play context selectedCharacterCount',
          ),
        }),
    ...(outcome === 'omitted'
      ? { omissionReason: omissionReason as PlayContextSourceOmissionReason }
      : {}),
  };
}

function normalizeDriftState(value: unknown): PlaySourceDriftState {
  if (
    value !== 'current' &&
    value !== 'changed' &&
    value !== 'missing' &&
    value !== 'invalid'
  ) {
    throw new Error('Play context source driftState is invalid.');
  }
  return value;
}

function normalizeRole(value: unknown): NonNullable<PlayContextSourceTrace['role']> {
  const roles: Array<NonNullable<PlayContextSourceTrace['role']>> = [
    'chapter', 'character', 'world', 'timeline', 'state', 'other',
  ];
  if (!roles.includes(value as NonNullable<PlayContextSourceTrace['role']>)) {
    throw new Error('Play context source role is invalid.');
  }
  return value as NonNullable<PlayContextSourceTrace['role']>;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: string[],
  label: string,
): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}.`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function assertSafeId(value: unknown, label: string): string {
  const id = requireString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)) {
    throw new Error(`${label} is invalid.`);
  }
  return id;
}

function requireHash(value: unknown): string {
  const hash = requireString(value, 'Play context source hash');
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error('Play context source hash must be a SHA-256 digest.');
  }
  return hash;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function requirePositiveInteger(value: unknown, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new Error(`${label} must be between 1 and ${max}.`);
  }
  return value as number;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} values must be unique.`);
  }
}

function assertPathWithin(root: string, path: string): void {
  const pathRelative = relative(root, path);
  if (
    pathRelative === '' ||
    pathRelative === '..' ||
    pathRelative.startsWith(`..${sep}`)
  ) {
    throw new Error('Play context trace path must stay inside its root.');
  }
}
