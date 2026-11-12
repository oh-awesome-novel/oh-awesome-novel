import { expect, it } from 'vite-plus/test';
import { normalizePlayChapterIntent, parsePlayChapterDraft, nextChapterPath } from '@oh-awesome-novel/core';
import { chapterIntent } from './fixtures/play-chapter';
it('keeps author intent bounded and verifies every citation against the selected material', () => {
  expect(normalizePlayChapterIntent(chapterIntent)).toEqual(chapterIntent);
  expect(() => normalizePlayChapterIntent({ ...chapterIntent, unexpected: true })).toThrow();
  expect(() => normalizePlayChapterIntent({ ...chapterIntent, goal: 'x'.repeat(2001) })).toThrow();
  const draft = { title: '雨夜', paragraphs: [{ text: '她递出伞。', sourceItemIds: ['item-1'] }, { text: '雨声停了。', sourceItemIds: [] }] };
  expect(parsePlayChapterDraft(draft, ['item-1'])).toEqual(draft);
  expect(() => parsePlayChapterDraft(draft, ['item-2'])).toThrow('未选');
  expect(() => parsePlayChapterDraft({ ...draft, paragraphs: [{ text: '无来源', sourceItemIds: [] }] }, ['item-1'])).toThrow('没有引用');
  expect(nextChapterPath([])).toBe('chapters/0001/0001.md');
  expect(nextChapterPath([{ volume: 1, chapter: 2 }])).toBe('chapters/0001/0003.md');
});
