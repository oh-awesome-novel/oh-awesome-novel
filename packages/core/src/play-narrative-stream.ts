export const PLAY_SETTLEMENT_FENCE = '```oan-play-settlement';
const PLAY_STREAM_BOUNDARIES = ['```', '~~~', 'oan-play-settlement'] as const;
const PLAY_STRUCTURED_NARRATIVE_FIELD =
  /(?:[{}]|```|~~~|oan-play-settlement|^\s*(?:settlement|events|scheduledEventChanges|stateDelta|observations|suggestedActions|elapsed|worldTimeAnchor)\s*:|"(?:events|scheduledEventChanges|stateDelta|observations|suggestedActions|elapsed|worldTimeAnchor)"\s*:)/imu;

export interface PlayNarrativeStreamFilter {
  push(chunk: string): string;
  finish(): string;
  reset(): void;
  readonly settlementStarted: boolean;
}

/**
 * Keeps the complete provider response quarantined until a settlement
 * boundary is observed. Only then may the narrative prefix be shown as
 * provisional text. This deliberately trades token-by-token latency for a
 * fail-closed boundary: a model response that omits the settlement fence (or
 * prints raw settlement JSON) never reaches the player UI. The final parser
 * separately requires the exact settlement tag before anything is committed.
 *
 * This is the filter for the workbench presentation and for every request that
 * names no presentation. Stage-mode turns use `createPlaySentenceStreamFilter`.
 */
export const createPlayNarrativeStreamFilter = (): PlayNarrativeStreamFilter => {
  let pending = '';
  let settlementStarted = false;

  return {
    push(chunk) {
      if (!chunk || settlementStarted) {
        return '';
      }

      pending += chunk;
      // Player-visible provisional prose must never include a fenced block.
      // The final parser still requires the exact settlement tag, but the
      // streaming boundary is deliberately more conservative so a mistyped,
      // spaced, or untagged settlement fence cannot expose structured facts.
      const normalizedPending = pending.toLowerCase();
      const fenceIndex = PLAY_STREAM_BOUNDARIES
        .map((boundary) => normalizedPending.indexOf(boundary))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0] ?? -1;

      if (fenceIndex >= 0) {
        const narrative = pending.slice(0, fenceIndex);
        pending = '';
        settlementStarted = true;
        return isSafePlayNarrativePrefix(narrative) ? narrative : '';
      }

      return '';
    },
    finish() {
      if (settlementStarted) {
        return '';
      }

      pending = '';
      return '';
    },
    reset() {
      pending = '';
      settlementStarted = false;
    },
    get settlementStarted() {
      return settlementStarted;
    },
  };
};

/** How much already released text is re-checked together with the next sentence. */
const SENTENCE_STREAM_CONTEXT = 256;
// A sentence end that is known to be complete: closing marks are followed by something else, or the line ended.
const SENTENCE_END = /[。！？!?…]+[”」』"’）)]*(?=[^。！？!?…”」』"’）)\n])|\n/gu;

export interface PlaySentenceStreamFilterOptions {
  /** Stage markup (task 1610): a line that starts with a speaker tag is only released whole. */
  wholeTaggedLines?: boolean;
}

/**
 * Stage-mode filter (task 1620): releases finished sentences before the settlement
 * boundary, so the stage can start playing while the referee is still writing.
 *
 * This deliberately relaxes the fail-closed boundary above, and only for turns
 * requested with the stage presentation:
 * - Still true: braces, fences and settlement field names never reach a draft. Every
 *   sentence is checked together with the text released just before it; the first
 *   suspicious piece closes the filter and nothing after it is released, even if a
 *   valid fence follows. Nothing is saved unless the final parser accepts the reply.
 * - No longer true: the opening sentences of a reply that later fails to parse may
 *   already have been shown; the caller withdraws the draft when that happens.
 * - Not addressed here or above: a plain sentence that reveals something the player
 *   should not know.
 */
export const createPlaySentenceStreamFilter = (
  options: PlaySentenceStreamFilterOptions = {},
): PlayNarrativeStreamFilter => {
  let pending = '';
  let context = '';
  let atLineStart = true;
  let closed = false;
  let settlementStarted = false;

  const release = (text: string): string => {
    if (!text) return '';
    if (!isSafePlayNarrativePrefix(context + text)) {
      closed = true;
      pending = '';
      return '';
    }
    context = (context + text).slice(-SENTENCE_STREAM_CONTEXT);
    atLineStart = text.endsWith('\n');
    return text;
  };

  /** Ends of the finished sentences in `pending` that may be released now, in order. */
  const sentenceEnds = (): number[] => {
    const ends: number[] = [];
    let lineStart = atLineStart;
    let lineBegin = 0;
    for (const match of pending.matchAll(SENTENCE_END)) {
      const stop = match.index + match[0].length;
      const newline = match[0] === '\n';
      const tagged = options.wholeTaggedLines && lineStart && /^\s*[@＠]/u.test(pending.slice(lineBegin));
      if (newline || !tagged) ends.push(stop);
      if (newline) { lineStart = true; lineBegin = stop; }
    }
    return ends;
  };

  /** Releases sentence by sentence, so whole sentences before a suspicious piece stay visible. */
  const releaseUpTo = (ends: readonly number[]): string => {
    let released = '';
    let start = 0;
    for (const end of ends) {
      if (closed) break;
      released += release(pending.slice(start, end));
      start = end;
    }
    if (!closed) pending = pending.slice(start);
    return released;
  };

  return {
    push(chunk) {
      if (!chunk || closed || settlementStarted) {
        return '';
      }

      pending += chunk;
      const normalizedPending = pending.toLowerCase();
      const fenceIndex = PLAY_STREAM_BOUNDARIES
        .map((boundary) => normalizedPending.indexOf(boundary))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0] ?? -1;

      if (fenceIndex >= 0) {
        // The boundary ends the narrative: its last sentence is complete even without a full stop.
        pending = pending.slice(0, fenceIndex);
        settlementStarted = true;
        const released = releaseUpTo([...sentenceEnds().filter(end => end < pending.length), pending.length]);
        pending = '';
        return released;
      }

      return releaseUpTo(sentenceEnds());
    },
    finish() {
      // Text after the last finished sentence stays quarantined, as in the fail-closed filter.
      pending = '';
      return '';
    },
    reset() {
      pending = '';
      context = '';
      atLineStart = true;
      closed = false;
      settlementStarted = false;
    },
    get settlementStarted() {
      return settlementStarted;
    },
  };
};

/**
 * Player-visible narrative is prose, never a second structured output
 * channel. Rejecting braces and settlement field labels is intentionally
 * conservative: otherwise raw hidden JSON before a later valid fence could
 * be released and then committed as if it were ordinary narrative.
 */
export function assertSafePlayNarrativePrefix(value: string): void {
  if (!isSafePlayNarrativePrefix(value)) {
    throw new Error(
      'Play player-visible narrative must not contain structured settlement data.',
    );
  }
}

function isSafePlayNarrativePrefix(value: string): boolean {
  return !PLAY_STRUCTURED_NARRATIVE_FIELD.test(value);
}
