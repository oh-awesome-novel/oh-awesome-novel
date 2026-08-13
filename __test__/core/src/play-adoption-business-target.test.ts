import { describe, expect, it } from 'vitest';

import { normalizePlayAdoptionBusinessTarget } from '@oh-awesome-novel/core';

describe('Play adoption business target', () => {
  it('normalizes all four targets without exposing legacy write tool names', () => {
    const targets = [
      normalizePlayAdoptionBusinessTarget({
        target: 'chapterDraft',
        payload: { chapterId: '0001/0002', title: 'Rain', content: 'Scene.' },
      }),
      normalizePlayAdoptionBusinessTarget({
        target: 'state',
        payload: { file: 'play.yaml', path: 'evidence.rain', value: true },
      }),
      normalizePlayAdoptionBusinessTarget({
        target: 'timeline',
        payload: { event: { id: 'rain', title: 'Rain', order: 1 } },
      }),
      normalizePlayAdoptionBusinessTarget({
        target: 'foreshadow',
        payload: { item: { id: 'rain', description: 'Rain clue', status: 'active' } },
      }),
    ];

    expect(targets.map((target) => target.targetFile)).toEqual([
      'chapters/0001/0002.md',
      'state/play.yaml',
      'timeline/events.yaml',
      'foreshadow/active.yaml',
    ]);
    expect(Object.keys(targets[0]!)).toEqual([
      'target',
      'targetFile',
      'operation',
      'content',
    ]);
  });

  it('rejects path substitution and unknown payload fields', () => {
    expect(() => normalizePlayAdoptionBusinessTarget({
      target: 'chapterDraft',
      payload: {
        chapterId: '0001/0002',
        file: 'chapters/0001/0003.md',
        content: 'Scene.',
      },
    })).toThrow(/must match/u);
    expect(() => normalizePlayAdoptionBusinessTarget({
      target: 'state',
      payload: {
        file: 'play.yaml',
        path: 'flag',
        value: true,
        unexpected: true,
      },
    })).toThrow(/unknown fields/u);
  });
});
