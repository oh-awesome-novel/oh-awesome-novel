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
export function createEmptyForgeBrief(): ForgeBrief { return { title: '未命名设定', readiness: 0, items: [], openPoints: [] }; }
export interface ForgeDraft {
  schemaVersion: 1; id: string; revision: number; idea: string;
  stage: 'discuss' | 'plan' | 'written' | 'proposed';
  brief: ForgeBrief; questions: ForgeQuestion[]; reply: string;
  plan?: ForgePlan; chunks?: Record<string, string>; pendingActionId?: string; sourcePaths?: string[];
}
