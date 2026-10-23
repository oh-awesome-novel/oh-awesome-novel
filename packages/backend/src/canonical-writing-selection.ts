import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadCanonicalWritingContext, selectCanonicalWritingSourcePaths } from './canonical-writing-context.js';
const LIMIT = 16 * 1024;
async function directory(root: string): Promise<string> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Unsafe Writing selection workspace.');
  let path = await realpath(root);
  for (const segment of ['.workspace', 'writing']) {
    path = join(path, segment);
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe Writing selection directory.');
  }
  return path;
}
function validate(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(path => typeof path !== 'string') || value.length > 16 || new Set(value).size !== value.length) throw new Error('Invalid Writing sources.');
  const selected = selectCanonicalWritingSourcePaths(value);
  if (selected.length !== value.length) throw new Error('Invalid Writing source path.');
  return [...value];
}
export async function readCanonicalWritingSources(root: string): Promise<string[]> {
  const path = join(await directory(root), 'selected-sources.json');
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > LIMIT) throw new Error('Unsafe Writing selection file.');
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    if (offset !== info.size) throw new Error('Writing selection changed while reading.');
    const value = JSON.parse(bytes.subarray(0, offset).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) throw new Error('Unsupported Writing selection.');
    return validate(value.sourcePaths);
  } finally { await handle.close(); }
}
export async function saveCanonicalWritingSources(root: string, value: unknown): Promise<string[]> {
  const paths = validate(value);
  const context = await loadCanonicalWritingContext(root, paths);
  const dir = await directory(root);
  const lock = join(dir, 'selected-sources.lock');
  const owner = await open(lock, 'wx', 0o600);
  const temp = join(dir, `.${randomUUID()}.tmp`);
  try {
    await context.assertFresh();
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, sourcePaths: paths })); await handle.sync(); }
    finally { await handle.close(); }
    await context.assertFresh();
    await rename(temp, join(dir, 'selected-sources.json'));
    return paths;
  } finally { await unlink(temp).catch(() => undefined); await owner.close(); await unlink(lock); }
}
