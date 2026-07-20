import { isDeepStrictEqual } from 'node:util';

import { normalizePlayScheduledEvents } from './play-event-schedule.js';
import type { PlayScheduledEvent } from './play-event-schedule.js';
import {
  fingerprintPlayAdoptionEvidenceClosure,
  normalizePlayAdoptionEvidenceClosure,
  normalizePlayAdoptionSeed,
} from './play-adoption.js';
import {
  PLAY_KNOWLEDGE_STATE_KEY,
  assertPlayKnowledgeHistory,
  assertPlayKnowledgeTransition,
  readPlayKnowledgeState,
} from './play-knowledge.js';
import {
  collectPlayArtifactAncestorIds,
  hasCompletePlayBranchSnapshot,
  validatePlayScheduledEventHistory,
} from './play-event-schedule-history.js';
import {
  PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION,
  assertSafePlayTurnArtifactId,
  createLegacyPlayTurnArtifacts,
  normalizePlayTurnArtifact,
  projectPlayTranscript,
  selectDefaultPlayTurnPath,
} from './play-turn-artifact.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type {
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayEventOrigin,
  PlayEventVisibility,
  PlayObservation,
  PlayTranscriptTurn,
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldEventCause,
  PlayWorldEventKind,
  PlayWorldRefereeSettlementEvent,
} from './play-types.js';
import {
  PLAY_WORLD_MOMENTUM_STATE_KEY,
  assertPlayWorldMomentumTransition,
  formatPlayRelativeTimeAdvance,
  readPlayWorldMomentum,
} from './play-world-momentum.js';
import {
  normalizePlayCommittedSceneEvidence,
  normalizePlaySceneRehearsalSidecar,
} from './play-rehearsal.js';
import type {
  PlayCommittedSceneEvidence,
  PlayRehearsalTurnEvidence,
  PlaySceneRehearsalSidecar,
} from './play-rehearsal.js';

export interface PlayBranchBaseSnapshot {
  parentTurnId?: string;
  worldClock: PlayWorldClock;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
}

export interface MaterializePlayTurnFactsInput {
  revision: number;
  transcript: PlayTranscriptTurn[];
  turnArtifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  branchSnapshotRequiredFromRevision: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  events: PlayWorldEvent[];
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
  sceneRehearsal?: PlaySceneRehearsalSidecar;
  rehearsalScenes?: PlayCommittedSceneEvidence[];
}

export type PlaySessionRevisionSource = Pick<
  MaterializePlayTurnFactsInput,
  'revision' | 'worldClock'
>;

const PLAY_EVENT_VISIBILITIES: readonly PlayEventVisibility[] = [
  'playerVisible',
  'rumor',
  'playerUnknown',
];

const PLAY_EVENT_ORIGINS: readonly PlayEventOrigin[] = [
  'player',
  'npc',
  'faction',
  'clock',
  'environment',
  'worldRule',
  'manual',
];

const PLAY_WORLD_EVENT_KINDS: readonly PlayWorldEventKind[] = [
  'environmentChanged',
  'locationChanged',
  'npcActed',
  'factionActed',
  'arrival',
  'departure',
  'deadlineAdvanced',
  'resourceChanged',
  'itemMoved',
  'evidenceChanged',
  'relationshipChanged',
  'informationSpread',
  'ruleConsequence',
  'manual',
];

const PLAY_ADOPTION_TARGETS: readonly PlayAdoptionTarget[] = [
  'chapterDraft',
  'state',
  'timeline',
  'foreshadow',
];


export const createPlayAdoptionCandidate = (
  input: Omit<
    PlayAdoptionCandidate,
    | 'requiresPendingAction'
    | 'visibility'
    | 'sourceObservationIds'
    | 'sourceTurnIds'
    | 'sourceEventIds'
  > & Partial<Pick<
    PlayAdoptionCandidate,
    | 'visibility'
    | 'sourceObservationIds'
    | 'sourceTurnIds'
    | 'sourceEventIds'
  >>,
): PlayAdoptionCandidate => ({
  ...input,
  ...(input.payload ? { payload: structuredClone(input.payload) } : {}),
  ...(input.seed ? { seed: structuredClone(input.seed) } : {}),
  ...(input.evidenceClosure
    ? { evidenceClosure: structuredClone(input.evidenceClosure) }
    : {}),
  visibility: input.visibility ?? 'playerVisible',
  sourceObservationIds: [...(input.sourceObservationIds ?? [])],
  sourceTurnIds: [...(input.sourceTurnIds ?? [])],
  sourceEventIds: [...(input.sourceEventIds ?? [])],
  requiresPendingAction: true,
});

export function materializePlayTurnFacts(
  session: MaterializePlayTurnFactsInput,
): {
  transcript: PlayTranscriptTurn[];
  turnArtifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  selectedMessageIds: Set<string>;
  selectedEventIds: Set<string>;
  selectedObservationIds: Set<string>;
  selectedScheduledEvents: PlayScheduledEvent[];
  selectedPlayLocalState: Record<string, unknown>;
  selectedPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  selectedSuggestedActions: string[];
  selectedRehearsalEvidence: PlayRehearsalTurnEvidence[];
  branchBaseSnapshot: PlayBranchBaseSnapshot;
} {
  const storedArtifacts = Array.isArray(session.turnArtifacts)
    ? session.turnArtifacts.map(normalizePlayTurnArtifact)
    : [];
  const usesStoredArtifacts = storedArtifacts.length > 0;
  const turnArtifacts = usesStoredArtifacts
    ? storedArtifacts
    : createLegacyPlayTurnArtifacts({
        transcript: session.transcript ?? [],
        events: session.events,
        observations: session.observations,
      });
  const selectedTurnIds = usesStoredArtifacts && Array.isArray(session.selectedTurnIds)
    ? session.selectedTurnIds.map(assertSafePlayTurnArtifactId)
    : selectDefaultPlayTurnPath(turnArtifacts);
  const branchBaseSnapshot = normalizePlayBranchBaseSnapshot(
    session.branchBaseSnapshot,
  );

  const validated = validatePlayTurnFacts({
    turnArtifacts,
    selectedTurnIds,
    events: session.events,
    scheduledEvents: session.scheduledEvents,
    observations: session.observations,
    adoptionCandidates: session.adoptionCandidates,
    currentRevision: resolvePlaySessionRevision(session, turnArtifacts),
    currentWorldTurn: session.worldClock.turn,
    sessionWorldClock: session.worldClock,
    sessionPlayLocalState: session.playLocalState,
    sessionPlayLocalStateVisibility: session.playLocalStateVisibility,
    branchSnapshotRequiredFromRevision:
      session.branchSnapshotRequiredFromRevision,
    branchBaseSnapshot,
    sessionSuggestedActions: session.suggestedActions,
    sceneRehearsal: session.sceneRehearsal,
    rehearsalScenes: session.rehearsalScenes,
  });

  return {
    ...validated,
    turnArtifacts,
    selectedTurnIds,
    branchBaseSnapshot,
  };
}

export interface ValidatePlayTurnFactsInput {
  turnArtifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  events: PlayWorldEvent[];
  scheduledEvents: PlayScheduledEvent[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
  currentRevision: number;
  currentWorldTurn: number;
  sessionWorldClock: PlayWorldClock;
  sessionPlayLocalState: Record<string, unknown>;
  sessionPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  branchSnapshotRequiredFromRevision: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
  sessionSuggestedActions: string[];
  sceneRehearsal?: PlaySceneRehearsalSidecar;
  rehearsalScenes?: PlayCommittedSceneEvidence[];
}

export interface ValidatedPlayTurnFacts {
  transcript: PlayTranscriptTurn[];
  selectedMessageIds: Set<string>;
  selectedEventIds: Set<string>;
  selectedObservationIds: Set<string>;
  selectedScheduledEvents: PlayScheduledEvent[];
  selectedPlayLocalState: Record<string, unknown>;
  selectedPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  selectedSuggestedActions: string[];
  selectedRehearsalEvidence: PlayRehearsalTurnEvidence[];
}

export function validatePlayTurnFacts(
  input: ValidatePlayTurnFactsInput,
): ValidatedPlayTurnFacts {
  const roots = input.turnArtifacts.filter((artifact) => !artifact.parentTurnId);
  if (
    roots.length > 1 &&
    (
      input.branchBaseSnapshot.parentTurnId !== undefined ||
      roots.some((artifact) => !hasCompletePlayBranchSnapshot(artifact))
    )
  ) {
    throw new Error(
      'Play turn artifact forest roots must be complete v2 snapshots sharing the virtual branch base.',
    );
  }
  for (const event of input.events) {
    assertPlayWorldEvent(event, { strict: true });
  }
  for (const observation of input.observations) {
    assertPlayObservation(observation, { strict: true });
  }
  const adoptionCandidates = input.adoptionCandidates.map((candidate) =>
    assertPlayAdoptionCandidate(candidate, { strict: true }));
  const adoptionCandidateIds = new Set<string>();
  for (const candidate of adoptionCandidates) {
    if (adoptionCandidateIds.has(candidate.id)) {
      throw new Error(
        `Play adoption candidate ledger contains duplicate id: ${candidate.id}.`,
      );
    }
    adoptionCandidateIds.add(candidate.id);
  }
  if (
    input.turnArtifacts.length &&
    !input.selectedTurnIds.length &&
    (
      input.branchBaseSnapshot.parentTurnId !== undefined ||
      roots.some((artifact) => !hasCompletePlayBranchSnapshot(artifact))
    )
  ) {
    throw new Error(
      'Play turn artifacts require a selected path or a complete v2 forest at the virtual branch base.',
    );
  }
  const transcript = projectPlayTranscript(
    input.turnArtifacts,
    input.selectedTurnIds,
  );
  const artifactsById = new Map(
    input.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const messagesById = new Map<string, PlayTranscriptTurn>();
  const messageOwners = new Map<string, string>();
  for (const artifact of input.turnArtifacts) {
    for (const message of artifact.messages) {
      if (!message.id) {
        throw new Error(`Play turn artifact ${artifact.id} contains a message without id.`);
      }
      if (messagesById.has(message.id)) {
        throw new Error(`Play turn artifacts contain duplicate message id: ${message.id}.`);
      }
      messagesById.set(message.id, message);
      messageOwners.set(message.id, artifact.id);
    }
  }

  const eventsById = indexUniquePlayFacts(input.events, 'event');
  const scheduledEvents = normalizePlayScheduledEvents(input.scheduledEvents);
  const observationsById = indexUniquePlayFacts(input.observations, 'observation');
  const eventOwners = new Map<string, string>();
  const observationOwners = new Map<string, string>();

  for (const event of input.events) {
    if (!messagesById.has(event.turnId)) {
      throw new Error(`Play event ${event.id} references unknown turn: ${event.turnId}.`);
    }
    assertKnownPlayFactReferences(
      `Play event ${event.id}`,
      event.cause.sourceTurnIds ?? [],
      event.cause.sourceEventIds ?? [],
      messagesById,
      eventsById,
    );
  }
  for (const observation of input.observations) {
    assertKnownPlayFactReferences(
      `Play observation ${observation.id}`,
      observation.sourceTurnIds,
      observation.sourceEventIds,
      messagesById,
      eventsById,
    );
  }

  for (const artifact of input.turnArtifacts) {
    const ownMessageIds = new Set(artifact.messages.map((message) => message.id!));
    const allowedArtifactIds: string[] = [];
    let current: PlayTurnArtifact | undefined = artifact;
    while (current) {
      allowedArtifactIds.push(current.id);
      current = current.parentTurnId
        ? artifactsById.get(current.parentTurnId)
        : undefined;
    }
    const allowedMessageIds = new Set(
      allowedArtifactIds.flatMap((artifactId) =>
        artifactsById.get(artifactId)!.messages.map((message) => message.id!)),
    );
    const allowedEventIds = new Set(
      allowedArtifactIds.flatMap((artifactId) =>
        artifactsById.get(artifactId)!.eventIds),
    );

    for (const eventId of artifact.eventIds) {
      const event = eventsById.get(eventId);
      if (!event) {
        throw new Error(`Play turn artifact ${artifact.id} references missing event: ${eventId}.`);
      }
      const existingOwner = eventOwners.get(eventId);
      if (existingOwner) {
        throw new Error(
          `Play event ${eventId} belongs to multiple artifacts: ${existingOwner}, ${artifact.id}.`,
        );
      }
      eventOwners.set(eventId, artifact.id);
      if (!ownMessageIds.has(event.turnId)) {
        throw new Error(
          `Play event ${eventId} turnId does not belong to artifact ${artifact.id}.`,
        );
      }
      assertScopedPlayFactReferences(
        `Play event ${eventId}`,
        event.cause.sourceTurnIds ?? [],
        event.cause.sourceEventIds ?? [],
        allowedMessageIds,
        allowedEventIds,
      );
    }

    for (const observationId of artifact.observationIds) {
      const observation = observationsById.get(observationId);
      if (!observation) {
        throw new Error(
          `Play turn artifact ${artifact.id} references missing observation: ${observationId}.`,
        );
      }
      const existingOwner = observationOwners.get(observationId);
      if (existingOwner) {
        throw new Error(
          `Play observation ${observationId} belongs to multiple artifacts: ${existingOwner}, ${artifact.id}.`,
        );
      }
      observationOwners.set(observationId, artifact.id);
      assertScopedPlayFactReferences(
        `Play observation ${observationId}`,
        observation.sourceTurnIds,
        observation.sourceEventIds,
        allowedMessageIds,
        allowedEventIds,
      );
    }
  }

  for (const event of input.events) {
    if (!eventOwners.has(event.id)) {
      throw new Error(`Play event ${event.id} is not owned by a turn artifact.`);
    }
  }

  const selectedArtifacts = input.selectedTurnIds.map((id) => artifactsById.get(id)!);
  const selectedMessageIds = new Set(
    selectedArtifacts.flatMap((artifact) =>
      artifact.messages.map((message) => message.id!)),
  );
  const selectedEventIds = new Set(
    selectedArtifacts.flatMap((artifact) => artifact.eventIds),
  );
  const selectedObservationIds = new Set(
    selectedArtifacts.flatMap((artifact) => artifact.observationIds),
  );
  const selectedArtifactIds = new Set(input.selectedTurnIds);
  for (const observation of input.observations) {
    if (observationOwners.has(observation.id)) {
      continue;
    }
    const provenanceArtifactIds = collectPlayReferenceOwnerArtifactIds(
      observation.sourceTurnIds,
      observation.sourceEventIds,
      messageOwners,
      eventOwners,
    );
    assertPlayReferenceOwnersShareBranch(
      `Play unowned observation ${observation.id}`,
      provenanceArtifactIds,
      artifactsById,
    );
    if (provenanceArtifactIds.every((artifactId) =>
      selectedArtifactIds.has(artifactId))) {
      selectedObservationIds.add(observation.id);
    }
  }
  for (const candidate of adoptionCandidates) {
    assertKnownPlayFactReferences(
      `Play adoption candidate ${candidate.id}`,
      candidate.sourceTurnIds,
      candidate.sourceEventIds,
      messagesById,
      eventsById,
    );
    const unknownObservationId = candidate.sourceObservationIds.find(
      (observationId) => !observationsById.has(observationId),
    );
    if (unknownObservationId) {
      throw new Error(
        `Play adoption candidate ${candidate.id} references unknown ` +
        `observation: ${unknownObservationId}.`,
      );
    }
    const provenanceArtifactIds = collectPlayReferenceOwnerArtifactIds(
      candidate.sourceTurnIds,
      candidate.sourceEventIds,
      messageOwners,
      eventOwners,
    );
    if (candidate.evidenceClosure) {
      for (const artifactRef of [
        ...candidate.evidenceClosure.selectedArtifactTurnRefs,
        ...candidate.evidenceClosure.artifactTurnRefs,
      ]) {
        if (!artifactsById.has(artifactRef)) {
          throw new Error(
            `Play adoption candidate ${candidate.id} evidence closure ` +
            `references unknown artifact: ${artifactRef}.`,
          );
        }
        provenanceArtifactIds.push(artifactRef);
      }
    }
    for (const observationId of candidate.sourceObservationIds) {
      const observation = observationsById.get(observationId)!;
      const observationOwnerId = observationOwners.get(observationId);
      if (observationOwnerId) {
        provenanceArtifactIds.push(observationOwnerId);
        continue;
      }
      provenanceArtifactIds.push(...collectPlayReferenceOwnerArtifactIds(
        observation.sourceTurnIds,
        observation.sourceEventIds,
        messageOwners,
        eventOwners,
      ));
    }
    assertPlayReferenceOwnersShareBranch(
      `Play adoption candidate ${candidate.id}`,
      provenanceArtifactIds,
      artifactsById,
    );
  }

  const selectedBranchSnapshot = validatePlayBranchSnapshots({
    artifacts: input.turnArtifacts,
    artifactsById,
    selectedTurnIds: input.selectedTurnIds,
    eventsById,
    sessionWorldClock: input.sessionWorldClock,
    sessionPlayLocalState: input.sessionPlayLocalState,
    sessionPlayLocalStateVisibility: input.sessionPlayLocalStateVisibility,
    currentRevision: input.currentRevision,
    branchSnapshotRequiredFromRevision:
      input.branchSnapshotRequiredFromRevision,
    branchBaseSnapshot: input.branchBaseSnapshot,
    sessionSuggestedActions: input.sessionSuggestedActions,
  });

  const selectedScheduledEvents = validatePlayScheduledEventHistory({
    artifacts: input.turnArtifacts,
    artifactsById,
    selectedTurnIds: input.selectedTurnIds,
    ledger: scheduledEvents,
    messageOwners,
    eventOwners,
    eventsById,
    currentRevision: input.currentRevision,
    currentWorldTurn: input.currentWorldTurn,
    branchBaseSnapshot: input.branchBaseSnapshot,
  });
  const selectedRehearsalEvidence = validatePlayRehearsalEvidence({
    artifacts: input.turnArtifacts,
    selectedTurnIds: input.selectedTurnIds,
    eventsById,
    sidecar: input.sceneRehearsal,
    scenes: input.rehearsalScenes,
  });

  return {
    transcript,
    selectedMessageIds,
    selectedEventIds,
    selectedObservationIds,
    selectedScheduledEvents,
    selectedPlayLocalState: selectedBranchSnapshot.playLocalState,
    selectedPlayLocalStateVisibility:
      selectedBranchSnapshot.playLocalStateVisibility,
    selectedSuggestedActions: selectedBranchSnapshot.suggestedActions,
    selectedRehearsalEvidence,
  };
}

function validatePlayRehearsalEvidence(input: {
  artifacts: PlayTurnArtifact[];
  selectedTurnIds: string[];
  eventsById: Map<string, PlayWorldEvent>;
  sidecar?: PlaySceneRehearsalSidecar;
  scenes?: PlayCommittedSceneEvidence[];
}): PlayRehearsalTurnEvidence[] {
  if ((input.sidecar === undefined) !== (input.scenes === undefined)) {
    throw new Error('Play rehearsal sidecar and committed scenes must appear together.');
  }
  if (!input.sidecar || !input.scenes) {
    const rehearsalArtifact = input.artifacts.find((artifact) =>
      artifact.schemaVersion === PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION ||
      artifact.rehearsalEvidenceRefs !== undefined);
    if (rehearsalArtifact) {
      throw new Error(
        `Play artifact ${rehearsalArtifact.id} carries rehearsal evidence without a sidecar.`,
      );
    }
    return [];
  }

  const sidecar = normalizePlaySceneRehearsalSidecar(input.sidecar);
  const scenes = input.scenes.map(normalizePlayCommittedSceneEvidence);
  if (scenes.length !== 1 || scenes[0]?.sceneId !== sidecar.activeSceneRef) {
    throw new Error('Play rehearsal evidence does not match the active scene.');
  }
  const evidence = scenes.flatMap((scene) => scene.turns);
  const evidenceById = new Map<string, PlayRehearsalTurnEvidence>();
  for (const turnEvidence of evidence) {
    if (evidenceById.has(turnEvidence.id)) {
      throw new Error(`Play rehearsal evidence contains duplicate id: ${turnEvidence.id}.`);
    }
    evidenceById.set(turnEvidence.id, turnEvidence);
  }
  const referencedEvidenceIds = new Set<string>();
  for (const artifact of input.artifacts) {
    if (artifact.schemaVersion !== PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION) {
      throw new Error(
        `Play rehearsal artifact ${artifact.id} must use schema v3 evidence refs.`,
      );
    }
    const artifactsById = new Map(input.artifacts.map((candidate) => [
      candidate.id,
      candidate,
    ]));
    const owningEventIds = new Set(artifact.eventIds);
    const allowedEventIds = new Set<string>();
    let ancestor: PlayTurnArtifact | undefined = artifact;
    while (ancestor) {
      for (const eventId of ancestor.eventIds) allowedEventIds.add(eventId);
      ancestor = ancestor.parentTurnId
        ? artifactsById.get(ancestor.parentTurnId)
        : undefined;
    }
    for (const evidenceRef of artifact.rehearsalEvidenceRefs ?? []) {
      if (referencedEvidenceIds.has(evidenceRef)) {
        throw new Error(`Play rehearsal evidence belongs to multiple artifacts: ${evidenceRef}.`);
      }
      referencedEvidenceIds.add(evidenceRef);
      const turnEvidence = evidenceById.get(evidenceRef);
      if (!turnEvidence) {
        throw new Error(
          `Play rehearsal artifact ${artifact.id} references missing evidence: ${evidenceRef}.`,
        );
      }
      if (turnEvidence.owningTurnArtifactId !== artifact.id) {
        throw new Error(
          `Play rehearsal evidence ${evidenceRef} does not point back to artifact ${artifact.id}.`,
        );
      }
      if (turnEvidence.steps.length !== sidecar.participants.length) {
        throw new Error(
          `Play rehearsal evidence ${evidenceRef} does not cover the scene participants.`,
        );
      }
      const evidenceParticipantRefs = turnEvidence.steps.map((step) =>
        step.participantRef);
      if (
        new Set(evidenceParticipantRefs).size !== evidenceParticipantRefs.length ||
        sidecar.participants.some((participant) =>
          !evidenceParticipantRefs.includes(participant.participantRef))
      ) {
        throw new Error(
          `Play rehearsal evidence ${evidenceRef} does not contain one step per participant.`,
        );
      }
      const committedKnowledge = readPlayKnowledgeState(
        artifact.playLocalStateSnapshot ?? {},
      );
      const unknownGrantParticipant = committedKnowledge.records.find((record) =>
        record.kind === 'participantGrant' &&
        !sidecar.participants.some((participant) =>
          participant.participantRef === record.participantRef));
      if (unknownGrantParticipant?.kind === 'participantGrant') {
        throw new Error(
          `Play participant knowledge grant ${unknownGrantParticipant.id} ` +
          `references an unknown scene participant: ${unknownGrantParticipant.participantRef}.`,
        );
      }
      const stepSettlementEventRefs: string[] = [];
      for (const step of turnEvidence.steps) {
        const participant = sidecar.participants.find((candidate) =>
          candidate.participantRef === step.participantRef)!;
        const allowedEvidenceRefs = new Set(
          participant.initialKnowledgeEvidenceRefs,
        );
        for (const record of committedKnowledge.records) {
          if (
            record.kind !== 'participantGrant' ||
            record.participantRef !== participant.participantRef
          ) continue;
          allowedEvidenceRefs.add(derivePlayParticipantKnowledgeEvidenceId(
            record.interventionRef,
          ));
          if (record.grant.kind === 'existingFact') {
            for (const factRef of record.grant.factRefs) {
              allowedEvidenceRefs.add(factRef);
            }
          }
        }
        const forbiddenDecisionRef = step.decisionBasisRefs.find((ref) =>
          !allowedEvidenceRefs.has(ref));
        if (forbiddenDecisionRef) {
          throw new Error(
            `Play rehearsal step ${step.stepRef} references forbidden knowledge: ${forbiddenDecisionRef}.`,
          );
        }
        const invalidSettlementEventRef = step.settlementEventRefs.find((ref) => {
          const event = input.eventsById.get(ref);
          return !owningEventIds.has(ref) ||
            !event ||
            event.cause.triggerId !== undefined;
        });
        if (invalidSettlementEventRef) {
          throw new Error(
            `Play rehearsal step ${step.stepRef} references invalid settlement event evidence: ${invalidSettlementEventRef}.`,
          );
        }
        stepSettlementEventRefs.push(...step.settlementEventRefs);
        const expectedStepWorldNoticeEventRefs = step.settlementEventRefs.filter(
          (ref) => input.eventsById.get(ref)!.visibility === 'playerVisible',
        );
        const worldNotices = step.narrativeBlocks.filter((block) =>
          block.kind === 'worldNotice');
        if (
          worldNotices.length !== (expectedStepWorldNoticeEventRefs.length ? 1 : 0) ||
          worldNotices.some((block) =>
            block.id !== `world-notice-${step.stepRef}` ||
            block.speakerRef !== undefined ||
            block.visibility !== 'playerVisible' ||
            block.projection !== 'transcript' ||
            block.sourceRefs.length !== 0 ||
            block.eventRefs.length === 0)
        ) {
          throw new Error(
            `Play rehearsal step ${step.stepRef} contains invalid world notice evidence.`,
          );
        }
        for (const block of step.narrativeBlocks) {
          const forbiddenSourceRef = block.sourceRefs.find((ref) =>
            !allowedEvidenceRefs.has(ref));
          if (forbiddenSourceRef) {
            throw new Error(
              `Play rehearsal block ${block.id} references forbidden knowledge: ${forbiddenSourceRef}.`,
            );
          }
          const unknownEventRef = block.eventRefs.find((ref) =>
            !allowedEventIds.has(ref) || !input.eventsById.has(ref));
          if (unknownEventRef) {
            throw new Error(
              `Play rehearsal block ${block.id} references an unknown owning event: ${unknownEventRef}.`,
            );
          }
          const nonOwningWorldNoticeRef = block.kind === 'worldNotice'
            ? block.eventRefs.find((ref) => !owningEventIds.has(ref))
            : undefined;
          if (nonOwningWorldNoticeRef) {
            throw new Error(
              `Play rehearsal world notice ${block.id} references a non-owning event: ${nonOwningWorldNoticeRef}.`,
            );
          }
          if (block.kind === 'worldNotice') {
            if (!isDeepStrictEqual(
              block.eventRefs,
              expectedStepWorldNoticeEventRefs,
            )) {
              throw new Error(
                `Play rehearsal step world notice ${block.id} does not match its actor-contribution event partition.`,
              );
            }
            const expectedContent = block.eventRefs.map((ref) => {
              const event = input.eventsById.get(ref)!;
              return `${event.title}: ${event.summary}`;
            }).join('\n');
            if (block.content !== expectedContent) {
              throw new Error(
                `Play rehearsal step world notice ${block.id} does not match its event evidence.`,
              );
            }
          }
          const incompatibleEventRef = block.eventRefs.find((ref) =>
            !doesPlayVisibilityCover(
              block.visibility,
              input.eventsById.get(ref)!.visibility,
            ));
          if (incompatibleEventRef) {
            throw new Error(
              `Play rehearsal block ${block.id} is more visible than its event: ${incompatibleEventRef}.`,
            );
          }
        }
      }
      const expectedStepSettlementEventRefs = artifact.eventIds.filter((ref) => {
        const event = input.eventsById.get(ref);
        return event && !event.cause.triggerId;
      });
      if (!isDeepStrictEqual(
        stepSettlementEventRefs,
        expectedStepSettlementEventRefs,
      )) {
        throw new Error(
          `Play rehearsal evidence ${evidenceRef} does not exactly partition actor-contribution events by step.`,
        );
      }
      const hostNarrativeBlocks = turnEvidence.hostNarrativeBlocks;
      const expectedHostEventRefs = artifact.eventIds.filter((ref) => {
        const event = input.eventsById.get(ref);
        return event?.visibility === 'playerVisible' && Boolean(event.cause.triggerId);
      });
      const expectedHostBlockCount = expectedHostEventRefs.length ? 1 : 0;
      if (hostNarrativeBlocks.length !== expectedHostBlockCount) {
        throw new Error(
          `Play rehearsal evidence ${evidenceRef} does not exactly cover player-visible host events.`,
        );
      }
      for (const block of hostNarrativeBlocks) {
        const expectedContent = expectedHostEventRefs.map((ref) => {
          const event = input.eventsById.get(ref)!;
          return `${event.title}: ${event.summary}`;
        }).join('\n');
        if (
          block.id !== `world-notice-host-${artifact.id}` ||
          block.kind !== 'worldNotice' ||
          block.speakerRef !== undefined ||
          block.visibility !== 'playerVisible' ||
          block.projection !== 'transcript' ||
          block.sourceRefs.length !== 0 ||
          !isDeepStrictEqual(block.eventRefs, expectedHostEventRefs) ||
          block.content !== expectedContent
        ) {
          throw new Error(
            `Play rehearsal host world notice ${block.id} does not match its hard-due event evidence.`,
          );
        }
      }
    }
  }
  const unownedEvidence = evidence.find((turnEvidence) =>
    !referencedEvidenceIds.has(turnEvidence.id));
  if (unownedEvidence) {
    throw new Error(
      `Play rehearsal evidence is not owned by a turn artifact: ${unownedEvidence.id}.`,
    );
  }

  const selectedArtifactsById = new Map(
    input.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  return input.selectedTurnIds.flatMap((artifactId) =>
    (selectedArtifactsById.get(artifactId)?.rehearsalEvidenceRefs ?? []).map(
      (evidenceRef) => structuredClone(evidenceById.get(evidenceRef)!),
    ));
}

function doesPlayVisibilityCover(
  blockVisibility: PlayEventVisibility,
  eventVisibility: PlayEventVisibility,
): boolean {
  const restriction = {
    playerVisible: 0,
    rumor: 1,
    playerUnknown: 2,
  } satisfies Record<PlayEventVisibility, number>;
  return restriction[blockVisibility] >= restriction[eventVisibility];
}

function validatePlayBranchSnapshots(input: {
  artifacts: PlayTurnArtifact[];
  artifactsById: Map<string, PlayTurnArtifact>;
  selectedTurnIds: string[];
  eventsById: Map<string, PlayWorldEvent>;
  sessionWorldClock: PlayWorldClock;
  sessionPlayLocalState: Record<string, unknown>;
  sessionPlayLocalStateVisibility: Record<string, PlayEventVisibility>;
  currentRevision: number;
  branchSnapshotRequiredFromRevision: number;
  branchBaseSnapshot: PlayBranchBaseSnapshot;
  sessionSuggestedActions: string[];
}): {
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  suggestedActions: string[];
} {
  assertPlayWorldMomentumState(
    input.branchBaseSnapshot.playLocalState,
    input.branchBaseSnapshot.playLocalStateVisibility,
    'Play branch base',
  );
  assertPlayKnowledgeState(
    input.branchBaseSnapshot.playLocalState,
    input.branchBaseSnapshot.playLocalStateVisibility,
    'Play branch base',
    collectPlayArtifactLineageEvents(
      input.branchBaseSnapshot.parentTurnId,
      input.artifactsById,
      input.eventsById,
    ),
  );
  assertPlayWorldMomentumState(
    input.sessionPlayLocalState,
    input.sessionPlayLocalStateVisibility,
    'Play session',
  );
  assertPlayKnowledgeState(
    input.sessionPlayLocalState,
    input.sessionPlayLocalStateVisibility,
    'Play session',
    input.selectedTurnIds.flatMap((artifactId) =>
      input.artifactsById.get(artifactId)!.eventIds.map((eventId) =>
        input.eventsById.get(eventId)!),
    ),
  );
  if (input.sessionWorldClock.revision !== input.currentRevision) {
    throw new Error('Play session world clock revision does not match session revision.');
  }
  if (
    !Number.isSafeInteger(input.branchSnapshotRequiredFromRevision) ||
    input.branchSnapshotRequiredFromRevision < 0
  ) {
    throw new Error('Play branch snapshot watermark must be a non-negative integer.');
  }
  if (
    input.branchSnapshotRequiredFromRevision > input.currentRevision ||
    input.branchSnapshotRequiredFromRevision !==
      input.branchBaseSnapshot.worldClock.revision
  ) {
    throw new Error('Play branch snapshot watermark does not match its base snapshot.');
  }

  for (const artifact of input.artifacts) {
    const parent = artifact.parentTurnId
      ? input.artifactsById.get(artifact.parentTurnId)
      : undefined;
    const completeSnapshot = hasCompletePlayBranchSnapshot(artifact);
    if (
      artifact.revision > input.branchSnapshotRequiredFromRevision &&
      !completeSnapshot
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} cannot downgrade below the branch snapshot watermark.`,
      );
    }
    if (
      artifact.worldClock &&
      artifact.worldClock.revision !== artifact.revision
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} world clock revision does not match artifact revision.`,
      );
    }
    if (!completeSnapshot) {
      if (
        (parent && hasCompletePlayBranchSnapshot(parent)) ||
        artifact.branchSnapshotVersion !== undefined ||
        artifact.artifactKind !== undefined ||
        artifact.scheduledEventSnapshots.length ||
        artifact.playLocalStateSnapshot !== undefined ||
        artifact.playLocalStateVisibilitySnapshot !== undefined
      ) {
        throw new Error(
          `Play turn artifact ${artifact.id} has an incomplete branch snapshot.`,
        );
      }
      continue;
    }

    const worldClock = artifact.worldClock!;
    const stateSnapshot = artifact.playLocalStateSnapshot!;
    const visibilitySnapshot = artifact.playLocalStateVisibilitySnapshot!;
    const parentComplete = Boolean(parent && hasCompletePlayBranchSnapshot(parent));
    const usesBaseSnapshot = !parentComplete &&
      input.branchBaseSnapshot.parentTurnId === artifact.parentTurnId;
    if (!parentComplete && !usesBaseSnapshot) {
      throw new Error(
        `Play turn artifact ${artifact.id} has no verifiable predecessor snapshot.`,
      );
    }
    const predecessorClock = parentComplete
      ? parent!.worldClock!
      : input.branchBaseSnapshot.worldClock;
    const predecessorState = parentComplete
      ? parent!.playLocalStateSnapshot!
      : input.branchBaseSnapshot.playLocalState;
    const predecessorVisibility = parentComplete
      ? parent!.playLocalStateVisibilitySnapshot!
      : input.branchBaseSnapshot.playLocalStateVisibility;
    const predecessorSuggestedActions = parentComplete
      ? parent!.suggestedActions
      : input.branchBaseSnapshot.suggestedActions;
    assertPlayWorldMomentumState(
      stateSnapshot,
      visibilitySnapshot,
      `Play turn artifact ${artifact.id}`,
    );
    assertPlayKnowledgeState(
      stateSnapshot,
      visibilitySnapshot,
      `Play turn artifact ${artifact.id}`,
      collectPlayArtifactLineageEvents(
        artifact.id,
        input.artifactsById,
        input.eventsById,
      ),
    );
    if (artifact.revision <= predecessorClock.revision) {
      throw new Error(
        `Play turn artifact ${artifact.id} revision does not advance its predecessor.`,
      );
    }
    assertCompletePlayArtifactKind(artifact, input.eventsById);
    if (
      artifact.artifactKind === 'transcriptAppend' &&
      !isDeepStrictEqual(
        artifact.suggestedActions,
        predecessorSuggestedActions,
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} transcript append changes suggested actions.`,
      );
    }
    const expectedTurn = predecessorClock.turn +
      (artifact.artifactKind === 'worldSettlement' ? 1 : 0);
    if (
      worldClock.turn !== expectedTurn ||
      (
        artifact.artifactKind === 'transcriptAppend' &&
        (
          worldClock.anchor !== predecessorClock.anchor ||
          worldClock.elapsed !== predecessorClock.elapsed
        )
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} world clock does not follow its predecessor.`,
      );
    }
    const expectedState = mergePlayLocalState(
      predecessorState,
      artifact.stateDelta,
    );
    if (!isDeepStrictEqual(stateSnapshot, expectedState)) {
      throw new Error(
        `Play turn artifact ${artifact.id} state snapshot does not match its predecessor and delta.`,
      );
    }
    const predecessorHasMomentum = Object.hasOwn(
      predecessorState,
      PLAY_WORLD_MOMENTUM_STATE_KEY,
    );
    const currentHasMomentum = Object.hasOwn(
      stateSnapshot,
      PLAY_WORLD_MOMENTUM_STATE_KEY,
    );
    if (predecessorHasMomentum !== currentHasMomentum) {
      throw new Error(
        `Play turn artifact ${artifact.id} cannot add or remove world momentum records.`,
      );
    }
    if (predecessorHasMomentum) {
      assertPlayWorldMomentumTransition(
        predecessorState[PLAY_WORLD_MOMENTUM_STATE_KEY],
        stateSnapshot[PLAY_WORLD_MOMENTUM_STATE_KEY],
      );
    }
    const refereeTurnId = artifact.artifactKind === 'worldSettlement'
      ? artifact.messages[1]!.id!
      : artifact.messages[0]!.id!;
    assertPlayKnowledgeTransition({
      predecessorPlayLocalState: predecessorState,
      nextPlayLocalState: stateSnapshot,
      selectedAncestorEvents: collectPlayArtifactAncestorEvents(
        artifact,
        input.artifactsById,
        input.eventsById,
      ),
      currentEvents: artifact.eventIds.map((eventId) => input.eventsById.get(eventId)!),
      revision: artifact.revision,
      refereeTurnId,
      knowledgeDeltaPresent: Object.hasOwn(
        artifact.stateDelta,
        PLAY_KNOWLEDGE_STATE_KEY,
      ),
      artifactKind: artifact.artifactKind!,
    });
    const expectedVisibility = { ...predecessorVisibility };
    const settlementVisibility = resolveArtifactSettlementVisibility(
      artifact,
      input.eventsById,
    );
    for (const key of Object.keys(artifact.stateDelta)) {
      expectedVisibility[key] = (
        key === PLAY_WORLD_MOMENTUM_STATE_KEY ||
        key === PLAY_KNOWLEDGE_STATE_KEY
      )
        ? 'playerUnknown'
        : settlementVisibility;
    }
    if (!isDeepStrictEqual(visibilitySnapshot, expectedVisibility)) {
      throw new Error(
        `Play turn artifact ${artifact.id} state visibility does not match its predecessor and delta.`,
      );
    }
    if (
      !isDeepStrictEqual(
        Object.keys(visibilitySnapshot).toSorted(),
        Object.keys(stateSnapshot).toSorted(),
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} state visibility keys do not match its state snapshot.`,
      );
    }

    for (const eventId of artifact.eventIds) {
      const event = input.eventsById.get(eventId)!;
      if (!isDeepStrictEqual(event.worldClock, worldClock)) {
        throw new Error(
          `Play event ${eventId} world clock does not match artifact ${artifact.id}.`,
        );
      }
    }
  }

  const selectedHeadId = input.selectedTurnIds.at(-1);
  const selectedHead = selectedHeadId
    ? input.artifactsById.get(selectedHeadId)
    : undefined;
  if (!selectedHead || !hasCompletePlayBranchSnapshot(selectedHead)) {
    if (
      selectedHeadId !== input.branchBaseSnapshot.parentTurnId ||
      input.sessionWorldClock.turn !== input.branchBaseSnapshot.worldClock.turn ||
      input.sessionWorldClock.anchor !== input.branchBaseSnapshot.worldClock.anchor ||
      input.sessionWorldClock.elapsed !== input.branchBaseSnapshot.worldClock.elapsed ||
      !isDeepStrictEqual(
        input.sessionPlayLocalState,
        input.branchBaseSnapshot.playLocalState,
      ) ||
      !isDeepStrictEqual(
        input.sessionPlayLocalStateVisibility,
        input.branchBaseSnapshot.playLocalStateVisibility,
      ) ||
      !isDeepStrictEqual(
        input.sessionSuggestedActions,
        input.branchBaseSnapshot.suggestedActions,
      )
    ) {
      throw new Error('Play legacy projection does not match its branch base snapshot.');
    }
    return {
      playLocalState: clonePlayLocalState(input.branchBaseSnapshot.playLocalState),
      playLocalStateVisibility: {
        ...input.branchBaseSnapshot.playLocalStateVisibility,
      },
      suggestedActions: [...input.branchBaseSnapshot.suggestedActions],
    };
  }

  const headClock = selectedHead.worldClock!;
  if (
    input.sessionWorldClock.turn !== headClock.turn ||
    input.sessionWorldClock.anchor !== headClock.anchor ||
    input.sessionWorldClock.elapsed !== headClock.elapsed
  ) {
    throw new Error(
      'Play session world clock does not match the selected turn artifact head.',
    );
  }
  if (!isDeepStrictEqual(
    input.sessionPlayLocalState,
    selectedHead.playLocalStateSnapshot,
  )) {
    throw new Error(
      'Play-local state does not match the selected turn artifact head.',
    );
  }
  if (!isDeepStrictEqual(
    input.sessionPlayLocalStateVisibility,
    selectedHead.playLocalStateVisibilitySnapshot,
  )) {
    throw new Error(
      'Play-local state visibility does not match the selected turn artifact head.',
    );
  }
  if (!isDeepStrictEqual(
    input.sessionSuggestedActions,
    selectedHead.suggestedActions,
  )) {
    throw new Error(
      'Play suggested actions do not match the selected turn artifact head.',
    );
  }

  return {
    playLocalState: clonePlayLocalState(selectedHead.playLocalStateSnapshot!),
    playLocalStateVisibility: {
      ...selectedHead.playLocalStateVisibilitySnapshot!,
    },
    suggestedActions: [...selectedHead.suggestedActions],
  };
}

function assertPlayWorldMomentumState(
  state: Record<string, unknown>,
  visibility: Record<string, PlayEventVisibility>,
  label: string,
): void {
  if (!Object.hasOwn(state, PLAY_WORLD_MOMENTUM_STATE_KEY)) {
    return;
  }
  readPlayWorldMomentum(state);
  if (visibility[PLAY_WORLD_MOMENTUM_STATE_KEY] !== 'playerUnknown') {
    throw new Error(`${label} world momentum must remain referee-only in generic state.`);
  }
}

function assertPlayKnowledgeState(
  state: Record<string, unknown>,
  visibility: Record<string, PlayEventVisibility>,
  label: string,
  selectedEvents: readonly PlayWorldEvent[],
): void {
  const hasState = Object.hasOwn(state, PLAY_KNOWLEDGE_STATE_KEY);
  const hasVisibility = Object.hasOwn(visibility, PLAY_KNOWLEDGE_STATE_KEY);
  if (hasState !== hasVisibility) {
    throw new Error(`${label} Play knowledge state and visibility must appear together.`);
  }
  if (!hasState) {
    return;
  }
  readPlayKnowledgeState(state);
  assertPlayKnowledgeHistory({
    playLocalState: state,
    selectedEvents,
  });
  if (visibility[PLAY_KNOWLEDGE_STATE_KEY] !== 'playerUnknown') {
    throw new Error(`${label} Play knowledge must remain referee-only in generic state.`);
  }
}

function collectPlayArtifactAncestorEvents(
  artifact: PlayTurnArtifact,
  artifactsById: Map<string, PlayTurnArtifact>,
  eventsById: Map<string, PlayWorldEvent>,
): PlayWorldEvent[] {
  const chain: PlayTurnArtifact[] = [];
  let current = artifact.parentTurnId
    ? artifactsById.get(artifact.parentTurnId)
    : undefined;
  while (current) {
    chain.push(current);
    current = current.parentTurnId
      ? artifactsById.get(current.parentTurnId)
      : undefined;
  }
  return chain.reverse().flatMap((ancestor) =>
    ancestor.eventIds.map((eventId) => eventsById.get(eventId)!));
}

function collectPlayArtifactLineageEvents(
  headArtifactId: string | undefined,
  artifactsById: Map<string, PlayTurnArtifact>,
  eventsById: Map<string, PlayWorldEvent>,
): PlayWorldEvent[] {
  if (!headArtifactId) {
    return [];
  }
  const head = artifactsById.get(headArtifactId);
  if (!head) {
    return [];
  }
  return [
    ...collectPlayArtifactAncestorEvents(head, artifactsById, eventsById),
    ...head.eventIds.map((eventId) => eventsById.get(eventId)!),
  ];
}

function assertCompletePlayArtifactKind(
  artifact: PlayTurnArtifact,
  eventsById: Map<string, PlayWorldEvent>,
): void {
  if (artifact.artifactKind === 'worldSettlement') {
    const [userMessage, refereeMessage] = artifact.messages;
    if (
      !artifact.input ||
      artifact.messages.length !== 2 ||
      userMessage?.speaker !== 'user' ||
      refereeMessage?.speaker !== 'world-referee' ||
      userMessage.content !== artifact.input.raw ||
      userMessage.actionKind !== artifact.input.kind ||
      refereeMessage.actionKind !== undefined
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} has an invalid world settlement shape.`,
      );
    }
    if (artifact.eventIds.some((eventId) =>
      eventsById.get(eventId)?.turnId !== refereeMessage.id)) {
      throw new Error(
        `Play turn artifact ${artifact.id} settlement events must belong to its referee message.`,
      );
    }
    if (
      artifact.input.timeAdvance &&
      artifact.worldClock?.elapsed !== formatPlayRelativeTimeAdvance(
        artifact.input.timeAdvance,
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} typed wait does not match its world clock elapsed.`,
      );
    }
    return;
  }

  if (
    artifact.artifactKind !== 'transcriptAppend' ||
    artifact.input !== undefined ||
    artifact.messages.length !== 1 ||
    artifact.eventIds.length !== 0 ||
    artifact.dueScheduledEventIds.length !== 0 ||
    artifact.observationIds.length !== 0 ||
    Object.keys(artifact.stateDelta).length !== 0
  ) {
    throw new Error(
      `Play turn artifact ${artifact.id} has an invalid transcript append shape.`,
    );
  }
}

function resolveArtifactSettlementVisibility(
  artifact: PlayTurnArtifact,
  eventsById: Map<string, PlayWorldEvent>,
): PlayEventVisibility {
  const visibilities = artifact.eventIds.map((eventId) =>
    eventsById.get(eventId)?.visibility ?? 'playerVisible');
  if (visibilities.includes('playerUnknown')) {
    return 'playerUnknown';
  }
  if (visibilities.includes('rumor')) {
    return 'rumor';
  }
  return 'playerVisible';
}

function indexUniquePlayFacts<T extends { id: string }>(
  facts: T[],
  label: 'event' | 'observation',
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const fact of facts) {
    if (indexed.has(fact.id)) {
      throw new Error(`Play ${label} ledger contains duplicate id: ${fact.id}.`);
    }
    indexed.set(fact.id, fact);
  }
  return indexed;
}

function assertKnownPlayFactReferences(
  label: string,
  sourceTurnIds: string[],
  sourceEventIds: string[],
  messagesById: Map<string, PlayTranscriptTurn>,
  eventsById: Map<string, PlayWorldEvent>,
): void {
  const unknownTurnId = sourceTurnIds.find((id) => !messagesById.has(id));
  if (unknownTurnId) {
    throw new Error(`${label} references unknown turn: ${unknownTurnId}.`);
  }
  const unknownEventId = sourceEventIds.find((id) => !eventsById.has(id));
  if (unknownEventId) {
    throw new Error(`${label} references unknown event: ${unknownEventId}.`);
  }
}

function collectPlayReferenceOwnerArtifactIds(
  sourceTurnIds: string[],
  sourceEventIds: string[],
  messageOwners: Map<string, string>,
  eventOwners: Map<string, string>,
): string[] {
  return [
    ...sourceTurnIds.map((turnId) => messageOwners.get(turnId)),
    ...sourceEventIds.map((eventId) => eventOwners.get(eventId)),
  ].filter((artifactId): artifactId is string => artifactId !== undefined);
}

function assertPlayReferenceOwnersShareBranch(
  label: string,
  ownerArtifactIds: string[],
  artifactsById: Map<string, PlayTurnArtifact>,
): void {
  const uniqueOwnerIds = [...new Set(ownerArtifactIds)];
  if (uniqueOwnerIds.length < 2) {
    return;
  }
  const deepestOwner = uniqueOwnerIds
    .map((artifactId) => artifactsById.get(artifactId)!)
    .toSorted((left, right) => right.revision - left.revision)[0]!;
  const ancestorIds = collectPlayArtifactAncestorIds(deepestOwner, artifactsById);
  const incompatibleOwnerId = uniqueOwnerIds.find((artifactId) =>
    !ancestorIds.has(artifactId));
  if (incompatibleOwnerId) {
    throw new Error(
      `${label} mixes facts from incompatible Play branches: ` +
      `${incompatibleOwnerId}.`,
    );
  }
}

export function assertScopedPlayFactReferences(
  label: string,
  sourceTurnIds: string[],
  sourceEventIds: string[],
  allowedMessageIds: Set<string>,
  allowedEventIds: Set<string>,
): void {
  const outOfBranchTurnId = sourceTurnIds.find((id) => !allowedMessageIds.has(id));
  if (outOfBranchTurnId) {
    throw new Error(`${label} references out-of-branch turn: ${outOfBranchTurnId}.`);
  }
  const outOfBranchEventId = sourceEventIds.find((id) => !allowedEventIds.has(id));
  if (outOfBranchEventId) {
    throw new Error(`${label} references out-of-branch event: ${outOfBranchEventId}.`);
  }
}


export function resolvePlaySessionRevision(
  session: PlaySessionRevisionSource,
  artifacts: PlayTurnArtifact[],
): number {
  return Math.max(
    normalizeNonNegativeInteger(session.revision),
    normalizeNonNegativeInteger(session.worldClock.revision),
    ...artifacts.map((artifact) => artifact.revision),
  );
}


export function normalizePlayWorldClock(
  clock?: Partial<PlayWorldClock>,
  revision?: number,
): PlayWorldClock {
  const normalizedRevision = normalizeNonNegativeInteger(revision ?? clock?.revision);
  const anchor = normalizeOptionalString(clock?.anchor);
  const elapsed = normalizeOptionalString(clock?.elapsed);

  return {
    turn: normalizeNonNegativeInteger(clock?.turn),
    revision: normalizedRevision,
    ...(anchor ? { anchor } : {}),
    ...(elapsed ? { elapsed } : {}),
  };
}

export function normalizePlayLocalStateVisibility(
  state: Record<string, unknown>,
  visibility?: Record<string, PlayEventVisibility>,
): Record<string, PlayEventVisibility> {
  return Object.fromEntries(
    Object.keys(state).map((key) => [
      key,
      normalizeEnum(visibility?.[key], PLAY_EVENT_VISIBILITIES) ?? 'playerVisible',
    ]),
  );
}

export function requireExactPlayLocalStateVisibility(
  state: Record<string, unknown>,
  value: unknown,
  label: string,
): Record<string, PlayEventVisibility> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be present as an object.`);
  }
  const stateKeys = Object.keys(state).toSorted();
  const visibilityKeys = Object.keys(value).toSorted();
  if (!isDeepStrictEqual(visibilityKeys, stateKeys)) {
    throw new Error(`${label} keys must exactly match Play-local state keys.`);
  }
  return Object.fromEntries(stateKeys.map((key) => {
    const visibility = normalizeEnum(value[key], PLAY_EVENT_VISIBILITIES);
    if (!visibility) {
      throw new Error(`${label} contains invalid visibility for ${key}.`);
    }
    return [key, visibility];
  }));
}

export function requirePlayBranchSnapshotWatermark(value: unknown): number {
  const watermark = normalizeOptionalNonNegativeInteger(value);
  if (watermark === undefined) {
    throw new Error('Play session v4 requires a branch snapshot watermark.');
  }
  return watermark;
}

export function normalizePlayBranchBaseSnapshot(
  value: unknown,
): PlayBranchBaseSnapshot {
  if (!isRecord(value)) {
    throw new Error('Play session v4 requires a branch base snapshot.');
  }
  const knownFields = new Set([
    'parentTurnId',
    'worldClock',
    'playLocalState',
    'playLocalStateVisibility',
    'scheduledEvents',
    'suggestedActions',
  ]);
  if (Object.keys(value).some((field) => !knownFields.has(field))) {
    throw new Error('Play branch base snapshot contains unknown fields.');
  }
  if (
    !isRecord(value.worldClock) ||
    !isRecord(value.playLocalState) ||
    !isRecord(value.playLocalStateVisibility)
  ) {
    throw new Error('Play branch base snapshot is incomplete.');
  }
  const playLocalState = clonePlayLocalState(value.playLocalState);
  const playLocalStateVisibility = requireExactPlayLocalStateVisibility(
    playLocalState,
    value.playLocalStateVisibility,
    'Play branch base state visibility',
  );
  const worldClock = normalizePlayWorldClock(value.worldClock);
  const suggestedActions = normalizeStringList(value.suggestedActions, 6);
  if (
    !Array.isArray(value.suggestedActions) ||
    suggestedActions.length !== value.suggestedActions.length ||
    new Set(suggestedActions).size !== suggestedActions.length
  ) {
    throw new Error('Play branch base suggested actions are invalid.');
  }
  return {
    ...(value.parentTurnId !== undefined
      ? { parentTurnId: assertSafePlayTurnArtifactId(value.parentTurnId) }
      : {}),
    worldClock,
    playLocalState,
    playLocalStateVisibility,
    scheduledEvents: normalizePlayBranchBaseScheduledEvents(
      value.scheduledEvents,
      worldClock,
    ),
    suggestedActions,
  };
}

export function normalizePlayBranchBaseScheduledEvents(
  value: unknown,
  worldClock: PlayWorldClock,
): PlayScheduledEvent[] {
  const events = normalizePlayScheduledEvents(value);
  for (const event of events) {
    if (event.status !== 'scheduled') {
      throw new Error(
        `Play branch base scheduled event ${event.id} cannot start terminal.`,
      );
    }
    if (
      event.sourceTurnId !== undefined ||
      event.changeReason !== undefined ||
      event.occurredEventIds !== undefined ||
      event.resolvedAtTurnId !== undefined ||
      event.resolutionReason !== undefined
    ) {
      throw new Error(
        `Play branch base scheduled event ${event.id} cannot contain ` +
        'unverifiable source or resolution evidence.',
      );
    }
    if (
      event.scheduledAtTurn > worldClock.turn ||
      event.scheduledAtRevision > worldClock.revision
    ) {
      throw new Error(
        `Play branch base scheduled event ${event.id} starts after its base clock.`,
      );
    }
  }
  return events;
}

export function normalizePlayWorldRefereeEvent(value: unknown): PlayWorldRefereeSettlementEvent {
  if (!isRecord(value)) {
    throw new Error('Every Play event must be an object.');
  }

  const kind = normalizeEnum(value.kind, PLAY_WORLD_EVENT_KINDS);
  const origin = normalizeEnum(value.origin, PLAY_EVENT_ORIGINS);
  const visibility = normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES);
  const title = normalizeOptionalString(value.title);
  const summary = normalizeOptionalString(value.summary);

  if (!kind || !origin || !visibility || !title || !summary || !isRecord(value.cause)) {
    throw new Error('Every Play event requires kind, origin, title, summary, visibility, and cause.');
  }

  const reason = normalizeOptionalString(value.cause.reason);
  if (!reason) {
    throw new Error('Every Play event cause requires a reason.');
  }

  return {
    kind,
    origin,
    title,
    summary,
    visibility,
    cause: {
      reason,
      ...readOptionalCauseReferences(value.cause),
    },
  };
}


export function assertPlayWorldEvent(
  value: unknown,
  options: { strict?: boolean } = {},
): PlayWorldEvent {
  if (!isRecord(value)) {
    throw new Error('Stored Play event must be an object.');
  }

  const draft = normalizePlayWorldRefereeEvent(value);
  const id = normalizeStoredPlayFactId(
    value.id,
    'Play event id',
    options.strict === true,
  );
  const turnId = normalizeStoredPlayFactId(
    value.turnId,
    'Play event turnId',
    options.strict === true,
  );
  const createdAt = normalizeOptionalString(value.createdAt);
  const sequence = value.sequence;
  const worldClock = isRecord(value.worldClock)
    ? normalizePlayWorldClock(value.worldClock)
    : undefined;

  if (
    !id ||
    !turnId ||
    !createdAt ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1 ||
    !worldClock
  ) {
    throw new Error('Stored Play event requires id, turnId, sequence, worldClock, and createdAt.');
  }
  if (
    options.strict &&
    (
      !isRecord(value.worldClock) ||
      !Number.isSafeInteger(value.worldClock.turn) ||
      (value.worldClock.turn as number) < 0 ||
      !Number.isSafeInteger(value.worldClock.revision) ||
      (value.worldClock.revision as number) < 0
    )
  ) {
    throw new Error(`Stored Play event ${id} requires a valid world clock.`);
  }
  if (options.strict && value.canonical !== false) {
    throw new Error(`Stored Play event ${id} must remain non-canonical.`);
  }

  return {
    id,
    turnId,
    sequence: sequence as number,
    ...draft,
    worldClock,
    createdAt,
    canonical: false,
  };
}

export function assertPlayObservation(
  value: unknown,
  options: { strict?: boolean } = {},
): PlayObservation {
  if (!isRecord(value)) {
    throw new Error('Stored Play observation must be an object.');
  }

  const id = normalizeStoredPlayFactId(
    value.id,
    'Play observation id',
    options.strict === true,
  );
  const summary = normalizeOptionalString(value.summary);
  const evidence = normalizeOptionalString(value.evidence);
  if (!id || !summary || !evidence) {
    throw new Error('Stored Play observation requires id, summary, and evidence.');
  }
  const visibility = normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES);
  if (options.strict && !visibility) {
    throw new Error(
      `Stored Play observation ${id} requires a valid visibility.`,
    );
  }
  if (options.strict && value.canonical !== false) {
    throw new Error(`Stored Play observation ${id} must remain non-canonical.`);
  }

  return {
    id,
    summary,
    evidence,
    visibility: visibility ?? 'playerVisible',
    sourceTurnIds: normalizePlayProvenanceIdList(
      value.sourceTurnIds,
      'sourceTurnIds',
      `Play observation ${id}`,
      options.strict === true,
    ),
    sourceEventIds: normalizePlayProvenanceIdList(
      value.sourceEventIds,
      'sourceEventIds',
      `Play observation ${id}`,
      options.strict === true,
    ),
    canonical: false,
  };
}

export function assertPlayAdoptionCandidate(
  value: unknown,
  options: { strict?: boolean } = {},
): PlayAdoptionCandidate {
  if (!isRecord(value)) {
    throw new Error('Stored Play adoption candidate must be an object.');
  }
  if (options.strict) {
    assertOnlyKnownPlayAdoptionCandidateFields(value);
  }

  const id = normalizeStoredPlayFactId(
    value.id,
    'Play adoption candidate id',
    options.strict === true,
  );
  const target = normalizeEnum(value.target, PLAY_ADOPTION_TARGETS);
  const summary = normalizeOptionalString(value.summary);
  const evidence = normalizeOptionalString(value.evidence);
  if (!id || !target || !summary || !evidence) {
    throw new Error('Stored Play adoption candidate is incomplete.');
  }
  const visibility = normalizeEnum(value.visibility, PLAY_EVENT_VISIBILITIES);
  if (options.strict && !visibility) {
    throw new Error(
      `Stored Play adoption candidate ${id} requires a valid visibility.`,
    );
  }
  if (options.strict && value.requiresPendingAction !== true) {
    throw new Error(
      `Stored Play adoption candidate ${id} must require a PendingAction.`,
    );
  }
  if (options.strict && value.payload !== undefined && !isRecord(value.payload)) {
    throw new Error(`Stored Play adoption candidate ${id} has an invalid payload.`);
  }

  const hasSeed = value.seed !== undefined;
  const hasClosure = value.evidenceClosure !== undefined;
  const hasFingerprint = value.evidenceFingerprint !== undefined;
  if (
    (hasSeed || hasClosure || hasFingerprint) &&
    !(hasSeed && hasClosure && hasFingerprint)
  ) {
    throw new Error(
      `Stored Play adoption candidate ${id} requires seed, evidenceClosure, ` +
      'and evidenceFingerprint together.',
    );
  }
  const seed = hasSeed ? normalizePlayAdoptionSeed(value.seed) : undefined;
  const evidenceClosure = hasClosure
    ? normalizePlayAdoptionEvidenceClosure(value.evidenceClosure)
    : undefined;
  const evidenceFingerprint = hasFingerprint
    ? normalizePlayAdoptionEvidenceFingerprint(value.evidenceFingerprint, id!)
    : undefined;
  if (
    evidenceClosure &&
    fingerprintPlayAdoptionEvidenceClosure(evidenceClosure) !== evidenceFingerprint
  ) {
    throw new Error(
      `Stored Play adoption candidate ${id} evidence fingerprint does not ` +
      'match its closure.',
    );
  }

  const sourceObservationIds = normalizePlayProvenanceIdList(
    value.sourceObservationIds,
    'sourceObservationIds',
    `Play adoption candidate ${id}`,
    options.strict === true,
  );
  const sourceTurnIds = normalizePlayProvenanceIdList(
    value.sourceTurnIds,
    'sourceTurnIds',
    `Play adoption candidate ${id}`,
    options.strict === true,
  );
  const sourceEventIds = normalizePlayProvenanceIdList(
    value.sourceEventIds,
    'sourceEventIds',
    `Play adoption candidate ${id}`,
    options.strict === true,
  );
  if (
    evidenceClosure &&
    (
      !isDeepStrictEqual(sourceObservationIds, evidenceClosure.observationRefs) ||
      !isDeepStrictEqual(sourceTurnIds, evidenceClosure.messageRefs) ||
      !isDeepStrictEqual(sourceEventIds, evidenceClosure.eventRefs)
    )
  ) {
    throw new Error(
      `Stored Play adoption candidate ${id} provenance does not match its ` +
      'evidence closure.',
    );
  }

  return createPlayAdoptionCandidate({
    id,
    target,
    summary,
    evidence,
    ...(isRecord(value.payload) ? { payload: { ...value.payload } } : {}),
    ...(seed ? { seed } : {}),
    ...(evidenceClosure ? { evidenceClosure } : {}),
    ...(evidenceFingerprint ? { evidenceFingerprint } : {}),
    visibility: visibility ?? 'playerVisible',
    sourceObservationIds,
    sourceTurnIds,
    sourceEventIds,
  });
}

function assertOnlyKnownPlayAdoptionCandidateFields(
  value: Record<string, unknown>,
): void {
  const known = new Set([
    'id',
    'target',
    'summary',
    'evidence',
    'payload',
    'visibility',
    'sourceObservationIds',
    'sourceTurnIds',
    'sourceEventIds',
    'seed',
    'evidenceClosure',
    'evidenceFingerprint',
    'requiresPendingAction',
  ]);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length) {
    throw new Error(
      `Stored Play adoption candidate contains unknown fields: ${unknown.join(', ')}.`,
    );
  }
}

function normalizePlayAdoptionEvidenceFingerprint(
  value: unknown,
  candidateId: string,
): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(
      `Stored Play adoption candidate ${candidateId} requires a lowercase ` +
      'SHA-256 evidenceFingerprint.',
    );
  }
  return value;
}

function normalizeStoredPlayFactId(
  value: unknown,
  label: string,
  strict: boolean,
): string | undefined {
  const normalized = strict
    ? value
    : normalizeOptionalString(value);
  if (normalized === undefined) {
    return undefined;
  }
  return assertSafePlayStoredFactId(normalized, label);
}

function normalizePlayProvenanceIdList(
  value: unknown,
  field: 'sourceObservationIds' | 'sourceTurnIds' | 'sourceEventIds',
  ownerLabel: string,
  strict: boolean,
): string[] {
  if (strict) {
    if (!Array.isArray(value) || value.length > 24) {
      throw new Error(`${ownerLabel} ${field} must be an array of at most 24 ids.`);
    }
    const ids = value.map((id) => assertSafePlayStoredFactId(
      id,
      `${ownerLabel} ${field}`,
    ));
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${ownerLabel} ${field} must not contain duplicates.`);
    }
    return ids;
  }

  return [...new Set(normalizeStringList(value, 24).filter((id) =>
    isSafePlayStoredFactId(id)))];
}

function assertSafePlayStoredFactId(value: unknown, label: string): string {
  if (!isSafePlayStoredFactId(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function isSafePlayStoredFactId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
    !value.includes('..') &&
    !value.includes('/') &&
    !value.includes('\\');
}

function readOptionalCauseReferences(
  cause: Record<string, unknown>,
): Omit<PlayWorldEventCause, 'reason'> {
  const sourceTurnIds = normalizeUniquePlayCauseIds(
    cause.sourceTurnIds,
    'sourceTurnIds',
  );
  const sourceEventIds = normalizeUniquePlayCauseIds(
    cause.sourceEventIds,
    'sourceEventIds',
  );
  const triggerId = normalizeOptionalPlayCauseId(cause.triggerId, 'triggerId');
  const pressureId = normalizeOptionalPlayCauseId(cause.pressureId, 'pressureId');
  const agendaId = normalizeOptionalPlayCauseId(cause.agendaId, 'agendaId');

  return {
    ...(sourceTurnIds.length ? { sourceTurnIds } : {}),
    ...(sourceEventIds.length ? { sourceEventIds } : {}),
    ...(triggerId ? { triggerId } : {}),
    ...(pressureId ? { pressureId } : {}),
    ...(agendaId ? { agendaId } : {}),
  };
}

function normalizeUniquePlayCauseIds(
  value: unknown,
  field: 'sourceTurnIds' | 'sourceEventIds',
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 24) {
    throw new Error(`Play event cause ${field} must be an array of at most 24 ids.`);
  }
  const ids = value.map((id) => assertSafePlayCauseId(id, field));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Play event cause ${field} must not contain duplicates.`);
  }
  return ids;
}

function normalizeOptionalPlayCauseId(
  value: unknown,
  field: 'triggerId' | 'pressureId' | 'agendaId',
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertSafePlayCauseId(value, field);
}

function assertSafePlayCauseId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error(`Invalid Play event cause ${field}.`);
  }
  return value;
}

function normalizeEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | undefined {
  return typeof value === 'string' && values.includes(value as T)
    ? value as T
    : undefined;
}

export function normalizeStringList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

export function normalizeOptionalNonNegativeInteger(
  value: unknown,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Play branch snapshot watermark must be a non-negative integer.');
  }
  return value;
}

export function clonePlayLocalState(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return structuredClone(value);
}

function derivePlayParticipantKnowledgeEvidenceId(interventionRef: string): string {
  const candidate = `participant-knowledge-${interventionRef}`;
  return candidate.length <= 180
    ? candidate
    : `participant-knowledge-${interventionRef.slice(-150)}`;
}

export function mergePlayLocalState(
  base: Record<string, unknown>,
  delta: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...clonePlayLocalState(base),
    ...clonePlayLocalState(delta),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
