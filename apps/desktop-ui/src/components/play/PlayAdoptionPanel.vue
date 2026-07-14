<script setup lang="ts">
import PlayAdoptionDraftForm from './PlayAdoptionDraftForm.vue';
import type {
  PlayAdoptionCandidate,
  PlayObservation,
} from '../../composables/useWorkspaceApi';
import type { PlayAdoptionDraftInput } from '../../composables/usePlayWorkspace';

defineProps<{
  observations: PlayObservation[];
  candidates: PlayAdoptionCandidate[];
  busyCandidateId: string;
  creatingCandidate: boolean;
  disabled: boolean;
  notice: string;
}>();

const emit = defineEmits<{
  createCandidate: [input: PlayAdoptionDraftInput];
  createPendingAction: [candidate: PlayAdoptionCandidate];
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
        <strong>{{ observation.summary }}</strong>
        <p>{{ observation.evidence }}</p>
      </article>
    </div>
    <p v-else class="play-muted-copy">值得写回小说的发现会先成为 observation。</p>

    <PlayAdoptionDraftForm
      v-if="observations.length"
      :observations="observations"
      :creating="creatingCandidate"
      :disabled="disabled"
      @create-candidate="emit('createCandidate', $event)"
    />

    <header class="play-adoption-heading">
      <span class="play-section-marker" aria-hidden="true">[+]</span>
      <h2>Adoption</h2>
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
        <button
          class="ghost-button tight-button"
          type="button"
          :disabled="disabled || Boolean(busyCandidateId)"
          @click="emit('createPendingAction', candidate)"
        >
          {{ busyCandidateId === candidate.id ? 'Creating…' : 'Create PendingAction' }}
        </button>
      </article>
    </div>
    <p v-else class="play-muted-copy">
      没有 adoption candidate。Play 内容不会自动进入 canonical 文件。
    </p>
  </section>
</template>
