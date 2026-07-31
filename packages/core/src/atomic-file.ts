import {
  link,
  mkdir,
  open,
  rename,
  unlink,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

export async function writeFileAtomically(
  filePath: string,
  content: string,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  const parentDirectory = dirname(filePath);
  const temporaryPath = join(
    parentDirectory,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(parentDirectory, { recursive: true });

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (options.overwrite === false) {
      await link(temporaryPath, filePath);
      await unlink(temporaryPath);
    } else {
      await rename(temporaryPath, filePath);
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== 'ENOENT') {
        throw cleanupError;
      }
    });
    throw error;
  }
}
