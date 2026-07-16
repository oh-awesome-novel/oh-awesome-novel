import type {
  PlayAgenda,
  PlayEventVisibility,
  PlayPressure,
  PlayScheduledEvent,
  PlayTranscriptTurn,
  PlayTurnArtifact,
  PlayWorldEvent,
} from './useWorkspaceApi';

const PLAY_WORLD_MOMENTUM_STATE_KEY = 'worldMomentum';
export const PLAY_KNOWLEDGE_STATE_KEY = 'playKnowledge';
const MAX_PRESENTATION_TEXT = 160;

export type PlayEventCauseLabelKind =
  | 'action'
  | 'trigger'
  | 'sourceEvent'
  | 'pressure'
  | 'agenda'
  | 'related';

export interface PlayEventCauseLabelView {
  kind: PlayEventCauseLabelKind;
  label: string;
  ref: string;
}

export interface PlayEventStateImpactView {
  path: string;
  value: string;
}

export interface PlayEventTechnicalRefView {
  label: string;
  value: string;
}

export interface PlayEventRevealAuthorView {
  recordId: string;
  subjectEventId: string;
  subjectTitle: string;
  subjectSummary: string;
  subjectWorldTimeLabel: string;
  subjectReason?: string;
  revealedByEventId: string;
  revealedByTitle: string;
  previousPlayerProjection: 'playerUnknown' | 'rumor';
  playerProjection: 'rumor' | 'playerVisible';
  knownByParticipantRefs: string[];
}

export interface PlayEventRevealChainView {
  statusLabel: string;
  explanation: string;
  author?: PlayEventRevealAuthorView;
}

export interface PlayEventCardView {
  id: string;
  title: string;
  impact: string;
  kindLabel: string;
  originLabel: string;
  visibility: PlayEventVisibility;
  worldTimeLabel: string;
  causeLabels: PlayEventCauseLabelView[];
  stateImpacts: PlayEventStateImpactView[];
  technicalRefs: PlayEventTechnicalRefView[];
  projection?: 'player' | 'author';
  revealChain?: PlayEventRevealChainView;
  authorReason?: string;
}

export interface BuildPlayEventCardViewsInput {
  events: readonly PlayWorldEvent[];
  artifacts: readonly PlayTurnArtifact[];
  showSpoilers: boolean;
  /** @deprecated Historical cards deliberately ignore current-head schedules. */
  scheduledEvents?: readonly PlayScheduledEvent[];
  /** @deprecated Historical cards deliberately ignore current-head momentum. */
  pressures?: readonly PlayPressure[];
  /** @deprecated Historical cards deliberately ignore current-head momentum. */
  agendas?: readonly PlayAgenda[];
  /** @deprecated Historical cards require the owning artifact visibility snapshot. */
  stateVisibility?: Readonly<Record<string, PlayEventVisibility>>;
}

/**
 * Builds the user-facing event feed from facts already projected onto the
 * selected branch. Hidden references are resolved only when Author view is on;
 * an opaque id is never used as a fallback label because ids may themselves be
 * descriptive.
 */
export function buildPlayEventCardViews(
  input: BuildPlayEventCardViewsInput,
): PlayEventCardView[] {
  const eventsById = new Map(input.events.map((event) => [event.id, event]));
  const artifactsById = new Map(
    input.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const artifactsByEventId = indexArtifactsByEventId(input.artifacts);
  const messagesById = indexMessages(input.artifacts);

  return input.events
    .filter((event) => input.showSpoilers || event.visibility !== 'playerUnknown')
    .map((event) => {
      const artifact = artifactsByEventId.get(event.id);
      const scheduledEvent = resolveScheduledEventEvidence(event, artifact);
      const momentum = readArtifactMomentumEvidence(artifact);
      const causeLabels = buildCauseLabels({
        event,
        eventsById,
        messagesById,
        scheduledEvent,
        pressuresById: new Map(
          momentum.pressures.map((pressure) => [pressure.id, pressure]),
        ),
        agendasById: new Map(
          momentum.agendas.map((agenda) => [agenda.id, agenda]),
        ),
        showSpoilers: input.showSpoilers,
      });
      const revealChain = buildRevealChain({
        event,
        artifact,
        eventsById,
        artifactsById,
        artifactsByEventId,
        showSpoilers: input.showSpoilers,
      });

      return {
        id: event.id,
        title: event.title,
        impact: event.summary,
        kindLabel: humanizeIdentifier(event.kind),
        originLabel: `Origin · ${humanizeIdentifier(event.origin)}`,
        visibility: event.visibility,
        worldTimeLabel: formatWorldTime(event),
        causeLabels,
        stateImpacts: buildStateImpacts(
          event,
          artifact,
          eventsById,
          momentum,
          input.showSpoilers,
        ),
        technicalRefs: input.showSpoilers
          ? buildTechnicalRefs(event, artifact, causeLabels, scheduledEvent)
          : [],
        projection: input.showSpoilers ? 'author' : 'player',
        ...(revealChain ? { revealChain } : {}),
        ...(input.showSpoilers && event.cause.reason.trim()
          ? { authorReason: event.cause.reason.trim() }
          : {}),
      };
    });
}

interface BuildRevealChainInput {
  event: PlayWorldEvent;
  artifact?: PlayTurnArtifact;
  eventsById: ReadonlyMap<string, PlayWorldEvent>;
  artifactsById: ReadonlyMap<string, PlayTurnArtifact>;
  artifactsByEventId: ReadonlyMap<string, PlayTurnArtifact>;
  showSpoilers: boolean;
}

interface PlayEventRevealRecordEvidence {
  id: string;
  kind: 'eventReveal';
  subjectEventId: string;
  previousPlayerProjection: 'playerUnknown' | 'rumor';
  playerProjection: 'rumor' | 'playerVisible';
  knownByParticipantRefs: string[];
  revealedAtTurnId: string;
  revealedByEventId: string;
  canonical: false;
}

function buildRevealChain(
  input: BuildRevealChainInput,
): PlayEventRevealChainView | undefined {
  const artifact = input.artifact;
  if (
    !artifact?.playLocalStateSnapshot ||
    !Object.prototype.hasOwnProperty.call(
      artifact.stateDelta,
      PLAY_KNOWLEDGE_STATE_KEY,
    ) ||
    artifact.playLocalStateVisibilitySnapshot?.[PLAY_KNOWLEDGE_STATE_KEY] !==
      'playerUnknown' ||
    input.event.kind !== 'informationSpread'
  ) {
    return undefined;
  }

  const records = readPlayKnowledgeRecords(
    artifact.playLocalStateSnapshot[PLAY_KNOWLEDGE_STATE_KEY],
  );
  const deltaRecords = readPlayKnowledgeRecords(
    artifact.stateDelta[PLAY_KNOWLEDGE_STATE_KEY],
  );
  if (!records || !deltaRecords || !areRevealRecordListsEqual(records, deltaRecords)) {
    return undefined;
  }
  const matches = records.filter((record) =>
    record.revealedByEventId === input.event.id,
  );
  if (matches.length !== 1) return undefined;

  const record = matches[0]!;
  const subject = input.eventsById.get(record.subjectEventId);
  const subjectArtifact = input.artifactsByEventId.get(record.subjectEventId);
  if (
    !subject ||
    subject.visibility !== 'playerUnknown' ||
    !subjectArtifact ||
    !isStrictArtifactAncestor(
      subjectArtifact,
      artifact,
      input.artifactsById,
    ) ||
    record.revealedAtTurnId !== input.event.turnId ||
    record.playerProjection !== input.event.visibility ||
    !input.event.cause.sourceEventIds?.includes(subject.id) ||
    !isValidRevealTransition(record)
  ) {
    return undefined;
  }

  const chain: PlayEventRevealChainView = {
    statusLabel: record.playerProjection === 'rumor'
      ? 'Rumor surfaced'
      : 'Information confirmed',
    explanation: record.playerProjection === 'rumor'
      ? 'This event carries a rumor about an earlier unseen development.'
      : 'This event confirms information about an earlier unseen development.',
  };
  if (!input.showSpoilers) return chain;

  return {
    ...chain,
    author: {
      recordId: record.id,
      subjectEventId: subject.id,
      subjectTitle: subject.title,
      subjectSummary: subject.summary,
      subjectWorldTimeLabel: formatWorldTime(subject),
      ...(subject.cause.reason.trim()
        ? { subjectReason: subject.cause.reason.trim() }
        : {}),
      revealedByEventId: input.event.id,
      revealedByTitle: input.event.title,
      previousPlayerProjection: record.previousPlayerProjection,
      playerProjection: record.playerProjection,
      knownByParticipantRefs: [...record.knownByParticipantRefs],
    },
  };
}

function isStrictArtifactAncestor(
  candidate: Readonly<PlayTurnArtifact>,
  artifact: Readonly<PlayTurnArtifact>,
  artifactsById: ReadonlyMap<string, PlayTurnArtifact>,
): boolean {
  const visited = new Set<string>([artifact.id]);
  let parentId = artifact.parentTurnId;
  while (parentId) {
    if (visited.has(parentId)) return false;
    visited.add(parentId);

    const parent = artifactsById.get(parentId);
    if (!parent) return false;
    if (parent.id === candidate.id) {
      return parent.revision < artifact.revision;
    }
    parentId = parent.parentTurnId;
  }
  return false;
}

function readPlayKnowledgeRecords(
  value: unknown,
): PlayEventRevealRecordEvidence[] | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['schemaVersion', 'records']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records) ||
    !value.records.every(isPlayEventRevealRecordEvidence)
  ) {
    return undefined;
  }
  return value.records;
}

function isPlayEventRevealRecordEvidence(
  value: unknown,
): value is PlayEventRevealRecordEvidence {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id',
    'kind',
    'subjectEventId',
    'previousPlayerProjection',
    'playerProjection',
    'knownByParticipantRefs',
    'revealedAtTurnId',
    'revealedByEventId',
    'canonical',
  ])) {
    return false;
  }
  return isNonEmptyString(value.id) &&
    value.kind === 'eventReveal' &&
    isNonEmptyString(value.subjectEventId) &&
    (value.previousPlayerProjection === 'playerUnknown' ||
      value.previousPlayerProjection === 'rumor') &&
    (value.playerProjection === 'rumor' || value.playerProjection === 'playerVisible') &&
    Array.isArray(value.knownByParticipantRefs) &&
    value.knownByParticipantRefs.length === 0 &&
    isNonEmptyString(value.revealedAtTurnId) &&
    isNonEmptyString(value.revealedByEventId) &&
    value.canonical === false;
}

function isValidRevealTransition(record: PlayEventRevealRecordEvidence): boolean {
  return record.previousPlayerProjection === 'playerUnknown' ||
    record.playerProjection === 'playerVisible';
}

function areRevealRecordListsEqual(
  left: readonly PlayEventRevealRecordEvidence[],
  right: readonly PlayEventRevealRecordEvidence[],
): boolean {
  return left.length === right.length && left.every((record, index) => {
    const candidate = right[index];
    return candidate !== undefined &&
      record.id === candidate.id &&
      record.kind === candidate.kind &&
      record.subjectEventId === candidate.subjectEventId &&
      record.previousPlayerProjection === candidate.previousPlayerProjection &&
      record.playerProjection === candidate.playerProjection &&
      record.revealedAtTurnId === candidate.revealedAtTurnId &&
      record.revealedByEventId === candidate.revealedByEventId &&
      record.canonical === candidate.canonical &&
      record.knownByParticipantRefs.length === candidate.knownByParticipantRefs.length &&
      record.knownByParticipantRefs.every((value, participantIndex) =>
        value === candidate.knownByParticipantRefs[participantIndex]);
  });
}

interface BuildCauseLabelsInput {
  event: PlayWorldEvent;
  eventsById: ReadonlyMap<string, PlayWorldEvent>;
  messagesById: ReadonlyMap<string, PlayTranscriptTurn>;
  scheduledEvent?: PlayScheduledEvent;
  pressuresById: ReadonlyMap<string, PlayPressure>;
  agendasById: ReadonlyMap<string, PlayAgenda>;
  showSpoilers: boolean;
}

function buildCauseLabels(input: BuildCauseLabelsInput): PlayEventCauseLabelView[] {
  const labels: PlayEventCauseLabelView[] = [];

  for (const messageId of input.event.cause.sourceTurnIds ?? []) {
    const message = input.messagesById.get(messageId);
    if (!message || !isPlayerMessage(message)) continue;
    const actionKind = message.actionKind
      ? humanizeIdentifier(message.actionKind)
      : 'Action';
    labels.push({
      kind: 'action',
      label: `${actionKind} · ${truncateText(message.content)}`,
      ref: messageId,
    });
  }

  const scheduledEvent = input.scheduledEvent;
  if (scheduledEvent && isVisible(scheduledEvent.template.visibility, input.showSpoilers)) {
    labels.push({
      kind: 'trigger',
      label: `Scheduled · ${scheduledEvent.label} (${formatTrigger(scheduledEvent)})`,
      ref: scheduledEvent.id,
    });
  }

  for (const eventId of input.event.cause.sourceEventIds ?? []) {
    const sourceEvent = input.eventsById.get(eventId);
    if (!sourceEvent || !isVisible(sourceEvent.visibility, input.showSpoilers)) continue;
    labels.push({
      kind: 'sourceEvent',
      label: `Earlier event · ${sourceEvent.title}`,
      ref: sourceEvent.id,
    });
  }

  const pressureId = input.event.cause.pressureId;
  const pressure = pressureId ? input.pressuresById.get(pressureId) : undefined;
  if (
    pressure &&
    pressure.causeRefs.includes(input.event.id) &&
    isVisible(pressure.visibility, input.showSpoilers)
  ) {
    labels.push({
      kind: 'pressure',
      label: `Pressure · ${pressure.label}`,
      ref: pressure.id,
    });
  }

  const agendaId = input.event.cause.agendaId;
  const agenda = agendaId ? input.agendasById.get(agendaId) : undefined;
  if (
    agenda &&
    agenda.updatedAtTurnId === input.event.turnId &&
    isVisible(agenda.visibility, input.showSpoilers)
  ) {
    labels.push({
      kind: 'agenda',
      label: `Agenda · ${agenda.ownerEntityId}: ${agenda.nextMove ?? agenda.goal}`,
      ref: agenda.id,
    });
  }

  return dedupeCauseLabels(labels);
}

function buildStateImpacts(
  event: PlayWorldEvent,
  artifact: PlayTurnArtifact | undefined,
  eventsById: ReadonlyMap<string, PlayWorldEvent>,
  momentum: Readonly<PlayWorldMomentumEvidence>,
  showSpoilers: boolean,
): PlayEventStateImpactView[] {
  if (!artifact?.playLocalStateVisibilitySnapshot) return [];

  const artifactContainsHiddenEvent = artifact.eventIds.some((eventId) =>
    eventsById.get(eventId)?.visibility === 'playerUnknown');
  if (artifactContainsHiddenEvent && !showSpoilers) {
    return [];
  }

  const impacts: PlayEventStateImpactView[] = [];
  for (const [stateKey, stateValue] of Object.entries(artifact.stateDelta)) {
    if (stateKey === PLAY_KNOWLEDGE_STATE_KEY) continue;
    if (stateKey === PLAY_WORLD_MOMENTUM_STATE_KEY) {
      if (hasSafeMomentumImpactEvidence(event, momentum, showSpoilers)) {
        impacts.push({
          path: PLAY_WORLD_MOMENTUM_STATE_KEY,
          value: 'Pressure / agenda state updated',
        });
      }
      continue;
    }

    const stateVisibility = artifact.playLocalStateVisibilitySnapshot[stateKey];
    if (!isPlayVisibility(stateVisibility)) {
      continue;
    }
    if (!showSpoilers && stateVisibility !== 'playerVisible') {
      continue;
    }
    for (const [path, value] of flattenStateValue(stateKey, stateValue)) {
      if (
        !showSpoilers &&
        artifact.playLocalStateVisibilitySnapshot[path] !== undefined &&
        artifact.playLocalStateVisibilitySnapshot[path] !== 'playerVisible'
      ) {
        continue;
      }
      impacts.push({ path, value: formatStateValue(value) });
    }
  }
  return impacts;
}

function buildTechnicalRefs(
  event: PlayWorldEvent,
  artifact: PlayTurnArtifact | undefined,
  causeLabels: readonly PlayEventCauseLabelView[],
  scheduledEvent: PlayScheduledEvent | undefined,
): PlayEventTechnicalRefView[] {
  const refs: PlayEventTechnicalRefView[] = [
    { label: 'Event', value: event.id },
    { label: 'Turn message', value: event.turnId },
  ];
  if (artifact) {
    refs.push(
      { label: 'Artifact', value: artifact.id },
      { label: 'Artifact revision', value: String(artifact.revision) },
    );
  }
  for (const cause of causeLabels) {
    refs.push({ label: `${causeLabelKind(cause.kind)} ref`, value: cause.ref });
  }
  if (scheduledEvent?.trigger.type === 'flagEquals') {
    refs.push({
      label: 'Trigger condition',
      value: `${scheduledEvent.trigger.path} = ${String(scheduledEvent.trigger.value)}`,
    });
  }
  return dedupeTechnicalRefs(refs);
}

interface PlayWorldMomentumEvidence {
  pressures: PlayPressure[];
  agendas: PlayAgenda[];
}

function readArtifactMomentumEvidence(
  artifact: PlayTurnArtifact | undefined,
): PlayWorldMomentumEvidence {
  const value = artifact?.playLocalStateSnapshot?.[PLAY_WORLD_MOMENTUM_STATE_KEY];
  if (!isRecord(value) || !Array.isArray(value.pressures) || !Array.isArray(value.agendas)) {
    return { pressures: [], agendas: [] };
  }
  if (!value.pressures.every(isPlayPressure) || !value.agendas.every(isPlayAgenda)) {
    return { pressures: [], agendas: [] };
  }
  return { pressures: value.pressures, agendas: value.agendas };
}

function resolveScheduledEventEvidence(
  event: PlayWorldEvent,
  artifact: PlayTurnArtifact | undefined,
): PlayScheduledEvent | undefined {
  const triggerId = event.cause.triggerId;
  if (!triggerId || !artifact?.dueScheduledEventIds.includes(triggerId)) {
    return undefined;
  }
  const scheduledEvent = artifact.scheduledEventSnapshots.find(
    (candidate) => candidate.id === triggerId,
  );
  if (
    scheduledEvent?.status !== 'occurred' ||
    !scheduledEvent.occurredEventIds?.includes(event.id)
  ) {
    return undefined;
  }
  return scheduledEvent;
}

function hasSafeMomentumImpactEvidence(
  event: PlayWorldEvent,
  momentum: Readonly<PlayWorldMomentumEvidence>,
  showSpoilers: boolean,
): boolean {
  if (!showSpoilers) {
    return false;
  }
  const pressure = event.cause.pressureId
    ? momentum.pressures.find((candidate) => candidate.id === event.cause.pressureId)
    : undefined;
  if (
    pressure?.causeRefs.includes(event.id) &&
    isVisible(pressure.visibility, showSpoilers)
  ) {
    return true;
  }

  const agenda = event.cause.agendaId
    ? momentum.agendas.find((candidate) => candidate.id === event.cause.agendaId)
    : undefined;
  return Boolean(
    agenda &&
    agenda.updatedAtTurnId === event.turnId &&
    isVisible(agenda.visibility, showSpoilers),
  );
}

function indexArtifactsByEventId(
  artifacts: readonly PlayTurnArtifact[],
): Map<string, PlayTurnArtifact> {
  const result = new Map<string, PlayTurnArtifact>();
  for (const artifact of artifacts) {
    for (const eventId of artifact.eventIds) {
      if (!result.has(eventId)) result.set(eventId, artifact);
    }
  }
  return result;
}

function indexMessages(
  artifacts: readonly PlayTurnArtifact[],
): Map<string, PlayTranscriptTurn> {
  const result = new Map<string, PlayTranscriptTurn>();
  for (const artifact of artifacts) {
    for (const message of artifact.messages) {
      if (message.id && !result.has(message.id)) {
        result.set(message.id, message);
      }
    }
  }
  return result;
}

function flattenStateValue(
  rootPath: string,
  rootValue: unknown,
): Array<[path: string, value: unknown]> {
  const result: Array<[path: string, value: unknown]> = [];
  const pending: Array<[path: string, value: unknown]> = [[rootPath, rootValue]];

  while (pending.length > 0) {
    const [path, value] = pending.pop()!;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        result.push([path, value]);
      } else {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          pending.push([`${path}.${index}`, value[index]]);
        }
      }
      continue;
    }
    if (isRecord(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        result.push([path, value]);
      } else {
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const [key, nestedValue] = entries[index]!;
          pending.push([`${path}.${key}`, nestedValue]);
        }
      }
      continue;
    }
    result.push([path, value]);
  }

  return result;
}

function formatWorldTime(event: PlayWorldEvent): string {
  const parts = [
    event.worldClock.anchor?.trim(),
    `Turn ${event.worldClock.turn}`,
    event.worldClock.elapsed ? `+ ${event.worldClock.elapsed}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return parts.join(' · ');
}

function formatTrigger(event: PlayScheduledEvent): string {
  switch (event.trigger.type) {
    case 'nextTurn': return 'next turn';
    case 'afterTurns':
      return `after ${event.trigger.turns} turn${event.trigger.turns === 1 ? '' : 's'}`;
    case 'flagEquals': return 'tracked world condition matched';
    case 'atWorldTime': return `at ${event.trigger.value}`;
    case 'manual': return 'manual';
  }
}

function formatStateValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return truncateText(String(value));
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? '[unavailable]' : truncateText(serialized);
  } catch {
    return '[unavailable]';
  }
}

function humanizeIdentifier(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim();
  return spaced
    ? `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`
    : value;
}

function truncateText(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length <= MAX_PRESENTATION_TEXT
    ? normalized
    : `${normalized.slice(0, MAX_PRESENTATION_TEXT - 1).trimEnd()}…`;
}

function isPlayerMessage(message: PlayTranscriptTurn): boolean {
  const speaker = message.speaker.trim().toLowerCase();
  return speaker === 'user' || speaker === 'player';
}

function isVisible(visibility: PlayEventVisibility, showSpoilers: boolean): boolean {
  return showSpoilers || visibility !== 'playerUnknown';
}

function isPlayPressure(value: unknown): value is PlayPressure {
  return isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.kind === 'string' &&
    ['deadline', 'pursuit', 'factionProject', 'environment', 'rumor', 'relationship']
      .includes(value.kind) &&
    isNonEmptyString(value.label) &&
    typeof value.status === 'string' &&
    ['latent', 'active', 'resolved'].includes(value.status) &&
    isOptionalFiniteNumber(value.level) &&
    isOptionalFiniteNumber(value.threshold) &&
    Array.isArray(value.causeRefs) &&
    value.causeRefs.every(isNonEmptyString) &&
    isOptionalNonEmptyString(value.nextConsequence) &&
    isPlayVisibility(value.visibility);
}

function isPlayAgenda(value: unknown): value is PlayAgenda {
  return isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.ownerEntityId) &&
    isNonEmptyString(value.goal) &&
    isOptionalNonEmptyString(value.nextMove) &&
    Array.isArray(value.blockers) &&
    value.blockers.every(isNonEmptyString) &&
    typeof value.status === 'string' &&
    ['active', 'blocked', 'completed', 'abandoned'].includes(value.status) &&
    isPlayVisibility(value.visibility) &&
    isNonEmptyString(value.updatedAtTurnId);
}

function isPlayVisibility(value: unknown): value is PlayEventVisibility {
  return value === 'playerVisible' || value === 'rumor' || value === 'playerUnknown';
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function dedupeCauseLabels(
  labels: readonly PlayEventCauseLabelView[],
): PlayEventCauseLabelView[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = `${label.kind}:${label.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeTechnicalRefs(
  refs: readonly PlayEventTechnicalRefView[],
): PlayEventTechnicalRefView[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.label}:${ref.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function causeLabelKind(kind: PlayEventCauseLabelKind): string {
  switch (kind) {
    case 'action': return 'Action';
    case 'trigger': return 'Trigger';
    case 'sourceEvent': return 'Source event';
    case 'pressure': return 'Pressure';
    case 'agenda': return 'Agenda';
    case 'related': return 'Related cause';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
