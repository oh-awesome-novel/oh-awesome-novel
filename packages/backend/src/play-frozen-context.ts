import { readdir, readFile, realpath, lstat, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { buildPlayFrozenSystemPrompt } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
/** Capture host-owned permanent files once at session creation, including Forge/import starts. */
export async function freezePlayPermanentContext(workspaceRoot: string, session: PlaySession, activatedContext = ''): Promise<void> {
  if (session.schemaVersion !== 4) return;
  const root = await realpath(workspaceRoot);
  const blocks = [activatedContext];
  let totalBytes = Buffer.byteLength(activatedContext);
  if (totalBytes > 256 * 1024) throw new Error('Permanent Play context exceeds total limit.');
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
      if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024) throw new Error(`Permanent Play context is invalid or too large: ${path}`);
      const content = await readFile(file, 'utf8');
      if (Buffer.byteLength(content) > 64 * 1024 || content.includes('\0')) throw new Error(`Permanent Play context is invalid: ${path}`);
      totalBytes += Buffer.byteLength(content);
      if (totalBytes > 256 * 1024) throw new Error('Permanent Play context exceeds total limit.');
      blocks.push(`## ${path}\n${content}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  session.metadataExtensions.frozenSystemPrompt = buildPlayFrozenSystemPrompt(session, blocks.join('\n\n'));
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
