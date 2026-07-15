<script setup lang="ts">
import {
  computed,
  nextTick,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue';
import type { DeepReadonly } from 'vue';

import type { PlayCheckpointSummary } from '../../composables/useWorkspaceApi';

const props = withDefaults(defineProps<{
  checkpoints: DeepReadonly<PlayCheckpointSummary[]>;
  sessionRevision: number;
  loading: boolean;
  busyArtifactId: string;
  retryingArtifactId?: string;
  retryDisabled?: boolean;
  retryDisabledReason?: string;
  blocked: boolean;
  notice: string;
}>(), {
  retryingArtifactId: '',
  retryDisabled: false,
  retryDisabledReason: 'Configure a provider to Retry this settlement.',
});

const emit = defineEmits<{
  restore: [artifactId: string];
  retry: [artifactId: string];
}>();

type PendingActionKind = 'restore' | 'retry';

interface PendingHistoryAction {
  kind: PendingActionKind;
  artifactId: string;
}

interface HistoryGroup {
  id: 'checkpoints' | 'variants';
  title: 'Checkpoints' | 'Variants';
  emptyText: string;
  items: DeepReadonly<PlayCheckpointSummary[]>;
}

const headingId = `${useId()}-play-history-heading`;
const pendingAction = shallowRef<PendingHistoryAction>();
const restoreButtons = useTemplateRef<HTMLButtonElement[]>('restoreButtons');
const retryButtons = useTemplateRef<HTMLButtonElement[]>('retryButtons');
const confirmActionButtons = useTemplateRef<HTMLButtonElement[]>('confirmActionButtons');

const groups = computed<HistoryGroup[]>(() => [
  {
    id: 'checkpoints',
    title: 'Checkpoints',
    emptyText: 'No checkpoints on the selected path.',
    items: props.checkpoints.filter((checkpoint) => checkpoint.status !== 'variant'),
  },
  {
    id: 'variants',
    title: 'Variants',
    emptyText: 'No retained variants.',
    items: props.checkpoints.filter((checkpoint) => checkpoint.status === 'variant'),
  },
]);

const statusMessage = computed(() => {
  if (props.loading) {
    return 'Loading Play history…';
  }
  if (props.retryingArtifactId) {
    return 'Retrying from before the original turn… The existing result remains a variant.';
  }
  if (props.busyArtifactId) {
    return 'Restoring checkpoint…';
  }
  const retryNotice = props.retryDisabled && props.checkpoints.some(
    (checkpoint) => checkpoint.retryable,
  )
    ? props.retryDisabledReason
    : '';
  return [props.notice, retryNotice].filter(Boolean).join(' ');
});

watch(
  () => props.sessionRevision,
  () => {
    pendingAction.value = undefined;
  },
);

function checkpointLabel(checkpoint: DeepReadonly<PlayCheckpointSummary>): string {
  return checkpoint.preview.trim() || `Revision ${checkpoint.revision}`;
}

function checkpointStatus(checkpoint: DeepReadonly<PlayCheckpointSummary>): string {
  switch (checkpoint.status) {
    case 'current': return 'Current';
    case 'selectedAncestor': return 'Selected path';
    case 'variant': return 'Variant';
  }
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

function isActionUnavailable(kind: PendingActionKind): boolean {
  return props.blocked ||
    props.loading ||
    Boolean(props.busyArtifactId) ||
    Boolean(props.retryingArtifactId) ||
    (kind === 'retry' && props.retryDisabled);
}

async function requestAction(kind: PendingActionKind, artifactId: string): Promise<void> {
  if (isActionUnavailable(kind)) {
    return;
  }

  pendingAction.value = { kind, artifactId };
  await nextTick();
  confirmActionButtons.value?.[0]?.focus();
}

async function cancelAction(): Promise<void> {
  const action = pendingAction.value;
  if (!action) {
    return;
  }

  pendingAction.value = undefined;
  await nextTick();
  const buttons = action.kind === 'retry' ? retryButtons.value : restoreButtons.value;
  buttons
    ?.find((button) => button.dataset.artifactId === action.artifactId)
    ?.focus();
}

function confirmAction(): void {
  const action = pendingAction.value;
  if (!action || isActionUnavailable(action.kind)) {
    return;
  }

  pendingAction.value = undefined;
  if (action.kind === 'retry') {
    emit('retry', action.artifactId);
  } else {
    emit('restore', action.artifactId);
  }
}
</script>

<template>
  <section
    class="play-history-controls"
    :aria-labelledby="headingId"
    :aria-busy="loading || Boolean(busyArtifactId) || Boolean(retryingArtifactId)"
  >
    <header class="play-history-heading">
      <h3 :id="headingId">Checkpoints / Variants</h3>
      <span>Session revision {{ sessionRevision }}</span>
    </header>

    <section
      v-for="group in groups"
      :key="group.id"
      class="play-history-group"
      :aria-label="group.title"
    >
      <h4>{{ group.title }}</h4>
      <ul v-if="group.items.length" class="play-history-list">
        <li
          v-for="checkpoint in group.items"
          :key="checkpoint.artifactId"
          class="play-history-item"
          :aria-current="checkpoint.status === 'current' ? 'true' : undefined"
        >
          <div class="play-history-item-copy">
            <strong>{{ checkpointLabel(checkpoint) }}</strong>
            <span>{{ checkpointStatus(checkpoint) }}</span>
            <small>
              Revision {{ checkpoint.revision }} · World turn {{ checkpoint.worldTurn }} ·
              {{ formatTime(checkpoint.committedAt) }}
            </small>
          </div>

          <div
            v-if="pendingAction?.artifactId !== checkpoint.artifactId"
            class="play-history-actions"
          >
            <button
              v-if="checkpoint.restorable"
              ref="restoreButtons"
              class="play-history-restore"
              type="button"
              :data-artifact-id="checkpoint.artifactId"
              :disabled="isActionUnavailable('restore')"
              :aria-label="`Restore ${checkpointLabel(checkpoint)}`"
              @click="requestAction('restore', checkpoint.artifactId)"
            >
              {{ busyArtifactId === checkpoint.artifactId ? 'Restoring…' : 'Restore' }}
            </button>
            <button
              v-if="checkpoint.retryable"
              ref="retryButtons"
              class="play-history-retry"
              type="button"
              :data-artifact-id="checkpoint.artifactId"
              :disabled="isActionUnavailable('retry')"
              :title="retryDisabled ? retryDisabledReason : undefined"
              :aria-label="`Retry ${checkpointLabel(checkpoint)} from before the turn`"
              @click="requestAction('retry', checkpoint.artifactId)"
            >
              {{ retryingArtifactId === checkpoint.artifactId ? 'Retrying…' : 'Retry' }}
            </button>
          </div>

          <div
            v-if="pendingAction?.artifactId === checkpoint.artifactId"
            class="play-history-confirmation"
            role="group"
            :aria-label="pendingAction.kind === 'retry' ? 'Confirm settlement Retry' : 'Confirm checkpoint restore'"
            @keydown.esc.stop.prevent="cancelAction"
          >
            <p v-if="pendingAction.kind === 'retry'">
              Retry from before this turn? The existing result is preserved as a variant.
            </p>
            <p v-else>Restore this checkpoint? Later turns remain variants and are not deleted.</p>
            <div class="play-history-confirmation-actions">
              <button type="button" @click="cancelAction">Cancel</button>
              <button
                ref="confirmActionButtons"
                class="play-history-confirm"
                type="button"
                :disabled="isActionUnavailable(pendingAction.kind)"
                @click="confirmAction"
              >
                {{ pendingAction.kind === 'retry' ? 'Confirm Retry' : 'Confirm restore' }}
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="play-history-empty">{{ group.emptyText }}</p>
    </section>

    <p
      class="play-history-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ statusMessage }}
    </p>
  </section>
</template>
