<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue';
import type { Component } from 'vue';
import {
  BookOpen,
  Bot,
  Braces,
  ChevronDown,
  CirclePlay,
  GitBranch,
  House,
  Library,
  ListChecks,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Search,
  Settings,
  Sun,
  LogOut,
} from '@lucide/vue';

import type { WorkspaceRightTab } from '../../composables/useWorkspaceLayoutState';
import type { WorkspaceSummary } from '../../composables/useWorkspaceApi';

type ExternalEditor = 'vscode' | 'zed' | 'webstorm';

interface ToolbarNavItem {
  id: string;
  label: string;
  icon: Component;
  rightTab?: WorkspaceRightTab;
}

interface EditorOption {
  id: ExternalEditor;
  label: string;
  icon: Component;
}

const props = defineProps<{
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
  theme: 'light' | 'dark';
  leftPinned: boolean;
  rightShown: boolean;
  rightTab: WorkspaceRightTab;
  pendingActionCount: number;
  editorError?: string;
}>();

const emit = defineEmits<{
  toggleLeft: [];
  showHome: [];
  openChapters: [];
  openSearch: [];
  openPending: [];
  openRightTab: [tab: WorkspaceRightTab];
  openExternalEditor: [editor: ExternalEditor];
  toggleRight: [];
  configureProvider: [];
  toggleTheme: [];
  leaveWorkspace: [];
}>();

const editorMenu = useTemplateRef<HTMLDetailsElement>('editor-menu');
const selectedEditor = shallowRef<ExternalEditor>('vscode');

const navigationItems: ToolbarNavItem[] = [
  { id: 'home', label: 'Home', icon: House, rightTab: 'health' },
  { id: 'chapters', label: 'Chapters', icon: BookOpen },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'pending', label: 'Pending actions', icon: ListChecks, rightTab: 'approval' },
  { id: 'git', label: 'Git', icon: GitBranch, rightTab: 'git' },
  { id: 'references', label: 'References', icon: Library, rightTab: 'references' },
  { id: 'play', label: 'Play', icon: CirclePlay, rightTab: 'play' },
];

const editorOptions: EditorOption[] = [
  { id: 'vscode', label: 'VS Code', icon: Monitor },
  { id: 'zed', label: 'Zed', icon: Pencil },
  { id: 'webstorm', label: 'WebStorm', icon: Braces },
];

const selectedEditorOption = computed(() =>
  editorOptions.find((option) => option.id === selectedEditor.value) ?? editorOptions[0],
);
const providerLabel = computed(() =>
  props.providerConfigured ? 'Provider ready' : 'Configure provider',
);
const themeLabel = computed(() =>
  props.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
);

function isNavigationActive(item: ToolbarNavItem): boolean {
  return Boolean(item.rightTab && props.rightTab === item.rightTab);
}

function triggerNavigation(item: ToolbarNavItem) {
  switch (item.id) {
    case 'home':
      emit('showHome');
      return;
    case 'chapters':
      emit('openChapters');
      return;
    case 'search':
      emit('openSearch');
      return;
    case 'pending':
      emit('openPending');
      return;
    default:
      if (item.rightTab) {
        emit('openRightTab', item.rightTab);
      }
  }
}

function chooseEditor(editor: ExternalEditor) {
  selectedEditor.value = editor;
  editorMenu.value?.removeAttribute('open');
  emit('openExternalEditor', editor);
}
</script>

<template>
  <header class="workspace-toolbar">
    <div class="toolbar-left">
      <button
        class="toolbar-icon-action"
        type="button"
        :aria-label="leftPinned ? '隐藏文件栏' : '固定文件栏'"
        :title="leftPinned ? '隐藏文件栏' : '固定文件栏'"
        @click="emit('toggleLeft')"
      >
        <PanelLeftClose v-if="leftPinned" :size="18" aria-hidden="true" />
        <PanelLeftOpen v-else :size="18" aria-hidden="true" />
      </button>

      <nav class="toolbar-nav-group" aria-label="Workspace navigation">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="toolbar-icon-action"
          :class="{ 'toolbar-icon-action-active': isNavigationActive(item) }"
          type="button"
          :aria-label="item.label"
          :title="item.label"
          @click="triggerNavigation(item)"
        >
          <component :is="item.icon" :size="18" aria-hidden="true" />
          <span
            v-if="item.id === 'pending' && pendingActionCount > 0"
            class="toolbar-icon-badge"
            aria-hidden="true"
          >
            {{ pendingActionCount }}
          </span>
        </button>
      </nav>
    </div>

    <div class="toolbar-title" :title="workspace.path">
      <strong>{{ workspace.name }}</strong>
      <span>{{ workspace.path }}</span>
      <small v-if="editorError" class="toolbar-error">{{ editorError }}</small>
    </div>

    <div class="toolbar-right">
      <button
        class="toolbar-status-button"
        :class="{ 'toolbar-status-button-ready': providerConfigured }"
        type="button"
        :aria-label="providerLabel"
        :title="providerLabel"
        @click="emit('configureProvider')"
      >
        <Bot :size="17" aria-hidden="true" />
        <span class="toolbar-status-dot" aria-hidden="true"></span>
      </button>

      <details ref="editor-menu" class="toolbar-editor-menu">
        <summary
          class="toolbar-editor-trigger"
          :aria-label="`Open workspace in ${selectedEditorOption.label}`"
          :title="`Open workspace in ${selectedEditorOption.label}`"
        >
          <component :is="selectedEditorOption.icon" :size="17" aria-hidden="true" />
          <ChevronDown :size="15" aria-hidden="true" />
        </summary>
        <div class="toolbar-editor-list" role="menu" aria-label="Open external editor">
          <button
            v-for="option in editorOptions"
            :key="option.id"
            class="toolbar-editor-item"
            type="button"
            role="menuitem"
            @click="chooseEditor(option.id)"
          >
            <component :is="option.icon" :size="16" aria-hidden="true" />
            <span>{{ option.label }}</span>
          </button>
        </div>
      </details>

      <button
        class="toolbar-icon-action"
        type="button"
        :aria-label="rightShown ? '隐藏审阅栏' : '显示审阅栏'"
        :title="rightShown ? '隐藏审阅栏' : '显示审阅栏'"
        @click="emit('toggleRight')"
      >
        <PanelRightClose v-if="rightShown" :size="18" aria-hidden="true" />
        <PanelRightOpen v-else :size="18" aria-hidden="true" />
      </button>

      <button
        class="toolbar-icon-action"
        type="button"
        role="switch"
        :aria-checked="theme === 'dark'"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="emit('toggleTheme')"
      >
        <Moon v-if="theme === 'dark'" :size="17" aria-hidden="true" />
        <Sun v-else :size="17" aria-hidden="true" />
      </button>

      <button
        class="toolbar-icon-action"
        type="button"
        aria-label="Provider settings"
        title="Provider settings"
        @click="emit('configureProvider')"
      >
        <Settings :size="17" aria-hidden="true" />
      </button>

      <button
        class="toolbar-icon-action"
        type="button"
        aria-label="Back to launcher"
        title="Back to launcher"
        @click="emit('leaveWorkspace')"
      >
        <LogOut :size="17" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
