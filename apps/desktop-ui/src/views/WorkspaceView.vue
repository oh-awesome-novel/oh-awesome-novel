<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';

import WorkspaceShell from '../components/workspace/WorkspaceShell.vue';
import type {
  WorkspaceSummary,
} from '../composables/useWorkspaceApi';

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

const router = useRouter();

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
</script>

<template>
  <WorkspaceShell
    v-if="workspace"
    :workspace="workspace"
    :provider-configured="providerConfigured"
    :theme="theme"
    :start-guide="startGuide"
    @leave-workspace="emit('leaveWorkspace')"
    @configure-provider="emit('configureProvider')"
    @toggle-theme="emit('toggleTheme')"
    @workspace-updated="emit('workspaceUpdated', $event)"
  />
  <main v-else class="launcher-shell">
    <section class="launcher-main" aria-label="Workspace redirect">
      <p class="empty-copy">正在返回项目列表...</p>
    </section>
  </main>
</template>
