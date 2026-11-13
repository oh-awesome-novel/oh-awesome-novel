import { isImageAssetPath } from './image-assets.js';

/** One prepared portrait as the roster profile records it. */
export interface CharacterPortraitItem {
  id: string;
  label: string;
  description: string;
  usage?: string;
  /** Path inside `assets/`; the file may be absent on this machine. */
  image?: string;
  prompt?: { positive: string; negative?: string; useCharacterTags?: boolean };
  generation?: Record<string, string | number>;
}
export interface CharacterPortraitSet { default: string; items: CharacterPortraitItem[] }
export interface CharacterPortraitMissingImage { id: string; image: string; reason: string }
/** What a Play session records for one character when it starts. */
export interface PlaySessionPortraitSetView {
  default: string;
  items: Array<{ id: string; label: string; description: string; usage?: string; image?: string; sha256?: string }>;
  skipped: string[];
}

export interface CharacterPortraitForm {
  characterId: string;
  /** The roster profile this form edits. */
  path: string;
  /** Null when the character has no roster profile yet; the form cannot be saved then. */
  profile: null | {
    name: string;
    /** Identifies the file content the form was loaded from. */
    sourceHash: string;
    portraits: CharacterPortraitSet | null;
    nameColor: string | null;
    /** The single image older profiles use; shown so the author can move it into the set. */
    legacyRefImagePath: string | null;
    missingImages: CharacterPortraitMissingImage[];
  };
}

export interface CharacterPortraitClientMethods {
  getCharacterPortraits(characterId: string, signal?: AbortSignal): Promise<CharacterPortraitForm>;
  /**
   * Proposes the edited portraits as a change awaiting the author's approval. Nothing is written
   * to the roster profile until that change is accepted.
   */
  proposeCharacterPortraits(characterId: string, input: {
    expectedWorkspaceRoot: string;
    sourceHash: string;
    portraits: CharacterPortraitSet | null;
    nameColor: string | null;
  }): Promise<{ pendingActionId: string; targetPath: string; missingImages: CharacterPortraitMissingImage[] }>;
}

type Request = <T>(path: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => Promise<T>;

const CHARACTER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const PORTRAIT_ID = /^[A-Za-z0-9_-]{1,32}$/;
const NAME_COLOR = /^#[0-9a-fA-F]{6}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function createCharacterPortraitClientMethods(request: Request): CharacterPortraitClientMethods {
  const base = (characterId: string): string => {
    if (!CHARACTER_ID.test(characterId)) throw new Error('角色 id 无效。');
    return `/api/workspace/characters/${encodeURIComponent(characterId)}/portraits`;
  };
  return {
    async getCharacterPortraits(characterId, signal) {
      const value = await request<unknown>(base(characterId), { signal });
      if (!record(value) || value.characterId !== characterId || value.path !== `characters/${characterId}/roster-profile.yaml`) throw new Error('立绘响应无效。');
      if (value.profile === null) return { characterId, path: value.path, profile: null };
      const profile = value.profile;
      if (!record(profile) || typeof profile.name !== 'string' || typeof profile.sourceHash !== 'string' || !SHA256.test(profile.sourceHash)
        || (profile.portraits !== null && !portraitSet(profile.portraits))
        || (profile.nameColor !== null && (typeof profile.nameColor !== 'string' || !NAME_COLOR.test(profile.nameColor)))
        || (profile.legacyRefImagePath !== null && typeof profile.legacyRefImagePath !== 'string')
        || !missing(profile.missingImages)) throw new Error('立绘响应无效。');
      return {
        characterId,
        path: value.path,
        profile: {
          name: profile.name,
          sourceHash: profile.sourceHash,
          portraits: profile.portraits as CharacterPortraitSet | null,
          nameColor: profile.nameColor as string | null,
          legacyRefImagePath: profile.legacyRefImagePath as string | null,
          missingImages: profile.missingImages,
        },
      };
    },
    async proposeCharacterPortraits(characterId, input) {
      const value = await request<unknown>(`${base(characterId)}/propose`, { method: 'POST', body: input });
      if (!record(value) || typeof value.pendingActionId !== 'string' || !/^pa_[A-Za-z0-9-]{1,80}$/.test(value.pendingActionId)
        || value.targetPath !== `characters/${characterId}/roster-profile.yaml` || !missing(value.missingImages)) throw new Error('立绘提案响应无效。');
      return { pendingActionId: value.pendingActionId, targetPath: value.targetPath, missingImages: value.missingImages };
    },
  };
}

/** Reads the portrait sets a Play session recorded; anything malformed is treated as absent. */
export function readPlaySessionPortraitSets(value: unknown): Record<string, PlaySessionPortraitSetView> {
  if (!record(value)) return {};
  const result: Record<string, PlaySessionPortraitSetView> = {};
  for (const [characterId, set] of Object.entries(value)) {
    if (!CHARACTER_ID.test(characterId) || !portraitSet(set)) continue;
    const raw = set as unknown as Record<string, unknown>;
    if (!Array.isArray(raw.skipped) || !raw.skipped.every(id => typeof id === 'string')) continue;
    if (set.items.some(item => { const hash = (item as { sha256?: unknown }).sha256; return hash !== undefined && (typeof hash !== 'string' || !SHA256.test(hash)); })) continue;
    result[characterId] = set as unknown as PlaySessionPortraitSetView;
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function portraitSet(value: unknown): value is CharacterPortraitSet {
  if (!record(value) || typeof value.default !== 'string' || !Array.isArray(value.items) || value.items.length === 0 || value.items.length > 24) return false;
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || typeof item.id !== 'string' || !PORTRAIT_ID.test(item.id) || ids.has(item.id)
      || typeof item.label !== 'string' || typeof item.description !== 'string'
      || (item.usage !== undefined && typeof item.usage !== 'string')
      || (item.image !== undefined && !isImageAssetPath(item.image))) return false;
    ids.add(item.id);
  }
  return ids.has(value.default);
}

function missing(value: unknown): value is CharacterPortraitMissingImage[] {
  return Array.isArray(value) && value.length <= 24 && value.every(item => record(item)
    && typeof item.id === 'string' && typeof item.image === 'string' && typeof item.reason === 'string');
}
