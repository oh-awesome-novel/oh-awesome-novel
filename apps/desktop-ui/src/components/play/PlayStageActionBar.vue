<script setup lang="ts">
import { computed, nextTick, shallowRef } from 'vue';
import type { DeepReadonly } from 'vue';

import PlayFollowUpQueue from './PlayFollowUpQueue.vue';
import PlayTimeAdvanceControl from './PlayTimeAdvanceControl.vue';
import type {
  PlayActionKind,
  PlayCheckpointSummary,
  PlayRelativeTimeAdvance,
} from '../../composables/useWorkspaceApi';
import type { PlayFollowUpControls } from '../../composables/usePlayFollowUpQueue';
import { normalizeRelativeTimeAdvance } from '../../composables/usePlayWorkspace';
import type { PlayTurnRunPhase } from '../../composables/usePlayTurnStream';

/**
 * The stage's own action input and its few turn controls. The draft, action kind and
 * wait duration are the session's shared ones, so the workbench composer shows the same text.
 */
const userText = defineModel<string>('userText', { required: true });
const actionKind = defineModel<PlayActionKind>('actionKind', { required: true });
const timeAdvance = defineModel<PlayRelativeTimeAdvance | undefined>('timeAdvance', { required: true });

const props = defineProps<{
  /** No model is configured. */
  disabled: boolean;
  /** Something holds the session; only a running turn still accepts queued or steering text. */
  busy: boolean;
  running: boolean;
  canStop: boolean;
  canSteer: boolean;
  phase?: PlayTurnRunPhase;
  status: string;
  followUps: PlayFollowUpControls;
  checkpoints: DeepReadonly<PlayCheckpointSummary[]>;
}>();

const emit = defineEmits<{
  /** Sends the action, or queues it while a turn runs. */
  submit: [];
  steer: [];
  stop: [];
  retry: [artifactId: string];
  restore: [checkpointId: string];
  configureProvider: [];
  /** The input was closed from the keyboard; the stage takes focus back. */
  closed: [];
}>();

const kinds: Array<{ id: PlayActionKind; label: string }> = [
  { id: 'say', label: '说' },
  { id: 'look', label: '看' },
  { id: 'move', label: '走' },
  { id: 'do', label: '做' },
  { id: 'wait', label: '等' },
];
// A draft carried over from the workbench is shown straight away.
const editorOpen = shallowRef(userText.value.trim().length > 0);
const textarea = shallowRef<HTMLTextAreaElement>();

const inputLocked = computed(() => props.disabled || (props.busy && !props.running));
const canSubmit = computed(() => !inputLocked.value && (
  actionKind.value === 'wait'
    ? normalizeRelativeTimeAdvance(timeAdvance.value) !== undefined
    : userText.value.trim().length > 0
));
const canSendSteer = computed(() => props.running && props.canSteer && userText.value.trim().length > 0);
// Older checkpoint listings name a turn only by its artifact.
function checkpointIdOf(checkpoint: DeepReadonly<PlayCheckpointSummary>): string {
  return (checkpoint.checkpointId as string | undefined) ?? checkpoint.artifactId ?? '';
}
const currentCheckpoint = computed(() => props.checkpoints.find(checkpoint => checkpoint.status === 'current'));
const currentCheckpointId = computed(() => currentCheckpoint.value ? checkpointIdOf(currentCheckpoint.value) : '');
const retryTarget = computed(() => currentCheckpoint.value?.retryable ? currentCheckpoint.value.artifactId : undefined);
const jumpOptions = computed(() => props.checkpoints.map(checkpoint => ({
  id: checkpointIdOf(checkpoint),
  current: checkpoint.status === 'current',
  restorable: checkpoint.restorable,
  // Guided Retry notes are Director information and are never part of the label.
  label: [
    checkpoint.name?.trim() || (checkpoint.kind === 'initialWorld' ? '开局' : `第 ${checkpoint.worldTurn} 回合`),
    checkpoint.status === 'variant' ? '（另一个结果）' : '',
    checkpoint.preview ? ` · ${Array.from(checkpoint.preview).slice(0, 24).join('')}` : '',
  ].join(''),
})));
const stopLabel = computed(() => props.phase === 'stopping'
  ? '正在停止…'
  : props.phase === 'committing' ? '正在提交…' : '停止');

async function open(): Promise<void> {
  editorOpen.value = true;
  await nextTick();
  textarea.value?.focus();
}

function close(): void {
  editorOpen.value = false;
  emit('closed');
}

function selectKind(kind: PlayActionKind): void {
  actionKind.value = kind;
  if (kind === 'wait' && !normalizeRelativeTimeAdvance(timeAdvance.value)) {
    timeAdvance.value = { amount: 10, unit: 'minute' };
  }
}

function submit(): void {
  if (!canSubmit.value) return;
  emit('submit');
  // An idle submit starts the turn, and the stage shows it; a queued one keeps the input for more.
  if (!props.running) close();
}

function steer(): void {
  if (canSendSteer.value) emit('steer');
}

function keydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); close(); return; }
  if (event.key !== 'Enter') return;
  if (event.altKey && props.running) { event.preventDefault(); steer(); return; }
  if (event.metaKey || event.ctrlKey) { event.preventDefault(); submit(); }
}

function jump(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const id = select.value;
  // The list shows where the session is; it only moves once the restore has happened.
  select.value = currentCheckpointId.value;
  if (id && id !== currentCheckpointId.value) emit('restore', id);
}

defineExpose({ open });
</script>

<template>
  <div class="play-stage-bar">
    <form v-if="editorOpen" class="play-stage-input" aria-label="本回合行动" @submit.prevent="submit">
      <div class="play-stage-kinds" role="group" aria-label="行动类型">
        <button
          v-for="kind in kinds"
          :key="kind.id"
          type="button"
          :class="{ active: actionKind === kind.id }"
          :aria-pressed="actionKind === kind.id"
          :disabled="inputLocked"
          @click="selectKind(kind.id)"
        >
          {{ kind.label }}
        </button>
      </div>
      <PlayTimeAdvanceControl v-if="actionKind === 'wait'" v-model:time-advance="timeAdvance" :disabled="inputLocked" />
      <label class="visually-hidden" for="play-stage-action-input">本回合行动</label>
      <textarea
        id="play-stage-action-input"
        ref="textarea"
        v-model="userText"
        rows="2"
        :placeholder="running ? '写下要排队的下一步，或给本回合的补充…' : '写下你要说什么、做什么…'"
        :disabled="inputLocked"
        @keydown="keydown"
      ></textarea>
      <div class="play-stage-input-actions">
        <small>{{ running ? 'Cmd/Ctrl + Enter 排队 · Alt + Enter 插话 · Esc 收起' : 'Cmd/Ctrl + Enter 发送 · Esc 收起' }}</small>
        <button type="button" @click="close">收起</button>
        <template v-if="running">
          <button type="submit" :disabled="!canSubmit" title="本回合提交后再发送">排队</button>
          <button type="button" :disabled="!canSendSteer" title="停止本回合未提交的生成，把这句补充进当前行动后重新生成" @click="steer">插话</button>
        </template>
        <button v-else type="submit" class="primary" :disabled="!canSubmit">{{ actionKind === 'wait' ? '推进时间' : '行动' }}</button>
      </div>
    </form>

    <details v-if="followUps.items.length || followUps.notice" class="play-stage-queue">
      <summary>排队中的行动 · {{ followUps.items.length }} 条{{ followUps.paused ? '（已暂停）' : '' }}</summary>
      <PlayFollowUpQueue :controls="followUps" :can-steer="running && canSteer" :running="running" />
    </details>

    <div class="play-stage-tools" role="toolbar" aria-label="舞台操作">
      <button v-if="disabled" type="button" @click="emit('configureProvider')">配置模型后才能推进回合</button>
      <button v-else-if="!editorOpen" type="button" class="play-stage-write" :disabled="inputLocked" @click="open">
        {{ running ? '插话 / 排队' : '写行动' }}
      </button>
      <button v-if="running" type="button" class="play-stage-stop" :disabled="!canStop" aria-label="停止本回合" @click="emit('stop')">
        {{ stopLabel }} <span aria-hidden="true">■</span>
      </button>
      <button
        type="button"
        class="play-stage-retry"
        :disabled="disabled || busy || !retryTarget"
        title="保留现有结果，从这一回合开始前再演一次"
        @click="retryTarget && emit('retry', retryTarget)"
      >
        重演上一回合
      </button>
      <label v-if="jumpOptions.length > 1" class="play-stage-jump">
        <span>存档点</span>
        <select :value="currentCheckpointId" :disabled="busy" aria-label="跳转到存档点" @change="jump">
          <option v-for="option in jumpOptions" :key="option.id" :value="option.id" :disabled="!option.current && !option.restorable">
            {{ option.label }}
          </option>
        </select>
      </label>
      <span class="play-stage-status" role="status">{{ status }}</span>
    </div>
  </div>
</template>

<style scoped>
.play-stage-bar { display:grid; gap:8px; margin-top:10px; color:#f5ebd8; font-size:13px; }
.play-stage-input { display:grid; gap:8px; padding:12px; border:1px solid #8d7c57; border-radius:10px; background:#111b28ee; }
.play-stage-kinds { display:flex; gap:6px; }
.play-stage-input textarea { width:100%; box-sizing:border-box; padding:10px; color:#f5e7c6; border:1px solid #657181; border-radius:8px; background:#0c141eee; font:inherit; line-height:1.6; resize:vertical; }
.play-stage-input-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; }
.play-stage-input-actions small { margin-right:auto; opacity:.65; font-size:11px; }
.play-stage-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.play-stage-bar button, .play-stage-jump select { padding:6px 12px; color:inherit; border:1px solid #657181; border-radius:6px; background:#283447; font:inherit; cursor:pointer; }
.play-stage-bar button:disabled, .play-stage-jump select:disabled { opacity:.5; cursor:default; }
.play-stage-bar button.active, .play-stage-bar button.primary { border-color:#e9c983; color:#e9c983; }
.play-stage-jump { display:flex; align-items:center; gap:6px; }
.play-stage-jump select { max-width:260px; }
.play-stage-status { margin-left:auto; opacity:.75; font-size:12px; }
.play-stage-queue { padding:8px 12px; border:1px solid #657181; border-radius:8px; background:#111b28ee; }
.play-stage-queue summary { cursor:pointer; }
.visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
</style>
