import type { Context } from 'hono';
import {
  addPortraitImage, deleteUnreferencedImageAsset, IMAGE_ASSET_GITIGNORE_PATTERN, IMAGE_ASSET_MAX_BYTES, IMAGE_ASSET_ROOT,
  ImageAssetError, listPortraitImages, listUnreferencedImageAssets, portraitAssetDirectory, readImageAsset,
} from '@oh-awesome-novel/core';
import type { ImageAssetErrorCode } from '@oh-awesome-novel/core';
import { ensureGitLocalExclude } from '@oh-awesome-novel/tools';

const STATUS: Readonly<Record<ImageAssetErrorCode, number>> = {
  invalid_path: 400,
  invalid_character: 400,
  invalid_name: 400,
  empty: 400,
  unsupported_type: 415,
  signature_mismatch: 415,
  too_large: 413,
  missing: 404,
  unsafe_file: 422,
  referenced: 409,
  too_many: 409,
};

/**
 * Image asset endpoints. They read and add files in the workspace's Git-ignored `assets/`
 * folder only; no formal file, candidate or PendingAction is touched, and nothing here is
 * reachable from a model tool.
 */
export function createImageAssetHandlers(input: { getWorkspaceRoot(): string }) {
  function json(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  function failure(error: unknown): Response {
    if (error instanceof ImageAssetError) return json(STATUS[error.code], { error: error.message, code: error.code });
    return json(500, { error: '图片资源操作失败。', code: 'image_asset_failed' });
  }
  /** Exactly the named query parameters, each given once. */
  function query(context: Context, names: readonly string[]): Record<string, string> {
    const params = new URL(context.req.url).searchParams;
    if ([...params.keys()].some(key => !names.includes(key)) || names.some(name => params.getAll(name).length !== 1)) {
      throw new ImageAssetError('invalid_path', '请求参数无效。');
    }
    return Object.fromEntries(names.map(name => [name, params.get(name)!]));
  }

  return {
    async listPortraits(context: Context, characterId: string): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        return json(200, { directory: portraitAssetDirectory(characterId), images: await listPortraitImages(root, characterId) });
      } catch (error) { return failure(error); }
    },

    /** The author picked a local file: its raw bytes are the request body. */
    async importPortrait(context: Context, characterId: string): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        portraitAssetDirectory(characterId);
        const { name } = query(context, ['name']);
        const declared = Number(context.req.header('content-length'));
        if (Number.isFinite(declared) && declared > IMAGE_ASSET_MAX_BYTES) throw new ImageAssetError('too_large', '图片超过 16 MiB 的上限。');
        const bytes = await readBoundedBody(context, IMAGE_ASSET_MAX_BYTES);
        // An existing workspace may not ignore the folder yet; this only edits the local, uncommitted exclude file.
        const ignore = await ensureGitLocalExclude(root, IMAGE_ASSET_GITIGNORE_PATTERN, `${IMAGE_ASSET_ROOT}/probe.png`).catch(() => 'unknown' as const);
        const result = await addPortraitImage(root, { characterId, fileName: name!, bytes });
        return json(result.reused ? 200 : 201, { ...result, gitIgnored: ignore === 'ignored' || ignore === 'added' });
      } catch (error) { return failure(error); }
    },

    /** The original bytes, for display only. */
    async read(context: Context): Promise<Response> {
      try {
        const { path } = query(context, ['path']);
        const content = await readImageAsset(input.getWorkspaceRoot(), path!);
        return new Response(new Uint8Array(content.bytes), {
          status: 200,
          headers: {
            'Content-Type': content.mime,
            'Content-Length': String(content.bytes.length),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
          },
        });
      } catch (error) { return failure(error); }
    },

    async listUnreferenced(): Promise<Response> {
      try {
        return json(200, { images: await listUnreferencedImageAssets(input.getWorkspaceRoot()) });
      } catch (error) { return failure(error); }
    },

    async remove(context: Context): Promise<Response> {
      try {
        const { path } = query(context, ['path']);
        await deleteUnreferencedImageAsset(input.getWorkspaceRoot(), path!);
        return json(200, { deleted: path });
      } catch (error) { return failure(error); }
    },
  };
}

async function readBoundedBody(context: Context, maxBytes: number): Promise<Uint8Array> {
  const reader = context.req.raw.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ImageAssetError('too_large', '图片超过 16 MiB 的上限。');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
