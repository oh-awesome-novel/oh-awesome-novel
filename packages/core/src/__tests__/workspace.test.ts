import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import {
  isEmptyDirectory,
  initWorkspace,
  resolveGlobalOanConfigDir,
  loadWorkspaceList,
  saveWorkspaceList,
} from '../workspace.js';

describe('isEmptyDirectory', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oan-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns true for an empty directory', async () => {
    const result = await isEmptyDirectory(tempDir);
    expect(result).toBe(true);
  });

  it('returns true for a directory with only .DS_Store', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tempDir, '.DS_Store'), '', 'utf-8');
    const result = await isEmptyDirectory(tempDir);
    expect(result).toBe(true);
  });

  it('returns false for a non-empty directory', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tempDir, 'file.txt'), 'hello', 'utf-8');
    const result = await isEmptyDirectory(tempDir);
    expect(result).toBe(false);
  });

  it('throws for a non-existent directory', async () => {
    await expect(
      isEmptyDirectory(join(tempDir, 'no-such-dir')),
    ).rejects.toThrow('Directory does not exist');
  });

  it('throws for a path that is not a directory', async () => {
    const { writeFile } = await import('node:fs/promises');
    const filePath = join(tempDir, 'not-a-dir.txt');
    await writeFile(filePath, 'hello', 'utf-8');
    await expect(isEmptyDirectory(filePath)).rejects.toThrow(
      'Path is not a directory',
    );
  });
});

describe('initWorkspace', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oan-init-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates the full workspace directory structure', async () => {
    const { stat, readFile } = await import('node:fs/promises');

    const config = await initWorkspace(tempDir);

    expect(config.rootDir).toBe(tempDir);

    // Content directories
    const contentDirs = [
      'chapters',
      'characters',
      'world',
      'state',
      'timeline',
      'foreshadow',
      'summaries',
      'schemas',
    ];
    for (const dir of contentDirs) {
      await expect(stat(join(tempDir, dir))).resolves.toBeDefined();
    }

    // .oan subdirectories
    const oanDirs = ['constitution', 'prompts', 'skills', 'extensions'];
    for (const dir of oanDirs) {
      await expect(stat(join(tempDir, '.oan', dir))).resolves.toBeDefined();
    }

    // workflow.yaml exists and has content
    const workflowContent = await readFile(
      join(tempDir, '.oan', 'workflow.yaml'),
      'utf-8',
    );
    expect(workflowContent).toContain('name: lightnovel');
    expect(workflowContent).toContain('steps:');

    // config.yaml exists
    const configContent = await readFile(
      join(tempDir, '.oan', 'config.yaml'),
      'utf-8',
    );
    expect(configContent).toContain('version: 1');
  });

  it('throws when initialising a non-empty directory', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tempDir, 'existing-file.txt'), 'data', 'utf-8');

    await expect(initWorkspace(tempDir)).rejects.toThrow(
      'directory is not empty',
    );
  });

  it('throws when initialising a directory with subdirectories', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(tempDir, 'subdir'));

    await expect(initWorkspace(tempDir)).rejects.toThrow(
      'directory is not empty',
    );
  });
});

describe('resolveGlobalOanConfigDir', () => {
  it('returns ~/.oan/ by default', () => {
    const dir = resolveGlobalOanConfigDir();
    expect(dir).toMatch(/\.oan$/);
    expect(dir).toContain(homedir());
  });

  it('respects the override option', () => {
    const customDir = '/custom/config/dir';
    const dir = resolveGlobalOanConfigDir({ globalConfigDir: customDir });
    expect(dir).toBe(customDir);
  });
});

describe('Workspace list', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oan-list-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('starts with an empty list when no file exists', async () => {
    const list = await loadWorkspaceList(tempDir);
    expect(list.workspaces).toEqual([]);
  });

  it('can save and load a workspace list', async () => {
    const original = {
      workspaces: [
        { name: 'My Novel', path: '/path/to/novel' },
        { name: 'Another', path: '/path/to/another' },
      ],
    };

    await saveWorkspaceList(tempDir, original);
    const loaded = await loadWorkspaceList(tempDir);

    expect(loaded).toEqual(original);
  });

  it('creates the config directory if it does not exist', async () => {
    const newDir = join(tempDir, 'deep', 'nested', 'config');
    await saveWorkspaceList(newDir, { workspaces: [] });

    const loaded = await loadWorkspaceList(newDir);
    expect(loaded.workspaces).toEqual([]);
  });
});