<script setup lang="ts">
import { useId } from 'vue';

import type {
  PlayRehearsalEventDensity,
  PlayRehearsalSceneDraft,
  PlayRehearsalSceneErrors,
  PlayRehearsalSimulationMode,
} from './types';

const { draft, errors, disabled } = defineProps<{
  draft: Readonly<PlayRehearsalSceneDraft>;
  errors: Readonly<PlayRehearsalSceneErrors>;
  disabled: boolean;
}>();

const emit = defineEmits<{
  updateDraft: [draft: PlayRehearsalSceneDraft];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-rehearsal-scene`;

function updateText(
  field: 'title' | 'opening' | 'location' | 'atmosphere' | 'objective' | 'risk',
  event: Event,
): void {
  emit('updateDraft', {
    ...draft,
    [field]: (event.target as HTMLInputElement | HTMLTextAreaElement).value,
  });
}

function updateSimulationMode(event: Event): void {
  emit('updateDraft', {
    ...draft,
    simulationMode: (event.target as HTMLSelectElement).value as PlayRehearsalSimulationMode,
  });
}

function updateDensity(event: Event): void {
  emit('updateDraft', {
    ...draft,
    density: (event.target as HTMLSelectElement).value as PlayRehearsalEventDensity,
  });
}
</script>

<template>
  <form class="play-rehearsal-step-form" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>Step 1 / 3</span>
      <h2 :id="`${prefix}-heading`">Scene</h2>
      <p>Set the boundary for this rehearsal. These values remain Play-local.</p>
    </header>

    <div class="play-rehearsal-field-grid">
      <label>
        <span>Scene title</span>
        <input
          :id="`${prefix}-title`"
          name="scene-title"
          type="text"
          :value="draft.title"
          :disabled="disabled"
          :aria-invalid="Boolean(errors.title)"
          :aria-describedby="errors.title ? `${prefix}-title-error` : undefined"
          aria-required="true"
          @input="updateText('title', $event)"
        >
        <small v-if="errors.title" :id="`${prefix}-title-error`" class="play-rehearsal-field-error">{{ errors.title }}</small>
      </label>

      <label>
        <span>Location</span>
        <input
          :id="`${prefix}-location`"
          name="scene-location"
          type="text"
          :value="draft.location"
          :disabled="disabled"
          :aria-invalid="Boolean(errors.location)"
          :aria-describedby="errors.location ? `${prefix}-location-error` : undefined"
          aria-required="true"
          @input="updateText('location', $event)"
        >
        <small v-if="errors.location" :id="`${prefix}-location-error`" class="play-rehearsal-field-error">{{ errors.location }}</small>
      </label>

      <label class="play-rehearsal-field-wide">
        <span>Opening situation</span>
        <textarea
          :id="`${prefix}-opening`"
          name="scene-opening"
          rows="3"
          :value="draft.opening"
          :disabled="disabled"
          :aria-invalid="Boolean(errors.opening)"
          :aria-describedby="errors.opening ? `${prefix}-opening-error` : undefined"
          aria-required="true"
          @input="updateText('opening', $event)"
        ></textarea>
        <small v-if="errors.opening" :id="`${prefix}-opening-error`" class="play-rehearsal-field-error">{{ errors.opening }}</small>
      </label>

      <label>
        <span>Rehearsal objective</span>
        <textarea
          :id="`${prefix}-objective`"
          name="scene-objective"
          rows="2"
          :value="draft.objective"
          :disabled="disabled"
          :aria-invalid="Boolean(errors.objective)"
          :aria-describedby="errors.objective ? `${prefix}-objective-error` : undefined"
          aria-required="true"
          @input="updateText('objective', $event)"
        ></textarea>
        <small v-if="errors.objective" :id="`${prefix}-objective-error`" class="play-rehearsal-field-error">{{ errors.objective }}</small>
      </label>

      <label>
        <span>Risk</span>
        <textarea
          :id="`${prefix}-risk`"
          name="scene-risk"
          rows="2"
          :value="draft.risk"
          :disabled="disabled"
          @input="updateText('risk', $event)"
        ></textarea>
      </label>

      <label>
        <span>Atmosphere</span>
        <input
          :id="`${prefix}-atmosphere`"
          name="scene-atmosphere"
          type="text"
          :value="draft.atmosphere"
          :disabled="disabled"
          @input="updateText('atmosphere', $event)"
        >
      </label>

      <label>
        <span>World activity</span>
        <select
          :id="`${prefix}-simulation-mode`"
          name="scene-simulation-mode"
          :value="draft.simulationMode"
          :disabled="disabled"
          @change="updateSimulationMode"
        >
          <option value="conversation">Conversation</option>
          <option value="reactiveWorld">Reactive world</option>
          <option value="activeWorld">Active world</option>
        </select>
      </label>

      <label>
        <span>Event density</span>
        <select
          :id="`${prefix}-density`"
          name="scene-density"
          :value="draft.density"
          :disabled="disabled"
          @change="updateDensity"
        >
          <option value="quiet">Quiet</option>
          <option value="balanced">Balanced</option>
          <option value="volatile">Volatile</option>
        </select>
      </label>
    </div>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">Cancel</button>
      <button class="play-rehearsal-primary" type="submit" :disabled="disabled">Continue to Cast</button>
    </footer>
  </form>
</template>

<style scoped>
.play-rehearsal-step-form {
  display: grid;
  gap: 16px;
}

.play-rehearsal-step-form header {
  display: grid;
  gap: 4px;
}

.play-rehearsal-step-form header > span,
.play-rehearsal-step-form header p,
.play-rehearsal-step-form label > span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-rehearsal-step-form h2,
.play-rehearsal-step-form p {
  margin: 0;
}

.play-rehearsal-step-form h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 16px;
}

.play-rehearsal-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.play-rehearsal-field-grid label {
  display: grid;
  align-content: start;
  gap: 5px;
}

.play-rehearsal-field-wide {
  grid-column: 1 / -1;
}

.play-rehearsal-step-form :where(input, textarea, select) {
  width: 100%;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-radius: 4px;
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-ink, var(--editor-ink));
  font: inherit;
}

.play-rehearsal-step-form textarea {
  resize: vertical;
}

.play-rehearsal-step-form [aria-invalid="true"] {
  border-color: var(--play-danger, var(--editor-danger));
}

.play-rehearsal-field-error {
  color: var(--play-danger, var(--editor-danger));
  font-size: 10px;
}

.play-rehearsal-step-form footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-step-form footer button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}

.play-rehearsal-step-form footer .play-rehearsal-primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

@media (max-width: 640px) {
  .play-rehearsal-field-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .play-rehearsal-field-wide {
    grid-column: auto;
  }
}
</style>
