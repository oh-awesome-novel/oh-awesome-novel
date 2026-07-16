<script setup lang="ts">
import { computed, useId } from 'vue';
import type { DeepReadonly } from 'vue';

import type { PlayCheckpointSummary } from '../../composables/useWorkspaceApi';
import PlayWorldlineNode from './PlayWorldlineNode.vue';

type HistoryCheckpoint = DeepReadonly<PlayCheckpointSummary> & {
  checkpointId?: string;
  kind?: 'initialWorld' | 'turn';
  parentCheckpointId?: string;
  depth?: number;
  name?: string;
};

const props = withDefaults(defineProps<{
  checkpoints: DeepReadonly<PlayCheckpointSummary[]>;
  sessionRevision: number;
  loading: boolean;
  busyArtifactId: string;
  retryingArtifactId?: string;
  namingCheckpointId?: string;
  retryDisabled?: boolean;
  retryDisabledReason?: string;
  blocked: boolean;
  notice: string;
}>(), {
  retryingArtifactId: '',
  namingCheckpointId: '',
  retryDisabled: false,
  retryDisabledReason: 'Configure a provider to Retry this settlement.',
});

const emit = defineEmits<{
  restore: [checkpointId: string];
  retry: [checkpointId: string];
  name: [checkpointId: string, name: string];
}>();

const headingId = `${useId()}-play-worldline-heading`;
const worldline = computed(() => orderWorldline(
  props.checkpoints as readonly HistoryCheckpoint[],
));
const statusMessage = computed(() => {
  if (props.loading) {
    return 'Loading worldline…';
  }
  if (props.retryingArtifactId) {
    return 'Retrying from before the original turn… The existing result remains a variant.';
  }
  if (props.busyArtifactId) {
    return 'Restoring worldline…';
  }
  if (props.namingCheckpointId) {
    return 'Saving worldline point name…';
  }
  const retryNotice = props.retryDisabled && props.checkpoints.some(
    (checkpoint) => checkpoint.retryable,
  )
    ? props.retryDisabledReason
    : '';
  return [props.notice, retryNotice].filter(Boolean).join(' ');
});

function forwardName(checkpointId: string, name: string): void {
  emit('name', checkpointId, name);
}

function orderWorldline(
  checkpoints: readonly HistoryCheckpoint[],
): HistoryCheckpoint[] {
  const byId = new Map(checkpoints.map((checkpoint) => [
    checkpointIdOf(checkpoint),
    checkpoint,
  ]));
  const childrenByParent = new Map<string, HistoryCheckpoint[]>();
  const roots: HistoryCheckpoint[] = [];

  for (const checkpoint of checkpoints) {
    const parentId = parentCheckpointIdOf(checkpoint);
    if (!parentId || !byId.has(parentId)) {
      roots.push(checkpoint);
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(checkpoint);
    childrenByParent.set(parentId, children);
  }

  roots.sort(compareWorldlineNodes);
  for (const children of childrenByParent.values()) {
    children.sort(compareWorldlineNodes);
  }

  const ordered: HistoryCheckpoint[] = [];
  const visited = new Set<string>();
  const visit = (checkpoint: HistoryCheckpoint): void => {
    const checkpointId = checkpointIdOf(checkpoint);
    if (!checkpointId || visited.has(checkpointId)) return;
    visited.add(checkpointId);
    ordered.push(checkpoint);
    for (const child of childrenByParent.get(checkpointId) ?? []) {
      visit(child);
    }
  };

  for (const root of roots) visit(root);
  for (const checkpoint of [...checkpoints].sort(compareWorldlineNodes)) {
    visit(checkpoint);
  }
  return ordered;
}

function compareWorldlineNodes(
  left: HistoryCheckpoint,
  right: HistoryCheckpoint,
): number {
  const leftInitial = checkpointKindOf(left) === 'initialWorld' ? 0 : 1;
  const rightInitial = checkpointKindOf(right) === 'initialWorld' ? 0 : 1;
  return leftInitial - rightInitial ||
    statusOrder(left.status) - statusOrder(right.status) ||
    checkpointDepthOf(left) - checkpointDepthOf(right) ||
    left.revision - right.revision ||
    left.committedAt.localeCompare(right.committedAt) ||
    checkpointIdOf(left).localeCompare(checkpointIdOf(right));
}

function statusOrder(status: PlayCheckpointSummary['status']): number {
  return status === 'variant' ? 1 : 0;
}

function checkpointIdOf(checkpoint: HistoryCheckpoint): string {
  return checkpoint.checkpointId ?? checkpoint.artifactId ?? '';
}

function checkpointKindOf(
  checkpoint: HistoryCheckpoint,
): 'initialWorld' | 'turn' {
  return checkpoint.kind ?? (
    checkpointIdOf(checkpoint) === 'initial-world' ? 'initialWorld' : 'turn'
  );
}

function parentCheckpointIdOf(checkpoint: HistoryCheckpoint): string | undefined {
  if (checkpoint.parentCheckpointId) return checkpoint.parentCheckpointId;
  const legacyParentId = 'parentArtifactId' in checkpoint
    ? checkpoint.parentArtifactId
    : undefined;
  return typeof legacyParentId === 'string' ? legacyParentId : undefined;
}

function checkpointDepthOf(checkpoint: HistoryCheckpoint): number {
  return checkpoint.depth ?? checkpoint.selectedTurnIds.length;
}
</script>

<template>
  <section
    class="play-history-controls"
    :aria-labelledby="headingId"
    :aria-busy="loading || Boolean(busyArtifactId) || Boolean(retryingArtifactId) || Boolean(namingCheckpointId)"
  >
    <header class="play-history-heading">
      <h3 :id="headingId">Worldline</h3>
      <span>Current path and retained outcomes</span>
    </header>

    <ol v-if="worldline.length" class="play-history-list play-worldline-list">
      <PlayWorldlineNode
        v-for="checkpoint in worldline"
        :key="checkpointIdOf(checkpoint)"
        :checkpoint="checkpoint"
        :session-revision="sessionRevision"
        :loading="loading"
        :busy-checkpoint-id="busyArtifactId"
        :retrying-checkpoint-id="retryingArtifactId"
        :naming-checkpoint-id="namingCheckpointId"
        :retry-disabled="retryDisabled"
        :retry-disabled-reason="retryDisabledReason"
        :blocked="blocked"
        @restore="emit('restore', $event)"
        @retry="emit('retry', $event)"
        @name="forwardName"
      />
    </ol>
    <p v-else class="play-history-empty">
      No worldline points are available yet.
    </p>

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
