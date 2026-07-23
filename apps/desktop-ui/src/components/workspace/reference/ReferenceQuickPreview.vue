<script setup lang="ts">
import { computed } from 'vue';

import type {
  ReferencePreviewEvidence,
  ReferenceQuickPreview,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  preview: ReferenceQuickPreview;
  evidence: ReferencePreviewEvidence[];
}>();

const evidenceLabels = computed(() => new Map(
  props.evidence.map((item) => [
    item.id,
    `${item.pointer.chapterId} · lines ${item.pointer.lineStart}-${item.pointer.lineEnd}`,
  ]),
));

function evidenceLabel(evidenceRef: string): string {
  return evidenceLabels.value.get(evidenceRef) ?? evidenceRef;
}
</script>

<template>
  <article class="reference-preview" aria-label="Reference quick preview">
    <div class="reference-section-heading">
      <div>
        <h4>Quick Preview</h4>
        <p>{{ preview.sourceOverview }}</p>
      </div>
      <span class="status-pill">{{ preview.confidence }} confidence</span>
    </div>

    <div class="reference-coverage-grid">
      <div class="status-block">
        <span>Chapters</span>
        <strong>
          {{ preview.coverage.analyzedChapterIds.length }}/{{ preview.coverage.selectedChapterIds.length }}
        </strong>
      </div>
      <div class="status-block">
        <span>Evidence</span>
        <strong>
          {{ preview.coverage.citedPointerCount }}/{{ preview.coverage.selectedPointerCount }}
        </strong>
      </div>
      <div class="status-block">
        <span>Coverage</span>
        <strong>{{ preview.coverage.chapterCoveragePercent }}%</strong>
      </div>
    </div>

    <section v-if="preview.chapterPreviews.length" class="reference-preview-section">
      <h5>Opening chapters</h5>
      <article
        v-for="chapter in preview.chapterPreviews"
        :key="chapter.id"
        class="reference-preview-card"
      >
        <div class="reference-section-heading">
          <strong>{{ chapter.chapterId }}</strong>
          <span>{{ chapter.confidence }}</span>
        </div>
        <p>{{ chapter.summary }}</p>
        <p v-if="chapter.uncertainty" class="reference-uncertainty">
          Uncertainty: {{ chapter.uncertainty }}
        </p>
        <small v-if="chapter.evidenceRefs.length">
          {{ chapter.evidenceRefs.map(evidenceLabel).join(' · ') }}
        </small>
      </article>
    </section>

    <section v-if="preview.borrowablePatterns.length" class="reference-preview-section">
      <h5>Borrowable patterns</h5>
      <article
        v-for="pattern in preview.borrowablePatterns"
        :key="pattern.id"
        class="reference-preview-card"
      >
        <div class="reference-section-heading">
          <strong>{{ pattern.title }}</strong>
          <span>{{ pattern.confidence }}</span>
        </div>
        <p>{{ pattern.technique }}</p>
        <p v-if="pattern.whenUseful"><strong>When useful:</strong> {{ pattern.whenUseful }}</p>
        <small>{{ pattern.evidenceRefs.map(evidenceLabel).join(' · ') }}</small>
      </article>
    </section>

    <section v-if="preview.findings.length" class="reference-preview-section">
      <h5>Technique observations</h5>
      <article
        v-for="finding in preview.findings"
        :key="finding.id"
        class="reference-preview-card"
      >
        <div class="reference-section-heading">
          <strong>{{ finding.kind }}</strong>
          <span>{{ finding.confidence }}</span>
        </div>
        <p>{{ finding.observation }}</p>
        <p><strong>Technique:</strong> {{ finding.technique }}</p>
        <p v-if="finding.whenUseful"><strong>When useful:</strong> {{ finding.whenUseful }}</p>
        <p v-if="finding.avoid"><strong>Avoid:</strong> {{ finding.avoid }}</p>
        <p v-if="finding.uncertainty" class="reference-uncertainty">
          Uncertainty: {{ finding.uncertainty }}
        </p>
        <small v-if="finding.evidenceRefs.length">
          {{ finding.evidenceRefs.map(evidenceLabel).join(' · ') }}
        </small>
        <small v-else>General inference; no source claim.</small>
      </article>
    </section>

    <div class="reference-guardrail-grid">
      <section v-if="preview.doNotCopy.length" class="reference-preview-section">
        <h5>Do not copy</h5>
        <ul>
          <li v-for="item in preview.doNotCopy" :key="item">{{ item }}</li>
        </ul>
      </section>
      <section v-if="preview.differentiationRequirements.length" class="reference-preview-section">
        <h5>Differentiation requirements</h5>
        <ul>
          <li v-for="item in preview.differentiationRequirements" :key="item">{{ item }}</li>
        </ul>
      </section>
      <section v-if="preview.differentiationPrompts.length" class="reference-preview-section">
        <h5>Differentiation prompts</h5>
        <ul>
          <li v-for="item in preview.differentiationPrompts" :key="item">{{ item }}</li>
        </ul>
      </section>
      <section v-if="preview.canonContaminationWarnings.length" class="reference-preview-section">
        <h5>Canon contamination warnings</h5>
        <ul>
          <li v-for="item in preview.canonContaminationWarnings" :key="item">{{ item }}</li>
        </ul>
      </section>
    </div>

    <section v-if="preview.uncertainties.length" class="reference-preview-section">
      <h5>Uncertainties</h5>
      <ul>
        <li v-for="item in preview.uncertainties" :key="item">{{ item }}</li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
.reference-preview,
.reference-preview-section {
  display: grid;
  gap: 8px;
}

.reference-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.reference-section-heading h4,
.reference-preview-section h5,
.reference-section-heading p,
.reference-preview-card p,
.reference-preview-section ul {
  margin: 0;
}

.reference-section-heading p,
.reference-preview-card p,
.reference-preview-card small,
.reference-preview-section li {
  overflow-wrap: anywhere;
}

.reference-section-heading p,
.reference-preview-card small {
  color: rgb(100 116 139);
}

.reference-coverage-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.reference-preview-card,
.reference-preview-section {
  padding: 9px;
  border-radius: 8px;
  background: rgb(248 250 252);
}

.reference-preview-section .reference-preview-card {
  background: rgb(255 255 255);
}

.reference-guardrail-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reference-preview-section ul {
  display: grid;
  gap: 4px;
  padding-left: 18px;
}

.reference-uncertainty {
  color: rgb(180 83 9);
}

:global([data-theme="dark"]) .reference-preview-card,
:global([data-theme="dark"]) .reference-preview-section {
  background: rgb(38 38 38);
}

:global([data-theme="dark"]) .reference-preview-section .reference-preview-card {
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-section-heading p,
:global([data-theme="dark"]) .reference-preview-card small {
  color: rgb(163 163 163);
}

@media (max-width: 880px) {
  .reference-guardrail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
