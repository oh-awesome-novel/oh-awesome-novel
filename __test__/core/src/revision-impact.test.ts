import { expect, it } from 'vite-plus/test';
import { analyzeRevisionImpact } from '@oh-awesome-novel/core';
import { impactFiles, impactHash, impactPath, impactText, impactAfter } from './fixtures/revision-impact';
const comparison = { path: impactPath, beforeKnown: true, beforeHash: impactHash(impactText), afterHash: impactHash(impactAfter), beforeText: impactText, afterText: impactAfter, oldTextAvailable: true, change: 'changed' as const, identities: [{ namespace: 'chapter', id: '0001/0001' }], names: ['城门'] };
it('propagates chapter changes through chapter, volume and global evidence without rewriting any files', () => {
  const files = impactFiles().filter(file => !file.path.includes('0001/0002')); files[0]!.content = impactAfter; const before = JSON.stringify(files);
  const result = analyzeRevisionImpact({ comparisons: [comparison], files, complete: true, references: [], generations: [] });
  expect(result.items.filter(item => item.kind === 'derived').map(i => [i.path, i.beforeStatus, i.status])).toEqual([
    ['summaries/chapter/0001/0001.md', 'current', 'stale'], ['state/chapters/0001/0001.yaml', 'current', 'stale'], ['summaries/volume/0001.md', 'current', 'stale'], ['summaries/global.md', 'current', 'stale'],
  ]); expect(JSON.stringify(files)).toBe(before);
  expect(analyzeRevisionImpact({ comparisons: [{ ...comparison, afterHash: comparison.beforeHash, change: 'unchanged' }], files, complete: true, references: [], generations: [] }).items).toEqual([]);
});
it('keeps explicit references, actual generation reads and unrelated namesakes separate', () => {
  const files = impactFiles(); const source = { ...comparison, path: 'characters/lin-an/profile.md', identities: [{ namespace: 'character', id: 'lin-an' }], names: ['林安'] };
  const result = analyzeRevisionImpact({ comparisons: [source], files, complete: true,
    references: [{ path: 'chapters/0001/0002.md', namespace: 'character', targetId: 'lin-an', location: 'characters[0]' }],
    generations: [{ path: source.path, generationId: 'turn-1', targetPath: impactPath, location: 'request.sources[0]' }] });
  expect(result.items.find(i => i.path === 'chapters/0001/0002.md')?.kind).toBe('reference');
  expect(result.items.find(i => i.generationId === 'turn-1')?.kind).toBe('generationRead');
  expect(result.items.find(i => i.path === 'world/namesake.md')?.kind).toBe('mention');
  expect(result.items.some(i => i.path === 'world/unrelated.md')).toBe(false);
});
it('bounds a large possible-match set and never labels partial aggregate coverage stale', () => {
  const files = [...impactFiles(), ...Array.from({ length: 1200 }, (_, i) => ({ path: `world/place-${i}.md`, content: '# 城门\n仅命中词项。' }))]; files[0]!.content = impactAfter;
  const result = analyzeRevisionImpact({ comparisons: [comparison], files, complete: false, references: [], generations: [] });
  expect(result.items.length).toBeLessThanOrEqual(300); expect(result.omittedItems).toBeGreaterThan(800);
  expect(result.items.find(i => i.path === 'summaries/global.md')?.status).toBe('unverified');
});
