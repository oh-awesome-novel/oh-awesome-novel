<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { createStageSnapshot, type StageSnapshot } from '@oh-awesome-novel/core/text-speaker-parser';
import type { PlayTranscriptTurn } from '../../composables/useWorkspaceApi';
import VisualNovelTextBox from './VisualNovelTextBox.vue';
import VisualNovelChoiceOverlay from './VisualNovelChoiceOverlay.vue';
const props = defineProps<{ sessionId: string; scene: string; turns: PlayTranscriptTurn[]; choices: string[]; draft?: string; disabled: boolean; hasMoreBefore?: boolean; loadingEarlier?: boolean }>();
const emit = defineEmits<{ choose: [text: string]; close: []; loadEarlier: [] }>();
const stage = ref<HTMLElement>();
onMounted(() => stage.value?.focus());
const beatIndex = ref(0);
const logOpen = ref(false);
const historicalId = ref<string>();
const textbox = ref<InstanceType<typeof VisualNovelTextBox>>();
const narratives = computed(() => props.turns.filter(turn => turn.speaker !== 'user'));
const selected = computed(() => historicalId.value ? narratives.value.find(turn => turn.id === historicalId.value) : narratives.value.at(-1));
const snapshot = computed<StageSnapshot>(() => {
  if (!historicalId.value && props.draft) {
    const committed = selected.value?.stageSnapshot;
    return { ...createStageSnapshot(committed?.sceneId ?? props.scene, props.draft), ...(committed?.backgroundDataUrl ? { backgroundDataUrl: committed.backgroundDataUrl } : {}) };
  }
  return selected.value?.stageSnapshot ?? createStageSnapshot(props.scene, selected.value?.content ?? props.scene);
});
const beat = computed(() => snapshot.value.beats[beatIndex.value]);
const isLast = computed(() => beatIndex.value >= snapshot.value.beats.length - 1);
const choices = computed(() => props.choices.length ? props.choices : (selected.value?.content.match(/^[1-9](?:️⃣|[.、)])\s*(.+)$/gm) ?? []).map(line => line.replace(/^[1-9](?:️⃣|[.、)])\s*/, '')));
const atmosphere = computed(() => /深夜|夜晚|午夜/.test(snapshot.value.sceneId) ? 'night' : /黄昏|日落|夕阳/.test(snapshot.value.sceneId) ? 'sunset' : 'day');
watch(() => props.sessionId, () => { historicalId.value = undefined; logOpen.value = false; beatIndex.value = 0; });
watch(() => Boolean(props.draft), (drafting) => { if (drafting) beatIndex.value = 0; });
watch(() => selected.value?.id, () => { beatIndex.value = 0; });
watch(() => props.turns, () => { if (historicalId.value && !narratives.value.some(turn => turn.id === historicalId.value)) historicalId.value = undefined; });
function choose(text: string): void { if (!props.disabled && !props.draft && !historicalId.value) emit('choose', text); }
function keydown(event: KeyboardEvent): void {
  if (event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return;
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); textbox.value?.advance(); }
  if (/^[1-9]$/.test(event.key) && isLast.value) { const choice = choices.value[Number(event.key) - 1]; if (choice) { event.preventDefault(); choose(choice); } }
}
</script>
<template>
  <section ref="stage" class="vn-stage" :class="atmosphere" aria-label="视觉小说演出" tabindex="0" @keydown="keydown">
    <img v-if="snapshot.backgroundDataUrl" class="vn-background" :src="snapshot.backgroundDataUrl" alt="" aria-hidden="true" />
    <header><strong>{{ snapshot.sceneId }}</strong><div><button type="button" @click="logOpen = !logOpen">Log · 历史</button><button type="button" @click="emit('close')">返回推演工作台</button></div></header>
    <p v-if="draft && !historicalId" role="status">正在演出草稿 · 尚未保存</p>
    <div class="vn-cast" aria-label="在场角色"><span v-for="character in snapshot.activeCharacters" :key="character.characterId" :class="[character.position, { speaking: beat?.speaker === character.characterId }]"><img v-if="character.portraitDataUrl" :src="character.portraitDataUrl" :alt="character.characterId" />{{ character.characterId }}</span></div>
    <VisualNovelChoiceOverlay v-if="isLast && !historicalId && !draft" :choices="choices" :disabled="disabled" @choose="choose" />
    <VisualNovelTextBox ref="textbox" :beat="beat" @next="beatIndex = Math.min(beatIndex + 1, snapshot.beats.length - 1)" />
    <aside v-if="logOpen" class="vn-log" aria-label="历史文本"><button v-if="hasMoreBefore" type="button" :disabled="loadingEarlier" @click="emit('loadEarlier')">加载更早回合</button><button type="button" @click="historicalId = undefined; beatIndex = 0">回到当前回合</button><article v-for="turn in narratives" :key="turn.id"><button type="button" @click="historicalId = turn.id; beatIndex = 0">回看 {{ turn.createdAt }}</button><p>{{ turn.content }}</p></article></aside>
  </section>
</template>
<style scoped>
.vn-stage { position:relative; display:flex; flex-direction:column; height:clamp(360px, calc(100dvh - 260px), 760px); min-height:360px; box-sizing:border-box; padding:24px; background:linear-gradient(150deg,#273b48,#152026); color:#f5ebd8; border-radius:12px; overflow:hidden; }.vn-background { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.55; pointer-events:none; }.vn-stage > :not(.vn-background) { position:relative; z-index:1; }.vn-stage.sunset { background:linear-gradient(150deg,#744b50,#262437); }.vn-stage.night { background:linear-gradient(150deg,#171a34,#080e15); }header { display:flex; justify-content:space-between; gap:20px; }header strong { max-width:65%; white-space:pre-wrap; }button { cursor:pointer; }header button,.vn-log button { color:inherit; background:#283447; border:1px solid #657181; padding:8px; border-radius:6px; }.vn-cast { display:flex; justify-content:center; align-items:end; gap:24px; flex:1; padding:24px; }.vn-cast span { opacity:.5; border:1px solid #8993a4; border-radius:50% 50% 8px 8px; padding:64px 20px 20px; }.vn-cast img { display:block; max-height:220px; max-width:150px; object-fit:contain; }.vn-cast span:has(img) { padding:0; border:0; }.vn-cast .speaking { opacity:1; border-color:#e9c983; }.left { order:0; }.center { order:1; }.right { order:2; }.vn-log { max-height:320px; overflow:auto; background:#111b28; padding:16px; }.vn-log p { white-space:pre-wrap; }
</style>
