<script setup lang="ts">
import { computed } from 'vue';

import ReferenceQualityWarnings from './ReferenceQualityWarnings.vue';
import type {
  ReferenceDeconstructionAnalysisQualityStatus,
  ReferenceDeconstructionDiagnostic,
  ReferenceDeconstructionRunStatus,
} from '../../../composables/useWorkspaceApi';
import type {
  ReferenceDeconstructionPublicationView,
} from '../../../composables/useReferenceDeconstruction';

const props = defineProps<{
  publication: ReferenceDeconstructionPublicationView;
  status: ReferenceDeconstructionRunStatus;
  sourceChecksumSha256: string;
  pipelineVersion: number;
  capabilityVersion: string;
  coveragePercent: number;
  qualityStatus: ReferenceDeconstructionAnalysisQualityStatus;
  diagnostics: readonly ReferenceDeconstructionDiagnostic[];
  publishing: boolean;
  canPublish: boolean;
}>();

const emit = defineEmits<{
  publish: [];
  reviewPendingAction: [pendingActionId: string];
}>();

const categoryCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const entry of props.publication.entryInventory) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }));
});
const materialInventory = computed(() => props.publication.materialInventory ?? []);
const storyMaterialAnalysisFiles = computed(() => props.publication.files.filter((file) =>
  file.path.includes('/deconstruction/material-')));
const storyMaterialProjectionFiles = computed(() => props.publication.files.filter((file) =>
  file.kind === 'materials'));
const storyMaterialFiles = computed(() => [
  ...storyMaterialAnalysisFiles.value,
  ...storyMaterialProjectionFiles.value,
]);
const techniqueFiles = computed(() => props.publication.files.filter((file) =>
  file.kind === 'distilled'
  || file.kind === 'context'
  || file.kind === 'deconstruction'
    && !file.path.includes('/deconstruction/material-')));
const bundleControlFiles = computed(() => props.publication.files.filter((file) =>
  !storyMaterialFiles.value.includes(file)
  && !techniqueFiles.value.includes(file)));
const materialKindOrder = [
  'world',
  'characters',
  'relationships',
  'outline',
  'timeline',
] as const;
const materialKindRows = computed(() => materialKindOrder
  .filter((kind) =>
    materialInventory.value.some((entry) => entry.materialKind === kind)
    || storyMaterialProjectionFiles.value.some((file) =>
      file.path.endsWith(`/materials/${kind}.yaml`)))
  .map((kind) => ({
    kind,
    entryCount: materialInventory.value.filter((entry) =>
      entry.materialKind === kind).length,
    path: `materials/${kind}.yaml`,
  })));
const warningDiagnostics = computed(() =>
  props.diagnostics.filter((diagnostic) => !diagnostic.blocking),
);
</script>

<template>
  <section class="reference-publish-review" aria-label="Reference publish review">
    <div class="reference-section-heading">
      <div>
        <h4>Publish Review</h4>
        <p>
          Candidate files remain in workspace shadow storage until the global
          PendingAction is accepted.
        </p>
      </div>
      <span class="status-pill">
        {{ status === 'completed'
          ? 'Published'
          : publication.pendingActionId ? 'Approval pending' : 'Candidate ready' }}
      </span>
    </div>

    <div class="reference-publish-facts">
      <div class="status-block">
        <span>Coverage</span>
        <strong>{{ coveragePercent }}%</strong>
      </div>
      <div class="status-block">
        <span>Files</span>
        <strong>{{ publication.files.length }}</strong>
      </div>
      <div class="status-block">
        <span>Technique entries</span>
        <strong>{{ publication.entryInventory.length }}</strong>
      </div>
      <div class="status-block">
        <span>Material entries</span>
        <strong>{{ materialInventory.length }}</strong>
      </div>
      <div class="status-block">
        <span>Warnings</span>
        <strong>{{ warningDiagnostics.length }}</strong>
      </div>
    </div>

    <dl class="reference-publish-identity">
      <div>
        <dt>Candidate fingerprint</dt>
        <dd>{{ publication.candidateFingerprint }}</dd>
      </div>
      <div>
        <dt>Source checksum</dt>
        <dd>{{ sourceChecksumSha256 }}</dd>
      </div>
      <div>
        <dt>Pipeline</dt>
        <dd>{{ pipelineVersion }} · {{ capabilityVersion }}</dd>
      </div>
      <div>
        <dt>Prepared</dt>
        <dd>{{ publication.preparedAt }}</dd>
      </div>
    </dl>

    <section class="reference-publish-section" aria-label="Bundle control files">
      <h5>Bundle control files</h5>
      <ul class="reference-publish-file-list">
        <li v-for="file in bundleControlFiles" :key="file.path">
          <strong>{{ file.kind }}</strong>
          <span>{{ file.path }}</span>
          <small>{{ file.checksumSha256 }}</small>
        </li>
      </ul>
    </section>

    <section
      class="reference-publish-section reference-track-group"
      aria-label="Technique publication group"
    >
      <h5>Technique</h5>
      <p class="reference-track-boundary">
        Abstract, reusable craft observations. These files stay separate from
        concrete Story Materials.
      </p>
      <h6>Technique files</h6>
      <ul v-if="techniqueFiles.length" class="reference-publish-file-list">
        <li v-for="file in techniqueFiles" :key="file.path">
          <strong>{{ file.kind }}</strong>
          <span>{{ file.path }}</span>
          <small>{{ file.checksumSha256 }}</small>
        </li>
      </ul>
      <p v-else class="empty-copy">No Technique projection in this candidate.</p>
      <h6>Selector entry inventory</h6>
      <p class="reference-category-summary">
        <span v-for="item in categoryCounts" :key="item.category">
          {{ item.category }} {{ item.count }}
        </span>
      </p>
      <ul v-if="publication.entryInventory.length" class="reference-publish-entry-list">
        <li v-for="entry in publication.entryInventory" :key="entry.id">
          <div>
            <strong>{{ entry.title }}</strong>
            <span>{{ entry.category }} · {{ entry.estimatedTokens }} tokens</span>
          </div>
          <small>{{ entry.id }}</small>
        </li>
      </ul>
      <p v-else class="empty-copy">No Technique selector entries in this candidate.</p>
    </section>

    <section
      class="reference-publish-section reference-track-group reference-material-group"
      aria-label="Story Materials publication group"
    >
      <h5>Story Materials</h5>
      <p class="reference-track-boundary">
        YAML projections contain concrete source facts. Markdown analysis files are
        review evidence only; neither group is Technique or Writing context.
      </p>
      <p v-if="materialKindRows.length" class="reference-category-summary">
        <span v-for="item in materialKindRows" :key="item.kind">
          {{ item.kind }} {{ item.entryCount }} · {{ item.path }}
        </span>
      </p>
      <h6>Story Material analysis files</h6>
      <ul v-if="storyMaterialAnalysisFiles.length" class="reference-publish-file-list">
        <li v-for="file in storyMaterialAnalysisFiles" :key="file.path">
          <strong>{{ file.kind }}</strong>
          <span>{{ file.path }}</span>
          <small>{{ file.checksumSha256 }}</small>
        </li>
      </ul>
      <p v-else class="empty-copy">No Story Material analysis files in this candidate.</p>
      <h6>Concrete material files</h6>
      <ul v-if="storyMaterialProjectionFiles.length" class="reference-publish-file-list">
        <li v-for="file in storyMaterialProjectionFiles" :key="file.path">
          <strong>{{ file.kind }}</strong>
          <span>{{ file.path }}</span>
          <small>{{ file.checksumSha256 }}</small>
        </li>
      </ul>
      <p v-else class="empty-copy">No Story Material projection in this candidate.</p>
      <ul v-if="materialInventory.length" class="reference-publish-entry-list">
        <li v-for="entry in materialInventory" :key="entry.id">
          <div>
            <strong>{{ entry.title }}</strong>
            <span>
              {{ entry.materialKind }} · {{ entry.assertionType }} · {{ entry.confidence }} confidence
            </span>
          </div>
          <small>{{ entry.path }} · {{ entry.id }}</small>
        </li>
      </ul>
      <p v-else-if="storyMaterialProjectionFiles.length" class="empty-copy">
        The selected material files contain no projected entries.
      </p>
    </section>

    <ReferenceQualityWarnings
      :status="qualityStatus"
      :diagnostics="diagnostics"
    />

    <p class="reference-publish-boundary">
      Accept writes the complete candidate atomically and follows the existing Git
      auto-commit preference. Reject leaves the published reference bundle unchanged.
    </p>

    <div class="pending-actions">
      <button
        v-if="!publication.pendingActionId"
        class="primary-button tight-button"
        type="button"
        :disabled="!canPublish"
        @click="emit('publish')"
      >
        {{ publishing ? 'Creating PendingAction…' : 'Create publish PendingAction' }}
      </button>
      <button
        v-else-if="status !== 'completed'"
        class="primary-button tight-button"
        type="button"
        @click="emit('reviewPendingAction', publication.pendingActionId)"
      >
        Review PendingAction
      </button>
      <span v-if="status === 'publishing'" class="empty-copy">
        Awaiting an explicit global approval decision.
      </span>
      <span v-else-if="status === 'completed'" class="empty-copy">
        This accepted candidate is the current published reference bundle.
      </span>
    </div>
  </section>
</template>

<style scoped>
.reference-publish-review,
.reference-publish-section {
  display: grid;
  gap: 10px;
}

.reference-publish-review {
  padding: 10px;
  border: 1px solid rgb(22 163 74);
  border-radius: 8px;
  background: rgb(240 253 244);
}

.reference-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.reference-section-heading h4,
.reference-section-heading p,
.reference-publish-section h5,
.reference-publish-section h6,
.reference-category-summary,
.reference-track-boundary,
.reference-publish-boundary {
  margin: 0;
}

.reference-section-heading p,
.reference-track-boundary,
.reference-publish-boundary {
  color: rgb(71 85 105);
}

.reference-publish-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.reference-publish-identity {
  display: grid;
  gap: 6px;
  margin: 0;
}

.reference-publish-identity > div {
  display: grid;
  grid-template-columns: minmax(130px, auto) minmax(0, 1fr);
  gap: 8px;
}

.reference-publish-identity dt {
  color: rgb(71 85 105);
}

.reference-publish-identity dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.reference-publish-file-list,
.reference-publish-entry-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reference-publish-file-list li,
.reference-publish-entry-list li {
  display: grid;
  gap: 3px;
  padding: 8px;
  border-radius: 6px;
  background: rgb(255 255 255);
}

.reference-publish-file-list span,
.reference-publish-file-list small,
.reference-publish-entry-list span,
.reference-publish-entry-list small {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-size: 12px;
}

.reference-publish-entry-list > li > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.reference-track-group {
  padding: 10px;
  border: 1px solid rgb(187 247 208);
  border-radius: 8px;
  background: rgb(255 255 255 / 65%);
}

.reference-material-group {
  border-color: rgb(216 180 254);
}

.reference-category-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reference-category-summary span {
  padding: 3px 6px;
  border-radius: 999px;
  background: rgb(220 252 231);
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-publish-review {
  border-color: rgb(34 197 94);
  background: rgb(20 83 45 / 25%);
}

:global([data-theme="dark"]) .reference-publish-file-list li,
:global([data-theme="dark"]) .reference-publish-entry-list li {
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-track-group {
  border-color: rgb(22 101 52);
  background: rgb(23 23 23 / 45%);
}

:global([data-theme="dark"]) .reference-material-group {
  border-color: rgb(107 33 168);
}

:global([data-theme="dark"]) .reference-section-heading p,
:global([data-theme="dark"]) .reference-track-boundary,
:global([data-theme="dark"]) .reference-publish-boundary,
:global([data-theme="dark"]) .reference-publish-identity dt {
  color: rgb(163 163 163);
}

:global([data-theme="dark"]) .reference-category-summary span {
  background: rgb(20 83 45);
}

@media (max-width: 880px) {
  .reference-publish-facts {
    grid-template-columns: 1fr;
  }

  .reference-publish-entry-list > li > div {
    display: grid;
  }
}
</style>
