<script setup lang="ts">
import { shallowRef, watch } from 'vue';

import { useWorkspaceSearch } from '../../composables/useWorkspaceSearch';
import type { WorkspaceSummary } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  import: [path: string];
  open: [workspace: WorkspaceSummary];
  remove: [workspace: WorkspaceSummary];
  rename: [workspace: WorkspaceSummary, name: string];
  refresh: [];
}>();

const query = shallowRef('');
const importPath = shallowRef('');
const editingPath = shallowRef('');
const editingName = shallowRef('');
const searchableWorkspaces = shallowRef(props.workspaces);

const { results } = useWorkspaceSearch(searchableWorkspaces, query);

watch(
  () => props.workspaces,
  (nextWorkspaces) => {
    searchableWorkspaces.value = nextWorkspaces;
  },
);

function submitImport() {
  const path = importPath.value.trim();

  if (!path) {
    return;
  }

  emit('import', path);
  importPath.value = '';
}

function startRename(workspace: WorkspaceSummary) {
  editingPath.value = workspace.path;
  editingName.value = workspace.name;
}

function saveRename(workspace: WorkspaceSummary) {
  const name = editingName.value.trim();

  if (name) {
    emit('rename', workspace, name);
  }

  editingPath.value = '';
  editingName.value = '';
}
</script>

<template>
  <main class="launcher-shell">
    <section class="launcher-hero" aria-label="Workspace launcher">
      <div class="launcher-mark">OAN</div>
      <div class="launcher-title-block">
        <p class="eyebrow">oh-awesome-novel</p>
        <h1 class="launcher-title">选择小说工作区</h1>
        <p class="launcher-copy">打开一个 filesystem-first 小说工程，然后进入只读工作台和 Copilot。</p>
      </div>
    </section>

    <section class="launcher-panel" aria-label="Workspace list">
      <div class="launcher-toolbar">
        <label class="search-box">
          <span class="visually-hidden">搜索 workspace</span>
          <input
            v-model="query"
            class="text-input"
            type="search"
            placeholder="搜索名称、小说名或路径"
          >
        </label>
        <button class="ghost-button" type="button" :disabled="loading" @click="emit('refresh')">
          刷新
        </button>
      </div>

      <form class="import-row" @submit.prevent="submitImport">
        <input
          v-model="importPath"
          class="text-input"
          type="text"
          placeholder="粘贴 OAN workspace 目录路径"
        >
        <button class="primary-button" type="submit" :disabled="loading || !importPath.trim()">
          导入
        </button>
      </form>

      <p v-if="error" class="error-copy">{{ error }}</p>

      <div v-if="results.length" class="workspace-list">
        <article
          v-for="workspace in results"
          :key="workspace.path"
          class="workspace-row"
          :class="{ 'workspace-row-invalid': !workspace.valid }"
        >
          <div class="workspace-main">
            <template v-if="editingPath === workspace.path">
              <input
                v-model="editingName"
                class="text-input"
                type="text"
                @keyup.enter="saveRename(workspace)"
                @keyup.esc="editingPath = ''"
              >
            </template>
            <template v-else>
              <h2 class="workspace-name">{{ workspace.name }}</h2>
            </template>
            <p class="workspace-meta">{{ workspace.novelName }} · {{ workspace.path }}</p>
            <p v-if="workspace.lastOpenedAt" class="workspace-time">
              最近打开 {{ new Date(workspace.lastOpenedAt).toLocaleString() }}
            </p>
            <p v-if="!workspace.valid" class="error-copy">{{ workspace.reason }}</p>
          </div>
          <div class="workspace-actions">
            <button
              v-if="editingPath === workspace.path"
              class="secondary-button"
              type="button"
              @click="saveRename(workspace)"
            >
              保存名称
            </button>
            <button
              v-else
              class="secondary-button"
              type="button"
              @click="startRename(workspace)"
            >
              改名
            </button>
            <button
              class="secondary-button"
              type="button"
              :disabled="!workspace.valid"
              @click="emit('open', workspace)"
            >
              进入
            </button>
            <button class="danger-button" type="button" @click="emit('remove', workspace)">
              移除
            </button>
          </div>
        </article>
      </div>

      <div v-else class="empty-state">
        <h2 class="empty-title">还没有最近工作区</h2>
        <p class="empty-copy">导入一个已有 OAN workspace。列表只保存元数据，不会写进小说目录。</p>
      </div>
    </section>
  </main>
</template>
