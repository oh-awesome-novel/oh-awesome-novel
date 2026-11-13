import { describe, expect, it, vi } from 'vite-plus/test';
import { createOanClient, isImageAssetPath } from '@oh-awesome-novel/client';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const entry = { path: 'assets/portraits/nian/normal.png', name: 'normal.png', bytes: 8, mime: 'image/png' };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function client(fetcher: ReturnType<typeof vi.fn>) {
  return createOanClient({ backendBaseUrl: 'http://127.0.0.1:3210', fetch: fetcher as unknown as typeof fetch });
}

describe('image asset client', () => {
  it('lists, imports raw bytes, reads a blob and deletes by path', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ directory: 'assets/portraits/nian', images: [entry] }))
      .mockResolvedValueOnce(json({ image: entry, reused: false, gitIgnored: true }, 201))
      .mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(json({ images: [{ ...entry, mime: undefined, problem: '文件已损坏。' }] }))
      .mockResolvedValueOnce(json({ deleted: entry.path }));
    const api = client(fetcher);

    expect(await api.listPortraitImages('nian')).toEqual({ directory: 'assets/portraits/nian', images: [entry] });
    expect(await api.importPortraitImage('nian', { name: '平常 normal.png', data: PNG })).toEqual({ image: entry, reused: false, gitIgnored: true });
    const blob = await api.readImageAsset(entry.path);
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG);
    expect((await api.listUnreferencedImageAssets()).images[0]).toMatchObject({ problem: '文件已损坏。' });
    expect(await api.deleteImageAsset(entry.path)).toEqual({ deleted: entry.path });

    expect(fetcher.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      ['http://127.0.0.1:3210/api/workspace/image-assets/portraits/nian', 'GET'],
      [`http://127.0.0.1:3210/api/workspace/image-assets/portraits/nian?name=${encodeURIComponent('平常 normal.png')}`, 'POST'],
      [`http://127.0.0.1:3210/api/workspace/image-assets/file?path=${encodeURIComponent(entry.path)}`, 'GET'],
      ['http://127.0.0.1:3210/api/workspace/image-assets/unreferenced', 'GET'],
      [`http://127.0.0.1:3210/api/workspace/image-assets/file?path=${encodeURIComponent(entry.path)}`, 'DELETE'],
    ]);
    // The image travels as raw bytes, not as base64 JSON.
    expect(fetcher.mock.calls[1]![1].body).toBe(PNG);
    expect(fetcher.mock.calls[1]![1].headers).toEqual({ 'content-type': 'application/octet-stream' });
  });

  it('refuses unsafe input before any request and surfaces the backend reason', async () => {
    const fetcher = vi.fn();
    const api = client(fetcher);
    await expect(api.listPortraitImages('../x')).rejects.toThrow('角色 id 无效');
    await expect(api.readImageAsset('assets/../.oan/config.yaml')).rejects.toThrow('图片路径无效');
    await expect(api.deleteImageAsset('characters/nian/profile.md')).rejects.toThrow('图片路径无效');
    await expect(api.importPortraitImage('nian', { name: 'huge.png', data: new Uint8Array(16 * 1024 * 1024 + 1) })).rejects.toThrow('16 MiB');
    expect(fetcher).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(json({ error: '图片文件不存在。图片不随 Git 同步，换一台机器后需要重新放入。', code: 'missing' }, 404));
    await expect(api.readImageAsset(entry.path)).rejects.toMatchObject({ message: expect.stringContaining('不随 Git'), status: 404 });
    fetcher.mockResolvedValueOnce(json({ error: '文件内容是 JPEG，与扩展名 .png 不一致。', code: 'signature_mismatch' }, 415));
    await expect(api.importPortraitImage('nian', { name: 'a.png', data: PNG })).rejects.toThrow('JPEG');
  });

  it('rejects responses that point outside the asset folder or the requested character', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ directory: 'assets/portraits/nian', images: [{ ...entry, path: '../secret.png' }] }))
      .mockResolvedValueOnce(json({ image: { ...entry, path: 'assets/portraits/lu/normal.png' }, reused: false, gitIgnored: true }))
      .mockResolvedValueOnce(new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }))
      .mockResolvedValueOnce(json({ deleted: 'assets/other.png' }));
    const api = client(fetcher);
    await expect(api.listPortraitImages('nian')).rejects.toThrow('响应无效');
    await expect(api.importPortraitImage('nian', { name: 'a.png', data: PNG })).rejects.toThrow('响应无效');
    await expect(api.readImageAsset(entry.path)).rejects.toThrow('响应无效');
    await expect(api.deleteImageAsset(entry.path)).rejects.toThrow('响应无效');
    expect(isImageAssetPath('assets/portraits/nian/normal.v2.webp')).toBe(true);
    expect(isImageAssetPath('assets/a..png')).toBe(false);
  });
});
