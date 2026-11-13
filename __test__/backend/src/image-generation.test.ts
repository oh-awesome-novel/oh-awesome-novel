import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { APICallError } from 'ai';
import { MockImageModelV4 } from 'ai/test';

import { createImageGeneration, startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { ImageGenerationError } from '@oh-awesome-novel/core';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('fake-png-body')]);
const PROMPT = 'SECRET_PROMPT silver hair';
const KEY = 'sk-image-secret';
const workflow = JSON.stringify({
  3: { class_type: 'KSampler', inputs: { seed: 0, positive: ['6', 0] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: '{{batch}}' } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: '{{positive}}' } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '{{negative}}' } },
});
const mapping = { seed: { node: '3', input: 'seed' }, width: { node: '5', input: 'width' }, height: { node: '5', input: 'height' } };
const request = { positive: PROMPT, negative: 'blurry', width: 768, height: 1152, count: 2, seed: 100 };

interface MockComfy {
  url: string;
  requests: Array<{ method: string; path: string; body?: unknown; auth?: string }>;
  /** History polls answered "not finished yet" before the result appears. */
  pendingPolls: number;
  finish: boolean;
  status: 'success' | 'error';
  image: Buffer;
  promptStatus: number;
}
async function mockComfy(): Promise<MockComfy> {
  const state: MockComfy = { url: '', requests: [], pendingPolls: 1, finish: true, status: 'success', image: PNG, promptStatus: 200 };
  const json = (response: ServerResponse, status: number, body: unknown): void => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://x');
      const text = Buffer.concat(chunks).toString();
      state.requests.push({ method: request.method ?? '', path: url.pathname + url.search, ...(text ? { body: JSON.parse(text) } : {}), ...(request.headers.authorization ? { auth: request.headers.authorization } : {}) });
      if (url.pathname === '/system_stats') return json(response, 200, { system: { os: 'posix' }, devices: [] });
      if (url.pathname === '/prompt') return json(response, state.promptStatus, state.promptStatus === 200 ? { prompt_id: 'job-1' } : { error: { type: 'prompt_outputs_failed_validation' } });
      if (url.pathname === '/history/job-1') {
        if (!state.finish || state.pendingPolls-- > 0) return json(response, 200, {});
        return json(response, 200, { 'job-1': { status: { status_str: state.status, completed: true }, outputs: state.status === 'error' ? {} : { 9: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }, { filename: 'b.png', subfolder: 'x', type: 'output' }] } } } });
      }
      if (url.pathname === '/view') { response.writeHead(200, { 'content-type': 'image/png' }); return response.end(state.image); }
      if (url.pathname === '/interrupt') return json(response, 200, {});
      return json(response, 404, {});
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return state;
}

async function setup(model: MockImageModelV4 = new MockImageModelV4()) {
  const configDir = await mkdtemp(join(tmpdir(), 'oan-image-config-'));
  cleanups.push(() => rm(configDir, { recursive: true, force: true }));
  const images = createImageGeneration({ configDir: () => configDir, resolveImageModel: () => model, comfyPollMs: 10 });
  return { configDir, images };
}
const comfyConfig = (comfy: MockComfy, extra: Record<string, unknown> = {}) => ({ id: 'local', kind: 'comfyui', baseUrl: comfy.url, timeoutMs: 5000, ...extra });
const errorCode = async (work: Promise<unknown>) => work.then(() => undefined, (error: unknown) => (error as ImageGenerationError).code);
/** Everything the module wrote to disk, to prove what never gets stored. */
async function allFiles(directory: string): Promise<string> {
  let text = '';
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) text += await readFile(join(entry.parentPath, entry.name), 'utf8');
  }
  return text;
}

describe('ComfyUI adapter', () => {
  it('queues the filled workflow, polls, fetches the images and logs the request', async () => {
    const comfy = await mockComfy();
    const { images, configDir } = await setup();
    const saved = await images.save({ config: comfyConfig(comfy), workflowText: workflow, workflowMapping: mapping });
    expect(saved[0]!.workflow?.slots).toEqual(['positive', 'negative', 'seed', 'width', 'height', 'batch']);
    expect((await stat(join(configDir, 'image-providers.json'))).mode & 0o777).toBe(0o600);

    expect(await images.check('local')).toMatchObject({ ok: true, message: 'ComfyUI 已连通。' });
    const result = await images.generate('local', request);
    expect(result.images.map(image => [image.mediaType, image.seed, Buffer.from(image.bytes).equals(PNG)])).toEqual([['image/png', 100, true], ['image/png', 101, true]]);
    expect(result.providerMeta).toEqual({ seed: 100, workflowHash: saved[0]!.workflow!.sha256 });

    const queued = comfy.requests.find(item => item.path === '/prompt')!.body as { prompt: Record<string, { inputs: Record<string, unknown> }> };
    expect(queued.prompt['6']!.inputs.text).toBe(PROMPT);
    expect(queued.prompt['5']!.inputs).toEqual({ width: 768, height: 1152, batch_size: 2 });
    expect(queued.prompt['3']!.inputs.seed).toBe(100);
    expect(comfy.requests.filter(item => item.path === '/history/job-1').length).toBe(2);
    expect(comfy.requests.filter(item => item.path.startsWith('/view')).map(item => item.path)).toEqual(['/view?filename=a.png&subfolder=&type=output', '/view?filename=b.png&subfolder=x&type=output']);

    const log = await images.log();
    expect(log).toEqual([expect.objectContaining({ providerId: 'local', providerKind: 'comfyui', endpointOrigin: comfy.url, local: true, requestedCount: 2, width: 768, height: 1152, outcome: 'completed', imageCount: 2 })]);
    expect(await allFiles(configDir)).not.toContain('SECRET_PROMPT');
  });

  it('interrupts the job on cancel and on timeout, and logs each outcome', async () => {
    const comfy = await mockComfy();
    comfy.finish = false;
    const { images } = await setup();
    await images.save({ config: comfyConfig(comfy), workflowText: workflow, workflowMapping: mapping });

    const controller = new AbortController();
    const cancelled = errorCode(images.generate('local', request, controller.signal));
    await new Promise(resolve => setTimeout(resolve, 60));
    controller.abort();
    expect(await cancelled).toBe('cancelled');
    expect(comfy.requests.filter(item => item.path === '/interrupt')).toHaveLength(1);

    await images.save({ config: comfyConfig(comfy, { timeoutMs: 5000 }) });
    // The shortest timeout the config accepts is five seconds; this run waits for it.
    expect(await errorCode(images.generate('local', request))).toBe('timeout');
    expect(comfy.requests.filter(item => item.path === '/interrupt')).toHaveLength(2);
    expect((await images.log()).map(item => [item.outcome, item.errorCode])).toEqual([['failed', 'timeout'], ['cancelled', 'cancelled']]);
    // A timeout is remembered on the service; a cancel is not an error of the service.
    expect((await images.list())[0]!.lastError).toMatchObject({ code: 'timeout' });
  }, 15_000);

  it('reports a missing workflow, a rejected workflow, a failed run and a non-image result', async () => {
    const comfy = await mockComfy();
    const { images } = await setup();
    await images.save({ config: comfyConfig(comfy) });
    expect(await errorCode(images.generate('local', request))).toBe('workflow');
    expect(await images.check('local')).toMatchObject({ ok: true, message: 'ComfyUI 已连通，但还没有导入工作流。' });
    expect(await errorCode(images.save({ config: comfyConfig(comfy), workflowText: JSON.stringify({ 6: { class_type: 'X', inputs: { text: 'fixed' } } }) }))).toBe('workflow');

    await images.save({ config: comfyConfig(comfy), workflowText: workflow, workflowMapping: mapping });
    comfy.promptStatus = 400;
    expect(await errorCode(images.generate('local', request))).toBe('workflow');
    comfy.promptStatus = 200;
    comfy.status = 'error';
    expect(await errorCode(images.generate('local', request))).toBe('workflow');
    comfy.status = 'success';
    comfy.pendingPolls = 0;
    comfy.image = Buffer.from('<html>not an image</html>');
    expect(await errorCode(images.generate('local', request))).toBe('invalid_response');
    expect((await images.log()).every(item => item.outcome === 'failed' && item.imageCount === 0)).toBe(true);
  });

  it('refuses a remote address unless allowed and reports an unreachable one', async () => {
    const { images } = await setup();
    expect(await errorCode(images.save({ config: { id: 'lan', kind: 'comfyui', baseUrl: 'http://192.168.77.1:8188' } }))).toBe('config');
    await images.save({ config: { id: 'gone', kind: 'comfyui', baseUrl: 'http://127.0.0.1:9', timeoutMs: 5000 }, workflowText: workflow, workflowMapping: mapping });
    expect(await images.check('gone')).toMatchObject({ ok: false });
    expect(await errorCode(images.generate('gone', request))).toBe('unreachable');
    expect((await images.list())[0]!.lastError).toMatchObject({ code: 'unreachable' });
  });
});

describe('online adapter', () => {
  const online = { id: 'cloud', kind: 'openai-compatible', baseUrl: 'https://images.example/v1', model: 'paint-1', apiKey: KEY, timeoutMs: 5000 };
  const apiError = (statusCode: number, responseBody: string) => new APICallError({ message: 'failed', url: 'https://images.example/v1/images/generations', requestBodyValues: {}, statusCode, responseBody });

  it('generates through the AI SDK and logs the request without the prompt or the key', async () => {
    const calls: unknown[] = [];
    const model = new MockImageModelV4({
      maxImagesPerCall: 4,
      doGenerate: async (input) => {
        calls.push(input);
        // One image more than asked for: the adapter keeps only what was requested.
        return { images: [new Uint8Array(PNG), new Uint8Array(PNG), new Uint8Array(PNG)], warnings: [], response: { timestamp: new Date(), modelId: 'paint-1', headers: undefined } };
      },
    });
    const { images, configDir } = await setup(model);
    const saved = await images.save({ config: online });
    expect(saved[0]).toMatchObject({ hasApiKey: true, model: 'paint-1' });
    expect(JSON.stringify(saved)).not.toContain(KEY);

    const result = await images.generate('cloud', request);
    expect(result.images).toHaveLength(2);
    expect(calls[0]).toMatchObject({ prompt: PROMPT, n: 2, size: '768x1152', seed: 100 });
    expect(await images.log()).toEqual([expect.objectContaining({ providerId: 'cloud', providerKind: 'openai-compatible', modelId: 'paint-1', endpointOrigin: 'https://images.example', local: false, outcome: 'completed', imageCount: 2 })]);
    const log = await readFile(join(configDir, 'image-generation-log.jsonl'), 'utf8');
    expect(log).not.toContain('SECRET_PROMPT');
    expect(log).not.toContain(KEY);
    expect(log).not.toContain('/v1');
  });

  it('classifies a rejected key, rejected content and a bad result, and keeps the key bound to its address', async () => {
    let failure: unknown = apiError(401, '{"error":{"message":"Incorrect API key"}}');
    const model = new MockImageModelV4({ doGenerate: async () => { throw failure; } });
    const { images } = await setup(model);
    await images.save({ config: online });
    expect(await errorCode(images.generate('cloud', request))).toBe('auth');
    failure = apiError(400, '{"error":{"code":"content_policy_violation","message":"Your request was rejected by our safety system."}}');
    expect(await errorCode(images.generate('cloud', request))).toBe('content_rejected');
    failure = apiError(500, 'oops');
    expect(await errorCode(images.generate('cloud', request))).toBe('invalid_response');
    expect((await images.log()).map(item => item.errorCode)).toEqual(['invalid_response', 'content_rejected', 'auth']);
    expect((await images.list())[0]!.lastError?.message).not.toContain(KEY);

    // Editing other fields keeps the stored key; moving to another host asks for it again.
    const { apiKey: _key, ...withoutKey } = online;
    expect((await images.save({ config: { ...withoutKey, displayName: '云端' } }))[0]).toMatchObject({ hasApiKey: true, displayName: '云端' });
    expect(await errorCode(images.save({ config: { ...withoutKey, baseUrl: 'https://elsewhere.example/v1' } }))).toBe('config');
  });
});

describe('image services over HTTP', () => {
  it('saves, lists without the key, checks, generates and removes', async () => {
    const comfy = await mockComfy();
    const configDir = await mkdtemp(join(tmpdir(), 'oan-image-http-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-image-ws-'));
    const backend = await startNovelHttpBackend({ workspaceRoot, globalConfigDir: configDir, comfyPollMs: 10, resolveImageModel: () => new MockImageModelV4() });
    cleanups.push(async () => { await backend.close(); await rm(configDir, { recursive: true, force: true }); await rm(workspaceRoot, { recursive: true, force: true }); });
    const post = (path: string, body?: unknown) => fetch(`${backend.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

    const saved = await post('/api/image-providers', { ...comfyConfig(comfy), apiKey: KEY, workflowText: workflow, workflowMapping: mapping });
    expect(saved.status).toBe(200);
    const listed = await (await fetch(`${backend.url}/api/image-providers`)).text();
    expect(listed).not.toContain(KEY);
    expect(JSON.parse(listed).providers[0]).toMatchObject({ id: 'local', hasApiKey: true, workflow: { slots: expect.arrayContaining(['positive']) } });
    // The workflow text itself is not returned either.
    expect(listed).not.toContain('CLIPTextEncode');

    expect(await (await post('/api/image-providers/local/check')).json()).toMatchObject({ ok: true });
    const generated = await (await post('/api/image-providers/local/generate', request)).json() as { images: Array<{ mediaType: string; base64: string }> };
    expect(generated.images.map(image => [image.mediaType, Buffer.from(image.base64, 'base64').equals(PNG)])).toEqual([['image/png', true], ['image/png', true]]);
    // A key stored for ComfyUI goes out as a bearer token.
    expect(comfy.requests.find(item => item.path === '/prompt')!.auth).toBe(`Bearer ${KEY}`);

    const bad = await post('/api/image-providers/local/generate', { ...request, count: 99 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'config' });
    const remote = await post('/api/image-providers', { id: 'lan', kind: 'comfyui', baseUrl: 'http://192.168.77.1:8188' });
    expect(remote.status).toBe(400);

    const log = await (await fetch(`${backend.url}/api/image-generation/log`)).json() as { records: unknown[] };
    expect(log.records).toHaveLength(1);
    const removed = await (await fetch(`${backend.url}/api/image-providers/local`, { method: 'DELETE' })).json() as { providers: unknown[] };
    expect(removed.providers).toEqual([]);
    expect(await readdir(join(configDir, 'image-workflows'))).toEqual([]);
    // Nothing was written into the novel workspace.
    expect(await readdir(workspaceRoot)).toEqual([]);
  });
});
