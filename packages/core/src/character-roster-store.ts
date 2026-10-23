import { readPlaySceneBackgrounds } from './play-scene-backgrounds.js';
import { readCharacterPortrait } from './character-portrait.js';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRosterProfile, findRosterCharacter, type RosterCharacter } from './character-roster.js';
import { readWorkspaceTextFile } from './workspace-text.js';
import type { PlaySession } from './play-session.js';
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
    if (character.looks.refImagePath) portraits[character.id] = await readCharacterPortrait(workspaceRoot, character.looks.refImagePath);
  }
  session.metadataExtensions.characterRoster = [...selected.values()];
  session.metadataExtensions.characterPortraits = portraits;
}
