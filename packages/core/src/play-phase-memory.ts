import { createHash } from 'node:crypto';
import { playCompactionSource } from './play-compaction.js';
import { PLAY_KNOWLEDGE_STATE_KEY } from './play-knowledge.js';
import { PLAY_WORLD_MOMENTUM_STATE_KEY } from './play-world-momentum.js';
import { PLAY_CANON_BEATS_STATE_KEY } from './play-canon-beats.js';
import type { PlaySession } from './play-session.js';
import type { PlayEventVisibility } from './play-types.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';

export interface PlayPhase {
  sessionId: string;
  firstTurn: number;
  lastTurn: number;
  headId: string | null;
  current: boolean;
}
export interface PlayPhaseCatalog {
  sessionId: string;
  revision: number;
  headId: string | null;
  phases: PlayPhase[];
  gap?: 'source-unavailable' | 'invalid-archive' | 'depth-limit';
}
export interface PlayPhaseBudget {
  estimatedTokens: number;
  protectedTokens: number;
  inputTokens?: number;
  outputReserve?: number;
  previousRequestTokens?: number;
  status: 'unknown' | 'within' | 'near-limit' | 'overflow' | 'protected-overflow';
}
export type PlayPhaseOverview = PlayPhaseCatalog & { budget: PlayPhaseBudget };
export interface PlayPhaseQuery {
  sessionId: string;
  revision: number;
  headId: string;
  phaseSessionId: string;
  lens: 'player' | 'director';
  query: string;
  firstTurn: number;
  lastTurn: number;
  selectEvidence?: true;
}
export interface PlayPhaseHit {
  turn: number;
  turnId: string;
  messageId: string;
  start: number;
  end: number;
  quote: string;
  quoteHash: string;
  visibility: PlayEventVisibility;
  stateRecorded: boolean;
  historicalState: Record<string, unknown>;
  omittedStateFields: number;
}
export interface PlayPhaseRecall {
  scope: PlayPhaseQuery;
  hits: PlayPhaseHit[];
  candidateBytes: number;
  omittedMessages: number;
  omittedHits: number;
  selectedMessageIds?: string[];
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Verify only the immutable prefix selected by the browsing session. A source can have advanced or switched branches. */
function archivedPrefix(source: PlaySession, ids: string[], expectedHash: string): string | undefined {
  if (source.schemaVersion !== 4) return undefined;
  const byId = new Map(source.turnArtifacts.map(turn => [turn.id, turn]));
  const selected = ids.map(id => byId.get(id));
  const head = selected.at(-1);
  if (!head || selected.some((turn, index) => !turn || turn.parentTurnId !== ids[index - 1])) return undefined;
  const state = head.playLocalStateSnapshot ?? (source.branchBaseSnapshot.parentTurnId === head.id ? source.branchBaseSnapshot.playLocalState : undefined);
  if (!state) return undefined;
  const anchored = { ...source, selectedTurnIds: ids, playLocalState: state,
    transcript: selected.flatMap(turn => turn!.messages) };
  if (sha256(playCompactionSource(anchored)) !== expectedHash) return undefined;
  // The original archive hash predates per-turn visibility/schedule validation.
  // Compare the copied artifacts as well before disclosing any historical state.
  const hash = createHash('sha256');
  for (const turn of selected) hash.update(JSON.stringify(turn)).update('\n');
  return hash.digest('hex');
}

export async function buildPlayPhaseCatalog(session: PlaySession, load: (id: string) => Promise<PlaySession>): Promise<PlayPhaseCatalog> {
  if (session.schemaVersion !== 4) throw new Error('阶段归档仅支持沉浸式推演。');
  const ids = session.selectedTurnIds;
  const result: PlayPhaseCatalog = { sessionId: session.id, revision: session.revision, headId: ids.at(-1) ?? null, phases: [] };
  let source = session;
  let end = ids.length;
  const visited = new Set<string>();
  while (true) {
    visited.add(source.id);
    const marker = source.metadataExtensions.playCompaction;
    let boundary = 0;
    if (marker === undefined && (source.metadataExtensions.playCompactionStartRevision !== undefined || source.metadataExtensions.playContinuation !== undefined)) {
      result.gap = 'invalid-archive'; break;
    }
    if (marker !== undefined) {
      if (!record(marker) || typeof marker.sourceTurnId !== 'string' || typeof marker.sourceSessionId !== 'string'
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(marker.sourceSessionId) || marker.sourceSessionId.includes('..') || typeof marker.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(marker.sourceHash)) {
        result.gap = 'invalid-archive'; break;
      }
      const index = ids.indexOf(marker.sourceTurnId);
      if (!Number.isSafeInteger(marker.sourceRevision) || !record(marker.data) || !Number.isSafeInteger(marker.data.turnsCovered)
        || !source.turnArtifacts.some(turn => turn.id === marker.sourceTurnId)) { result.gap = 'invalid-archive'; break; }
      // A restored pre-archive branch does not inherit a continuation from its sibling.
      if (index >= 0 && index < end) {
        boundary = index + 1;
        if (marker.data.turnsCovered !== boundary) { result.gap = 'invalid-archive'; break; }
      }
    }
    result.phases.unshift({ sessionId: source.id, firstTurn: boundary + 1, lastTurn: end, headId: ids[end - 1] ?? null, current: source.id === session.id });
    if (!boundary || !record(marker)) break;
    const parentId = marker.sourceSessionId as string;
    if (visited.has(parentId)) { result.gap = 'invalid-archive'; break; }
    if (visited.size >= 64) { result.gap = 'depth-limit'; break; }
    const prefix = ids.slice(0, boundary);
    try {
      const parent = await load(parentId);
      const proof = archivedPrefix(parent, prefix, String(marker.sourceHash));
      if (!proof || parent.id !== parentId || proof !== archivedPrefix(session, prefix, String(marker.sourceHash))) {
        result.gap = 'invalid-archive'; break;
      }
      source = parent;
    } catch { result.gap = 'source-unavailable'; break; }
    end = boundary;
  }
  return result;
}

const candidateLimit = 256 * 1024;
const outputLimit = 24 * 1024;
const hitLimit = 20;

function stateAt(turn: PlayTurnArtifact, lens: PlayPhaseQuery['lens']) {
  const state = turn.playLocalStateSnapshot ?? {};
  const visibility = turn.playLocalStateVisibilitySnapshot ?? {};
  const historicalState: Record<string, unknown> = Object.create(null);
  let omittedStateFields = 0;
  let size = 0;
  let evidenceVisibility: PlayEventVisibility = 'playerVisible';
  for (const [key, value] of Object.entries(state)) {
    const labels = [visibility[key] ?? 'playerUnknown', ...Object.entries(visibility)
      .filter(([path]) => path.startsWith(key + '.')).map(([, label]) => label)];
    if (key === PLAY_KNOWLEDGE_STATE_KEY || key === PLAY_WORLD_MOMENTUM_STATE_KEY || key === PLAY_CANON_BEATS_STATE_KEY) labels.push('playerUnknown');
    const fieldVisibility = labels.includes('playerUnknown') ? 'playerUnknown' : labels.includes('rumor') ? 'rumor' : 'playerVisible';
    if (lens === 'player' && fieldVisibility !== 'playerVisible') continue;
    const bytes = Buffer.byteLength(JSON.stringify({ [key]: value }));
    if (size + bytes > 2048) { omittedStateFields++; continue; }
    historicalState[key] = value;
    if (fieldVisibility === 'playerUnknown' || evidenceVisibility === 'playerVisible') evidenceVisibility = fieldVisibility;
    size += bytes;
  }
  return { historicalState, omittedStateFields, stateRecorded: turn.playLocalStateSnapshot !== undefined, visibility: evidenceVisibility };
}

/** Materialize one selected, bounded, read-only window. No tools, model calls or dynamic host reads occur during search. */
export function recallPlayPhase(session: PlaySession, catalog: PlayPhaseCatalog, scope: PlayPhaseQuery): PlayPhaseRecall {
  if (session.schemaVersion !== 4 || session.id !== scope.sessionId || session.revision !== scope.revision
    || session.selectedTurnIds.at(-1) !== scope.headId || catalog.sessionId !== session.id || catalog.revision !== session.revision || catalog.headId !== scope.headId) throw new Error('当前分支已改变，请重新选择阶段。');
  const phase = catalog.phases.find(item => item.sessionId === scope.phaseSessionId);
  if (!phase || scope.selectEvidence !== undefined && scope.selectEvidence !== true || !['player', 'director'].includes(scope.lens) || typeof scope.query !== 'string' || !scope.query.trim() || scope.query.length > 160
    || !Number.isSafeInteger(scope.firstTurn) || !Number.isSafeInteger(scope.lastTurn) || scope.firstTurn < phase.firstTurn
    || scope.lastTurn > phase.lastTurn || scope.firstTurn > scope.lastTurn) throw new Error('检索范围或关键词无效。');
  const byId = new Map(session.turnArtifacts.map(turn => [turn.id, turn]));
  const result: PlayPhaseRecall = { scope, hits: [], candidateBytes: 0, omittedMessages: 0, omittedHits: 0 };
  const window: { turn: PlayTurnArtifact; number: number; messageId: string; content: string }[] = [];
  for (let number = scope.firstTurn; number <= scope.lastTurn; number++) {
    const turn = byId.get(session.selectedTurnIds[number - 1]!)!;
    for (const message of turn.messages) {
      const bytes = Buffer.byteLength(message.content) + 64;
      if (!message.id || result.candidateBytes + bytes > candidateLimit) { result.omittedMessages++; continue; }
      window.push({ turn, number, messageId: message.id, content: message.content });
      result.candidateBytes += bytes;
    }
  }
  let outputBytes = 0;
  for (const { turn, number, messageId, content } of window) {
    const match = content.indexOf(scope.query);
    if (match < 0) continue;
    if (result.hits.length >= hitLimit) { result.omittedHits++; continue; }
    // UTF-16 offsets locate the exact excerpt in the original message. Keep surrogate pairs intact.
    let start = Math.max(0, match - 64), end = Math.min(content.length, match + scope.query.length + 64);
    if (start && /[\uDC00-\uDFFF]/u.test(content.charAt(start))) start--;
    if (end < content.length && /[\uDC00-\uDFFF]/u.test(content.charAt(end))) end++;
    const quote = content.slice(start, end);
    const hit: PlayPhaseHit = { turn: number, turnId: turn.id, messageId, start, end, quote, quoteHash: sha256(quote),
      ...stateAt(turn, scope.lens) };
    const bytes = Buffer.byteLength(JSON.stringify(hit)) + 1;
    if (outputBytes + bytes > outputLimit) { result.omittedHits++; continue; }
    result.hits.push(hit);
    outputBytes += bytes;
  }
  return result;
}
