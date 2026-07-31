import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  formatReferenceContextSelectionMarkdown,
  importReferenceWork,
  listReferenceWorks,
  referenceSelectionToContextSources,
  selectReferenceContext,
  setReferenceEnabled,
} from '@oh-awesome-novel/core';

describe('reference work import', () => {
  it('returns before reference scoring when the active Profile excludes techniques', async () => {
    const selection = await selectReferenceContext({
      workspaceRoot: '/workspace-that-does-not-need-to-exist',
      techniquesEnabled: false,
      capability: 'novel.write_chapter',
      goal: '参考作品中的节奏技巧',
    });

    expect(selection).toMatchObject({
      usedTokens: 0,
      originalSourceRead: false,
      profileOmission: {
        reasonCode: 'profileExcludesTechniques',
      },
      included: [],
      omitted: [],
    });
    expect(formatReferenceContextSelectionMarkdown(selection))
      .toContain('Profile omission: profileExcludesTechniques');
  });

  it('rejects invalid metadata values before creating a reference bundle', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-'));

    await expect(importReferenceWork({
      workspaceRoot,
      title: 'Invalid Runtime Metadata',
      sourceText: 'Chapter 1\nText.',
      sourceType: 'futureSourceType',
    } as never)).rejects.toThrow('sourceType');
  });

  it('imports pasted reference text into an examples reference bundle', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-'));
    const result = await importReferenceWork({
      workspaceRoot,
      title: '雨城样章',
      sourceText: [
        '第一章 雨夜',
        '苏灵推开门。',
        '第二章 灯火',
        '街角还有人在等。',
        '第三章 回声',
        '旧账开始浮出水面。',
      ].join('\n'),
      sourceType: 'chapterSample',
      rights: 'owned',
      allowedUsage: ['analysisOnly', 'styleInspiration', 'noDirectQuotation'],
    });

    expect(result.reference).toMatchObject({
      title: '雨城样章',
      sourceType: 'chapterSample',
      rights: 'owned',
      enabled: true,
      chapterCount: 3,
      structureConfidence: 'high',
      deconstructionStatus: 'notAnalyzed',
      contextEligible: false,
      readinessReason: 'notAnalyzed',
    });
    expect(result.createdFiles).toContain('examples/README.md');
    expect(result.createdFiles).toContain(`examples/references/${result.reference.id}/context/reference-summary.md`);
    expect(result.createdFiles).toContain(`examples/references/${result.reference.id}/distilled/do-not-copy.md`);
    expect(result.createdFiles).toContain(`examples/references/${result.reference.id}/deconstruction-manifest.yaml`);
    expect(result.createdFiles).toContain(`examples/references/${result.reference.id}/diagnostics.yaml`);
    expect(result.createdFiles).not.toContain(`examples/references/${result.reference.id}/deconstruction/quick-preview.md`);

    const sourceManifest = parse(await readFile(
      join(workspaceRoot, result.reference.bundlePath, 'sources', 'source-manifest.yaml'),
      'utf-8',
    )) as { detectedStructure: { chapterCount: number; confidence: string } };
    expect(sourceManifest.detectedStructure.chapterCount).toBe(3);
    expect(sourceManifest.detectedStructure.confidence).toBe('high');

    const original = await readFile(
      join(workspaceRoot, result.reference.bundlePath, 'sources', 'original.txt'),
      'utf-8',
    );
    expect(original).toContain('苏灵推开门。');

    const summary = await readFile(
      join(workspaceRoot, result.reference.summaryPath),
      'utf-8',
    );
    expect(summary).toContain('Not analyzed');
    expect(summary).toContain('Context eligible: no');
  });

  it('keeps enabled separate from context eligibility and omits unanalyzed references', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-'));
    const first = await importReferenceWork({
      workspaceRoot,
      title: 'Enabled Reference',
      sourceText: 'Chapter 1\nA short sample.',
    });
    const second = await importReferenceWork({
      workspaceRoot,
      title: 'Disabled Reference',
      sourceText: 'Chapter 1\nAnother short sample.',
    });

    await setReferenceEnabled(workspaceRoot, second.reference.id, false);

    const references = await listReferenceWorks(workspaceRoot);
    expect(references).toHaveLength(2);
    expect(references.find((item) => item.id === second.reference.id)?.enabled).toBe(false);

    const selection = await selectReferenceContext({
      workspaceRoot,
      capability: 'novel.write_chapter',
      goal: 'continue rain-city pacing',
      tokenBudget: 2_000,
    });
    expect(selection.included).toEqual([]);
    expect(selection.originalSourceRead).toBe(false);
    expect(selection.noCopyWarnings.join('\n')).toContain('do not copy');
    expect(selection.omitted).toContainEqual(expect.objectContaining({
      referenceId: first.reference.id,
      reasonCode: 'notAnalyzed',
      deconstructionStatus: 'notAnalyzed',
      contextEligible: false,
    }));
    expect(selection.omitted).toContainEqual({
      scope: 'reference',
      referenceId: second.reference.id,
      referenceTitle: 'Disabled Reference',
      reason: 'disabled',
      budgetLayer: 'L3',
      deconstructionStatus: 'notAnalyzed',
      contextEligible: false,
      reasonCode: 'disabled',
    });

    const contextSources = referenceSelectionToContextSources(selection);
    expect(contextSources.selected).toEqual([]);
    expect(contextSources.omitted[0]).toMatchObject({
      sourceId: 'referenceDistilled',
      semanticBoundary: 'excluded',
    });
    expect(formatReferenceContextSelectionMarkdown(selection)).toContain('Original source read: no');
  });

  it('imports a local source path and records checksum metadata', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-'));
    const sourcePath = join(workspaceRoot, 'sample-reference.md');
    await writeFile(sourcePath, '# Chapter 1\nA clean imported file.', 'utf-8');

    const result = await importReferenceWork({
      workspaceRoot,
      title: 'Markdown Sample',
      sourcePath,
      rights: 'licensed',
      enabled: false,
    });

    expect(result.reference.enabled).toBe(false);
    expect(result.reference.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.manifest.originalFile).toBe('original.md');
    expect(result.manifest.sourcePath).toBe(sourcePath);

    const metadata = parse(await readFile(
      join(workspaceRoot, result.reference.bundlePath, 'metadata.yaml'),
      'utf-8',
    )) as { rights: string; enabled: boolean; sourcePath: string };
    expect(metadata).toMatchObject({
      rights: 'licensed',
      enabled: false,
      sourcePath,
    });
  });

  it('does not retain stale published context when readiness is no longer completed', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-'));
    const imported = await importReferenceWork({
      workspaceRoot,
      title: 'Stale Published Context',
      sourceText: 'Chapter 1\nA bounded sample.',
    });
    const indexPath = join(workspaceRoot, 'examples', 'references.yaml');
    const injectPublishedContext = async () => {
      const index = parse(await readFile(indexPath, 'utf-8')) as {
        references: Array<Record<string, unknown>>;
      };
      Object.assign(index.references[0]!, {
        deconstructionStatus: 'completed',
        publishedContext: {
          runId: 'old-published-run',
          fingerprint: 'a'.repeat(64),
          entryCount: 5,
          categoryCounts: {
            writingStyle: 1,
            pacing: 1,
            hooks: 1,
            scene: 1,
            character: 1,
          },
        },
      });
      await writeFile(indexPath, stringify(index), 'utf-8');
    };

    await injectPublishedContext();
    const disabled = await setReferenceEnabled(
      workspaceRoot,
      imported.reference.id,
      false,
    );
    expect(disabled.deconstructionStatus).toBe('notAnalyzed');
    expect(disabled).not.toHaveProperty('publishedContext');
    const persisted = parse(await readFile(indexPath, 'utf-8')) as {
      references: Array<Record<string, unknown>>;
    };
    expect(persisted.references[0]).not.toHaveProperty('publishedContext');

    await injectPublishedContext();
    const metadataPath = join(
      workspaceRoot,
      imported.reference.bundlePath,
      'metadata.yaml',
    );
    const metadata = parse(await readFile(metadataPath, 'utf-8')) as {
      checksumSha256: string;
    };
    metadata.checksumSha256 = 'f'.repeat(64);
    await writeFile(metadataPath, stringify(metadata), 'utf-8');
    const listed = await listReferenceWorks(workspaceRoot);
    expect(listed[0]?.deconstructionStatus).toBe('stale');
    expect(listed[0]).not.toHaveProperty('publishedContext');
  });

  it('does not reuse orphan bundles or write through a references parent symlink', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-'));
    const sourceText = 'Chapter 1\nA filesystem collision must not be overwritten.';
    const baseId = `orphan-bundle-${createHash('sha256')
      .update(sourceText)
      .digest('hex')
      .slice(0, 8)}`;
    const orphanRoot = join(workspaceRoot, 'examples', 'references', baseId);
    await mkdir(orphanRoot, { recursive: true });
    await writeFile(join(orphanRoot, 'sentinel.txt'), 'preserve me', 'utf-8');

    const imported = await importReferenceWork({
      workspaceRoot,
      title: 'Orphan Bundle',
      sourceText,
    });
    expect(imported.reference.id).toBe(`${baseId}-2`);
    await expect(readFile(join(orphanRoot, 'sentinel.txt'), 'utf-8'))
      .resolves.toBe('preserve me');

    const symlinkWorkspace = await mkdtemp(join(tmpdir(), 'oan-reference-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'oan-reference-outside-'));
    await symlink(outsideRoot, join(symlinkWorkspace, 'examples'), 'dir');
    await expect(importReferenceWork({
      workspaceRoot: symlinkWorkspace,
      title: 'Unsafe Parent',
      sourceText: 'Chapter 1\nDo not write outside.',
    })).rejects.toThrow('safe directory');
  });
});
