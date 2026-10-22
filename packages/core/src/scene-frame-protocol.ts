import { findRosterCharacter, type RosterCharacter } from './character-roster.js';
export interface SceneFrame { scene: string; characters: Array<{ characterId: string; description: string; position: 'left' | 'center' | 'right'; fixedBooruTags: string; refImagePath?: string }> }
export function parseSceneFrame(text: string, roster: readonly RosterCharacter[]): SceneFrame {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
  const scene = lines.shift()?.match(/^场景[:：]\s*(.+)$/)?.[1];
  if (!scene) throw new Error('Scene frame requires a scene.');
  const seen = new Set<string>();
  const characters = lines.map(line => {
    const match = line.match(/^\[([^\]]+)\]\s*(.+?)\s*\|\s*(left|center|right)$/);
    if (!match) throw new Error('Invalid scene character line.');
    const character = findRosterCharacter(roster, match[1]!);
    if (!character || seen.has(character.id)) throw new Error('Unknown or duplicate scene character.');
    seen.add(character.id);
    return { characterId: character.id, description: match[2]!, position: match[3] as 'left' | 'center' | 'right', fixedBooruTags: character.looks.fixedBooruTags, ...(character.looks.refImagePath ? { refImagePath: character.looks.refImagePath } : {}) };
  });
  return { scene, characters };
}
