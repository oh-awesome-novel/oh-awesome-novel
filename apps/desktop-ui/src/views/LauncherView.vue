<script setup lang="ts">
import WorkspaceLauncher from '../components/workspace/WorkspaceLauncher.vue';
import type { LauncherSection } from '../components/workspace/launcherSections';
import type {
  WorkspaceSummary,
} from '../composables/useWorkspaceApi';

defineProps<{
  section: LauncherSection;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error: string;
  theme: 'light' | 'dark';
  appVersion: string;
  desktopFolderPickerAvailable: boolean;
}>();

const emit = defineEmits<{
  create: [path: string];
  browseCreate: [];
  import: [path: string];
  browseImport: [];
  open: [workspace: WorkspaceSummary];
  remove: [workspace: WorkspaceSummary];
  rename: [workspace: WorkspaceSummary, name: string];
  refresh: [];
  toggleTheme: [];
  providerConfigured: [configured: boolean];
  updateSection: [section: LauncherSection];
}>();

function renameWorkspace(workspace: WorkspaceSummary, name: string) {
  emit('rename', workspace, name);
}
</script>

<template>
  <WorkspaceLauncher
    :section="section"
    :workspaces="workspaces"
    :loading="loading"
    :error="error"
    :theme="theme"
    :app-version="appVersion"
    :desktop-folder-picker-available="desktopFolderPickerAvailable"
    @create="emit('create', $event)"
    @browse-create="emit('browseCreate')"
    @import="emit('import', $event)"
    @browse-import="emit('browseImport')"
    @open="emit('open', $event)"
    @remove="emit('remove', $event)"
    @rename="renameWorkspace"
    @refresh="emit('refresh')"
    @toggle-theme="emit('toggleTheme')"
    @provider-configured="emit('providerConfigured', $event)"
    @update-section="emit('updateSection', $event)"
  />
</template>
