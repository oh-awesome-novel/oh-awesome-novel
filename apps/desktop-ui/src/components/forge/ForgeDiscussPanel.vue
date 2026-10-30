<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue';
import type { ForgeDiscussSelection, ForgeQuestion } from '@oh-awesome-novel/client';

const props = defineProps<{ questions: ForgeQuestion[]; reply: string; busy: boolean }>();
const emit = defineEmits<{
  answer: [input: {
    message: string;
    selection?: ForgeDiscussSelection;
    selections?: ForgeDiscussSelection[];
  }];
}>();

const message = shallowRef('');
const selected = reactive<Record<string, number[]>>({});
const delegated = reactive<Record<string, boolean>>({});

function isSelected(questionId: string, index: number): boolean {
  return (selected[questionId] ?? []).includes(index);
}

function toggleOption(question: ForgeQuestion, index: number): void {
  delete delegated[question.id];
  const current = selected[question.id] ?? [];
  if (question.kind === 'multi') {
    selected[question.id] = current.includes(index)
      ? current.filter(i => i !== index)
      : [...current, index];
  } else {
    selected[question.id] = current.includes(index) ? [] : [index];
  }
}

function toggleDelegate(questionId: string): void {
  delete selected[questionId];
  delegated[questionId] = !delegated[questionId];
}

const canSubmit = computed(() => {
  if (message.value.trim().length > 0) return true;
  if (Object.values(delegated).some(Boolean)) return true;
  return Object.values(selected).some(indices => indices.length > 0);
});

function send(): void {
  if (!canSubmit.value) return;

  const messageParts: string[] = [];
  const selectionsList: ForgeDiscussSelection[] = [];

  for (const q of props.questions) {
    if (delegated[q.id]) {
      messageParts.push(`${q.title}：你来定`);
    } else {
      const indices = selected[q.id] ?? [];
      if (indices.length > 0) {
        selectionsList.push({ questionId: q.id, optionIndices: [...indices] });
        const chosen = indices.map(i => q.options[i]).filter(Boolean);
        const labels = chosen.map(o => o.label).join('、');
        const samples = chosen.map(o => o.sample).filter(Boolean).join(' ');
        messageParts.push(`${q.title}：${labels}。${samples}`);
      }
    }
  }

  if (message.value.trim()) {
    messageParts.push(message.value.trim());
  }

  const fullMessage = messageParts.join('\n');
  emit('answer', {
    message: fullMessage,
    ...(selectionsList.length ? { selections: selectionsList } : {}),
    ...(selectionsList.length === 1 ? { selection: selectionsList[0] } : {}),
  });

  message.value = '';
  for (const k of Object.keys(selected)) delete selected[k];
  for (const k of Object.keys(delegated)) delete delegated[k];
}
</script>

<template>
  <section aria-label="聊想法" class="discuss-panel">
    <h3>聊想法</h3>
    <p class="reply">{{ reply }}</p>

    <fieldset v-for="question in questions" :key="question.id" :disabled="busy">
      <legend>{{ question.title }}</legend>
      <p class="question-why">{{ question.why }}</p>

      <button
        v-for="(option, optionIndex) in question.options"
        :key="option.label"
        type="button"
        class="option"
        :aria-pressed="isSelected(question.id, optionIndex)"
        @click="toggleOption(question, optionIndex)"
      >
        <strong>{{ option.label }}</strong>
        <span v-if="option.detail">{{ option.detail }}</span>
        <blockquote v-if="option.sample">{{ option.sample }}</blockquote>
      </button>

      <button
        type="button"
        class="delegate"
        :aria-pressed="Boolean(delegated[question.id])"
        @click="toggleDelegate(question.id)"
      >
        {{ delegated[question.id] ? '已指定：你来定' : '你来定' }}
      </button>
    </fieldset>

    <form @submit.prevent="send">
      <label for="forge-answer">补充你的想法（可选，可与上方选项合并发送）</label>
      <textarea
        id="forge-answer"
        v-model="message"
        :disabled="busy"
        rows="3"
        placeholder="写下补充设定或特定要求..."
      />
      <button type="submit" :disabled="busy || !canSubmit">
        发送本轮回答
      </button>
    </form>
  </section>
</template>

<style scoped>
.discuss-panel {
  min-width: 0;
}
.reply,
blockquote {
  white-space: pre-wrap;
}
.question-why {
  color: var(--muted-text-color, #666);
  margin-top: 2px;
  font-size: 0.9em;
}
fieldset {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 10px;
  margin-bottom: 12px;
  padding: 12px;
}
.option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px;
  margin: 8px 0;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.option:hover {
  border-color: var(--accent-color, #466b67);
}
.option[aria-pressed='true'] {
  outline: 2px solid var(--accent-color, #466b67);
  background: var(--accent-subtle, rgba(70, 107, 103, 0.08));
}
.delegate {
  padding: 6px 12px;
  margin: 4px 0;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.delegate[aria-pressed='true'] {
  outline: 2px solid var(--accent-color, #466b67);
  background: var(--accent-subtle, rgba(70, 107, 103, 0.08));
}
.option span {
  display: block;
}
blockquote {
  margin: 8px 0 0;
  opacity: 0.85;
}
textarea {
  box-sizing: border-box;
  width: 100%;
  margin: 8px 0;
}
label {
  display: block;
}
</style>
