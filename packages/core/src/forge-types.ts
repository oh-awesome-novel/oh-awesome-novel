/** Model-free contracts for the author-controlled setting workshop. */
export const FORGE_BRIEF_KEYS = ['stage', 'lead', 'user', 'bond', 'play', 'tone', 'style', 'cast', 'track', 'opening'] as const;
export type ForgeBriefKey = typeof FORGE_BRIEF_KEYS[number];
export interface ForgeOption { label: string; detail?: string; sample: string }
export interface ForgeQuestion { id: string; title: string; why: string; kind: 'single' | 'multi' | 'taste'; options: ForgeOption[] }
export interface BriefItem { key: ForgeBriefKey; label: string; value: string; by: 'user' | 'assistant'; locked?: boolean }
export interface ForgeBrief { title: string; readiness: number; items: BriefItem[]; openPoints: string[] }
export interface ForgeDiscussResult { reply: string; questions: ForgeQuestion[]; brief: ForgeBrief }
export interface ForgeTrait { name: string; behaviors: string[] }
export interface ForgeFacet { kind: 'normal' | 'pressure' | 'private'; trigger: string; state: string; dialogue: string[]; habitualAction: string }
export interface ForgeCharacterPlan {
  id: string; name: string; aliases: string[];
  palette: { base: string; mainTones: ForgeTrait[]; accents: ForgeTrait[] };
  facets: ForgeFacet[];
  clarifications: Array<{ trait: string; meaning: string; when: string; not: string }>;
  desire: { goal: string; obstacle: string; cost: string };
  choice: { dilemma: string; decision: string; sacrifice: string; consequence: string };
  resources: Array<{ name: string; initial: string; cost: string; settlement: string }>;
}
export interface ForgePlan {
  title: string;
  characters: ForgeCharacterPlan[];
  world: { kind: 'real' | 'fictional'; premise: string; rules: string[]; factions: string[]; history: string[] };
  places: Array<{ id: string; name: string; appearance: string; atmosphere: string; characters: string[]; events: string[] }>;
  opening: string;
}
export const FORGE_CHUNK_KINDS = ['world', 'places', 'characters', 'facets', 'clarifications', 'opening'] as const;
export type ForgeChunkKind = typeof FORGE_CHUNK_KINDS[number];
export interface ForgeChunk { kind: ForgeChunkKind; text: string }
/** Kinds written once per character or place; their chunk keys are `kind:id`. */
export const FORGE_ENTITY_CHUNK_KINDS = ['places', 'characters', 'facets', 'clarifications'] as const satisfies readonly ForgeChunkKind[];
export function isForgeEntityChunkKind(kind: ForgeChunkKind): kind is typeof FORGE_ENTITY_CHUNK_KINDS[number] {
  return (FORGE_ENTITY_CHUNK_KINDS as readonly string[]).includes(kind);
}
export function forgeChunkEntityIds(plan: ForgePlan, kind: ForgeChunkKind): string[] {
  if (kind === 'places') return plan.places.map(place => place.id);
  return isForgeEntityChunkKind(kind) ? plan.characters.map(character => character.id) : [];
}
/** Every chunk key a written draft must hold for its plan. */
export function forgeChunkKeys(plan: ForgePlan): string[] {
  return FORGE_CHUNK_KINDS.flatMap(kind => isForgeEntityChunkKind(kind) ? forgeChunkEntityIds(plan, kind).map(id => `${kind}:${id}`) : [kind]);
}
export function createEmptyForgeBrief(): ForgeBrief { return { title: '未命名设定', readiness: 0, items: [], openPoints: [] }; }
export interface ForgeDraft {
  schemaVersion: 1; id: string; revision: number; idea: string;
  stage: 'discuss' | 'plan' | 'written' | 'proposed';
  brief: ForgeBrief; questions: ForgeQuestion[]; reply: string;
  plan?: ForgePlan; chunks?: Record<string, string>; pendingActionId?: string; sourcePaths?: string[];
  /** Recent discussion rounds, so later rounds do not repeat questions. */
  rounds?: Array<{ answer: string; questions: string[] }>;
}
export const FORGE_MAX_DISCUSS_ROUNDS = 12;
