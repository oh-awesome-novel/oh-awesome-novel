import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import type { NovelHonoApp } from '@oh-awesome-novel/backend';

const git = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6kAAAAASUVORK5CYII=', 'base64');
const OTHER_PNG = Buffer.concat([PNG, Buffer.from([0])]);
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
const base = '/api/workspace/image-assets';
const PROFILE = 'id: nian\nname: 念念\naliases: []\ngenderKind: girl\nisPlayer: false\nlooks:\n  fixedBooruTags: ""\n  outfitDescription: ""\n  outfitTags: ""\n';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-image-assets-'));
  roots.push(root);
  await mkdir(join(root, '.oan'));
  await mkdir(join(root, 'characters/nian'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Test\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, 'characters/nian/roster-profile.yaml'), PROFILE);
  // An existing workspace: its .gitignore knows nothing about the asset folder.
  await writeFile(join(root, '.gitignore'), '.workspace/\n');
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, 'config', 'user.name', 'Test']);
  await git('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, 'commit', '-m', 'baseline']);
  return { root, app: createNovelHonoApp({ workspaceRoot: root }) };
}
function upload(app: NovelHonoApp, characterId: string, name: string, bytes: Uint8Array) {
  return app.request(`${base}/portraits/${characterId}?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
  });
}
async function status(root: string): Promise<string> {
  return (await git('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'])).stdout;
}

describe('image asset endpoints', () => {
  it('imports, lists and serves original images without touching Git, formal files or approvals', async () => {
    const { root, app } = await fixture();
    expect(await (await app.request(`${base}/portraits/nian`)).json()).toEqual({ directory: 'assets/portraits/nian', images: [] });

    const created = await upload(app, 'nian', '平常 normal.png', PNG);
    expect(created.status, await created.clone().text()).toBe(201);
    expect(await created.json()).toEqual({
      image: { path: 'assets/portraits/nian/normal.png', name: 'normal.png', bytes: PNG.length, mime: 'image/png' },
      reused: false,
      gitIgnored: true,
    });

    // Nothing for Git to see, the tracked .gitignore is untouched, and no approval state appeared.
    expect(await status(root)).toBe('');
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('.workspace/\n');
    expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toContain('/assets/\n');
    expect(await readFile(join(root, 'characters/nian/roster-profile.yaml'), 'utf8')).toBe(PROFILE);
    expect((await readdir(root)).sort()).toEqual(['.git', '.gitignore', '.oan', 'assets', 'characters']);
    const pending = await app.request('/api/workspace/pending-actions');
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ pendingActions: [] });

    // Same name, other bytes: a second file. Same bytes again: no new file.
    const renamed = await upload(app, 'nian', 'normal.png', OTHER_PNG);
    expect(renamed.status).toBe(201);
    expect((await renamed.json()).image.path).toBe('assets/portraits/nian/normal-2.png');
    const again = await upload(app, 'nian', 'again.png', PNG);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ reused: true, image: { path: 'assets/portraits/nian/normal.png' } });
    expect((await readdir(join(root, 'assets/portraits/nian'))).sort()).toEqual(['normal-2.png', 'normal.png']);

    const listed = await (await app.request(`${base}/portraits/nian`)).json();
    expect(listed.images.map((image: { path: string }) => image.path)).toEqual(['assets/portraits/nian/normal-2.png', 'assets/portraits/nian/normal.png']);

    const served = await app.request(`${base}/file?path=${encodeURIComponent('assets/portraits/nian/normal.png')}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe('no-store');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG);
    expect(await status(root)).toBe('');
  });

  it('rejects files that are not matching, bounded images and paths outside the folder', async () => {
    const { root, app } = await fixture();
    const reject = async (response: Response | Promise<Response>, code: number, errorCode: string) => {
      const resolved = await response;
      expect(resolved.status, await resolved.clone().text()).toBe(code);
      const body = await resolved.json();
      expect(body.code).toBe(errorCode);
      expect(typeof body.error).toBe('string');
    };
    await reject(upload(app, 'nian', 'notes.txt', Buffer.from('hello')), 415, 'unsupported_type');
    await reject(upload(app, 'nian', 'fake.png', Buffer.from('not an image')), 415, 'unsupported_type');
    await reject(upload(app, 'nian', 'wrong.png', JPEG), 415, 'signature_mismatch');
    await reject(upload(app, 'nian', 'empty.png', Buffer.alloc(0)), 400, 'empty');
    await reject(upload(app, 'nian', 'huge.png', Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)])), 413, 'too_large');
    await reject(upload(app, '.hidden', 'a.png', PNG), 400, 'invalid_character');
    await reject(app.request(`${base}/portraits/nian`, { method: 'POST', body: PNG }), 400, 'invalid_path');
    await reject(app.request(`${base}/portraits/nian?name=a.png&name=b.png`, { method: 'POST', body: PNG }), 400, 'invalid_path');
    for (const path of ['assets/../.oan/config.yaml', 'characters/nian/roster-profile.yaml', 'assets/.git/a.png', '/etc/passwd', 'assets/a.svg']) {
      await reject(app.request(`${base}/file?path=${encodeURIComponent(path)}`), 400, 'invalid_path');
      await reject(app.request(`${base}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }), 400, 'invalid_path');
    }
    await reject(app.request(`${base}/file`), 400, 'invalid_path');
    // Nothing was written by any rejected request.
    expect((await readdir(root)).sort()).toEqual(['.git', '.gitignore', '.oan', 'characters']);
    expect(await status(root)).toBe('');
  });

  it('reports a missing or damaged image with its reason, and deletes only unreferenced images', async () => {
    const { root, app } = await fixture();
    const used = (await (await upload(app, 'nian', 'normal.png', PNG)).json()).image.path as string;
    const unused = (await (await upload(app, 'nian', 'angry.png', OTHER_PNG)).json()).image.path as string;
    await writeFile(join(root, 'characters/nian/roster-profile.yaml'), PROFILE.replace('looks:\n', `looks:\n  refImagePath: ${used}\n`));

    expect((await (await app.request(`${base}/unreferenced`)).json()).images.map((image: { path: string }) => image.path)).toEqual([unused]);
    const refused = await app.request(`${base}/file?path=${encodeURIComponent(used)}`, { method: 'DELETE' });
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('referenced');
    const removed = await app.request(`${base}/file?path=${encodeURIComponent(unused)}`, { method: 'DELETE' });
    expect(await removed.json()).toEqual({ deleted: unused });
    expect(await readdir(join(root, 'assets/portraits/nian'))).toEqual(['normal.png']);

    // The referenced image disappears (another machine, or the author removed it): a reason, not a failure.
    await unlink(join(root, used));
    const missing = await app.request(`${base}/file?path=${encodeURIComponent(used)}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'missing', error: expect.stringContaining('不随 Git') });
    await writeFile(join(root, used), 'damaged');
    const damaged = await app.request(`${base}/file?path=${encodeURIComponent(used)}`);
    expect(damaged.status).toBe(415);
    const listed = await (await app.request(`${base}/portraits/nian`)).json();
    expect(listed.images).toEqual([{ path: used, name: 'normal.png', bytes: 7, problem: expect.stringContaining('损坏') }]);
  });
});
