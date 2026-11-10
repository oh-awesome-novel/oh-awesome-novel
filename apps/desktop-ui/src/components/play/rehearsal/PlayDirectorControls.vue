<script setup lang="ts">
import { PLAY_REHEARSAL_ATTEMPT_STATUS_LABELS } from '../../../composables/playTerms';
import {
  computed,
  nextTick,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue';

import type {
  PlayDirectorPanelMode,
  PlayRehearsalAttemptStatus,
  PlayRehearsalControl,
  PlayRehearsalControlCapabilities,
} from './types';

const props = defineProps<{
  activeStepRef?: string;
  attemptStatus: PlayRehearsalAttemptStatus;
  busy: boolean;
  capabilities: Readonly<PlayRehearsalControlCapabilities>;
  activePanel?: PlayDirectorPanelMode;
  announcement?: string;
}>();

const emit = defineEmits<{
  accept: [stepRef: string];
  openIntervention: [mode: PlayDirectorPanelMode];
  retry: [stepRef: string];
  finish: [];
  cancel: [];
}>();

type ConfirmationAction = 'finish' | 'cancel';

const pendingAction = shallowRef<ConfirmationAction>();
const returnFocusAction = shallowRef<ConfirmationAction>();
const returnFocusPanel = shallowRef<PlayDirectorPanelMode>();
const modifyButton = useTemplateRef<HTMLButtonElement>('modifyButton');
const insertActorButton = useTemplateRef<HTMLButtonElement>('insertActorButton');
const grantKnowledgeButton = useTemplateRef<HTMLButtonElement>('grantKnowledgeButton');
const finishButton = useTemplateRef<HTMLButtonElement>('finishButton');
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelButton');
const confirmButton = useTemplateRef<HTMLButtonElement>('confirmButton');
const helpId = `${useId()}-director-control-help`;

const helpText = computed(() => {
  if (props.busy) return '请等待当前角色步骤处理完毕。';
  if (!props.activeStepRef) return '先生成一个角色步骤，再采用或重演。';
  return props.announcement || '采用会选定这份草稿；重演会把它保留为本次试演内的另一个结果。';
});

watch(
  () => props.attemptStatus,
  () => {
    pendingAction.value = undefined;
  },
);

watch(
  [() => props.activePanel, () => props.busy],
  async ([panel, busy]) => {
    if (panel || busy || !returnFocusPanel.value) return;
    const target = returnFocusPanel.value;
    returnFocusPanel.value = undefined;
    await nextTick();
    focusPanelAction(target);
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

function requestPanel(mode: PlayDirectorPanelMode): void {
  const enabled = mode === 'modify'
    ? props.capabilities.canModify
    : mode === 'insertActor'
      ? props.capabilities.canInsertActor
      : props.capabilities.canGrantKnowledge;
  if (props.busy || !enabled) return;
  returnFocusPanel.value = mode;
  emit('openIntervention', mode);
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

function focusPanelAction(action: PlayDirectorPanelMode): void {
  (action === 'modify'
    ? modifyButton.value
    : action === 'insertActor'
      ? insertActorButton.value
      : grantKnowledgeButton.value)?.focus();
}
</script>

<template>
  <section class="play-director-controls" aria-label="导演控制">
    <div v-if="!pendingAction" class="play-director-control-row" role="group" :aria-describedby="helpId">
      <button
        type="button"
        :disabled="busy || !capabilities.canAccept || !activeStepRef"
        :title="reasonFor('accept')"
        :aria-describedby="helpId"
        @click="emitStepAction('accept')"
      >采用</button>
      <button
        ref="modifyButton"
        type="button"
        :disabled="busy || !capabilities.canModify"
        :title="reasonFor('modify')"
        :aria-describedby="helpId"
        @click="requestPanel('modify')"
      >修改</button>
      <button
        type="button"
        :disabled="busy || !capabilities.canRetry || !activeStepRef"
        :title="reasonFor('retry')"
        :aria-describedby="helpId"
        @click="emitStepAction('retry')"
      >重演</button>
      <button
        ref="insertActorButton"
        type="button"
        :disabled="busy || !capabilities.canInsertActor"
        :title="reasonFor('insertActor')"
        :aria-describedby="helpId"
        @click="requestPanel('insertActor')"
      >插入角色</button>
      <button
        ref="grantKnowledgeButton"
        type="button"
        :disabled="busy || !capabilities.canGrantKnowledge"
        :title="reasonFor('grantKnowledge')"
        :aria-describedby="helpId"
        @click="requestPanel('grantKnowledge')"
      >授予认知</button>
      <span class="play-director-control-separator" aria-hidden="true"></span>
      <button
        ref="finishButton"
        type="button"
        :disabled="busy || !capabilities.canFinish"
        :title="reasonFor('finish')"
        :aria-describedby="helpId"
        @click="requestConfirmation('finish')"
      >完成试演</button>
      <button
        ref="cancelButton"
        type="button"
        :disabled="busy || !capabilities.canCancel"
        :title="reasonFor('cancel')"
        :aria-describedby="helpId"
        @click="requestConfirmation('cancel')"
      >取消</button>
    </div>

    <div
      v-else
      class="play-director-confirmation"
      role="group"
      :aria-label="pendingAction === 'finish' ? '确认完成试演' : '确认取消试演'"
      @keydown.esc.stop.prevent="closeConfirmation"
    >
      <p v-if="pendingAction === 'finish'">
        完成试演并一次性提交已选步骤？生成中和被替换的结果不会进入提交的记录。
      </p>
      <p v-else>
        取消整次试演？已提交的会话、时钟、状态、事件和记录都不会改变。
      </p>
      <div>
        <button type="button" @click="closeConfirmation">返回</button>
        <button
          ref="confirmButton"
          class="play-director-confirm"
          :class="{ 'play-director-confirm-cancel': pendingAction === 'cancel' }"
          type="button"
          @click="confirmPendingAction"
        >
          {{ pendingAction === 'finish' ? '确认完成' : '确认取消' }}
        </button>
      </div>
    </div>

    <p :id="helpId" class="play-director-control-help">
      试演{{ PLAY_REHEARSAL_ATTEMPT_STATUS_LABELS[attemptStatus] ?? attemptStatus }} · {{ helpText }}
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
