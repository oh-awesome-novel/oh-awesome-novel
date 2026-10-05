import { open } from 'node:fs/promises';

/** Node cannot flush directory handles on some Windows filesystems. File
 * fsync remains mandatory; unsupported directory flushes do not imply the
 * stronger POSIX directory durability guarantee on Windows. */
export async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if (isUnsupportedWindowsDirectorySync(error)) return;
    throw error;
  }
  try {
    try {
      await handle.sync();
    } catch (error) {
      if (!isUnsupportedWindowsDirectorySync(error)) throw error;
    }
  } finally {
    await handle.close();
  }
}

function isUnsupportedWindowsDirectorySync(error: unknown): boolean {
  return process.platform === 'win32'
    && ['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}
