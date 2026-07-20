import { computed, onMounted, readonly, shallowRef, toRaw } from 'vue';
import type { Ref } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import {
  projectPlaySessionBeforeArtifact,
  type PlayRetryBeforeTurnProjection,
} from './usePlayRetryProjection';
import { usePlaySessionHistory } from './usePlaySessionHistory';
import { usePlaySessionHistoryWindow } from './usePlaySessionHistoryWindow';
import { usePlayRehearsalWorkspace } from './usePlayRehearsalWorkspace';
import { usePlayTurnStream } from './usePlayTurnStream';
import {
  buildPlayEventCardViews,
  PLAY_KNOWLEDGE_STATE_KEY,
} from './playWorldPresentation';
import type {
  CreatePlaySceneRehearsalSessionInput,
  PlayActionKind,
  PlayAdoptionCandidate,
  PlayAgenda,
  PlayEventPolicy,
  PlayEventVisibility,
  PlayObservation,
  PlayPressure,
  PlayRelativeTimeAdvance,
  PlayScheduledEvent,
  PlaySession,
  PlaySessionSelectedDetail,
  PlaySessionSummary,
} from './useWorkspaceApi';

const PLAY_WORLD_MOMENTUM_STATE_KEY = 'worldMomentum';

export interface PlaySessionCreateInput {
  title: string;
  sceneStart: string;
  userPersona?: string;
  characters?: string[];
  eventPolicy?: Partial<PlayEventPolicy>;
  worldMomentum?: PlayWorldMomentum;
}

export type PlaySessionCreateRequest =
  | PlaySessionCreateInput
  | CreatePlaySceneRehearsalSessionInput;

export interface PlayWorldMomentum {
  pressures: PlayPressure[];
  agendas: PlayAgenda[];
}

export interface PlaySuggestedActionView {
  id: string;
  label: string;
  userText: string;
  actionKind: PlayActionKind;
}

export interface PlayStateEntryView {
  key: string;
  value: string;
}

export function usePlayWorkspace(
  workspacePath: string,
  providerConfigured: Readonly<Ref<boolean>>,
) {
  const api = useWorkspaceApi();
  const sessions = shallowRef<PlaySessionSummary[]>([]);
  const selectedSessionId = shallowRef(readSelectedSession(workspacePath));
  const loading = shallowRef(false);
  const creating = shallowRef(false);
  const error = shallowRef('');
  const userText = shallowRef('');
  const actionKind = shallowRef<PlayActionKind>('do');
  const timeAdvance = shallowRef<PlayRelativeTimeAdvance | undefined>({
    amount: 10,
    unit: 'minute',
  });
  const showSpoilers = shallowRef(false);
  const historyRetryingArtifactId = shallowRef('');
  const retryProjection = shallowRef<{
    sessionId: string;
    projection: PlayRetryBeforeTurnProjection;
  }>();
  const historyWindow = usePlaySessionHistoryWindow({
    client: api,
    selectedSessionId,
    directorLens: showSpoilers,
    onDecision(result) {
      if (result.createdSessionId) rememberSelectedSession(result.createdSessionId);
      void refreshSessionSummaries().catch((caught) => {
        error.value = toErrorMessage(caught);
      });
    },
    onError(caught) {
      error.value = toErrorMessage(caught);
    },
  });
  const {
    run: provisionalTurn,
    announcement: turnAnnouncement,
    busy: sending,
    canStop,
    submit: submitStreamTurn,
    retry: retryStreamTurn,
    stop: stopStreamTurn,
    reconcile: reconcileStreamTurn,
    clearTerminalRun,
  } = usePlayTurnStream({
    client: api,
    onCommitted(session) {
      replaceSession(session);
      clearRetryProjection();
      userText.value = '';
      resetTimeAdvance();
      error.value = '';
    },
  });

  const selectedSession = computed(() => historyWindow.detail.value
    ? materializeBoundedPlaySession(historyWindow.detail.value)
    : undefined);
  const selectedJourneySession = computed(() =>
    selectedSession.value?.schemaVersion === 4 ? selectedSession.value : undefined,
  );
  const rehearsalWorkspace = usePlayRehearsalWorkspace({
    client: api,
    selectedSession,
    selectedArtifactPresentation: computed(() =>
      historyWindow.detail.value?.selectedArtifactPresentation),
    providerConfigured,
    onCommitted(session) {
      replaceSession(session);
      error.value = '';
    },
  });
  const displaySession = computed<PlaySession | undefined>(() => {
    const session = selectedSession.value;
    const activeProjection = retryProjection.value;
    if (
      !session ||
      session.schemaVersion !== 4 ||
      activeProjection?.sessionId !== session.id
    ) {
      return session;
    }

    const projection = activeProjection.projection;
    return {
      ...session,
      selectedTurnIds: projection.selectedTurnIds,
      transcript: projection.transcript,
      playLocalState: projection.playLocalState,
      playLocalStateVisibility: projection.playLocalStateVisibility,
      worldClock: projection.worldClock,
      scheduledEvents: projection.scheduledEvents,
      suggestedActions: projection.suggestedActions,
    };
  });
  const turnInteractionBlocked = computed(() =>
    sending.value || provisionalTurn.value?.phase === 'indeterminate',
  );
  const turnTruthIndeterminate = computed(() =>
    provisionalTurn.value?.phase === 'indeterminate',
  );
  const {
    checkpoints: historyCheckpoints,
    busyArtifactId: historyBusyArtifactId,
    namingCheckpointId: historyNamingCheckpointId,
    loading: historyLoading,
    notice: historyNotice,
    rename: renameCheckpoint,
    restore: restoreCheckpoint,
  } = usePlaySessionHistory({
    client: api,
    selectedSession: selectedJourneySession,
    blocked: turnInteractionBlocked,
    onRestored(session) {
      replaceSession(session);
      clearRetryProjection();
      clearTerminalRun();
      userText.value = '';
      resetTimeAdvance();
      error.value = '';
    },
    onRenamed(session) {
      replaceSession(session);
      error.value = '';
    },
    onError(caught) {
      error.value = toErrorMessage(caught);
    },
  });
  const interactionBlocked = computed(() =>
    loading.value ||
    creating.value ||
    historyWindow.loading.value ||
    historyWindow.loadingEarlierTranscript.value ||
    historyWindow.loadingEarlierEvents.value ||
    historyWindow.decisionBusy.value ||
    turnInteractionBlocked.value ||
    rehearsalWorkspace.interactionBlocked.value ||
    Boolean(historyBusyArtifactId.value) ||
    Boolean(historyRetryingArtifactId.value),
  );
  const refreshBlocked = computed(() =>
    loading.value ||
    creating.value ||
    historyWindow.loading.value ||
    historyWindow.decisionBusy.value ||
    sending.value ||
    rehearsalWorkspace.interactionBlocked.value ||
    Boolean(historyBusyArtifactId.value) ||
    Boolean(historyRetryingArtifactId.value),
  );
  const suggestedActions = computed<PlaySuggestedActionView[]>(() =>
    (displaySession.value?.suggestedActions ?? []).map((suggestion, index) => ({
      id: `${displaySession.value?.id ?? 'play'}-suggestion-${index}`,
      label: suggestion,
      userText: suggestion,
      actionKind: inferActionKind(suggestion),
    })),
  );
  const worldMomentum = computed(() =>
    readPlayWorldMomentum(displaySession.value?.playLocalState),
  );
  const spoilerProjectedPressures = computed(() =>
    worldMomentum.value.pressures.filter((pressure) =>
      showSpoilers.value || pressure.visibility !== 'playerUnknown',
    ),
  );
  const spoilerProjectedAgendas = computed(() =>
    worldMomentum.value.agendas.filter((agenda) =>
      showSpoilers.value || agenda.visibility !== 'playerUnknown',
    ),
  );
  const visiblePressures = computed(() =>
    spoilerProjectedPressures.value.filter((pressure) => pressure.status === 'active'),
  );
  const visibleAgendas = computed(() =>
    spoilerProjectedAgendas.value.filter((agenda) =>
      agenda.status === 'active' || agenda.status === 'blocked',
    ),
  );
  const stateEntries = computed<PlayStateEntryView[]>(() =>
    buildPlayStateEntryViews(
      displaySession.value?.playLocalState,
      displaySession.value?.playLocalStateVisibility,
      showSpoilers.value,
    ),
  );
  // M5 detail windows are already selected-branch projections. The renderer
  // must not reconstruct ownership from the intentionally omitted artifact
  // ledger or fall back to the legacy full-session list.
  const projectedEvents = computed(() => displaySession.value?.events ?? []);
  const projectedObservations = computed(() =>
    displaySession.value?.observations ?? [],
  );
  const projectedObservationIds = computed(() => new Set(
    projectedObservations.value.map((observation) => observation.id),
  ));
  const projectedCandidates = computed(() =>
    (displaySession.value?.adoptionCandidates ?? []).filter((candidate) =>
      candidate.sourceObservationIds.every((id) => projectedObservationIds.value.has(id)),
    ),
  );
  const sortedEvents = computed(() =>
    [...projectedEvents.value].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.sequence - left.sequence,
    ),
  );
  const eventCards = computed(() => buildPlayEventCardViews({
    events: sortedEvents.value,
    artifacts: [],
    eventPresentation: historyWindow.detail.value?.eventPresentation ?? [],
    showSpoilers: showSpoilers.value,
  }));
  const causeLabelsByEventId = computed<Record<string, string[]>>(() =>
    Object.fromEntries(eventCards.value.map((card) => [
      card.id,
      card.causeLabels.map((cause) => cause.label),
    ])),
  );
  const visibleObservations = computed(() =>
    projectedObservations.value.filter(
      (observation) => showSpoilers.value || observation.visibility !== 'playerUnknown',
    ),
  );
  const visibleCandidates = computed(() =>
    projectedCandidates.value.filter(
      (candidate) => showSpoilers.value || candidate.visibility !== 'playerUnknown',
    ),
  );
  const visibleScheduledEvents = computed(() =>
    [...(displaySession.value?.scheduledEvents ?? [])]
      .filter((event) =>
        event.status === 'scheduled' &&
        (showSpoilers.value || event.template.visibility !== 'playerUnknown'),
      )
      .sort((left, right) =>
        (right.priority ?? 0) - (left.priority ?? 0) ||
        left.scheduledAtTurn - right.scheduledAtTurn ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map((event) => projectScheduledEventForView(event, showSpoilers.value)),
  );
  const hasHiddenPlayContent = computed(() => {
    const session = displaySession.value;
    if (!session) {
      return false;
    }

    return projectedEvents.value.some((event) => Boolean(event.cause.reason)) ||
      Object.keys(session.playLocalStateVisibility).some(
        (key) =>
          key !== PLAY_WORLD_MOMENTUM_STATE_KEY &&
          session.playLocalStateVisibility[key] !== 'playerVisible',
      ) || projectedEvents.value.some((event) => event.visibility === 'playerUnknown')
      || projectedObservations.value.some((observation) =>
        observation.visibility === 'playerUnknown')
      || projectedCandidates.value.some((candidate) =>
        candidate.visibility === 'playerUnknown')
      || session.scheduledEvents.some((event) =>
        event.status === 'scheduled' &&
        event.template.visibility === 'playerUnknown')
      || worldMomentum.value.pressures.some((pressure) =>
        pressure.visibility === 'playerUnknown')
      || worldMomentum.value.agendas.some((agenda) =>
        agenda.visibility === 'playerUnknown');
  });

  onMounted(() => {
    void refreshSessions();
  });

  async function refreshSessions() {
    if (refreshBlocked.value) {
      return;
    }

    loading.value = true;
    error.value = '';

    try {
      if (turnTruthIndeterminate.value) {
        await reconcileStreamTurn();
      }
      await refreshSessionIndexAndDetail();
      clearRetryProjection();
      clearTerminalRun();
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      loading.value = false;
    }
  }

  function selectSession(id: string) {
    if (!interactionBlocked.value && sessions.value.some((session) => session.id === id)) {
      rememberSelectedSession(id);
      error.value = '';
      void historyWindow.refreshSelected();
    }
  }

  async function createSession(input: PlaySessionCreateRequest) {
    if (interactionBlocked.value) {
      return undefined;
    }

    creating.value = true;
    error.value = '';

    try {
      const result = await api.createPlaySession(input);
      rememberSelectedSession(result.session.id);
      await refreshSessionIndexAndDetail(result.session.id);
      return result.session;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return undefined;
    } finally {
      creating.value = false;
    }
  }

  function registerCreatedSession(session: PlaySession): void {
    rememberSelectedSession(session.id);
    error.value = '';
    void refreshSessionIndexAndDetail(session.id);
  }

  async function submitTurn() {
    const session = selectedSession.value;
    const requestedTimeAdvance = actionKind.value === 'wait'
      ? normalizeRelativeTimeAdvance(timeAdvance.value)
      : undefined;
    const text = userText.value.trim() || (
      requestedTimeAdvance ? formatWaitAction(requestedTimeAdvance) : ''
    );

    if (
      !session ||
      session.schemaVersion !== 4 ||
      !text ||
      interactionBlocked.value ||
      (actionKind.value === 'wait' && !requestedTimeAdvance)
    ) {
      return;
    }

    error.value = '';

    const outcome = await submitStreamTurn({
      sessionId: session.id,
      userText: text,
      actionKind: actionKind.value,
      baseRevision: session.revision,
      ...(requestedTimeAdvance ? { timeAdvance: requestedTimeAdvance } : {}),
    });

    if (outcome === 'failed' || outcome === 'unknown') {
      error.value = provisionalTurn.value?.error ?? 'Play turn failed before commit.';
    }
  }

  async function retryCheckpoint(artifactId: string) {
    const session = selectedSession.value;
    if (!session || session.schemaVersion !== 4 || interactionBlocked.value) {
      return;
    }
    if (!providerConfigured.value) {
      error.value = 'Configure a provider before retrying a Play settlement.';
      return;
    }

    const checkpoint = historyCheckpoints.value.find(
      (candidate) => candidate.artifactId === artifactId,
    );
    if (!checkpoint?.retryable) {
      error.value = 'This settlement cannot be retried from its saved history.';
      return;
    }

    error.value = '';
    historyRetryingArtifactId.value = artifactId;

    try {
      // Retry is an explicit graph operation, so it lazily requests the legacy
      // full artifact graph instead of putting that graph back on the main
      // Play workspace read path.
      const loaded = await api.getPlaySession(session.id);
      if (loaded.session.schemaVersion !== 4 || loaded.session.revision !== session.revision) {
        throw new Error('Play session changed before Retry could reconstruct its checkpoint.');
      }
      const artifact = loaded.session.turnArtifacts.find((candidate) =>
        candidate.id === artifactId);
      const projection = projectPlaySessionBeforeArtifact(loaded.session, artifactId);
      if (!artifact?.input || !projection) {
        throw new Error(
          'The state before this turn cannot be reconstructed safely, so Retry was not started.',
        );
      }
      retryProjection.value = { sessionId: session.id, projection };
      const outcome = await retryStreamTurn({
        sessionId: session.id,
        artifactId,
        baseRevision: loaded.session.revision,
        userText: artifact.input.raw,
        actionKind: artifact.input.kind,
      });

      if (outcome === 'failed' || outcome === 'unknown') {
        error.value = provisionalTurn.value?.error ?? 'Play Retry failed before commit.';
      }
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      clearRetryProjection();
    }
  }

  async function stopTurn() {
    await stopStreamTurn();
    if (provisionalTurn.value?.error) {
      error.value = provisionalTurn.value.error;
    }
  }

  function replaceSession(session: PlaySession) {
    const currentRevision = historyWindow.detail.value?.snapshot.revision ?? -1;
    if (session.id === selectedSessionId.value && session.revision >= currentRevision) {
      void refreshSessionIndexAndDetail(session.id);
    }
  }

  async function refreshSessionIndexAndDetail(preferredSessionId?: string): Promise<void> {
    await refreshSessionSummaries();
    const nextSessionId = preferredSessionId && sessions.value.some((summary) =>
      summary.id === preferredSessionId)
      ? preferredSessionId
      : sessions.value.some((summary) => summary.id === selectedSessionId.value)
        ? selectedSessionId.value
        : sessions.value[0]?.id ?? '';
    rememberSelectedSession(nextSessionId);
    if (nextSessionId) {
      await historyWindow.refreshSelected();
    } else {
      historyWindow.reset();
    }
  }

  async function refreshSessionSummaries(): Promise<void> {
    const result = await api.listPlaySessionSummaries();
    sessions.value = result.summaries;
  }

  function clearRetryProjection() {
    historyRetryingArtifactId.value = '';
    retryProjection.value = undefined;
  }

  function resetTimeAdvance() {
    timeAdvance.value = { amount: 10, unit: 'minute' };
  }

  function rememberSelectedSession(id: string) {
    if (selectedSessionId.value !== id) {
      showSpoilers.value = false;
      resetTimeAdvance();
    }
    selectedSessionId.value = id;
    writeSelectedSession(workspacePath, id);
  }

  return {
    actionKind,
    creating,
    error,
    loading,
    displaySession,
    rehearsalWorkspace,
    selectedSession,
    selectedSessionId,
    sending,
    interactionBlocked,
    refreshBlocked,
    historyCheckpoints,
    historyBusyArtifactId,
    historyNamingCheckpointId,
    historyRetryingArtifactId: readonly(historyRetryingArtifactId),
    historyLoading,
    historyNotice,
    historyWindow,
    canStop,
    provisionalTurn,
    turnAnnouncement,
    timeAdvance,
    showSpoilers,
    hasHiddenPlayContent,
    sessions,
    sortedEvents,
    eventCards,
    causeLabelsByEventId,
    stateEntries,
    suggestedActions,
    userText,
    visibleCandidates,
    visibleObservations,
    visibleScheduledEvents,
    visiblePressures,
    visibleAgendas,
    createSession,
    registerCreatedSession,
    replaceSession,
    refreshSessions,
    retryCheckpoint,
    renameCheckpoint,
    restoreCheckpoint,
    selectSession,
    stopTurn,
    submitTurn,
  };
}

export function isPlayProvenanceInSelectedBranch(
  fact: Pick<PlayObservation | PlayAdoptionCandidate, 'sourceTurnIds' | 'sourceEventIds'>,
  selectedMessageIds: ReadonlySet<string>,
  selectedEventIds: ReadonlySet<string>,
): boolean {
  return fact.sourceTurnIds.every((id) => selectedMessageIds.has(id)) &&
    fact.sourceEventIds.every((id) => selectedEventIds.has(id));
}

/**
 * Adapts the bounded M5 read model to the pre-M5 presentational component
 * shape. Historical ledgers stay empty by design; mutation code must use the
 * session id/revision or explicitly fetch the full graph (Retry does so).
 */
export function materializeBoundedPlaySession(
  detail: Readonly<PlaySessionSelectedDetail>,
): PlaySession {
  const mutableDetail = structuredClone(toRaw(detail)) as PlaySessionSelectedDetail;
  const snapshot = mutableDetail.snapshot;
  const common = {
    ...snapshot,
    transcript: mutableDetail.transcript.items,
    turnArtifacts: [],
    branchBaseSnapshot: {
      worldClock: { ...snapshot.worldClock },
      playLocalState: structuredClone(snapshot.playLocalState),
      playLocalStateVisibility: { ...snapshot.playLocalStateVisibility },
      scheduledEvents: structuredClone(snapshot.scheduledEvents),
      suggestedActions: [...snapshot.suggestedActions],
    },
    events: mutableDetail.events.items,
  };
  if (snapshot.schemaVersion === 5) {
    if (!snapshot.sceneRehearsal || !snapshot.rehearsalScenes) {
      throw new Error('Bounded rehearsal detail is missing its Scene Rehearsal sidecars.');
    }
    return {
      ...common,
      schemaVersion: 5,
      sceneRehearsal: snapshot.sceneRehearsal,
      rehearsalScenes: snapshot.rehearsalScenes,
    };
  }
  return { ...common, schemaVersion: 4 };
}

export function readPlayWorldMomentum(
  state: Readonly<Record<string, unknown>> | undefined,
): PlayWorldMomentum {
  const value = state?.[PLAY_WORLD_MOMENTUM_STATE_KEY];
  if (!isRecord(value) || !Array.isArray(value.pressures) || !Array.isArray(value.agendas)) {
    return { pressures: [], agendas: [] };
  }
  if (!value.pressures.every(isPlayPressure) || !value.agendas.every(isPlayAgenda)) {
    return { pressures: [], agendas: [] };
  }

  return {
    pressures: value.pressures,
    agendas: value.agendas,
  };
}

export function buildPlayStateEntryViews(
  state: Readonly<Record<string, unknown>> | undefined,
  visibility: Readonly<Record<string, PlayEventVisibility>> | undefined,
  showSpoilers: boolean,
): PlayStateEntryView[] {
  return Object.entries(state ?? {})
    .filter(([key]) =>
      key !== PLAY_WORLD_MOMENTUM_STATE_KEY && key !== PLAY_KNOWLEDGE_STATE_KEY,
    )
    .filter(([key]) => showSpoilers || visibility?.[key] === 'playerVisible')
    .map(([key, value]) => ({
      key,
      value: formatStateValue(value),
    }));
}

export function normalizeRelativeTimeAdvance(
  value: PlayRelativeTimeAdvance | undefined,
): PlayRelativeTimeAdvance | undefined {
  if (
    !value ||
    !Number.isSafeInteger(value.amount) ||
    value.amount <= 0 ||
    !['minute', 'hour', 'day'].includes(value.unit) ||
    relativeTimeAdvanceMinutes(value) > 525_600
  ) {
    return undefined;
  }

  return { ...value };
}

export function projectScheduledEventForView(
  event: Readonly<PlayScheduledEvent>,
  showSpoilers: boolean,
): PlayScheduledEvent {
  if (showSpoilers || event.trigger.type !== 'flagEquals') {
    return event;
  }
  return {
    ...event,
    trigger: {
      type: 'flagEquals',
      path: 'tracked world condition',
      value: 'matched',
    },
  };
}

function relativeTimeAdvanceMinutes(value: PlayRelativeTimeAdvance): number {
  if (value.unit === 'day') return value.amount * 1_440;
  if (value.unit === 'hour') return value.amount * 60;
  return value.amount;
}

function formatWaitAction(value: PlayRelativeTimeAdvance): string {
  const unit = value.unit === 'minute' ? '分钟' : value.unit === 'hour' ? '小时' : '天';
  return `等待 ${value.amount} ${unit}，观察世界变化。`;
}

function isPlayPressure(value: unknown): value is PlayPressure {
  return isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.kind === 'string' &&
    ['deadline', 'pursuit', 'factionProject', 'environment', 'rumor', 'relationship']
      .includes(value.kind) &&
    isNonEmptyString(value.label) &&
    typeof value.status === 'string' &&
    ['latent', 'active', 'resolved'].includes(value.status) &&
    isOptionalFiniteNumber(value.level) &&
    isOptionalFiniteNumber(value.threshold) &&
    Array.isArray(value.causeRefs) &&
    value.causeRefs.every(isNonEmptyString) &&
    isOptionalNonEmptyString(value.nextConsequence) &&
    isPlayVisibility(value.visibility);
}

function isPlayAgenda(value: unknown): value is PlayAgenda {
  return isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.ownerEntityId) &&
    isNonEmptyString(value.goal) &&
    isOptionalNonEmptyString(value.nextMove) &&
    Array.isArray(value.blockers) &&
    value.blockers.every(isNonEmptyString) &&
    typeof value.status === 'string' &&
    ['active', 'blocked', 'completed', 'abandoned'].includes(value.status) &&
    isPlayVisibility(value.visibility) &&
    isNonEmptyString(value.updatedAtTurnId);
}

function isPlayVisibility(value: unknown): boolean {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferActionKind(text: string): PlayActionKind {
  const normalized = text.trim().toLowerCase();

  if (/^(等待|等到|休息|wait|rest)/u.test(normalized)) {
    return 'wait';
  }
  if (/^(观察|查看|环顾|look|inspect)/u.test(normalized)) {
    return 'look';
  }
  if (/^(前往|走向|离开|进入|move|go|leave|enter)/u.test(normalized)) {
    return 'move';
  }
  if (/^(说|询问|回答|say|ask|tell)/u.test(normalized)) {
    return 'say';
  }

  return 'do';
}

function formatStateValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '[unavailable]';
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSelectedSession(workspacePath: string): string {
  try {
    return globalThis.localStorage?.getItem(selectionStorageKey(workspacePath)) ?? '';
  } catch {
    return '';
  }
}

function writeSelectedSession(workspacePath: string, id: string) {
  try {
    if (id) {
      globalThis.localStorage?.setItem(selectionStorageKey(workspacePath), id);
    } else {
      globalThis.localStorage?.removeItem(selectionStorageKey(workspacePath));
    }
  } catch {
    // Selection persistence is a UI preference; Play data remains filesystem-backed.
  }
}

function selectionStorageKey(workspacePath: string): string {
  return `oan:play:selected-session:${workspacePath}`;
}
