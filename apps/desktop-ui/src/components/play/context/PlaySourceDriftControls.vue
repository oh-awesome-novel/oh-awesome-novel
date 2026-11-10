<script setup lang="ts">
import { PLAY_SOURCE_DRIFT_STATE_LABELS } from '../../../composables/playTerms';
import { computed, nextTick, shallowRef, useId, useTemplateRef } from 'vue';

import type {
  PlaySourceDriftDecisionDraft,
  PlaySourceDriftView,
} from './types';

const props = defineProps<{
  drift?: Readonly<PlaySourceDriftView>;
  busy: boolean;
}>();

const emit = defineEmits<{
  decide: [decision: PlaySourceDriftDecisionDraft];
  refresh: [];
}>();

type DecisionKind = PlaySourceDriftDecisionDraft['kind'];

const pendingDecision = shallowRef<DecisionKind>();
const returnDecision = shallowRef<DecisionKind>();
const forkSessionId = shallowRef('');
const forkTitle = shallowRef('');
const checkButton = useTemplateRef<HTMLButtonElement>('checkButton');
const continueFrozenButton = useTemplateRef<HTMLButtonElement>('continueFrozenButton');
const reassembleButton = useTemplateRef<HTMLButtonElement>('reassembleButton');
const forkButton = useTemplateRef<HTMLButtonElement>('forkButton');
const confirmButton = useTemplateRef<HTMLButtonElement>('confirmButton');
const helpId = `${useId()}-source-drift-help`;
const canConfirm = computed(() =>
  pendingDecision.value !== 'fork' || forkSessionId.value.trim().length > 0,
);

async function openDecision(kind: DecisionKind): Promise<void> {
  if (props.busy || !props.drift?.availableDecisions.includes(kind)) return;
  returnDecision.value = kind;
  pendingDecision.value = kind;
  await nextTick();
  confirmButton.value?.focus();
}

async function closeDecision(): Promise<void> {
  pendingDecision.value = undefined;
  await nextTick();
  focusReturnTarget();
}

async function confirmDecision(): Promise<void> {
  const kind = pendingDecision.value;
  if (!kind || !canConfirm.value) return;
  if (kind === 'fork') {
    emit('decide', {
      kind,
      newSessionId: forkSessionId.value.trim(),
      ...(forkTitle.value.trim() ? { title: forkTitle.value.trim() } : {}),
    });
  } else {
    emit('decide', { kind });
  }
  pendingDecision.value = undefined;
  await nextTick();
  focusReturnTarget();
}

function focusReturnTarget(): void {
  const target = returnDecision.value === 'continueFrozen'
    ? continueFrozenButton.value
    : returnDecision.value === 'reassemble'
      ? reassembleButton.value
      : returnDecision.value === 'fork'
        ? forkButton.value
        : undefined;
  (target ?? checkButton.value)?.focus();
}
</script>

<template>
  <section class="play-source-drift-controls" aria-label="正式来源状态">
    <header>
      <h3>正式来源</h3>
      <button ref="checkButton" type="button" :disabled="busy" @click="emit('refresh')">检查</button>
    </header>

    <p v-if="drift?.activeResolution" class="play-source-resolution">
      {{ drift.activeResolution }}
    </p>
    <ul v-if="drift?.items.length">
      <li v-for="item in drift.items" :key="item.id">
        <strong>{{ item.label }}</strong>
        <span>{{ PLAY_SOURCE_DRIFT_STATE_LABELS[item.state] ?? item.state }}</span>
        <small v-if="item.evidence">{{ item.evidence }}</small>
      </li>
    </ul>
    <p v-else>没有发现来源变化。</p>

    <div
      v-if="drift && drift.overall !== 'current' && !pendingDecision"
      class="play-source-decision-row"
      role="group"
      :aria-describedby="helpId"
    >
      <button
        ref="continueFrozenButton"
        type="button"
        :disabled="busy || !drift.availableDecisions.includes('continueFrozen')"
        @click="openDecision('continueFrozen')"
      >沿用开局时的内容</button>
      <button
        ref="reassembleButton"
        type="button"
        :disabled="busy || !drift.availableDecisions.includes('reassemble')"
        @click="openDecision('reassemble')"
      >按当前文件重组</button>
      <button
        ref="forkButton"
        type="button"
        :disabled="busy || !drift.availableDecisions.includes('fork')"
        @click="openDecision('fork')"
      >另开会话</button>
    </div>

    <div
      v-if="pendingDecision"
      class="play-source-decision-confirmation"
      role="group"
      :aria-label="`Confirm ${pendingDecision} source decision`"
      @keydown.esc.stop.prevent="closeDecision"
    >
      <p v-if="pendingDecision === 'continueFrozen'">
        沿用推演内的状态继续；已变化的正式来源不再进入新的上下文。
      </p>
      <p v-else-if="pendingDecision === 'reassemble'">
        按正式来源的当前内容重组这个会话，并作为一次推演内决定记录下来。
      </p>
      <template v-else>
        <label>新会话编号 <input v-model.trim="forkSessionId" /></label>
        <label>标题 <input v-model.trim="forkTitle" /></label>
      </template>
      <div>
        <button type="button" @click="closeDecision">返回</button>
        <button
          ref="confirmButton"
          type="button"
          :disabled="busy || !canConfirm"
          @click="confirmDecision"
        >确认</button>
      </div>
    </div>

    <p :id="helpId" class="play-source-drift-help">
      来源处理只影响推演内的上下文，正式文件不会改变。
    </p>
  </section>
</template>

<style scoped>
.play-source-drift-controls,
.play-source-drift-controls li,
.play-source-decision-confirmation {
  display: grid;
  gap: 7px;
}

.play-source-drift-controls header,
.play-source-decision-row,
.play-source-decision-confirmation > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.play-source-drift-controls header {
  justify-content: space-between;
}

.play-source-drift-controls :where(h3, p, ul) {
  margin: 0;
}

.play-source-drift-controls ul {
  padding-left: 16px;
}

.play-source-drift-controls small,
.play-source-drift-help,
.play-source-resolution {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-source-decision-confirmation {
  padding: 8px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
}

.play-source-decision-confirmation label {
  display: grid;
  gap: 3px;
  font-size: 10px;
}
</style>
