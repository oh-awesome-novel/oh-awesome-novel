import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

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
  assertDueEventMatchesTemplate,
  clonePlayScheduledEvent,
} from './play-event-schedule-history.js';
import {
  PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
  assertSafePlayTurnArtifactId,
  createLegacyPlayTurnArtifacts,
  createPlayTurnArtifactId,
  normalizePlayTurnArtifact,
  projectPlayTranscript,
} from './play-turn-artifact.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import {
  assertPlayAdoptionCandidate,
  assertPlayObservation,
  assertPlayWorldEvent,
  assertScopedPlayFactReferences,
  clonePlayLocalState,
  isRecord,
  materializePlayTurnFacts,
  mergePlayLocalState,
  normalizeNonNegativeInteger,
  normalizeOptionalString,
  normalizePlayBranchBaseScheduledEvents,
  normalizePlayBranchBaseSnapshot,
  normalizePlayLocalStateVisibility,
  normalizePlayWorldClock,
  normalizePlayWorldRefereeEvent,
  normalizeStringList,
  requireExactPlayLocalStateVisibility,
  requirePlayBranchSnapshotWatermark,
  resolvePlaySessionRevision,
  validatePlayTurnFacts,
} from './play-session-facts.js';
import type {
  PlayBranchBaseSnapshot,
  ValidatedPlayTurnFacts,
} from './play-session-facts.js';
import type {
  PlayActionKind,
  PlayActivatedSource,
  PlayAdoptionCandidate,
  PlayEventDensity,
  PlayEventPolicy,
  PlayEventVisibility,
  PlayObservation,
  PlaySimulationMode,
  PlaySourceTrust,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldEventCause,
  PlayWorldRefereeSettlementEvent,
} from './play-types.js';

export { createPlayAdoptionCandidate } from './play-session-facts.js';
export type { PlayBranchBaseSnapshot } from './play-session-facts.js';
export {
  listPlaySessionCheckpoints,
  restorePlaySessionCheckpoint,
} from './play-turn-graph.js';
export type {
  PlayCheckpointStatus,
  PlayCheckpointSummary,
} from './play-turn-graph.js';

export type {
  PlayActionKind,
  PlayActivatedSource,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayEventDensity,
  PlayEventOrigin,
  PlayEventPolicy,
  PlayEventVisibility,
  PlayObservation,
  PlaySimulationMode,
  PlaySourceTrust,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldEventCause,
  PlayWorldEventKind,
  PlayWorldRefereeSettlementEvent,
} from './play-types.js';

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

function formatPromptJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
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
