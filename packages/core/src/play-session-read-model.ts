import { Buffer } from 'node:buffer';

import { materializePlayTurnFacts } from './play-session-facts.js';
import {
  PLAY_KNOWLEDGE_STATE_KEY,
  readPlayKnowledgeState,
} from './play-knowledge.js';
import { PLAY_WORLD_MOMENTUM_STATE_KEY, readPlayWorldMomentum } from './play-world-momentum.js';
import type { PlaySession } from './play-session.js';
import type {
  PlayActionKind,
  PlayActivatedSource,
  PlayAdoptionCandidate,
  PlayEventPolicy,
  PlayEventVisibility,
  PlayObservation,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
} from './play-types.js';
import type {
  PlayEventTrigger,
  PlayScheduledEvent,
} from './play-event-schedule.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type {
  PlayCommittedSceneEvidence,
  PlaySceneRehearsalSidecar,
} from './play-rehearsal.js';

export const DEFAULT_PLAY_DETAIL_WINDOW_LIMIT = 50;
export const MAX_PLAY_DETAIL_WINDOW_LIMIT = 200;
export const MAX_PLAY_EVENT_PRESENTATION_STATE_IMPACTS = 64;
export const MAX_PLAY_EVENT_PRESENTATION_TEXT_LENGTH = 160;

export interface PlaySessionSummary {
  schemaVersion: PlaySession['schemaVersion'];
  id: string;
  title: string;
  createdAt: string;
  latestActivityAt: string;
  revision: number;
  purpose: 'immersiveJourney' | 'sceneRehearsal';
  startMode: 'quick' | 'guided';
  selectedArtifactId?: string;
  selectedTurnCount: number;
  transcriptCount: number;
  eventCount: number;
  worldClock: PlayWorldClock;
  canonical: false;
}

export interface PlayCursorWindow<T> {
  items: T[];
  totalCount: number;
  hasMoreBefore: boolean;
  nextCursor?: string;
}

/**
 * The bounded selected-session read model intentionally omits the historical
 * transcript, event ledger, and turn artifacts. Callers page those through the
 * two cursor windows and keep the legacy full-session endpoint only for
 * workflows that still need the complete immutable branch graph.
 */
export interface PlaySessionSelectedSnapshot {
  schemaVersion: PlaySession['schemaVersion'];
  id: string;
  title: string;
  createdAt: string;
  revision: number;
  userPersona?: string;
  sceneStart: string;
  characters: string[];
  selectedTurnIds: string[];
  branchSnapshotRequiredFromRevision: number;
  metadataExtensions: Record<string, unknown>;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  eventPolicy: PlayEventPolicy;
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
  activatedSources: PlayActivatedSource[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
  sceneRehearsal?: PlaySceneRehearsalSidecar;
  rehearsalScenes?: PlayCommittedSceneEvidence[];
}

export interface PlaySessionSelectedDetail {
  summary: PlaySessionSummary;
  snapshot: PlaySessionSelectedSnapshot;
  transcript: PlayCursorWindow<PlayTranscriptTurn>;
  events: PlayCursorWindow<PlayWorldEvent>;
  eventPresentation: PlayEventPresentationEvidence[];
  selectedArtifactPresentation?: PlaySelectedArtifactPresentation;
}

export interface PlayEventPresentationActionCause {
  actionKind?: PlayActionKind;
  contentExcerpt: string;
}

export interface PlayEventPresentationSourceEventCause {
  title: string;
}

export interface PlayEventPresentationScheduledCause {
  label: string;
  trigger: PlayEventTrigger;
}

export interface PlayEventPresentationPressureCause {
  label: string;
}

export interface PlayEventPresentationAgendaCause {
  ownerEntityId: string;
  summary: string;
}

export interface PlayEventPresentationCauses {
  actions: PlayEventPresentationActionCause[];
  sourceEvents: PlayEventPresentationSourceEventCause[];
  scheduled?: PlayEventPresentationScheduledCause;
  pressure?: PlayEventPresentationPressureCause;
  agenda?: PlayEventPresentationAgendaCause;
}

export interface PlayEventPresentationStateImpact {
  path: string;
  value: string;
}

export interface PlayEventPresentationReveal {
  status: 'rumorSurfaced' | 'informationConfirmed';
}

export interface PlayEventPresentationAuthorReveal {
  recordId: string;
  subjectEventId: string;
  subjectTitle: string;
  subjectSummary: string;
  subjectWorldClock: PlayWorldClock;
  subjectReason?: string;
  revealedByEventId: string;
  previousPlayerProjection: 'playerUnknown' | 'rumor';
  playerProjection: 'rumor' | 'playerVisible';
  knownByParticipantRefs: string[];
}

export interface PlayEventPresentationTechnicalRefs {
  artifactId: string;
  artifactRevision: number;
  turnId: string;
  sourceTurnIds: string[];
  sourceEventIds: string[];
  triggerId?: string;
  pressureId?: string;
  agendaId?: string;
}

export interface PlayEventPresentationAuthorEvidence {
  reason: string;
  technicalRefs: PlayEventPresentationTechnicalRefs;
  hiddenCauses: PlayEventPresentationCauses;
  stateImpacts: PlayEventPresentationStateImpact[];
  stateImpactOmittedCount: number;
  reveal?: PlayEventPresentationAuthorReveal;
}

export interface PlayEventPresentationEvidence {
  eventId: string;
  causes: PlayEventPresentationCauses;
  stateImpacts: PlayEventPresentationStateImpact[];
  stateImpactOmittedCount: number;
  reveal?: PlayEventPresentationReveal;
  author: PlayEventPresentationAuthorEvidence;
}

export interface PlaySelectedArtifactPresentation {
  id: string;
  revision: number;
  eventIds: string[];
  stateDelta: Record<string, unknown>;
  playLocalStateVisibilitySnapshot: Record<string, PlayEventVisibility>;
  rehearsalEvidenceRefs?: string[];
  canonical: false;
}

export interface ProjectPlaySessionSelectedDetailOptions {
  limit?: number;
  transcriptCursor?: string;
  eventCursor?: string;
}

interface PlayWindowCursorPayload {
  version: 1;
  kind: 'transcript' | 'event';
  sessionId: string;
  revision: number;
  selectedHead: string;
  end: number;
}

export function summarizePlaySession(session: PlaySession): PlaySessionSummary {
  const facts = materializePlayTurnFacts(session);
  const selectedEvents = session.events.filter((event) =>
    facts.selectedEventIds.has(event.id));
  const selectedArtifact = facts.selectedTurnIds.length
    ? facts.turnArtifacts.find((artifact) =>
        artifact.id === facts.selectedTurnIds.at(-1))
    : undefined;
  const launch = readLaunchMetadata(session.metadataExtensions);
  const purpose = session.schemaVersion === 5
    ? 'sceneRehearsal'
    : launch?.purpose ?? 'immersiveJourney';
  const startMode = session.schemaVersion === 5
    ? session.sceneRehearsal?.startMode ?? launch?.startMode ?? 'quick'
    : launch?.startMode ?? 'quick';

  return {
    schemaVersion: session.schemaVersion,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    latestActivityAt: selectedArtifact?.committedAt ?? session.createdAt,
    revision: session.revision,
    purpose,
    startMode,
    ...(selectedArtifact ? { selectedArtifactId: selectedArtifact.id } : {}),
    selectedTurnCount: facts.selectedTurnIds.length,
    transcriptCount: facts.transcript.length,
    eventCount: selectedEvents.length,
    worldClock: { ...session.worldClock },
    canonical: false,
  };
}

export function projectPlaySessionSelectedDetail(
  session: PlaySession,
  options: ProjectPlaySessionSelectedDetailOptions = {},
): PlaySessionSelectedDetail {
  const limit = normalizeWindowLimit(options.limit);
  const facts = materializePlayTurnFacts(session);
  const selectedHead = facts.selectedTurnIds.at(-1) ?? 'initial-world';
  const selectedEvents = session.events.filter((event) =>
    facts.selectedEventIds.has(event.id));
  const selectedObservations = session.observations.filter((observation) =>
    facts.selectedObservationIds.has(observation.id));
  const selectedCandidates = session.adoptionCandidates.filter((candidate) =>
    isCandidateOnSelectedBranch(candidate, facts));
  const selectedRehearsalEvidenceIds = new Set(
    facts.selectedRehearsalEvidence.map((evidence) => evidence.id),
  );
  const selectedRehearsalScenes = session.sceneRehearsal &&
      session.rehearsalScenes
    ? session.rehearsalScenes
      .filter((scene) =>
        scene.sceneId === session.sceneRehearsal?.activeSceneRef)
      .map((scene) => ({
        ...structuredClone(scene),
        turns: scene.turns.filter((turn) =>
          selectedRehearsalEvidenceIds.has(turn.id)),
      }))
    : undefined;
  const transcript = createWindow(
    facts.transcript,
    'transcript',
    session,
    selectedHead,
    limit,
    options.transcriptCursor,
  );
  const events = createWindow(
    selectedEvents,
    'event',
    session,
    selectedHead,
    limit,
    options.eventCursor,
  );
  const selectedArtifacts = facts.selectedTurnIds.map((artifactId) => {
    const artifact = facts.turnArtifacts.find((candidate) =>
      candidate.id === artifactId);
    if (!artifact) {
      throw new Error(`Selected Play artifact is missing: ${artifactId}.`);
    }
    return artifact;
  });
  const selectedArtifact = selectedArtifacts.at(-1);

  return {
    summary: summarizePlaySession(session),
    snapshot: {
      schemaVersion: session.schemaVersion,
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      revision: session.revision,
      ...(session.userPersona ? { userPersona: session.userPersona } : {}),
      sceneStart: session.sceneStart,
      characters: [...session.characters],
      selectedTurnIds: [...facts.selectedTurnIds],
      branchSnapshotRequiredFromRevision:
        session.branchSnapshotRequiredFromRevision,
      metadataExtensions: structuredClone(session.metadataExtensions),
      playLocalState: structuredClone(facts.selectedPlayLocalState),
      playLocalStateVisibility: {
        ...facts.selectedPlayLocalStateVisibility,
      },
      worldClock: { ...session.worldClock },
      eventPolicy: { ...session.eventPolicy },
      scheduledEvents: structuredClone(facts.selectedScheduledEvents),
      suggestedActions: [...facts.selectedSuggestedActions],
      activatedSources: structuredClone(session.activatedSources),
      observations: structuredClone(selectedObservations),
      adoptionCandidates: structuredClone(selectedCandidates),
      ...(session.sceneRehearsal
        ? { sceneRehearsal: structuredClone(session.sceneRehearsal) }
        : {}),
      ...(selectedRehearsalScenes
        ? { rehearsalScenes: selectedRehearsalScenes }
        : {}),
    },
    transcript,
    events,
    eventPresentation: projectEventPresentation(
      events.items,
      selectedEvents,
      selectedArtifacts,
    ),
    ...(selectedArtifact
      ? {
          selectedArtifactPresentation:
            projectSelectedArtifactPresentation(selectedArtifact),
        }
      : {}),
  };
}

function projectEventPresentation(
  pageEvents: readonly PlayWorldEvent[],
  selectedEvents: readonly PlayWorldEvent[],
  selectedArtifacts: readonly PlayTurnArtifact[],
): PlayEventPresentationEvidence[] {
  const eventsById = new Map(selectedEvents.map((event) => [event.id, event]));
  const eventIndexes = new Map(selectedEvents.map((event, index) => [event.id, index]));
  const artifactsByEventId = new Map<string, PlayTurnArtifact>();
  const messagesById = new Map<string, PlayTranscriptTurn>();
  for (const artifact of selectedArtifacts) {
    for (const eventId of artifact.eventIds) artifactsByEventId.set(eventId, artifact);
    for (const message of artifact.messages) {
      if (message.id) messagesById.set(message.id, message);
    }
  }

  return pageEvents.map((event) => {
    const artifact = artifactsByEventId.get(event.id);
    if (!artifact) {
      throw new Error(`Selected Play event has no selected artifact: ${event.id}.`);
    }
    const momentum = artifact.playLocalStateSnapshot
      ? readPlayWorldMomentum(artifact.playLocalStateSnapshot)
      : { pressures: [], agendas: [] };
    const scheduled = resolveScheduledCause(event, artifact);
    const pressure = event.cause.pressureId
      ? momentum.pressures.find((candidate) =>
          candidate.id === event.cause.pressureId &&
          candidate.causeRefs.includes(event.id))
      : undefined;
    const agenda = event.cause.agendaId
      ? momentum.agendas.find((candidate) =>
          candidate.id === event.cause.agendaId &&
          candidate.updatedAtTurnId === event.turnId)
      : undefined;
    const actions = (event.cause.sourceTurnIds ?? [])
      .map((messageId) => messagesById.get(messageId))
      .filter((message): message is PlayTranscriptTurn =>
        message !== undefined && isPlayerMessage(message))
      .map((message) => ({
        ...(message.actionKind ? { actionKind: message.actionKind } : {}),
        contentExcerpt: truncatePresentationText(message.content),
      }));
    const sourceEvents = (event.cause.sourceEventIds ?? [])
      .map((eventId) => eventsById.get(eventId))
      .filter((candidate): candidate is PlayWorldEvent => candidate !== undefined);
    const visibleCauses: PlayEventPresentationCauses = {
      actions,
      sourceEvents: sourceEvents
        .filter((candidate) => candidate.visibility !== 'playerUnknown')
        .map((candidate) => ({ title: candidate.title })),
      ...(scheduled && scheduled.template.visibility !== 'playerUnknown'
        ? {
            scheduled: {
              label: scheduled.label,
              trigger: structuredClone(scheduled.trigger),
            },
          }
        : {}),
      ...(pressure && pressure.visibility !== 'playerUnknown'
        ? { pressure: { label: pressure.label } }
        : {}),
      ...(agenda && agenda.visibility !== 'playerUnknown'
        ? {
            agenda: {
              ownerEntityId: agenda.ownerEntityId,
              summary: agenda.nextMove ?? agenda.goal,
            },
          }
        : {}),
    };
    const hiddenCauses: PlayEventPresentationCauses = {
      actions: [],
      sourceEvents: sourceEvents
        .filter((candidate) => candidate.visibility === 'playerUnknown')
        .map((candidate) => ({ title: candidate.title })),
      ...(scheduled && scheduled.template.visibility === 'playerUnknown'
        ? {
            scheduled: {
              label: scheduled.label,
              trigger: structuredClone(scheduled.trigger),
            },
          }
        : {}),
      ...(pressure && pressure.visibility === 'playerUnknown'
        ? { pressure: { label: pressure.label } }
        : {}),
      ...(agenda && agenda.visibility === 'playerUnknown'
        ? {
            agenda: {
              ownerEntityId: agenda.ownerEntityId,
              summary: agenda.nextMove ?? agenda.goal,
            },
          }
        : {}),
    };
    const containsHiddenEvent = artifact.eventIds.some((eventId) =>
      eventsById.get(eventId)?.visibility === 'playerUnknown');
    const allStateImpacts = projectArtifactStateImpacts(artifact, true, {
      momentumChanged: Boolean(pressure || agenda),
    });
    const safeStateImpacts = containsHiddenEvent
      ? []
      : projectArtifactStateImpacts(artifact, false, {
          momentumChanged: false,
        });
    const reveal = projectRevealEvidence(
      event,
      artifact,
      eventsById,
      eventIndexes,
    );

    return {
      eventId: event.id,
      causes: visibleCauses,
      stateImpacts: safeStateImpacts.items,
      stateImpactOmittedCount: safeStateImpacts.omittedCount,
      ...(reveal ? { reveal: reveal.player } : {}),
      author: {
        reason: event.cause.reason,
        technicalRefs: {
          artifactId: artifact.id,
          artifactRevision: artifact.revision,
          turnId: event.turnId,
          sourceTurnIds: [...(event.cause.sourceTurnIds ?? [])],
          sourceEventIds: [...(event.cause.sourceEventIds ?? [])],
          ...(event.cause.triggerId ? { triggerId: event.cause.triggerId } : {}),
          ...(event.cause.pressureId ? { pressureId: event.cause.pressureId } : {}),
          ...(event.cause.agendaId ? { agendaId: event.cause.agendaId } : {}),
        },
        hiddenCauses,
        stateImpacts: allStateImpacts.items,
        stateImpactOmittedCount: allStateImpacts.omittedCount,
        ...(reveal ? { reveal: reveal.author } : {}),
      },
    };
  });
}

function projectSelectedArtifactPresentation(
  artifact: PlayTurnArtifact,
): PlaySelectedArtifactPresentation {
  return {
    id: artifact.id,
    revision: artifact.revision,
    eventIds: [...artifact.eventIds],
    stateDelta: structuredClone(artifact.stateDelta),
    playLocalStateVisibilitySnapshot: {
      ...(artifact.playLocalStateVisibilitySnapshot ?? {}),
    },
    ...(artifact.rehearsalEvidenceRefs
      ? { rehearsalEvidenceRefs: [...artifact.rehearsalEvidenceRefs] }
      : {}),
    canonical: false,
  };
}

function resolveScheduledCause(
  event: PlayWorldEvent,
  artifact: PlayTurnArtifact,
): PlayScheduledEvent | undefined {
  const triggerId = event.cause.triggerId;
  if (!triggerId || !artifact.dueScheduledEventIds.includes(triggerId)) {
    return undefined;
  }
  const scheduled = artifact.scheduledEventSnapshots.find((candidate) =>
    candidate.id === triggerId);
  return scheduled?.status === 'occurred' &&
      scheduled.occurredEventIds?.includes(event.id)
    ? scheduled
    : undefined;
}

function projectArtifactStateImpacts(
  artifact: PlayTurnArtifact,
  author: boolean,
  options: { momentumChanged: boolean },
): {
  items: PlayEventPresentationStateImpact[];
  omittedCount: number;
} {
  const impacts: PlayEventPresentationStateImpact[] = [];
  if (author && options.momentumChanged) {
    impacts.push({
      path: PLAY_WORLD_MOMENTUM_STATE_KEY,
      value: 'Pressure / agenda state updated',
    });
  }
  for (const [rootPath, rootValue] of Object.entries(artifact.stateDelta)) {
    if (
      rootPath === PLAY_WORLD_MOMENTUM_STATE_KEY ||
      rootPath === PLAY_KNOWLEDGE_STATE_KEY
    ) {
      continue;
    }
    const rootVisibility = artifact.playLocalStateVisibilitySnapshot?.[rootPath];
    if (!author && rootVisibility !== 'playerVisible') continue;
    for (const [path, value] of flattenStateValue(rootPath, rootValue)) {
      if (
        !author &&
        artifact.playLocalStateVisibilitySnapshot?.[path] !== undefined &&
        artifact.playLocalStateVisibilitySnapshot[path] !== 'playerVisible'
      ) {
        continue;
      }
      impacts.push({
        path: truncatePresentationText(path),
        value: formatPresentationValue(value),
      });
    }
  }
  return {
    items: impacts.slice(0, MAX_PLAY_EVENT_PRESENTATION_STATE_IMPACTS),
    omittedCount: Math.max(
      0,
      impacts.length - MAX_PLAY_EVENT_PRESENTATION_STATE_IMPACTS,
    ),
  };
}

function projectRevealEvidence(
  event: PlayWorldEvent,
  artifact: PlayTurnArtifact,
  eventsById: ReadonlyMap<string, PlayWorldEvent>,
  eventIndexes: ReadonlyMap<string, number>,
): {
  player: PlayEventPresentationReveal;
  author: PlayEventPresentationAuthorReveal;
} | undefined {
  if (
    event.kind !== 'informationSpread' ||
    !Object.hasOwn(artifact.stateDelta, PLAY_KNOWLEDGE_STATE_KEY)
  ) {
    return undefined;
  }
  const knowledge = readPlayKnowledgeState({
    [PLAY_KNOWLEDGE_STATE_KEY]: artifact.stateDelta[PLAY_KNOWLEDGE_STATE_KEY],
  });
  const matches = knowledge.records.filter((record) =>
    record.kind === 'eventReveal' && record.revealedByEventId === event.id);
  if (matches.length !== 1) return undefined;
  const record = matches[0]!;
  if (record.kind !== 'eventReveal') return undefined;
  const subject = eventsById.get(record.subjectEventId);
  const subjectIndex = subject ? eventIndexes.get(subject.id) : undefined;
  const revealingIndex = eventIndexes.get(event.id);
  if (
    !subject ||
    subject.visibility !== 'playerUnknown' ||
    subjectIndex === undefined ||
    revealingIndex === undefined ||
    subjectIndex >= revealingIndex ||
    subject.worldClock.revision >= event.worldClock.revision ||
    record.revealedAtTurnId !== event.turnId ||
    record.playerProjection !== event.visibility ||
    !event.cause.sourceEventIds?.includes(subject.id)
  ) {
    return undefined;
  }
  const status = record.playerProjection === 'rumor'
    ? 'rumorSurfaced'
    : 'informationConfirmed';
  return {
    player: { status },
    author: {
      recordId: record.id,
      subjectEventId: subject.id,
      subjectTitle: subject.title,
      subjectSummary: subject.summary,
      subjectWorldClock: { ...subject.worldClock },
      ...(subject.cause.reason
        ? { subjectReason: subject.cause.reason }
        : {}),
      revealedByEventId: event.id,
      previousPlayerProjection: record.previousPlayerProjection,
      playerProjection: record.playerProjection,
      knownByParticipantRefs: [...record.knownByParticipantRefs],
    },
  };
}

function flattenStateValue(
  rootPath: string,
  rootValue: unknown,
): Array<[path: string, value: unknown]> {
  const result: Array<[path: string, value: unknown]> = [];
  const pending: Array<[path: string, value: unknown]> = [[rootPath, rootValue]];
  while (pending.length) {
    const [path, value] = pending.pop()!;
    if (Array.isArray(value)) {
      if (!value.length) result.push([path, value]);
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push([`${path}.${index}`, value[index]]);
      }
      continue;
    }
    if (isRecord(value)) {
      const entries = Object.entries(value);
      if (!entries.length) result.push([path, value]);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, nested] = entries[index]!;
        pending.push([`${path}.${key}`, nested]);
      }
      continue;
    }
    result.push([path, value]);
  }
  return result;
}

function formatPresentationValue(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return truncatePresentationText(String(value));
  }
  try {
    return truncatePresentationText(JSON.stringify(value) ?? '[unavailable]');
  } catch {
    return '[unavailable]';
  }
}

function truncatePresentationText(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length <= MAX_PLAY_EVENT_PRESENTATION_TEXT_LENGTH
    ? normalized
    : `${normalized
      .slice(0, MAX_PLAY_EVENT_PRESENTATION_TEXT_LENGTH - 1)
      .trimEnd()}…`;
}

function isPlayerMessage(message: PlayTranscriptTurn): boolean {
  const speaker = message.speaker.trim().toLowerCase();
  return speaker === 'user' || speaker === 'player';
}

function isCandidateOnSelectedBranch(
  candidate: PlayAdoptionCandidate,
  facts: ReturnType<typeof materializePlayTurnFacts>,
): boolean {
  const selectedArtifactIds = new Set(facts.selectedTurnIds);
  if (
    candidate.sourceTurnIds.some((id) => !facts.selectedMessageIds.has(id)) ||
    candidate.sourceEventIds.some((id) => !facts.selectedEventIds.has(id)) ||
    candidate.sourceObservationIds.some((id) =>
      !facts.selectedObservationIds.has(id))
  ) {
    return false;
  }
  if (candidate.seed?.kind === 'event' &&
      !facts.selectedEventIds.has(candidate.seed.eventId)) {
    return false;
  }
  if (candidate.seed?.kind === 'observation' &&
      !facts.selectedObservationIds.has(candidate.seed.observationId)) {
    return false;
  }
  const closure = candidate.evidenceClosure;
  return closure === undefined || (
    closure.selectedArtifactTurnRefs.every((id) => selectedArtifactIds.has(id)) &&
    closure.artifactTurnRefs.every((id) => selectedArtifactIds.has(id)) &&
    closure.messageRefs.every((id) => facts.selectedMessageIds.has(id)) &&
    closure.eventRefs.every((id) => facts.selectedEventIds.has(id)) &&
    closure.observationRefs.every((id) =>
      facts.selectedObservationIds.has(id))
  );
}

function createWindow<T>(
  items: T[],
  kind: PlayWindowCursorPayload['kind'],
  session: PlaySession,
  selectedHead: string,
  limit: number,
  cursor: string | undefined,
): PlayCursorWindow<T> {
  const end = cursor === undefined
    ? items.length
    : parseCursor(cursor, {
        kind,
        sessionId: session.id,
        revision: session.revision,
        selectedHead,
        itemCount: items.length,
      });
  const start = Math.max(0, end - limit);
  return {
    items: structuredClone(items.slice(start, end)),
    totalCount: items.length,
    hasMoreBefore: start > 0,
    ...(start > 0
      ? {
          nextCursor: formatCursor({
            version: 1,
            kind,
            sessionId: session.id,
            revision: session.revision,
            selectedHead,
            end: start,
          }),
        }
      : {}),
  };
}

function formatCursor(payload: PlayWindowCursorPayload): string {
  return `play-window-v1.${Buffer.from(JSON.stringify(payload), 'utf-8')
    .toString('base64url')}`;
}

function parseCursor(
  cursor: string,
  expected: Omit<PlayWindowCursorPayload, 'version' | 'end'> & {
    itemCount: number;
  },
): number {
  if (!cursor.startsWith('play-window-v1.')) {
    throw new Error('Play detail cursor is invalid.');
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(
      cursor.slice('play-window-v1.'.length),
      'base64url',
    ).toString('utf-8'));
  } catch {
    throw new Error('Play detail cursor is invalid.');
  }
  if (
    !isRecord(value) ||
    [...Object.keys(value)].sort().join(',') !==
      'end,kind,revision,selectedHead,sessionId,version' ||
    value.version !== 1 ||
    value.kind !== expected.kind ||
    value.sessionId !== expected.sessionId ||
    value.revision !== expected.revision ||
    value.selectedHead !== expected.selectedHead ||
    !Number.isSafeInteger(value.end) ||
    (value.end as number) < 0 ||
    (value.end as number) > expected.itemCount
  ) {
    throw new Error(
      'Play detail cursor is stale or belongs to another selected branch.',
    );
  }
  return value.end as number;
}

function normalizeWindowLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PLAY_DETAIL_WINDOW_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PLAY_DETAIL_WINDOW_LIMIT) {
    throw new Error(
      `Play detail window limit must be between 1 and ${MAX_PLAY_DETAIL_WINDOW_LIMIT}.`,
    );
  }
  return value;
}

function readLaunchMetadata(value: Record<string, unknown>): {
  purpose: 'immersiveJourney' | 'sceneRehearsal';
  startMode: 'guided';
} | undefined {
  const launch = value.playLaunch;
  if (!isRecord(launch) || launch.startMode !== 'guided') return undefined;
  if (launch.purpose !== 'immersiveJourney' && launch.purpose !== 'sceneRehearsal') {
    return undefined;
  }
  return { purpose: launch.purpose, startMode: 'guided' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
