<script setup lang="ts">
import type { ReferenceWorkSummary } from '../../composables/useWorkspaceApi';

defineProps<{
  references: ReferenceWorkSummary[];
  updatingId: string;
}>();

const emit = defineEmits<{
  toggleEnabled: [reference: ReferenceWorkSummary];
}>();
</script>

<template>
  <div class="reference-list">
    <article v-for="reference in references" :key="reference.id" class="reference-card">
      <div class="panel-heading">
        <div class="reference-card-title">
          <strong>{{ reference.title }}</strong>
          <span>{{ reference.id }}</span>
        </div>
        <span class="status-pill">{{ reference.enabled ? 'Enabled' : 'Disabled' }}</span>
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
          <span>Stage</span>
          <strong>{{ reference.progress.currentStage }}</strong>
        </div>
      </div>
      <p class="reference-path">{{ reference.summaryPath }}</p>
      <p class="reference-path">{{ reference.bundlePath }}</p>
      <p class="reference-checksum">{{ reference.checksumSha256 }}</p>
      <div class="pending-actions">
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
.reference-path,
.reference-checksum {
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-card-title span,
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
</style>
