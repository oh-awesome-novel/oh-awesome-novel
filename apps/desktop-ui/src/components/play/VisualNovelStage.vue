<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createStageSnapshot, type StageSnapshot, type SpeakerIdentity } from '@oh-awesome-novel/core/text-speaker-parser';
import type { PlayTranscriptTurn } from '../../composables/useWorkspaceApi';
import { PLAY_STAGE_AUTO_MS_PER_CHAR, usePlayStageReadingPrefs } from '../../composables/usePlayStageReadingPrefs';
import { plainStageText, prefersReducedMotion } from '../../composables/visualNovelText';
import type { StageBeat } from '../../composables/visualNovelText';
import VisualNovelChoiceOverlay from './VisualNovelChoiceOverlay.vue';
import VisualNovelLog from './VisualNovelLog.vue';
import type { VisualNovelLogGroup } from './VisualNovelLog.vue';
import VisualNovelSettings from './VisualNovelSettings.vue';
import VisualNovelTextBox from './VisualNovelTextBox.vue';

const props = withDefaults(defineProps<{
  sessionId: string;
  scene: string;
  turns: PlayTranscriptTurn[];
  choices: string[];
  /** Unsaved text of the turn being generated. */
  draft?: string;
  /** The author's action for the turn being generated; shown before any draft text arrives. */
  draftAction?: string;
  usageOperationId?: string;
  disabled: boolean;
  hasMoreBefore?: boolean;
  loadingEarlier?: boolean;
  roster?: unknown;
  portraits?: unknown;
  backgrounds?: unknown;
  /** Fill the container instead of using the embedded fixed height. */
  fill?: boolean;
  /** "改一改 / 自己写" emit `edit` for a host-owned action input instead of opening an editor here. */
  externalEditor?: boolean;
  closeLabel?: string;
}>(), { closeLabel: '返回推演工作台' });
const emit = defineEmits<{ choose: [text: string]; custom: [text: string, basedOn?: string]; edit: [basedOn?: string]; close: []; loadEarlier: [] }>();

type RosterEntry = SpeakerIdentity & { isPlayer?: unknown; looks?: unknown };
/** A committed narrative turn with the author's action that led to it. */
interface StageTurn { turn: PlayTranscriptTurn; action?: string }

const stage = ref<HTMLElement>();
const textbox = ref<InstanceType<typeof VisualNovelTextBox>>();
const beatIndex = ref(0);
const historicalId = ref<string>();
const logOpen = ref(false);
const settingsOpen = ref(false);
const uiHidden = ref(false);
const auto = ref(false);
const fullscreen = ref(false);
const revealed = ref(false);
const reducedMotion = prefersReducedMotion();
const { prefs, update: updatePrefs } = usePlayStageReadingPrefs();

const roster = computed<RosterEntry[]>(() => {
  if (!Array.isArray(props.roster)) return [];
  return props.roster.filter((item): item is RosterEntry => Boolean(item)
    && typeof item.id === 'string' && typeof item.name === 'string'
    && Array.isArray(item.aliases) && item.aliases.every((alias: unknown) => typeof alias === 'string'));
});
const playerName = computed(() => roster.value.find(item => item.isPlayer === true)?.name ?? '你');
const NAME_COLOR = /^#[0-9a-fA-F]{6}$/;
/** The roster's own name plate colour, when it has one; otherwise the text box derives one. */
function nameColor(speaker: string): string | undefined {
  const looks = roster.value.find(item => item.name === speaker)?.looks;
  const color = looks && typeof looks === 'object' ? (looks as { nameColor?: unknown }).nameColor : undefined;
  return typeof color === 'string' && NAME_COLOR.test(color) ? color : undefined;
}

const IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
function images(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && entry[1].length <= 350000 && IMAGE.test(entry[1])));
}
// Launch-time snapshots of the session; turns reference them by id.
const portraits = computed(() => images(props.portraits));
const backgrounds = computed(() => images(props.backgrounds));

const stageTurns = computed<StageTurn[]>(() => props.turns.flatMap((turn, index) => {
  if (turn.speaker === 'user') return [];
  const before = props.turns[index - 1];
  return [{ turn, ...(before?.speaker === 'user' && before.content.trim() ? { action: before.content.trim() } : {}) }];
}));
const selectedTurn = computed(() => historicalId.value
  ? stageTurns.value.find(item => item.turn.id === historicalId.value)
  : stageTurns.value.at(-1));
const selected = computed(() => selectedTurn.value?.turn);
/** A turn is being generated and is on stage instead of the last committed one. */
const drafting = computed(() => !historicalId.value && Boolean(props.draft || props.draftAction));

function turnSnapshot(turn: PlayTranscriptTurn | undefined): StageSnapshot {
  return turn?.stageSnapshot ?? createStageSnapshot(props.scene, turn?.content ?? props.scene, roster.value, backgrounds.value);
}
function playerBeat(action: string | undefined): StageBeat[] {
  return action ? [{ speaker: playerName.value, text: action, isDialogue: false, player: true }] : [];
}
const snapshot = computed<StageSnapshot>(() => {
  if (drafting.value) {
    const committed = selected.value?.stageSnapshot;
    const draft = createStageSnapshot(committed?.sceneId ?? props.scene, props.draft ?? '', roster.value, backgrounds.value);
    return {
      ...draft,
      // Characters already on the committed stage keep their frozen place and portrait while the draft streams.
      activeCharacters: draft.activeCharacters.map(character => ({ ...(committed?.activeCharacters.find(item => item.characterId === character.characterId) ?? character) })),
      // The draft changes prose and who is present; committed scenery stays frozen.
      ...(committed?.backgroundId ? { backgroundId: committed.backgroundId } : {}),
      ...(committed?.backgroundDataUrl ? { backgroundDataUrl: committed.backgroundDataUrl } : {}),
    };
  }
  return turnSnapshot(selected.value);
});
/** What the text box walks through: the author's action first, then the turn's sentences. */
const beats = computed<StageBeat[]>(() => [
  ...playerBeat(drafting.value ? props.draftAction?.trim() : selectedTurn.value?.action),
  ...snapshot.value.beats,
]);
const beat = computed(() => beats.value[beatIndex.value]);
const beatKey = computed(() => `${drafting.value ? 'draft' : selected.value?.id ?? 'scene'}:${beatIndex.value}`);
const isLast = computed(() => beatIndex.value >= beats.value.length - 1);
const background = computed(() => snapshot.value.backgroundDataUrl ?? (snapshot.value.backgroundId ? backgrounds.value[snapshot.value.backgroundId] : undefined));
const cast = computed(() => snapshot.value.activeCharacters.map((character) => {
  const label = character.name ?? roster.value.find(item => item.id === character.characterId)?.name ?? character.characterId;
  return {
    ...character,
    label,
    portrait: character.portraitDataUrl ?? portraits.value[character.characterId],
    // The author's own action lights nobody up.
    speaking: !beat.value?.player && Boolean(beat.value?.speaker) && (beat.value?.speaker === label || beat.value?.speaker === character.characterId),
  };
}));
const someoneSpeaking = computed(() => cast.value.some(character => character.speaking));

const NUMBERED_CHOICE = /^[1-9](?:️⃣|[.、)])\s*/;
// Only a trailing numbered block is a menu; numbered lines inside the prose body stay narrative.
function trailingChoices(content = ''): string[] {
  const lines = content.trimEnd().split(/\r?\n/);
  const block: string[] = [];
  for (let index = lines.length - 1; index >= 0 && NUMBERED_CHOICE.test(lines[index]!.trim()); index--) block.unshift(lines[index]!.trim().replace(NUMBERED_CHOICE, ''));
  return block.filter(Boolean);
}
const choices = computed(() => props.choices.length ? props.choices : trailingChoices(selected.value?.content));
const choicesShown = computed(() => isLast.value && !historicalId.value && !drafting.value);
const atmosphere = computed(() => /深夜|夜晚|午夜/.test(snapshot.value.sceneId) ? 'night' : /黄昏|日落|夕阳/.test(snapshot.value.sceneId) ? 'sunset' : 'day');
const charDelayMs = computed(() => prefs.value.typewriter && !reducedMotion ? Math.round(1000 / prefs.value.charsPerSecond) : 0);
const logGroups = computed<VisualNovelLogGroup[]>(() => stageTurns.value.map(({ turn, action }) => ({
  id: turn.id ?? '',
  createdAt: turn.createdAt,
  beats: [...playerBeat(action), ...turnSnapshot(turn).beats].map(item => ({ ...item, color: nameColor(item.speaker) })),
})));

// Where the author was in a draft, so the committed turn continues from there instead of replaying.
let carry: { index: number; head: string } | undefined;
let lastDraft = '';
function draftHead(text: string): string {
  return Array.from(plainStageText(text).trim()).slice(0, 12).join('');
}
function clampBeat(index: number): number {
  return Math.max(0, Math.min(index, beats.value.length - 1));
}
watch(() => props.draft, (text) => { if (text) lastDraft = text; }, { immediate: true });
watch(() => props.sessionId, () => {
  historicalId.value = undefined;
  logOpen.value = false;
  carry = undefined;
  lastDraft = '';
  beatIndex.value = 0;
});
// One watcher for both signals: a draft ending and its committed turn arriving can come in
// either order, or together.
watch([drafting, () => selected.value?.id] as const, ([now, id], [was, previousId]) => {
  if (now) {
    if (!was) {
      carry = undefined;
      lastDraft = props.draft ?? '';
      beatIndex.value = 0;
    }
    return;
  }
  if (was) carry = { index: beatIndex.value, head: draftHead(lastDraft) };
  const content = plainStageText(selected.value?.content).trim();
  if (carry?.head && !historicalId.value && content.startsWith(carry.head)) {
    beatIndex.value = clampBeat(carry.index);
    carry = undefined;
  } else if (id !== previousId) {
    beatIndex.value = 0;
  } else {
    // The draft is gone and its turn has not arrived yet: stay within what is on stage.
    beatIndex.value = clampBeat(beatIndex.value);
  }
});
watch(() => props.turns, () => {
  if (historicalId.value && !stageTurns.value.some(item => item.turn.id === historicalId.value)) historicalId.value = undefined;
});
watch(() => beats.value.length, () => { beatIndex.value = clampBeat(beatIndex.value); });

function next(): void {
  beatIndex.value = clampBeat(beatIndex.value + 1);
}
/** One step of reading: finish the sentence being typed, or move to the next one. */
function advance(): void {
  if (uiHidden.value) { uiHidden.value = false; return; }
  textbox.value?.advance();
}
/** Jumps to the last sentence there is; it never chooses an option or submits anything. */
async function skip(): Promise<void> {
  beatIndex.value = clampBeat(beats.value.length - 1);
  await nextTick();
  textbox.value?.complete();
}

// Auto: once a sentence is fully shown, wait for its length and move on. It stops at the
// last sentence of the turn, where the options or the next draft sentence take over.
let autoTimer: ReturnType<typeof setTimeout> | undefined;
const autoPaused = computed(() => logOpen.value || settingsOpen.value || uiHidden.value);
watch([auto, revealed, beatIndex, isLast, autoPaused, () => prefs.value.autoDelayMs], () => {
  clearTimeout(autoTimer);
  if (!auto.value || !revealed.value || isLast.value || autoPaused.value) return;
  const length = Array.from(plainStageText(beat.value?.text)).length;
  autoTimer = setTimeout(next, prefs.value.autoDelayMs + length * PLAY_STAGE_AUTO_MS_PER_CHAR);
});

function choose(text: string): void { if (!props.disabled && choicesShown.value) emit('choose', text); }
function custom(text: string, basedOn?: string): void { if (!props.disabled && choicesShown.value) emit('custom', text, basedOn); }
function edit(basedOn?: string): void { if (!props.disabled && choicesShown.value) emit('edit', basedOn); }

function replay(turnId: string, index: number): void {
  const current = stageTurns.value.at(-1)?.turn.id === turnId && !drafting.value;
  historicalId.value = current ? undefined : turnId;
  logOpen.value = false;
  // The selection watcher resets the position first; the chosen sentence is applied after it.
  void nextTick(() => { beatIndex.value = clampBeat(index); stage.value?.focus(); });
}
function backToCurrent(): void {
  historicalId.value = undefined;
  logOpen.value = false;
  beatIndex.value = 0;
}
function toggleLog(): void {
  settingsOpen.value = false;
  logOpen.value = !logOpen.value;
}
function toggleSettings(): void {
  logOpen.value = false;
  settingsOpen.value = !settingsOpen.value;
}

function syncFullscreen(): void {
  fullscreen.value = Boolean(stage.value) && document.fullscreenElement === stage.value;
}
/** Window fullscreen through the Fullscreen API; Esc leaves it natively. */
function toggleFullscreen(): void {
  if (!stage.value) return;
  if (document.fullscreenElement === stage.value) void document.exitFullscreen?.();
  else void stage.value.requestFullscreen?.()?.catch(() => { fullscreen.value = false; });
}

function isFormTarget(target: HTMLElement | undefined): boolean {
  return Boolean(target && (target.matches('input, textarea, select') || target.isContentEditable));
}
function keydown(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : undefined;
  if (isFormTarget(target)) return;
  if (uiHidden.value) {
    // Any key brings the interface back and is spent doing so.
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) { event.preventDefault(); uiHidden.value = false; }
    return;
  }
  if (event.key === 'Escape') {
    if (settingsOpen.value) settingsOpen.value = false;
    else if (logOpen.value) logOpen.value = false;
    else if (historicalId.value) backToCurrent();
    else return;
    event.preventDefault();
    stage.value?.focus();
    return;
  }
  if (event.key === ' ' || event.key === 'Enter') {
    // Other buttons on the stage keep their own Space / Enter; only the stage and its text box advance.
    if (target && target !== stage.value && !target.matches('.vn-textbox')) return;
    event.preventDefault();
    advance();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  if (/^[1-9]$/.test(event.key) && isLast.value) {
    const choice = choices.value[Number(event.key) - 1];
    if (choice) { event.preventDefault(); choose(choice); }
    return;
  }
  const shortcut: Record<string, () => void> = {
    a: () => { auto.value = !auto.value; },
    s: () => { void skip(); },
    l: toggleLog,
    h: () => { uiHidden.value = true; },
    f: toggleFullscreen,
  };
  const run = shortcut[event.key.toLowerCase()];
  if (run && !event.repeat) { event.preventDefault(); run(); }
}

let lastWheel = -Infinity;
/** Wheel down reads on, wheel up opens the log; panels and inputs keep their own scrolling. */
function wheel(event: WheelEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : undefined;
  if (!event.deltaY || logOpen.value || settingsOpen.value || isFormTarget(target) || target?.closest('.vn-controls')) return;
  event.preventDefault();
  if (event.timeStamp - lastWheel < 180) return;
  lastWheel = event.timeStamp;
  if (event.deltaY > 0) advance();
  else if (!uiHidden.value) logOpen.value = true;
}
function contextMenu(event: MouseEvent): void {
  if (isFormTarget(event.target instanceof HTMLElement ? event.target : undefined)) return;
  event.preventDefault();
  uiHidden.value = !uiHidden.value;
}
/** With the interface hidden, the first click only brings it back. */
function captureClick(event: MouseEvent): void {
  if (!uiHidden.value) return;
  event.preventDefault();
  event.stopPropagation();
  uiHidden.value = false;
}

onMounted(() => {
  stage.value?.focus();
  document.addEventListener('fullscreenchange', syncFullscreen);
});
onBeforeUnmount(() => {
  clearTimeout(autoTimer);
  document.removeEventListener('fullscreenchange', syncFullscreen);
});
defineExpose({ focus: () => stage.value?.focus() });
</script>
<template>
  <section
    ref="stage"
    class="vn-stage"
    :class="[atmosphere, { fill, 'ui-hidden': uiHidden, 'reduced-motion': reducedMotion }]"
    aria-label="视觉小说演出"
    tabindex="0"
    @keydown="keydown"
    @wheel="wheel"
    @contextmenu="contextMenu"
    @click.capture="captureClick"
  >
    <Transition name="vn-fade">
      <img v-if="background" :key="background" class="vn-background" :src="background" alt="" aria-hidden="true" />
    </Transition>
    <header v-show="!uiHidden">
      <Transition name="vn-fade" mode="out-in"><strong :key="snapshot.sceneId">{{ snapshot.sceneId }}</strong></Transition>
      <div class="vn-menu" role="toolbar" aria-label="阅读控制">
        <button type="button" :aria-pressed="auto" title="自动播放 (A)" @click="auto = !auto">自动</button>
        <button type="button" title="快进到本回合末或选项处 (S)" @click="skip">快进</button>
        <button type="button" :aria-pressed="logOpen" title="按句回看 (L，或滚轮上翻)" @click="toggleLog">回看</button>
        <button type="button" title="隐藏界面 (H，或右键)；任意点击或按键恢复" @click.stop="uiHidden = true">隐藏</button>
        <button type="button" :aria-pressed="fullscreen" title="全屏 (F)；Esc 退出" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏' }}</button>
        <button type="button" :aria-pressed="settingsOpen" title="阅读设置" @click="toggleSettings">设置</button>
        <button type="button" @click="emit('close')">{{ closeLabel }}</button>
      </div>
    </header>
    <p v-if="drafting && !uiHidden" class="vn-status" role="status">正在演出草稿 · 尚未保存</p>
    <p v-else-if="historicalId && !uiHidden" class="vn-status" role="status">
      只读回看 <button type="button" @click="backToCurrent">回到当前回合</button>
    </p>
    <TransitionGroup tag="div" name="vn-fade" class="vn-cast" :class="{ focused: someoneSpeaking }" aria-label="在场角色">
      <span v-for="character in cast" :key="character.characterId" :class="[character.position, { speaking: character.speaking }]">
        <img v-if="character.portrait" :src="character.portrait" :alt="character.label" />{{ character.label }}
      </span>
    </TransitionGroup>
    <VisualNovelChoiceOverlay v-if="choicesShown && !uiHidden" :choices="choices" :disabled="disabled" :external-editor="externalEditor" @choose="choose" @custom="custom" @edit="edit" />
    <VisualNovelTextBox
      v-show="!uiHidden"
      ref="textbox"
      :beat="beat"
      :beat-key="beatKey"
      :char-delay-ms="charDelayMs"
      :opacity="prefs.boxOpacity"
      :name-color="beat ? nameColor(beat.speaker) : undefined"
      :usage-operation-id="drafting ? usageOperationId : undefined"
      :usage-message-id="!drafting ? selected?.id : undefined"
      @next="next"
      @revealed="revealed = $event"
    />
    <div v-show="!uiHidden" class="vn-controls"><slot name="controls" /></div>
    <p v-if="uiHidden" class="vn-hidden-hint" role="status">界面已隐藏 · 点击或按任意键恢复</p>
    <VisualNovelLog
      v-if="logOpen && !uiHidden"
      :groups="logGroups"
      :current-id="drafting ? undefined : selected?.id"
      :current-index="beatIndex"
      :replaying="Boolean(historicalId)"
      :has-more-before="hasMoreBefore"
      :loading-earlier="loadingEarlier"
      @jump="replay"
      @current="backToCurrent"
      @load-earlier="emit('loadEarlier')"
      @close="logOpen = false; stage?.focus()"
    />
    <VisualNovelSettings v-if="settingsOpen && !uiHidden" :prefs="prefs" @update="updatePrefs" @close="settingsOpen = false; stage?.focus()" />
  </section>
</template>
<style scoped>
.vn-stage { position:relative; display:flex; flex-direction:column; height:clamp(360px, calc(100dvh - 260px), 760px); min-height:360px; box-sizing:border-box; padding:24px; background:linear-gradient(150deg,#273b48,#152026); color:#f5ebd8; border-radius:12px; overflow:hidden; }
.vn-stage.fill { height:100%; min-height:0; border-radius:0; overflow-y:auto; }
.vn-stage.fill .vn-cast { min-height:0; }
.vn-stage:fullscreen { height:100%; padding:32px; border-radius:0; }
.vn-stage.sunset { background:linear-gradient(150deg,#744b50,#262437); }
.vn-stage.night { background:linear-gradient(150deg,#171a34,#080e15); }
.vn-background { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.55; pointer-events:none; }
.vn-stage > :not(.vn-background) { position:relative; z-index:1; }
.vn-stage > .vn-log, .vn-stage > .vn-settings { position:absolute; z-index:3; }
header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; }
header strong { max-width:55%; white-space:pre-wrap; }
button { cursor:pointer; }
.vn-menu { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
.vn-menu button, .vn-status button { color:inherit; background:#283447; border:1px solid #657181; padding:6px 10px; border-radius:6px; font:inherit; font-size:12px; }
.vn-menu button[aria-pressed='true'] { border-color:#e9c983; color:#e9c983; }
.vn-status { margin:8px 0 0; font-size:12px; opacity:.85; }
.vn-status button { margin-left:8px; }
.vn-cast { display:flex; justify-content:center; align-items:end; gap:24px; flex:1; padding:24px; }
.vn-cast span { border:1px solid #8993a4; border-radius:50% 50% 8px 8px; padding:64px 20px 20px; opacity:.85; transition:opacity .25s ease, transform .25s ease, filter .25s ease; }
.vn-cast img { display:block; max-height:220px; max-width:150px; object-fit:contain; }
.vn-cast span:has(img) { padding:0; border:0; }
/* While someone speaks, they step forward and the others dim. */
.vn-cast.focused span { opacity:.45; filter:brightness(.7); }
.vn-cast.focused .speaking { opacity:1; filter:none; border-color:#e9c983; transform:translateY(-8px) scale(1.04); }
.left { order:0; } .center { order:1; } .right { order:2; }
.vn-hidden-hint { position:absolute !important; right:16px; bottom:8px; margin:0; font-size:11px; opacity:.45; }
.vn-fade-enter-active, .vn-fade-leave-active { transition:opacity .35s ease; }
.vn-fade-enter-from, .vn-fade-leave-to { opacity:0 !important; }
.vn-stage.reduced-motion, .vn-stage.reduced-motion * { transition:none !important; animation:none !important; }
.vn-stage.reduced-motion .vn-cast.focused .speaking { transform:none; }
@media (prefers-reduced-motion: reduce) {
  .vn-stage, .vn-stage * { transition:none !important; animation:none !important; }
  .vn-cast.focused .speaking { transform:none; }
}
</style>
