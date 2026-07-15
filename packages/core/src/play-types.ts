import type {
  ContextBudgetLayer,
  SemanticBoundary,
} from './agent-context-package.js';

export type PlaySourceTrust =
  | 'canonical'
  | 'interactionHint'
  | 'playLocal'
  | 'modelImprovisation';

export type PlayActionKind = 'say' | 'look' | 'move' | 'do' | 'wait';

export type PlaySimulationMode =
  | 'conversation'
  | 'reactiveWorld'
  | 'activeWorld';

export type PlayEventDensity = 'quiet' | 'balanced' | 'volatile';

export type PlayEventVisibility =
  | 'playerVisible'
  | 'rumor'
  | 'playerUnknown';

export type PlayEventOrigin =
  | 'player'
  | 'npc'
  | 'faction'
  | 'clock'
  | 'environment'
  | 'worldRule'
  | 'manual';

export type PlayWorldEventKind =
  | 'environmentChanged'
  | 'locationChanged'
  | 'npcActed'
  | 'factionActed'
  | 'arrival'
  | 'departure'
  | 'deadlineAdvanced'
  | 'resourceChanged'
  | 'itemMoved'
  | 'evidenceChanged'
  | 'relationshipChanged'
  | 'informationSpread'
  | 'ruleConsequence'
  | 'manual';

export type PlayAdoptionTarget =
  | 'chapterDraft'
  | 'state'
  | 'timeline'
  | 'foreshadow';

export interface PlayActivatedSource {
  sourceId: string;
  path?: string;
  reason: string;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: SemanticBoundary;
  trust: PlaySourceTrust;
}

export interface PlayTranscriptTurn {
  id?: string;
  speaker: string;
  content: string;
  createdAt: string;
  actionKind?: PlayActionKind;
}

export interface PlayWorldClock {
  turn: number;
  revision: number;
  anchor?: string;
  elapsed?: string;
}

export interface PlayEventPolicy {
  simulationMode: PlaySimulationMode;
  density: PlayEventDensity;
  allowOffscreen: boolean;
  allowHidden: boolean;
  maxExternalEventsPerTurn: number;
}

export interface PlayWorldEventCause {
  reason: string;
  sourceTurnIds?: string[];
  sourceEventIds?: string[];
  triggerId?: string;
  pressureId?: string;
  agendaId?: string;
}

export interface PlayWorldEvent {
  id: string;
  turnId: string;
  sequence: number;
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
  cause: PlayWorldEventCause;
  worldClock: PlayWorldClock;
  createdAt: string;
  canonical: false;
}

export interface PlayWorldRefereeSettlementEvent {
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
  cause: PlayWorldEventCause;
}

export interface PlayObservation {
  id: string;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  sourceTurnIds: string[];
  sourceEventIds: string[];
  canonical: false;
}

export interface PlayAdoptionCandidate {
  id: string;
  target: PlayAdoptionTarget;
  summary: string;
  evidence: string;
  payload?: Record<string, unknown>;
  visibility: PlayEventVisibility;
  sourceObservationIds: string[];
  sourceTurnIds: string[];
  sourceEventIds: string[];
  requiresPendingAction: true;
}
