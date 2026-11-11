<script setup lang="ts">
import { shallowRef } from 'vue';

import type { PlayCanonBeatCandidate } from '../../../composables/useWorkspaceApi';
import {
  MAX_GUIDED_CANON_BEATS,
  type PlayGuidedCanonBeatDraft,
  type PlayGuidedCanonCandidates,
  type PlayGuidedSourceOption,
} from '../../../composables/usePlayGuidedStart';

defineProps<{
  timelineSources: readonly PlayGuidedSourceOption[];
  beats: readonly PlayGuidedCanonBeatDraft[];
  candidates: Readonly<Record<string, Readonly<PlayGuidedCanonCandidates>>>;
  protagonistKnowsCanon: boolean;
  limitReached: boolean;
  disabled: boolean;
  isSelected: (sourceId: string, quote: string) => boolean;
}>();

const emit = defineEmits<{
  load: [sourceId: string];
  toggle: [sourceId: string, candidate: PlayCanonBeatCandidate, selected: boolean];
  addManual: [label: string, expectedWhen: string];
  remove: [key: string];
  setKnows: [value: boolean];
}>();

const manualLabel = shallowRef('');
const manualWhen = shallowRef('');

function addManual(): void {
  if (!manualLabel.value.trim()) return;
  emit('addManual', manualLabel.value, manualWhen.value);
  manualLabel.value = '';
  manualWhen.value = '';
}
</script>

<template>
  <section class="guided-canon-beats" aria-labelledby="guided-canon-heading">
    <header>
      <h3 id="guided-canon-heading">原作节点 <small>可选</small></h3>
      <p>
        勾选入场点之后原作里会发生的事件。推演会记录它们是照常发生、被改写、被阻止还是不再适用。
        节点只属于这次推演，不会修改时间线文件，也不会自己发生。
      </p>
      <span>已选 {{ beats.length }} / {{ MAX_GUIDED_CANON_BEATS }}</span>
    </header>

    <p v-if="timelineSources.length === 0" class="canon-empty">
      没有选择时间线来源。可以回到“来源”勾选 timeline/ 下的文件，或者在下面手写节点。
    </p>

    <details v-for="source in timelineSources" :key="source.sourceId" class="canon-source">
      <summary @click="candidates[source.sourceId] || emit('load', source.sourceId)">
        从 {{ source.path }} 勾选
      </summary>
      <p v-if="candidates[source.sourceId]?.loading" role="status">正在读取…</p>
      <p v-else-if="candidates[source.sourceId]?.error" role="alert">
        {{ candidates[source.sourceId]?.error }}
        <button type="button" :disabled="disabled" @click="emit('load', source.sourceId)">重试</button>
      </p>
      <p v-else-if="candidates[source.sourceId] && candidates[source.sourceId]!.candidates.length === 0">
        这个文件里没有可勾选的条目。
      </p>
      <ul v-else>
        <li v-for="candidate in candidates[source.sourceId]?.candidates ?? []" :key="candidate.quote">
          <label class="canon-candidate">
            <input
              type="checkbox"
              name="guided-canon-candidate"
              :value="candidate.quote"
              :checked="isSelected(source.sourceId, candidate.quote)"
              :disabled="disabled || (limitReached && !isSelected(source.sourceId, candidate.quote))"
              @change="emit('toggle', source.sourceId, candidate, ($event.target as HTMLInputElement).checked)"
            >
            <span>{{ candidate.label }}</span>
            <small v-if="candidate.expectedWhen">{{ candidate.expectedWhen }}</small>
          </label>
        </li>
      </ul>
    </details>

    <div class="canon-manual">
      <label>
        <span>手写节点</span>
        <input v-model="manualLabel" name="guided-canon-manual-label" type="text" maxlength="200" placeholder="原作里之后会发生的一件事" :disabled="disabled || limitReached" @keydown.enter.prevent="addManual">
      </label>
      <label>
        <span>大致时间（可选）</span>
        <input v-model="manualWhen" name="guided-canon-manual-when" type="text" maxlength="120" :disabled="disabled || limitReached" @keydown.enter.prevent="addManual">
      </label>
      <button type="button" class="canon-manual-add" :disabled="disabled || limitReached || !manualLabel.trim()" @click="addManual">
        添加手写节点
      </button>
    </div>
    <p v-if="limitReached" role="status">已达到 {{ MAX_GUIDED_CANON_BEATS }} 条上限。</p>

    <ul v-if="beats.length" class="canon-selected" aria-label="已选原作节点">
      <li v-for="beat in beats" :key="beat.key">
        <strong>{{ beat.label }}</strong>
        <small v-if="beat.expectedWhen">{{ beat.expectedWhen }}</small>
        <small>{{ beat.sourceId ? '来源引文' : '作者提供' }}</small>
        <button type="button" :disabled="disabled" :aria-label="`移除原作节点 ${beat.label}`" @click="emit('remove', beat.key)">移除</button>
      </li>
    </ul>

    <fieldset v-if="beats.length" class="canon-knowledge">
      <legend>穿越者知道原作吗</legend>
      <label>
        <input type="radio" name="guided-canon-knows" :checked="protagonistKnowsCanon" :disabled="disabled" @change="emit('setKnows', true)">
        知道：参与者视角可以看到这些节点
      </label>
      <label>
        <input type="radio" name="guided-canon-knows" :checked="!protagonistKnowsCanon" :disabled="disabled" @change="emit('setKnows', false)">
        不知道：只有导演视角能看到
      </label>
    </fieldset>
  </section>
</template>

<style scoped>
.guided-canon-beats {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  font-size: 12px;
}

.guided-canon-beats header {
  display: grid;
  gap: 4px;
}

.guided-canon-beats h3,
.guided-canon-beats p,
.guided-canon-beats ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.guided-canon-beats h3 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.guided-canon-beats header p,
.guided-canon-beats header span,
.guided-canon-beats small,
.canon-empty {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.canon-source ul {
  display: grid;
  gap: 4px;
  max-height: 220px;
  margin-top: 6px;
  overflow: auto;
}

.canon-candidate,
.canon-selected li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.canon-manual {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
}

.canon-manual label {
  display: grid;
  gap: 4px;
}

.canon-selected {
  display: grid;
  gap: 4px;
}

.canon-knowledge {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
}

input[type='text'],
button {
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
  font: inherit;
}

input[type='text'] {
  padding: 5px 7px;
}

button {
  padding: 3px 8px;
}

@media (max-width: 680px) {
  .canon-manual {
    grid-template-columns: 1fr;
  }
}
</style>
