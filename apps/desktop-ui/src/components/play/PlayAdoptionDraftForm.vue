<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, useId, useTemplateRef, watch } from 'vue';

import {
  PLAY_ADOPTION_TARGET_LABELS,
  formFromPayload,
  payloadFromForm,
} from '../../composables/playAdoptionForm';
import type { PlayAdoptionForm, StateRow } from '../../composables/playAdoptionForm';
import type {
  PlayAdoptionPendingActionView,
  PlayAdoptionPreviewRequest,
  PlayAdoptionPreviewView,
  PlayAdoptionSeed,
} from '../../composables/usePlayAdoptionPreview';
import type { PlayAdoptionTarget } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  seed: Readonly<PlayAdoptionSeed>;
  preview?: Readonly<PlayAdoptionPreviewView>;
  pendingAction?: Readonly<PlayAdoptionPendingActionView>;
  previewing: boolean;
  confirming: boolean;
  disabled: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  preview: [request: PlayAdoptionPreviewRequest];
  confirm: [];
  review: [pendingActionId: string];
}>();

const TARGETS = (Object.keys(PLAY_ADOPTION_TARGET_LABELS) as PlayAdoptionTarget[])
  .map((value) => ({ value, label: PLAY_ADOPTION_TARGET_LABELS[value] }));

const TARGET_REASONS: Record<PlayAdoptionTarget, string> = {
  chapterDraft: '把这条推演结果写成可编辑的章节正文。',
  state: '把这条推演结果记为一个明确的状态值。',
  timeline: '把这条推演结果追加为一条时间线事件。',
  foreshadow: '把这条推演结果保存为一条进行中的伏笔或后续回收点。',
};

const formRegion = useTemplateRef<HTMLElement>('formRegion');
const target = shallowRef<PlayAdoptionTarget>('chapterDraft');
/** Payload the form edits on top of; hidden fields (ids, fingerprints) ride along unchanged. */
const basePayload = shallowRef<Record<string, unknown>>({});
const form = ref<PlayAdoptionForm>(formFromPayload('chapterDraft', {}));
const uid = useId();
const fieldId = (name: string) => `${uid}-adoption-${name}`;
const targetId = fieldId('target');

const sourceKindLabel = computed(() => {
  if (props.seed.kind === 'event') return '世界事件';
  if (props.seed.kind === 'observation') return '观察笔记';
  return '结果报告条目';
});
const selectedSuggestion = computed(() =>
  props.preview?.suggestions.find((suggestion) => suggestion.target === target.value),
);
const selectedBusinessTargetLabel = computed(() => {
  const selectedTarget = selectedSuggestion.value?.target;
  if (selectedTarget === 'chapterDraft') return '写入章节 Markdown';
  if (selectedTarget === 'state') return '写入状态 YAML';
  if (selectedTarget === 'timeline') return '追加到时间线 YAML';
  if (selectedTarget === 'foreshadow') return '追加到伏笔 YAML';
  return '';
});
const built = computed(() => payloadFromForm(form.value, basePayload.value));
const errors = computed(() => built.value.errors);
const payloadJson = computed(() => built.value.payload
  ? JSON.stringify(built.value.payload, null, 2)
  : '');
const previewMatchesEdits = computed(() => Boolean(
  props.preview &&
  built.value.payload &&
  props.preview.target === target.value &&
  stableStringify(props.preview.payload) === stableStringify(built.value.payload),
));
const busy = computed(() => props.previewing || props.confirming);
const locked = computed(() => props.disabled || busy.value || Boolean(props.pendingAction));
const canPreview = computed(() => Boolean(
  !props.disabled && !busy.value && built.value.payload,
));
const canConfirm = computed(() => Boolean(
  !props.disabled && !busy.value && previewMatchesEdits.value && !props.pendingAction,
));
const statusMessage = computed(() => {
  if (props.error) return props.error;
  if (props.previewing) return '正在生成改动预览。';
  if (props.confirming) return '正在创建待确认改动。';
  if (props.pendingAction) {
    return `已创建待确认改动 ${props.pendingAction.id}，正式文件仍未改变。`;
  }
  if (props.preview) {
    return previewMatchesEdits.value
      ? '预览是最新的。还没有创建待确认改动。'
      : '目标或内容已修改，请重新预览后再确认。';
  }
  return '正在读取建议内容。还没有创建待确认改动。';
});

watch(
  () => props.seed,
  async () => {
    target.value = 'chapterDraft';
    basePayload.value = {};
    form.value = formFromPayload('chapterDraft', {});
    await nextTick();
    formRegion.value?.focus();
  },
  { deep: true },
);

watch(
  () => props.preview?.id,
  () => {
    if (!props.preview) return;
    loadPayload(props.preview.target, props.preview.payload);
  },
  { immediate: true },
);

onMounted(() => {
  formRegion.value?.focus();
});

function loadPayload(nextTarget: PlayAdoptionTarget, payload: Readonly<Record<string, unknown>>): void {
  target.value = nextTarget;
  // Props are reactive proxies; a JSON copy is enough for JSON payloads.
  basePayload.value = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  form.value = formFromPayload(nextTarget, payload);
}

function selectTarget(): void {
  loadPayload(target.value, selectedSuggestion.value?.defaultPayload ?? {});
}

function addStateRow(): void {
  if (form.value.target !== 'state' || locked.value) return;
  form.value.rows.push({ key: '', value: '', json: false });
}

function removeStateRow(row: StateRow): void {
  if (form.value.target !== 'state' || locked.value) return;
  form.value.rows = form.value.rows.filter((item) => item !== row);
  if (!form.value.rows.length) form.value.rows.push({ key: '', value: '', json: false });
}

function requestPreview(): void {
  const payload = built.value.payload;
  if (!canPreview.value || !payload) return;
  emit('preview', { target: target.value, payload });
}

function close(): void {
  if (!busy.value) emit('close');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
</script>

<template>
  <section
    ref="formRegion"
    class="play-adoption-draft"
    tabindex="-1"
    aria-label="带回写作"
    :aria-busy="busy"
    @keydown.esc.stop="close"
  >
    <header class="play-adoption-draft-header">
      <div class="play-adoption-draft-heading">
        <span>{{ sourceKindLabel }}</span>
        <h3>带回写作</h3>
      </div>
      <button
        class="play-adoption-close"
        type="button"
        aria-label="关闭带回写作"
        :disabled="busy"
        @click="close"
      >×</button>
    </header>

    <div v-if="preview" class="play-adoption-source">
      <strong>{{ preview.summary }}</strong>
      <p>{{ preview.evidence }}</p>
    </div>
    <p v-else class="play-adoption-source-loading">
      正在从当前分支重新整理可用的依据。
    </p>

    <form class="play-adoption-editor" novalidate @submit.prevent="requestPreview">
      <label :for="targetId">
        <span>写到哪里</span>
        <select
          :id="targetId"
          v-model="target"
          :disabled="locked"
          @change="selectTarget"
        >
          <option v-for="option in TARGETS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <div v-if="selectedSuggestion" class="play-adoption-suggestion">
        <span>
          建议
          <template v-if="selectedSuggestion.recommended"> · 推荐</template>
        </span>
        <strong>{{ selectedBusinessTargetLabel }}</strong>
        <p>{{ TARGET_REASONS[selectedSuggestion.target] }}</p>
      </div>

      <template v-if="form.target === 'chapterDraft'">
        <div class="play-adoption-readonly">
          <span>目标章节</span>
          <strong>{{ form.chapterId || '—' }}</strong>
          <small v-if="errors.chapterId" class="play-adoption-validation" role="alert">{{ errors.chapterId }}</small>
        </div>
        <label :for="fieldId('title')">
          <span>标题（可选）</span>
          <input :id="fieldId('title')" v-model="form.title" type="text" :disabled="locked" :aria-invalid="Boolean(errors.title)" :aria-describedby="errors.title ? fieldId('title-error') : undefined" />
        </label>
        <p v-if="errors.title" :id="fieldId('title-error')" class="play-adoption-validation" role="alert">{{ errors.title }}</p>
        <label :for="fieldId('content')">
          <span>正文</span>
          <textarea :id="fieldId('content')" v-model="form.content" rows="9" :disabled="locked" :aria-invalid="Boolean(errors.content)" :aria-describedby="errors.content ? fieldId('content-error') : undefined"></textarea>
        </label>
        <p v-if="errors.content" :id="fieldId('content-error')" class="play-adoption-validation" role="alert">{{ errors.content }}</p>
        <label :for="fieldId('mode')">
          <span>写入方式</span>
          <select :id="fieldId('mode')" v-model="form.mode" :disabled="locked">
            <option value="replace">替换章节内容</option>
            <option value="create">新建章节</option>
            <option value="">默认</option>
          </select>
        </label>
      </template>

      <template v-else-if="form.target === 'state'">
        <label :for="fieldId('file')">
          <span>状态文件（state/ 下）</span>
          <input :id="fieldId('file')" v-model="form.file" type="text" :disabled="locked" :aria-invalid="Boolean(errors.file)" :aria-describedby="errors.file ? fieldId('file-error') : undefined" />
        </label>
        <p v-if="errors.file" :id="fieldId('file-error')" class="play-adoption-validation" role="alert">{{ errors.file }}</p>
        <label :for="fieldId('path')">
          <span>对象</span>
          <input :id="fieldId('path')" v-model="form.path" type="text" :disabled="locked" :aria-invalid="Boolean(errors.path)" :aria-describedby="errors.path ? fieldId('path-error') : undefined" />
        </label>
        <p v-if="errors.path" :id="fieldId('path-error')" class="play-adoption-validation" role="alert">{{ errors.path }}</p>
        <fieldset v-if="form.shape === 'rows'" class="play-adoption-rows">
          <legend>字段与新值</legend>
          <div v-for="(row, index) in form.rows" :key="index" class="play-adoption-row">
            <label :for="fieldId(`row-${index}-key`)">
              <span>字段</span>
              <input :id="fieldId(`row-${index}-key`)" v-model="row.key" type="text" :disabled="locked" :aria-invalid="Boolean(errors[`rows.${index}.key`])" />
            </label>
            <label :for="fieldId(`row-${index}-value`)">
              <span>{{ row.json ? '新值（JSON）' : '新值' }}</span>
              <input :id="fieldId(`row-${index}-value`)" v-model="row.value" type="text" :disabled="locked" :aria-invalid="Boolean(errors[`rows.${index}.value`])" />
            </label>
            <button type="button" class="ghost-button tight-button" :disabled="locked" :aria-label="`删除第 ${index + 1} 行`" @click="removeStateRow(row)">删除</button>
            <p v-if="errors[`rows.${index}.key`]" class="play-adoption-validation" role="alert">{{ errors[`rows.${index}.key`] }}</p>
            <p v-if="errors[`rows.${index}.value`]" class="play-adoption-validation" role="alert">{{ errors[`rows.${index}.value`] }}</p>
          </div>
          <p v-if="errors.rows" class="play-adoption-validation" role="alert">{{ errors.rows }}</p>
          <button type="button" class="ghost-button tight-button" :disabled="locked" @click="addStateRow">添加一行</button>
        </fieldset>
        <template v-else>
          <label :for="fieldId('scalar')">
            <span>{{ form.scalar.json ? '新值（JSON）' : '新值' }}</span>
            <input :id="fieldId('scalar')" v-model="form.scalar.value" type="text" :disabled="locked" :aria-invalid="Boolean(errors.scalar)" />
          </label>
          <p v-if="errors.scalar" class="play-adoption-validation" role="alert">{{ errors.scalar }}</p>
        </template>
      </template>

      <template v-else-if="form.target === 'timeline'">
        <label :for="fieldId('date')">
          <span>世界内时间</span>
          <input :id="fieldId('date')" v-model="form.date" type="text" placeholder="例如：七月十七日夜" :disabled="locked" />
        </label>
        <label :for="fieldId('summary')">
          <span>事件</span>
          <textarea :id="fieldId('summary')" v-model="form.summary" rows="4" :disabled="locked" :aria-invalid="Boolean(errors.summary)" :aria-describedby="errors.summary ? fieldId('summary-error') : undefined"></textarea>
        </label>
        <p v-if="errors.summary" :id="fieldId('summary-error')" class="play-adoption-validation" role="alert">{{ errors.summary }}</p>
        <label :for="fieldId('participants')">
          <span>参与者（用顿号或逗号分隔）</span>
          <input :id="fieldId('participants')" v-model="form.participants" type="text" :disabled="locked" />
        </label>
        <label :for="fieldId('location')">
          <span>地点</span>
          <input :id="fieldId('location')" v-model="form.location" type="text" :disabled="locked" />
        </label>
      </template>

      <template v-else>
        <label :for="fieldId('summary')">
          <span>伏笔描述</span>
          <textarea :id="fieldId('summary')" v-model="form.summary" rows="4" :disabled="locked" :aria-invalid="Boolean(errors.summary)" :aria-describedby="errors.summary ? fieldId('summary-error') : undefined"></textarea>
        </label>
        <p v-if="errors.summary" :id="fieldId('summary-error')" class="play-adoption-validation" role="alert">{{ errors.summary }}</p>
        <label :for="fieldId('first-chapter')">
          <span>埋设位置</span>
          <input :id="fieldId('first-chapter')" v-model="form.firstChapter" type="text" placeholder="例如：0001/0003 或某个场景" :disabled="locked" />
        </label>
        <label :for="fieldId('expected-resolution')">
          <span>预期回收条件</span>
          <input :id="fieldId('expected-resolution')" v-model="form.expectedResolution" type="text" :disabled="locked" />
        </label>
      </template>

      <details class="play-adoption-json">
        <summary>查看 JSON</summary>
        <pre v-if="payloadJson" aria-label="将提交的 JSON（只读）">{{ payloadJson }}</pre>
        <p v-else>表单还有需要修正的地方。</p>
      </details>

      <button
        class="ghost-button tight-button"
        type="submit"
        :disabled="!canPreview || Boolean(pendingAction)"
      >{{ previewing ? '正在生成预览…' : '预览改动' }}</button>
    </form>

    <section v-if="preview" class="play-adoption-preview" aria-label="改动预览">
      <div class="play-adoption-target-files">
        <span>目标文件</span>
        <ul v-if="preview.changes.length">
          <li v-for="change in preview.changes" :key="change.path">
            {{ change.operation }} · {{ change.path }}
          </li>
        </ul>
        <p v-else>没有返回目标文件。</p>
      </div>
      <div class="play-adoption-diff">
        <span>实际 diff</span>
        <pre aria-label="改动 diff 预览">{{ preview.diff }}</pre>
      </div>
      <p class="play-adoption-boundary">
        仅预览 · 还没有创建待确认改动 · 正式文件没有变化。
      </p>
      <button
        v-if="!pendingAction"
        class="primary-button tight-button"
        type="button"
        :disabled="!canConfirm"
        @click="emit('confirm')"
      >{{ confirming ? '正在创建…' : '确认并创建待确认改动' }}</button>
    </section>

    <section
      v-if="pendingAction"
      class="play-adoption-created"
      aria-label="已创建的待确认改动"
    >
      <div>
        <span>已创建待确认改动</span>
        <strong>{{ pendingAction.id }}</strong>
        <p>在审阅中接受之前，正式文件不会改变。</p>
      </div>
      <button
        class="primary-button tight-button"
        type="button"
        @click="emit('review', pendingAction.id)"
      >去审阅</button>
    </section>

    <p
      class="play-adoption-status"
      :class="{ 'play-adoption-status-error': Boolean(error) }"
      :role="error ? 'alert' : 'status'"
      aria-live="polite"
    >{{ statusMessage }}</p>
  </section>
</template>

<style scoped>
.play-adoption-draft,
.play-adoption-editor,
.play-adoption-source,
.play-adoption-preview,
.play-adoption-suggestion,
.play-adoption-target-files,
.play-adoption-diff,
.play-adoption-created > div {
  display: grid;
  gap: 7px;
}

.play-adoption-draft {
  padding: 10px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  outline: none;
}

.play-adoption-draft-header,
.play-adoption-created {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.play-adoption-draft-heading {
  display: grid;
  gap: 2px;
}

.play-adoption-draft-heading span,
.play-adoption-editor label > span,
.play-adoption-suggestion > span,
.play-adoption-target-files > span,
.play-adoption-diff > span,
.play-adoption-created span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
  font-weight: 700;
}

.play-adoption-draft-heading h3,
.play-adoption-source p,
.play-adoption-source-loading,
.play-adoption-suggestion p,
.play-adoption-target-files p,
.play-adoption-boundary,
.play-adoption-created p,
.play-adoption-status {
  margin: 0;
}

.play-adoption-draft-heading h3,
.play-adoption-source strong,
.play-adoption-suggestion strong,
.play-adoption-created strong {
  color: var(--play-ink, var(--editor-ink));
}

.play-adoption-draft-heading h3 {
  font-size: 12px;
}

.play-adoption-close {
  min-width: 28px;
  min-height: 28px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-muted, var(--editor-muted));
}

.play-adoption-source,
.play-adoption-source-loading,
.play-adoption-suggestion,
.play-adoption-preview,
.play-adoption-created,
.play-adoption-status {
  padding: 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
}

.play-adoption-source p,
.play-adoption-source-loading,
.play-adoption-suggestion p,
.play-adoption-target-files,
.play-adoption-boundary,
.play-adoption-created p,
.play-adoption-status {
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
  line-height: 1.5;
}

.play-adoption-editor label {
  display: grid;
  gap: 4px;
}

.play-adoption-editor select,
.play-adoption-editor input,
.play-adoption-editor textarea {
  min-width: 0;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-adoption-editor textarea,
.play-adoption-diff pre {
  font-family: var(--font-mono, monospace);
}

.play-adoption-validation,
.play-adoption-status-error {
  color: var(--play-danger, var(--editor-danger));
}

.play-adoption-readonly {
  display: grid;
  gap: 2px;
}

.play-adoption-readonly span,
.play-adoption-rows legend,
.play-adoption-json summary {
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
  font-weight: 700;
}

.play-adoption-rows {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 6px;
  border: 1px solid var(--play-line, var(--editor-hairline));
}

.play-adoption-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
  align-items: end;
  gap: 6px;
}

.play-adoption-row > p {
  grid-column: 1 / -1;
  margin: 0;
}

.play-adoption-json pre {
  max-height: 200px;
  margin: 4px 0 0;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  white-space: pre-wrap;
}

.play-adoption-json p {
  margin: 4px 0 0;
  font-size: 9px;
}

.play-adoption-validation {
  margin: 0;
  font-size: 10px;
}

.play-adoption-target-files ul {
  display: grid;
  gap: 3px;
  margin: 0;
  padding-left: 18px;
}

.play-adoption-diff pre {
  max-height: 280px;
  margin: 0;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
  font-size: 9px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.play-adoption-created {
  background: var(--play-canvas, var(--editor-canvas));
}

@media (max-width: 720px) {
  .play-adoption-created {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
