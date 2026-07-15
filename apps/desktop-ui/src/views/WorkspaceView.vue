<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import WorkspaceShell from '../components/workspace/WorkspaceShell.vue';
import type {
  WorkspaceSummary,
} from '../composables/useWorkspaceApi';
import {
  readWorkspaceModePreference,
  writeWorkspaceModePreference,
} from '../composables/useWorkspaceLayoutState';
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
const rememberedWorkspaceMode = shallowRef<WorkspaceMode>('writing');
const routeModeState = computed(() => readWorkspaceModeRouteState(route.params.mode));
const workspaceMode = computed<WorkspaceMode>(() =>
  routeModeState.value.kind === 'explicit'
    ? routeModeState.value.mode
    : rememberedWorkspaceMode.value,
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

watch(
  [() => props.workspace?.path, routeModeState],
  ([workspacePath, modeState]) => {
    if (!workspacePath) {
      rememberedWorkspaceMode.value = 'writing';
      return;
    }

    if (modeState.kind === 'explicit') {
      rememberedWorkspaceMode.value = modeState.mode;
      writeWorkspaceModePreference(workspacePath, modeState.mode);
      if (modeState.mode === 'writing') {
        replaceWorkspaceModeRoute('writing');
      }
      return;
    }

    const restoredMode = readWorkspaceModePreference(workspacePath);
    rememberedWorkspaceMode.value = restoredMode;
    if (modeState.kind === 'invalid' || restoredMode === 'play') {
      replaceWorkspaceModeRoute(restoredMode);
    }
  },
  { immediate: true },
);

function selectMode(mode: WorkspaceMode) {
  if (props.workspace) {
    rememberedWorkspaceMode.value = mode;
    writeWorkspaceModePreference(props.workspace.path, mode);
  }

  replaceWorkspaceModeRoute(mode);
}

function replaceWorkspaceModeRoute(mode: WorkspaceMode) {
  void router.replace({
    name: 'workspace',
    params: mode === 'play' ? { mode: 'play' } : {},
  });
}

type WorkspaceModeRouteState =
  | { kind: 'implicit' }
  | { kind: 'explicit'; mode: WorkspaceMode }
  | { kind: 'invalid' };

function readWorkspaceModeRouteState(value: unknown): WorkspaceModeRouteState {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string' || !candidate) {
    return { kind: 'implicit' };
  }

  if (candidate === 'play' || candidate === 'writing') {
    return { kind: 'explicit', mode: candidate };
  }

  return { kind: 'invalid' };
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
