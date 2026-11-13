<script setup lang="ts">
import { useId } from 'vue';

import type { PlayGuidedSourceOption } from '../../../composables/usePlayGuidedStart';

const { sources, selectedSourceIds, error, disabled } = defineProps<{
  sources: readonly Readonly<PlayGuidedSourceOption>[];
  selectedSourceIds: readonly string[];
  error?: string;
  disabled: boolean;
  hasCrossover?: boolean;
  suggestionsLoading?: boolean;
  suggestionNotice?: string;
}>();

const emit = defineEmits<{
  toggle: [sourceId: string, selected: boolean];
  setWork: [sourceId: string, title: string];
  prefill: [];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-guided-sources`;

function toggle(sourceId: string, event: Event): void {
  emit('toggle', sourceId, (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <form class="guided-step" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>第 1 步</span>
      <h2 :id="`${prefix}-heading`">来源</h2>
      <p>从这个工作区选择真实文件，文件所在领域决定它在开局中的作用。</p>
    </header>

    <p v-if="error" :id="`${prefix}-error`" class="field-error" role="alert">{{ error }}</p>
    <button type="button" :disabled="disabled || suggestionsLoading || !selectedSourceIds.length" @click="emit('prefill')">{{ suggestionsLoading ? '正在读取作品归属…' : '预填作品归属' }}</button>
    <p v-if="suggestionNotice" role="status">{{ suggestionNotice }}</p>
    <datalist :id="`${prefix}-works`"><option v-for="title in [...new Set(sources.flatMap(source => source.originWork?.title ?? []))]" :key="title" :value="title"></option></datalist>

    <ul v-if="sources.length" class="source-tree" :aria-describedby="error ? `${prefix}-error` : undefined">
      <li v-for="source in sources" :key="source.sourceId">
        <label>
          <input
            type="checkbox"
            :name="`guided-source-${source.sourceId}`"
            :value="source.sourceId"
            :checked="selectedSourceIds.includes(source.sourceId)"
            :disabled="disabled || (!selectedSourceIds.includes(source.sourceId) && selectedSourceIds.length >= 24)"
            @change="toggle(source.sourceId, $event)"
          >
          <span class="source-copy">
            <strong>{{ source.name }}</strong>
            <small>{{ source.path }}</small>
          </span>
          <span class="role-badge">{{ source.role }}</span>
        </label>
        <label v-if="selectedSourceIds.includes(source.sourceId)" class="work-label">
          <span>所属作品（可选）</span>
          <input type="text" :aria-label="`${source.name} 所属作品`" :list="`${prefix}-works`" :value="source.originWork?.title ?? ''" maxlength="120" :disabled="disabled" placeholder="填写或选择作品名" @change="emit('setWork', source.sourceId, ($event.target as HTMLInputElement).value)" />
        </label>
      </li>
    </ul>
    <p v-else class="empty-state">没有可选择的工作区文件。</p>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">取消</button>
      <button class="primary" type="submit" :disabled="disabled">下一步：{{ hasCrossover ? '融合契约' : '入场' }}</button>
    </footer>
  </form>
</template>

<style scoped>
.guided-step,
.guided-step > header,
.source-tree {
  display: grid;
  gap: 12px;
}

.guided-step > header {
  gap: 4px;
}

.guided-step h2,
.guided-step p {
  margin: 0;
}

.guided-step h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

.guided-step > header > span,
.guided-step > header p,
.source-copy small,
.empty-state {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.source-tree {
  max-height: min(44vh, 430px);
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.source-tree li {
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.source-tree label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  cursor: pointer;
}

.source-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.source-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-badge {
  padding: 2px 6px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
  text-transform: uppercase;
}
.source-tree .work-label { grid-template-columns: auto minmax(0, 1fr); padding-top: 0; font-size: 12px; }
.work-label input { min-width: 0; min-height: 36px; padding: 6px; border: 1px solid var(--play-line-strong, var(--editor-hairline)); background: var(--play-canvas, var(--editor-canvas)); color: var(--play-ink, var(--editor-ink)); font: inherit; }

.field-error {
  color: var(--play-danger, var(--editor-danger));
  font-size: 11px;
}

footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
}

button {
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}
</style>
