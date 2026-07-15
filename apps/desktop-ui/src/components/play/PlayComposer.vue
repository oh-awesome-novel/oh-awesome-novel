<script setup lang="ts">
import { computed } from 'vue';

import PlayTimeAdvanceControl from './PlayTimeAdvanceControl.vue';
import type {
  PlayActionKind,
  PlayRelativeTimeAdvance,
} from '../../composables/useWorkspaceApi';
import type { PlaySuggestedActionView } from '../../composables/usePlayWorkspace';
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
}>();

const emit = defineEmits<{
  submit: [];
  stop: [];
}>();

const actions: Array<{ id: PlayActionKind; label: string }> = [
  { id: 'say', label: 'Say' },
  { id: 'look', label: 'Look' },
  { id: 'move', label: 'Move' },
  { id: 'do', label: 'Do' },
  { id: 'wait', label: 'Wait' },
];
const canSubmit = computed(() =>
  !props.disabled && !props.busy && (
    actionKind.value === 'wait'
      ? isValidTimeAdvance(timeAdvance.value)
      : userText.value.trim().length > 0
  ),
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

function useSuggestion(suggestion: PlaySuggestedActionView) {
  if (props.disabled || props.busy) {
    return;
  }

  actionKind.value = suggestion.actionKind;
  userText.value = suggestion.userText;
  if (suggestion.actionKind === 'wait') {
    timeAdvance.value = undefined;
  }
}

function selectActionKind(value: PlayActionKind) {
  actionKind.value = value;
  if (value === 'wait' && !isValidTimeAdvance(timeAdvance.value)) {
    timeAdvance.value = { amount: 10, unit: 'minute' };
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || (!event.metaKey && !event.ctrlKey)) {
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
    <div v-if="suggestions.length" class="play-suggestions" aria-label="Suggested actions">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion.id"
        type="button"
        :disabled="disabled || busy"
        @click="useSuggestion(suggestion)"
      >
        {{ suggestion.label }}
      </button>
    </div>

    <div class="play-composer-surface">
      <div class="play-action-kinds" aria-label="Action kind">
        <button
          v-for="action in actions"
          :key="action.id"
          type="button"
          :class="{ 'play-action-kind-active': actionKind === action.id }"
          :aria-pressed="actionKind === action.id"
          :disabled="disabled || busy"
          @click="selectActionKind(action.id)"
        >
          <span v-if="action.id === 'wait'" aria-hidden="true">[~]</span>
          {{ action.label }}
        </button>
      </div>

      <PlayTimeAdvanceControl
        v-if="actionKind === 'wait'"
        v-model:time-advance="timeAdvance"
        :disabled="disabled || busy"
      />

      <label class="visually-hidden" for="play-action-input">Play action</label>
      <textarea
        id="play-action-input"
        v-model="userText"
        rows="3"
        :placeholder="placeholder"
        :disabled="disabled || busy"
        @keydown="handleKeydown"
      ></textarea>

      <footer>
        <span>Play-local · {{ runStatus }}</span>
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
