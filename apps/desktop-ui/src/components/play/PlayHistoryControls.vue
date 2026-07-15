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

const props = defineProps<{
  checkpoints: DeepReadonly<PlayCheckpointSummary[]>;
  sessionRevision: number;
  loading: boolean;
  busyArtifactId: string;
  blocked: boolean;
  notice: string;
}>();

const emit = defineEmits<{
  restore: [artifactId: string];
}>();

interface HistoryGroup {
  id: 'checkpoints' | 'variants';
  title: 'Checkpoints' | 'Variants';
  emptyText: string;
  items: DeepReadonly<PlayCheckpointSummary[]>;
}

const headingId = `${useId()}-play-history-heading`;
const pendingArtifactId = shallowRef('');
const restoreButtons = useTemplateRef<HTMLButtonElement[]>('restoreButtons');
const confirmRestoreButtons = useTemplateRef<HTMLButtonElement[]>('confirmRestoreButtons');

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
  if (props.busyArtifactId) {
    return 'Restoring checkpoint…';
  }
  return props.notice;
});

watch(
  () => props.sessionRevision,
  () => {
    pendingArtifactId.value = '';
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

async function requestRestore(artifactId: string): Promise<void> {
  if (props.blocked || props.loading || props.busyArtifactId) {
    return;
  }

  pendingArtifactId.value = artifactId;
  await nextTick();
  confirmRestoreButtons.value?.[0]?.focus();
}

async function cancelRestore(): Promise<void> {
  const artifactId = pendingArtifactId.value;
  if (!artifactId) {
    return;
  }

  pendingArtifactId.value = '';
  await nextTick();
  restoreButtons.value
    ?.find((button) => button.dataset.artifactId === artifactId)
    ?.focus();
}

function confirmRestore(): void {
  const artifactId = pendingArtifactId.value;
  if (
    !artifactId ||
    props.blocked ||
    props.loading ||
    props.busyArtifactId
  ) {
    return;
  }

  pendingArtifactId.value = '';
  emit('restore', artifactId);
}
</script>

<template>
  <section
    class="play-history-controls"
    :aria-labelledby="headingId"
    :aria-busy="loading || Boolean(busyArtifactId)"
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

          <button
            v-if="checkpoint.restorable && pendingArtifactId !== checkpoint.artifactId"
            ref="restoreButtons"
            class="play-history-restore"
            type="button"
            :data-artifact-id="checkpoint.artifactId"
            :disabled="blocked || loading || Boolean(busyArtifactId)"
            :aria-label="`Restore ${checkpointLabel(checkpoint)}`"
            @click="requestRestore(checkpoint.artifactId)"
          >
            {{ busyArtifactId === checkpoint.artifactId ? 'Restoring…' : 'Restore' }}
          </button>

          <div
            v-if="pendingArtifactId === checkpoint.artifactId"
            class="play-history-confirmation"
            role="group"
            aria-label="Confirm checkpoint restore"
            @keydown.esc.stop.prevent="cancelRestore"
          >
            <p>Restore this checkpoint? Later turns remain variants and are not deleted.</p>
            <div class="play-history-confirmation-actions">
              <button type="button" @click="cancelRestore">Cancel</button>
              <button
                ref="confirmRestoreButtons"
                class="play-history-confirm"
                type="button"
                :disabled="blocked || loading || Boolean(busyArtifactId)"
                @click="confirmRestore"
              >
                Confirm restore
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
