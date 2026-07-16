<script setup lang="ts">
import { computed, useId } from 'vue';

import { MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST } from '../../composables/useAgentConversationSessions';
import type { PlayWritingReferenceAttachment } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  attachments: readonly PlayWritingReferenceAttachment[];
  selectedAttachmentIds: readonly string[];
  loading: boolean;
  error: string;
  disabled: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  toggle: [attachmentId: string];
}>();

const helpId = `${useId()}-writing-reference-help`;
const statusId = `${useId()}-writing-reference-status`;
const activeAttachmentCount = computed(() =>
  props.attachments.filter((attachment) => attachment.status === 'active').length,
);
const selectionLimitReached = computed(() =>
  props.selectedAttachmentIds.length >= MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST,
);

function isDisabled(attachment: PlayWritingReferenceAttachment): boolean {
  return props.disabled ||
    attachment.status !== 'active' ||
    (
      selectionLimitReached.value &&
      !props.selectedAttachmentIds.includes(attachment.id)
    );
}
</script>

<template>
  <fieldset
    class="writing-reference-selector"
    :aria-busy="loading"
    :aria-describedby="`${helpId} ${statusId}`"
  >
    <legend>Play Writing References</legend>
    <div class="writing-reference-selector-header">
      <p :id="helpId">
        仅附到下一次请求；发送成功或切换对话后自动清空。最多选择
        {{ MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST }} 个。
      </p>
      <button
        class="ghost-button tight-button"
        type="button"
        :disabled="loading"
        aria-label="Refresh Play Writing References"
        @click="emit('refresh')"
      >刷新</button>
    </div>
    <p v-if="error" class="error-copy" role="alert">
      {{ error }}
    </p>
    <p v-else-if="loading" class="empty-copy" role="status" aria-live="polite">
      正在读取 Play Writing References…
    </p>
    <template v-else>
      <p
        :id="statusId"
        class="writing-reference-selection-status"
        role="status"
        aria-live="polite"
      >
        已选择 {{ selectedAttachmentIds.length }} /
        {{ MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST }} 个
        <template v-if="selectionLimitReached">；已达到本次请求上限。</template>
      </p>
      <div v-if="attachments.length > 0" class="writing-reference-options">
        <label
          v-for="attachment in attachments"
          :key="attachment.id"
          class="writing-reference-option"
          :class="{ 'writing-reference-option-disabled': attachment.status !== 'active' }"
        >
          <input
            type="checkbox"
            :checked="selectedAttachmentIds.includes(attachment.id)"
            :disabled="isDisabled(attachment)"
            :aria-label="`Use Writing Reference ${attachment.id} (${attachment.status})`"
            @change="emit('toggle', attachment.id)"
          >
          <span>
            <strong>{{ attachment.id }}</strong>
            <small>{{ attachment.sessionId }} · {{ attachment.status }}</small>
          </span>
        </label>
      </div>
      <p v-else class="empty-copy">
        {{ activeAttachmentCount === 0
          ? '尚无可用附件；请先在 Play Outcome 中明确选择条目。'
          : '没有可显示的 Writing Reference。' }}
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.writing-reference-selector {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--editor-hairline);
  background: var(--editor-surface);
}

.writing-reference-selector legend {
  padding: 0 4px;
  color: var(--editor-ink);
  font-size: 12px;
  font-weight: 700;
}

.writing-reference-selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.writing-reference-selector-header p {
  margin: 0;
  color: var(--editor-muted);
  font-size: 11px;
}

.writing-reference-options {
  display: grid;
  gap: 5px;
  max-height: 132px;
  overflow: auto;
}

.writing-reference-selection-status {
  margin: 0;
  color: var(--editor-muted);
  font-size: 10px;
}

.writing-reference-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 7px;
  padding: 7px;
  border: 1px solid var(--editor-hairline);
  background: var(--editor-canvas);
  cursor: pointer;
}

.writing-reference-option > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.writing-reference-option strong,
.writing-reference-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.writing-reference-option strong {
  color: var(--editor-ink);
  font-size: 11px;
}

.writing-reference-option small {
  color: var(--editor-muted);
  font-size: 10px;
}

.writing-reference-option-disabled {
  cursor: not-allowed;
  opacity: .62;
}
</style>
