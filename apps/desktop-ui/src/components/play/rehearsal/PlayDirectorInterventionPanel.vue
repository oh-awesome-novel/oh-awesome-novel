<script setup lang="ts">
import { PLAY_NARRATIVE_BLOCK_KIND_LABELS, PLAY_REHEARSAL_STEP_STATUS_LABELS } from '../../../composables/playTerms';
import {
  computed,
  nextTick,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue';

import type {
  PlayDirectorInterventionDraft,
  PlayDirectorPanelMode,
  PlayRehearsalActorQueueItem,
  PlayRehearsalStepView,
} from './types';

const props = defineProps<{
  mode: PlayDirectorPanelMode;
  steps: readonly Readonly<PlayRehearsalStepView>[];
  participants: readonly Readonly<PlayRehearsalActorQueueItem>[];
  activeStepRef?: string;
  busy: boolean;
  /** Opens "修改" as a redirect of one step with editable director intent. */
  redirectSeed?: { stepRef: string; intent: string; nonce: number };
}>();

const emit = defineEmits<{
  close: [];
  submit: [draft: PlayDirectorInterventionDraft];
}>();

type ModifyMode = 'reviseProjection' | 'redirectStep';
type GrantMode = 'existingFact' | 'authorProvidedPlayFact';

const panelId = `${useId()}-director-intervention`;
const heading = useTemplateRef<HTMLHeadingElement>('heading');
const modifyMode = shallowRef<ModifyMode>('reviseProjection');
const targetStepRef = shallowRef('');
const projectionByBlockId = shallowRef<Record<string, string>>({});
const directorIntent = shallowRef('');
const authorConstraintRefs = shallowRef('');
const participantRef = shallowRef('');
const insertionAnchor = shallowRef<'before' | 'after' | 'next'>('next');
const insertionStepRef = shallowRef('');
const effectiveFromStepRef = shallowRef('');
const grantMode = shallowRef<GrantMode>('existingFact');
const factRefs = shallowRef('');
const authorFact = shallowRef('');
const authorFactVisibility = shallowRef<'playerVisible' | 'rumor' | 'playerUnknown'>(
  'playerVisible',
);

const liveSteps = computed(() => props.steps.filter((step) =>
  step.status === 'selected' || step.status === 'provisional',
));
const selectedStep = computed(() => liveSteps.value.find((step) =>
  step.id === targetStepRef.value,
));
const editableBlocks = computed(() => selectedStep.value?.blocks.filter((block) =>
  block.kind !== 'worldNotice',
) ?? []);
const canSubmit = computed(() => {
  if (props.busy) return false;
  if (props.mode === 'modify') {
    if (!selectedStep.value) return false;
    if (modifyMode.value === 'redirectStep') return Boolean(directorIntent.value.trim());
    return editableBlocks.value.length > 0 && editableBlocks.value.every((block) =>
      Boolean(projectionByBlockId.value[block.id]?.trim()),
    );
  }
  if (props.mode === 'insertActor') {
    return Boolean(participantRef.value) && (
      insertionAnchor.value === 'next' || Boolean(insertionStepRef.value)
    );
  }
  return Boolean(participantRef.value && effectiveFromStepRef.value) && (
    grantMode.value === 'existingFact'
      ? splitRefs(factRefs.value).length > 0
      : Boolean(authorFact.value.trim())
  );
});

watch(
  () => props.mode,
  async () => {
    resetFormDefaults();
    applyRedirectSeed();
    await nextTick();
    heading.value?.focus();
  },
  { immediate: true },
);

function applyRedirectSeed(): void {
  const seed = props.redirectSeed;
  if (!seed || props.mode !== 'modify' || !liveSteps.value.some((step) => step.id === seed.stepRef)) return;
  modifyMode.value = 'redirectStep';
  targetStepRef.value = seed.stepRef;
  directorIntent.value = seed.intent;
}
watch(() => props.redirectSeed?.nonce, applyRedirectSeed);

watch(liveSteps, () => {
  if (!liveSteps.value.some((step) => step.id === targetStepRef.value)) {
    targetStepRef.value = preferredStepRef();
  }
  if (!liveSteps.value.some((step) => step.id === effectiveFromStepRef.value)) {
    effectiveFromStepRef.value = preferredStepRef();
  }
}, { immediate: true });

watch(targetStepRef, () => {
  projectionByBlockId.value = Object.fromEntries(
    editableBlocks.value.map((block) => [block.id, block.content]),
  );
});

function resetFormDefaults(): void {
  modifyMode.value = 'reviseProjection';
  targetStepRef.value = preferredStepRef();
  projectionByBlockId.value = Object.fromEntries(
    editableBlocks.value.map((block) => [block.id, block.content]),
  );
  directorIntent.value = '';
  authorConstraintRefs.value = '';
  participantRef.value = props.participants[0]?.participantRef ?? '';
  insertionAnchor.value = 'next';
  insertionStepRef.value = preferredStepRef();
  effectiveFromStepRef.value = preferredStepRef();
  grantMode.value = 'existingFact';
  factRefs.value = '';
  authorFact.value = '';
  authorFactVisibility.value = 'playerVisible';
}

function preferredStepRef(): string {
  return liveSteps.value.some((step) => step.id === props.activeStepRef)
    ? props.activeStepRef!
    : liveSteps.value.at(-1)?.id ?? '';
}

function updateProjection(blockId: string, event: Event): void {
  const input = event.currentTarget as HTMLTextAreaElement;
  projectionByBlockId.value = {
    ...projectionByBlockId.value,
    [blockId]: input.value,
  };
}

function submit(): void {
  if (!canSubmit.value) return;
  if (props.mode === 'modify') {
    if (modifyMode.value === 'redirectStep') {
      emit('submit', {
        kind: 'redirectStep',
        stepRef: targetStepRef.value,
        directorIntent: directorIntent.value.trim(),
        authorConstraintRefs: splitRefs(authorConstraintRefs.value),
      });
      return;
    }
    emit('submit', {
      kind: 'reviseProjection',
      stepRef: targetStepRef.value,
      replacementProjection: editableBlocks.value.map((block) => ({
        blockId: block.id,
        content: projectionByBlockId.value[block.id]!.trim(),
      })),
    });
    return;
  }
  if (props.mode === 'insertActor') {
    emit('submit', {
      kind: 'insertActor',
      participantRef: participantRef.value,
      anchor: insertionAnchor.value,
      ...(insertionAnchor.value !== 'next'
        ? { anchorStepRef: insertionStepRef.value }
        : {}),
    });
    return;
  }
  emit('submit', {
    kind: 'grantKnowledge',
    participantRef: participantRef.value,
    effectiveFromStepRef: effectiveFromStepRef.value,
    grant: grantMode.value === 'existingFact'
      ? { kind: 'existingFact', factRefs: splitRefs(factRefs.value) }
      : {
          kind: 'authorProvidedPlayFact',
          summary: authorFact.value.trim(),
          visibility: authorFactVisibility.value,
        },
  });
}

function splitRefs(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean))];
}
</script>

<template>
  <section
    class="play-director-intervention-panel"
    :aria-labelledby="panelId"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <header>
      <div>
        <span>试演内干预</span>
        <h2 :id="panelId" ref="heading" tabindex="-1">
          {{ mode === 'modify'
            ? '修改角色步骤'
            : mode === 'insertActor'
              ? '插入角色'
              : '授予参与者认知' }}
        </h2>
      </div>
      <button type="button" :disabled="busy" aria-label="关闭干预面板" @click="emit('close')">
        关闭
      </button>
    </header>

    <template v-if="mode === 'modify'">
      <div class="play-director-mode-tabs" role="group" aria-label="修改方式">
        <button
          type="button"
          :aria-pressed="modifyMode === 'reviseProjection'"
          :disabled="busy"
          @click="modifyMode = 'reviseProjection'"
        >修改呈现</button>
        <button
          type="button"
          :aria-pressed="modifyMode === 'redirectStep'"
          :disabled="busy"
          @click="modifyMode = 'redirectStep'"
        >改变走向</button>
      </div>

      <label>
        目标步骤
        <select v-model="targetStepRef" :disabled="busy">
          <option v-for="step in liveSteps" :key="step.id" :value="step.id">
            {{ step.participantName }} · {{ PLAY_REHEARSAL_STEP_STATUS_LABELS[step.status] ?? step.status }} · {{ step.id }}
          </option>
        </select>
      </label>

      <template v-if="modifyMode === 'reviseProjection'">
        <p>
          修改呈现只改叙述，宿主结算的效果和指纹不变。
        </p>
        <label v-for="block in editableBlocks" :key="block.id">
          {{ PLAY_NARRATIVE_BLOCK_KIND_LABELS[block.kind] ?? block.kind }} · {{ block.id }}
          <textarea
            :value="projectionByBlockId[block.id]"
            :disabled="busy"
            rows="3"
            @input="updateProjection(block.id, $event)"
          ></textarea>
        </label>
      </template>
      <template v-else>
        <p>改变走向会让裁判从目标步骤之前的状态重新生成一个结果。</p>
        <label>
          导演意图
          <textarea v-model="directorIntent" :disabled="busy" rows="4"></textarea>
        </label>
        <label>
          作者约束引用（逗号或空格分隔）
          <input v-model="authorConstraintRefs" :disabled="busy" />
        </label>
      </template>
    </template>

    <template v-else-if="mode === 'insertActor'">
      <label>
        场景参与者
        <select v-model="participantRef" :disabled="busy">
          <option v-for="participant in participants" :key="participant.participantRef" :value="participant.participantRef">
            {{ participant.displayName }}
          </option>
        </select>
      </label>
      <label>
        插入位置
        <select v-model="insertionAnchor" :disabled="busy">
          <option value="next">下一个未选定的位置</option>
          <option value="before">某个步骤之前</option>
          <option value="after">某个步骤之后</option>
        </select>
      </label>
      <label v-if="insertionAnchor !== 'next'">
        参照步骤
        <select v-model="insertionStepRef" :disabled="busy">
          <option v-for="step in liveSteps" :key="step.id" :value="step.id">{{ step.id }}</option>
        </select>
      </label>
      <p>调整角色顺序会保留旧结果，只替换受影响的后续步骤。</p>
    </template>

    <template v-else>
      <label>
        获得认知的参与者
        <select v-model="participantRef" :disabled="busy">
          <option v-for="participant in participants" :key="participant.participantRef" :value="participant.participantRef">
            {{ participant.displayName }}
          </option>
        </select>
      </label>
      <label>
        从这个步骤起生效
        <select v-model="effectiveFromStepRef" :disabled="busy">
          <option v-for="step in liveSteps" :key="step.id" :value="step.id">{{ step.id }}</option>
        </select>
      </label>
      <fieldset>
        <legend>认知依据</legend>
        <label><input v-model="grantMode" type="radio" value="existingFact" :disabled="busy" /> 已有的稳定事实</label>
        <label><input v-model="grantMode" type="radio" value="authorProvidedPlayFact" :disabled="busy" /> 作者提供的推演事实</label>
      </fieldset>
      <label v-if="grantMode === 'existingFact'">
        稳定事实引用（逗号或空格分隔）
        <input v-model="factRefs" :disabled="busy" />
      </label>
      <template v-else>
        <label>
          推演内事实
          <textarea v-model="authorFact" :disabled="busy" rows="3"></textarea>
        </label>
        <label>
          可见性
          <select v-model="authorFactVisibility" :disabled="busy">
            <option value="playerVisible">参与者可见</option>
            <option value="rumor">传闻</option>
            <option value="playerUnknown">仅导演可见</option>
          </select>
        </label>
      </template>
      <p>授予的认知只属于这个参与者和当前分支，不会改变事件的整体可见性。</p>
    </template>

    <footer>
      <button type="button" :disabled="busy" @click="emit('close')">返回</button>
      <button type="button" :disabled="!canSubmit" @click="submit">
        {{ busy ? 'Applying…' : '应用干预' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.play-director-intervention-panel {
  display: grid;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-director-intervention-panel > header,
.play-director-intervention-panel > footer,
.play-director-mode-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.play-director-mode-tabs {
  justify-content: flex-start;
}

.play-director-intervention-panel :where(h2, p, fieldset) {
  margin: 0;
}

.play-director-intervention-panel header span,
.play-director-intervention-panel p {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
  line-height: 1.5;
}

.play-director-intervention-panel h2 {
  font-size: 13px;
  outline: none;
}

.play-director-intervention-panel label,
.play-director-intervention-panel fieldset {
  display: grid;
  gap: 4px;
  min-width: 0;
  font-size: 10px;
}

.play-director-intervention-panel fieldset label {
  display: flex;
  align-items: center;
}

.play-director-intervention-panel :where(input:not([type='radio']), select, textarea) {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}

.play-director-intervention-panel textarea {
  resize: vertical;
}

.play-director-intervention-panel button {
  min-height: 34px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}

.play-director-intervention-panel > footer button:last-child {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}
</style>
