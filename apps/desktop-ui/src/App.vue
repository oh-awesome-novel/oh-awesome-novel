<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { RouterView, useRouter } from 'vue-router';

import ProviderGateModal from './components/workspace/ProviderGateModal.vue';
import { oanClient } from './client';
import type { LauncherSection } from './components/workspace/launcherSections';
import { useWorkspaceApi } from './composables/useWorkspaceApi';
import { useThemePreference } from './composables/useThemePreference';
import type {
  ProviderConfigInput,
  WorkspaceSummary,
} from './composables/useWorkspaceApi';

const api = useWorkspaceApi();
const router = useRouter();
const { theme, toggleTheme } = useThemePreference();
const workspaces = shallowRef<WorkspaceSummary[]>([]);
const activeWorkspace = shallowRef<WorkspaceSummary>();
const pendingWorkspace = shallowRef<WorkspaceSummary>();
const startWorkspaceGuide = shallowRef(false);
const providerConfigured = shallowRef(false);
const loading = shallowRef(false);
const savingProvider = shallowRef(false);
const error = shallowRef('');
const providerError = shallowRef('');
const desktopFolderPickerAvailable = shallowRef(false);
const appVersion = shallowRef('');
const providerGateOpen = computed(() => Boolean(pendingWorkspace.value || providerError.value));
const launcherSection = computed<LauncherSection>(() =>
  getLauncherSectionFromRouteName(router.currentRoute.value.name),
);

const launcherRouteBySection: Record<LauncherSection, string> = {
  workspaces: 'launcher',
  model: 'launcher-model',
  about: 'launcher-about',
  settings: 'launcher-settings',
};

onMounted(() => {
  desktopFolderPickerAvailable.value = oanClient.isDirectoryPickerAvailable();
  void loadAppVersion();
  void refreshWorkspaces();
});

async function loadAppVersion() {
  try {
    appVersion.value = await oanClient.getAppVersion() ?? '';
  } catch {
    appVersion.value = '';
  }
}

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

async function importWorkspaceFromFolderPicker() {
  if (!oanClient.isDirectoryPickerAvailable()) {
    return;
  }

  const path = await oanClient.selectDirectory();

  if (path) {
    await importWorkspace(path);
  }
}

async function createWorkspace(path: string) {
  loading.value = true;
  error.value = '';

  try {
    const result = await api.createWorkspace(path);
    activeWorkspace.value = result.workspace;
    providerConfigured.value = result.providerConfigured;
    pendingWorkspace.value = undefined;
    startWorkspaceGuide.value = result.onboarding.show;
    await refreshWorkspaces();
    await openWorkspaceRoute();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function createWorkspaceFromFolderPicker() {
  if (!oanClient.isDirectoryPickerAvailable()) {
    return;
  }

  const path = await oanClient.selectDirectory();

  if (path) {
    await createWorkspace(path);
  }
}

async function openWorkspace(workspace: WorkspaceSummary) {
  loading.value = true;
  error.value = '';

  try {
    const result = await api.openWorkspace(workspace.path);
    activeWorkspace.value = result.workspace;
    providerConfigured.value = result.providerConfigured;
    startWorkspaceGuide.value = false;
    await openWorkspaceRoute();

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
      startWorkspaceGuide.value = false;
      void openLauncherRoute();
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
    void openLauncherRoute();
  }

  pendingWorkspace.value = undefined;
  providerError.value = '';
}

function leaveWorkspace() {
  activeWorkspace.value = undefined;
  pendingWorkspace.value = undefined;
  startWorkspaceGuide.value = false;
  void openLauncherRoute();
  void refreshWorkspaces();
}

function openProviderSettings() {
  pendingWorkspace.value = activeWorkspace.value;
}

function updateActiveWorkspace(workspace: WorkspaceSummary) {
  activeWorkspace.value = workspace;
  void refreshWorkspaces();
}

function updateProviderConfigured(configured: boolean) {
  providerConfigured.value = configured;
}

function updateLauncherSection(section: LauncherSection) {
  const routeName = launcherRouteBySection[section];

  if (router.currentRoute.value.name !== routeName) {
    void router.push({ name: routeName });
  }
}

async function openWorkspaceRoute() {
  if (router.currentRoute.value.name !== 'workspace') {
    await router.push({ name: 'workspace' });
  }
}

async function openLauncherRoute() {
  if (router.currentRoute.value.name !== 'launcher') {
    await router.push({ name: 'launcher' });
  }
}

function getLauncherSectionFromRouteName(routeName: unknown): LauncherSection {
  switch (routeName) {
    case 'launcher-model':
      return 'model';
    case 'launcher-about':
      return 'about';
    case 'launcher-settings':
      return 'settings';
    default:
      return 'workspaces';
  }
}
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <component
      :is="Component"
      v-if="route.name === 'workspace'"
      :workspace="activeWorkspace"
      :provider-configured="providerConfigured"
      :theme="theme"
      :start-guide="startWorkspaceGuide"
      @leave-workspace="leaveWorkspace"
      @configure-provider="openProviderSettings"
      @toggle-theme="toggleTheme"
      @workspace-updated="updateActiveWorkspace"
    />
    <component
      :is="Component"
      v-else
      :section="launcherSection"
      :workspaces="workspaces"
      :loading="loading"
      :error="error"
      :theme="theme"
      :app-version="appVersion"
      :desktop-folder-picker-available="desktopFolderPickerAvailable"
      @create="createWorkspace"
      @browse-create="createWorkspaceFromFolderPicker"
      @import="importWorkspace"
      @browse-import="importWorkspaceFromFolderPicker"
      @open="openWorkspace"
      @remove="removeWorkspace"
      @rename="renameWorkspace"
      @refresh="refreshWorkspaces"
      @toggle-theme="toggleTheme"
      @provider-configured="updateProviderConfigured"
      @update-section="updateLauncherSection"
    />
  </RouterView>
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
