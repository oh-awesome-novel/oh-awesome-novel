import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import {
  isEmptyDirectory,
  initWorkspace,
  resolveGlobalOanConfigDir,
  loadWorkspaceList,
  saveWorkspaceList,
  formatVolumeDirectoryName,
  formatChapterFileName,
  resolveChapterFilePath,
  resolveVolumeMetadataFilePath,
  resolveNarrativeChapterFilePath,
} from '@oh-awesome-novel/core';

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

    expect(config.rootDir).toBe(resolve(tempDir));

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

    const oanDirs = ['constitution', 'prompts', 'skills', 'extensions'];
    for (const dir of oanDirs) {
      await expect(stat(join(tempDir, '.oan', dir))).resolves.toBeDefined();
    }

    const workflowContent = await readFile(
      join(tempDir, '.oan', 'workflow.yaml'),
      'utf-8',
    );
    expect(workflowContent).toContain('name: lightnovel');
    expect(workflowContent).toContain('steps:');

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

  it('can save the initialized workspace to the global workspace list', async () => {
    const globalConfigDir = await mkdtemp(join(tmpdir(), 'oan-global-'));

    try {
      const config = await initWorkspace(tempDir, {
        globalConfigDir,
        saveToWorkspaceList: true,
        workspaceName: 'Draft Novel',
      });

      const list = await loadWorkspaceList(globalConfigDir);
      expect(list.workspaces).toEqual([
        { name: 'Draft Novel', path: config.rootDir },
      ]);
    } finally {
      await rm(globalConfigDir, { recursive: true, force: true });
    }
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

  it('throws for invalid workspace list JSON', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tempDir, 'workspace-list.json'), '{', 'utf-8');

    await expect(loadWorkspaceList(tempDir)).rejects.toThrow();
  });

  it('throws for an invalid workspace list shape', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(tempDir, 'workspace-list.json'),
      JSON.stringify({ workspaces: [{ name: 'Missing path' }] }),
      'utf-8',
    );

    await expect(loadWorkspaceList(tempDir)).rejects.toThrow(
      'Invalid workspace entry',
    );
  });
});

describe('novel body paths', () => {
  it('formats stable volume and chapter names', () => {
    expect(formatVolumeDirectoryName(1)).toBe('0001');
    expect(formatChapterFileName(0)).toBe('0000.md');
    expect(formatChapterFileName(12)).toBe('0012.md');
  });

  it('resolves stable chapter paths under chapters/', () => {
    const parts = resolveChapterFilePath('/novel', 2, 1);

    expect(parts).toEqual({
      volumeDir: '0002',
      chapterFile: '0001.md',
      relativePath: join('chapters', '0002', '0001.md'),
      absolutePath: join(resolve('/novel'), 'chapters', '0002', '0001.md'),
    });
  });

  it('separates volume metadata paths from narrative chapter paths', () => {
    expect(resolveVolumeMetadataFilePath('/novel', 1).relativePath).toBe(
      join('chapters', '0001', '0000.md'),
    );
    expect(resolveNarrativeChapterFilePath('/novel', 1, 1).relativePath).toBe(
      join('chapters', '0001', '0001.md'),
    );
    expect(() => resolveNarrativeChapterFilePath('/novel', 1, 0)).toThrow(
      'reserved for volume metadata',
    );
  });

  it('rejects invalid volume and chapter numbers', () => {
    expect(() => formatVolumeDirectoryName(0)).toThrow('positive integer');
    expect(() => formatChapterFileName(-1)).toThrow('non-negative integer');
    expect(() => formatChapterFileName(1.5)).toThrow('non-negative integer');
  });
});
