import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const runner = require('../packaged-main-smoke/run.cjs') as {
  findPackagedExecutable(input: string, platform?: string, arch?: string): Promise<string>;
  parsePhaseReport(stdout: string, phase: string): unknown;
  createSmokeEnvironment(root: string, inherited: Record<string, string>): Record<string, string>;
  REQUIRED: Record<string, string[]>;
};
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('portable packaged writing smoke runner', () => {
  it('isolates settings, credentials, network proxies and Git object/index writes from the invoking shell', () => {
    const environment = runner.createSmokeEnvironment('/tmp/fixture', {
      HOME: '/users/author', PATH: '/bin', GIT_OBJECT_DIRECTORY: '/user/repo/objects', GIT_INDEX_FILE: '/user/repo/index',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'include.path', GIT_CONFIG_VALUE_0: '/user/config', GIT_AUTHOR_NAME: 'Personal Author',
      OAN_GLOBAL_CONFIG_DIR: '/user/config', OAN_WORKSPACE_ROOT: '/user/manuscript', OPENAI_API_KEY: 'personal',
      HTTPS_PROXY: 'https://external', NODE_OPTIONS: '--require=/user/setup.cjs', ELECTRON_RUN_AS_NODE: '1',
    });
    expect(environment.HOME).toBe('/users/author'); expect(environment.PATH).toBe('/bin');
    expect(environment.GIT_CONFIG_GLOBAL).toBe(path.join('/tmp/fixture', 'gitconfig'));
    expect(environment.GIT_AUTHOR_NAME).toBe('OAN Packaged Smoke'); expect(environment.GIT_CONFIG_COUNT).toBe('0');
    for (const key of ['GIT_OBJECT_DIRECTORY', 'GIT_INDEX_FILE', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0',
      'OAN_GLOBAL_CONFIG_DIR', 'OAN_WORKSPACE_ROOT', 'OPENAI_API_KEY', 'HTTPS_PROXY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) expect(environment).not.toHaveProperty(key);
  });
  it.each([
    ['darwin', 'arm64', 'oan.app/Contents/MacOS/oan'],
    ['darwin', 'x64', 'oan.app/Contents/MacOS/oan'],
    ['win32', 'x64', 'oan.exe'],
    ['linux', 'x64', 'oan'],
  ])('selects the actual %s/%s app executable without confusing installers or executable permission bits', async (platform, arch, relative) => {
    const root = await mkdtemp(path.join(tmpdir(), 'oan-smoke-runner-test-')); roots.push(root);
    const packaged = path.join(root, `oan-${platform}-${arch}`);
    const executable = path.join(packaged, relative);
    await mkdir(path.dirname(executable), { recursive: true }); await writeFile(executable, 'fixture', { mode: 0o600 });
    await mkdir(path.join(root, 'make'), { recursive: true }); await writeFile(path.join(root, 'make/Setup.exe'), 'installer');
    expect(await runner.findPackagedExecutable(root, platform, arch)).toBe(executable);
    expect(await runner.findPackagedExecutable(packaged, platform, arch)).toBe(executable);
    expect(await runner.findPackagedExecutable(executable, platform, arch)).toBe(executable);
    await expect(runner.findPackagedExecutable(root, platform, 'wrong-arch')).rejects.toThrow('No');
  });
  it('requires the complete evidence for each distinct process, not merely an ok substring', () => {
    const report = { ok: true, component: 'packaged-writing-journey', phase: 'write', platform: process.platform, arch: process.arch,
      provider: 'deterministic-local-http', rendererErrors: 0, blockedNetwork: 0, checks: runner.REQUIRED.write };
    expect(runner.parsePhaseReport(`Chromium notice\n${JSON.stringify(report)}\n`, 'write')).toEqual(report);
    for (const invalid of [
      { ...report, phase: 'reopen' }, { ...report, arch: 'wrong' }, { ...report, checks: report.checks.slice(1) },
      { ...report, rendererErrors: 1 }, { ...report, blockedNetwork: 1 }, { ...report, provider: 'mock-model' },
    ]) expect(() => runner.parsePhaseReport(JSON.stringify(invalid), 'write')).toThrow();
    expect(() => runner.parsePhaseReport('"ok":true', 'write')).toThrow();
    expect(() => runner.parsePhaseReport(`${JSON.stringify(report)}\n${JSON.stringify(report)}`, 'write')).toThrow();
    expect(() => runner.parsePhaseReport(JSON.stringify(report), 'reopen')).toThrow();
  });
});
