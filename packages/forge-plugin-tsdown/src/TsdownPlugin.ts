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

type TsdownBuild = (config: Record<string, unknown>) => Promise<unknown>;
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

export default class TsdownPlugin extends PluginBase<TsdownPluginConfig> {
  public name = 'tsdown';

  private projectDir!: string;
  private baseDir!: string;
  private outDir!: string;
  private isProd = false;

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
          return this.build(task, 'development');
        }, 'Preparing tsdown bundles'),
      ],
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
      const rendererDist = path.resolve(
        this.projectDir,
        this.config.renderer.dist,
      );
      const rendererOutDir = path.resolve(
        buildPath,
        this.config.renderer.outDir ?? '.vite/renderer',
      );

      await rm(rendererOutDir, { force: true, recursive: true });
      await cp(rendererDist, rendererOutDir, { recursive: true });
    }
  };

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

    return task?.newListr(builds, {
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

export { TsdownPlugin };
