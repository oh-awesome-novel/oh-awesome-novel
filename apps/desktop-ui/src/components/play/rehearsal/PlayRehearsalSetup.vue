<script setup lang="ts">
import { nextTick, useId, useTemplateRef } from 'vue';

import PlayRehearsalCastStep from './PlayRehearsalCastStep.vue';
import PlayRehearsalReviewStep from './PlayRehearsalReviewStep.vue';
import PlayRehearsalSceneStep from './PlayRehearsalSceneStep.vue';
import { usePlayRehearsalSetup } from '../../../composables/usePlayRehearsalSetup';
import type {
  PlayRehearsalSetupStep,
  PlayRehearsalSetupSubmission,
} from './types';

const { creating = false, disabled = false } = defineProps<{
  creating?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  create: [input: PlayRehearsalSetupSubmission];
  cancel: [];
}>();

const {
  currentStep,
  sceneDraft,
  participants,
  sceneErrors,
  castErrors,
  announcement,
  updateScene,
  updateParticipant,
  addParticipant,
  removeParticipant,
  moveParticipant,
  nextStep,
  previousStep,
  buildSubmission,
  reset,
} = usePlayRehearsalSetup();

const headingId = `${useId()}-rehearsal-setup-heading`;
const stepPanel = useTemplateRef<HTMLDivElement>('stepPanel');
const steps: Array<{ id: PlayRehearsalSetupStep; label: string }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'cast', label: 'Cast' },
  { id: 'review', label: 'Review' },
];

async function advance(): Promise<void> {
  if (nextStep()) {
    await focusStepPanel();
  }
}

async function back(): Promise<void> {
  if (previousStep()) {
    await focusStepPanel();
  }
}

function confirm(): void {
  const input = buildSubmission();
  if (input) {
    emit('create', input);
  }
}

function cancel(): void {
  reset();
  emit('cancel');
}

async function focusStepPanel(): Promise<void> {
  await nextTick();
  stepPanel.value?.focus();
}
</script>

<template>
  <section class="play-rehearsal-setup" :aria-labelledby="headingId">
    <header class="play-rehearsal-setup-heading">
      <div>
        <span>Scene Rehearsal</span>
        <h1 :id="headingId">Prepare a playable scene</h1>
      </div>
      <span>Play-local · not canonical</span>
    </header>

    <nav aria-label="Rehearsal setup progress">
      <ol>
        <li
          v-for="(step, index) in steps"
          :key="step.id"
          :class="{ 'play-rehearsal-setup-step-current': currentStep === step.id }"
          :aria-current="currentStep === step.id ? 'step' : undefined"
        >
          <span>{{ index + 1 }}</span>
          {{ step.label }}
        </li>
      </ol>
    </nav>

    <div ref="stepPanel" class="play-rehearsal-setup-panel" tabindex="-1">
      <PlayRehearsalSceneStep
        v-if="currentStep === 'scene'"
        :draft="sceneDraft"
        :errors="sceneErrors"
        :disabled="disabled || creating"
        @update-draft="updateScene"
        @next="advance"
        @cancel="cancel"
      />
      <PlayRehearsalCastStep
        v-else-if="currentStep === 'cast'"
        :participants="participants"
        :errors="castErrors"
        :disabled="disabled || creating"
        @update-participant="updateParticipant"
        @add-participant="addParticipant"
        @remove-participant="removeParticipant"
        @move-participant="moveParticipant"
        @back="back"
        @next="advance"
        @cancel="cancel"
      />
      <PlayRehearsalReviewStep
        v-else
        :scene="sceneDraft"
        :participants="participants"
        :creating="creating"
        :disabled="disabled"
        @back="back"
        @confirm="confirm"
        @cancel="cancel"
      />
    </div>

    <p class="play-rehearsal-setup-announcement" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </p>
  </section>
</template>

<style scoped>
.play-rehearsal-setup {
  display: grid;
  min-width: 0;
  gap: 0;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-setup-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-setup-heading div {
  display: grid;
  gap: 2px;
}

.play-rehearsal-setup-heading span,
.play-rehearsal-setup-heading > span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-rehearsal-setup-heading h1 {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 16px;
}

.play-rehearsal-setup nav {
  padding: 0 16px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-setup nav ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-rehearsal-setup nav li {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 6px;
  border-bottom: 2px solid transparent;
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-rehearsal-setup nav li > span {
  font-variant-numeric: tabular-nums;
}

.play-rehearsal-setup nav .play-rehearsal-setup-step-current {
  border-bottom-color: var(--play-ink, var(--editor-ink));
  color: var(--play-ink, var(--editor-ink));
  font-weight: 700;
}

.play-rehearsal-setup-panel {
  padding: 18px;
  outline: none;
}

.play-rehearsal-setup-panel:focus-visible {
  outline: 1px solid var(--play-focus, var(--editor-focus));
  outline-offset: -2px;
}

.play-rehearsal-setup-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .play-rehearsal-setup-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .play-rehearsal-setup-panel {
    padding: 12px;
  }
}
</style>
