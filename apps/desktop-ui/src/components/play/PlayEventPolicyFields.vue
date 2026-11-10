<script setup lang="ts">
import { computed, useId } from 'vue';
import { playEventSettingsError, type PlayEventSettingsDraft } from '../../composables/playEventPolicyForm';

const { value, disabled = false } = defineProps<{
  value: Readonly<PlayEventSettingsDraft>;
  disabled?: boolean;
}>();
const emit = defineEmits<{ update: [value: PlayEventSettingsDraft] }>();
const prefix = `${useId()}-event-policy`;
const error = computed(() => playEventSettingsError(value));

function toggle(field: 'allowOffscreen' | 'allowHidden', event: Event): void {
  emit('update', { ...value, [field]: (event.target as HTMLInputElement).checked });
}

function updateLimit(event: Event): void {
  emit('update', { ...value, maxExternalEventsPerTurn: (event.target as HTMLInputElement).value });
}
</script>

<template>
  <details class="play-event-settings">
    <summary>事件设置 · 可选</summary>
    <fieldset class="play-event-settings-fields" :disabled="disabled">
      <legend class="visually-hidden">世界事件设置</legend>
      <label class="play-event-toggle">
        <input name="play-allow-offscreen" type="checkbox" :checked="value.allowOffscreen" @change="toggle('allowOffscreen', $event)">
        <span>允许幕后事件</span>
      </label>
      <label class="play-event-toggle">
        <input name="play-allow-hidden" type="checkbox" :checked="value.allowHidden" @change="toggle('allowHidden', $event)">
        <span>允许隐藏事件</span>
      </label>
      <p class="play-event-hint">隐藏事件需要同时开启两项；关闭任一项都不会再产生新的隐藏事件。</p>
      <label class="play-event-limit">
        <span>每回合外部事件上限</span>
        <input
          name="play-event-limit" type="number" min="0" max="6" step="1" required
          :value="value.maxExternalEventsPerTurn" :aria-invalid="Boolean(error)"
          :aria-describedby="`${prefix}-hint${error ? ` ${prefix}-error` : ''}`"
          @input="updateLimit"
        >
      </label>
      <p :id="`${prefix}-hint`" class="play-event-hint">0–6 条自发事件。上限为 0 时，到期的计划事件仍会结算。</p>
      <p v-if="error" :id="`${prefix}-error`" class="play-event-error" role="alert">{{ error }}</p>
    </fieldset>
  </details>
</template>

<style scoped>
.play-event-settings { border: 1px solid var(--play-line, var(--editor-hairline)); padding: 10px; }
.play-event-settings summary { cursor: pointer; color: var(--play-ink, var(--editor-ink)); font-size: 12px; }
.play-event-settings-fields { display: grid; gap: 10px; margin: 12px 0 0; padding: 0; border: 0; }
.play-event-settings-fields .play-event-toggle { display: flex; align-items: center; gap: 8px; }
.play-event-toggle input { width: auto; min-width: auto; }
.play-event-limit { display: grid; gap: 6px; }
.play-event-limit input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--play-line, var(--editor-hairline)); background: var(--play-surface, var(--editor-surface)); color: var(--play-ink, var(--editor-ink)); font: inherit; }
.play-event-hint, .play-event-error { margin: 0; font-size: 12px; line-height: 1.5; }
.play-event-hint { color: var(--play-muted, var(--editor-muted)); }
.play-event-error { color: var(--play-danger, var(--editor-danger)); }
.play-event-settings :focus-visible { outline: 2px solid var(--play-focus, var(--editor-focus)); outline-offset: 2px; }
</style>
