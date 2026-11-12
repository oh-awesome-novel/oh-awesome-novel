<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { createStageSnapshot, type StageSnapshot, type SpeakerIdentity } from '@oh-awesome-novel/core/text-speaker-parser';
import type { PlayTranscriptTurn } from '../../composables/useWorkspaceApi';
import VisualNovelTextBox from './VisualNovelTextBox.vue';
import VisualNovelChoiceOverlay from './VisualNovelChoiceOverlay.vue';
const props = withDefaults(defineProps<{
  sessionId: string; scene: string; turns: PlayTranscriptTurn[]; choices: string[]; draft?: string; usageOperationId?: string; disabled: boolean; hasMoreBefore?: boolean; loadingEarlier?: boolean; roster?: unknown; portraits?: unknown; backgrounds?: unknown;
  /** Fill the container instead of using the embedded fixed height. */
  fill?: boolean;
  /** "改一改 / 自己写" emit `edit` for a host-owned action input instead of opening an editor here. */
  externalEditor?: boolean;
  closeLabel?: string;
}>(), { closeLabel: '返回推演工作台' });
const emit = defineEmits<{ choose: [text: string]; custom: [text: string, basedOn?: string]; edit: [basedOn?: string]; close: []; loadEarlier: [] }>();
const stage = ref<HTMLElement>();
onMounted(() => stage.value?.focus());
const beatIndex = ref(0);
const logOpen = ref(false);
const historicalId = ref<string>();
const textbox = ref<InstanceType<typeof VisualNovelTextBox>>();
const narratives = computed(() => props.turns.filter(turn => turn.speaker !== 'user'));
const selected = computed(() => historicalId.value ? narratives.value.find(turn => turn.id === historicalId.value) : narratives.value.at(-1));
const roster = computed<SpeakerIdentity[]>(() => {
  if (!Array.isArray(props.roster)) return [];
  return props.roster.filter((item): item is SpeakerIdentity => Boolean(item)
    && typeof item.id === 'string' && typeof item.name === 'string'
    && Array.isArray(item.aliases) && item.aliases.every((alias: unknown) => typeof alias === 'string'));
});
const IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
function images(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && entry[1].length <= 350000 && IMAGE.test(entry[1])));
}
// Launch-time snapshots of the session; turns reference them by id.
const portraits = computed(() => images(props.portraits));
const backgrounds = computed(() => images(props.backgrounds));
const snapshot = computed<StageSnapshot>(() => {
  if (!historicalId.value && props.draft) {
    const committed = selected.value?.stageSnapshot;
    const draft = createStageSnapshot(committed?.sceneId ?? props.scene, props.draft, roster.value, backgrounds.value);
    return {
      ...draft,
      // Characters already on the committed stage keep their frozen place and portrait while the draft streams.
      activeCharacters: draft.activeCharacters.map(character => ({ ...(committed?.activeCharacters.find(item => item.characterId === character.characterId) ?? character) })),
      // The draft changes prose and who is present; committed scenery stays frozen.
      ...(committed?.backgroundId ? { backgroundId: committed.backgroundId } : {}),
      ...(committed?.backgroundDataUrl ? { backgroundDataUrl: committed.backgroundDataUrl } : {}),
    };
  }
  return selected.value?.stageSnapshot ?? createStageSnapshot(props.scene, selected.value?.content ?? props.scene, roster.value, backgrounds.value);
});
const background = computed(() => snapshot.value.backgroundDataUrl ?? (snapshot.value.backgroundId ? backgrounds.value[snapshot.value.backgroundId] : undefined));
const cast = computed(() => snapshot.value.activeCharacters.map(character => ({
  ...character,
  label: character.name ?? roster.value.find(item => item.id === character.characterId)?.name ?? character.characterId,
  portrait: character.portraitDataUrl ?? portraits.value[character.characterId],
})));
const beat = computed(() => snapshot.value.beats[beatIndex.value]);
const isLast = computed(() => beatIndex.value >= snapshot.value.beats.length - 1);
const NUMBERED_CHOICE = /^[1-9](?:️⃣|[.、)])\s*/;
// Only a trailing numbered block is a menu; numbered lines inside the prose body stay narrative.
function trailingChoices(content = ''): string[] {
  const lines = content.trimEnd().split(/\r?\n/);
  const block: string[] = [];
  for (let index = lines.length - 1; index >= 0 && NUMBERED_CHOICE.test(lines[index]!.trim()); index--) block.unshift(lines[index]!.trim().replace(NUMBERED_CHOICE, ''));
  return block.filter(Boolean);
}
const choices = computed(() => props.choices.length ? props.choices : trailingChoices(selected.value?.content));
const atmosphere = computed(() => /深夜|夜晚|午夜/.test(snapshot.value.sceneId) ? 'night' : /黄昏|日落|夕阳/.test(snapshot.value.sceneId) ? 'sunset' : 'day');
watch(() => props.sessionId, () => { historicalId.value = undefined; logOpen.value = false; beatIndex.value = 0; });
watch(() => Boolean(props.draft), (drafting) => { if (drafting) beatIndex.value = 0; });
watch(() => selected.value?.id, () => { beatIndex.value = 0; });
watch(() => props.turns, () => { if (historicalId.value && !narratives.value.some(turn => turn.id === historicalId.value)) historicalId.value = undefined; });
function choose(text: string): void { if (!props.disabled && !props.draft && !historicalId.value) emit('choose', text); }
function custom(text: string, basedOn?: string): void { if (!props.disabled && !props.draft && !historicalId.value) emit('custom', text, basedOn); }
function edit(basedOn?: string): void { if (!props.disabled && !props.draft && !historicalId.value) emit('edit', basedOn); }
function keydown(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : undefined;
  if (target && (target.matches('input, textarea, select') || target.isContentEditable)) return;
  if (event.key === ' ' || event.key === 'Enter') {
    // Other buttons on the stage keep their own Space / Enter; only the stage and its text box advance.
    if (target && target !== stage.value && !target.matches('.vn-textbox')) return;
    event.preventDefault(); textbox.value?.advance();
  }
  if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && isLast.value) { const choice = choices.value[Number(event.key) - 1]; if (choice) { event.preventDefault(); choose(choice); } }
}
defineExpose({ focus: () => stage.value?.focus() });
</script>
<template>
  <section ref="stage" class="vn-stage" :class="[atmosphere, { fill }]" aria-label="视觉小说演出" tabindex="0" @keydown="keydown">
    <img v-if="background" class="vn-background" :src="background" alt="" aria-hidden="true" />
    <header><strong>{{ snapshot.sceneId }}</strong><div><button type="button" @click="logOpen = !logOpen">历史</button><button type="button" @click="emit('close')">{{ closeLabel }}</button></div></header>
    <p v-if="draft && !historicalId" role="status">正在演出草稿 · 尚未保存</p>
    <div class="vn-cast" aria-label="在场角色"><span v-for="character in cast" :key="character.characterId" :class="[character.position, { speaking: beat?.speaker === character.label || beat?.speaker === character.characterId }]"><img v-if="character.portrait" :src="character.portrait" :alt="character.label" />{{ character.label }}</span></div>
    <VisualNovelChoiceOverlay v-if="isLast && !historicalId && !draft" :choices="choices" :disabled="disabled" :external-editor="externalEditor" @choose="choose" @custom="custom" @edit="edit" />
    <VisualNovelTextBox ref="textbox" :beat="beat" :usage-operation-id="draft && !historicalId ? usageOperationId : undefined" :usage-message-id="!draft ? selected?.id : undefined" @next="beatIndex = Math.min(beatIndex + 1, snapshot.beats.length - 1)" />
    <slot name="controls" />
    <aside v-if="logOpen" class="vn-log" aria-label="历史文本"><button v-if="hasMoreBefore" type="button" :disabled="loadingEarlier" @click="emit('loadEarlier')">加载更早回合</button><button type="button" @click="historicalId = undefined; beatIndex = 0">回到当前回合</button><article v-for="turn in narratives" :key="turn.id"><button type="button" @click="historicalId = turn.id; beatIndex = 0">回看 {{ turn.createdAt }}</button><p>{{ turn.content }}</p></article></aside>
  </section>
</template>
<style scoped>
.vn-stage { position:relative; display:flex; flex-direction:column; height:clamp(360px, calc(100dvh - 260px), 760px); min-height:360px; box-sizing:border-box; padding:24px; background:linear-gradient(150deg,#273b48,#152026); color:#f5ebd8; border-radius:12px; overflow:hidden; }.vn-stage.fill { height:100%; min-height:0; border-radius:0; overflow-y:auto; }.vn-stage.fill .vn-cast { min-height:0; }.vn-background { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.55; pointer-events:none; }.vn-stage > :not(.vn-background) { position:relative; z-index:1; }.vn-stage.sunset { background:linear-gradient(150deg,#744b50,#262437); }.vn-stage.night { background:linear-gradient(150deg,#171a34,#080e15); }header { display:flex; justify-content:space-between; gap:20px; }header strong { max-width:65%; white-space:pre-wrap; }button { cursor:pointer; }header button,.vn-log button { color:inherit; background:#283447; border:1px solid #657181; padding:8px; border-radius:6px; }.vn-cast { display:flex; justify-content:center; align-items:end; gap:24px; flex:1; padding:24px; }.vn-cast span { opacity:.5; border:1px solid #8993a4; border-radius:50% 50% 8px 8px; padding:64px 20px 20px; }.vn-cast img { display:block; max-height:220px; max-width:150px; object-fit:contain; }.vn-cast span:has(img) { padding:0; border:0; }.vn-cast .speaking { opacity:1; border-color:#e9c983; }.left { order:0; }.center { order:1; }.right { order:2; }.vn-log { max-height:320px; overflow:auto; background:#111b28; padding:16px; }.vn-log p { white-space:pre-wrap; }
</style>
