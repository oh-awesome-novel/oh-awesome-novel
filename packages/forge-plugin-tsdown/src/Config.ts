export type TsdownPluginTarget = 'main' | 'preload';

export type TsdownPluginEntry =
  | string
  | string[]
  | Record<string, string | string[]>;

export type TsdownPluginUserConfig = Record<string, unknown>;

export interface TsdownPluginBuildConfig {
  /**
   * Entry passed to tsdown. A string entry such as "src/main.ts" emits
   * ".vite/build/main.js" with the default plugin output options.
   */
  entry: TsdownPluginEntry;
  /**
   * Human readable Electron target.
   *
   * @defaultValue "main"
   */
  target?: TsdownPluginTarget;
  /**
   * Additional tsdown options for this target.
   */
  config?: TsdownPluginUserConfig;
}

export interface TsdownPluginRendererConfig {
  /**
   * Path to a Vite-built renderer dist directory.
   */
  dist: string;
  /**
   * Destination in the packaged app.
   *
   * @defaultValue ".vite/renderer"
   */
  outDir?: string;
}

export interface TsdownPluginConfig {
  /**
   * Build targets such as the Electron main process and preload scripts.
   */
  build: TsdownPluginBuildConfig[];
  /**
   * Optional external renderer dist to copy during packaging.
   */
  renderer?: TsdownPluginRendererConfig;
  /**
   * Output directory for main/preload bundles.
   *
   * @defaultValue ".vite/build"
   */
  outDir?: string;
  /**
   * Run build targets concurrently.
   *
   * @defaultValue true
   */
  concurrent?: boolean;
}
