import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseForgeDraft } from '@oh-awesome-novel/core';
import type { ForgeDraft } from '@oh-awesome-novel/core';

const LIMIT = 2 * 1024 * 1024;
export const FORGE_LOCK_TTL_MS = 3 * 60 * 1000;

export function assertForgeId(id: string): void {
  if (!/^forge_[a-f0-9-]{36}$/u.test(id)) throw new Error('Invalid Forge draft id.');
}
async function directory(root: string): Promise<string> {
  let current = root;
  for (const name of ['.workspace', 'forge', 'drafts']) {
    current = join(current, name);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe Forge draft directory.');
  }
  return current;
}
export async function readForgeDraft(root: string, id: string): Promise<ForgeDraft> {
  assertForgeId(id);
  const path = join(await directory(root), `${id}.yaml`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > LIMIT) throw new Error('Unsafe Forge draft.');
    // JSON is a YAML subset; avoiding YAML aliases keeps internal drafts bounded.
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > LIMIT) throw new Error('Forge draft exceeds size limit.');
    const draft = parseForgeDraft(JSON.parse(text));
    if (draft.id !== id) throw new Error('Forge draft identity mismatch.');
    return draft;
  } finally { await handle.close(); }
}
export async function listForgeDrafts(root: string): Promise<ForgeDraft[]> {
  const files = await readdir(await directory(root));
  const ids = files.filter(name => /^forge_[a-f0-9-]{36}\.yaml$/u.test(name));
  const drafts = await Promise.all(ids.map(name => readForgeDraft(root, name.slice(0, -5))));
  return drafts.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || b.revision - a.revision).slice(0, 100);
}
export async function deleteForgeDraft(root: string, id: string): Promise<void> {
  assertForgeId(id);
  const dir = await directory(root);
  await unlink(join(dir, `${id}.yaml`)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await unlink(join(dir, `${id}.lock`)).catch(() => undefined);
}
export async function saveForgeDraft(root: string, draft: ForgeDraft): Promise<void> {
  if (draft.updatedAt === undefined) draft.updatedAt = Date.now();
  parseForgeDraft(draft);
  const dir = await directory(root);
  const text = JSON.stringify(draft, null, 2);
  if (Buffer.byteLength(text) > LIMIT) throw new Error('Forge draft exceeds size limit.');
  const temp = join(dir, `.${draft.id}.${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temp, join(dir, `${draft.id}.yaml`)); }
  finally { await unlink(temp).catch(() => undefined); }
}
/** A cross-process exclusive lock with lease self-healing for crashed processes. */
export async function withForgeDraftLock<T>(root: string, id: string, fn: () => Promise<T>): Promise<T> {
  assertForgeId(id);
  const path = join(await directory(root), `${id}.lock`);
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      let isStale = false;
      try {
        const lockStat = await lstat(path);
        if (Date.now() - lockStat.mtimeMs > FORGE_LOCK_TTL_MS) {
          isStale = true;
        } else {
          const content = await readFile(path, 'utf8');
          const data = JSON.parse(content);
          if (typeof data?.pid === 'number') {
            try { process.kill(data.pid, 0); }
            catch (killErr: unknown) {
              if ((killErr as NodeJS.ErrnoException).code === 'ESRCH') isStale = true;
            }
          }
        }
      } catch {
        isStale = true;
      }
      if (isStale) {
        await unlink(path).catch(() => undefined);
        try {
          handle = await open(path, 'wx', 0o600);
        } catch {
          throw new Error('Forge draft is busy; reload before retrying.');
        }
      } else {
        throw new Error('Forge draft is busy; reload before retrying.');
      }
    } else {
      throw error;
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
    await handle.sync();
    return await fn();
  } finally {
    await handle.close();
    await unlink(path).catch(() => undefined);
  }
}
