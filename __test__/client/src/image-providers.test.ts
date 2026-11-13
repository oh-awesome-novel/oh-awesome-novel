import { describe, expect, it } from 'vite-plus/test';

import { createOanClient } from '@oh-awesome-novel/client';

const provider = { id: 'cloud', kind: 'openai', displayName: '云端', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', defaultWidth: 1024, defaultHeight: 1024, timeoutMs: 60_000, hasApiKey: true };

function clientFor(reply: unknown, requests: Array<{ url: string; method: string; body?: unknown }> = []) {
  return createOanClient({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}) });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
    systemTheme: () => 'dark',
  });
}

describe('image provider client', () => {
  it('reads, saves, checks and removes services', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const client = clientFor({ providers: [provider] }, requests);
    expect((await client.listImageProviders()).providers).toEqual([provider]);
    await client.saveImageProvider({ id: 'cloud', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'sk-new' });
    await client.deleteImageProvider('cloud');
    expect(requests.map(item => [item.method, new URL(item.url, 'http://x').pathname])).toEqual([
      ['GET', '/api/image-providers'], ['POST', '/api/image-providers'], ['DELETE', '/api/image-providers/cloud'],
    ]);
    expect(requests[1]!.body).toMatchObject({ apiKey: 'sk-new' });
    await expect(client.deleteImageProvider('../x')).rejects.toThrow('生图服务 id 无效');
    expect(await clientFor({ ok: true, message: 'ComfyUI 已连通。', latencyMs: 8 }).checkImageProvider('cloud')).toEqual({ ok: true, message: 'ComfyUI 已连通。', latencyMs: 8 });
  });

  it('refuses a response that carries a key or is malformed', async () => {
    await expect(clientFor({ providers: [{ ...provider, apiKey: 'sk-leaked' }] }).listImageProviders()).rejects.toThrow('生图服务列表响应无效');
    await expect(clientFor({ providers: [{ ...provider, kind: 'midjourney' }] }).listImageProviders()).rejects.toThrow('生图服务列表响应无效');
    await expect(clientFor({ ok: 'yes' }).checkImageProvider('cloud')).rejects.toThrow('连通测试响应无效');
  });

  it('returns generated images and the request log', async () => {
    const images = [{ mediaType: 'image/png', base64: 'iVBORw0KGgo=', seed: 7 }];
    const result = await clientFor({ images, providerMeta: { seed: 7 } }).generatePortraitImages('cloud', { positive: 'silver hair', width: 768, height: 1152 });
    expect(result).toEqual({ images, providerMeta: { seed: 7 } });
    await expect(clientFor({ images: [{ mediaType: 'image/svg+xml', base64: 'PHN2Zz4=' }], providerMeta: {} }).generatePortraitImages('cloud', { positive: 'a', width: 64, height: 64 })).rejects.toThrow('生图响应无效');
    await expect(clientFor({ images: [], providerMeta: {} }).generatePortraitImages('cloud', { positive: 'a', width: 64, height: 64 })).rejects.toThrow('生图响应无效');

    const record = { id: 'a', createdAt: '2026-11-13T00:00:00.000Z', providerId: 'cloud', providerKind: 'openai', endpointOrigin: 'https://api.openai.com', local: false, requestedCount: 1, width: 768, height: 1152, durationMs: 900, outcome: 'completed', imageCount: 1 };
    expect((await clientFor({ records: [record] }).getImageGenerationLog(20)).records).toEqual([record]);
    await expect(clientFor({ records: [{ ...record, prompt: 'silver hair' }] }).getImageGenerationLog()).rejects.toThrow('生图记录响应无效');
  });
});
