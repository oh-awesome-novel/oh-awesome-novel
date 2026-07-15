import { computed, shallowRef, watch } from 'vue';

export type WorkspaceMode = 'writing' | 'play';
export type WorkspaceRightTab = 'file' | 'diff' | 'approval' | 'health' | 'git' | 'references';
export type WorkspaceSidebarTab = 'files' | 'chapters' | 'history';

interface PersistedWorkspaceUiState {
  version: 1;
  workspaceMode: WorkspaceMode;
  leftPinned: boolean;
  rightShown: boolean;
  rightTab: WorkspaceRightTab;
  rightWidthPercent: number;
  sidebarTab: WorkspaceSidebarTab;
}

const WORKSPACE_UI_STATE_VERSION = 1 as const;
const WORKSPACE_UI_STORAGE_PREFIX = 'oan:workspace-ui:';
const WORKSPACE_RIGHT_TABS: readonly WorkspaceRightTab[] = [
  'file',
  'diff',
  'approval',
  'health',
  'git',
  'references',
];
const WORKSPACE_SIDEBAR_TABS: readonly WorkspaceSidebarTab[] = [
  'files',
  'chapters',
  'history',
];
const DEFAULT_WORKSPACE_UI_STATE: PersistedWorkspaceUiState = {
  version: WORKSPACE_UI_STATE_VERSION,
  workspaceMode: 'writing',
  leftPinned: true,
  rightShown: false,
  rightTab: 'approval',
  rightWidthPercent: 36,
  sidebarTab: 'files',
};

export function useWorkspaceLayoutState(workspacePath: string) {
  const restored = readWorkspaceUiState(workspacePath);

  const leftPinned = shallowRef(restored.leftPinned);
  const leftOverlayOpen = shallowRef(false);
  const rightShown = shallowRef(restored.rightShown);
  const rightTab = shallowRef<WorkspaceRightTab>(restored.rightTab);
  const rightWidthPercent = shallowRef(restored.rightWidthPercent);
  const sidebarTab = shallowRef<WorkspaceSidebarTab>(restored.sidebarTab);

  const workbenchStyle = computed(() => ({
    '--right-panel-width': `${rightWidthPercent.value}%`,
  }));

  const workbenchClass = computed(() => ({
    'workspace-workbench-left-hidden': !leftPinned.value,
    'workspace-workbench-right-hidden': !rightShown.value,
  }));

  watch(
    [leftPinned, rightShown, rightTab, rightWidthPercent, sidebarTab],
    ([nextLeftPinned, nextRightShown, nextRightTab, nextRightWidthPercent, nextSidebarTab]) => {
      updateWorkspaceUiState(workspacePath, {
        leftPinned: nextLeftPinned,
        rightShown: nextRightShown,
        rightTab: nextRightTab,
        rightWidthPercent: nextRightWidthPercent,
        sidebarTab: nextSidebarTab,
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

export function readWorkspaceModePreference(workspacePath: string): WorkspaceMode {
  return readWorkspaceUiState(workspacePath).workspaceMode;
}

export function writeWorkspaceModePreference(
  workspacePath: string,
  mode: WorkspaceMode,
): void {
  updateWorkspaceUiState(workspacePath, { workspaceMode: mode });
}

function readWorkspaceUiState(workspacePath: string): PersistedWorkspaceUiState {
  if (!workspacePath) {
    return { ...DEFAULT_WORKSPACE_UI_STATE };
  }

  try {
    const raw = globalThis.localStorage?.getItem(workspaceUiStorageKey(workspacePath));
    if (!raw) {
      return { ...DEFAULT_WORKSPACE_UI_STATE };
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== WORKSPACE_UI_STATE_VERSION) {
      return { ...DEFAULT_WORKSPACE_UI_STATE };
    }

    return {
      version: WORKSPACE_UI_STATE_VERSION,
      workspaceMode: isWorkspaceMode(parsed.workspaceMode)
        ? parsed.workspaceMode
        : DEFAULT_WORKSPACE_UI_STATE.workspaceMode,
      leftPinned: typeof parsed.leftPinned === 'boolean'
        ? parsed.leftPinned
        : DEFAULT_WORKSPACE_UI_STATE.leftPinned,
      rightShown: typeof parsed.rightShown === 'boolean'
        ? parsed.rightShown
        : DEFAULT_WORKSPACE_UI_STATE.rightShown,
      rightTab: isWorkspaceRightTab(parsed.rightTab)
        ? parsed.rightTab
        : DEFAULT_WORKSPACE_UI_STATE.rightTab,
      rightWidthPercent: isRightWidthPercent(parsed.rightWidthPercent)
        ? parsed.rightWidthPercent
        : DEFAULT_WORKSPACE_UI_STATE.rightWidthPercent,
      sidebarTab: isWorkspaceSidebarTab(parsed.sidebarTab)
        ? parsed.sidebarTab
        : DEFAULT_WORKSPACE_UI_STATE.sidebarTab,
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_UI_STATE };
  }
}

function updateWorkspaceUiState(
  workspacePath: string,
  patch: Partial<Omit<PersistedWorkspaceUiState, 'version'>>,
): void {
  if (!workspacePath) {
    return;
  }

  try {
    globalThis.localStorage?.setItem(
      workspaceUiStorageKey(workspacePath),
      JSON.stringify({
        ...readWorkspaceUiState(workspacePath),
        ...patch,
        version: WORKSPACE_UI_STATE_VERSION,
      } satisfies PersistedWorkspaceUiState),
    );
  } catch {
    // Workspace UI continuity is best-effort; novel and Play facts remain filesystem-backed.
  }
}

function workspaceUiStorageKey(workspacePath: string): string {
  return `${WORKSPACE_UI_STORAGE_PREFIX}${workspacePath}`;
}

function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === 'writing' || value === 'play';
}

function isWorkspaceRightTab(value: unknown): value is WorkspaceRightTab {
  return WORKSPACE_RIGHT_TABS.some((tab) => tab === value);
}

function isWorkspaceSidebarTab(value: unknown): value is WorkspaceSidebarTab {
  return WORKSPACE_SIDEBAR_TABS.some((tab) => tab === value);
}

function isRightWidthPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 80;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
