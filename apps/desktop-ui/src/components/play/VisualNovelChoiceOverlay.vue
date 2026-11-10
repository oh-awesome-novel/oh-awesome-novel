<script setup lang="ts">
import { nextTick, shallowRef } from 'vue';

const props = defineProps<{ choices: string[]; disabled: boolean }>();
const emit = defineEmits<{
  /** An option taken as written. */
  choose: [text: string];
  /** The author's own text; `basedOn` names the option it was edited from, if any. */
  custom: [text: string, basedOn?: string];
}>();

const editing = shallowRef<{ basedOn?: string }>();
const draft = shallowRef('');
const input = shallowRef<HTMLTextAreaElement>();

async function openEditor(basedOn?: string): Promise<void> {
  if (props.disabled) return;
  editing.value = basedOn === undefined ? {} : { basedOn };
  draft.value = basedOn ?? '';
  await nextTick();
  input.value?.focus();
}

function confirm(): void {
  const text = draft.value.trim();
  const basedOn = editing.value?.basedOn;
  if (props.disabled || !text) return;
  editing.value = undefined;
  if (text === basedOn) emit('choose', text);
  else emit('custom', text, basedOn);
}

function keydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); editing.value = undefined; }
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); confirm(); }
}
</script>
<template>
  <form v-if="editing" class="vn-choice-editor" aria-label="输入行动" @submit.prevent="confirm">
    <label class="vn-choice-label" for="vn-choice-input">{{ editing.basedOn === undefined ? '写下你的行动' : '修改这条行动' }}</label>
    <textarea id="vn-choice-input" ref="input" v-model="draft" rows="3" :disabled="disabled" @keydown="keydown"></textarea>
    <div>
      <button type="button" @click="editing = undefined">取消</button>
      <button type="submit" :disabled="disabled || !draft.trim()">确定</button>
    </div>
  </form>
  <div v-else class="vn-choices" aria-label="行动选项">
    <div v-for="(choice, index) in choices.slice(0, 9)" :key="`${index}-${choice}`" class="vn-choice">
      <button class="vn-choice-pick" type="button" :disabled="disabled" @click="emit('choose', choice)">{{ index + 1 }} · {{ choice }}</button>
      <button class="vn-choice-edit" type="button" :disabled="disabled" :aria-label="`修改行动选项 ${index + 1}`" @click="openEditor(choice)">改一改</button>
    </div>
    <button v-if="choices.length || !disabled" class="vn-choice-own" type="button" :disabled="disabled" @click="openEditor()">自己写</button>
  </div>
</template>
<style scoped>
.vn-choices, .vn-choice-editor { display:grid; gap:10px; width:100%; max-width:560px; margin:24px auto; }
.vn-choice { display:flex; gap:8px; }
.vn-choice-pick { flex:1 1 auto; text-align:left; }
.vn-choice-edit { flex:0 0 auto; }
.vn-choices button, .vn-choice-editor button { padding:12px 20px; background:#1e293bee; color:#f5e7c6; border:1px solid #8d7c57; border-radius:8px; }
.vn-choices button:disabled, .vn-choice-editor button:disabled { opacity:.5; }
.vn-choice-own { text-align:center; }
.vn-choice-label { font-size:13px; }
.vn-choice-editor textarea { padding:12px; background:#111b28ee; color:#f5e7c6; border:1px solid #8d7c57; border-radius:8px; font:inherit; resize:vertical; }
.vn-choice-editor div { display:flex; justify-content:flex-end; gap:8px; }
</style>
