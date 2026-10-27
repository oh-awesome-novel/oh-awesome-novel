import { describe, expect, it } from 'vite-plus/test';
import { inferNovelAgentCapability } from '@oh-awesome-novel/agent';

describe('inferNovelAgentCapability keyword matching', () => {
  it('matches English keywords only as whole words', () => {
    expect(inferNovelAgentCapability('please settle this chapter')).toBe('novel.settle_chapter');
    expect(inferNovelAgentCapability('the ending feels unsettled to me')).toBeUndefined();
    expect(inferNovelAgentCapability('review chapter three')).toBe('novel.review_chapter');
    expect(inferNovelAgentCapability('show me a preview of the scene')).toBeUndefined();
    expect(inferNovelAgentCapability('update the character state')).toBe('novel.update_state');
    expect(inferNovelAgentCapability('what is the statement here?')).toBeUndefined();
    expect(inferNovelAgentCapability('an outline for book two')).toBe('novel.plan_outline');
  });

  it('keeps the Chinese keywords', () => {
    expect(inferNovelAgentCapability('帮我结算这一章')).toBe('novel.settle_chapter');
    expect(inferNovelAgentCapability('审稿第三章')).toBe('novel.review_chapter');
  });
});
