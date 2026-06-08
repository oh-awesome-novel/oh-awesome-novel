import { contextBridge } from 'electron';

const backendBaseUrl = process.argv
  .find((arg) => arg.startsWith('--oan-backend-base-url='))
  ?.slice('--oan-backend-base-url='.length);

contextBridge.exposeInMainWorld('ohAwesomeNovel', {
  backendBaseUrl,
});
