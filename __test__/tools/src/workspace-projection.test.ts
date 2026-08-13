import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WorkspaceProjectionDriftError,
  createWorkspaceProjection,
} from '@oh-awesome-novel/tools';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('workspace projection', () => {
  it('creates a fixed UTF-8 snapshot without exposing ignored or internal host files', async () => {
    const root = await workspace({
      'chapters/第一 章.md': '# 第一章\n',
      'chapters/nested/scene.md': 'before\n',
      'characters/ignored.md': 'not selected\n',
      '.git/config': 'secret\n',
      '.workspace/private.txt': 'secret\n',
      '.oan/constitution/rules.md': '# Rules\n',
      '.oan/config.yaml': 'apiKey: secret\n',
    });
    const canonicalBefore = await readFile(join(root, 'chapters/第一 章.md'));

    const projection = await createWorkspaceProjection({
      workspaceRoot: root,
      rules: [
        { kind: 'prefix', path: 'chapters' },
        { kind: 'prefix', path: '.oan/constitution' },
      ],
    });

    await expect(projection.fs.readFile('/workspace/chapters/第一 章.md')).resolves.toBe('# 第一章\n');
    await expect(projection.fs.readFile('/workspace/.oan/constitution/rules.md')).resolves.toBe('# Rules\n');
    await expect(projection.fs.exists('/workspace/characters/ignored.md')).resolves.toBe(false);
    await expect(projection.fs.exists('/workspace/.git/config')).resolves.toBe(false);
    expect(projection.manifest.files.map((file) => file.path)).toEqual([
      '.oan/constitution/rules.md',
      'chapters/nested/scene.md',
      'chapters/第一 章.md',
    ]);
    expect(projection.fingerprint).toMatch(/^[0-9a-f]{64}$/u);

    await projection.fs.writeFile('/workspace/chapters/第一 章.md', '# virtual only\n');
    expect(await readFile(join(root, 'chapters/第一 章.md'))).toEqual(canonicalBefore);
    await expect(projection.recheck()).resolves.toMatchObject({ fresh: true });
  });

  it('detects host create, update, delete and unsafe replacement drift', async () => {
    const root = await workspace({ 'chapters/a.md': 'one\n' });
    const projection = await createWorkspaceProjection({
      workspaceRoot: root,
      rules: [{ kind: 'prefix', path: 'chapters' }],
    });

    await writeFile(join(root, 'chapters/a.md'), 'two\n');
    await writeFile(join(root, 'chapters/new.md'), 'new\n');
    const drift = await projection.recheck();
    expect(drift).toMatchObject({ fresh: false });
    expect(drift.driftedPaths).toEqual(['chapters/a.md', 'chapters/new.md']);
    await expect(projection.assertFresh()).rejects.toBeInstanceOf(WorkspaceProjectionDriftError);

    await rm(join(root, 'chapters/a.md'));
    await symlink('/etc/passwd', join(root, 'chapters/a.md'));
    await expect(projection.recheck()).resolves.toMatchObject({
      fresh: false,
      errorCode: 'UNSAFE_HOST_PROJECTION',
    });
  });

  it('rejects symlinks, hard links, invalid UTF-8, NUL, oversized files and non-NFC paths', async () => {
    const symlinkRoot = await workspace({ 'outside.md': 'outside\n' });
    await mkdir(join(symlinkRoot, 'chapters'), { recursive: true });
    await symlink('../outside.md', join(symlinkRoot, 'chapters/link.md'));
    await expect(createWorkspaceProjection({
      workspaceRoot: symlinkRoot,
      rules: [{ kind: 'prefix', path: 'chapters' }],
    })).rejects.toThrow('symbolic link');

    const hardLinkRoot = await workspace({ 'chapters/a.md': 'same\n' });
    await link(join(hardLinkRoot, 'chapters/a.md'), join(hardLinkRoot, 'chapters/b.md'));
    await expect(createWorkspaceProjection({
      workspaceRoot: hardLinkRoot,
      rules: [{ kind: 'prefix', path: 'chapters' }],
    })).rejects.toThrow('hard-linked');

    const binaryRoot = await workspace({});
    await mkdir(join(binaryRoot, 'chapters'), { recursive: true });
    await writeFile(join(binaryRoot, 'chapters/binary.md'), Buffer.from([0xff, 0xfe]));
    await expect(createWorkspaceProjection({
      workspaceRoot: binaryRoot,
      rules: [{ kind: 'prefix', path: 'chapters' }],
    })).rejects.toThrow('valid UTF-8');

    const nulRoot = await workspace({ 'chapters/nul.md': 'before\0after' });
    await expect(createWorkspaceProjection({
      workspaceRoot: nulRoot,
      rules: [{ kind: 'prefix', path: 'chapters' }],
    })).rejects.toThrow('NUL');

    const largeRoot = await workspace({ 'chapters/large.md': '12345' });
    await expect(createWorkspaceProjection({
      workspaceRoot: largeRoot,
      rules: [{ kind: 'prefix', path: 'chapters' }],
      maxFileBytes: 4,
      maxTotalBytes: 4,
    })).rejects.toThrow('file size limit');

    const unicodeRoot = await workspace({ 'chapters/e\u0301.md': 'text\n' });
    await expect(createWorkspaceProjection({
      workspaceRoot: unicodeRoot,
      rules: [{ kind: 'prefix', path: 'chapters' }],
    })).rejects.toThrow(/NFC/u);
  });

  it('rejects internal projection rules before touching their contents', async () => {
    const root = await workspace({ '.git/config': 'secret\n' });
    await expect(createWorkspaceProjection({
      workspaceRoot: root,
      rules: [{ kind: 'prefix', path: '.git' }],
    })).rejects.toThrow('Internal path');
    await expect(createWorkspaceProjection({
      workspaceRoot: root,
      rules: [{ kind: 'exact', path: '.oan/config.yaml' }],
    })).rejects.toThrow('Private .oan');
  });
});

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-projection-'));
  temporaryRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, content);
  }
  return root;
}
