import { describe, expect, it } from 'vite-plus/test';
import { createPlayNarrativeStreamFilter, createPlaySentenceStreamFilter } from '@oh-awesome-novel/core';

const SETTLEMENT = '```oan-play-settlement\n{"events":[]}\n```';

/** Feeds the text one character at a time and records what each push released. */
function drip(raw: string, options?: Parameters<typeof createPlaySentenceStreamFilter>[0]): string[] {
  const filter = createPlaySentenceStreamFilter(options);
  const released: string[] = [];
  for (const char of raw) {
    const text = filter.push(char);
    if (text) released.push(text);
  }
  const tail = filter.finish();
  if (tail) released.push(tail);
  return released;
}

describe('Play stage sentence stream filter', () => {
  it('releases the first finished sentence before the settlement arrives', () => {
    const filter = createPlaySentenceStreamFilter();
    expect(filter.push('雨声压低了站台上的谈话。')).toBe('');
    // The sentence is complete once something other than a closing mark follows it.
    expect(filter.push('远处')).toBe('雨声压低了站台上的谈话。');
    expect(filter.settlementStarted).toBe(false);
    expect(filter.push(`的铁门开始落锁\n${SETTLEMENT}`)).toBe('远处的铁门开始落锁\n');
    expect(filter.settlementStarted).toBe(true);
    expect(filter.push('more')).toBe('');
  });

  it('releases the same text as the fail-closed filter for an ordinary reply, at every chunk boundary', () => {
    const narrative = '门开了。“谁？”她问……没有人回答！\n\n第二段没有句号\n';
    const raw = `${narrative}${SETTLEMENT}`;
    for (let split = 0; split <= raw.length; split += 1) {
      const stage = createPlaySentenceStreamFilter();
      const workbench = createPlayNarrativeStreamFilter();
      const read = (filter: typeof stage) => [filter.push(raw.slice(0, split)), filter.push(raw.slice(split)), filter.finish()].join('');
      expect(read(stage)).toBe(narrative);
      expect(read(workbench)).toBe(narrative);
    }
  });

  it('keeps closing quotes with their sentence and never splits a sentence', () => {
    expect(drip(`“你来了。”他说。\n“嗯！”\n${SETTLEMENT}`)).toEqual(['“你来了。”', '他说。\n', '“嗯！”\n']);
  });

  it('shows whole sentences before a structured piece and nothing from it or after it', () => {
    const cases: Array<[string, string]> = [
      // Inside a sentence.
      ['走廊安静。她低声说{"events":[]}然后离开。后面还有一句。\n', '走廊安静。'],
      // Right after a sentence end.
      ['走廊安静。{"visibility":"playerUnknown"}\n刺客在阁楼。\n', '走廊安静。'],
      // A settlement field name on its own line, before any fence.
      ['走廊安静。\n灯灭了。\nevents: 刺客在阁楼\n她没有察觉。\n', '走廊安静。\n灯灭了。\n'],
      ['走廊安静。\n"stateDelta": 1\n', '走廊安静。\n'],
    ];
    for (const [narrative, visible] of cases) {
      for (const raw of [`${narrative}${SETTLEMENT}`, narrative]) {
        expect(drip(raw).join('')).toBe(visible);
        for (let split = 0; split <= raw.length; split += 1) {
          const filter = createPlaySentenceStreamFilter();
          const text = [filter.push(raw.slice(0, split)), filter.push(raw.slice(split)), filter.finish()].join('');
          expect(visible.startsWith(text)).toBe(true);
          expect(text).not.toMatch(/[{}]|events|stateDelta|刺客|后面还有/u);
        }
      }
    }
  });

  it('never releases a fence, however it is typed or split', () => {
    for (const fence of ['```oan-play-settlement', '```OAN-PLAY-SETTLEMENT', '```', '~~~oan-play-settlement', 'oan-play-settlement']) {
      const raw = `雨停了。\n${fence}\n{"events":[]}\n\`\`\``;
      for (let split = 0; split <= raw.length; split += 1) {
        const filter = createPlaySentenceStreamFilter();
        expect([filter.push(raw.slice(0, split)), filter.push(raw.slice(split)), filter.finish()].join('')).toBe('雨停了。\n');
      }
    }
  });

  it('keeps an unfinished last sentence quarantined when the reply has no settlement', () => {
    expect(drip('第一句。第二句没有写完')).toEqual(['第一句。']);
  });

  it('releases a tagged line only when the whole line has arrived', () => {
    const raw = `念念放下灯。她抬头。\n@nian[angry] “你又迟到了！”“我等了很久。”\n@lin “抱歉。”\n${SETTLEMENT}`;
    expect(drip(raw, { wholeTaggedLines: true })).toEqual([
      '念念放下灯。',
      '她抬头。\n',
      '@nian[angry] “你又迟到了！”“我等了很久。”\n',
      '@lin “抱歉。”\n',
    ]);
    // The last tagged line may end at the boundary without a newline.
    expect(drip('@lin “抱歉。”```oan-play-settlement', { wholeTaggedLines: true })).toEqual(['@lin “抱歉。”']);
    // Without stage markup an "@" line is ordinary prose.
    expect(drip('@某人 第一句。第二句。\n')).toEqual(['@某人 第一句。', '第二句。\n']);
  });

  it('starts over after a reset', () => {
    const filter = createPlaySentenceStreamFilter();
    filter.push('我先查一下资料。{');
    filter.reset();
    expect(filter.push('门外传来脚步声。\n```oan-play-settlement')).toBe('门外传来脚步声。\n');
  });
});
