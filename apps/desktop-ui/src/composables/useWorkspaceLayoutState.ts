import { computed, shallowRef } from 'vue';

export type WorkspaceMode = 'writing' | 'play';
export type WorkspaceRightTab = 'file' | 'diff' | 'approval' | 'health' | 'git' | 'references';
export type WorkspaceSidebarTab = 'files' | 'chapters' | 'history';

export function useWorkspaceLayoutState(workspacePath: string) {
  void workspacePath;

  const leftPinned = shallowRef(true);
  const leftOverlayOpen = shallowRef(false);
  const rightShown = shallowRef(false);
  const rightTab = shallowRef<WorkspaceRightTab>('approval');
  const rightWidthPercent = shallowRef(36);
  const sidebarTab = shallowRef<WorkspaceSidebarTab>('files');

  const workbenchStyle = computed(() => ({
    '--right-panel-width': `${rightWidthPercent.value}%`,
  }));

  const workbenchClass = computed(() => ({
    'workspace-workbench-left-hidden': !leftPinned.value,
    'workspace-workbench-right-hidden': !rightShown.value,
  }));

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
