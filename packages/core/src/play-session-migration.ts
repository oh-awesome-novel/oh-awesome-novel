import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Bind approval to every original byte, including extension files in the backup. */
export async function fingerprintPlayMigrationSource(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1)) {
        throw new Error(`Play migration source must contain only regular files: ${relative}.`);
      }
      hash.update(JSON.stringify([relative, info.isDirectory() ? 'directory' : 'file', info.mode]));
      if (info.isDirectory()) await visit(path, relative);
      else hash.update(createHash('sha256').update(await readFile(path)).digest());
    }
  }
  await visit(root, '');
  return hash.digest('hex');
}
