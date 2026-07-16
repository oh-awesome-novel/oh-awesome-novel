import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  createPlayOutcomeReport,
  fingerprintPlayOutcomeReport,
  normalizePlayOutcomeReport,
} from './play-outcome.js';
import type {
  PlayOutcomeItem,
  PlayOutcomeReport,
} from './play-outcome.js';
import { materializePlayTurnFacts } from './play-session-facts.js';
import type { PlaySession } from './play-session.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type {
  PlayActivatedSource,
  PlayAdoptionCandidate,
  PlayAdoptionDraft,
  PlayAdoptionEvidenceClosure,
  PlayAdoptionSeed,
  PlayAdoptionSourceSnapshot,
  PlayAdoptionTarget,
  PlayAdoptionTargetSuggestion,
  PlayAdoptionWriteIntentToolName,
  PlayEventVisibility,
  PlayObservation,
  PlayWorldEvent,
} from './play-types.js';

export const PLAY_ADOPTION_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const PLAY_ADOPTION_TARGETS = [
  'chapterDraft',
  'state',
  'timeline',
  'foreshadow',
] as const satisfies readonly PlayAdoptionTarget[];
export const MAX_PLAY_ADOPTION_EVIDENCE_REFS = 24 as const;
export const MAX_PLAY_ADOPTION_SELECTED_PATH_REFS = 512 as const;
export const MAX_PLAY_ADOPTION_SOURCE_SNAPSHOTS = 24 as const;

export interface RebuildPlayAdoptionDraftInput {
  session: PlaySession;
  seed: unknown;
  projection?: 'player' | 'director';
  outcomeReport?: PlayOutcomeReport;
}

export interface CreatePlayAdoptionCandidateFromDraftInput {
  id: string;
  draft: PlayAdoptionDraft;
  target: PlayAdoptionTarget;
  payload?: Record<string, unknown>;
}

export interface PlayAdoptionSourceBase {
  sourceSnapshots: PlayAdoptionSourceSnapshot[];
  sourceBaseFingerprint: string;
}

interface ResolvedAdoptionRoot {
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  recommendedTarget: PlayAdoptionTarget;
  artifactTurnRefs: string[];
  messageRefs: string[];
  eventRefs: string[];
  observationRefs: string[];
  evidenceRefs: string[];
}

interface SelectedEvidenceIndex {
  selectedArtifactTurnRefs: string[];
  artifactsById: Map<string, PlayTurnArtifact>;
  artifactOrder: Map<string, number>;
  messageOwners: Map<string, string>;
  eventOwners: Map<string, string>;
  observationOwners: Map<string, string>;
  evidenceOwners: Map<string, string>;
  messagesById: Map<string, { id: string }>;
  eventsById: Map<string, PlayWorldEvent>;
  observationsById: Map<string, PlayObservation>;
}

export function normalizePlayAdoptionSeed(value: unknown): PlayAdoptionSeed {
  const record = requireRecord(value, 'Play adoption seed');
  switch (record.kind) {
    case 'event':
      assertOnlyKnownFields(record, ['kind', 'eventId'], 'Play event adoption seed');
      return {
        kind: 'event',
        eventId: assertSafeId(record.eventId, 'Play adoption eventId'),
      };
    case 'observation':
      assertOnlyKnownFields(
        record,
        ['kind', 'observationId'],
        'Play observation adoption seed',
      );
      return {
        kind: 'observation',
        observationId: assertSafeId(
          record.observationId,
          'Play adoption observationId',
        ),
      };
    case 'outcome':
      assertOnlyKnownFields(
        record,
        ['kind', 'outcomeItemId', 'outcomeReportFingerprint'],
        'Play outcome adoption seed',
      );
      return {
        kind: 'outcome',
        outcomeItemId: assertSafeId(
          record.outcomeItemId,
          'Play adoption outcomeItemId',
        ),
        outcomeReportFingerprint: assertSha256(
          record.outcomeReportFingerprint,
          'Play adoption outcomeReportFingerprint',
        ),
      };
    default:
      throw new Error(`Unsupported Play adoption seed kind: ${String(record.kind)}.`);
  }
}

export function normalizePlayAdoptionEvidenceClosure(
  value: unknown,
): PlayAdoptionEvidenceClosure {
  const record = requireRecord(value, 'Play adoption evidence closure');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'sessionId',
    'sessionRevision',
    'selectedArtifactTurnRefs',
    'artifactTurnRefs',
    'messageRefs',
    'eventRefs',
    'observationRefs',
    'evidenceRefs',
    'sourceSnapshots',
    'selectedPathFingerprint',
    'sourceBaseFingerprint',
  ], 'Play adoption evidence closure');
  if (record.schemaVersion !== PLAY_ADOPTION_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Play adoption evidence schemaVersion: ` +
      `${String(record.schemaVersion)}.`,
    );
  }
  if (
    !Number.isSafeInteger(record.sessionRevision) ||
    (record.sessionRevision as number) < 0
  ) {
    throw new Error('Play adoption evidence sessionRevision must be non-negative.');
  }
  const sourceSnapshots = normalizeSourceSnapshots(record.sourceSnapshots);
  const closure: PlayAdoptionEvidenceClosure = {
    schemaVersion: PLAY_ADOPTION_EVIDENCE_SCHEMA_VERSION,
    sessionId: assertSafeId(record.sessionId, 'Play adoption evidence sessionId'),
    sessionRevision: record.sessionRevision as number,
    selectedArtifactTurnRefs: normalizeIdList(
      record.selectedArtifactTurnRefs,
      'selectedArtifactTurnRefs',
      MAX_PLAY_ADOPTION_SELECTED_PATH_REFS,
    ),
    artifactTurnRefs: normalizeIdList(record.artifactTurnRefs, 'artifactTurnRefs'),
    messageRefs: normalizeIdList(record.messageRefs, 'messageRefs'),
    eventRefs: normalizeIdList(record.eventRefs, 'eventRefs'),
    observationRefs: normalizeIdList(record.observationRefs, 'observationRefs'),
    evidenceRefs: normalizeIdList(record.evidenceRefs, 'evidenceRefs'),
    sourceSnapshots,
    selectedPathFingerprint: assertSha256(
      record.selectedPathFingerprint,
      'Play adoption selectedPathFingerprint',
    ),
    sourceBaseFingerprint: assertSha256(
      record.sourceBaseFingerprint,
      'Play adoption sourceBaseFingerprint',
    ),
  };
  const selectedRefs = new Set(closure.selectedArtifactTurnRefs);
  const outsideSelected = closure.artifactTurnRefs.find((ref) =>
    !selectedRefs.has(ref));
  if (outsideSelected) {
    throw new Error(
      `Play adoption artifactTurnRefs contains an unselected artifact: ` +
      `${outsideSelected}.`,
    );
  }
  const expectedPathFingerprint = sha256(canonicalJson({
    sessionId: closure.sessionId,
    selectedArtifactTurnRefs: closure.selectedArtifactTurnRefs,
  }));
  if (closure.selectedPathFingerprint !== expectedPathFingerprint) {
    throw new Error('Play adoption selectedPathFingerprint does not match its path.');
  }
  if (closure.sourceBaseFingerprint !== sha256(canonicalJson(sourceSnapshots))) {
    throw new Error('Play adoption sourceBaseFingerprint does not match its snapshots.');
  }
  return closure;
}

export function fingerprintPlayAdoptionEvidenceClosure(
  value: PlayAdoptionEvidenceClosure,
): string {
  return sha256(canonicalJson(normalizePlayAdoptionEvidenceClosure(value)));
}

export function createPlayAdoptionSourceBase(
  sources: readonly PlayActivatedSource[],
): PlayAdoptionSourceBase {
  const sourceSnapshots = createSessionSourceBase(sources);
  return {
    sourceSnapshots,
    sourceBaseFingerprint: sha256(canonicalJson(sourceSnapshots)),
  };
}

export function rebuildPlayAdoptionDraft(
  input: RebuildPlayAdoptionDraftInput,
): PlayAdoptionDraft {
  const projection = input.projection ?? 'director';
  if (projection !== 'player' && projection !== 'director') {
    throw new Error(`Unsupported Play adoption projection: ${String(projection)}.`);
  }
  const seed = normalizePlayAdoptionSeed(input.seed);
  const facts = materializePlayTurnFacts(input.session);
  const evidenceIndex = createSelectedEvidenceIndex(input.session, facts);
  const root = resolveAdoptionRoot({
    session: input.session,
    seed,
    outcomeReport: input.outcomeReport,
    evidenceIndex,
  });
  if (projection === 'player' && root.visibility === 'playerUnknown') {
    throw new Error('Player projection cannot adopt a playerUnknown Play root.');
  }

  const closure = createEvidenceClosure({
    session: input.session,
    evidenceIndex,
    root,
  });
  const evidenceFingerprint = fingerprintPlayAdoptionEvidenceClosure(closure);
  const targetSuggestions = suggestPlayAdoptionTargets({
    seed,
    summary: root.summary,
    evidence: root.evidence,
    visibility: root.visibility,
    evidenceFingerprint,
    recommendedTarget: root.recommendedTarget,
  });
  const draft: PlayAdoptionDraft = {
    seed,
    summary: root.summary,
    evidence: root.evidence,
    visibility: root.visibility,
    evidenceClosure: closure,
    evidenceFingerprint,
    targetSuggestions,
  };
  return projection === 'player'
    ? projectPlayAdoptionDraft(draft, 'player')!
    : draft;
}

export function suggestPlayAdoptionTargets(input: {
  seed: PlayAdoptionSeed;
  summary: string;
  evidence: string;
  visibility: PlayEventVisibility;
  evidenceFingerprint: string;
  recommendedTarget?: PlayAdoptionTarget;
}): PlayAdoptionTargetSuggestion[] {
  const seed = normalizePlayAdoptionSeed(input.seed);
  const summary = requireBoundedString(input.summary, 'Play adoption summary', 4_000);
  // Evidence is deliberately validated but never copied into default payloads:
  // a visible root summary is the sole text source for automatic canonical drafts.
  requireBoundedString(input.evidence, 'Play adoption evidence', 8_000);
  const visibility = normalizeVisibility(input.visibility);
  const evidenceFingerprint = assertSha256(
    input.evidenceFingerprint,
    'Play adoption evidenceFingerprint',
  );
  const recommendedTarget = input.recommendedTarget ?? inferRecommendedTarget(seed);
  if (!PLAY_ADOPTION_TARGETS.includes(recommendedTarget)) {
    throw new Error(`Unsupported Play adoption target: ${String(recommendedTarget)}.`);
  }
  if (visibility === 'playerUnknown' && seed.kind !== 'outcome' && !summary) {
    throw new Error('Hidden Play adoption requires an explicit root summary.');
  }
  const stableId = `play_${evidenceFingerprint.slice(0, 12)}`;

  const specs: Array<{
    target: PlayAdoptionTarget;
    toolName: PlayAdoptionWriteIntentToolName;
    reason: string;
    defaultPayload: Record<string, unknown>;
  }> = [{
    target: 'chapterDraft',
    toolName: 'chapter.createDraft',
    reason: 'Turn the selected Play result into editable chapter prose.',
    defaultPayload: {
      chapterId: '0001/0001',
      content: summary,
      mode: 'replace',
    },
  }, {
    target: 'state',
    toolName: 'state.set',
    reason: 'Record the selected Play result as an explicit canonical state value.',
    defaultPayload: {
      file: 'play-adoption.yaml',
      path: `evidence.${stableId}`,
      value: {
        summary,
        evidenceFingerprint,
      },
    },
  }, {
    target: 'timeline',
    toolName: 'timeline.add',
    reason: 'Append the selected Play result as a canonical timeline event.',
    defaultPayload: {
      file: 'events.yaml',
      path: 'events',
      event: {
        id: stableId,
        summary,
        source: 'play',
        evidenceFingerprint,
      },
    },
  }, {
    target: 'foreshadow',
    toolName: 'foreshadow.create',
    reason: 'Preserve the selected Play result as an active clue or future payoff.',
    defaultPayload: {
      file: 'active.yaml',
      path: 'active',
      item: {
        id: stableId,
        summary,
        status: 'active',
        source: 'play',
        evidenceFingerprint,
      },
    },
  }];
  return specs.map((spec) => ({
    ...spec,
    recommended: spec.target === recommendedTarget,
    defaultPayload: structuredClone(spec.defaultPayload),
  }));
}

export function createPlayAdoptionCandidateFromDraft(
  input: CreatePlayAdoptionCandidateFromDraftInput,
): PlayAdoptionCandidate {
  const id = assertSafeId(input.id, 'Play adoption candidate id');
  const draft = normalizePlayAdoptionDraft(input.draft);
  if (!PLAY_ADOPTION_TARGETS.includes(input.target)) {
    throw new Error(`Unsupported Play adoption target: ${String(input.target)}.`);
  }
  const suggestion = draft.targetSuggestions.find((candidate) =>
    candidate.target === input.target);
  if (!suggestion) {
    throw new Error(`Play adoption draft has no suggestion for ${input.target}.`);
  }
  if (input.payload !== undefined && !isRecord(input.payload)) {
    throw new Error('Play adoption candidate payload must be an object.');
  }
  return {
    id,
    target: input.target,
    summary: draft.summary,
    evidence: draft.evidence,
    payload: structuredClone(input.payload ?? suggestion.defaultPayload),
    visibility: draft.visibility,
    sourceObservationIds: [...draft.evidenceClosure.observationRefs],
    sourceTurnIds: [...draft.evidenceClosure.messageRefs],
    sourceEventIds: [...draft.evidenceClosure.eventRefs],
    seed: structuredClone(draft.seed),
    evidenceClosure: structuredClone(draft.evidenceClosure),
    evidenceFingerprint: draft.evidenceFingerprint,
    requiresPendingAction: true,
  };
}

export function projectPlayAdoptionDraft(
  draftValue: PlayAdoptionDraft,
  projection: 'player' | 'director',
): PlayAdoptionDraft | undefined {
  const draft = normalizePlayAdoptionDraft(draftValue);
  if (projection === 'director') return structuredClone(draft);
  if (projection !== 'player') {
    throw new Error(`Unsupported Play adoption projection: ${String(projection)}.`);
  }
  if (draft.visibility === 'playerUnknown') return undefined;
  const evidenceClosure = redactEvidenceClosure(draft.evidenceClosure);
  const evidenceFingerprint = fingerprintPlayAdoptionEvidenceClosure(
    evidenceClosure,
  );
  const recommendedTarget = draft.targetSuggestions.find((suggestion) =>
    suggestion.recommended)!.target;
  return {
    ...structuredClone(draft),
    evidenceClosure,
    evidenceFingerprint,
    targetSuggestions: suggestPlayAdoptionTargets({
      seed: draft.seed,
      summary: draft.summary,
      evidence: draft.evidence,
      visibility: draft.visibility,
      evidenceFingerprint,
      recommendedTarget,
    }),
  };
}

export function projectPlayAdoptionCandidate(
  candidate: PlayAdoptionCandidate,
  projection: 'player' | 'director',
): PlayAdoptionCandidate | undefined {
  if (projection === 'director') return structuredClone(candidate);
  if (projection !== 'player') {
    throw new Error(`Unsupported Play adoption projection: ${String(projection)}.`);
  }
  if (candidate.visibility === 'playerUnknown') return undefined;
  const projected = structuredClone(candidate);
  projected.sourceObservationIds = [];
  projected.sourceTurnIds = [];
  projected.sourceEventIds = [];
  delete projected.seed;
  delete projected.evidenceClosure;
  delete projected.evidenceFingerprint;
  return projected;
}

export function normalizePlayAdoptionDraft(value: unknown): PlayAdoptionDraft {
  const record = requireRecord(value, 'Play adoption draft');
  assertOnlyKnownFields(record, [
    'seed',
    'summary',
    'evidence',
    'visibility',
    'evidenceClosure',
    'evidenceFingerprint',
    'targetSuggestions',
  ], 'Play adoption draft');
  const seed = normalizePlayAdoptionSeed(record.seed);
  const summary = requireBoundedString(record.summary, 'Play adoption summary', 4_000);
  const evidence = requireBoundedString(record.evidence, 'Play adoption evidence', 8_000);
  const visibility = normalizeVisibility(record.visibility);
  const evidenceClosure = normalizePlayAdoptionEvidenceClosure(record.evidenceClosure);
  const evidenceFingerprint = assertSha256(
    record.evidenceFingerprint,
    'Play adoption evidenceFingerprint',
  );
  if (fingerprintPlayAdoptionEvidenceClosure(evidenceClosure) !== evidenceFingerprint) {
    throw new Error('Play adoption evidence fingerprint does not match its closure.');
  }
  const targetSuggestions = normalizeTargetSuggestions(record.targetSuggestions);
  const recommendedTarget = targetSuggestions.find((suggestion) =>
    suggestion.recommended)!.target;
  const expectedSuggestions = suggestPlayAdoptionTargets({
    seed,
    summary,
    evidence,
    visibility,
    evidenceFingerprint,
    recommendedTarget,
  });
  if (!isDeepStrictEqual(targetSuggestions, expectedSuggestions)) {
    throw new Error(
      'Play adoption targetSuggestions do not match the safe root defaults.',
    );
  }
  return {
    seed,
    summary,
    evidence,
    visibility,
    evidenceClosure,
    evidenceFingerprint,
    targetSuggestions,
  };
}

function createSelectedEvidenceIndex(
  session: PlaySession,
  facts: ReturnType<typeof materializePlayTurnFacts>,
): SelectedEvidenceIndex {
  const artifactsById = new Map(
    facts.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const selectedArtifactSet = new Set(facts.selectedTurnIds);
  const artifactOrder = new Map(
    facts.selectedTurnIds.map((artifactId, index) => [artifactId, index]),
  );
  const messageOwners = new Map<string, string>();
  const eventOwners = new Map<string, string>();
  const observationOwners = new Map<string, string>();
  for (const artifact of facts.turnArtifacts) {
    for (const message of artifact.messages) {
      if (message.id) messageOwners.set(message.id, artifact.id);
    }
    for (const eventId of artifact.eventIds) eventOwners.set(eventId, artifact.id);
    for (const observationId of artifact.observationIds) {
      observationOwners.set(observationId, artifact.id);
    }
  }

  const messagesById = new Map<string, { id: string }>();
  for (const artifactId of facts.selectedTurnIds) {
    const artifact = artifactsById.get(artifactId)!;
    for (const message of artifact.messages) {
      if (!message.id) {
        throw new Error(`Selected Play artifact ${artifact.id} contains an id-less message.`);
      }
      messagesById.set(message.id, { id: message.id });
    }
  }
  const eventsById = new Map(
    session.events
      .filter((event) => facts.selectedEventIds.has(event.id))
      .map((event) => [event.id, event]),
  );
  const observationsById = new Map(
    session.observations
      .filter((observation) => facts.selectedObservationIds.has(observation.id))
      .map((observation) => [observation.id, observation]),
  );
  const evidenceOwners = new Map<string, string>();
  for (const evidence of facts.selectedRehearsalEvidence) {
    if (!selectedArtifactSet.has(evidence.owningTurnArtifactId)) continue;
    evidenceOwners.set(evidence.id, evidence.owningTurnArtifactId);
    for (const step of evidence.steps) {
      for (const ref of [
        step.stepRef,
        step.perceptionRef,
        ...step.decisionBasisRefs,
        ...(step.variantOf ? [step.variantOf] : []),
      ]) {
        evidenceOwners.set(ref, evidence.owningTurnArtifactId);
      }
    }
  }
  return {
    selectedArtifactTurnRefs: [...facts.selectedTurnIds],
    artifactsById,
    artifactOrder,
    messageOwners,
    eventOwners,
    observationOwners,
    evidenceOwners,
    messagesById,
    eventsById,
    observationsById,
  };
}

function resolveAdoptionRoot(input: {
  session: PlaySession;
  seed: PlayAdoptionSeed;
  outcomeReport?: PlayOutcomeReport;
  evidenceIndex: SelectedEvidenceIndex;
}): ResolvedAdoptionRoot {
  switch (input.seed.kind) {
    case 'event': {
      const event = input.evidenceIndex.eventsById.get(input.seed.eventId);
      if (!event) {
        throw new Error(
          `Play adoption event is unknown or outside the selected branch: ` +
          `${input.seed.eventId}.`,
        );
      }
      return {
        summary: `${event.title}: ${event.summary}`,
        evidence: `Selected Play ${event.kind} world event.`,
        visibility: event.visibility,
        recommendedTarget: recommendTargetForEvent(event),
        artifactTurnRefs: [requireSelectedOwner(
          input.evidenceIndex.eventOwners,
          event.id,
          'event',
          input.evidenceIndex,
        )],
        messageRefs: [event.turnId, ...(event.cause.sourceTurnIds ?? [])],
        eventRefs: [event.id, ...(event.cause.sourceEventIds ?? [])],
        observationRefs: [],
        evidenceRefs: [],
      };
    }
    case 'observation': {
      const observation = input.evidenceIndex.observationsById.get(
        input.seed.observationId,
      );
      if (!observation) {
        throw new Error(
          `Play adoption observation is unknown or outside the selected branch: ` +
          `${input.seed.observationId}.`,
        );
      }
      const artifactTurnRefs = collectObservationOwnerRefs(
        observation,
        input.evidenceIndex,
      );
      if (!artifactTurnRefs.length) {
        throw new Error(
          `Play adoption observation has no selected committed evidence: ` +
          `${observation.id}.`,
        );
      }
      return {
        summary: observation.summary,
        evidence: observation.evidence,
        visibility: observation.visibility,
        recommendedTarget: 'chapterDraft',
        artifactTurnRefs,
        messageRefs: [...observation.sourceTurnIds],
        eventRefs: [...observation.sourceEventIds],
        observationRefs: [observation.id],
        evidenceRefs: [],
      };
    }
    case 'outcome': {
      const report = requireCurrentOutcomeReport(
        input.session,
        input.evidenceIndex.selectedArtifactTurnRefs,
        input.seed,
        input.outcomeReport,
      );
      const item = report.items.find((candidate) =>
        candidate.id === input.seed.outcomeItemId);
      if (!item) {
        throw new Error(`Play adoption outcome item is unknown: ${input.seed.outcomeItemId}.`);
      }
      assertOutcomeItemSelected(item, input.evidenceIndex);
      return {
        summary: item.summary,
        evidence: `Current Play outcome ${item.kind} (${item.confidence}).`,
        visibility: item.visibility,
        recommendedTarget: recommendTargetForOutcome(item),
        artifactTurnRefs: [...item.artifactTurnRefs],
        messageRefs: [...item.messageRefs],
        eventRefs: [...item.eventRefs],
        observationRefs: [...item.observationRefs],
        evidenceRefs: [...item.evidenceRefs],
      };
    }
  }
}

function createEvidenceClosure(input: {
  session: PlaySession;
  evidenceIndex: SelectedEvidenceIndex;
  root: ResolvedAdoptionRoot;
}): PlayAdoptionEvidenceClosure {
  const artifactRefs = new Set(input.root.artifactTurnRefs);
  const messageRefs = new Set(input.root.messageRefs);
  const eventRefs = new Set<string>();
  const observationRefs = new Set(input.root.observationRefs);
  const evidenceRefs = new Set(input.root.evidenceRefs);
  const pendingEvents = [...input.root.eventRefs];
  while (pendingEvents.length) {
    const eventRef = pendingEvents.shift()!;
    if (eventRefs.has(eventRef)) continue;
    const event = input.evidenceIndex.eventsById.get(eventRef);
    if (!event) {
      throw new Error(
        `Play adoption evidence references unknown or out-of-branch event: ${eventRef}.`,
      );
    }
    eventRefs.add(eventRef);
    messageRefs.add(event.turnId);
    for (const turnRef of event.cause.sourceTurnIds ?? []) messageRefs.add(turnRef);
    for (const sourceEventRef of event.cause.sourceEventIds ?? []) {
      pendingEvents.push(sourceEventRef);
    }
    artifactRefs.add(requireSelectedOwner(
      input.evidenceIndex.eventOwners,
      eventRef,
      'event',
      input.evidenceIndex,
    ));
  }
  for (const observationRef of observationRefs) {
    const observation = input.evidenceIndex.observationsById.get(observationRef);
    if (!observation) {
      throw new Error(
        `Play adoption evidence references unknown or out-of-branch observation: ` +
        `${observationRef}.`,
      );
    }
    for (const turnRef of observation.sourceTurnIds) messageRefs.add(turnRef);
    for (const eventRef of observation.sourceEventIds) {
      if (!eventRefs.has(eventRef)) pendingEvents.push(eventRef);
    }
    for (const ownerRef of collectObservationOwnerRefs(
      observation,
      input.evidenceIndex,
    )) artifactRefs.add(ownerRef);
  }
  // Observation sources can introduce additional causal event closure.
  while (pendingEvents.length) {
    const eventRef = pendingEvents.shift()!;
    if (eventRefs.has(eventRef)) continue;
    const event = input.evidenceIndex.eventsById.get(eventRef);
    if (!event) {
      throw new Error(
        `Play adoption evidence references unknown or out-of-branch event: ${eventRef}.`,
      );
    }
    eventRefs.add(eventRef);
    messageRefs.add(event.turnId);
    for (const turnRef of event.cause.sourceTurnIds ?? []) messageRefs.add(turnRef);
    for (const sourceEventRef of event.cause.sourceEventIds ?? []) {
      pendingEvents.push(sourceEventRef);
    }
    artifactRefs.add(requireSelectedOwner(
      input.evidenceIndex.eventOwners,
      eventRef,
      'event',
      input.evidenceIndex,
    ));
  }
  for (const messageRef of messageRefs) {
    if (!input.evidenceIndex.messagesById.has(messageRef)) {
      throw new Error(
        `Play adoption evidence references unknown or out-of-branch message: ` +
        `${messageRef}.`,
      );
    }
    artifactRefs.add(requireSelectedOwner(
      input.evidenceIndex.messageOwners,
      messageRef,
      'message',
      input.evidenceIndex,
    ));
  }
  for (const evidenceRef of evidenceRefs) {
    const owner = input.evidenceIndex.evidenceOwners.get(evidenceRef);
    if (!owner) {
      throw new Error(
        `Play adoption evidence references unknown or out-of-branch evidence: ` +
        `${evidenceRef}.`,
      );
    }
    artifactRefs.add(owner);
  }
  if (!artifactRefs.size) {
    throw new Error('Play adoption evidence requires a selected committed artifact.');
  }
  const sourceBase = createPlayAdoptionSourceBase(input.session.activatedSources);
  const sourceSnapshots = sourceBase.sourceSnapshots;
  const selectedArtifactTurnRefs = [...input.evidenceIndex.selectedArtifactTurnRefs];
  const closure = normalizePlayAdoptionEvidenceClosure({
    schemaVersion: PLAY_ADOPTION_EVIDENCE_SCHEMA_VERSION,
    sessionId: input.session.id,
    sessionRevision: input.session.revision,
    selectedArtifactTurnRefs,
    artifactTurnRefs: orderArtifactRefs(
      artifactRefs,
      input.evidenceIndex.artifactOrder,
    ),
    messageRefs: orderRefsBySelectedArtifacts(
      messageRefs,
      input.evidenceIndex.messageOwners,
      input.evidenceIndex.artifactOrder,
    ),
    eventRefs: orderRefsBySelectedArtifacts(
      eventRefs,
      input.evidenceIndex.eventOwners,
      input.evidenceIndex.artifactOrder,
    ),
    observationRefs: orderRefsBySelectedArtifacts(
      observationRefs,
      input.evidenceIndex.observationOwners,
      input.evidenceIndex.artifactOrder,
    ),
    evidenceRefs: orderRefsBySelectedArtifacts(
      evidenceRefs,
      input.evidenceIndex.evidenceOwners,
      input.evidenceIndex.artifactOrder,
    ),
    sourceSnapshots,
    selectedPathFingerprint: sha256(canonicalJson({
      sessionId: input.session.id,
      selectedArtifactTurnRefs,
    })),
    sourceBaseFingerprint: sourceBase.sourceBaseFingerprint,
  });
  return closure;
}

function requireCurrentOutcomeReport(
  session: PlaySession,
  selectedArtifactTurnRefs: string[],
  seed: Extract<PlayAdoptionSeed, { kind: 'outcome' }>,
  value: PlayOutcomeReport | undefined,
): PlayOutcomeReport {
  if (!value) {
    throw new Error('Play outcome adoption requires the current Director outcome report.');
  }
  const report = normalizePlayOutcomeReport(value);
  const fingerprint = fingerprintPlayOutcomeReport(report);
  if (fingerprint !== seed.outcomeReportFingerprint) {
    throw new Error('Play outcome adoption report fingerprint is stale or mismatched.');
  }
  if (
    report.sessionId !== session.id ||
    report.sessionRevision !== session.revision ||
    !isDeepStrictEqual(report.selectedArtifactTurnRefs, selectedArtifactTurnRefs)
  ) {
    throw new Error('Play outcome adoption report is stale for the selected branch.');
  }
  const expected = createPlayOutcomeReport(session, { createdAt: report.createdAt });
  if (!isDeepStrictEqual(report, expected)) {
    throw new Error('Play outcome adoption report does not match current selected evidence.');
  }
  return report;
}

function assertOutcomeItemSelected(
  item: PlayOutcomeItem,
  index: SelectedEvidenceIndex,
): void {
  for (const artifactRef of item.artifactTurnRefs) {
    if (!index.artifactOrder.has(artifactRef)) {
      throw new Error(`Play outcome item references an unselected artifact: ${artifactRef}.`);
    }
  }
  for (const messageRef of item.messageRefs) {
    if (!index.messagesById.has(messageRef)) {
      throw new Error(`Play outcome item references an unselected message: ${messageRef}.`);
    }
  }
  for (const eventRef of item.eventRefs) {
    if (!index.eventsById.has(eventRef)) {
      throw new Error(`Play outcome item references an unselected event: ${eventRef}.`);
    }
  }
  for (const observationRef of item.observationRefs) {
    if (!index.observationsById.has(observationRef)) {
      throw new Error(
        `Play outcome item references an unselected observation: ${observationRef}.`,
      );
    }
  }
  for (const evidenceRef of item.evidenceRefs) {
    if (!index.evidenceOwners.has(evidenceRef)) {
      throw new Error(`Play outcome item references unselected evidence: ${evidenceRef}.`);
    }
  }
  if (!item.artifactTurnRefs.length) {
    throw new Error(`Play outcome item ${item.id} has no selected committed artifact.`);
  }
}

function collectObservationOwnerRefs(
  observation: PlayObservation,
  index: SelectedEvidenceIndex,
): string[] {
  const owners = new Set<string>();
  const directOwner = index.observationOwners.get(observation.id);
  if (directOwner && index.artifactOrder.has(directOwner)) owners.add(directOwner);
  for (const turnRef of observation.sourceTurnIds) {
    const owner = index.messageOwners.get(turnRef);
    if (owner && index.artifactOrder.has(owner)) owners.add(owner);
  }
  for (const eventRef of observation.sourceEventIds) {
    const owner = index.eventOwners.get(eventRef);
    if (owner && index.artifactOrder.has(owner)) owners.add(owner);
  }
  return orderArtifactRefs(owners, index.artifactOrder);
}

function requireSelectedOwner(
  owners: Map<string, string>,
  ref: string,
  kind: string,
  index: SelectedEvidenceIndex,
): string {
  const owner = owners.get(ref);
  if (!owner || !index.artifactOrder.has(owner)) {
    throw new Error(`Play adoption ${kind} has no selected artifact owner: ${ref}.`);
  }
  return owner;
}

function recommendTargetForEvent(event: PlayWorldEvent): PlayAdoptionTarget {
  switch (event.kind) {
    case 'relationshipChanged':
    case 'resourceChanged':
    case 'itemMoved':
      return 'state';
    case 'evidenceChanged':
    case 'informationSpread':
      return 'foreshadow';
    case 'environmentChanged':
    case 'locationChanged':
    case 'npcActed':
    case 'factionActed':
    case 'arrival':
    case 'departure':
    case 'deadlineAdvanced':
    case 'ruleConsequence':
      return 'timeline';
    case 'manual':
      return 'chapterDraft';
  }
}

function recommendTargetForOutcome(item: PlayOutcomeItem): PlayAdoptionTarget {
  switch (item.kind) {
    case 'goalAssessment':
      return 'foreshadow';
    case 'worldChange':
      return 'timeline';
    case 'sceneSummary':
    case 'participantFootprint':
    case 'writingMaterial':
      return 'chapterDraft';
  }
}

function inferRecommendedTarget(seed: PlayAdoptionSeed): PlayAdoptionTarget {
  return seed.kind === 'event'
    ? 'timeline'
    : seed.kind === 'observation'
      ? 'chapterDraft'
      : 'chapterDraft';
}

function createSessionSourceBase(
  sources: readonly PlayActivatedSource[],
): PlayAdoptionSourceSnapshot[] {
  if (sources.length > MAX_PLAY_ADOPTION_SOURCE_SNAPSHOTS) {
    throw new Error(
      `Play adoption source base cannot exceed ` +
      `${MAX_PLAY_ADOPTION_SOURCE_SNAPSHOTS} snapshots.`,
    );
  }
  const snapshots = sources.map((source): PlayAdoptionSourceSnapshot => ({
    sourceId: requireBoundedString(source.sourceId, 'Play adoption sourceId', 512),
    ...(source.path ? { path: requireBoundedString(source.path, 'source path', 1_000) } : {}),
    ...(source.contentHash
      ? { contentHash: assertSha256(source.contentHash, 'Play adoption source contentHash') }
      : {}),
  })).toSorted((left, right) => left.sourceId.localeCompare(right.sourceId));
  assertUnique(snapshots.map((snapshot) => snapshot.sourceId), 'source snapshot');
  return snapshots;
}

function normalizeSourceSnapshots(value: unknown): PlayAdoptionSourceSnapshot[] {
  if (!Array.isArray(value) || value.length > MAX_PLAY_ADOPTION_SOURCE_SNAPSHOTS) {
    throw new Error(
      `Play adoption sourceSnapshots must be an array of at most ` +
      `${MAX_PLAY_ADOPTION_SOURCE_SNAPSHOTS} entries.`,
    );
  }
  const snapshots = value.map((entry): PlayAdoptionSourceSnapshot => {
    const record = requireRecord(entry, 'Play adoption source snapshot');
    assertOnlyKnownFields(
      record,
      ['sourceId', 'path', 'contentHash'],
      'Play adoption source snapshot',
    );
    return {
      sourceId: requireBoundedString(record.sourceId, 'Play adoption sourceId', 512),
      ...(record.path === undefined
        ? {}
        : { path: requireBoundedString(record.path, 'Play adoption source path', 1_000) }),
      ...(record.contentHash === undefined
        ? {}
        : {
            contentHash: assertSha256(
              record.contentHash,
              'Play adoption source contentHash',
            ),
          }),
    };
  });
  assertUnique(snapshots.map((snapshot) => snapshot.sourceId), 'source snapshot');
  const sorted = [...snapshots].toSorted((left, right) =>
    left.sourceId.localeCompare(right.sourceId));
  if (!isDeepStrictEqual(snapshots, sorted)) {
    throw new Error('Play adoption sourceSnapshots must use stable source id order.');
  }
  return snapshots;
}

function normalizeTargetSuggestions(value: unknown): PlayAdoptionTargetSuggestion[] {
  if (!Array.isArray(value) || value.length !== PLAY_ADOPTION_TARGETS.length) {
    throw new Error('Play adoption targetSuggestions must contain all four targets.');
  }
  let recommendedCount = 0;
  const suggestions = value.map((entry, index): PlayAdoptionTargetSuggestion => {
    const record = requireRecord(entry, 'Play adoption target suggestion');
    assertOnlyKnownFields(record, [
      'target',
      'toolName',
      'recommended',
      'reason',
      'defaultPayload',
    ], 'Play adoption target suggestion');
    const target = PLAY_ADOPTION_TARGETS[index]!;
    if (record.target !== target) {
      throw new Error('Play adoption targetSuggestions must use stable target order.');
    }
    const toolName = toolNameForTarget(target);
    if (record.toolName !== toolName) {
      throw new Error(`Play adoption target ${target} has an invalid write-intent tool.`);
    }
    if (typeof record.recommended !== 'boolean') {
      throw new Error('Play adoption target suggestion requires recommended boolean.');
    }
    if (record.recommended) recommendedCount += 1;
    if (!isRecord(record.defaultPayload)) {
      throw new Error('Play adoption target suggestion requires defaultPayload object.');
    }
    return {
      target,
      toolName,
      recommended: record.recommended,
      reason: requireBoundedString(record.reason, 'Play adoption target reason', 1_000),
      defaultPayload: structuredClone(record.defaultPayload),
    };
  });
  if (recommendedCount !== 1) {
    throw new Error('Play adoption targetSuggestions require exactly one recommendation.');
  }
  return suggestions;
}

function toolNameForTarget(target: PlayAdoptionTarget): PlayAdoptionWriteIntentToolName {
  switch (target) {
    case 'chapterDraft': return 'chapter.createDraft';
    case 'state': return 'state.set';
    case 'timeline': return 'timeline.add';
    case 'foreshadow': return 'foreshadow.create';
  }
}

function redactEvidenceClosure(
  closure: PlayAdoptionEvidenceClosure,
): PlayAdoptionEvidenceClosure {
  const redacted = {
    ...structuredClone(closure),
    selectedArtifactTurnRefs: [],
    artifactTurnRefs: [],
    messageRefs: [],
    eventRefs: [],
    observationRefs: [],
    evidenceRefs: [],
    sourceSnapshots: [],
  };
  redacted.selectedPathFingerprint = sha256(canonicalJson({
    sessionId: redacted.sessionId,
    selectedArtifactTurnRefs: [],
  }));
  redacted.sourceBaseFingerprint = sha256(canonicalJson([]));
  return normalizePlayAdoptionEvidenceClosure(redacted);
}

function orderArtifactRefs(
  refs: Iterable<string>,
  order: Map<string, number>,
): string[] {
  return [...new Set(refs)].toSorted((left, right) =>
    (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    left.localeCompare(right));
}

function orderRefsBySelectedArtifacts(
  refs: Iterable<string>,
  owners: Map<string, string>,
  artifactOrder: Map<string, number>,
): string[] {
  const unique = [...new Set(refs)];
  return unique.toSorted((left, right) => {
    const leftOwner = owners.get(left);
    const rightOwner = owners.get(right);
    return (
      (artifactOrder.get(leftOwner ?? '') ?? Number.MAX_SAFE_INTEGER) -
      (artifactOrder.get(rightOwner ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right)
    );
  });
}

function normalizeIdList(
  value: unknown,
  label: string,
  maximum = MAX_PLAY_ADOPTION_EVIDENCE_REFS,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(
      `Play adoption ${label} must be an array of at most ` +
      `${maximum} ids.`,
    );
  }
  const ids = value.map((id) => assertSafeId(id, `Play adoption ${label}`));
  assertUnique(ids, label);
  return ids;
}

function normalizeVisibility(value: unknown): PlayEventVisibility {
  if (value !== 'playerVisible' && value !== 'rumor' && value !== 'playerUnknown') {
    throw new Error('Play adoption visibility is invalid.');
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Play adoption ${label} values must not contain duplicates.`);
  }
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !value ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..')
  ) {
    throw new Error(`${label} must be a safe id.`);
  }
  return value;
}

function assertSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 fingerprint.`);
  }
  return value;
}

function requireBoundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const known = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export type {
  PlayAdoptionDraft,
  PlayAdoptionEvidenceClosure,
  PlayAdoptionSeed,
  PlayAdoptionSourceSnapshot,
  PlayAdoptionTargetSuggestion,
  PlayAdoptionWriteIntentToolName,
} from './play-types.js';
