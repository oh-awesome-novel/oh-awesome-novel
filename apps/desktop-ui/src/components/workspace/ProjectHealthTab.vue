<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  ProjectionRebuildResult,
  ProjectHealth,
  WorkspaceStatus,
} from '../../composables/useWorkspaceApi';

const props = defineProps<{
  status?: WorkspaceStatus;
  health?: ProjectHealth;
}>();

const emit = defineEmits<{
  settleChapter: [path: string];
}>();

const api = useWorkspaceApi();
const rebuilding = shallowRef(false);
const rebuildError = shallowRef('');
const rebuildResult = shallowRef<ProjectionRebuildResult>();

const gitLabel = computed(() => {
  if (!props.status) {
    return 'checking';
  }

  if (props.status.git.status === 'unknown') {
    return props.status.git.error?.message ?? 'unknown';
  }

  return props.status.git.dirty ? 'dirty' : 'clean';
});

const unsettledChapters = computed(() => props.health?.unsettledChapters ?? []);
const issues = computed(() => (props.health?.issues ?? []).filter((issue) => !issue.id.startsWith('aggregate-summary-missing:')));
const optionalSummaries = computed(() => (props.health?.issues ?? []).filter((issue) => issue.id.startsWith('aggregate-summary-missing:')));

async function rebuildProjections() {
  rebuilding.value = true;
  rebuildError.value = '';

  try {
    rebuildResult.value = await api.rebuildProjections();
  } catch (error) {
    rebuildError.value = error instanceof Error ? error.message : String(error);
  } finally {
    rebuilding.value = false;
  }
}
</script>

<template>
  <section class="right-tab-panel" aria-label="Workspace health">
    <div class="panel-heading">
      <h2 class="panel-title">Workspace Health</h2>
      <button
        class="ghost-button tight-button"
        type="button"
        :disabled="rebuilding"
        @click="rebuildProjections"
      >
        Rebuild Projections
      </button>
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
    <div v-if="unsettledChapters.length" class="health-issue-row health-unsettled-row">
      <strong>{{ unsettledChapters.length }} 章尚未整理</strong>
      <span>继续写作前先整理，摘要和状态才会跟上正文。最早的是 {{ unsettledChapters[0] }}。</span>
      <button class="secondary-button tight-button" type="button" @click="emit('settleChapter', unsettledChapters[0]!)">
        整理这一章
      </button>
    </div>
    <div v-if="issues.length" class="health-issue-list">
      <div v-for="issue in issues" :key="issue.id" class="health-issue-row">
        <strong>{{ issue.title }}</strong>
        <span>{{ issue.detail }}</span>
      </div>
    </div>
    <p v-else class="empty-copy">No health issues.</p>
    <details v-if="optionalSummaries.length" class="health-issue-list">
      <summary>可选完善：{{ optionalSummaries.length }} 份卷 / 全书摘要尚未建立</summary>
      <p class="muted-copy">不影响继续写作。需要汇总时，先整理章节，再按卷和全书生成。</p>
      <div v-for="issue in optionalSummaries" :key="issue.id" class="health-issue-row">
        <span>{{ issue.path }}</span>
      </div>
    </details>
    <p v-if="rebuildError" class="error-copy">{{ rebuildError }}</p>
    <div v-if="rebuildResult" class="health-issue-list">
      <div v-for="projection in rebuildResult.projections" :key="projection.path" class="health-issue-row">
        <strong>{{ projection.target }}</strong>
        <span>{{ projection.path }}</span>
      </div>
    </div>
  </section>
</template>
