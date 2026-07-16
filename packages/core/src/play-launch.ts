import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import type {
  PlayEventDensity,
  PlayEventVisibility,
  PlaySimulationMode,
  PlaySourceTrust,
} from './play-types.js';
import type {
  PlaySessionPurpose,
  PlayStartMode,
} from './play-rehearsal.js';
import type {
  ContextBudgetLayer,
  SemanticBoundary,
} from './agent-context-package.js';

export const PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION = 1 as const;
export const PLAY_LAUNCH_SETUP_DIRECTORY = 'play-setups' as const;
export const PLAY_LAUNCH_SETUP_FILE = 'setup.yaml' as const;
export const MAX_PLAY_LAUNCH_SOURCE_BYTES = 1_000_000;
export const MAX_PLAY_LAUNCH_SOURCE_EXCERPT = 2_000;

export type PlayLaunchSourceRole =
  | 'chapter'
  | 'character'
  | 'world'
  | 'timeline'
  | 'state'
  | 'other';

export type PlayLaunchSourceStatus = 'ready' | 'missing' | 'invalid';

export type PlayLaunchDiagnosticCode =
  | 'invalidSource'
  | 'missingSource'
  | 'staleSource'
  | 'sourceTooLarge'
  | 'binarySource'
  | 'participantWithoutCharacterSource'
  | 'participantCharacterMismatch';

export interface PlayLaunchSourceInput {
  sourceId: string;
  path: string;
  role: PlayLaunchSourceRole;
  reason?: string;
}

export interface PlayLaunchSceneValue {
  value: string;
  provenance:
    | { kind: 'sourceBacked'; sourceRefs: string[] }
    | { kind: 'authorProvided'; providedAt: string };
}

export interface PlayLaunchEntryPointInput {
  id: string;
  label: string;
  opening: string;
  sourceRefs: string[];
  location?: PlayLaunchSceneValue;
  worldTime?: PlayLaunchSceneValue;
  atmosphere?: PlayLaunchSceneValue;
  trigger?: PlayLaunchSceneValue;
  objective?: PlayLaunchSceneValue;
  risk?: PlayLaunchSceneValue;
}

export interface PlayLaunchIdentityInput {
  kind: 'player' | 'director';
  persona?: string;
  directorPurpose?: string;
}

export interface PlayLaunchKnowledgeBoundaryInput {
  id: string;
  fact: string;
  visibility: PlayEventVisibility;
  sourceRefs: string[];
}

export interface PlayLaunchParticipantRoleInput {
  participantRef: string;
  displayName: string;
  canonicalCharacterRef?: string;
  sourceRefs: string[];
  position?: string;
  currentGoal?: string;
  initialKnowledge: PlayLaunchKnowledgeBoundaryInput[];
}

export interface PlayLaunchPackagePreviewInput {
  id?: string;
  createdAt?: string;
  title: string;
  purpose: PlaySessionPurpose;
  startMode: Extract<PlayStartMode, 'guided'>;
  simulationMode: PlaySimulationMode;
  density: PlayEventDensity;
  sources: PlayLaunchSourceInput[];
  entryPoint: PlayLaunchEntryPointInput;
  identity: PlayLaunchIdentityInput;
  participantRoles: PlayLaunchParticipantRoleInput[];
}

export interface PlayLaunchSource {
  sourceId: string;
  path: string;
  objectId?: string;
  role: PlayLaunchSourceRole;
  reason: string;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: SemanticBoundary;
  trust: PlaySourceTrust;
  status: PlayLaunchSourceStatus;
  contentHash?: string;
  excerpt?: string;
}

export interface PlayLaunchDiagnostic {
  id: string;
  code: PlayLaunchDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  sourceId?: string;
  path?: string;
  participantRef?: string;
  expectedContentHash?: string;
  actualContentHash?: string;
}

export interface PlayLaunchPackage {
  schemaVersion: typeof PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  title: string;
  purpose: PlaySessionPurpose;
  startMode: Extract<PlayStartMode, 'guided'>;
  eventPolicy: {
    simulationMode: PlaySimulationMode;
    density: PlayEventDensity;
  };
  sourceBase: {
    activatedSources: PlayLaunchSource[];
  };
  entryPoint: PlayLaunchEntryPointInput;
  identity: PlayLaunchIdentityInput;
  participantRoles: PlayLaunchParticipantRoleInput[];
  diagnostics: PlayLaunchDiagnostic[];
  canonical: false;
}

export class PlayLaunchSourceValidationError extends Error {
  readonly name = 'PlayLaunchSourceValidationError';

  constructor(
    message: string,
    readonly diagnostics: PlayLaunchDiagnostic[],
  ) {
    super(message);
  }
}

export async function previewPlayLaunchPackage(
  workspaceRoot: string,
  value: PlayLaunchPackagePreviewInput,
): Promise<PlayLaunchPackage> {
  const input = normalizePlayLaunchPackagePreviewInput(value);
  const sources = await Promise.all(input.sources.map((source, index) =>
    inspectPlayLaunchSource(workspaceRoot, source, index)));
  const diagnostics = sources.flatMap((result) => result.diagnostics);
  const sourceIds = new Set(input.sources.map((source) => source.sourceId));

  for (const participant of input.participantRoles) {
    const characterSources = participant.sourceRefs.flatMap((sourceRef) => {
      const selected = sources.find((source) => source.source.sourceId === sourceRef)?.source;
      return selected?.role === 'character' ? [selected] : [];
    });
    if (
      participant.canonicalCharacterRef &&
      !characterSources.some((source) =>
        source.objectId === participant.canonicalCharacterRef)
    ) {
      diagnostics.push({
        id: `diagnostic-participant-character-${participant.participantRef}`,
        code: 'participantCharacterMismatch',
        severity: 'error',
        message: `${participant.displayName} does not reference a matching canonical character source.`,
        participantRef: participant.participantRef,
      });
    } else if (!participant.canonicalCharacterRef && characterSources.length === 0) {
      diagnostics.push({
        id: `diagnostic-participant-${participant.participantRef}`,
        code: 'participantWithoutCharacterSource',
        severity: 'warning',
        message: `${participant.displayName} has no selected character source and will be treated as author-provided Play context.`,
        participantRef: participant.participantRef,
      });
    }
    assertKnownSourceRefs(participant.sourceRefs, sourceIds, 'participant sourceRefs');
    for (const knowledge of participant.initialKnowledge) {
      assertKnownSourceRefs(
        knowledge.sourceRefs,
        sourceIds,
        'participant knowledge sourceRefs',
      );
    }
  }
  assertKnownSourceRefs(input.entryPoint.sourceRefs, sourceIds, 'entry point sourceRefs');
  for (const field of PLAY_LAUNCH_SCENE_VALUE_FIELDS) {
    const sceneValue = input.entryPoint[field];
    if (sceneValue?.provenance.kind === 'sourceBacked') {
      assertKnownSourceRefs(
        sceneValue.provenance.sourceRefs,
        sourceIds,
        `entry point ${field} sourceRefs`,
      );
    }
  }

  return normalizePlayLaunchPackage({
    schemaVersion: PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION,
    id: input.id ?? `setup-${randomUUID()}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    title: input.title,
    purpose: input.purpose,
    startMode: 'guided',
    eventPolicy: {
      simulationMode: input.simulationMode,
      density: input.density,
    },
    sourceBase: {
      activatedSources: sources.map((result) => result.source),
    },
    entryPoint: input.entryPoint,
    identity: input.identity,
    participantRoles: input.participantRoles,
    diagnostics,
    canonical: false,
  });
}

export async function validatePlayLaunchPackageSources(
  workspaceRoot: string,
  value: PlayLaunchPackage,
): Promise<PlayLaunchDiagnostic[]> {
  const launchPackage = normalizePlayLaunchPackage(value);
  return (await inspectPlayLaunchPackageEvidence(workspaceRoot, launchPackage))
    .diagnostics;
}

export async function writePlayLaunchPackage(
  workspaceRoot: string,
  value: PlayLaunchPackage,
): Promise<string[]> {
  const launchPackage = normalizePlayLaunchPackage(value);
  const inspected = await inspectPlayLaunchPackageEvidence(
    workspaceRoot,
    launchPackage,
  );
  const previewErrors = launchPackage.diagnostics.filter((item) =>
    item.severity === 'error');
  const unavailableDiagnostics = launchPackage.sourceBase.activatedSources
    .filter((source) => source.status !== 'ready')
    .map((source, index): PlayLaunchDiagnostic => ({
      id: `diagnostic-unavailable-${index + 1}`,
      code: source.status === 'missing' ? 'missingSource' : 'invalidSource',
      severity: 'error',
      message: `Play launch source is not ready: ${source.path}`,
      sourceId: source.sourceId,
      path: source.path,
    }));
  const blocking = normalizeDiagnostics([
    ...previewErrors,
    ...unavailableDiagnostics,
    ...inspected.diagnostics,
  ])
    .filter((item) => item.severity === 'error');
  if (blocking.length) {
    throw new PlayLaunchSourceValidationError(
      'Play launch package contains missing, invalid, or stale sources.',
      blocking,
    );
  }

  const setupRoot = resolvePlayLaunchSetupPath(workspaceRoot, launchPackage.id);
  const setupsRoot = dirname(setupRoot);
  const stageRoot = join(setupsRoot, `.${launchPackage.id}.stage.${randomUUID()}`);
  await mkdir(setupsRoot, { recursive: true });
  try {
    await stat(setupRoot);
    throw new Error(`Play launch setup already exists: ${launchPackage.id}.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(stageRoot, { recursive: false });
  try {
    await writeFile(
      join(stageRoot, PLAY_LAUNCH_SETUP_FILE),
      `${stringify(inspected.authoritative).trimEnd()}\n`,
      'utf-8',
    );
    await rename(stageRoot, setupRoot);
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }

  return [relative(resolve(workspaceRoot), join(setupRoot, PLAY_LAUNCH_SETUP_FILE))
    .split(sep)
    .join('/')];
}

async function inspectPlayLaunchPackageEvidence(
  workspaceRoot: string,
  launchPackage: PlayLaunchPackage,
): Promise<{
  authoritative: PlayLaunchPackage;
  diagnostics: PlayLaunchDiagnostic[];
}> {
  const authoritative = await previewPlayLaunchPackage(workspaceRoot, {
    id: launchPackage.id,
    createdAt: launchPackage.createdAt,
    title: launchPackage.title,
    purpose: launchPackage.purpose,
    startMode: 'guided',
    simulationMode: launchPackage.eventPolicy.simulationMode,
    density: launchPackage.eventPolicy.density,
    sources: launchPackage.sourceBase.activatedSources.map((source) => ({
      sourceId: source.sourceId,
      path: source.path,
      role: source.role,
      reason: source.reason,
    })),
    entryPoint: launchPackage.entryPoint,
    identity: launchPackage.identity,
    participantRoles: launchPackage.participantRoles,
  });
  const diagnostics = [...authoritative.diagnostics];

  for (const [index, submitted] of launchPackage.sourceBase.activatedSources.entries()) {
    const current = authoritative.sourceBase.activatedSources[index]!;
    if (isDeepStrictEqual(submitted, current)) continue;

    if (
      submitted.status === 'ready' &&
      current.status === 'ready' &&
      submitted.contentHash !== current.contentHash
    ) {
      diagnostics.push({
        id: `diagnostic-stale-${submitted.sourceId}`,
        code: 'staleSource',
        severity: 'error',
        message: `Source changed after preview: ${submitted.path}`,
        sourceId: submitted.sourceId,
        path: submitted.path,
        expectedContentHash: submitted.contentHash,
        actualContentHash: current.contentHash,
      });
      continue;
    }

    diagnostics.push({
      id: `diagnostic-evidence-${submitted.sourceId}`,
      code: 'invalidSource',
      severity: 'error',
      message: `Submitted source evidence does not match authoritative workspace bytes: ${submitted.path}`,
      sourceId: submitted.sourceId,
      path: submitted.path,
    });
  }

  if (!isDeepStrictEqual(launchPackage.diagnostics, authoritative.diagnostics)) {
    diagnostics.push({
      id: 'diagnostic-evidence-diagnostics',
      code: 'invalidSource',
      severity: 'error',
      message: 'Submitted launch diagnostics do not match the authoritative source inspection.',
    });
  }

  return {
    authoritative,
    diagnostics: normalizeDiagnostics(diagnostics),
  };
}

export async function readPlayLaunchPackage(
  workspaceRoot: string,
  setupId: string,
): Promise<PlayLaunchPackage> {
  const setupRoot = resolvePlayLaunchSetupPath(workspaceRoot, setupId);
  const entries = await readdir(setupRoot, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0]?.name !== PLAY_LAUNCH_SETUP_FILE ||
    !entries[0].isFile()
  ) {
    throw new Error('Play launch setup must contain exactly one setup.yaml file.');
  }
  const launchPackage = normalizePlayLaunchPackage(
    parse(await readFile(join(setupRoot, PLAY_LAUNCH_SETUP_FILE), 'utf-8')),
  );
  if (launchPackage.id !== assertSafePlayLaunchId(setupId, 'setup id')) {
    throw new Error('Play launch setup id does not match its directory identity.');
  }
  return launchPackage;
}

export function resolvePlayLaunchSetupPath(
  workspaceRoot: string,
  setupId: string,
): string {
  const safeId = assertSafePlayLaunchId(setupId, 'setup id');
  const root = resolve(workspaceRoot);
  const setupRoot = resolve(root, '.workspace', PLAY_LAUNCH_SETUP_DIRECTORY, safeId);
  const relativePath = relative(root, setupRoot);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Play launch setup path must stay inside workspace.');
  }
  return setupRoot;
}

export function normalizePlayLaunchPackage(value: unknown): PlayLaunchPackage {
  const record = requireRecord(value, 'Play launch package');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'id',
    'createdAt',
    'title',
    'purpose',
    'startMode',
    'eventPolicy',
    'sourceBase',
    'entryPoint',
    'identity',
    'participantRoles',
    'diagnostics',
    'canonical',
  ], 'Play launch package');
  if (record.schemaVersion !== PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Play launch package schemaVersion: ${String(record.schemaVersion)}.`);
  }
  if (record.canonical !== false) {
    throw new Error('Play launch package must remain non-canonical.');
  }
  const purpose = normalizePurpose(record.purpose);
  const startMode = record.startMode;
  if (startMode !== 'guided') {
    throw new Error('Play launch package startMode must be guided.');
  }
  const eventPolicy = requireRecord(record.eventPolicy, 'Play launch eventPolicy');
  assertOnlyKnownFields(
    eventPolicy,
    ['simulationMode', 'density'],
    'Play launch eventPolicy',
  );
  const sourceBase = requireRecord(record.sourceBase, 'Play launch sourceBase');
  assertOnlyKnownFields(sourceBase, ['activatedSources'], 'Play launch sourceBase');
  if (!Array.isArray(sourceBase.activatedSources)) {
    throw new Error('Play launch sourceBase requires activatedSources.');
  }
  if (
    sourceBase.activatedSources.length === 0 ||
    sourceBase.activatedSources.length > 24
  ) {
    throw new Error('Guided Start requires between 1 and 24 source selections.');
  }
  const sources = sourceBase.activatedSources.map(normalizePlayLaunchSource);
  assertUnique(sources.map((source) => source.sourceId), 'source id');
  assertUnique(sources.map((source) => source.path), 'source path');
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const entryPoint = normalizeEntryPoint(record.entryPoint);
  if (!entryPoint.sourceRefs.length) {
    throw new Error('Guided Start entry point requires at least one source ref.');
  }
  assertKnownSourceRefs(entryPoint.sourceRefs, sourceIds, 'entry point sourceRefs');
  for (const field of PLAY_LAUNCH_SCENE_VALUE_FIELDS) {
    const sceneValue = entryPoint[field];
    if (sceneValue?.provenance.kind === 'sourceBacked') {
      assertKnownSourceRefs(
        sceneValue.provenance.sourceRefs,
        sourceIds,
        `entry point ${field} sourceRefs`,
      );
    }
  }
  const participants = normalizeParticipants(record.participantRoles);
  for (const participant of participants) {
    assertKnownSourceRefs(participant.sourceRefs, sourceIds, 'participant sourceRefs');
    for (const knowledge of participant.initialKnowledge) {
      assertKnownSourceRefs(
        knowledge.sourceRefs,
        sourceIds,
        'participant knowledge sourceRefs',
      );
    }
    if (participant.canonicalCharacterRef) {
      const matchingCharacterSource = participant.sourceRefs.some((sourceRef) => {
        const source = sources.find((item) => item.sourceId === sourceRef);
        return source?.role === 'character' &&
          source.objectId === participant.canonicalCharacterRef;
      });
      if (!matchingCharacterSource) {
        throw new Error(
          `Play participant ${participant.participantRef} lacks its canonical character source.`,
        );
      }
    }
  }
  if (purpose === 'sceneRehearsal' && participants.length === 0) {
    throw new Error('Guided Scene Rehearsal requires at least one participant.');
  }
  const identity = normalizeIdentity(record.identity);
  assertIdentityMatchesPurpose(purpose, identity);
  const diagnostics = normalizeDiagnostics(record.diagnostics);
  const participantRefs = new Set(participants.map((item) => item.participantRef));
  for (const diagnostic of diagnostics) {
    if (diagnostic.sourceId && !sourceIds.has(diagnostic.sourceId)) {
      throw new Error(
        `Play launch diagnostic references unknown source: ${diagnostic.sourceId}.`,
      );
    }
    if (diagnostic.participantRef && !participantRefs.has(diagnostic.participantRef)) {
      throw new Error(
        `Play launch diagnostic references unknown participant: ${diagnostic.participantRef}.`,
      );
    }
  }

  return {
    schemaVersion: PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION,
    id: assertSafePlayLaunchId(record.id, 'setup id'),
    createdAt: normalizeText(record.createdAt, 'createdAt', 128),
    title: normalizeText(record.title, 'title', 200),
    purpose,
    startMode: 'guided',
    eventPolicy: {
      simulationMode: normalizeSimulationMode(eventPolicy.simulationMode),
      density: normalizeDensity(eventPolicy.density),
    },
    sourceBase: { activatedSources: sources },
    entryPoint,
    identity,
    participantRoles: participants,
    diagnostics,
    canonical: false,
  };
}

function normalizePlayLaunchPackagePreviewInput(
  value: PlayLaunchPackagePreviewInput,
): PlayLaunchPackagePreviewInput {
  const record = requireRecord(value, 'Play launch preview input');
  assertOnlyKnownFields(record, [
    'id',
    'createdAt',
    'title',
    'purpose',
    'startMode',
    'simulationMode',
    'density',
    'sources',
    'entryPoint',
    'identity',
    'participantRoles',
  ], 'Play launch preview input');
  if (record.startMode !== 'guided') {
    throw new Error('Play launch preview startMode must be guided.');
  }
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    throw new Error('Guided Start requires at least one source selection.');
  }
  if (record.sources.length > 24) {
    throw new Error('Guided Start supports at most 24 source selections.');
  }
  const sources = record.sources.map(normalizeSourceInput);
  assertUnique(sources.map((source) => source.sourceId), 'source id');
  assertUnique(sources.map((source) => source.path), 'source path');

  const purpose = normalizePurpose(record.purpose);
  const identity = normalizeIdentity(record.identity);
  assertIdentityMatchesPurpose(purpose, identity);
  const entryPoint = normalizeEntryPoint(record.entryPoint);
  if (!entryPoint.sourceRefs.length) {
    throw new Error('Guided Start entry point requires at least one source ref.');
  }

  return {
    ...(record.id === undefined
      ? {}
      : { id: assertSafePlayLaunchId(record.id, 'setup id') }),
    ...(record.createdAt === undefined
      ? {}
      : { createdAt: normalizeText(record.createdAt, 'createdAt', 128) }),
    title: normalizeText(record.title, 'title', 200),
    purpose,
    startMode: 'guided',
    simulationMode: normalizeSimulationMode(record.simulationMode),
    density: normalizeDensity(record.density),
    sources,
    entryPoint,
    identity,
    participantRoles: normalizeParticipants(record.participantRoles),
  };
}

async function inspectPlayLaunchSource(
  workspaceRoot: string,
  input: PlayLaunchSourceInput,
  index: number,
): Promise<{ source: PlayLaunchSource; diagnostics: PlayLaunchDiagnostic[] }> {
  const source = normalizeSourceInput(input);
  const objectId = deriveObjectId(source.path, source.role);
  const base: Omit<PlayLaunchSource, 'status'> = {
    sourceId: source.sourceId,
    path: source.path,
    ...(objectId ? { objectId } : {}),
    role: source.role,
    reason: source.reason ?? `Guided Start ${source.role} source`,
    budgetLayer: source.role === 'chapter' ? 'L2' : 'L1',
    semanticBoundary: 'compressible',
    trust: 'canonical',
  };
  const diagnosticId = `diagnostic-source-${index + 1}`;

  if (!sourcePathMatchesRole(source.path, source.role)) {
    return invalidSource(
      base,
      diagnosticId,
      'invalidSource',
      `Selected ${source.role} source is outside its canonical domain: ${source.path}`,
    );
  }

  try {
    const filePath = await resolveRealWorkspaceSource(workspaceRoot, source.path);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return invalidSource(base, diagnosticId, 'invalidSource', 'Selected source is not a file.');
    }
    if (fileStat.size > MAX_PLAY_LAUNCH_SOURCE_BYTES) {
      return invalidSource(
        base,
        diagnosticId,
        'sourceTooLarge',
        `Selected source exceeds ${MAX_PLAY_LAUNCH_SOURCE_BYTES} bytes.`,
      );
    }
    const buffer = await readFile(filePath);
    if (buffer.includes(0)) {
      return invalidSource(base, diagnosticId, 'binarySource', 'Selected source is not plain text.');
    }
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return invalidSource(base, diagnosticId, 'binarySource', 'Selected source is not valid UTF-8 text.');
    }
    if (!content.trim()) {
      return invalidSource(base, diagnosticId, 'invalidSource', 'Selected source is empty.');
    }
    return {
      source: {
        ...base,
        status: 'ready',
        contentHash: createHash('sha256').update(buffer).digest('hex'),
        excerpt: normalizeExcerpt(content),
      },
      diagnostics: [],
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return invalidSource(
      base,
      diagnosticId,
      missing ? 'missingSource' : 'invalidSource',
      missing
        ? `Selected source is missing: ${source.path}`
        : `Selected source is unavailable or unsafe: ${source.path}`,
      missing ? 'missing' : 'invalid',
    );
  }
}

function invalidSource(
  source: Omit<PlayLaunchSource, 'status'>,
  diagnosticId: string,
  code: PlayLaunchDiagnosticCode,
  message: string,
  status: Exclude<PlayLaunchSourceStatus, 'ready'> = 'invalid',
): { source: PlayLaunchSource; diagnostics: PlayLaunchDiagnostic[] } {
  return {
    source: { ...source, status },
    diagnostics: [{
      id: diagnosticId,
      code,
      severity: 'error',
      message,
      sourceId: source.sourceId,
      path: source.path,
    }],
  };
}

async function resolveRealWorkspaceSource(
  workspaceRoot: string,
  sourcePath: string,
): Promise<string> {
  const root = resolve(workspaceRoot);
  const normalizedPath = normalizeSourcePath(sourcePath);
  const lexical = resolve(root, normalizedPath);
  const lexicalRelative = relative(root, lexical);
  if (
    lexicalRelative === '..' ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  ) {
    throw new Error('Play launch source must stay inside workspace.');
  }
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(lexical)]);
  const realRelative = relative(realRoot, realFile);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${sep}`) ||
    isAbsolute(realRelative)
  ) {
    throw new Error('Play launch source resolves outside workspace.');
  }
  return realFile;
}

function normalizePlayLaunchSource(value: unknown): PlayLaunchSource {
  const record = requireRecord(value, 'Play launch source');
  assertOnlyKnownFields(record, [
    'sourceId',
    'path',
    'objectId',
    'role',
    'reason',
    'budgetLayer',
    'semanticBoundary',
    'trust',
    'status',
    'contentHash',
    'excerpt',
  ], 'Play launch source');
  const status = normalizeSourceStatus(record.status);
  const contentHash = record.contentHash === undefined
    ? undefined
    : normalizeHash(record.contentHash);
  const excerpt = record.excerpt === undefined
    ? undefined
    : normalizeText(record.excerpt, 'source excerpt', MAX_PLAY_LAUNCH_SOURCE_EXCERPT);
  if (status === 'ready' && (!contentHash || excerpt === undefined)) {
    throw new Error('Ready Play launch source requires contentHash and excerpt.');
  }
  if (status !== 'ready' && (contentHash !== undefined || excerpt !== undefined)) {
    throw new Error('Unavailable Play launch source cannot contain content evidence.');
  }
  return {
    sourceId: assertSafePlayLaunchId(record.sourceId, 'source id'),
    path: normalizeSourcePath(record.path),
    ...(record.objectId === undefined
      ? {}
      : { objectId: normalizeObjectId(record.objectId) }),
    role: normalizeSourceRole(record.role),
    reason: normalizeText(record.reason, 'source reason', 500),
    budgetLayer: normalizeBudgetLayer(record.budgetLayer),
    semanticBoundary: normalizeSemanticBoundary(record.semanticBoundary),
    trust: normalizeSourceTrust(record.trust),
    status,
    ...(contentHash ? { contentHash } : {}),
    ...(excerpt !== undefined ? { excerpt } : {}),
  };
}

function normalizeSourceInput(value: unknown): PlayLaunchSourceInput {
  const record = requireRecord(value, 'Play launch source input');
  assertOnlyKnownFields(
    record,
    ['sourceId', 'path', 'role', 'reason'],
    'Play launch source input',
  );
  return {
    sourceId: assertSafePlayLaunchId(record.sourceId, 'source id'),
    path: normalizeSourcePath(record.path),
    role: normalizeSourceRole(record.role),
    ...(record.reason === undefined
      ? {}
      : { reason: normalizeText(record.reason, 'source reason', 500) }),
  };
}

const PLAY_LAUNCH_SCENE_VALUE_FIELDS = [
  'location',
  'worldTime',
  'atmosphere',
  'trigger',
  'objective',
  'risk',
] as const;

function normalizeEntryPoint(value: unknown): PlayLaunchEntryPointInput {
  const record = requireRecord(value, 'Play launch entry point');
  assertOnlyKnownFields(record, [
    'id',
    'label',
    'opening',
    'sourceRefs',
    ...PLAY_LAUNCH_SCENE_VALUE_FIELDS,
  ], 'Play launch entry point');
  return {
    id: assertSafePlayLaunchId(record.id, 'entry point id'),
    label: normalizeText(record.label, 'entry point label', 200),
    opening: normalizeText(record.opening, 'entry point opening', 12_000),
    sourceRefs: normalizeSafeIdList(record.sourceRefs, 'entry point sourceRefs', 24),
    ...Object.fromEntries(PLAY_LAUNCH_SCENE_VALUE_FIELDS.flatMap((field) =>
      record[field] === undefined
        ? []
        : [[field, normalizeSceneValue(record[field], field)]])),
  } as PlayLaunchEntryPointInput;
}

function normalizeSceneValue(value: unknown, label: string): PlayLaunchSceneValue {
  const record = requireRecord(value, `Play launch ${label}`);
  assertOnlyKnownFields(record, ['value', 'provenance'], `Play launch ${label}`);
  const provenance = requireRecord(
    record.provenance,
    `Play launch ${label} provenance`,
  );
  if (provenance.kind === 'sourceBacked') {
    assertOnlyKnownFields(
      provenance,
      ['kind', 'sourceRefs'],
      `Play launch ${label} provenance`,
    );
    return {
      value: normalizeText(record.value, label, 2_000),
      provenance: {
        kind: 'sourceBacked',
        sourceRefs: normalizeSafeIdList(
          provenance.sourceRefs,
          `${label} sourceRefs`,
          24,
        ),
      },
    };
  }
  if (provenance.kind === 'authorProvided') {
    assertOnlyKnownFields(
      provenance,
      ['kind', 'providedAt'],
      `Play launch ${label} provenance`,
    );
    return {
      value: normalizeText(record.value, label, 2_000),
      provenance: {
        kind: 'authorProvided',
        providedAt: normalizeText(provenance.providedAt, 'providedAt', 128),
      },
    };
  }
  throw new Error(`Play launch ${label} provenance is invalid.`);
}

function normalizeIdentity(value: unknown): PlayLaunchIdentityInput {
  const record = requireRecord(value, 'Play launch identity');
  assertOnlyKnownFields(
    record,
    ['kind', 'persona', 'directorPurpose'],
    'Play launch identity',
  );
  if (record.kind !== 'player' && record.kind !== 'director') {
    throw new Error('Play launch identity kind is invalid.');
  }
  const persona = normalizeOptionalText(record.persona, 'persona', 2_000);
  const directorPurpose = normalizeOptionalText(
    record.directorPurpose,
    'director purpose',
    2_000,
  );
  if (record.kind === 'director' && !directorPurpose) {
    throw new Error('Director Guided Start requires a rehearsal purpose.');
  }
  return {
    kind: record.kind,
    ...(persona ? { persona } : {}),
    ...(directorPurpose ? { directorPurpose } : {}),
  };
}

function normalizeParticipants(value: unknown): PlayLaunchParticipantRoleInput[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error('Play launch participantRoles must contain at most 16 participants.');
  }
  const participants = value.map((item) => {
    const record = requireRecord(item, 'Play launch participant');
    assertOnlyKnownFields(record, [
      'participantRef',
      'displayName',
      'canonicalCharacterRef',
      'sourceRefs',
      'position',
      'currentGoal',
      'initialKnowledge',
    ], 'Play launch participant');
    if (!Array.isArray(record.initialKnowledge) || record.initialKnowledge.length > 32) {
      throw new Error('Play participant initialKnowledge must be an array of at most 32 items.');
    }
    return {
      participantRef: assertSafePlayLaunchId(record.participantRef, 'participant ref'),
      displayName: normalizeText(record.displayName, 'participant name', 200),
      ...(record.canonicalCharacterRef === undefined
        ? {}
        : {
            canonicalCharacterRef: assertSafePlayLaunchId(
              record.canonicalCharacterRef,
              'canonical character ref',
            ),
          }),
      sourceRefs: normalizeSafeIdList(record.sourceRefs, 'participant sourceRefs', 24),
      ...(normalizeOptionalText(record.position, 'participant position', 1_000)
        ? { position: normalizeOptionalText(record.position, 'participant position', 1_000)! }
        : {}),
      ...(normalizeOptionalText(record.currentGoal, 'participant current goal', 2_000)
        ? { currentGoal: normalizeOptionalText(record.currentGoal, 'participant current goal', 2_000)! }
        : {}),
      initialKnowledge: record.initialKnowledge.map(normalizeKnowledgeBoundary),
    };
  });
  assertUnique(participants.map((item) => item.participantRef), 'participant ref');
  assertUnique(
    participants.flatMap((item) => item.initialKnowledge.map((knowledge) => knowledge.id)),
    'knowledge id',
  );
  return participants;
}

function normalizeKnowledgeBoundary(value: unknown): PlayLaunchKnowledgeBoundaryInput {
  const record = requireRecord(value, 'Play launch knowledge boundary');
  assertOnlyKnownFields(
    record,
    ['id', 'fact', 'visibility', 'sourceRefs'],
    'Play launch knowledge boundary',
  );
  return {
    id: assertSafePlayLaunchId(record.id, 'knowledge id'),
    fact: normalizeText(record.fact, 'knowledge fact', 2_000),
    visibility: normalizeVisibility(record.visibility),
    sourceRefs: normalizeSafeIdList(record.sourceRefs, 'knowledge sourceRefs', 24),
  };
}

function normalizeDiagnostics(value: unknown): PlayLaunchDiagnostic[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error('Play launch diagnostics must be an array of at most 128 items.');
  }
  const diagnostics = value.map((item) => {
    const record = requireRecord(item, 'Play launch diagnostic');
    assertOnlyKnownFields(record, [
      'id',
      'code',
      'severity',
      'message',
      'sourceId',
      'path',
      'participantRef',
      'expectedContentHash',
      'actualContentHash',
    ], 'Play launch diagnostic');
    return {
      id: assertSafePlayLaunchId(record.id, 'diagnostic id'),
      code: normalizeDiagnosticCode(record.code),
      severity: normalizeDiagnosticSeverity(record.severity),
      message: normalizeText(record.message, 'diagnostic message', 1_000),
      ...(record.sourceId === undefined
        ? {}
        : { sourceId: assertSafePlayLaunchId(record.sourceId, 'diagnostic source id') }),
      ...(record.path === undefined
        ? {}
        : { path: normalizeSourcePath(record.path) }),
      ...(record.participantRef === undefined
        ? {}
        : {
            participantRef: assertSafePlayLaunchId(
              record.participantRef,
              'diagnostic participant ref',
            ),
          }),
      ...(record.expectedContentHash === undefined
        ? {}
        : { expectedContentHash: normalizeHash(record.expectedContentHash) }),
      ...(record.actualContentHash === undefined
        ? {}
        : { actualContentHash: normalizeHash(record.actualContentHash) }),
    };
  });
  const byId = new Map<string, PlayLaunchDiagnostic>();
  for (const diagnostic of diagnostics) byId.set(diagnostic.id, diagnostic);
  return [...byId.values()].toSorted((left, right) =>
    left.severity.localeCompare(right.severity) || left.id.localeCompare(right.id));
}

function normalizePurpose(value: unknown): PlaySessionPurpose {
  if (value !== 'immersiveJourney' && value !== 'sceneRehearsal') {
    throw new Error('Play launch purpose is invalid.');
  }
  return value;
}

function normalizeSimulationMode(value: unknown): PlaySimulationMode {
  if (value !== 'conversation' && value !== 'reactiveWorld' && value !== 'activeWorld') {
    throw new Error('Play launch simulation mode is invalid.');
  }
  return value;
}

function normalizeDensity(value: unknown): PlayEventDensity {
  if (value !== 'quiet' && value !== 'balanced' && value !== 'volatile') {
    throw new Error('Play launch event density is invalid.');
  }
  return value;
}

function normalizeSourceRole(value: unknown): PlayLaunchSourceRole {
  if (
    value !== 'chapter' &&
    value !== 'character' &&
    value !== 'world' &&
    value !== 'timeline' &&
    value !== 'state' &&
    value !== 'other'
  ) {
    throw new Error('Play launch source role is invalid.');
  }
  return value;
}

function normalizeSourceStatus(value: unknown): PlayLaunchSourceStatus {
  if (value !== 'ready' && value !== 'missing' && value !== 'invalid') {
    throw new Error('Play launch source status is invalid.');
  }
  return value;
}

function normalizeDiagnosticCode(value: unknown): PlayLaunchDiagnosticCode {
  if (
    value !== 'invalidSource' &&
    value !== 'missingSource' &&
    value !== 'staleSource' &&
    value !== 'sourceTooLarge' &&
    value !== 'binarySource' &&
    value !== 'participantWithoutCharacterSource' &&
    value !== 'participantCharacterMismatch'
  ) {
    throw new Error('Play launch diagnostic code is invalid.');
  }
  return value;
}

function normalizeDiagnosticSeverity(value: unknown): 'warning' | 'error' {
  if (value !== 'warning' && value !== 'error') {
    throw new Error('Play launch diagnostic severity is invalid.');
  }
  return value;
}

function normalizeVisibility(value: unknown): PlayEventVisibility {
  if (value !== 'playerVisible' && value !== 'rumor' && value !== 'playerUnknown') {
    throw new Error('Play launch knowledge visibility is invalid.');
  }
  return value;
}

function normalizeBudgetLayer(value: unknown): ContextBudgetLayer {
  if (value !== 'L0' && value !== 'L1' && value !== 'L2' && value !== 'L3') {
    throw new Error('Play launch budget layer is invalid.');
  }
  return value;
}

function normalizeSemanticBoundary(value: unknown): SemanticBoundary {
  if (value !== 'protected' && value !== 'compressible' && value !== 'excluded') {
    throw new Error('Play launch semantic boundary is invalid.');
  }
  return value;
}

function normalizeSourceTrust(value: unknown): PlaySourceTrust {
  if (
    value !== 'canonical' &&
    value !== 'interactionHint' &&
    value !== 'playLocal' &&
    value !== 'modelImprovisation'
  ) {
    throw new Error('Play launch source trust is invalid.');
  }
  return value;
}

function normalizeHash(value: unknown): string {
  const hash = normalizeText(value, 'contentHash', 64);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error('Play launch contentHash must be a SHA-256 hex digest.');
  }
  return hash;
}

function normalizeSourcePath(value: unknown): string {
  const path = normalizeText(value, 'source path', 1_000).replaceAll('\\', '/');
  const parts = path.split('/');
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:\//u.test(path) ||
    parts.some((part) => !part || part === '..' || part.startsWith('.'))
  ) {
    throw new Error('Play launch source path must be a visible workspace-relative path.');
  }
  return path;
}

function deriveObjectId(path: string, role: PlayLaunchSourceRole): string | undefined {
  const parts = path.split('/');
  if (role === 'other') return undefined;
  const root = sourceRoleRoot(role);
  if (!root || parts[0] !== root) return undefined;
  const identityParts = role === 'character'
    ? parts.slice(1, 2)
    : parts.slice(1);
  if (!identityParts.length) return undefined;
  const last = identityParts.at(-1)!;
  identityParts[identityParts.length - 1] = basename(last, extname(last));
  const candidate = identityParts.join('/');
  return normalizeObjectId(candidate);
}

function sourcePathMatchesRole(path: string, role: PlayLaunchSourceRole): boolean {
  const root = sourceRoleRoot(role);
  return root === undefined || path.split('/')[0] === root;
}

function sourceRoleRoot(role: PlayLaunchSourceRole): string | undefined {
  if (role === 'chapter') return 'chapters';
  if (role === 'character') return 'characters';
  if (role === 'world') return 'world';
  if (role === 'timeline') return 'timeline';
  if (role === 'state') return 'state';
  return undefined;
}

function normalizeObjectId(value: unknown): string {
  const objectId = normalizeText(value, 'object id', 300).replaceAll('\\', '/');
  const parts = objectId.split('/');
  if (
    isAbsolute(objectId) ||
    parts.some((part) =>
      !part ||
      part === '..' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part))
  ) {
    throw new Error('Play launch object id is invalid.');
  }
  return objectId;
}

function assertIdentityMatchesPurpose(
  purpose: PlaySessionPurpose,
  identity: PlayLaunchIdentityInput,
): void {
  if (purpose === 'immersiveJourney' && identity.kind !== 'player') {
    throw new Error('Guided Immersive Journey requires a player identity.');
  }
  if (purpose === 'sceneRehearsal' && identity.kind !== 'director') {
    throw new Error('Guided Scene Rehearsal requires a director identity.');
  }
}

function normalizeExcerpt(value: string): string {
  const normalized = value.trim().replace(/\r\n?/gu, '\n');
  return normalized.length > MAX_PLAY_LAUNCH_SOURCE_EXCERPT
    ? `${normalized.slice(0, MAX_PLAY_LAUNCH_SOURCE_EXCERPT - 3)}...`
    : normalized;
}

function assertKnownSourceRefs(
  refs: string[],
  knownSourceIds: Set<string>,
  label: string,
): void {
  const unknown = refs.find((ref) => !knownSourceIds.has(ref));
  if (unknown) {
    throw new Error(`Play launch ${label} references unknown source: ${unknown}.`);
  }
}

function normalizeSafeIdList(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`Play launch ${label} must contain at most ${maximum} refs.`);
  }
  const values = value.map((item) => assertSafePlayLaunchId(item, label));
  assertUnique(values, label);
  return values;
}

function normalizeOptionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeText(value, label, maximum);
}

function normalizeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Play launch ${label} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Play launch ${label} must contain 1-${maximum} characters.`);
  }
  return normalized;
}

function assertSafePlayLaunchId(value: unknown, label: string): string {
  const id = normalizeText(value, label, 200);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) ||
    id.includes('..') ||
    id.includes('/') ||
    id.includes('\\')
  ) {
    throw new Error(`Play launch ${label} is invalid.`);
  }
  return id;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Play launch contains duplicate ${label}.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  known: readonly string[],
  label: string,
): void {
  const allowed = new Set(known);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  }
}
