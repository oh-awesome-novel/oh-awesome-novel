import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  MAX_REFERENCE_QUICK_PREVIEW_CHAPTERS,
  createReferenceEvidencePointerMap,
  createReferenceQuickPreviewSelection,
  createReferenceStructureFingerprint,
  normalizeReferenceQuickPreviewModelOutput,
} from '@oh-awesome-novel/core';

describe('reference deconstruction contracts', () => {
  it('selects at most three requested chapters under a hard character budget', () => {
    const sourceText = [
      'Chapter 1',
      'A'.repeat(90),
      'Chapter 2',
      'B'.repeat(90),
      'Chapter 3',
      'C'.repeat(90),
      'Chapter 4',
      'D'.repeat(90),
    ].join('\n');
    const chapters = [1, 2, 3, 4].map((number) => ({
      id: String(number).padStart(4, '0'),
      title: `Chapter ${number}`,
      lineStart: number * 2 - 1,
      lineEnd: number * 2,
      wordCount: 2,
    }));
    const structureFingerprint = createReferenceStructureFingerprint({
      chapterCount: chapters.length,
      chapters,
      confidence: 'high',
    });
    const selection = createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-alpha',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint,
      chapters,
    }, {
      selectedChapterIds: ['0002', '0003'],
      maxChars: 100,
      maxChapters: MAX_REFERENCE_QUICK_PREVIEW_CHAPTERS,
      maxChunkChars: 40,
    });

    expect(selection.selectedChapterIds).toEqual(['0002', '0003']);
    expect(selection.omittedChapterIds).toEqual(['0001', '0004']);
    expect(selection.totalChars).toBeLessThanOrEqual(100);
    expect(selection.windows.every((window) => window.charLength <= 40)).toBe(true);
    expect(selection.windows.map((window) => window.pointerId)).toEqual(
      selection.windows.map((_, index) =>
        `source-window-${String(index + 1).padStart(3, '0')}`),
    );

    const defaultChunkSelection = createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-alpha',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint,
      chapters,
    }, { maxChars: 100 });
    expect(defaultChunkSelection.totalChars).toBeLessThanOrEqual(100);
    expect(defaultChunkSelection.windows.every((window) =>
      window.charLength <= 100)).toBe(true);

    expect(() => createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-alpha',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint,
      chapters,
    }, {
      selectedChapterIds: ['0001', '0002', '0003', '0004'],
    })).toThrow('selectedChapterIds');
  });

  it('normalizes typed preview output with stable ids and evidence closure', () => {
    const sourceText = `Chapter 1\n${'A distinctive source sequence '.repeat(8)}`;
    const chapters = [{
      id: '0001',
      title: 'Chapter 1',
      lineStart: 1,
      lineEnd: 2,
      wordCount: 32,
    }];
    const selection = createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-alpha',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint: createReferenceStructureFingerprint({
        chapterCount: 1,
        chapters,
        confidence: 'medium',
      }),
      chapters,
    });
    const allowedPointers = createReferenceEvidencePointerMap(selection);
    const output = validOutput(selection.windows[0]!.pointerId);
    const first = normalizeReferenceQuickPreviewModelOutput(output, {
      runId: 'run-alpha',
      referenceId: selection.referenceId,
      sourceChecksumSha256: selection.sourceChecksumSha256,
      selectedChapterIds: selection.selectedChapterIds,
      allowedPointers,
      sourceWindows: selection.windows,
    });
    const second = normalizeReferenceQuickPreviewModelOutput(output, {
      runId: 'run-alpha',
      referenceId: selection.referenceId,
      sourceChecksumSha256: selection.sourceChecksumSha256,
      selectedChapterIds: selection.selectedChapterIds,
      allowedPointers,
      sourceWindows: selection.windows,
    });

    expect(first).toEqual(second);
    expect(first.chapterPreviews[0]?.id).toMatch(/^preview-chapter-/u);
    expect(first.findings[0]?.id).toMatch(/^preview-finding-/u);
    expect(first.borrowablePatterns[0]?.id).toMatch(/^preview-pattern-/u);
    expect(first.coverage).toEqual({
      selectedChapterIds: ['0001'],
      analyzedChapterIds: ['0001'],
      selectedPointerCount: selection.windows.length,
      citedPointerCount: 1,
      chapterCoveragePercent: 100,
    });

    expect(() => normalizeReferenceQuickPreviewModelOutput({
      ...output,
      findings: [{ ...output.findings[0], evidenceRefs: ['unknown-evidence'] }],
    }, {
      runId: 'run-alpha',
      referenceId: selection.referenceId,
      sourceChecksumSha256: selection.sourceChecksumSha256,
      selectedChapterIds: selection.selectedChapterIds,
      allowedPointers,
    })).toThrow('unknown evidence ref');
  });

  it('reports blocking exact-overlap diagnostics without returning source text', () => {
    const copied = 'This is a deliberately long exact source expression '.repeat(4);
    const sourceText = `Chapter 1\n${copied}`;
    const chapters = [{
      id: '0001',
      title: 'Chapter 1',
      lineStart: 1,
      lineEnd: 2,
      wordCount: 30,
    }];
    const selection = createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-copy-risk',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint: createReferenceStructureFingerprint({
        chapterCount: 1,
        chapters,
        confidence: 'medium',
      }),
      chapters,
    });
    const output = validOutput(selection.windows[0]!.pointerId);
    const preview = normalizeReferenceQuickPreviewModelOutput({
      ...output,
      sourceOverview: copied,
    }, {
      runId: 'run-copy-risk',
      referenceId: selection.referenceId,
      sourceChecksumSha256: selection.sourceChecksumSha256,
      selectedChapterIds: selection.selectedChapterIds,
      allowedPointers: createReferenceEvidencePointerMap(selection),
      sourceWindows: selection.windows,
    });

    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: 'copyRisk.exactOverlap',
      blocking: true,
      evidenceRefs: [],
    }));
    expect(JSON.stringify(preview.diagnostics)).not.toContain(copied);
  });

  it('blocks approval when model output omits a selected chapter preview', () => {
    const sourceText = [
      'Chapter 1',
      'First chapter source.',
      'Chapter 2',
      'Second chapter source.',
      'Chapter 3',
      'Third chapter source.',
    ].join('\n');
    const chapters = [1, 2, 3].map((number) => ({
      id: String(number).padStart(4, '0'),
      title: `Chapter ${number}`,
      lineStart: number * 2 - 1,
      lineEnd: number * 2,
      wordCount: 4,
    }));
    const selection = createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-incomplete',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint: createReferenceStructureFingerprint({
        chapterCount: chapters.length,
        chapters,
        confidence: 'high',
      }),
      chapters,
    });
    const preview = normalizeReferenceQuickPreviewModelOutput(
      validOutput(selection.windows[0]!.pointerId),
      {
        runId: 'run-incomplete',
        referenceId: selection.referenceId,
        sourceChecksumSha256: selection.sourceChecksumSha256,
        selectedChapterIds: selection.selectedChapterIds,
        allowedPointers: createReferenceEvidencePointerMap(selection),
        sourceWindows: selection.windows,
      },
    );

    expect(preview.coverage.chapterCoveragePercent).toBe(33);
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: 'coverage.incomplete',
      blocking: true,
      evidenceRefs: [],
    }));
  });

  it('rejects source selections that fragment into more than 24 windows', () => {
    const sourceText = ['Chapter 1', ...Array.from({ length: 30 }, () => 'AAAA')]
      .join('\n');
    const chapters = [{
      id: '0001',
      title: 'Chapter 1',
      lineStart: 1,
      lineEnd: 31,
      wordCount: 31,
    }];
    expect(() => createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-many-windows',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint: createReferenceStructureFingerprint({
        chapterCount: 1,
        chapters,
        confidence: 'medium',
      }),
      chapters,
    }, {
      maxChars: 120,
      maxChunkChars: 5,
    })).toThrow('cannot exceed 24 source windows');
  });

  it('checks every optional user-visible model field for exact overlap', () => {
    const copied = 'A deliberately recognizable source passage for overlap checking '.repeat(3);
    const sourceText = `Chapter 1\n${copied}`;
    const chapters = [{
      id: '0001',
      title: 'Chapter 1',
      lineStart: 1,
      lineEnd: 2,
      wordCount: 24,
    }];
    const selection = createReferenceQuickPreviewSelection({
      sourceText,
      referenceId: 'reference-overlap-fields',
      sourceChecksumSha256: sha256(sourceText),
      structureFingerprint: createReferenceStructureFingerprint({
        chapterCount: 1,
        chapters,
        confidence: 'medium',
      }),
      chapters,
    });
    const mutations: Array<{
      name: string;
      apply(output: ReturnType<typeof validOutput>): void;
    }> = [
      { name: 'chapter uncertainty', apply: (output) => { output.chapterPreviews[0]!.uncertainty = copied; } },
      { name: 'finding whenUseful', apply: (output) => { output.findings[0]!.whenUseful = copied; } },
      { name: 'finding avoid', apply: (output) => { output.findings[0]!.avoid = copied; } },
      { name: 'finding uncertainty', apply: (output) => { output.findings[0]!.uncertainty = copied; } },
      { name: 'pattern whenUseful', apply: (output) => { output.borrowablePatterns[0]!.whenUseful = copied; } },
      { name: 'top-level uncertainties', apply: (output) => { output.uncertainties = [copied]; } },
    ];

    for (const mutation of mutations) {
      const output = validOutput(selection.windows[0]!.pointerId);
      mutation.apply(output);
      const preview = normalizeReferenceQuickPreviewModelOutput(output, {
        runId: `run-overlap-${mutation.name.replaceAll(/\W+/gu, '-')}`,
        referenceId: selection.referenceId,
        sourceChecksumSha256: selection.sourceChecksumSha256,
        selectedChapterIds: selection.selectedChapterIds,
        allowedPointers: createReferenceEvidencePointerMap(selection),
        sourceWindows: selection.windows,
      });
      expect(preview.diagnostics, mutation.name).toContainEqual(expect.objectContaining({
        code: 'copyRisk.exactOverlap',
        blocking: true,
      }));
    }
  });
});

function validOutput(pointerId: string) {
  return {
    sourceOverview: 'The opening establishes a question and delays its answer.',
    chapterPreviews: [{
      chapterId: '0001',
      summary: 'The opening introduces friction and an unresolved turn.',
      evidenceRefs: [pointerId],
      confidence: 'high' as const,
      uncertainty: null,
    }],
    findings: [{
      kind: 'hook' as const,
      observation: 'A concrete question appears before its answer.',
      technique: 'Open with a bounded question and delay resolution.',
      whenUseful: null,
      avoid: null,
      confidence: 'high' as const,
      evidenceRefs: [pointerId],
      generalInference: false,
      uncertainty: null,
    }],
    borrowablePatterns: [{
      title: 'Bounded opening question',
      technique: 'Create a clear uncertainty with a near-term promise.',
      whenUseful: null,
      evidenceRefs: [pointerId],
      confidence: 'high' as const,
    }],
    doNotCopy: ['Do not reuse names, prose, dialogue, or scene execution.'],
    differentiationRequirements: ['Change premise, characters, setting, and causal sequence.'],
    differentiationPrompts: ['What different conflict can serve the same reader function?'],
    canonContaminationWarnings: ['Reference facts are not current-novel canon.'],
    confidence: 'high' as const,
    uncertainties: [],
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
