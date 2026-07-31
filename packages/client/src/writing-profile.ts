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
  version: 1;
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

export interface WritingProfileState {
  activeProfileId: string;
  activeProfile: WritingProfile;
  profiles: WritingProfileListItem[];
  fallbackUsed: boolean;
  configError?: string;
  profileErrors: Array<{
    source: string;
    message: string;
  }>;
  summary: {
    profileId: string;
    displayName: string;
    outputs: WritingProfileOutput[];
    reminders: WritingReminderId[];
  };
}

export interface CloneWritingProfileInput {
  id: string;
  displayName?: string;
  description?: string;
}

const OUTPUTS = new Set<string>(WRITING_PROFILE_OUTPUTS);
const PROFILE_ID = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;

export function assertWritingProfile(value: unknown): asserts value is WritingProfile {
  if (!isWritingProfile(value)) {
    throw new Error('Writing Profile payload is invalid.');
  }
}

export function assertWritingProfileId(value: unknown): asserts value is string {
  if (!isProfileId(value)) {
    throw new Error('Writing Profile id is invalid.');
  }
}

export function assertCloneWritingProfileInput(
  value: unknown,
): asserts value is CloneWritingProfileInput {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['id'], ['displayName', 'description'])
    || !isProfileId(value.id)
    || (value.displayName !== undefined && !isBoundedString(value.displayName, 100))
    || (value.description !== undefined && !isBoundedString(value.description, 2_000))
  ) {
    throw new Error('Writing Profile clone request is invalid.');
  }
}

export function parseWritingProfileStateEnvelope(value: unknown): {
  state: WritingProfileState;
} {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['state'])
    || !isWritingProfileState(value.state)
  ) {
    throw new Error('Writing Profile response is invalid.');
  }
  return { state: value.state };
}

function isWritingProfileState(value: unknown): value is WritingProfileState {
  if (
    !isRecord(value)
    || !hasExactKeys(
      value,
      [
        'activeProfileId',
        'activeProfile',
        'profiles',
        'fallbackUsed',
        'profileErrors',
        'summary',
      ],
      ['configError'],
    )
    || !isProfileId(value.activeProfileId)
    || !isWritingProfile(value.activeProfile)
    || value.activeProfile.id !== value.activeProfileId
    || !Array.isArray(value.profiles)
    || !value.profiles.every(isWritingProfileListItem)
    || value.profiles.filter((item) => item.active).length !== 1
    || !value.profiles.some((item) =>
      item.active && item.profile.id === value.activeProfileId)
    || typeof value.fallbackUsed !== 'boolean'
    || (value.configError !== undefined && typeof value.configError !== 'string')
    || !Array.isArray(value.profileErrors)
    || !value.profileErrors.every(isWritingProfileLoadError)
    || !isWritingProfileSummary(value.summary)
    || value.summary.profileId !== value.activeProfileId
    || value.summary.displayName !== value.activeProfile.displayName
    || !arraysEqual(
      value.summary.outputs,
      value.activeProfile.deconstruction.outputs,
    )
    || !arraysEqual(
      value.summary.reminders,
      activeReminderIds(value.activeProfile),
    )
  ) {
    return false;
  }
  return new Set(value.profiles.map((item) => item.profile.id)).size ===
    value.profiles.length;
}

function isWritingProfileListItem(value: unknown): value is WritingProfileListItem {
  return isRecord(value)
    && hasExactKeys(value, ['profile', 'builtIn', 'active'])
    && isWritingProfile(value.profile)
    && typeof value.builtIn === 'boolean'
    && typeof value.active === 'boolean';
}

function isWritingProfile(value: unknown): value is WritingProfile {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'version',
      'id',
      'displayName',
      'description',
      'deconstruction',
      'writingReminders',
    ])
    || value.version !== 1
    || !isProfileId(value.id)
    || !isBoundedString(value.displayName, 100)
    || !isBoundedString(value.description, 2_000)
    || !isRecord(value.deconstruction)
    || !hasExactKeys(value.deconstruction, ['outputs'])
    || !Array.isArray(value.deconstruction.outputs)
    || value.deconstruction.outputs.length === 0
    || value.deconstruction.outputs.length > WRITING_PROFILE_OUTPUTS.length
    || !value.deconstruction.outputs.every((output) =>
      typeof output === 'string' && OUTPUTS.has(output))
    || new Set(value.deconstruction.outputs).size !==
      value.deconstruction.outputs.length
    || !isWritingReminders(value.writingReminders)
  ) {
    return false;
  }
  return true;
}

function isWritingProfileLoadError(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['source', 'message'])
    && typeof value.source === 'string'
    && typeof value.message === 'string';
}

function isWritingReminders(
  value: unknown,
): value is Record<WritingReminderId, boolean> {
  return isRecord(value)
    && hasExactKeys(value, WRITING_REMINDER_IDS)
    && WRITING_REMINDER_IDS.every((reminder) =>
      typeof value[reminder] === 'boolean');
}

function isWritingProfileSummary(
  value: unknown,
): value is WritingProfileState['summary'] {
  return isRecord(value)
    && hasExactKeys(value, ['profileId', 'displayName', 'outputs', 'reminders'])
    && isProfileId(value.profileId)
    && isBoundedString(value.displayName, 100)
    && Array.isArray(value.outputs)
    && value.outputs.length > 0
    && value.outputs.length <= WRITING_PROFILE_OUTPUTS.length
    && value.outputs.every((output) =>
      typeof output === 'string' && OUTPUTS.has(output))
    && new Set(value.outputs).size === value.outputs.length
    && Array.isArray(value.reminders)
    && value.reminders.every((reminder) =>
      typeof reminder === 'string'
      && (WRITING_REMINDER_IDS as readonly string[]).includes(reminder))
    && new Set(value.reminders).size === value.reminders.length;
}

function isProfileId(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_ID.test(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= maximum
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(normalized);
}

function arraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function activeReminderIds(profile: WritingProfile): WritingReminderId[] {
  return WRITING_REMINDER_IDS.filter(
    (reminder) => profile.writingReminders[reminder],
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
