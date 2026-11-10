<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue';

import PlayFollowUpQueue from './PlayFollowUpQueue.vue';
import PlayTimeAdvanceControl from './PlayTimeAdvanceControl.vue';
import type {
  PlayActionKind,
  PlayRelativeTimeAdvance,
} from '../../composables/useWorkspaceApi';
import type { PlayFollowUpControls } from '../../composables/usePlayFollowUpQueue';
import { canSubmitPlayChoiceDirectly, type PlaySuggestedActionView } from '../../composables/usePlayWorkspace';
import type { PlayTurnRunPhase } from '../../composables/usePlayTurnStream';

const userText = defineModel<string>('userText', { required: true });
const actionKind = defineModel<PlayActionKind>('actionKind', { required: true });
const timeAdvance = defineModel<PlayRelativeTimeAdvance | undefined>('timeAdvance', {
  required: true,
});

const props = defineProps<{
  disabled: boolean;
  busy: boolean;
  phase?: PlayTurnRunPhase;
  canStop: boolean;
  suggestions: PlaySuggestedActionView[];
  /** A Play turn is running; the input stays usable to queue or steer. */
  running?: boolean;
  canSteer?: boolean;
  followUps?: PlayFollowUpControls;
  /** Another surface (the visual novel stage) owns the number keys. */
  suppressChoiceHotkeys?: boolean;
  /** The session has committed turns, so missing options are worth explaining. */
  showEmptyChoices?: boolean;
}>();

const emit = defineEmits<{
  /** Sends the action, or queues it while a turn runs. */
  submit: [];
  /** Sends one option as the turn's action, leaving the composer draft alone. */
  choose: [suggestion: PlaySuggestedActionView];
  steer: [];
  stop: [];
}>();

const actions: Array<{ id: PlayActionKind; label: string }> = [
  { id: 'say', label: 'Say' },
  { id: 'look', label: 'Look' },
  { id: 'move', label: 'Move' },
  { id: 'do', label: 'Do' },
  { id: 'wait', label: 'Wait' },
];
// While a turn runs only that turn holds the composer; other busy work locks it.
const inputLocked = computed(() => props.disabled || (props.busy && !props.running));
// Options belong to the last committed turn; they are not offered while anything else runs.
const choiceLocked = computed(() => props.disabled || props.busy);
const choices = computed(() => props.suggestions.slice(0, 9));
const textarea = shallowRef<HTMLTextAreaElement>();
const kindLabels: Record<PlayActionKind, string> = { say: '说', look: '看', move: '走', do: '做', wait: '等' };
const unitLabels: Record<PlayRelativeTimeAdvance['unit'], string> = { minute: '分钟', hour: '小时', day: '天' };
const canSubmit = computed(() =>
  !inputLocked.value && (
    actionKind.value === 'wait'
      ? isValidTimeAdvance(timeAdvance.value)
      : userText.value.trim().length > 0
  ),
);
const canSendSteer = computed(() =>
  Boolean(props.running && props.canSteer) && userText.value.trim().length > 0,
);
const runStatus = computed(() => {
  switch (props.phase) {
    case 'starting': return 'starting world referee';
    case 'streaming': return 'streaming · not committed';
    case 'prepared': return 'validated · waiting to commit';
    case 'stopping': return 'server is cancelling';
    case 'committing': return 'committing Play truth';
    case 'cancelled': return 'cancelled · draft preserved';
    case 'failed': return 'failed · draft preserved';
    case 'conflict': return 'revision conflict · draft preserved';
    case 'indeterminate': return 'server outcome unknown · refresh required';
    default: return 'Cmd/Ctrl + Enter';
  }
});
const stopLabel = computed(() => {
  if (props.phase === 'stopping') return 'Stopping…';
  if (props.phase === 'committing') return 'Committing…';
  if (props.phase === 'starting') return 'Starting…';
  return 'Stop';
});
const placeholder = computed(() =>
  actionKind.value === 'wait'
    ? '可选：描述等待期间要做什么、关注什么，或防备什么…'
    : '描述你要说什么、观察什么，或采取什么行动…',
);
const submitLabel = computed(() => actionKind.value === 'wait' ? 'Advance' : 'Act');

function submit() {
  if (canSubmit.value) {
    emit('submit');
  }
}

function steer() {
  if (canSendSteer.value) {
    emit('steer');
  }
}

function choiceKindLabel(suggestion: PlaySuggestedActionView): string {
  const advance = suggestion.timeAdvance;
  return advance
    ? `${kindLabels.wait} ${advance.amount} ${unitLabels[advance.unit]}`
    : kindLabels[suggestion.actionKind];
}

function pickChoice(suggestion: PlaySuggestedActionView) {
  if (choiceLocked.value) {
    return;
  }
  // The host never guesses how long a wait lasts: the author sets it in the composer first.
  if (!canSubmitPlayChoiceDirectly(suggestion)) {
    editChoice(suggestion);
    return;
  }
  emit('choose', suggestion);
}

function editChoice(suggestion: PlaySuggestedActionView) {
  if (inputLocked.value) {
    return;
  }

  actionKind.value = suggestion.actionKind;
  userText.value = suggestion.userText;
  if (suggestion.actionKind === 'wait') {
    timeAdvance.value = suggestion.timeAdvance;
  }
  textarea.value?.focus();
}

function writeOwnAction() {
  if (inputLocked.value) {
    return;
  }
  // Text that is just an untouched option is not a draft worth keeping.
  if (props.suggestions.some(suggestion => suggestion.userText === userText.value)) {
    userText.value = '';
  }
  textarea.value?.focus();
}

function handleChoiceHotkey(event: KeyboardEvent) {
  if (
    props.suppressChoiceHotkeys || choiceLocked.value || event.repeat || event.isComposing
    || event.metaKey || event.ctrlKey || event.altKey || !/^[1-9]$/u.test(event.key)
  ) {
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) {
    return;
  }
  if (document.querySelector('dialog[open], [aria-modal="true"]')) {
    return;
  }
  const choice = choices.value[Number(event.key) - 1];
  if (choice) {
    event.preventDefault();
    pickChoice(choice);
  }
}

onMounted(() => document.addEventListener('keydown', handleChoiceHotkey));
onBeforeUnmount(() => document.removeEventListener('keydown', handleChoiceHotkey));

function selectActionKind(value: PlayActionKind) {
  actionKind.value = value;
  if (value === 'wait' && !isValidTimeAdvance(timeAdvance.value)) {
    timeAdvance.value = { amount: 10, unit: 'minute' };
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) {
    return;
  }
  if (event.altKey && props.running) {
    event.preventDefault();
    steer();
    return;
  }
  if (!event.metaKey && !event.ctrlKey) {
    return;
  }

  event.preventDefault();
  submit();
}

function isValidTimeAdvance(
  value: PlayRelativeTimeAdvance | undefined,
): value is PlayRelativeTimeAdvance {
  if (!value || !Number.isSafeInteger(value.amount) || value.amount <= 0) {
    return false;
  }
  const minutes = value.unit === 'day'
    ? value.amount * 1_440
    : value.unit === 'hour'
      ? value.amount * 60
      : value.amount;
  return minutes <= 525_600;
}
</script>

<template>
  <form class="play-composer" @submit.prevent="submit">
    <ol v-if="choices.length" class="play-choices" aria-label="候选行动">
      <li v-for="(suggestion, index) in choices" :key="suggestion.id">
        <button
          class="play-choice-pick"
          type="button"
          :disabled="choiceLocked"
          :title="canSubmitPlayChoiceDirectly(suggestion) ? `以这条行动推进本回合（按 ${index + 1}）` : '这条等待没有写明时长，先在下方选择时长'"
          @click="pickChoice(suggestion)"
        >
          <kbd aria-hidden="true">{{ index + 1 }}</kbd>
          <span class="play-choice-kind">{{ choiceKindLabel(suggestion) }}</span>
          <span class="play-choice-text">{{ suggestion.label }}</span>
        </button>
        <button
          class="play-choice-edit"
          type="button"
          :disabled="inputLocked"
          :aria-label="`修改候选行动 ${index + 1}`"
          @click="editChoice(suggestion)"
        >
          改一改
        </button>
      </li>
      <li>
        <button class="play-choice-own" type="button" :disabled="inputLocked" @click="writeOwnAction">
          自己写
        </button>
      </li>
    </ol>
    <p v-else-if="showEmptyChoices && !busy" class="play-choices-empty">
      本回合没有候选行动，在下方写下你的行动。
    </p>

    <div class="play-composer-surface">
      <div class="play-action-kinds" aria-label="Action kind">
        <button
          v-for="action in actions"
          :key="action.id"
          type="button"
          :class="{ 'play-action-kind-active': actionKind === action.id }"
          :aria-pressed="actionKind === action.id"
          :disabled="inputLocked"
          @click="selectActionKind(action.id)"
        >
          <span v-if="action.id === 'wait'" aria-hidden="true">[~]</span>
          {{ action.label }}
        </button>
      </div>

      <PlayTimeAdvanceControl
        v-if="actionKind === 'wait'"
        v-model:time-advance="timeAdvance"
        :disabled="inputLocked"
      />

      <label class="visually-hidden" for="play-action-input">Play action</label>
      <textarea
        id="play-action-input"
        ref="textarea"
        v-model="userText"
        rows="3"
        :placeholder="placeholder"
        :disabled="inputLocked"
        @keydown="handleKeydown"
      ></textarea>

      <PlayFollowUpQueue
        v-if="followUps"
        :controls="followUps"
        :can-steer="Boolean(running && canSteer)"
        :running="Boolean(running)"
      />

      <footer>
        <span>Play-local · {{ runStatus }}</span>
        <template v-if="running">
          <button
            class="play-queue-button"
            type="submit"
            :disabled="!canSubmit"
            title="本回合提交后再发送 (Cmd/Ctrl + Enter)"
            aria-label="排队 Play 行动"
          >
            排队
          </button>
          <button
            class="play-steer-button"
            type="button"
            :disabled="!canSendSteer"
            title="停止本回合未提交的生成，把这句补充进当前行动后重新生成 (Alt + Enter)"
            aria-label="插话"
            @click="steer"
          >
            插话
          </button>
        </template>
        <button
          v-if="busy"
          class="play-stop-button"
          type="button"
          :disabled="!canStop"
          aria-label="停止 Play 回合"
          @click="emit('stop')"
        >
          <span>{{ stopLabel }}</span>
          <span aria-hidden="true">■</span>
        </button>
        <button v-else type="submit" :disabled="!canSubmit" aria-label="提交 Play 行动">
          <span>{{ submitLabel }}</span>
          <span aria-hidden="true">↵</span>
        </button>
      </footer>
    </div>
  </form>
</template>
