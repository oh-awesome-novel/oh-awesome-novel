<script setup lang="ts">
import ReferenceCharacterDecision from './ReferenceCharacterDecision.vue';
import type { CharacterAdoptionDecision, ReferenceCharacterPreflight, RelationshipCharacterSelection } from '@oh-awesome-novel/client';
import { computed, reactive, shallowRef, watch } from 'vue';

import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionEntry,
  ReferenceMaterialAdoptionPreflightIssue,
  ReferenceMaterialAdoptionRecord,
  ReferenceMaterialAdoptionSelection,
  ReferenceMaterialAdoptionTargetSuggestions,
} from '../../../composables/useWorkspaceApi';
import {
  CONFIDENCE_LABELS,
  MATERIAL_KIND_LABELS,
  MATERIAL_KINDS,
} from './referenceMaterialLabels';

const PAGE_SIZE = 30;
const MAX_SELECTIONS = 64;

const props = defineProps<{
  catalog: ReferenceMaterialAdoptionCatalog;
  disabled: boolean;
  targetSuggestions?: ReferenceMaterialAdoptionTargetSuggestions;
  /** Issues from the latest preflight, shown next to the entries they name. */
  issues?: readonly ReferenceMaterialAdoptionPreflightIssue[];
  records?: readonly ReferenceMaterialAdoptionRecord[];
  characterPreflight?: ReferenceCharacterPreflight;
}>();

const emit = defineEmits<{
  /** Asks for the batch check; nothing is generated yet. */
  preflight: [selections: ReferenceMaterialAdoptionSelection[]];
  /** The batch changed, so an earlier preflight no longer describes it. */
  change: [];
}>();

interface EntryFormState {
  characterDecision?: CharacterAdoptionDecision;
  relationshipCharacters?: RelationshipCharacterSelection[];
  selected: boolean;
  targetFile: string;
  targetPath: string;
}

type KindFilter = 'all' | ReferenceMaterialAdoptionEntry['materialKind'];
type ConfidenceFilter = 'all' | ReferenceMaterialAdoptionEntry['confidence'];
type FlagFilter = 'all' | 'uncertain' | 'selected' | 'adopted' | 'notAdopted';

const form = reactive<Record<string, EntryFormState>>({});
const query = shallowRef('');
const characterCheck = shallowRef<ReferenceCharacterPreflight>();
watch(() => props.characterPreflight, value => {
  if (!value) return;
  characterCheck.value = value;
  for (const match of value.matches) {
    const state = form[match.entryId];
    if (state && match.recordedCharacterId && !state.characterDecision) state.targetFile = state.targetFile.replace(/^characters\/[^/]+\//u, `characters/${match.recordedCharacterId}/`);
  }
});
const kindFilter = shallowRef<KindFilter>('all');
const confidenceFilter = shallowRef<ConfidenceFilter>('all');
const flagFilter = shallowRef<FlagFilter>('all');
const visibleLimit = shallowRef(PAGE_SIZE);

/** Entries a retained adoption record names, with the furthest state they reached. */
const adoption = computed(() => {
  const map = new Map<string, { status: 'accepted' | 'pending'; targetFile: string }>();
  for (const record of props.records ?? []) {
    if (record.status === 'rejected') continue;
    for (const entry of record.entries) {
      if (entry.decision === 'skip') continue;
      if (map.get(entry.entryId)?.status === 'accepted') continue;
      map.set(entry.entryId, { status: record.status, targetFile: entry.targetFile });
    }
  }
  return map;
});

const filteredEntries = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return props.catalog.entries.filter((entry) => {
    if (kindFilter.value !== 'all' && entry.materialKind !== kindFilter.value) return false;
    if (confidenceFilter.value !== 'all' && entry.confidence !== confidenceFilter.value) return false;
    if (flagFilter.value === 'uncertain' && !entry.uncertainty) return false;
    if (flagFilter.value === 'selected' && !form[entry.id]?.selected) return false;
    if (flagFilter.value === 'adopted' && !adoption.value.has(entry.id)) return false;
    if (flagFilter.value === 'notAdopted' && adoption.value.has(entry.id)) return false;
    if (!needle) return true;
    return [entry.title, entry.content, entry.uncertainty ?? '', ...entry.details]
      .some((text) => text.toLowerCase().includes(needle));
  });
});
const visibleEntries = computed(() => filteredEntries.value.slice(0, visibleLimit.value));
const selectedEntries = computed(() =>
  props.catalog.entries.filter((entry) => form[entry.id]?.selected));
const hiddenSelectedCount = computed(() => {
  const shown = new Set(filteredEntries.value.map((entry) => entry.id));
  return selectedEntries.value.filter((entry) => !shown.has(entry.id)).length;
});
const selections = computed<ReferenceMaterialAdoptionSelection[]>(() =>
  selectedEntries.value.map((entry) => {
    const state = form[entry.id]!;
    return {
      ...(state.characterDecision ? { characterDecision: state.characterDecision } : {}),
      ...(state.relationshipCharacters?.length ? { relationshipCharacters: state.relationshipCharacters } : {}),
      entryId: entry.id,
      targetFile: state.targetFile.trim(),
      ...(entry.materialKind === 'timeline' && state.targetPath.trim()
        ? { targetPath: state.targetPath.trim() }
        : {}),
    };
  }),
);
const canPreflight = computed(() => !props.disabled && selections.value.length > 0);
const issuesByEntry = computed(() => {
  const map = new Map<string, ReferenceMaterialAdoptionPreflightIssue[]>();
  for (const issue of props.issues ?? []) {
    for (const entryId of issue.entryIds) {
      map.set(entryId, [...(map.get(entryId) ?? []), issue]);
    }
  }
  return map;
});

watch(
  () => props.catalog.fingerprint,
  () => {
    characterCheck.value = undefined;
    for (const key of Object.keys(form)) delete form[key];
    for (const entry of props.catalog.entries) {
      const defaults = defaultTarget(entry);
      form[entry.id] = {
        selected: false,
        targetFile: defaults.targetFile,
        targetPath: defaults.targetPath ?? '',
      };
    }
    query.value = '';
    kindFilter.value = 'all';
    confidenceFilter.value = 'all';
    flagFilter.value = 'all';
    visibleLimit.value = PAGE_SIZE;
  },
  { immediate: true },
);
// Filtering never touches the selection; it only restarts the page.
watch([query, kindFilter, confidenceFilter, flagFilter], () => {
  visibleLimit.value = PAGE_SIZE;
});
// Any change to the batch makes an earlier preflight stale.
watch(() => JSON.stringify(selections.value), (next, previous) => {
  if (previous !== undefined && next !== previous) emit('change');
});

function decideCharacter(entryId: string, decision: CharacterAdoptionDecision): void {
  form[entryId]!.characterDecision = decision;
  form[entryId]!.targetFile = form[entryId]!.targetFile.replace(/^characters\/[^/]+\//u, `characters/${decision.characterId}/`);
}
function requestPreflight(): void {
  if (canPreflight.value) emit('preflight', selections.value);
}

function selectFiltered(): void {
  let room = MAX_SELECTIONS - selectedEntries.value.length;
  for (const entry of filteredEntries.value) {
    if (room <= 0) break;
    const state = form[entry.id]!;
    if (state.selected) continue;
    state.selected = true;
    room -= 1;
  }
}

function clearSelection(): void {
  for (const entry of props.catalog.entries) form[entry.id]!.selected = false;
}

function suggestionListId(entry: ReferenceMaterialAdoptionEntry): string {
  return `material-target-suggestions-${entry.materialKind}`;
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
  <form class="material-entry-selector" @submit.prevent="requestPreflight">
    <div class="material-entry-selector-heading">
      <div>
        <h4>已发布的拆书材料</h4>
        <p>勾选要采用的条目，核对每条的目标文件，再预检这一批。</p>
      </div>
      <span class="status-pill">共 {{ catalog.entries.length }} 条</span>
    </div>

    <div class="material-filters" role="group" aria-label="筛选材料">
      <label class="material-filter-search">
        <span>搜索</span>
        <input v-model="query" type="search" placeholder="标题、内容或不确定说明" :disabled="disabled">
      </label>
      <label>
        <span>类型</span>
        <select v-model="kindFilter" :disabled="disabled">
          <option value="all">全部类型</option>
          <option v-for="kind in MATERIAL_KINDS" :key="kind" :value="kind">
            {{ MATERIAL_KIND_LABELS[kind] }}
          </option>
        </select>
      </label>
      <label>
        <span>把握</span>
        <select v-model="confidenceFilter" :disabled="disabled">
          <option value="all">全部</option>
          <option value="high">{{ CONFIDENCE_LABELS.high }}</option>
          <option value="medium">{{ CONFIDENCE_LABELS.medium }}</option>
          <option value="low">{{ CONFIDENCE_LABELS.low }}</option>
        </select>
      </label>
      <label>
        <span>范围</span>
        <select v-model="flagFilter" :disabled="disabled">
          <option value="all">全部条目</option>
          <option value="uncertain">有不确定说明</option>
          <option value="selected">只看已选</option>
          <option value="adopted">采用过</option>
          <option value="notAdopted">没有采用记录</option>
        </select>
      </label>
    </div>

    <p class="material-filter-summary" role="status">
      符合筛选 {{ filteredEntries.length }} 条，显示 {{ visibleEntries.length }} 条 ·
      已选 {{ selectedEntries.length }} / {{ MAX_SELECTIONS }}
      <template v-if="hiddenSelectedCount">（{{ hiddenSelectedCount }} 条已选不在当前筛选结果中）</template>
      <button
        class="ghost-button tight-button"
        type="button"
        :disabled="disabled || !filteredEntries.length || selectedEntries.length >= MAX_SELECTIONS"
        @click="selectFiltered"
      >
        选中筛选结果
      </button>
      <button
        class="ghost-button tight-button"
        type="button"
        :disabled="disabled || !selectedEntries.length"
        @click="clearSelection"
      >
        清空选择
      </button>
    </p>

    <template v-if="targetSuggestions">
      <datalist v-for="kind in MATERIAL_KINDS" :id="`material-target-suggestions-${kind}`" :key="kind">
        <option v-for="path in targetSuggestions[kind]" :key="path" :value="path"></option>
      </datalist>
    </template>

    <p v-if="!filteredEntries.length" class="material-filter-empty">没有符合筛选条件的条目。</p>

    <article
      v-for="entry in visibleEntries"
      :key="entry.id"
      class="material-entry-card"
      :class="{ 'material-entry-card-selected': form[entry.id]!.selected }"
    >
      <label class="material-entry-toggle">
        <input
          v-model="form[entry.id]!.selected"
          type="checkbox"
          :disabled="disabled || (!form[entry.id]!.selected && selectedEntries.length >= MAX_SELECTIONS)"
        >
        <span>
          <strong>{{ entry.title }}</strong>
          <small>
            {{ MATERIAL_KIND_LABELS[entry.materialKind] }} · {{ CONFIDENCE_LABELS[entry.confidence] }}
            <template v-if="adoption.get(entry.id)">
              · {{ adoption.get(entry.id)!.status === 'accepted' ? '已采用到' : '审批中，目标' }}
              {{ adoption.get(entry.id)!.targetFile }}
            </template>
          </small>
        </span>
      </label>
      <p class="material-entry-content">{{ entry.content }}</p>
      <p v-if="entry.uncertainty" class="material-entry-uncertainty">
        不确定：{{ entry.uncertainty }}
      </p>
      <details class="material-entry-evidence">
        <summary>依据与细节</summary>
        <ul v-if="entry.details.length">
          <li v-for="detail in entry.details" :key="detail">{{ detail }}</li>
        </ul>
        <p>{{ entry.assertionType }} · 证据 {{ entry.evidenceRefs.join('、') }}</p>
      </details>
      <div v-if="form[entry.id]!.selected" class="material-target-fields">
        <label>
          <span>目标文件</span>
          <input
            v-model="form[entry.id]!.targetFile"
            type="text"
            spellcheck="false"
            :list="suggestionListId(entry)"
            :disabled="disabled"
          >
        </label>
        <label v-if="entry.materialKind === 'timeline'">
          <span>YAML 路径</span>
          <input
            v-model="form[entry.id]!.targetPath"
            type="text"
            spellcheck="false"
            :disabled="disabled"
          >
        </label>
        <button
          class="ghost-button tight-button"
          type="button"
          :disabled="disabled"
          @click="form[entry.id]!.selected = false"
        >
          移出这一批
        </button>
      </div>
      <template v-if="form[entry.id]!.selected && characterCheck">
        <ReferenceCharacterDecision v-for="match in characterCheck.matches.filter(m => m.entryId === entry.id)" :key="match.entryId" :match="match" :entry="entry" :characters="characterCheck.characters" :decision="form[entry.id]!.characterDecision" :disabled="disabled" @decide="decideCharacter(entry.id, $event)" @remove="form[entry.id]!.selected = false" />
        <fieldset v-if="entry.materialKind === 'relationships'" :disabled="disabled" class="relationship-resolution">
          <legend>确认关系中的对方人物</legend><p>填写来料姓名；有当前人物对应时可自动解析，也可以指定角色。每个对方各列一行。</p>
          <div v-for="(person, index) in form[entry.id]!.relationshipCharacters ?? []" :key="index">
            <label>来料人物名<input v-model="person.name" aria-label="关系来料人物名" /></label>
            <label>对应角色<select v-model="person.characterId" aria-label="关系对应角色"><option value="">按已确认的人物对应解析</option><option v-for="c in characterCheck.characters" :key="c.id" :value="c.id">{{ c.name }} · {{ c.id }}</option><option v-for="s in selectedEntries.filter(e => e.materialKind === 'characters' && form[e.id]!.characterDecision?.kind !== 'same')" :key="s.id" :value="form[s.id]!.targetFile.split('/')[1]">本批：{{ s.title }}</option></select></label>
            <button type="button" @click="form[entry.id]!.relationshipCharacters!.splice(index, 1)">移除人物</button>
          </div>
          <button type="button" @click="(form[entry.id]!.relationshipCharacters ??= []).push({ name: '', characterId: '' })">添加关系人物</button>
        </fieldset>
      </template>
      <ul v-if="form[entry.id]!.selected && issuesByEntry.get(entry.id)" class="material-entry-issues">
        <li
          v-for="issue in issuesByEntry.get(entry.id)"
          :key="`${issue.code}-${issue.targetFile ?? ''}`"
          :class="`material-issue-${issue.severity}`"
        >
          {{ issue.message }}
        </li>
      </ul>
    </article>

    <button
      v-if="visibleEntries.length < filteredEntries.length"
      class="ghost-button tight-button"
      type="button"
      @click="visibleLimit += PAGE_SIZE"
    >
      再显示 {{ Math.min(PAGE_SIZE, filteredEntries.length - visibleEntries.length) }} 条
    </button>

    <button class="primary-button tight-button" type="submit" :disabled="!canPreflight">
      预检这一批（{{ selections.length }}）
    </button>
  </form>
</template>

<style scoped>
.material-entry-selector,
.material-entry-card,
.material-target-fields label,
.material-filters label {
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
.material-entry-card p,
.material-filter-summary,
.material-filter-empty {
  margin: 0;
}

.material-entry-selector-heading p,
.material-entry-toggle small,
.material-entry-evidence,
.material-filter-summary,
.material-filter-empty,
.material-filters label span,
.material-target-fields label span {
  color: rgb(100 116 139);
  font-size: 12px;
}

.material-filters {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.material-filter-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.material-entry-card {
  padding: 10px;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  background: rgb(248 250 252);
}

.material-entry-card-selected {
  border-color: rgb(59 130 246);
}

.material-entry-toggle {
  justify-content: flex-start;
}

.material-entry-toggle span {
  display: grid;
  gap: 2px;
}

.material-entry-content {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  white-space: pre-wrap;
}

.material-entry-evidence ul,
.material-entry-issues {
  margin: 4px 0 0;
  padding-left: 18px;
}

.material-entry-uncertainty,
.material-issue-notice {
  color: rgb(180 83 9);
}

.material-issue-error {
  color: rgb(185 28 28);
}

.material-entry-issues {
  font-size: 12px;
}

.material-target-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(110px, 0.35fr) auto;
  align-items: end;
  gap: 8px;
}

.material-filters input,
.material-filters select,
.material-target-fields input {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgb(203 213 225);
  border-radius: 6px;
  background: white;
  color: inherit;
  font-size: 12px;
}

.material-target-fields input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

:global([data-theme="dark"]) .material-entry-card {
  border-color: rgb(64 64 64);
}

:global([data-theme="dark"]) .material-entry-card,
:global([data-theme="dark"]) .material-filters input,
:global([data-theme="dark"]) .material-filters select,
:global([data-theme="dark"]) .material-target-fields input {
  background: rgb(38 38 38);
}

:global([data-theme="dark"]) .material-entry-selector-heading p,
:global([data-theme="dark"]) .material-entry-toggle small,
:global([data-theme="dark"]) .material-entry-evidence,
:global([data-theme="dark"]) .material-filter-summary,
:global([data-theme="dark"]) .material-filters label span,
:global([data-theme="dark"]) .material-target-fields label span {
  color: rgb(163 163 163);
}
</style>
