<script setup lang="ts">
import { computed, reactive } from 'vue';
import type {
  ReferenceAllowedUsage,
  ReferenceImportInput,
  ReferenceRights,
  ReferenceSourceType,
} from '../../composables/useWorkspaceApi';

const props = defineProps<{
  importing: boolean;
}>();

const emit = defineEmits<{
  import: [input: ReferenceImportInput];
}>();

const form = reactive({
  title: '',
  sourcePath: '',
  sourceText: '',
  originalFileName: '',
  sourceType: 'novel' as ReferenceSourceType,
  rights: 'unknown' as ReferenceRights,
  enabled: true,
  usage: {
    analysisOnly: true,
    styleInspiration: true,
    structureReference: true,
    noDirectQuotation: true,
  } satisfies Record<ReferenceAllowedUsage, boolean>,
});

const canSubmit = computed(() =>
  Boolean(form.title.trim() && (form.sourcePath.trim() || form.sourceText.trim())),
);

function submitImport() {
  if (!canSubmit.value || props.importing) {
    return;
  }

  emit('import', {
    title: form.title.trim(),
    sourcePath: form.sourcePath.trim() || undefined,
    sourceText: form.sourceText.trim() || undefined,
    originalFileName: form.originalFileName.trim() || undefined,
    sourceType: form.sourceType,
    rights: form.rights,
    enabled: form.enabled,
    allowedUsage: Object.entries(form.usage)
      .filter(([, selected]) => selected)
      .map(([usage]) => usage as ReferenceAllowedUsage),
  });
}
</script>

<template>
  <form class="reference-import-form" @submit.prevent="submitImport">
    <div class="reference-form-grid">
      <label class="field field-wide">
        Title
        <input v-model="form.title" class="text-input" type="text" placeholder="Reference title">
      </label>
      <label class="field">
        Source type
        <select v-model="form.sourceType" class="text-input">
          <option value="novel">Novel</option>
          <option value="chapterSample">Chapter sample</option>
          <option value="styleSample">Style sample</option>
          <option value="settingBible">Setting bible</option>
          <option value="notes">Notes</option>
        </select>
      </label>
      <label class="field">
        Rights
        <select v-model="form.rights" class="text-input">
          <option value="unknown">Unknown</option>
          <option value="owned">Owned</option>
          <option value="publicDomain">Public domain</option>
          <option value="licensed">Licensed</option>
          <option value="excerpt">Excerpt</option>
        </select>
      </label>
      <label class="field field-wide">
        Source path
        <input v-model="form.sourcePath" class="text-input" type="text" placeholder="/path/to/reference.txt">
      </label>
      <label class="field field-wide">
        Original file name
        <input v-model="form.originalFileName" class="text-input" type="text" placeholder="Optional for pasted text">
      </label>
      <label class="field field-wide">
        Paste source text
        <textarea
          v-model="form.sourceText"
          class="text-input reference-source-textarea"
          placeholder="Paste a short sample or source text"
        ></textarea>
      </label>
    </div>

    <fieldset class="reference-usage-panel">
      <legend>Allowed usage</legend>
      <label class="reference-check">
        <input v-model="form.usage.analysisOnly" type="checkbox">
        <span>Analysis only</span>
      </label>
      <label class="reference-check">
        <input v-model="form.usage.styleInspiration" type="checkbox">
        <span>Style inspiration</span>
      </label>
      <label class="reference-check">
        <input v-model="form.usage.structureReference" type="checkbox">
        <span>Structure reference</span>
      </label>
      <label class="reference-check">
        <input v-model="form.usage.noDirectQuotation" type="checkbox">
        <span>No direct quotation</span>
      </label>
      <label class="reference-check">
        <input v-model="form.enabled" type="checkbox">
        <span>Enabled in selector</span>
      </label>
    </fieldset>

    <button class="primary-button" type="submit" :disabled="!canSubmit || importing">
      {{ importing ? 'Importing...' : 'Import reference' }}
    </button>
  </form>
</template>

<style scoped>
.reference-import-form {
  display: grid;
  gap: 12px;
}

.reference-form-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reference-source-textarea {
  min-height: 120px;
  resize: vertical;
}

.reference-usage-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 10px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
}

:global([data-theme="dark"]) .reference-usage-panel {
  border-color: rgb(64 64 64);
}

.reference-usage-panel legend {
  padding: 0 4px;
  font-size: 12px;
  font-weight: 800;
}

.reference-check {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
}

@media (max-width: 880px) {
  .reference-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
