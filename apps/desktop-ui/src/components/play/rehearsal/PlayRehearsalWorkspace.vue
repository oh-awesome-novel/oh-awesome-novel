<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue';

import PlayActorQueue from './PlayActorQueue.vue';
import PlayDirectorControls from './PlayDirectorControls.vue';
import PlayDirectorInterventionPanel from './PlayDirectorInterventionPanel.vue';
import PlayRehearsalHeader from './PlayRehearsalHeader.vue';
import PlayRehearsalInspector from './PlayRehearsalInspector.vue';
import PlayRehearsalProviderGate from './PlayRehearsalProviderGate.vue';
import PlayRehearsalRecoveryNotice from './PlayRehearsalRecoveryNotice.vue';
import PlayRehearsalResult from './PlayRehearsalResult.vue';
import PlayRehearsalStepPanel from './PlayRehearsalStepPanel.vue';
import PlaySceneMemoryPanel from './PlaySceneMemoryPanel.vue';
import type {
  PlayDirectorInterventionDraft,
  PlayDirectorPanelMode,
  PlayRehearsalActorQueueItem,
  PlayRehearsalAttemptView,
  PlayRehearsalClockView,
  PlayRehearsalControlCapabilities,
  PlayRehearsalPerceptionView,
  PlayRehearsalResultView,
  PlayRehearsalSceneContractView,
  PlaySceneMemoryView,
  PlayRehearsalStepRunView,
  PlayRehearsalStepView,
  PlayRehearsalVisibleEventView,
} from './types';

const props = defineProps<{
  scene: Readonly<PlayRehearsalSceneContractView>;
  clock: Readonly<PlayRehearsalClockView>;
  attempt?: Readonly<PlayRehearsalAttemptView>;
  queue: readonly Readonly<PlayRehearsalActorQueueItem>[];
  steps: readonly Readonly<PlayRehearsalStepView>[];
  stepRun?: Readonly<PlayRehearsalStepRunView>;
  perception?: Readonly<PlayRehearsalPerceptionView>;
  visibleEvents: readonly Readonly<PlayRehearsalVisibleEventView>[];
  result?: Readonly<PlayRehearsalResultView>;
  capabilities: Readonly<PlayRehearsalControlCapabilities>;
  providerConfigured: boolean;
  busy: boolean;
  announcement: string;
  error?: string;
  recoveryRequired?: boolean;
  recoveryMessage?: string;
  recovering?: boolean;
  lens?: 'player' | 'director';
  memory?: Readonly<PlaySceneMemoryView>;
  memoryLoading?: boolean;
  memoryRebuilding?: boolean;
  memoryError?: string;
}>();

const emit = defineEmits<{
  startAttempt: [];
  generateStep: [];
  stopStep: [];
  accept: [stepRef: string];
  retry: [stepRef: string];
  intervene: [draft: PlayDirectorInterventionDraft];
  finish: [];
  cancel: [];
  reconcileStep: [];
  configureProvider: [];
  updateLens: [lens: 'player' | 'director'];
  refreshMemory: [];
  rebuildMemory: [];
}>();

const runtimePanel = useTemplateRef<HTMLElement>('runtimePanel');
const launchButton = useTemplateRef<HTMLButtonElement>('launchButton');
const resultPanel = useTemplateRef<HTMLElement>('resultPanel');
const interventionMode = shallowRef<PlayDirectorPanelMode>();
const activeStep = computed(() =>
  props.steps.find((step) => step.status === 'provisional'),
);
const currentActor = computed(() =>
  props.queue.find((actor) => actor.status === 'current'),
);
const terminalAttempt = computed(() =>
  props.attempt?.status === 'committed' || props.attempt?.status === 'cancelled',
);
const showDirectorControls = computed(() =>
  Boolean(props.attempt && !terminalAttempt.value && !props.result),
);
const launchLabel = computed(() =>
  props.attempt ? 'Generate current actor step' : 'Begin rehearsal attempt',
);
const canLaunch = computed(() =>
  props.providerConfigured && !props.busy && (
    props.attempt
      ? props.capabilities.canGenerateStep
      : props.capabilities.canStartAttempt
  ),
);
const focusKey = computed(() =>
  `${currentActor.value?.participantRef ?? ''}:${activeStep.value?.id ?? ''}`,
);
const launchAvailable = computed(() =>
  !props.attempt &&
  !props.result &&
  props.capabilities.canStartAttempt &&
  !props.busy,
);

watch(focusKey, async (next, previous) => {
  if (!previous || next === previous) {
    return;
  }
  await nextTick();
  if (launchAvailable.value || props.result) {
    return;
  }
  runtimePanel.value?.focus();
});

watch(
  () => props.result?.artifactRef,
  async (next, previous) => {
    if (!next || next === previous) return;
    await nextTick();
    resultPanel.value?.focus();
  },
);

watch(
  launchAvailable,
  async (next, previous) => {
    if (!next || previous) return;
    await nextTick();
    launchButton.value?.focus();
  },
);

function launch(): void {
  if (!canLaunch.value) {
    return;
  }
  if (props.attempt) {
    emit('generateStep');
  } else {
    emit('startAttempt');
  }
}

function openIntervention(mode: PlayDirectorPanelMode): void {
  if (!props.busy) interventionMode.value = mode;
}

function closeIntervention(): void {
  if (!props.busy) interventionMode.value = undefined;
}

function submitIntervention(draft: PlayDirectorInterventionDraft): void {
  if (props.busy) return;
  emit('intervene', draft);
  interventionMode.value = undefined;
}
</script>

<template>
  <section
    class="play-rehearsal-workspace"
    aria-label="Scene rehearsal workspace"
    :aria-busy="busy"
  >
    <PlayRehearsalHeader
      :scene="scene"
      :clock="clock"
      :attempt-status="attempt?.status"
    />

    <p v-if="error" class="play-rehearsal-workspace-error" role="alert">{{ error }}</p>
    <p
      v-if="attempt?.supersededStepRefs?.length"
      class="play-rehearsal-workspace-notice"
    >
      {{ attempt.supersededStepRefs.length }} earlier step variant(s) are superseded; Finish will use only the current selected prefix.
    </p>
    <p
      v-if="attempt?.stagnation?.warning"
      class="play-rehearsal-workspace-notice"
    >
      {{ attempt.stagnation.consecutiveNoMaterialSteps }} consecutive steps had no material effect. The Director may redirect or continue without manufacturing conflict.
    </p>

    <PlayRehearsalRecoveryNotice
      v-if="recoveryRequired"
      :recovering="recovering"
      :message="recoveryMessage || stepRun?.error"
      @recover="emit('reconcileStep')"
    />

    <PlayRehearsalProviderGate
      v-if="!providerConfigured"
      @configure="emit('configureProvider')"
    />

    <div class="play-rehearsal-workspace-grid">
      <PlayActorQueue :items="queue" />

      <main ref="runtimePanel" class="play-rehearsal-runtime" tabindex="-1">
        <div
          v-if="!activeStep && !result && (capabilities.canStartAttempt || capabilities.canGenerateStep)"
          class="play-rehearsal-launch"
        >
          <span aria-hidden="true">[actor step]</span>
          <strong>{{ currentActor ? `${currentActor.displayName} is next` : 'Ready to begin' }}</strong>
          <p>Generation remains provisional until Accept, and the attempt remains uncommitted until Finish.</p>
          <button ref="launchButton" type="button" :disabled="!canLaunch" @click="launch">
            {{ launchLabel }}
          </button>
        </div>

        <PlayRehearsalStepPanel
          :steps="steps"
          :run="stepRun"
          :can-stop="capabilities.canStopStep"
          @stop-step="emit('stopStep')"
        />

        <div
          v-if="result"
          ref="resultPanel"
          class="play-rehearsal-result-focus"
          tabindex="-1"
        >
          <PlayRehearsalResult :result="result" />
          <div v-if="capabilities.canStartAttempt" class="play-rehearsal-next-attempt">
            <div>
              <strong>Continue from committed rehearsal truth</strong>
              <p>Start a new recovery attempt at revision {{ result.revision }}.</p>
            </div>
            <button
              type="button"
              :disabled="!providerConfigured || busy"
              @click="emit('startAttempt')"
            >Begin next rehearsal attempt</button>
          </div>
        </div>
      </main>

      <div class="play-rehearsal-inspector-stack">
        <PlayRehearsalInspector
          :scene="scene"
          :active-actor="currentActor"
          :perception="perception"
          :visible-events="visibleEvents"
          :lens="lens ?? 'director'"
          @update-lens="emit('updateLens', $event)"
        />
        <PlaySceneMemoryPanel
          :memory="memory"
          :lens="lens ?? 'director'"
          :loading="memoryLoading ?? false"
          :rebuilding="memoryRebuilding ?? false"
          :error="memoryError"
          @update-lens="emit('updateLens', $event)"
          @refresh="emit('refreshMemory')"
          @rebuild="emit('rebuildMemory')"
        />
      </div>
    </div>

    <PlayDirectorControls
      v-if="showDirectorControls"
      :active-step-ref="activeStep?.id"
      :attempt-status="attempt!.status"
      :busy="busy"
      :capabilities="capabilities"
      :active-panel="interventionMode"
      :announcement="announcement"
      @accept="emit('accept', $event)"
      @retry="emit('retry', $event)"
      @open-intervention="openIntervention"
      @finish="emit('finish')"
      @cancel="emit('cancel')"
    />

    <PlayDirectorInterventionPanel
      v-if="showDirectorControls && interventionMode"
      :mode="interventionMode"
      :steps="steps"
      :participants="queue"
      :active-step-ref="activeStep?.id"
      :busy="busy"
      @close="closeIntervention"
      @submit="submitIntervention"
    />

    <p class="play-rehearsal-workspace-announcement" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </p>
  </section>
</template>

<style scoped>
.play-rehearsal-workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 10px;
  padding: 12px;
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-workspace-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--play-danger, var(--editor-danger));
  color: var(--play-danger, var(--editor-danger));
  font-size: 11px;
}

.play-rehearsal-workspace-notice {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-launch button {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

.play-rehearsal-workspace-grid {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(170px, 210px) minmax(360px, 1fr) minmax(240px, 290px);
  gap: 10px;
}

.play-rehearsal-runtime {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(280px, 1fr) auto;
  gap: 10px;
  outline: none;
}

.play-rehearsal-inspector-stack {
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 10px;
  overflow: auto;
}

.play-rehearsal-inspector-stack > .play-rehearsal-inspector {
  overflow: visible;
}

.play-rehearsal-runtime:focus-visible {
  outline: 1px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}

.play-rehearsal-result-focus {
  display: grid;
  gap: 10px;
  outline: none;
}

.play-rehearsal-result-focus:focus-visible {
  outline: 1px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}

.play-rehearsal-next-attempt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-next-attempt > div {
  display: grid;
  gap: 2px;
}

.play-rehearsal-next-attempt strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-next-attempt p {
  margin: 0;
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-next-attempt button {
  min-height: 34px;
  flex: 0 0 auto;
  padding: 0 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

.play-rehearsal-launch {
  display: grid;
  justify-items: start;
  gap: 5px;
  padding: 11px;
  border: 1px dashed var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-launch > span,
.play-rehearsal-launch p {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-launch strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-launch p {
  margin: 0;
}

.play-rehearsal-workspace-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 980px) {
  .play-rehearsal-workspace-grid {
    grid-template-columns: minmax(160px, 190px) minmax(320px, 1fr);
  }

  .play-rehearsal-workspace-grid > :last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .play-rehearsal-workspace-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .play-rehearsal-workspace-grid > :last-child {
    grid-column: auto;
  }

  .play-rehearsal-next-attempt {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
