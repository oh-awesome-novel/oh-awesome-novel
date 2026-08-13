<script setup lang="ts">
import { computed } from 'vue';

import type { PendingActionViewV1 } from '@oh-awesome-novel/client';

const props = defineProps<{
  diff: string;
  changes: PendingActionViewV1['changes'];
}>();

const rows = computed(() => props.changes.map((change) => ({
  operation: change.operation,
  path: change.path,
  label: operationLabel(change.operation),
})));

function operationLabel(operation: 'create' | 'update' | 'delete'): string {
  if (operation === 'create') return 'created';
  if (operation === 'delete') return 'deleted';
  return 'updated';
}
</script>

<template>
  <div class="structured-diff" aria-label="PendingAction diff">
    <ul v-if="rows.length" class="diff-change-list" aria-label="PendingAction file changes">
      <li
        v-for="row in rows"
        :key="`${row.operation}:${row.path}`"
        class="diff-file-header"
        :data-operation="row.operation"
      >
        <strong>{{ row.path }}</strong>
        <small>{{ row.label }}</small>
      </li>
    </ul>
    <p v-else class="empty-copy">No file changes.</p>
    <pre v-if="diff" class="diff-preview" aria-label="PendingAction diff text">{{ diff }}</pre>
    <p v-else class="empty-copy">No diff available.</p>
  </div>
</template>
