<script setup lang="ts">
import { useId, type DeepReadonly } from 'vue';

import type {
  PlayGuidedEntryDraft,
  PlayGuidedEventDensity,
  PlayGuidedSimulationMode,
  PlayGuidedSourceOption,
  PlayGuidedStartErrors,
} from '../../../composables/usePlayGuidedStart';

const { draft, sources, errors, disabled } = defineProps<{
  draft: DeepReadonly<PlayGuidedEntryDraft>;
  sources: readonly Readonly<PlayGuidedSourceOption>[];
  errors: Readonly<PlayGuidedStartErrors>;
  disabled: boolean;
}>();

const emit = defineEmits<{
  update: [patch: Partial<PlayGuidedEntryDraft>];
  toggleSource: [sourceId: string, selected: boolean];
  back: [];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-guided-entry`;

function updateText(field: keyof PlayGuidedEntryDraft, event: Event): void {
  emit('update', {
    [field]: (event.target as HTMLInputElement | HTMLTextAreaElement).value,
  });
}

function updateSimulationMode(event: Event): void {
  emit('update', {
    simulationMode: (event.target as HTMLSelectElement).value as PlayGuidedSimulationMode,
  });
}

function updateDensity(event: Event): void {
  emit('update', {
    density: (event.target as HTMLSelectElement).value as PlayGuidedEventDensity,
  });
}

function toggleSource(sourceId: string, event: Event): void {
  emit('toggleSource', sourceId, (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <form class="guided-entry" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>Step 2 / 5</span>
      <h2 :id="`${prefix}-heading`">Entry</h2>
      <p>Describe the opening boundary. Edited values are marked author-provided.</p>
    </header>

    <div class="field-grid">
      <label>
        <span>Session title</span>
        <input
          name="guided-title"
          type="text"
          :value="draft.title"
          :disabled="disabled"
          :aria-invalid="Boolean(errors.title)"
          aria-required="true"
          @input="updateText('title', $event)"
        >
        <small v-if="errors.title" class="field-error">{{ errors.title }}</small>
      </label>

      <label>
        <span>Entry label</span>
        <input
          name="guided-entry-label"
          type="text"
          :value="draft.label"
          :disabled="disabled"
          :aria-invalid="Boolean(errors.label)"
          aria-required="true"
          @input="updateText('label', $event)"
        >
        <small v-if="errors.label" class="field-error">{{ errors.label }}</small>
      </label>

      <label class="wide">
        <span>Opening situation</span>
        <textarea
          name="guided-opening"
          rows="3"
          :value="draft.opening"
          :disabled="disabled"
          :aria-invalid="Boolean(errors.opening)"
          aria-required="true"
          @input="updateText('opening', $event)"
        ></textarea>
        <small v-if="errors.opening" class="field-error">{{ errors.opening }}</small>
      </label>

      <fieldset class="wide" :aria-invalid="Boolean(errors.entrySources)">
        <legend>Entry source refs</legend>
        <label v-for="source in sources" :key="source.sourceId" class="source-ref">
          <input
            type="checkbox"
            :name="`entry-source-${source.sourceId}`"
            :checked="draft.sourceRefs.includes(source.sourceId)"
            :disabled="disabled"
            @change="toggleSource(source.sourceId, $event)"
          >
          <span>{{ source.path }}</span>
        </label>
        <small v-if="errors.entrySources" class="field-error">{{ errors.entrySources }}</small>
      </fieldset>

      <label>
        <span>Location</span>
        <input name="guided-location" type="text" :value="draft.location" :disabled="disabled" @input="updateText('location', $event)">
      </label>
      <label>
        <span>World time</span>
        <input name="guided-world-time" type="text" :value="draft.worldTime" :disabled="disabled" @input="updateText('worldTime', $event)">
      </label>
      <label>
        <span>Atmosphere</span>
        <input name="guided-atmosphere" type="text" :value="draft.atmosphere" :disabled="disabled" @input="updateText('atmosphere', $event)">
      </label>
      <label>
        <span>Trigger</span>
        <input name="guided-trigger" type="text" :value="draft.trigger" :disabled="disabled" @input="updateText('trigger', $event)">
      </label>
      <label>
        <span>Objective</span>
        <textarea name="guided-objective" rows="2" :value="draft.objective" :disabled="disabled" @input="updateText('objective', $event)"></textarea>
      </label>
      <label>
        <span>Risk</span>
        <textarea name="guided-risk" rows="2" :value="draft.risk" :disabled="disabled" @input="updateText('risk', $event)"></textarea>
      </label>
      <label>
        <span>World activity</span>
        <select name="guided-simulation-mode" :value="draft.simulationMode" :disabled="disabled" @change="updateSimulationMode">
          <option value="conversation">Conversation</option>
          <option value="reactiveWorld">Reactive world</option>
          <option value="activeWorld">Active world</option>
        </select>
      </label>
      <label>
        <span>Event density</span>
        <select name="guided-density" :value="draft.density" :disabled="disabled" @change="updateDensity">
          <option value="quiet">Quiet</option>
          <option value="balanced">Balanced</option>
          <option value="volatile">Volatile</option>
        </select>
      </label>
    </div>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">Cancel</button>
      <div>
        <button type="button" :disabled="disabled" @click="emit('back')">Back to Sources</button>
        <button class="primary" type="submit" :disabled="disabled">Continue to Identity</button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.guided-entry,
.guided-entry > header,
.field-grid {
  display: grid;
  gap: 12px;
}

.guided-entry > header {
  gap: 4px;
}

.guided-entry h2,
.guided-entry p {
  margin: 0;
}

.guided-entry h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

.guided-entry > header > span,
.guided-entry > header p,
label > span,
legend {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.field-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

label:not(.source-ref) {
  display: grid;
  gap: 5px;
}

.wide {
  grid-column: 1 / -1;
}

fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--play-line, var(--editor-hairline));
}

.source-ref {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

input,
textarea,
select,
button {
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
  font: inherit;
}

input,
textarea,
select {
  min-width: 0;
  padding: 7px 8px;
}

.field-error {
  color: var(--play-danger, var(--editor-danger));
  font-size: 11px;
}

footer,
footer > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

button {
  min-height: 34px;
  padding: 6px 11px;
}

.primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}

@media (max-width: 680px) {
  .field-grid {
    grid-template-columns: 1fr;
  }

  .wide {
    grid-column: auto;
  }
}
</style>
