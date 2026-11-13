import { describe, expect, it, vi } from 'vite-plus/test';
import { createOanClient, readPlaySessionPortraitSets } from '@oh-awesome-novel/client';

const HASH = 'a'.repeat(64);
const portraits = {
  default: 'casual',
  items: [
    { id: 'casual', label: '常服', description: '米色开衫。', image: 'assets/portraits/nian/casual.png' },
    { id: 'night', label: '夜行', description: '黑色斗篷。', prompt: { positive: 'black cloak' } },
  ],
};
const formBody = {
  characterId: 'nian',
  path: 'characters/nian/roster-profile.yaml',
  profile: { name: '念念', sourceHash: HASH, portraits, nameColor: '#E9C983', legacyRefImagePath: null, missingImages: [{ id: 'casual', image: 'assets/portraits/nian/casual.png', reason: '图片文件不存在。' }] },
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function client(fetcher: ReturnType<typeof vi.fn>) {
  return createOanClient({ backendBaseUrl: 'http://127.0.0.1:3210', fetch: fetcher as unknown as typeof fetch });
}

describe('character portrait client', () => {
  it('reads the form and proposes an edit for approval', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(formBody))
      .mockResolvedValueOnce(json({ characterId: 'lu', path: 'characters/lu/roster-profile.yaml', profile: null }))
      .mockResolvedValueOnce(json({ pendingActionId: 'pa_0b5c8a52-1111-4222-8333-444455556666', targetPath: 'characters/nian/roster-profile.yaml', missingImages: [] }));
    const api = client(fetcher);
    expect(await api.getCharacterPortraits('nian')).toEqual(formBody);
    expect((await api.getCharacterPortraits('lu')).profile).toBeNull();
    const input = { expectedWorkspaceRoot: '/novel', sourceHash: HASH, portraits, nameColor: null };
    expect(await api.proposeCharacterPortraits('nian', input)).toEqual({
      pendingActionId: 'pa_0b5c8a52-1111-4222-8333-444455556666', targetPath: 'characters/nian/roster-profile.yaml', missingImages: [],
    });
    expect(fetcher.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      ['http://127.0.0.1:3210/api/workspace/characters/nian/portraits', 'GET'],
      ['http://127.0.0.1:3210/api/workspace/characters/lu/portraits', 'GET'],
      ['http://127.0.0.1:3210/api/workspace/characters/nian/portraits/propose', 'POST'],
    ]);
    expect(JSON.parse(fetcher.mock.calls[2]![1].body as string)).toEqual(input);
  });

  it('refuses unsafe ids and responses that do not belong to the request, and surfaces the backend reason', async () => {
    const fetcher = vi.fn();
    const api = client(fetcher);
    await expect(api.getCharacterPortraits('../nian')).rejects.toThrow('角色 id 无效');
    expect(fetcher).not.toHaveBeenCalled();
    for (const body of [
      { ...formBody, characterId: 'other' },
      { ...formBody, path: 'characters/other/roster-profile.yaml' },
      { ...formBody, profile: { ...formBody.profile, sourceHash: 'short' } },
      { ...formBody, profile: { ...formBody.profile, portraits: { default: 'missing', items: portraits.items } } },
      { ...formBody, profile: { ...formBody.profile, portraits: { default: 'casual', items: [{ ...portraits.items[0], image: '../secret.png' }] } } },
      { ...formBody, profile: { ...formBody.profile, nameColor: 'gold' } },
    ]) {
      fetcher.mockResolvedValueOnce(json(body));
      await expect(api.getCharacterPortraits('nian')).rejects.toThrow('立绘响应无效');
    }
    fetcher.mockResolvedValueOnce(json({ pendingActionId: 'pa_1', targetPath: 'characters/other/roster-profile.yaml', missingImages: [] }));
    await expect(api.proposeCharacterPortraits('nian', { expectedWorkspaceRoot: '/novel', sourceHash: HASH, portraits: null, nameColor: null })).rejects.toThrow('立绘提案响应无效');
    fetcher.mockResolvedValueOnce(json({ error: { code: 'stale_roster_profile', message: '名册文件已被修改，请重新载入后再保存。' } }, 409));
    await expect(api.proposeCharacterPortraits('nian', { expectedWorkspaceRoot: '/novel', sourceHash: HASH, portraits: null, nameColor: null })).rejects.toThrow('名册文件已被修改');
  });

  it('reads the portrait sets a session recorded and ignores malformed ones', () => {
    const recorded = { default: 'casual', items: [{ id: 'casual', label: '常服', description: '米色开衫。', image: 'assets/portraits/nian/casual.png', sha256: HASH }], skipped: ['p9'] };
    expect(readPlaySessionPortraitSets({
      nian: recorded,
      '../x': recorded,
      noSkipped: { default: 'casual', items: recorded.items },
      badHash: { ...recorded, items: [{ ...recorded.items[0], sha256: 'nope' }] },
      badPath: { ...recorded, items: [{ ...recorded.items[0], image: 'characters/nian/a.png' }] },
      dataUrl: 'data:image/png;base64,AAAA',
    })).toEqual({ nian: recorded });
    expect(readPlaySessionPortraitSets(undefined)).toEqual({});
    expect(readPlaySessionPortraitSets([recorded])).toEqual({});
  });
});
