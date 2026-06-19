import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';

interface CliOptions {
  host?: string;
  port?: number;
  workspaceRoot?: string;
  globalConfigDir?: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../..');
const defaultWorkspaceRoot = resolve(repoRoot, 'examples/sample-novel');
const cliOptions = parseCliOptions(process.argv.slice(2));
const workspaceRoot = resolvePath(
  cliOptions.workspaceRoot ?? process.env.OAN_WORKSPACE_ROOT ?? defaultWorkspaceRoot,
);
const globalConfigDir = resolvePath(cliOptions.globalConfigDir ?? process.env.OAN_GLOBAL_CONFIG_DIR);
const host = cliOptions.host ?? process.env.OAN_HTTP_HOST ?? '127.0.0.1';
const port = cliOptions.port ?? readPort(process.env.OAN_HTTP_PORT) ?? 3210;
const backend = await startNovelHttpBackend({
  workspaceRoot,
  seedWorkspaceRoot: workspaceRoot,
  globalConfigDir,
  host,
  port,
});

console.log(`Oh Awesome Novel HTTP backend listening at ${backend.url}`);
console.log(`Workspace: ${workspaceRoot}`);

const shutdown = async () => {
  await backend.close();
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});

function parseCliOptions(args: string[]): CliOptions {
  return {
    host: readCliString(args, 'host'),
    port: readPort(readCliString(args, 'port')),
    workspaceRoot: readCliString(args, 'workspace') ?? readCliString(args, 'workspace-root'),
    globalConfigDir: readCliString(args, 'global-config-dir'),
  };
}

function readCliString(args: string[], name: string): string | undefined {
  const inlinePrefix = `--${name}=`;

  for (const [index, arg] of args.entries()) {
    if (arg.startsWith(inlinePrefix)) {
      const value = arg.slice(inlinePrefix.length).trim();
      return value || undefined;
    }

    if (arg === `--${name}`) {
      const value = args[index + 1]?.trim();
      return value && !value.startsWith('--') ? value : undefined;
    }
  }

  return undefined;
}

function readPort(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid HTTP port: ${value}`);
  }

  return port;
}

function resolvePath(path: string | undefined): string | undefined {
  return path ? resolve(path) : undefined;
}
