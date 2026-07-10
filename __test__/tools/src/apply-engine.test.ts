import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  previewSemanticPatches,
  validateSemanticPatch,
} from '@oh-awesome-novel/tools';
import type {
  ApplyPreviewResult,
  SemanticPatch,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('SemanticPatch Apply Engine preview', () => {
  it('previews a collection yamlSet patch without writing the target file', async () => {
    const workspaceRoot = await createWorkspace();

    const result = await previewSemanticPatches({
      workspaceRoot,
      patches: [{
        kind: 'collection',
        domain: 'state',
        file: 'characters.yaml',
        operation: 'yamlSet',
        path: 'characters.heroine.status',
        value: 'injured',
      }],
    });

    expect(result.touchedFiles).toEqual(['state/characters.yaml']);
    expect(result.diff).toContain('+    status: injured');
    expect(result.shadowWrites[0]).toMatchObject({
      targetFile: 'state/characters.yaml',
      targetExisted: true,
      originalHash: sha256(`characters:\n  heroine:\n    hp: normal\n`),
      draftHash: sha256(result.candidates[0].draft),
    });
    await expect(readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'))
      .resolves
      .not.toContain('status: injured');
    await expect(readFile(join(workspaceRoot, result.shadowWrites[0].shadowFile), 'utf-8'))
      .resolves
      .toContain('status: injured');
  });

  it('previews an object Markdown section patch without writing the target file', async () => {
    const workspaceRoot = await createWorkspace();

    const result = await previewSemanticPatches({
      workspaceRoot,
      patches: [{
        kind: 'object',
        domain: 'character',
        entityId: 'heroine',
        file: 'personality.md',
        operation: 'replaceSection',
        selector: { section: '外在人格' },
        value: '她在人前更加冷淡克制。',
      }],
    });

    expect(result.touchedFiles).toEqual(['characters/heroine/personality.md']);
    expect(result.diff).toContain('+她在人前更加冷淡克制。');
    await expect(readFile(join(workspaceRoot, 'characters/heroine/personality.md'), 'utf-8'))
      .resolves
      .toContain('冷淡克制。');
    await expect(readFile(join(workspaceRoot, result.shadowWrites[0].shadowFile), 'utf-8'))
      .resolves
      .toContain('更加冷淡克制');
  });

  it('previews narrative scene and chunk patches without writing the chapter', async () => {
    const workspaceRoot = await createWorkspace();

    const result = await previewSemanticPatches({
      workspaceRoot,
      patches: [
        {
          kind: 'narrative',
          domain: 'chapter',
          file: '0001/0001.md',
          operation: 'replaceScene',
          selector: { scene: 'Scene A' },
          value: `她发现雨停在半空。\n\n<!-- chunk:beat-1 -->\n她松开伞柄。\n<!-- /chunk:beat-1 -->`,
        },
        {
          kind: 'narrative',
          domain: 'chapter',
          file: '0001/0001.md',
          operation: 'replaceChunk',
          selector: { chunkId: 'beat-1' },
          value: '她握紧伞柄。',
        },
      ],
    });

    expect(result.touchedFiles).toEqual(['chapters/0001/0001.md']);
    expect(result.diff).toContain('+她发现雨停在半空。');
    expect(result.diff).toContain('+她握紧伞柄。');
    await expect(readFile(join(workspaceRoot, 'chapters/0001/0001.md'), 'utf-8'))
      .resolves
      .toContain('雨还在下。');
    await expect(readFile(join(workspaceRoot, result.shadowWrites[0].shadowFile), 'utf-8'))
      .resolves
      .toContain('她握紧伞柄。');
  });

  it('rejects patch targets that point at hidden workspace paths', async () => {
    const workspaceRoot = await createWorkspace();

    await expect(previewSemanticPatches({
      workspaceRoot,
      patches: [{
        kind: 'collection',
        domain: 'state',
        file: '../.workspace/escape.yaml',
        operation: 'yamlSet',
        path: 'x',
        value: true,
      }],
    })).rejects.toThrow(/Invalid workspace relative path/);
  });

  it('uses distinct canonical shadow paths for Unicode and punctuation targets', async () => {
    const workspaceRoot = await createWorkspace();
    const result = await previewSemanticPatches({
      workspaceRoot,
      id: 'ap_unicode_paths',
      patches: [
        objectReplaceFile('甲!.md', '甲内容'),
        objectReplaceFile('乙?.md', '乙内容'),
      ],
    });

    expect(new Set(result.shadowWrites.map((write) => write.shadowFile)).size).toBe(2);
    expect(result.shadowWrites.map((write) => write.targetFile)).toEqual([
      'characters/heroine/甲!.md',
      'characters/heroine/乙?.md',
    ]);
    await expect(readFile(join(workspaceRoot, result.shadowWrites[0].shadowFile), 'utf-8'))
      .resolves.toBe('甲内容\n');
    await expect(readFile(join(workspaceRoot, result.shadowWrites[1].shadowFile), 'utf-8'))
      .resolves.toBe('乙内容\n');
  });

  it('rejects prototype-chain segments in frontmatter and collection paths', async () => {
    const workspaceRoot = await createWorkspace();
    const polluted = Object.prototype as Record<string, unknown>;

    await expect(previewSemanticPatches({
      workspaceRoot,
      patches: [{
        kind: 'object',
        domain: 'character',
        entityId: 'heroine',
        file: 'personality.md',
        operation: 'frontmatterSet',
        selector: { path: '__proto__.oanPolluted' },
        value: true,
      }],
    })).rejects.toThrow(/forbidden segment/);
    await expect(previewSemanticPatches({
      workspaceRoot,
      patches: [{
        kind: 'collection',
        domain: 'state',
        file: 'characters.yaml',
        operation: 'yamlSet',
        path: 'constructor.prototype.oanPolluted',
        value: true,
      }],
    })).rejects.toThrow(/forbidden segment/);
    expect(polluted.oanPolluted).toBeUndefined();
  });

  it('validates operation-specific values, selectors, paths, patch lists, and ids', async () => {
    const invalidPatches: Array<[unknown, RegExp]> = [
      [{
        kind: 'object', domain: 'character', entityId: 'heroine', file: 'x.md',
        operation: 'replaceFile',
      }, /replaceFile value/],
      [{
        kind: 'object', domain: 'character', entityId: 'heroine', file: 'x.md',
        operation: 'replaceFile', value: null,
      }, /replaceFile value/],
      [{
        kind: 'object', domain: 'character', entityId: 'heroine', file: 'x.md',
        operation: 'replaceBlock', value: 'x',
      }, /selector\.block/],
      [{
        kind: 'collection', domain: 'state', file: 'x.yaml', operation: 'yamlSet',
        path: 'x',
      }, /yamlSet value/],
      [{
        kind: 'collection', domain: 'state', file: 'x.yaml', operation: 'yamlMove',
        path: 'x', value: { to: '' },
      }, /destination is required/],
      [{
        kind: 'narrative', domain: 'chapter', file: '0001/x.md',
        operation: 'appendScene',
      }, /appendScene value/],
      [{
        kind: 'narrative', domain: 'chapter', file: '0001/x.md',
        operation: 'replaceScene', value: 'x',
      }, /selector\.scene/],
    ];

    for (const [patch, message] of invalidPatches) {
      expect(() => validateSemanticPatch(patch as SemanticPatch)).toThrow(message);
    }

    expect(() => validateSemanticPatch({
      kind: 'object',
      domain: 'character',
      entityId: 'heroine',
      file: 'personality.md',
      operation: 'frontmatterDelete',
      selector: { path: 'metadata.legacy' },
    })).not.toThrow();

    const workspaceRoot = await createWorkspace();
    await expect(previewSemanticPatches({ workspaceRoot, patches: [] }))
      .rejects.toThrow(/At least one/);
    await expect(previewSemanticPatches({
      workspaceRoot,
      id: '../escape',
      patches: [objectReplaceFile('safe.md', 'safe')],
    })).rejects.toThrow(/Invalid ApplyPreview id/);
  });

  it('returns an empty diff for an exact no-op', async () => {
    const workspaceRoot = await createWorkspace();
    const original = await readFile(
      join(workspaceRoot, 'characters/heroine/personality.md'),
      'utf-8',
    );
    const result = await previewSemanticPatches({
      workspaceRoot,
      patches: [objectReplaceFile('personality.md', original)],
    });

    expect(result.diff).toBe('');
    expect(result.candidates[0]).toMatchObject({
      targetExisted: true,
      originalHash: sha256(original),
      draftHash: sha256(original),
    });
  });

  it('generates a git-applicable round-trip diff for edits, creation, emptying, blank lines, and final-newline changes', async () => {
    const workspaceRoot = await createWorkspace();
    await writeFileTree(workspaceRoot, {
      'characters/heroine/清 单!.md': '旧行\n\n保留行\n',
      'world/city/note.md': '没有结尾换行',
      'summaries/empty-me.md': '删除这一行\n',
    });
    const result = await previewSemanticPatches({
      workspaceRoot,
      patches: [
        objectReplaceFile('清 单!.md', '新行\n\n保留行'),
        {
          kind: 'object', domain: 'world', entityId: 'city', file: 'note.md',
          operation: 'replaceFile', value: '现在有结尾换行',
        },
        {
          kind: 'narrative', domain: 'summary', file: 'empty-me.md',
          operation: 'replaceFile', value: '',
        },
        {
          kind: 'narrative', domain: 'chapter', file: '0001/新 场景!.md',
          operation: 'replaceFile', value: '# 新场景\n\n内容。',
        },
      ],
    });

    expect(result.diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(result.diff).toContain('\\ No newline at end of file');
    await expectDiffRoundTrip(workspaceRoot, result);
  });
});

function objectReplaceFile(file: string, value: string): SemanticPatch {
  return {
    kind: 'object',
    domain: 'character',
    entityId: 'heroine',
    file,
    operation: 'replaceFile',
    value,
  };
}

async function expectDiffRoundTrip(
  workspaceRoot: string,
  result: ApplyPreviewResult,
): Promise<void> {
  const patchFile = join(workspaceRoot, '.workspace', `${result.id}.diff`);
  await writeFile(patchFile, result.diff, 'utf-8');
  await execFileAsync('git', ['init', '-q'], { cwd: workspaceRoot });
  await execFileAsync('git', ['apply', '--check', patchFile], { cwd: workspaceRoot });
  await execFileAsync('git', ['apply', patchFile], { cwd: workspaceRoot });

  for (const candidate of result.candidates) {
    await expect(readFile(join(workspaceRoot, candidate.targetFile), 'utf-8'))
      .resolves.toBe(candidate.draft);
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-apply-engine-'));
  tempRoots.push(workspaceRoot);
  await writeFileTree(workspaceRoot, {
    'state/characters.yaml': `characters:\n  heroine:\n    hp: normal\n`,
    'characters/heroine/personality.md': `# 外在人格\n\n冷淡克制。\n\n# 内在人格\n\n温柔但隐藏。\n`,
    'chapters/0001/0001.md': `# Chapter 1\n\n## Scene A\n\n雨还在下。\n\n<!-- chunk:beat-1 -->\n她松开伞柄。\n<!-- /chunk:beat-1 -->\n`,
  });
  return workspaceRoot;
}

async function writeFileTree(root: string, files: Record<string, string>): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await Promise.all(Object.entries(files).map(async ([file, content]) => {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }));
}
