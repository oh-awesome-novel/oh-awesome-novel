export const PLAY_SETTLEMENT_FENCE = '```oan-play-settlement';

export interface PlayNarrativeStreamFilter {
  push(chunk: string): string;
  finish(): string;
  reset(): void;
  readonly settlementStarted: boolean;
}

/**
 * Keeps the structured settlement fence server-side while allowing the
 * narrative prefix to be shown as provisional text. The rolling tail makes
 * fence detection safe when a provider splits the sentinel across chunks.
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
      const fenceIndex = pending.toLowerCase().indexOf(PLAY_SETTLEMENT_FENCE);

      if (fenceIndex >= 0) {
        const narrative = pending.slice(0, fenceIndex);
        pending = '';
        settlementStarted = true;
        return narrative;
      }

      const safeLength = pending.length - settlementFencePrefixSuffixLength(pending);
      const narrative = pending.slice(0, safeLength);
      pending = pending.slice(safeLength);
      return narrative;
    },
    finish() {
      if (settlementStarted) {
        return '';
      }

      const narrative = pending;
      pending = '';
      return narrative;
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

function settlementFencePrefixSuffixLength(value: string): number {
  const normalized = value.toLowerCase();
  const maxLength = Math.min(
    normalized.length,
    PLAY_SETTLEMENT_FENCE.length - 1,
  );

  for (let length = maxLength; length > 0; length -= 1) {
    if (PLAY_SETTLEMENT_FENCE.startsWith(normalized.slice(-length))) {
      return length;
    }
  }

  return 0;
}
