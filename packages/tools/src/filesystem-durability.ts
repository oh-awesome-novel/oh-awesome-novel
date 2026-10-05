import { open } from 'node:fs/promises';
import process from 'node:process';

/** Windows has no portable POSIX directory flush through Node. Preserve the
 * file flush and atomic rename, tolerating only its known directory limitation. */
export async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    try {
      handle = await open(path, 'r');
      await handle.sync();
    } catch (error) {
      if (process.platform !== 'win32'
        || !['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  } finally {
    await handle?.close();
  }
}

/** FlushFileBuffers requires a writable handle on Windows. No file error is
 * tolerated: a successfully written draft must still reach its flush barrier. */
export async function syncFile(path: string): Promise<void> {
  const handle = await open(path, process.platform === 'win32' ? 'r+' : 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
