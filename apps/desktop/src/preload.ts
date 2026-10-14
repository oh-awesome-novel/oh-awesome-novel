import { contextBridge, ipcRenderer } from 'electron';

const backendBaseUrl = readArgument('--oan-backend-base-url=');
const backendToken = readArgument('--oan-backend-token=');

contextBridge.exposeInMainWorld('ohAwesomeNovel', {
  backendBaseUrl,
  backendToken,
  app: {
    getVersion: () => ipcRenderer.invoke('oan:app:get-version'),
  },
  appConfig: {
    get: () => ipcRenderer.invoke('oan:app-config:get'),
    set: (config: unknown) => ipcRenderer.invoke('oan:app-config:set', config),
  },
  theme: {
    get: () => ipcRenderer.invoke('oan:theme:get'),
    set: (theme: 'light' | 'dark') => ipcRenderer.invoke('oan:theme:set', theme),
  },
  workspace: {
    selectDirectory: () => ipcRenderer.invoke('oan:workspace:select-directory'),
  },
});

function readArgument(prefix: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
