import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import {
  createPlayOutcomeReport,
  projectPlayOutcomeReport,
} from './play-outcome.js';
import type { PlayOutcomeItem, PlayOutcomeProjection } from './play-outcome.js';
import { materializePlayTurnFacts } from './play-session-facts.js';
import {
  resolvePlaySessionPath,
  withPlaySessionFileTransaction,
} from './play-session.js';
import type { PlaySession } from './play-session.js';

export const PLAY_SCENE_MEMORY_SCHEMA_VERSION = 1 as const;
export const PLAY_SCENE_MEMORIES_DIRECTORY = 'memories' as const;

export type PlaySceneMemoryStatus = 'current' | 'stale' | 'superseded';
export type PlaySceneMemoryStaleReason =
  | 'sessionRevisionChanged'
  | 'selectedBranchChanged'
  | 'sourceHashesChanged';

export interface PlaySceneMemoryArtifact {
  schemaVersion: typeof PLAY_SCENE_MEMORY_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  sceneId?: string;
  lens: PlayOutcomeProjection;
  throughRevision: number;
  selectedTurnRefs: string[];
  sourceHashes: Record<string, string>;
  items: PlayOutcomeItem[];
  status: PlaySceneMemoryStatus;
  builtAt: string;
  staleReasons?: PlaySceneMemoryStaleReason[];
}

export function rebuildPlaySceneMemory(
  session: PlaySession,
  lens: PlayOutcomeProjection,
  builtAt = new Date().toISOString(),
): PlaySceneMemoryArtifact {
  assertLens(lens);
  const facts = materializePlayTurnFacts(session);
  const report = projectPlayOutcomeReport(
    createPlayOutcomeReport(session, { createdAt: builtAt }),
    lens,
  );
  return normalizePlaySceneMemoryArtifact({
    schemaVersion: PLAY_SCENE_MEMORY_SCHEMA_VERSION,
    id: `scene-memory-${lens}-${session.revision}`,
    sessionId: session.id,
    ...(session.sceneRehearsal
      ? { sceneId: session.sceneRehearsal.activeSceneRef }
      : {}),
    lens,
    throughRevision: session.revision,
    selectedTurnRefs: [...facts.selectedTurnIds],
    sourceHashes: Object.fromEntries(session.activatedSources.flatMap((source) =>
      source.contentHash ? [[source.sourceId, source.contentHash]] : [])),
    items: report.items,
    status: 'current',
    builtAt,
  });
}

export function evaluatePlaySceneMemoryStatus(
  memoryValue: PlaySceneMemoryArtifact,
  session: PlaySession,
): PlaySceneMemoryArtifact {
  const memory = normalizePlaySceneMemoryArtifact(memoryValue);
  if (memory.sessionId !== session.id) {
    throw new Error('Play Scene Memory belongs to another session.');
  }
  const facts = materializePlayTurnFacts(session);
  const staleReasons: PlaySceneMemoryStaleReason[] = [];
  if (memory.throughRevision !== session.revision) {
    staleReasons.push('sessionRevisionChanged');
  }
  if (!isDeepStrictEqual(memory.selectedTurnRefs, facts.selectedTurnIds)) {
    staleReasons.push('selectedBranchChanged');
  }
  const sourceHashes = Object.fromEntries(session.activatedSources.flatMap((source) =>
    source.contentHash ? [[source.sourceId, source.contentHash]] : []));
  if (!isDeepStrictEqual(memory.sourceHashes, sourceHashes)) {
    staleReasons.push('sourceHashesChanged');
  }
  const { staleReasons: _storedStaleReasons, ...base } = memory;
  return staleReasons.length
    ? { ...base, status: 'stale', staleReasons }
    : { ...base, status: 'current' };
}

export function projectPlaySceneMemory(
  memoryValue: PlaySceneMemoryArtifact,
  lens: PlayOutcomeProjection,
): PlaySceneMemoryArtifact {
  const memory = normalizePlaySceneMemoryArtifact(memoryValue);
  assertLens(lens);
  if (memory.lens !== lens) {
    throw new Error('Play Scene Memory must be rebuilt to change projection lens.');
  }
  if (lens === 'director') return structuredClone(memory);
  return {
    ...structuredClone(memory),
    selectedTurnRefs: [],
    sourceHashes: {},
    items: memory.items
      .filter((item) => item.visibility !== 'playerUnknown')
      .map((item) => ({
        ...structuredClone(item),
        artifactTurnRefs: [],
        messageRefs: [],
        eventRefs: [],
        observationRefs: [],
        evidenceRefs: [],
        sourceRefs: [],
        participantRefs: [],
      })),
  };
}

export async function writePlaySceneMemory(
  workspaceRoot: string,
  sessionId: string,
  lens: PlayOutcomeProjection,
  builtAt?: string,
): Promise<PlaySceneMemoryArtifact> {
  return withPlaySessionFileTransaction(workspaceRoot, sessionId, async (transaction) => {
    const session = await transaction.read();
    const memory = rebuildPlaySceneMemory(session, lens, builtAt);
    const path = resolvePlaySceneMemoryPath(workspaceRoot, sessionId, lens);
    await ensureMemoryDirectory(workspaceRoot, dirname(path));
    await writeAtomically(path, stringify(memory));
    return memory;
  });
}

export async function readPlaySceneMemory(
  workspaceRoot: string,
  sessionId: string,
  lens: PlayOutcomeProjection,
): Promise<PlaySceneMemoryArtifact | null> {
  assertLens(lens);
  return withPlaySessionFileTransaction(workspaceRoot, sessionId, async (transaction) => {
    const session = await transaction.read();
    const path = resolvePlaySceneMemoryPath(workspaceRoot, sessionId, lens);
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('Play Scene Memory must be a regular file.');
      }
      const memory = normalizePlaySceneMemoryArtifact(
        parse(await readFile(path, 'utf-8')),
      );
      const evaluated = evaluatePlaySceneMemoryStatus(memory, session);
      if (evaluated.status === 'current') {
        const expected = rebuildPlaySceneMemory(session, lens, memory.builtAt);
        if (!isDeepStrictEqual(evaluated, expected)) {
          throw new Error(
            'Play Scene Memory does not match the selected committed evidence.',
          );
        }
      }
      return evaluated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  });
}

export function normalizePlaySceneMemoryArtifact(
  value: unknown,
): PlaySceneMemoryArtifact {
  const record = requireRecord(value, 'Play Scene Memory');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'id',
    'sessionId',
    'sceneId',
    'lens',
    'throughRevision',
    'selectedTurnRefs',
    'sourceHashes',
    'items',
    'status',
    'builtAt',
    'staleReasons',
  ], 'Play Scene Memory');
  if (record.schemaVersion !== PLAY_SCENE_MEMORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported Play Scene Memory schemaVersion: ${String(record.schemaVersion)}.`);
  }
  const lens = assertLens(record.lens);
  const status = assertStatus(record.status);
  const staleReasons = record.staleReasons === undefined
    ? undefined
    : normalizeStaleReasons(record.staleReasons);
  if ((status === 'stale') !== Boolean(staleReasons?.length)) {
    throw new Error('Play Scene Memory stale status requires staleReasons.');
  }
  const items = requireArray(record.items, 'Play Scene Memory items')
    .map(normalizeMemoryItem);
  assertUnique(items.map((item) => item.id), 'Play Scene Memory item id');
  if (lens === 'player' && items.some((item) =>
    item.visibility === 'playerUnknown' ||
    item.artifactTurnRefs.length > 0 ||
    item.messageRefs.length > 0 ||
    item.eventRefs.length > 0 ||
    item.observationRefs.length > 0 ||
    item.evidenceRefs.length > 0 ||
    item.sourceRefs.length > 0 ||
    item.participantRefs.length > 0
  )) {
    throw new Error('Player Play Scene Memory contains hidden evidence identities.');
  }
  return {
    schemaVersion: PLAY_SCENE_MEMORY_SCHEMA_VERSION,
    id: assertSafeId(record.id, 'Play Scene Memory id'),
    sessionId: assertSafeId(record.sessionId, 'Play Scene Memory sessionId'),
    ...(record.sceneId === undefined
      ? {}
      : { sceneId: assertSafeId(record.sceneId, 'Play Scene Memory sceneId') }),
    lens,
    throughRevision: normalizeNonNegativeInteger(
      record.throughRevision,
      'Play Scene Memory throughRevision',
    ),
    selectedTurnRefs: normalizeIdList(
      record.selectedTurnRefs,
      'Play Scene Memory selectedTurnRefs',
    ),
    sourceHashes: normalizeSourceHashes(record.sourceHashes),
    items,
    status,
    builtAt: normalizeTimestamp(record.builtAt, 'Play Scene Memory builtAt'),
    ...(staleReasons?.length ? { staleReasons } : {}),
  };
}

export function resolvePlaySceneMemoryPath(
  workspaceRoot: string,
  sessionId: string,
  lens: PlayOutcomeProjection,
): string {
  assertLens(lens);
  const sessionRoot = dirname(resolvePlaySessionPath(
    workspaceRoot,
    sessionId,
    'session.yaml',
  ));
  const path = resolve(sessionRoot, PLAY_SCENE_MEMORIES_DIRECTORY, `${lens}.yaml`);
  assertPathInside(sessionRoot, path, 'Play Scene Memory');
  return path;
}

function normalizeMemoryItem(value: unknown): PlayOutcomeItem {
  const record = requireRecord(value, 'Play Scene Memory item');
  const fields = [
    'id', 'kind', 'summary', 'visibility', 'confidence', 'goalStatus', 'tags',
    'artifactTurnRefs', 'messageRefs', 'eventRefs', 'observationRefs',
    'evidenceRefs', 'sourceRefs', 'participantRefs',
  ];
  assertOnlyKnownFields(record, fields, 'Play Scene Memory item');
  const arrays = ['tags', 'artifactTurnRefs', 'messageRefs', 'eventRefs',
    'observationRefs', 'evidenceRefs', 'sourceRefs', 'participantRefs'] as const;
  const normalized = Object.fromEntries(arrays.map((field) => [
    field,
    field === 'tags'
      ? normalizeStringList(record[field], `Play Scene Memory item ${field}`)
      : normalizeIdList(record[field], `Play Scene Memory item ${field}`),
  ]));
  const kinds: PlayOutcomeItem['kind'][] = [
    'sceneSummary',
    'goalAssessment',
    'participantFootprint',
    'worldChange',
    'writingMaterial',
  ];
  const visibilities: PlayOutcomeItem['visibility'][] = [
    'playerVisible',
    'rumor',
    'playerUnknown',
  ];
  const confidences: PlayOutcomeItem['confidence'][] = [
    'confirmed',
    'inferred',
    'authorProvided',
  ];
  const goalStatuses: NonNullable<PlayOutcomeItem['goalStatus']>[] = [
    'reached',
    'partial',
    'missed',
    'changed',
  ];
  const allowedTags: PlayOutcomeItem['tags'][number][] = [
    'goal',
    'divergence',
    'consistency',
    'worldChange',
    'participantFootprint',
    'writingMaterial',
  ];
  if (!kinds.includes(record.kind as PlayOutcomeItem['kind'])) {
    throw new Error(`Invalid Play Scene Memory item kind: ${String(record.kind)}.`);
  }
  if (!visibilities.includes(record.visibility as PlayOutcomeItem['visibility'])) {
    throw new Error(
      `Invalid Play Scene Memory item visibility: ${String(record.visibility)}.`,
    );
  }
  if (!confidences.includes(record.confidence as PlayOutcomeItem['confidence'])) {
    throw new Error(
      `Invalid Play Scene Memory item confidence: ${String(record.confidence)}.`,
    );
  }
  const tags = normalized.tags as string[];
  if (!tags.length || tags.some((tag) =>
    !allowedTags.includes(tag as PlayOutcomeItem['tags'][number]))) {
    throw new Error('Play Scene Memory item tags are invalid.');
  }
  assertUnique(tags, 'Play Scene Memory item tag');
  if (
    (record.kind === 'goalAssessment') !== (record.goalStatus !== undefined) ||
    (record.goalStatus !== undefined &&
      !goalStatuses.includes(record.goalStatus as NonNullable<PlayOutcomeItem['goalStatus']>))
  ) {
    throw new Error('Play Scene Memory goal assessment has invalid goalStatus.');
  }
  return {
    id: assertSafeId(record.id, 'Play Scene Memory item id'),
    kind: record.kind as PlayOutcomeItem['kind'],
    summary: normalizeText(record.summary, 'Play Scene Memory item summary', 20_000),
    visibility: record.visibility as PlayOutcomeItem['visibility'],
    confidence: record.confidence as PlayOutcomeItem['confidence'],
    ...(record.goalStatus === undefined
      ? {}
      : { goalStatus: record.goalStatus as PlayOutcomeItem['goalStatus'] }),
    ...normalized,
    tags: tags as PlayOutcomeItem['tags'],
  } as PlayOutcomeItem;
}

function normalizeSourceHashes(value: unknown): Record<string, string> {
  const record = requireRecord(value, 'Play Scene Memory sourceHashes');
  const normalized: Record<string, string> = {};
  for (const [sourceId, hash] of Object.entries(record)) {
    if (sourceId === '__proto__' || sourceId === 'prototype' || sourceId === 'constructor') {
      throw new Error('Play Scene Memory sourceHashes contains unsafe source identity.');
    }
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash)) {
      throw new Error('Play Scene Memory source hash must be SHA-256.');
    }
    normalized[assertSafeId(sourceId, 'Play Scene Memory source id')] = hash;
  }
  return normalized;
}

function normalizeStaleReasons(value: unknown): PlaySceneMemoryStaleReason[] {
  const allowed: PlaySceneMemoryStaleReason[] = [
    'sessionRevisionChanged',
    'selectedBranchChanged',
    'sourceHashesChanged',
  ];
  const reasons = requireArray(value, 'Play Scene Memory staleReasons').map((item) => {
    if (!allowed.includes(item as PlaySceneMemoryStaleReason)) {
      throw new Error(`Invalid Play Scene Memory stale reason: ${String(item)}.`);
    }
    return item as PlaySceneMemoryStaleReason;
  });
  assertUnique(reasons, 'Play Scene Memory stale reason');
  return reasons;
}

function assertLens(value: unknown): PlayOutcomeProjection {
  if (value !== 'player' && value !== 'director') {
    throw new Error(`Invalid Play Scene Memory lens: ${String(value)}.`);
  }
  return value;
}

function assertStatus(value: unknown): PlaySceneMemoryStatus {
  if (value !== 'current' && value !== 'stale' && value !== 'superseded') {
    throw new Error(`Invalid Play Scene Memory status: ${String(value)}.`);
  }
  return value;
}

async function ensureMemoryDirectory(workspaceRoot: string, path: string): Promise<void> {
  const workspace = resolve(workspaceRoot);
  assertPathInside(workspace, path, 'Play Scene Memory directory');
  await mkdir(path, { recursive: true });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Play Scene Memory directory must be a real directory.');
  }
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, content.endsWith('\n') ? content : `${content}\n`, {
      encoding: 'utf-8',
      flag: 'wx',
    });
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function normalizeIdList(value: unknown, label: string): string[] {
  const ids = normalizeStringList(value, label).map((item) => assertSafeId(item, label));
  assertUnique(ids, label);
  return ids;
}

function normalizeStringList(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item) => normalizeText(item, label, 4_096));
}

function normalizeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${label} must be non-empty text up to ${maximum} characters.`);
  }
  return value.trim();
}

function normalizeTimestamp(value: unknown, label: string): string {
  const timestamp = normalizeText(value, label, 128);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} is invalid.`);
  return timestamp;
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.length > 180
  ) throw new Error(`${label} is invalid.`);
  return value;
}

function assertPathInside(root: string, path: string, label: string): void {
  const candidate = relative(root, path);
  if (!candidate || candidate.startsWith('..') || candidate.includes(`..${sep}`)) {
    throw new Error(`${label} path must stay inside its root.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const known = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !known.has(field));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}
