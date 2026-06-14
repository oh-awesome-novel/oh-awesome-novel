<script setup lang="ts">
import { computed } from 'vue';

import type { WorkspaceStatus, WorkspaceSummary } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
  status?: WorkspaceStatus;
}>();

const emit = defineEmits<{
  generateNextChapter: [];
  openChapters: [];
  openCopilot: [];
  openPending: [];
  configureProvider: [];
  leaveWorkspace: [];
}>();

const pendingStatusLabel = computed(() => {
  const count = props.status?.pendingActionCount ?? 0;
  return count === 0 ? '0 项' : `${count} 项待审批`;
});

const gitStatusLabel = computed(() => {
  if (!props.status) {
    return '检查中';
  }

  if (props.status.git.status === 'unknown') {
    return 'unknown';
  }

  return props.status.git.dirty ? 'dirty' : 'clean';
});
</script>

<template>
  <section class="home-pane" aria-label="Workspace home">
    <div class="home-header">
      <div>
        <p class="eyebrow">Workspace</p>
        <h1 class="home-title">{{ workspace.name }}</h1>
        <p class="workspace-meta">{{ workspace.path }}</p>
      </div>
      <span class="status-pill">{{ providerConfigured ? 'Provider ready' : 'Provider missing' }}</span>
    </div>

    <div class="home-status-grid">
      <div class="status-block">
        <span>PendingAction</span>
        <strong>{{ pendingStatusLabel }}</strong>
      </div>
      <div class="status-block">
        <span>Git dirty</span>
        <strong>{{ gitStatusLabel }}</strong>
      </div>
      <div class="status-block">
        <span>Copilot</span>
        <strong>{{ providerConfigured ? '可打开' : '只读模式' }}</strong>
      </div>
    </div>

    <div class="quick-action-grid" aria-label="Quick actions">
      <button class="quick-action" type="button" @click="emit('generateNextChapter')">
        <strong>生成下一章</strong>
        <span>打开 Copilot，并填入明确的写作请求。</span>
      </button>
      <button class="quick-action" type="button" @click="emit('openChapters')">
        <strong>打开章节导航</strong>
        <span>按卷和章节标题浏览正文。</span>
      </button>
      <button class="quick-action" type="button" @click="emit('openCopilot')">
        <strong>打开 Copilot</strong>
        <span>查看对话、工具记录和待审批修改。</span>
      </button>
      <button class="quick-action" type="button" @click="emit('openPending')">
        <strong>查看待审批修改</strong>
        <span>聚焦 PendingAction 面板。</span>
      </button>
      <button class="quick-action" type="button" @click="emit('configureProvider')">
        <strong>配置 LLM Provider</strong>
        <span>Provider 配置只属于应用级设置。</span>
      </button>
      <button class="quick-action" type="button" @click="emit('leaveWorkspace')">
        <strong>退出 workspace</strong>
        <span>返回全局 workspace 列表。</span>
      </button>
    </div>
  </section>
</template>
