<script setup lang="ts">
import type { ReferenceWorkSummary } from '../../composables/useWorkspaceApi';

defineProps<{
  references: ReferenceWorkSummary[];
  updatingId: string;
  selectedId: string;
  selectionDisabled: boolean;
}>();

const emit = defineEmits<{
  toggleEnabled: [reference: ReferenceWorkSummary];
  select: [reference: ReferenceWorkSummary];
}>();

function publishedContext(reference: ReferenceWorkSummary): {
  fingerprint: string;
  entryCount: number;
} | undefined {
  return reference.publishedContext;
}
</script>

<template>
  <div class="reference-list">
    <article
      v-for="reference in references"
      :key="reference.id"
      class="reference-card"
      :class="{ 'reference-card-selected': selectedId === reference.id }"
    >
      <div class="panel-heading">
        <div class="reference-card-title">
          <strong>{{ reference.title }}</strong>
          <span>{{ reference.id }}</span>
        </div>
        <span class="status-pill">
          Preference {{ reference.enabled ? 'enabled' : 'disabled' }}
        </span>
      </div>
      <div class="reference-meta-grid">
        <div class="status-block">
          <span>Type</span>
          <strong>{{ reference.sourceType }}</strong>
        </div>
        <div class="status-block">
          <span>Rights</span>
          <strong>{{ reference.rights }}</strong>
        </div>
        <div class="status-block">
          <span>Chapters</span>
          <strong>{{ reference.chapterCount }}</strong>
        </div>
        <div class="status-block">
          <span>Boundary confidence</span>
          <strong>{{ reference.structureConfidence }}</strong>
        </div>
        <div class="status-block">
          <span>Analysis</span>
          <strong>{{ reference.deconstructionStatus }}</strong>
        </div>
        <div class="status-block">
          <span>Writing context</span>
          <strong>{{ reference.contextEligible ? 'Eligible' : 'Not eligible' }}</strong>
        </div>
      </div>
      <p class="reference-readiness">{{ reference.readinessReason }}</p>
      <p v-if="publishedContext(reference)" class="reference-published-summary">
        {{ publishedContext(reference)?.entryCount }} distilled entries ·
        fingerprint {{ publishedContext(reference)?.fingerprint }}
      </p>
      <p class="reference-path">{{ reference.summaryPath }}</p>
      <p class="reference-path">{{ reference.bundlePath }}</p>
      <p class="reference-checksum">{{ reference.checksumSha256 }}</p>
      <div class="pending-actions">
        <button
          class="ghost-button tight-button"
          type="button"
          :disabled="selectionDisabled || selectedId === reference.id"
          @click="emit('select', reference)"
        >
          {{ selectedId === reference.id ? 'Selected' : 'Open' }}
        </button>
        <button
          class="secondary-button tight-button"
          type="button"
          :disabled="updatingId === reference.id"
          @click="emit('toggleEnabled', reference)"
        >
          {{ reference.enabled ? 'Disable' : 'Enable' }}
        </button>
      </div>
    </article>

    <p v-if="references.length === 0" class="empty-copy">
      No imported references yet.
    </p>
  </div>
</template>

<style scoped>
.reference-list {
  display: grid;
  gap: 10px;
}

.reference-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(248 250 252);
}

.reference-card-selected {
  border-color: rgb(37 99 235);
  box-shadow: 0 0 0 1px rgb(37 99 235 / 20%);
}

:global([data-theme="dark"]) .reference-card {
  border-color: rgb(64 64 64);
  background: rgb(38 38 38);
}

.reference-card-title {
  min-width: 0;
}

.reference-card-title strong,
.reference-card-title span {
  display: block;
}

.reference-card-title span,
.reference-readiness,
.reference-published-summary,
.reference-path,
.reference-checksum {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-card-title span,
:global([data-theme="dark"]) .reference-readiness,
:global([data-theme="dark"]) .reference-published-summary,
:global([data-theme="dark"]) .reference-path,
:global([data-theme="dark"]) .reference-checksum {
  color: rgb(163 163 163);
}

.reference-meta-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reference-path,
.reference-checksum {
  margin: 8px 0 0;
}

.reference-readiness {
  margin: 8px 0 0;
  color: rgb(100 116 139);
  font-size: 12px;
}

.reference-published-summary {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
  color: rgb(21 128 61);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
