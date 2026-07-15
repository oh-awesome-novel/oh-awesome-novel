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
