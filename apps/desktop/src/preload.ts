import { contextBridge, ipcRenderer } from 'electron';

const backendBaseUrl = process.argv
  .find((arg) => arg.startsWith('--oan-backend-base-url='))
  ?.slice('--oan-backend-base-url='.length);

contextBridge.exposeInMainWorld('ohAwesomeNovel', {
  backendBaseUrl,
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
