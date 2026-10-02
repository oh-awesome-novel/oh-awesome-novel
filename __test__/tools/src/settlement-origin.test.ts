import { describe, expect, it } from 'vitest';
import { parsePendingActionOrigin } from '@oh-awesome-novel/tools';

const hash = 'a'.repeat(64);
const chapter = { path: 'chapters/0001/0001.md', sha256: hash };
const origin = { kind: 'chapterSettlement', chapterId: '0001/0001', sourceHash: hash, characterInventoryHash: hash,
  inputFiles: [chapter, { path: 'characters/hero/meta.yaml', sha256: hash },
    ...['foreshadow/active.yaml', 'foreshadow/resolved.yaml', 'state/chapters/0001/0001.yaml',
      'state/characters.yaml', 'summaries/chapter/0001/0001.md', 'timeline/events.yaml']
      .map((path) => ({ path, sha256: null }))] };

describe('settlement origin dependency boundary', () => {
  it('binds exact existing and absent domain files and freezes the read set', () => {
    const parsed = parsePendingActionOrigin(origin);
    expect(parsed).toEqual(origin);
    if (parsed.kind !== 'chapterSettlement') throw new Error('Wrong origin');
    expect(Object.isFrozen(parsed.inputFiles)).toBe(true);
    expect(Object.isFrozen(parsed.inputFiles[0])).toBe(true);
  });

  it('rejects missing evidence, unsafe/foreign inputs, duplicates and invalid identities', () => {
    const withInput = (index: number, input: unknown) => ({ ...origin,
      inputFiles: origin.inputFiles.map((file, offset) => offset === index ? input : file) });
    const withExtra = (path: string) => ({ ...origin,
      inputFiles: [...origin.inputFiles, { path, sha256: hash }].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
    const invalid = [
      { ...origin, characterInventoryHash: undefined }, { ...origin, characterInventoryHash: 'bad' },
      { ...origin, inputFiles: undefined }, { ...origin, inputFiles: [] },
      { ...origin, inputFiles: [chapter] },
      withInput(0, { ...chapter, sha256: null }),
      withInput(0, { ...chapter, sha256: 'b'.repeat(64) }),
      withInput(1, chapter),
      { ...origin, inputFiles: [...origin.inputFiles].reverse() },
      withExtra('.oan/config.yaml'), withExtra('outline/main.md'), withExtra('chapters/0001/0002.md'),
      withExtra(chapter.path),
      withInput(1, { path: 'characters/hero/../../meta.yaml', sha256: hash }),
      withInput(1, { ...origin.inputFiles[1], sha256: 'bad' }),
      withInput(1, { ...origin.inputFiles[1], sha256: null, content: 'private' }),
      withInput(2, { path: 'characters/other/meta.yaml', sha256: null }),
      { ...origin, inputFiles: Array.from({ length: 129 }, () => chapter) },
    ];
    for (const value of invalid) expect(() => parsePendingActionOrigin(value)).toThrow();
  });
});
