import { onMounted, shallowRef, watch } from 'vue';

import { oanClient } from '../client';
import type { ThemeMode } from '@oh-awesome-novel/client';

export type { ThemeMode };

export function useThemePreference() {
  const theme = shallowRef<ThemeMode>(oanClient.getSystemThemePreference());
  const hydrated = shallowRef(false);

  onMounted(async () => {
    theme.value = await readThemePreference();
    hydrated.value = true;
  });

  watch(
    theme,
    (nextTheme) => {
      document.documentElement.dataset.theme = nextTheme;

      if (hydrated.value) {
        void writeThemePreference(nextTheme);
      }
    },
    { immediate: true },
  );

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  return {
    theme,
    toggleTheme,
  };
}

async function readThemePreference(): Promise<ThemeMode> {
  return oanClient.getThemePreference();
}

async function writeThemePreference(theme: ThemeMode): Promise<void> {
  await oanClient.setThemePreference(theme);
}
