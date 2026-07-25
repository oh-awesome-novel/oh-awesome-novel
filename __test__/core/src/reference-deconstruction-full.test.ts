import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createReferenceDeconstructionWorkPlan,
  createReferenceStructureFingerprint,
  resolveReferenceChapterWorkUnitWindow,
} from '@oh-awesome-novel/core';

describe('reference full deconstruction work plan', () => {
  it('plans every chapter beyond the former twelve-chapter stub boundary', () => {
    const chapters = Array.from({ length: 15 }, (_, index) => ({
      id: String(index + 1).padStart(4, '0'),
      title: `Chapter ${index + 1}`,
      lineStart: index * 2 + 1,
      lineEnd: index * 2 + 2,
      wordCount: 4,
    }));
    const sourceText = chapters.flatMap((chapter) => [
      chapter.title,
      `Bounded source movement ${chapter.id}.`,
    ]).join('\n');
    const plan = createReferenceDeconstructionWorkPlan({
      referenceId: 'reference-many-chapters',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint: createReferenceStructureFingerprint({
        chapterCount: chapters.length,
        chapters,
        confidence: 'high',
      }),
      sourceText,
      chapters,
    });

    const chapterUnits = plan.units.filter((unit) => unit.kind === 'chapterChunk');
    expect(new Set(chapterUnits.map((unit) => unit.chapterId))).toEqual(
      new Set(chapters.map((chapter) => chapter.id)),
    );
    expect(chapterUnits).toHaveLength(15);
    expect(plan.units.at(-1)?.kind).toBe('analysisQuality');
  });

  it('preserves distinct offsets when one source line spans multiple chunks', () => {
    const longLine = Array.from({ length: 25_500 }, (_, index) =>
      String.fromCharCode(65 + (index % 26))).join('');
    const sourceText = `Chapter 1\n${longLine}`;
    const chapters = [{
      id: '0001',
      title: 'Chapter 1',
      lineStart: 1,
      lineEnd: 2,
      wordCount: 2,
    }];
    const plan = createReferenceDeconstructionWorkPlan({
      referenceId: 'reference-long-line',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint: createReferenceStructureFingerprint({
        chapterCount: 1,
        chapters,
        confidence: 'high',
      }),
      sourceText,
      chapters,
    });
    const slicedUnits = plan.units.filter((unit) =>
      unit.kind === 'chapterChunk' && unit.lineCharStart !== undefined);
    const windows = slicedUnits.map((unit) =>
      resolveReferenceChapterWorkUnitWindow(sourceText, unit));

    expect(slicedUnits).toHaveLength(3);
    expect(slicedUnits.map((unit) => [unit.lineCharStart, unit.lineCharEnd])).toEqual([
      [0, 12_000],
      [12_000, 24_000],
      [24_000, 25_500],
    ]);
    expect(windows.map((window) => window.content).join('')).toBe(longLine);
    expect(new Set(windows.map((window) => window.content))).toHaveLength(3);
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
