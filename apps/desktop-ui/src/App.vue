<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';

import ProviderGateModal from './components/workspace/ProviderGateModal.vue';
import WorkspaceLauncher from './components/workspace/WorkspaceLauncher.vue';
import WorkspaceShell from './components/workspace/WorkspaceShell.vue';
import { useWorkspaceApi } from './composables/useWorkspaceApi';
import type {
  ProviderConfigInput,
  WorkspaceSummary,
} from './composables/useWorkspaceApi';

const api = useWorkspaceApi();
const workspaces = shallowRef<WorkspaceSummary[]>([]);
const activeWorkspace = shallowRef<WorkspaceSummary>();
const pendingWorkspace = shallowRef<WorkspaceSummary>();
const providerConfigured = shallowRef(false);
const loading = shallowRef(false);
const savingProvider = shallowRef(false);
const error = shallowRef('');
const providerError = shallowRef('');
const providerGateOpen = computed(() => Boolean(pendingWorkspace.value || providerError.value));

onMounted(() => {
  void refreshWorkspaces();
});

async function refreshWorkspaces() {
  loading.value = true;
  error.value = '';

  try {
    const result = await api.listWorkspaces();
    workspaces.value = result.workspaces;
    providerConfigured.value = result.providerConfigured;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function importWorkspace(path: string) {
  loading.value = true;
  error.value = '';

  try {
    await api.importWorkspace(path);
    await refreshWorkspaces();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function openWorkspace(workspace: WorkspaceSummary) {
  loading.value = true;
  error.value = '';

  try {
    const result = await api.openWorkspace(workspace.path);
    activeWorkspace.value = result.workspace;
    providerConfigured.value = result.providerConfigured;

    if (!result.providerConfigured) {
      pendingWorkspace.value = result.workspace;
      return;
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function renameWorkspace(workspace: WorkspaceSummary, name: string) {
  loading.value = true;
  error.value = '';

  try {
    const result = await api.renameWorkspace(workspace.path, name);
    workspaces.value = result.workspaces;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function removeWorkspace(workspace: WorkspaceSummary) {
  loading.value = true;
  error.value = '';

  try {
    const result = await api.removeWorkspace(workspace.path);
    workspaces.value = result.workspaces;
    if (activeWorkspace.value?.path === workspace.path) {
      activeWorkspace.value = undefined;
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function saveProvider(provider: ProviderConfigInput) {
  savingProvider.value = true;
  providerError.value = '';

  try {
    const result = await api.saveProviderConfig(provider);
    providerConfigured.value = result.configured;
    pendingWorkspace.value = undefined;
  } catch (caught) {
    providerError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    savingProvider.value = false;
  }
}

function skipProviderGate() {
  pendingWorkspace.value = undefined;
  providerError.value = '';
}

function cancelProviderGate() {
  if (pendingWorkspace.value && !providerConfigured.value) {
    activeWorkspace.value = undefined;
  }

  pendingWorkspace.value = undefined;
  providerError.value = '';
}

function leaveWorkspace() {
  activeWorkspace.value = undefined;
  pendingWorkspace.value = undefined;
  void refreshWorkspaces();
}

function openProviderSettings() {
  pendingWorkspace.value = activeWorkspace.value;
}
</script>

<template>
  <WorkspaceShell
    v-if="activeWorkspace"
    :workspace="activeWorkspace"
    :provider-configured="providerConfigured"
    @leave-workspace="leaveWorkspace"
    @configure-provider="openProviderSettings"
  />
  <WorkspaceLauncher
    v-else
    :workspaces="workspaces"
    :loading="loading"
    :error="error"
    @import="importWorkspace"
    @open="openWorkspace"
    @remove="removeWorkspace"
    @rename="renameWorkspace"
    @refresh="refreshWorkspaces"
  />
  <ProviderGateModal
    :open="providerGateOpen"
    :workspace-name="pendingWorkspace?.name"
    :saving="savingProvider"
    :error="providerError"
    @save="saveProvider"
    @skip="skipProviderGate"
    @cancel="cancelProviderGate"
  />
</template>
