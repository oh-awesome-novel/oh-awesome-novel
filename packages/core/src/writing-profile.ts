import {
  readdir,
  readFile,
  unlink,
} from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

import { writeFileAtomically } from './atomic-file.js';
import { loadWorkspaceConfig } from './workspace.js';

export const WRITING_PROFILE_VERSION = 1 as const;
export const DEFAULT_WRITING_PROFILE_ID = 'commercialWriting' as const;
export const WRITING_PROFILE_OUTPUTS = [
  'techniques',
  'world',
  'characters',
  'relationships',
  'outline',
  'timeline',
] as const;
export const WRITING_REMINDER_IDS = [
  'originality',
  'aiVoice',
  'characterConsistency',
  'adaptationFreedom',
] as const;

export type WritingProfileOutput = typeof WRITING_PROFILE_OUTPUTS[number];
export type WritingReminderId = typeof WRITING_REMINDER_IDS[number];

export interface WritingProfile {
  version: typeof WRITING_PROFILE_VERSION;
  id: string;
  displayName: string;
  description: string;
  deconstruction: {
    outputs: WritingProfileOutput[];
  };
  writingReminders: Record<WritingReminderId, boolean>;
}

export interface WritingProfileListItem {
  profile: WritingProfile;
  builtIn: boolean;
  active: boolean;
}

export interface WritingProfileLoadError {
  source: string;
  message: string;
}

export interface WritingProfileStatusSummary {
  profileId: string;
  displayName: string;
  outputs: WritingProfileOutput[];
  reminders: WritingReminderId[];
}

export interface WritingProfileState {
  activeProfileId: string;
  activeProfile: WritingProfile;
  profiles: WritingProfileListItem[];
  fallbackUsed: boolean;
  configError?: string;
  profileErrors: WritingProfileLoadError[];
  summary: WritingProfileStatusSummary;
}

export interface CloneWritingProfileInput {
  id: string;
  displayName?: string;
  description?: string;
}

const BUILTIN_WRITING_PROFILES: readonly WritingProfile[] = [
  {
    version: WRITING_PROFILE_VERSION,
    id: DEFAULT_WRITING_PROFILE_ID,
    displayName: '商业写作',
    description: '强调独立表达，并在审稿与修订中关注机械化 AI 表达。',
    deconstruction: {
      outputs: ['techniques'],
    },
    writingReminders: {
      originality: true,
      aiVoice: true,
      characterConsistency: false,
      adaptationFreedom: false,
    },
  },
  {
    version: WRITING_PROFILE_VERSION,
    id: 'fanfictionWriting',
    displayName: '同人二创写作',
    description: '强调当前 workspace 中已接受材料的人物一致性与改编自由。',
    deconstruction: {
      outputs: ['world', 'characters', 'relationships', 'outline', 'timeline'],
    },
    writingReminders: {
      originality: false,
      aiVoice: false,
      characterConsistency: true,
      adaptationFreedom: true,
    },
  },
];

const BUILTIN_WRITING_PROFILE_IDS = new Set(
  BUILTIN_WRITING_PROFILES.map((profile) => profile.id),
);
const WRITING_PROFILE_OUTPUT_SET = new Set<string>(WRITING_PROFILE_OUTPUTS);
const WRITING_PROFILE_SAFE_ID = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;

export function getBuiltinWritingProfiles(): WritingProfile[] {
  return BUILTIN_WRITING_PROFILES.map(copyWritingProfile);
}

export function normalizeWritingProfile(value: unknown): WritingProfile {
  const record = requireRecord(value, 'Writing Profile');
  assertExactKeys(record, [
    'version',
    'id',
    'displayName',
    'description',
    'deconstruction',
    'writingReminders',
  ], 'Writing Profile');

  if (record.version !== WRITING_PROFILE_VERSION) {
    throw new Error('Writing Profile version must be 1.');
  }

  const id = requireWritingProfileId(record.id, 'Writing Profile id');
  const displayName = requireString(
    record.displayName,
    'Writing Profile displayName',
    100,
  );
  const description = requireString(
    record.description,
    'Writing Profile description',
    2_000,
  );
  const deconstruction = requireRecord(
    record.deconstruction,
    'Writing Profile deconstruction',
  );
  assertExactKeys(
    deconstruction,
    ['outputs'],
    'Writing Profile deconstruction',
  );
  const outputs = normalizeWritingProfileOutputs(deconstruction.outputs);
  const writingReminders = requireRecord(
    record.writingReminders,
    'Writing Profile writingReminders',
  );
  assertExactKeys(
    writingReminders,
    WRITING_REMINDER_IDS,
    'Writing Profile writingReminders',
  );

  return {
    version: WRITING_PROFILE_VERSION,
    id,
    displayName,
    description,
    deconstruction: { outputs },
    writingReminders: {
      originality: requireBoolean(
        writingReminders.originality,
        'Writing Profile reminder originality',
      ),
      aiVoice: requireBoolean(
        writingReminders.aiVoice,
        'Writing Profile reminder aiVoice',
      ),
      characterConsistency: requireBoolean(
        writingReminders.characterConsistency,
        'Writing Profile reminder characterConsistency',
      ),
      adaptationFreedom: requireBoolean(
        writingReminders.adaptationFreedom,
        'Writing Profile reminder adaptationFreedom',
      ),
    },
  };
}

export function createWritingProfileStatusSummary(
  profile: WritingProfile,
): WritingProfileStatusSummary {
  const normalized = normalizeWritingProfile(profile);
  return {
    profileId: normalized.id,
    displayName: normalized.displayName,
    outputs: [...normalized.deconstruction.outputs],
    reminders: WRITING_REMINDER_IDS.filter(
      (reminder) => normalized.writingReminders[reminder],
    ),
  };
}

export async function loadWritingProfileState(
  workspaceRoot: string,
): Promise<WritingProfileState> {
  const config = await loadWorkspaceConfig(workspaceRoot);
  const custom = await loadCustomWritingProfiles(workspaceRoot);
  const profiles = [
    ...getBuiltinWritingProfiles().map((profile) => ({
      profile,
      builtIn: true,
      active: false,
    })),
    ...custom.profiles.map((profile) => ({
      profile,
      builtIn: false,
      active: false,
    })),
  ];
  const configured = readActiveWritingProfileId(config.writingProfile);
  let configError = configured.error;
  let fallbackUsed = configured.activeProfileId === undefined;
  let activeProfile = profiles.find((item) =>
    item.profile.id === configured.activeProfileId)?.profile;

  if (configured.activeProfileId && !activeProfile) {
    configError = `Active Writing Profile does not exist or is invalid: ${configured.activeProfileId}.`;
    fallbackUsed = true;
  }

  activeProfile ??= profiles.find((item) =>
    item.profile.id === DEFAULT_WRITING_PROFILE_ID)?.profile;
  if (!activeProfile) {
    throw new Error('Built-in commercialWriting Profile is unavailable.');
  }

  for (const item of profiles) {
    item.active = item.profile.id === activeProfile.id;
  }

  return {
    activeProfileId: activeProfile.id,
    activeProfile: copyWritingProfile(activeProfile),
    profiles,
    fallbackUsed,
    ...(configError ? { configError } : {}),
    profileErrors: custom.errors,
    summary: createWritingProfileStatusSummary(activeProfile),
  };
}

export async function createCustomWritingProfile(
  workspaceRoot: string,
  value: unknown,
): Promise<WritingProfileState> {
  const profile = normalizeWritingProfile(value);
  assertCustomWritingProfileId(profile.id);
  await writeFileAtomically(
    writingProfilePath(workspaceRoot, profile.id),
    stringify(profile),
    { overwrite: false },
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') {
      throw new Error(`Writing Profile already exists: ${profile.id}.`);
    }
    throw error;
  });
  return loadWritingProfileState(workspaceRoot);
}

export async function cloneCustomWritingProfile(
  workspaceRoot: string,
  sourceProfileId: string,
  input: CloneWritingProfileInput,
): Promise<WritingProfileState> {
  const sourceId = requireWritingProfileId(
    sourceProfileId,
    'Source Writing Profile id',
  );
  const cloneId = requireWritingProfileId(input.id, 'Writing Profile clone id');
  assertExactKeys(
    input as unknown as Record<string, unknown>,
    ['id', 'displayName', 'description'],
    'Writing Profile clone request',
    true,
  );
  const state = await loadWritingProfileState(workspaceRoot);
  const source = state.profiles.find((item) => item.profile.id === sourceId)?.profile;
  if (!source) {
    throw new Error(`Writing Profile not found: ${sourceId}.`);
  }

  return createCustomWritingProfile(workspaceRoot, {
    ...copyWritingProfile(source),
    id: cloneId,
    displayName: input.displayName === undefined
      ? `${source.displayName} 副本`
      : requireString(input.displayName, 'Writing Profile displayName', 100),
    description: input.description === undefined
      ? source.description
      : requireString(input.description, 'Writing Profile description', 2_000),
  });
}

export async function updateCustomWritingProfile(
  workspaceRoot: string,
  profileId: string,
  value: unknown,
): Promise<WritingProfileState> {
  const id = requireWritingProfileId(profileId, 'Writing Profile id');
  assertCustomWritingProfileId(id);
  const profile = normalizeWritingProfile(value);
  if (profile.id !== id) {
    throw new Error('Writing Profile id must match its filename.');
  }
  await assertCustomWritingProfileExists(workspaceRoot, id);
  await writeFileAtomically(
    writingProfilePath(workspaceRoot, id),
    stringify(profile),
  );
  return loadWritingProfileState(workspaceRoot);
}

export async function deleteCustomWritingProfile(
  workspaceRoot: string,
  profileId: string,
): Promise<WritingProfileState> {
  const id = requireWritingProfileId(profileId, 'Writing Profile id');
  assertCustomWritingProfileId(id);
  const state = await loadWritingProfileState(workspaceRoot);
  if (state.activeProfileId === id) {
    throw new Error('Switch to another Writing Profile before deleting the active Profile.');
  }
  await assertCustomWritingProfileExists(workspaceRoot, id);
  await unlink(writingProfilePath(workspaceRoot, id));
  return loadWritingProfileState(workspaceRoot);
}

export async function activateWritingProfile(
  workspaceRoot: string,
  profileId: string,
): Promise<WritingProfileState> {
  const id = requireWritingProfileId(profileId, 'Writing Profile id');
  const state = await loadWritingProfileState(workspaceRoot);
  if (!state.profiles.some((item) => item.profile.id === id)) {
    throw new Error(`Writing Profile not found: ${id}.`);
  }

  const config = await loadWorkspaceConfig(workspaceRoot);
  config.writingProfile = { activeProfileId: id };
  await writeFileAtomically(
    workspaceConfigPath(workspaceRoot),
    stringify(config),
  );
  return loadWritingProfileState(workspaceRoot);
}

async function loadCustomWritingProfiles(workspaceRoot: string): Promise<{
  profiles: WritingProfile[];
  errors: WritingProfileLoadError[];
}> {
  const directory = writingProfilesDirectory(workspaceRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { profiles: [], errors: [] };
    }
    throw error;
  }

  const profiles: WritingProfile[] = [];
  const errors: WritingProfileLoadError[] = [];
  for (const entry of entries
    .filter((item) => item.name.endsWith('.yaml'))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const source = `.oan/writing-profiles/${entry.name}`;
    try {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('Writing Profile path must be a regular file.');
      }
      const fileId = basename(entry.name, '.yaml');
      requireWritingProfileId(fileId, 'Writing Profile filename');
      const profile = normalizeWritingProfile(
        parse(await readFile(join(directory, entry.name), 'utf-8')) as unknown,
      );
      if (profile.id !== fileId) {
        throw new Error('Writing Profile id must match its filename.');
      }
      assertCustomWritingProfileId(profile.id);
      profiles.push(profile);
    } catch (error) {
      errors.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { profiles, errors };
}

function readActiveWritingProfileId(value: unknown): {
  activeProfileId?: string;
  error?: string;
} {
  if (value === undefined) {
    return {};
  }

  try {
    const section = requireRecord(value, 'Workspace writingProfile config');
    assertExactKeys(
      section,
      ['activeProfileId'],
      'Workspace writingProfile config',
    );
    return {
      activeProfileId: requireWritingProfileId(
        section.activeProfileId,
        'Workspace activeProfileId',
      ),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeWritingProfileOutputs(value: unknown): WritingProfileOutput[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > WRITING_PROFILE_OUTPUTS.length
    || value.some((output) =>
      typeof output !== 'string' || !WRITING_PROFILE_OUTPUT_SET.has(output))
  ) {
    throw new Error('Writing Profile outputs must contain one or more supported values.');
  }
  if (new Set(value).size !== value.length) {
    throw new Error('Writing Profile outputs must be unique.');
  }
  return [...value] as WritingProfileOutput[];
}

function assertCustomWritingProfileId(id: string): void {
  if (BUILTIN_WRITING_PROFILE_IDS.has(id)) {
    throw new Error(`Built-in Writing Profile is read-only: ${id}.`);
  }
}

async function assertCustomWritingProfileExists(
  workspaceRoot: string,
  id: string,
): Promise<void> {
  const state = await loadWritingProfileState(workspaceRoot);
  const item = state.profiles.find((candidate) => candidate.profile.id === id);
  if (!item || item.builtIn) {
    throw new Error(`Custom Writing Profile not found: ${id}.`);
  }
}

function requireWritingProfileId(value: unknown, field: string): string {
  if (
    typeof value !== 'string'
    || !WRITING_PROFILE_SAFE_ID.test(value)
  ) {
    throw new Error(`${field} must be a safe id.`);
  }
  return value;
}

function requireString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(normalized)) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
  allowMissing = false,
): void {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  if (
    actual.some((key) => !allowed.has(key))
    || (!allowMissing && keys.some((key) => !Object.hasOwn(value, key)))
  ) {
    throw new Error(`${field} contains unknown or missing fields.`);
  }
}

function writingProfilesDirectory(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), '.oan', 'writing-profiles');
}

function writingProfilePath(workspaceRoot: string, id: string): string {
  return join(writingProfilesDirectory(workspaceRoot), `${id}.yaml`);
}

function workspaceConfigPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), '.oan', 'config.yaml');
}

function copyWritingProfile(profile: WritingProfile): WritingProfile {
  return {
    ...profile,
    deconstruction: {
      outputs: [...profile.deconstruction.outputs],
    },
    writingReminders: {
      ...profile.writingReminders,
    },
  };
}
