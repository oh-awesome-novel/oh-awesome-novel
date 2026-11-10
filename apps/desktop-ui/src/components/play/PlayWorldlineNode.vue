<script setup lang="ts">
import {
  computed,
  nextTick,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import type { CSSProperties, DeepReadonly } from 'vue';

import type { PlayCheckpointSummary } from '../../composables/useWorkspaceApi';

type PendingActionKind = 'restore' | 'retry';
type SubmittedActionKind = PendingActionKind | 'name';
type WorldlineCheckpoint = DeepReadonly<PlayCheckpointSummary> & {
  checkpointId?: string;
  kind?: 'initialWorld' | 'turn';
  parentCheckpointId?: string;
  depth?: number;
  name?: string;
};

const props = withDefaults(defineProps<{
  checkpoint: WorldlineCheckpoint;
  sessionRevision: number;
  loading: boolean;
  busyCheckpointId: string;
  retryingCheckpointId?: string;
  namingCheckpointId?: string;
  retryDisabled?: boolean;
  retryDisabledReason?: string;
  blocked: boolean;
  /** Director view; only then may the guided Retry note be shown. */
  directorLens?: boolean;
}>(), {
  retryingCheckpointId: '',
  namingCheckpointId: '',
  retryDisabled: false,
  retryDisabledReason: '配置模型后才能重演这一回合。',
  directorLens: false,
});

const emit = defineEmits<{
  restore: [checkpointId: string];
  retry: [checkpointId: string, guidance?: string];
  name: [checkpointId: string, name: string];
}>();

const pendingAction = shallowRef<PendingActionKind>();
const submittedAction = shallowRef<{
  kind: SubmittedActionKind;
  baseRevision: number;
  observedBusy: boolean;
}>();
const naming = shallowRef(false);
const nameDraft = shallowRef('');
const guidanceDraft = shallowRef('');
const MAX_GUIDANCE_LENGTH = 500;
const guidanceLength = computed(() => [...guidanceDraft.value.trim()].length);
const guidanceTooLong = computed(() => guidanceLength.value > MAX_GUIDANCE_LENGTH);
const retryGuidance = computed(() =>
  props.directorLens ? props.checkpoint.retryGuidance?.trim() ?? '' : '');
const node = useTemplateRef<HTMLLIElement>('node');
const restoreButton = useTemplateRef<HTMLButtonElement>('restoreButton');
const retryButton = useTemplateRef<HTMLButtonElement>('retryButton');
const nameButton = useTemplateRef<HTMLButtonElement>('nameButton');
const nameInput = useTemplateRef<HTMLInputElement>('nameInput');
const confirmActionButton = useTemplateRef<HTMLButtonElement>('confirmActionButton');

const checkpointId = computed(() => checkpointIdOf(props.checkpoint));
const checkpointKind = computed(() =>
  props.checkpoint.kind ?? (checkpointId.value === 'initial-world' ? 'initialWorld' : 'turn'));
const checkpointDepth = computed(() =>
  props.checkpoint.depth ?? Math.max(0, props.checkpoint.selectedTurnIds.length));
const checkpointName = computed(() => props.checkpoint.name?.trim() ?? '');
// Host fallbacks (no author input to summarize) are fixed English identifiers; author text passes through.
const hostPreview = computed(() => {
  const preview = props.checkpoint.preview.trim();
  if (checkpointKind.value === 'initialWorld' && preview === 'Initial world') return '初始世界';
  if (preview === 'Imported starting point') return '导入的起点';
  const turn = /^World turn (\d+)$/u.exec(preview);
  return turn ? `第 ${turn[1]} 回合` : preview;
});
const checkpointLabel = computed(() =>
  checkpointName.value || hostPreview.value || (
    checkpointKind.value === 'initialWorld'
      ? '初始世界'
      : `第 ${props.checkpoint.worldTurn} 回合`
  ));
const checkpointPreview = computed(() =>
  checkpointName.value && hostPreview.value !== checkpointName.value
    ? hostPreview.value
    : '');
const checkpointStatus = computed(() => {
  switch (props.checkpoint.status) {
    case 'current': return '当前位置';
    case 'selectedAncestor': return '当前世界线';
    case 'variant': return '保留的另一结果';
  }
});
const worldMoment = computed(() => checkpointKind.value === 'initialWorld'
  ? `起点 · ${formatTime(props.checkpoint.committedAt)}`
  : `第 ${props.checkpoint.worldTurn} 回合 · ${formatTime(props.checkpoint.committedAt)}`);
const nodeStyle = computed<CSSProperties>(() => ({
  marginInlineStart: `${Math.min(checkpointDepth.value, 6) * 8}px`,
}));
const actionUnavailable = computed(() =>
  props.blocked ||
  props.loading ||
  Boolean(props.busyCheckpointId) ||
  Boolean(props.retryingCheckpointId) ||
  Boolean(props.namingCheckpointId));
const normalizedNameDraft = computed(() => nameDraft.value.trim());
const nameIsValid = computed(() =>
  normalizedNameDraft.value.length > 0 &&
  normalizedNameDraft.value.length <= 80 &&
  normalizedNameDraft.value !== checkpointName.value);
const parentCheckpointId = computed(() => {
  if (props.checkpoint.parentCheckpointId) {
    return props.checkpoint.parentCheckpointId;
  }
  return 'parentArtifactId' in props.checkpoint
    ? props.checkpoint.parentArtifactId
    : undefined;
});

watch(
  () => props.sessionRevision,
  async (sessionRevision) => {
    const completedAction = submittedAction.value;
    pendingAction.value = undefined;
    naming.value = false;
    if (!completedAction || sessionRevision === completedAction.baseRevision) {
      return;
    }
    submittedAction.value = undefined;
    await nextTick();
    node.value?.focus();
  },
);

watch(
  () => [
    props.busyCheckpointId,
    props.retryingCheckpointId,
    props.namingCheckpointId,
  ] as const,
  async () => {
    const action = submittedAction.value;
    if (!action) return;

    const activeCheckpointId = action.kind === 'restore'
      ? props.busyCheckpointId
      : action.kind === 'retry'
        ? props.retryingCheckpointId
        : props.namingCheckpointId;
    if (activeCheckpointId === checkpointId.value) {
      if (!action.observedBusy) {
        submittedAction.value = { ...action, observedBusy: true };
      }
      return;
    }
    if (!action.observedBusy || props.sessionRevision !== action.baseRevision) {
      return;
    }

    submittedAction.value = undefined;
    await nextTick();
    focusActionControl(action.kind);
  },
);

async function requestAction(kind: PendingActionKind): Promise<void> {
  if (isActionUnavailable(kind)) return;
  naming.value = false;
  pendingAction.value = kind;
  if (kind === 'retry') guidanceDraft.value = '';
  await nextTick();
  confirmActionButton.value?.focus();
}

async function cancelAction(): Promise<void> {
  const action = pendingAction.value;
  if (!action) return;
  pendingAction.value = undefined;
  await nextTick();
  (action === 'retry' ? retryButton.value : restoreButton.value)?.focus();
}

function confirmAction(): void {
  const action = pendingAction.value;
  if (!action || isActionUnavailable(action)) return;
  if (action === 'retry' && guidanceTooLong.value) return;
  rememberSubmittedAction(action);
  pendingAction.value = undefined;
  if (action === 'retry') {
    const guidance = guidanceDraft.value.trim();
    guidanceDraft.value = '';
    if (guidance) emit('retry', checkpointId.value, guidance);
    else emit('retry', checkpointId.value);
  } else {
    emit('restore', checkpointId.value);
  }
}

async function startNaming(): Promise<void> {
  if (actionUnavailable.value) return;
  pendingAction.value = undefined;
  nameDraft.value = checkpointName.value;
  naming.value = true;
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}

async function cancelNaming(): Promise<void> {
  if (!naming.value) return;
  naming.value = false;
  await nextTick();
  nameButton.value?.focus();
}

function submitName(): void {
  if (actionUnavailable.value || !nameIsValid.value) return;
  const name = normalizedNameDraft.value;
  rememberSubmittedAction('name');
  naming.value = false;
  emit('name', checkpointId.value, name);
}

function rememberSubmittedAction(kind: SubmittedActionKind): void {
  submittedAction.value = {
    kind,
    baseRevision: props.sessionRevision,
    observedBusy: false,
  };
}

function focusActionControl(kind: SubmittedActionKind): void {
  if (kind === 'retry') {
    retryButton.value?.focus();
    return;
  }
  if (kind === 'restore') {
    restoreButton.value?.focus();
    return;
  }
  nameButton.value?.focus();
}

function isActionUnavailable(kind: PendingActionKind): boolean {
  return actionUnavailable.value || (kind === 'retry' && props.retryDisabled);
}

function checkpointIdOf(checkpoint: WorldlineCheckpoint): string {
  return checkpoint.checkpointId ?? checkpoint.artifactId ?? '';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
</script>

<template>
  <li
    ref="node"
    class="play-history-item play-worldline-node"
    :class="{
      'play-worldline-initial': checkpointKind === 'initialWorld',
      'play-worldline-variant': checkpoint.status === 'variant',
    }"
    :style="nodeStyle"
    :data-worldline-checkpoint="checkpointId"
    :aria-current="checkpoint.status === 'current' ? 'step' : undefined"
    tabindex="-1"
  >
    <div class="play-history-item-copy">
      <div class="play-worldline-node-meta">
        <span>{{ checkpointStatus }}</span>
        <small>{{ worldMoment }}</small>
      </div>
      <strong>{{ checkpointLabel }}</strong>
      <p v-if="checkpointPreview" class="play-worldline-preview">
        {{ checkpointPreview }}
      </p>
      <p v-if="retryGuidance" class="play-worldline-guidance">
        <span>重演要求（导演视角）</span>
        {{ retryGuidance }}
      </p>
    </div>

    <div
      v-if="!pendingAction && !naming"
      class="play-history-actions"
    >
      <button
        ref="nameButton"
        class="play-worldline-name"
        type="button"
        :disabled="actionUnavailable"
        :aria-label="`${checkpointName ? '重命名' : '命名'} ${checkpointLabel}`"
        @click="startNaming"
      >
        {{ namingCheckpointId === checkpointId
          ? '正在保存…'
          : checkpointName ? '重命名' : '命名' }}
      </button>
      <button
        v-if="checkpoint.restorable"
        ref="restoreButton"
        class="play-history-restore"
        type="button"
        :data-checkpoint-id="checkpointId"
        :data-artifact-id="checkpointId"
        :disabled="isActionUnavailable('restore')"
        :aria-label="checkpointKind === 'initialWorld'
          ? '回到初始世界'
          : `回到 ${checkpointLabel}`"
        @click="requestAction('restore')"
      >
        {{ busyCheckpointId === checkpointId ? '正在回到这里…' : '回到这里' }}
      </button>
      <button
        v-if="checkpoint.retryable"
        ref="retryButton"
        class="play-history-retry"
        type="button"
        :data-checkpoint-id="checkpointId"
        :data-artifact-id="checkpointId"
        :disabled="isActionUnavailable('retry')"
        :title="retryDisabled ? retryDisabledReason : undefined"
        :aria-label="`从回合开始前重演 ${checkpointLabel}`"
        @click="requestAction('retry')"
      >
        {{ retryingCheckpointId === checkpointId ? '正在重演…' : '重演' }}
      </button>
    </div>

    <form
      v-if="naming"
      class="play-worldline-name-form"
      aria-label="命名存档点"
      @submit.prevent="submitName"
      @keydown.esc.stop.prevent="cancelNaming"
    >
      <label :for="`${checkpointId}-worldline-name`">存档点名称</label>
      <input
        :id="`${checkpointId}-worldline-name`"
        ref="nameInput"
        v-model="nameDraft"
        type="text"
        maxlength="80"
        autocomplete="off"
      />
      <div class="play-worldline-name-actions">
        <button type="button" @click="cancelNaming">取消</button>
        <button type="submit" :disabled="!nameIsValid">保存名称</button>
      </div>
    </form>

    <div
      v-if="pendingAction"
      class="play-history-confirmation"
      role="group"
      :aria-label="pendingAction === 'retry'
        ? '确认重演'
        : '确认回到这里'"
      @keydown.esc.stop.prevent="cancelAction"
    >
      <template v-if="pendingAction === 'retry'">
        <p>
          从这一回合开始前重演？行动不变，现有结果会保留为另一个结果。
        </p>
        <label class="play-retry-guidance-label" :for="`${checkpointId}-retry-guidance`">
          这次希望有什么不同（可选）
        </label>
        <textarea
          :id="`${checkpointId}-retry-guidance`"
          v-model="guidanceDraft"
          class="play-retry-guidance"
          rows="3"
          placeholder="例如：别让她这么快妥协；让对话更紧张一些。"
          :aria-invalid="guidanceTooLong"
          :aria-describedby="`${checkpointId}-retry-guidance-hint`"
        ></textarea>
        <small
          :id="`${checkpointId}-retry-guidance-hint`"
          class="play-retry-guidance-hint"
          :class="{ 'play-retry-guidance-error': guidanceTooLong }"
        >
          {{ guidanceTooLong
            ? `最多 ${MAX_GUIDANCE_LENGTH} 字，当前 ${guidanceLength} 字。`
            : `只用于这一次重演，不会带到后续回合；参与者视角看不到。${guidanceLength}/${MAX_GUIDANCE_LENGTH}` }}
        </small>
      </template>
      <p v-else-if="checkpointKind === 'initialWorld'">
        回到初始世界？之后的回合会保留为其他结果，不会删除。
      </p>
      <p v-else>
        回到这个存档点继续？之后的回合会保留为其他结果，不会删除。
      </p>
      <div class="play-history-confirmation-actions">
        <button type="button" @click="cancelAction">取消</button>
        <button
          ref="confirmActionButton"
          class="play-history-confirm"
          type="button"
          :disabled="isActionUnavailable(pendingAction) || (pendingAction === 'retry' && guidanceTooLong)"
          @click="confirmAction"
        >
          {{ pendingAction === 'retry' ? '确认重演' : '确认回到这里' }}
        </button>
      </div>
    </div>

    <details class="play-worldline-technical">
      <summary>技术细节</summary>
      <p class="play-worldline-session-revision">
        会话 revision {{ sessionRevision }}
      </p>
      <dl>
        <dt>存档点</dt>
        <dd>{{ checkpointId }}</dd>
        <template v-if="checkpoint.artifactId">
          <dt>Artifact</dt>
          <dd>{{ checkpoint.artifactId }}</dd>
        </template>
        <template v-if="parentCheckpointId">
          <dt>上一节点</dt>
          <dd>{{ parentCheckpointId }}</dd>
        </template>
        <dt>深度</dt>
        <dd>{{ checkpointDepth }}</dd>
        <dt>Revision</dt>
        <dd>{{ checkpoint.revision }}</dd>
        <dt>选中路径</dt>
        <dd>{{ checkpoint.selectedTurnIds.join(' → ') || '初始世界' }}</dd>
      </dl>
    </details>
  </li>
</template>

<style scoped>
.play-worldline-node {
  border-inline-start: 2px solid var(--play-line-strong);
}

.play-worldline-initial {
  border-inline-start-color: var(--play-ink);
}

.play-worldline-variant {
  border-inline-start-style: dashed;
}

.play-worldline-node-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 8px;
}

.play-worldline-node-meta span,
.play-worldline-node-meta small,
.play-worldline-preview,
.play-worldline-technical summary,
.play-worldline-technical dt,
.play-worldline-technical dd,
.play-worldline-name-form label {
  color: var(--play-muted);
  font-size: 10px;
}

.play-worldline-preview {
  margin: 1px 0 0;
  line-height: 1.45;
}

.play-worldline-guidance {
  margin: 4px 0 0;
  padding: 4px 6px;
  border-inline-start: 2px solid var(--play-line-strong);
  color: var(--play-body);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.play-worldline-guidance span {
  display: block;
  color: var(--play-muted);
  font-size: 10px;
}

.play-retry-guidance-label {
  display: block;
  margin-top: 6px;
  color: var(--play-muted);
  font-size: 10px;
  font-weight: 700;
}

.play-retry-guidance {
  box-sizing: border-box;
  width: 100%;
  min-height: 56px;
  margin-top: 4px;
  padding: 6px 7px;
  border: 1px solid var(--play-line-strong);
  background: var(--play-canvas);
  color: var(--play-ink);
  font: inherit;
  font-size: 11px;
  resize: vertical;
}

.play-retry-guidance-hint {
  display: block;
  margin-top: 3px;
  color: var(--play-muted);
  font-size: 10px;
}

.play-retry-guidance-error {
  color: var(--play-danger, #b42318);
}

.play-worldline-name,
.play-worldline-name-form button {
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid var(--play-line-strong);
  background: var(--play-canvas);
  color: var(--play-body);
  font-size: 10px;
  font-weight: 700;
}

.play-worldline-name-form {
  display: grid;
  gap: 6px;
  padding-top: 7px;
  border-top: 1px solid var(--play-line);
}

.play-worldline-name-form input {
  min-width: 0;
  min-height: 30px;
  padding: 0 7px;
  border: 1px solid var(--play-line-strong);
  background: var(--play-canvas);
  color: var(--play-ink);
  font: inherit;
}

.play-worldline-name-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.play-worldline-technical {
  padding-top: 6px;
  border-top: 1px solid var(--play-line);
}

.play-worldline-technical summary {
  cursor: pointer;
  font-weight: 700;
}

.play-worldline-technical dl {
  display: grid;
  grid-template-columns: minmax(0, .65fr) minmax(0, 1.35fr);
  gap: 3px 8px;
  margin: 6px 0 0;
}

.play-worldline-session-revision {
  margin: 6px 0 0;
  color: var(--play-muted);
  font-size: 10px;
}

.play-worldline-technical dt,
.play-worldline-technical dd {
  overflow-wrap: anywhere;
}

.play-worldline-technical dd {
  margin: 0;
  color: var(--play-body);
}
</style>
