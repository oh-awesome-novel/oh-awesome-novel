import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readCharacterPortrait } from './character-portrait.js';
/** Optional filesystem convention: world/places/<scene-id>.(png|jpg|jpeg|webp). */
const MAX_PLAY_SCENE_BACKGROUNDS = 12;
export async function readPlaySceneBackgrounds(workspaceRoot: string, preferredId?: string): Promise<Record<string, string>> {
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
  const candidates = new Map<string, string[]>();
  for (const entry of entries) {
    const match = entry.name.match(/^([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\.(png|jpe?g|webp)$/i);
    if (match) candidates.set(match[1]!, [...candidates.get(match[1]!) ?? [], entry.name]);
  }
  // The scene a session starts in is snapshotted first; the rest is best-effort scenery.
  const ids = [...candidates.keys()].sort((a, b) => Number(b === preferredId) - Number(a === preferredId) || a.localeCompare(b));
  const backgrounds: Record<string, string> = {};
  for (const id of ids) {
    const names = candidates.get(id)!;
    // Same id with several extensions is ambiguous; leave that scene without a background instead of failing launch.
    if (names.length !== 1) continue;
    if (Object.keys(backgrounds).length >= MAX_PLAY_SCENE_BACKGROUNDS) break;
    // The bounded raster reader rejects symlinks/non-regular files, including matching entries.
    backgrounds[id] = await readCharacterPortrait(workspaceRoot, `world/places/${names[0]}`);
  }
  return backgrounds;
}
