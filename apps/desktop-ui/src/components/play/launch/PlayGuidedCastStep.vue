<script setup lang="ts">
import { useId } from 'vue';

import type { PlaySessionPurpose } from '../../../composables/useWorkspaceApi';
import type {
  PlayGuidedParticipantDraft,
  PlayGuidedParticipantPatch,
  PlayGuidedSourceOption,
  PlayGuidedStartErrors,
  PlayKnowledgeVisibility,
} from '../../../composables/usePlayGuidedStart';

const { purpose, participants, characterSources, errors, disabled } = defineProps<{
  purpose: PlaySessionPurpose;
  participants: readonly Readonly<PlayGuidedParticipantDraft>[];
  characterSources: readonly Readonly<PlayGuidedSourceOption>[];
  errors: Readonly<PlayGuidedStartErrors>;
  disabled: boolean;
}>();

const emit = defineEmits<{
  updateParticipant: [participantRef: string, patch: PlayGuidedParticipantPatch];
  addParticipant: [];
  removeParticipant: [participantRef: string];
  back: [];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-guided-cast`;

function updateText(
  participantRef: string,
  field: keyof PlayGuidedParticipantPatch,
  event: Event,
): void {
  emit('updateParticipant', participantRef, {
    [field]: (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value,
  });
}

function updateVisibility(participantRef: string, event: Event): void {
  emit('updateParticipant', participantRef, {
    knowledgeVisibility: (event.target as HTMLSelectElement).value as PlayKnowledgeVisibility,
  });
}
</script>

<template>
  <form class="guided-cast" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>Step 4 / 5</span>
      <h2 :id="`${prefix}-heading`">Cast</h2>
      <p>Confirm participant goals, positions, and initial knowledge boundaries.</p>
    </header>

    <p v-if="errors.cast" class="field-error" role="alert">{{ errors.cast }}</p>

    <ol v-if="participants.length" aria-label="Guided Start cast order">
      <li v-for="(participant, index) in participants" :key="participant.participantRef">
        <header class="participant-heading">
          <strong>Participant {{ index + 1 }}</strong>
          <button
            type="button"
            :disabled="disabled"
            :aria-label="`Remove participant ${index + 1}`"
            @click="emit('removeParticipant', participant.participantRef)"
          >Remove</button>
        </header>

        <div class="participant-fields">
          <label>
            <span>Name</span>
            <input
              :name="`guided-participant-${index + 1}-name`"
              type="text"
              :value="participant.displayName"
              :disabled="disabled"
              :aria-invalid="Boolean(errors.participants?.[participant.participantRef]?.displayName)"
              aria-required="true"
              @input="updateText(participant.participantRef, 'displayName', $event)"
            >
            <small v-if="errors.participants?.[participant.participantRef]?.displayName" class="field-error">
              {{ errors.participants[participant.participantRef]?.displayName }}
            </small>
          </label>

          <label>
            <span>Canonical character source</span>
            <select
              :name="`guided-participant-${index + 1}-source`"
              :value="participant.characterSourceId"
              :disabled="disabled"
              @change="updateText(participant.participantRef, 'characterSourceId', $event)"
            >
              <option value="">Author-provided guest</option>
              <option v-for="source in characterSources" :key="source.sourceId" :value="source.sourceId">
                {{ source.objectId ?? source.path }}
              </option>
            </select>
          </label>

          <label>
            <span>Position</span>
            <input
              :name="`guided-participant-${index + 1}-position`"
              type="text"
              :value="participant.position"
              :disabled="disabled"
              @input="updateText(participant.participantRef, 'position', $event)"
            >
          </label>

          <label>
            <span>Current goal</span>
            <input
              :name="`guided-participant-${index + 1}-goal`"
              type="text"
              :value="participant.currentGoal"
              :disabled="disabled"
              :aria-invalid="Boolean(errors.participants?.[participant.participantRef]?.currentGoal)"
              aria-required="true"
              @input="updateText(participant.participantRef, 'currentGoal', $event)"
            >
            <small v-if="errors.participants?.[participant.participantRef]?.currentGoal" class="field-error">
              {{ errors.participants[participant.participantRef]?.currentGoal }}
            </small>
          </label>

          <label class="wide">
            <span>Initial knowledge</span>
            <textarea
              :name="`guided-participant-${index + 1}-knowledge`"
              rows="2"
              :value="participant.initialKnowledge"
              :disabled="disabled"
              placeholder="A Play-local fact this participant may use"
              @input="updateText(participant.participantRef, 'initialKnowledge', $event)"
            ></textarea>
          </label>

          <label>
            <span>Knowledge visibility</span>
            <select
              :name="`guided-participant-${index + 1}-visibility`"
              :value="participant.knowledgeVisibility"
              :disabled="disabled"
              @change="updateVisibility(participant.participantRef, $event)"
            >
              <option value="playerVisible">Player visible</option>
              <option value="rumor">Rumor</option>
              <option value="playerUnknown">Player unknown</option>
            </select>
          </label>
        </div>
      </li>
    </ol>

    <p v-else class="empty-cast">
      {{ purpose === 'sceneRehearsal' ? 'Add at least one participant to rehearse the scene.' : 'No cast is required for an immersive entry.' }}
    </p>

    <button class="add-participant" type="button" :disabled="disabled" @click="emit('addParticipant')">
      <span aria-hidden="true">[+]</span> Add participant
    </button>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">Cancel</button>
      <div>
        <button type="button" :disabled="disabled" @click="emit('back')">Back to Identity</button>
        <button class="primary" type="submit" :disabled="disabled">Preview Launch Package</button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.guided-cast,
.guided-cast > header,
.guided-cast ol {
  display: grid;
  gap: 12px;
}

.guided-cast > header {
  gap: 4px;
}

h2,
p {
  margin: 0;
}

h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

.guided-cast > header > span,
.guided-cast > header p,
label > span,
.empty-cast {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

ol > li {
  display: grid;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
}

.participant-heading,
footer,
footer > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.participant-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

label {
  display: grid;
  gap: 5px;
}

.wide {
  grid-column: 1 / -1;
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

button {
  min-height: 32px;
  padding: 5px 9px;
}

.add-participant {
  justify-self: start;
}

.primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

.field-error {
  color: var(--play-danger, var(--editor-danger));
  font-size: 11px;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}

@media (max-width: 680px) {
  .participant-fields {
    grid-template-columns: 1fr;
  }

  .wide {
    grid-column: auto;
  }
}
</style>
