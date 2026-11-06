import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  importReferenceWork,
  normalizeReferenceQuestion,
  normalizeReferenceQuestionAnswer,
  prepareReferenceQuestionSource,
} from '@oh-awesome-novel/core';

const OPENING = 'A short opening applies pressure and then changes direction while a visible consequence keeps the reader-facing question active.';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function prepare(opening = OPENING) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-question-'));
  roots.push(workspaceRoot);
  const imported = await importReferenceWork({
    workspaceRoot,
    title: 'Question Fixture',
    sourceText: ['Chapter 1', opening, '', 'Chapter 2', 'A second movement resolves one question while opening another.'].join('\n'),
    rights: 'owned',
  });
  return prepareReferenceQuestionSource(workspaceRoot, imported.reference.id);
}

describe('reference question', () => {
  it('splits the source into host pointers without creating a run', async () => {
    const source = await prepare();
    expect(source.title).toBe('Question Fixture');
    expect(source.windows).toHaveLength(2);
    expect(source.windows[0]!.content).toContain(OPENING);
    expect(source.windows[1]!.pointer.lineStart).toBeGreaterThan(source.windows[0]!.pointer.lineEnd);
  });

  it('accepts only pointers the model opened and resolves their lines', async () => {
    const source = await prepare();
    const [first, second] = source.windows;
    const allowedPointers = { [first!.pointerId]: first!.pointer };
    const answer = normalizeReferenceQuestionAnswer({
      answer: 'The opening turns on a visible consequence.',
      findings: [{ observation: 'Pressure turns early.', technique: null, evidenceRefs: [first!.pointerId] }],
      uncertainties: [],
    }, { question: 'How does it open?', allowedPointers, windows: source.windows });
    expect(answer.evidence).toEqual([{
      pointerId: first!.pointerId,
      chapterId: first!.pointer.chapterId,
      lineStart: first!.pointer.lineStart,
      lineEnd: first!.pointer.lineEnd,
    }]);
    expect(answer.findings[0]).not.toHaveProperty('technique');
    expect(answer.copyRisk).toBe(false);

    expect(() => normalizeReferenceQuestionAnswer({
      answer: 'x',
      findings: [{ observation: 'y', technique: null, evidenceRefs: [second!.pointerId] }],
      uncertainties: [],
    }, { question: 'q', allowedPointers, windows: source.windows })).toThrow(/not opened/u);
  });

  it('flags answers that repeat long source runs', async () => {
    const source = await prepare();
    const answer = normalizeReferenceQuestionAnswer({
      answer: `It says: ${OPENING}`,
      findings: [],
      uncertainties: ['Only two chapters exist.'],
    }, { question: 'q', allowedPointers: {}, windows: source.windows });
    expect(answer.copyRisk).toBe(true);
  });

  it('flags exactly 80 copied characters at every offset of the former 40-character stride', async () => {
    const excerpt = Array.from({ length: 80 }, (_, index) => String.fromCharCode(0x4e00 + index)).join('');
    const source = await prepare(`原文前缀：${excerpt}原文后缀。`);
    for (let offset = 0; offset < 40; offset++) {
      const result = normalizeReferenceQuestionAnswer({
        answer: `${'说'.repeat(offset)}${excerpt}。`, findings: [], uncertainties: [],
      }, { question: 'q', allowedPointers: {}, windows: source.windows });
      expect(result.copyRisk, `copied run starts at ${offset}`).toBe(true);
    }
  });

  it.each(['observation', 'technique'] as const)('checks unaligned copied runs in finding %s', async field => {
    const excerpt = Array.from({ length: 80 }, (_, index) => String.fromCharCode(0x4e00 + index)).join('');
    const source = await prepare(excerpt);
    const pointer = source.windows[0]!;
    const result = normalizeReferenceQuestionAnswer({
      answer: '分析结果',
      findings: [{ observation: '手法说明', technique: '分析', [field]: `说明：${excerpt}。`, evidenceRefs: [pointer.pointerId] }],
      uncertainties: [],
    }, { question: 'q', allowedPointers: { [pointer.pointerId]: pointer.pointer }, windows: source.windows });
    expect(result.copyRisk).toBe(true);
  });

  it('does not flag 79 copied characters, a changed character, or unrelated text', async () => {
    const excerpt = Array.from({ length: 80 }, (_, index) => String.fromCharCode(0x4e00 + index)).join('');
    const source = await prepare(excerpt);
    for (const answer of [
      `说明：${excerpt.slice(0, 79)}。`,
      `说明：${excerpt.slice(0, 40)}！${excerpt.slice(41)}。`,
      '说明：全新表达。'.repeat(30),
    ]) {
      expect(normalizeReferenceQuestionAnswer({ answer, findings: [], uncertainties: [] }, {
        question: 'q', allowedPointers: {}, windows: source.windows,
      }).copyRisk).toBe(false);
    }
  });

  it('requires literal equality even when two 80-character spans share a rolling hash', async () => {
    // Aa and BB have the same base-31 hash, including after a common prefix.
    const source = await prepare(`${'x'.repeat(78)}Aa`);
    expect(normalizeReferenceQuestionAnswer({
      answer: `${'x'.repeat(78)}BB`, findings: [], uncertainties: [],
    }, { question: 'q', allowedPointers: {}, windows: source.windows }).copyRisk).toBe(false);
  });

  it('checks a copied run across a tool-window boundary against the original source', async () => {
    const excerpt = Array.from({ length: 80 }, (_, index) => String.fromCharCode(0x4e00 + index)).join('');
    const source = await prepare(`${'前'.repeat(11_960)}${excerpt}${'后'.repeat(100)}`);
    expect(source.windows.every(window => !window.content.includes(excerpt))).toBe(true);
    expect(normalizeReferenceQuestionAnswer({
      answer: `说明：${excerpt}。`, findings: [], uncertainties: [],
    }, { question: 'q', allowedPointers: {}, windows: source.windows, sourceText: source.sourceText }).copyRisk).toBe(true);
  });

  it('bounds the question', () => {
    expect(normalizeReferenceQuestion('  why?  ')).toBe('why?');
    expect(() => normalizeReferenceQuestion('')).toThrow();
    expect(() => normalizeReferenceQuestion('x'.repeat(1_001))).toThrow();
  });
});
