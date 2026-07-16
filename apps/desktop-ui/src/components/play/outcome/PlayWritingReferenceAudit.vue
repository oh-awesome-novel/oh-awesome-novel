<script setup lang="ts">
import { useId } from 'vue';

import type { PlayWritingReferenceAttachment } from '../../../composables/useWorkspaceApi';

defineProps<{
  attachments: readonly PlayWritingReferenceAttachment[];
  loading: boolean;
  detachingAttachmentId: string;
}>();

const emit = defineEmits<{
  refresh: [];
  detach: [attachmentId: string];
}>();

const headingId = `${useId()}-writing-reference-audit`;
</script>

<template>
  <section class="play-outcome-attachments" :aria-labelledby="headingId">
    <header>
      <div>
        <h3 :id="headingId">Writing Reference audit</h3>
        <span>{{ attachments.length }}</span>
      </div>
      <button
        type="button"
        :disabled="loading"
        aria-label="Refresh Writing Reference attachments"
        @click="emit('refresh')"
      >↻</button>
    </header>
    <p v-if="loading" class="play-muted-copy" role="status" aria-live="polite">
      正在读取附件…
    </p>
    <ul v-else-if="attachments.length">
      <li v-for="attachment in attachments" :key="attachment.id">
        <span>
          <strong>{{ attachment.id }}</strong>
          <small>
            {{ attachment.selectedOutcomeItemRefs.length }} item(s) · {{ attachment.status }}
            <template v-if="attachment.detachedAt"> · {{ attachment.detachedAt }}</template>
          </small>
        </span>
        <button
          v-if="attachment.status === 'active'"
          class="ghost-button tight-button"
          type="button"
          :disabled="Boolean(detachingAttachmentId)"
          :aria-label="`Detach Writing Reference ${attachment.id}`"
          @click="emit('detach', attachment.id)"
        >{{ detachingAttachmentId === attachment.id ? 'Detaching…' : 'Detach' }}</button>
      </li>
    </ul>
    <p v-else class="play-muted-copy">暂无附件。Detach 只停用引用，不删除审计记录。</p>
  </section>
</template>

<style scoped>
.play-outcome-attachments {
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-outcome-attachments > header,
.play-outcome-attachments > header > div,
.play-outcome-attachments li {
  display: flex;
  align-items: center;
}

.play-outcome-attachments > header,
.play-outcome-attachments li {
  justify-content: space-between;
  gap: 8px;
}

.play-outcome-attachments > header > div {
  gap: 6px;
}

.play-outcome-attachments h3,
.play-outcome-attachments p,
.play-outcome-attachments ul {
  margin: 0;
}

.play-outcome-attachments h3,
.play-outcome-attachments strong {
  color: var(--play-ink, var(--editor-ink));
}

.play-outcome-attachments h3 {
  font-size: 11px;
}

.play-outcome-attachments > header span,
.play-outcome-attachments small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 9px;
}

.play-outcome-attachments > header button {
  min-height: 28px;
  padding: 0 7px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-muted, var(--editor-muted));
}

.play-outcome-attachments ul {
  display: grid;
  gap: 5px;
  padding: 0;
  list-style: none;
}

.play-outcome-attachments li {
  padding-top: 6px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-outcome-attachments li > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.play-outcome-attachments strong {
  font-size: 10px;
}
</style>
