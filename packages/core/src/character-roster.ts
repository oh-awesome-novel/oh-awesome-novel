import { parse, stringify } from 'yaml';

export interface RosterCharacter {
  id: string;
  name: string;
  aliases: string[];
  genderKind: 'girl' | 'boy' | 'other';
  isPlayer: boolean;
  looks: { fixedBooruTags: string; outfitDescription: string; outfitTags: string; refImagePath?: string; loraName?: string; loraTrigger?: string };
  voiceConfig?: { preferredVoiceId: string; pitchOffset?: number };
}
export function normalizeRosterCharacter(value: unknown): RosterCharacter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid roster profile.');
  const v = value as Record<string, unknown>;
  const str = (x: unknown): x is string => typeof x === 'string';
  if (!str(v.id) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(v.id) || !str(v.name) || !v.name.trim() || !Array.isArray(v.aliases) || !v.aliases.every(str) || !['girl', 'boy', 'other'].includes(String(v.genderKind)) || typeof v.isPlayer !== 'boolean') throw new Error('Invalid roster identity.');
  if (!v.looks || typeof v.looks !== 'object') throw new Error('Invalid roster looks.');
  const looks = v.looks as Record<string, unknown>;
  for (const key of ['fixedBooruTags', 'outfitDescription', 'outfitTags']) if (!str(looks[key])) throw new Error(`Invalid roster ${key}.`);
  for (const key of ['refImagePath', 'loraName', 'loraTrigger']) if (looks[key] !== undefined && !str(looks[key])) throw new Error(`Invalid roster ${key}.`);
  if (looks.refImagePath && (!/^[\w/-]+\.(png|jpg|jpeg|webp)$/i.test(String(looks.refImagePath)) || String(looks.refImagePath).split('/').some(p => p === '..' || p === '.') || String(looks.refImagePath).startsWith('/'))) throw new Error('Unsafe roster image path.');
  if (v.voiceConfig !== undefined) {
    const voice = v.voiceConfig as Record<string, unknown>;
    if (!voice || !str(voice.preferredVoiceId) || (voice.pitchOffset !== undefined && (typeof voice.pitchOffset !== 'number' || !Number.isFinite(voice.pitchOffset)))) throw new Error('Invalid roster voice.');
  }
  return structuredClone(v) as unknown as RosterCharacter;
}
export function parseRosterProfile(text: string): RosterCharacter { return normalizeRosterCharacter(parse(text)); }
export function serializeRosterProfile(character: RosterCharacter): string { return stringify(normalizeRosterCharacter(character)); }
export function findRosterCharacter(roster: readonly RosterCharacter[], alias: string): RosterCharacter | undefined {
  const matches = roster.filter(c => c.id === alias || c.name === alias || c.aliases.includes(alias));
  if (matches.length > 1) throw new Error(`Ambiguous character alias: ${alias}`);
  return matches[0];
}
