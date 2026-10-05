<script setup lang="ts">
import type { ManuscriptImportPreview } from '@oh-awesome-novel/client';
defineProps<{ preview: ManuscriptImportPreview }>();
</script>
<template>
  <section aria-label="旧稿导入预览" class="import-preview">
    <h3>3. 检查导入预览</h3>
    <p role="status">{{ preview.chapters.length }} 章 · 原稿 {{ preview.sourceBytes }} 字节 · {{ preview.canPropose ? '可创建待审批导入' : '需先解决目标冲突' }}</p>
    <p>原稿内容（包括原有标题）保留在对应分片内；新增章节元数据和映射标题见下方差异。</p>
    <ul class="preview-targets"><li v-for="chapter in preview.chapters" :key="chapter.index">{{ chapter.path }} · {{ chapter.title }} · 原稿 {{ chapter.sourceBytes }} 字节</li></ul>
    <div v-if="preview.conflicts.length" class="error-copy" role="alert">
      <p>请调整卷章映射后重新预览，已有正文不会被覆盖。</p>
      <ul><li v-for="conflict in preview.conflicts" :key="`${conflict.index}-${conflict.reason}`">分片 {{ conflict.index + 1 }}：{{ conflict.path }} — {{ conflict.reason === 'exists' ? '目标章节已存在' : '多个分片映射到同一章节' }}</li></ul>
    </div>
    <ul v-if="preview.warnings.length"><li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li></ul>
    <details v-if="preview.diff" open><summary>查看新增章节差异</summary><pre class="diff-preview">{{ preview.diff }}</pre></details>
  </section>
</template>
<style scoped>
.import-preview { margin-top: 24px; }
p, li { line-height: 1.6; }
.preview-targets { overflow-wrap: anywhere; }
.diff-preview { max-height: 360px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
summary { cursor: pointer; padding: 10px 0; }
summary:focus-visible { outline: 2px solid var(--editor-focus); outline-offset: 2px; }
</style>
