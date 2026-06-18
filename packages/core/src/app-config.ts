import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ThemePreference = 'light' | 'dark';

export interface AppConfig {
  theme?: ThemePreference;
}

const APP_CONFIG_FILENAME = 'app-config.json';

export async function loadAppConfig(configDir: string): Promise<AppConfig> {
  const filePath = appConfigPath(configDir);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    return assertAppConfig(parsed, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

export async function saveAppConfig(configDir: string, config: AppConfig): Promise<void> {
  assertAppConfig(config, 'app config');
  await mkdir(configDir, { recursive: true });
  await writeFile(appConfigPath(configDir), `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export async function loadThemePreference(
  configDir: string,
): Promise<ThemePreference | undefined> {
  return (await loadAppConfig(configDir)).theme;
}

export async function saveThemePreference(
  configDir: string,
  theme: ThemePreference,
): Promise<AppConfig> {
  const config = {
    ...(await loadAppConfig(configDir)),
    theme,
  };

  await saveAppConfig(configDir, config);

  return config;
}

function appConfigPath(configDir: string): string {
  return join(configDir, APP_CONFIG_FILENAME);
}

function assertAppConfig(value: unknown, source: string): AppConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid app config: ${source}`);
  }

  if (
    value.theme !== undefined &&
    value.theme !== 'light' &&
    value.theme !== 'dark'
  ) {
    throw new Error(`Invalid theme preference in: ${source}`);
  }

  return {
    theme: value.theme,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
