import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createWorkspaceChangePolicy, createWorkspaceProjection, ensureGitLocalExclude, readGitStatus } from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-asset-boundary-'));
  roots.push(root);
  return root;
}
async function write(root: string, path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

describe('image assets stay outside Git and the change engine', () => {
  it('ignores the asset folder locally in an existing workspace without touching .gitignore', async () => {
    const root = await workspace();
    await execFileAsync('git', ['-C', root, 'init', '-q', '-b', 'main']);
    await write(root, '.gitignore', '.workspace/\n');
    await write(root, 'assets/portraits/nian/normal.png', new Uint8Array([137, 80, 78, 71]));
    expect((await readGitStatus(root)).files.map(file => file.path)).toContain('assets/portraits/nian/normal.png');

    expect(await ensureGitLocalExclude(root, '/assets/', 'assets/probe.png')).toBe('added');
    expect(await ensureGitLocalExclude(root, '/assets/', 'assets/probe.png')).toBe('ignored');
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('.workspace/\n');
    expect((await readFile(join(root, '.git/info/exclude'), 'utf8')).match(/^\/assets\/$/gm)).toHaveLength(1);
    expect((await readGitStatus(root)).files.map(file => file.path)).toEqual(['.gitignore']);
  });

  it('leaves a workspace that already ignores the folder, or has no repository, alone', async () => {
    const ignored = await workspace();
    await execFileAsync('git', ['-C', ignored, 'init', '-q', '-b', 'main']);
    await write(ignored, '.gitignore', '/assets/\n');
    const exclude = await readFile(join(ignored, '.git/info/exclude'), 'utf8').catch(() => '');
    expect(await ensureGitLocalExclude(ignored, '/assets/', 'assets/probe.png')).toBe('ignored');
    expect(await readFile(join(ignored, '.git/info/exclude'), 'utf8').catch(() => '')).toBe(exclude);

    const plain = await workspace();
    expect(await ensureGitLocalExclude(plain, '/assets/', 'assets/probe.png')).toBe('not_repository');
    // A folder inside someone else's repository is not this workspace's repository.
    const nested = join(ignored, 'nested');
    await mkdir(nested);
    expect(await ensureGitLocalExclude(nested, '/assets/', 'assets/probe.png')).toBe('not_repository');
    await expect(ensureGitLocalExclude(plain, 'assets/*\n!x', 'assets/probe.png')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('never projects the asset folder to the model', async () => {
    const root = await workspace();
    await write(root, 'characters/nian/profile.md', '# 念念\n');
    await write(root, 'assets/portraits/nian/normal.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    await write(root, 'assets/notes.md', 'not novel content\n');
    const policy = createWorkspaceChangePolicy({ capability: 'read-only' });
    const projection = await createWorkspaceProjection({ workspaceRoot: root, rules: policy.readable });
    expect(projection.manifest.files.map(file => file.path)).toEqual(['characters/nian/profile.md']);
    expect(projection.baselineFiles.map(file => file.path)).toEqual(['characters/nian/profile.md']);
    expect(JSON.stringify(projection.manifest)).not.toContain('assets');
    // No capability can be widened to write there either.
    for (const capability of ['novel.multi-file-edit', 'character.edit'] as const) {
      expect(() => createWorkspaceChangePolicy({ capability, writablePrefixes: ['assets'] })).toThrow();
      expect(() => createWorkspaceChangePolicy({ capability, exactWritablePaths: ['assets/portraits/nian/normal.png'] })).toThrow();
    }
  });
});
