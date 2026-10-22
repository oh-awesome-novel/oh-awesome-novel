import { getPlayFrozenSystemPrompt } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
export interface PlayContextQuestion {
  frozenSystemPrompt: string;
  request: string;
}
/** A read-only throwaway question scoped to an exact selected-branch turn. */
export async function askInPlayContext(
  session: PlaySession,
  turnId: string,
  instruction: string,
  generate: (question: PlayContextQuestion) => Promise<string>,
): Promise<string> {
  const index = session.selectedTurnIds.indexOf(turnId);
  if (index < 0) throw new Error('Auxiliary question turn must belong to the selected branch.');
  if (!instruction.trim()) throw new Error('Auxiliary instruction is required.');
  const ids = new Set(session.selectedTurnIds.slice(0, index + 1));
  const history = session.turnArtifacts.filter(turn => ids.has(turn.id))
    .flatMap(turn => turn.messages.map(message => `【${message.speaker}】${message.content}`)).join('\n');
  return generate({ frozenSystemPrompt: getPlayFrozenSystemPrompt(session), request: `<历史记录>\n${history}\n</历史记录>\n<暂停推演：只读辅助请求>\n${instruction}\n</暂停推演：只读辅助请求>` });
}
