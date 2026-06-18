import { onMounted, shallowRef, watch } from 'vue';

export type ThemeMode = 'light' | 'dark';

export function useThemePreference() {
  const theme = shallowRef<ThemeMode>(getSystemTheme());
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
  const desktopTheme = window.ohAwesomeNovel?.theme;

  if (desktopTheme) {
    return desktopTheme.get();
  }

  return getSystemTheme();
}

async function writeThemePreference(theme: ThemeMode): Promise<void> {
  const desktopTheme = window.ohAwesomeNovel?.theme;

  if (desktopTheme) {
    await desktopTheme.set(theme);
  }
}

function getSystemTheme(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
