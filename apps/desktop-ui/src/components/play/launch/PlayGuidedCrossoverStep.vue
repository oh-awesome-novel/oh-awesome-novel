<script setup lang="ts">
import { useId } from 'vue';
import type { DeepReadonly } from 'vue';
import type { PlayCrossoverContract, PlayOriginWork } from '@oh-awesome-novel/client';
const props = defineProps<{
  works: DeepReadonly<PlayOriginWork[]>;
  draft: DeepReadonly<Omit<PlayCrossoverContract, 'works'>>;
  disabled: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  update: [patch: Partial<Omit<PlayCrossoverContract, 'works'>>];
  next: []; back: []; cancel: [];
}>();
const prefix = useId();
function rule(index: number, key: 'topic' | 'winner' | 'note', value: string): void {
  emit('update', { rulePrecedence: props.draft.rulePrecedence.map((item, i) => ({ ...item, ...(i === index ? { [key]: value } : {}) })) });
}
</script>

<template>
  <form class="crossover-step" aria-label="综漫融合契约" @submit.prevent="emit('next')">
    <h2>融合契约</h2>
    <p>本次开局：{{ works.map(work => work.title).join('、') }}。契约只用于这一局，先决定角色彼此知道多少，再说明规则冲突如何处理。</p>
    <label :for="`${prefix}-fusion`">融合方式</label>
    <select :id="`${prefix}-fusion`" :value="draft.fusion" :disabled="disabled" @change="emit('update', { fusion: ($event.target as HTMLSelectElement).value as PlayCrossoverContract['fusion'] })">
      <option value="merged">世界融合</option><option value="visitor">单向来客</option><option value="layered">并存叠层</option>
    </select>
    <label :for="`${prefix}-knowledge`">初始认知</label>
    <select :id="`${prefix}-knowledge`" :value="draft.knowledge" :disabled="disabled" @change="emit('update', { knowledge: ($event.target as HTMLSelectElement).value as PlayCrossoverContract['knowledge'] })">
      <option value="isolated">隔离：角色只知道自己作品的资料</option><option value="shared">互知：角色可以知道全部已选资料</option>
    </select>
    <p>隔离时，另一作品的信息需要在推演中明确获知。没有标注所属作品的角色不会自动得到任何作品资料。</p>
    <h3>规则裁定</h3>
    <fieldset v-for="(entry, index) in draft.rulePrecedence" :key="index" :disabled="disabled">
      <legend>裁定 {{ index + 1 }}</legend>
      <label :for="`${prefix}-topic-${index}`">议题</label>
      <input :id="`${prefix}-topic-${index}`" :value="entry.topic" maxlength="120" placeholder="例如：力量体系" @input="rule(index, 'topic', ($event.target as HTMLInputElement).value)" />
      <label :for="`${prefix}-winner-${index}`">采用哪部作品的规则</label>
      <select :id="`${prefix}-winner-${index}`" :value="entry.winner" @change="rule(index, 'winner', ($event.target as HTMLSelectElement).value)">
        <option v-for="work in works" :key="work.id" :value="work.id">{{ work.title }}</option>
      </select>
      <label :for="`${prefix}-note-${index}`">具体说明</label>
      <textarea :id="`${prefix}-note-${index}`" :value="entry.note" rows="2" maxlength="1000" @input="rule(index, 'note', ($event.target as HTMLTextAreaElement).value)"></textarea>
      <button type="button" @click="emit('update', { rulePrecedence: draft.rulePrecedence.filter((_, i) => i !== index).map(item => ({ ...item })) })">移除此裁定</button>
    </fieldset>
    <button type="button" :disabled="disabled || draft.rulePrecedence.length >= 24" @click="emit('update', { rulePrecedence: [...draft.rulePrecedence.map(item => ({ ...item })), { topic: '', winner: works[0]!.id, note: '' }] })">添加规则裁定</button>
    <p v-if="!draft.rulePrecedence.length">可以暂不填写。多部作品都提供世界规则时，确认页会提醒你尚未裁定。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <footer><button type="button" :disabled="disabled" @click="emit('back')">上一步：来源</button><button type="button" :disabled="disabled" @click="emit('cancel')">取消</button><button type="submit" :disabled="disabled">下一步：入场</button></footer>
  </form>
</template>

<style scoped>
.crossover-step, fieldset { display: grid; gap: 10px; min-width: 0; }
h2, h3, p { margin: 0; } p { color: var(--play-muted, var(--editor-muted)); line-height: 1.6; font-size: 13px; }
fieldset { border: 1px solid var(--play-line, var(--editor-hairline)); padding: 12px; }
input, textarea, select, button { min-width: 0; min-height: 36px; padding: 8px; font: inherit; border: 1px solid var(--play-line-strong, var(--editor-hairline)); background: var(--play-canvas, var(--editor-canvas)); color: var(--play-ink, var(--editor-ink)); }
footer { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
button { cursor: pointer; } button:disabled { opacity: .6; cursor: default; } .error { color: var(--play-danger, var(--editor-danger)); }
input:focus-visible, select:focus-visible, button:focus-visible, textarea:focus-visible { outline: 2px solid var(--play-focus, var(--editor-focus)); outline-offset: 2px; }
</style>
