/// <reference types="vite/client" />

import type { OanDesktopBridge } from '@oh-awesome-novel/client';

declare global {
  interface Window {
    ohAwesomeNovel?: OanDesktopBridge;
  }
}

export {};
