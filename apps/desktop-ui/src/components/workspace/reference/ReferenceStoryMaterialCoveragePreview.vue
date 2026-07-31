<script setup lang="ts">
import { computed } from 'vue';

import type {
  ReferencePreviewEvidence,
  ReferenceStoryMaterialCoveragePreview,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  preview: ReferenceStoryMaterialCoveragePreview;
  evidence: readonly ReferencePreviewEvidence[];
}>();

const evidenceById = computed(() => new Map(
  props.evidence.map((item) => [item.id, item.pointer]),
));
const substantialCount = computed(() =>
  props.preview.items.filter((item) => item.coverage === 'substantial').length,
);

function evidenceLabel(evidenceId: string): string {
  const pointer = evidenceById.value.get(evidenceId);
  if (!pointer) return evidenceId;
  return `${pointer.chapterId} · lines ${pointer.lineStart}-${pointer.lineEnd}`;
}
</script>

<template>
  <section
    class="reference-material-preview"
    aria-label="Story Material coverage preview"
  >
    <div class="reference-section-heading">
      <div>
        <h4>Story Material Coverage Preview</h4>
        <p>
          Specific source-story facts are tracked separately from transferable
          writing techniques.
        </p>
      </div>
      <span class="status-pill">
        {{ substantialCount }}/{{ preview.items.length }} substantial
      </span>
    </div>

    <ul class="reference-material-list">
      <li
        v-for="item in preview.items"
        :key="item.id"
        class="reference-material-card"
      >
        <div class="reference-material-heading">
          <strong>{{ item.materialKind }}</strong>
          <span>{{ item.coverage }} · {{ item.confidence }} confidence</span>
        </div>
        <p>{{ item.summary }}</p>
        <p v-if="item.uncertainty" class="reference-material-uncertainty">
          Uncertainty: {{ item.uncertainty }}
        </p>
        <p v-if="item.evidenceRefs.length" class="reference-material-evidence">
          Evidence
          <span v-for="evidenceId in item.evidenceRefs" :key="evidenceId">
            {{ evidenceLabel(evidenceId) }}
          </span>
        </p>
      </li>
    </ul>

    <section v-if="preview.uncertainties.length" class="reference-material-uncertainties">
      <h5>Coverage uncertainties</h5>
      <ul>
        <li v-for="uncertainty in preview.uncertainties" :key="uncertainty">
          {{ uncertainty }}
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.reference-material-preview,
.reference-material-list,
.reference-material-card,
.reference-material-uncertainties {
  display: grid;
  gap: 8px;
}

.reference-material-preview {
  padding: 10px;
  border: 1px solid rgb(147 51 234);
  border-radius: 8px;
  background: rgb(250 245 255);
}

.reference-section-heading,
.reference-material-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.reference-section-heading h4,
.reference-section-heading p,
.reference-material-card p,
.reference-material-uncertainties h5,
.reference-material-uncertainties ul {
  margin: 0;
}

.reference-section-heading p,
.reference-material-heading span,
.reference-material-evidence,
.reference-material-uncertainty {
  color: rgb(100 116 139);
}

.reference-material-list,
.reference-material-uncertainties ul {
  padding: 0;
  list-style: none;
}

.reference-material-card {
  padding: 8px;
  border-radius: 6px;
  background: rgb(255 255 255);
}

.reference-material-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
}

.reference-material-evidence span {
  padding: 2px 5px;
  border-radius: 999px;
  background: rgb(243 232 255);
}

:global([data-theme="dark"]) .reference-material-preview {
  border-color: rgb(168 85 247);
  background: rgb(88 28 135 / 25%);
}

:global([data-theme="dark"]) .reference-material-card {
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-section-heading p,
:global([data-theme="dark"]) .reference-material-heading span,
:global([data-theme="dark"]) .reference-material-evidence,
:global([data-theme="dark"]) .reference-material-uncertainty {
  color: rgb(163 163 163);
}

:global([data-theme="dark"]) .reference-material-evidence span {
  background: rgb(88 28 135);
}

@media (max-width: 880px) {
  .reference-section-heading,
  .reference-material-heading {
    display: grid;
  }
}
</style>
