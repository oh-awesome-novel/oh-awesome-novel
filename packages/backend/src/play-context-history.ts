import { isPlayCompactionActive } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
/** Selected committed prose only; never leak sibling branches or replay settlement JSON. */
export function playContextHistory(session: PlaySession, throughTurnId?: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const through = throughTurnId ? session.selectedTurnIds.indexOf(throughTurnId) : session.selectedTurnIds.length - 1;
  const ids = new Set(session.selectedTurnIds.slice(0, through + 1));
  const boundary = isPlayCompactionActive(session) ? session.metadataExtensions.playCompactionStartRevision : undefined;
  const turns = session.turnArtifacts.filter(turn => ids.has(turn.id) && (typeof boundary !== 'number' || turn.revision > boundary));
  const messages = turns.flatMap(turn => turn.messages.map(message => ({ role: message.speaker === 'user' ? 'user' as const : 'assistant' as const, content: message.content })));
  // Match the referee's bounded recent history, with an additional byte-like
  // character budget. Whole committed replies stay immutable between requests.
  const bounded: typeof messages = [];
  let chars = 0;
  for (const message of messages.slice(-20).reverse()) {
    if (chars + message.content.length > 60_000) break;
    bounded.unshift(message); chars += message.content.length;
  }
  return bounded;
}
