<script setup lang="ts">
defineProps<{
  path?: string;
  content: string;
  loading: boolean;
  error?: string;
}>();
</script>

<template>
  <section class="viewer-pane" aria-label="File viewer">
    <div class="viewer-header">
      <div>
        <p class="eyebrow">Read only</p>
        <h2 class="viewer-title">{{ path }}</h2>
      </div>
    </div>
    <p v-if="loading" class="empty-copy">读取文件内容…</p>
    <p v-else-if="error" class="error-copy">{{ error }}</p>
    <pre v-else class="file-content">{{ content }}</pre>
  </section>
</template>
