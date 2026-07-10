<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';

import type {
  PlayAdoptionTarget,
  PlayObservation,
} from '../../composables/useWorkspaceApi';
import type { PlayAdoptionDraftInput } from '../../composables/usePlayWorkspace';

const props = defineProps<{
  observations: PlayObservation[];
  creating: boolean;
}>();

const emit = defineEmits<{
  createCandidate: [input: PlayAdoptionDraftInput];
}>();

const observationId = shallowRef('');
const target = shallowRef<PlayAdoptionTarget>('chapterDraft');
const destination = shallowRef('');
const statePath = shallowRef('');
const content = shallowRef('');

const selectedObservation = computed(() =>
  props.observations.find((observation) => observation.id === observationId.value),
);
const destinationLabel = computed(() => {
  if (target.value === 'chapterDraft') return '章节 ID';
  if (target.value === 'state') return '状态文件';
  return '目标文件（可选）';
});
const destinationPlaceholder = computed(() => {
  if (target.value === 'chapterDraft') return '0001/0002';
  if (target.value === 'state') return 'characters.yaml';
  return target.value === 'timeline' ? 'events.yaml' : 'active.yaml';
});
const destinationRequired = computed(() =>
  target.value === 'chapterDraft' || target.value === 'state',
);
const canSubmit = computed(() => Boolean(
  selectedObservation.value &&
  content.value.trim() &&
  (!destinationRequired.value || destination.value.trim()) &&
  (target.value !== 'state' || statePath.value.trim()),
));

watch(
  () => props.observations.map((observation) => observation.id),
  (ids) => {
    if (!ids.includes(observationId.value)) {
      observationId.value = ids[0] ?? '';
    }
  },
  { immediate: true },
);

watch(selectedObservation, (observation) => {
  content.value = observation?.evidence ?? '';
}, { immediate: true });

function submit() {
  const observation = selectedObservation.value;
  if (!observation || !canSubmit.value) {
    return;
  }

  emit('createCandidate', {
    target: target.value,
    summary: observation.summary,
    evidence: observation.evidence,
    payload: createPayload(observation),
    sourceObservationIds: [observation.id],
  });
}

function createPayload(observation: PlayObservation): Record<string, unknown> {
  const details = content.value.trim();
  const file = destination.value.trim();

  if (target.value === 'chapterDraft') {
    return { chapterId: file, content: details };
  }
  if (target.value === 'state') {
    return { file, path: statePath.value.trim(), value: details };
  }
  if (target.value === 'timeline') {
    return {
      event: { summary: observation.summary, evidence: observation.evidence, details },
      ...(file ? { file } : {}),
    };
  }

  return {
    item: { summary: observation.summary, evidence: observation.evidence, details },
    ...(file ? { file } : {}),
  };
}
</script>

<template>
  <form class="play-adoption-draft" @submit.prevent="submit">
    <label>
      <span>Observation</span>
      <select v-model="observationId" :disabled="creating">
        <option v-for="observation in observations" :key="observation.id" :value="observation.id">
          {{ observation.summary }}
        </option>
      </select>
    </label>
    <label>
      <span>采纳目标</span>
      <select v-model="target" :disabled="creating">
        <option value="chapterDraft">Chapter draft</option>
        <option value="state">State</option>
        <option value="timeline">Timeline</option>
        <option value="foreshadow">Foreshadow</option>
      </select>
    </label>
    <label>
      <span>{{ destinationLabel }}</span>
      <input
        v-model="destination"
        type="text"
        :required="destinationRequired"
        :placeholder="destinationPlaceholder"
        :disabled="creating"
      >
    </label>
    <label v-if="target === 'state'">
      <span>YAML path</span>
      <input v-model="statePath" type="text" required placeholder="characters.heroine.mood" :disabled="creating">
    </label>
    <label class="play-adoption-draft-wide">
      <span>候选内容</span>
      <textarea v-model="content" rows="3" :disabled="creating"></textarea>
    </label>
    <button class="ghost-button tight-button" type="submit" :disabled="creating || !canSubmit">
      {{ creating ? 'Preparing…' : 'Prepare adoption candidate' }}
    </button>
  </form>
</template>

<style scoped>
.play-adoption-draft {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 9px;
  border: 1px solid rgb(235 226 212);
  border-radius: 8px;
  background: rgb(255 253 249);
}

.play-adoption-draft label {
  display: grid;
  gap: 4px;
}

.play-adoption-draft label > span {
  color: rgb(120 91 67);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
}

.play-adoption-draft input,
.play-adoption-draft select,
.play-adoption-draft textarea {
  min-width: 0;
  border: 1px solid rgb(224 208 185);
  border-radius: 6px;
  background: rgb(255 252 247);
  color: rgb(82 60 43);
  font: inherit;
  font-size: 10px;
  padding: 6px 7px;
}

.play-adoption-draft-wide,
.play-adoption-draft > button {
  grid-column: 1 / -1;
}

:global([data-theme="dark"]) .play-adoption-draft,
:global([data-theme="dark"]) .play-adoption-draft input,
:global([data-theme="dark"]) .play-adoption-draft select,
:global([data-theme="dark"]) .play-adoption-draft textarea {
  border-color: rgb(83 70 58);
  background: rgb(38 32 28);
  color: rgb(245 235 220);
}
</style>
