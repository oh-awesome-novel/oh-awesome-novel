// @vitest-environment happy-dom

import { effectScope, nextTick } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  readWorkspaceModePreference,
  useWorkspaceLayoutState,
  writeWorkspaceModePreference,
} from '../../../apps/desktop-ui/src/composables/useWorkspaceLayoutState';

describe('workspace UI continuity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores mode and durable layout preferences without persisting overlay state', async () => {
    const workspacePath = '/novels/alpha';
    const firstScope = effectScope();
    const first = firstScope.run(() => useWorkspaceLayoutState(workspacePath))!;

    first.leftPinned.value = false;
    first.leftOverlayOpen.value = true;
    first.rightShown.value = true;
    first.rightTab.value = 'git';
    first.rightWidthPercent.value = 48;
    first.sidebarTab.value = 'chapters';
    writeWorkspaceModePreference(workspacePath, 'play');
    await nextTick();
    firstScope.stop();

    const restoredScope = effectScope();
    const restored = restoredScope.run(() => useWorkspaceLayoutState(workspacePath))!;
    const stored = JSON.parse(
      localStorage.getItem(`oan:workspace-ui:${workspacePath}`) ?? '{}',
    ) as Record<string, unknown>;

    expect(readWorkspaceModePreference(workspacePath)).toBe('play');
    expect(restored.leftPinned.value).toBe(false);
    expect(restored.leftOverlayOpen.value).toBe(false);
    expect(restored.rightShown.value).toBe(true);
    expect(restored.rightTab.value).toBe('git');
    expect(restored.rightWidthPercent.value).toBe(48);
    expect(restored.sidebarTab.value).toBe('chapters');
    expect(stored).not.toHaveProperty('leftOverlayOpen');
    expect(stored).not.toHaveProperty('showSpoilers');

    restoredScope.stop();
  });

  it('keeps preferences isolated by workspace path', async () => {
    const firstScope = effectScope();
    const first = firstScope.run(() => useWorkspaceLayoutState('/novels/alpha'))!;
    first.leftPinned.value = false;
    first.rightShown.value = true;
    writeWorkspaceModePreference('/novels/alpha', 'play');
    await nextTick();
    firstScope.stop();

    const secondScope = effectScope();
    const second = secondScope.run(() => useWorkspaceLayoutState('/novels/beta'))!;

    expect(readWorkspaceModePreference('/novels/beta')).toBe('writing');
    expect(second.leftPinned.value).toBe(true);
    expect(second.rightShown.value).toBe(false);

    secondScope.stop();
  });
});
