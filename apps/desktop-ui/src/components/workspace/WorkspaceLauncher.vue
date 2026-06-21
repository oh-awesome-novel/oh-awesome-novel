<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { RefreshCw, Search, Settings } from '@lucide/vue';

import LauncherModelView from './LauncherModelView.vue';
import LauncherSettingsView from './LauncherSettingsView.vue';
import { useWorkspaceSearch } from '../../composables/useWorkspaceSearch';
import type { LauncherSection } from './launcherSections';
import type { WorkspaceSummary } from '../../composables/useWorkspaceApi';
import appIconUrl from '../../assets/oan-app-icon.svg';

const props = defineProps<{
  section: LauncherSection;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error?: string;
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

const query = shallowRef('');
const importPath = shallowRef('');
const createPath = shallowRef('');
const editingPath = shallowRef('');
const editingName = shallowRef('');
const selectedPath = shallowRef('');
const pathDialogOpen = shallowRef(false);
const createDialogOpen = shallowRef(false);
const searchableWorkspaces = shallowRef(props.workspaces);

const { results } = useWorkspaceSearch(searchableWorkspaces, query);

watch(
  () => props.workspaces,
  (nextWorkspaces) => {
    searchableWorkspaces.value = nextWorkspaces;
  },
);

watch(
  results,
  (nextResults) => {
    if (!nextResults.length) {
      selectedPath.value = '';
      return;
    }

    if (!nextResults.some((workspace) => workspace.path === selectedPath.value)) {
      selectedPath.value = nextResults[0].path;
    }
  },
  { immediate: true },
);

function submitImport() {
  const path = importPath.value.trim();

  if (!path) {
    return;
  }

  emit('import', path);
  closePathDialog();
}

function submitCreate() {
  const path = createPath.value.trim();

  if (!path) {
    return;
  }

  emit('create', path);
  closeCreateDialog();
}

function requestNewWorkspaceFolder() {
  if (props.desktopFolderPickerAvailable) {
    emit('browseCreate');
    return;
  }

  createDialogOpen.value = true;
}

function requestWorkspaceFolder() {
  if (props.desktopFolderPickerAvailable) {
    emit('browseImport');
    return;
  }

  pathDialogOpen.value = true;
}

function closePathDialog() {
  pathDialogOpen.value = false;
  importPath.value = '';
}

function closeCreateDialog() {
  createDialogOpen.value = false;
  createPath.value = '';
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

function workspaceInitials(workspace: WorkspaceSummary) {
  const name = workspace.name || workspace.novelName || 'Workspace';
  const chunks = name
    .split(/[\s._-]+/u)
    .filter(Boolean)
    .slice(0, 2);
  const initials = chunks.map((chunk) => chunk[0]?.toUpperCase()).join('');

  return initials || name.slice(0, 2).toUpperCase();
}

function workspaceAccent(index: number) {
  return `project-tile-accent-${index % 6}`;
}

function formatOpenedAt(value?: string) {
  if (!value) {
    return '尚未打开';
  }

  return new Date(value).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <main class="launcher-shell">
    <aside class="launcher-sidebar" aria-label="Oh Awesome Novel navigation">
      <div class="launcher-brand">
        <img class="launcher-app-icon" :src="appIconUrl" alt="" aria-hidden="true">
        <div class="launcher-brand-copy">
          <strong>Oh Awesome Novel</strong>
          <span v-if="appVersion">{{ appVersion }}</span>
        </div>
      </div>

      <nav class="launcher-nav" aria-label="Launcher sections">
        <button
          class="launcher-nav-item"
          :class="{ 'launcher-nav-item-active': section === 'workspaces' }"
          type="button"
          @click="emit('updateSection', 'workspaces')"
        >
          <span>项目</span>
        </button>
        <button
          class="launcher-nav-item"
          :class="{ 'launcher-nav-item-active': section === 'model' }"
          type="button"
          @click="emit('updateSection', 'model')"
        >
          <span>模型</span>
        </button>
        <button
          class="launcher-nav-item"
          :class="{ 'launcher-nav-item-active': section === 'about' }"
          type="button"
          @click="emit('updateSection', 'about')"
        >
          <span>关于</span>
        </button>
      </nav>

      <div class="launcher-sidebar-footer">
        <button
          class="settings-button"
          :class="{ 'settings-button-active': section === 'settings' }"
          type="button"
          aria-label="设置"
          @click="emit('updateSection', 'settings')"
        >
          <Settings :size="20" aria-hidden="true" />
        </button>
      </div>
    </aside>

    <section v-if="section === 'workspaces'" class="launcher-main" aria-label="Workspace list">
      <header class="launcher-main-header">
        <div class="launcher-search">
          <Search class="launcher-search-icon" :size="18" aria-hidden="true" />
          <input
            v-model="query"
            class="launcher-search-input"
            type="search"
            aria-label="搜索项目"
            placeholder="搜索项目、名称、小说或路径"
          >
        </div>
        <div class="launcher-actions">
          <button
            class="icon-button launcher-refresh-button"
            type="button"
            :disabled="loading"
            aria-label="刷新"
            title="刷新"
            @click="emit('refresh')"
          >
            <RefreshCw :size="17" aria-hidden="true" />
          </button>
          <button
            class="secondary-button launcher-action-button"
            type="button"
            :disabled="loading"
            @click="requestNewWorkspaceFolder"
          >
            新建
          </button>
          <button
            class="secondary-button launcher-action-button"
            type="button"
            :disabled="loading"
            @click="requestWorkspaceFolder"
          >
            打开
          </button>
        </div>
      </header>

      <p v-if="error" class="error-copy">{{ error }}</p>

      <div v-if="results.length" class="project-list" role="listbox" aria-label="Recent workspaces">
        <article
          v-for="(workspace, index) in results"
          :key="workspace.path"
          class="project-row"
          :class="{
            'project-row-active': selectedPath === workspace.path,
            'project-row-invalid': !workspace.valid,
          }"
          role="option"
          :aria-selected="selectedPath === workspace.path"
          tabindex="0"
          @click="selectedPath = workspace.path"
          @dblclick="workspace.valid && emit('open', workspace)"
          @keyup.enter="workspace.valid && emit('open', workspace)"
        >
          <div class="project-tile" :class="workspaceAccent(index)">
            {{ workspaceInitials(workspace) }}
          </div>

          <div class="project-main">
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
              <h2 class="project-name">{{ workspace.name }}</h2>
            </template>
            <p class="project-path">{{ workspace.path }}</p>
            <div class="project-meta">
              <span>{{ workspace.novelName || 'Novel workspace' }}</span>
              <span>{{ formatOpenedAt(workspace.lastOpenedAt) }}</span>
            </div>
            <p v-if="!workspace.valid" class="error-copy">{{ workspace.reason }}</p>
          </div>

          <div class="project-actions">
            <button
              v-if="editingPath === workspace.path"
              class="row-action-button"
              type="button"
              @click="saveRename(workspace)"
            >
              保存
            </button>
            <button
              v-else
              class="row-action-button"
              type="button"
              @click="startRename(workspace)"
            >
              改名
            </button>
            <button
              class="row-action-button"
              type="button"
              :disabled="!workspace.valid"
              @click="emit('open', workspace)"
            >
              进入
            </button>
            <button class="row-action-button row-action-danger" type="button" @click="emit('remove', workspace)">
              移除
            </button>
          </div>
        </article>
      </div>

      <div v-else class="empty-state">
        <h2 class="empty-title">还没有最近工作区</h2>
        <p class="empty-copy">导入一个已有 OAN workspace。列表只保存最近使用的元数据，不会写进小说目录。</p>
      </div>

      <div v-if="pathDialogOpen" class="modal-backdrop" role="presentation">
        <section class="web-path-modal" role="dialog" aria-modal="true" aria-label="打开工作区">
          <div class="web-path-modal-header">
            <div>
              <p class="eyebrow">Web Preview</p>
              <h2 class="panel-title">打开工作区</h2>
            </div>
            <button class="icon-button" type="button" aria-label="关闭" @click="closePathDialog">
              ×
            </button>
          </div>

          <p class="empty-copy">纯 Web 预览不能调用系统文件夹选择器，请输入 OAN workspace 目录路径。</p>

          <form class="web-path-form" @submit.prevent="submitImport">
            <input
              v-model="importPath"
              class="text-input"
              type="text"
              placeholder="例如 /Users/me/novels/my-workspace"
            >
            <div class="modal-actions">
              <button class="secondary-button" type="button" :disabled="loading" @click="closePathDialog">
                取消
              </button>
              <button class="primary-button" type="submit" :disabled="loading || !importPath.trim()">
                打开
              </button>
            </div>
          </form>
        </section>
      </div>

      <div v-if="createDialogOpen" class="modal-backdrop" role="presentation">
        <section class="web-path-modal" role="dialog" aria-modal="true" aria-label="新建工作区">
          <div class="web-path-modal-header">
            <div>
              <p class="eyebrow">Web Preview</p>
              <h2 class="panel-title">新建工作区</h2>
            </div>
            <button class="icon-button" type="button" aria-label="关闭" @click="closeCreateDialog">
              ×
            </button>
          </div>

          <p class="empty-copy">纯 Web 预览不能调用系统文件夹选择器，请输入一个空目录路径。</p>

          <form class="web-path-form" @submit.prevent="submitCreate">
            <input
              v-model="createPath"
              class="text-input"
              type="text"
              placeholder="例如 /Users/me/novels/new-story"
            >
            <div class="modal-actions">
              <button class="secondary-button" type="button" :disabled="loading" @click="closeCreateDialog">
                取消
              </button>
              <button class="primary-button" type="submit" :disabled="loading || !createPath.trim()">
                创建
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>

    <LauncherModelView
      v-else-if="section === 'model'"
      @saved="emit('providerConfigured', $event)"
    />

    <section v-else-if="section === 'about'" class="launcher-main about-main" aria-label="About Oh Awesome Novel">
      <div class="about-card">
        <img class="about-icon" :src="appIconUrl" alt="" aria-hidden="true">
        <div>
          <p class="eyebrow">About</p>
          <h1 class="about-title">Oh Awesome Novel</h1>
          <p class="about-copy">Filesystem-first 长篇小说 AI Copilot / Novel IDE。</p>
        </div>
      </div>

      <div class="about-grid">
        <section class="about-section">
          <h2 class="panel-title">产品定位</h2>
          <p class="empty-copy">Markdown / YAML / Object File Tree 是数据库，Git 是历史引擎，AI 是 Copilot。</p>
        </section>
        <section class="about-section">
          <h2 class="panel-title">桌面应用</h2>
          <p class="empty-copy">当前界面以 Electron 为主路径，Web 预览只作为开发 fallback。</p>
        </section>
      </div>

      <section class="about-section about-guide">
        <div class="about-section-heading">
          <p class="eyebrow">Guide</p>
          <h2 class="panel-title">使用说明</h2>
        </div>
        <div class="guide-grid">
          <article class="guide-step">
            <span>1</span>
            <div>
              <strong>创建或打开 workspace</strong>
              <p>新建会初始化 OAN 文件树；打开会导入已有小说目录到最近项目列表。</p>
            </div>
          </article>
          <article class="guide-step">
            <span>2</span>
            <div>
              <strong>完成新建引导</strong>
              <p>填写小说名、基础灵感和角色方向，也可以跳过，之后再从 Copilot 开始。</p>
            </div>
          </article>
          <article class="guide-step">
            <span>3</span>
            <div>
              <strong>配置 Provider</strong>
              <p>配置模型后，中央 Copilot 可以读取项目文件并根据快捷指令推进写作。</p>
            </div>
          </article>
          <article class="guide-step">
            <span>4</span>
            <div>
              <strong>审批写入</strong>
              <p>角色卡、章节草稿、摘要和状态更新都会先进入 PendingAction，确认后才写入真实文件。</p>
            </div>
          </article>
        </div>
      </section>

      <section class="about-section about-guide">
        <div class="about-section-heading">
          <p class="eyebrow">Workflow</p>
          <h2 class="panel-title">推荐写作流程</h2>
        </div>
        <ol class="guide-flow">
          <li>先用 `/生成角色卡` 和 `/规划下一章` 固定人物关系、章节目标与冲突。</li>
          <li>再用 `/写下一章` 生成章节草稿 PendingAction，在右侧查看文件或差异后决定接受。</li>
          <li>每章结束后用 `/整理本章` 更新摘要、角色状态、timeline 和 foreshadow。</li>
          <li>需要润色时使用 `/审稿` 或 `/去AI味`，仍然通过 PendingAction 审批落盘。</li>
        </ol>
      </section>
    </section>

    <LauncherSettingsView
      v-else
      :theme="theme"
      @toggle-theme="emit('toggleTheme')"
    />
  </main>
</template>
