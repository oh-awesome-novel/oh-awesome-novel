import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addOmittedSource,
  addSelectedSource,
  createContextPackageDraft,
  formatContextPackageSummary,
  resolveContextPackageArtifactPath,
  writeContextPackageArtifact,
} from '@oh-awesome-novel/core';

describe('agent context package', () => {
  it('builds selected and omitted source explanations with budget layers', () => {
    const contextPackage = createContextPackageDraft({
      id: 'ctx-test',
      capability: 'novel.write_chapter',
      createdAt: '2026-06-19T00:00:00.000Z',
      selected: [
        {
          sourceId: 'constitution',
          reason: 'highest priority writing rules',
          budgetLayer: 'L0',
          semanticBoundary: 'protected',
          path: '.oan/constitution/style.md',
        },
        {
          sourceId: 'previousChapterEnding',
          reason: 'continue from the latest scene anchor',
          budgetLayer: 'L1',
          semanticBoundary: 'compressible',
          path: 'chapters/0001/0003.md',
        },
      ],
      omitted: [
        {
          sourceId: 'referenceDistilled',
          reason: 'not causally relevant to this chapter',
          budgetLayer: 'L3',
          semanticBoundary: 'excluded',
        },
      ],
      trace: [
        {
          id: 'trace-constitution',
          type: 'workspaceSnapshot',
          sourceId: 'constitution',
          reason: 'loaded from workspace snapshot',
          budgetLayer: 'L0',
          semanticBoundary: 'protected',
          outcome: 'selected',
          createdAt: '2026-06-19T00:00:00.000Z',
          path: '.oan/constitution/style.md',
        },
      ],
      minimalMemory: {
        characters: ['heroine', 'heroine', 'hero'],
        hooks: ['black_mark'],
        worldRules: ['magic has a cost'],
        recentFacts: ['heroine is injured'],
      },
    });

    expect(contextPackage.selected.map((source) => source.budgetLayer)).toEqual([
      'L0',
      'L1',
    ]);
    expect(contextPackage.omitted[0]).toMatchObject({
      semanticBoundary: 'excluded',
      reason: 'not causally relevant to this chapter',
    });
    expect(contextPackage.trace[0]).toMatchObject({
      type: 'workspaceSnapshot',
      outcome: 'selected',
      reason: 'loaded from workspace snapshot',
    });
    expect(contextPackage.minimalMemory).toMatchObject({
      characters: ['heroine', 'hero'],
      hooks: ['black_mark'],
    });
  });

  it('requires explicit omitted source reasons', () => {
    expect(() =>
      createContextPackageDraft({
        capability: 'novel.review_chapter',
        omitted: [
          {
            sourceId: 'latestState',
            reason: ' ',
            budgetLayer: 'L0',
            semanticBoundary: 'protected',
          },
        ],
      }),
    ).toThrow('requires a reason');
  });

  it('requires explicit trace reasons', () => {
    expect(() =>
      createContextPackageDraft({
        capability: 'novel.review_chapter',
        trace: [
          {
            id: 'trace-empty',
            type: 'toolCall',
            toolName: 'chapter.get',
            reason: ' ',
            outcome: 'failed',
            createdAt: '2026-06-19T00:00:00.000Z',
          },
        ],
      }),
    ).toThrow('requires a reason');
  });

  it('adds sources without mutating the original package', () => {
    const base = createContextPackageDraft({
      id: 'ctx-add',
      capability: 'novel.plan_chapter',
      createdAt: '2026-06-19T00:00:00.000Z',
    });

    const withSelected = addSelectedSource(base, {
      sourceId: 'workflow',
      reason: 'workflow controls chapter planning steps',
      budgetLayer: 'L0',
      semanticBoundary: 'protected',
    });
    const withOmitted = addOmittedSource(withSelected, {
      sourceId: 'playTranscript',
      reason: 'sandbox transcript was not adopted',
      budgetLayer: 'L3',
      semanticBoundary: 'excluded',
    });

    expect(base.selected).toHaveLength(0);
    expect(withSelected.selected).toHaveLength(1);
    expect(withOmitted.omitted).toHaveLength(1);
  });

  it('formats a concise model-visible summary', () => {
    const contextPackage = createContextPackageDraft({
      id: 'ctx-summary',
      capability: 'novel.settle_chapter',
      createdAt: '2026-06-19T00:00:00.000Z',
      selected: [
        {
          sourceId: 'timeline',
          reason: 'settlement must align plot events',
          budgetLayer: 'L2',
          semanticBoundary: 'compressible',
        },
      ],
      trace: [
        {
          id: 'trace-timeline',
          type: 'toolCall',
          sourceId: 'timeline',
          toolName: 'timeline.list',
          reason: 'read timeline for settlement alignment',
          budgetLayer: 'L2',
          semanticBoundary: 'compressible',
          outcome: 'read',
          createdAt: '2026-06-19T00:00:00.000Z',
        },
      ],
    });

    const summary = formatContextPackageSummary(contextPackage);

    expect(summary).toContain('Context Package: ctx-summary');
    expect(summary).toContain('timeline [L2/compressible]');
    expect(summary).toContain('Omitted sources:');
    expect(summary).toContain('Trace:');
    expect(summary).toContain('toolCall/read timeline');
  });

  it('writes context package artifacts only under .workspace sessions', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-ctx-'));

    try {
      const contextPackage = createContextPackageDraft({
        id: 'ctx-write',
        capability: 'novel.write_chapter',
        createdAt: '2026-06-19T00:00:00.000Z',
      });
      const filePath = await writeContextPackageArtifact({
        workspaceRoot,
        sessionId: 'session-1',
        contextPackage,
      });

      expect(relative(workspaceRoot, filePath)).toBe(
        join('.workspace', 'sessions', 'session-1', 'context-package.yaml'),
      );
      await expect(readFile(filePath, 'utf-8')).resolves.toContain('ctx-write');
      expect(() =>
        resolveContextPackageArtifactPath(workspaceRoot, '../escape'),
      ).toThrow('Invalid session id');
      expect(() =>
        resolveContextPackageArtifactPath(workspaceRoot, '.hidden'),
      ).toThrow('Invalid session id');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
