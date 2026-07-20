export type PlayContextSourceOutcome = 'selected' | 'omitted';

export interface PlayContextSourceTraceView {
  id: string;
  label: string;
  outcome: PlayContextSourceOutcome;
  reason?: string;
  evidence?: string;
}

export interface PlayContextTraceView {
  id: string;
  createdAt: string;
  transcriptWindowLabel: string;
  eventWindowLabel: string;
  sources: PlayContextSourceTraceView[];
}

export type PlaySourceDriftState = 'current' | 'changed' | 'missing' | 'invalid';

export interface PlaySourceDriftItemView {
  id: string;
  label: string;
  state: PlaySourceDriftState;
  evidence?: string;
}

export interface PlaySourceDriftView {
  overall: 'current' | 'drifted' | 'unavailable';
  items: PlaySourceDriftItemView[];
  availableDecisions: Array<'continueFrozen' | 'reassemble' | 'fork'>;
  activeResolution?: string;
}

export type PlaySourceDriftDecisionDraft =
  | { kind: 'continueFrozen' }
  | { kind: 'reassemble' }
  | { kind: 'fork'; newSessionId: string; title?: string };
