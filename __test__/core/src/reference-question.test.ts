import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  importReferenceWork,
  normalizeReferenceQuestion,
  normalizeReferenceQuestionAnswer,
  prepareReferenceQuestionSource,
} from '@oh-awesome-novel/core';

const OPENING = 'A short opening applies pressure and then changes direction while a visible consequence keeps the reader-facing question active.';

async function prepare() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-question-'));
  const imported = await importReferenceWork({
    workspaceRoot,
    title: 'Question Fixture',
    sourceText: ['Chapter 1', OPENING, '', 'Chapter 2', 'A second movement resolves one question while opening another.'].join('\n'),
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

  it('bounds the question', () => {
    expect(normalizeReferenceQuestion('  why?  ')).toBe('why?');
    expect(() => normalizeReferenceQuestion('')).toThrow();
    expect(() => normalizeReferenceQuestion('x'.repeat(1_001))).toThrow();
  });
});
