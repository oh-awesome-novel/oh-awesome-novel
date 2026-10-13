<script setup lang="ts">
import { nextTick, useId, useTemplateRef } from 'vue';

const props = defineProps<{
  open: boolean;
  sources: readonly { id: string; label: string }[];
  busy: boolean;
  disabled: boolean;
  canSave: boolean;
  error: string;
  notice: string;
}>();
const summary = defineModel<string>('summary', { required: true });
const evidence = defineModel<string>('evidence', { required: true });
const sourceTurnId = defineModel<string>('sourceTurnId', { required: true });
const emit = defineEmits<{ start: []; cancel: []; save: []; refresh: [] }>();
const prefix = `${useId()}-observation`;
const summaryInput = useTemplateRef<HTMLInputElement>('summaryInput');
const addButton = useTemplateRef<HTMLButtonElement>('addButton');

async function start() {
  emit('start');
  await nextTick();
  summaryInput.value?.focus();
}
async function cancel() {
  if (props.busy) return;
  emit('cancel');
  await nextTick();
  addButton.value?.focus();
}
</script>

<template>
  <div class="play-observation-entry">
    <button v-if="!open" ref="addButton" type="button" :disabled="disabled || !sources.length" @click="start">Add observation</button>
    <p v-if="!sources.length" class="play-observation-help">A committed message with a saved source ID is needed. Continue Play or load earlier transcript before adding an observation.</p>
    <form v-if="open" class="play-observation-form" aria-label="Add observation" :aria-busy="busy" @submit.prevent="emit('save')">
      <p class="play-observation-help">Record your own observation from a visible message. This is a player-visible, noncanonical Play note; saving it does not change novel files.</p>
      <label :for="`${prefix}-source`">Source message</label>
      <select :id="`${prefix}-source`" v-model="sourceTurnId" name="observation-source" :disabled="disabled" required>
        <option value="" disabled>Select a committed message</option>
        <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.label }}</option>
      </select>
      <label :for="`${prefix}-summary`">Observation summary</label>
      <input :id="`${prefix}-summary`" ref="summaryInput" v-model="summary" name="observation-summary" :disabled="disabled" required />
      <label :for="`${prefix}-evidence`">Evidence from this message</label>
      <textarea :id="`${prefix}-evidence`" v-model="evidence" name="observation-evidence" :disabled="disabled" rows="3" required />
      <div class="play-observation-actions">
        <button type="button" :disabled="busy" @click="cancel">Cancel observation</button>
        <button type="submit" :disabled="!canSave">{{ busy ? 'Saving observation…' : 'Save observation' }}</button>
      </div>
    </form>
    <div v-if="error" class="play-observation-error" role="alert">
      <p>{{ error }}</p>
      <p v-if="open">Your input is retained. Refresh the session, review the source, then try saving again.</p>
      <p v-else>Refresh the session to load the saved observation. Do not submit it again.</p>
      <button type="button" :disabled="disabled" @click="emit('refresh')">Refresh observation sources</button>
    </div>
    <p v-if="notice" class="play-observation-help" role="status">{{ notice }}</p>
  </div>
</template>

<style scoped>
.play-observation-entry, .play-observation-form { display: grid; gap: 8px; }
.play-observation-form { padding: 12px 0; }
.play-observation-help, .play-observation-error p { margin: 0; line-height: 1.5; font-size: 12px; }
.play-observation-help { color: var(--play-muted, var(--editor-muted)); }
.play-observation-error { color: var(--play-danger, var(--editor-danger)); }
.play-observation-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.play-observation-entry :where(input, select, textarea, button) { min-height: 44px; max-width: 100%; min-width: 0; }
.play-observation-entry :where(input, select, textarea) { width: 100%; box-sizing: border-box; }
.play-observation-entry :where(input, select, textarea, button):focus-visible { outline: 2px solid var(--play-focus, var(--editor-focus)); outline-offset: 2px; }
</style>
