import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { APICallError, NoImageGeneratedError, generateImage } from 'ai';
import type { ImageModel } from 'ai';
import {
  IMAGE_GENERATION_LIMITS, ImageGenerationError, createEmptyImageProviderConfigState, detectImageAssetMime,
  fillComfyWorkflow, inspectComfyWorkflow, isLoopbackHost, normalizeImageProviderConfig, normalizePortraitImageRequest,
  parseImageGenerationLogRecord, redactImageProviderConfig, removeImageProviderConfig, upsertImageProviderConfig,
} from '@oh-awesome-novel/core';
import type {
  ImageGenerationErrorCode, ImageGenerationLogRecord, ImageProviderConfig, ImageProviderConfigState,
  PortraitImage, PortraitImageRequest, PortraitImageResult,
} from '@oh-awesome-novel/core';

/**
 * Image generation services (task 1640). Config, keys, workflows and the request log all live
 * in the app-level config directory; nothing here reads or writes a novel workspace.
 */
export interface ImageGenerationOptions {
  /** The app-level config directory. */
  configDir(): string;
  /** Online services only; ComfyUI never goes through the AI SDK. */
  resolveImageModel(config: ImageProviderConfig): ImageModel | Promise<ImageModel>;
  /** How often a queued ComfyUI prompt is checked. */
  comfyPollMs?: number;
}

const CONFIG_FILE = 'image-providers.json';
const WORKFLOW_DIRECTORY = 'image-workflows';
const LOG_FILE = 'image-generation-log.jsonl';
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_KEEP_LINES = 1000;
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;

const ERROR_TEXT: Record<ImageGenerationErrorCode, string> = {
  unreachable: '连不上生图服务。',
  auth: '生图服务拒绝了凭据。',
  timeout: '生图请求超时。',
  content_rejected: '生图服务拒绝了这次请求的内容。',
  invalid_response: '生图服务返回的内容无法使用。',
  workflow: 'ComfyUI 工作流有问题。',
  cancelled: '生图请求已取消。',
  config: '生图服务配置有问题。',
};

export function imageGenerationErrorText(code: ImageGenerationErrorCode): string { return ERROR_TEXT[code]; }

async function writeOwnerOnlyAtomically(filePath: string, content: string): Promise<void> {
  const temp = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(content, 'utf-8'); await handle.chmod(0o600); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, filePath); } catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function loadImageProviderConfigState(configDir: string): Promise<ImageProviderConfigState> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(join(configDir, CONFIG_FILE), 'utf-8')); } catch { return createEmptyImageProviderConfigState(); }
  const state = parsed as { kind?: unknown; version?: unknown; state?: { providers?: unknown } };
  if (state?.kind !== 'image-provider-config' || state.version !== 1 || !Array.isArray(state.state?.providers)) return createEmptyImageProviderConfigState();
  // One damaged entry does not hide the others.
  return { providers: state.state.providers.flatMap((item) => { try { return [normalizeImageProviderConfig(item)]; } catch { return []; } }) };
}

async function saveImageProviderConfigState(configDir: string, state: ImageProviderConfigState): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeOwnerOnlyAtomically(join(configDir, CONFIG_FILE), `${JSON.stringify({ kind: 'image-provider-config', version: 1, state }, null, 2)}\n`);
}

const workflowPath = (configDir: string, id: string): string => join(configDir, WORKFLOW_DIRECTORY, `${id}.json`);

function abortError(signal: AbortSignal): ImageGenerationError {
  return signal.reason === 'timeout'
    ? new ImageGenerationError('timeout', ERROR_TEXT.timeout)
    : new ImageGenerationError('cancelled', ERROR_TEXT.cancelled);
}

/** A timeout and the caller's cancel share one signal; the reason tells them apart. */
function deadline(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; done(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const cancel = (): void => controller.abort('cancelled');
  if (outer?.aborted) cancel(); else outer?.addEventListener('abort', cancel, { once: true });
  return { signal: controller.signal, done() { clearTimeout(timer); outer?.removeEventListener('abort', cancel); } };
}

async function comfyFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal, redirect: 'error' }); }
  catch (error) {
    if (signal.aborted) throw abortError(signal);
    throw new ImageGenerationError('unreachable', `${ERROR_TEXT.unreachable}（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (response.status === 401 || response.status === 403) throw new ImageGenerationError('auth', ERROR_TEXT.auth);
  return response;
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new ImageGenerationError('invalid_response', ERROR_TEXT.invalid_response);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ImageGenerationError('invalid_response', '生图服务返回的内容超过了大小上限。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ImageGenerationError) throw error;
    if (signal.aborted) throw abortError(signal);
    throw new ImageGenerationError('unreachable', ERROR_TEXT.unreachable);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const bytes = await readBounded(response, MAX_HISTORY_BYTES, signal);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ImageGenerationError('invalid_response', ERROR_TEXT.invalid_response); }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function checkedImage(bytes: Uint8Array, seed?: number): PortraitImage {
  if (bytes.byteLength > IMAGE_GENERATION_LIMITS.maxImageBytes) throw new ImageGenerationError('invalid_response', '生图服务返回的图片超过了大小上限。');
  const mediaType = detectImageAssetMime(bytes);
  if (!mediaType) throw new ImageGenerationError('invalid_response', '生图服务返回的不是 PNG、JPEG 或 WebP 图片。');
  return { bytes, mediaType, ...(seed === undefined ? {} : { seed }) };
}

function authHeaders(config: ImageProviderConfig): Record<string, string> {
  return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
}

function assertComfyAddress(config: ImageProviderConfig): void {
  if (!config.allowRemote && !isLoopbackHost(new URL(config.baseUrl).hostname)) {
    throw new ImageGenerationError('config', 'ComfyUI 地址不在本机。要使用远程 ComfyUI，请先在设置里明确允许。');
  }
}

async function generateWithComfy(
  config: ImageProviderConfig, workflowText: string, request: PortraitImageRequest, signal: AbortSignal, pollMs: number,
): Promise<PortraitImageResult> {
  assertComfyAddress(config);
  if (!config.workflow) throw new ImageGenerationError('workflow', '这个 ComfyUI 服务还没有导入工作流。');
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
  const prompt = fillComfyWorkflow(workflowText, config.workflow.mapping, request, seed);
  const headers = authHeaders(config);
  const queued = await comfyFetch(`${config.baseUrl}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ prompt, client_id: `oan-${randomUUID()}` }),
  }, signal);
  const queuedBody = record(await readJson(queued, signal));
  if (!queued.ok) {
    // ComfyUI answers 400 with node errors when the workflow itself cannot run.
    throw new ImageGenerationError(queued.status === 400 ? 'workflow' : 'invalid_response',
      queued.status === 400 ? 'ComfyUI 没有接受这个工作流，请在 ComfyUI 里确认它能正常运行。' : `ComfyUI 返回了 ${queued.status}。`);
  }
  const promptId = queuedBody?.prompt_id;
  if (typeof promptId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(promptId)) throw new ImageGenerationError('invalid_response', ERROR_TEXT.invalid_response);

  try {
    let outputs: Record<string, unknown> | undefined;
    while (!outputs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, pollMs);
        const stop = (): void => { clearTimeout(timer); reject(abortError(signal)); };
        if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
      });
      const history = await comfyFetch(`${config.baseUrl}/history/${promptId}`, { headers }, signal);
      if (!history.ok) throw new ImageGenerationError('invalid_response', `ComfyUI 返回了 ${history.status}。`);
      const entry = record(record(await readJson(history, signal))?.[promptId]);
      if (!entry) continue;
      if (record(entry.status)?.status_str === 'error') throw new ImageGenerationError('workflow', 'ComfyUI 执行这个工作流时出错，请在 ComfyUI 里查看具体节点。');
      outputs = record(entry.outputs);
      if (!outputs) throw new ImageGenerationError('invalid_response', ERROR_TEXT.invalid_response);
    }
    const files = Object.values(outputs).flatMap(node => {
      const images = record(node)?.images;
      return Array.isArray(images) ? images.flatMap((image) => {
        const item = record(image);
        return item && typeof item.filename === 'string' ? [{ filename: item.filename, subfolder: typeof item.subfolder === 'string' ? item.subfolder : '', type: typeof item.type === 'string' ? item.type : 'output' }] : [];
      }) : [];
    }).slice(0, IMAGE_GENERATION_LIMITS.maxCount);
    if (!files.length) throw new ImageGenerationError('invalid_response', 'ComfyUI 工作流执行完了，但没有输出图片。');
    const images: PortraitImage[] = [];
    for (const [index, file] of files.entries()) {
      const view = await comfyFetch(`${config.baseUrl}/view?${new URLSearchParams(file).toString()}`, { headers }, signal);
      if (!view.ok) throw new ImageGenerationError('invalid_response', `ComfyUI 取图时返回了 ${view.status}。`);
      images.push(checkedImage(await readBounded(view, IMAGE_GENERATION_LIMITS.maxImageBytes, signal), seed + index));
    }
    return { images, providerMeta: { seed, workflowHash: config.workflow.sha256 } };
  } catch (error) {
    // Stop the job on a timeout or cancel, so the author's GPU is not left working on it.
    if (signal.aborted) {
      await fetch(`${config.baseUrl}/interrupt`, { method: 'POST', headers, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    }
    throw error;
  }
}

function classifyOnlineError(error: unknown, signal: AbortSignal): ImageGenerationError {
  if (error instanceof ImageGenerationError) return error;
  if (signal.aborted) return abortError(signal);
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const body = `${error.message} ${error.responseBody ?? ''}`.toLowerCase();
    if (status === 401 || status === 403) return new ImageGenerationError('auth', ERROR_TEXT.auth);
    if (/content_policy|content policy|moderation|safety system|safety_violation|nsfw/u.test(body)) return new ImageGenerationError('content_rejected', ERROR_TEXT.content_rejected);
    if (status === 408 || status === 504) return new ImageGenerationError('timeout', ERROR_TEXT.timeout);
    if (status === undefined) return new ImageGenerationError('unreachable', ERROR_TEXT.unreachable);
    return new ImageGenerationError('invalid_response', `生图服务返回了 ${status}。`);
  }
  if (NoImageGeneratedError.isInstance(error)) return new ImageGenerationError('invalid_response', '生图服务没有返回图片。');
  return new ImageGenerationError('unreachable', ERROR_TEXT.unreachable);
}

async function generateOnline(
  config: ImageProviderConfig, request: PortraitImageRequest, signal: AbortSignal, options: ImageGenerationOptions,
): Promise<PortraitImageResult> {
  try {
    const result = await generateImage({
      model: await options.resolveImageModel(config),
      prompt: request.positive,
      n: request.count,
      size: `${request.width}x${request.height}`,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      // One attempt: a retry would bill the author again without telling them.
      maxRetries: 0,
      abortSignal: signal,
    });
    const images = result.images.slice(0, request.count).map(image => checkedImage(image.uint8Array, request.seed));
    if (!images.length) throw new ImageGenerationError('invalid_response', '生图服务没有返回图片。');
    return { images, providerMeta: { model: config.model ?? '' } };
  } catch (error) { throw classifyOnlineError(error, signal); }
}

async function appendLog(configDir: string, entry: ImageGenerationLogRecord): Promise<void> {
  const file = join(configDir, LOG_FILE);
  await mkdir(configDir, { recursive: true });
  await appendFile(file, `${JSON.stringify(parseImageGenerationLogRecord(entry))}\n`, { mode: 0o600 });
  if ((await stat(file)).size > LOG_MAX_BYTES) {
    const lines = (await readFile(file, 'utf-8')).split('\n').filter(Boolean).slice(-LOG_KEEP_LINES);
    await writeOwnerOnlyAtomically(file, `${lines.join('\n')}\n`);
  }
}

export async function readImageGenerationLog(configDir: string, limit = 50): Promise<ImageGenerationLogRecord[]> {
  let text: string;
  try { text = await readFile(join(configDir, LOG_FILE), 'utf-8'); } catch { return []; }
  return text.split('\n').filter(Boolean).slice(-Math.max(1, Math.min(limit, 200)))
    .flatMap((line) => { try { return [parseImageGenerationLogRecord(JSON.parse(line))]; } catch { return []; } }).reverse();
}

export interface ImageProviderSaveInput {
  config: Record<string, unknown>;
  /** A new workflow to import (API-format JSON text). Absent keeps the stored one. */
  workflowText?: string;
  /** Slot mapping for the workflow; with no new workflow it re-maps the stored one. */
  workflowMapping?: unknown;
}

export function createImageGeneration(options: ImageGenerationOptions) {
  const load = () => loadImageProviderConfigState(options.configDir());
  const find = async (id: string): Promise<ImageProviderConfig> => {
    const provider = (await load()).providers.find(item => item.id === id);
    if (!provider) throw new ImageGenerationError('config', '没有这个生图服务。');
    return provider;
  };
  const rememberError = async (id: string, error: ImageGenerationError | undefined): Promise<void> => {
    const state = await load();
    const provider = state.providers.find(item => item.id === id);
    if (!provider || (!error && !provider.lastError)) return;
    const { lastError: _previous, ...rest } = provider;
    await saveImageProviderConfigState(options.configDir(), upsertImageProviderConfig(state, {
      ...rest, ...(error ? { lastError: { at: new Date().toISOString(), code: error.code, message: error.message } } : {}),
    }));
  };

  return {
    async list(): Promise<ImageProviderConfig[]> { return (await load()).providers.map(redactImageProviderConfig); },

    async save(input: ImageProviderSaveInput): Promise<ImageProviderConfig[]> {
      const state = await load();
      const existing = state.providers.find(item => item.id === input.config.id);
      const draft = normalizeImageProviderConfig({ ...input.config, workflow: undefined, lastError: undefined });
      const requestKey = typeof input.config.apiKey === 'string' && input.config.apiKey.trim() ? input.config.apiKey.trim() : undefined;
      // A stored key stays with the address it was entered for.
      const sameEndpoint = existing !== undefined && new URL(existing.baseUrl).origin === new URL(draft.baseUrl).origin;
      if (!requestKey && existing?.apiKey && !sameEndpoint) {
        throw new ImageGenerationError('config', '服务地址变了，请重新填写 API Key。');
      }
      const apiKey = requestKey ?? (sameEndpoint ? existing?.apiKey : undefined);
      let workflow = draft.kind === 'comfyui' ? existing?.workflow : undefined;
      if (draft.kind === 'comfyui') {
        const directory = join(options.configDir(), WORKFLOW_DIRECTORY);
        if (input.workflowText !== undefined) {
          const inspected = inspectComfyWorkflow(input.workflowText, input.workflowMapping);
          await mkdir(directory, { recursive: true });
          await writeOwnerOnlyAtomically(workflowPath(options.configDir(), draft.id), input.workflowText);
          workflow = { sha256: createHash('sha256').update(input.workflowText).digest('hex'), ...inspected, importedAt: new Date().toISOString() };
        } else if (workflow && input.workflowMapping !== undefined) {
          const text = await readFile(workflowPath(options.configDir(), draft.id), 'utf-8');
          workflow = { ...workflow, ...inspectComfyWorkflow(text, input.workflowMapping) };
        }
      } else {
        await rm(workflowPath(options.configDir(), draft.id), { force: true });
      }
      const { apiKey: _draftKey, ...withoutKey } = draft;
      await saveImageProviderConfigState(options.configDir(), upsertImageProviderConfig(state, {
        ...withoutKey, ...(apiKey ? { apiKey } : {}), ...(workflow ? { workflow } : {}),
      }));
      return this.list();
    },

    async remove(id: string): Promise<ImageProviderConfig[]> {
      const state = await load();
      await saveImageProviderConfigState(options.configDir(), removeImageProviderConfig(state, id));
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) await rm(workflowPath(options.configDir(), id), { force: true });
      return this.list();
    },

    /** ComfyUI: `GET /system_stats`. Online: a one-image request is not free, so this only checks the stored config. */
    async check(id: string): Promise<{ ok: boolean; message: string; latencyMs: number }> {
      const config = await find(id);
      const startedAt = Date.now();
      try {
        if (config.kind !== 'comfyui') {
          await options.resolveImageModel(config);
          return { ok: true, latencyMs: 0, message: '配置完整。在线服务按张计费，这里不会发出生图请求；第一次生图时才会验证地址和 API Key。' };
        }
        assertComfyAddress(config);
        const limit = deadline(Math.min(config.timeoutMs, 10_000));
        try {
          const response = await comfyFetch(`${config.baseUrl}/system_stats`, { headers: authHeaders(config) }, limit.signal);
          if (!response.ok || !record(await readJson(response, limit.signal))?.system) throw new ImageGenerationError('invalid_response', '这个地址有响应，但不像是 ComfyUI。');
        } finally { limit.done(); }
        await rememberError(id, undefined);
        return { ok: true, latencyMs: Date.now() - startedAt, message: config.workflow ? 'ComfyUI 已连通。' : 'ComfyUI 已连通，但还没有导入工作流。' };
      } catch (error) {
        const failure = error instanceof ImageGenerationError ? error : new ImageGenerationError('unreachable', ERROR_TEXT.unreachable);
        await rememberError(id, failure);
        return { ok: false, latencyMs: Date.now() - startedAt, message: failure.message };
      }
    },

    /** The one entry point for producing images. Every call leaves one log record, whatever the outcome. */
    async generate(id: string, requestInput: unknown, signal?: AbortSignal): Promise<PortraitImageResult> {
      const config = await find(id);
      const request = normalizePortraitImageRequest(requestInput);
      const startedAt = Date.now();
      const limit = deadline(config.timeoutMs, signal);
      let result: PortraitImageResult | undefined;
      let failure: ImageGenerationError | undefined;
      try {
        if (config.kind === 'comfyui') {
          const text = await readFile(workflowPath(options.configDir(), config.id), 'utf-8')
            .catch(() => { throw new ImageGenerationError('workflow', '这个 ComfyUI 服务还没有导入工作流。'); });
          result = await generateWithComfy(config, text, request, limit.signal, options.comfyPollMs ?? 1000);
        } else {
          result = await generateOnline(config, request, limit.signal, options);
        }
        return result;
      } catch (error) {
        failure = error instanceof ImageGenerationError ? error
          : limit.signal.aborted ? abortError(limit.signal) : new ImageGenerationError('invalid_response', ERROR_TEXT.invalid_response);
        throw failure;
      } finally {
        limit.done();
        const origin = new URL(config.baseUrl);
        // The log and the last-error note are bookkeeping; they never change the outcome.
        await appendLog(options.configDir(), {
          schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(),
          providerId: config.id, providerKind: config.kind, ...(config.model ? { modelId: config.model } : {}),
          endpointOrigin: origin.origin, local: isLoopbackHost(origin.hostname),
          requestedCount: request.count, width: request.width, height: request.height,
          durationMs: Date.now() - startedAt,
          outcome: failure ? (failure.code === 'cancelled' ? 'cancelled' : 'failed') : 'completed',
          imageCount: result?.images.length ?? 0,
          ...(failure ? { errorCode: failure.code } : {}),
        }).catch(() => undefined);
        if (failure?.code !== 'cancelled') await rememberError(config.id, failure).catch(() => undefined);
      }
    },

    log(limit?: number): Promise<ImageGenerationLogRecord[]> { return readImageGenerationLog(options.configDir(), limit); },
  };
}

export type ImageGeneration = ReturnType<typeof createImageGeneration>;

/** HTTP handlers. Errors carry a code the UI can show; they never echo a prompt or a key. */
export function createImageGenerationHandlers(images: ImageGeneration) {
  type Reply = { status: number; body: unknown };
  const failure = (error: unknown): Reply => error instanceof ImageGenerationError
    ? { status: error.code === 'config' || error.code === 'workflow' ? 400 : error.code === 'cancelled' ? 499 : 502, body: { error: error.message, code: error.code } }
    : { status: 500, body: { error: '生图服务出错。', code: 'invalid_response' } };
  const run = async (work: () => Promise<unknown>): Promise<Reply> => {
    try { return { status: 200, body: await work() }; } catch (error) { return failure(error); }
  };
  return {
    list: () => run(async () => ({ providers: await images.list() })),
    save: (body: Record<string, unknown>) => run(async () => {
      const { workflowText, workflowMapping, ...config } = body;
      if (workflowText !== undefined && typeof workflowText !== 'string') throw new ImageGenerationError('workflow', 'The workflow must be JSON text.');
      return { providers: await images.save({ config, ...(workflowText === undefined ? {} : { workflowText }), ...(workflowMapping === undefined ? {} : { workflowMapping }) }) };
    }),
    remove: (id: string) => run(async () => ({ providers: await images.remove(id) })),
    check: (id: string) => run(() => images.check(id)),
    generate: (id: string, body: Record<string, unknown>, signal: AbortSignal) => run(async () => {
      const result = await images.generate(id, body, signal);
      return {
        images: result.images.map(image => ({ mediaType: image.mediaType, base64: Buffer.from(image.bytes).toString('base64'), ...(image.seed === undefined ? {} : { seed: image.seed }) })),
        providerMeta: result.providerMeta,
      };
    }),
    log: (limit?: number) => run(async () => ({ records: await images.log(limit) })),
  };
}
