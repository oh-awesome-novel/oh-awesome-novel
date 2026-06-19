import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  importReferenceWork,
  listReferenceWorks,
  selectReferenceContext,
  setReferenceEnabled,
} from '@oh-awesome-novel/core';

describe('reference work import', () => {
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
    });
    expect(result.createdFiles).toContain('examples/README.md');
    expect(result.createdFiles).toContain(`examples/references/${result.reference.id}/context/reference-summary.md`);
    expect(result.createdFiles).toContain(`examples/references/${result.reference.id}/distilled/do-not-copy.md`);

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
    expect(summary).toContain('Original source is retained');
    expect(summary).toContain('not read by default');
  });

  it('lists references and omits disabled references from selected context', async () => {
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

    const selection = await selectReferenceContext({ workspaceRoot, tokenBudget: 2_000 });
    expect(selection.included.map((item) => item.id)).toEqual([first.reference.id]);
    expect(selection.included[0]?.reason).toContain('original source not read');
    expect(selection.omitted).toContainEqual({
      id: second.reference.id,
      title: 'Disabled Reference',
      reason: 'disabled',
    });
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
});
