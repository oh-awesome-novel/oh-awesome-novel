import { isPlayCompactionActive } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
/** Selected committed prose only; never leak sibling branches or replay settlement JSON. */
export function playContextHistory(session: PlaySession, throughTurnId?: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const through = throughTurnId ? session.selectedTurnIds.indexOf(throughTurnId) : session.selectedTurnIds.length - 1;
  const ids = new Set(session.selectedTurnIds.slice(0, through + 1));
  const boundary = isPlayCompactionActive(session) ? session.metadataExtensions.playCompactionStartRevision : undefined;
  const turns = session.turnArtifacts.filter(turn => ids.has(turn.id) && (typeof boundary !== 'number' || turn.revision > boundary));
  const messages = turns.flatMap(turn => turn.messages.map(message => ({ role: message.speaker === 'user' ? 'user' as const : 'assistant' as const, content: message.content })));
  return stablePlayHistoryWindow(messages);
}

/** Messages per window step; the window start only moves on these boundaries. */
export const PLAY_HISTORY_WINDOW_STEP = 20;
export const PLAY_HISTORY_MAX_CHARACTERS = 60_000;

/**
 * An append-only view of the committed history. A sliding "last N" window
 * changes its first message every turn and defeats provider prefix caches, so
 * the start only advances by whole steps: at least one full step of recent
 * messages stays visible and the prefix is byte-stable between boundaries.
 * The start never moves backwards as history grows, so a later turn can still
 * reuse the cache written by an earlier one.
 */
export function stablePlayHistoryWindow<T extends { content: string }>(messages: readonly T[]): T[] {
  const step = PLAY_HISTORY_WINDOW_STEP;
  const size = (from: number) => messages.slice(from).reduce((sum, message) => sum + message.content.length, 0);
  let start = Math.max(0, Math.floor((messages.length - step) / step) * step);
  while (start + step < messages.length && size(start) > PLAY_HISTORY_MAX_CHARACTERS) start += step;
  if (size(start) <= PLAY_HISTORY_MAX_CHARACTERS) return messages.slice(start);
  // A single step over budget: keep the newest whole messages that fit.
  const bounded: T[] = [];
  let chars = 0;
  for (const message of messages.slice(start).reverse()) {
    if (chars + message.content.length > PLAY_HISTORY_MAX_CHARACTERS) break;
    bounded.unshift(message); chars += message.content.length;
  }
  return bounded;
}
