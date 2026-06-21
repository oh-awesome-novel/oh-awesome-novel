import { computed, onMounted, shallowRef } from 'vue';

import { oanClient } from '../client';
import type { ComposerSubmitShortcutPreference } from '@oh-awesome-novel/client';

export type ComposerSubmitShortcut = ComposerSubmitShortcutPreference;

interface ComposerShortcutOption {
  value: ComposerSubmitShortcut;
  label: string;
  description: string;
}

const shortcut = shallowRef<ComposerSubmitShortcut>(defaultShortcut());
const hydrated = shallowRef(false);
let hydrating: Promise<void> | undefined;
let changedBeforeHydration = false;

export function useComposerShortcutPreference() {
  onMounted(() => {
    void hydrateShortcutPreference();
  });

  const shortcutOptions = computed<ComposerShortcutOption[]>(() => [
    {
      value: 'enter',
      label: 'Enter',
      description: '按 Enter 发送，Shift + Enter 换行。',
    },
    {
      value: 'meta-enter',
      label: isMacPlatform() ? 'Cmd + Enter' : 'Meta + Enter',
      description: 'macOS 默认发送方式。',
    },
    {
      value: 'ctrl-enter',
      label: 'Ctrl + Enter',
      description: '跨平台的保守发送方式。',
    },
  ]);

  const shortcutLabel = computed(() =>
    shortcutOptions.value.find((option) => option.value === shortcut.value)?.label ?? 'Ctrl + Enter',
  );

  function setShortcut(value: ComposerSubmitShortcut) {
    shortcut.value = value;
    changedBeforeHydration = !hydrated.value;
    void writeShortcutPreference(value);
  }

  return {
    shortcut,
    shortcutLabel,
    shortcutOptions,
    setShortcut,
  };
}

export function shouldSubmitWithShortcut(event: KeyboardEvent, value: ComposerSubmitShortcut): boolean {
  if (event.key !== 'Enter' || event.isComposing) {
    return false;
  }

  if (value === 'enter') {
    return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
  }

  if (value === 'meta-enter') {
    return event.metaKey;
  }

  return event.ctrlKey;
}

function defaultShortcut(): ComposerSubmitShortcut {
  return isMacPlatform() ? 'meta-enter' : 'ctrl-enter';
}

async function hydrateShortcutPreference(): Promise<void> {
  if (hydrated.value) {
    return;
  }

  hydrating ??= (async () => {
    const stored = await oanClient.getComposerSubmitShortcutPreference();
    if (stored && !changedBeforeHydration) {
      shortcut.value = stored;
    }

    hydrated.value = true;

    if (changedBeforeHydration) {
      await writeShortcutPreference(shortcut.value);
    }
  })();

  await hydrating;
}

async function writeShortcutPreference(value: ComposerSubmitShortcut): Promise<void> {
  await oanClient.setComposerSubmitShortcutPreference(value);
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
