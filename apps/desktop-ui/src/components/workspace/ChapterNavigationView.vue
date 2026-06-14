<script setup lang="ts">
import type {
  ChapterIndex,
  ChapterIndexChapter,
  ChapterIndexStatus,
} from '../../composables/useWorkspaceApi';

defineProps<{
  index?: ChapterIndex;
  status?: ChapterIndexStatus;
  activePath?: string;
  loading: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  openChapter: [chapter: ChapterIndexChapter];
  rescan: [];
}>();

function statusLabel(status?: ChapterIndexStatus): string {
  if (!status) {
    return '未知';
  }

  const labels: Record<ChapterIndexStatus['status'], string> = {
    missing: '未生成索引',
    current: '索引最新',
    stale: '需要重新扫描',
    unknown: 'Git 状态未知',
    dirty: '工作区有未提交修改',
  };

  return labels[status.status];
}
</script>

<template>
  <section class="sidebar-panel" aria-label="Chapter navigation">
    <div class="panel-heading compact-heading">
      <h2 class="panel-title">Chapters</h2>
      <span class="status-pill">{{ statusLabel(status) }}</span>
    </div>

    <button class="secondary-button tight-button" type="button" :disabled="loading" @click="emit('rescan')">
      重新扫描章节
    </button>

    <p v-if="status && status.status !== 'current'" class="empty-copy">
      章节列表来自文件系统；索引状态不是最新时，请显式重新扫描。
    </p>
    <p v-if="loading" class="empty-copy">读取章节目录…</p>
    <p v-else-if="error" class="error-copy">{{ error }}</p>
    <div v-else-if="index?.volumes.length" class="chapter-list">
      <section v-for="volume in index.volumes" :key="volume.id" class="chapter-volume">
        <div class="chapter-volume-header">
          <strong>{{ volume.title }}</strong>
          <span>{{ volume.id }}</span>
        </div>
        <button
          v-for="chapter in volume.chapters"
          :key="chapter.id"
          class="chapter-row"
          :class="{ 'chapter-row-active': activePath === chapter.path }"
          type="button"
          @click="emit('openChapter', chapter)"
        >
          <span class="chapter-title">{{ chapter.title }}</span>
          <span class="chapter-meta">{{ chapter.id }} · {{ chapter.path }}</span>
        </button>
      </section>
    </div>
    <p v-else class="empty-copy">还没有正文章节。`0000.md` 会作为卷信息，不会显示为章节。</p>
  </section>
</template>
