import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

import type { ContextBudgetLayer, SemanticBoundary } from './agent-context-package.js';

export const PLAY_SESSION_FILES = [
  'session.yaml',
  'transcript.md',
  'play-local-state.yaml',
  'activated-sources.yaml',
  'events.yaml',
  'observations.yaml',
  'adoption-candidates.yaml',
] as const;

export const PLAY_SESSION_SCHEMA_VERSION = 2 as const;

export type PlaySessionFile = typeof PLAY_SESSION_FILES[number];

export type PlaySourceTrust = 'canonical' | 'interactionHint' | 'playLocal' | 'modelImprovisation';
export type PlayActionKind = 'say' | 'look' | 'move' | 'do' | 'wait';
export type PlaySimulationMode = 'conversation' | 'reactiveWorld' | 'activeWorld';
export type PlayEventDensity = 'quiet' | 'balanced' | 'volatile';
export type PlayEventVisibility = 'playerVisible' | 'rumor' | 'playerUnknown';
export type PlayEventOrigin =
  | 'player'
  | 'npc'
  | 'faction'
  | 'clock'
  | 'environment'
  | 'worldRule'
  | 'manual';
export type PlayWorldEventKind =
  | 'environmentChanged'
  | 'locationChanged'
  | 'npcActed'
  | 'factionActed'
  | 'arrival'
  | 'departure'
  | 'deadlineAdvanced'
  | 'resourceChanged'
  | 'itemMoved'
  | 'evidenceChanged'
  | 'relationshipChanged'
  | 'informationSpread'
  | 'ruleConsequence'
  | 'manual';

export type PlayAdoptionTarget =
  | 'chapterDraft'
  | 'state'
  | 'timeline'
  | 'foreshadow';

export interface PlayActivatedSource {
  sourceId: string;
  path?: string;
  reason: string;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: SemanticBoundary;
  trust: PlaySourceTrust;
}

export interface PlayTranscriptTurn {
  id?: string;
  speaker: string;
  content: string;
  createdAt: string;
  actionKind?: PlayActionKind;
}

export interface PlayWorldClock {
  turn: number;
  revision: number;
  anchor?: string;
  elapsed?: string;
}

export interface PlayEventPolicy {
  simulationMode: PlaySimulationMode;
  density: PlayEventDensity;
  allowOffscreen: boolean;
  allowHidden: boolean;
  maxExternalEventsPerTurn: number;
}

export interface PlayWorldEventCause {
  reason: string;
  sourceTurnIds?: string[];
  sourceEventIds?: string[];
  triggerId?: string;
  pressureId?: string;
  agendaId?: string;
}

export interface PlayWorldEvent {
  id: string;
  turnId: string;
  sequence: number;
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
  cause: PlayWorldEventCause;
  worldClock: PlayWorldClock;
  createdAt: string;
  canonical: false;
}

export interface PlayWorldRefereeSettlementEvent {
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
  cause: PlayWorldEventCause;
}

export interface PlayWorldRefereeSettlement {
  elapsed?: string;
  worldTimeAnchor?: string;
  events: PlayWorldRefereeSettlementEvent[];
  stateDelta: Record<string, unknown>;
  observations: Array<{ summary: string; evidence: string }>;
  suggestedActions: string[];
}

export interface ParsedPlayWorldRefereeResponse {
  narrative: string;
  settlement: PlayWorldRefereeSettlement;
}

export interface SettlePlayWorldRefereeResponseInput {
  session: PlaySession;
  userText: string;
  actionKind: PlayActionKind;
  refereeResponse: string;
  createdAt?: string;
}

export const DEFAULT_PLAY_EVENT_POLICY: PlayEventPolicy = {
  simulationMode: 'reactiveWorld',
  density: 'balanced',
  allowOffscreen: true,
  allowHidden: true,
  maxExternalEventsPerTurn: 2,
};

export const createDefaultPlayWorldClock = (): PlayWorldClock => ({
  turn: 0,
  revision: 0,
});

export interface PlayObservation {
  id: string;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  sourceTurnIds: string[];
  sourceEventIds: string[];
  canonical: false;
}

export interface PlayAdoptionCandidate {
  id: string;
  target: PlayAdoptionTarget;
  summary: string;
  evidence: string;
  payload?: Record<string, unknown>;
  visibility: PlayEventVisibility;
  sourceObservationIds: string[];
  sourceTurnIds: string[];
  sourceEventIds: string[];
  requiresPendingAction: true;
}

export interface PlaySession {
  schemaVersion: typeof PLAY_SESSION_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  revision: number;
  userPersona?: string;
  sceneStart: string;
  characters: string[];
  transcript: PlayTranscriptTurn[];
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  eventPolicy: PlayEventPolicy;
  events: PlayWorldEvent[];
  suggestedActions: string[];
  activatedSources: PlayActivatedSource[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
}

export interface CreatePlaySessionInput {
  id: string;
  title: string;
  createdAt?: string;
  userPersona?: string;
  sceneStart: string;
  characters: string[];
  activatedSources?: PlayActivatedSource[];
  eventPolicy?: Partial<PlayEventPolicy>;
}

export const createPlaySessionDraft = (
  input: CreatePlaySessionInput,
): PlaySession => ({
  schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
  id: assertSafePlaySessionId(input.id),
  title: input.title,
  createdAt: input.createdAt ?? new Date().toISOString(),
  revision: 0,
  userPersona: input.userPersona,
  sceneStart: input.sceneStart,
  characters: [...input.characters],
  transcript: [],
  playLocalState: {},
  playLocalStateVisibility: {},
  worldClock: createDefaultPlayWorldClock(),
  eventPolicy: normalizePlayEventPolicy(input.eventPolicy),
  events: [],
  suggestedActions: [],
  activatedSources: input.activatedSources?.map(assertActivatedSource) ?? [],
  observations: [],
  adoptionCandidates: [],
});

export const createPlayAdoptionCandidate = (
  input: Omit<
    PlayAdoptionCandidate,
    | 'requiresPendingAction'
    | 'visibility'
    | 'sourceObservationIds'
    | 'sourceTurnIds'
    | 'sourceEventIds'
  > & Partial<Pick<
    PlayAdoptionCandidate,
    | 'visibility'
    | 'sourceObservationIds'
    | 'sourceTurnIds'
    | 'sourceEventIds'
  >>,
): PlayAdoptionCandidate => ({
  ...input,
  visibility: input.visibility ?? 'playerVisible',
  sourceObservationIds: [...(input.sourceObservationIds ?? [])],
  sourceTurnIds: [...(input.sourceTurnIds ?? [])],
  sourceEventIds: [...(input.sourceEventIds ?? [])],
  requiresPendingAction: true,
});

export const resolvePlaySessionPath = (
  workspaceRoot: string,
  sessionId: string,
  file: PlaySessionFile,
): string => {
  assertSafePlaySessionId(sessionId);

  if (!PLAY_SESSION_FILES.includes(file)) {
    throw new Error('Unsupported Play session file.');
  }

  const workspace = resolve(workspaceRoot);
  const filePath = resolve(workspace, '.workspace', 'play-sessions', sessionId, file);
  const fileRelativePath = relative(workspace, filePath);

  if (
    fileRelativePath.startsWith('..') ||
    fileRelativePath === '' ||
    fileRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Play session path must stay inside workspace.');
  }

  return filePath;
};

export const writePlaySessionFiles = async (
  workspaceRoot: string,
  session: PlaySession,
): Promise<string[]> => {
  await recoverPlaySessionDirectory(workspaceRoot, session.id);

  const files: Array<[PlaySessionFile, string]> = [
    ['session.yaml', stringify(formatSessionMetadata(session))],
    ['transcript.md', formatTranscript(session)],
    ['play-local-state.yaml', stringify(session.playLocalState)],
    ['activated-sources.yaml', stringify({ activatedSources: session.activatedSources })],
    ['events.yaml', stringify({ events: session.events })],
    ['observations.yaml', stringify({ observations: session.observations })],
    ['adoption-candidates.yaml', stringify({ adoptionCandidates: session.adoptionCandidates })],
  ];
  const sessionsRoot = resolvePlaySessionsRoot(workspaceRoot);
  const sessionRoot = dirname(resolvePlaySessionPath(
    workspaceRoot,
    session.id,
    'session.yaml',
  ));
  const transactionId = `${Date.now()}-${randomUUID()}`;
  const stageRoot = join(sessionsRoot, `.${session.id}.stage.${transactionId}`);
  const backupRoot = join(sessionsRoot, `.${session.id}.backup.${transactionId}`);

  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(stageRoot, { recursive: false });

  try {
    await Promise.all(files.map(async ([file, content]) => {
      await writeFile(
        join(stageRoot, file),
        content.endsWith('\n') ? content : `${content}\n`,
        'utf-8',
      );
    }));
    await writeFile(join(stageRoot, '.ready'), `${session.revision}\n`, 'utf-8');
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }

  let movedExistingSession = false;
  try {
    await rename(sessionRoot, backupRoot);
    movedExistingSession = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await rm(stageRoot, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    await rename(stageRoot, sessionRoot);
  } catch (error) {
    if (movedExistingSession) {
      await rename(backupRoot, sessionRoot).catch(() => undefined);
    }
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }

  await Promise.all([
    rm(join(sessionRoot, '.ready'), { force: true }).catch(() => undefined),
    movedExistingSession
      ? rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
      : Promise.resolve(),
  ]);

  return files.map(([file]) => resolvePlaySessionPath(workspaceRoot, session.id, file));
};

export const readPlaySessionFiles = async (
  workspaceRoot: string,
  sessionId: string,
): Promise<PlaySession> => {
  await recoverPlaySessionDirectory(workspaceRoot, sessionId);

  const metadata = await readPlayYaml<{
    schemaVersion?: number;
    id: string;
    title: string;
    createdAt: string;
    revision?: number;
    userPersona?: string;
    sceneStart: string;
    characters?: string[];
    transcript?: PlayTranscriptTurn[];
    worldClock?: Partial<PlayWorldClock>;
    eventPolicy?: Partial<PlayEventPolicy>;
    suggestedActions?: string[];
    playLocalStateVisibility?: Record<string, PlayEventVisibility>;
  }>(workspaceRoot, sessionId, 'session.yaml');
  assertSupportedPlaySessionSchemaVersion(metadata.schemaVersion);
  if (metadata.id !== sessionId) {
    throw new Error(`Play session metadata id mismatch: expected ${sessionId}.`);
  }
  const playLocalState = await readPlayYaml<Record<string, unknown>>(
    workspaceRoot,
    sessionId,
    'play-local-state.yaml',
    {},
  );
  const activatedSources = await readPlayYaml<{ activatedSources?: PlayActivatedSource[] }>(
    workspaceRoot,
    sessionId,
    'activated-sources.yaml',
    {},
  );
  const events = await readPlayYaml<{ events?: PlayWorldEvent[] }>(
    workspaceRoot,
    sessionId,
    'events.yaml',
    {},
  );
  const observations = await readPlayYaml<{ observations?: PlayObservation[] }>(
    workspaceRoot,
    sessionId,
    'observations.yaml',
    {},
  );
  const adoptionCandidates = await readPlayYaml<{ adoptionCandidates?: PlayAdoptionCandidate[] }>(
    workspaceRoot,
    sessionId,
    'adoption-candidates.yaml',
    {},
  );

  return {
    schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    id: assertSafePlaySessionId(metadata.id),
    title: metadata.title,
    createdAt: metadata.createdAt,
    revision: normalizeNonNegativeInteger(metadata.revision ?? metadata.worldClock?.revision),
    userPersona: metadata.userPersona,
    sceneStart: metadata.sceneStart,
    characters: metadata.characters ?? [],
    transcript: metadata.transcript ?? [],
    playLocalState,
    playLocalStateVisibility: normalizePlayLocalStateVisibility(
      playLocalState,
      metadata.playLocalStateVisibility,
    ),
    worldClock: normalizePlayWorldClock(
      metadata.worldClock,
      metadata.revision ?? metadata.worldClock?.revision,
    ),
    eventPolicy: normalizePlayEventPolicy(metadata.eventPolicy),
    events: (events.events ?? []).map(assertPlayWorldEvent),
    suggestedActions: normalizeStringList(metadata.suggestedActions, 6),
    activatedSources: (activatedSources.activatedSources ?? []).map(assertActivatedSource),
    observations: (observations.observations ?? []).map(assertPlayObservation),
    adoptionCandidates: (adoptionCandidates.adoptionCandidates ?? [])
      .map(assertPlayAdoptionCandidate),
  };
};

export const listPlaySessions = async (
  workspaceRoot: string,
): Promise<PlaySession[]> => {
  const sessionsRoot = resolvePlaySessionsRoot(workspaceRoot);

  try {
    await recoverPlaySessionsRoot(workspaceRoot);
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => readPlaySessionFiles(workspaceRoot, entry.name)),
    );

    return sessions.toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

export const formatPlayWorldRefereePrompt = (session: PlaySession): string => [
  '# Play Mode World Referee',
  '',
  'Run a roleplay sandbox turn inside the OAN novel world.',
  'Use one world referee with character voice/state modules; do not spawn a multi-agent runtime.',
  'Play-local state and transcript are not canonical truth.',
  'The world is not inert: resolve consequences that follow from time, prior events, NPC intent, and world rules.',
  'Every external event requires a concise causal reason. Do not invent unrelated drama.',
  'Do not call canonical write tools. Return Play-local narrative and settlement only.',
  '',
  `Session: ${session.id}`,
  `Scene start: ${session.sceneStart}`,
  `User persona: ${session.userPersona ?? 'unspecified'}`,
  `Characters: ${session.characters.join(', ') || 'none'}`,
  `Revision: ${session.revision}`,
  `World clock: turn ${session.worldClock.turn}; anchor ${session.worldClock.anchor ?? 'unspecified'}; last elapsed ${session.worldClock.elapsed ?? 'none'}`,
  `World activity: ${session.eventPolicy.simulationMode}/${session.eventPolicy.density}; max external events ${session.eventPolicy.maxExternalEventsPerTurn}`,
  '',
  'Current Play-local state:',
  formatPromptJson(session.playLocalState),
  '',
  'Recent committed transcript:',
  ...(session.transcript.length
    ? session.transcript.slice(-20).map((turn) =>
        `- [${turn.id ?? turn.createdAt}] ${turn.speaker}${turn.actionKind ? `/${turn.actionKind}` : ''}: ${turn.content}`,
      )
    : ['- none']),
  '',
  'Recent world events (referee knowledge; respect visibility in player-facing prose):',
  ...(session.events.length
    ? session.events.slice(-12).map((event) =>
        `- ${event.id} [${event.visibility}/${event.kind}] ${event.summary}; cause: ${event.cause.reason}`,
      )
    : ['- none']),
  '',
  'Activated sources:',
  ...(
    session.activatedSources.length
      ? session.activatedSources.map((source) =>
          `- ${source.sourceId} [${source.trust}/${source.budgetLayer}/${source.semanticBoundary}]: ${source.reason}`,
        )
      : ['- none']
  ),
  '',
  'Output protocol:',
  '1. Write only the player-visible narrative first. Never leak playerUnknown events.',
  '2. End with exactly one fenced `oan-play-settlement` JSON object.',
  '3. The JSON fields are: elapsed, worldTimeAnchor, events, stateDelta, observations, suggestedActions.',
  '4. Each event contains kind, origin, title, summary, visibility, and cause: { reason }.',
  '5. Do not include event ids, turn ids, sequence, timestamps, or canonical flags; the host assigns them.',
  '6. After the turn, observations remain Play-local. Do not adopt them into canon without PendingAction.',
].join('\n');

export const parsePlayWorldRefereeResponse = (
  response: string,
): ParsedPlayWorldRefereeResponse => {
  const normalized = response.trim();
  const match = /```oan-play-settlement\s*([\s\S]*?)```/iu.exec(normalized);

  if (!match) {
    if (!normalized) {
      throw new Error('Play world referee returned an empty response.');
    }

    throw new Error('Play world referee response requires a final oan-play-settlement block.');
  }

  const trailing = normalized.slice((match.index ?? 0) + match[0].length).trim();
  if (trailing) {
    throw new Error('Play settlement must be the final response block.');
  }

  const narrative = normalized.slice(0, match.index).trim();
  if (!narrative) {
    throw new Error('Play world referee response requires player-visible narrative.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]?.trim() ?? '');
  } catch {
    throw new Error('Play settlement must contain valid JSON.');
  }

  return {
    narrative,
    settlement: normalizePlayWorldRefereeSettlement(parsed),
  };
};

export const settlePlayWorldRefereeResponse = (
  input: SettlePlayWorldRefereeResponseInput,
): PlaySession => {
  const userText = input.userText.trim();
  if (!userText) {
    throw new Error('Play turn requires user text.');
  }

  const parsed = parsePlayWorldRefereeResponse(input.refereeResponse);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const revision = input.session.revision + 1;
  const turnId = `turn-${revision}`;
  const userTurnId = `${turnId}-user`;
  const refereeTurnId = `${turnId}-referee`;
  assertSettlementMatchesEventPolicy(input.session, parsed.settlement);
  assertSettlementCauseReferences(
    input.session,
    parsed.settlement,
    userTurnId,
  );
  const worldClock: PlayWorldClock = {
    turn: input.session.worldClock.turn + 1,
    revision,
    ...(parsed.settlement.worldTimeAnchor
      ? { anchor: parsed.settlement.worldTimeAnchor }
      : input.session.worldClock.anchor
        ? { anchor: input.session.worldClock.anchor }
        : {}),
    ...(parsed.settlement.elapsed
      ? { elapsed: parsed.settlement.elapsed }
      : {}),
  };
  const events: PlayWorldEvent[] = parsed.settlement.events.map((event, index) => ({
    id: `${turnId}-event-${index + 1}`,
    turnId: refereeTurnId,
    sequence: index + 1,
    kind: event.kind,
    origin: event.origin,
    title: event.title,
    summary: event.summary,
    visibility: event.visibility,
    cause: materializePlayWorldEventCause(event.cause, userTurnId),
    worldClock: { ...worldClock },
    createdAt,
    canonical: false,
  }));
  const settlementVisibility: PlayEventVisibility = events.some(
    (event) => event.visibility === 'playerUnknown',
  )
    ? 'playerUnknown'
    : events.some((event) => event.visibility === 'rumor')
      ? 'rumor'
      : 'playerVisible';
  const sourceEventIds = events.map((event) => event.id);
  const observations: PlayObservation[] = parsed.settlement.observations.map(
    (observation, index) => ({
      id: `obs-${revision}-${index + 1}`,
      summary: observation.summary,
      evidence: observation.evidence,
      visibility: settlementVisibility,
      sourceTurnIds: [refereeTurnId],
      sourceEventIds,
      canonical: false,
    }),
  );
  const playLocalStateVisibility = {
    ...input.session.playLocalStateVisibility,
  };
  for (const key of Object.keys(parsed.settlement.stateDelta)) {
    playLocalStateVisibility[key] = settlementVisibility;
  }

  return {
    ...input.session,
    schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    revision,
    transcript: [
      ...input.session.transcript,
      {
        id: userTurnId,
        speaker: 'user',
        content: userText,
        createdAt,
        actionKind: input.actionKind,
      },
      {
        id: refereeTurnId,
        speaker: 'world-referee',
        content: parsed.narrative,
        createdAt,
      },
    ],
    playLocalState: {
      ...input.session.playLocalState,
      ...parsed.settlement.stateDelta,
    },
    playLocalStateVisibility,
    worldClock,
    events: [...input.session.events, ...events],
    observations: [...input.session.observations, ...observations],
    suggestedActions: settlementVisibility === 'playerUnknown'
      ? []
      : parsed.settlement.suggestedActions,
  };
};

export const addPlayTranscriptTurn = (
  session: PlaySession,
  turn: PlayTranscriptTurn,
): PlaySession => {
  const next = advancePlaySessionRevision(session);
  return {
    ...next,
    transcript: [...session.transcript, turn],
  };
};

export const addPlayObservation = (
  session: PlaySession,
  observation: PlayObservation,
): PlaySession => {
  const next = advancePlaySessionRevision(session);
  return {
    ...next,
    observations: [...session.observations, observation],
  };
};

export const addPlayAdoptionCandidate = (
  session: PlaySession,
  candidate: PlayAdoptionCandidate,
): PlaySession => {
  const next = advancePlaySessionRevision(session);
  return {
    ...next,
    adoptionCandidates: [...session.adoptionCandidates, candidate],
  };
};

function formatTranscript(session: PlaySession): string {
  return [
    `# ${session.title}`,
    '',
    `Session: ${session.id}`,
    `Created: ${session.createdAt}`,
    `Scene: ${session.sceneStart}`,
    '',
    ...session.transcript.map((turn) => [
      `## ${turn.speaker}`,
      '',
      turn.content,
      '',
      `_${turn.createdAt}_`,
      '',
    ].join('\n')),
  ].join('\n');
}

function formatSessionMetadata(session: PlaySession): Record<string, unknown> {
  return {
    schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    revision: session.revision,
    userPersona: session.userPersona,
    sceneStart: session.sceneStart,
    characters: session.characters,
    transcript: session.transcript,
    playLocalStateVisibility: session.playLocalStateVisibility,
    worldClock: session.worldClock,
    eventPolicy: session.eventPolicy,
    suggestedActions: session.suggestedActions,
  };
}

async function readPlayYaml<T>(
  workspaceRoot: string,
  sessionId: string,
  file: PlaySessionFile,
  fallback?: T,
): Promise<T> {
  try {
    const filePath = resolvePlaySessionPath(workspaceRoot, sessionId, file);
    const parsed = parse(await readFile(filePath, 'utf-8')) as T | undefined;
    return parsed ?? (fallback as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) {
      return fallback;
    }

    throw error;
  }
}

function resolvePlaySessionsRoot(workspaceRoot: string): string {
  const workspace = resolve(workspaceRoot);
  const root = resolve(workspace, '.workspace', 'play-sessions');
  const rootRelativePath = relative(workspace, root);

  if (
    rootRelativePath.startsWith('..') ||
    rootRelativePath === '' ||
    rootRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Play sessions root must stay inside workspace.');
  }

  return root;
}

async function recoverPlaySessionsRoot(workspaceRoot: string): Promise<void> {
  const sessionsRoot = resolvePlaySessionsRoot(workspaceRoot);
  let entries: Dirent[];

  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const interruptedSessionIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sessionId = readTransactionSessionId(entry.name);
    if (sessionId) {
      interruptedSessionIds.add(sessionId);
    }
  }

  await Promise.all(
    [...interruptedSessionIds].map((sessionId) =>
      recoverPlaySessionDirectory(workspaceRoot, sessionId),
    ),
  );
}

async function recoverPlaySessionDirectory(
  workspaceRoot: string,
  sessionId: string,
): Promise<void> {
  assertSafePlaySessionId(sessionId);
  const sessionsRoot = resolvePlaySessionsRoot(workspaceRoot);
  let entries: Dirent[];

  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const sessionRoot = join(sessionsRoot, sessionId);
  const stagePrefix = `.${sessionId}.stage.`;
  const backupPrefix = `.${sessionId}.backup.`;
  const stages = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(stagePrefix))
    .map((entry) => join(sessionsRoot, entry.name))
    .sort();
  const backups = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(backupPrefix))
    .map((entry) => join(sessionsRoot, entry.name))
    .sort();

  if (await pathExists(sessionRoot)) {
    // A stage can belong to an in-flight writer. Only backups are safe to clean
    // once a complete target directory is visible.
    await cleanupPlayTransactionDirectories(backups);
    await rm(join(sessionRoot, '.ready'), { force: true }).catch(() => undefined);
    return;
  }

  const readyStages: string[] = [];
  for (const stage of stages) {
    if (await pathExists(join(stage, '.ready'))) {
      readyStages.push(stage);
    }
  }

  const selectedStage = readyStages.at(-1);
  const selectedBackup = backups.at(-1);
  if (selectedStage) {
    await rename(selectedStage, sessionRoot);
    await rm(join(sessionRoot, '.ready'), { force: true }).catch(() => undefined);
  } else if (selectedBackup) {
    await rename(selectedBackup, sessionRoot);
  }

  await cleanupPlayTransactionDirectories([...stages, ...backups]);
}

async function cleanupPlayTransactionDirectories(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) =>
    rm(path, { recursive: true, force: true }).catch(() => undefined),
  ));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function readTransactionSessionId(name: string): string | undefined {
  const stageIndex = name.lastIndexOf('.stage.');
  const backupIndex = name.lastIndexOf('.backup.');
  const markerIndex = Math.max(stageIndex, backupIndex);

  if (!name.startsWith('.') || markerIndex <= 1) {
    return undefined;
  }

  const sessionId = name.slice(1, markerIndex);
  try {
    return assertSafePlaySessionId(sessionId);
  } catch {
    return undefined;
  }
}

function advancePlaySessionRevision(session: PlaySession): PlaySession {
  const revision = session.revision + 1;
  return {
    ...session,
    revision,
    worldClock: {
      ...session.worldClock,
      revision,
    },
  };
}

const PLAY_SIMULATION_MODES: readonly PlaySimulationMode[] = [
  'conversation',
  'reactiveWorld',
  'activeWorld',
];
const PLAY_EVENT_DENSITIES: readonly PlayEventDensity[] = [
  'quiet',
  'balanced',
  'volatile',
];
const PLAY_EVENT_VISIBILITIES: readonly PlayEventVisibility[] = [
  'playerVisible',
  'rumor',
  'playerUnknown',
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
const PLAY_ADOPTION_TARGETS: readonly PlayAdoptionTarget[] = [
  'chapterDraft',
  'state',
  'timeline',
  'foreshadow',
];

function normalizePlayEventPolicy(
  policy?: Partial<PlayEventPolicy>,
): PlayEventPolicy {
  const simulationMode = PLAY_SIMULATION_MODES.includes(
    policy?.simulationMode as PlaySimulationMode,
  )
    ? policy?.simulationMode as PlaySimulationMode
    : DEFAULT_PLAY_EVENT_POLICY.simulationMode;
  const density = PLAY_EVENT_DENSITIES.includes(policy?.density as PlayEventDensity)
    ? policy?.density as PlayEventDensity
    : DEFAULT_PLAY_EVENT_POLICY.density;
  const configuredMaximum = normalizeNonNegativeInteger(policy?.maxExternalEventsPerTurn);

  return {
    simulationMode,
    density,
    allowOffscreen: typeof policy?.allowOffscreen === 'boolean'
      ? policy.allowOffscreen
      : DEFAULT_PLAY_EVENT_POLICY.allowOffscreen,
    allowHidden: typeof policy?.allowHidden === 'boolean'
      ? policy.allowHidden
      : DEFAULT_PLAY_EVENT_POLICY.allowHidden,
    maxExternalEventsPerTurn: policy?.maxExternalEventsPerTurn === undefined
      ? DEFAULT_PLAY_EVENT_POLICY.maxExternalEventsPerTurn
      : Math.min(configuredMaximum, 6),
  };
}

function normalizePlayWorldClock(
  clock?: Partial<PlayWorldClock>,
  revision?: number,
): PlayWorldClock {
  const normalizedRevision = normalizeNonNegativeInteger(revision ?? clock?.revision);
  const anchor = normalizeOptionalString(clock?.anchor);
  const elapsed = normalizeOptionalString(clock?.elapsed);

  return {
    turn: normalizeNonNegativeInteger(clock?.turn),
    revision: normalizedRevision,
    ...(anchor ? { anchor } : {}),
    ...(elapsed ? { elapsed } : {}),
  };
}

function assertSupportedPlaySessionSchemaVersion(value: unknown): void {
  if (value === undefined || value === 1 || value === PLAY_SESSION_SCHEMA_VERSION) {
    return;
  }

  throw new Error(`Unsupported Play session schemaVersion: ${String(value)}.`);
}

function normalizePlayLocalStateVisibility(
  state: Record<string, unknown>,
  visibility?: Record<string, PlayEventVisibility>,
): Record<string, PlayEventVisibility> {
  return Object.fromEntries(
    Object.keys(state).map((key) => [
      key,
      normalizeEnum(visibility?.[key], PLAY_EVENT_VISIBILITIES) ?? 'playerVisible',
    ]),
  );
}

function normalizePlayWorldRefereeSettlement(value: unknown): PlayWorldRefereeSettlement {
  if (!isRecord(value)) {
    throw new Error('Play settlement must be a JSON object.');
  }

  if (value.events !== undefined && !Array.isArray(value.events)) {
    throw new Error('Play settlement events must be an array.');
  }
  if (value.stateDelta !== undefined && !isRecord(value.stateDelta)) {
    throw new Error('Play settlement stateDelta must be an object.');
  }
  if (value.observations !== undefined && !Array.isArray(value.observations)) {
    throw new Error('Play settlement observations must be an array.');
  }
  if (value.suggestedActions !== undefined && !Array.isArray(value.suggestedActions)) {
    throw new Error('Play settlement suggestedActions must be an array.');
  }

  return {
    ...(normalizeOptionalString(value.elapsed)
      ? { elapsed: normalizeOptionalString(value.elapsed) }
      : {}),
    ...(normalizeOptionalString(value.worldTimeAnchor)
      ? { worldTimeAnchor: normalizeOptionalString(value.worldTimeAnchor) }
      : {}),
    events: (value.events ?? []).map(normalizePlayWorldRefereeEvent),
    stateDelta: isRecord(value.stateDelta) ? { ...value.stateDelta } : {},
    observations: (value.observations ?? []).map(normalizePlayWorldRefereeObservation),
    suggestedActions: normalizeStringList(value.suggestedActions, 6),
  };
}

function assertSettlementMatchesEventPolicy(
  session: PlaySession,
  settlement: PlayWorldRefereeSettlement,
): void {
  if (settlement.events.length > session.eventPolicy.maxExternalEventsPerTurn) {
    throw new Error(
      `Play settlement exceeds the event budget of ${session.eventPolicy.maxExternalEventsPerTurn}.`,
    );
  }

  const hasPlayerUnknownEvent = settlement.events.some(
    (event) => event.visibility === 'playerUnknown',
  );
  if (hasPlayerUnknownEvent && !session.eventPolicy.allowHidden) {
    throw new Error('Play settlement contains a hidden event while hidden events are disabled.');
  }
  if (hasPlayerUnknownEvent && !session.eventPolicy.allowOffscreen) {
    throw new Error('Play settlement contains an offscreen event while offscreen events are disabled.');
  }
}

function assertSettlementCauseReferences(
  session: PlaySession,
  settlement: PlayWorldRefereeSettlement,
  currentUserTurnId: string,
): void {
  const knownTurnIds = new Set(
    session.transcript
      .map((turn) => turn.id)
      .filter((id): id is string => Boolean(id)),
  );
  knownTurnIds.add(currentUserTurnId);
  const knownEventIds = new Set(session.events.map((event) => event.id));

  for (const event of settlement.events) {
    const unknownTurnId = event.cause.sourceTurnIds?.find(
      (turnId) => !knownTurnIds.has(turnId),
    );
    if (unknownTurnId) {
      throw new Error(`Play event cause references an unknown turn: ${unknownTurnId}.`);
    }

    const unknownEventId = event.cause.sourceEventIds?.find(
      (eventId) => !knownEventIds.has(eventId),
    );
    if (unknownEventId) {
      throw new Error(`Play event cause references an unknown event: ${unknownEventId}.`);
    }
  }
}

function materializePlayWorldEventCause(
  cause: PlayWorldEventCause,
  currentUserTurnId: string,
): PlayWorldEventCause {
  const sourceTurnIds = cause.sourceTurnIds?.length
    ? [...cause.sourceTurnIds]
    : undefined;
  const sourceEventIds = cause.sourceEventIds?.length
    ? [...cause.sourceEventIds]
    : undefined;

  return {
    ...cause,
    ...(sourceTurnIds ? { sourceTurnIds } : {}),
    ...(sourceEventIds ? { sourceEventIds } : {}),
    ...(!sourceTurnIds && !sourceEventIds
      ? { sourceTurnIds: [currentUserTurnId] }
      : {}),
  };
}

function normalizePlayWorldRefereeEvent(value: unknown): PlayWorldRefereeSettlementEvent {
  if (!isRecord(value)) {
    throw new Error('Every Play event must be an object.');
  }

  const kind = normalizeEnum(value.kind, PLAY_WORLD_EVENT_KINDS);
  const origin = normalizeEnum(value.origin, PLAY_EVENT_ORIGINS);
  const visibility = normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES);
  const title = normalizeOptionalString(value.title);
  const summary = normalizeOptionalString(value.summary);

  if (!kind || !origin || !visibility || !title || !summary || !isRecord(value.cause)) {
    throw new Error('Every Play event requires kind, origin, title, summary, visibility, and cause.');
  }

  const reason = normalizeOptionalString(value.cause.reason);
  if (!reason) {
    throw new Error('Every Play event cause requires a reason.');
  }

  return {
    kind,
    origin,
    title,
    summary,
    visibility,
    cause: {
      reason,
      ...readOptionalCauseReferences(value.cause),
    },
  };
}

function normalizePlayWorldRefereeObservation(value: unknown): {
  summary: string;
  evidence: string;
} {
  if (!isRecord(value)) {
    throw new Error('Every Play observation must be an object.');
  }

  const summary = normalizeOptionalString(value.summary);
  const evidence = normalizeOptionalString(value.evidence);
  if (!summary || !evidence) {
    throw new Error('Every Play observation requires summary and evidence.');
  }

  return { summary, evidence };
}

function assertPlayWorldEvent(value: PlayWorldEvent): PlayWorldEvent {
  if (!isRecord(value)) {
    throw new Error('Stored Play event must be an object.');
  }

  const draft = normalizePlayWorldRefereeEvent(value);
  const id = normalizeOptionalString(value.id);
  const turnId = normalizeOptionalString(value.turnId);
  const createdAt = normalizeOptionalString(value.createdAt);
  const sequence = normalizeNonNegativeInteger(value.sequence);
  const worldClock = isRecord(value.worldClock)
    ? normalizePlayWorldClock(value.worldClock)
    : undefined;

  if (!id || !turnId || !createdAt || sequence < 1 || !worldClock) {
    throw new Error('Stored Play event requires id, turnId, sequence, worldClock, and createdAt.');
  }

  return {
    id,
    turnId,
    sequence,
    ...draft,
    worldClock,
    createdAt,
    canonical: false,
  };
}

function assertPlayObservation(value: PlayObservation): PlayObservation {
  if (!isRecord(value)) {
    throw new Error('Stored Play observation must be an object.');
  }

  const id = normalizeOptionalString(value.id);
  const summary = normalizeOptionalString(value.summary);
  const evidence = normalizeOptionalString(value.evidence);
  if (!id || !summary || !evidence) {
    throw new Error('Stored Play observation requires id, summary, and evidence.');
  }

  return {
    id,
    summary,
    evidence,
    visibility: normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES)
      ?? 'playerVisible',
    sourceTurnIds: normalizeStringList(value.sourceTurnIds, 24),
    sourceEventIds: normalizeStringList(value.sourceEventIds, 24),
    canonical: false,
  };
}

function assertPlayAdoptionCandidate(
  value: PlayAdoptionCandidate,
): PlayAdoptionCandidate {
  if (!isRecord(value)) {
    throw new Error('Stored Play adoption candidate must be an object.');
  }

  const id = normalizeOptionalString(value.id);
  const target = normalizeEnum(value.target, PLAY_ADOPTION_TARGETS);
  const summary = normalizeOptionalString(value.summary);
  const evidence = normalizeOptionalString(value.evidence);
  if (!id || !target || !summary || !evidence) {
    throw new Error('Stored Play adoption candidate is incomplete.');
  }

  return createPlayAdoptionCandidate({
    id,
    target,
    summary,
    evidence,
    ...(isRecord(value.payload) ? { payload: { ...value.payload } } : {}),
    visibility: normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES)
      ?? 'playerVisible',
    sourceObservationIds: normalizeStringList(value.sourceObservationIds, 24),
    sourceTurnIds: normalizeStringList(value.sourceTurnIds, 24),
    sourceEventIds: normalizeStringList(value.sourceEventIds, 24),
  });
}

function readOptionalCauseReferences(
  cause: Record<string, unknown>,
): Omit<PlayWorldEventCause, 'reason'> {
  const sourceTurnIds = normalizeStringList(cause.sourceTurnIds, 24);
  const sourceEventIds = normalizeStringList(cause.sourceEventIds, 24);
  const triggerId = normalizeOptionalString(cause.triggerId);
  const pressureId = normalizeOptionalString(cause.pressureId);
  const agendaId = normalizeOptionalString(cause.agendaId);

  return {
    ...(sourceTurnIds.length ? { sourceTurnIds } : {}),
    ...(sourceEventIds.length ? { sourceEventIds } : {}),
    ...(triggerId ? { triggerId } : {}),
    ...(pressureId ? { pressureId } : {}),
    ...(agendaId ? { agendaId } : {}),
  };
}

function normalizeEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | undefined {
  return typeof value === 'string' && values.includes(value as T)
    ? value as T
    : undefined;
}

function normalizeStringList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function formatPromptJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertActivatedSource(source: PlayActivatedSource): PlayActivatedSource {
  if (!source.reason.trim()) {
    throw new Error(`Play activated source ${source.sourceId} requires a reason.`);
  }

  return {
    ...source,
    reason: source.reason.trim(),
  };
}

function assertSafePlaySessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
    throw new Error('Invalid Play session id.');
  }

  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    throw new Error('Invalid Play session id.');
  }

  return sessionId;
}
