<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue';

import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlaySession,
} from '../../composables/useWorkspaceApi';

const emit = defineEmits<{
  pendingActionCreated: [];
}>();

const api = useWorkspaceApi();
const sessions = shallowRef<PlaySession[]>([]);
const selectedSessionId = shallowRef('');
const loading = shallowRef(false);
const saving = shallowRef(false);
const error = shallowRef('');
const adoptionStatus = shallowRef('');

const createForm = reactive({
  title: '',
  sceneStart: '',
  userPersona: '',
  characters: '',
});
const turnForm = reactive({
  speaker: 'user',
  content: '',
});
const candidateForm = reactive({
  target: 'chapterDraft' as PlayAdoptionTarget,
  summary: '',
  evidence: '',
  payload: '',
});

const selectedSession = computed(() =>
  sessions.value.find((session) => session.id === selectedSessionId.value),
);
const sortedCandidates = computed(() =>
  selectedSession.value?.adoptionCandidates ?? [],
);

onMounted(() => {
  void refreshSessions();
});

async function refreshSessions() {
  loading.value = true;
  error.value = '';

  try {
    sessions.value = (await api.listPlaySessions()).sessions;
    selectedSessionId.value = selectedSessionId.value || sessions.value[0]?.id || '';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function createSession() {
  if (!createForm.title.trim() || !createForm.sceneStart.trim()) {
    error.value = 'Title and scene are required.';
    return;
  }

  saving.value = true;
  error.value = '';

  try {
    const result = await api.createPlaySession({
      title: createForm.title.trim(),
      sceneStart: createForm.sceneStart.trim(),
      userPersona: createForm.userPersona.trim() || undefined,
      characters: splitLines(createForm.characters),
    });
    sessions.value = [result.session, ...sessions.value.filter((session) => session.id !== result.session.id)];
    selectedSessionId.value = result.session.id;
    createForm.title = '';
    createForm.sceneStart = '';
    createForm.userPersona = '';
    createForm.characters = '';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function appendTurn() {
  const session = selectedSession.value;
  if (!session || !turnForm.speaker.trim() || !turnForm.content.trim()) {
    return;
  }

  saving.value = true;
  error.value = '';

  try {
    const result = await api.appendPlayTranscript(session.id, {
      speaker: turnForm.speaker.trim(),
      content: turnForm.content.trim(),
    });
    replaceSession(result.session);
    turnForm.content = '';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function addCandidate() {
  const session = selectedSession.value;
  if (!session || !candidateForm.summary.trim() || !candidateForm.evidence.trim()) {
    return;
  }

  const payload = parsePayload(candidateForm.payload);
  if (payload instanceof Error) {
    error.value = payload.message;
    return;
  }

  saving.value = true;
  error.value = '';

  try {
    const result = await api.addPlayAdoptionCandidate(session.id, {
      target: candidateForm.target,
      summary: candidateForm.summary.trim(),
      evidence: candidateForm.evidence.trim(),
      ...(payload ? { payload } : {}),
    });
    replaceSession(result.session);
    candidateForm.summary = '';
    candidateForm.evidence = '';
    candidateForm.payload = '';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function createPendingAction(candidate: PlayAdoptionCandidate) {
  const session = selectedSession.value;
  if (!session) {
    return;
  }

  adoptionStatus.value = candidate.id;
  error.value = '';

  try {
    await api.createPlayAdoptionPendingAction(session.id, candidate.id);
    emit('pendingActionCreated');
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    adoptionStatus.value = '';
  }
}

function replaceSession(session: PlaySession) {
  sessions.value = sessions.value.map((item) =>
    item.id === session.id ? session : item,
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePayload(value: string): Record<string, unknown> | undefined | Error {
  if (!value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : new Error('Payload must be a JSON object.');
  } catch {
    return new Error('Payload must be valid JSON.');
  }
}
</script>

<template>
  <section class="right-tab-panel play-mode-panel" aria-label="Play mode">
    <div class="panel-heading">
      <div>
        <h2 class="panel-title">Play Mode</h2>
        <p class="empty-copy">Play-local · non-canonical</p>
      </div>
      <button class="ghost-button tight-button" type="button" :disabled="loading" @click="refreshSessions">
        Refresh
      </button>
    </div>

    <p v-if="error" class="error-copy">{{ error }}</p>

    <section class="play-section" aria-label="Create Play session">
      <div class="form-grid">
        <input v-model="createForm.title" class="text-input" type="text" placeholder="Session title">
        <input v-model="createForm.sceneStart" class="text-input" type="text" placeholder="Scene">
        <input v-model="createForm.userPersona" class="text-input" type="text" placeholder="Persona">
        <textarea v-model="createForm.characters" class="text-input" rows="2" placeholder="Characters"></textarea>
      </div>
      <button class="primary-button tight-button" type="button" :disabled="saving" @click="createSession">
        Create
      </button>
    </section>

    <section class="play-section" aria-label="Play sessions">
      <div v-if="sessions.length" class="play-session-list">
        <button
          v-for="session in sessions"
          :key="session.id"
          class="play-session-row"
          :class="{ 'play-session-row-active': session.id === selectedSessionId }"
          type="button"
          @click="selectedSessionId = session.id"
        >
          <strong>{{ session.title }}</strong>
          <span>{{ session.sceneStart }}</span>
        </button>
      </div>
      <p v-else class="empty-copy">No Play sessions.</p>
    </section>

    <section v-if="selectedSession" class="play-section" aria-label="Selected Play session">
      <div class="panel-heading">
        <h3 class="panel-title">{{ selectedSession.title }}</h3>
        <span class="status-pill">{{ selectedSession.transcript.length }} turns</span>
      </div>

      <div class="play-transcript">
        <div v-for="turn in selectedSession.transcript" :key="`${turn.speaker}:${turn.createdAt}`" class="play-turn">
          <strong>{{ turn.speaker }}</strong>
          <p>{{ turn.content }}</p>
        </div>
      </div>

      <div class="form-grid">
        <input v-model="turnForm.speaker" class="text-input" type="text" placeholder="Speaker">
        <textarea v-model="turnForm.content" class="text-input" rows="3" placeholder="Turn"></textarea>
      </div>
      <button class="ghost-button tight-button" type="button" :disabled="saving" @click="appendTurn">
        Append Turn
      </button>
    </section>

    <section v-if="selectedSession" class="play-section" aria-label="Adoption candidates">
      <div class="panel-heading">
        <h3 class="panel-title">Adoption Candidates</h3>
        <span class="status-pill">{{ sortedCandidates.length }}</span>
      </div>
      <div class="form-grid">
        <select v-model="candidateForm.target" class="text-input">
          <option value="chapterDraft">chapterDraft</option>
          <option value="state">state</option>
          <option value="timeline">timeline</option>
          <option value="foreshadow">foreshadow</option>
        </select>
        <input v-model="candidateForm.summary" class="text-input" type="text" placeholder="Summary">
        <textarea v-model="candidateForm.evidence" class="text-input" rows="2" placeholder="Evidence"></textarea>
        <textarea v-model="candidateForm.payload" class="text-input" rows="4" placeholder='{"chapterId":"0001/0002","content":"..."}'></textarea>
      </div>
      <button class="ghost-button tight-button" type="button" :disabled="saving" @click="addCandidate">
        Add Candidate
      </button>

      <div v-if="sortedCandidates.length" class="play-candidate-list">
        <article v-for="candidate in sortedCandidates" :key="candidate.id" class="play-candidate-row">
          <div>
            <strong>{{ candidate.target }}</strong>
            <p>{{ candidate.summary }}</p>
            <span>{{ candidate.evidence }}</span>
          </div>
          <button
            class="primary-button tight-button"
            type="button"
            :disabled="adoptionStatus === candidate.id"
            @click="createPendingAction(candidate)"
          >
            PendingAction
          </button>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.play-mode-panel {
  gap: 12px;
}

.play-section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(255 255 255);
}

:global([data-theme="dark"]) .play-section {
  border-color: rgb(64 64 64);
  background: rgb(23 23 23);
}

.form-grid {
  display: grid;
  gap: 8px;
}

.play-session-list,
.play-candidate-list,
.play-transcript {
  display: grid;
  gap: 8px;
}

.play-session-row,
.play-turn,
.play-candidate-row {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(248 250 252);
  color: inherit;
  text-align: left;
}

.play-session-row {
  cursor: pointer;
}

.play-session-row-active {
  border-color: rgb(14 165 233);
}

:global([data-theme="dark"]) .play-session-row,
:global([data-theme="dark"]) .play-turn,
:global([data-theme="dark"]) .play-candidate-row {
  border-color: rgb(64 64 64);
  background: rgb(38 38 38);
}

.play-session-row span,
.play-turn p,
.play-candidate-row p,
.play-candidate-row span {
  margin: 0;
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-size: 12px;
}

:global([data-theme="dark"]) .play-session-row span,
:global([data-theme="dark"]) .play-turn p,
:global([data-theme="dark"]) .play-candidate-row p,
:global([data-theme="dark"]) .play-candidate-row span {
  color: rgb(163 163 163);
}

.play-candidate-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}
</style>
