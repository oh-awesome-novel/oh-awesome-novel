import { describe, expect, it } from 'vitest';
import { stablePlayHistoryWindow } from '@oh-awesome-novel/backend';

const history = (count: number, size = 10) => Array.from({ length: count }, (_, n) => ({ content: `${n}`.padEnd(size, '.') }));

describe('append-only Play history window', () => {
  it('keeps the first message fixed between window steps so prefix caches stay valid', () => {
    for (let n = 1; n < 120; n++) {
      const now = stablePlayHistoryWindow(history(n));
      const next = stablePlayHistoryWindow(history(n + 1));
      expect(now.length).toBeGreaterThanOrEqual(Math.min(n, 20));
      if (next[0] === undefined || now[0] === undefined) continue;
      // Either the next request extends this one byte-for-byte or the start jumped a whole step.
      if (next[0].content === now[0].content) expect(next.slice(0, now.length)).toEqual(now);
      else expect(Number.parseInt(next[0].content, 10) % 20).toBe(0);
    }
  });

  it('never moves the window start backwards under the character budget', () => {
    let previous = 0;
    for (let n = 1; n < 200; n++) {
      const start = Number.parseInt(stablePlayHistoryWindow(history(n, 2_000))[0]!.content, 10);
      expect(start).toBeGreaterThanOrEqual(previous);
      previous = start;
    }
  });
});
