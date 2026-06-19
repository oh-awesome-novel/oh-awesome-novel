export type ObservationCategory =
  | 'character'
  | 'location'
  | 'item'
  | 'resource'
  | 'injury'
  | 'power'
  | 'status'
  | 'relationship'
  | 'emotionArc'
  | 'informationBoundary'
  | 'time'
  | 'sceneState'
  | 'foreshadow'
  | 'worldFact';

export type EvidenceConfidence = 'high' | 'medium' | 'low';

export type SettlementHookOperation =
  | 'create'
  | 'mention'
  | 'advance'
  | 'resolve'
  | 'defer';

export interface ObservationEntry {
  category: ObservationCategory;
  subject: string;
  observation: string;
  evidence: string;
  confidence: EvidenceConfidence;
  location?: string;
}

export interface ObservationLog {
  chapterId: string;
  observations: ObservationEntry[];
  unresolvedAmbiguities: string[];
}

export interface SettlementPatchProposal {
  domain: 'summary' | 'state' | 'timeline' | 'foreshadow' | 'character';
  target: string;
  reason: string;
  evidence: string;
  confidence: EvidenceConfidence;
}

export interface SettlementStateChange {
  entity: string;
  field: string;
  oldValue?: string;
  newValue: string;
  evidence: string;
  confidence: EvidenceConfidence;
}

export interface SettlementTimelineEvent {
  eventId?: string;
  title: string;
  time: string;
  summary: string;
  evidence: string;
}

export interface SettlementForeshadowChange {
  hookId?: string;
  title: string;
  operation: SettlementHookOperation;
  evidence: string;
}

export interface SettlementCharacterUpdate {
  characterId: string;
  section: string;
  change: string;
  evidence: string;
}

export interface SettlementBundle {
  chapterId: string;
  fulfillment: string[];
  ambiguities: string[];
  observations: ObservationLog;
  patches: SettlementPatchProposal[];
  summary?: {
    chapterId: string;
    content: string;
    evidence: string;
  };
  stateChanges: SettlementStateChange[];
  timelineEvents: SettlementTimelineEvent[];
  foreshadowChanges: SettlementForeshadowChange[];
  characterUpdates: SettlementCharacterUpdate[];
  nextChapterHandoff: string[];
  unresolvedAmbiguity: string[];
}

export const SETTLEMENT_HOOK_OPERATIONS: SettlementHookOperation[] = [
  'create',
  'mention',
  'advance',
  'resolve',
  'defer',
];

export const formatObservationLogMarkdown = (
  log: ObservationLog,
): string => [
  '## Observation Log',
  '',
  `- chapter id: ${log.chapterId}`,
  '',
  '### Evidence-Only Observations',
  ...formatObservationEntries(log.observations),
  '',
  '### Unresolved Ambiguities',
  formatList(log.unresolvedAmbiguities),
].join('\n');

export const formatSettlementBundleMarkdown = (
  bundle: SettlementBundle,
): string => [
  formatObservationLogMarkdown(bundle.observations),
  '',
  '## Settlement Bundle',
  '',
  '### Fulfillment',
  formatList(bundle.fulfillment),
  '',
  '### Ambiguities',
  formatList(bundle.ambiguities),
  '',
  '### Patch Proposals',
  ...formatPatchProposals(bundle.patches),
  '',
  '### Chapter Summary',
  bundle.summary?.content ?? 'none',
  '',
  '### State Changes',
  ...formatStateChanges(bundle.stateChanges),
  '',
  '### Timeline Events',
  ...formatTimelineEvents(bundle.timelineEvents),
  '',
  '### Foreshadow Changes',
  ...formatForeshadowChanges(bundle.foreshadowChanges),
  '',
  '### Character Updates',
  ...formatCharacterUpdates(bundle.characterUpdates),
  '',
  '### Next Chapter Handoff',
  formatList(bundle.nextChapterHandoff),
  '',
  '### Unresolved Ambiguity',
  formatList(bundle.unresolvedAmbiguity),
].join('\n');

function formatObservationEntries(entries: ObservationEntry[]): string[] {
  if (!entries.length) {
    return ['- none'];
  }

  return entries.map((entry) => {
    const location = entry.location ? ` @ ${entry.location}` : '';
    return [
      `- [${entry.category}] ${entry.subject}${location}`,
      `  - observation: ${entry.observation}`,
      `  - evidence: ${entry.evidence}`,
      `  - confidence: ${entry.confidence}`,
    ].join('\n');
  });
}

function formatPatchProposals(patches: SettlementPatchProposal[]): string[] {
  if (!patches.length) {
    return ['- none'];
  }

  return patches.map((patch) => [
    `- [${patch.domain}] ${patch.target}`,
    `  - reason: ${patch.reason}`,
    `  - evidence: ${patch.evidence}`,
    `  - confidence: ${patch.confidence}`,
  ].join('\n'));
}

function formatStateChanges(changes: SettlementStateChange[]): string[] {
  if (!changes.length) {
    return ['- none'];
  }

  return changes.map((change) =>
    `- ${change.entity}.${change.field}: ${change.oldValue ?? 'unknown'} -> ${change.newValue} (${change.confidence})`,
  );
}

function formatTimelineEvents(events: SettlementTimelineEvent[]): string[] {
  if (!events.length) {
    return ['- none'];
  }

  return events.map((event) => `- ${event.time} ${event.title}: ${event.summary}`);
}

function formatForeshadowChanges(changes: SettlementForeshadowChange[]): string[] {
  if (!changes.length) {
    return ['- none'];
  }

  return changes.map((change) =>
    `- ${change.hookId ?? 'new'} ${change.title} [${change.operation}]: ${change.evidence}`,
  );
}

function formatCharacterUpdates(updates: SettlementCharacterUpdate[]): string[] {
  if (!updates.length) {
    return ['- none'];
  }

  return updates.map((update) =>
    `- ${update.characterId}/${update.section}: ${update.change} (${update.evidence})`,
  );
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}
