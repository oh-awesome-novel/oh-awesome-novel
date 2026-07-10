import { computed, onMounted, shallowRef } from 'vue';

import { useWorkspaceApi } from './useWorkspaceApi';
import type {
  PlayActionKind,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayEventPolicy,
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
  const sending = shallowRef(false);
  const error = shallowRef('');
  const adoptionBusyId = shallowRef('');
  const adoptionCreating = shallowRef(false);
  const adoptionNotice = shallowRef('');
  const userText = shallowRef('');
  const actionKind = shallowRef<PlayActionKind>('do');
  const showSpoilers = shallowRef(false);

  const selectedSession = computed(() =>
    sessions.value.find((session) => session.id === selectedSessionId.value),
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
  const sortedEvents = computed(() =>
    [...(selectedSession.value?.events ?? [])].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.sequence - left.sequence,
    ),
  );
  const visibleObservations = computed(() =>
    (selectedSession.value?.observations ?? []).filter(
      (observation) => showSpoilers.value || observation.visibility !== 'playerUnknown',
    ),
  );
  const visibleCandidates = computed(() =>
    (selectedSession.value?.adoptionCandidates ?? []).filter(
      (candidate) => showSpoilers.value || candidate.visibility !== 'playerUnknown',
    ),
  );

  onMounted(() => {
    void refreshSessions();
  });

  async function refreshSessions() {
    loading.value = true;
    error.value = '';

    try {
      const result = await api.listPlaySessions();
      sessions.value = result.sessions;

      if (!sessions.value.some((session) => session.id === selectedSessionId.value)) {
        rememberSelectedSession(sessions.value[0]?.id ?? '');
      }
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      loading.value = false;
    }
  }

  function selectSession(id: string) {
    if (sessions.value.some((session) => session.id === id)) {
      rememberSelectedSession(id);
      error.value = '';
      adoptionNotice.value = '';
    }
  }

  async function createSession(input: PlaySessionCreateInput) {
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

    if (!session || !text || sending.value) {
      return;
    }

    sending.value = true;
    error.value = '';
    adoptionNotice.value = '';

    try {
      const result = await api.runPlayWorldRefereeTurn(session.id, {
        userText: text,
        actionKind: actionKind.value,
        baseRevision: session.revision,
      });
      replaceSession(result.session);
      userText.value = '';
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      sending.value = false;
    }
  }

  async function createPendingAction(candidate: PlayAdoptionCandidate): Promise<boolean> {
    const session = selectedSession.value;
    if (!session || adoptionBusyId.value) {
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
    if (!session || adoptionCreating.value) {
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
      item.id === session.id ? session : item,
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
    showSpoilers,
    sessions,
    sortedEvents,
    stateEntries,
    suggestedActions,
    userText,
    visibleCandidates,
    visibleObservations,
    createPendingAction,
    createAdoptionCandidate,
    createSession,
    refreshSessions,
    selectSession,
    submitTurn,
  };
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
