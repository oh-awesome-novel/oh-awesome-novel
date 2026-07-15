import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import type { ContextBudgetLayer, SemanticBoundary } from './agent-context-package.js';
import { assertSafePlayNarrativePrefix } from './play-narrative-stream.js';
import {
  evaluatePlayDueEvents,
  normalizePlayEventTrigger,
  normalizePlayScheduledEventTemplate,
  normalizePlayScheduledEvents,
} from './play-event-schedule.js';
import type {
  PlayEventTrigger,
  PlayScheduledEvent,
  PlayScheduledEventTemplate,
} from './play-event-schedule.js';
import {
  PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
  assertSafePlayTurnArtifactId,
  createLegacyPlayTurnArtifacts,
  createPlayTurnArtifactId,
  normalizePlayTurnArtifact,
  projectPlayTranscript,
  selectDefaultPlayTurnPath,
} from './play-turn-artifact.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';

export const PLAY_SESSION_FILES = [
  'session.yaml',
  'transcript.md',
  'play-local-state.yaml',
  'activated-sources.yaml',
  'events.yaml',
  'event-schedule.yaml',
  'observations.yaml',
  'adoption-candidates.yaml',
] as const;

export const PLAY_SESSION_SCHEMA_VERSION = 4 as const;
export const PLAY_TURNS_DIRECTORY = 'turns' as const;

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

export interface PlayBranchBaseSnapshot {
  parentTurnId?: string;
  worldClock: PlayWorldClock;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
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
  scheduledEventChanges: PlayWorldRefereeScheduledEventChange[];
  stateDelta: Record<string, unknown>;
  observations: Array<{ summary: string; evidence: string }>;
  suggestedActions: string[];
}

export type PlayWorldRefereeScheduledEventChange =
  | {
      type: 'schedule';
      label: string;
      trigger: PlayEventTrigger;
      template: PlayScheduledEventTemplate;
      reason: string;
      priority?: number;
    }
  | {
      type: 'cancel';
      scheduledEventId: string;
      reason: string;
    }
  | {
      type: 'reschedule';
      scheduledEventId: string;
      trigger: PlayEventTrigger;
      reason: string;
      priority?: number;
    };

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
  turnArtifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  branchSnapshotRequiredFromRevision: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
  metadataExtensions: Record<string, unknown>;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  eventPolicy: PlayEventPolicy;
  events: PlayWorldEvent[];
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
  activatedSources: PlayActivatedSource[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
}

export interface PlaySessionMigrationPreview {
  sessionId: string;
  fromSchemaVersion: 1 | 2 | 3;
  toSchemaVersion: typeof PLAY_SESSION_SCHEMA_VERSION;
  unknownMetadataKeys: string[];
  legacyTranscriptCount: number;
  projectedTurnCount: number;
  generatedTurnIds: string[];
  backupRelativePath: string;
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
  scheduledEvents?: PlayScheduledEvent[];
}

export const createPlaySessionDraft = (
  input: CreatePlaySessionInput,
): PlaySession => {
  const worldClock = createDefaultPlayWorldClock();
  const scheduledEvents = normalizePlayBranchBaseScheduledEvents(
    input.scheduledEvents ?? [],
    worldClock,
  );
  return {
    schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    id: assertSafePlaySessionId(input.id),
    title: input.title,
    createdAt: input.createdAt ?? new Date().toISOString(),
    revision: 0,
    userPersona: input.userPersona,
    sceneStart: input.sceneStart,
    characters: [...input.characters],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { ...worldClock },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: scheduledEvents.map(clonePlayScheduledEvent),
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock,
    eventPolicy: normalizePlayEventPolicy(input.eventPolicy),
    events: [],
    scheduledEvents,
    suggestedActions: [],
    activatedSources: input.activatedSources?.map(assertActivatedSource) ?? [],
    observations: [],
    adoptionCandidates: [],
  };
};

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

export const resolvePlayTurnArtifactPath = (
  workspaceRoot: string,
  sessionId: string,
  artifactId: string,
): string => {
  assertSafePlaySessionId(sessionId);
  const safeArtifactId = assertSafePlayTurnArtifactId(artifactId);
  const sessionRoot = dirname(resolvePlaySessionPath(
    workspaceRoot,
    sessionId,
    'session.yaml',
  ));
  const artifactPath = resolve(
    sessionRoot,
    PLAY_TURNS_DIRECTORY,
    `${safeArtifactId}.yaml`,
  );
  const artifactRelativePath = relative(sessionRoot, artifactPath);

  if (
    artifactRelativePath.startsWith('..') ||
    artifactRelativePath === '' ||
    artifactRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Play turn artifact path must stay inside session.');
  }

  return artifactPath;
};

export const writePlaySessionFiles = async (
  workspaceRoot: string,
  session: PlaySession,
): Promise<string[]> => {
  await recoverPlaySessionDirectory(workspaceRoot, session.id);

  const normalizedObservations = session.observations.map((observation) =>
    assertPlayObservation(observation, { strict: true }));
  const normalizedAdoptionCandidates = session.adoptionCandidates.map((candidate) =>
    assertPlayAdoptionCandidate(candidate, { strict: true }));
  const normalizedSession: PlaySession = {
    ...session,
    observations: normalizedObservations,
    adoptionCandidates: normalizedAdoptionCandidates,
  };
  const normalizedFacts = materializePlayTurnFacts(normalizedSession);
  const revision = resolvePlaySessionRevision(
    normalizedSession,
    normalizedFacts.turnArtifacts,
  );
  const sessionForWrite: PlaySession = {
    ...normalizedSession,
    revision,
    transcript: normalizedFacts.transcript,
    turnArtifacts: normalizedFacts.turnArtifacts,
    selectedTurnIds: normalizedFacts.selectedTurnIds,
    branchBaseSnapshot: normalizedFacts.branchBaseSnapshot,
    scheduledEvents: normalizedFacts.selectedScheduledEvents,
    playLocalState: normalizedFacts.selectedPlayLocalState,
    playLocalStateVisibility: normalizedFacts.selectedPlayLocalStateVisibility,
    suggestedActions: normalizedFacts.selectedSuggestedActions,
    worldClock: {
      ...normalizedSession.worldClock,
      revision,
    },
  };
  const files: Array<[string, string]> = [
    ['session.yaml', stringify(formatSessionMetadata(sessionForWrite))],
    ['transcript.md', formatTranscript(sessionForWrite)],
    ['play-local-state.yaml', stringify(sessionForWrite.playLocalState)],
    ['activated-sources.yaml', stringify({
      activatedSources: sessionForWrite.activatedSources,
    })],
    ['events.yaml', stringify({ events: sessionForWrite.events })],
    ['event-schedule.yaml', stringify({
      scheduledEvents: normalizePlayScheduledEvents(sessionForWrite.scheduledEvents),
    })],
    ['observations.yaml', stringify({ observations: sessionForWrite.observations })],
    ['adoption-candidates.yaml', stringify({
      adoptionCandidates: sessionForWrite.adoptionCandidates,
    })],
    ...sessionForWrite.turnArtifacts.map((artifact) => [
      join(PLAY_TURNS_DIRECTORY, `${assertSafePlayTurnArtifactId(artifact.id)}.yaml`),
      stringify(artifact),
    ] as [string, string]),
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
  const migrationPreview = await readStoredPlaySessionMigrationPreview(sessionRoot);

  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(stageRoot, { recursive: false });

  try {
    await copyPlaySessionMigrationHistory(sessionRoot, stageRoot);
    if (migrationPreview) {
      await writePlaySessionMigrationBackup({
        sessionRoot,
        stageRoot,
        preview: migrationPreview,
      });
    }
    await Promise.all(files.map(async ([file, content]) => {
      await mkdir(dirname(join(stageRoot, file)), { recursive: true });
      await writeFile(
        join(stageRoot, file),
        content.endsWith('\n') ? content : `${content}\n`,
        'utf-8',
      );
    }));
    await writeFile(join(stageRoot, '.ready'), `${sessionForWrite.revision}\n`, 'utf-8');
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

  return files.map(([file]) => join(sessionRoot, file));
};

export const readPlaySessionFiles = async (
  workspaceRoot: string,
  sessionId: string,
): Promise<PlaySession> => {
  await recoverPlaySessionDirectory(workspaceRoot, sessionId);

  const metadata = await readPlayYaml<Record<string, unknown> & {
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
    selectedTurnIds?: string[];
    branchSnapshotRequiredFromRevision?: number;
    branchBaseSnapshot?: unknown;
  }>(workspaceRoot, sessionId, 'session.yaml');
  assertSupportedPlaySessionSchemaVersion(metadata.schemaVersion);
  const sourceSchemaVersion = normalizeStoredPlaySessionSchemaVersion(
    metadata.schemaVersion,
  );
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
  const eventSchedule = await readPlayYaml<{ scheduledEvents?: unknown }>(
    workspaceRoot,
    sessionId,
    'event-schedule.yaml',
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
  const requireStoredVisibility = sourceSchemaVersion === PLAY_SESSION_SCHEMA_VERSION;
  const normalizedEvents = (events.events ?? []).map((event) =>
    assertPlayWorldEvent(event, { strict: requireStoredVisibility }));
  const normalizedScheduledEvents = normalizePlayScheduledEvents(
    eventSchedule.scheduledEvents ?? [],
  );
  const normalizedObservations = (observations.observations ?? []).map((observation) =>
    assertPlayObservation(observation, {
      strict: requireStoredVisibility,
    }));
  const normalizedAdoptionCandidates = (adoptionCandidates.adoptionCandidates ?? [])
    .map((candidate) => assertPlayAdoptionCandidate(candidate, {
      strict: requireStoredVisibility,
    }));
  const usesStructuredTurnArtifacts = sourceSchemaVersion >= 3;
  const turnArtifacts = usesStructuredTurnArtifacts
    ? await readPlayTurnArtifacts(workspaceRoot, sessionId)
    : createLegacyPlayTurnArtifacts({
        transcript: metadata.transcript ?? [],
        events: normalizedEvents,
        observations: normalizedObservations,
      });
  const selectedTurnIds = usesStructuredTurnArtifacts
    ? normalizeSelectedTurnIds(metadata.selectedTurnIds, turnArtifacts)
    : turnArtifacts.map((artifact) => artifact.id);
  const revision = Math.max(
    normalizeNonNegativeInteger(metadata.revision ?? metadata.worldClock?.revision),
    ...turnArtifacts.map((artifact) => artifact.revision),
  );
  const worldClock = normalizePlayWorldClock(metadata.worldClock, revision);
  const sessionPlayLocalStateVisibility = requireStoredVisibility
    ? requireExactPlayLocalStateVisibility(
        playLocalState,
        metadata.playLocalStateVisibility,
        'Play session v4 state visibility',
      )
    : normalizePlayLocalStateVisibility(
        playLocalState,
        metadata.playLocalStateVisibility,
      );
  const sessionSuggestedActions = normalizeStringList(metadata.suggestedActions, 6);
  if (
    sourceSchemaVersion === 3 &&
    turnArtifacts.some((artifact) =>
      artifact.schemaVersion === PLAY_TURN_ARTIFACT_SCHEMA_VERSION)
  ) {
    throw new Error('Play session v3 cannot contain unverifiable v2 branch snapshots.');
  }
  const branchSnapshotRequiredFromRevision =
    sourceSchemaVersion === PLAY_SESSION_SCHEMA_VERSION
      ? requirePlayBranchSnapshotWatermark(
          metadata.branchSnapshotRequiredFromRevision,
        )
      : revision;
  const branchBaseSnapshot = sourceSchemaVersion === PLAY_SESSION_SCHEMA_VERSION
    ? normalizePlayBranchBaseSnapshot(metadata.branchBaseSnapshot)
    : normalizePlayBranchBaseSnapshot({
        ...(selectedTurnIds.at(-1)
          ? { parentTurnId: selectedTurnIds.at(-1) }
          : {}),
        worldClock: { ...worldClock },
        playLocalState: clonePlayLocalState(playLocalState),
        playLocalStateVisibility: { ...sessionPlayLocalStateVisibility },
        scheduledEvents: normalizedScheduledEvents.map(clonePlayScheduledEvent),
        suggestedActions: [...sessionSuggestedActions],
      });
  const validatedFacts = validatePlayTurnFacts({
    turnArtifacts,
    selectedTurnIds,
    events: normalizedEvents,
    scheduledEvents: normalizedScheduledEvents,
    observations: normalizedObservations,
    adoptionCandidates: normalizedAdoptionCandidates,
    currentRevision: revision,
    currentWorldTurn: worldClock.turn,
    sessionWorldClock: worldClock,
    sessionPlayLocalState: playLocalState,
    sessionPlayLocalStateVisibility,
    branchSnapshotRequiredFromRevision,
    branchBaseSnapshot,
    sessionSuggestedActions,
  });
  const transcript = validatedFacts.transcript;

  return {
    schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    id: assertSafePlaySessionId(metadata.id),
    title: metadata.title,
    createdAt: metadata.createdAt,
    revision,
    userPersona: metadata.userPersona,
    sceneStart: metadata.sceneStart,
    characters: metadata.characters ?? [],
    transcript,
    turnArtifacts,
    selectedTurnIds,
    branchSnapshotRequiredFromRevision,
    branchBaseSnapshot,
    metadataExtensions: readPlaySessionMetadataExtensions(metadata),
    playLocalState: validatedFacts.selectedPlayLocalState,
    playLocalStateVisibility: validatedFacts.selectedPlayLocalStateVisibility,
    worldClock,
    eventPolicy: normalizePlayEventPolicy(metadata.eventPolicy),
    events: normalizedEvents,
    scheduledEvents: validatedFacts.selectedScheduledEvents,
    suggestedActions: validatedFacts.selectedSuggestedActions,
    activatedSources: (activatedSources.activatedSources ?? []).map(assertActivatedSource),
    observations: normalizedObservations,
    adoptionCandidates: normalizedAdoptionCandidates,
  };
};

export const previewPlaySessionMigration = async (
  workspaceRoot: string,
  sessionId: string,
): Promise<PlaySessionMigrationPreview | undefined> => {
  await recoverPlaySessionDirectory(workspaceRoot, sessionId);
  const sessionRoot = dirname(resolvePlaySessionPath(
    workspaceRoot,
    sessionId,
    'session.yaml',
  ));
  return readStoredPlaySessionMigrationPreview(sessionRoot);
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

export const evaluatePlaySessionDueEvents = (
  session: PlaySession,
) => {
  const facts = materializePlayTurnFacts(session);
  return evaluatePlayDueEvents({
    scheduledEvents: facts.selectedScheduledEvents,
    currentTurn: session.worldClock.turn,
    nextTurn: session.worldClock.turn + 1,
    playLocalState: facts.selectedPlayLocalState,
    ...(session.worldClock.anchor
      ? { currentWorldTime: session.worldClock.anchor }
      : {}),
  });
};

export const formatPlayWorldRefereePrompt = (session: PlaySession): string => {
  const facts = materializePlayTurnFacts(session);
  const selectedEvents = session.events.filter((event) =>
    facts.selectedEventIds.has(event.id));
  const revision = resolvePlaySessionRevision(session, facts.turnArtifacts);
  const scheduleEvaluation = evaluatePlaySessionDueEvents(session);

  return [
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
    `Revision: ${revision}`,
    `World clock: turn ${session.worldClock.turn}; anchor ${session.worldClock.anchor ?? 'unspecified'}; last elapsed ${session.worldClock.elapsed ?? 'none'}`,
    `World activity: ${session.eventPolicy.simulationMode}/${session.eventPolicy.density}; max external events ${session.eventPolicy.maxExternalEventsPerTurn}`,
    '',
    'Current Play-local state:',
    formatPromptJson(facts.selectedPlayLocalState),
    '',
    'Recent committed transcript:',
    ...(facts.transcript.length
      ? facts.transcript.slice(-20).map((turn) =>
          `- [${turn.id ?? turn.createdAt}] ${turn.speaker}${turn.actionKind ? `/${turn.actionKind}` : ''}: ${turn.content}`,
        )
      : ['- none']),
    '',
    'Recent world events (referee knowledge; respect visibility in player-facing prose):',
    ...(selectedEvents.length
      ? selectedEvents.slice(-12).map((event) =>
          `- ${event.id} [${event.visibility}/${event.kind}] ${event.summary}; cause: ${event.cause.reason}`,
        )
      : ['- none']),
    '',
    'Host-enforced hard-due events for this turn:',
    ...(scheduleEvaluation.dueEvents.length
      ? scheduleEvaluation.dueEvents.map((event) =>
          `- ${event.id} [priority ${event.priority ?? 0}/${event.template.visibility}] ${event.label}: ${event.template.title} — ${event.template.summary}`,
        )
      : ['- none']),
    'Every listed hard-due event must appear exactly once in settlement.events with cause.triggerId set to its id. Hard-due events do not consume the external-event budget.',
    '',
    'Pending scheduled events:',
    ...(scheduleEvaluation.pendingEvents.length
      ? scheduleEvaluation.pendingEvents.slice(0, 20).map((event) =>
          `- ${event.id} [${event.trigger.type}/${event.template.visibility}] ${event.label}`,
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
    '3. The JSON fields are: elapsed, worldTimeAnchor, events, scheduledEventChanges, stateDelta, observations, suggestedActions.',
    '4. Each event contains kind, origin, title, summary, visibility, and cause: { reason }.',
    '5. To create a future consequence, add a scheduledEventChanges item with type schedule, label, trigger, template, reason, and optional priority. To cancel or reschedule a pending item, reference its scheduledEventId and provide a reason.',
    '6. Do not include event ids, turn ids, sequence, timestamps, or canonical flags; the host assigns them.',
    '7. After the turn, observations remain Play-local. Do not adopt them into canon without PendingAction.',
    '8. Player-visible or rumor summaries and observation evidence may describe only perceivable consequences. Keep hidden causal reasoning in event cause and mark truly secret facts playerUnknown.',
  ].join('\n');
};

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
  assertSafePlayNarrativePrefix(narrative);

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
  const existingFacts = materializePlayTurnFacts(input.session);
  const revision = resolvePlaySessionRevision(
    input.session,
    existingFacts.turnArtifacts,
  ) + 1;
  const turnId = `turn-${revision}`;
  const userTurnId = `${turnId}-user`;
  const refereeTurnId = `${turnId}-referee`;
  const scheduleEvaluation = evaluatePlaySessionDueEvents(input.session);
  assertSettlementMatchesEventPolicy(
    input.session,
    parsed.settlement,
    scheduleEvaluation.dueEvents,
  );
  assertSettlementScheduleReferences(
    input.session,
    parsed.settlement,
    scheduleEvaluation.dueEvents,
  );
  assertSettlementCauseReferences(
    existingFacts,
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
  const scheduledEvents = materializePlayScheduledEvents({
    session: input.session,
    settlement: parsed.settlement,
    events,
    revision,
    worldTurn: worldClock.turn,
    refereeTurnId,
  });
  const playLocalStateVisibility = {
    ...existingFacts.selectedPlayLocalStateVisibility,
  };
  for (const key of Object.keys(parsed.settlement.stateDelta)) {
    playLocalStateVisibility[key] = settlementVisibility;
  }
  const playLocalState = mergePlayLocalState(
    existingFacts.selectedPlayLocalState,
    parsed.settlement.stateDelta,
  );
  const suggestedActions = settlementVisibility === 'playerUnknown'
    ? []
    : [...parsed.settlement.suggestedActions];

  const messages: PlayTranscriptTurn[] = [
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
  ];
  const artifactId = createPlayTurnArtifactId(
    revision,
    existingFacts.turnArtifacts.map((artifact) => artifact.id),
  );
  const parentTurnId = existingFacts.selectedTurnIds.at(-1);
  const artifact: PlayTurnArtifact = {
    schemaVersion: PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
    artifactKind: 'worldSettlement',
    branchSnapshotVersion: 1,
    id: artifactId,
    revision,
    ...(parentTurnId ? { parentTurnId } : {}),
    input: {
      kind: input.actionKind,
      raw: userText,
    },
    messages,
    worldClock: { ...worldClock },
    eventIds: events.map((event) => event.id),
    dueScheduledEventIds: scheduleEvaluation.dueEvents.map((event) => event.id),
    scheduledEventIds: scheduledEvents.map((scheduledEvent) => scheduledEvent.id),
    scheduledEventSnapshots: scheduledEvents.map(clonePlayScheduledEvent),
    playLocalStateSnapshot: clonePlayLocalState(playLocalState),
    playLocalStateVisibilitySnapshot: { ...playLocalStateVisibility },
    observationIds: observations.map((observation) => observation.id),
    stateDelta: clonePlayLocalState(parsed.settlement.stateDelta),
    suggestedActions,
    committedAt: createdAt,
    canonical: false,
  };
  const turnArtifacts = [...existingFacts.turnArtifacts, artifact];
  const selectedTurnIds = [...existingFacts.selectedTurnIds, artifact.id];

  return {
    ...input.session,
    schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    revision,
    transcript: projectPlayTranscript(turnArtifacts, selectedTurnIds),
    turnArtifacts,
    selectedTurnIds,
    branchSnapshotRequiredFromRevision:
      input.session.branchSnapshotRequiredFromRevision,
    branchBaseSnapshot: existingFacts.branchBaseSnapshot,
    metadataExtensions: { ...(input.session.metadataExtensions ?? {}) },
    playLocalState,
    playLocalStateVisibility,
    worldClock,
    events: [...input.session.events, ...events],
    scheduledEvents,
    observations: [...input.session.observations, ...observations],
    suggestedActions,
  };
};

export const addPlayTranscriptTurn = (
  session: PlaySession,
  turn: PlayTranscriptTurn,
): PlaySession => {
  if (turn.speaker.trim().toLowerCase() === 'world-referee') {
    throw new Error('world-referee is reserved for host-validated settlements.');
  }
  const existingFacts = materializePlayTurnFacts(session);
  const next = advancePlaySessionRevision(session, existingFacts.turnArtifacts);
  const artifactId = createPlayTurnArtifactId(
    next.revision,
    existingFacts.turnArtifacts.map((artifact) => artifact.id),
  );
  const parentTurnId = existingFacts.selectedTurnIds.at(-1);
  const artifact: PlayTurnArtifact = {
    schemaVersion: PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
    artifactKind: 'transcriptAppend',
    branchSnapshotVersion: 1,
    id: artifactId,
    revision: next.revision,
    ...(parentTurnId ? { parentTurnId } : {}),
    messages: [{
      ...turn,
      id: turn.id ?? `${artifactId}-message-1`,
    }],
    worldClock: { ...next.worldClock },
    eventIds: [],
    dueScheduledEventIds: [],
    scheduledEventIds: existingFacts.selectedScheduledEvents.map((event) => event.id),
    scheduledEventSnapshots: existingFacts.selectedScheduledEvents.map(
      clonePlayScheduledEvent,
    ),
    playLocalStateSnapshot: clonePlayLocalState(
      existingFacts.selectedPlayLocalState,
    ),
    playLocalStateVisibilitySnapshot: {
      ...existingFacts.selectedPlayLocalStateVisibility,
    },
    observationIds: [],
    stateDelta: {},
    suggestedActions: [...existingFacts.selectedSuggestedActions],
    committedAt: turn.createdAt,
    canonical: false,
  };
  const turnArtifacts = [...existingFacts.turnArtifacts, artifact];
  const selectedTurnIds = [...existingFacts.selectedTurnIds, artifact.id];
  return {
    ...next,
    transcript: projectPlayTranscript(turnArtifacts, selectedTurnIds),
    turnArtifacts,
    selectedTurnIds,
    branchSnapshotRequiredFromRevision:
      session.branchSnapshotRequiredFromRevision,
    branchBaseSnapshot: existingFacts.branchBaseSnapshot,
    metadataExtensions: { ...(session.metadataExtensions ?? {}) },
  };
};

export const addPlayObservation = (
  session: PlaySession,
  observation: PlayObservation,
): PlaySession => {
  const normalizedObservation = assertPlayObservation(observation, {
    strict: true,
  });
  const existingFacts = materializePlayTurnFacts(session);
  const outOfBranchTurnId = normalizedObservation.sourceTurnIds.find(
    (turnId) => !existingFacts.selectedMessageIds.has(turnId),
  );
  if (outOfBranchTurnId) {
    throw new Error(
      `Play manual observation references out-of-branch turn: ${outOfBranchTurnId}.`,
    );
  }
  const outOfBranchEventId = normalizedObservation.sourceEventIds.find(
    (eventId) => !existingFacts.selectedEventIds.has(eventId),
  );
  if (outOfBranchEventId) {
    throw new Error(
      `Play manual observation references out-of-branch event: ${outOfBranchEventId}.`,
    );
  }
  const next = advancePlaySessionRevision(session, existingFacts.turnArtifacts);
  return {
    ...next,
    observations: [...session.observations, normalizedObservation],
  };
};

export const addPlayAdoptionCandidate = (
  session: PlaySession,
  candidate: PlayAdoptionCandidate,
): PlaySession => {
  const normalizedCandidate = assertPlayAdoptionCandidate(candidate, {
    strict: true,
  });
  const existingFacts = materializePlayTurnFacts(session);
  assertScopedPlayFactReferences(
    `Play adoption candidate ${normalizedCandidate.id}`,
    normalizedCandidate.sourceTurnIds,
    normalizedCandidate.sourceEventIds,
    existingFacts.selectedMessageIds,
    existingFacts.selectedEventIds,
  );
  const outOfBranchObservationId = normalizedCandidate.sourceObservationIds.find(
    (observationId) => !existingFacts.selectedObservationIds.has(observationId),
  );
  if (outOfBranchObservationId) {
    throw new Error(
      `Play adoption candidate ${normalizedCandidate.id} references ` +
      `out-of-branch observation: ${outOfBranchObservationId}.`,
    );
  }
  const sessionWithCandidate: PlaySession = {
    ...session,
    adoptionCandidates: [...session.adoptionCandidates, normalizedCandidate],
  };
  const facts = materializePlayTurnFacts(sessionWithCandidate);
  return advancePlaySessionRevision(sessionWithCandidate, facts.turnArtifacts);
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
    ...session.metadataExtensions,
    schemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    revision: session.revision,
    userPersona: session.userPersona,
    sceneStart: session.sceneStart,
    characters: session.characters,
    selectedTurnIds: session.selectedTurnIds,
    branchSnapshotRequiredFromRevision:
      session.branchSnapshotRequiredFromRevision,
    branchBaseSnapshot: session.branchBaseSnapshot,
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

async function readPlayTurnArtifacts(
  workspaceRoot: string,
  sessionId: string,
): Promise<PlayTurnArtifact[]> {
  const sessionRoot = dirname(resolvePlaySessionPath(
    workspaceRoot,
    sessionId,
    'session.yaml',
  ));
  return readPlayTurnArtifactsFromSessionRoot(sessionRoot);
}

async function readPlayTurnArtifactsFromSessionRoot(
  sessionRoot: string,
): Promise<PlayTurnArtifact[]> {
  const turnsRoot = join(sessionRoot, PLAY_TURNS_DIRECTORY);
  let entries: Dirent[];

  try {
    entries = await readdir(turnsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const artifacts = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
      .map(async (entry) => {
        const artifactId = assertSafePlayTurnArtifactId(entry.name.slice(0, -5));
        const artifact = normalizePlayTurnArtifact(
          parse(await readFile(join(turnsRoot, entry.name), 'utf-8')),
        );
        if (artifact.id !== artifactId) {
          throw new Error(
            `Play turn artifact id mismatch: expected ${artifactId}, found ${artifact.id}.`,
          );
        }
        return artifact;
      }),
  );

  return artifacts.toSorted((left, right) =>
    left.revision - right.revision || left.committedAt.localeCompare(right.committedAt),
  );
}

function materializePlayTurnFacts(session: PlaySession): {
  transcript: PlayTranscriptTurn[];
  turnArtifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  selectedMessageIds: Set<string>;
  selectedEventIds: Set<string>;
  selectedObservationIds: Set<string>;
  selectedScheduledEvents: PlayScheduledEvent[];
  selectedPlayLocalState: Record<string, unknown>;
  selectedPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  selectedSuggestedActions: string[];
  branchBaseSnapshot: PlayBranchBaseSnapshot;
} {
  const storedArtifacts = Array.isArray(session.turnArtifacts)
    ? session.turnArtifacts.map(normalizePlayTurnArtifact)
    : [];
  const usesStoredArtifacts = storedArtifacts.length > 0;
  const turnArtifacts = usesStoredArtifacts
    ? storedArtifacts
    : createLegacyPlayTurnArtifacts({
        transcript: session.transcript ?? [],
        events: session.events,
        observations: session.observations,
      });
  const selectedTurnIds = usesStoredArtifacts && Array.isArray(session.selectedTurnIds)
    ? session.selectedTurnIds.map(assertSafePlayTurnArtifactId)
    : selectDefaultPlayTurnPath(turnArtifacts);
  const branchBaseSnapshot = normalizePlayBranchBaseSnapshot(
    session.branchBaseSnapshot,
  );

  const validated = validatePlayTurnFacts({
    turnArtifacts,
    selectedTurnIds,
    events: session.events,
    scheduledEvents: session.scheduledEvents,
    observations: session.observations,
    adoptionCandidates: session.adoptionCandidates,
    currentRevision: resolvePlaySessionRevision(session, turnArtifacts),
    currentWorldTurn: session.worldClock.turn,
    sessionWorldClock: session.worldClock,
    sessionPlayLocalState: session.playLocalState,
    sessionPlayLocalStateVisibility: session.playLocalStateVisibility,
    branchSnapshotRequiredFromRevision:
      session.branchSnapshotRequiredFromRevision,
    branchBaseSnapshot,
    sessionSuggestedActions: session.suggestedActions,
  });

  return {
    ...validated,
    turnArtifacts,
    selectedTurnIds,
    branchBaseSnapshot,
  };
}

interface ValidatePlayTurnFactsInput {
  turnArtifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  events: PlayWorldEvent[];
  scheduledEvents: PlayScheduledEvent[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
  currentRevision: number;
  currentWorldTurn: number;
  sessionWorldClock: PlayWorldClock;
  sessionPlayLocalState: Record<string, unknown>;
  sessionPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  branchSnapshotRequiredFromRevision: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
  sessionSuggestedActions: string[];
}

interface ValidatedPlayTurnFacts {
  transcript: PlayTranscriptTurn[];
  selectedMessageIds: Set<string>;
  selectedEventIds: Set<string>;
  selectedObservationIds: Set<string>;
  selectedScheduledEvents: PlayScheduledEvent[];
  selectedPlayLocalState: Record<string, unknown>;
  selectedPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  selectedSuggestedActions: string[];
}

function validatePlayTurnFacts(
  input: ValidatePlayTurnFactsInput,
): ValidatedPlayTurnFacts {
  for (const event of input.events) {
    assertPlayWorldEvent(event, { strict: true });
  }
  for (const observation of input.observations) {
    assertPlayObservation(observation, { strict: true });
  }
  const adoptionCandidates = input.adoptionCandidates.map((candidate) =>
    assertPlayAdoptionCandidate(candidate, { strict: true }));
  const adoptionCandidateIds = new Set<string>();
  for (const candidate of adoptionCandidates) {
    if (adoptionCandidateIds.has(candidate.id)) {
      throw new Error(
        `Play adoption candidate ledger contains duplicate id: ${candidate.id}.`,
      );
    }
    adoptionCandidateIds.add(candidate.id);
  }
  if (input.turnArtifacts.length && !input.selectedTurnIds.length) {
    throw new Error('Play turn artifacts require a selected root-to-head path.');
  }
  const transcript = projectPlayTranscript(
    input.turnArtifacts,
    input.selectedTurnIds,
  );
  const artifactsById = new Map(
    input.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const messagesById = new Map<string, PlayTranscriptTurn>();
  const messageOwners = new Map<string, string>();
  for (const artifact of input.turnArtifacts) {
    for (const message of artifact.messages) {
      if (!message.id) {
        throw new Error(`Play turn artifact ${artifact.id} contains a message without id.`);
      }
      if (messagesById.has(message.id)) {
        throw new Error(`Play turn artifacts contain duplicate message id: ${message.id}.`);
      }
      messagesById.set(message.id, message);
      messageOwners.set(message.id, artifact.id);
    }
  }

  const eventsById = indexUniquePlayFacts(input.events, 'event');
  const scheduledEvents = normalizePlayScheduledEvents(input.scheduledEvents);
  const observationsById = indexUniquePlayFacts(input.observations, 'observation');
  const eventOwners = new Map<string, string>();
  const observationOwners = new Map<string, string>();

  for (const event of input.events) {
    if (!messagesById.has(event.turnId)) {
      throw new Error(`Play event ${event.id} references unknown turn: ${event.turnId}.`);
    }
    assertKnownPlayFactReferences(
      `Play event ${event.id}`,
      event.cause.sourceTurnIds ?? [],
      event.cause.sourceEventIds ?? [],
      messagesById,
      eventsById,
    );
  }
  for (const observation of input.observations) {
    assertKnownPlayFactReferences(
      `Play observation ${observation.id}`,
      observation.sourceTurnIds,
      observation.sourceEventIds,
      messagesById,
      eventsById,
    );
  }

  for (const artifact of input.turnArtifacts) {
    const ownMessageIds = new Set(artifact.messages.map((message) => message.id!));
    const allowedArtifactIds: string[] = [];
    let current: PlayTurnArtifact | undefined = artifact;
    while (current) {
      allowedArtifactIds.push(current.id);
      current = current.parentTurnId
        ? artifactsById.get(current.parentTurnId)
        : undefined;
    }
    const allowedMessageIds = new Set(
      allowedArtifactIds.flatMap((artifactId) =>
        artifactsById.get(artifactId)!.messages.map((message) => message.id!)),
    );
    const allowedEventIds = new Set(
      allowedArtifactIds.flatMap((artifactId) =>
        artifactsById.get(artifactId)!.eventIds),
    );

    for (const eventId of artifact.eventIds) {
      const event = eventsById.get(eventId);
      if (!event) {
        throw new Error(`Play turn artifact ${artifact.id} references missing event: ${eventId}.`);
      }
      const existingOwner = eventOwners.get(eventId);
      if (existingOwner) {
        throw new Error(
          `Play event ${eventId} belongs to multiple artifacts: ${existingOwner}, ${artifact.id}.`,
        );
      }
      eventOwners.set(eventId, artifact.id);
      if (!ownMessageIds.has(event.turnId)) {
        throw new Error(
          `Play event ${eventId} turnId does not belong to artifact ${artifact.id}.`,
        );
      }
      assertScopedPlayFactReferences(
        `Play event ${eventId}`,
        event.cause.sourceTurnIds ?? [],
        event.cause.sourceEventIds ?? [],
        allowedMessageIds,
        allowedEventIds,
      );
    }

    for (const observationId of artifact.observationIds) {
      const observation = observationsById.get(observationId);
      if (!observation) {
        throw new Error(
          `Play turn artifact ${artifact.id} references missing observation: ${observationId}.`,
        );
      }
      const existingOwner = observationOwners.get(observationId);
      if (existingOwner) {
        throw new Error(
          `Play observation ${observationId} belongs to multiple artifacts: ${existingOwner}, ${artifact.id}.`,
        );
      }
      observationOwners.set(observationId, artifact.id);
      assertScopedPlayFactReferences(
        `Play observation ${observationId}`,
        observation.sourceTurnIds,
        observation.sourceEventIds,
        allowedMessageIds,
        allowedEventIds,
      );
    }
  }

  for (const event of input.events) {
    if (!eventOwners.has(event.id)) {
      throw new Error(`Play event ${event.id} is not owned by a turn artifact.`);
    }
  }

  const selectedArtifacts = input.selectedTurnIds.map((id) => artifactsById.get(id)!);
  const selectedMessageIds = new Set(
    selectedArtifacts.flatMap((artifact) =>
      artifact.messages.map((message) => message.id!)),
  );
  const selectedEventIds = new Set(
    selectedArtifacts.flatMap((artifact) => artifact.eventIds),
  );
  const selectedObservationIds = new Set(
    selectedArtifacts.flatMap((artifact) => artifact.observationIds),
  );
  const selectedArtifactIds = new Set(input.selectedTurnIds);
  for (const observation of input.observations) {
    if (observationOwners.has(observation.id)) {
      continue;
    }
    const provenanceArtifactIds = collectPlayReferenceOwnerArtifactIds(
      observation.sourceTurnIds,
      observation.sourceEventIds,
      messageOwners,
      eventOwners,
    );
    assertPlayReferenceOwnersShareBranch(
      `Play unowned observation ${observation.id}`,
      provenanceArtifactIds,
      artifactsById,
    );
    if (provenanceArtifactIds.every((artifactId) =>
      selectedArtifactIds.has(artifactId))) {
      selectedObservationIds.add(observation.id);
    }
  }
  for (const candidate of adoptionCandidates) {
    assertKnownPlayFactReferences(
      `Play adoption candidate ${candidate.id}`,
      candidate.sourceTurnIds,
      candidate.sourceEventIds,
      messagesById,
      eventsById,
    );
    const unknownObservationId = candidate.sourceObservationIds.find(
      (observationId) => !observationsById.has(observationId),
    );
    if (unknownObservationId) {
      throw new Error(
        `Play adoption candidate ${candidate.id} references unknown ` +
        `observation: ${unknownObservationId}.`,
      );
    }
    const provenanceArtifactIds = collectPlayReferenceOwnerArtifactIds(
      candidate.sourceTurnIds,
      candidate.sourceEventIds,
      messageOwners,
      eventOwners,
    );
    for (const observationId of candidate.sourceObservationIds) {
      const observation = observationsById.get(observationId)!;
      const observationOwnerId = observationOwners.get(observationId);
      if (observationOwnerId) {
        provenanceArtifactIds.push(observationOwnerId);
        continue;
      }
      provenanceArtifactIds.push(...collectPlayReferenceOwnerArtifactIds(
        observation.sourceTurnIds,
        observation.sourceEventIds,
        messageOwners,
        eventOwners,
      ));
    }
    assertPlayReferenceOwnersShareBranch(
      `Play adoption candidate ${candidate.id}`,
      provenanceArtifactIds,
      artifactsById,
    );
  }

  const selectedBranchSnapshot = validatePlayBranchSnapshots({
    artifacts: input.turnArtifacts,
    artifactsById,
    selectedTurnIds: input.selectedTurnIds,
    eventsById,
    sessionWorldClock: input.sessionWorldClock,
    sessionPlayLocalState: input.sessionPlayLocalState,
    sessionPlayLocalStateVisibility: input.sessionPlayLocalStateVisibility,
    currentRevision: input.currentRevision,
    branchSnapshotRequiredFromRevision:
      input.branchSnapshotRequiredFromRevision,
    branchBaseSnapshot: input.branchBaseSnapshot,
    sessionSuggestedActions: input.sessionSuggestedActions,
  });

  const selectedScheduledEvents = validatePlayScheduledEventHistory({
    artifacts: input.turnArtifacts,
    artifactsById,
    selectedTurnIds: input.selectedTurnIds,
    ledger: scheduledEvents,
    messageOwners,
    eventOwners,
    eventsById,
    currentRevision: input.currentRevision,
    currentWorldTurn: input.currentWorldTurn,
    branchBaseSnapshot: input.branchBaseSnapshot,
  });

  return {
    transcript,
    selectedMessageIds,
    selectedEventIds,
    selectedObservationIds,
    selectedScheduledEvents,
    selectedPlayLocalState: selectedBranchSnapshot.playLocalState,
    selectedPlayLocalStateVisibility:
      selectedBranchSnapshot.playLocalStateVisibility,
    selectedSuggestedActions: selectedBranchSnapshot.suggestedActions,
  };
}

function validatePlayBranchSnapshots(input: {
  artifacts: PlayTurnArtifact[];
  artifactsById: Map<string, PlayTurnArtifact>;
  selectedTurnIds: string[];
  eventsById: Map<string, PlayWorldEvent>;
  sessionWorldClock: PlayWorldClock;
  sessionPlayLocalState: Record<string, unknown>;
  sessionPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  currentRevision: number;
  branchSnapshotRequiredFromRevision: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
  sessionSuggestedActions: string[];
}): {
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  suggestedActions: string[];
} {
  if (input.sessionWorldClock.revision !== input.currentRevision) {
    throw new Error('Play session world clock revision does not match session revision.');
  }
  if (
    !Number.isSafeInteger(input.branchSnapshotRequiredFromRevision) ||
    input.branchSnapshotRequiredFromRevision < 0
  ) {
    throw new Error('Play branch snapshot watermark must be a non-negative integer.');
  }
  if (
    input.branchSnapshotRequiredFromRevision > input.currentRevision ||
    input.branchSnapshotRequiredFromRevision !==
      input.branchBaseSnapshot.worldClock.revision
  ) {
    throw new Error('Play branch snapshot watermark does not match its base snapshot.');
  }

  for (const artifact of input.artifacts) {
    const parent = artifact.parentTurnId
      ? input.artifactsById.get(artifact.parentTurnId)
      : undefined;
    const completeSnapshot = hasCompletePlayBranchSnapshot(artifact);
    if (
      artifact.revision > input.branchSnapshotRequiredFromRevision &&
      !completeSnapshot
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} cannot downgrade below the branch snapshot watermark.`,
      );
    }
    if (
      artifact.worldClock &&
      artifact.worldClock.revision !== artifact.revision
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} world clock revision does not match artifact revision.`,
      );
    }
    if (!completeSnapshot) {
      if (
        (parent && hasCompletePlayBranchSnapshot(parent)) ||
        artifact.branchSnapshotVersion !== undefined ||
        artifact.artifactKind !== undefined ||
        artifact.scheduledEventSnapshots.length ||
        artifact.playLocalStateSnapshot !== undefined ||
        artifact.playLocalStateVisibilitySnapshot !== undefined
      ) {
        throw new Error(
          `Play turn artifact ${artifact.id} has an incomplete branch snapshot.`,
        );
      }
      continue;
    }

    const worldClock = artifact.worldClock!;
    const stateSnapshot = artifact.playLocalStateSnapshot!;
    const visibilitySnapshot = artifact.playLocalStateVisibilitySnapshot!;
    const parentComplete = Boolean(parent && hasCompletePlayBranchSnapshot(parent));
    const usesBaseSnapshot = !parentComplete &&
      input.branchBaseSnapshot.parentTurnId === artifact.parentTurnId;
    if (!parentComplete && !usesBaseSnapshot) {
      throw new Error(
        `Play turn artifact ${artifact.id} has no verifiable predecessor snapshot.`,
      );
    }
    const predecessorClock = parentComplete
      ? parent!.worldClock!
      : input.branchBaseSnapshot.worldClock;
    const predecessorState = parentComplete
      ? parent!.playLocalStateSnapshot!
      : input.branchBaseSnapshot.playLocalState;
    const predecessorVisibility = parentComplete
      ? parent!.playLocalStateVisibilitySnapshot!
      : input.branchBaseSnapshot.playLocalStateVisibility;
    const predecessorSuggestedActions = parentComplete
      ? parent!.suggestedActions
      : input.branchBaseSnapshot.suggestedActions;
    if (artifact.revision <= predecessorClock.revision) {
      throw new Error(
        `Play turn artifact ${artifact.id} revision does not advance its predecessor.`,
      );
    }
    assertCompletePlayArtifactKind(artifact, input.eventsById);
    if (
      artifact.artifactKind === 'transcriptAppend' &&
      !isDeepStrictEqual(
        artifact.suggestedActions,
        predecessorSuggestedActions,
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} transcript append changes suggested actions.`,
      );
    }
    const expectedTurn = predecessorClock.turn +
      (artifact.artifactKind === 'worldSettlement' ? 1 : 0);
    if (
      worldClock.turn !== expectedTurn ||
      (
        artifact.artifactKind === 'transcriptAppend' &&
        (
          worldClock.anchor !== predecessorClock.anchor ||
          worldClock.elapsed !== predecessorClock.elapsed
        )
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} world clock does not follow its predecessor.`,
      );
    }
    const expectedState = mergePlayLocalState(
      predecessorState,
      artifact.stateDelta,
    );
    if (!isDeepStrictEqual(stateSnapshot, expectedState)) {
      throw new Error(
        `Play turn artifact ${artifact.id} state snapshot does not match its predecessor and delta.`,
      );
    }
    const expectedVisibility = { ...predecessorVisibility };
    const settlementVisibility = resolveArtifactSettlementVisibility(
      artifact,
      input.eventsById,
    );
    for (const key of Object.keys(artifact.stateDelta)) {
      expectedVisibility[key] = settlementVisibility;
    }
    if (!isDeepStrictEqual(visibilitySnapshot, expectedVisibility)) {
      throw new Error(
        `Play turn artifact ${artifact.id} state visibility does not match its predecessor and delta.`,
      );
    }
    if (
      !isDeepStrictEqual(
        Object.keys(visibilitySnapshot).toSorted(),
        Object.keys(stateSnapshot).toSorted(),
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} state visibility keys do not match its state snapshot.`,
      );
    }

    for (const eventId of artifact.eventIds) {
      const event = input.eventsById.get(eventId)!;
      if (!isDeepStrictEqual(event.worldClock, worldClock)) {
        throw new Error(
          `Play event ${eventId} world clock does not match artifact ${artifact.id}.`,
        );
      }
    }
  }

  const selectedHeadId = input.selectedTurnIds.at(-1);
  const selectedHead = selectedHeadId
    ? input.artifactsById.get(selectedHeadId)
    : undefined;
  if (!selectedHead || !hasCompletePlayBranchSnapshot(selectedHead)) {
    if (
      selectedHeadId !== input.branchBaseSnapshot.parentTurnId ||
      input.sessionWorldClock.turn !== input.branchBaseSnapshot.worldClock.turn ||
      input.sessionWorldClock.anchor !== input.branchBaseSnapshot.worldClock.anchor ||
      input.sessionWorldClock.elapsed !== input.branchBaseSnapshot.worldClock.elapsed ||
      !isDeepStrictEqual(
        input.sessionPlayLocalState,
        input.branchBaseSnapshot.playLocalState,
      ) ||
      !isDeepStrictEqual(
        input.sessionPlayLocalStateVisibility,
        input.branchBaseSnapshot.playLocalStateVisibility,
      ) ||
      !isDeepStrictEqual(
        input.sessionSuggestedActions,
        input.branchBaseSnapshot.suggestedActions,
      )
    ) {
      throw new Error('Play legacy projection does not match its branch base snapshot.');
    }
    return {
      playLocalState: clonePlayLocalState(input.branchBaseSnapshot.playLocalState),
      playLocalStateVisibility: {
        ...input.branchBaseSnapshot.playLocalStateVisibility,
      },
      suggestedActions: [...input.branchBaseSnapshot.suggestedActions],
    };
  }

  const headClock = selectedHead.worldClock!;
  if (
    input.sessionWorldClock.turn !== headClock.turn ||
    input.sessionWorldClock.anchor !== headClock.anchor ||
    input.sessionWorldClock.elapsed !== headClock.elapsed
  ) {
    throw new Error(
      'Play session world clock does not match the selected turn artifact head.',
    );
  }
  if (!isDeepStrictEqual(
    input.sessionPlayLocalState,
    selectedHead.playLocalStateSnapshot,
  )) {
    throw new Error(
      'Play-local state does not match the selected turn artifact head.',
    );
  }
  if (!isDeepStrictEqual(
    input.sessionPlayLocalStateVisibility,
    selectedHead.playLocalStateVisibilitySnapshot,
  )) {
    throw new Error(
      'Play-local state visibility does not match the selected turn artifact head.',
    );
  }
  if (!isDeepStrictEqual(
    input.sessionSuggestedActions,
    selectedHead.suggestedActions,
  )) {
    throw new Error(
      'Play suggested actions do not match the selected turn artifact head.',
    );
  }

  return {
    playLocalState: clonePlayLocalState(selectedHead.playLocalStateSnapshot!),
    playLocalStateVisibility: {
      ...selectedHead.playLocalStateVisibilitySnapshot!,
    },
    suggestedActions: [...selectedHead.suggestedActions],
  };
}

function hasCompletePlayBranchSnapshot(artifact: PlayTurnArtifact): boolean {
  return artifact.schemaVersion === PLAY_TURN_ARTIFACT_SCHEMA_VERSION;
}

function assertCompletePlayArtifactKind(
  artifact: PlayTurnArtifact,
  eventsById: Map<string, PlayWorldEvent>,
): void {
  if (artifact.artifactKind === 'worldSettlement') {
    const [userMessage, refereeMessage] = artifact.messages;
    if (
      !artifact.input ||
      artifact.messages.length !== 2 ||
      userMessage?.speaker !== 'user' ||
      refereeMessage?.speaker !== 'world-referee' ||
      userMessage.content !== artifact.input.raw ||
      userMessage.actionKind !== artifact.input.kind ||
      refereeMessage.actionKind !== undefined
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} has an invalid world settlement shape.`,
      );
    }
    if (artifact.eventIds.some((eventId) =>
      eventsById.get(eventId)?.turnId !== refereeMessage.id)) {
      throw new Error(
        `Play turn artifact ${artifact.id} settlement events must belong to its referee message.`,
      );
    }
    return;
  }

  if (
    artifact.artifactKind !== 'transcriptAppend' ||
    artifact.input !== undefined ||
    artifact.messages.length !== 1 ||
    artifact.eventIds.length !== 0 ||
    artifact.dueScheduledEventIds.length !== 0 ||
    artifact.observationIds.length !== 0 ||
    Object.keys(artifact.stateDelta).length !== 0
  ) {
    throw new Error(
      `Play turn artifact ${artifact.id} has an invalid transcript append shape.`,
    );
  }
}

function resolveArtifactSettlementVisibility(
  artifact: PlayTurnArtifact,
  eventsById: Map<string, PlayWorldEvent>,
): PlayEventVisibility {
  const visibilities = artifact.eventIds.map((eventId) =>
    eventsById.get(eventId)?.visibility ?? 'playerVisible');
  if (visibilities.includes('playerUnknown')) {
    return 'playerUnknown';
  }
  if (visibilities.includes('rumor')) {
    return 'rumor';
  }
  return 'playerVisible';
}

interface ValidatePlayScheduledEventHistoryInput {
  artifacts: PlayTurnArtifact[];
  artifactsById: Map<string, PlayTurnArtifact>;
  selectedTurnIds: string[];
  ledger: PlayScheduledEvent[];
  messageOwners: Map<string, string>;
  eventOwners: Map<string, string>;
  eventsById: Map<string, PlayWorldEvent>;
  currentRevision: number;
  currentWorldTurn: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
}

function validatePlayScheduledEventHistory(
  input: ValidatePlayScheduledEventHistoryInput,
): PlayScheduledEvent[] {
  for (const artifact of input.artifacts) {
    if (!hasCompletePlayBranchSnapshot(artifact)) {
      continue;
    }
    const allowedArtifactIds = collectPlayArtifactAncestorIds(
      artifact,
      input.artifactsById,
    );
    const parent = artifact.parentTurnId
      ? input.artifactsById.get(artifact.parentTurnId)
      : undefined;
    const parentSnapshotComplete = Boolean(
      parent && hasCompletePlayBranchSnapshot(parent),
    );
    const previousSnapshots = parentSnapshotComplete
      ? parent!.scheduledEventSnapshots
      : input.branchBaseSnapshot.scheduledEvents;
    const predecessorWorldClock = parentSnapshotComplete
      ? parent!.worldClock!
      : input.branchBaseSnapshot.worldClock;
    const predecessorPlayLocalState = parentSnapshotComplete
      ? parent!.playLocalStateSnapshot!
      : input.branchBaseSnapshot.playLocalState;
    const previousById = new Map(
      previousSnapshots.map((event) => [event.id, event]),
    );
    const currentById = new Map(
      artifact.scheduledEventSnapshots.map((event) => [event.id, event]),
    );
    if (
      artifact.artifactKind === 'transcriptAppend' &&
      !arePlayScheduledEventListsEqual(
        artifact.scheduledEventSnapshots,
        previousSnapshots,
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} transcript append changes the schedule head.`,
      );
    }
    assertPlayArtifactDueScheduleEvidence({
      artifact,
      previousSnapshots,
      currentSnapshots: artifact.scheduledEventSnapshots,
      predecessorWorldClock,
      predecessorPlayLocalState,
    });

    for (const previous of previousSnapshots) {
      if (!currentById.has(previous.id)) {
        throw new Error(
          `Play turn artifact ${artifact.id} removes scheduled event ${previous.id}.`,
        );
      }
    }

    for (const scheduledEvent of artifact.scheduledEventSnapshots) {
      assertPlayScheduledEventEvidence({
        artifact,
        scheduledEvent,
        allowedArtifactIds,
        artifactsById: input.artifactsById,
        messageOwners: input.messageOwners,
        eventOwners: input.eventOwners,
        eventsById: input.eventsById,
      });
      assertPlayScheduledEventTransition(
        artifact,
        true,
        previousById.get(scheduledEvent.id),
        scheduledEvent,
      );
    }
  }

  for (const event of input.eventsById.values()) {
    const triggerId = event.cause.triggerId;
    if (!triggerId) {
      continue;
    }
    const ownerId = input.eventOwners.get(event.id);
    const owner = ownerId ? input.artifactsById.get(ownerId) : undefined;
    const scheduledEvent = owner?.scheduledEventSnapshots.find(
      (candidate) => candidate.id === triggerId,
    );
    if (
      !scheduledEvent ||
      scheduledEvent.status !== 'occurred' ||
      !scheduledEvent.occurredEventIds?.includes(event.id)
    ) {
      throw new Error(
        `Play event ${event.id} is not recorded by scheduled event ${triggerId} on its branch.`,
      );
    }
  }

  const selectedHeadId = input.selectedTurnIds.at(-1);
  const selectedHead = selectedHeadId
    ? input.artifactsById.get(selectedHeadId)
    : undefined;
  let selectedScheduledEvents: PlayScheduledEvent[];
  if (selectedHead && hasCompletePlayBranchSnapshot(selectedHead)) {
    selectedScheduledEvents = selectedHead.scheduledEventSnapshots;
  } else {
    selectedScheduledEvents = input.branchBaseSnapshot.scheduledEvents;
  }

  if (!arePlayScheduledEventListsEqual(input.ledger, selectedScheduledEvents)) {
    throw new Error(
      'Play event-schedule ledger does not match the selected turn artifact head.',
    );
  }

  for (const scheduledEvent of selectedScheduledEvents) {
    if (
      scheduledEvent.scheduledAtRevision > input.currentRevision ||
      scheduledEvent.scheduledAtTurn > input.currentWorldTurn
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} is ahead of the selected session clock.`,
      );
    }
  }

  return selectedScheduledEvents.map(clonePlayScheduledEvent);
}

function assertPlayScheduledEventEvidence(input: {
  artifact: PlayTurnArtifact;
  scheduledEvent: PlayScheduledEvent;
  allowedArtifactIds: Set<string>;
  artifactsById: Map<string, PlayTurnArtifact>;
  messageOwners: Map<string, string>;
  eventOwners: Map<string, string>;
  eventsById: Map<string, PlayWorldEvent>;
}): void {
  const {
    artifact,
    scheduledEvent,
    allowedArtifactIds,
    artifactsById,
    messageOwners,
    eventOwners,
    eventsById,
  } = input;

  if (scheduledEvent.scheduledAtRevision > artifact.revision) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} has a future scheduledAtRevision in artifact ${artifact.id}.`,
    );
  }
  if (
    artifact.worldClock &&
    scheduledEvent.scheduledAtTurn > artifact.worldClock.turn
  ) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} has a future scheduledAtTurn in artifact ${artifact.id}.`,
    );
  }

  if (scheduledEvent.sourceTurnId) {
    const sourceOwnerId = messageOwners.get(scheduledEvent.sourceTurnId);
    const sourceOwner = sourceOwnerId
      ? artifactsById.get(sourceOwnerId)
      : undefined;
    const sourceMessage = sourceOwner?.messages.find(
      (message) => message.id === scheduledEvent.sourceTurnId,
    );
    if (
      !sourceOwnerId ||
      !sourceOwner ||
      sourceOwner.artifactKind !== 'worldSettlement' ||
      sourceMessage?.speaker !== 'world-referee' ||
      sourceOwner.messages[1]?.id !== scheduledEvent.sourceTurnId ||
      !allowedArtifactIds.has(sourceOwnerId)
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} references an out-of-branch source turn.`,
      );
    }
    if (
      scheduledEvent.scheduledAtRevision !== sourceOwner.revision ||
      !sourceOwner.worldClock ||
      scheduledEvent.scheduledAtTurn !== sourceOwner.worldClock.turn
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} scheduling evidence does not match its source artifact.`,
      );
    }
    if (!scheduledEvent.changeReason) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} requires changeReason for a turn-owned change.`,
      );
    }
  }

  if (!scheduledEvent.resolvedAtTurnId) {
    return;
  }

  const resolutionOwnerId = messageOwners.get(scheduledEvent.resolvedAtTurnId);
  const resolutionOwner = resolutionOwnerId
    ? artifactsById.get(resolutionOwnerId)
    : undefined;
  const resolutionMessage = resolutionOwner?.messages.find(
    (message) => message.id === scheduledEvent.resolvedAtTurnId,
  );
  if (
    !resolutionOwnerId ||
    resolutionOwner?.artifactKind !== 'worldSettlement' ||
    resolutionMessage?.speaker !== 'world-referee' ||
    resolutionOwner?.messages[1]?.id !== scheduledEvent.resolvedAtTurnId ||
    !allowedArtifactIds.has(resolutionOwnerId)
  ) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} references an out-of-branch resolution turn.`,
    );
  }

  if (
    scheduledEvent.status === 'occurred' &&
    scheduledEvent.occurredEventIds?.length !== 1
  ) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} must resolve to exactly one occurred event.`,
    );
  }

  for (const eventId of scheduledEvent.occurredEventIds ?? []) {
    const event = eventsById.get(eventId);
    if (
      !event ||
      eventOwners.get(eventId) !== resolutionOwnerId ||
      event.turnId !== scheduledEvent.resolvedAtTurnId ||
      event.cause.triggerId !== scheduledEvent.id
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} references invalid branch-owned occurred event ${eventId}.`,
      );
    }
    assertDueEventMatchesTemplate(event, scheduledEvent);
  }
}

function assertPlayArtifactDueScheduleEvidence(input: {
  artifact: PlayTurnArtifact;
  previousSnapshots: PlayScheduledEvent[];
  currentSnapshots: PlayScheduledEvent[];
  predecessorWorldClock: PlayWorldClock;
  predecessorPlayLocalState: Record<string, unknown>;
}): void {
  const {
    artifact,
    previousSnapshots,
    currentSnapshots,
    predecessorWorldClock,
    predecessorPlayLocalState,
  } = input;
  const eligibleIds = new Set(previousSnapshots.map((event) => event.id));
  if (artifact.dueScheduledEventIds.some((id) => !eligibleIds.has(id))) {
    throw new Error(
      `Play turn artifact ${artifact.id} contains invalid hard-due schedule evidence.`,
    );
  }

  const expectedDueIds = artifact.artifactKind === 'worldSettlement'
    ? evaluatePlayDueEvents({
      scheduledEvents: previousSnapshots,
      currentTurn: predecessorWorldClock.turn,
      nextTurn: artifact.worldClock!.turn,
      playLocalState: predecessorPlayLocalState,
      ...(predecessorWorldClock.anchor
        ? { currentWorldTime: predecessorWorldClock.anchor }
        : {}),
    }).dueEvents.map((event) => event.id)
    : [];
  if (!isDeepStrictEqual(artifact.dueScheduledEventIds, expectedDueIds)) {
    throw new Error(
      `Play turn artifact ${artifact.id} hard-due evidence does not match its predecessor snapshot.`,
    );
  }

  for (const dueId of artifact.dueScheduledEventIds) {
    if (currentSnapshots.find((event) => event.id === dueId)?.status !== 'occurred') {
      throw new Error(
        `Play scheduled event ${dueId} was hard-due and did not occur in artifact ${artifact.id}.`,
      );
    }
  }
}

function assertPlayScheduledEventTransition(
  artifact: PlayTurnArtifact,
  parentSnapshotComplete: boolean,
  previous: PlayScheduledEvent | undefined,
  current: PlayScheduledEvent,
): void {
  if (!previous) {
    if (!current.sourceTurnId) {
      const resolvesSeedInThisArtifact =
        current.status !== 'scheduled' &&
        Boolean(current.resolvedAtTurnId) &&
        artifact.messages.some((message) => message.id === current.resolvedAtTurnId);
      if (
        parentSnapshotComplete ||
        current.scheduledAtRevision >= artifact.revision ||
        (current.status !== 'scheduled' && !resolvesSeedInThisArtifact)
      ) {
        throw new Error(
          `Play scheduled event ${current.id} has invalid seed evidence in artifact ${artifact.id}.`,
        );
      }
      if (current.status !== 'scheduled') {
        assertScheduledEventResolutionMatchesDueEvidence(artifact, current);
      } else if (artifact.dueScheduledEventIds.includes(current.id)) {
        throw new Error(
          `Play scheduled event ${current.id} was hard-due and cannot remain scheduled.`,
        );
      }
      return;
    }
    if (
      current.status !== 'scheduled' ||
      !artifact.messages.some((message) => message.id === current.sourceTurnId)
    ) {
      throw new Error(
        `Play scheduled event ${current.id} has an invalid creation transition in artifact ${artifact.id}.`,
      );
    }
    return;
  }

  if (previous.status !== 'scheduled') {
    if (arePlayScheduledEventsEqual(previous, current)) {
      return;
    }
    throw new Error(
      `Play scheduled event ${current.id} changes after reaching ${previous.status}.`,
    );
  }

  const wasDue = artifact.dueScheduledEventIds.includes(previous.id);
  if (wasDue && current.status !== 'occurred') {
    throw new Error(
      `Play scheduled event ${current.id} was hard-due and cannot be ${current.status}.`,
    );
  }
  if (!wasDue && current.status === 'occurred') {
    throw new Error(
      `Play scheduled event ${current.id} occurred before its trigger was due.`,
    );
  }
  if (arePlayScheduledEventsEqual(previous, current)) {
    if (wasDue) {
      throw new Error(
        `Play scheduled event ${current.id} was hard-due and cannot remain scheduled.`,
      );
    }
    return;
  }

  if (current.status === 'scheduled') {
    if (
      previous.id !== current.id ||
      previous.label !== current.label ||
      JSON.stringify(previous.template) !== JSON.stringify(current.template) ||
      !current.sourceTurnId ||
      !artifact.messages.some((message) => message.id === current.sourceTurnId) ||
      current.scheduledAtRevision !== artifact.revision ||
      !artifact.worldClock ||
      current.scheduledAtTurn !== artifact.worldClock.turn
    ) {
      throw new Error(
        `Play scheduled event ${current.id} has an invalid reschedule transition in artifact ${artifact.id}.`,
      );
    }
    return;
  }

  if (
    !hasSamePlayScheduledEventPlan(previous, current) ||
    !current.resolvedAtTurnId ||
    !artifact.messages.some((message) => message.id === current.resolvedAtTurnId)
  ) {
    throw new Error(
      `Play scheduled event ${current.id} has an invalid ${current.status} transition in artifact ${artifact.id}.`,
    );
  }
}

function assertScheduledEventResolutionMatchesDueEvidence(
  artifact: PlayTurnArtifact,
  current: PlayScheduledEvent,
): void {
  const wasDue = artifact.dueScheduledEventIds.includes(current.id);
  if (current.status === 'occurred' && !wasDue) {
    throw new Error(
      `Play scheduled event ${current.id} occurred before its trigger was due.`,
    );
  }
  if (current.status === 'cancelled' && wasDue) {
    throw new Error(
      `Play scheduled event ${current.id} was hard-due and cannot be cancelled.`,
    );
  }
}

function collectPlayArtifactAncestorIds(
  artifact: PlayTurnArtifact,
  artifactsById: Map<string, PlayTurnArtifact>,
): Set<string> {
  const ids = new Set<string>();
  let current: PlayTurnArtifact | undefined = artifact;
  while (current) {
    ids.add(current.id);
    current = current.parentTurnId
      ? artifactsById.get(current.parentTurnId)
      : undefined;
  }
  return ids;
}

function hasSamePlayScheduledEventPlan(
  left: PlayScheduledEvent,
  right: PlayScheduledEvent,
): boolean {
  return left.id === right.id &&
    left.label === right.label &&
    JSON.stringify(left.trigger) === JSON.stringify(right.trigger) &&
    JSON.stringify(left.template) === JSON.stringify(right.template) &&
    left.scheduledAtTurn === right.scheduledAtTurn &&
    left.scheduledAtRevision === right.scheduledAtRevision &&
    left.sourceTurnId === right.sourceTurnId &&
    left.changeReason === right.changeReason &&
    left.priority === right.priority;
}

function arePlayScheduledEventsEqual(
  left: PlayScheduledEvent,
  right: PlayScheduledEvent,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function arePlayScheduledEventListsEqual(
  left: readonly PlayScheduledEvent[],
  right: readonly PlayScheduledEvent[],
): boolean {
  return left.length === right.length && left.every((event, index) =>
    arePlayScheduledEventsEqual(event, right[index]!));
}

function clonePlayScheduledEvent(event: PlayScheduledEvent): PlayScheduledEvent {
  return {
    ...event,
    trigger: { ...event.trigger },
    template: { ...event.template },
    ...(event.occurredEventIds
      ? { occurredEventIds: [...event.occurredEventIds] }
      : {}),
  };
}

function indexUniquePlayFacts<T extends { id: string }>(
  facts: T[],
  label: 'event' | 'observation',
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const fact of facts) {
    if (indexed.has(fact.id)) {
      throw new Error(`Play ${label} ledger contains duplicate id: ${fact.id}.`);
    }
    indexed.set(fact.id, fact);
  }
  return indexed;
}

function assertKnownPlayFactReferences(
  label: string,
  sourceTurnIds: string[],
  sourceEventIds: string[],
  messagesById: Map<string, PlayTranscriptTurn>,
  eventsById: Map<string, PlayWorldEvent>,
): void {
  const unknownTurnId = sourceTurnIds.find((id) => !messagesById.has(id));
  if (unknownTurnId) {
    throw new Error(`${label} references unknown turn: ${unknownTurnId}.`);
  }
  const unknownEventId = sourceEventIds.find((id) => !eventsById.has(id));
  if (unknownEventId) {
    throw new Error(`${label} references unknown event: ${unknownEventId}.`);
  }
}

function collectPlayReferenceOwnerArtifactIds(
  sourceTurnIds: string[],
  sourceEventIds: string[],
  messageOwners: Map<string, string>,
  eventOwners: Map<string, string>,
): string[] {
  return [
    ...sourceTurnIds.map((turnId) => messageOwners.get(turnId)),
    ...sourceEventIds.map((eventId) => eventOwners.get(eventId)),
  ].filter((artifactId): artifactId is string => artifactId !== undefined);
}

function assertPlayReferenceOwnersShareBranch(
  label: string,
  ownerArtifactIds: string[],
  artifactsById: Map<string, PlayTurnArtifact>,
): void {
  const uniqueOwnerIds = [...new Set(ownerArtifactIds)];
  if (uniqueOwnerIds.length < 2) {
    return;
  }
  const deepestOwner = uniqueOwnerIds
    .map((artifactId) => artifactsById.get(artifactId)!)
    .toSorted((left, right) => right.revision - left.revision)[0]!;
  const ancestorIds = collectPlayArtifactAncestorIds(deepestOwner, artifactsById);
  const incompatibleOwnerId = uniqueOwnerIds.find((artifactId) =>
    !ancestorIds.has(artifactId));
  if (incompatibleOwnerId) {
    throw new Error(
      `${label} mixes facts from incompatible Play branches: ` +
      `${incompatibleOwnerId}.`,
    );
  }
}

function assertScopedPlayFactReferences(
  label: string,
  sourceTurnIds: string[],
  sourceEventIds: string[],
  allowedMessageIds: Set<string>,
  allowedEventIds: Set<string>,
): void {
  const outOfBranchTurnId = sourceTurnIds.find((id) => !allowedMessageIds.has(id));
  if (outOfBranchTurnId) {
    throw new Error(`${label} references out-of-branch turn: ${outOfBranchTurnId}.`);
  }
  const outOfBranchEventId = sourceEventIds.find((id) => !allowedEventIds.has(id));
  if (outOfBranchEventId) {
    throw new Error(`${label} references out-of-branch event: ${outOfBranchEventId}.`);
  }
}

function normalizeSelectedTurnIds(
  value: unknown,
  artifacts: PlayTurnArtifact[],
): string[] {
  if (!Array.isArray(value)) {
    if (artifacts.length) {
      throw new Error('Play session with turn artifacts requires selectedTurnIds.');
    }
    return [];
  }
  const selectedTurnIds = value.map(assertSafePlayTurnArtifactId);
  projectPlayTranscript(artifacts, selectedTurnIds);
  return selectedTurnIds;
}

const PLAY_SESSION_METADATA_KEYS = new Set([
  'schemaVersion',
  'id',
  'title',
  'createdAt',
  'revision',
  'userPersona',
  'sceneStart',
  'characters',
  'transcript',
  'selectedTurnIds',
  'branchSnapshotRequiredFromRevision',
  'branchBaseSnapshot',
  'playLocalStateVisibility',
  'worldClock',
  'eventPolicy',
  'suggestedActions',
]);

function readPlaySessionMetadataExtensions(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !PLAY_SESSION_METADATA_KEYS.has(key)),
  );
}

function normalizeStoredPlaySessionSchemaVersion(value: unknown): 1 | 2 | 3 | 4 {
  if (value === undefined || value === 1) {
    return 1;
  }
  if (value === 2 || value === 3 || value === PLAY_SESSION_SCHEMA_VERSION) {
    return value;
  }
  throw new Error(`Unsupported Play session schemaVersion: ${String(value)}.`);
}

async function readStoredPlaySessionMigrationPreview(
  sessionRoot: string,
): Promise<PlaySessionMigrationPreview | undefined> {
  let metadata: unknown;
  try {
    metadata = parse(await readFile(join(sessionRoot, 'session.yaml'), 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  if (!isRecord(metadata)) {
    throw new Error('Play session metadata must be an object.');
  }
  const fromSchemaVersion = normalizeStoredPlaySessionSchemaVersion(
    metadata.schemaVersion,
  );
  if (fromSchemaVersion === PLAY_SESSION_SCHEMA_VERSION) {
    return undefined;
  }

  const sessionId = assertSafePlaySessionId(normalizeOptionalString(metadata.id) ?? '');
  const transcript = Array.isArray(metadata.transcript)
    ? metadata.transcript as PlayTranscriptTurn[]
    : [];
  const projectedArtifacts = fromSchemaVersion === 3
    ? await readPlayTurnArtifactsFromSessionRoot(sessionRoot)
    : createLegacyPlayTurnArtifacts({ transcript });
  const migrationName = `v${fromSchemaVersion}-to-v${PLAY_SESSION_SCHEMA_VERSION}`;

  return {
    sessionId,
    fromSchemaVersion,
    toSchemaVersion: PLAY_SESSION_SCHEMA_VERSION,
    unknownMetadataKeys: Object.keys(readPlaySessionMetadataExtensions(metadata)).sort(),
    legacyTranscriptCount: transcript.length,
    projectedTurnCount: projectedArtifacts.length,
    generatedTurnIds: projectedArtifacts.map((artifact) => artifact.id),
    backupRelativePath: ['.migrations', migrationName, 'original'].join('/'),
  };
}

async function writePlaySessionMigrationBackup(input: {
  sessionRoot: string;
  stageRoot: string;
  preview: PlaySessionMigrationPreview;
}): Promise<void> {
  const migrationRoot = join(
    input.stageRoot,
    '.migrations',
    `v${input.preview.fromSchemaVersion}-to-v${input.preview.toSchemaVersion}`,
  );
  const originalRoot = join(migrationRoot, 'original');
  await mkdir(migrationRoot, { recursive: true });
  await cp(input.sessionRoot, originalRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  await writeFile(
    join(migrationRoot, 'preview.yaml'),
    stringify(input.preview),
    'utf-8',
  );
}

async function copyPlaySessionMigrationHistory(
  sessionRoot: string,
  stageRoot: string,
): Promise<void> {
  try {
    await cp(
      join(sessionRoot, '.migrations'),
      join(stageRoot, '.migrations'),
      {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
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

function advancePlaySessionRevision(
  session: PlaySession,
  artifacts = materializePlayTurnFacts(session).turnArtifacts,
): PlaySession {
  const revision = resolvePlaySessionRevision(session, artifacts) + 1;
  return {
    ...session,
    revision,
    worldClock: {
      ...session.worldClock,
      revision,
    },
  };
}

function resolvePlaySessionRevision(
  session: Pick<PlaySession, 'revision' | 'worldClock'>,
  artifacts: PlayTurnArtifact[],
): number {
  return Math.max(
    normalizeNonNegativeInteger(session.revision),
    normalizeNonNegativeInteger(session.worldClock.revision),
    ...artifacts.map((artifact) => artifact.revision),
  );
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
  if (
    value === undefined ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === PLAY_SESSION_SCHEMA_VERSION
  ) {
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

function requireExactPlayLocalStateVisibility(
  state: Record<string, unknown>,
  value: unknown,
  label: string,
): Record<string, PlayEventVisibility> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be present as an object.`);
  }
  const stateKeys = Object.keys(state).toSorted();
  const visibilityKeys = Object.keys(value).toSorted();
  if (!isDeepStrictEqual(visibilityKeys, stateKeys)) {
    throw new Error(`${label} keys must exactly match Play-local state keys.`);
  }
  return Object.fromEntries(stateKeys.map((key) => {
    const visibility = normalizeEnum(value[key], PLAY_EVENT_VISIBILITIES);
    if (!visibility) {
      throw new Error(`${label} contains invalid visibility for ${key}.`);
    }
    return [key, visibility];
  }));
}

function requirePlayBranchSnapshotWatermark(value: unknown): number {
  const watermark = normalizeOptionalNonNegativeInteger(value);
  if (watermark === undefined) {
    throw new Error('Play session v4 requires a branch snapshot watermark.');
  }
  return watermark;
}

function normalizePlayBranchBaseSnapshot(
  value: unknown,
): PlayBranchBaseSnapshot {
  if (!isRecord(value)) {
    throw new Error('Play session v4 requires a branch base snapshot.');
  }
  const knownFields = new Set([
    'parentTurnId',
    'worldClock',
    'playLocalState',
    'playLocalStateVisibility',
    'scheduledEvents',
    'suggestedActions',
  ]);
  if (Object.keys(value).some((field) => !knownFields.has(field))) {
    throw new Error('Play branch base snapshot contains unknown fields.');
  }
  if (
    !isRecord(value.worldClock) ||
    !isRecord(value.playLocalState) ||
    !isRecord(value.playLocalStateVisibility)
  ) {
    throw new Error('Play branch base snapshot is incomplete.');
  }
  const playLocalState = clonePlayLocalState(value.playLocalState);
  const playLocalStateVisibility = requireExactPlayLocalStateVisibility(
    playLocalState,
    value.playLocalStateVisibility,
    'Play branch base state visibility',
  );
  const worldClock = normalizePlayWorldClock(value.worldClock);
  const suggestedActions = normalizeStringList(value.suggestedActions, 6);
  if (
    !Array.isArray(value.suggestedActions) ||
    suggestedActions.length !== value.suggestedActions.length ||
    new Set(suggestedActions).size !== suggestedActions.length
  ) {
    throw new Error('Play branch base suggested actions are invalid.');
  }
  return {
    ...(value.parentTurnId !== undefined
      ? { parentTurnId: assertSafePlayTurnArtifactId(value.parentTurnId) }
      : {}),
    worldClock,
    playLocalState,
    playLocalStateVisibility,
    scheduledEvents: normalizePlayBranchBaseScheduledEvents(
      value.scheduledEvents,
      worldClock,
    ),
    suggestedActions,
  };
}

function normalizePlayBranchBaseScheduledEvents(
  value: unknown,
  worldClock: PlayWorldClock,
): PlayScheduledEvent[] {
  const events = normalizePlayScheduledEvents(value);
  for (const event of events) {
    if (event.status !== 'scheduled') {
      throw new Error(
        `Play branch base scheduled event ${event.id} cannot start terminal.`,
      );
    }
    if (
      event.sourceTurnId !== undefined ||
      event.changeReason !== undefined ||
      event.occurredEventIds !== undefined ||
      event.resolvedAtTurnId !== undefined ||
      event.resolutionReason !== undefined
    ) {
      throw new Error(
        `Play branch base scheduled event ${event.id} cannot contain ` +
        'unverifiable source or resolution evidence.',
      );
    }
    if (
      event.scheduledAtTurn > worldClock.turn ||
      event.scheduledAtRevision > worldClock.revision
    ) {
      throw new Error(
        `Play branch base scheduled event ${event.id} starts after its base clock.`,
      );
    }
  }
  return events;
}

function normalizePlayWorldRefereeSettlement(value: unknown): PlayWorldRefereeSettlement {
  if (!isRecord(value)) {
    throw new Error('Play settlement must be a JSON object.');
  }

  if (value.events !== undefined && !Array.isArray(value.events)) {
    throw new Error('Play settlement events must be an array.');
  }
  if (
    value.scheduledEventChanges !== undefined &&
    !Array.isArray(value.scheduledEventChanges)
  ) {
    throw new Error('Play settlement scheduledEventChanges must be an array.');
  }
  if (
    Array.isArray(value.scheduledEventChanges) &&
    value.scheduledEventChanges.length > 8
  ) {
    throw new Error('Play settlement cannot change more than 8 scheduled events per turn.');
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
    scheduledEventChanges: (value.scheduledEventChanges ?? [])
      .map(normalizePlayWorldRefereeScheduledEventChange),
    stateDelta: isRecord(value.stateDelta)
      ? clonePlayLocalState(value.stateDelta)
      : {},
    observations: (value.observations ?? []).map(normalizePlayWorldRefereeObservation),
    suggestedActions: normalizeStringList(value.suggestedActions, 6),
  };
}

function normalizePlayWorldRefereeScheduledEventChange(
  value: unknown,
): PlayWorldRefereeScheduledEventChange {
  if (!isRecord(value)) {
    throw new Error('Every Play scheduled event change must be an object.');
  }

  const reason = normalizeOptionalString(value.reason);
  if (!reason) {
    throw new Error('Every Play scheduled event change requires a reason.');
  }

  switch (value.type) {
    case 'schedule': {
      assertPlayScheduledEventChangeFields(value, [
        'type',
        'label',
        'trigger',
        'template',
        'reason',
        'priority',
      ]);
      const label = normalizeOptionalString(value.label);
      if (!label) {
        throw new Error('A Play schedule change requires a label.');
      }
      return {
        type: 'schedule',
        label,
        trigger: normalizePlayEventTrigger(value.trigger),
        template: normalizePlayScheduledEventTemplate(value.template),
        reason,
        ...readOptionalSchedulePriority(value.priority),
      };
    }
    case 'cancel':
      assertPlayScheduledEventChangeFields(value, [
        'type',
        'scheduledEventId',
        'reason',
      ]);
      return {
        type: 'cancel',
        scheduledEventId: normalizeRequiredScheduleId(value.scheduledEventId),
        reason,
      };
    case 'reschedule':
      assertPlayScheduledEventChangeFields(value, [
        'type',
        'scheduledEventId',
        'trigger',
        'reason',
        'priority',
      ]);
      return {
        type: 'reschedule',
        scheduledEventId: normalizeRequiredScheduleId(value.scheduledEventId),
        trigger: normalizePlayEventTrigger(value.trigger),
        reason,
        ...readOptionalSchedulePriority(value.priority),
      };
    default:
      throw new Error(`Unsupported Play scheduled event change type: ${String(value.type)}.`);
  }
}

function assertPlayScheduledEventChangeFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const known = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length) {
    throw new Error(
      `Play scheduled event change contains unknown fields: ${unknown.join(', ')}.`,
    );
  }
}

function normalizeRequiredScheduleId(value: unknown): string {
  const id = normalizeOptionalString(value);
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) || id.includes('..')) {
    throw new Error('Play scheduled event change requires a safe scheduledEventId.');
  }
  return id;
}

function readOptionalSchedulePriority(
  value: unknown,
): { priority?: number } {
  if (value === undefined) {
    return {};
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error('Play scheduled event priority must be a safe integer.');
  }
  return { priority: value as number };
}

function assertSettlementMatchesEventPolicy(
  session: PlaySession,
  settlement: PlayWorldRefereeSettlement,
  dueEvents: readonly PlayScheduledEvent[],
): void {
  const dueIds = new Set(dueEvents.map((event) => event.id));
  const budgetedEvents = settlement.events.filter((event) =>
    !event.cause.triggerId || !dueIds.has(event.cause.triggerId));
  if (budgetedEvents.length > session.eventPolicy.maxExternalEventsPerTurn) {
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

  const hasHiddenSchedule = settlement.scheduledEventChanges.some(
    (change) => change.type === 'schedule' && change.template.visibility === 'playerUnknown',
  );
  if (hasHiddenSchedule && !session.eventPolicy.allowHidden) {
    throw new Error('Play settlement schedules a hidden event while hidden events are disabled.');
  }
  if (hasHiddenSchedule && !session.eventPolicy.allowOffscreen) {
    throw new Error('Play settlement schedules an offscreen event while offscreen events are disabled.');
  }
}

function materializePlayScheduledEvents(input: {
  session: PlaySession;
  settlement: PlayWorldRefereeSettlement;
  events: PlayWorldEvent[];
  revision: number;
  worldTurn: number;
  refereeTurnId: string;
}): PlayScheduledEvent[] {
  const eventIdsByTrigger = new Map<string, string[]>();
  for (const event of input.events) {
    const triggerId = event.cause.triggerId;
    if (!triggerId) {
      continue;
    }
    eventIdsByTrigger.set(triggerId, [
      ...(eventIdsByTrigger.get(triggerId) ?? []),
      event.id,
    ]);
  }

  const scheduledEvents = input.session.scheduledEvents.map((scheduledEvent) => {
    const occurredEventIds = eventIdsByTrigger.get(scheduledEvent.id);
    if (!occurredEventIds) {
      return { ...scheduledEvent };
    }
    return {
      ...scheduledEvent,
      status: 'occurred' as const,
      occurredEventIds,
      resolvedAtTurnId: input.refereeTurnId,
    };
  });
  const scheduledIds = new Set(scheduledEvents.map((event) => event.id));
  let createdIndex = 0;

  for (const change of input.settlement.scheduledEventChanges) {
    if (change.type === 'schedule') {
      createdIndex += 1;
      let id = `scheduled-${input.revision}-${createdIndex}`;
      while (scheduledIds.has(id)) {
        createdIndex += 1;
        id = `scheduled-${input.revision}-${createdIndex}`;
      }
      scheduledIds.add(id);
      scheduledEvents.push({
        id,
        label: change.label,
        trigger: change.trigger,
        template: change.template,
        status: 'scheduled',
        scheduledAtTurn: input.worldTurn,
        scheduledAtRevision: input.revision,
        sourceTurnId: input.refereeTurnId,
        changeReason: change.reason,
        ...(change.priority !== undefined ? { priority: change.priority } : {}),
      });
      continue;
    }

    const index = scheduledEvents.findIndex((event) =>
      event.id === change.scheduledEventId);
    const existing = scheduledEvents[index];
    if (!existing) {
      throw new Error(
        `Play scheduled event disappeared during settlement: ${change.scheduledEventId}.`,
      );
    }
    if (change.type === 'cancel') {
      scheduledEvents[index] = {
        ...existing,
        status: 'cancelled',
        resolvedAtTurnId: input.refereeTurnId,
        resolutionReason: change.reason,
      };
      continue;
    }
    scheduledEvents[index] = {
      ...existing,
      trigger: change.trigger,
      status: 'scheduled',
      scheduledAtTurn: input.worldTurn,
      scheduledAtRevision: input.revision,
      sourceTurnId: input.refereeTurnId,
      changeReason: change.reason,
      ...(change.priority !== undefined
        ? { priority: change.priority }
        : existing.priority !== undefined
          ? { priority: existing.priority }
          : {}),
    };
  }

  return normalizePlayScheduledEvents(scheduledEvents);
}

function assertSettlementScheduleReferences(
  session: PlaySession,
  settlement: PlayWorldRefereeSettlement,
  dueEvents: readonly PlayScheduledEvent[],
): void {
  const dueById = new Map(dueEvents.map((event) => [event.id, event]));
  const settledDueIds = new Set<string>();

  for (const event of settlement.events) {
    const triggerId = event.cause.triggerId;
    if (!triggerId) {
      continue;
    }
    const scheduledEvent = dueById.get(triggerId);
    if (!scheduledEvent) {
      throw new Error(`Play event references a scheduled trigger that is not due: ${triggerId}.`);
    }
    if (settledDueIds.has(triggerId)) {
      throw new Error(`Play settlement resolves hard-due event more than once: ${triggerId}.`);
    }
    assertDueEventMatchesTemplate(event, scheduledEvent);
    settledDueIds.add(triggerId);
  }

  const missingDueEvent = dueEvents.find((event) => !settledDueIds.has(event.id));
  if (missingDueEvent) {
    throw new Error(`Play settlement omitted hard-due event: ${missingDueEvent.id}.`);
  }

  const scheduledById = new Map(session.scheduledEvents.map((event) => [event.id, event]));
  const changedIds = new Set<string>();
  for (const change of settlement.scheduledEventChanges) {
    if (change.type === 'schedule') {
      continue;
    }
    if (changedIds.has(change.scheduledEventId)) {
      throw new Error(
        `Play settlement changes scheduled event more than once: ${change.scheduledEventId}.`,
      );
    }
    changedIds.add(change.scheduledEventId);
    const existing = scheduledById.get(change.scheduledEventId);
    if (!existing || existing.status !== 'scheduled') {
      throw new Error(
        `Play settlement references an unavailable scheduled event: ${change.scheduledEventId}.`,
      );
    }
    if (dueById.has(change.scheduledEventId)) {
      throw new Error(
        `Hard-due Play event cannot be cancelled or rescheduled: ${change.scheduledEventId}.`,
      );
    }
  }
}

function assertDueEventMatchesTemplate(
  event: PlayWorldRefereeSettlementEvent,
  scheduledEvent: PlayScheduledEvent,
): void {
  const template = scheduledEvent.template;
  if (
    event.kind !== template.kind ||
    event.origin !== template.origin ||
    event.title !== template.title ||
    event.visibility !== template.visibility
  ) {
    throw new Error(
      `Play hard-due event does not match its host template: ${scheduledEvent.id}.`,
    );
  }
}

function assertSettlementCauseReferences(
  facts: Pick<ValidatedPlayTurnFacts, 'selectedMessageIds' | 'selectedEventIds'>,
  settlement: PlayWorldRefereeSettlement,
  currentUserTurnId: string,
): void {
  const knownTurnIds = new Set(facts.selectedMessageIds);
  knownTurnIds.add(currentUserTurnId);
  const knownEventIds = facts.selectedEventIds;

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

function assertPlayWorldEvent(
  value: unknown,
  options: { strict?: boolean } = {},
): PlayWorldEvent {
  if (!isRecord(value)) {
    throw new Error('Stored Play event must be an object.');
  }

  const draft = normalizePlayWorldRefereeEvent(value);
  const id = normalizeStoredPlayFactId(
    value.id,
    'Play event id',
    options.strict === true,
  );
  const turnId = normalizeStoredPlayFactId(
    value.turnId,
    'Play event turnId',
    options.strict === true,
  );
  const createdAt = normalizeOptionalString(value.createdAt);
  const sequence = value.sequence;
  const worldClock = isRecord(value.worldClock)
    ? normalizePlayWorldClock(value.worldClock)
    : undefined;

  if (
    !id ||
    !turnId ||
    !createdAt ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1 ||
    !worldClock
  ) {
    throw new Error('Stored Play event requires id, turnId, sequence, worldClock, and createdAt.');
  }
  if (
    options.strict &&
    (
      !isRecord(value.worldClock) ||
      !Number.isSafeInteger(value.worldClock.turn) ||
      (value.worldClock.turn as number) < 0 ||
      !Number.isSafeInteger(value.worldClock.revision) ||
      (value.worldClock.revision as number) < 0
    )
  ) {
    throw new Error(`Stored Play event ${id} requires a valid world clock.`);
  }
  if (options.strict && value.canonical !== false) {
    throw new Error(`Stored Play event ${id} must remain non-canonical.`);
  }

  return {
    id,
    turnId,
    sequence: sequence as number,
    ...draft,
    worldClock,
    createdAt,
    canonical: false,
  };
}

function assertPlayObservation(
  value: unknown,
  options: { strict?: boolean } = {},
): PlayObservation {
  if (!isRecord(value)) {
    throw new Error('Stored Play observation must be an object.');
  }

  const id = normalizeStoredPlayFactId(
    value.id,
    'Play observation id',
    options.strict === true,
  );
  const summary = normalizeOptionalString(value.summary);
  const evidence = normalizeOptionalString(value.evidence);
  if (!id || !summary || !evidence) {
    throw new Error('Stored Play observation requires id, summary, and evidence.');
  }
  const visibility = normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES);
  if (options.strict && !visibility) {
    throw new Error(
      `Stored Play observation ${id} requires a valid visibility.`,
    );
  }
  if (options.strict && value.canonical !== false) {
    throw new Error(`Stored Play observation ${id} must remain non-canonical.`);
  }

  return {
    id,
    summary,
    evidence,
    visibility: visibility ?? 'playerVisible',
    sourceTurnIds: normalizePlayProvenanceIdList(
      value.sourceTurnIds,
      'sourceTurnIds',
      `Play observation ${id}`,
      options.strict === true,
    ),
    sourceEventIds: normalizePlayProvenanceIdList(
      value.sourceEventIds,
      'sourceEventIds',
      `Play observation ${id}`,
      options.strict === true,
    ),
    canonical: false,
  };
}

function assertPlayAdoptionCandidate(
  value: unknown,
  options: { strict?: boolean } = {},
): PlayAdoptionCandidate {
  if (!isRecord(value)) {
    throw new Error('Stored Play adoption candidate must be an object.');
  }

  const id = normalizeStoredPlayFactId(
    value.id,
    'Play adoption candidate id',
    options.strict === true,
  );
  const target = normalizeEnum(value.target, PLAY_ADOPTION_TARGETS);
  const summary = normalizeOptionalString(value.summary);
  const evidence = normalizeOptionalString(value.evidence);
  if (!id || !target || !summary || !evidence) {
    throw new Error('Stored Play adoption candidate is incomplete.');
  }
  const visibility = normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES);
  if (options.strict && !visibility) {
    throw new Error(
      `Stored Play adoption candidate ${id} requires a valid visibility.`,
    );
  }
  if (options.strict && value.requiresPendingAction !== true) {
    throw new Error(
      `Stored Play adoption candidate ${id} must require a PendingAction.`,
    );
  }
  if (options.strict && value.payload !== undefined && !isRecord(value.payload)) {
    throw new Error(`Stored Play adoption candidate ${id} has an invalid payload.`);
  }

  return createPlayAdoptionCandidate({
    id,
    target,
    summary,
    evidence,
    ...(isRecord(value.payload) ? { payload: { ...value.payload } } : {}),
    visibility: visibility ?? 'playerVisible',
    sourceObservationIds: normalizePlayProvenanceIdList(
      value.sourceObservationIds,
      'sourceObservationIds',
      `Play adoption candidate ${id}`,
      options.strict === true,
    ),
    sourceTurnIds: normalizePlayProvenanceIdList(
      value.sourceTurnIds,
      'sourceTurnIds',
      `Play adoption candidate ${id}`,
      options.strict === true,
    ),
    sourceEventIds: normalizePlayProvenanceIdList(
      value.sourceEventIds,
      'sourceEventIds',
      `Play adoption candidate ${id}`,
      options.strict === true,
    ),
  });
}

function normalizeStoredPlayFactId(
  value: unknown,
  label: string,
  strict: boolean,
): string | undefined {
  const normalized = strict
    ? value
    : normalizeOptionalString(value);
  if (normalized === undefined) {
    return undefined;
  }
  return assertSafePlayStoredFactId(normalized, label);
}

function normalizePlayProvenanceIdList(
  value: unknown,
  field: 'sourceObservationIds' | 'sourceTurnIds' | 'sourceEventIds',
  ownerLabel: string,
  strict: boolean,
): string[] {
  if (strict) {
    if (!Array.isArray(value) || value.length > 24) {
      throw new Error(`${ownerLabel} ${field} must be an array of at most 24 ids.`);
    }
    const ids = value.map((id) => assertSafePlayStoredFactId(
      id,
      `${ownerLabel} ${field}`,
    ));
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${ownerLabel} ${field} must not contain duplicates.`);
    }
    return ids;
  }

  return [...new Set(normalizeStringList(value, 24).filter((id) =>
    isSafePlayStoredFactId(id)))];
}

function assertSafePlayStoredFactId(value: unknown, label: string): string {
  if (!isSafePlayStoredFactId(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function isSafePlayStoredFactId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
    !value.includes('..') &&
    !value.includes('/') &&
    !value.includes('\\');
}

function readOptionalCauseReferences(
  cause: Record<string, unknown>,
): Omit<PlayWorldEventCause, 'reason'> {
  const sourceTurnIds = normalizeUniquePlayCauseIds(
    cause.sourceTurnIds,
    'sourceTurnIds',
  );
  const sourceEventIds = normalizeUniquePlayCauseIds(
    cause.sourceEventIds,
    'sourceEventIds',
  );
  const triggerId = normalizeOptionalPlayCauseId(cause.triggerId, 'triggerId');
  const pressureId = normalizeOptionalPlayCauseId(cause.pressureId, 'pressureId');
  const agendaId = normalizeOptionalPlayCauseId(cause.agendaId, 'agendaId');

  return {
    ...(sourceTurnIds.length ? { sourceTurnIds } : {}),
    ...(sourceEventIds.length ? { sourceEventIds } : {}),
    ...(triggerId ? { triggerId } : {}),
    ...(pressureId ? { pressureId } : {}),
    ...(agendaId ? { agendaId } : {}),
  };
}

function normalizeUniquePlayCauseIds(
  value: unknown,
  field: 'sourceTurnIds' | 'sourceEventIds',
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 24) {
    throw new Error(`Play event cause ${field} must be an array of at most 24 ids.`);
  }
  const ids = value.map((id) => assertSafePlayCauseId(id, field));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Play event cause ${field} must not contain duplicates.`);
  }
  return ids;
}

function normalizeOptionalPlayCauseId(
  value: unknown,
  field: 'triggerId' | 'pressureId' | 'agendaId',
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertSafePlayCauseId(value, field);
}

function assertSafePlayCauseId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error(`Invalid Play event cause ${field}.`);
  }
  return value;
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

function normalizeOptionalNonNegativeInteger(
  value: unknown,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Play branch snapshot watermark must be a non-negative integer.');
  }
  return value;
}

function clonePlayLocalState(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return structuredClone(value);
}

function mergePlayLocalState(
  base: Record<string, unknown>,
  delta: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...clonePlayLocalState(base),
    ...clonePlayLocalState(delta),
  };
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
