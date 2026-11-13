import { parse, stringify } from 'yaml';
import { assertImageAssetPath } from './image-assets.js';

/** Text prompt for generating this portrait; plain text, editable without any image service. */
export interface RosterPortraitPrompt { positive: string; negative?: string; useCharacterTags?: boolean }
/** Where a generated image came from. Written when a generated image is adopted; never holds keys or addresses. */
export interface RosterPortraitGeneration {
  provider?: string; model?: string; seed?: number | string; size?: string;
  workflowHash?: string; promptHash?: string; generatedAt?: string;
}
/** One prepared portrait: a description the author and the referee can read, and optionally an image path. */
export interface RosterPortrait {
  id: string;
  label: string;
  description: string;
  /** When this portrait fits. */
  usage?: string;
  /** Path inside the workspace's image asset folder. Only the path is recorded; the file may be absent. */
  image?: string;
  prompt?: RosterPortraitPrompt;
  generation?: RosterPortraitGeneration;
}
export interface RosterPortraitSet { default: string; items: RosterPortrait[] }
export const ROSTER_PORTRAIT_LIMITS = {
  maxItems: 24,
  /** Portraits a Play session records per character. */
  maxSessionItems: 8,
  maxLabel: 16,
  maxDescription: 500,
  maxUsage: 200,
  maxPrompt: 2000,
} as const;
const PORTRAIT_ID = /^[A-Za-z0-9_-]{1,32}$/;
const NAME_COLOR = /^#[0-9a-fA-F]{6}$/;
const PORTRAIT_KEYS = new Set(['id', 'label', 'description', 'usage', 'image', 'prompt', 'generation']);
const GENERATION_KEYS = new Set(['provider', 'model', 'seed', 'size', 'workflowHash', 'promptHash', 'generatedAt']);

export interface RosterCharacter {
  id: string;
  name: string;
  aliases: string[];
  genderKind: 'girl' | 'boy' | 'other';
  isPlayer: boolean;
  looks: {
    fixedBooruTags: string; outfitDescription: string; outfitTags: string; refImagePath?: string; loraName?: string; loraTrigger?: string;
    /** Name plate colour on the stage, `#RRGGBB`. */
    nameColor?: string;
  };
  /** Prepared portraits. When present they take precedence over `looks.refImagePath`. */
  portraits?: RosterPortraitSet;
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
  if (looks.nameColor !== undefined && (!str(looks.nameColor) || !NAME_COLOR.test(looks.nameColor))) throw new Error('Roster nameColor must be #RRGGBB.');
  if (v.portraits !== undefined) normalizeRosterPortraitSet(v.portraits);
  if (v.voiceConfig !== undefined) {
    const voice = v.voiceConfig as Record<string, unknown>;
    if (!voice || !str(voice.preferredVoiceId) || (voice.pitchOffset !== undefined && (typeof voice.pitchOffset !== 'number' || !Number.isFinite(voice.pitchOffset)))) throw new Error('Invalid roster voice.');
  }
  return structuredClone(v) as unknown as RosterCharacter;
}
function boundedText(value: unknown, max: number, label: string, required: boolean): void {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || (required && !value.trim()) || Array.from(value).length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) {
    throw new Error(`Invalid portrait ${label}.`);
  }
}
/** Validates a portrait set as it is written in a roster profile. Image paths are checked by shape only. */
export function normalizeRosterPortraitSet(value: unknown): RosterPortraitSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid roster portraits.');
  const set = value as Record<string, unknown>;
  if (Object.keys(set).some(key => key !== 'default' && key !== 'items')) throw new Error('Unknown roster portraits field.');
  if (!Array.isArray(set.items) || set.items.length === 0 || set.items.length > ROSTER_PORTRAIT_LIMITS.maxItems) {
    throw new Error(`Roster portraits need 1 to ${ROSTER_PORTRAIT_LIMITS.maxItems} items.`);
  }
  const ids = new Set<string>();
  for (const raw of set.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid portrait item.');
    const item = raw as Record<string, unknown>;
    const unknown = Object.keys(item).find(key => !PORTRAIT_KEYS.has(key));
    if (unknown) throw new Error(`Unknown portrait field: ${unknown}.`);
    if (typeof item.id !== 'string' || !PORTRAIT_ID.test(item.id)) throw new Error('Portrait id must be 1 to 32 ASCII letters, digits, "_" or "-".');
    if (ids.has(item.id)) throw new Error(`Duplicate portrait id: ${item.id}.`);
    ids.add(item.id);
    boundedText(item.label, ROSTER_PORTRAIT_LIMITS.maxLabel, 'label', true);
    boundedText(item.description, ROSTER_PORTRAIT_LIMITS.maxDescription, 'description', true);
    boundedText(item.usage, ROSTER_PORTRAIT_LIMITS.maxUsage, 'usage', false);
    if (item.image !== undefined) {
      try { assertImageAssetPath(item.image); } catch { throw new Error(`Portrait image must be a PNG, JPEG or WebP path inside assets/: ${item.id}.`); }
    }
    if (item.prompt !== undefined) {
      const prompt = item.prompt as Record<string, unknown>;
      if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt) || Object.keys(prompt).some(key => !['positive', 'negative', 'useCharacterTags'].includes(key))) throw new Error('Invalid portrait prompt.');
      boundedText(prompt.positive, ROSTER_PORTRAIT_LIMITS.maxPrompt, 'prompt', true);
      boundedText(prompt.negative, ROSTER_PORTRAIT_LIMITS.maxPrompt, 'negative prompt', false);
      if (prompt.useCharacterTags !== undefined && typeof prompt.useCharacterTags !== 'boolean') throw new Error('Invalid portrait prompt.');
    }
    if (item.generation !== undefined) {
      const generation = item.generation as Record<string, unknown>;
      if (!generation || typeof generation !== 'object' || Array.isArray(generation)) throw new Error('Invalid portrait generation record.');
      for (const [key, entry] of Object.entries(generation)) {
        const valid = GENERATION_KEYS.has(key) && (key === 'seed'
          ? (typeof entry === 'number' && Number.isSafeInteger(entry)) || (typeof entry === 'string' && /^\d{1,32}$/.test(entry))
          : typeof entry === 'string' && entry.length <= 200 && !/[\x00-\x1f\x7f]/u.test(entry));
        if (!valid) throw new Error(`Invalid portrait generation field: ${key}.`);
      }
    }
  }
  if (typeof set.default !== 'string' || !ids.has(set.default)) throw new Error('Roster portraits default must name one of its items.');
  return structuredClone(set) as unknown as RosterPortraitSet;
}
export function parseRosterProfile(text: string): RosterCharacter { return normalizeRosterCharacter(parse(text)); }
export function serializeRosterProfile(character: RosterCharacter): string { return stringify(normalizeRosterCharacter(character)); }
export function findRosterCharacter(roster: readonly RosterCharacter[], alias: string): RosterCharacter | undefined {
  const matches = roster.filter(c => c.id === alias || c.name === alias || c.aliases.includes(alias));
  if (matches.length > 1) throw new Error(`Ambiguous character alias: ${alias}`);
  return matches[0];
}
