import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import { materializePlayTurnFacts } from './play-session-facts.js';
import {
  resolvePlaySessionPath,
  withPlaySessionFileTransaction,
} from './play-session.js';
import type { PlaySession } from './play-session.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type {
  PlayActivatedSource,
  PlayEventVisibility,
  PlayObservation,
  PlayTranscriptTurn,
  PlayWorldEvent,
} from './play-types.js';
import type { PlayRehearsalTurnEvidence } from './play-rehearsal.js';

export const PLAY_OUTCOME_REPORT_SCHEMA_VERSION = 1 as const;
export const PLAY_OUTCOME_REPORTS_DIRECTORY = 'reports' as const;
export const PLAY_OUTCOME_REPORT_YAML_FILE = 'outcome.yaml' as const;
export const PLAY_OUTCOME_REPORT_MARKDOWN_FILE = 'outcome.md' as const;

export type PlayOutcomeProjection = 'player' | 'director';

export type PlayOutcomeTag =
  | 'goal'
  | 'divergence'
  | 'consistency'
  | 'worldChange'
  | 'participantFootprint'
  | 'writingMaterial';

export type PlayOutcomeItemKind =
  | 'sceneSummary'
  | 'goalAssessment'
  | 'participantFootprint'
  | 'worldChange'
  | 'writingMaterial';

export type PlayOutcomeConfidence = 'confirmed' | 'inferred' | 'authorProvided';

export type PlayOutcomeGoalStatus =
  | 'reached'
  | 'partial'
  | 'missed'
  | 'changed';

export interface PlayOutcomeSourceSnapshot {
  sourceId: string;
  path?: string;
  contentHash?: string;
}

/**
 * `artifactTurnRefs` name immutable turn artifacts. `messageRefs` name
 * transcript messages inside those artifacts. They are intentionally distinct
 * because older Play data used the ambiguous word "turn" for both identities.
 */
export interface PlayOutcomeItem {
  id: string;
  kind: PlayOutcomeItemKind;
  summary: string;
  visibility: PlayEventVisibility;
  confidence: PlayOutcomeConfidence;
  goalStatus?: PlayOutcomeGoalStatus;
  tags: PlayOutcomeTag[];
  artifactTurnRefs: string[];
  messageRefs: string[];
  eventRefs: string[];
  observationRefs: string[];
  evidenceRefs: string[];
  sourceRefs: string[];
  participantRefs: string[];
}

export interface PlayOutcomeReport {
  schemaVersion: typeof PLAY_OUTCOME_REPORT_SCHEMA_VERSION;
  sessionId: string;
  sceneId?: string;
  createdAt: string;
  sessionRevision: number;
  selectedArtifactTurnRefs: string[];
  sourceSnapshots: PlayOutcomeSourceSnapshot[];
  items: PlayOutcomeItem[];
}

export type PlayOutcomeReportStaleReason =
  | 'sessionRevisionChanged'
  | 'selectedBranchChanged'
  | 'sourceSnapshotChanged'
  | `sourceContentChanged:${string}`
  | `sourceUnavailable:${string}`;

export interface PlayOutcomeReportReadResult {
  report: PlayOutcomeReport;
  status: 'current' | 'stale';
  staleReasons: PlayOutcomeReportStaleReason[];
}

export interface SelectedPlayOutcomeMessageEvidence {
  artifactTurnRef: string;
  message: PlayTranscriptTurn & { id: string };
}

export interface SelectedPlayOutcomeEventEvidence {
  artifactTurnRef: string;
  event: PlayWorldEvent;
}

export interface SelectedPlayOutcomeObservationEvidence {
  artifactTurnRefs: string[];
  observation: PlayObservation;
}

export interface SelectedPlayOutcomeRehearsalEvidence {
  artifactTurnRef: string;
  evidence: PlayRehearsalTurnEvidence;
}

export interface SelectedPlayOutcomeEvidenceIndex {
  sessionId: string;
  sessionRevision: number;
  selectedArtifactTurnRefs: string[];
  artifacts: PlayTurnArtifact[];
  messages: SelectedPlayOutcomeMessageEvidence[];
  events: SelectedPlayOutcomeEventEvidence[];
  observations: SelectedPlayOutcomeObservationEvidence[];
  rehearsalEvidence: SelectedPlayOutcomeRehearsalEvidence[];
}

export interface CreatePlayOutcomeReportOptions {
  createdAt?: string;
}

export type PlayOutcomeReportFormat = 'yaml' | 'markdown';

export function createSelectedPlayOutcomeEvidenceIndex(
  session: PlaySession,
): SelectedPlayOutcomeEvidenceIndex {
  const facts = materializePlayTurnFacts(session);
  const artifactsById = new Map(
    facts.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const selectedArtifacts = facts.selectedTurnIds.map((artifactTurnRef) => {
    const artifact = artifactsById.get(artifactTurnRef);
    if (!artifact) {
      throw new Error(
        `Play outcome selected branch references missing artifact: ${artifactTurnRef}.`,
      );
    }
    return artifact;
  });
  const selectedArtifactRefSet = new Set(facts.selectedTurnIds);
  const messageOwners = new Map<string, string>();
  const eventOwners = new Map<string, string>();
  const observationOwners = new Map<string, string>();
  for (const artifact of facts.turnArtifacts) {
    for (const message of artifact.messages) {
      if (!message.id) {
        throw new Error(`Play outcome artifact ${artifact.id} contains an id-less message.`);
      }
      messageOwners.set(message.id, artifact.id);
    }
    for (const eventRef of artifact.eventIds) eventOwners.set(eventRef, artifact.id);
    for (const observationRef of artifact.observationIds) {
      observationOwners.set(observationRef, artifact.id);
    }
  }

  const messages = selectedArtifacts.flatMap((artifact) =>
    artifact.messages.map((message): SelectedPlayOutcomeMessageEvidence => ({
      artifactTurnRef: artifact.id,
      message: { ...message, id: message.id! },
    })));
  const events = session.events
    .filter((event) => facts.selectedEventIds.has(event.id))
    .map((event): SelectedPlayOutcomeEventEvidence => {
      const artifactTurnRef = eventOwners.get(event.id);
      if (!artifactTurnRef || !selectedArtifactRefSet.has(artifactTurnRef)) {
        throw new Error(`Play outcome event has no selected artifact owner: ${event.id}.`);
      }
      return { artifactTurnRef, event: structuredClone(event) };
    });
  const observations = session.observations
    .filter((observation) => facts.selectedObservationIds.has(observation.id))
    .map((observation): SelectedPlayOutcomeObservationEvidence => {
      const ownerRefs = new Set<string>();
      const directOwner = observationOwners.get(observation.id);
      if (directOwner) ownerRefs.add(directOwner);
      for (const messageRef of observation.sourceTurnIds) {
        const owner = messageOwners.get(messageRef);
        if (owner) ownerRefs.add(owner);
      }
      for (const eventRef of observation.sourceEventIds) {
        const owner = eventOwners.get(eventRef);
        if (owner) ownerRefs.add(owner);
      }
      return {
        artifactTurnRefs: facts.selectedTurnIds.filter((artifactRef) =>
          ownerRefs.has(artifactRef)),
        observation: structuredClone(observation),
      };
    });
  const rehearsalEvidence = facts.selectedRehearsalEvidence.map(
    (evidence): SelectedPlayOutcomeRehearsalEvidence => {
      if (!selectedArtifactRefSet.has(evidence.owningTurnArtifactId)) {
        throw new Error(
          `Play outcome rehearsal evidence is outside the selected branch: ${evidence.id}.`,
        );
      }
      return {
        artifactTurnRef: evidence.owningTurnArtifactId,
        evidence: structuredClone(evidence),
      };
    },
  );

  return {
    sessionId: session.id,
    sessionRevision: session.revision,
    selectedArtifactTurnRefs: [...facts.selectedTurnIds],
    artifacts: selectedArtifacts.map((artifact) => structuredClone(artifact)),
    messages,
    events,
    observations,
    rehearsalEvidence,
  };
}

export function createPlayOutcomeReport(
  session: PlaySession,
  options: CreatePlayOutcomeReportOptions = {},
): PlayOutcomeReport {
  const evidence = createSelectedPlayOutcomeEvidenceIndex(session);
  const items: PlayOutcomeItem[] = [];
  const addItem = (item: Omit<PlayOutcomeItem, 'id'>): void => {
    items.push(normalizePlayOutcomeItem({
      id: `outcome-${String(items.length + 1).padStart(4, '0')}`,
      ...item,
      summary: boundOutcomeSummary(item.summary),
    }));
  };

  for (const { artifactTurnRef, message } of evidence.messages) {
    if (message.speaker.trim().toLowerCase() === 'user') {
      continue;
    }
    addItem({
      kind: 'sceneSummary',
      summary: `${message.speaker}: ${message.content}`,
      visibility: 'playerVisible',
      confidence: 'confirmed',
      tags: ['writingMaterial'],
      artifactTurnRefs: [artifactTurnRef],
      messageRefs: [message.id],
      eventRefs: [],
      observationRefs: [],
      evidenceRefs: [],
      sourceRefs: [],
      participantRefs: [],
    });
  }

  for (const { artifactTurnRef, event } of evidence.events) {
    addItem({
      kind: 'worldChange',
      summary: `${event.title}: ${event.summary}`,
      visibility: event.visibility,
      confidence: 'confirmed',
      tags: ['worldChange', 'writingMaterial'],
      artifactTurnRefs: [artifactTurnRef],
      messageRefs: dedupe([event.turnId, ...(event.cause.sourceTurnIds ?? [])]),
      eventRefs: dedupe([event.id, ...(event.cause.sourceEventIds ?? [])]),
      observationRefs: [],
      evidenceRefs: [],
      sourceRefs: [],
      participantRefs: [],
    });
  }

  for (const { artifactTurnRefs, observation } of evidence.observations) {
    // A free-floating author note is not selected committed-branch evidence.
    if (!artifactTurnRefs.length) continue;
    addItem({
      kind: 'writingMaterial',
      summary: `${observation.summary}: ${observation.evidence}`,
      visibility: observation.visibility,
      confidence: 'confirmed',
      tags: ['writingMaterial', 'consistency'],
      artifactTurnRefs,
      messageRefs: [...observation.sourceTurnIds],
      eventRefs: [...observation.sourceEventIds],
      observationRefs: [observation.id],
      evidenceRefs: [],
      sourceRefs: [],
      participantRefs: [],
    });
  }

  for (const artifact of evidence.artifacts) {
    for (const [key, value] of Object.entries(artifact.stateDelta)) {
      addItem({
        kind: 'worldChange',
        summary: `State ${key} changed to ${formatOutcomeValue(value)}.`,
        visibility: artifact.playLocalStateVisibilitySnapshot?.[key] ??
          'playerUnknown',
        confidence: 'confirmed',
        tags: ['worldChange', 'consistency'],
        artifactTurnRefs: [artifact.id],
        messageRefs: [],
        eventRefs: [...artifact.eventIds],
        observationRefs: [],
        evidenceRefs: [],
        sourceRefs: [],
        participantRefs: [],
      });
    }
  }

  addRehearsalOutcomeItems(session, evidence, addItem);

  const report = normalizePlayOutcomeReport({
    schemaVersion: PLAY_OUTCOME_REPORT_SCHEMA_VERSION,
    sessionId: session.id,
    ...(session.sceneRehearsal
      ? { sceneId: session.sceneRehearsal.activeSceneRef }
      : {}),
    createdAt: normalizeTimestamp(
      options.createdAt ?? new Date().toISOString(),
      'Play outcome createdAt',
    ),
    sessionRevision: evidence.sessionRevision,
    selectedArtifactTurnRefs: evidence.selectedArtifactTurnRefs,
    sourceSnapshots: createSourceSnapshots(session.activatedSources),
    items,
  });
  return report;
}

export function projectPlayOutcomeReport(
  reportValue: PlayOutcomeReport,
  projection: PlayOutcomeProjection,
): PlayOutcomeReport {
  const report = normalizePlayOutcomeReport(reportValue);
  if (projection === 'director') return structuredClone(report);
  if (projection !== 'player') {
    throw new Error(`Unsupported Play outcome projection: ${String(projection)}.`);
  }
  return {
    ...structuredClone(report),
    // Branch and evidence identities are Director-only audit material. Player
    // projection keeps only the authored, visibility-filtered outcome text so
    // opaque ids cannot be used to correlate a visible consequence with a
    // hidden sibling/cause in another inspector surface.
    selectedArtifactTurnRefs: [],
    sourceSnapshots: [],
    items: report.items
      .filter((item) => item.visibility !== 'playerUnknown')
      .map((item) => ({
        ...structuredClone(item),
        artifactTurnRefs: [],
        messageRefs: [],
        eventRefs: [],
        observationRefs: [],
        evidenceRefs: [],
        sourceRefs: [],
        participantRefs: [],
      })),
  };
}

export function fingerprintPlayOutcomeReport(
  reportValue: PlayOutcomeReport,
): string {
  const report = normalizePlayOutcomeReport(reportValue);
  const { createdAt: _createdAt, ...evidenceSnapshot } = report;
  return createHash('sha256')
    // createdAt is report-generation metadata, not evidence identity. A
    // deterministic rebuild of the same selected branch must not stale an
    // explicitly selected Writing Reference attachment.
    .update(canonicalJson(evidenceSnapshot))
    .digest('hex');
}

export function formatPlayOutcomeReportMarkdown(
  reportValue: PlayOutcomeReport,
  projection: PlayOutcomeProjection = 'director',
): string {
  const report = projectPlayOutcomeReport(reportValue, projection);
  const branch = projection === 'player'
    ? '(redacted in Player projection)'
    : report.selectedArtifactTurnRefs.length
      ? report.selectedArtifactTurnRefs.join(' -> ')
      : '(initial world; no committed turns)';
  const itemBlocks = report.items.length
    ? report.items.map((item) => [
        `## ${item.id}: ${formatOutcomeKind(item.kind)}`,
        '',
        item.summary,
        '',
        `- Visibility: ${item.visibility}`,
        `- Confidence: ${item.confidence}`,
        ...(item.goalStatus ? [`- Goal status: ${item.goalStatus}`] : []),
        `- Tags: ${item.tags.join(', ')}`,
        `- Artifact turns: ${formatRefs(item.artifactTurnRefs)}`,
        `- Messages: ${formatRefs(item.messageRefs)}`,
        `- Events: ${formatRefs(item.eventRefs)}`,
        `- Observations: ${formatRefs(item.observationRefs)}`,
        `- Evidence: ${formatRefs(item.evidenceRefs)}`,
        `- Sources: ${formatRefs(item.sourceRefs)}`,
        `- Participants: ${formatRefs(item.participantRefs)}`,
      ].join('\n'))
    : ['_No selected committed outcome evidence._'];
  return [
    '# Play Outcome Report',
    '',
    `- Session: ${report.sessionId}`,
    ...(report.sceneId ? [`- Scene: ${report.sceneId}`] : []),
    `- Session revision: ${report.sessionRevision}`,
    `- Projection: ${projection}`,
    `- Created: ${report.createdAt}`,
    `- Selected committed branch: ${branch}`,
    '',
    ...itemBlocks,
    '',
  ].join('\n');
}

export function resolvePlayOutcomeReportPath(
  workspaceRoot: string,
  sessionId: string,
  format: PlayOutcomeReportFormat,
): string {
  const sessionRoot = dirname(resolvePlaySessionPath(
    workspaceRoot,
    sessionId,
    'session.yaml',
  ));
  const file = format === 'yaml'
    ? PLAY_OUTCOME_REPORT_YAML_FILE
    : format === 'markdown'
      ? PLAY_OUTCOME_REPORT_MARKDOWN_FILE
      : undefined;
  if (!file) throw new Error('Unsupported Play outcome report format.');
  const path = resolve(sessionRoot, PLAY_OUTCOME_REPORTS_DIRECTORY, file);
  assertPathInside(sessionRoot, path, 'Play outcome report');
  return path;
}

export async function writePlayOutcomeReport(
  workspaceRoot: string,
  sessionId: string,
  options: CreatePlayOutcomeReportOptions = {},
): Promise<PlayOutcomeReport> {
  return withPlaySessionFileTransaction(workspaceRoot, sessionId, async (transaction) => {
    const session = await transaction.read();
    const report = createPlayOutcomeReport(session, options);
    const yamlPath = resolvePlayOutcomeReportPath(workspaceRoot, sessionId, 'yaml');
    const markdownPath = resolvePlayOutcomeReportPath(
      workspaceRoot,
      sessionId,
      'markdown',
    );
    await ensurePlayOutcomeReportsDirectory(
      workspaceRoot,
      dirname(yamlPath),
    );
    // Markdown is a disposable projection; YAML is renamed last as the commit marker.
    await writeFileAtomically(
      markdownPath,
      formatPlayOutcomeReportMarkdown(report, 'director'),
    );
    await writeFileAtomically(yamlPath, stringify(report));
    return report;
  });
}

export async function readPlayOutcomeReport(
  workspaceRoot: string,
  sessionId: string,
): Promise<PlayOutcomeReportReadResult> {
  return withPlaySessionFileTransaction(workspaceRoot, sessionId, async (transaction) => {
    const session = await transaction.read();
    const yamlPath = resolvePlayOutcomeReportPath(workspaceRoot, sessionId, 'yaml');
    const reportStats = await lstat(yamlPath);
    if (!reportStats.isFile() || reportStats.isSymbolicLink()) {
      throw new Error('Play outcome report must be a regular file.');
    }
    const report = normalizePlayOutcomeReport(
      parse(await readFile(yamlPath, 'utf-8')),
    );
    if (report.sessionId !== session.id) {
      throw new Error('Play outcome report belongs to another session.');
    }
    const staleReasons = await collectOutcomeStaleReasons(
      workspaceRoot,
      session,
      report,
    );
    if (
      !staleReasons.includes('sessionRevisionChanged') &&
      !staleReasons.includes('selectedBranchChanged') &&
      !staleReasons.includes('sourceSnapshotChanged')
    ) {
      const expected = createPlayOutcomeReport(session, {
        createdAt: report.createdAt,
      });
      if (!isDeepStrictEqual(report, expected)) {
        throw new Error(
          'Play outcome report does not match the selected committed evidence.',
        );
      }
    }
    return {
      report,
      status: staleReasons.length ? 'stale' : 'current',
      staleReasons,
    };
  });
}

export function normalizePlayOutcomeReport(value: unknown): PlayOutcomeReport {
  const record = requireRecord(value, 'Play outcome report');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'sessionId',
    'sceneId',
    'createdAt',
    'sessionRevision',
    'selectedArtifactTurnRefs',
    'sourceSnapshots',
    'items',
  ], 'Play outcome report');
  if (record.schemaVersion !== PLAY_OUTCOME_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Play outcome report schemaVersion: ${String(record.schemaVersion)}.`,
    );
  }
  const sourceSnapshots = requireArray(
    record.sourceSnapshots,
    'Play outcome sourceSnapshots',
  ).map(normalizeSourceSnapshot);
  assertUnique(sourceSnapshots.map((source) => source.sourceId), 'source id');
  const items = requireArray(record.items, 'Play outcome items')
    .map(normalizePlayOutcomeItem);
  assertUnique(items.map((item) => item.id), 'outcome item id');
  return {
    schemaVersion: PLAY_OUTCOME_REPORT_SCHEMA_VERSION,
    sessionId: assertSafeId(record.sessionId, 'Play outcome sessionId'),
    ...(record.sceneId === undefined
      ? {}
      : { sceneId: assertSafeId(record.sceneId, 'Play outcome sceneId') }),
    createdAt: normalizeTimestamp(record.createdAt, 'Play outcome createdAt'),
    sessionRevision: normalizeNonNegativeInteger(
      record.sessionRevision,
      'Play outcome sessionRevision',
    ),
    selectedArtifactTurnRefs: normalizeIdList(
      record.selectedArtifactTurnRefs,
      'Play outcome selectedArtifactTurnRefs',
    ),
    sourceSnapshots,
    items,
  };
}

function addRehearsalOutcomeItems(
  session: PlaySession,
  evidence: SelectedPlayOutcomeEvidenceIndex,
  addItem: (item: Omit<PlayOutcomeItem, 'id'>) => void,
): void {
  const sidecar = session.sceneRehearsal;
  if (!sidecar || !evidence.rehearsalEvidence.length) return;

  if (sidecar.sceneContract.objective) {
    const artifactTurnRefs = dedupe(evidence.rehearsalEvidence.map((entry) =>
      entry.artifactTurnRef));
    const evidenceRefs = evidence.rehearsalEvidence.map((entry) => entry.evidence.id);
    addItem({
      kind: 'goalAssessment',
      summary: `Scene goal has committed rehearsal evidence, but completion is not confirmed: ${sidecar.sceneContract.objective.value}`,
      visibility: 'playerUnknown',
      confidence: sidecar.sceneContract.objective.provenance.kind === 'authorProvided'
        ? 'authorProvided'
        : 'confirmed',
      goalStatus: 'partial',
      tags: ['goal', 'consistency'],
      artifactTurnRefs,
      messageRefs: [],
      eventRefs: [],
      observationRefs: [],
      evidenceRefs,
      sourceRefs: sidecar.sceneContract.objective.provenance.kind === 'sourceBacked'
        ? [...sidecar.sceneContract.objective.provenance.sourceRefs]
        : [],
      participantRefs: [],
    });
  }

  for (const participant of sidecar.participants) {
    if (!participant.currentGoal) continue;
    const participantEvidence = evidence.rehearsalEvidence.flatMap((entry) => {
      const steps = entry.evidence.steps.filter((step) =>
        step.participantRef === participant.participantRef);
      return steps.length ? [{ entry, steps }] : [];
    });
    if (!participantEvidence.length) continue;
    addItem({
      kind: 'goalAssessment',
      summary: `${participant.displayName}'s goal has committed rehearsal evidence, but completion is not confirmed: ${participant.currentGoal}`,
      visibility: 'playerUnknown',
      confidence: 'authorProvided',
      goalStatus: 'partial',
      tags: ['goal', 'consistency', 'participantFootprint'],
      artifactTurnRefs: dedupe(participantEvidence.map(({ entry }) =>
        entry.artifactTurnRef)),
      messageRefs: [],
      eventRefs: [],
      observationRefs: [],
      evidenceRefs: dedupe(participantEvidence.flatMap(({ entry, steps }) => [
        entry.evidence.id,
        ...steps.map((step) => step.stepRef),
      ])),
      sourceRefs: [...participant.initialKnowledgeEvidenceRefs],
      participantRefs: [participant.participantRef],
    });
  }

  for (const entry of evidence.rehearsalEvidence) {
    for (const step of entry.evidence.steps) {
      addItem({
        kind: 'participantFootprint',
        summary: `${step.participantRef} intent: ${step.intentSummary}`,
        visibility: 'playerUnknown',
        confidence: 'inferred',
        tags: dedupeTags([
          'participantFootprint',
          'goal',
          'consistency',
          ...(step.variantOf ? ['divergence' as const] : []),
        ]),
        artifactTurnRefs: [entry.artifactTurnRef],
        messageRefs: [],
        eventRefs: [...step.settlementEventRefs],
        observationRefs: [],
        evidenceRefs: dedupe([
          entry.evidence.id,
          step.stepRef,
          step.perceptionRef,
          ...step.decisionBasisRefs,
          ...(step.variantOf ? [step.variantOf] : []),
        ]),
        sourceRefs: [...step.decisionBasisRefs],
        participantRefs: [step.participantRef],
      });
      for (const block of step.narrativeBlocks) {
        addItem({
          kind: 'participantFootprint',
          summary: block.content,
          visibility: block.visibility,
          confidence: 'confirmed',
          tags: dedupeTags([
            'participantFootprint',
            'writingMaterial',
            'consistency',
            ...(step.variantOf ? ['divergence' as const] : []),
          ]),
          artifactTurnRefs: [entry.artifactTurnRef],
          messageRefs: [],
          eventRefs: [...block.eventRefs],
          observationRefs: [],
          evidenceRefs: [entry.evidence.id, step.stepRef, block.id],
          sourceRefs: [...block.sourceRefs],
          participantRefs: [step.participantRef],
        });
      }
    }
    for (const block of entry.evidence.hostNarrativeBlocks) {
      addItem({
        kind: 'sceneSummary',
        summary: block.content,
        visibility: block.visibility,
        confidence: 'confirmed',
        tags: ['worldChange', 'writingMaterial'],
        artifactTurnRefs: [entry.artifactTurnRef],
        messageRefs: [],
        eventRefs: [...block.eventRefs],
        observationRefs: [],
        evidenceRefs: [entry.evidence.id, block.id],
        sourceRefs: [...block.sourceRefs],
        participantRefs: [],
      });
    }
  }
}

function normalizePlayOutcomeItem(value: unknown): PlayOutcomeItem {
  const record = requireRecord(value, 'Play outcome item');
  assertOnlyKnownFields(record, [
    'id',
    'kind',
    'summary',
    'visibility',
    'confidence',
    'goalStatus',
    'tags',
    'artifactTurnRefs',
    'messageRefs',
    'eventRefs',
    'observationRefs',
    'evidenceRefs',
    'sourceRefs',
    'participantRefs',
  ], 'Play outcome item');
  const kinds: readonly PlayOutcomeItemKind[] = [
    'sceneSummary',
    'goalAssessment',
    'participantFootprint',
    'worldChange',
    'writingMaterial',
  ];
  const confidences: readonly PlayOutcomeConfidence[] = [
    'confirmed',
    'inferred',
    'authorProvided',
  ];
  const visibility = normalizeVisibility(record.visibility);
  if (!kinds.includes(record.kind as PlayOutcomeItemKind)) {
    throw new Error(`Play outcome item has invalid kind: ${String(record.kind)}.`);
  }
  if (!confidences.includes(record.confidence as PlayOutcomeConfidence)) {
    throw new Error(
      `Play outcome item has invalid confidence: ${String(record.confidence)}.`,
    );
  }
  const goalStatuses: readonly PlayOutcomeGoalStatus[] = [
    'reached',
    'partial',
    'missed',
    'changed',
  ];
  const goalStatus = record.goalStatus === undefined
    ? undefined
    : record.goalStatus as PlayOutcomeGoalStatus;
  if (
    (record.kind === 'goalAssessment' && !goalStatus) ||
    (record.kind !== 'goalAssessment' && goalStatus !== undefined) ||
    (goalStatus !== undefined && !goalStatuses.includes(goalStatus))
  ) {
    throw new Error(
      'Play outcome goalAssessment requires a valid goalStatus, and other items cannot carry one.',
    );
  }
  const tags = normalizeTags(record.tags);
  if (!tags.length) throw new Error('Play outcome item requires at least one tag.');
  const artifactTurnRefs = normalizeIdList(
    record.artifactTurnRefs,
    'Play outcome artifactTurnRefs',
  );
  if (!artifactTurnRefs.length) {
    throw new Error('Play outcome item requires selected committed artifact evidence.');
  }
  return {
    id: assertSafeId(record.id, 'Play outcome item id'),
    kind: record.kind as PlayOutcomeItemKind,
    summary: normalizeText(record.summary, 'Play outcome item summary', 20_000),
    visibility,
    confidence: record.confidence as PlayOutcomeConfidence,
    ...(goalStatus ? { goalStatus } : {}),
    tags,
    artifactTurnRefs,
    messageRefs: normalizeIdList(record.messageRefs, 'Play outcome messageRefs'),
    eventRefs: normalizeIdList(record.eventRefs, 'Play outcome eventRefs'),
    observationRefs: normalizeIdList(
      record.observationRefs,
      'Play outcome observationRefs',
    ),
    evidenceRefs: normalizeIdList(record.evidenceRefs, 'Play outcome evidenceRefs'),
    sourceRefs: normalizeIdList(record.sourceRefs, 'Play outcome sourceRefs'),
    participantRefs: normalizeIdList(
      record.participantRefs,
      'Play outcome participantRefs',
    ),
  };
}

function normalizeSourceSnapshot(value: unknown): PlayOutcomeSourceSnapshot {
  const record = requireRecord(value, 'Play outcome source snapshot');
  assertOnlyKnownFields(
    record,
    ['sourceId', 'path', 'contentHash'],
    'Play outcome source snapshot',
  );
  const path = record.path === undefined
    ? undefined
    : normalizeText(record.path, 'Play outcome source path', 4_096);
  const contentHash = record.contentHash === undefined
    ? undefined
    : normalizeHash(record.contentHash);
  return {
    sourceId: normalizeText(record.sourceId, 'Play outcome sourceId', 512),
    ...(path ? { path } : {}),
    ...(contentHash ? { contentHash } : {}),
  };
}

async function collectOutcomeStaleReasons(
  workspaceRoot: string,
  session: PlaySession,
  report: PlayOutcomeReport,
): Promise<PlayOutcomeReportStaleReason[]> {
  const reasons: PlayOutcomeReportStaleReason[] = [];
  if (report.sessionRevision !== session.revision) {
    reasons.push('sessionRevisionChanged');
  }
  const facts = materializePlayTurnFacts(session);
  if (!isDeepStrictEqual(
    report.selectedArtifactTurnRefs,
    facts.selectedTurnIds,
  )) {
    reasons.push('selectedBranchChanged');
  }
  const sourceSnapshots = createSourceSnapshots(session.activatedSources);
  if (!isDeepStrictEqual(report.sourceSnapshots, sourceSnapshots)) {
    reasons.push('sourceSnapshotChanged');
  }
  for (const source of report.sourceSnapshots) {
    if (!source.path || !source.contentHash) continue;
    const currentHash = await readWorkspaceSourceHash(workspaceRoot, source.path);
    if (!currentHash) {
      reasons.push(`sourceUnavailable:${source.sourceId}`);
    } else if (currentHash !== source.contentHash) {
      reasons.push(`sourceContentChanged:${source.sourceId}`);
    }
  }
  return dedupe(reasons) as PlayOutcomeReportStaleReason[];
}

async function readWorkspaceSourceHash(
  workspaceRoot: string,
  sourcePath: string,
): Promise<string | undefined> {
  try {
    const workspace = resolve(workspaceRoot);
    const candidate = resolve(workspace, sourcePath);
    assertPathInside(workspace, candidate, 'Play outcome source');
    const [realWorkspace, realCandidate] = await Promise.all([
      realpath(workspace),
      realpath(candidate),
    ]);
    assertPathInside(realWorkspace, realCandidate, 'Play outcome source');
    const content = await readFile(realCandidate);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return undefined;
  }
}

async function ensurePlayOutcomeReportsDirectory(
  workspaceRoot: string,
  reportsRoot: string,
): Promise<void> {
  const workspace = resolve(workspaceRoot);
  assertPathInside(workspace, reportsRoot, 'Play outcome reports');
  await mkdir(reportsRoot, { recursive: true });
  const stats = await lstat(reportsRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Play outcome reports root must be a real directory.');
  }
  const [realWorkspace, realReportsRoot] = await Promise.all([
    realpath(workspace),
    realpath(reportsRoot),
  ]);
  assertPathInside(realWorkspace, realReportsRoot, 'Play outcome reports');
}

function createSourceSnapshots(
  sources: readonly PlayActivatedSource[],
): PlayOutcomeSourceSnapshot[] {
  return sources.map((source) => normalizeSourceSnapshot({
    sourceId: source.sourceId,
    ...(source.path ? { path: source.path } : {}),
    ...(source.contentHash ? { contentHash: source.contentHash } : {}),
  }));
}

async function writeFileAtomically(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  try {
    await writeFile(tempPath, normalized, { encoding: 'utf-8', flag: 'wx' });
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function formatOutcomeValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return String(value);
  return serialized.length > 800 ? `${serialized.slice(0, 797)}...` : serialized;
}

function boundOutcomeSummary(value: string): string {
  const normalized = value.trim();
  const maxLength = 8_000;
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 20)}… [summary truncated]`;
}

function formatOutcomeKind(kind: PlayOutcomeItemKind): string {
  return kind.replace(/([A-Z])/gu, ' $1').replace(/^./u, (value) =>
    value.toUpperCase());
}

function formatRefs(refs: readonly string[]): string {
  return refs.length ? refs.join(', ') : 'none';
}

function normalizeTags(value: unknown): PlayOutcomeTag[] {
  const allowed: readonly PlayOutcomeTag[] = [
    'goal',
    'divergence',
    'consistency',
    'worldChange',
    'participantFootprint',
    'writingMaterial',
  ];
  return normalizeStringArray(value, 'Play outcome tags').map((tag) => {
    if (!allowed.includes(tag as PlayOutcomeTag)) {
      throw new Error(`Play outcome item has invalid tag: ${tag}.`);
    }
    return tag as PlayOutcomeTag;
  });
}

function dedupeTags(tags: PlayOutcomeTag[]): PlayOutcomeTag[] {
  return [...new Set(tags)];
}

function normalizeVisibility(value: unknown): PlayEventVisibility {
  if (
    value !== 'playerVisible' &&
    value !== 'rumor' &&
    value !== 'playerUnknown'
  ) {
    throw new Error(`Play outcome has invalid visibility: ${String(value)}.`);
  }
  return value;
}

function normalizeIdList(value: unknown, label: string): string[] {
  const ids = normalizeStringArray(value, label).map((item) =>
    assertSafeId(item, label));
  assertUnique(ids, `${label} ref`);
  return ids;
}

function normalizeStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item) =>
    normalizeText(item, label, 4_096));
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be non-empty text up to ${maxLength} characters.`);
  }
  return value.trim();
}

function normalizeTimestamp(value: unknown, label: string): string {
  const timestamp = normalizeText(value, label, 128);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO-compatible timestamp.`);
  }
  return timestamp;
}

function normalizeHash(value: unknown): string {
  const hash = normalizeText(value, 'Play outcome contentHash', 64);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error('Play outcome contentHash must be a SHA-256 hex digest.');
  }
  return hash;
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.length > 180
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function assertPathInside(root: string, path: string, label: string): void {
  const pathRelative = relative(root, path);
  if (
    pathRelative.startsWith('..') ||
    pathRelative === '' ||
    pathRelative.includes(`..${sep}`)
  ) {
    throw new Error(`${label} path must stay inside its root.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const known = new Set(fields);
  const unknown = Object.keys(value).find((field) => !known.has(field));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}.`);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Play outcome contains duplicate ${label}.`);
  }
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
