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

describe('strict multi-domain settlement intent', () => {
  const withState = () => ({ ...valid(), domainChanges: [{ domain: 'state', observationId: 'key', characterId: 'hero', field: 'inventory', expectedValue: null, value: '钥匙' }], unresolvedObservationIds: [] as string[] });
  it('accepts typed field intent and retains unresolved observation IDs for the compiler', () => {
    const value = withState(); value.unresolvedObservationIds = ['key'];
    expect(parseChapterSettlementObservationLog(value, source)).toEqual(value);
  });
  it.each([
    (v: any) => { v.domainChanges[0].target = 'state/evil.yaml'; },
    (v: any) => { v.domainChanges[0].characterId = '../hero'; },
    (v: any) => { v.domainChanges[0].characterId = 'constructor'; },
    (v: any) => { v.domainChanges[0].field = 'hp'; },
    (v: any) => { v.domainChanges[0].field = '__proto__'; },
    (v: any) => { v.domainChanges[0].expectedValue = {}; },
    (v: any) => { delete v.domainChanges[0].expectedValue; },
    (v: any) => { v.domainChanges[0].observationId = 'absent'; },
    (v: any) => { v.domainChanges[0].domain = 'world'; },
    (v: any) => { v.domainChanges.push(v.domainChanges[0]); },
    (v: any) => { v.domainChanges = Array.from({ length: 33 }, () => v.domainChanges[0]); },
    (v: any) => { v.unresolvedObservationIds = ['absent']; },
    (v: any) => { v.unresolvedObservationIds = ['key', 'key']; },
  ])('rejects unknown fields, references, category mappings and duplicate targets %#', (mutate) => {
    const value = withState(); mutate(value);
    expect(() => parseChapterSettlementObservationLog(value, source)).toThrow();
  });
  it('validates the hook lifecycle union and every category mapping', () => {
    const value: any = valid();
    value.observations[0].category = 'foreshadow';
    value.domainChanges = [{ domain: 'foreshadow', observationId: 'key', hookId: 'key_origin', operation: 'create', description: '钥匙来源未明', relatedCharacters: ['hero'] }];
    expect(parseChapterSettlementObservationLog(value, source).domainChanges).toHaveLength(1);
    for (const operation of ['mention', 'advance', 'resolve', 'defer']) {
      value.domainChanges = [{ domain: 'foreshadow', observationId: 'key', hookId: 'key_origin', operation, expectedStatus: 'active' }];
      expect(parseChapterSettlementObservationLog(value, source).domainChanges?.[0]).toEqual(value.domainChanges[0]);
    }
    value.domainChanges[0].operation = 'delete';
    expect(() => parseChapterSettlementObservationLog(value, source)).toThrow();
    value.domainChanges[0].operation = 'resolve'; value.domainChanges[0].expectedStatus = 'deferred';
    expect(() => parseChapterSettlementObservationLog(value, source)).toThrow();
    value.observations[0].category = 'time'; value.domainChanges = [{ domain: 'timeline', observationId: 'key', title: '离开房间', time: '清晨' }];
    expect(parseChapterSettlementObservationLog(value, source).domainChanges).toHaveLength(1);
    value.observations[0].category = 'character'; value.domainChanges = [{ domain: 'character', observationId: 'key', characterId: 'hero' }];
    expect(parseChapterSettlementObservationLog(value, source).domainChanges).toHaveLength(1);
    value.observations[0].category = 'time';
    expect(() => parseChapterSettlementObservationLog(value, source)).toThrow();
  });
});
