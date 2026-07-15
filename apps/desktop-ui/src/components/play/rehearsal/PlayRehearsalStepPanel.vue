<script setup lang="ts">
import { computed, useId } from 'vue';

import type {
  PlayRehearsalNarrativeBlockKind,
  PlayRehearsalStepRunPhase,
  PlayRehearsalStepRunView,
  PlayRehearsalStepStatus,
  PlayRehearsalStepView,
} from './types';

const { steps, run, canStop } = defineProps<{
  steps: readonly Readonly<PlayRehearsalStepView>[];
  run?: Readonly<PlayRehearsalStepRunView>;
  canStop: boolean;
}>();

const emit = defineEmits<{
  stopStep: [];
}>();

const headingId = `${useId()}-rehearsal-narrative-heading`;
const busyPhases: ReadonlySet<PlayRehearsalStepRunPhase> = new Set([
  'starting',
  'streaming',
  'prepared',
  'stopping',
]);
const isBusy = computed(() => Boolean(run && busyPhases.has(run.phase)));

function statusLabel(status: PlayRehearsalStepStatus): string {
  switch (status) {
    case 'provisional': return 'provisional · not committed';
    case 'selected': return 'selected · attempt-local';
    case 'committed': return 'committed';
    case 'superseded': return 'superseded variant';
  }
}

function blockKindLabel(kind: PlayRehearsalNarrativeBlockKind): string {
  switch (kind) {
    case 'narrator': return 'Narrator';
    case 'characterSpeech': return 'Speech';
    case 'characterAction': return 'Action';
    case 'worldNotice': return 'World';
  }
}
</script>

<template>
  <section
    class="play-rehearsal-step-panel"
    :aria-labelledby="headingId"
    :aria-busy="isBusy"
  >
    <header>
      <div>
        <span>Narrative / attempt</span>
        <h2 :id="headingId">Actor Steps</h2>
      </div>
      <span>{{ run?.statusMessage || 'Ready' }}</span>
    </header>

    <div class="play-rehearsal-step-scroll">
      <article
        v-for="step in steps"
        :key="step.id"
        class="play-rehearsal-step"
        :data-status="step.status"
        :aria-label="`${step.participantName}, ${statusLabel(step.status)}`"
      >
        <header>
          <div>
            <strong>{{ step.participantName }}</strong>
            <span v-if="step.intentSummary">{{ step.intentSummary }}</span>
          </div>
          <span>[{{ statusLabel(step.status) }}]</span>
        </header>

        <div v-if="step.blocks.length" class="play-rehearsal-blocks">
          <section v-for="block in step.blocks" :key="block.id">
            <header>
              <span>{{ block.speakerName || blockKindLabel(block.kind) }}</span>
              <small>{{ blockKindLabel(block.kind) }}<template v-if="block.projection === 'directorOnly'"> · Director only</template></small>
            </header>
            <p>{{ block.content }}</p>
          </section>
        </div>
        <p v-else class="play-rehearsal-step-empty">No narrative block prepared yet.</p>

        <small v-if="step.variantOf" class="play-rehearsal-variant-ref">
          Variant of {{ step.variantOf }}
        </small>
      </article>

      <div v-if="steps.length === 0" class="play-rehearsal-step-placeholder">
        <span aria-hidden="true">[ ]</span>
        <strong>No actor step yet</strong>
        <p>Generate the current actor's reaction, then Accept or Retry it inside this attempt.</p>
      </div>
    </div>

    <footer v-if="run">
      <div>
        <strong>{{ run.statusMessage }}</strong>
        <span v-if="run.error" role="alert">{{ run.error }}</span>
      </div>
      <button
        v-if="isBusy"
        type="button"
        :disabled="!canStop"
        aria-label="Stop current actor step generation; keep the rehearsal attempt"
        @click="emit('stopStep')"
      >
        {{ run.phase === 'stopping' ? 'Stopping step…' : 'Stop step' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.play-rehearsal-step-panel {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-step-panel > header,
.play-rehearsal-step-panel > header > div,
.play-rehearsal-step > header,
.play-rehearsal-step > header > div,
.play-rehearsal-blocks section header,
.play-rehearsal-step-panel > footer {
  display: flex;
  align-items: center;
}

.play-rehearsal-step-panel > header {
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-step-panel > header > div,
.play-rehearsal-step > header > div {
  align-items: flex-start;
  flex-direction: column;
  gap: 1px;
}

.play-rehearsal-step-panel > header span,
.play-rehearsal-step > header span,
.play-rehearsal-blocks small,
.play-rehearsal-variant-ref {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-step-panel h2 {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.play-rehearsal-step-scroll {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding: 14px;
}

.play-rehearsal-step {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-rehearsal-step[data-status="provisional"] {
  border-style: dashed;
}

.play-rehearsal-step[data-status="selected"] {
  border-style: double;
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-step[data-status="committed"] {
  border-left-color: var(--play-success, var(--editor-success));
}

.play-rehearsal-step[data-status="superseded"] {
  border-left-style: dotted;
  opacity: .7;
}

.play-rehearsal-step > header {
  justify-content: space-between;
  gap: 8px;
}

.play-rehearsal-step strong,
.play-rehearsal-blocks section header span {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-blocks {
  display: grid;
  gap: 8px;
}

.play-rehearsal-blocks section {
  padding: 9px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-blocks section header {
  justify-content: space-between;
  gap: 8px;
}

.play-rehearsal-blocks p,
.play-rehearsal-step-empty,
.play-rehearsal-step-placeholder p {
  margin: 6px 0 0;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.65;
}

.play-rehearsal-step-empty,
.play-rehearsal-step-placeholder p {
  color: var(--play-muted, var(--editor-muted));
}

.play-rehearsal-step-placeholder {
  display: grid;
  min-height: 180px;
  align-content: center;
  justify-items: center;
  gap: 5px;
  color: var(--play-muted, var(--editor-muted));
  text-align: center;
}

.play-rehearsal-step-placeholder strong {
  color: var(--play-ink, var(--editor-ink));
}

.play-rehearsal-step-panel > footer {
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-step-panel > footer div {
  display: grid;
  gap: 2px;
  font-size: 10px;
}

.play-rehearsal-step-panel > footer span[role="alert"] {
  color: var(--play-danger, var(--editor-danger));
}

.play-rehearsal-step-panel > footer button {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}
</style>
