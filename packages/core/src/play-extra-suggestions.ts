import { PLAY_TURN_CHOICE_RULE } from './play-turn-choices.js';

/** Fence the read-only suggestion reply must use. */
export const PLAY_EXTRA_SUGGESTIONS_FENCE = 'oan-play-suggestions' as const;
/** One extra batch never offers more than this many actions. */
export const MAX_PLAY_EXTRA_SUGGESTIONS = 4;
const MAX_SUGGESTION_LENGTH = 200;
const MAX_EXISTING_SUGGESTIONS = 12;

/**
 * Read-only auxiliary instruction for "give me a few more actions". It never
 * advances the world: the reply is a fenced JSON list, not a settlement. Only
 * what the player has perceived may be used, so hidden-settlement turns get
 * player-standpoint options too.
 */
export function buildPlayExtraSuggestionsInstruction(existing: readonly string[] = []): string {
  const avoid = existing
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_EXISTING_SUGGESTIONS);
  return [
    '作者请求补充行动建议。这是暂停中的只读请求：不要推进时间，不要叙述后果，不要输出 oan-play-settlement。',
    '只根据参与者在已提交叙述中亲眼所见、亲耳所闻或已经知道的内容来想；不得使用隐藏事件、隐藏状态或参与者不知道的设定。',
    PLAY_TURN_CHOICE_RULE.replaceAll('settlement.suggestedActions lists', 'List'),
    ...(avoid.length
      ? ['下面这些已经给过，新的建议必须与它们在做法或态度上明显不同，不能换个说法重复：', ...avoid.map((value) => `- ${value}`)]
      : []),
    `只输出一个 \`\`\`${PLAY_EXTRA_SUGGESTIONS_FENCE} 代码块，内容是 JSON：{"suggestedActions": ["[say] ……", "[look] ……"]}，3 到 4 条。代码块之外不写任何内容。`,
  ].join('\n');
}

/**
 * Reads the auxiliary reply. Unknown shapes fail; entries are trimmed,
 * de-duplicated against each other and against `existing`, and capped.
 */
export function parsePlayExtraSuggestionsResponse(
  response: string,
  existing: readonly string[] = [],
): string[] {
  const fence = new RegExp(`\`\`\`${PLAY_EXTRA_SUGGESTIONS_FENCE}\\s*([\\s\\S]*?)\`\`\``, 'iu').exec(response);
  const body = (fence?.[1] ?? response).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('补充行动建议不是有效的 JSON。');
  }
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { suggestedActions?: unknown }).suggestedActions)
      ? (parsed as { suggestedActions: unknown[] }).suggestedActions
      : undefined;
  if (!list) {
    throw new Error('补充行动建议缺少 suggestedActions 列表。');
  }
  const seen = new Set(existing.map((value) => value.trim()));
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || [...text].length > MAX_SUGGESTION_LENGTH || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= MAX_PLAY_EXTRA_SUGGESTIONS) break;
  }
  if (!result.length) {
    throw new Error('模型没有给出新的行动建议。');
  }
  return result;
}
