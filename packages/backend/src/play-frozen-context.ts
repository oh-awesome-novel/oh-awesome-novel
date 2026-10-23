import { open, readdir, realpath, lstat, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { buildPlayFrozenSystemPrompt } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
/** Capture host-owned permanent files once at session creation, including Forge/import starts. */
const MAX_PERMANENT_FILE_BYTES = 64 * 1024;
const MAX_PERMANENT_CONTEXT_BYTES = 256 * 1024;
export async function freezePlayPermanentContext(workspaceRoot: string, session: PlaySession, activatedContext = ''): Promise<void> {
  if (session.schemaVersion !== 4) return;
  const root = await realpath(workspaceRoot);
  // Activated launch sources are already excerpted by the source loader; keep the prefix bounded without rejecting launch.
  const activated = truncateUtf8(activatedContext, MAX_PERMANENT_CONTEXT_BYTES);
  const blocks = [activated.text];
  const notes: string[] = activated.truncated ? ['Activated source context was truncated to the permanent context budget.'] : [];
  let totalBytes = Buffer.byteLength(activated.text);
  const paths = ['world/rules.md', ...session.characters.filter(id => /^[a-zA-Z0-9_-]+$/.test(id)).map(id => `characters/${id}/profile.md`)];
  try {
    await rejectLinks(root, '.oan/constitution');
    const directory = await realpath(join(root, '.oan/constitution'));
    assertInside(root, directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.md')) paths.push(`.oan/constitution/${entry.name}`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const path of paths.sort()) {
    try {
      await rejectLinks(root, path);
      const file = await realpath(join(root, path)); assertInside(root, file);
      const info = await stat(file);
      if (!info.isFile() || info.nlink !== 1) throw new Error(`Permanent Play context is invalid: ${path}`);
      const read = await readUtf8Prefix(file, MAX_PERMANENT_FILE_BYTES);
      if (read.text.includes('\0')) throw new Error(`Permanent Play context is invalid: ${path}`);
      const remaining = MAX_PERMANENT_CONTEXT_BYTES - totalBytes;
      if (remaining <= 0) { notes.push(`${path} omitted: permanent context budget is full.`); continue; }
      const block = truncateUtf8(`## ${path}\n${read.text}`, remaining);
      if (read.truncated || block.truncated) notes.push(`${path} truncated to fit the permanent context budget.`);
      totalBytes += Buffer.byteLength(block.text);
      blocks.push(block.text);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (notes.length) blocks.push(['## Permanent context budget', ...notes.map(note => `- ${note}`)].join('\n'));
  session.metadataExtensions.frozenSystemPrompt = buildPlayFrozenSystemPrompt(session, blocks.join('\n\n'));
}
async function readUtf8Prefix(file: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    const truncated = length > maxBytes;
    return { text: utf8Prefix(buffer.subarray(0, Math.min(length, maxBytes))), truncated };
  } finally { await handle.close(); }
}
function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text);
  return bytes.length <= maxBytes ? { text, truncated: false } : { text: utf8Prefix(bytes.subarray(0, Math.max(0, maxBytes))), truncated: true };
}
/** Decode without leaving a split multi-byte character at the end. */
function utf8Prefix(bytes: Buffer): string {
  let end = bytes.length;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const byte = bytes[end - back]!;
    if ((byte & 0xc0) === 0x80) continue;
    const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (width > back) end -= back;
    break;
  }
  return bytes.subarray(0, end).toString('utf8');
}
function assertInside(root: string, file: string): void {
  const path = relative(root, file);
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error('Permanent Play context resolves outside workspace.');
}

async function rejectLinks(root: string, path: string): Promise<void> {
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    const entry = await lstat(cursor);
    if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink !== 1)) throw new Error(`Permanent Play context links are forbidden: ${path}`);
  }
}
