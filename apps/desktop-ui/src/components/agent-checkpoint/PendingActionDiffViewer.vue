<script setup lang="ts">
import { computed, reactive } from 'vue';

const props = defineProps<{
  diff: string;
  touchedFiles?: string[];
}>();

const expanded = reactive<Record<string, boolean>>({});

const fileBlocks = computed(() => {
  const lines = props.diff.split('\n');
  const blocks: Array<{ path: string; status: string; body: string }> = [];
  let current: { path: string; status: string; body: string[] } | undefined;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) {
        blocks.push({ ...current, body: current.body.join('\n') });
      }

      const match = / b\/(.+)$/u.exec(line);
      const path = match?.[1] ?? props.touchedFiles?.[blocks.length] ?? 'unknown';
      current = {
        path,
        status: readStatus(path, props.touchedFiles ?? []),
        body: [line],
      };
      expanded[path] ??= blocks.length === 0;
      continue;
    }

    current?.body.push(line);
  }

  if (current) {
    blocks.push({ ...current, body: current.body.join('\n') });
  }

  if (blocks.length === 0 && props.diff.trim()) {
    return [{
      path: props.touchedFiles?.[0] ?? 'diff',
      status: 'modified',
      body: props.diff,
    }];
  }

  return blocks;
});

function toggle(path: string) {
  expanded[path] = !expanded[path];
}

function readStatus(path: string, touchedFiles: string[]): string {
  return touchedFiles.includes(path) ? 'modified' : 'changed';
}
</script>

<template>
  <div class="structured-diff" aria-label="PendingAction diff">
    <article v-for="block in fileBlocks" :key="block.path" class="diff-file-block">
      <button class="diff-file-header" type="button" @click="toggle(block.path)">
        <span>{{ expanded[block.path] ? '▾' : '▸' }}</span>
        <strong>{{ block.path }}</strong>
        <small>{{ block.status }}</small>
      </button>
      <pre v-if="expanded[block.path]" class="diff-preview">{{ block.body }}</pre>
    </article>
    <p v-if="fileBlocks.length === 0" class="empty-copy">No diff available.</p>
  </div>
</template>
