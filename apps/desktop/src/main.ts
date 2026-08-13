import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import type { OpenDialogOptions } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import {
  loadAppConfig,
  loadThemePreference,
  saveAppConfig,
  saveThemePreference,
} from '@oh-awesome-novel/core';
import type { NovelBackendHandle } from '@oh-awesome-novel/backend';
import type {
  AppConfig,
  ComposerSubmitShortcutPreference,
  ThemePreference,
} from '@oh-awesome-novel/core';
import {
  createSandboxEditSession,
  createWorkspaceChangePolicy,
} from '@oh-awesome-novel/tools';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let backend: NovelBackendHandle | undefined;
const packagedMainSmokeEnabled = process.argv.some((argument) => (
  argument === '--oan-packaged-main-smoke'
  || argument === '--oan-packaged-main-smoke=1'
));

ipcMain.handle('oan:app:get-version', () => app.getVersion());

ipcMain.handle('oan:app-config:get', async () => loadAppConfig(resolveDesktopConfigDir()));

ipcMain.handle('oan:app-config:set', async (_event, input: unknown) => {
  if (!isRecord(input)) {
    throw new Error('Invalid app config input.');
  }

  const config: AppConfig = {
    ...(await loadAppConfig(resolveDesktopConfigDir())),
  };

  if (hasOwn(input, 'theme')) {
    if (!isThemePreference(input.theme)) {
      throw new Error('Invalid theme preference.');
    }

    config.theme = input.theme;
  }

  if (hasOwn(input, 'composerSubmitShortcut')) {
    if (!isComposerSubmitShortcutPreference(input.composerSubmitShortcut)) {
      throw new Error('Invalid composer submit shortcut preference.');
    }

    config.composerSubmitShortcut = input.composerSubmitShortcut;
  }

  await saveAppConfig(resolveDesktopConfigDir(), config);

  return config;
});

ipcMain.handle('oan:theme:get', async () => {
  const theme = await loadThemePreference(resolveDesktopConfigDir());

  return theme ?? getSystemTheme();
});

ipcMain.handle('oan:theme:set', async (_event, theme: unknown) => {
  if (!isThemePreference(theme)) {
    throw new Error('Invalid theme preference.');
  }

  await saveThemePreference(resolveDesktopConfigDir(), theme);

  return theme;
});

ipcMain.handle('oan:workspace:select-directory', async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: '打开 Oh Awesome Novel 工作区',
    properties: ['openDirectory'],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled) {
    return undefined;
  }

  return result.filePaths[0];
});

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: backend
        ? [`--oan-backend-base-url=${backend.url}`]
        : [],
    },
  });

  const rendererDevServerUrl = process.env.OAN_DESKTOP_UI_DEV_SERVER_URL;

  if (rendererDevServerUrl) {
    mainWindow.loadURL(rendererDevServerUrl);
  } else {
    mainWindow.loadFile(getRendererIndexPath());
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

const getRendererIndexPath = () => {
  if (app.isPackaged) {
    return path.join(__dirname, '../renderer/index.html');
  }

  return path.resolve(app.getAppPath(), '../desktop-ui/dist/index.html');
};

app.on('ready', async () => {
  if (packagedMainSmokeEnabled) {
    return;
  }

  backend = await startNovelHttpBackend({
    seedWorkspaceRoot: resolveWorkspaceRoot(),
  });
  createWindow();
});

if (packagedMainSmokeEnabled) {
  void runPackagedMainSmoke().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  void backend?.close();
});

function resolveWorkspaceRoot(): string {
  return (
    process.env.OAN_WORKSPACE_ROOT ??
    path.resolve(app.getAppPath(), '../../examples/sample-novel')
  );
}

function resolveDesktopConfigDir(): string {
  return app.getPath('userData');
}

function getSystemTheme(): ThemePreference {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark';
}

function isComposerSubmitShortcutPreference(
  value: unknown,
): value is ComposerSubmitShortcutPreference {
  return value === 'enter' || value === 'meta-enter' || value === 'ctrl-enter';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function runPackagedMainSmoke(): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'oan-packaged-main-smoke-'));
  let session: Awaited<ReturnType<typeof createSandboxEditSession>> | undefined;
  let output: Record<string, unknown> | undefined;
  let exitCode = 0;
  try {
    const relativePath = 'summaries/smoke.md';
    const canonicalPath = path.join(workspaceRoot, relativePath);
    const original = '# Smoke\n\nbefore\n';
    await mkdir(path.dirname(canonicalPath), { recursive: true });
    await writeFile(canonicalPath, original, 'utf8');
    session = await createSandboxEditSession({
      workspaceRoot,
      sessionId: 'packaged-main-smoke',
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: async () => ({
        repositoryId: '0'.repeat(64),
        branch: 'smoke',
        head: '0'.repeat(40),
      }),
    });
    const bash = session.tools.bash as {
      execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
    };
    if (!bash.execute) throw new Error('Packaged sandbox bash tool is unavailable.');
    const result = await bash.execute({
      command: "printf '# Smoke\\n\\nafter\\n' > summaries/smoke.md",
    }, {});
    if (!isRecord(result) || result.exitCode !== 0) {
      throw new Error('Packaged sandbox command failed.');
    }
    const preview = await session.preview();
    const candidate = await session.finalizeCandidate({ finalization: 'runtime-fallback' });
    const canonical = await readFile(canonicalPath, 'utf8');
    if (
      canonical !== original
      || preview.changes.length !== 1
      || preview.changes[0]?.operation !== 'update'
      || preview.changes[0]?.path !== relativePath
      || candidate?.changes.length !== 1
    ) {
      throw new Error('Packaged sandbox smoke assertions failed.');
    }
    await session.dispose();
    try {
      await session.preview();
      throw new Error('Disposed packaged sandbox session remained usable.');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('disposed')) throw error;
    }
    session = undefined;
    output = {
      ok: true,
      component: 'sandbox-change-engine',
      operation: candidate.changes[0]?.operation,
      path: candidate.changes[0]?.path,
    };
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    exitCode = 1;
  } finally {
    await session?.dispose();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  app.exit(exitCode);
}
