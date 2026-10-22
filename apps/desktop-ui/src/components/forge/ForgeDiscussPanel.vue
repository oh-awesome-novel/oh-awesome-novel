<script setup lang="ts">
import { reactive, shallowRef } from 'vue';
import type { ForgeQuestion } from '@oh-awesome-novel/client';
defineProps<{ questions: ForgeQuestion[]; reply: string; busy: boolean }>();
const emit = defineEmits<{ answer: [message: string] }>();
const message = shallowRef('');
const choices = reactive<Record<string, string[]>>({});
function toggle(id: string, label: string) { const values = choices[id] ?? []; choices[id] = values.includes(label) ? values.filter(value => value !== label) : [...values, label]; }
function send() { if (message.value.trim()) { emit('answer', message.value.trim()); message.value = ''; } }
</script>
<template>
  <section aria-label="聊想法" class="discuss-panel">
    <h3>聊想法</h3><p class="reply">{{ reply }}</p>
    <fieldset v-for="question in questions" :key="question.id" :disabled="busy">
      <legend>{{ question.title }}</legend><p>{{ question.why }}</p>
      <button v-for="option in question.options" :key="option.label" type="button" class="option"
        :aria-pressed="question.kind === 'multi' ? (choices[question.id] ?? []).includes(option.label) : undefined"
        @click="question.kind === 'multi' ? toggle(question.id, option.label) : emit('answer', `${question.title}：${option.label}。${option.sample ?? ''}`)">
        <strong>{{ option.label }}</strong><span v-if="option.detail">{{ option.detail }}</span><blockquote v-if="option.sample">{{ option.sample }}</blockquote>
      </button>
      <button v-if="question.kind === 'multi'" type="button" :disabled="!(choices[question.id]?.length)" @click="emit('answer', `${question.title}：${choices[question.id]?.join('、')}`)">确认多选</button>
    </fieldset>
    <form @submit.prevent="send"><label for="forge-answer">补充你的想法</label><textarea id="forge-answer" v-model="message" :disabled="busy" rows="3" /><button type="submit" :disabled="busy || !message.trim()">发送</button></form>
  </section>
</template>
<style scoped>
.discuss-panel{min-width:0}.reply,blockquote{white-space:pre-wrap}fieldset{border:1px solid var(--border-color,#ddd);border-radius:10px;margin-bottom:12px;padding:12px}.option{display:block;width:100%;text-align:left;padding:12px;margin:8px 0;border:1px solid var(--border-color,#ddd);border-radius:8px;background:transparent;color:inherit}.option[aria-pressed=true]{outline:2px solid var(--accent-color,#466b67)}.option span{display:block}blockquote{margin:8px 0 0;opacity:.8}textarea{box-sizing:border-box;width:100%;margin:8px 0}label{display:block}
</style>
