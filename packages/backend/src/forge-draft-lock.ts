import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const MAX_ATTEMPTS = 3;
const MAX_OWNER_BYTES = 4_096;
const TOKEN_PATTERN = /^[a-f0-9-]{36}$/u;

interface LockOwner {
  pid: number;
  token?: string;
}

interface RecoveryLockOwner extends LockOwner {
  token: string;
}

function busy(): Error {
  return new Error('Forge draft is busy; reload before retrying.');
}

/** Only ESRCH proves an owner has exited. Age, EPERM and invalid metadata do not. */
function ownerHasExited(owner: LockOwner): boolean {
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function readOwner(path: string): Promise<LockOwner | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_OWNER_BYTES) throw busy();
    const raw = await handle.readFile('utf8');
    if (Buffer.byteLength(raw) > MAX_OWNER_BYTES) throw busy();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw busy(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw busy();
    const owner = value as Partial<LockOwner>;
    if (typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid > 2_147_483_647
      || (owner.token !== undefined && (typeof owner.token !== 'string' || !TOKEN_PATTERN.test(owner.token)))) throw busy();
    return { pid: owner.pid, ...(owner.token === undefined ? {} : { token: owner.token }) };
  } finally {
    await handle.close();
  }
}

async function readRecoveryOwner(path: string): Promise<RecoveryLockOwner | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw busy();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const owner = await readOwner(join(path, 'owner.json'));
  // A published recovery directory is always populated before rename.
  if (!owner?.token) throw busy();
  return { pid: owner.pid, token: owner.token };
}

function isContention(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'ENOTEMPTY'
    || (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'));
}

async function fenceRecoveryOwner(path: string, owner: RecoveryLockOwner): Promise<void> {
  const fence = `${path}.stale-${owner.token}`;
  try {
    // Keep this nonempty destination on both recovery and normal release.
    // A delayed observer of this owner cannot rename a replacement over it.
    await rename(path, fence);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (isContention(error)) {
      const fenced = await readRecoveryOwner(fence);
      if (fenced && fenced.token === owner.token && fenced.pid === owner.pid) return;
    }
    throw error;
  }
}

/** Serialize dead-owner removal without letting a delayed recoverer steal a new lock. */
async function withRecoveryLock(path: string, operation: () => Promise<boolean>): Promise<boolean> {
  const owner = { pid: process.pid, token: randomUUID() };
  const candidate = `${path}.candidate-${owner.token}`;
  await mkdir(candidate, { mode: 0o700 });
  try {
    const handle = await open(join(candidate, 'owner.json'), 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
    finally { await handle.close(); }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        // Unlike a file rename, this cannot replace an occupied nonempty directory.
        await rename(candidate, path);
      } catch (error) {
        if (!isContention(error)) throw error;
        const current = await readRecoveryOwner(path);
        if (current) {
          if (!ownerHasExited(current)) return false;
          await fenceRecoveryOwner(path, current);
        }
        continue;
      }
      try { return await operation(); }
      finally { await fenceRecoveryOwner(path, owner); }
    }
    return false;
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

async function recoverAbandonedLock(path: string): Promise<boolean> {
  const observed = await readOwner(path);
  if (!observed) return true;
  if (!ownerHasExited(observed)) return false;
  return withRecoveryLock(`${path}.recovery`, async () => {
    // Recheck under the recovery mutex; the first observation is not authority.
    const current = await readOwner(path);
    if (!current) return true;
    if (!ownerHasExited(current)) return false;
    await unlink(path);
    return true;
  });
}

export async function withForgeFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const owner = { pid: process.pid, token: randomUUID(), createdAt: Date.now() };
  let handle: FileHandle | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      handle = await open(path, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await recoverAbandonedLock(path))) throw busy();
    }
  }
  if (!handle) throw busy();
  try {
    // An interrupted/invalid owner write stays fail-closed, never a TTL reclaim.
    await handle.writeFile(JSON.stringify(owner));
    await handle.sync();
  } catch (error) {
    await handle.close();
    throw error;
  }
  try { return await operation(); }
  finally {
    await handle.close();
    if ((await readOwner(path))?.token === owner.token) await unlink(path);
  }
}
