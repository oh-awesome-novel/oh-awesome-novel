<script setup lang="ts">
import type { ReferenceImportResult } from '../../../composables/useWorkspaceApi';

defineProps<{
  result: ReferenceImportResult;
}>();
</script>

<template>
  <article class="reference-import-result">
    <div class="panel-heading">
      <h3 class="panel-title">{{ result.reference.title }}</h3>
      <span class="status-pill">{{ result.manifest.detectedStructure.confidence }}</span>
    </div>
    <div class="reference-meta-grid">
      <div class="status-block">
        <span>Chapters</span>
        <strong>{{ result.manifest.detectedStructure.chapterCount }}</strong>
      </div>
      <div class="status-block">
        <span>Files</span>
        <strong>{{ result.createdFiles.length }}</strong>
      </div>
      <div class="status-block">
        <span>Analysis</span>
        <strong>{{ result.reference.deconstructionStatus }}</strong>
      </div>
      <div class="status-block">
        <span>Writing context</span>
        <strong>{{ result.reference.contextEligible ? 'Eligible' : 'Not eligible' }}</strong>
      </div>
    </div>
    <p class="reference-path">{{ result.reference.bundlePath }}</p>
    <p class="reference-checksum">{{ result.reference.checksumSha256 }}</p>
  </article>
</template>

<style scoped>
.reference-import-result {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(255 255 255);
}

.reference-meta-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reference-path,
.reference-checksum {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
  color: rgb(100 116 139);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-import-result {
  border-color: rgb(64 64 64);
  background: rgb(23 23 23);
}

:global([data-theme="dark"]) .reference-path,
:global([data-theme="dark"]) .reference-checksum {
  color: rgb(163 163 163);
}
</style>
