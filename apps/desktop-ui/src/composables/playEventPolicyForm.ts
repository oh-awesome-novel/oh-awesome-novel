import type { PlayEventPolicy } from './useWorkspaceApi';

export interface PlayEventSettingsDraft {
  allowOffscreen: boolean;
  allowHidden: boolean;
  maxExternalEventsPerTurn: number | string;
}

export function createPlayEventSettingsDraft(): PlayEventSettingsDraft {
  return { allowOffscreen: true, allowHidden: true, maxExternalEventsPerTurn: 2 };
}

export function playEventSettingsError(draft: Readonly<PlayEventSettingsDraft>): string | undefined {
  const limit = Number(draft.maxExternalEventsPerTurn);
  return String(draft.maxExternalEventsPerTurn).trim() === '' ||
    !Number.isInteger(limit) || limit < 0 || limit > 6
    ? 'Enter a whole number from 0 to 6.'
    : undefined;
}

export function buildPlayEventSettings(
  draft: Readonly<PlayEventSettingsDraft> = createPlayEventSettingsDraft(),
): Pick<PlayEventPolicy, 'allowOffscreen' | 'allowHidden' | 'maxExternalEventsPerTurn'> {
  const error = playEventSettingsError(draft);
  if (error) throw new Error(error);
  return {
    allowOffscreen: draft.allowOffscreen,
    allowHidden: draft.allowHidden,
    maxExternalEventsPerTurn: Number(draft.maxExternalEventsPerTurn),
  };
}
