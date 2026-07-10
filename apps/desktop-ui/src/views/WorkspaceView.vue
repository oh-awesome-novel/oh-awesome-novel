<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import WorkspaceShell from '../components/workspace/WorkspaceShell.vue';
import type {
  WorkspaceSummary,
} from '../composables/useWorkspaceApi';
import type { WorkspaceMode } from '../composables/useWorkspaceLayoutState';

const props = defineProps<{
  workspace?: WorkspaceSummary;
  providerConfigured: boolean;
  theme: 'light' | 'dark';
  startGuide: boolean;
}>();

const emit = defineEmits<{
  leaveWorkspace: [];
  configureProvider: [];
  toggleTheme: [];
  workspaceUpdated: [workspace: WorkspaceSummary];
}>();

const route = useRoute();
const router = useRouter();
const workspaceMode = computed<WorkspaceMode>(() =>
  route.params.mode === 'play' ? 'play' : 'writing',
);

function returnToLauncherIfWorkspaceMissing() {
  if (!props.workspace) {
    void router.replace({ name: 'launcher' });
  }
}

onMounted(returnToLauncherIfWorkspaceMissing);

watch(
  () => props.workspace,
  returnToLauncherIfWorkspaceMissing,
);

function selectMode(mode: WorkspaceMode) {
  void router.replace({
    name: 'workspace',
    params: mode === 'play' ? { mode: 'play' } : {},
  });
}
</script>

<template>
  <WorkspaceShell
    v-if="workspace"
    :workspace="workspace"
    :provider-configured="providerConfigured"
    :theme="theme"
    :start-guide="startGuide"
    :mode="workspaceMode"
    @leave-workspace="emit('leaveWorkspace')"
    @configure-provider="emit('configureProvider')"
    @toggle-theme="emit('toggleTheme')"
    @workspace-updated="emit('workspaceUpdated', $event)"
    @select-mode="selectMode"
  />
  <main v-else class="launcher-shell">
    <section class="launcher-main" aria-label="Workspace redirect">
      <p class="empty-copy">正在返回项目列表...</p>
    </section>
  </main>
</template>
