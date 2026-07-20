import { randomUUID } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import { access, copyFile, cp, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import { assertSafePlayNarrativePrefix } from './play-narrative-stream.js';
import { createPlayAdoptionSourceBase } from './play-adoption.js';
import {
  PLAY_KNOWLEDGE_STATE_KEY,
  applyPlayKnowledgeChanges,
  listPlayKnowledgeRevealCandidates,
  normalizePlayKnowledgeChanges,
  readPlayKnowledgeState,
} from './play-knowledge.js';
import type { PlayKnowledgeChange } from './play-knowledge.js';
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
  PLAY_WORLD_MOMENTUM_STATE_KEY,
  applyPlayWorldMomentumChanges,
  evaluatePlayEligibleWorldEvents,
  formatPlayRelativeTimeAdvance,
  normalizePlayAgendaChanges,
  normalizePlayPressureChanges,
  normalizePlayRelativeTimeAdvance,
  normalizePlayWorldMomentum,
  readPlayWorldMomentum,
} from './play-world-momentum.js';
import type {
  PlayAgendaChange,
  PlayEligibleWorldEventEvaluation,
  PlayPressureChange,
} from './play-world-momentum.js';
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
  PlayRelativeTimeAdvance,
  PlaySimulationMode,
  PlaySourceTrust,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldEventCause,
  PlayWorldRefereeSettlementEvent,
  PlayWorldMomentum,
} from './play-types.js';
import {
  PLAY_REHEARSAL_SCENES_DIRECTORY,
  PLAY_REHEARSAL_SCENE_SCHEMA_VERSION,
  PLAY_REHEARSAL_SIDECAR_FILE,
  PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION,
  PLAY_REHEARSAL_SESSION_SCHEMA_VERSION,
  assertSafePlayRehearsalId,
  normalizePlayCommittedSceneEvidence,
  normalizePlaySceneRehearsalSidecar,
} from './play-rehearsal.js';
import {
  PLAY_CONTEXT_TRACES_DIRECTORY,
  normalizePlayTurnContextTrace,
  writePlayContextTraceToStage,
} from './play-context-trace.js';
import type { PlayTurnContextTrace } from './play-context-trace.js';
import { summarizePlaySession } from './play-session-read-model.js';
import type { PlaySessionSummary } from './play-session-read-model.js';
import type {
  PlayCommittedSceneEvidence,
  PlayRehearsalParticipant,
  PlaySceneContract,
  PlaySceneKnowledgeEvidence,
  PlaySceneRehearsalSidecar,
  PlayStartMode,
} from './play-rehearsal.js';

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
  PlayAgenda,
  PlayAgendaStatus,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayEventDensity,
  PlayEventOrigin,
  PlayEventPolicy,
  PlayEventVisibility,
  PlayObservation,
  PlayPressure,
  PlayPressureKind,
  PlayPressureStatus,
  PlayRelativeTimeAdvance,
  PlayTimeAdvanceUnit,
  PlaySimulationMode,
  PlaySourceTrust,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldEventCause,
  PlayWorldEventKind,
  PlayWorldRefereeSettlementEvent,
  PlayWorldMomentum,
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
  PLAY_REHEARSAL_SIDECAR_FILE,
] as const;

export const PLAY_SESSION_SCHEMA_VERSION = 4 as const;
export const PLAY_TURNS_DIRECTORY = 'turns' as const;

export type PlaySessionFile = typeof PLAY_SESSION_FILES[number];

export interface PlayWorldRefereeSettlement {
  elapsed?: string;
  worldTimeAnchor?: string;
  events: PlayWorldRefereeSettlementEvent[];
  pressureChanges: PlayPressureChange[];
  agendaChanges: PlayAgendaChange[];
  scheduledEventChanges: PlayWorldRefereeScheduledEventChange[];
  knowledgeChanges: PlayKnowledgeChange[];
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
  timeAdvance?: PlayRelativeTimeAdvance;
  refereeResponse: string;
  createdAt?: string;
}

export interface SettlePlayWorldRefereeSettlementInput {
  session: PlaySession;
  userText: string;
  actionKind: PlayActionKind;
  timeAdvance?: PlayRelativeTimeAdvance;
  narrative: string;
  settlement: PlayWorldRefereeSettlement;
  /** Host-evaluated provisional rehearsal due set; renderer input must never set this. */
  dueScheduledEvents?: PlayScheduledEvent[];
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
  schemaVersion:
    | typeof PLAY_SESSION_SCHEMA_VERSION
    | typeof PLAY_REHEARSAL_SESSION_SCHEMA_VERSION;
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
  sceneRehearsal?: PlaySceneRehearsalSidecar;
  rehearsalScenes?: PlayCommittedSceneEvidence[];
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

export interface WritePlaySessionFilesOptions {
  /**
   * Optional compare-and-swap guard for a staged write. The authoritative
   * session is re-read after the cross-process write lock is acquired, and the
   * same lock is held through the staged directory swap.
   */
  expectedCurrentSession?: PlaySession;
  /**
   * Create-only guard. After the cross-process write lock and recovery have
   * completed, the write fails if an authoritative session already exists.
   */
  expectedAbsent?: boolean;
  /**
   * Optional host-owned context evidence committed inside the same sibling
   * stage as its successful turn artifact. A failed/cancelled turn must never
   * call the writer with this option.
   */
  contextTrace?: PlayTurnContextTrace;
}

export interface PlaySessionFileTransaction {
  read(): Promise<PlaySession>;
  write(
    session: PlaySession,
    options?: WritePlaySessionFilesOptions,
  ): Promise<string[]>;
}

export class PlaySessionWriteConflictError extends Error {
  readonly name = 'PlaySessionWriteConflictError';
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
  worldMomentum?: PlayWorldMomentum;
}

export interface CreatePlaySceneRehearsalSessionInput
  extends Omit<CreatePlaySessionInput, 'worldMomentum'> {
  startMode?: PlayStartMode;
  sceneContract: PlaySceneContract;
  participants: PlayRehearsalParticipant[];
  initialKnowledgeEvidence: PlaySceneKnowledgeEvidence[];
  worldMomentum?: PlayWorldMomentum;
}

export const createPlaySessionDraft = (
  input: CreatePlaySessionInput,
): PlaySession => {
  const worldClock = createDefaultPlayWorldClock();
  const scheduledEvents = normalizePlayBranchBaseScheduledEvents(
    input.scheduledEvents ?? [],
    worldClock,
  );
  const worldMomentum = input.worldMomentum === undefined
    ? undefined
    : normalizePlayWorldMomentum(input.worldMomentum);
  const playLocalState = worldMomentum
    ? { [PLAY_WORLD_MOMENTUM_STATE_KEY]: worldMomentum }
    : {};
  const playLocalStateVisibility: Record<string, PlayEventVisibility> = worldMomentum
    ? { [PLAY_WORLD_MOMENTUM_STATE_KEY]: 'playerUnknown' }
    : {};
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
      playLocalState: clonePlayLocalState(playLocalState),
      playLocalStateVisibility: { ...playLocalStateVisibility },
      scheduledEvents: scheduledEvents.map(clonePlayScheduledEvent),
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState,
    playLocalStateVisibility,
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

export const createPlaySceneRehearsalSessionDraft = (
  input: CreatePlaySceneRehearsalSessionInput,
): PlaySession => {
  const ordinary = createPlaySessionDraft(input);
  const sceneRehearsal = normalizePlaySceneRehearsalSidecar({
    schemaVersion: PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION,
    sessionId: ordinary.id,
    purpose: 'sceneRehearsal',
    startMode: input.startMode ?? 'quick',
    activeSceneRef: input.sceneContract.sceneId,
    sceneContract: input.sceneContract,
    participants: input.participants,
    initialKnowledgeEvidence: input.initialKnowledgeEvidence,
  });
  if (
    sceneRehearsal.sceneContract.worldClock.turn !== ordinary.worldClock.turn ||
    sceneRehearsal.sceneContract.worldClock.revision !== ordinary.worldClock.revision
  ) {
    throw new Error(
      'A new Play rehearsal Scene Contract must use the initial session world clock.',
    );
  }
  return {
    ...ordinary,
    schemaVersion: PLAY_REHEARSAL_SESSION_SCHEMA_VERSION,
    characters: sceneRehearsal.participants.map((participant) =>
      participant.displayName),
    sceneRehearsal,
    rehearsalScenes: [{
      schemaVersion: PLAY_REHEARSAL_SCENE_SCHEMA_VERSION,
      sessionId: ordinary.id,
      sceneId: sceneRehearsal.activeSceneRef,
      turns: [],
    }],
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
  options: WritePlaySessionFilesOptions = {},
): Promise<string[]> => withPlaySessionFileTransaction(
  workspaceRoot,
  session.id,
  (transaction) => transaction.write(session, options),
);

export const withPlaySessionFileTransaction = async <T>(
  workspaceRoot: string,
  sessionIdValue: string,
  operation: (transaction: PlaySessionFileTransaction) => Promise<T>,
): Promise<T> => {
  const sessionId = assertSafePlaySessionId(sessionIdValue);
  const releaseWriteLock = await acquirePlaySessionWriteLock(
    workspaceRoot,
    sessionId,
  );
  try {
    await recoverPlaySessionDirectoryWithLock(workspaceRoot, sessionId);
    return await operation({
      read: () => readPlaySessionFilesWithoutRecovery(workspaceRoot, sessionId),
      write: async (session, options = {}) => {
        if (session.id !== sessionId) {
          throw new Error('Play session transaction cannot cross sessions.');
        }
        if (options.expectedAbsent && options.expectedCurrentSession) {
          throw new Error(
            'Play session writes cannot require both expectedAbsent and expectedCurrentSession.',
          );
        }
        if (options.expectedAbsent) {
          try {
            await readPlaySessionFilesWithoutRecovery(workspaceRoot, sessionId);
            throw new PlaySessionWriteConflictError(
              `Play session already exists: ${sessionId}`,
            );
          } catch (error) {
            if (error instanceof PlaySessionWriteConflictError) throw error;
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        if (options.expectedCurrentSession) {
          const authoritative = await readPlaySessionFilesWithoutRecovery(
            workspaceRoot,
            sessionId,
          );
          if (!isDeepStrictEqual(authoritative, options.expectedCurrentSession)) {
            throw new PlaySessionWriteConflictError(
              `Play session ${sessionId} changed before the staged write could commit.`,
            );
          }
        }
        return writePlaySessionFilesWithLock(
          workspaceRoot,
          session,
          options.contextTrace,
        );
      },
    });
  } finally {
    await releaseWriteLock();
  }
};

const writePlaySessionFilesWithLock = async (
  workspaceRoot: string,
  session: PlaySession,
  contextTrace?: PlayTurnContextTrace,
): Promise<string[]> => {
  const rehearsalState = normalizePlaySessionRehearsalState(session);

  const normalizedObservations = session.observations.map((observation) =>
    assertPlayObservation(observation, { strict: true }));
  const normalizedAdoptionCandidates = session.adoptionCandidates.map((candidate) =>
    assertPlayAdoptionCandidate(candidate, { strict: true }));
  const normalizedSession: PlaySession = {
    ...session,
    observations: normalizedObservations,
    adoptionCandidates: normalizedAdoptionCandidates,
    ...(rehearsalState
      ? {
          sceneRehearsal: rehearsalState.sidecar,
          rehearsalScenes: rehearsalState.scenes,
        }
      : {}),
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
  const normalizedContextTrace = contextTrace === undefined
    ? undefined
    : normalizePlayTurnContextTrace(contextTrace);
  if (normalizedContextTrace) {
    const selectedArtifactId = sessionForWrite.selectedTurnIds.at(-1);
    if (
      normalizedContextTrace.sessionId !== sessionForWrite.id ||
      normalizedContextTrace.sessionRevision !== sessionForWrite.revision ||
      normalizedContextTrace.artifactId !== selectedArtifactId ||
      !sessionForWrite.turnArtifacts.some((artifact) =>
        artifact.id === normalizedContextTrace.artifactId)
    ) {
      throw new Error(
        'Play context trace must match the committed selected turn artifact.',
      );
    }
  }
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
    ...(rehearsalState
      ? [
          [
            PLAY_REHEARSAL_SIDECAR_FILE,
            stringify(rehearsalState.sidecar),
          ] as [string, string],
          ...rehearsalState.scenes.map((scene) => [
            join(PLAY_REHEARSAL_SCENES_DIRECTORY, `${scene.sceneId}.yaml`),
            stringify(scene),
          ] as [string, string]),
        ]
      : []),
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
    await copyPlaySessionRecoveryState(sessionRoot, stageRoot);
    await copyPlaySessionReports(sessionRoot, stageRoot);
    await copyPlaySessionMemories(sessionRoot, stageRoot);
    await copyPlaySessionContextTraces(sessionRoot, stageRoot);
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
    if (normalizedContextTrace) {
      const existingTracePath = join(
        stageRoot,
        PLAY_CONTEXT_TRACES_DIRECTORY,
        `${normalizedContextTrace.artifactId}.context.yaml`,
      );
      try {
        const existingTrace = normalizePlayTurnContextTrace(
          parse(await readFile(existingTracePath, 'utf-8')),
        );
        if (!isDeepStrictEqual(existingTrace, normalizedContextTrace)) {
          throw new Error(
            `Play context trace is immutable: ${normalizedContextTrace.artifactId}.`,
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await writePlayContextTraceToStage(stageRoot, normalizedContextTrace);
    }
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
): Promise<PlaySession> => withPlaySessionFileTransaction(
  workspaceRoot,
  sessionId,
  (transaction) => transaction.read(),
);

const readPlaySessionFilesWithoutRecovery = async (
  workspaceRoot: string,
  sessionId: string,
): Promise<PlaySession> => {
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
    sceneRehearsalSidecarVersion?: number;
  }>(workspaceRoot, sessionId, 'session.yaml');
  assertSupportedPlaySessionSchemaVersion(metadata.schemaVersion);
  const sourceSchemaVersion = normalizeStoredPlaySessionSchemaVersion(
    metadata.schemaVersion,
  );
  if (metadata.id !== sessionId) {
    throw new Error(`Play session metadata id mismatch: expected ${sessionId}.`);
  }
  const sessionRoot = dirname(resolvePlaySessionPath(
    workspaceRoot,
    sessionId,
    'session.yaml',
  ));
  const rehearsalSidecarPath = join(sessionRoot, PLAY_REHEARSAL_SIDECAR_FILE);
  const rehearsalScenesRoot = join(sessionRoot, PLAY_REHEARSAL_SCENES_DIRECTORY);
  const hasRehearsalSidecar = await pathExists(rehearsalSidecarPath);
  const hasRehearsalScenes = await pathExists(rehearsalScenesRoot);
  let sceneRehearsal: PlaySceneRehearsalSidecar | undefined;
  let rehearsalScenes: PlayCommittedSceneEvidence[] | undefined;
  if (sourceSchemaVersion === PLAY_REHEARSAL_SESSION_SCHEMA_VERSION) {
    if (
      metadata.sceneRehearsalSidecarVersion !==
        PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION ||
      !hasRehearsalSidecar ||
      !hasRehearsalScenes
    ) {
      throw new Error(
        'Play session v5 requires a matching scene rehearsal sidecar and scenes directory.',
      );
    }
    sceneRehearsal = normalizePlaySceneRehearsalSidecar(
      parse(await readFile(rehearsalSidecarPath, 'utf-8')),
    );
    rehearsalScenes = await readPlayCommittedScenesFromSessionRoot(sessionRoot);
  } else if (
    metadata.sceneRehearsalSidecarVersion !== undefined ||
    hasRehearsalSidecar ||
    hasRehearsalScenes
  ) {
    throw new Error(
      'Play session v1-v4 cannot contain orphan scene rehearsal files.',
    );
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
  const requireStoredVisibility = sourceSchemaVersion >= PLAY_SESSION_SCHEMA_VERSION;
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
    sourceSchemaVersion >= PLAY_SESSION_SCHEMA_VERSION
      ? requirePlayBranchSnapshotWatermark(
          metadata.branchSnapshotRequiredFromRevision,
        )
      : revision;
  const branchBaseSnapshot = sourceSchemaVersion >= PLAY_SESSION_SCHEMA_VERSION
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
    sceneRehearsal,
    rehearsalScenes,
  });
  const transcript = validatedFacts.transcript;

  const restoredSession: PlaySession = {
    schemaVersion: sourceSchemaVersion === PLAY_REHEARSAL_SESSION_SCHEMA_VERSION
      ? PLAY_REHEARSAL_SESSION_SCHEMA_VERSION
      : PLAY_SESSION_SCHEMA_VERSION,
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
    ...(sceneRehearsal && rehearsalScenes
      ? { sceneRehearsal, rehearsalScenes }
      : {}),
  };
  const launchMetadata = restoredSession.metadataExtensions.playLaunch;
  if (
    isRecord(launchMetadata) &&
    (
      (restoredSession.schemaVersion === PLAY_REHEARSAL_SESSION_SCHEMA_VERSION &&
        launchMetadata.purpose !== 'sceneRehearsal') ||
      (restoredSession.schemaVersion === PLAY_SESSION_SCHEMA_VERSION &&
        launchMetadata.purpose !== 'immersiveJourney')
    )
  ) {
    throw new Error(
      'Play launch session metadata purpose does not match the parent session schema.',
    );
  }
  if (isRecord(launchMetadata)) {
    const sourceIds = restoredSession.activatedSources.map((source) => source.sourceId);
    if (
      sourceIds.length === 0 ||
      new Set(sourceIds).size !== sourceIds.length ||
      restoredSession.activatedSources.some((source) =>
        !source.contentHash || !source.role)
    ) {
      throw new Error(
        'Guided Play sessions require unique activated source hash and role evidence.',
      );
    }
  }
  normalizePlaySessionRehearsalState(restoredSession);
  return restoredSession;
};

export const previewPlaySessionMigration = async (
  workspaceRoot: string,
  sessionId: string,
): Promise<PlaySessionMigrationPreview | undefined> => {
  const releaseReadLock = await acquirePlaySessionWriteLock(
    workspaceRoot,
    sessionId,
  );
  try {
    await recoverPlaySessionDirectoryWithLock(workspaceRoot, sessionId);
    const sessionRoot = dirname(resolvePlaySessionPath(
      workspaceRoot,
      sessionId,
      'session.yaml',
    ));
    return await readStoredPlaySessionMigrationPreview(sessionRoot);
  } finally {
    await releaseReadLock();
  }
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

export const listPlaySessionSummaries = async (
  workspaceRoot: string,
): Promise<PlaySessionSummary[]> => {
  const summaries = (await listPlaySessions(workspaceRoot))
    .map(summarizePlaySession);

  return summaries.sort((left, right) =>
    right.latestActivityAt.localeCompare(left.latestActivityAt));
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

export interface PlayWorldRefereeTurnContext {
  actionKind?: PlayActionKind;
  userText?: string;
  timeAdvance?: PlayRelativeTimeAdvance;
}

export const evaluatePlaySessionEligibleEvents = (
  session: PlaySession,
  turn: PlayWorldRefereeTurnContext = {},
): PlayEligibleWorldEventEvaluation => {
  const actionKind = turn.actionKind ?? 'do';
  const timeAdvance = turn.timeAdvance === undefined
    ? undefined
    : normalizePlayRelativeTimeAdvance(turn.timeAdvance);
  assertPlayTimeAdvanceMatchesAction(actionKind, timeAdvance);
  const facts = materializePlayTurnFacts(session);
  return evaluatePlayEligibleWorldEvents({
    momentum: readPlayWorldMomentum(facts.selectedPlayLocalState),
    eventPolicy: session.eventPolicy,
    actionKind,
    ...(timeAdvance ? { timeAdvance } : {}),
    sceneEntityIds: session.characters,
  });
};

export const formatPlayWorldRefereePrompt = (
  session: PlaySession,
  turn: PlayWorldRefereeTurnContext = {},
): string => {
  const facts = materializePlayTurnFacts(session);
  const selectedEvents = session.events.filter((event) =>
    facts.selectedEventIds.has(event.id));
  const revision = resolvePlaySessionRevision(session, facts.turnArtifacts);
  const scheduleEvaluation = evaluatePlaySessionDueEvents(session);
  const momentum = readPlayWorldMomentum(facts.selectedPlayLocalState);
  const revealCandidates = listPlayKnowledgeRevealCandidates({
    playLocalState: facts.selectedPlayLocalState,
    selectedEvents,
  });
  const eligibleEvaluation = evaluatePlaySessionEligibleEvents(session, turn);
  const timeAdvance = turn.timeAdvance === undefined
    ? undefined
    : normalizePlayRelativeTimeAdvance(turn.timeAdvance);

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
    `Turn action: ${turn.actionKind ?? 'do'}; requested elapsed ${timeAdvance ? formatPlayRelativeTimeAdvance(timeAdvance) : 'unspecified'}`,
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
    'Selected-branch hidden events eligible for an explicit causal reveal:',
    ...(revealCandidates.length
      ? revealCandidates.map((candidate) =>
          `- ${candidate.subjectEventId} [current ${candidate.currentPlayerProjection}/${candidate.kind}] ${candidate.title}: ${candidate.summary}; cause: ${candidate.reason}`,
        )
      : ['- none']),
    'To reveal one candidate, emit exactly one knowledgeChanges revealEvent item and exactly one current informationSpread event at the same target visibility whose cause.sourceEventIds contains that subjectEventId. Never copy hidden source details into Player-facing prose.',
    '',
    'World momentum records (referee knowledge; never leak playerUnknown entries):',
    ...(momentum.pressures.length
      ? momentum.pressures.map((pressure) =>
          `- pressure ${pressure.id} [${pressure.status}/${pressure.kind}/${pressure.visibility}] ${pressure.label}; next: ${pressure.nextConsequence ?? 'none'}`,
        )
      : ['- pressures: none']),
    ...(momentum.agendas.length
      ? momentum.agendas.map((agenda) =>
          `- agenda ${agenda.id} [${agenda.status}/${agenda.visibility}] ${agenda.ownerEntityId}: ${agenda.goal}; next: ${agenda.nextMove ?? 'none'}; blockers: ${agenda.blockers.join(', ') || 'none'}`,
        )
      : ['- agendas: none']),
    '',
    `Host-eligible world-motion cues (budget ${eligibleEvaluation.effectiveBudget}):`,
    ...(eligibleEvaluation.candidates.length
      ? eligibleEvaluation.candidates.map((candidate) =>
          `- ${candidate.id} [${candidate.visibility}] ${candidate.consequence}; ${candidate.reason}`,
        )
      : ['- none']),
    'A settlement event that realizes one of these cues must set its listed cause.pressureId or cause.agendaId. Do not invent momentum ids. A cue may be realized at most once this turn.',
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
    '3. The JSON fields are: elapsed, worldTimeAnchor, events, pressureChanges, agendaChanges, scheduledEventChanges, knowledgeChanges, stateDelta, observations, suggestedActions.',
    '4. Each event contains kind, origin, title, summary, visibility, and cause: { reason, optional pressureId or agendaId }. Momentum ids must come from the host-eligible list.',
    '5. To create a future consequence, add a scheduledEventChanges item with type schedule, label, trigger, template, reason, and optional priority. To cancel or reschedule a pending item, reference its scheduledEventId and provide a reason.',
    '6. Update an existing pressure or agenda only through pressureChanges / agendaChanges. Each change needs its id, reason, and at least one changed field; every event that cites a pressureId or agendaId must include the matching change. Never write worldMomentum or playKnowledge through stateDelta and never invent a new momentum id.',
    '7. Do not include event ids, turn ids, sequence, timestamps, or canonical flags; the host assigns them.',
    '8. After the turn, observations remain Play-local. Do not adopt them into canon without PendingAction.',
    '9. Player-visible or rumor summaries and observation evidence may describe only perceivable consequences. Keep hidden causal reasoning in event cause and mark truly secret facts playerUnknown.',
    ...(timeAdvance
      ? [`10. This is a typed wait. settlement.elapsed must equal ${formatPlayRelativeTimeAdvance(timeAdvance)} exactly.`]
      : []),
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
  const parsed = parsePlayWorldRefereeResponse(input.refereeResponse);
  return settlePlayWorldRefereeSettlement({
    session: input.session,
    userText: input.userText,
    actionKind: input.actionKind,
    ...(input.timeAdvance ? { timeAdvance: input.timeAdvance } : {}),
    narrative: parsed.narrative,
    settlement: parsed.settlement,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
};

export const settlePlayWorldRefereeSettlement = (
  input: SettlePlayWorldRefereeSettlementInput,
): PlaySession => {
  const userText = input.userText.trim();
  if (!userText) {
    throw new Error('Play turn requires user text.');
  }
  const narrative = input.narrative.trim();
  if (!narrative) {
    throw new Error('Play world referee settlement requires player-visible narrative.');
  }
  const settlement = normalizePlayWorldRefereeSettlement(input.settlement);
  const timeAdvance = input.timeAdvance === undefined
    ? undefined
    : normalizePlayRelativeTimeAdvance(input.timeAdvance);
  assertPlayTimeAdvanceMatchesAction(input.actionKind, timeAdvance);
  if (timeAdvance) {
    const expectedElapsed = formatPlayRelativeTimeAdvance(timeAdvance);
    if (settlement.elapsed !== expectedElapsed) {
      throw new Error(
        `Typed Play wait requires settlement.elapsed ${expectedElapsed}.`,
      );
    }
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const existingFacts = materializePlayTurnFacts(input.session);
  const revision = resolvePlaySessionRevision(
    input.session,
    existingFacts.turnArtifacts,
  ) + 1;
  const turnId = `turn-${revision}`;
  const userTurnId = `${turnId}-user`;
  const refereeTurnId = `${turnId}-referee`;
  const scheduleEvaluation = input.dueScheduledEvents
    ? {
        ...evaluatePlaySessionDueEvents(input.session),
        dueEvents: normalizePlayScheduledEvents(input.dueScheduledEvents),
      }
    : evaluatePlaySessionDueEvents(input.session);
  const eligibleEvaluation = evaluatePlaySessionEligibleEvents(input.session, {
    actionKind: input.actionKind,
    userText,
    ...(timeAdvance ? { timeAdvance } : {}),
  });
  assertSettlementMatchesEventPolicy(
    input.session,
    settlement,
    scheduleEvaluation.dueEvents,
    eligibleEvaluation,
  );
  assertSettlementMomentumReferences(
    settlement,
    eligibleEvaluation,
  );
  assertSettlementScheduleReferences(
    input.session,
    settlement,
    scheduleEvaluation.dueEvents,
  );
  assertSettlementCauseReferences(
    existingFacts,
    settlement,
    userTurnId,
  );
  const worldClock: PlayWorldClock = {
    turn: input.session.worldClock.turn + 1,
    revision,
    ...(settlement.worldTimeAnchor
      ? { anchor: settlement.worldTimeAnchor }
      : input.session.worldClock.anchor
        ? { anchor: input.session.worldClock.anchor }
        : {}),
    ...(timeAdvance
      ? { elapsed: formatPlayRelativeTimeAdvance(timeAdvance) }
      : settlement.elapsed
        ? { elapsed: settlement.elapsed }
      : {}),
  };
  const events: PlayWorldEvent[] = settlement.events.map((event, index) => ({
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
  const nextKnowledge = settlement.knowledgeChanges.length
    ? applyPlayKnowledgeChanges({
        playLocalState: existingFacts.selectedPlayLocalState,
        selectedAncestorEvents: input.session.events.filter((event) =>
          existingFacts.selectedEventIds.has(event.id)),
        currentEvents: events,
        changes: settlement.knowledgeChanges,
        revision,
        refereeTurnId,
      })
    : readPlayKnowledgeState(existingFacts.selectedPlayLocalState);
  const settlementVisibility: PlayEventVisibility = events.some(
    (event) => event.visibility === 'playerUnknown',
  )
    ? 'playerUnknown'
    : events.some((event) => event.visibility === 'rumor')
      ? 'rumor'
      : 'playerVisible';
  const sourceEventIds = events.map((event) => event.id);
  const observations: PlayObservation[] = settlement.observations.map(
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
    settlement,
    events,
    revision,
    worldTurn: worldClock.turn,
    refereeTurnId,
  });
  const previousMomentum = readPlayWorldMomentum(
    existingFacts.selectedPlayLocalState,
  );
  const pressureEventIds = new Map<string, string[]>();
  for (const event of events) {
    const pressureId = event.cause.pressureId;
    if (!pressureId) continue;
    pressureEventIds.set(pressureId, [
      ...(pressureEventIds.get(pressureId) ?? []),
      event.id,
    ]);
  }
  const momentumChanged = settlement.pressureChanges.length > 0 ||
    settlement.agendaChanges.length > 0;
  const nextMomentum = momentumChanged
    ? applyPlayWorldMomentumChanges({
        momentum: previousMomentum,
        pressureChanges: settlement.pressureChanges,
        agendaChanges: settlement.agendaChanges,
        refereeTurnId,
        pressureEventIds,
      })
    : previousMomentum;
  const stateDelta = clonePlayLocalState(settlement.stateDelta);
  if (momentumChanged) {
    stateDelta[PLAY_WORLD_MOMENTUM_STATE_KEY] = nextMomentum;
  }
  if (settlement.knowledgeChanges.length) {
    stateDelta[PLAY_KNOWLEDGE_STATE_KEY] = nextKnowledge;
  }
  const playLocalStateVisibility = {
    ...existingFacts.selectedPlayLocalStateVisibility,
  };
  for (const key of Object.keys(stateDelta)) {
    playLocalStateVisibility[key] = (
      key === PLAY_WORLD_MOMENTUM_STATE_KEY ||
      key === PLAY_KNOWLEDGE_STATE_KEY
    )
      ? 'playerUnknown'
      : settlementVisibility;
  }
  const playLocalState = mergePlayLocalState(
    existingFacts.selectedPlayLocalState,
    stateDelta,
  );
  readPlayWorldMomentum(playLocalState);
  readPlayKnowledgeState(playLocalState);
  const suggestedActions = settlementVisibility === 'playerUnknown'
    ? []
    : [...settlement.suggestedActions];

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
      content: narrative,
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
      ...(timeAdvance ? { timeAdvance } : {}),
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
    stateDelta,
    suggestedActions,
    committedAt: createdAt,
    canonical: false,
  };
  const turnArtifacts = [...existingFacts.turnArtifacts, artifact];
  const selectedTurnIds = [...existingFacts.selectedTurnIds, artifact.id];

  return {
    ...input.session,
    schemaVersion: input.session.schemaVersion,
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
  if (normalizedCandidate.evidenceClosure) {
    const closure = normalizedCandidate.evidenceClosure;
    if (
      closure.sessionId !== session.id ||
      closure.sessionRevision !== session.revision ||
      !isDeepStrictEqual(
        closure.selectedArtifactTurnRefs,
        existingFacts.selectedTurnIds,
      )
    ) {
      throw new Error(
        `Play adoption candidate ${normalizedCandidate.id} evidence closure ` +
        'is stale for the current selected branch.',
      );
    }
    const outOfBranchArtifact = closure.artifactTurnRefs.find((artifactRef) =>
      !existingFacts.selectedTurnIds.includes(artifactRef));
    if (outOfBranchArtifact) {
      throw new Error(
        `Play adoption candidate ${normalizedCandidate.id} references ` +
        `out-of-branch artifact: ${outOfBranchArtifact}.`,
      );
    }
    const sourceBase = createPlayAdoptionSourceBase(session.activatedSources);
    if (
      closure.sourceBaseFingerprint !== sourceBase.sourceBaseFingerprint ||
      !isDeepStrictEqual(closure.sourceSnapshots, sourceBase.sourceSnapshots)
    ) {
      throw new Error(
        `Play adoption candidate ${normalizedCandidate.id} source base is stale.`,
      );
    }
  }
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
    schemaVersion: session.schemaVersion,
    ...(session.schemaVersion === PLAY_REHEARSAL_SESSION_SCHEMA_VERSION
      ? {
          sceneRehearsalSidecarVersion:
            PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION,
        }
      : {}),
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

async function readPlayCommittedScenesFromSessionRoot(
  sessionRoot: string,
): Promise<PlayCommittedSceneEvidence[]> {
  const scenesRoot = join(sessionRoot, PLAY_REHEARSAL_SCENES_DIRECTORY);
  const entries = await readdir(scenesRoot, { withFileTypes: true });
  const unsupportedEntry = entries.find((entry) =>
    !entry.isFile() || !entry.name.endsWith('.yaml'));
  if (unsupportedEntry) {
    throw new Error(
      `Play committed scenes directory contains an unsupported entry: ${unsupportedEntry.name}.`,
    );
  }
  const scenes = await Promise.all(entries
    .map(async (entry) => {
      const sceneId = assertSafePlayRehearsalId(
        entry.name.slice(0, -5),
        'scene file id',
      );
      const scene = normalizePlayCommittedSceneEvidence(
        parse(await readFile(join(scenesRoot, entry.name), 'utf-8')),
      );
      if (scene.sceneId !== sceneId) {
        throw new Error(
          `Play committed scene id mismatch: expected ${sceneId}, found ${scene.sceneId}.`,
        );
      }
      return scene;
    }));
  return scenes.toSorted((left, right) =>
    left.sceneId.localeCompare(right.sceneId));
}

function normalizePlaySessionRehearsalState(
  session: PlaySession,
): {
  sidecar: PlaySceneRehearsalSidecar;
  scenes: PlayCommittedSceneEvidence[];
} | undefined {
  if (session.schemaVersion === PLAY_SESSION_SCHEMA_VERSION) {
    if (session.sceneRehearsal !== undefined || session.rehearsalScenes !== undefined) {
      throw new Error('Play session v4 cannot contain scene rehearsal state.');
    }
    return undefined;
  }
  if (session.schemaVersion !== PLAY_REHEARSAL_SESSION_SCHEMA_VERSION) {
    throw new Error(`Unsupported Play session schemaVersion: ${String(session.schemaVersion)}.`);
  }
  if (!session.sceneRehearsal || !session.rehearsalScenes) {
    throw new Error('Play session v5 requires scene rehearsal state.');
  }
  const sidecar = normalizePlaySceneRehearsalSidecar(session.sceneRehearsal);
  const scenes = session.rehearsalScenes.map(normalizePlayCommittedSceneEvidence);
  if (sidecar.sessionId !== session.id) {
    throw new Error('Play scene rehearsal sidecar belongs to another session.');
  }
  if (scenes.length !== 1 || scenes[0]?.sceneId !== sidecar.activeSceneRef) {
    throw new Error('F1 Play rehearsal requires exactly one matching active scene evidence file.');
  }
  if (scenes[0].sessionId !== session.id) {
    throw new Error('Play committed scene evidence belongs to another session.');
  }
  if (
    sidecar.sceneContract.worldClock.turn !== session.branchBaseSnapshot.worldClock.turn ||
    sidecar.sceneContract.worldClock.revision !==
      session.branchBaseSnapshot.worldClock.revision
  ) {
    throw new Error('Play Scene Contract clock must match the immutable branch base.');
  }
  if (
    sidecar.sceneContract.clockProvenance.kind === 'sessionRevision' &&
    (
      sidecar.sceneContract.clockProvenance.sessionId !== session.id ||
      sidecar.sceneContract.clockProvenance.revision !==
        sidecar.sceneContract.worldClock.revision
    )
  ) {
    throw new Error('Play Scene Contract clock provenance does not match its session.');
  }
  return {
    sidecar,
    scenes,
  };
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
  'sceneRehearsalSidecarVersion',
]);

function readPlaySessionMetadataExtensions(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const extensions = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !PLAY_SESSION_METADATA_KEYS.has(key)),
  );
  if (extensions.playLaunch !== undefined) {
    assertStoredPlayLaunchMetadata(extensions.playLaunch);
  }
  return extensions;
}

function assertStoredPlayLaunchMetadata(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('Play launch session metadata must be an object.');
  }
  const knownFields = new Set([
    'setupId',
    'setupSchemaVersion',
    'purpose',
    'startMode',
  ]);
  const unknownField = Object.keys(value).find((field) => !knownFields.has(field));
  if (unknownField) {
    throw new Error(
      `Play launch session metadata contains unknown field: ${unknownField}.`,
    );
  }
  if (
    typeof value.setupId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value.setupId) ||
    value.setupId.includes('..')
  ) {
    throw new Error('Play launch session metadata setupId is invalid.');
  }
  if (value.setupSchemaVersion !== 1) {
    throw new Error('Unsupported Play launch session metadata version.');
  }
  if (value.purpose !== 'immersiveJourney' && value.purpose !== 'sceneRehearsal') {
    throw new Error('Play launch session metadata purpose is invalid.');
  }
  if (value.startMode !== 'guided') {
    throw new Error('Play launch session metadata startMode must be guided.');
  }
}

function normalizeStoredPlaySessionSchemaVersion(
  value: unknown,
): 1 | 2 | 3 | 4 | 5 {
  if (value === undefined || value === 1) {
    return 1;
  }
  if (
    value === 2 ||
    value === 3 ||
    value === PLAY_SESSION_SCHEMA_VERSION ||
    value === PLAY_REHEARSAL_SESSION_SCHEMA_VERSION
  ) {
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
  if (
    fromSchemaVersion === PLAY_SESSION_SCHEMA_VERSION ||
    fromSchemaVersion === PLAY_REHEARSAL_SESSION_SCHEMA_VERSION
  ) {
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

async function copyPlaySessionRecoveryState(
  sessionRoot: string,
  stageRoot: string,
): Promise<void> {
  const recoveryRoot = join(sessionRoot, '.recovery');
  try {
    await cp(
      recoveryRoot,
      join(stageRoot, '.recovery'),
      {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        filter: (source) => isDurablePlaySessionRecoveryPath(
          recoveryRoot,
          source,
        ),
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function copyPlaySessionReports(
  sessionRoot: string,
  stageRoot: string,
): Promise<void> {
  const reportsRoot = join(sessionRoot, 'reports');
  const allowedFiles = new Set(['outcome.yaml', 'outcome.md']);
  let rootStats: Stats;
  try {
    rootStats = await lstat(reportsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Play reports root must be a real directory.');
  }
  const entries = await readdir(reportsRoot, { withFileTypes: true });
  const unsupported = entries.find((entry) =>
    !allowedFiles.has(entry.name));
  if (unsupported) {
    throw new Error(
      `Play reports directory contains an unsupported entry: ${unsupported.name}.`,
    );
  }
  const names = new Set(entries.map((entry) => entry.name));
  if (names.has('outcome.md') && !names.has('outcome.yaml')) {
    throw new Error('Play outcome markdown cannot exist without authoritative YAML.');
  }
  if (!names.has('outcome.yaml')) return;
  const targetRoot = join(stageRoot, 'reports');
  await mkdir(targetRoot, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(reportsRoot, entry.name);
    const fileStats = await lstat(sourcePath);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !fileStats.isFile() ||
      fileStats.isSymbolicLink()
    ) {
      throw new Error(`Play report must be a regular file: ${entry.name}.`);
    }
    if (fileStats.size > 32 * 1024 * 1024) {
      throw new Error(`Play report exceeds the preservation size limit: ${entry.name}.`);
    }
    await copyFile(sourcePath, join(targetRoot, entry.name));
  }
}

async function copyPlaySessionMemories(
  sessionRoot: string,
  stageRoot: string,
): Promise<void> {
  const memoriesRoot = join(sessionRoot, 'memories');
  const allowedFiles = new Set(['player.yaml', 'director.yaml']);
  let rootStats: Stats;
  try {
    rootStats = await lstat(memoriesRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Play Scene Memory root must be a real directory.');
  }
  const entries = await readdir(memoriesRoot, { withFileTypes: true });
  const unsupported = entries.find((entry) => !allowedFiles.has(entry.name));
  if (unsupported) {
    throw new Error(
      `Play Scene Memory directory contains an unsupported entry: ${unsupported.name}.`,
    );
  }
  if (!entries.length) return;
  const targetRoot = join(stageRoot, 'memories');
  await mkdir(targetRoot, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(memoriesRoot, entry.name);
    const fileStats = await lstat(sourcePath);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !fileStats.isFile() ||
      fileStats.isSymbolicLink()
    ) {
      throw new Error(`Play Scene Memory must be a regular file: ${entry.name}.`);
    }
    if (fileStats.size > 32 * 1024 * 1024) {
      throw new Error(`Play Scene Memory exceeds the size limit: ${entry.name}.`);
    }
    await copyFile(sourcePath, join(targetRoot, entry.name));
  }
}

async function copyPlaySessionContextTraces(
  sessionRoot: string,
  stageRoot: string,
): Promise<void> {
  const tracesRoot = join(sessionRoot, PLAY_CONTEXT_TRACES_DIRECTORY);
  let rootStats: Stats;
  try {
    rootStats = await lstat(tracesRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Play context traces root must be a real directory.');
  }
  const entries = await readdir(tracesRoot, { withFileTypes: true });
  const targetRoot = join(stageRoot, PLAY_CONTEXT_TRACES_DIRECTORY);
  await mkdir(targetRoot, { recursive: true });
  for (const entry of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.context\.yaml$/u.test(entry.name)) {
      throw new Error(
        `Play context traces directory contains an unsupported entry: ${entry.name}.`,
      );
    }
    const sourcePath = join(tracesRoot, entry.name);
    const fileStats = await lstat(sourcePath);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !fileStats.isFile() ||
      fileStats.isSymbolicLink()
    ) {
      throw new Error(`Play context trace must be a regular file: ${entry.name}.`);
    }
    if (fileStats.size > 4 * 1024 * 1024) {
      throw new Error(`Play context trace exceeds the size limit: ${entry.name}.`);
    }
    const trace = normalizePlayTurnContextTrace(
      parse(await readFile(sourcePath, 'utf-8')),
    );
    const artifactId = entry.name.slice(0, -'.context.yaml'.length);
    if (
      trace.sessionId !== basename(sessionRoot) ||
      trace.artifactId !== artifactId
    ) {
      throw new Error(`Play context trace identity does not match: ${entry.name}.`);
    }
    await copyFile(sourcePath, join(targetRoot, entry.name));
  }
}

function isDurablePlaySessionRecoveryPath(
  recoveryRoot: string,
  source: string,
): boolean {
  if (source === recoveryRoot) return true;
  const name = basename(source);
  return name !== '.coordination.lock' &&
    !name.startsWith('.coordination.lock.stale.') &&
    !name.startsWith('.attempt-stage.') &&
    !/^\.attempt\.[^.]+\.tmp$/u.test(name);
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
  const releaseRecoveryLock = await acquirePlaySessionWriteLock(
    workspaceRoot,
    sessionId,
  );
  try {
    await recoverPlaySessionDirectoryWithLock(workspaceRoot, sessionId);
  } finally {
    await releaseRecoveryLock();
  }
}

async function recoverPlaySessionDirectoryWithLock(
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

const PLAY_SESSION_WRITE_LOCKS_DIRECTORY = '.write-locks';
const PLAY_SESSION_WRITE_LOCK_OWNER_FILE = 'owner.json';
const PLAY_SESSION_INCOMPLETE_LOCK_STALE_MS = 30_000;

interface PlaySessionWriteLockOwner {
  token: string;
  pid: number;
  createdAt: string;
}

function resolvePlaySessionWriteLockRoot(
  workspaceRoot: string,
  sessionId: string,
): string {
  return join(
    resolvePlaySessionsRoot(workspaceRoot),
    PLAY_SESSION_WRITE_LOCKS_DIRECTORY,
    `${assertSafePlaySessionId(sessionId)}.lock`,
  );
}

async function acquirePlaySessionWriteLock(
  workspaceRoot: string,
  sessionIdValue: string,
): Promise<() => Promise<void>> {
  const sessionId = assertSafePlaySessionId(sessionIdValue);
  const sessionsRoot = resolvePlaySessionsRoot(workspaceRoot);
  const locksRoot = join(sessionsRoot, PLAY_SESSION_WRITE_LOCKS_DIRECTORY);
  const lockRoot = resolvePlaySessionWriteLockRoot(workspaceRoot, sessionId);
  const ownerPath = join(lockRoot, PLAY_SESSION_WRITE_LOCK_OWNER_FILE);
  const owner: PlaySessionWriteLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  await mkdir(locksRoot, { recursive: true });

  for (let iteration = 0; iteration < 250; iteration += 1) {
    try {
      await mkdir(lockRoot, { recursive: false });
      try {
        await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, {
          encoding: 'utf-8',
          flag: 'wx',
        });
      } catch (error) {
        await rm(lockRoot, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        await removePlaySessionWriteLockIfOwned(lockRoot, owner.token);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await removeStalePlaySessionWriteLock(lockRoot)) continue;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  throw new PlaySessionWriteConflictError(
    `Play session ${sessionId} write lock did not stabilize.`,
  );
}

async function removePlaySessionWriteLockIfOwned(
  lockRoot: string,
  token: string,
): Promise<void> {
  try {
    const raw = await readFile(
      join(lockRoot, PLAY_SESSION_WRITE_LOCK_OWNER_FILE),
      'utf-8',
    );
    if (parsePlaySessionWriteLockOwner(raw)?.token === token) {
      await rm(lockRoot, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function removeStalePlaySessionWriteLock(
  lockRoot: string,
): Promise<boolean> {
  let raw: string | undefined;
  let lockStat: Stats | undefined;
  try {
    lockStat = await stat(lockRoot);
    raw = await readFile(
      join(lockRoot, PLAY_SESSION_WRITE_LOCK_OWNER_FILE),
      'utf-8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        lockStat = await stat(lockRoot);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') return true;
        throw statError;
      }
    } else {
      throw error;
    }
  }
  if (!lockStat) return true;
  let owner = raw ? parsePlaySessionWriteLockOwner(raw) : undefined;
  if (owner && isProcessAlive(owner.pid)) return false;
  if (
    !owner &&
    Date.now() - lockStat.mtimeMs < PLAY_SESSION_INCOMPLETE_LOCK_STALE_MS
  ) {
    return false;
  }
  if (raw === undefined) {
    const staleClaim: PlaySessionWriteLockOwner = {
      token: randomUUID(),
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    try {
      raw = `${JSON.stringify(staleClaim)}\n`;
      await writeFile(
        join(lockRoot, PLAY_SESSION_WRITE_LOCK_OWNER_FILE),
        raw,
        { encoding: 'utf-8', flag: 'wx' },
      );
      owner = staleClaim;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  try {
    const current = await readFile(
      join(lockRoot, PLAY_SESSION_WRITE_LOCK_OWNER_FILE),
      'utf-8',
    );
    if (current !== raw) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
  const observedIdentity = owner?.token ?? [
    lockStat.dev,
    lockStat.ino,
    Math.trunc(lockStat.mtimeMs),
  ].join('-');
  const quarantineRoot = `${lockRoot}.stale.${observedIdentity}`;
  try {
    // Every contender that observed this owner uses the same destination.
    // Keeping the quarantine directory prevents a delayed contender from
    // renaming (and thereby stealing) the replacement live lock.
    await rename(lockRoot, quarantineRoot);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return false;
    throw error;
  }
}

function parsePlaySessionWriteLockOwner(
  raw: string,
): PlaySessionWriteLockOwner | undefined {
  try {
    const value = JSON.parse(raw) as Partial<PlaySessionWriteLockOwner>;
    return typeof value.token === 'string' && value.token.length > 0 &&
      Number.isSafeInteger(value.pid) && (value.pid as number) > 0 &&
      typeof value.createdAt === 'string' && value.createdAt.length > 0
      ? value as PlaySessionWriteLockOwner
      : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
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
    value === PLAY_SESSION_SCHEMA_VERSION ||
    value === PLAY_REHEARSAL_SESSION_SCHEMA_VERSION
  ) {
    return;
  }

  throw new Error(`Unsupported Play session schemaVersion: ${String(value)}.`);
}

export function normalizePlayWorldRefereeSettlement(
  value: unknown,
): PlayWorldRefereeSettlement {
  if (!isRecord(value)) {
    throw new Error('Play settlement must be a JSON object.');
  }

  if (value.events !== undefined && !Array.isArray(value.events)) {
    throw new Error('Play settlement events must be an array.');
  }
  if (value.pressureChanges !== undefined && !Array.isArray(value.pressureChanges)) {
    throw new Error('Play settlement pressureChanges must be an array.');
  }
  if (value.agendaChanges !== undefined && !Array.isArray(value.agendaChanges)) {
    throw new Error('Play settlement agendaChanges must be an array.');
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
  if (value.knowledgeChanges !== undefined && !Array.isArray(value.knowledgeChanges)) {
    throw new Error('Play settlement knowledgeChanges must be an array.');
  }
  if (value.stateDelta !== undefined && !isRecord(value.stateDelta)) {
    throw new Error('Play settlement stateDelta must be an object.');
  }
  if (
    isRecord(value.stateDelta) &&
    (
      Object.hasOwn(value.stateDelta, PLAY_WORLD_MOMENTUM_STATE_KEY) ||
      Object.hasOwn(value.stateDelta, PLAY_KNOWLEDGE_STATE_KEY)
    )
  ) {
    throw new Error(
      'Play settlement must update reserved state through typed changes, not stateDelta.',
    );
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
    pressureChanges: normalizePlayPressureChanges(value.pressureChanges),
    agendaChanges: normalizePlayAgendaChanges(value.agendaChanges),
    scheduledEventChanges: (value.scheduledEventChanges ?? [])
      .map(normalizePlayWorldRefereeScheduledEventChange),
    knowledgeChanges: normalizePlayKnowledgeChanges(value.knowledgeChanges),
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
  eligibleEvaluation: PlayEligibleWorldEventEvaluation,
): void {
  const dueIds = new Set(dueEvents.map((event) => event.id));
  const budgetedEvents = settlement.events.filter((event) =>
    !event.cause.triggerId || !dueIds.has(event.cause.triggerId));
  if (budgetedEvents.length > session.eventPolicy.maxExternalEventsPerTurn) {
    throw new Error(
      `Play settlement exceeds the event budget of ${session.eventPolicy.maxExternalEventsPerTurn}.`,
    );
  }
  const momentumLinkedEvents = budgetedEvents.filter((event) =>
    event.cause.pressureId || event.cause.agendaId);
  if (momentumLinkedEvents.length > eligibleEvaluation.effectiveBudget) {
    throw new Error(
      `Play settlement exceeds the eligible world-motion budget of ${eligibleEvaluation.effectiveBudget}.`,
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

function assertSettlementMomentumReferences(
  settlement: PlayWorldRefereeSettlement,
  evaluation: PlayEligibleWorldEventEvaluation,
): void {
  const eligiblePressureIds = new Set(
    evaluation.candidates
      .map((candidate) => candidate.pressureId)
      .filter((id): id is string => Boolean(id)),
  );
  const eligibleAgendaIds = new Set(
    evaluation.candidates
      .map((candidate) => candidate.agendaId)
      .filter((id): id is string => Boolean(id)),
  );
  const changedPressureIds = new Set(
    settlement.pressureChanges.map((change) => change.pressureId),
  );
  const changedAgendaIds = new Set(
    settlement.agendaChanges.map((change) => change.agendaId),
  );
  const usedPressureIds = new Set<string>();
  const usedAgendaIds = new Set<string>();

  for (const event of settlement.events) {
    const pressureId = event.cause.pressureId;
    const agendaId = event.cause.agendaId;
    if (pressureId) {
      if (!eligiblePressureIds.has(pressureId)) {
        throw new Error(`Play event references ineligible pressure: ${pressureId}.`);
      }
      if (usedPressureIds.has(pressureId)) {
        throw new Error(`Play settlement realizes pressure more than once: ${pressureId}.`);
      }
      if (!changedPressureIds.has(pressureId)) {
        throw new Error(`Play event must advance referenced pressure: ${pressureId}.`);
      }
      usedPressureIds.add(pressureId);
    }
    if (agendaId) {
      if (!eligibleAgendaIds.has(agendaId)) {
        throw new Error(`Play event references ineligible agenda: ${agendaId}.`);
      }
      if (usedAgendaIds.has(agendaId)) {
        throw new Error(`Play settlement realizes agenda more than once: ${agendaId}.`);
      }
      if (!changedAgendaIds.has(agendaId)) {
        throw new Error(`Play event must advance referenced agenda: ${agendaId}.`);
      }
      usedAgendaIds.add(agendaId);
    }
  }
}

function assertPlayTimeAdvanceMatchesAction(
  actionKind: PlayActionKind,
  timeAdvance?: PlayRelativeTimeAdvance,
): void {
  if (timeAdvance && actionKind !== 'wait') {
    throw new Error('Play time advance requires a wait action.');
  }
}

export function materializePlayScheduledEvents(input: {
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
  if (!source.sourceId.trim()) {
    throw new Error('Play activated source requires a sourceId.');
  }
  if (!source.reason.trim()) {
    throw new Error(`Play activated source ${source.sourceId} requires a reason.`);
  }
  if (
    source.contentHash !== undefined &&
    !/^[a-f0-9]{64}$/u.test(source.contentHash)
  ) {
    throw new Error(
      `Play activated source ${source.sourceId} contentHash must be a SHA-256 hex digest.`,
    );
  }
  if (
    source.role !== undefined &&
    !['chapter', 'character', 'world', 'timeline', 'state', 'other']
      .includes(source.role)
  ) {
    throw new Error(`Play activated source ${source.sourceId} has an invalid role.`);
  }

  return {
    ...source,
    sourceId: source.sourceId.trim(),
    ...(source.path === undefined ? {} : { path: source.path.trim() }),
    ...(source.objectId === undefined ? {} : { objectId: source.objectId.trim() }),
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
