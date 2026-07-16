<script setup lang="ts">
import { useId } from 'vue';

import type { PlaySessionPurpose } from '../../../composables/useWorkspaceApi';
import type {
  PlayGuidedIdentityDraft,
  PlayGuidedStartErrors,
} from '../../../composables/usePlayGuidedStart';

const { purpose, draft, errors, disabled } = defineProps<{
  purpose: PlaySessionPurpose;
  draft: Readonly<PlayGuidedIdentityDraft>;
  errors: Readonly<PlayGuidedStartErrors>;
  disabled: boolean;
}>();

const emit = defineEmits<{
  update: [patch: Partial<PlayGuidedIdentityDraft>];
  back: [];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-guided-identity`;

function update(field: keyof PlayGuidedIdentityDraft, event: Event): void {
  emit('update', {
    [field]: (event.target as HTMLInputElement | HTMLTextAreaElement).value,
  });
}
</script>

<template>
  <form class="guided-identity" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>Step 3 / 5</span>
      <h2 :id="`${prefix}-heading`">Identity</h2>
      <p v-if="purpose === 'immersiveJourney'">Set the player lens used to enter this world.</p>
      <p v-else>State what the Director wants this rehearsal to test.</p>
    </header>

    <label v-if="purpose === 'immersiveJourney'">
      <span>Player persona</span>
      <textarea
        name="guided-player-persona"
        rows="4"
        :value="draft.persona"
        :disabled="disabled"
        :aria-invalid="Boolean(errors.persona)"
        aria-required="true"
        placeholder="Who am I here, and what can I reasonably know?"
        @input="update('persona', $event)"
      ></textarea>
      <small v-if="errors.persona" class="field-error">{{ errors.persona }}</small>
    </label>

    <label v-else>
      <span>Director rehearsal purpose</span>
      <textarea
        name="guided-director-purpose"
        rows="4"
        :value="draft.directorPurpose"
        :disabled="disabled"
        :aria-invalid="Boolean(errors.directorPurpose)"
        aria-required="true"
        placeholder="What character behavior or scene tension should this run test?"
        @input="update('directorPurpose', $event)"
      ></textarea>
      <small v-if="errors.directorPurpose" class="field-error">{{ errors.directorPurpose }}</small>
    </label>

    <aside>
      <strong>{{ purpose === 'immersiveJourney' ? 'Player Lens' : 'Director Lens' }}</strong>
      <span>Identity changes the viewing boundary; it does not create a second world truth.</span>
    </aside>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">Cancel</button>
      <div>
        <button type="button" :disabled="disabled" @click="emit('back')">Back to Entry</button>
        <button class="primary" type="submit" :disabled="disabled">Continue to Cast</button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.guided-identity,
.guided-identity > header,
.guided-identity label {
  display: grid;
  gap: 12px;
}

.guided-identity > header,
.guided-identity label {
  gap: 5px;
}

h2,
p {
  margin: 0;
}

h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

header > span,
header p,
label > span,
aside span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

textarea,
button {
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
  font: inherit;
}

textarea {
  padding: 8px;
}

aside {
  display: grid;
  gap: 3px;
  padding: 10px;
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
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
textarea:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}
</style>
