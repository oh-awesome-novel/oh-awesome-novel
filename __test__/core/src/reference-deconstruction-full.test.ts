import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createReferenceDeconstructionWorkPlan,
  createReferenceStructureFingerprint,
  resolveReferenceChapterWorkUnitWindow,
} from '@oh-awesome-novel/core';
import type { WritingProfileOutput } from '@oh-awesome-novel/core';

describe('reference full deconstruction work plan', () => {
  it.each([
    {
      label: 'technique-only',
      outputs: ['techniques'] as WritingProfileOutput[],
      trackKeys: ['technique'],
    },
    {
      label: 'material-only',
      outputs: [
        'world',
        'characters',
        'relationships',
        'outline',
        'timeline',
      ] as WritingProfileOutput[],
      trackKeys: ['storyMaterial'],
    },
    {
      label: 'both',
      outputs: ['techniques', 'world', 'characters'] as WritingProfileOutput[],
      trackKeys: ['storyMaterial', 'technique'],
    },
  ])('builds the strict per-track terminal codec for $label', ({ outputs, trackKeys }) => {
    const plan = createPlan(outputs);

    expect(Object.keys(plan).sort()).toEqual([
      'chapterIds',
      'id',
      'outputs',
      'referenceId',
      'sourceChecksumSha256',
      'structureFingerprint',
      'tracks',
      'units',
      'version',
    ]);
    expect(Object.keys(plan.tracks).sort()).toEqual(trackKeys);
    expect(plan.outputs).toEqual(outputs);
    expect(plan).not.toHaveProperty('aggregateRootUnitId');
    expect(plan).not.toHaveProperty('styleUnitId');
    expect(plan).not.toHaveProperty('distillUnitId');
    expect(plan).not.toHaveProperty('analysisQualityUnitId');

    if (plan.tracks.technique) {
      expect(Object.keys(plan.tracks.technique).sort()).toEqual([
        'aggregateRootUnitId',
        'analysisQualityUnitId',
        'distillUnitId',
        'styleUnitId',
      ]);
      expectTerminal(plan, plan.tracks.technique.aggregateRootUnitId, 'technique', 'aggregate');
      expectTerminal(plan, plan.tracks.technique.styleUnitId, 'technique', 'style');
      expectTerminal(plan, plan.tracks.technique.distillUnitId, 'technique', 'distill');
      expectTerminal(
        plan,
        plan.tracks.technique.analysisQualityUnitId,
        'technique',
        'analysisQuality',
      );
    }
    if (plan.tracks.storyMaterial) {
      expect(Object.keys(plan.tracks.storyMaterial).sort()).toEqual([
        'aggregateRootUnitId',
        'analysisQualityUnitId',
        'materialKinds',
        'projectionUnitId',
      ]);
      expect(plan.tracks.storyMaterial.materialKinds).toEqual(
        outputs.filter((output) => output !== 'techniques'),
      );
      expectTerminal(
        plan,
        plan.tracks.storyMaterial.aggregateRootUnitId,
        'storyMaterial',
        'aggregate',
      );
      expectTerminal(
        plan,
        plan.tracks.storyMaterial.projectionUnitId,
        'storyMaterial',
        'materialProjection',
      );
      expectTerminal(
        plan,
        plan.tracks.storyMaterial.analysisQualityUnitId,
        'storyMaterial',
        'analysisQuality',
      );
    }
  });

  it('shares chapter source pointers between both typed tracks without sharing units', () => {
    const plan = createPlan(['techniques', 'world']);
    const techniqueUnits = plan.units.filter((unit) =>
      unit.track === 'technique' && unit.kind === 'chapterChunk');
    const materialUnits = plan.units.filter((unit) =>
      unit.track === 'storyMaterial' && unit.kind === 'chapterChunk');

    expect(techniqueUnits).toHaveLength(materialUnits.length);
    expect(techniqueUnits.map((unit) => ({
      chapterId: unit.chapterId,
      chunkId: unit.chunkId,
      pointerId: unit.pointerId,
      pointer: unit.pointer,
    }))).toEqual(materialUnits.map((unit) => ({
      chapterId: unit.chapterId,
      chunkId: unit.chunkId,
      pointerId: unit.pointerId,
      pointer: unit.pointer,
    })));
    expect(new Set([
      ...techniqueUnits.map((unit) => unit.id),
      ...materialUnits.map((unit) => unit.id),
    ]).size).toBe(techniqueUnits.length + materialUnits.length);
  });

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

function createPlan(outputs: readonly WritingProfileOutput[]) {
  const sourceText = [
    'Chapter 1',
    'A bounded first chapter movement.',
    'Chapter 2',
    'A bounded second chapter movement.',
  ].join('\n');
  const chapters = [
    { id: '0001', title: 'Chapter 1', lineStart: 1, lineEnd: 2 },
    { id: '0002', title: 'Chapter 2', lineStart: 3, lineEnd: 4 },
  ];
  return createReferenceDeconstructionWorkPlan({
    referenceId: 'reference-track-codec',
    sourceChecksumSha256: sha256(sourceText),
    structureFingerprint: createReferenceStructureFingerprint({
      chapterCount: chapters.length,
      chapters,
      confidence: 'high',
    }),
    sourceText,
    chapters,
    outputs,
  });
}

function expectTerminal(
  plan: ReturnType<typeof createReferenceDeconstructionWorkPlan>,
  unitId: string,
  track: 'technique' | 'storyMaterial',
  kind: 'aggregate' | 'style' | 'distill' | 'materialProjection' | 'analysisQuality',
): void {
  expect(plan.units.find((unit) => unit.id === unitId)).toMatchObject({
    id: unitId,
    track,
    kind,
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
