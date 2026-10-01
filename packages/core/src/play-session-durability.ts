import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Flush copied sidecars as well as freshly serialized session/turn files. */
export async function syncPlaySnapshotTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await syncPlaySnapshotTree(path);
    } else if (entry.isFile()) {
      await syncPlaySnapshotFile(path);
    } else {
      throw new Error(`Play staged snapshot contains an unsafe entry: ${entry.name}.`);
    }
  }
  // Child entries and file bytes must precede their parent directory barrier.
  await syncPlaySnapshotDirectory(root);
}

export async function syncPlaySnapshotFile(path: string): Promise<void> {
  const information = await lstat(path);
  if (!information.isFile() || information.isSymbolicLink()) {
    throw new Error('Play snapshot fsync requires a regular file.');
  }
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function syncPlaySnapshotDirectory(path: string): Promise<void> {
  const information = await lstat(path);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error('Play snapshot fsync requires a directory.');
  }
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
