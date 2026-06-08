import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { NovelBackendHandle } from '@oh-awesome-novel/backend';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let backend: NovelBackendHandle | undefined;

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
  backend = await startNovelHttpBackend({
    workspaceRoot: resolveWorkspaceRoot(),
  });
  createWindow();
});

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
