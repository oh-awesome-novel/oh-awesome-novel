import type { PlayActionKind, PlayRelativeTimeAdvance } from './play-types.js';

const MAX_WAIT_MINUTES = 525_600;

/**
 * Per-turn rule for the settlement's suggestedActions. It travels in the turn
 * tail, never the frozen prefix, so existing sessions receive it too.
 */
export const PLAY_TURN_CHOICE_RULE = [
  'Choice options: settlement.suggestedActions lists 3 or 4 actions the player could take next, written in the narrative language from the player\'s own standpoint.',
  'They must differ clearly in approach or attitude (for example cautious, direct, evasive); never restate one idea in different words.',
  'Each describes an attempt, never its outcome, and uses nothing the player cannot perceive or know.',
  'Start each with exactly one type tag: [say], [look], [move], [do], or [wait Nm], [wait Nh], [wait Nd] with a whole number N. After the tag write the action in at most 60 characters.',
].join(' ');

export interface PlayTurnChoice {
  /** Action text shown to the author and submitted as the turn input. */
  text: string;
  actionKind: PlayActionKind;
  /** Only a wait tag with an explicit valid duration carries one; the host never guesses a duration from prose. */
  timeAdvance?: PlayRelativeTimeAdvance;
  /** False when the text carried no recognised type tag and the kind was inferred. */
  typed: boolean;
}

const KIND_TAGS: Readonly<Record<string, PlayActionKind>> = {
  say: 'say', 说: 'say',
  look: 'look', 看: 'look',
  move: 'move', 走: 'move',
  do: 'do', 做: 'do',
  wait: 'wait', 等: 'wait',
};
const UNIT_TAGS: Readonly<Record<string, PlayRelativeTimeAdvance['unit']>> = {
  m: 'minute', min: 'minute', 分钟: 'minute',
  h: 'hour', 小时: 'hour',
  d: 'day', 天: 'day',
};
const TAG = /^\s*[[【]\s*([A-Za-z]{2,4}|[说看走做等])(?:\s*(\d{1,6})\s*(min|m|h|d|分钟|小时|天))?\s*[\]】]\s*/u;

/**
 * Reads one stored suggestedActions string. The stored value keeps its tag;
 * this is the only place that turns it into a typed action.
 */
export function parsePlayTurnChoice(value: string): PlayTurnChoice {
  const match = TAG.exec(value);
  const kind = match ? KIND_TAGS[match[1]!.toLowerCase()] : undefined;
  const text = (kind ? value.slice(match![0].length) : value).trim();
  // A tag with nothing after it, or a duration on a non-wait tag, is not a tag we issued.
  if (!kind || !text || (match![2] !== undefined && kind !== 'wait')) {
    const fallback = value.trim();
    return { text: fallback, actionKind: inferLegacyActionKind(fallback), typed: false };
  }
  const timeAdvance = kind === 'wait' ? readWait(match![2], match![3]) : undefined;
  return { text, actionKind: kind, ...(timeAdvance ? { timeAdvance } : {}), typed: true };
}

export function parsePlayTurnChoices(values: readonly string[]): PlayTurnChoice[] {
  return values.map(parsePlayTurnChoice).filter(choice => choice.text.length > 0);
}

function readWait(amountText: string | undefined, unitText: string | undefined): PlayRelativeTimeAdvance | undefined {
  const unit = unitText ? UNIT_TAGS[unitText] : undefined;
  const amount = Number(amountText);
  if (!unit || !Number.isSafeInteger(amount) || amount <= 0) return undefined;
  const minutes = unit === 'day' ? amount * 1_440 : unit === 'hour' ? amount * 60 : amount;
  return minutes <= MAX_WAIT_MINUTES ? { amount, unit } : undefined;
}

/** Suggestions written before the tag convention only hint at their kind through wording. */
function inferLegacyActionKind(text: string): PlayActionKind {
  const normalized = text.toLowerCase();
  if (/^(等待|等到|休息|wait|rest)/u.test(normalized)) return 'wait';
  if (/^(观察|查看|环顾|look|inspect)/u.test(normalized)) return 'look';
  if (/^(前往|走向|离开|进入|move|go|leave|enter)/u.test(normalized)) return 'move';
  if (/^(说|询问|回答|say|ask|tell)/u.test(normalized)) return 'say';
  return 'do';
}
