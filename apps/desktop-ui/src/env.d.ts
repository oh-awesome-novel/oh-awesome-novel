/// <reference types="vite/client" />

interface Window {
  ohAwesomeNovel?: {
    backendBaseUrl?: string;
    app?: {
      getVersion: () => Promise<string>;
    };
    theme?: {
      get: () => Promise<'light' | 'dark'>;
      set: (theme: 'light' | 'dark') => Promise<'light' | 'dark'>;
    };
    workspace?: {
      selectDirectory: () => Promise<string | undefined>;
    };
  };
}
