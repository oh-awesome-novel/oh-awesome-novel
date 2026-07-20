import type {
  PlayEventPresentationCauses,
  PlayEventPresentationEvidence,
  PlaySession,
  PlaySessionSelectedDetail,
  PlaySessionSummary,
  PlaySourceDriftStatus,
} from '@oh-awesome-novel/client';
import type { Mock } from 'vitest';

type TestMock = Mock<(...args: any[]) => any>;

export interface LegacyPlayReadModelApi {
  listPlaySessions: TestMock;
  listPlaySessionSummaries: TestMock;
  getPlaySession: TestMock;
  getPlaySessionDetail: TestMock;
  listPlayContextTraces: TestMock;
  getPlaySourceDrift: TestMock;
  createPlaySession?: TestMock;
  startPlaySessionFromLaunchPackage?: TestMock;
  finishPlayRehearsalAttempt?: TestMock;
  restorePlayCheckpoint?: TestMock;
  renamePlayCheckpoint?: TestMock;
}

/**
 * Keeps pre-M5 component fixtures focused on their original behavior while
 * driving the product through the new summary/detail read path. New M5 tests
 * should mock the new methods directly instead of using this bridge.
 */
export function installLegacyPlayReadModelMocks(
  api: LegacyPlayReadModelApi,
): void {
  api.listPlaySessionSummaries.mockImplementation(async () => ({
    summaries: (await readLegacySessions(api)).map(toPlaySessionSummary),
  }));
  api.getPlaySessionDetail.mockImplementation(async (id: string) => {
    const session = (await readLegacySessions(api)).find((candidate) =>
      candidate.id === id);
    if (!session) throw new Error(`Missing legacy Play detail fixture: ${id}`);
    return { detail: toPlaySessionSelectedDetail(session) };
  });
  api.getPlaySession.mockImplementation(async (id: string) => {
    const session = (await readLegacySessions(api)).find((candidate) =>
      candidate.id === id);
    if (!session) throw new Error(`Missing legacy Play session fixture: ${id}`);
    return { session };
  });
  api.listPlayContextTraces.mockResolvedValue({ traces: [] });
  api.getPlaySourceDrift.mockImplementation(async (id: string) => {
    const session = (await readLegacySessions(api)).find((candidate) =>
      candidate.id === id);
    if (!session) throw new Error(`Missing legacy Play source fixture: ${id}`);
    return { status: currentSourceStatus(session) };
  });
}

export function toPlaySessionSummary(session: PlaySession): PlaySessionSummary {
  const launch = readLaunchMetadata(session.metadataExtensions);
  const selectedEvents = selectedBranchEvents(session);
  const latestActivityAt = [
    session.createdAt,
    ...session.transcript.map((item) => item.createdAt),
    ...selectedEvents.map((item) => item.createdAt),
  ].toSorted().at(-1)!;
  return {
    schemaVersion: session.schemaVersion,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    latestActivityAt,
    revision: session.revision,
    purpose: session.schemaVersion === 5 ? 'sceneRehearsal' : launch?.purpose ?? 'immersiveJourney',
    startMode: session.schemaVersion === 5
      ? session.sceneRehearsal.startMode
      : launch?.startMode ?? 'quick',
    selectedArtifactId: session.selectedTurnIds.at(-1),
    selectedTurnCount: session.selectedTurnIds.length,
    transcriptCount: session.transcript.length,
    eventCount: selectedEvents.length,
    worldClock: structuredClone(session.worldClock),
    canonical: false,
  };
}

export function toPlaySessionSelectedDetail(
  session: PlaySession,
): PlaySessionSelectedDetail {
  const selectedArtifact = session.turnArtifacts.find((artifact) =>
    artifact.id === session.selectedTurnIds.at(-1));
  const selectedEvents = selectedBranchEvents(session);
  const snapshot = {
    schemaVersion: session.schemaVersion,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    revision: session.revision,
    ...(session.userPersona ? { userPersona: session.userPersona } : {}),
    sceneStart: session.sceneStart,
    characters: structuredClone(session.characters),
    selectedTurnIds: structuredClone(session.selectedTurnIds),
    branchSnapshotRequiredFromRevision: session.branchSnapshotRequiredFromRevision,
    metadataExtensions: structuredClone(session.metadataExtensions),
    playLocalState: structuredClone(session.playLocalState),
    playLocalStateVisibility: structuredClone(session.playLocalStateVisibility),
    worldClock: structuredClone(session.worldClock),
    eventPolicy: structuredClone(session.eventPolicy),
    scheduledEvents: structuredClone(session.scheduledEvents),
    suggestedActions: structuredClone(session.suggestedActions),
    activatedSources: structuredClone(session.activatedSources),
    observations: structuredClone(session.observations),
    adoptionCandidates: structuredClone(session.adoptionCandidates),
    ...(session.schemaVersion === 5
      ? {
          sceneRehearsal: structuredClone(session.sceneRehearsal),
          rehearsalScenes: structuredClone(session.rehearsalScenes),
        }
      : {}),
  } satisfies PlaySessionSelectedDetail['snapshot'];

  return {
    summary: toPlaySessionSummary(session),
    snapshot,
    transcript: {
      items: structuredClone(session.transcript),
      totalCount: session.transcript.length,
      hasMoreBefore: false,
    },
    events: {
      items: structuredClone(selectedEvents),
      totalCount: selectedEvents.length,
      hasMoreBefore: false,
    },
    eventPresentation: selectedEvents.map((event) =>
      toEventPresentationEvidence(session, event)),
    ...(selectedArtifact
      ? {
          selectedArtifactPresentation: {
            id: selectedArtifact.id,
            revision: selectedArtifact.revision,
            eventIds: structuredClone(selectedArtifact.eventIds),
            stateDelta: structuredClone(selectedArtifact.stateDelta),
            playLocalStateVisibilitySnapshot: structuredClone(
              selectedArtifact.playLocalStateVisibilitySnapshot ?? {},
            ),
            ...(selectedArtifact.rehearsalEvidenceRefs
              ? {
                  rehearsalEvidenceRefs: structuredClone(
                    selectedArtifact.rehearsalEvidenceRefs,
                  ),
                }
              : {}),
            canonical: false,
          },
        }
      : {}),
  };
}

function selectedBranchEvents(session: PlaySession): PlaySession['events'] {
  const selectedArtifactIds = new Set(session.selectedTurnIds);
  const selectedEventIds = new Set(session.turnArtifacts
    .filter((artifact) => selectedArtifactIds.has(artifact.id))
    .flatMap((artifact) => artifact.eventIds));
  return session.events.filter((event) => selectedEventIds.has(event.id));
}

function toEventPresentationEvidence(
  session: PlaySession,
  event: PlaySession['events'][number],
): PlayEventPresentationEvidence {
  const artifact = session.turnArtifacts.find((candidate) =>
    candidate.eventIds.includes(event.id));
  if (!artifact) {
    throw new Error(`Missing legacy Play event artifact fixture: ${event.id}`);
  }
  const eventsById = new Map(session.events.map((candidate) => [candidate.id, candidate]));
  const momentum = readMomentum(artifact.playLocalStateSnapshot);
  const pressure = momentum.pressures.find((candidate) =>
    candidate.id === event.cause.pressureId && candidate.causeRefs.includes(event.id));
  const agenda = momentum.agendas.find((candidate) =>
    candidate.id === event.cause.agendaId && candidate.updatedAtTurnId === event.turnId);
  const scheduled = artifact.scheduledEventSnapshots.find((candidate) =>
    candidate.id === event.cause.triggerId &&
    candidate.status === 'occurred' &&
    candidate.occurredEventIds?.includes(event.id));
  const sourceEvents = (event.cause.sourceEventIds ?? [])
    .map((id) => eventsById.get(id))
    .filter((candidate): candidate is PlaySession['events'][number] => Boolean(candidate));
  const actions = (event.cause.sourceTurnIds ?? [])
    .map((id) => artifact.messages.find((message) => message.id === id))
    .filter((message): message is PlaySession['transcript'][number] =>
      message?.speaker === 'player')
    .map((message) => ({
      ...(message.actionKind ? { actionKind: message.actionKind } : {}),
      contentExcerpt: message.content.slice(0, 160),
    }));
  const causes: PlayEventPresentationCauses = {
    actions,
    sourceEvents: sourceEvents
      .filter((candidate) => candidate.visibility !== 'playerUnknown')
      .map((candidate) => ({ title: candidate.title })),
    ...(scheduled && scheduled.template.visibility !== 'playerUnknown'
      ? { scheduled: { label: scheduled.label, trigger: structuredClone(scheduled.trigger) } }
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
      ? { scheduled: { label: scheduled.label, trigger: structuredClone(scheduled.trigger) } }
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
  const allStateImpacts = Object.entries(artifact.stateDelta)
    .filter(([path]) => path !== 'worldMomentum' && path !== 'playKnowledge')
    .map(([path, value]) => ({ path, value: formatStateImpact(value) }));
  const safeStateImpacts = allStateImpacts.filter(({ path }) =>
    artifact.playLocalStateVisibilitySnapshot?.[path] === 'playerVisible');

  return {
    eventId: event.id,
    causes,
    stateImpacts: safeStateImpacts,
    stateImpactOmittedCount: allStateImpacts.length - safeStateImpacts.length,
    author: {
      reason: event.cause.reason,
      technicalRefs: {
        artifactId: artifact.id,
        artifactRevision: artifact.revision,
        turnId: event.turnId,
        sourceTurnIds: structuredClone(event.cause.sourceTurnIds ?? []),
        sourceEventIds: structuredClone(event.cause.sourceEventIds ?? []),
        ...(event.cause.triggerId ? { triggerId: event.cause.triggerId } : {}),
        ...(event.cause.pressureId ? { pressureId: event.cause.pressureId } : {}),
        ...(event.cause.agendaId ? { agendaId: event.cause.agendaId } : {}),
      },
      hiddenCauses,
      stateImpacts: allStateImpacts,
      stateImpactOmittedCount: 0,
    },
  };
}

function readMomentum(value: Record<string, unknown> | undefined): {
  pressures: Array<{
    id: string;
    label: string;
    causeRefs: string[];
    visibility: 'playerVisible' | 'rumor' | 'playerUnknown';
  }>;
  agendas: Array<{
    id: string;
    ownerEntityId: string;
    goal: string;
    nextMove?: string;
    updatedAtTurnId: string;
    visibility: 'playerVisible' | 'rumor' | 'playerUnknown';
  }>;
} {
  const momentum = value?.worldMomentum;
  if (!isRecord(momentum)) return { pressures: [], agendas: [] };
  return {
    pressures: Array.isArray(momentum.pressures)
      ? momentum.pressures.filter(isLegacyPressure)
      : [],
    agendas: Array.isArray(momentum.agendas)
      ? momentum.agendas.filter(isLegacyAgenda)
      : [],
  };
}

function isLegacyPressure(value: unknown): value is ReturnType<typeof readMomentum>['pressures'][number] {
  return isRecord(value) && typeof value.id === 'string' &&
    typeof value.label === 'string' && Array.isArray(value.causeRefs) &&
    value.causeRefs.every((item) => typeof item === 'string') &&
    isVisibility(value.visibility);
}

function isLegacyAgenda(value: unknown): value is ReturnType<typeof readMomentum>['agendas'][number] {
  return isRecord(value) && typeof value.id === 'string' &&
    typeof value.ownerEntityId === 'string' && typeof value.goal === 'string' &&
    (value.nextMove === undefined || typeof value.nextMove === 'string') &&
    typeof value.updatedAtTurnId === 'string' && isVisibility(value.visibility);
}

function isVisibility(
  value: unknown,
): value is 'playerVisible' | 'rumor' | 'playerUnknown' {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

function formatStateImpact(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 160);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return (JSON.stringify(value) ?? String(value)).slice(0, 160);
}

async function readLegacySessions(
  api: LegacyPlayReadModelApi,
): Promise<PlaySession[]> {
  const initial = await api.listPlaySessions() as { sessions: PlaySession[] };
  const sessions = new Map(initial.sessions.map((session) => [session.id, session]));
  const mutationMocks = [
    api.createPlaySession,
    api.startPlaySessionFromLaunchPackage,
    api.finishPlayRehearsalAttempt,
    api.restorePlayCheckpoint,
    api.renamePlayCheckpoint,
  ].filter((mock): mock is TestMock => Boolean(mock));

  for (const mock of mutationMocks) {
    for (const result of mock.mock.results) {
      if (result.type !== 'return') continue;
      try {
        const value = await result.value as { session?: PlaySession };
        const session = value?.session;
        if (!session) continue;
        const current = sessions.get(session.id);
        if (!current || session.revision > current.revision) {
          sessions.set(session.id, session);
        }
      } catch {
        // The owning feature test asserts its mutation failure separately.
      }
    }
  }

  return [...sessions.values()].toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
}

function currentSourceStatus(session: PlaySession): PlaySourceDriftStatus {
  return {
    sessionId: session.id,
    sessionRevision: session.revision,
    overall: 'current',
    sources: [],
    availableDecisions: [],
    canonical: false,
  };
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
