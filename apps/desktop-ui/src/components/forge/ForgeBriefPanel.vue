<script setup lang="ts">
import type { ForgeBrief } from '@oh-awesome-novel/client';
const props = defineProps<{ brief: ForgeBrief; busy: boolean }>();
const emit = defineEmits<{ save: [brief: ForgeBrief] }>();
function edit(index: number, event: Event) { const value = (event.target as HTMLTextAreaElement).value; emit('save', { ...props.brief, items: props.brief.items.map((item, i) => i === index ? { ...item, value, by: 'user' } : item) }); }
function lock(index: number) { emit('save', { ...props.brief, items: props.brief.items.map((item, i) => i === index ? { ...item, locked: !item.locked } : item) }); }
</script>
<template>
  <section aria-label="实时设定草图"><h3>{{ brief.title || '设定草图' }}</h3>
    <label>就绪度 {{ brief.readiness }}% <progress :value="brief.readiness" max="100" /></label>
    <article v-for="(item, index) in brief.items" :key="item.key">
      <label :for="`forge-brief-${item.key}`">{{ item.label }} · {{ item.by === 'user' ? '你确认的' : 'AI 提议' }}</label>
      <textarea :id="`forge-brief-${item.key}`" :value="item.value" :disabled="busy" rows="3" @change="edit(index, $event)" />
      <button type="button" :disabled="busy" :aria-pressed="Boolean(item.locked)" @click="lock(index)">{{ item.locked ? '已锁定 · 解锁' : '锁定此项' }}</button>
    </article>
    <h4 v-if="brief.openPoints.length">尚待决定</h4><ul><li v-for="point in brief.openPoints" :key="point">{{ point }}</li></ul>
  </section>
</template>
<style scoped>
article{padding:12px 0;border-bottom:1px solid var(--border-color,#ddd)}label{display:block}textarea{box-sizing:border-box;width:100%;margin:8px 0}progress{width:100%}
</style>
