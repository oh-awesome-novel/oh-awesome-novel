import type { DeepReadonly } from 'vue';

import type {
  PlayRehearsalActorQueueItem,
  PlayRehearsalAttemptView,
  PlayRehearsalClockView,
  PlayRehearsalNarrativeBlockView,
  PlayRehearsalPerceptionView,
  PlayRehearsalResultView,
  PlayRehearsalSceneContractView,
  PlayRehearsalStepRunView,
  PlayRehearsalStepView,
  PlayRehearsalVisibleEventView,
  PlayRehearsalSetupSubmission,
} from '../components/play/rehearsal/types';
import type {
  CreatePlaySceneRehearsalSessionInput,
  NarrativeBlock,
  PlayEventVisibility,
  PlayParticipantKnowledgeGrantRecord,
  PlayRehearsalSessionV5,
  PlayRehearsalTurnEvidence,
  PlaySelectedArtifactPresentation,
  PlaySession,
  PlayTurnArtifact,
} from './useWorkspaceApi';
import type {
  PlayActorNarrativeBlockRecord,
  PlayActorStepRecord,
  PlayActorStepRun,
  PlayRehearsalAttemptRecord,
} from './usePlayActorStepStream';
import type {
  PlayRehearsalFinishResult,
} from './usePlayRehearsalAttempt';

export type PlayRehearsalCommittedResult = PlayRehearsalFinishResult<
  PlayRehearsalSessionV5,
  PlayTurnArtifact,
  PlayRehearsalTurnEvidence
>;
export type PlayRehearsalResultArtifact = Pick<
  PlayTurnArtifact,
  'id' | 'revision' | 'eventIds' | 'stateDelta' | 'rehearsalEvidenceRefs'
> & Partial<Pick<PlayTurnArtifact, 'playLocalStateVisibilitySnapshot'>>;
export interface PlayRehearsalCommittedProjection {
  session: PlayRehearsalSessionV5;
  artifact: PlayRehearsalResultArtifact;
  evidence: PlayRehearsalTurnEvidence;
}
type ReadonlyPlayRehearsalAttempt = DeepReadonly<PlayRehearsalAttemptRecord>;
type ReadonlyPlayRehearsalResult =
  | PlayRehearsalCommittedProjection
  | DeepReadonly<PlayRehearsalCommittedProjection>;

export interface BuildPlayRehearsalSessionInputOptions {
  providedAt?: string;
}

export function buildPlayRehearsalSessionInput(
  submission: PlayRehearsalSetupSubmission,
  options: BuildPlayRehearsalSessionInputOptions = {},
): CreatePlaySceneRehearsalSessionInput {
  assertCompleteActorOrder(submission);
  const providedAt = options.providedAt ?? new Date().toISOString();
  const usedParticipantRefs = new Set<string>();
  const usedEvidenceRefs = new Set<string>();
  const participantRefs = new Map<string, string>();
  const participants = submission.participants.map((participant, index) => {
    const participantRef = uniqueSafeRef(
      participant.participantRef,
      `participant-${index + 1}`,
      usedParticipantRefs,
    );
    participantRefs.set(participant.participantRef, participantRef);
    const initialKnowledge = participant.initialKnowledge.trim();
    const evidenceRef = initialKnowledge
      ? uniqueSafeRef(
          `${participantRef}-knowledge`,
          `knowledge-${index + 1}`,
          usedEvidenceRefs,
        )
      : undefined;

    return {
      participantRef,
      displayName: participant.displayName.trim(),
      ...(participant.position.trim() ? { position: participant.position.trim() } : {}),
      ...(participant.currentGoal.trim()
        ? { currentGoal: participant.currentGoal.trim() }
        : {}),
      initialKnowledgeEvidenceRefs: evidenceRef ? [evidenceRef] : [],
    };
  });
  const actorOrder = submission.actorOrder.map((participantRef) => {
    const normalized = participantRefs.get(participantRef);
    if (!normalized) {
      throw new Error(`Rehearsal actor order references an unknown participant: ${participantRef}.`);
    }
    return normalized;
  });
  const initialKnowledgeEvidence = participants.flatMap((participant, index) => {
    const evidenceRef = participant.initialKnowledgeEvidenceRefs[0];
    const fact = submission.participants[index]!.initialKnowledge.trim();
    return evidenceRef && fact
      ? [{
          id: evidenceRef,
          participantRef: participant.participantRef,
          visibility: 'playerVisible' as const,
          fact,
          provenance: {
            kind: 'authorProvided' as const,
            providedAt,
          },
        }]
      : [];
  });
  const sceneId = safeRefFromText(submission.scene.title, 'scene-1', 'scene');
  const authorValue = (value: string) => value.trim()
    ? {
        value: value.trim(),
        provenance: {
          kind: 'authorProvided' as const,
          providedAt,
        },
      }
    : undefined;
  const location = authorValue(submission.scene.location);
  const atmosphere = authorValue(submission.scene.atmosphere);
  const trigger = authorValue(submission.scene.opening);
  const objective = authorValue(submission.scene.objective);
  const risk = authorValue(submission.scene.risk);

  return {
    title: submission.scene.title.trim(),
    sceneStart: submission.scene.opening.trim(),
    characters: participants.map((participant) => participant.displayName),
    eventPolicy: {
      simulationMode: submission.scene.simulationMode,
      density: submission.scene.density,
    },
    purpose: 'sceneRehearsal',
    startMode: submission.startMode,
    sceneContract: {
      sceneId,
      worldClock: { turn: 0, revision: 0 },
      clockProvenance: {
        kind: 'newSessionInitial',
        sourceRefs: [],
        authorProvidedAt: providedAt,
      },
      ...(location ? { location } : {}),
      ...(atmosphere ? { atmosphere } : {}),
      ...(trigger ? { trigger } : {}),
      ...(objective ? { objective } : {}),
      ...(risk ? { risk } : {}),
      participantRefs: actorOrder,
      orderStrategy: 'directorFixed',
    },
    participants,
    initialKnowledgeEvidence,
  };
}

export function isPlayRehearsalSession(
  session: PlaySession | undefined,
): session is PlayRehearsalSessionV5 {
  return session?.schemaVersion === 5;
}

export function findPersistedPlayRehearsalResult(
  session: PlayRehearsalSessionV5,
  selectedArtifactPresentation?: Readonly<PlaySelectedArtifactPresentation>,
): PlayRehearsalCommittedProjection | undefined {
  const activeScene = session.rehearsalScenes.find((scene) =>
    scene.sceneId === session.sceneRehearsal.activeSceneRef);
  if (!activeScene) return undefined;

  const artifacts = new Map(
    session.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const evidenceByArtifactId = new Map(
    activeScene.turns.map((evidence) => [evidence.owningTurnArtifactId, evidence]),
  );

  for (const artifactId of [...session.selectedTurnIds].reverse()) {
    const artifact = artifacts.get(artifactId) ?? (
      selectedArtifactPresentation?.id === artifactId
        ? selectedArtifactPresentation
        : undefined
    );
    const evidence = evidenceByArtifactId.get(artifactId);
    if (
      !artifact ||
      !evidence ||
      artifact.revision > session.revision ||
      !artifact.rehearsalEvidenceRefs?.includes(evidence.id)
    ) {
      continue;
    }
    return { session, artifact, evidence };
  }
  return undefined;
}

export function projectPlayRehearsalScene(
  session: PlayRehearsalSessionV5,
): PlayRehearsalSceneContractView {
  const contract = session.sceneRehearsal.sceneContract;
  return {
    title: session.title,
    opening: contract.trigger?.value ?? session.sceneStart,
    ...(contract.location ? { location: contract.location.value } : {}),
    ...(contract.atmosphere ? { atmosphere: contract.atmosphere.value } : {}),
    ...(contract.objective ? { objective: contract.objective.value } : {}),
    ...(contract.risk ? { risk: contract.risk.value } : {}),
  };
}

export function projectPlayRehearsalClock(
  session: PlayRehearsalSessionV5,
): PlayRehearsalClockView {
  return {
    turn: session.worldClock.turn,
    revision: session.revision,
    ...(session.worldClock.anchor ? { anchor: session.worldClock.anchor } : {}),
    ...(session.worldClock.elapsed ? { elapsed: session.worldClock.elapsed } : {}),
  };
}

export function projectPlayRehearsalAttempt(
  session: PlayRehearsalSessionV5,
  attempt: ReadonlyPlayRehearsalAttempt | undefined,
): PlayRehearsalAttemptView | undefined {
  if (!attempt) return undefined;
  return {
    id: attempt.id,
    revision: attempt.attemptRevision,
    status: attempt.status,
    currentParticipantRef: currentParticipantRef(session, attempt),
    selectedStepRefs: [...attempt.selectedStepRefs],
    ...(attempt.selectedHeadRef ? { selectedHeadRef: attempt.selectedHeadRef } : {}),
    supersededStepRefs: [...new Set(
      (attempt.interventions ?? []).flatMap((intervention) =>
        intervention.supersededStepRefs),
    )],
    ...(attempt.orderStrategy ? { orderStrategy: attempt.orderStrategy } : {}),
    ...(attempt.stagnation
      ? { stagnation: { ...attempt.stagnation } }
      : {}),
  };
}

export function projectPlayRehearsalQueue(
  session: PlayRehearsalSessionV5,
  attempt: ReadonlyPlayRehearsalAttempt | undefined,
  result: ReadonlyPlayRehearsalResult | undefined,
): PlayRehearsalActorQueueItem[] {
  const selectedByParticipant = new Map<string, string>();
  for (const stepRef of attempt?.selectedStepRefs ?? []) {
    const step = attempt?.steps.find((candidate) => candidate.id === stepRef);
    if (step) selectedByParticipant.set(step.participantRef, step.id);
  }
  const committedByParticipant = new Map(
    (result?.evidence.steps ?? []).map((step) => [step.participantRef, step.stepRef]),
  );
  const activeParticipantRef = result
    ? undefined
    : currentParticipantRef(session, attempt);
  const participants = new Map(
    session.sceneRehearsal.participants.map((participant) => [
      participant.participantRef,
      participant,
    ]),
  );

  const actorOrder = attempt?.actorOrder ??
    session.sceneRehearsal.sceneContract.participantRefs;
  return actorOrder.map((participantRef) => {
    const participant = participants.get(participantRef);
    const committedStepRef = committedByParticipant.get(participantRef);
    const selectedStepRef = selectedByParticipant.get(participantRef);
    return {
      participantRef,
      displayName: participant?.displayName ?? participantRef,
      ...(participant?.position ? { position: participant.position } : {}),
      ...(participant?.currentGoal ? { currentGoal: participant.currentGoal } : {}),
      status: committedStepRef
        ? 'committed'
        : selectedStepRef
          ? 'selected'
          : participantRef === activeParticipantRef
            ? 'current'
            : 'waiting',
      ...(committedStepRef ?? selectedStepRef
        ? { stepRef: (committedStepRef ?? selectedStepRef)! }
        : {}),
    };
  });
}

export function projectPlayRehearsalSteps(
  session: PlayRehearsalSessionV5,
  attempt: ReadonlyPlayRehearsalAttempt | undefined,
  run: PlayActorStepRun | undefined,
  result: ReadonlyPlayRehearsalResult | undefined,
): PlayRehearsalStepView[] {
  const participantNames = participantNameMap(session);
  const committedRefs = new Set(result?.evidence.selectedStepRefs ?? []);
  const projected = (attempt?.steps ?? []).map((step) =>
    projectAttemptStep(step, participantNames, committedRefs));
  const existingRefs = new Set(projected.map((step) => step.id));

  for (const step of result?.evidence.steps ?? []) {
    if (!existingRefs.has(step.stepRef)) {
      projected.push({
        id: step.stepRef,
        participantRef: step.participantRef,
        participantName: participantNames.get(step.participantRef) ?? step.participantRef,
        ...(step.intentSummary ? { intentSummary: step.intentSummary } : {}),
        status: 'committed',
        blocks: step.narrativeBlocks
          .filter(isPlayerSafeNarrativeBlock)
          .map((block) => projectNarrativeBlock(block, participantNames)),
        ...(step.variantOf ? { variantOf: step.variantOf } : {}),
      });
      existingRefs.add(step.stepRef);
    }
  }

  if (
    run &&
    ['starting', 'streaming', 'stopping'].includes(run.phase) &&
    !run.preparedStepRef
  ) {
    const participantRef = run.participantRef ?? currentParticipantRef(session, attempt);
    if (participantRef) {
      projected.push({
        id: run.localId,
        participantRef,
        participantName: participantNames.get(participantRef) ?? participantRef,
        status: 'provisional',
        blocks: run.provisionalText
          ? [{
              id: `${run.localId}-delta`,
              kind: 'characterAction',
              content: run.provisionalText,
              speakerName: participantNames.get(participantRef) ?? participantRef,
              projection: 'transcript',
            }]
          : [],
      });
    }
  }

  return projected;
}

export function projectPlayRehearsalStepRun(
  run: PlayActorStepRun | undefined,
): PlayRehearsalStepRunView | undefined {
  if (!run) return undefined;
  return {
    id: run.runId ?? run.localId,
    phase: run.phase === 'aborted'
      ? 'idle'
      : run.phase === 'indeterminate'
        ? 'failed'
        : run.phase,
    statusMessage: run.statusMessage,
    ...(run.error ? { error: run.error } : {}),
  };
}

export function projectPlayRehearsalPerception(
  session: PlayRehearsalSessionV5,
  attempt: ReadonlyPlayRehearsalAttempt | undefined,
): PlayRehearsalPerceptionView | undefined {
  const participantRef = currentParticipantRef(session, attempt);
  if (!participantRef) return undefined;
  const participant = session.sceneRehearsal.participants.find((candidate) =>
    candidate.participantRef === participantRef);
  const evidenceRefs = new Set(participant?.initialKnowledgeEvidenceRefs ?? []);
  const initialKnowledge = session.sceneRehearsal.initialKnowledgeEvidence
    .filter((evidence) =>
      evidence.participantRef === participantRef && evidenceRefs.has(evidence.id));
  const observedBlockLabels = selectedVisiblePerceptionBlocks(session, attempt)
    .map((block) => block.content);
  const committedGrantRecords = readCommittedParticipantKnowledgeGrants(
    session.playLocalState.playKnowledge,
    participantRef,
  );
  const committedGrants = committedGrantRecords.map((record) => projectGrantedKnowledge(
    session,
    record.id,
    record.grant,
    `Committed at ${record.grantedAtTurnId}`,
  ));
  const committedInterventionRefs = new Set(
    committedGrantRecords.map((record) => record.interventionRef),
  );
  const provisionalGrants = (attempt?.interventions ?? []).flatMap((intervention) => {
    if (
      intervention.kind !== 'grantKnowledge' ||
      intervention.participantRef !== participantRef ||
      !intervention.grant ||
      committedInterventionRefs.has(intervention.id)
    ) return [];
    return [projectGrantedKnowledge(
      session,
      intervention.id,
      intervention.grant,
      intervention.grant.kind === 'existingFact'
        ? 'Existing selected-branch evidence'
        : `Author-provided at ${intervention.grant.providedAt}`,
    )];
  });
  const grantedKnowledge = [...committedGrants, ...provisionalGrants];
  return {
    participantRef,
    visibleFacts: initialKnowledge.map((evidence) => evidence.fact),
    visibleFactVisibilities: initialKnowledge.map((evidence) => evidence.visibility),
    behaviorAnchors: [participant?.currentGoal]
      .filter((value): value is string => Boolean(value)),
    observedBlockLabels,
    ...(grantedKnowledge.length ? { grantedKnowledge } : {}),
  };
}

function readCommittedParticipantKnowledgeGrants(
  value: unknown,
  participantRef: string,
): PlayParticipantKnowledgeGrantRecord[] {
  if (
    !isStateRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records)
  ) return [];
  return value.records.flatMap((record) => {
    if (
      !isStateRecord(record) ||
      record.kind !== 'participantGrant' ||
      record.participantRef !== participantRef ||
      typeof record.id !== 'string' ||
      typeof record.interventionRef !== 'string' ||
      typeof record.effectiveFromStepRef !== 'string' ||
      typeof record.grantedAtTurnId !== 'string' ||
      record.canonical !== false ||
      !isDirectorKnowledgeGrant(record.grant)
    ) return [];
    return [record as unknown as PlayParticipantKnowledgeGrantRecord];
  });
}

function projectGrantedKnowledge(
  session: PlayRehearsalSessionV5,
  id: string,
  grant:
    | { readonly kind: 'existingFact'; readonly factRefs: readonly string[] }
    | {
        readonly kind: 'authorProvidedPlayFact';
        readonly summary: string;
        readonly visibility: PlayEventVisibility;
        readonly providedAt: string;
      },
  provenanceLabel: string,
): NonNullable<PlayRehearsalPerceptionView['grantedKnowledge']>[number] {
  if (grant.kind === 'authorProvidedPlayFact') {
    return {
      id,
      summary: grant.summary,
      provenanceLabel,
      visibility: grant.visibility,
    };
  }
  const resolved = grant.factRefs.map((factRef) => {
    const evidence = session.sceneRehearsal.initialKnowledgeEvidence.find((item) =>
      item.id === factRef);
    if (evidence) return { summary: evidence.fact, visibility: evidence.visibility };
    const event = session.events.find((item) => item.id === factRef);
    if (event) {
      return {
        summary: `${event.title}: ${event.summary}`,
        visibility: event.visibility,
      };
    }
    // A bounded event window may not include an older stable fact. Keep its
    // identity Director-only instead of guessing that it is player-visible.
    return {
      summary: `Stable fact ${factRef}`,
      visibility: 'playerUnknown' as const,
    };
  });
  return {
    id,
    summary: resolved.map((item) => item.summary).join('\n'),
    provenanceLabel,
    visibility: strictestPlayVisibility(resolved.map((item) => item.visibility)),
  };
}

function isDirectorKnowledgeGrant(
  value: unknown,
): value is PlayParticipantKnowledgeGrantRecord['grant'] {
  if (!isStateRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'existingFact') {
    return Array.isArray(value.factRefs) &&
      value.factRefs.length > 0 &&
      value.factRefs.every((item) => typeof item === 'string' && Boolean(item));
  }
  return value.kind === 'authorProvidedPlayFact' &&
    typeof value.summary === 'string' &&
    Boolean(value.summary) &&
    isPlayVisibility(value.visibility) &&
    typeof value.providedAt === 'string';
}

function strictestPlayVisibility(
  values: readonly PlayEventVisibility[],
): PlayEventVisibility {
  return values.includes('playerUnknown')
    ? 'playerUnknown'
    : values.includes('rumor')
      ? 'rumor'
      : 'playerVisible';
}

function isPlayVisibility(value: unknown): value is PlayEventVisibility {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

export function projectPlayRehearsalVisibleEvents(
  session: PlayRehearsalSessionV5,
  attempt?: ReadonlyPlayRehearsalAttempt,
): PlayRehearsalVisibleEventView[] {
  const observedEventIds = new Set(
    selectedVisiblePerceptionBlocks(session, attempt)
      .flatMap((block) => block.eventRefs ?? []),
  );
  return session.events
    .filter((event) =>
      observedEventIds.has(event.id) &&
      event.visibility !== 'playerUnknown')
    .map((event) => ({
      id: event.id,
      title: event.title,
      summary: event.summary,
    }));
}

function selectedVisiblePerceptionBlocks(
  session: PlayRehearsalSessionV5,
  attempt: ReadonlyPlayRehearsalAttempt | undefined,
): Array<DeepReadonly<NarrativeBlock | PlayActorNarrativeBlockRecord>> {
  const selectedArtifactIds = new Set(session.selectedTurnIds);
  const committedBlocks = session.rehearsalScenes
    .flatMap((scene) => scene.turns)
    .filter((evidence) => selectedArtifactIds.has(evidence.owningTurnArtifactId))
    .flatMap((evidence) => evidence.narrativeBlocks);
  const selectedStepRefs = new Set(attempt?.selectedStepRefs ?? []);
  const attemptBlocks = (attempt?.steps ?? [])
    .filter((step) => selectedStepRefs.has(step.id))
    .flatMap((step) => step.narrativeBlocks ?? []);
  const blocks = [...committedBlocks, ...attemptBlocks]
    .filter(isPlayerSafeNarrativeBlock);
  return blocks.filter((block, index) =>
    blocks.findIndex((candidate) => candidate.id === block.id) === index);
}

export function projectPlayRehearsalResult(
  result: ReadonlyPlayRehearsalResult | undefined,
): PlayRehearsalResultView | undefined {
  if (!result) return undefined;
  const participantNames = participantNameMap(result.session);
  const blocks = result.evidence.narrativeBlocks
    .filter(isPlayerSafeNarrativeBlock)
    .map((block) => projectNarrativeBlock(block, participantNames));
  const eventIds = new Set(result.artifact.eventIds);
  const eventSummaries = result.session.events
    .filter((event) =>
      eventIds.has(event.id) && event.visibility !== 'playerUnknown')
    .map((event) => event.summary);
  const summary = blocks
    .map((block) => block.content)
    .join(' ')
    .trim() || `Scene rehearsal committed with ${result.evidence.steps.length} actor steps.`;

  return {
    artifactRef: result.artifact.id,
    revision: result.artifact.revision,
    summary,
    blocks,
    eventSummaries,
    stateChanges: flattenStateDeltaLeaves(result.artifact.stateDelta)
      .filter(([label]) =>
        !isReservedStatePath(label) &&
        result.session.playLocalStateVisibility[label] === 'playerVisible')
      .map(([label, value]) => ({
        label,
        after: formatStateValue(value),
      })),
  };
}

function projectAttemptStep(
  step: DeepReadonly<PlayActorStepRecord>,
  participantNames: ReadonlyMap<string, string>,
  committedRefs: ReadonlySet<string>,
): PlayRehearsalStepView {
  return {
    id: step.id,
    participantRef: step.participantRef,
    participantName: participantNames.get(step.participantRef) ?? step.participantRef,
    ...(step.intentSummary ? { intentSummary: step.intentSummary } : {}),
    status: committedRefs.has(step.id)
      ? 'committed'
      : step.status === 'draft'
        ? 'provisional'
        : step.status === 'selected'
          ? 'selected'
          : 'superseded',
    blocks: (step.narrativeBlocks ?? [])
      .filter(isPlayerSafeNarrativeBlock)
      .map((block) => projectNarrativeBlock(block, participantNames)),
    ...(step.variantOf ? { variantOf: step.variantOf } : {}),
    ...(step.effectFingerprint
      ? { effectFingerprint: step.effectFingerprint }
      : {}),
    ...(step.materialEffect
      ? {
          materialEffect: step.materialEffect.kind === 'materialEffect'
            ? { kind: 'materialEffect' as const }
            : {
                kind: 'noMaterialEffect' as const,
                reason: step.materialEffect.reason,
              },
        }
      : {}),
  };
}

function projectNarrativeBlock(
  block: DeepReadonly<NarrativeBlock | PlayActorNarrativeBlockRecord>,
  participantNames: ReadonlyMap<string, string>,
): PlayRehearsalNarrativeBlockView {
  return {
    id: block.id,
    kind: block.kind,
    content: block.content,
    ...(block.speakerRef
      ? { speakerName: participantNames.get(block.speakerRef) ?? block.speakerRef }
      : {}),
    projection: block.projection,
  };
}

function isPlayerSafeNarrativeBlock(block: {
  readonly projection: 'transcript' | 'directorOnly';
  readonly visibility?: string;
}): boolean {
  return block.projection === 'transcript' && block.visibility !== 'playerUnknown';
}

/**
 * Projects structured state into exact dotted leaf paths before visibility is
 * considered. This keeps a visible sibling useful without exposing another
 * sibling through its parent object.
 */
export function flattenStateDeltaLeaves(
  stateDelta: Readonly<Record<string, unknown>>,
): Array<[path: string, value: unknown]> {
  const leaves: Array<[path: string, value: unknown]> = [];
  const pending: Array<[path: string, value: unknown]> = Object.entries(stateDelta)
    .reverse();

  while (pending.length > 0) {
    const [path, value] = pending.pop()!;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        leaves.push([path, value]);
        continue;
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push([`${path}.${index}`, value[index]]);
      }
      continue;
    }

    if (isStateRecord(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        leaves.push([path, value]);
        continue;
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, nestedValue] = entries[index]!;
        pending.push([`${path}.${key}`, nestedValue]);
      }
      continue;
    }

    leaves.push([path, value]);
  }

  return leaves;
}

function isStateRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}

function isReservedStatePath(path: string): boolean {
  return path === 'worldMomentum' || path.startsWith('worldMomentum.');
}

function currentParticipantRef(
  _session: PlayRehearsalSessionV5,
  attempt: ReadonlyPlayRehearsalAttempt | undefined,
): string | undefined {
  if (!attempt || attempt.status !== 'running') return undefined;
  const currentStep = attempt.currentStepRef
    ? attempt.steps.find((step) => step.id === attempt.currentStepRef)
    : undefined;
  return currentStep?.participantRef ??
    attempt.actorOrder[
      attempt.selectedStepRefs.length
    ];
}

function participantNameMap(
  session: {
    readonly sceneRehearsal: {
      readonly participants: readonly {
        readonly participantRef: string;
        readonly displayName: string;
      }[];
    };
  },
): Map<string, string> {
  return new Map(session.sceneRehearsal.participants.map((participant) => [
    participant.participantRef,
    participant.displayName,
  ]));
}

function assertCompleteActorOrder(submission: PlayRehearsalSetupSubmission): void {
  const participantRefs = submission.participants.map((participant) =>
    participant.participantRef);
  if (
    new Set(participantRefs).size !== participantRefs.length ||
    submission.actorOrder.length !== participantRefs.length ||
    submission.actorOrder.some((participantRef) => !participantRefs.includes(participantRef))
  ) {
    throw new Error('Rehearsal setup actor order must contain every participant exactly once.');
  }
}

function uniqueSafeRef(
  requested: string,
  fallback: string,
  used: Set<string>,
): string {
  const requestedRef = isSafeRef(requested) ? requested : fallback;
  const base = requestedRef.slice(0, 170);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 170 - String(suffix).length)}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function safeRefFromText(value: string, fallback: string, prefix: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '')
    .replace(/\.{2,}/gu, '.')
    .slice(0, 160);
  const candidate = slug ? `${prefix}-${slug}` : fallback;
  return isSafeRef(candidate) ? candidate : fallback;
}

function isSafeRef(value: string): boolean {
  return value.length <= 180 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
    !value.includes('..') &&
    !value.includes('/') &&
    !value.includes('\\');
}

function formatStateValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unavailable]';
  }
}
