import { computed, shallowRef } from 'vue';
import type { Ref } from 'vue';

/** Two presentations of one Play session: the immersive stage and the full workbench. */
export type PlayPresentationMode = 'stage' | 'workbench';

const MAX_REMEMBERED_SESSIONS = 200;

/**
 * Remembers the presentation mode per session as an application UI preference.
 * Nothing here touches the novel workspace or the Play session files.
 */
export function usePlayPresentationMode(
  workspacePath: string,
  selectedSessionId: Readonly<Ref<string>>,
) {
  const stored = shallowRef(readModes(workspacePath));
  const mode = computed<PlayPresentationMode>(() =>
    stored.value[selectedSessionId.value] ?? 'workbench');

  function setMode(next: PlayPresentationMode, sessionId = selectedSessionId.value): void {
    if (!sessionId || stored.value[sessionId] === next) return;
    // Re-insert so the most recently chosen sessions survive the size cap.
    const { [sessionId]: _previous, ...rest } = stored.value;
    const entries = [...Object.entries(rest), [sessionId, next] as const];
    stored.value = Object.fromEntries(entries.slice(-MAX_REMEMBERED_SESSIONS));
    writeModes(workspacePath, stored.value);
  }

  /** True when the author has chosen a mode for this session before. */
  function hasPreference(sessionId: string): boolean {
    return stored.value[sessionId] !== undefined;
  }

  return { mode, setMode, hasPreference };
}

function storageKey(workspacePath: string): string {
  return `oan:play:presentation-mode:${workspacePath}`;
}

function readModes(workspacePath: string): Record<string, PlayPresentationMode> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey(workspacePath)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(
      (entry): entry is [string, PlayPresentationMode] => entry[1] === 'stage' || entry[1] === 'workbench',
    ));
  } catch {
    return {};
  }
}

function writeModes(workspacePath: string, modes: Record<string, PlayPresentationMode>): void {
  try {
    globalThis.localStorage?.setItem(storageKey(workspacePath), JSON.stringify(modes));
  } catch {
    // A UI preference only; the session itself is unaffected.
  }
}
