import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseForgeDraft } from '@oh-awesome-novel/core';
import type { ForgeDraft } from '@oh-awesome-novel/core';

const LIMIT = 2 * 1024 * 1024;
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
  const ids = files.filter(name => /^forge_[a-f0-9-]{36}\.yaml$/u.test(name)).sort().slice(-100);
  return Promise.all(ids.map(name => readForgeDraft(root, name.slice(0, -5))));
}
export async function saveForgeDraft(root: string, draft: ForgeDraft): Promise<void> {
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
/** A cross-process exclusive lock. A crashed writer fails closed; no lease stealing. */
export async function withForgeDraftLock<T>(root: string, id: string, fn: () => Promise<T>): Promise<T> {
  assertForgeId(id);
  const path = join(await directory(root), `${id}.lock`);
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Forge draft is busy; reload before retrying.');
    throw error;
  }
  try { return await fn(); }
  finally { await handle.close(); await unlink(path); }
}
