import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  loadAppConfig,
  loadComposerSubmitShortcutPreference,
  loadThemePreference,
  saveAppConfig,
  saveComposerSubmitShortcutPreference,
  saveThemePreference,
} from '@oh-awesome-novel/core';

describe('app config', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oan-app-config-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('starts empty when no app config exists', async () => {
    await expect(loadAppConfig(tempDir)).resolves.toEqual({});
    await expect(loadThemePreference(tempDir)).resolves.toBeUndefined();
    await expect(loadComposerSubmitShortcutPreference(tempDir)).resolves.toBeUndefined();
  });

  it('can save and load a theme preference', async () => {
    await saveThemePreference(tempDir, 'dark');

    await expect(loadAppConfig(tempDir)).resolves.toEqual({ theme: 'dark' });
    await expect(loadThemePreference(tempDir)).resolves.toBe('dark');
  });

  it('writes app config as readable JSON', async () => {
    await saveAppConfig(tempDir, {
      theme: 'light',
      composerSubmitShortcut: 'meta-enter',
    });

    const raw = await readFile(join(tempDir, 'app-config.json'), 'utf-8');
    expect(raw).toContain('"theme": "light"');
    expect(raw).toContain('"composerSubmitShortcut": "meta-enter"');
  });

  it('can save and load a composer submit shortcut preference', async () => {
    await saveThemePreference(tempDir, 'dark');
    await saveComposerSubmitShortcutPreference(tempDir, 'ctrl-enter');

    await expect(loadAppConfig(tempDir)).resolves.toEqual({
      theme: 'dark',
      composerSubmitShortcut: 'ctrl-enter',
    });
    await expect(loadComposerSubmitShortcutPreference(tempDir)).resolves.toBe('ctrl-enter');
  });

  it('throws for invalid theme preferences', async () => {
    await writeFile(
      join(tempDir, 'app-config.json'),
      JSON.stringify({ theme: 'system' }),
      'utf-8',
    );

    await expect(loadAppConfig(tempDir)).rejects.toThrow('Invalid theme preference');
  });

  it('throws for invalid composer submit shortcut preferences', async () => {
    await writeFile(
      join(tempDir, 'app-config.json'),
      JSON.stringify({ composerSubmitShortcut: 'spacebar' }),
      'utf-8',
    );

    await expect(loadAppConfig(tempDir)).rejects.toThrow('Invalid composer submit shortcut preference');
  });
});
