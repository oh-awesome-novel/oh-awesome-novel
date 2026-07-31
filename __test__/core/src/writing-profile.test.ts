import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  activateWritingProfile,
  cloneCustomWritingProfile,
  createCustomWritingProfile,
  deleteCustomWritingProfile,
  getBuiltinWritingProfiles,
  initWorkspace,
  loadWorkspaceConfig,
  loadWritingProfileState,
  normalizeWritingProfile,
  updateCustomWritingProfile,
  type WritingProfile,
} from '@oh-awesome-novel/core';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('Writing Profile configuration', () => {
  it('initializes a workspace with commercialWriting and a custom Profile directory', async () => {
    const root = await createRoot();
    await initWorkspace(root);

    const state = await loadWritingProfileState(root);
    const config = parse(await readFile(
      join(root, '.oan', 'config.yaml'),
      'utf-8',
    )) as Record<string, unknown>;

    expect(state.activeProfileId).toBe('commercialWriting');
    expect(state.fallbackUsed).toBe(false);
    expect(state.profiles.map((item) => ({
      id: item.profile.id,
      builtIn: item.builtIn,
    }))).toEqual([
      { id: 'commercialWriting', builtIn: true },
      { id: 'fanfictionWriting', builtIn: true },
    ]);
    expect(config).toMatchObject({
      version: 1,
      writingProfile: { activeProfileId: 'commercialWriting' },
    });
    await expect(readdir(join(root, '.oan', 'writing-profiles')))
      .resolves
      .toEqual([]);
  });

  it('strictly rejects unknown fields, source bindings, invalid outputs and reminder values', () => {
    const valid = customProfile('strict-profile');

    expect(() => normalizeWritingProfile({
      ...valid,
      genreType: 'fantasy',
    })).toThrow('unknown or missing');
    expect(() => normalizeWritingProfile({
      ...valid,
      deconstruction: {
        outputs: ['techniques', 'techniques'],
        sourceBinding: 'reference-1',
      },
    })).toThrow();
    expect(() => normalizeWritingProfile({
      ...valid,
      deconstruction: { outputs: [] },
    })).toThrow('one or more');
    expect(() => normalizeWritingProfile({
      ...valid,
      writingReminders: {
        ...valid.writingReminders,
        originality: 'yes',
      },
    })).toThrow('boolean');
  });

  it('falls back without persisting when config is missing and isolates invalid config sections', async () => {
    const root = await createWorkspaceSkeleton();
    await writeFile(
      join(root, '.oan', 'config.yaml'),
      [
        'version: 1',
        'git:',
        '  autoCommitOnAccept: false',
        'onboarding:',
        '  completed: true',
        'writingProfile:',
        '  activeProfileId: missing-profile',
        '  sourceBinding: forbidden',
        '',
      ].join('\n'),
      'utf-8',
    );

    const state = await loadWritingProfileState(root);
    const config = await loadWorkspaceConfig(root);

    expect(state.activeProfileId).toBe('commercialWriting');
    expect(state.fallbackUsed).toBe(true);
    expect(state.configError).toContain('unknown or missing');
    expect(config.git).toEqual({ autoCommitOnAccept: false });
    expect(config.onboarding).toEqual({ completed: true });

    await writeFile(join(root, '.oan', 'config.yaml'), 'version: 1\n', 'utf-8');
    const missing = await loadWritingProfileState(root);
    expect(missing).toMatchObject({
      activeProfileId: 'commercialWriting',
      fallbackUsed: true,
    });
    expect(missing.configError).toBeUndefined();
  });

  it('creates, clones, updates, activates and safely deletes custom Profiles', async () => {
    const root = await createRoot();
    await initWorkspace(root);
    const created = await createCustomWritingProfile(
      root,
      customProfile('derivative-commercial'),
    );
    expect(created.profiles).toContainEqual(expect.objectContaining({
      builtIn: false,
      profile: expect.objectContaining({ id: 'derivative-commercial' }),
    }));

    const cloned = await cloneCustomWritingProfile(
      root,
      'fanfictionWriting',
      {
        id: 'fanfiction-remix',
        displayName: '同人混合版',
      },
    );
    expect(cloned.profiles.find((item) =>
      item.profile.id === 'fanfiction-remix')?.profile.deconstruction.outputs)
      .toEqual(['world', 'characters', 'relationships', 'outline', 'timeline']);

    const updatedProfile = customProfile('derivative-commercial');
    updatedProfile.deconstruction.outputs = ['world', 'characters'];
    updatedProfile.writingReminders.aiVoice = true;
    const updated = await updateCustomWritingProfile(
      root,
      updatedProfile.id,
      updatedProfile,
    );
    expect(updated.profiles.find((item) =>
      item.profile.id === updatedProfile.id)?.profile).toEqual(updatedProfile);

    const active = await activateWritingProfile(root, updatedProfile.id);
    expect(active.activeProfileId).toBe(updatedProfile.id);
    await expect(deleteCustomWritingProfile(root, updatedProfile.id))
      .rejects
      .toThrow('before deleting');
    await expect(updateCustomWritingProfile(
      root,
      'commercialWriting',
      customProfile('commercialWriting'),
    )).rejects.toThrow('read-only');

    await activateWritingProfile(root, 'commercialWriting');
    const deleted = await deleteCustomWritingProfile(root, updatedProfile.id);
    expect(deleted.profiles.some((item) =>
      item.profile.id === updatedProfile.id)).toBe(false);
    expect((await readdir(join(root, '.oan', 'writing-profiles')))
      .some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('reports id/filename mismatches and built-in collisions without breaking workspace loading', async () => {
    const root = await createWorkspaceSkeleton();
    await writeFile(
      join(root, '.oan', 'config.yaml'),
      'version: 1\nwritingProfile:\n  activeProfileId: mismatched\n',
      'utf-8',
    );
    await writeFile(
      join(root, '.oan', 'writing-profiles', 'mismatched.yaml'),
      [
        'version: 1',
        'id: another-id',
        'displayName: Mismatch',
        'description: Invalid filename identity.',
        'deconstruction:',
        '  outputs: [techniques]',
        'writingReminders:',
        '  originality: true',
        '  aiVoice: false',
        '  characterConsistency: false',
        '  adaptationFreedom: false',
        '',
      ].join('\n'),
      'utf-8',
    );
    await writeFile(
      join(root, '.oan', 'writing-profiles', 'commercialWriting.yaml'),
      [
        'version: 1',
        'id: commercialWriting',
        'displayName: Forged built-in',
        'description: Must not shadow host preset.',
        'deconstruction:',
        '  outputs: [techniques]',
        'writingReminders:',
        '  originality: true',
        '  aiVoice: true',
        '  characterConsistency: false',
        '  adaptationFreedom: false',
        '',
      ].join('\n'),
      'utf-8',
    );

    const state = await loadWritingProfileState(root);
    expect(state.activeProfileId).toBe('commercialWriting');
    expect(state.configError).toContain('does not exist or is invalid');
    expect(state.profileErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('filename') }),
      expect.objectContaining({ message: expect.stringContaining('read-only') }),
    ]));
    expect(getBuiltinWritingProfiles().find((profile) =>
      profile.id === 'commercialWriting')?.displayName).toBe('商业写作');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-writing-profile-'));
  roots.push(root);
  return root;
}

async function createWorkspaceSkeleton(): Promise<string> {
  const root = await createRoot();
  await mkdir(join(root, '.oan', 'writing-profiles'), { recursive: true });
  return root;
}

function customProfile(id: string): WritingProfile {
  return {
    version: 1 as const,
    id,
    displayName: '衍生商业写作',
    description: '使用固定拆书输出与 Writing 提醒。',
    deconstruction: {
      outputs: ['techniques', 'world'],
    },
    writingReminders: {
      originality: true,
      aiVoice: false,
      characterConsistency: true,
      adaptationFreedom: false,
    },
  };
}
