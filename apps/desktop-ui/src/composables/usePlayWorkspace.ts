import { computed, onMounted, readonly, shallowRef } from 'vue';
import type { Ref } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import {
  projectPlaySessionBeforeArtifact,
  type PlayRetryBeforeTurnProjection,
} from './usePlayRetryProjection';
import { usePlaySessionHistory } from './usePlaySessionHistory';
import { usePlayRehearsalWorkspace } from './usePlayRehearsalWorkspace';
import { usePlayTurnStream } from './usePlayTurnStream';
import type {
  CreatePlaySceneRehearsalSessionInput,
  PlayActionKind,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayAgenda,
  PlayEventPolicy,
  PlayObservation,
  PlayPressure,
  PlayRelativeTimeAdvance,
  PlaySession,
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

export interface PlayAdoptionDraftInput {
  target: PlayAdoptionTarget;
  summary: string;
  evidence: string;
  payload: Record<string, unknown>;
  sourceObservationIds: string[];
}

export function usePlayWorkspace(
  workspacePath: string,
  providerConfigured: Readonly<Ref<boolean>>,
) {
  const api = useWorkspaceApi();
  const sessions = shallowRef<PlaySession[]>([]);
  const selectedSessionId = shallowRef(readSelectedSession(workspacePath));
  const loading = shallowRef(false);
  const creating = shallowRef(false);
  const error = shallowRef('');
  const adoptionBusyId = shallowRef('');
  const adoptionCreating = shallowRef(false);
  const adoptionNotice = shallowRef('');
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

  const selectedSession = computed(() =>
    sessions.value.find((session) => session.id === selectedSessionId.value),
  );
  const selectedJourneySession = computed(() =>
    selectedSession.value?.schemaVersion === 4 ? selectedSession.value : undefined,
  );
  const rehearsalWorkspace = usePlayRehearsalWorkspace({
    client: api,
    selectedSession,
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
    loading: historyLoading,
    notice: historyNotice,
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
      adoptionNotice.value = '';
    },
    onError(caught) {
      error.value = toErrorMessage(caught);
    },
  });
  const interactionBlocked = computed(() =>
    loading.value ||
    creating.value ||
    turnInteractionBlocked.value ||
    rehearsalWorkspace.interactionBlocked.value ||
    Boolean(historyBusyArtifactId.value) ||
    Boolean(historyRetryingArtifactId.value),
  );
  const refreshBlocked = computed(() =>
    loading.value ||
    creating.value ||
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
    Object.entries(displaySession.value?.playLocalState ?? {})
      .filter(([key]) => key !== PLAY_WORLD_MOMENTUM_STATE_KEY)
      .filter(([key]) =>
        showSpoilers.value ||
        displaySession.value?.playLocalStateVisibility[key] !== 'playerUnknown',
      )
      .map(([key, value]) => ({
        key,
        value: formatStateValue(value),
      })),
  );
  const selectedArtifactIds = computed(() =>
    new Set(displaySession.value?.selectedTurnIds ?? []),
  );
  const selectedEventIds = computed(() => new Set(
    (displaySession.value?.turnArtifacts ?? [])
      .filter((artifact) => selectedArtifactIds.value.has(artifact.id))
      .flatMap((artifact) => artifact.eventIds),
  ));
  const selectedMessageIds = computed(() => new Set(
    (displaySession.value?.turnArtifacts ?? [])
      .filter((artifact) => selectedArtifactIds.value.has(artifact.id))
      .flatMap((artifact) => artifact.messages.map((message) => message.id))
      .filter((id): id is string => Boolean(id)),
  ));
  const selectedObservationIds = computed(() => new Set(
    (displaySession.value?.turnArtifacts ?? [])
      .filter((artifact) => selectedArtifactIds.value.has(artifact.id))
      .flatMap((artifact) => artifact.observationIds),
  ));
  const artifactOwnedObservationIds = computed(() => new Set(
    (displaySession.value?.turnArtifacts ?? [])
      .flatMap((artifact) => artifact.observationIds),
  ));
  const projectedEvents = computed(() =>
    (displaySession.value?.events ?? []).filter((event) =>
      selectedEventIds.value.has(event.id),
    ),
  );
  const projectedObservations = computed(() =>
    (displaySession.value?.observations ?? []).filter((observation) =>
      (
        !artifactOwnedObservationIds.value.has(observation.id) ||
        selectedObservationIds.value.has(observation.id)
      ) && isPlayProvenanceInSelectedBranch(
        observation,
        selectedMessageIds.value,
        selectedEventIds.value,
      ),
    ),
  );
  const projectedObservationIds = computed(() => new Set(
    projectedObservations.value.map((observation) => observation.id),
  ));
  const projectedCandidates = computed(() =>
    (displaySession.value?.adoptionCandidates ?? []).filter((candidate) =>
      candidate.sourceObservationIds.every((id) =>
        projectedObservationIds.value.has(id)) &&
      isPlayProvenanceInSelectedBranch(
        candidate,
        selectedMessageIds.value,
        selectedEventIds.value,
      ),
    ),
  );
  const sortedEvents = computed(() =>
    [...projectedEvents.value].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.sequence - left.sequence,
    ),
  );
  const causeLabelsByEventId = computed<Record<string, string[]>>(() => {
    const pressuresById = new Map(
      spoilerProjectedPressures.value.map((pressure) => [pressure.id, pressure]),
    );
    const agendasById = new Map(
      spoilerProjectedAgendas.value.map((agenda) => [agenda.id, agenda]),
    );

    return Object.fromEntries(projectedEvents.value.map((event) => {
      const labels: string[] = [];
      const pressure = event.cause.pressureId
        ? pressuresById.get(event.cause.pressureId)
        : undefined;
      const agenda = event.cause.agendaId
        ? agendasById.get(event.cause.agendaId)
        : undefined;

      if (pressure) {
        labels.push(`Pressure · ${pressure.label}`);
      }
      if (agenda) {
        labels.push(
          `Agenda · ${agenda.ownerEntityId}: ${agenda.nextMove ?? agenda.goal}`,
        );
      }

      return [event.id, [...new Set(labels)]];
    }));
  });
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
      ),
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
          session.playLocalStateVisibility[key] === 'playerUnknown',
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
      const result = await api.listPlaySessions();
      sessions.value = result.sessions;

      if (!sessions.value.some((session) => session.id === selectedSessionId.value)) {
        rememberSelectedSession(sessions.value[0]?.id ?? '');
      }
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
      adoptionNotice.value = '';
    }
  }

  async function createSession(input: PlaySessionCreateRequest) {
    if (interactionBlocked.value) {
      return;
    }

    creating.value = true;
    error.value = '';

    try {
      const result = await api.createPlaySession(input);
      sessions.value = [
        result.session,
        ...sessions.value.filter((session) => session.id !== result.session.id),
      ];
      rememberSelectedSession(result.session.id);
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      creating.value = false;
    }
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
    adoptionNotice.value = '';

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

    const artifact = session.turnArtifacts.find((candidate) => candidate.id === artifactId);
    const projection = projectPlaySessionBeforeArtifact(session, artifactId);
    if (!artifact?.input || !projection) {
      error.value = 'The state before this turn cannot be reconstructed safely, so Retry was not started.';
      return;
    }

    error.value = '';
    adoptionNotice.value = '';
    historyRetryingArtifactId.value = artifactId;
    retryProjection.value = { sessionId: session.id, projection };

    try {
      const outcome = await retryStreamTurn({
        sessionId: session.id,
        artifactId,
        baseRevision: session.revision,
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

  async function createPendingAction(candidate: PlayAdoptionCandidate): Promise<boolean> {
    const session = selectedSession.value;
    if (
      !session ||
      session.schemaVersion !== 4 ||
      adoptionBusyId.value ||
      interactionBlocked.value
    ) {
      return false;
    }

    adoptionBusyId.value = candidate.id;
    adoptionNotice.value = '';
    error.value = '';

    try {
      await api.createPlayAdoptionPendingAction(session.id, candidate.id);
      adoptionNotice.value = 'PendingAction 已创建，canonical 文件仍保持不变。';
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    } finally {
      adoptionBusyId.value = '';
    }
  }

  async function createAdoptionCandidate(input: PlayAdoptionDraftInput): Promise<boolean> {
    const session = selectedSession.value;
    if (
      !session ||
      session.schemaVersion !== 4 ||
      adoptionCreating.value ||
      interactionBlocked.value
    ) {
      return false;
    }

    adoptionCreating.value = true;
    adoptionNotice.value = '';
    error.value = '';

    try {
      const result = await api.addPlayAdoptionCandidate(session.id, {
        ...input,
        baseRevision: session.revision,
      });
      replaceSession(result.session);
      adoptionNotice.value = 'Adoption candidate 已准备好；创建 PendingAction 后仍需人工审阅。';
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    } finally {
      adoptionCreating.value = false;
    }
  }

  function replaceSession(session: PlaySession) {
    sessions.value = sessions.value.map((item) =>
      item.id === session.id && session.revision >= item.revision ? session : item,
    );
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
    adoptionBusyId,
    adoptionCreating,
    adoptionNotice,
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
    historyRetryingArtifactId: readonly(historyRetryingArtifactId),
    historyLoading,
    historyNotice,
    canStop,
    provisionalTurn,
    turnAnnouncement,
    timeAdvance,
    showSpoilers,
    hasHiddenPlayContent,
    sessions,
    sortedEvents,
    causeLabelsByEventId,
    stateEntries,
    suggestedActions,
    userText,
    visibleCandidates,
    visibleObservations,
    visibleScheduledEvents,
    visiblePressures,
    visibleAgendas,
    createPendingAction,
    createAdoptionCandidate,
    createSession,
    refreshSessions,
    retryCheckpoint,
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
