<script setup lang="ts">
import type { PlaySessionMigrationPreview } from '@oh-awesome-novel/client';
import type { DeepReadonly } from 'vue';
defineProps<{ preview: DeepReadonly<PlaySessionMigrationPreview>; busy: boolean; error: string }>();
defineEmits<{ confirm: [] }>();
</script>

<template>
  <section class="play-migration" aria-label="Review Play session upgrade">
    <h2>Review this Play session upgrade</h2>
    <p>This session uses format {{ preview.fromSchemaVersion }}. Upgrade to format {{ preview.toSchemaVersion }} before continuing. Opening this preview does not upgrade it.</p>
    <p>The upgrade preserves {{ preview.legacyTranscriptCount }} legacy messages and {{ preview.projectedTurnCount }} saved turns. Original files will be backed up inside this session at <code>{{ preview.backupRelativePath }}</code>.</p>
    <p v-if="preview.unknownMetadataKeys.length">Custom metadata will be preserved: {{ preview.unknownMetadataKeys.join(', ') }}.</p>
    <p>Your novel files are unchanged. You can select another session or return later to keep this session in its original format.</p>
    <details v-if="preview.generatedTurnIds.length">
      <summary>Preview saved turn identifiers</summary>
      <ul><li v-for="id in preview.generatedTurnIds" :key="id">{{ id }}</li></ul>
    </details>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="button" :disabled="busy" @click="$emit('confirm')">{{ busy ? 'Upgrading…' : 'Confirm upgrade and preserve backup' }}</button>
    <slot />
  </section>
</template>

<style scoped>
.play-migration { grid-column: 2 / -1; padding: 24px; overflow: auto; min-width: 0; }
.play-migration p { max-width: 72ch; line-height: 1.6; }
.play-migration code { overflow-wrap: anywhere; }
.play-migration button { min-height: 44px; margin-top: 16px; }
@media (max-width: 860px) { .play-migration { grid-column: 1; } }
</style>
