<script setup lang="ts">
import { nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue';

import PlaySessionCreateForm from './PlaySessionCreateForm.vue';
import PlayRehearsalSetup from './rehearsal/PlayRehearsalSetup.vue';
import PlaySessionPurposePicker from './rehearsal/PlaySessionPurposePicker.vue';
import type {
  PlayRehearsalSetupSubmission,
  PlaySessionPurposeChoice,
} from './rehearsal/types';
import { buildPlayRehearsalSessionInput } from '../../composables/playRehearsalPresentation';
import type { PlaySession } from '../../composables/useWorkspaceApi';
import type { PlaySessionCreateRequest } from '../../composables/usePlayWorkspace';

const props = defineProps<{
  sessions: PlaySession[];
  selectedSessionId: string;
  loading: boolean;
  creating: boolean;
  busy: boolean;
  refreshDisabled: boolean;
}>();

const emit = defineEmits<{
  selectSession: [id: string];
  createSession: [input: PlaySessionCreateRequest];
  refresh: [];
}>();

const createOpen = shallowRef(false);
const createPurpose = shallowRef<PlaySessionPurposeChoice>();
const createTrigger = useTemplateRef<HTMLButtonElement>('createTrigger');
const createFlow = useTemplateRef<HTMLDivElement>('createFlow');
const createPanelId = `${useId()}-play-session-create-panel`;

watch(
  () => props.selectedSessionId,
  (nextId, previousId) => {
    if (nextId && nextId !== previousId) {
      void closeCreate(true);
    }
  },
);

function toggleCreate(): void {
  if (createOpen.value) {
    void closeCreate(true);
    return;
  }
  createOpen.value = true;
  createPurpose.value = undefined;
}

async function closeCreate(focusTrigger = false): Promise<void> {
  createOpen.value = false;
  createPurpose.value = undefined;
  if (focusTrigger) {
    await nextTick();
    createTrigger.value?.focus();
  }
}

async function choosePurpose(purpose: PlaySessionPurposeChoice): Promise<void> {
  createPurpose.value = purpose;
  await nextTick();
  createFlow.value?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
}

async function returnToPurpose(): Promise<void> {
  createPurpose.value = undefined;
  await nextTick();
  createFlow.value?.querySelector<HTMLElement>('.play-purpose-options button')?.focus();
}

function createRehearsal(submission: PlayRehearsalSetupSubmission): void {
  emit('createSession', buildPlayRehearsalSessionInput(submission));
}
</script>

<template>
  <aside class="play-session-rail" aria-label="Play sessions">
    <div class="play-rail-heading">
      <div>
        <span class="play-kicker">Stage door</span>
        <h2>Play Sessions</h2>
      </div>
      <button
        class="play-icon-button"
        type="button"
        :disabled="loading || refreshDisabled"
        aria-label="刷新 Play sessions"
        @click="emit('refresh')"
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>

    <button
      ref="createTrigger"
      class="play-create-trigger"
      type="button"
      :disabled="busy"
      :aria-expanded="createOpen"
      :aria-controls="createPanelId"
      @click="toggleCreate"
    >
      <span aria-hidden="true">[+]</span>
      New session
    </button>

    <div v-if="createOpen" :id="createPanelId" ref="createFlow" class="play-create-flow">
      <PlaySessionPurposePicker
        v-if="!createPurpose"
        :disabled="creating || busy"
        @choose="choosePurpose"
        @cancel="closeCreate(true)"
      />
      <PlaySessionCreateForm
        v-else-if="createPurpose === 'immersiveJourney'"
        :creating="creating || busy"
        @cancel="returnToPurpose"
        @create="emit('createSession', $event)"
      />
      <PlayRehearsalSetup
        v-else
        :creating="creating"
        :disabled="busy"
        @cancel="returnToPurpose"
        @create="createRehearsal"
      />
    </div>

    <div class="play-session-list">
      <button
        v-for="session in sessions"
        :key="session.id"
        class="play-session-card"
        :class="{ 'play-session-card-active': session.id === selectedSessionId }"
        type="button"
        :disabled="busy"
        :aria-current="session.id === selectedSessionId ? 'true' : undefined"
        @click="emit('selectSession', session.id)"
      >
        <span class="play-session-title">{{ session.title }}</span>
        <span class="play-session-scene">{{ session.sceneStart }}</span>
        <span class="play-session-meta">
          Turn {{ session.worldClock.turn }} · {{ session.transcript.length }} messages
        </span>
      </button>
      <p v-if="!loading && sessions.length === 0" class="play-empty-copy">
        暂无 Play session。创建一个场景，让人物和世界开始运转。
      </p>
    </div>
  </aside>
</template>

<style scoped>
.play-create-flow {
  min-width: 0;
}

.play-create-flow :deep(.play-rehearsal-setup-heading),
.play-create-flow :deep(.play-rehearsal-review footer),
.play-create-flow :deep(.play-rehearsal-cast footer) {
  align-items: stretch;
  flex-direction: column;
}

.play-create-flow :deep(.play-rehearsal-field-grid),
.play-create-flow :deep(.play-rehearsal-cast-fields),
.play-create-flow :deep(.play-rehearsal-review dl) {
  grid-template-columns: minmax(0, 1fr);
}

.play-create-flow :deep(.play-rehearsal-field-wide),
.play-create-flow :deep(.play-rehearsal-cast-wide) {
  grid-column: auto;
}

.play-create-flow :deep(.play-rehearsal-setup-panel) {
  padding: 12px;
}
</style>
