declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * Optional Vite dev server URL for apps/desktop-ui.
     *
     * Example: http://localhost:5173
     */
    OAN_DESKTOP_UI_DEV_SERVER_URL?: string;
  }
}
