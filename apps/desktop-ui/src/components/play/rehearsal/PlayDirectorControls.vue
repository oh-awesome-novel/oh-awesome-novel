<script setup lang="ts">
import {
  computed,
  nextTick,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue';

import type {
  PlayRehearsalAttemptStatus,
  PlayRehearsalControl,
  PlayRehearsalControlCapabilities,
} from './types';

const props = defineProps<{
  activeStepRef?: string;
  attemptStatus: PlayRehearsalAttemptStatus;
  busy: boolean;
  capabilities: Readonly<PlayRehearsalControlCapabilities>;
  announcement?: string;
}>();

const emit = defineEmits<{
  accept: [stepRef: string];
  retry: [stepRef: string];
  finish: [];
  cancel: [];
}>();

type ConfirmationAction = 'finish' | 'cancel';

const pendingAction = shallowRef<ConfirmationAction>();
const returnFocusAction = shallowRef<ConfirmationAction>();
const finishButton = useTemplateRef<HTMLButtonElement>('finishButton');
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelButton');
const confirmButton = useTemplateRef<HTMLButtonElement>('confirmButton');
const helpId = `${useId()}-director-control-help`;

const helpText = computed(() => {
  if (props.busy) return 'Wait for the current actor-step operation to reach terminal truth.';
  if (!props.activeStepRef) return 'Generate a provisional actor step before using Accept or Retry.';
  return props.announcement || 'Accept selects the draft. Retry preserves it as an attempt-local variant.';
});

watch(
  () => props.attemptStatus,
  () => {
    pendingAction.value = undefined;
  },
);

watch(
  () => props.busy,
  async (next, previous) => {
    if (!previous || next || !returnFocusAction.value) {
      return;
    }
    const action = returnFocusAction.value;
    returnFocusAction.value = undefined;
    await nextTick();
    focusAction(action);
  },
);

function reasonFor(action: PlayRehearsalControl): string | undefined {
  return props.capabilities.disabledReasons?.[action];
}

function emitStepAction(action: 'accept' | 'retry'): void {
  const enabled = action === 'accept'
    ? props.capabilities.canAccept
    : props.capabilities.canRetry;
  if (props.busy || !enabled || !props.activeStepRef) {
    return;
  }
  if (action === 'accept') {
    emit('accept', props.activeStepRef);
  } else {
    emit('retry', props.activeStepRef);
  }
}

async function requestConfirmation(action: ConfirmationAction): Promise<void> {
  const enabled = action === 'finish'
    ? props.capabilities.canFinish
    : props.capabilities.canCancel;
  if (props.busy || !enabled) {
    return;
  }
  pendingAction.value = action;
  await nextTick();
  confirmButton.value?.focus();
}

async function closeConfirmation(): Promise<void> {
  const action = pendingAction.value;
  if (!action) {
    return;
  }
  pendingAction.value = undefined;
  await nextTick();
  focusAction(action);
}

async function confirmPendingAction(): Promise<void> {
  const action = pendingAction.value;
  if (!action) {
    return;
  }
  returnFocusAction.value = action;
  pendingAction.value = undefined;
  if (action === 'finish') {
    emit('finish');
  } else {
    emit('cancel');
  }
  await nextTick();
  if (!props.busy && returnFocusAction.value === action) {
    returnFocusAction.value = undefined;
    focusAction(action);
  }
}

function focusAction(action: ConfirmationAction): void {
  (action === 'finish' ? finishButton.value : cancelButton.value)?.focus();
}
</script>

<template>
  <section class="play-director-controls" aria-label="Director controls">
    <div v-if="!pendingAction" class="play-director-control-row" role="group" :aria-describedby="helpId">
      <button
        type="button"
        :disabled="busy || !capabilities.canAccept || !activeStepRef"
        :title="reasonFor('accept')"
        :aria-describedby="helpId"
        @click="emitStepAction('accept')"
      >Accept</button>
      <button
        type="button"
        :disabled="busy || !capabilities.canRetry || !activeStepRef"
        :title="reasonFor('retry')"
        :aria-describedby="helpId"
        @click="emitStepAction('retry')"
      >Retry</button>
      <span class="play-director-control-separator" aria-hidden="true"></span>
      <button
        ref="finishButton"
        type="button"
        :disabled="busy || !capabilities.canFinish"
        :title="reasonFor('finish')"
        :aria-describedby="helpId"
        @click="requestConfirmation('finish')"
      >Finish</button>
      <button
        ref="cancelButton"
        type="button"
        :disabled="busy || !capabilities.canCancel"
        :title="reasonFor('cancel')"
        :aria-describedby="helpId"
        @click="requestConfirmation('cancel')"
      >Cancel attempt</button>
    </div>

    <div
      v-else
      class="play-director-confirmation"
      role="group"
      :aria-label="pendingAction === 'finish' ? 'Confirm rehearsal finish' : 'Confirm rehearsal cancellation'"
      @keydown.esc.stop.prevent="closeConfirmation"
    >
      <p v-if="pendingAction === 'finish'">
        Finish and commit the selected step prefix once? Provisional and superseded variants stay out of the committed transcript.
      </p>
      <p v-else>
        Cancel this entire attempt? The committed session revision, clock, state, events and transcript remain unchanged.
      </p>
      <div>
        <button type="button" @click="closeConfirmation">Back</button>
        <button
          ref="confirmButton"
          class="play-director-confirm"
          :class="{ 'play-director-confirm-cancel': pendingAction === 'cancel' }"
          type="button"
          @click="confirmPendingAction"
        >
          {{ pendingAction === 'finish' ? 'Confirm Finish' : 'Confirm Cancel attempt' }}
        </button>
      </div>
    </div>

    <p :id="helpId" class="play-director-control-help">
      Attempt {{ attemptStatus }} · {{ helpText }}
    </p>
  </section>
</template>

<style scoped>
.play-director-controls {
  display: grid;
  gap: 7px;
  padding: 10px 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-director-control-row,
.play-director-confirmation > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.play-director-control-row button,
.play-director-confirmation button {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}

.play-director-control-row button:first-child,
.play-director-confirmation .play-director-confirm:not(.play-director-confirm-cancel) {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

.play-director-control-separator {
  width: 1px;
  height: 24px;
  margin: 0 2px;
  background: var(--play-line, var(--editor-hairline));
}

.play-director-confirmation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.play-director-confirmation p,
.play-director-control-help {
  margin: 0;
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
  line-height: 1.5;
}

.play-director-confirmation .play-director-confirm-cancel {
  border-color: var(--play-danger, var(--editor-danger));
  color: var(--play-danger, var(--editor-danger));
}

@media (max-width: 640px) {
  .play-director-control-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .play-director-control-separator {
    display: none;
  }

  .play-director-confirmation {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
