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
          :disabled="Boolean(busyCandidateId)"
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

<style scoped>
.play-adoption-panel {
  display: grid;
  gap: 9px;
  padding-top: 14px;
  border-top: 1px solid rgb(235 226 212);
}

.play-adoption-panel header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(120 75 36);
}

.play-adoption-panel h2 {
  margin: 0;
  color: rgb(68 54 43);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 16px;
}

.play-adoption-panel header > span {
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgb(246 235 218);
  font-size: 9px;
  font-weight: 900;
}

.play-adoption-heading {
  margin-top: 5px;
  padding-top: 13px;
  border-top: 1px dashed rgb(224 208 185);
}

.play-observation-list,
.play-candidate-list {
  display: grid;
  gap: 7px;
}

.play-observation-list article,
.play-candidate-list article {
  display: grid;
  gap: 4px;
  padding: 9px;
  border: 1px solid rgb(235 226 212);
  border-radius: 8px;
  background: rgb(255 253 249);
}

.play-candidate-list article {
  gap: 8px;
}

.play-observation-list strong,
.play-candidate-list strong {
  display: block;
  color: rgb(82 60 43);
  font-size: 10px;
}

.play-candidate-list article div > span {
  color: rgb(180 83 9);
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
}

.play-observation-list p,
.play-candidate-list p,
.play-muted-copy {
  margin: 2px 0 0;
  color: rgb(139 112 88);
  font-size: 10px;
  line-height: 1.45;
}

.play-adoption-notice {
  margin: 0;
  padding: 8px;
  border-radius: 7px;
  background: rgb(236 253 245);
  color: rgb(6 95 70);
  font-size: 10px;
  line-height: 1.45;
}

:global([data-theme="dark"]) .play-adoption-panel,
:global([data-theme="dark"]) .play-adoption-heading {
  border-color: rgb(68 58 49);
}

:global([data-theme="dark"]) .play-adoption-panel h2,
:global([data-theme="dark"]) .play-observation-list strong,
:global([data-theme="dark"]) .play-candidate-list strong {
  color: rgb(245 235 220);
}

:global([data-theme="dark"]) .play-observation-list article,
:global([data-theme="dark"]) .play-candidate-list article {
  border-color: rgb(83 70 58);
  background: rgb(38 32 28);
}

:global([data-theme="dark"]) .play-adoption-notice {
  background: rgb(6 78 59 / 32%);
  color: rgb(167 243 208);
}
</style>
