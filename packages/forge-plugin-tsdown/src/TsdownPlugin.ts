import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { namedHookWithTaskFn, PluginBase } from '@electron-forge/plugin-base';

import type { TsdownPluginBuildConfig, TsdownPluginConfig } from './Config';
import type {
  ForgeListrTask,
  ForgeMultiHookMap,
  ResolvedForgeConfig,
} from '@electron-forge/shared-types';
import type { ViteDevServer } from 'vite';

type TsdownBuild = (config: Record<string, unknown>) => Promise<unknown>;
type ViteModule = typeof import('vite');
type ForgeTask = ForgeListrTask<any>;
type ForgeTaskList = ReturnType<ForgeTask['newListr']>;

const electronExternals = [
  'electron',
  'electron/main',
  'electron/common',
  'electron/renderer',
];

const nodeExternals = builtinModules.flatMap((moduleName) => [
  moduleName,
  `node:${moduleName}`,
]);

const defaultRendererDevServerEnv = 'OAN_DESKTOP_UI_DEV_SERVER_URL';

export default class TsdownPlugin extends PluginBase<TsdownPluginConfig> {
  public name = 'tsdown';

  private projectDir!: string;
  private baseDir!: string;
  private outDir!: string;
  private isProd = false;
  private rendererDevServer?: ViteDevServer;

  init = (dir: string): void => {
    this.setDirectories(dir);
  };

  public setDirectories(dir: string): void {
    this.projectDir = dir;
    this.baseDir = path.join(dir, '.vite');
    this.outDir = path.resolve(dir, this.config.outDir ?? '.vite/build');
  }

  getHooks = (): ForgeMultiHookMap => {
    return {
      preStart: [
        namedHookWithTaskFn<'preStart'>(async (task) => {
          await this.cleanBaseDir();
          if (!task) {
            await this.launchRendererDevServer();
            await this.build(null, 'development');
            return;
          }

          const tasks = [];

          if (this.config.renderer) {
            tasks.push({
              title: 'Launching renderer Vite dev server',
              task: async (_ctx: unknown, subtask: ForgeTask) => {
                await this.launchRendererDevServer(subtask);
                subtask.title = 'Launched renderer Vite dev server';
              },
            });
          }

          tasks.push({
            title: 'Building Electron main and preload bundles',
            task: async (_ctx: unknown, subtask: ForgeTask) => {
              await this.build(subtask, 'development');
            },
          });

          return task.newListr(tasks, {
            concurrent: false,
            exitOnError: true,
            rendererOptions: {
              collapseSubtasks: false,
              persistentOutput: true,
            },
          } as Parameters<ForgeTask['newListr']>[1]);
        }, 'Preparing tsdown bundles'),
      ],
      postStart: async (_forgeConfig, child) => {
        child.on('exit', () => {
          void this.closeRendererDevServer();
        });
      },
      prePackage: [
        namedHookWithTaskFn<'prePackage'>(async (task) => {
          this.isProd = true;
          await this.cleanBaseDir();
          return this.build(task, 'production');
        }, 'Building production tsdown bundles'),
      ],
      resolveForgeConfig: this.resolveForgeConfig,
      packageAfterCopy: this.packageAfterCopy,
    };
  };

  resolveForgeConfig = async (
    forgeConfig: ResolvedForgeConfig,
  ): Promise<ResolvedForgeConfig> => {
    forgeConfig.packagerConfig ??= {};

    if (forgeConfig.packagerConfig.ignore) {
      return forgeConfig;
    }

    forgeConfig.packagerConfig.ignore = (file: string) => {
      if (!file) return false;
      return !file.startsWith('/.vite');
    };

    return forgeConfig;
  };

  packageAfterCopy = async (
    _forgeConfig: ResolvedForgeConfig,
    buildPath: string,
  ): Promise<void> => {
    const packageJsonPath = path.resolve(this.projectDir, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

    if (!packageJson.main?.includes('.vite/')) {
      throw new Error(`Electron Forge is configured to use the tsdown plugin. The plugin expects the
"main" entry point in "package.json" to be ".vite/*" where the plugin outputs generated files.
Instead, it is ${JSON.stringify(packageJson.main)}.`);
    }

    if (packageJson.config) {
      delete packageJson.config.forge;
    }

    await writeFile(
      path.resolve(buildPath, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );

    if (this.config.renderer) {
      const rendererDist = this.getRendererDistDir();
      const rendererOutDir = path.resolve(
        buildPath,
        this.config.renderer.outDir ?? '.vite/renderer',
      );

      await rm(rendererOutDir, { force: true, recursive: true });
      await cp(rendererDist, rendererOutDir, { recursive: true });
    }
  };

  public async launchRendererDevServer(task?: ForgeTask): Promise<void> {
    if (!this.config.renderer) {
      return;
    }

    if (this.rendererDevServer) {
      this.setRendererDevServerOutput(task);
      return;
    }

    const vite = await importVite();
    const rendererRoot = this.getRendererProjectDir();
    const rendererConfig = this.config.renderer;
    const configFile = rendererConfig.configFile
      ? path.resolve(rendererRoot, rendererConfig.configFile)
      : undefined;

    const server = await vite.createServer({
      root: rendererRoot,
      configFile,
      clearScreen: false,
      server: {
        host: rendererConfig.host,
        port: rendererConfig.port,
      },
    });

    await server.listen();

    this.rendererDevServer = server;
    process.env[this.getRendererDevServerEnv()] =
      this.getRendererDevServerUrl(server);
    this.setRendererDevServerOutput(task);
  }

  public async closeRendererDevServer(): Promise<void> {
    if (!this.rendererDevServer) {
      return;
    }

    const server = this.rendererDevServer;
    this.rendererDevServer = undefined;
    await server.close();
  }

  private getRendererProjectDir(): string {
    if (!this.config.renderer?.dir) {
      throw new Error('"config.renderer.dir" must point to a Vite project root');
    }

    return path.resolve(this.projectDir, this.config.renderer.dir);
  }

  private getRendererDistDir(): string {
    if (!this.config.renderer) {
      throw new Error('"config.renderer" must be configured');
    }

    return path.resolve(
      this.projectDir,
      this.config.renderer.dist ??
        path.join(this.config.renderer.dir, 'dist'),
    );
  }

  private getRendererDevServerEnv(): string {
    return (
      this.config.renderer?.devServerEnv ?? defaultRendererDevServerEnv
    );
  }

  private getRendererDevServerUrl(server: ViteDevServer): string {
    const localUrl = server.resolvedUrls?.local[0];

    if (!localUrl) {
      throw new Error('Vite did not expose a local renderer dev server URL');
    }

    return localUrl;
  }

  private setRendererDevServerOutput(task?: ForgeTask): void {
    if (!task || !this.rendererDevServer) {
      return;
    }

    const urls = this.rendererDevServer.resolvedUrls;
    const localUrls = urls?.local ?? [];
    const networkUrls = urls?.network ?? [];
    const lines = [
      `Renderer root: ${path.relative(
        this.projectDir,
        this.getRendererProjectDir(),
      )}`,
      `${this.getRendererDevServerEnv()}=${process.env[this.getRendererDevServerEnv()]}`,
    ];

    if (localUrls.length > 0) {
      lines.push('Local:', ...localUrls.map((url) => `  ${url}`));
    }

    if (networkUrls.length > 0) {
      lines.push('Network:', ...networkUrls.map((url) => `  ${url}`));
    }

    task.output = lines.join('\n');
  }

  private build = async (
    task: ForgeTask | null = null,
    mode: 'development' | 'production',
  ): Promise<ForgeTaskList | void> => {
    if (!Array.isArray(this.config.build)) {
      throw new Error('"config.build" must be an Array');
    }

    const builds = this.config.build.map((buildConfig) => ({
      title: `Building ${this.getBuildTitle(buildConfig)} target`,
      task: async (_ctx: unknown, subtask: ForgeTask) => {
        await this.buildTarget(buildConfig, mode);
        subtask.title = `Built ${this.getBuildTitle(buildConfig)} target`;
      },
    }));

    if (!task) {
      await Promise.all(
        this.config.build.map((buildConfig) =>
          this.buildTarget(buildConfig, mode),
        ),
      );
      return;
    }

    return task.newListr(builds, {
      concurrent: this.config.concurrent ?? true,
      exitOnError: this.isProd,
    });
  };

  private async buildTarget(
    buildConfig: TsdownPluginBuildConfig,
    mode: 'development' | 'production',
  ): Promise<void> {
    const { build } = await importTsdown();

    const config: Record<string, unknown> = {
      cwd: this.projectDir,
      entry: buildConfig.entry,
      format: 'cjs',
      outDir: path.relative(this.projectDir, this.outDir),
      platform: 'node',
      clean: false,
      minify: mode === 'production',
      sourcemap: mode === 'development',
      dts: false,
      hash: false,
      nodeProtocol: false,
      deps: {
        neverBundle: [...electronExternals, ...nodeExternals],
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
      },
      outExtensions: () => ({
        js: '.js',
      }),
      outputOptions: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        codeSplitting: buildConfig.target === 'preload' ? false : true,
      },
      ...buildConfig.config,
    };

    await build(config);
  }

  private async cleanBaseDir(): Promise<void> {
    await rm(this.baseDir, { force: true, recursive: true });
  }

  private getBuildTitle(buildConfig: TsdownPluginBuildConfig): string {
    const target = buildConfig.target ?? 'main';
    if (typeof buildConfig.entry === 'string') {
      return `${target} ${buildConfig.entry}`;
    }
    return target;
  }
}

const importTsdown = async (): Promise<{ build: TsdownBuild }> => {
  const importModule = new Function(
    'specifier',
    'return import(specifier)',
  ) as (specifier: string) => Promise<{ build: TsdownBuild }>;

  return importModule('tsdown');
};

const importVite = async (): Promise<ViteModule> => {
  const importModule = new Function(
    'specifier',
    'return import(specifier)',
  ) as (specifier: string) => Promise<ViteModule>;

  return importModule('vite');
};

export { TsdownPlugin };
