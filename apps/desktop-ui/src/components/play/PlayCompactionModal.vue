<script setup lang="ts">
import { shallowRef, watch, onBeforeUnmount } from 'vue';
import { oanClient } from '../../client';
import type { PlayCompactionPreview, PlaySession } from '@oh-awesome-novel/client';
const props = defineProps<{ session: PlaySession; disabled?: boolean }>();
const emit = defineEmits<{ continued: [session: PlaySession] }>();
const open = shallowRef(false);
const busy = shallowRef(false);
const error = shallowRef('');
const preview = shallowRef<PlayCompactionPreview>();
let requestVersion = 0;
onBeforeUnmount(() => { requestVersion++; });
watch(() => [props.session.id, props.session.revision], () => {
  requestVersion++; busy.value = false; error.value = ''; preview.value = undefined; open.value = false;
});
async function generate() {
  const version = ++requestVersion;
  open.value = true; busy.value = true; error.value = ''; preview.value = undefined;
  try {
    const result = await oanClient.compactPlaySession(props.session.id, props.session.revision);
    if (version === requestVersion) preview.value = result.preview;
  } catch (e) { if (version === requestVersion) error.value = e instanceof Error ? e.message : String(e); }
  finally { if (version === requestVersion) busy.value = false; }
}
async function continueStory() {
  if (!preview.value) return;
  const version = ++requestVersion;
  busy.value = true; error.value = '';
  try {
    const result = await oanClient.continueCompactedPlaySession(props.session.id, preview.value.sourceRevision);
    if (version === requestVersion) { open.value = false; emit('continued', result.session); }
  } catch (e) { if (version === requestVersion) error.value = e instanceof Error ? e.message : String(e); }
  finally { if (version === requestVersion) busy.value = false; }
}
function close() { requestVersion++; busy.value = false; open.value = false; }
</script>
<template>
  <button type="button" :disabled="disabled || busy || !session.selectedTurnIds.length" @click="generate">剧情归档</button>
  <dialog :open="open" aria-labelledby="compaction-title" @cancel.prevent="close" class="compaction-dialog">
    <h2 id="compaction-title">剧情归档 · 开启新阶段</h2>
    <p>保留当前分支的事实、资源与最近两轮原文。原会话仍可回看。</p>
    <p v-if="busy" role="status">正在核验与保存…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="preview">
      <h3>人物</h3><p v-for="character in preview.data.characters" :key="character.name">{{ character.name }}：{{ character.currentSituation }} · {{ character.relationshipChange }}</p>
      <h3>经过</h3><ol><li v-for="(fact, index) in preview.data.chronicle" :key="index">{{ typeof fact === 'string' ? fact : fact.fact }}<q v-if="typeof fact !== 'string' && fact.quote !== fact.fact" class="evidence">{{ fact.quote }}</q></li></ol>
      <h3>未完的线</h3><ul><li v-for="(fact, index) in preview.data.unresolvedThreads" :key="index">{{ fact }}</li></ul>
      <h3>当前场景</h3><p>{{ preview.data.currentScene.timeAndPlace }} · {{ preview.data.currentScene.immediateCrisis }}</p>
      <h3>文风</h3><p>{{ preview.data.voiceAndStyle.pov }} · {{ preview.data.voiceAndStyle.rhythm }} · {{ preview.data.voiceAndStyle.tonePoints.join('、') }}</p>
      <details><summary>资源与状态对账（逐项保留）</summary><pre>{{ JSON.stringify(preview.data.resourceState, null, 2) }}</pre></details>
    </template>
    <footer><button type="button" @click="close">关闭</button><button v-if="error" type="button" :disabled="busy" @click="generate">重新生成</button><button type="button" :disabled="busy || !preview || disabled" @click="continueStory">确认存档并开启新阶段</button></footer>
  </dialog>
</template>
<style scoped>
.compaction-dialog { position: fixed; inset: 8vh 10vw; z-index: 50; max-height: 80vh; overflow: auto; padding: 1.5rem; border: 1px solid var(--border-color, #888); border-radius: 12px; background: var(--surface, #fff); color: var(--text-color, #222); box-shadow: 0 12px 60px #0005; }
footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .75rem; margin-top: 1rem; } pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.evidence { display: block; margin-top: .25rem; font-size: .85em; opacity: .7; }
</style>
