import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Image assets live in the workspace's `assets/` folder: a plain, author-visible folder that
 * Git ignores. Formal novel files only record an image's path; the bytes never enter Git,
 * a candidate change set, or anything a model reads. Files are only ever added, never overwritten.
 */
export const IMAGE_ASSET_ROOT = 'assets';
export const PORTRAIT_ASSET_DIRECTORY = 'assets/portraits';
/** The line that keeps the asset folder out of Git. */
export const IMAGE_ASSET_GITIGNORE_PATTERN = '/assets/';
export const IMAGE_ASSET_MAX_BYTES = 16 * 1024 * 1024;
export const IMAGE_ASSET_LIMITS = {
  maxBytes: IMAGE_ASSET_MAX_BYTES,
  /** Entries visited when listing or scanning the asset folder. */
  maxEntries: 5000,
  maxDepth: 8,
  maxPathLength: 240,
  maxNameStem: 60,
  /** Formal text files larger than this are not scanned for references. */
  maxReferenceFileBytes: 2 * 1024 * 1024,
} as const;

export type ImageAssetMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type ImageAssetErrorCode =
  | 'invalid_path'
  | 'invalid_character'
  | 'invalid_name'
  | 'unsupported_type'
  | 'signature_mismatch'
  | 'too_large'
  | 'empty'
  | 'missing'
  | 'unsafe_file'
  | 'referenced'
  | 'too_many';

export class ImageAssetError extends Error {
  readonly code: ImageAssetErrorCode;
  constructor(code: ImageAssetErrorCode, message: string) {
    super(message);
    this.name = 'ImageAssetError';
    this.code = code;
  }
}

export interface ImageAssetEntry {
  /** Workspace-relative path, the only thing a formal file records. */
  path: string;
  name: string;
  bytes: number;
  /** Present when the file is a readable image of its declared type. */
  mime?: ImageAssetMime;
  /** Why the file cannot be shown, in the author's language. */
  problem?: string;
}

export interface ImageAssetContent {
  path: string;
  mime: ImageAssetMime;
  bytes: Buffer;
  sha256: string;
}

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(png|jpg|jpeg|webp)$/i;
const CHARACTER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const EXTENSION_MIME: Readonly<Record<string, ImageAssetMime>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const FORMAL_TEXT_ROOTS = ['chapters', 'characters', 'world', 'state', 'timeline', 'foreshadow', 'summaries', 'outline'] as const;

/** Recognises a raster image by its signature; the extension is never trusted on its own. */
export function detectImageAssetMime(bytes: Uint8Array): ImageAssetMime | undefined {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/**
 * Checks the shape of an image path as formal files record it. It does not require the
 * file to exist: images do not travel with Git, so a missing file is normal after a clone.
 */
export function assertImageAssetPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > IMAGE_ASSET_LIMITS.maxPathLength) {
    throw new ImageAssetError('invalid_path', '图片路径无效。');
  }
  const segments = value.split('/');
  if (
    segments.length < 2 || segments.length > IMAGE_ASSET_LIMITS.maxDepth + 1 || segments[0] !== IMAGE_ASSET_ROOT
    || !segments.slice(0, -1).every(segment => SEGMENT.test(segment) && !segment.includes('..'))
    || !FILE_NAME.test(segments.at(-1)!) || segments.at(-1)!.includes('..')
  ) {
    throw new ImageAssetError('invalid_path', `图片必须位于 ${IMAGE_ASSET_ROOT}/ 目录内，路径只能包含字母、数字、“_”和“-”，扩展名为 png、jpg、jpeg 或 webp。`);
  }
  return value;
}

export function isImageAssetPath(value: unknown): value is string {
  try {
    assertImageAssetPath(value);
    return true;
  } catch {
    return false;
  }
}

export function portraitAssetDirectory(characterId: string): string {
  if (typeof characterId !== 'string' || !CHARACTER_ID.test(characterId)) {
    throw new ImageAssetError('invalid_character', '角色 id 无效。');
  }
  return `${PORTRAIT_ASSET_DIRECTORY}/${characterId}`;
}

/** Lists the images in one character's portrait folder. A missing folder is an empty list. */
export async function listPortraitImages(workspaceRoot: string, characterId: string): Promise<ImageAssetEntry[]> {
  const directory = portraitAssetDirectory(characterId);
  const root = await realpath(workspaceRoot);
  const absolute = await resolveAssetDirectory(root, directory, false);
  if (!absolute) return [];
  const entries: ImageAssetEntry[] = [];
  for (const name of (await readdir(absolute)).sort()) {
    if (!FILE_NAME.test(name)) continue;
    if (entries.length >= IMAGE_ASSET_LIMITS.maxEntries) break;
    entries.push(await describeImage(root, `${directory}/${name}`));
  }
  return entries;
}

/**
 * Adds an image to a character's portrait folder: an import of a file the author picked, or an
 * image the host produced and the author adopted. Never overwrites: a taken name gets a numeric
 * suffix, and bytes already present in the folder are reused instead of written again.
 */
export async function addPortraitImage(
  workspaceRoot: string,
  input: { characterId: string; fileName: string; bytes: Uint8Array },
): Promise<{ image: ImageAssetEntry; reused: boolean }> {
  const directory = portraitAssetDirectory(input.characterId);
  const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  if (bytes.length === 0) throw new ImageAssetError('empty', '图片文件是空的。');
  if (bytes.length > IMAGE_ASSET_MAX_BYTES) throw new ImageAssetError('too_large', `图片超过 ${formatMiB(IMAGE_ASSET_MAX_BYTES)} 的上限。`);
  const { stem, extension } = splitImageFileName(input.fileName);
  const mime = detectImageAssetMime(bytes);
  if (!mime) throw new ImageAssetError('unsupported_type', '只支持 PNG、JPEG 和 WebP 图片。');
  if (EXTENSION_MIME[extension] !== mime) {
    throw new ImageAssetError('signature_mismatch', `文件内容是 ${mimeLabel(mime)}，与扩展名 .${extension} 不一致。`);
  }

  const root = await realpath(workspaceRoot);
  const absolute = (await resolveAssetDirectory(root, directory, true))!;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  for (const name of (await readdir(absolute)).sort()) {
    if (!FILE_NAME.test(name)) continue;
    const info = await lstat(join(absolute, name));
    if (!info.isFile() || info.size !== bytes.length) continue;
    const existing = await readImageAsset(root, `${directory}/${name}`).catch(() => undefined);
    if (existing?.sha256 === sha256) {
      return { image: { path: existing.path, name, bytes: bytes.length, mime: existing.mime }, reused: true };
    }
  }

  for (let attempt = 1; attempt <= 1000; attempt += 1) {
    const name = `${attempt === 1 ? stem : `${stem}-${attempt}`}.${extension}`;
    let handle;
    try {
      // Exclusive create: an existing file of this name is never opened for writing.
      handle = await open(join(absolute, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { image: { path: `${directory}/${name}`, name, bytes: bytes.length, mime }, reused: false };
  }
  throw new ImageAssetError('too_many', '这个文件名已有太多同名图片，请换一个文件名。');
}

/** Reads the original bytes of an asset image for display: no scaling, no transcoding. */
export async function readImageAsset(workspaceRoot: string, path: string): Promise<ImageAssetContent> {
  assertImageAssetPath(path);
  const root = await realpath(workspaceRoot);
  const segments = path.split('/');
  const directory = await resolveAssetDirectory(root, segments.slice(0, -1).join('/'), false);
  if (!directory) throw new ImageAssetError('missing', '图片文件不存在。图片不随 Git 同步，换一台机器后需要重新放入。');
  const absolute = join(directory, segments.at(-1)!);
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new ImageAssetError('missing', '图片文件不存在。图片不随 Git 同步，换一台机器后需要重新放入。');
    if (code === 'ELOOP' || code === 'EMLINK') throw new ImageAssetError('unsafe_file', '图片是符号链接，不能读取。');
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) throw new ImageAssetError('unsafe_file', '图片不是普通文件，不能读取。');
    if (before.size > IMAGE_ASSET_MAX_BYTES) throw new ImageAssetError('too_large', `图片超过 ${formatMiB(IMAGE_ASSET_MAX_BYTES)} 的上限。`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      throw new ImageAssetError('unsafe_file', '图片在读取时发生了变化，请重试。');
    }
    const mime = detectImageAssetMime(bytes);
    if (!mime) throw new ImageAssetError('unsupported_type', '文件不是可识别的 PNG、JPEG 或 WebP 图片，可能已损坏。');
    const extension = segments.at(-1)!.split('.').at(-1)!.toLowerCase();
    if (EXTENSION_MIME[extension] !== mime) {
      throw new ImageAssetError('signature_mismatch', `文件内容是 ${mimeLabel(mime)}，与扩展名 .${extension} 不一致。`);
    }
    return { path, mime, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally {
    await handle.close();
  }
}

/**
 * Asset images whose path no formal text file mentions. Listing never deletes anything;
 * the author decides what to remove.
 */
export async function listUnreferencedImageAssets(workspaceRoot: string): Promise<ImageAssetEntry[]> {
  const root = await realpath(workspaceRoot);
  const paths = await collectAssetImagePaths(root);
  if (!paths.length) return [];
  const referenced = await findReferencedPaths(root, paths);
  const entries: ImageAssetEntry[] = [];
  for (const path of paths) {
    if (!referenced.has(path)) entries.push(await describeImage(root, path));
  }
  return entries;
}

/** Deletes one asset image the author chose, and only while no formal file refers to it. */
export async function deleteUnreferencedImageAsset(workspaceRoot: string, path: string): Promise<void> {
  assertImageAssetPath(path);
  const root = await realpath(workspaceRoot);
  const segments = path.split('/');
  const directory = await resolveAssetDirectory(root, segments.slice(0, -1).join('/'), false);
  if (!directory) throw new ImageAssetError('missing', '图片文件不存在。');
  const absolute = join(directory, segments.at(-1)!);
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ImageAssetError('missing', '图片文件不存在。');
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new ImageAssetError('unsafe_file', '图片不是普通文件，不能删除。');
  if ((await findReferencedPaths(root, [path])).has(path)) {
    throw new ImageAssetError('referenced', '这张图片仍被正式文件引用，不能删除。请先修改引用它的路径。');
  }
  await unlink(absolute);
}

function splitImageFileName(fileName: unknown): { stem: string; extension: string } {
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255 || /[\x00-\x1f\x7f]/u.test(fileName)) {
    throw new ImageAssetError('invalid_name', '图片文件名无效。');
  }
  // Only the last path component of whatever the author's system reported.
  const base = fileName.split(/[/\\]/).at(-1)!.trim();
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (!Object.hasOwn(EXTENSION_MIME, extension)) {
    throw new ImageAssetError('unsupported_type', '只支持扩展名为 png、jpg、jpeg 或 webp 的图片。');
  }
  // Stored names are ASCII so every formal file can quote the path without escaping.
  const stem = base.slice(0, dot)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, IMAGE_ASSET_LIMITS.maxNameStem);
  return { stem: stem || 'image', extension };
}

/**
 * Resolves a directory under the workspace one segment at a time, refusing symbolic links
 * and anything that leaves the canonical root. Returns undefined when it does not exist
 * and `create` is false.
 */
async function resolveAssetDirectory(root: string, directory: string, create: boolean): Promise<string | undefined> {
  let cursor = root;
  for (const segment of directory.split('/')) {
    if (!SEGMENT.test(segment) || segment.includes('..')) throw new ImageAssetError('invalid_path', '图片目录路径无效。');
    cursor = join(cursor, segment);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!create) return undefined;
      await mkdir(cursor);
      info = await lstat(cursor);
    }
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(cursor) !== cursor) {
      throw new ImageAssetError('unsafe_file', `图片目录不是普通文件夹：${directory}`);
    }
  }
  return cursor;
}

async function describeImage(root: string, path: string): Promise<ImageAssetEntry> {
  const name = path.split('/').at(-1)!;
  try {
    const content = await readImageAsset(root, path);
    return { path, name, bytes: content.bytes.length, mime: content.mime };
  } catch (error) {
    const info = await lstat(join(root, ...path.split('/'))).catch(() => undefined);
    return {
      path,
      name,
      bytes: info?.isFile() ? info.size : 0,
      problem: error instanceof ImageAssetError ? error.message : '图片无法读取。',
    };
  }
}

async function collectAssetImagePaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  let visited = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    const absolute = await resolveAssetDirectory(root, directory, false).catch(() => undefined);
    if (!absolute || depth > IMAGE_ASSET_LIMITS.maxDepth) return;
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : 1)) {
      if (++visited > IMAGE_ASSET_LIMITS.maxEntries) return;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SEGMENT.test(entry.name)) await walk(path, depth + 1);
      } else if (entry.isFile() && isImageAssetPath(path)) {
        paths.push(path);
      }
    }
  }
  await walk(IMAGE_ASSET_ROOT, 1);
  return paths;
}

/** Which of `paths` appear, as text, in the workspace's formal Markdown and YAML files. */
async function findReferencedPaths(root: string, paths: readonly string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  let visited = 0;
  async function walk(absolute: string, depth: number): Promise<void> {
    if (depth > 24 || referenced.size === paths.length) return;
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (++visited > 50_000) return;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
      } else if (entry.isFile() && /\.(?:md|ya?ml)$/i.test(entry.name)) {
        const info = await lstat(child);
        if (info.size > IMAGE_ASSET_LIMITS.maxReferenceFileBytes) continue;
        const handle = await open(child, constants.O_RDONLY | constants.O_NOFOLLOW);
        let text: string;
        try {
          text = await handle.readFile('utf8');
        } finally {
          await handle.close();
        }
        for (const path of paths) if (text.includes(path)) referenced.add(path);
      }
    }
  }
  for (const directory of FORMAL_TEXT_ROOTS) await walk(join(root, directory), 1);
  return referenced;
}

function mimeLabel(mime: ImageAssetMime): string {
  return mime === 'image/png' ? 'PNG' : mime === 'image/jpeg' ? 'JPEG' : 'WebP';
}

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
