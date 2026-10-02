import { describe, expect, it } from 'vitest';
import { createChapterSettlementSource, parseChapterSettlementObservationLog } from '@oh-awesome-novel/core';

const source = createChapterSettlementSource('0001/0001', '---\ntitle: Chapter\n---\n林安拿起钥匙。\n他离开房间。\n');
const valid = () => ({ schemaVersion: 1, chapterId: source.chapterId, sourceHash: source.sourceHash,
  observations: [{ id: 'key', category: 'item', subject: '林安', observation: '持有钥匙', confidence: 'high',
    evidence: { startLine: 4, endLine: 4, quote: '林安拿起钥匙。' } }], unresolvedAmbiguities: ['钥匙是否属于林安尚不明确。'] });

describe('strict chapter settlement observations', () => {
  it('binds the complete source hash and exact body lines while retaining reported ambiguities', () => {
    expect(source.bodyStartLine).toBe(4);
    expect(parseChapterSettlementObservationLog(valid(), source)).toEqual(valid());
    const crlf = createChapterSettlementSource('0001/0001', source.content.replaceAll('\n', '\r\n'));
    expect(crlf.sourceHash).not.toBe(source.sourceHash);
    expect(parseChapterSettlementObservationLog({ ...valid(), sourceHash: crlf.sourceHash }, crlf).observations).toHaveLength(1);
  });
  it.each([
    (v: any) => { v.sourceHash = 'a'.repeat(64); },
    (v: any) => { v.chapterId = '0001/0002'; },
    (v: any) => { v.extra = 'ignored?'; },
    (v: any) => { v.observations[0].evidence.quote = '大纲中林安取得钥匙。'; },
    (v: any) => { v.observations[0].evidence.startLine = 2; v.observations[0].evidence.endLine = 2; v.observations[0].evidence.quote = 'title: Chapter'; },
    (v: any) => { v.observations[0].evidence.endLine = 99; },
    (v: any) => { v.observations[0].evidence.startLine = 4.1; },
    (v: any) => { v.observations[0].evidence.path = 'outline/0001.yaml'; },
    (v: any) => { v.observations.push(v.observations[0]); },
    (v: any) => { v.observations[0].confidence = 'certain'; },
    (v: any) => { v.observations[0].category = 'instructions'; },
  ])('rejects schema, identity or evidence corruption %#', (mutate) => {
    const value = valid(); mutate(value);
    expect(() => parseChapterSettlementObservationLog(value, source)).toThrow();
  });
  it('rejects invalid chapter IDs, incomplete frontmatter and forged source metadata', () => {
    expect(() => createChapterSettlementSource('0000/0001', 'text')).toThrow();
    expect(() => createChapterSettlementSource('0001/0001', '---\ntitle: x')).toThrow();
    expect(() => parseChapterSettlementObservationLog(valid(), { ...source, bodyStartLine: 1 })).toThrow();
  });
});
