import { readonly, shallowRef } from 'vue';

/** How the stage reads: an application UI preference shared by every workspace. */
export interface PlayStageReadingPrefs {
  /** Typing speed in characters per second. */
  charsPerSecond: number;
  /** Auto mode: base wait after a sentence is fully shown, before the per-character part. */
  autoDelayMs: number;
  /** Dialogue box background opacity, 0.3–1. */
  boxOpacity: number;
  /** False shows every sentence at once. */
  typewriter: boolean;
}

export const PLAY_STAGE_READING_DEFAULTS: Readonly<PlayStageReadingPrefs> = {
  charsPerSecond: 40,
  autoDelayMs: 1200,
  boxOpacity: 0.93,
  typewriter: true,
};
export const PLAY_STAGE_READING_LIMITS = {
  charsPerSecond: { min: 5, max: 120 },
  autoDelayMs: { min: 300, max: 5000 },
  boxOpacity: { min: 0.3, max: 1 },
} as const;
/** Auto mode waits this much longer per character of the sentence just shown. */
export const PLAY_STAGE_AUTO_MS_PER_CHAR = 45;

const STORAGE_KEY = 'oan:play:stage-reading';

export function usePlayStageReadingPrefs() {
  const prefs = shallowRef(read());

  function update(patch: Partial<PlayStageReadingPrefs>): void {
    prefs.value = normalize({ ...prefs.value, ...patch });
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs.value));
    } catch {
      // A UI preference only.
    }
  }

  return { prefs: readonly(prefs), update };
}

function read(): PlayStageReadingPrefs {
  try {
    return normalize(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...PLAY_STAGE_READING_DEFAULTS };
  }
}

function normalize(value: unknown): PlayStageReadingPrefs {
  const input = value && typeof value === 'object' ? value as Partial<Record<keyof PlayStageReadingPrefs, unknown>> : {};
  const bounded = (key: keyof typeof PLAY_STAGE_READING_LIMITS): number => {
    const raw = input[key];
    const limit = PLAY_STAGE_READING_LIMITS[key];
    return typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(limit.max, Math.max(limit.min, raw))
      : PLAY_STAGE_READING_DEFAULTS[key];
  };
  return {
    charsPerSecond: Math.round(bounded('charsPerSecond')),
    autoDelayMs: Math.round(bounded('autoDelayMs')),
    boxOpacity: bounded('boxOpacity'),
    typewriter: typeof input.typewriter === 'boolean' ? input.typewriter : PLAY_STAGE_READING_DEFAULTS.typewriter,
  };
}
