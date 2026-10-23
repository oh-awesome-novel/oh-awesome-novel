<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { TextBeat } from '@oh-awesome-novel/core/text-speaker-parser';
const props = defineProps<{ beat?: TextBeat }>();
const emit = defineEmits<{ next: [] }>();
const count = ref(0);
const speakerColor = computed(() => { let hue = 0; for (const char of props.beat?.speaker ?? '') hue = (hue * 31 + char.charCodeAt(0)) % 360; return `hsl(${hue} 65% 76%)`; });
let timer: ReturnType<typeof setInterval> | undefined;
const plain = computed(() => (props.beat?.text ?? '').replace(/<[^>]*>/g, '').replace(/\*\*/g, ''));
const text = computed(() => Array.from(plain.value).slice(0, count.value).join(''));
function advance(): void { if (count.value < Array.from(plain.value).length) count.value = Array.from(plain.value).length; else emit('next'); }
watch(plain, (value, previous) => { clearInterval(timer); if (!previous || !value.startsWith(previous)) count.value = 0; if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { count.value = Array.from(value).length; return; } timer = setInterval(() => { if (count.value < Array.from(plain.value).length) count.value++; else clearInterval(timer); }, 24); }, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));
defineExpose({ advance });
</script>
<template>
  <button type="button" class="vn-textbox" aria-label="显示全文或下一句" @click="advance">
    <strong v-if="beat?.speaker" class="vn-name" :style="{ color: speakerColor }">{{ beat.speaker }}</strong>
    <span :class="{ narration: !beat?.isDialogue }">{{ text || '…' }}</span>
    <small>空格 / Enter · 显示全文 / 下一句</small>
  </button>
</template>
<style scoped>
.vn-textbox { display:grid; gap:12px; width:100%; min-height:160px; text-align:left; padding:24px; color:#f7f0df; border:1px solid #b59b6a; background:#131a25ed; border-radius:12px; font:inherit; line-height:1.9; }
.vn-name { color:#e9c983; } .narration { color:#ccd0d7; } small { opacity:.65; font-size:11px; }
</style>
