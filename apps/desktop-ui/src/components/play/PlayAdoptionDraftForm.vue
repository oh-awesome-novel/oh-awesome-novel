<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useId, useTemplateRef, watch } from 'vue';

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

const TARGETS: Array<{ value: PlayAdoptionTarget; label: string }> = [
  { value: 'chapterDraft', label: 'Chapter draft' },
  { value: 'state', label: 'State' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'foreshadow', label: 'Foreshadow' },
];

const formRegion = useTemplateRef<HTMLElement>('formRegion');
const target = shallowRef<PlayAdoptionTarget>('chapterDraft');
const payloadText = shallowRef('{}');
const targetId = `${useId()}-adoption-target`;
const payloadId = `${useId()}-adoption-payload`;

const sourceKindLabel = computed(() => {
  if (props.seed.kind === 'event') return 'World event';
  if (props.seed.kind === 'observation') return 'Observation';
  return 'Outcome item';
});
const selectedSuggestion = computed(() =>
  props.preview?.suggestions.find((suggestion) => suggestion.target === target.value),
);
const parsedPayload = computed<{
  value?: Record<string, unknown>;
  error?: string;
}>(() => {
  try {
    const value: unknown = JSON.parse(payloadText.value);
    if (!isRecord(value)) {
      return { error: 'Payload must be a JSON object.' };
    }
    return { value: { ...value } };
  } catch {
    return { error: 'Payload must be valid JSON.' };
  }
});
const previewMatchesEdits = computed(() => Boolean(
  props.preview &&
  parsedPayload.value.value &&
  props.preview.target === target.value &&
  stableStringify(props.preview.payload) === stableStringify(parsedPayload.value.value),
));
const busy = computed(() => props.previewing || props.confirming);
const canPreview = computed(() => Boolean(
  !props.disabled && !busy.value && parsedPayload.value.value,
));
const canConfirm = computed(() => Boolean(
  !props.disabled && !busy.value && previewMatchesEdits.value && !props.pendingAction,
));
const statusMessage = computed(() => {
  if (props.error) return props.error;
  if (props.previewing) return 'Preparing a canonical diff preview.';
  if (props.confirming) return 'Creating a PendingAction for human review.';
  if (props.pendingAction) {
    return `PendingAction ${props.pendingAction.id} created. Canonical files remain unchanged.`;
  }
  if (props.preview) {
    return previewMatchesEdits.value
      ? 'Preview current. No PendingAction has been created.'
      : 'Target or payload changed. Generate a fresh preview before confirming.';
  }
  return 'Loading the server suggestion. No PendingAction has been created.';
});

watch(
  () => props.seed,
  async () => {
    target.value = 'chapterDraft';
    payloadText.value = '{}';
    await nextTick();
    formRegion.value?.focus();
  },
  { deep: true },
);

watch(
  () => props.preview?.id,
  () => {
    if (!props.preview) return;
    target.value = props.preview.target;
    payloadText.value = formatPayload(props.preview.payload);
  },
  { immediate: true },
);

onMounted(() => {
  formRegion.value?.focus();
});

function selectTarget(): void {
  const suggestion = selectedSuggestion.value;
  payloadText.value = formatPayload(suggestion?.defaultPayload ?? {});
}

function requestPreview(): void {
  const payload = parsedPayload.value.value;
  if (!canPreview.value || !payload) return;
  emit('preview', { target: target.value, payload });
}

function close(): void {
  if (!busy.value) emit('close');
}

function formatPayload(payload: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(payload, null, 2);
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
    aria-label="Play adoption preview"
    :aria-busy="busy"
    @keydown.esc.stop="close"
  >
    <header class="play-adoption-draft-header">
      <div class="play-adoption-draft-heading">
        <span>{{ sourceKindLabel }}</span>
        <h3>Bring to writing</h3>
      </div>
      <button
        class="play-adoption-close"
        type="button"
        aria-label="Close adoption preview"
        :disabled="busy"
        @click="close"
      >×</button>
    </header>

    <div v-if="preview" class="play-adoption-source">
      <strong>{{ preview.summary }}</strong>
      <p>{{ preview.evidence }}</p>
    </div>
    <p v-else class="play-adoption-source-loading">
      The server is rebuilding a safe evidence closure from the current selected branch.
    </p>

    <form class="play-adoption-editor" @submit.prevent="requestPreview">
      <label :for="targetId">
        <span>Canonical target</span>
        <select
          :id="targetId"
          v-model="target"
          :disabled="disabled || busy || Boolean(pendingAction)"
          @change="selectTarget"
        >
          <option v-for="option in TARGETS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <div v-if="selectedSuggestion" class="play-adoption-suggestion">
        <span>
          Server suggestion
          <template v-if="selectedSuggestion.recommended"> · recommended</template>
        </span>
        <strong>{{ selectedSuggestion.toolName }}</strong>
        <p>{{ selectedSuggestion.reason }}</p>
      </div>

      <label class="play-adoption-payload" :for="payloadId">
        <span>Editable JSON payload</span>
        <textarea
          :id="payloadId"
          v-model="payloadText"
          rows="9"
          spellcheck="false"
          :aria-invalid="Boolean(parsedPayload.error)"
          :aria-describedby="parsedPayload.error ? `${payloadId}-error` : undefined"
          :disabled="disabled || busy || Boolean(pendingAction)"
        ></textarea>
      </label>
      <p
        v-if="parsedPayload.error"
        :id="`${payloadId}-error`"
        class="play-adoption-validation"
        role="alert"
      >{{ parsedPayload.error }}</p>

      <button
        class="ghost-button tight-button"
        type="submit"
        :disabled="!canPreview || Boolean(pendingAction)"
      >{{ previewing ? 'Preparing preview…' : 'Preview canonical diff' }}</button>
    </form>

    <section v-if="preview" class="play-adoption-preview" aria-label="Canonical adoption preview">
      <div class="play-adoption-target-files">
        <span>Target files</span>
        <ul v-if="preview.touchedFiles.length">
          <li v-for="file in preview.touchedFiles" :key="file">{{ file }}</li>
        </ul>
        <p v-else>No canonical target file was returned.</p>
      </div>
      <div class="play-adoption-diff">
        <span>Actual diff</span>
        <pre aria-label="Canonical diff preview">{{ preview.diff }}</pre>
      </div>
      <p class="play-adoption-boundary">
        Preview only · no PendingAction has been created · canonical files are unchanged.
      </p>
      <button
        v-if="!pendingAction"
        class="primary-button tight-button"
        type="button"
        :disabled="!canConfirm"
        @click="emit('confirm')"
      >{{ confirming ? 'Creating PendingAction…' : 'Confirm and create PendingAction' }}</button>
    </section>

    <section
      v-if="pendingAction"
      class="play-adoption-created"
      aria-label="Created PendingAction"
    >
      <div>
        <span>PendingAction created</span>
        <strong>{{ pendingAction.id }}</strong>
        <p>Canonical files remain unchanged until Review accepts this action.</p>
      </div>
      <button
        class="primary-button tight-button"
        type="button"
        @click="emit('review', pendingAction.id)"
      >Review PendingAction</button>
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
