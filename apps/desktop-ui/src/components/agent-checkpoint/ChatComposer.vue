<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUp, ChevronDown, Plus, Sparkles } from '@lucide/vue';
import {
  shouldSubmitWithShortcut,
  useComposerShortcutPreference,
} from '../../composables/useComposerShortcutPreference';

export interface ChatQuickCommand {
  id: string;
  label: string;
  prompt: string;
}

const model = defineModel<string>({ required: true });

const props = withDefaults(defineProps<{
  disabled: boolean;
  quickCommands?: ChatQuickCommand[];
  quickCommandsDisabled?: boolean;
}>(), {
  quickCommands: () => [],
  quickCommandsDisabled: false,
});

const emit = defineEmits<{
  submit: [];
  configureModel: [];
}>();

const {
  shortcut,
  shortcutLabel,
  shortcutOptions,
  setShortcut,
} = useComposerShortcutPreference();
const canSubmit = computed(() => !props.disabled && model.value.trim().length > 0);

function submit() {
  if (!canSubmit.value) {
    return;
  }

  emit('submit');
}

function useQuickCommand(command: ChatQuickCommand) {
  if (props.disabled || props.quickCommandsDisabled) {
    return;
  }

  model.value = command.prompt;
}

function handleKeydown(event: KeyboardEvent) {
  if (!shouldSubmitWithShortcut(event, shortcut.value)) {
    return;
  }

  event.preventDefault();
  submit();
}
</script>

<template>
  <form class="composer" :class="{ 'composer-disabled': disabled }" @submit.prevent="submit">
    <div v-if="quickCommands.length > 0" class="composer-command-rail" aria-label="Novel quick commands">
      <button
        v-for="command in quickCommands"
        :key="command.id"
        class="composer-command-chip"
        type="button"
        :disabled="disabled || quickCommandsDisabled"
        @click="useQuickCommand(command)"
      >
        {{ command.label }}
      </button>
    </div>

    <div class="composer-surface">
      <label class="visually-hidden" for="agent-composer-input">Ask the checkpoint agent</label>
      <textarea
        id="agent-composer-input"
        v-model="model"
        class="composer-input"
        rows="4"
        :disabled="disabled"
        placeholder="Ask the checkpoint agent..."
        @keydown="handleKeydown"
      />

      <div class="composer-footer">
        <div class="composer-action-cluster">
          <button
            class="composer-icon-button"
            type="button"
            disabled
            aria-label="Attach context"
            title="Attach context"
          >
            <Plus :size="17" aria-hidden="true" />
          </button>
          <button
            class="composer-mode-button"
            type="button"
            aria-label="模型切换"
            title="模型切换"
            @click="emit('configureModel')"
          >
            <Sparkles :size="15" aria-hidden="true" />
            模型切换
            <ChevronDown :size="14" aria-hidden="true" />
          </button>
        </div>

        <div class="composer-send-wrap">
          <div class="composer-send-popover" role="menu" aria-label="发送方式">
            <div class="composer-send-popover-heading">
              <strong>{{ shortcutLabel }}</strong>
              <span>发送方式</span>
            </div>
            <button
              v-for="option in shortcutOptions"
              :key="option.value"
              class="composer-send-shortcut-option"
              :class="{ 'composer-send-shortcut-option-active': shortcut === option.value }"
              type="button"
              role="menuitemradio"
              :aria-checked="shortcut === option.value"
              @click="setShortcut(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
          <button
            class="composer-send-button"
            type="submit"
            :disabled="!canSubmit"
            aria-label="Send message"
            :title="`Send message (${shortcutLabel})`"
          >
            <ArrowUp :size="19" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </form>
</template>
