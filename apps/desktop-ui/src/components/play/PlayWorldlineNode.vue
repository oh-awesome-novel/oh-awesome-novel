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
}>(), {
  retryingCheckpointId: '',
  namingCheckpointId: '',
  retryDisabled: false,
  retryDisabledReason: 'Configure a provider to Retry this settlement.',
});

const emit = defineEmits<{
  restore: [checkpointId: string];
  retry: [checkpointId: string];
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
const checkpointLabel = computed(() =>
  checkpointName.value || props.checkpoint.preview.trim() || (
    checkpointKind.value === 'initialWorld'
      ? 'Initial world'
      : `World turn ${props.checkpoint.worldTurn}`
  ));
const checkpointPreview = computed(() =>
  checkpointName.value && props.checkpoint.preview.trim() !== checkpointName.value
    ? props.checkpoint.preview.trim()
    : '');
const checkpointStatus = computed(() => {
  switch (props.checkpoint.status) {
    case 'current': return 'Current worldline';
    case 'selectedAncestor': return 'On current worldline';
    case 'variant': return 'Retained outcome';
  }
});
const worldMoment = computed(() => checkpointKind.value === 'initialWorld'
  ? `Starting point · ${formatTime(props.checkpoint.committedAt)}`
  : `World turn ${props.checkpoint.worldTurn} · ${formatTime(props.checkpoint.committedAt)}`);
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
  rememberSubmittedAction(action);
  pendingAction.value = undefined;
  if (action === 'retry') {
    emit('retry', checkpointId.value);
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
    : date.toLocaleString([], {
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
        :aria-label="`${checkpointName ? 'Rename' : 'Name'} ${checkpointLabel}`"
        @click="startNaming"
      >
        {{ namingCheckpointId === checkpointId
          ? 'Saving name…'
          : checkpointName ? 'Rename' : 'Name' }}
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
          ? 'Return to the initial world'
          : `Continue from ${checkpointLabel}`"
        @click="requestAction('restore')"
      >
        {{ busyCheckpointId === checkpointId
          ? 'Restoring…'
          : checkpointKind === 'initialWorld' ? 'Return here' : 'Continue here' }}
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
        :aria-label="`Retry ${checkpointLabel} from before the turn`"
        @click="requestAction('retry')"
      >
        {{ retryingCheckpointId === checkpointId ? 'Retrying…' : 'Retry turn' }}
      </button>
    </div>

    <form
      v-if="naming"
      class="play-worldline-name-form"
      aria-label="Name worldline point"
      @submit.prevent="submitName"
      @keydown.esc.stop.prevent="cancelNaming"
    >
      <label :for="`${checkpointId}-worldline-name`">Worldline point name</label>
      <input
        :id="`${checkpointId}-worldline-name`"
        ref="nameInput"
        v-model="nameDraft"
        type="text"
        maxlength="80"
        autocomplete="off"
      />
      <div class="play-worldline-name-actions">
        <button type="button" @click="cancelNaming">Cancel</button>
        <button type="submit" :disabled="!nameIsValid">Save name</button>
      </div>
    </form>

    <div
      v-if="pendingAction"
      class="play-history-confirmation"
      role="group"
      :aria-label="pendingAction === 'retry'
        ? 'Confirm settlement Retry'
        : 'Confirm worldline restore'"
      @keydown.esc.stop.prevent="cancelAction"
    >
      <p v-if="pendingAction === 'retry'">
        Retry from before this turn? The existing result is preserved as a variant,
        shown here as a retained outcome.
      </p>
      <p v-else-if="checkpointKind === 'initialWorld'">
        Return to the initial world? Later turns remain variants and are not deleted.
      </p>
      <p v-else>
        Continue from this point? Later turns remain variants and are not deleted.
      </p>
      <div class="play-history-confirmation-actions">
        <button type="button" @click="cancelAction">Cancel</button>
        <button
          ref="confirmActionButton"
          class="play-history-confirm"
          type="button"
          :disabled="isActionUnavailable(pendingAction)"
          @click="confirmAction"
        >
          {{ pendingAction === 'retry' ? 'Confirm Retry' : 'Confirm restore' }}
        </button>
      </div>
    </div>

    <details class="play-worldline-technical">
      <summary>Technical details</summary>
      <p class="play-worldline-session-revision">
        Session revision {{ sessionRevision }}
      </p>
      <dl>
        <dt>Checkpoint</dt>
        <dd>{{ checkpointId }}</dd>
        <template v-if="checkpoint.artifactId">
          <dt>Artifact</dt>
          <dd>{{ checkpoint.artifactId }}</dd>
        </template>
        <template v-if="parentCheckpointId">
          <dt>Parent</dt>
          <dd>{{ parentCheckpointId }}</dd>
        </template>
        <dt>Depth</dt>
        <dd>{{ checkpointDepth }}</dd>
        <dt>Revision</dt>
        <dd>{{ checkpoint.revision }}</dd>
        <dt>Selected path</dt>
        <dd>{{ checkpoint.selectedTurnIds.join(' → ') || 'Initial world' }}</dd>
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
