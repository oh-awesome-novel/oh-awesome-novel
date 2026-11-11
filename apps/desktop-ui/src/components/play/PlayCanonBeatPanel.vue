<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import { normalizePlayIsoWorldTime } from '@oh-awesome-novel/client';

import type {
  PlayCanonBeat,
  PlayCanonBeatChangeRecord,
  PlayCanonBeatDirectorOperation,
  PlayCanonBeatStatus,
  PlayCanonBeatTable,
  PlayCanonBeatTerminalStatus,
  PlayCheckpointSummary,
  PlayEventVisibility,
} from '../../composables/useWorkspaceApi';

const props = withDefaults(defineProps<{
  /** Already projected for the current lens; undefined hides the panel entirely. */
  table?: PlayCanonBeatTable;
  directorLens: boolean;
  checkpoints?: readonly Readonly<Pick<PlayCheckpointSummary, 'checkpointId' | 'kind' | 'revision'>>[];
  disabled?: boolean;
  busy?: boolean;
  error?: string;
}>(), {
  table: undefined,
  checkpoints: () => [],
  disabled: false,
  busy: false,
  error: '',
});

const emit = defineEmits<{
  operate: [operation: PlayCanonBeatDirectorOperation];
  focusEvent: [eventId: string];
  focusTurn: [checkpointId: string];
}>();

const STATUS_ORDER: readonly PlayCanonBeatStatus[] = [
  'pending',
  'occurredAsCanon',
  'altered',
  'prevented',
  'obsolete',
];
const STATUS_LABELS: Readonly<Record<PlayCanonBeatStatus, string>> = {
  pending: '待发生',
  occurredAsCanon: '照常发生',
  altered: '已改写',
  prevented: '已阻止',
  obsolete: '不再适用',
};
const TERMINAL: readonly PlayCanonBeatTerminalStatus[] = [
  'occurredAsCanon',
  'altered',
  'prevented',
  'obsolete',
];

type TriggerChoice = 'nextTurn' | 'afterTurns' | 'atWorldTime' | 'manual';

const editing = shallowRef<{ beatId: string; mode: 'correct' | 'schedule' }>();
const correctStatus = shallowRef<PlayCanonBeatTerminalStatus>('altered');
const correctReason = shallowRef('');
const triggerType = shallowRef<TriggerChoice>('nextTurn');
const triggerTurns = shallowRef(2);
const triggerTime = shallowRef('');
const scheduleVisibility = shallowRef<PlayEventVisibility>('playerVisible');

const groups = computed(() => STATUS_ORDER
  .map((status) => ({
    status,
    label: STATUS_LABELS[status],
    beats: (props.table?.beats ?? []).filter((beat) => beat.status === status),
  }))
  .filter((group) => group.beats.length > 0));
const scheduleError = computed(() => {
  if (triggerType.value === 'afterTurns' &&
    (!Number.isInteger(triggerTurns.value) || triggerTurns.value < 1 || triggerTurns.value > 999)) {
    return '请输入 1 到 999 的整数回合数。';
  }
  if (triggerType.value === 'atWorldTime' && !normalizePlayIsoWorldTime(triggerTime.value.trim())) {
    return '请输入带时区的日期时间，例如 2026-10-07T09:00:00+08:00。';
  }
  return '';
});

function lastChange(beat: PlayCanonBeat): PlayCanonBeatChangeRecord | undefined {
  return props.table?.changes.filter((change) => change.beatId === beat.id).at(-1);
}

function checkpointFor(change: PlayCanonBeatChangeRecord): string | undefined {
  return props.checkpoints.find((checkpoint) =>
    checkpoint.revision === change.revision && checkpoint.kind !== 'initialWorld')?.checkpointId;
}

function correctionTargets(beat: PlayCanonBeat): PlayCanonBeatTerminalStatus[] {
  return TERMINAL.filter((status) => status !== beat.status);
}

function open(beat: PlayCanonBeat, mode: 'correct' | 'schedule'): void {
  editing.value = { beatId: beat.id, mode };
  correctStatus.value = correctionTargets(beat)[0]!;
  correctReason.value = '';
  triggerType.value = 'nextTurn';
  scheduleVisibility.value = beat.visibility;
}

function submitCorrection(beat: PlayCanonBeat): void {
  if (!correctReason.value.trim()) return;
  emit('operate', {
    type: 'correct',
    beatId: beat.id,
    status: correctStatus.value,
    reason: correctReason.value.trim(),
  });
  editing.value = undefined;
}

function submitSchedule(beat: PlayCanonBeat): void {
  if (scheduleError.value) return;
  emit('operate', {
    type: 'schedule',
    beatId: beat.id,
    trigger: triggerType.value === 'afterTurns'
      ? { type: 'afterTurns', turns: triggerTurns.value }
      : triggerType.value === 'atWorldTime'
        ? { type: 'atWorldTime', value: normalizePlayIsoWorldTime(triggerTime.value.trim())!, format: 'iso8601' }
        : { type: triggerType.value },
    visibility: scheduleVisibility.value,
  });
  editing.value = undefined;
}
</script>

<template>
  <section v-if="table" class="play-hud-section play-canon-panel" aria-label="原作走向">
    <h3><span aria-hidden="true">[+]</span> 原作走向</h3>
    <p class="play-muted-copy">
      属于这次推演，不修改时间线文件 ·
      {{ table.protagonistKnowsCanon ? '穿越者知道原作' : '穿越者不知道原作，仅导演视角可见' }}
    </p>
    <p v-if="error" class="play-canon-error" role="alert">{{ error }}</p>

    <div v-for="group in groups" :key="group.status" class="play-canon-group" :data-status="group.status">
      <h4>{{ group.label }} <span>{{ group.beats.length }}</span></h4>
      <article v-for="beat in group.beats" :key="beat.id" class="play-canon-beat">
        <strong>{{ beat.label }}</strong>
        <span v-if="beat.expectedWhen" class="play-canon-meta">原作时间：{{ beat.expectedWhen }}</span>
        <blockquote v-if="beat.source.kind === 'sourceBacked'">
          {{ beat.source.quote }}
          <cite>{{ beat.source.path }}</cite>
        </blockquote>
        <span v-else class="play-canon-meta">作者提供，没有来源引文</span>
        <span v-if="beat.scheduledEventId && beat.status === 'pending'" class="play-canon-meta">
          已转为计划事件
        </span>

        <template v-if="lastChange(beat)">
          <p class="play-canon-change">
            <span>{{ lastChange(beat)!.origin === 'manual' ? '作者更正' : '裁判判定' }}</span>
            {{ lastChange(beat)!.reason }}
          </p>
          <div class="play-canon-links">
            <button
              v-if="checkpointFor(lastChange(beat)!)"
              type="button"
              class="play-canon-turn-link"
              @click="emit('focusTurn', checkpointFor(lastChange(beat)!)!)"
            >
              查看所在回合
            </button>
            <button
              v-for="(eventId, index) in lastChange(beat)!.eventIds"
              :key="eventId"
              type="button"
              class="play-canon-event-link"
              @click="emit('focusEvent', eventId)"
            >
              查看事件{{ lastChange(beat)!.eventIds.length > 1 ? ` ${index + 1}` : '' }}
            </button>
          </div>
        </template>

        <div v-if="directorLens" class="play-canon-actions">
          <button type="button" class="play-canon-correct" :disabled="disabled || busy" @click="open(beat, 'correct')">
            更正状态
          </button>
          <button
            v-if="beat.status === 'pending' && !beat.scheduledEventId"
            type="button"
            class="play-canon-schedule"
            :disabled="disabled || busy"
            @click="open(beat, 'schedule')"
          >
            转为计划事件
          </button>
        </div>

        <form
          v-if="directorLens && editing?.beatId === beat.id && editing.mode === 'correct'"
          class="play-canon-form"
          @submit.prevent="submitCorrection(beat)"
        >
          <label>
            <span>改为</span>
            <select v-model="correctStatus" name="canon-correct-status" :disabled="disabled || busy">
              <option v-for="status in correctionTargets(beat)" :key="status" :value="status">
                {{ STATUS_LABELS[status] }}
              </option>
            </select>
          </label>
          <label>
            <span>更正理由</span>
            <textarea v-model="correctReason" name="canon-correct-reason" rows="2" maxlength="500" :disabled="disabled || busy"></textarea>
          </label>
          <p class="play-muted-copy">更正会记为作者来源，不能改回“待发生”；要撤销裁判的判定请重演那一回合。</p>
          <div>
            <button type="button" @click="editing = undefined">取消</button>
            <button type="submit" :disabled="disabled || busy || !correctReason.trim()">保存更正</button>
          </div>
        </form>

        <form
          v-if="directorLens && editing?.beatId === beat.id && editing.mode === 'schedule'"
          class="play-canon-form"
          @submit.prevent="submitSchedule(beat)"
        >
          <label>
            <span>触发方式</span>
            <select v-model="triggerType" name="canon-schedule-trigger" :disabled="disabled || busy">
              <option value="nextTurn">下一回合</option>
              <option value="afterTurns">若干回合后</option>
              <option value="atWorldTime">到达世界时间</option>
              <option value="manual">手动触发（不会自动到期）</option>
            </select>
          </label>
          <label v-if="triggerType === 'afterTurns'">
            <span>回合数</span>
            <input v-model.number="triggerTurns" name="canon-schedule-turns" type="number" min="1" max="999" :disabled="disabled || busy">
          </label>
          <label v-if="triggerType === 'atWorldTime'">
            <span>世界时间（带时区的 ISO 格式）</span>
            <input v-model="triggerTime" name="canon-schedule-time" type="text" placeholder="2026-10-07T09:00:00+08:00" :disabled="disabled || busy">
          </label>
          <label>
            <span>事件发生时</span>
            <select v-model="scheduleVisibility" name="canon-schedule-visibility" :disabled="disabled || busy">
              <option value="playerVisible">参与者可见</option>
              <option value="rumor">作为传闻</option>
              <option value="playerUnknown">参与者不知道</option>
            </select>
          </label>
          <p v-if="scheduleError" role="alert">{{ scheduleError }}</p>
          <p class="play-muted-copy">计划事件到期时由裁判结算；节点状态仍要等那一回合判定。</p>
          <div>
            <button type="button" @click="editing = undefined">取消</button>
            <button type="submit" :disabled="disabled || busy || Boolean(scheduleError)">排入计划</button>
          </div>
        </form>
      </article>
    </div>
  </section>
</template>

<style scoped>
.play-canon-group {
  display: grid;
  gap: 6px;
}

.play-canon-group h4 {
  display: flex;
  gap: 6px;
  margin: 0;
  color: var(--play-ink);
  font-size: 12px;
}

.play-canon-group h4 span,
.play-canon-meta,
.play-canon-beat cite {
  color: var(--play-muted);
  font-size: 11px;
}

.play-canon-beat {
  display: grid;
  gap: 4px;
  padding: 6px 0 6px 9px;
  border-left: 1px solid var(--play-line);
  font-size: 11px;
}

.play-canon-beat strong {
  color: var(--play-ink);
}

.play-canon-beat blockquote {
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: 7px;
  border-left: 2px solid var(--play-line-strong);
  color: var(--play-body);
}

.play-canon-change span {
  color: var(--play-body);
  font-weight: 700;
}

.play-canon-links,
.play-canon-actions,
.play-canon-form > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.play-canon-form {
  display: grid;
  gap: 6px;
  padding: 7px;
  border: 1px solid var(--play-line);
}

.play-canon-form label {
  display: grid;
  gap: 3px;
}

.play-canon-panel button,
.play-canon-panel select,
.play-canon-panel input,
.play-canon-panel textarea {
  padding: 2px 6px;
  border: 1px solid var(--play-line);
  background: var(--play-canvas);
  color: var(--play-body);
  font: inherit;
  font-size: 11px;
}

.play-canon-error {
  color: var(--play-danger);
}
</style>
