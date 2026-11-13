import { createOanRequestError } from './play-rehearsal.js';

/** Largest image the asset folder accepts; mirrors the backend limit. */
export const IMAGE_ASSET_MAX_BYTES = 16 * 1024 * 1024;

export type ImageAssetMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** One file in the workspace's Git-ignored `assets/` folder. */
export interface ImageAssetEntry {
  /** Workspace-relative path; the only thing formal files record. */
  path: string;
  name: string;
  bytes: number;
  /** Set when the file is a readable image of its declared type. */
  mime?: ImageAssetMime;
  /** Why the file cannot be shown. */
  problem?: string;
}

export interface ImageAssetClientMethods {
  /** Images in `assets/portraits/<characterId>/`. */
  listPortraitImages(characterId: string, signal?: AbortSignal): Promise<{ directory: string; images: ImageAssetEntry[] }>;
  /**
   * Copies a local image the author picked into the character's portrait folder. Nothing is
   * overwritten: `reused` is true when the same bytes were already there.
   */
  importPortraitImage(characterId: string, file: { name: string; data: Blob | ArrayBuffer | Uint8Array }, signal?: AbortSignal): Promise<{ image: ImageAssetEntry; reused: boolean; gitIgnored: boolean }>;
  /** The original image bytes for display. Rejects with the reason when the file is missing or damaged. */
  readImageAsset(path: string, signal?: AbortSignal): Promise<Blob>;
  /** Asset images no formal file mentions. */
  listUnreferencedImageAssets(signal?: AbortSignal): Promise<{ images: ImageAssetEntry[] }>;
  /** Deletes one image the author chose; refused while a formal file still refers to it. */
  deleteImageAsset(path: string): Promise<{ deleted: string }>;
}

type Request = <T>(path: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => Promise<T>;

const CHARACTER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const ASSET_PATH = /^assets(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|jpg|jpeg|webp)$/i;
const MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

export function isImageAssetPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 240 && ASSET_PATH.test(value) && !value.includes('..');
}

export function createImageAssetClientMethods(request: Request, fetcher: typeof fetch, baseUrl: string): ImageAssetClientMethods {
  const portraits = (characterId: string): string => {
    if (!CHARACTER_ID.test(characterId)) throw new Error('角色 id 无效。');
    return `/api/workspace/image-assets/portraits/${encodeURIComponent(characterId)}`;
  };
  const filePath = (path: string): string => {
    if (!isImageAssetPath(path)) throw new Error('图片路径无效。');
    return `/api/workspace/image-assets/file?path=${encodeURIComponent(path)}`;
  };
  return {
    async listPortraitImages(characterId, signal) {
      const value = await request<unknown>(portraits(characterId), { signal });
      if (!record(value) || value.directory !== `assets/portraits/${characterId}` || !entries(value.images)) throw new Error('图片列表响应无效。');
      return { directory: value.directory, images: value.images };
    },
    async importPortraitImage(characterId, file, signal) {
      const url = `${portraits(characterId)}?name=${encodeURIComponent(file.name)}`;
      const size = file.data instanceof Blob ? file.data.size : file.data.byteLength;
      if (size > IMAGE_ASSET_MAX_BYTES) throw new Error('图片超过 16 MiB 的上限。');
      const response = await fetcher(`${baseUrl}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file.data as BodyInit,
        signal,
      });
      const value = await readJson(response);
      if (!response.ok) throw createOanRequestError(response, value, '图片导入失败。');
      if (!record(value) || !entry(value.image) || typeof value.reused !== 'boolean' || typeof value.gitIgnored !== 'boolean'
        || !value.image.path.startsWith(`assets/portraits/${characterId}/`)) throw new Error('图片导入响应无效。');
      return { image: value.image, reused: value.reused, gitIgnored: value.gitIgnored };
    },
    async readImageAsset(path, signal) {
      const response = await fetcher(`${baseUrl}${filePath(path)}`, { method: 'GET', signal });
      if (!response.ok) throw createOanRequestError(response, await readJson(response), '图片无法读取。');
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!MIMES.includes(type)) throw new Error('图片响应无效。');
      return new Blob([await response.arrayBuffer()], { type });
    },
    async listUnreferencedImageAssets(signal) {
      const value = await request<unknown>('/api/workspace/image-assets/unreferenced', { signal });
      if (!record(value) || !entries(value.images)) throw new Error('图片列表响应无效。');
      return { images: value.images };
    },
    async deleteImageAsset(path) {
      const value = await request<unknown>(filePath(path), { method: 'DELETE' });
      if (!record(value) || value.deleted !== path) throw new Error('图片删除响应无效。');
      return { deleted: path };
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text.trim() ? JSON.parse(text) as unknown : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entry(value: unknown): value is ImageAssetEntry {
  return record(value) && isImageAssetPath(value.path) && typeof value.name === 'string' && value.path.endsWith(`/${value.name}`)
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0
    && (value.mime === undefined || MIMES.includes(value.mime as string))
    && (value.problem === undefined || (typeof value.problem === 'string' && value.problem.length <= 500));
}

function entries(value: unknown): value is ImageAssetEntry[] {
  return Array.isArray(value) && value.length <= 5000 && value.every(entry);
}
