import { playContextHistory } from './play-context-history.js';
import { getPlayFrozenSystemPrompt } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
export interface PlayContextQuestion {
  frozenSystemPrompt: string;
  request: string;
  priorMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}
/** A read-only throwaway question scoped to an exact selected-branch turn. */
export async function askInPlayContext(
  session: PlaySession,
  turnId: string | undefined,
  instruction: string,
  generate: (question: PlayContextQuestion) => Promise<string>,
): Promise<string> {
  if (!instruction.trim()) throw new Error('Auxiliary instruction is required.');
  if (turnId === undefined) {
    // The virtual initial world has no committed prose yet; only the opening scene is player-visible.
    if (session.selectedTurnIds.length) throw new Error('Auxiliary question turn must belong to the selected branch.');
    return generate({ priorMessages: [], frozenSystemPrompt: getPlayFrozenSystemPrompt(session), request: [
      `<开场>${session.sceneStart}</开场>`,
      `<暂停推演：只读辅助请求>\n${instruction}\n</暂停推演：只读辅助请求>`,
    ].join('\n') });
  }
  const index = session.selectedTurnIds.indexOf(turnId);
  if (index < 0) throw new Error('Auxiliary question turn must belong to the selected branch.');
  const ids = new Set(session.selectedTurnIds.slice(0, index + 1));
  const messages = session.turnArtifacts.filter(turn => ids.has(turn.id))
    .flatMap(turn => turn.messages.map(message => `【${message.speaker}】${message.content}`));
  // The recent window already travels as cache-warm prior messages; only older history is added once.
  const priorMessages = playContextHistory(session, turnId);
  const earlier = messages.slice(0, Math.max(0, messages.length - priorMessages.length));
  return generate({ priorMessages, frozenSystemPrompt: getPlayFrozenSystemPrompt(session), request: [
    ...(earlier.length ? [`<更早历史>\n${earlier.join('\n')}\n</更早历史>`] : []),
    `<暂停推演：只读辅助请求>\n${instruction}\n</暂停推演：只读辅助请求>`,
  ].join('\n') });
}
