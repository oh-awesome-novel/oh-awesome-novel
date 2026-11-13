import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  addPortraitImage, assertImageAssetPath, deleteUnreferencedImageAsset, detectImageAssetMime, IMAGE_ASSET_MAX_BYTES,
  initWorkspace, isImageAssetPath, listPortraitImages, listUnreferencedImageAssets, readImageAsset,
} from '@oh-awesome-novel/core';

const execFileAsync = promisify(execFile);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6kAAAAASUVORK5CYII=', 'base64');
const OTHER_PNG = Buffer.concat([PNG, Buffer.from([0])]);
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-assets-'));
  roots.push(root);
  return root;
}

describe('image asset directory', () => {
  it('keeps the asset folder out of Git in a new workspace', async () => {
    const root = await tempRoot();
    const workspace = join(root, 'novel');
    await mkdir(workspace);
    await initWorkspace(workspace, { globalConfigDir: join(root, 'global'), saveToWorkspaceList: false });
    expect((await readFile(join(workspace, '.gitignore'), 'utf8')).split('\n')).toContain('/assets/');

    await execFileAsync('git', ['-C', workspace, 'init', '-q']);
    const before = (await execFileAsync('git', ['-C', workspace, 'status', '--porcelain', '--untracked-files=all'])).stdout;
    const { image } = await addPortraitImage(workspace, { characterId: 'nian', fileName: 'normal.png', bytes: PNG });
    expect(image).toEqual({ path: 'assets/portraits/nian/normal.png', name: 'normal.png', bytes: PNG.length, mime: 'image/png' });
    const after = (await execFileAsync('git', ['-C', workspace, 'status', '--porcelain', '--untracked-files=all'])).stdout;
    expect(after).toBe(before);
    expect(after).not.toContain('assets');
  });

  it('never overwrites: a taken name is renamed and identical bytes are reused', async () => {
    const root = await tempRoot();
    const first = await addPortraitImage(root, { characterId: 'nian', fileName: 'normal.png', bytes: PNG });
    const sameName = await addPortraitImage(root, { characterId: 'nian', fileName: 'normal.png', bytes: OTHER_PNG });
    expect(first.reused).toBe(false);
    expect(sameName).toMatchObject({ reused: false, image: { path: 'assets/portraits/nian/normal-2.png' } });
    expect(await readFile(join(root, 'assets/portraits/nian/normal.png'))).toEqual(PNG);

    // The same bytes under another name: no third file.
    const sameBytes = await addPortraitImage(root, { characterId: 'nian', fileName: 'copy.png', bytes: PNG });
    expect(sameBytes).toMatchObject({ reused: true, image: { path: 'assets/portraits/nian/normal.png' } });
    expect((await readdir(join(root, 'assets/portraits/nian'))).sort()).toEqual(['normal-2.png', 'normal.png']);
    // Another character's folder is its own.
    expect((await addPortraitImage(root, { characterId: 'lu', fileName: 'normal.png', bytes: PNG })).reused).toBe(false);

    expect((await listPortraitImages(root, 'nian')).map(item => item.path)).toEqual([
      'assets/portraits/nian/normal-2.png', 'assets/portraits/nian/normal.png',
    ]);
    expect(await listPortraitImages(root, 'nobody')).toEqual([]);
  });

  it('stores ASCII names and reads the original bytes back', async () => {
    const root = await tempRoot();
    const stored = await addPortraitImage(root, { characterId: 'nian', fileName: 'C:\\图 片\\生气 (final).JPG', bytes: JPEG });
    expect(stored.image.path).toBe('assets/portraits/nian/final.jpg');
    expect((await addPortraitImage(root, { characterId: 'nian', fileName: '立绘.webp', bytes: WEBP })).image.path).toBe('assets/portraits/nian/image.webp');
    const content = await readImageAsset(root, stored.image.path);
    expect(content.mime).toBe('image/jpeg');
    expect(content.bytes).toEqual(JPEG);
    expect(content.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects what is not a matching, bounded raster image and says why', async () => {
    const root = await tempRoot();
    const add = (fileName: string, bytes: Uint8Array, characterId = 'nian') => addPortraitImage(root, { characterId, fileName, bytes });
    await expect(add('notes.txt', Buffer.from('hello'))).rejects.toMatchObject({ code: 'unsupported_type' });
    await expect(add('fake.png', Buffer.from('not an image'))).rejects.toMatchObject({ code: 'unsupported_type' });
    await expect(add('wrong.png', JPEG)).rejects.toMatchObject({ code: 'signature_mismatch', message: expect.stringContaining('JPEG') });
    await expect(add('empty.png', Buffer.alloc(0))).rejects.toMatchObject({ code: 'empty' });
    await expect(add('huge.png', Buffer.concat([PNG, Buffer.alloc(IMAGE_ASSET_MAX_BYTES)]))).rejects.toMatchObject({ code: 'too_large' });
    await expect(add('a.png', PNG, '../escape')).rejects.toMatchObject({ code: 'invalid_character' });
    await expect(add('a.png', PNG, '.hidden')).rejects.toMatchObject({ code: 'invalid_character' });
    await expect(readdir(join(root, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' });

    for (const path of ['assets/../secret.png', '/assets/a.png', 'assets/.hidden/a.png', 'assets/a/.b.png', 'world/places/inn.png',
      'assets/a.gif', 'assets/a b.png', 'assets\\a.png', 'assets/a..png', 'assets']) {
      expect(isImageAssetPath(path), path).toBe(false);
      await expect(readImageAsset(root, path)).rejects.toMatchObject({ code: 'invalid_path' });
    }
    expect(assertImageAssetPath('assets/portraits/nian/normal.v2.PNG')).toBe('assets/portraits/nian/normal.v2.PNG');
    expect(detectImageAssetMime(WEBP)).toBe('image/webp');
    expect(detectImageAssetMime(Buffer.from('GIF89a'))).toBeUndefined();
  });

  it('refuses symbolic links, hard links and damaged files when reading', async () => {
    const root = await tempRoot();
    await addPortraitImage(root, { characterId: 'nian', fileName: 'normal.png', bytes: PNG });
    const directory = join(root, 'assets/portraits/nian');
    await writeFile(join(root, 'outside.png'), PNG);
    await symlink(join(root, 'outside.png'), join(directory, 'linked.png'));
    await link(join(root, 'outside.png'), join(directory, 'hard.png'));
    await writeFile(join(directory, 'broken.png'), 'damaged');
    await writeFile(join(directory, 'renamed.png'), JPEG);
    await expect(readImageAsset(root, 'assets/portraits/nian/linked.png')).rejects.toMatchObject({ code: 'unsafe_file' });
    await expect(readImageAsset(root, 'assets/portraits/nian/hard.png')).rejects.toMatchObject({ code: 'unsafe_file' });
    await expect(readImageAsset(root, 'assets/portraits/nian/broken.png')).rejects.toMatchObject({ code: 'unsupported_type' });
    await expect(readImageAsset(root, 'assets/portraits/nian/renamed.png')).rejects.toMatchObject({ code: 'signature_mismatch' });
    await expect(readImageAsset(root, 'assets/portraits/nian/gone.png')).rejects.toMatchObject({ code: 'missing', message: expect.stringContaining('不随 Git') });

    // A listing describes broken files instead of failing.
    const listed = await listPortraitImages(root, 'nian');
    expect(listed.find(item => item.name === 'normal.png')).toMatchObject({ mime: 'image/png' });
    expect(listed.find(item => item.name === 'broken.png')).toMatchObject({ problem: expect.stringContaining('损坏') });
    expect(listed.find(item => item.name === 'linked.png')?.problem).toBeTruthy();

    // A symlinked asset folder is never followed, for reading or for writing.
    const other = await tempRoot();
    await mkdir(join(other, 'elsewhere'));
    await symlink(join(other, 'elsewhere'), join(other, 'assets'));
    await expect(addPortraitImage(other, { characterId: 'nian', fileName: 'a.png', bytes: PNG })).rejects.toMatchObject({ code: 'unsafe_file' });
    expect(await readdir(join(other, 'elsewhere'))).toEqual([]);
  });

  it('lists images no formal file mentions and deletes only those', async () => {
    const root = await tempRoot();
    const used = await addPortraitImage(root, { characterId: 'nian', fileName: 'normal.png', bytes: PNG });
    const unused = await addPortraitImage(root, { characterId: 'nian', fileName: 'angry.png', bytes: OTHER_PNG });
    await mkdir(join(root, 'characters/nian'), { recursive: true });
    await writeFile(join(root, 'characters/nian/roster-profile.yaml'), `id: nian\nlooks:\n  refImagePath: ${used.image.path}\n`);
    // A mention outside the formal folders is not a reference.
    await mkdir(join(root, '.workspace'), { recursive: true });
    await writeFile(join(root, '.workspace/notes.md'), unused.image.path);

    expect((await listUnreferencedImageAssets(root)).map(item => item.path)).toEqual([unused.image.path]);
    await expect(deleteUnreferencedImageAsset(root, used.image.path)).rejects.toMatchObject({ code: 'referenced' });
    await deleteUnreferencedImageAsset(root, unused.image.path);
    await expect(deleteUnreferencedImageAsset(root, unused.image.path)).rejects.toMatchObject({ code: 'missing' });
    expect(await readdir(join(root, 'assets/portraits/nian'))).toEqual(['normal.png']);
    expect(await listUnreferencedImageAssets(root)).toEqual([]);
    expect(await listUnreferencedImageAssets(await tempRoot())).toEqual([]);
  });
});
