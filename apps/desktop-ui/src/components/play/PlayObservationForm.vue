<script setup lang="ts">
import { nextTick, useId, useTemplateRef } from 'vue';

const props = defineProps<{
  open: boolean;
  sources: readonly { id: string; label: string }[];
  busy: boolean;
  disabled: boolean;
  canSave: boolean;
  error: string;
  notice: string;
}>();
const summary = defineModel<string>('summary', { required: true });
const evidence = defineModel<string>('evidence', { required: true });
const sourceTurnId = defineModel<string>('sourceTurnId', { required: true });
const emit = defineEmits<{ start: []; cancel: []; save: []; refresh: [] }>();
const prefix = `${useId()}-observation`;
const summaryInput = useTemplateRef<HTMLInputElement>('summaryInput');
const addButton = useTemplateRef<HTMLButtonElement>('addButton');

async function start() {
  emit('start');
  await nextTick();
  summaryInput.value?.focus();
}
async function cancel() {
  if (props.busy) return;
  emit('cancel');
  await nextTick();
  addButton.value?.focus();
}
</script>

<template>
  <div class="play-observation-entry">
    <button v-if="!open" ref="addButton" type="button" :disabled="disabled || !sources.length" @click="start">记一条观察笔记</button>
    <p v-if="!sources.length" class="play-observation-help">需要一条已提交、带来源编号的消息。请先继续推演或载入更早的记录，再记观察笔记。</p>
    <form v-if="open" class="play-observation-form" aria-label="记一条观察笔记" :aria-busy="busy" @submit.prevent="emit('save')">
      <p class="play-observation-help">从一条可见消息记下你的观察。观察笔记对参与者可见、不属于正式文件，保存它不会改动小说文件。</p>
      <label :for="`${prefix}-source`">来源消息</label>
      <select :id="`${prefix}-source`" v-model="sourceTurnId" name="observation-source" :disabled="disabled" required>
        <option value="" disabled>选择一条已提交的消息</option>
        <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.label }}</option>
      </select>
      <label :for="`${prefix}-summary`">观察摘要</label>
      <input :id="`${prefix}-summary`" ref="summaryInput" v-model="summary" name="observation-summary" :disabled="disabled" required />
      <label :for="`${prefix}-evidence`">来自这条消息的依据</label>
      <textarea :id="`${prefix}-evidence`" v-model="evidence" name="observation-evidence" :disabled="disabled" rows="3" required />
      <div class="play-observation-actions">
        <button type="button" :disabled="busy" @click="cancel">取消</button>
        <button type="submit" :disabled="!canSave">{{ busy ? '正在保存…' : '保存观察笔记' }}</button>
      </div>
    </form>
    <div v-if="error" class="play-observation-error" role="alert">
      <p>{{ error }}</p>
      <p v-if="open">你的输入已保留。请刷新会话、确认来源后再保存。</p>
      <p v-else>请刷新会话以载入已保存的观察笔记，不要重复提交。</p>
      <button type="button" :disabled="disabled" @click="emit('refresh')">刷新来源消息</button>
    </div>
    <p v-if="notice" class="play-observation-help" role="status">{{ notice }}</p>
  </div>
</template>

<style scoped>
.play-observation-entry, .play-observation-form { display: grid; gap: 8px; }
.play-observation-form { padding: 12px 0; }
.play-observation-help, .play-observation-error p { margin: 0; line-height: 1.5; font-size: 12px; }
.play-observation-help { color: var(--play-muted, var(--editor-muted)); }
.play-observation-error { color: var(--play-danger, var(--editor-danger)); }
.play-observation-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.play-observation-entry :where(input, select, textarea, button) { min-height: 44px; max-width: 100%; min-width: 0; }
.play-observation-entry :where(input, select, textarea) { width: 100%; box-sizing: border-box; }
.play-observation-entry :where(input, select, textarea, button):focus-visible { outline: 2px solid var(--play-focus, var(--editor-focus)); outline-offset: 2px; }
</style>
