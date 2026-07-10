<script setup lang="ts">
import { computed } from 'vue';

import type { PlayActionKind } from '../../composables/useWorkspaceApi';
import type { PlaySuggestedActionView } from '../../composables/usePlayWorkspace';

const userText = defineModel<string>('userText', { required: true });
const actionKind = defineModel<PlayActionKind>('actionKind', { required: true });

const props = defineProps<{
  disabled: boolean;
  sending: boolean;
  suggestions: PlaySuggestedActionView[];
}>();

const emit = defineEmits<{
  submit: [];
}>();

const actions: Array<{ id: PlayActionKind; label: string }> = [
  { id: 'say', label: 'Say' },
  { id: 'look', label: 'Look' },
  { id: 'move', label: 'Move' },
  { id: 'do', label: 'Do' },
  { id: 'wait', label: 'Wait' },
];
const canSubmit = computed(() =>
  !props.disabled && !props.sending && userText.value.trim().length > 0,
);
const placeholder = computed(() =>
  actionKind.value === 'wait'
    ? '例如：等到天亮，留意街区在这段时间发生的变化…'
    : '描述你要说什么、观察什么，或采取什么行动…',
);

function submit() {
  if (canSubmit.value) {
    emit('submit');
  }
}

function useSuggestion(suggestion: PlaySuggestedActionView) {
  if (props.disabled || props.sending) {
    return;
  }

  actionKind.value = suggestion.actionKind;
  userText.value = suggestion.userText;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || (!event.metaKey && !event.ctrlKey)) {
    return;
  }

  event.preventDefault();
  submit();
}
</script>

<template>
  <form class="play-composer" @submit.prevent="submit">
    <div v-if="suggestions.length" class="play-suggestions" aria-label="Suggested actions">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion.id"
        type="button"
        :disabled="disabled || sending"
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
          :disabled="disabled || sending"
          @click="actionKind = action.id"
        >
          <span v-if="action.id === 'wait'" aria-hidden="true">[~]</span>
          {{ action.label }}
        </button>
      </div>

      <label class="visually-hidden" for="play-action-input">Play action</label>
      <textarea
        id="play-action-input"
        v-model="userText"
        rows="3"
        :placeholder="placeholder"
        :disabled="disabled || sending"
        @keydown="handleKeydown"
      ></textarea>

      <footer>
        <span>Play-local · {{ sending ? 'resolving world turn' : 'Cmd/Ctrl + Enter' }}</span>
        <button type="submit" :disabled="!canSubmit" aria-label="提交 Play 行动">
          <span>{{ sending ? 'World moving…' : 'Act' }}</span>
          <span aria-hidden="true">↵</span>
        </button>
      </footer>
    </div>
  </form>
</template>

<style scoped>
.play-composer {
  display: grid;
  gap: 9px;
  padding: 12px 18px 16px;
  border-top: 1px solid rgb(235 226 212);
  background: linear-gradient(180deg, rgb(252 248 241 / 75%), rgb(248 242 232));
}

.play-suggestions {
  display: flex;
  gap: 7px;
  overflow-x: auto;
}

.play-suggestions button,
.play-action-kinds button {
  flex: 0 0 auto;
  min-height: 28px;
  border: 1px solid rgb(224 208 185);
  border-radius: 999px;
  background: rgb(255 253 249);
  color: rgb(120 83 51);
  font-size: 11px;
  font-weight: 800;
}

.play-suggestions button {
  max-width: 260px;
  overflow: hidden;
  padding: 0 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-composer-surface {
  overflow: hidden;
  border: 1px solid rgb(214 198 174);
  border-radius: 11px;
  background: rgb(255 253 249);
  box-shadow: 0 10px 30px rgb(91 67 43 / 8%);
}

.play-action-kinds {
  display: flex;
  gap: 5px;
  padding: 8px 10px 0;
}

.play-action-kinds button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 25px;
  padding: 0 8px;
  border-color: transparent;
  background: transparent;
}

.play-action-kinds .play-action-kind-active {
  border-color: rgb(217 119 6 / 28%);
  background: rgb(254 243 199);
  color: rgb(146 64 14);
}

.play-composer textarea {
  width: 100%;
  min-height: 74px;
  resize: vertical;
  padding: 10px 13px;
  border: 0;
  outline: 0;
  background: transparent;
  color: rgb(68 54 43);
  line-height: 1.55;
}

.play-composer textarea:focus-visible {
  outline: 2px solid rgb(180 83 9);
  outline-offset: -2px;
}

.play-composer-surface:focus-within {
  border-color: rgb(180 83 9);
  box-shadow: 0 0 0 3px rgb(217 119 6 / 16%), 0 10px 30px rgb(91 67 43 / 8%);
}

.play-composer footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 9px 9px 13px;
}

.play-composer footer > span {
  color: rgb(148 119 91);
  font-size: 10px;
}

.play-composer footer button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid rgb(180 83 9);
  border-radius: 8px;
  background: rgb(180 83 9);
  color: white;
  font-weight: 900;
}

:global([data-theme="dark"]) .play-composer {
  border-color: rgb(68 58 49);
  background: rgb(29 25 22);
}

:global([data-theme="dark"]) .play-composer-surface,
:global([data-theme="dark"]) .play-suggestions button {
  border-color: rgb(83 70 58);
  background: rgb(38 32 28);
  color: rgb(245 235 220);
}

:global([data-theme="dark"]) .play-composer textarea {
  color: rgb(245 235 220);
}
</style>
