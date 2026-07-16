<script setup lang="ts">
import type { PlayAdoptionSeed } from '../../composables/usePlayAdoptionPreview';
import type {
  PlayAdoptionCandidate,
  PlayObservation,
} from '../../composables/useWorkspaceApi';

defineProps<{
  observations: readonly PlayObservation[];
  candidates: readonly PlayAdoptionCandidate[];
  disabled: boolean;
  notice: string;
}>();

const emit = defineEmits<{
  prepareAdoption: [seed: PlayAdoptionSeed];
}>();
</script>

<template>
  <section class="play-adoption-panel" aria-label="Play observations and adoption">
    <header>
      <span class="play-section-marker" aria-hidden="true">[+]</span>
      <h2>Observations</h2>
      <span>{{ observations.length }}</span>
    </header>

    <div v-if="observations.length" class="play-observation-list">
      <article v-for="observation in observations" :key="observation.id">
        <div class="play-observation-copy">
          <strong>{{ observation.summary }}</strong>
          <p>{{ observation.evidence }}</p>
        </div>
        <button
          class="ghost-button tight-button"
          type="button"
          :disabled="disabled"
          :aria-label="`Bring observation to writing: ${observation.summary}`"
          @click="emit('prepareAdoption', {
            kind: 'observation',
            observationId: observation.id,
          })"
        >Bring to writing</button>
      </article>
    </div>
    <p v-else class="play-muted-copy">值得写回小说的发现会先成为 observation。</p>

    <header class="play-adoption-heading">
      <span class="play-section-marker" aria-hidden="true">[+]</span>
      <h2>Adoption history</h2>
      <span>{{ candidates.length }}</span>
    </header>

    <p v-if="notice" class="play-adoption-notice" role="status" aria-live="polite">
      {{ notice }}
    </p>
    <div v-if="candidates.length" class="play-candidate-list">
      <article v-for="candidate in candidates" :key="candidate.id">
        <div>
          <span>{{ candidate.target }}</span>
          <strong>{{ candidate.summary }}</strong>
          <p>{{ candidate.evidence }}</p>
        </div>
        <span class="play-candidate-boundary">noncanonical candidate</span>
      </article>
    </div>
    <p v-else class="play-muted-copy">
      没有 adoption candidate。Play 内容不会自动进入 canonical 文件。
    </p>
  </section>
</template>

<style scoped>
.play-observation-list article {
  display: grid;
  gap: 7px;
}

.play-observation-copy {
  display: grid;
  gap: 4px;
}

.play-observation-list button {
  justify-self: start;
}

.play-candidate-boundary {
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
}
</style>
