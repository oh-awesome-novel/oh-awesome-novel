<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef } from 'vue';
import { hashedSpeakerColor, plainStageText } from '../../composables/visualNovelText';
import type { StageBeat } from '../../composables/visualNovelText';

/** One committed turn in the log: the author's action, if any, then the turn's sentences. */
export interface VisualNovelLogGroup {
  id: string;
  createdAt: string;
  beats: Array<StageBeat & { color?: string }>;
}

const props = defineProps<{
  groups: VisualNovelLogGroup[];
  /** The sentence on stage, highlighted in the list. */
  currentId?: string;
  currentIndex: number;
  /** A past turn is being replayed. */
  replaying: boolean;
  hasMoreBefore?: boolean;
  loadingEarlier?: boolean;
}>();
const emit = defineEmits<{
  /** Replay this turn read-only from this sentence. */
  jump: [turnId: string, beatIndex: number];
  current: [];
  loadEarlier: [];
  close: [];
}>();

const list = useTemplateRef<HTMLElement>('list');
onMounted(async () => {
  await nextTick();
  // Open at the sentence on stage, which is near the end unless a past turn is replayed.
  const current = list.value?.querySelector<HTMLElement>('[aria-current="true"]');
  if (current) current.scrollIntoView?.({ block: 'center' });
  else if (list.value) list.value.scrollTop = list.value.scrollHeight;
});

function turnLabel(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function isCurrent(groupId: string, index: number): boolean {
  return groupId === props.currentId && index === props.currentIndex;
}
</script>
<template>
  <aside ref="list" class="vn-log" aria-label="历史文本">
    <header>
      <strong>回看</strong>
      <button v-if="hasMoreBefore" type="button" :disabled="loadingEarlier" @click="emit('loadEarlier')">加载更早回合</button>
      <button v-if="replaying" type="button" @click="emit('current')">回到当前回合</button>
      <button type="button" @click="emit('close')">关闭</button>
    </header>
    <p v-if="!groups.length" class="vn-log-empty">还没有可以回看的回合。</p>
    <section v-for="group in groups" :key="group.id" :aria-label="`回合 ${turnLabel(group.createdAt)}`">
      <h3>{{ turnLabel(group.createdAt) }}</h3>
      <button
        v-for="(beat, index) in group.beats"
        :key="index"
        type="button"
        class="vn-log-line"
        :class="{ player: beat.player, narration: !beat.isDialogue && !beat.player }"
        :aria-current="isCurrent(group.id, index) ? 'true' : undefined"
        title="从这一句只读回看"
        @click="emit('jump', group.id, index)"
      >
        <span v-if="beat.speaker" class="vn-log-name" :style="{ color: beat.color ?? hashedSpeakerColor(beat.speaker) }">{{ beat.speaker }}</span>
        <span class="vn-log-text">{{ plainStageText(beat.text) }}</span>
      </button>
    </section>
  </aside>
</template>
<style scoped>
.vn-log { position:absolute; inset:64px 24px 24px auto; z-index:3; width:min(520px, calc(100% - 48px)); overflow:auto; padding:0 16px 16px; border:1px solid #657181; border-radius:10px; background:#0d1520f5; color:#f5ebd8; }
.vn-log header { position:sticky; top:0; display:flex; align-items:center; gap:8px; padding:12px 0; background:#0d1520; }
.vn-log header strong { margin-right:auto; }
.vn-log header button { padding:6px 10px; color:inherit; border:1px solid #657181; border-radius:6px; background:#283447; cursor:pointer; }
.vn-log h3 { margin:14px 0 6px; color:#8f9bab; font-size:11px; font-weight:500; }
.vn-log-line { display:grid; grid-template-columns:5.5em minmax(0, 1fr); gap:10px; width:100%; padding:6px 8px; color:inherit; border:0; border-radius:6px; background:transparent; font:inherit; line-height:1.7; text-align:left; cursor:pointer; }
.vn-log-line:hover, .vn-log-line:focus-visible { background:#1e293b; }
.vn-log-line[aria-current='true'] { background:#283447; }
.vn-log-name { overflow:hidden; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
.vn-log-text { grid-column:2; white-space:pre-wrap; }
.vn-log-line.narration .vn-log-text { color:#ccd0d7; }
.vn-log-line.player .vn-log-text { color:#e9c983; }
.vn-log-empty { color:#8f9bab; }
</style>
