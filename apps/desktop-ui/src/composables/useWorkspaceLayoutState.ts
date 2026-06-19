import { computed, onMounted, shallowRef, watch } from 'vue';

export type WorkspaceRightTab = 'file' | 'diff' | 'approval' | 'health' | 'git' | 'references' | 'play';

interface PersistedWorkspaceLayoutState {
  leftPinned?: boolean;
  rightShown?: boolean;
  rightTab?: WorkspaceRightTab;
  rightWidthPercent?: number;
  sidebarTab?: 'files' | 'chapters';
}

export function useWorkspaceLayoutState(workspacePath: string) {
  const storageKey = `oan.workspace.layout.${hashWorkspacePath(workspacePath)}`;
  const leftPinned = shallowRef(true);
  const leftOverlayOpen = shallowRef(false);
  const rightShown = shallowRef(true);
  const rightTab = shallowRef<WorkspaceRightTab>('approval');
  const rightWidthPercent = shallowRef(36);
  const sidebarTab = shallowRef<'files' | 'chapters'>('files');

  const workbenchStyle = computed(() => ({
    '--right-panel-width': `${rightWidthPercent.value}%`,
  }));

  const workbenchClass = computed(() => ({
    'workspace-workbench-left-hidden': !leftPinned.value,
    'workspace-workbench-right-hidden': !rightShown.value,
  }));

  onMounted(() => {
    const stored = readStoredLayout(storageKey);
    leftPinned.value = stored.leftPinned ?? leftPinned.value;
    rightShown.value = stored.rightShown ?? rightShown.value;
    rightTab.value = stored.rightTab ?? rightTab.value;
    rightWidthPercent.value = clampRightWidth(stored.rightWidthPercent ?? rightWidthPercent.value);
    sidebarTab.value = stored.sidebarTab ?? sidebarTab.value;
  });

  watch(
    [leftPinned, rightShown, rightTab, rightWidthPercent, sidebarTab],
    () => {
      writeStoredLayout(storageKey, {
        leftPinned: leftPinned.value,
        rightShown: rightShown.value,
        rightTab: rightTab.value,
        rightWidthPercent: rightWidthPercent.value,
        sidebarTab: sidebarTab.value,
      });
    },
  );

  function toggleLeftPinned() {
    leftPinned.value = !leftPinned.value;
    if (leftPinned.value) {
      leftOverlayOpen.value = false;
    }
  }

  function openRightPanel(tab: WorkspaceRightTab = rightTab.value) {
    rightTab.value = tab;
    rightShown.value = true;
  }

  function toggleRightPanel(tab?: WorkspaceRightTab) {
    if (tab && tab !== rightTab.value) {
      openRightPanel(tab);
      return;
    }

    rightShown.value = !rightShown.value;
  }

  return {
    leftPinned,
    leftOverlayOpen,
    rightShown,
    rightTab,
    rightWidthPercent,
    sidebarTab,
    workbenchClass,
    workbenchStyle,
    openRightPanel,
    toggleLeftPinned,
    toggleRightPanel,
  };
}

function readStoredLayout(key: string): PersistedWorkspaceLayoutState {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as PersistedWorkspaceLayoutState : {};
  } catch {
    return {};
  }
}

function writeStoredLayout(key: string, value: PersistedWorkspaceLayoutState) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

function hashWorkspacePath(path: string): string {
  let hash = 0;

  for (const char of path) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function clampRightWidth(value: number): number {
  return Math.min(Math.max(value, 28), 48);
}
