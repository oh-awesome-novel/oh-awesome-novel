import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseForgeDraft } from '@oh-awesome-novel/core';
import type { ForgeDraft } from '@oh-awesome-novel/core';

const LIMIT = 2 * 1024 * 1024;
export const FORGE_LOCK_TTL_MS = 3 * 60 * 1000;
/** A live holder refreshes its lease well inside the TTL, so long model pipelines keep the lock. */
const FORGE_LOCK_HEARTBEAT_MS = 30 * 1000;
/** Locks held by this process; checked synchronously so concurrent requests never interleave on one draft. */
const heldLocks = new Set<string>();

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
  // Callers hold the draft lock; the lock file is released by withForgeDraftLock.
  await unlink(join(dir, `${id}.yaml`)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
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
async function isStaleForgeLock(path: string): Promise<boolean> {
  let info;
  try { info = await lstat(path); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
  // Live holders heartbeat the mtime, so an old mtime means the holder is gone.
  if (Date.now() - info.mtimeMs > FORGE_LOCK_TTL_MS) return true;
  let owner: { pid?: unknown };
  try { owner = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown }; }
  catch { return false; } // A holder may not have written its record yet; wait for the TTL instead.
  if (typeof owner?.pid !== 'number') return false;
  // Same process but not in heldLocks: an orphan left by an earlier failed release.
  if (owner.pid === process.pid) return !heldLocks.has(path);
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}
/**
 * A cross-process exclusive lock. Holders write {pid, token} and heartbeat the lease; a lock is
 * reclaimed only when its lease expired or its process is gone, and a holder releases the file
 * only while it still carries its own token.
 */
export async function withForgeDraftLock<T>(root: string, id: string, fn: () => Promise<T>): Promise<T> {
  assertForgeId(id);
  const path = join(await directory(root), `${id}.lock`);
  if (heldLocks.has(path)) throw new Error('Forge draft is busy; reload before retrying.');
  heldLocks.add(path);
  try {
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!await isStaleForgeLock(path)) throw new Error('Forge draft is busy; reload before retrying.');
      await unlink(path).catch(() => undefined);
      try { handle = await open(path, 'wx', 0o600); }
      catch { throw new Error('Forge draft is busy; reload before retrying.'); }
    }
    const token = randomUUID();
    const heartbeat = setInterval(() => { const now = new Date(); void utimes(path, now, now).catch(() => undefined); }, FORGE_LOCK_HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }), 'utf8');
      await handle.sync();
      return await fn();
    } finally {
      clearInterval(heartbeat);
      await handle.close();
      const owner = await readFile(path, 'utf8').then(text => JSON.parse(text) as { token?: unknown }, () => undefined);
      if (owner?.token === token) await unlink(path).catch(() => undefined);
    }
  } finally {
    heldLocks.delete(path);
  }
}
