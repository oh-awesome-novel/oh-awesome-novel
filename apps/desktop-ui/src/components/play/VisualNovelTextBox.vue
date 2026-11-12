<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { TextBeat } from '@oh-awesome-novel/core/text-speaker-parser';
import { hashedSpeakerColor, plainStageText, prefersReducedMotion } from '../../composables/visualNovelText';

const props = withDefaults(defineProps<{
  beat?: TextBeat;
  /**
   * Identity of the sentence on screen. A new key starts typing from the first character;
   * the same key with longer text (a streaming draft) keeps what is already shown.
   */
  beatKey?: string;
  /** Milliseconds per character; 0 shows the whole sentence at once. */
  charDelayMs?: number;
  /** Background opacity of the box, 0–1. */
  opacity?: number;
  /** Name plate colour; falls back to a colour derived from the speaker's name. */
  nameColor?: string;
  usageOperationId?: string;
  usageMessageId?: string;
}>(), { charDelayMs: 24, opacity: 0.93 });
const emit = defineEmits<{
  next: [];
  /** Whether the whole sentence is on screen. */
  revealed: [done: boolean];
}>();

const count = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
const plain = computed(() => plainStageText(props.beat?.text));
const length = computed(() => Array.from(plain.value).length);
const text = computed(() => Array.from(plain.value).slice(0, count.value).join(''));
const revealed = computed(() => count.value >= length.value);
const speakerColor = computed(() => props.nameColor ?? hashedSpeakerColor(props.beat?.speaker ?? ''));

function complete(): void {
  count.value = length.value;
}

/** First press shows the whole sentence, the next one moves on; nothing is swallowed in between. */
function advance(): void {
  if (!revealed.value) complete();
  else emit('next');
}

function type(): void {
  clearInterval(timer);
  if (props.charDelayMs <= 0 || prefersReducedMotion()) {
    complete();
    return;
  }
  timer = setInterval(() => {
    if (count.value < length.value) count.value++;
    else clearInterval(timer);
  }, props.charDelayMs);
}

watch([plain, () => props.beatKey] as const, ([value, key], previousValues) => {
  const previous = previousValues?.[0] ?? '';
  const sameSentence = key === undefined
    ? Boolean(previous) && value.startsWith(previous)
    : key === previousValues?.[1] && value.startsWith(previous);
  if (!sameSentence) count.value = 0;
  type();
}, { immediate: true });
watch(() => props.charDelayMs, type);
watch(revealed, done => emit('revealed', done), { immediate: true });
onBeforeUnmount(() => clearInterval(timer));
defineExpose({ advance, complete });
</script>
<template>
  <button
    type="button"
    class="vn-textbox"
    aria-label="显示全文或下一句"
    :style="{ background: `rgb(19 26 37 / ${opacity})` }"
    @click="advance"
  >
    <strong v-if="beat?.speaker" class="vn-name" :style="{ color: speakerColor }">{{ beat.speaker }}</strong>
    <span :class="{ narration: !beat?.isDialogue }" :data-usage-operation="text ? usageOperationId : undefined" :data-usage-message="text ? usageMessageId : undefined">{{ text || '…' }}</span>
    <small>空格 / 回车 / 滚轮 · 显示全文 / 下一句</small>
  </button>
</template>
<style scoped>
.vn-textbox { display:grid; gap:12px; width:100%; min-height:160px; text-align:left; padding:24px; color:#f7f0df; border:1px solid #b59b6a; border-radius:12px; font:inherit; line-height:1.9; }
.vn-name { color:#e9c983; } .narration { color:#ccd0d7; } small { opacity:.65; font-size:11px; }
</style>
