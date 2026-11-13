/** Image generation services (app-level settings). The API key is write-only: it is sent when saving and never comes back. */
export type ImageProviderKind = 'comfyui' | 'openai' | 'openai-compatible';
export type ImageGenerationErrorCode = 'unreachable' | 'auth' | 'timeout' | 'content_rejected' | 'invalid_response' | 'workflow' | 'cancelled' | 'config';
export const COMFY_WORKFLOW_SLOTS = ['positive', 'negative', 'seed', 'width', 'height', 'batch', 'lora'] as const;
export type ComfyWorkflowSlot = typeof COMFY_WORKFLOW_SLOTS[number];
export type ComfyWorkflowMapping = Partial<Record<ComfyWorkflowSlot, { node: string; input: string }>>;

export interface ImageProviderView {
  id: string;
  kind: ImageProviderKind;
  displayName: string;
  baseUrl: string;
  model?: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultNegative?: string;
  timeoutMs: number;
  allowRemote?: boolean;
  hasApiKey: boolean;
  workflow?: { sha256: string; mapping: ComfyWorkflowMapping; slots: ComfyWorkflowSlot[]; importedAt: string };
  lastError?: { at: string; code: ImageGenerationErrorCode; message: string };
}

export interface ImageProviderSaveInput {
  id: string;
  kind: ImageProviderKind;
  displayName?: string;
  baseUrl: string;
  model?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultNegative?: string;
  timeoutMs?: number;
  allowRemote?: boolean;
  /** Leave out to keep the stored key. */
  apiKey?: string;
  /** API-format ComfyUI workflow JSON to import. Leave out to keep the stored one. */
  workflowText?: string;
  workflowMapping?: ComfyWorkflowMapping;
}

export interface PortraitImageRequestInput { positive: string; negative?: string; width: number; height: number; seed?: number; count?: number; loraName?: string }
export interface GeneratedPortraitImage { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string; seed?: number }
export interface ImageGenerationLogEntry {
  id: string; createdAt: string; providerId: string; providerKind: ImageProviderKind; modelId?: string;
  endpointOrigin: string; local: boolean; requestedCount: number; width: number; height: number; durationMs: number;
  outcome: 'completed' | 'failed' | 'cancelled'; imageCount: number; errorCode?: ImageGenerationErrorCode;
}

export interface ImageProviderClientMethods {
  listImageProviders(signal?: AbortSignal): Promise<{ providers: ImageProviderView[] }>;
  saveImageProvider(input: ImageProviderSaveInput): Promise<{ providers: ImageProviderView[] }>;
  deleteImageProvider(id: string): Promise<{ providers: ImageProviderView[] }>;
  /** ComfyUI: asks the server for its status. Online services: checks the stored settings only, because a real request costs money. */
  checkImageProvider(id: string): Promise<{ ok: boolean; message: string; latencyMs: number }>;
  generatePortraitImages(id: string, request: PortraitImageRequestInput, signal?: AbortSignal): Promise<{ images: GeneratedPortraitImage[]; providerMeta: Record<string, string | number> }>;
  /** Recent requests: where they went and how they ended, never what was asked for. */
  getImageGenerationLog(limit?: number, signal?: AbortSignal): Promise<{ records: ImageGenerationLogEntry[] }>;
}

type Request = <T>(path: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => Promise<T>;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const KINDS: readonly string[] = ['comfyui', 'openai', 'openai-compatible'];
const MEDIA: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function provider(value: unknown): value is ImageProviderView {
  return record(value) && typeof value.id === 'string' && ID.test(value.id) && KINDS.includes(String(value.kind))
    && typeof value.displayName === 'string' && typeof value.baseUrl === 'string'
    && typeof value.defaultWidth === 'number' && typeof value.defaultHeight === 'number' && typeof value.timeoutMs === 'number'
    && typeof value.hasApiKey === 'boolean'
    // A response that carries a key is refused outright rather than passed to the page.
    && !('apiKey' in value)
    && (value.workflow === undefined || (record(value.workflow) && typeof value.workflow.sha256 === 'string' && Array.isArray(value.workflow.slots) && record(value.workflow.mapping)))
    && (value.lastError === undefined || (record(value.lastError) && typeof value.lastError.message === 'string' && typeof value.lastError.code === 'string'));
}
function providers(value: unknown): { providers: ImageProviderView[] } {
  if (!record(value) || !Array.isArray(value.providers) || !value.providers.every(provider)) throw new Error('生图服务列表响应无效。');
  return { providers: value.providers };
}
function path(id: string, suffix = ''): string {
  if (!ID.test(id)) throw new Error('生图服务 id 无效。');
  return `/api/image-providers/${encodeURIComponent(id)}${suffix}`;
}

export function createImageProviderClientMethods(request: Request): ImageProviderClientMethods {
  return {
    listImageProviders: async (signal) => providers(await request<unknown>('/api/image-providers', { signal })),
    saveImageProvider: async (input) => {
      path(input.id);
      return providers(await request<unknown>('/api/image-providers', { method: 'POST', body: input }));
    },
    deleteImageProvider: async (id) => providers(await request<unknown>(path(id), { method: 'DELETE' })),
    checkImageProvider: async (id) => {
      const value = await request<unknown>(path(id, '/check'), { method: 'POST' });
      if (!record(value) || typeof value.ok !== 'boolean' || typeof value.message !== 'string' || typeof value.latencyMs !== 'number') throw new Error('连通测试响应无效。');
      return { ok: value.ok, message: value.message, latencyMs: value.latencyMs };
    },
    generatePortraitImages: async (id, body, signal) => {
      const value = await request<unknown>(path(id, '/generate'), { method: 'POST', body, signal });
      if (!record(value) || !Array.isArray(value.images) || !value.images.length || !record(value.providerMeta)
        || !value.images.every(image => record(image) && MEDIA.includes(String(image.mediaType)) && typeof image.base64 === 'string' && /^[A-Za-z0-9+/]+=*$/.test(image.base64))) {
        throw new Error('生图响应无效。');
      }
      return { images: value.images as GeneratedPortraitImage[], providerMeta: value.providerMeta as Record<string, string | number> };
    },
    getImageGenerationLog: async (limit, signal) => {
      const value = await request<unknown>(`/api/image-generation/log${limit ? `?limit=${Math.trunc(limit)}` : ''}`, { signal });
      if (!record(value) || !Array.isArray(value.records) || !value.records.every(item => record(item) && typeof item.providerId === 'string' && typeof item.outcome === 'string' && !('prompt' in item))) {
        throw new Error('生图记录响应无效。');
      }
      return { records: value.records as ImageGenerationLogEntry[] };
    },
  };
}
