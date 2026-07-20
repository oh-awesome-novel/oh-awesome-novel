import { isDeepStrictEqual } from 'node:util';

import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type {
  PlayEventVisibility,
  PlayWorldClock,
} from './play-types.js';

export const PLAY_REHEARSAL_SESSION_SCHEMA_VERSION = 5 as const;
export const PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION = 1 as const;
export const PLAY_REHEARSAL_SCENE_SCHEMA_VERSION = 1 as const;
export const PLAY_REHEARSAL_SIDECAR_FILE = 'scene-rehearsal.yaml' as const;
export const PLAY_REHEARSAL_SCENES_DIRECTORY = 'scenes' as const;

const MAX_REHEARSAL_PARTICIPANTS = 24;
const MAX_REHEARSAL_KNOWLEDGE_ITEMS = 128;
const MAX_REHEARSAL_TURN_EVIDENCE = 512;
const MAX_REHEARSAL_STEPS = 48;
const MAX_NARRATIVE_BLOCKS = 96;
const MAX_SHORT_TEXT = 800;
const MAX_NARRATIVE_TEXT = 12_000;

export type PlaySessionPurpose = 'immersiveJourney' | 'sceneRehearsal';
export type PlayStartMode = 'quick' | 'guided';

export interface PlaySceneValue {
  value: string;
  provenance:
    | { kind: 'sourceBacked'; sourceRefs: string[] }
    | { kind: 'authorProvided'; providedAt: string };
}

export interface PlaySceneContract {
  sceneId: string;
  worldClock: PlayWorldClock;
  clockProvenance:
    | {
        kind: 'sessionRevision';
        sessionId: string;
        revision: number;
        owningTurnRef?: string;
      }
    | {
        kind: 'newSessionInitial';
        sourceRefs: string[];
        authorProvidedAt?: string;
      };
  location?: PlaySceneValue;
  atmosphere?: PlaySceneValue;
  trigger?: PlaySceneValue;
  objective?: PlaySceneValue;
  risk?: PlaySceneValue;
  participantRefs: string[];
  orderStrategy: PlayRehearsalOrderStrategy;
}

export type PlayRehearsalOrderStrategy =
  | 'directorFixed'
  | 'refereeDynamic'
  | 'hybrid';

export interface PlayRehearsalParticipant {
  participantRef: string;
  canonicalCharacterRef?: string;
  displayName: string;
  position?: string;
  emotion?: string;
  currentGoal?: string;
  initialKnowledgeEvidenceRefs: string[];
}

export interface PlaySceneKnowledgeEvidence {
  id: string;
  participantRef: string;
  visibility: PlayEventVisibility;
  fact: string;
  provenance:
    | {
        kind: 'sourceBacked';
        sourceId: string;
        sourcePath: string;
        contentHash: string;
        sourceFactRef?: string;
      }
    | {
        kind: 'authorProvided';
        providedAt: string;
      };
}

export interface PlaySceneRehearsalSidecar {
  schemaVersion: typeof PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION;
  sessionId: string;
  purpose: 'sceneRehearsal';
  startMode: PlayStartMode;
  activeSceneRef: string;
  sceneContract: PlaySceneContract;
  participants: PlayRehearsalParticipant[];
  initialKnowledgeEvidence: PlaySceneKnowledgeEvidence[];
}

export interface CharacterPerceptionPackage {
  id: string;
  participantRef: string;
  sceneRef: string;
  sceneRevision: number;
  participant: PlayRehearsalParticipant;
  scene: {
    worldClock: PlayWorldClock;
    location?: PlaySceneValue;
    atmosphere?: PlaySceneValue;
    trigger?: PlaySceneValue;
  };
  initialKnowledgeEvidence: PlaySceneKnowledgeEvidence[];
  grantedKnowledgeEvidence: PlayParticipantKnowledgeEvidence[];
  visibleEventRefs: string[];
  observedNarrativeBlockRefs: string[];
  omissionMetadata: Array<{
    reason: 'budget' | 'semanticBoundary';
    omittedCount?: number;
    opaqueTraceRef?: string;
  }>;
}

export interface PlayParticipantKnowledgeEvidence {
  id: string;
  participantRef: string;
  interventionRef: string;
  effectiveFromStepRef: string;
  factRefs: string[];
  fact: string;
  visibility: PlayEventVisibility;
  provenance:
    | { kind: 'existingFact' }
    | { kind: 'authorProvidedPlayFact'; providedAt: string };
}

export type NarrativeBlockKind =
  | 'narrator'
  | 'characterSpeech'
  | 'characterAction'
  | 'worldNotice';

export interface NarrativeBlock {
  id: string;
  kind: NarrativeBlockKind;
  speakerRef?: string;
  content: string;
  visibility: PlayEventVisibility;
  projection: 'transcript' | 'directorOnly';
  eventRefs: string[];
  sourceRefs: string[];
}

export interface PlayCommittedCharacterStepEvidence {
  stepRef: string;
  participantRef: string;
  perceptionRef: string;
  intentSummary: string;
  narrativeBlocks: NarrativeBlock[];
  settlementEventRefs: string[];
  decisionBasisRefs: string[];
  variantOf?: string;
}

export interface PlayRehearsalTurnEvidence {
  id: string;
  owningTurnArtifactId: string;
  attemptId: string;
  selectedStepRefs: string[];
  steps: PlayCommittedCharacterStepEvidence[];
  hostNarrativeBlocks: NarrativeBlock[];
  narrativeBlocks: NarrativeBlock[];
  finalizeReceipt: {
    idempotencyKey: string;
    requestFingerprint: string;
    attemptRevision: number;
  };
  committedAt: string;
  canonical: false;
}

export interface PlayCommittedSceneEvidence {
  schemaVersion: typeof PLAY_REHEARSAL_SCENE_SCHEMA_VERSION;
  sessionId: string;
  sceneId: string;
  turns: PlayRehearsalTurnEvidence[];
}

export function createPlayParticipantRef(
  displayName: string,
  existingRefs: Iterable<string> = [],
): string {
  const normalized = normalizeText(displayName, 'participant displayName', MAX_SHORT_TEXT);
  const slug = normalized
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'guest';
  const existing = new Set(existingRefs);
  const base = `participant-${slug}`;
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function normalizePlaySceneRehearsalSidecar(
  value: unknown,
): PlaySceneRehearsalSidecar {
  const record = requireRecord(value, 'Play scene rehearsal sidecar');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'sessionId',
    'purpose',
    'startMode',
    'activeSceneRef',
    'sceneContract',
    'participants',
    'initialKnowledgeEvidence',
  ], 'Play scene rehearsal sidecar');
  if (record.schemaVersion !== PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Play scene rehearsal schemaVersion: ${String(record.schemaVersion)}.`,
    );
  }
  if (record.purpose !== 'sceneRehearsal') {
    throw new Error('Play scene rehearsal sidecar requires purpose sceneRehearsal.');
  }
  if (record.startMode !== 'quick' && record.startMode !== 'guided') {
    throw new Error('Play scene rehearsal sidecar has an invalid startMode.');
  }
  const sessionId = assertSafePlayRehearsalId(record.sessionId, 'sessionId');
  const activeSceneRef = assertSafePlayRehearsalId(
    record.activeSceneRef,
    'activeSceneRef',
  );
  const sceneContract = normalizePlaySceneContract(record.sceneContract);
  if (sceneContract.sceneId !== activeSceneRef) {
    throw new Error('Play scene rehearsal activeSceneRef must match its Scene Contract.');
  }
  const participants = normalizeBoundedArray(
    record.participants,
    MAX_REHEARSAL_PARTICIPANTS,
    'Play rehearsal participants',
  ).map(normalizePlayRehearsalParticipant);
  if (!participants.length) {
    throw new Error('Play scene rehearsal requires at least one participant.');
  }
  assertUnique(participants.map((participant) => participant.participantRef), 'participant ref');
  if (
    participants.length !== sceneContract.participantRefs.length ||
    participants.some((participant, index) =>
      participant.participantRef !== sceneContract.participantRefs[index])
  ) {
    throw new Error('Play rehearsal participants must match the fixed Scene Contract order.');
  }

  const initialKnowledgeEvidence = normalizeBoundedArray(
    record.initialKnowledgeEvidence,
    MAX_REHEARSAL_KNOWLEDGE_ITEMS,
    'Play rehearsal initial knowledge evidence',
  ).map(normalizePlaySceneKnowledgeEvidence);
  assertUnique(initialKnowledgeEvidence.map((evidence) => evidence.id), 'knowledge evidence id');
  const evidenceById = new Map(initialKnowledgeEvidence.map((evidence) => [evidence.id, evidence]));
  const participantRefs = new Set(participants.map((participant) => participant.participantRef));
  for (const evidence of initialKnowledgeEvidence) {
    if (!participantRefs.has(evidence.participantRef)) {
      throw new Error(
        `Play knowledge evidence references an unknown participant: ${evidence.participantRef}.`,
      );
    }
  }
  const assignedEvidenceRefs = new Set<string>();
  for (const participant of participants) {
    for (const evidenceRef of participant.initialKnowledgeEvidenceRefs) {
      const evidence = evidenceById.get(evidenceRef);
      if (!evidence || evidence.participantRef !== participant.participantRef) {
        throw new Error(
          `Play participant ${participant.participantRef} references unavailable knowledge evidence: ${evidenceRef}.`,
        );
      }
      if (assignedEvidenceRefs.has(evidenceRef)) {
        throw new Error(`Play knowledge evidence is assigned more than once: ${evidenceRef}.`);
      }
      assignedEvidenceRefs.add(evidenceRef);
    }
  }
  if (assignedEvidenceRefs.size !== initialKnowledgeEvidence.length) {
    throw new Error('Every Play knowledge evidence record must be assigned to its participant.');
  }

  return {
    schemaVersion: PLAY_REHEARSAL_SIDECAR_SCHEMA_VERSION,
    sessionId,
    purpose: 'sceneRehearsal',
    startMode: record.startMode,
    activeSceneRef,
    sceneContract,
    participants,
    initialKnowledgeEvidence,
  };
}

export function normalizePlaySceneContract(value: unknown): PlaySceneContract {
  const record = requireRecord(value, 'Play Scene Contract');
  assertOnlyKnownFields(record, [
    'sceneId',
    'worldClock',
    'clockProvenance',
    'location',
    'atmosphere',
    'trigger',
    'objective',
    'risk',
    'participantRefs',
    'orderStrategy',
  ], 'Play Scene Contract');
  const orderStrategies: readonly PlayRehearsalOrderStrategy[] = [
    'directorFixed',
    'refereeDynamic',
    'hybrid',
  ];
  if (!orderStrategies.includes(record.orderStrategy as PlayRehearsalOrderStrategy)) {
    throw new Error('Play Scene Contract has an invalid actor order strategy.');
  }
  const participantRefs = normalizeSafeIdList(
    record.participantRefs,
    'Scene Contract participantRefs',
    MAX_REHEARSAL_PARTICIPANTS,
  );
  if (!participantRefs.length) {
    throw new Error('Play Scene Contract requires participants.');
  }
  const location = record.location === undefined
    ? undefined
    : normalizePlaySceneValue(record.location, 'location');
  const atmosphere = record.atmosphere === undefined
    ? undefined
    : normalizePlaySceneValue(record.atmosphere, 'atmosphere');
  const trigger = record.trigger === undefined
    ? undefined
    : normalizePlaySceneValue(record.trigger, 'trigger');
  const objective = record.objective === undefined
    ? undefined
    : normalizePlaySceneValue(record.objective, 'objective');
  const risk = record.risk === undefined
    ? undefined
    : normalizePlaySceneValue(record.risk, 'risk');
  return {
    sceneId: assertSafePlayRehearsalId(record.sceneId, 'sceneId'),
    worldClock: normalizeWorldClock(record.worldClock),
    clockProvenance: normalizeClockProvenance(record.clockProvenance),
    ...(location ? { location } : {}),
    ...(atmosphere ? { atmosphere } : {}),
    ...(trigger ? { trigger } : {}),
    ...(objective ? { objective } : {}),
    ...(risk ? { risk } : {}),
    participantRefs,
    orderStrategy: record.orderStrategy as PlayRehearsalOrderStrategy,
  };
}

export function normalizeNarrativeBlock(value: unknown): NarrativeBlock {
  const record = requireRecord(value, 'Play NarrativeBlock');
  assertOnlyKnownFields(record, [
    'id',
    'kind',
    'speakerRef',
    'content',
    'visibility',
    'projection',
    'eventRefs',
    'sourceRefs',
  ], 'Play NarrativeBlock');
  const kinds: NarrativeBlockKind[] = [
    'narrator',
    'characterSpeech',
    'characterAction',
    'worldNotice',
  ];
  if (!kinds.includes(record.kind as NarrativeBlockKind)) {
    throw new Error(`Invalid Play NarrativeBlock kind: ${String(record.kind)}.`);
  }
  const visibility = normalizeVisibility(record.visibility);
  if (record.projection !== 'transcript' && record.projection !== 'directorOnly') {
    throw new Error('Play NarrativeBlock has an invalid projection.');
  }
  if (visibility === 'playerUnknown' && record.projection !== 'directorOnly') {
    throw new Error('A playerUnknown NarrativeBlock must remain directorOnly.');
  }
  const speakerRef = record.speakerRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.speakerRef, 'NarrativeBlock speakerRef');
  if (
    (record.kind === 'characterSpeech' || record.kind === 'characterAction') &&
    !speakerRef
  ) {
    throw new Error('Character NarrativeBlocks require speakerRef.');
  }
  return {
    id: assertSafePlayRehearsalId(record.id, 'NarrativeBlock id'),
    kind: record.kind as NarrativeBlockKind,
    ...(speakerRef ? { speakerRef } : {}),
    content: normalizeText(record.content, 'NarrativeBlock content', MAX_NARRATIVE_TEXT),
    visibility,
    projection: record.projection,
    eventRefs: normalizeSafeIdList(record.eventRefs, 'NarrativeBlock eventRefs', 64),
    sourceRefs: normalizeSafeIdList(record.sourceRefs, 'NarrativeBlock sourceRefs', 64),
  };
}

export function normalizePlayCommittedSceneEvidence(
  value: unknown,
): PlayCommittedSceneEvidence {
  const record = requireRecord(value, 'Play committed scene evidence');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'sessionId',
    'sceneId',
    'turns',
  ], 'Play committed scene evidence');
  if (record.schemaVersion !== PLAY_REHEARSAL_SCENE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Play committed scene schemaVersion: ${String(record.schemaVersion)}.`,
    );
  }
  const turns = normalizeBoundedArray(
    record.turns,
    MAX_REHEARSAL_TURN_EVIDENCE,
    'Play rehearsal turn evidence',
  ).map(normalizePlayRehearsalTurnEvidence);
  assertUnique(turns.map((turn) => turn.id), 'rehearsal evidence id');
  assertUnique(turns.map((turn) => turn.owningTurnArtifactId), 'rehearsal evidence owner');
  assertUnique(turns.map((turn) => turn.attemptId), 'rehearsal attempt id');
  return {
    schemaVersion: PLAY_REHEARSAL_SCENE_SCHEMA_VERSION,
    sessionId: assertSafePlayRehearsalId(record.sessionId, 'scene evidence sessionId'),
    sceneId: assertSafePlayRehearsalId(record.sceneId, 'scene evidence sceneId'),
    turns,
  };
}

export function createCharacterPerceptionPackage(
  sidecarValue: PlaySceneRehearsalSidecar,
  participantRefValue: string,
  options: {
    sceneRevision?: number;
    worldClock?: PlayWorldClock;
    visibleEventRefs?: string[];
    observedNarrativeBlockRefs?: string[];
    grantedKnowledgeEvidence?: PlayParticipantKnowledgeEvidence[];
  } = {},
): CharacterPerceptionPackage {
  const sidecar = normalizePlaySceneRehearsalSidecar(sidecarValue);
  const participantRef = assertSafePlayRehearsalId(
    participantRefValue,
    'perception participantRef',
  );
  const participant = sidecar.participants.find((item) =>
    item.participantRef === participantRef);
  if (!participant) {
    throw new Error(`Play perception references an unknown participant: ${participantRef}.`);
  }
  const evidenceById = new Map(
    sidecar.initialKnowledgeEvidence.map((evidence) => [evidence.id, evidence]),
  );
  const initialKnowledgeEvidence = participant.initialKnowledgeEvidenceRefs.map(
    (evidenceRef) => structuredClone(evidenceById.get(evidenceRef)!),
  );
  const sceneRevision = normalizeNonNegativeInteger(
    options.sceneRevision ?? 0,
    'perception sceneRevision',
  );
  const location = sidecar.sceneContract.location
    ? structuredClone(sidecar.sceneContract.location)
    : undefined;
  const atmosphere = sidecar.sceneContract.atmosphere
    ? structuredClone(sidecar.sceneContract.atmosphere)
    : undefined;
  const trigger = sidecar.sceneContract.trigger
    ? structuredClone(sidecar.sceneContract.trigger)
    : undefined;
  return normalizeCharacterPerceptionPackage({
    id: `perception-${sidecar.activeSceneRef}-${participantRef}-${sceneRevision}`,
    participantRef,
    sceneRef: sidecar.activeSceneRef,
    sceneRevision,
    participant: structuredClone(participant),
    scene: {
      worldClock: normalizeWorldClock(
        options.worldClock ?? sidecar.sceneContract.worldClock,
      ),
      ...(location ? { location } : {}),
      ...(atmosphere ? { atmosphere } : {}),
      ...(trigger ? { trigger } : {}),
    },
    initialKnowledgeEvidence,
    grantedKnowledgeEvidence: options.grantedKnowledgeEvidence ?? [],
    visibleEventRefs: normalizeSafeIdList(
      options.visibleEventRefs ?? [],
      'perception visibleEventRefs',
      128,
    ),
    observedNarrativeBlockRefs: normalizeSafeIdList(
      options.observedNarrativeBlockRefs ?? [],
      'perception observedNarrativeBlockRefs',
      128,
    ),
    omissionMetadata: [],
  });
}

export function normalizeCharacterPerceptionPackage(
  value: unknown,
): CharacterPerceptionPackage {
  const record = requireRecord(value, 'Play character perception package');
  assertOnlyKnownFields(record, [
    'id',
    'participantRef',
    'sceneRef',
    'sceneRevision',
    'participant',
    'scene',
    'initialKnowledgeEvidence',
    'grantedKnowledgeEvidence',
    'visibleEventRefs',
    'observedNarrativeBlockRefs',
    'omissionMetadata',
  ], 'Play character perception package');
  const participantRef = assertSafePlayRehearsalId(
    record.participantRef,
    'perception participantRef',
  );
  const sceneRef = assertSafePlayRehearsalId(record.sceneRef, 'perception sceneRef');
  const sceneRevision = normalizeNonNegativeInteger(
    record.sceneRevision,
    'perception sceneRevision',
  );
  const id = assertSafePlayRehearsalId(record.id, 'perception id');
  if (id !== `perception-${sceneRef}-${participantRef}-${sceneRevision}`) {
    throw new Error('Play perception id does not match its scene/participant/revision.');
  }
  const participant = normalizePlayRehearsalParticipant(record.participant);
  if (participant.participantRef !== participantRef) {
    throw new Error('Play perception participant snapshot has mismatched identity.');
  }
  const scene = requireRecord(record.scene, 'Play perception scene');
  assertOnlyKnownFields(scene, [
    'worldClock',
    'location',
    'atmosphere',
    'trigger',
  ], 'Play perception scene');
  const location = scene.location === undefined
    ? undefined
    : normalizePlaySceneValue(scene.location, 'perception location');
  const atmosphere = scene.atmosphere === undefined
    ? undefined
    : normalizePlaySceneValue(scene.atmosphere, 'perception atmosphere');
  const trigger = scene.trigger === undefined
    ? undefined
    : normalizePlaySceneValue(scene.trigger, 'perception trigger');
  const initialKnowledgeEvidence = normalizeBoundedArray(
    record.initialKnowledgeEvidence,
    MAX_REHEARSAL_KNOWLEDGE_ITEMS,
    'Play perception initial knowledge evidence',
  ).map(normalizePlaySceneKnowledgeEvidence);
  assertUnique(
    initialKnowledgeEvidence.map((evidence) => evidence.id),
    'perception knowledge evidence id',
  );
  if (
    initialKnowledgeEvidence.some((evidence) =>
      evidence.participantRef !== participantRef) ||
    initialKnowledgeEvidence.length !== participant.initialKnowledgeEvidenceRefs.length ||
    initialKnowledgeEvidence.some((evidence, index) =>
      evidence.id !== participant.initialKnowledgeEvidenceRefs[index])
  ) {
    throw new Error(
      'Play perception knowledge evidence does not match its participant snapshot.',
    );
  }
  const omissionMetadata = normalizeBoundedArray(
    record.omissionMetadata,
    16,
    'Play perception omission metadata',
  ).map((item): CharacterPerceptionPackage['omissionMetadata'][number] => {
    const omission = requireRecord(item, 'Play perception omission metadata item');
    assertOnlyKnownFields(
      omission,
      ['reason', 'omittedCount', 'opaqueTraceRef'],
      'Play perception omission metadata item',
    );
    if (omission.reason !== 'budget' && omission.reason !== 'semanticBoundary') {
      throw new Error('Play perception omission metadata has an invalid reason.');
    }
    const omittedCount = omission.omittedCount === undefined
      ? undefined
      : normalizeNonNegativeInteger(omission.omittedCount, 'omittedCount');
    const opaqueTraceRef = omission.opaqueTraceRef === undefined
      ? undefined
      : assertSafePlayRehearsalId(omission.opaqueTraceRef, 'opaqueTraceRef');
    return {
      reason: omission.reason,
      ...(omittedCount !== undefined ? { omittedCount } : {}),
      ...(opaqueTraceRef ? { opaqueTraceRef } : {}),
    };
  });
  return {
    id,
    participantRef,
    sceneRef,
    sceneRevision,
    participant,
    scene: {
      worldClock: normalizeWorldClock(scene.worldClock),
      ...(location ? { location } : {}),
      ...(atmosphere ? { atmosphere } : {}),
      ...(trigger ? { trigger } : {}),
    },
    initialKnowledgeEvidence,
    grantedKnowledgeEvidence: normalizeParticipantKnowledgeEvidenceList(
      record.grantedKnowledgeEvidence,
      participantRef,
    ),
    visibleEventRefs: normalizeSafeIdList(
      record.visibleEventRefs,
      'perception visibleEventRefs',
      128,
    ),
    observedNarrativeBlockRefs: normalizeSafeIdList(
      record.observedNarrativeBlockRefs,
      'perception observedNarrativeBlockRefs',
      128,
    ),
    omissionMetadata,
  };
}

export function listForbiddenPlayKnowledgeEvidenceRefs(
  sidecarValue: PlaySceneRehearsalSidecar,
  participantRefValue: string,
): string[] {
  const sidecar = normalizePlaySceneRehearsalSidecar(sidecarValue);
  const participantRef = assertSafePlayRehearsalId(
    participantRefValue,
    'perception participantRef',
  );
  const participant = sidecar.participants.find((item) =>
    item.participantRef === participantRef);
  if (!participant) {
    throw new Error(`Play perception references an unknown participant: ${participantRef}.`);
  }
  const allowed = new Set(participant.initialKnowledgeEvidenceRefs);
  return sidecar.initialKnowledgeEvidence
    .map((evidence) => evidence.id)
    .filter((evidenceRef) => !allowed.has(evidenceRef));
}

/**
 * Lists the stable references a Director redirect may cite for one actor.
 *
 * Redirect constraints are deliberately bounded by the same participant
 * perception that is sent to the actor. This prevents an opaque, syntactically
 * valid id from being treated as evidence and keeps private knowledge owned by
 * another participant outside the redirect intervention and its constraint
 * records. The referee still receives its separately filtered private context.
 */
export function listPlayRedirectConstraintRefs(
  perceptionValue: CharacterPerceptionPackage,
): string[] {
  const perception = normalizeCharacterPerceptionPackage(perceptionValue);
  const refs = [
    ...perception.initialKnowledgeEvidence.map((evidence) => evidence.id),
    ...perception.grantedKnowledgeEvidence.map((evidence) => evidence.id),
    ...perception.grantedKnowledgeEvidence.flatMap((evidence) => evidence.factRefs),
    ...perception.visibleEventRefs,
    ...perception.observedNarrativeBlockRefs,
  ];
  return [...new Set(refs)];
}

export function assertNarrativeBlocksWithinPerception(
  blocksValue: readonly NarrativeBlock[],
  perception: CharacterPerceptionPackage,
): NarrativeBlock[] {
  const allowedEvidenceRefs = new Set(
    [
      ...perception.initialKnowledgeEvidence.map((evidence) => evidence.id),
      ...perception.grantedKnowledgeEvidence.map((evidence) => evidence.id),
      ...perception.grantedKnowledgeEvidence.flatMap((evidence) => evidence.factRefs),
    ],
  );
  const allowedEventRefs = new Set(perception.visibleEventRefs);
  const blocks = blocksValue.map(normalizeNarrativeBlock);
  assertUnique(blocks.map((block) => block.id), 'NarrativeBlock id');
  for (const block of blocks) {
    if (
      (block.kind === 'characterSpeech' || block.kind === 'characterAction') &&
      block.speakerRef !== perception.participantRef
    ) {
      throw new Error(
        `Play NarrativeBlock speaker is outside the participant perception: ${block.id}.`,
      );
    }
    const forbiddenSourceRef = block.sourceRefs.find((sourceRef) =>
      !allowedEvidenceRefs.has(sourceRef));
    if (forbiddenSourceRef) {
      throw new Error(
        `Play NarrativeBlock references forbidden knowledge evidence: ${forbiddenSourceRef}.`,
      );
    }
    const forbiddenEventRef = block.eventRefs.find((eventRef) =>
      !allowedEventRefs.has(eventRef));
    if (forbiddenEventRef) {
      throw new Error(
        `Play NarrativeBlock references an unavailable event: ${forbiddenEventRef}.`,
      );
    }
  }
  return blocks;
}

export function projectSelectedPlayRehearsalEvidence(
  artifacts: readonly PlayTurnArtifact[],
  selectedTurnIds: readonly string[],
  scenes: readonly PlayCommittedSceneEvidence[],
): PlayRehearsalTurnEvidence[] {
  const evidenceById = new Map(
    scenes.flatMap((scene) => scene.turns).map((turn) => [turn.id, turn]),
  );
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return selectedTurnIds.flatMap((artifactId) => {
    const artifact = artifactsById.get(artifactId);
    if (!artifact) {
      throw new Error(`Play rehearsal projection references missing artifact: ${artifactId}.`);
    }
    return (artifact.rehearsalEvidenceRefs ?? []).map((evidenceRef) => {
      const evidence = evidenceById.get(evidenceRef);
      if (!evidence) {
        throw new Error(`Play rehearsal projection references missing evidence: ${evidenceRef}.`);
      }
      return structuredClone(evidence);
    });
  });
}

export function assertSafePlayRehearsalId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.length > 180
  ) {
    throw new Error(`Invalid Play rehearsal ${label}.`);
  }
  return value;
}

function normalizePlayRehearsalParticipant(value: unknown): PlayRehearsalParticipant {
  const record = requireRecord(value, 'Play rehearsal participant');
  assertOnlyKnownFields(record, [
    'participantRef',
    'canonicalCharacterRef',
    'displayName',
    'position',
    'emotion',
    'currentGoal',
    'initialKnowledgeEvidenceRefs',
  ], 'Play rehearsal participant');
  const canonicalCharacterRef = record.canonicalCharacterRef === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.canonicalCharacterRef, 'canonicalCharacterRef');
  const position = normalizeOptionalText(record.position, 'participant position');
  const emotion = normalizeOptionalText(record.emotion, 'participant emotion');
  const currentGoal = normalizeOptionalText(record.currentGoal, 'participant currentGoal');
  return {
    participantRef: assertSafePlayRehearsalId(record.participantRef, 'participantRef'),
    ...(canonicalCharacterRef ? { canonicalCharacterRef } : {}),
    displayName: normalizeText(record.displayName, 'participant displayName', MAX_SHORT_TEXT),
    ...(position ? { position } : {}),
    ...(emotion ? { emotion } : {}),
    ...(currentGoal ? { currentGoal } : {}),
    initialKnowledgeEvidenceRefs: normalizeSafeIdList(
      record.initialKnowledgeEvidenceRefs,
      'participant initialKnowledgeEvidenceRefs',
      MAX_REHEARSAL_KNOWLEDGE_ITEMS,
    ),
  };
}

function normalizePlaySceneKnowledgeEvidence(value: unknown): PlaySceneKnowledgeEvidence {
  const record = requireRecord(value, 'Play scene knowledge evidence');
  assertOnlyKnownFields(record, [
    'id',
    'participantRef',
    'visibility',
    'fact',
    'provenance',
  ], 'Play scene knowledge evidence');
  const provenance = requireRecord(record.provenance, 'Play knowledge provenance');
  let normalizedProvenance: PlaySceneKnowledgeEvidence['provenance'];
  if (provenance.kind === 'sourceBacked') {
    assertOnlyKnownFields(provenance, [
      'kind',
      'sourceId',
      'sourcePath',
      'contentHash',
      'sourceFactRef',
    ], 'Play source-backed knowledge provenance');
    const sourceFactRef = provenance.sourceFactRef === undefined
      ? undefined
      : assertSafePlayRehearsalId(provenance.sourceFactRef, 'sourceFactRef');
    normalizedProvenance = {
      kind: 'sourceBacked',
      sourceId: assertSafePlayRehearsalId(provenance.sourceId, 'sourceId'),
      sourcePath: normalizeSafeRelativeSourcePath(provenance.sourcePath),
      contentHash: normalizeText(provenance.contentHash, 'contentHash', 256),
      ...(sourceFactRef ? { sourceFactRef } : {}),
    };
  } else if (provenance.kind === 'authorProvided') {
    assertOnlyKnownFields(
      provenance,
      ['kind', 'providedAt'],
      'Play author-provided knowledge provenance',
    );
    normalizedProvenance = {
      kind: 'authorProvided',
      providedAt: normalizeText(provenance.providedAt, 'providedAt', 128),
    };
  } else {
    throw new Error('Play knowledge evidence has invalid provenance.');
  }
  return {
    id: assertSafePlayRehearsalId(record.id, 'knowledge evidence id'),
    participantRef: assertSafePlayRehearsalId(
      record.participantRef,
      'knowledge participantRef',
    ),
    visibility: normalizeVisibility(record.visibility),
    fact: normalizeText(record.fact, 'knowledge fact', MAX_NARRATIVE_TEXT),
    provenance: normalizedProvenance,
  };
}

function normalizeParticipantKnowledgeEvidenceList(
  value: unknown,
  expectedParticipantRef: string,
): PlayParticipantKnowledgeEvidence[] {
  const evidence = normalizeBoundedArray(
    value ?? [],
    MAX_REHEARSAL_KNOWLEDGE_ITEMS,
    'Play perception granted knowledge evidence',
  ).map((item): PlayParticipantKnowledgeEvidence => {
    const record = requireRecord(item, 'Play participant knowledge evidence');
    assertOnlyKnownFields(record, [
      'id',
      'participantRef',
      'interventionRef',
      'effectiveFromStepRef',
      'factRefs',
      'fact',
      'visibility',
      'provenance',
    ], 'Play participant knowledge evidence');
    const participantRef = assertSafePlayRehearsalId(
      record.participantRef,
      'participant knowledge participantRef',
    );
    if (participantRef !== expectedParticipantRef) {
      throw new Error('Play participant knowledge evidence belongs to another participant.');
    }
    const provenance = requireRecord(
      record.provenance,
      'Play participant knowledge provenance',
    );
    let normalizedProvenance: PlayParticipantKnowledgeEvidence['provenance'];
    if (provenance.kind === 'existingFact') {
      assertOnlyKnownFields(
        provenance,
        ['kind'],
        'Play existing-fact knowledge provenance',
      );
      normalizedProvenance = { kind: 'existingFact' };
    } else if (provenance.kind === 'authorProvidedPlayFact') {
      assertOnlyKnownFields(
        provenance,
        ['kind', 'providedAt'],
        'Play author-provided participant knowledge provenance',
      );
      normalizedProvenance = {
        kind: 'authorProvidedPlayFact',
        providedAt: normalizeText(provenance.providedAt, 'providedAt', 128),
      };
    } else {
      throw new Error('Play participant knowledge evidence has invalid provenance.');
    }
    return {
      id: assertSafePlayRehearsalId(record.id, 'participant knowledge evidence id'),
      participantRef,
      interventionRef: assertSafePlayRehearsalId(
        record.interventionRef,
        'participant knowledge interventionRef',
      ),
      effectiveFromStepRef: assertSafePlayRehearsalId(
        record.effectiveFromStepRef,
        'participant knowledge effectiveFromStepRef',
      ),
      factRefs: normalizeSafeIdList(
        record.factRefs,
        'participant knowledge factRefs',
        64,
      ),
      fact: normalizeText(record.fact, 'participant knowledge fact', MAX_NARRATIVE_TEXT),
      visibility: normalizeVisibility(record.visibility),
      provenance: normalizedProvenance,
    };
  });
  assertUnique(evidence.map((item) => item.id), 'participant knowledge evidence id');
  return evidence;
}

function normalizePlayRehearsalTurnEvidence(value: unknown): PlayRehearsalTurnEvidence {
  const record = requireRecord(value, 'Play rehearsal turn evidence');
  assertOnlyKnownFields(record, [
    'id',
    'owningTurnArtifactId',
    'attemptId',
    'selectedStepRefs',
    'steps',
    'hostNarrativeBlocks',
    'narrativeBlocks',
    'finalizeReceipt',
    'committedAt',
    'canonical',
  ], 'Play rehearsal turn evidence');
  if (record.canonical !== false) {
    throw new Error('Play rehearsal evidence must remain non-canonical.');
  }
  const steps = normalizeBoundedArray(
    record.steps,
    MAX_REHEARSAL_STEPS,
    'Play committed rehearsal steps',
  ).map(normalizeCommittedStepEvidence);
  const selectedStepRefs = normalizeSafeIdList(
    record.selectedStepRefs,
    'rehearsal selectedStepRefs',
    MAX_REHEARSAL_STEPS,
  );
  if (
    steps.length !== selectedStepRefs.length ||
    steps.some((step, index) => step.stepRef !== selectedStepRefs[index])
  ) {
    throw new Error('Play rehearsal evidence steps must match selectedStepRefs.');
  }
  const hostNarrativeBlocks = normalizeBoundedArray(
    record.hostNarrativeBlocks,
    MAX_NARRATIVE_BLOCKS,
    'Play host NarrativeBlocks',
  ).map(normalizeNarrativeBlock);
  assertUnique(hostNarrativeBlocks.map((block) => block.id), 'host NarrativeBlock id');
  const narrativeBlocks = normalizeBoundedArray(
    record.narrativeBlocks,
    MAX_NARRATIVE_BLOCKS,
    'Play committed NarrativeBlocks',
  ).map(normalizeNarrativeBlock);
  assertUnique(narrativeBlocks.map((block) => block.id), 'committed NarrativeBlock id');
  const stepBlocks = [
    ...steps.flatMap((step) => step.narrativeBlocks),
    ...hostNarrativeBlocks,
  ];
  if (
    narrativeBlocks.length !== stepBlocks.length ||
    narrativeBlocks.some((block, index) =>
      !isDeepStrictEqual(block, stepBlocks[index]))
  ) {
    throw new Error(
      'Play rehearsal evidence NarrativeBlocks must match its selected steps and host blocks.',
    );
  }
  const finalizeReceipt = requireRecord(
    record.finalizeReceipt,
    'Play rehearsal finalize receipt',
  );
  assertOnlyKnownFields(finalizeReceipt, [
    'idempotencyKey',
    'requestFingerprint',
    'attemptRevision',
  ], 'Play rehearsal finalize receipt');
  return {
    id: assertSafePlayRehearsalId(record.id, 'turn evidence id'),
    owningTurnArtifactId: assertSafePlayRehearsalId(
      record.owningTurnArtifactId,
      'owningTurnArtifactId',
    ),
    attemptId: assertSafePlayRehearsalId(record.attemptId, 'attemptId'),
    selectedStepRefs,
    steps,
    hostNarrativeBlocks,
    narrativeBlocks,
    finalizeReceipt: {
      idempotencyKey: assertSafePlayRehearsalId(
        finalizeReceipt.idempotencyKey,
        'finalize idempotencyKey',
      ),
      requestFingerprint: normalizeText(
        finalizeReceipt.requestFingerprint,
        'finalize requestFingerprint',
        512,
      ),
      attemptRevision: normalizeNonNegativeInteger(
        finalizeReceipt.attemptRevision,
        'finalize attemptRevision',
      ),
    },
    committedAt: normalizeText(record.committedAt, 'committedAt', 128),
    canonical: false,
  };
}

function normalizeCommittedStepEvidence(value: unknown): PlayCommittedCharacterStepEvidence {
  const record = requireRecord(value, 'Play committed character step evidence');
  assertOnlyKnownFields(record, [
    'stepRef',
    'participantRef',
    'perceptionRef',
    'intentSummary',
    'narrativeBlocks',
    'settlementEventRefs',
    'decisionBasisRefs',
    'variantOf',
  ], 'Play committed character step evidence');
  const variantOf = record.variantOf === undefined
    ? undefined
    : assertSafePlayRehearsalId(record.variantOf, 'step variantOf');
  return {
    stepRef: assertSafePlayRehearsalId(record.stepRef, 'stepRef'),
    participantRef: assertSafePlayRehearsalId(record.participantRef, 'step participantRef'),
    perceptionRef: assertSafePlayRehearsalId(record.perceptionRef, 'step perceptionRef'),
    intentSummary: normalizeText(record.intentSummary, 'step intentSummary', MAX_SHORT_TEXT),
    narrativeBlocks: normalizeBoundedArray(
      record.narrativeBlocks,
      MAX_NARRATIVE_BLOCKS,
      'step NarrativeBlocks',
    ).map(normalizeNarrativeBlock),
    settlementEventRefs: normalizeSafeIdList(
      record.settlementEventRefs,
      'step settlementEventRefs',
      64,
    ),
    decisionBasisRefs: normalizeSafeIdList(
      record.decisionBasisRefs,
      'step decisionBasisRefs',
      MAX_REHEARSAL_KNOWLEDGE_ITEMS,
    ),
    ...(variantOf ? { variantOf } : {}),
  };
}

function normalizePlaySceneValue(value: unknown, label: string): PlaySceneValue {
  const record = requireRecord(value, `Play scene ${label}`);
  assertOnlyKnownFields(record, ['value', 'provenance'], `Play scene ${label}`);
  const provenance = requireRecord(record.provenance, `Play scene ${label} provenance`);
  if (provenance.kind === 'sourceBacked') {
    assertOnlyKnownFields(
      provenance,
      ['kind', 'sourceRefs'],
      `Play scene ${label} provenance`,
    );
    return {
      value: normalizeText(record.value, `scene ${label}`, MAX_SHORT_TEXT),
      provenance: {
        kind: 'sourceBacked',
        sourceRefs: normalizeSafeIdList(
          provenance.sourceRefs,
          `scene ${label} sourceRefs`,
          32,
        ),
      },
    };
  }
  if (provenance.kind === 'authorProvided') {
    assertOnlyKnownFields(
      provenance,
      ['kind', 'providedAt'],
      `Play scene ${label} provenance`,
    );
    return {
      value: normalizeText(record.value, `scene ${label}`, MAX_SHORT_TEXT),
      provenance: {
        kind: 'authorProvided',
        providedAt: normalizeText(provenance.providedAt, 'providedAt', 128),
      },
    };
  }
  throw new Error(`Play scene ${label} has invalid provenance.`);
}

function normalizeClockProvenance(
  value: unknown,
): PlaySceneContract['clockProvenance'] {
  const record = requireRecord(value, 'Play Scene Contract clock provenance');
  if (record.kind === 'sessionRevision') {
    assertOnlyKnownFields(record, [
      'kind',
      'sessionId',
      'revision',
      'owningTurnRef',
    ], 'Play Scene Contract clock provenance');
    const owningTurnRef = record.owningTurnRef === undefined
      ? undefined
      : assertSafePlayRehearsalId(record.owningTurnRef, 'clock owningTurnRef');
    return {
      kind: 'sessionRevision',
      sessionId: assertSafePlayRehearsalId(record.sessionId, 'clock sessionId'),
      revision: normalizeNonNegativeInteger(record.revision, 'clock revision'),
      ...(owningTurnRef ? { owningTurnRef } : {}),
    };
  }
  if (record.kind === 'newSessionInitial') {
    assertOnlyKnownFields(record, [
      'kind',
      'sourceRefs',
      'authorProvidedAt',
    ], 'Play Scene Contract clock provenance');
    const authorProvidedAt = normalizeOptionalText(
      record.authorProvidedAt,
      'clock authorProvidedAt',
    );
    return {
      kind: 'newSessionInitial',
      sourceRefs: normalizeSafeIdList(record.sourceRefs, 'clock sourceRefs', 32),
      ...(authorProvidedAt ? { authorProvidedAt } : {}),
    };
  }
  throw new Error('Play Scene Contract has invalid clock provenance.');
}

function normalizeWorldClock(value: unknown): PlayWorldClock {
  const record = requireRecord(value, 'Play Scene Contract worldClock');
  assertOnlyKnownFields(record, ['turn', 'revision', 'anchor', 'elapsed'], 'worldClock');
  const anchor = normalizeOptionalText(record.anchor, 'worldClock anchor');
  const elapsed = normalizeOptionalText(record.elapsed, 'worldClock elapsed');
  return {
    turn: normalizeNonNegativeInteger(record.turn, 'worldClock turn'),
    revision: normalizeNonNegativeInteger(record.revision, 'worldClock revision'),
    ...(anchor ? { anchor } : {}),
    ...(elapsed ? { elapsed } : {}),
  };
}

function normalizeVisibility(value: unknown): PlayEventVisibility {
  if (
    value !== 'playerVisible' &&
    value !== 'rumor' &&
    value !== 'playerUnknown'
  ) {
    throw new Error(`Invalid Play rehearsal visibility: ${String(value)}.`);
  }
  return value;
}

function normalizeSafeRelativeSourcePath(value: unknown): string {
  const path = normalizeText(value, 'sourcePath', 1_000);
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error('Play knowledge sourcePath must be a safe relative path.');
  }
  return path;
}

function normalizeSafeIdList(value: unknown, label: string, maximum: number): string[] {
  const values = normalizeBoundedArray(value, maximum, label).map((item) =>
    assertSafePlayRehearsalId(item, label));
  assertUnique(values, label);
  return values;
}

function normalizeBoundedArray(
  value: unknown,
  maximum: number,
  label: string,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array of at most ${maximum} items.`);
  }
  return value;
}

function normalizeOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return normalizeText(value, label, MAX_SHORT_TEXT);
}

function normalizeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Play rehearsal ${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Play rehearsal ${label} must contain 1-${maximum} characters.`);
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Play rehearsal ${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Play rehearsal contains duplicate ${label}.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  knownFields: readonly string[],
  label: string,
): void {
  const known = new Set(knownFields);
  const unknown = Object.keys(value).filter((field) => !known.has(field));
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  }
}
