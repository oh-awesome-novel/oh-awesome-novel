import { computed, onMounted, shallowRef } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import { usePlayTurnStream } from './usePlayTurnStream';
import type {
  PlayActionKind,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayEventPolicy,
  PlayObservation,
  PlaySession,
} from './useWorkspaceApi';

export interface PlaySessionCreateInput {
  title: string;
  sceneStart: string;
  userPersona?: string;
  characters?: string[];
  eventPolicy?: Partial<PlayEventPolicy>;
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

export function usePlayWorkspace(workspacePath: string) {
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
  const showSpoilers = shallowRef(false);
  const {
    run: provisionalTurn,
    announcement: turnAnnouncement,
    busy: sending,
    canStop,
    submit: submitStreamTurn,
    stop: stopStreamTurn,
    clearTerminalRun,
  } = usePlayTurnStream({
    client: api,
    onCommitted(session) {
      replaceSession(session);
      userText.value = '';
      error.value = '';
    },
  });

  const selectedSession = computed(() =>
    sessions.value.find((session) => session.id === selectedSessionId.value),
  );
  const interactionBlocked = computed(() =>
    sending.value || provisionalTurn.value?.phase === 'indeterminate',
  );
  const suggestedActions = computed<PlaySuggestedActionView[]>(() =>
    (selectedSession.value?.suggestedActions ?? []).map((suggestion, index) => ({
      id: `${selectedSession.value?.id ?? 'play'}-suggestion-${index}`,
      label: suggestion,
      userText: suggestion,
      actionKind: inferActionKind(suggestion),
    })),
  );
  const stateEntries = computed<PlayStateEntryView[]>(() =>
    Object.entries(selectedSession.value?.playLocalState ?? {})
      .filter(([key]) =>
        showSpoilers.value ||
        selectedSession.value?.playLocalStateVisibility[key] !== 'playerUnknown',
      )
      .map(([key, value]) => ({
        key,
        value: formatStateValue(value),
      })),
  );
  const selectedArtifactIds = computed(() =>
    new Set(selectedSession.value?.selectedTurnIds ?? []),
  );
  const selectedEventIds = computed(() => new Set(
    (selectedSession.value?.turnArtifacts ?? [])
      .filter((artifact) => selectedArtifactIds.value.has(artifact.id))
      .flatMap((artifact) => artifact.eventIds),
  ));
  const selectedMessageIds = computed(() => new Set(
    (selectedSession.value?.turnArtifacts ?? [])
      .filter((artifact) => selectedArtifactIds.value.has(artifact.id))
      .flatMap((artifact) => artifact.messages.map((message) => message.id))
      .filter((id): id is string => Boolean(id)),
  ));
  const selectedObservationIds = computed(() => new Set(
    (selectedSession.value?.turnArtifacts ?? [])
      .filter((artifact) => selectedArtifactIds.value.has(artifact.id))
      .flatMap((artifact) => artifact.observationIds),
  ));
  const artifactOwnedObservationIds = computed(() => new Set(
    (selectedSession.value?.turnArtifacts ?? [])
      .flatMap((artifact) => artifact.observationIds),
  ));
  const projectedEvents = computed(() =>
    (selectedSession.value?.events ?? []).filter((event) =>
      selectedEventIds.value.has(event.id),
    ),
  );
  const projectedObservations = computed(() =>
    (selectedSession.value?.observations ?? []).filter((observation) =>
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
    (selectedSession.value?.adoptionCandidates ?? []).filter((candidate) =>
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
    [...(selectedSession.value?.scheduledEvents ?? [])]
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
    const session = selectedSession.value;
    if (!session) {
      return false;
    }

    return projectedEvents.value.some((event) => Boolean(event.cause.reason)) ||
      Object.keys(session.playLocalStateVisibility).some(
      (key) => session.playLocalStateVisibility[key] === 'playerUnknown',
    ) || projectedEvents.value.some((event) => event.visibility === 'playerUnknown')
      || projectedObservations.value.some((observation) =>
        observation.visibility === 'playerUnknown')
      || projectedCandidates.value.some((candidate) =>
        candidate.visibility === 'playerUnknown')
      || session.scheduledEvents.some((event) =>
        event.status === 'scheduled' &&
        event.template.visibility === 'playerUnknown');
  });

  onMounted(() => {
    void refreshSessions();
  });

  async function refreshSessions() {
    if (sending.value) {
      return;
    }

    loading.value = true;
    error.value = '';

    try {
      const result = await api.listPlaySessions();
      sessions.value = result.sessions;

      if (!sessions.value.some((session) => session.id === selectedSessionId.value)) {
        rememberSelectedSession(sessions.value[0]?.id ?? '');
      }
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

  async function createSession(input: PlaySessionCreateInput) {
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
    const text = userText.value.trim();

    if (!session || !text || interactionBlocked.value) {
      return;
    }

    error.value = '';
    adoptionNotice.value = '';

    const outcome = await submitStreamTurn({
      sessionId: session.id,
      userText: text,
      actionKind: actionKind.value,
      baseRevision: session.revision,
    });

    if (outcome === 'failed' || outcome === 'unknown') {
      error.value = provisionalTurn.value?.error ?? 'Play turn failed before commit.';
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
    if (!session || adoptionBusyId.value || interactionBlocked.value) {
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
    if (!session || adoptionCreating.value || interactionBlocked.value) {
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

  function rememberSelectedSession(id: string) {
    if (selectedSessionId.value !== id) {
      showSpoilers.value = false;
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
    selectedSession,
    selectedSessionId,
    sending,
    interactionBlocked,
    canStop,
    provisionalTurn,
    turnAnnouncement,
    showSpoilers,
    hasHiddenPlayContent,
    sessions,
    sortedEvents,
    stateEntries,
    suggestedActions,
    userText,
    visibleCandidates,
    visibleObservations,
    visibleScheduledEvents,
    createPendingAction,
    createAdoptionCandidate,
    createSession,
    refreshSessions,
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
