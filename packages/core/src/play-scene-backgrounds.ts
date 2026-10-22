import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readCharacterPortrait } from './character-portrait.js';
/** Optional filesystem convention: world/places/<scene-id>.(png|jpg|jpeg|webp). */
export async function readPlaySceneBackgrounds(workspaceRoot: string): Promise<Record<string, string>> {
  const directory = join(workspaceRoot, 'world', 'places');
  let entries;
  try {
    // Do not enumerate through symlinked ancestors, even when no matching image exists.
    for (const path of [join(workspaceRoot, 'world'), directory]) {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe scene background directory.');
    }
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  if (entries.length > 2000) throw new Error('Scene background directory exceeds scan limit.');
  const backgrounds: Record<string, string> = {};
  for (const entry of entries) {
    const match = entry.name.match(/^([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\.(png|jpe?g|webp)$/i);
    if (!match) continue;
    const id = match[1]!;
    if (Object.hasOwn(backgrounds, id)) throw new Error(`Ambiguous scene background: ${id}`);
    if (Object.keys(backgrounds).length >= 12) throw new Error('A Play session supports up to 12 scene backgrounds.');
    // The bounded raster reader rejects symlinks/non-regular files, including matching entries.
    backgrounds[id] = await readCharacterPortrait(workspaceRoot, `world/places/${entry.name}`);
  }
  return backgrounds;
}
