<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionEntry,
  ReferenceMaterialAdoptionSelection,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  catalog: ReferenceMaterialAdoptionCatalog;
  disabled: boolean;
}>();

const emit = defineEmits<{
  preview: [selections: ReferenceMaterialAdoptionSelection[]];
}>();

interface EntryFormState {
  selected: boolean;
  targetFile: string;
  targetPath: string;
}

const form = reactive<Record<string, EntryFormState>>({});
const groupedEntries = computed(() => {
  const groups = new Map<string, ReferenceMaterialAdoptionEntry[]>();
  for (const entry of props.catalog.entries) {
    const items = groups.get(entry.materialKind) ?? [];
    items.push(entry);
    groups.set(entry.materialKind, items);
  }
  return [...groups.entries()].map(([materialKind, entries]) => ({
    materialKind,
    entries,
  }));
});
const selections = computed<ReferenceMaterialAdoptionSelection[]>(() =>
  props.catalog.entries.flatMap((entry) => {
    const state = form[entry.id];
    if (!state?.selected || !state.targetFile.trim()) return [];
    return [{
      entryId: entry.id,
      targetFile: state.targetFile.trim(),
      ...(entry.materialKind === 'timeline' && state.targetPath.trim()
        ? { targetPath: state.targetPath.trim() }
        : {}),
    }];
  }),
);
const canPreview = computed(() => !props.disabled && selections.value.length > 0);

watch(
  () => props.catalog.fingerprint,
  () => {
    for (const key of Object.keys(form)) delete form[key];
    for (const entry of props.catalog.entries) {
      const defaults = defaultTarget(entry);
      form[entry.id] = {
        selected: false,
        targetFile: defaults.targetFile,
        targetPath: defaults.targetPath ?? '',
      };
    }
  },
  { immediate: true },
);

function requestPreview(): void {
  if (canPreview.value) emit('preview', selections.value);
}

function defaultTarget(entry: ReferenceMaterialAdoptionEntry): {
  targetFile: string;
  targetPath?: string;
} {
  const slug = safeSlug(entry.id);
  switch (entry.materialKind) {
    case 'world':
      return { targetFile: `world/adopted/${slug}.md` };
    case 'characters':
      return { targetFile: `characters/${slug}/summary.md` };
    case 'relationships':
      return { targetFile: `characters/${slug}/relationships.yaml` };
    case 'outline':
      return { targetFile: 'outline/main.md' };
    case 'timeline':
      return { targetFile: 'timeline/events.yaml', targetPath: 'events' };
  }
}

function safeSlug(value: string): string {
  const slug = value.toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 72);
  return slug || 'adopted-entry';
}
</script>

<template>
  <form class="material-entry-selector" @submit.prevent="requestPreview">
    <div class="material-entry-selector-heading">
      <div>
        <h4>Published Story Materials</h4>
        <p>
          Select only the entries to adopt, then review each controlled workspace target.
        </p>
      </div>
      <span class="status-pill">{{ catalog.entries.length }} entries</span>
    </div>

    <section
      v-for="group in groupedEntries"
      :key="group.materialKind"
      class="material-kind-group"
      :aria-label="`${group.materialKind} Story Materials`"
    >
      <h5>{{ group.materialKind }}</h5>
      <article
        v-for="entry in group.entries"
        :key="entry.id"
        class="material-entry-card"
      >
        <label class="material-entry-toggle">
          <input
            v-model="form[entry.id]!.selected"
            type="checkbox"
            :disabled="disabled"
          >
          <span>
            <strong>{{ entry.title }}</strong>
            <small>
              {{ entry.assertionType }} · {{ entry.confidence }} · {{ entry.sourcePath }}
            </small>
          </span>
        </label>
        <p>{{ entry.content }}</p>
        <p v-if="entry.uncertainty" class="material-entry-uncertainty">
          Uncertainty: {{ entry.uncertainty }}
        </p>
        <p class="material-entry-evidence">
          Evidence {{ entry.evidenceRefs.join(', ') }}
        </p>
        <div v-if="form[entry.id]!.selected" class="material-target-fields">
          <label>
            <span>Workspace target</span>
            <input
              v-model="form[entry.id]!.targetFile"
              type="text"
              spellcheck="false"
              :disabled="disabled"
            >
          </label>
          <label v-if="entry.materialKind === 'timeline'">
            <span>YAML path</span>
            <input
              v-model="form[entry.id]!.targetPath"
              type="text"
              spellcheck="false"
              :disabled="disabled"
            >
          </label>
        </div>
      </article>
    </section>

    <button
      class="primary-button tight-button"
      type="submit"
      :disabled="!canPreview"
    >
      Preview adoption diff ({{ selections.length }})
    </button>
  </form>
</template>

<style scoped>
.material-entry-selector,
.material-kind-group,
.material-entry-card,
.material-target-fields,
.material-target-fields label {
  display: grid;
  gap: 8px;
}

.material-entry-selector-heading,
.material-entry-toggle {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.material-entry-selector-heading h4,
.material-entry-selector-heading p,
.material-kind-group h5,
.material-entry-card p {
  margin: 0;
}

.material-entry-selector-heading p,
.material-entry-toggle small,
.material-entry-evidence {
  color: rgb(100 116 139);
  font-size: 12px;
}

.material-kind-group {
  padding-top: 8px;
  border-top: 1px solid rgb(226 232 240);
}

.material-kind-group h5 {
  text-transform: capitalize;
}

.material-entry-card {
  padding: 10px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(248 250 252);
}

.material-entry-toggle {
  justify-content: flex-start;
}

.material-entry-toggle span {
  display: grid;
  gap: 2px;
}

.material-entry-uncertainty {
  color: rgb(180 83 9);
}

.material-target-fields {
  grid-template-columns: minmax(0, 1fr) minmax(110px, 0.35fr);
}

.material-target-fields label span {
  color: rgb(71 85 105);
  font-size: 11px;
  font-weight: 700;
}

.material-target-fields input {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgb(203 213 225);
  border-radius: 6px;
  background: white;
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

:global([data-theme="dark"]) .material-kind-group,
:global([data-theme="dark"]) .material-entry-card {
  border-color: rgb(64 64 64);
}

:global([data-theme="dark"]) .material-entry-card,
:global([data-theme="dark"]) .material-target-fields input {
  background: rgb(38 38 38);
}

:global([data-theme="dark"]) .material-entry-selector-heading p,
:global([data-theme="dark"]) .material-entry-toggle small,
:global([data-theme="dark"]) .material-entry-evidence,
:global([data-theme="dark"]) .material-target-fields label span {
  color: rgb(163 163 163);
}
</style>
