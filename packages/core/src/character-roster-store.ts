import { readPlaySceneBackgrounds } from './play-scene-backgrounds.js';
import { readCharacterPortrait } from './character-portrait.js';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRosterProfile, findRosterCharacter, ROSTER_PORTRAIT_LIMITS, type RosterCharacter } from './character-roster.js';
import { readImageAsset } from './image-assets.js';
import { readWorkspaceTextFile } from './workspace-text.js';
import type { PlaySession } from './play-session.js';
/** One portrait as a Play session records it: text and path, never image bytes. */
export interface PlaySessionPortrait {
  id: string;
  label: string;
  description: string;
  usage?: string;
  image?: string;
  /** SHA-256 of the image when the session was created; absent when there was no readable file. */
  sha256?: string;
}
export interface PlaySessionPortraitSet {
  default: string;
  items: PlaySessionPortrait[];
  /** Portrait ids left out because the character has more than the per-session limit. */
  skipped: string[];
}
/**
 * The portraits a new session records for one character: the default first, then file order,
 * up to the per-session limit. Images stay in the asset folder; only their hash is read.
 */
export async function recordPlaySessionPortraitSet(workspaceRoot: string, character: RosterCharacter): Promise<PlaySessionPortraitSet | undefined> {
  const set = character.portraits;
  if (!set) return undefined;
  const ordered = [...set.items.filter(item => item.id === set.default), ...set.items.filter(item => item.id !== set.default)];
  const kept = ordered.slice(0, ROSTER_PORTRAIT_LIMITS.maxSessionItems);
  const items: PlaySessionPortrait[] = [];
  for (const item of kept) {
    // A missing or damaged image is normal: images do not travel with Git.
    const sha256 = item.image ? (await readImageAsset(workspaceRoot, item.image).catch(() => undefined))?.sha256 : undefined;
    items.push({
      id: item.id, label: item.label, description: item.description,
      ...(item.usage ? { usage: item.usage } : {}),
      ...(item.image ? { image: item.image } : {}),
      ...(sha256 ? { sha256 } : {}),
    });
  }
  return { default: set.default, items, skipped: ordered.slice(ROSTER_PORTRAIT_LIMITS.maxSessionItems).map(item => item.id) };
}
/** Snapshot selected profiles once; later canonical edits cannot change historical speakers. */
export async function attachPlayCharacterRoster(workspaceRoot: string, session: PlaySession): Promise<void> {
  session.metadataExtensions.sceneBackgrounds = await readPlaySceneBackgrounds(workspaceRoot, session.sceneStart);
  const directory = join(workspaceRoot, 'characters');
  let entries;
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe character directory.');
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (entries.length > 2000) throw new Error('Character roster exceeds scan limit.');
  const roster: RosterCharacter[] = [];
  const invalid = new Map<string, unknown>();
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.name)) continue;
    try {
      const file = await readWorkspaceTextFile(workspaceRoot, `characters/${entry.name}/roster-profile.yaml`);
      const character = parseRosterProfile(file.content);
      if (character.id !== entry.name) throw new Error('Roster identity differs from directory.');
      roster.push(character);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') invalid.set(entry.name, error); }
  }
  // A broken profile only blocks launch when this session actually uses that character.
  const select = (name: string): RosterCharacter | undefined => {
    if (invalid.has(name)) throw invalid.get(name);
    return findRosterCharacter(roster, name);
  };
  const selected = new Map<string, RosterCharacter>();
  for (const name of session.characters) { const character = select(name); if (character) selected.set(character.id, character); }
  for (const source of session.activatedSources) {
    const id = source.path?.match(/^characters\/([^/]+)\//)?.[1];
    if (id) { const character = select(id); if (character) selected.set(character.id, character); }
  }
  if (selected.size > 12) throw new Error('Play roster supports up to 12 character portraits.');
  const portraits: Record<string, string> = {};
  for (const character of selected.values()) {
    // A prepared portrait set replaces the single legacy image, and its images are never copied into the session.
    if (character.looks.refImagePath && !character.portraits) portraits[character.id] = await readCharacterPortrait(workspaceRoot, character.looks.refImagePath);
  }
  const portraitSets: Record<string, PlaySessionPortraitSet> = {};
  for (const character of selected.values()) {
    const set = await recordPlaySessionPortraitSet(workspaceRoot, character);
    if (set) portraitSets[character.id] = set;
  }
  session.metadataExtensions.characterRoster = [...selected.values()];
  session.metadataExtensions.characterPortraits = portraits;
  // Only written when a selected character has prepared portraits, so other sessions are stored exactly as before.
  if (Object.keys(portraitSets).length) session.metadataExtensions.characterPortraitSets = portraitSets;
}
