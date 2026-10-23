import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
/** Small raster-only local portraits. Snapshotted bytes avoid live-file branch drift. */
export async function readCharacterPortrait(root: string, path: string): Promise<string> {
  if (!/^[\w/-]+\.(png|jpg|jpeg|webp)$/i.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part.startsWith('.'))) throw new Error('Unsafe portrait path.');
  const canonicalRoot = await realpath(root);
  let cursor = canonicalRoot;
  for (const part of path.split('/').slice(0, -1)) {
    cursor = join(cursor, part);
    const entry = await lstat(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory() || await realpath(cursor) !== cursor) throw new Error('Unsafe portrait directory.');
  }
  const absolute = join(canonicalRoot, path);
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 256 * 1024) throw new Error('Portrait must be a raster file under 256 KiB.');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) { const read = await file.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    const bytes = buffer.subarray(0, length);
    const current = await lstat(absolute);
    const after = await file.stat();
    if (bytes.length !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()) throw new Error('Portrait changed while reading.');
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : undefined;
    if (!mime) throw new Error('Portrait is not a supported raster image.');
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } finally { await file.close(); }
}
