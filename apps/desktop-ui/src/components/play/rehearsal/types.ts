export type PlaySessionPurposeChoice = 'immersiveJourney' | 'sceneRehearsal';

export type PlayRehearsalSetupStep = 'scene' | 'cast' | 'review';

export type PlayRehearsalSimulationMode =
  | 'conversation'
  | 'reactiveWorld'
  | 'activeWorld';

export type PlayRehearsalEventDensity = 'quiet' | 'balanced' | 'volatile';

export interface PlayRehearsalSceneDraft {
  title: string;
  opening: string;
  location: string;
  atmosphere: string;
  objective: string;
  risk: string;
  simulationMode: PlayRehearsalSimulationMode;
  density: PlayRehearsalEventDensity;
}

export interface PlayRehearsalParticipantDraft {
  participantRef: string;
  displayName: string;
  position: string;
  currentGoal: string;
  initialKnowledge: string;
}

export type PlayRehearsalParticipantDraftPatch = Partial<
  Omit<PlayRehearsalParticipantDraft, 'participantRef'>
>;

export type PlayRehearsalSceneErrors = Partial<Record<
  'title' | 'opening' | 'location' | 'objective',
  string
>>;

export interface PlayRehearsalParticipantErrors {
  displayName?: string;
  currentGoal?: string;
}

export type PlayRehearsalCastErrors = Record<
  string,
  PlayRehearsalParticipantErrors
>;

export interface PlayRehearsalSetupSubmission {
  purpose: 'sceneRehearsal';
  startMode: 'quick';
  scene: PlayRehearsalSceneDraft;
  participants: PlayRehearsalParticipantDraft[];
  actorOrder: string[];
}

export interface PlayRehearsalSceneContractView {
  title: string;
  opening: string;
  location?: string;
  atmosphere?: string;
  objective?: string;
  risk?: string;
}

export interface PlayRehearsalClockView {
  turn: number;
  revision: number;
  anchor?: string;
  elapsed?: string;
}

export type PlayRehearsalAttemptStatus =
  | 'idle'
  | 'running'
  | 'prepared'
  | 'committing'
  | 'committed'
  | 'cancelled'
  | 'failed';

export interface PlayRehearsalAttemptView {
  id: string;
  revision: number;
  status: PlayRehearsalAttemptStatus;
  currentParticipantRef?: string;
  selectedStepRefs: string[];
  selectedHeadRef?: string;
  supersededStepRefs?: string[];
  orderStrategy?: 'directorFixed' | 'refereeDynamic' | 'hybrid';
  stagnation?: {
    consecutiveNoMaterialSteps: number;
    threshold: number;
    warning: boolean;
  };
}

export type PlayRehearsalActorStatus =
  | 'current'
  | 'waiting'
  | 'selected'
  | 'committed';

export interface PlayRehearsalActorQueueItem {
  participantRef: string;
  displayName: string;
  position?: string;
  currentGoal?: string;
  status: PlayRehearsalActorStatus;
  stepRef?: string;
}

export type PlayRehearsalNarrativeBlockKind =
  | 'narrator'
  | 'characterSpeech'
  | 'characterAction'
  | 'worldNotice';

export interface PlayRehearsalNarrativeBlockView {
  id: string;
  kind: PlayRehearsalNarrativeBlockKind;
  content: string;
  speakerName?: string;
  projection: 'transcript' | 'directorOnly';
}

export type PlayRehearsalStepStatus =
  | 'provisional'
  | 'selected'
  | 'committed'
  | 'superseded';

export interface PlayRehearsalStepView {
  id: string;
  participantRef: string;
  participantName: string;
  intentSummary?: string;
  status: PlayRehearsalStepStatus;
  blocks: PlayRehearsalNarrativeBlockView[];
  variantOf?: string;
  effectFingerprint?: string;
  materialEffect?:
    | { kind: 'materialEffect' }
    | { kind: 'noMaterialEffect'; reason: string };
}

export type PlayRehearsalStepRunPhase =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'prepared'
  | 'stopping'
  | 'failed';

export interface PlayRehearsalStepRunView {
  id?: string;
  phase: PlayRehearsalStepRunPhase;
  statusMessage: string;
  error?: string;
}

export interface PlayRehearsalPerceptionView {
  participantRef: string;
  visibleFacts: string[];
  /** Parallel visibility metadata used by the Player/Director projection. */
  visibleFactVisibilities?: Array<
    'playerVisible' | 'rumor' | 'playerUnknown'
  >;
  behaviorAnchors: string[];
  observedBlockLabels: string[];
  grantedKnowledge?: Array<{
    id: string;
    summary: string;
    provenanceLabel: string;
    visibility: 'playerVisible' | 'rumor' | 'playerUnknown';
  }>;
  omissionNotice?: string;
}

export interface PlayRehearsalVisibleEventView {
  id: string;
  title: string;
  summary: string;
}

export interface PlayRehearsalStateChangeView {
  label: string;
  before?: string;
  after: string;
}

export interface PlayRehearsalResultView {
  artifactRef: string;
  revision: number;
  summary: string;
  blocks: PlayRehearsalNarrativeBlockView[];
  eventSummaries: string[];
  stateChanges: PlayRehearsalStateChangeView[];
}

export type PlayRehearsalControl =
  | 'startAttempt'
  | 'generateStep'
  | 'stopStep'
  | 'accept'
  | 'modify'
  | 'retry'
  | 'insertActor'
  | 'grantKnowledge'
  | 'finish'
  | 'cancel';

export interface PlayRehearsalControlCapabilities {
  canStartAttempt: boolean;
  canGenerateStep: boolean;
  canStopStep: boolean;
  canAccept: boolean;
  canModify?: boolean;
  canRetry: boolean;
  canInsertActor?: boolean;
  canGrantKnowledge?: boolean;
  canFinish: boolean;
  canCancel: boolean;
  disabledReasons?: Partial<Record<PlayRehearsalControl, string>>;
}

export type PlayDirectorPanelMode =
  | 'modify'
  | 'insertActor'
  | 'grantKnowledge';

export type PlayDirectorInterventionDraft =
  | {
      kind: 'reviseProjection';
      stepRef: string;
      replacementProjection: Array<{ blockId: string; content: string }>;
    }
  | {
      kind: 'redirectStep';
      stepRef: string;
      directorIntent: string;
      authorConstraintRefs: string[];
    }
  | {
      kind: 'insertActor';
      participantRef: string;
      anchor: 'before' | 'after' | 'next';
      anchorStepRef?: string;
    }
  | {
      kind: 'grantKnowledge';
      participantRef: string;
      effectiveFromStepRef: string;
      grant:
        | { kind: 'existingFact'; factRefs: string[] }
        | {
            kind: 'authorProvidedPlayFact';
            summary: string;
            visibility: 'playerVisible' | 'rumor' | 'playerUnknown';
          };
    };

export interface PlaySceneMemoryItemView {
  id: string;
  kind: string;
  summary: string;
  provenanceLabel?: string;
}

export interface PlaySceneMemoryView {
  id: string;
  lens: 'player' | 'director';
  status: 'current' | 'stale';
  revision: number;
  builtAt: string;
  staleReasons: string[];
  items: PlaySceneMemoryItemView[];
}
