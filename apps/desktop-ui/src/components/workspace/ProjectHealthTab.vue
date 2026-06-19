<script setup lang="ts">
import { computed } from 'vue';

import type { ProjectHealth, WorkspaceStatus } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  status?: WorkspaceStatus;
  health?: ProjectHealth;
}>();

const gitLabel = computed(() => {
  if (!props.status) {
    return 'checking';
  }

  if (props.status.git.status === 'unknown') {
    return props.status.git.error?.message ?? 'unknown';
  }

  return props.status.git.dirty ? 'dirty' : 'clean';
});

const issues = computed(() => props.health?.issues ?? []);
</script>

<template>
  <section class="right-tab-panel" aria-label="Workspace health">
    <div class="panel-heading">
      <h2 class="panel-title">Workspace Health</h2>
    </div>
    <div class="home-health-panel">
      <div class="status-block">
        <span>PendingAction</span>
        <strong>{{ status?.pendingActionCount ?? 0 }}</strong>
      </div>
      <div class="status-block">
        <span>Git</span>
        <strong>{{ gitLabel }}</strong>
      </div>
      <div class="status-block">
        <span>Active hooks</span>
        <strong>{{ health?.activeHookCount ?? 0 }}</strong>
      </div>
      <div class="status-block">
        <span>Timeline gaps</span>
        <strong>{{ health?.timelineGapCount ?? 0 }}</strong>
      </div>
    </div>
    <div v-if="issues.length" class="health-issue-list">
      <div v-for="issue in issues" :key="issue.id" class="health-issue-row">
        <strong>{{ issue.title }}</strong>
        <span>{{ issue.detail }}</span>
      </div>
    </div>
    <p v-else class="empty-copy">No health issues.</p>
  </section>
</template>
