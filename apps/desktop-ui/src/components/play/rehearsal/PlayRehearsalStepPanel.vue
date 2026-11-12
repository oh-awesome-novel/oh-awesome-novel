<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue';

import type {
  PlayRehearsalNarrativeBlockKind,
  PlayRehearsalStepRunPhase,
  PlayRehearsalStepRunView,
  PlayRehearsalStepStatus,
  PlayRehearsalStepView,
} from './types';

const { steps, run, canStop, steerPending, checkDisabled = false, checkingStepRef = '' } = defineProps<{
  steps: readonly Readonly<PlayRehearsalStepView>[];
  run?: Readonly<PlayRehearsalStepRunView>;
  canStop: boolean;
  /** Director intent waiting to redirect the step being generated. */
  steerPending?: string;
  checkDisabled?: boolean;
  /** Step whose in-character check is running. */
  checkingStepRef?: string;
}>();

const emit = defineEmits<{
  stopStep: [];
  steerStep: [intent: string];
  checkStep: [stepRef: string];
}>();

const steerText = shallowRef('');

function steer(): void {
  const intent = steerText.value.trim();
  if (!intent || !canStop) return;
  emit('steerStep', intent);
  steerText.value = '';
}

const headingId = `${useId()}-rehearsal-narrative-heading`;
const busyPhases: ReadonlySet<PlayRehearsalStepRunPhase> = new Set([
  'starting',
  'streaming',
  'prepared',
  'stopping',
]);
const isBusy = computed(() => Boolean(run && busyPhases.has(run.phase)));

function statusLabel(status: PlayRehearsalStepStatus): string {
  switch (status) {
    case 'provisional': return '临时 · 尚未提交';
    case 'selected': return '已采用 · 仅限本次试演';
    case 'committed': return '已提交';
    case 'superseded': return '已被替换的结果';
  }
}

function blockKindLabel(kind: PlayRehearsalNarrativeBlockKind): string {
  switch (kind) {
    case 'narrator': return '旁白';
    case 'characterSpeech': return '台词';
    case 'characterAction': return '动作';
    case 'worldNotice': return '世界';
  }
}
</script>

<template>
  <section
    class="play-rehearsal-step-panel"
    :aria-labelledby="headingId"
    :aria-busy="isBusy"
  >
    <header>
      <div>
        <span>叙述 / 本次试演</span>
        <h2 :id="headingId">角色步骤</h2>
      </div>
      <span>{{ run?.statusMessage || '就绪' }}</span>
    </header>

    <div class="play-rehearsal-step-scroll">
      <article
        v-for="step in steps"
        :key="step.id"
        class="play-rehearsal-step"
        :data-status="step.status"
        :aria-label="`${step.participantName}, ${statusLabel(step.status)}`"
      >
        <header>
          <div>
            <strong>{{ step.participantName }}</strong>
            <span v-if="step.intentSummary">{{ step.intentSummary }}</span>
          </div>
          <span>[{{ statusLabel(step.status) }}]</span>
        </header>

        <div v-if="step.blocks.length" class="play-rehearsal-blocks">
          <section v-for="block in step.blocks" :key="block.id">
            <header>
              <span>{{ block.speakerName || blockKindLabel(block.kind) }}</span>
              <small>{{ blockKindLabel(block.kind) }}<template v-if="block.projection === 'directorOnly'"> · 仅导演可见</template></small>
            </header>
            <p :data-usage-step="step.id">{{ block.content }}</p>
          </section>
        </div>
        <p v-else class="play-rehearsal-step-empty">还没有准备叙述段落。</p>

        <button
          v-if="step.blocks.length && (step.status === 'provisional' || step.status === 'selected')"
          class="play-rehearsal-step-check"
          type="button"
          :disabled="checkDisabled || Boolean(checkingStepRef)"
          :data-check-step="step.id"
          title="一次只读的模型调用：指出哪句话不像这个角色，并附角色资料里的依据。"
          @click="emit('checkStep', step.id)"
        >
          {{ checkingStepRef === step.id ? '正在检查…' : '检查角色贴合度' }}
        </button>

        <small v-if="step.variantOf" class="play-rehearsal-variant-ref">
          {{ step.variantOf }} 的另一结果
        </small>
      </article>

      <div v-if="steps.length === 0" class="play-rehearsal-step-placeholder">
        <span aria-hidden="true">[ ]</span>
        <strong>还没有角色步骤</strong>
        <p>生成当前角色的反应，然后在这次试演中采用或重演。</p>
      </div>
    </div>

    <footer v-if="run">
      <div>
        <strong>{{ run.statusMessage }}</strong>
        <span v-if="run.error" role="alert">{{ run.error }}</span>
      </div>
      <button
        v-if="isBusy"
        type="button"
        :disabled="!canStop"
        aria-label="停止生成当前角色步骤，保留这次试演"
        @click="emit('stopStep')"
      >
        {{ run.phase === 'stopping' ? '正在停止…' : '停止步骤' }}
      </button>
    </footer>
    <form
      v-if="run && isBusy && canStop"
      class="play-rehearsal-steer"
      aria-label="导演插话"
      @submit.prevent="steer"
    >
      <label class="visually-hidden" for="play-rehearsal-steer-input">导演插话</label>
      <input
        id="play-rehearsal-steer-input"
        v-model="steerText"
        type="text"
        placeholder="插话：让这一步改朝某个方向…"
      >
      <button type="submit" :disabled="!steerText.trim()">插话</button>
    </form>
    <p v-if="steerPending" class="play-rehearsal-steer-pending" role="status">
      插话已记下，本步生成结束后按“{{ steerPending }}”重写这一步。
    </p>
  </section>
</template>

<style scoped>
.play-rehearsal-step-panel {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-step-panel > header,
.play-rehearsal-step-panel > header > div,
.play-rehearsal-step > header,
.play-rehearsal-step > header > div,
.play-rehearsal-blocks section header,
.play-rehearsal-step-panel > footer {
  display: flex;
  align-items: center;
}

.play-rehearsal-step-panel > header {
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-step-panel > header > div,
.play-rehearsal-step > header > div {
  align-items: flex-start;
  flex-direction: column;
  gap: 1px;
}

.play-rehearsal-step-panel > header span,
.play-rehearsal-step > header span,
.play-rehearsal-blocks small,
.play-rehearsal-variant-ref {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-step-panel h2 {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.play-rehearsal-step-scroll {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding: 14px;
}

.play-rehearsal-step {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-rehearsal-step[data-status="provisional"] {
  border-style: dashed;
}

.play-rehearsal-step[data-status="selected"] {
  border-style: double;
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-step[data-status="committed"] {
  border-left-color: var(--play-success, var(--editor-success));
}

.play-rehearsal-step[data-status="superseded"] {
  border-left-style: dotted;
  opacity: .7;
}

.play-rehearsal-step > header {
  justify-content: space-between;
  gap: 8px;
}

.play-rehearsal-step strong,
.play-rehearsal-blocks section header span {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-blocks {
  display: grid;
  gap: 8px;
}

.play-rehearsal-blocks section {
  padding: 9px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-blocks section header {
  justify-content: space-between;
  gap: 8px;
}

.play-rehearsal-blocks p,
.play-rehearsal-step-empty,
.play-rehearsal-step-placeholder p {
  margin: 6px 0 0;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.65;
}

.play-rehearsal-step-empty,
.play-rehearsal-step-placeholder p {
  color: var(--play-muted, var(--editor-muted));
}

.play-rehearsal-step-placeholder {
  display: grid;
  min-height: 180px;
  align-content: center;
  justify-items: center;
  gap: 5px;
  color: var(--play-muted, var(--editor-muted));
  text-align: center;
}

.play-rehearsal-step-placeholder strong {
  color: var(--play-ink, var(--editor-ink));
}

.play-rehearsal-step-panel > footer {
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-step-panel > footer div {
  display: grid;
  gap: 2px;
  font-size: 10px;
}

.play-rehearsal-step-panel > footer span[role="alert"] {
  color: var(--play-danger, var(--editor-danger));
}

.play-rehearsal-step-panel > footer button {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}
.play-rehearsal-step-check {
  justify-self: end;
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: none;
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-rehearsal-steer {
  display: flex;
  gap: 6px;
  padding: 6px 13px;
}

.play-rehearsal-steer input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 12px;
}

.play-rehearsal-steer-pending {
  margin: 0;
  padding: 0 13px 8px;
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}
</style>
