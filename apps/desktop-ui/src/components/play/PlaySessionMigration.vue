<script setup lang="ts">
import type { PlaySessionMigrationPreview } from '@oh-awesome-novel/client';
import type { DeepReadonly } from 'vue';
defineProps<{ preview: DeepReadonly<PlaySessionMigrationPreview>; busy: boolean; error: string }>();
defineEmits<{ confirm: [] }>();
</script>

<template>
  <section class="play-migration" aria-label="确认升级推演会话">
    <h2>确认升级这个推演会话</h2>
    <p>这个会话使用格式 {{ preview.fromSchemaVersion }}，需要升级到格式 {{ preview.toSchemaVersion }} 才能继续。打开这个预览不会升级。</p>
    <p>升级会保留 {{ preview.legacyTranscriptCount }} 条旧消息和 {{ preview.projectedTurnCount }} 个已保存回合。原始文件会备份到会话内的 <code>{{ preview.backupRelativePath }}</code>。</p>
    <p v-if="preview.unknownMetadataKeys.length">会保留自定义元数据：{{ preview.unknownMetadataKeys.join('、') }}。</p>
    <p>小说文件不会改变。你可以先选择其他会话，或稍后再来；在此之前这个会话保持原格式。</p>
    <details v-if="preview.generatedTurnIds.length">
      <summary>预览已保存的回合编号</summary>
      <ul><li v-for="id in preview.generatedTurnIds" :key="id">{{ id }}</li></ul>
    </details>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="button" :disabled="busy" @click="$emit('confirm')">{{ busy ? 'Upgrading…' : '确认升级并保留备份' }}</button>
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
