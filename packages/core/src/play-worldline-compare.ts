import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

import { PLAY_CANON_BEATS_STATE_KEY, projectPlayCanonBeats, readPlayCanonBeatTable } from './play-canon-beats.js';
import { hasCompletePlayBranchSnapshot } from './play-event-schedule-history.js';
import { PLAY_KNOWLEDGE_STATE_KEY, projectPlayKnowledgeRecord, readPlayKnowledgeState } from './play-knowledge.js';
import { materializePlayTurnFacts } from './play-session-facts.js';
import type { PlaySession } from './play-session.js';
import { PLAY_INITIAL_WORLD_CHECKPOINT_ID } from './play-turn-graph.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type { PlayEventVisibility, PlayWorldClock } from './play-types.js';
import type { PlayScheduledEvent } from './play-event-schedule.js';
import { PLAY_WORLD_MOMENTUM_STATE_KEY, readPlayWorldMomentum } from './play-world-momentum.js';

export type PlayWorldlineLens = 'player' | 'director';
export type PlayWorldlineSection = 'actions' | 'state' | 'events' | 'scheduled' | 'knowledge' | 'canon';
export const PLAY_WORLDLINE_PAGE_SIZE = 40;
export const PLAY_WORLDLINE_TEXT_LIMIT = 640;

export interface PlayWorldlineCompareQuery {
  left: string;
  right: string;
  lens: PlayWorldlineLens;
  /** A shared page index; each dimension is independently bounded. */
  page?: number;
}

export interface PlayWorldlineDifference {
  key: string;
  label: string;
  left?: string;
  right?: string;
}

export interface PlayWorldlineDifferencePage {
  kind: PlayWorldlineSection;
  items: PlayWorldlineDifference[];
  total: number;
}

export interface PlayWorldlineCompareSide {
  checkpointId: string;
  turnCount: number;
  divergentTurnCount: number;
  clock: PlayWorldClock;
}

export interface PlayWorldlineComparison {
  sessionId: string;
  revision: number;
  lens: PlayWorldlineLens;
  page: number;
  pageSize: number;
  left: PlayWorldlineCompareSide;
  right: PlayWorldlineCompareSide;
  commonAncestor?: string;
  unavailableReason?: string;
  sections: PlayWorldlineDifferencePage[];
  canonical: false;
}

interface Snapshot {
  worldClock: PlayWorldClock;
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  scheduledEvents: PlayScheduledEvent[];
}

/** Pure, bounded read model. Neither Restore nor session mutation is involved. */
export function comparePlayWorldlines(session: PlaySession, query: PlayWorldlineCompareQuery): PlayWorldlineComparison {
  if (query.lens !== 'player' && query.lens !== 'director') throw new Error('Invalid comparison lens.');
  const page = query.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page > 100_000) throw new Error('Invalid comparison page.');
  const facts = materializePlayTurnFacts(session);
  const artifacts = new Map(facts.turnArtifacts.map(artifact => [artifact.id, artifact]));
  const path = (id: string): PlayTurnArtifact[] => {
    if (id === PLAY_INITIAL_WORLD_CHECKPOINT_ID) {
      if (facts.branchBaseSnapshot.parentTurnId) throw new Error('Initial world is unavailable.');
      return [];
    }
    const result: PlayTurnArtifact[] = [];
    let current = artifacts.get(id);
    if (!current) throw new Error('Unknown comparison checkpoint.');
    while (current) {
      result.push(current);
      current = current.parentTurnId ? artifacts.get(current.parentTurnId) : undefined;
    }
    return result.reverse();
  };
  const leftPath = path(query.left);
  const rightPath = path(query.right);
  let shared = 0;
  while (shared < Math.min(leftPath.length, rightPath.length) && leftPath[shared]!.id === rightPath[shared]!.id) shared++;
  const commonAncestor = shared ? leftPath[shared - 1]!.id
    : !facts.branchBaseSnapshot.parentTurnId ? PLAY_INITIAL_WORLD_CHECKPOINT_ID : undefined;
  const snapshot = (head: PlayTurnArtifact | undefined): Snapshot | undefined => {
    if (!head || head.id === facts.branchBaseSnapshot.parentTurnId) return facts.branchBaseSnapshot;
    if (!hasCompletePlayBranchSnapshot(head)) return undefined;
    return {
      worldClock: head.worldClock!,
      playLocalState: head.playLocalStateSnapshot!,
      playLocalStateVisibility: head.playLocalStateVisibilitySnapshot!,
      scheduledEvents: head.scheduledEventSnapshots,
    };
  };
  const left = snapshot(leftPath.at(-1));
  const right = snapshot(rightPath.at(-1));
  const side = (id: string, items: PlayTurnArtifact[], value: Snapshot | undefined): PlayWorldlineCompareSide => ({
    checkpointId: id,
    turnCount: items.length,
    divergentTurnCount: items.length - shared,
    clock: {
      turn: value?.worldClock.turn ?? 0, revision: value?.worldClock.revision ?? 0,
      ...(value?.worldClock.anchor !== undefined ? { anchor: clip(value.worldClock.anchor) } : {}),
      ...(value?.worldClock.elapsed !== undefined ? { elapsed: clip(value.worldClock.elapsed) } : {}),
    },
  });
  const result: PlayWorldlineComparison = {
    sessionId: session.id, revision: session.revision, lens: query.lens, page,
    pageSize: PLAY_WORLDLINE_PAGE_SIZE,
    left: side(query.left, leftPath, left), right: side(query.right, rightPath, right),
    ...(commonAncestor ? { commonAncestor } : {}), sections: [], canonical: false,
  };
  if (!left || !right || !commonAncestor) {
    result.unavailableReason = '所选旧节点缺少完整分支快照或共同起点，无法可靠比较。请选择较新的存档点。';
    return result;
  }

  const director = query.lens === 'director';
  const visible = (value: PlayEventVisibility | undefined): boolean => director || value === 'playerVisible' || value === 'rumor';
  const section = (kind: PlayWorldlineSection, rows: Iterable<PlayWorldlineDifference>): void => {
    const items: PlayWorldlineDifference[] = [];
    let total = 0;
    for (const row of rows) {
      if (total >= page * PLAY_WORLDLINE_PAGE_SIZE && items.length < PLAY_WORLDLINE_PAGE_SIZE) items.push(row);
      total++;
    }
    result.sections.push({ kind, items, total });
  };
  function* actions(): Generator<PlayWorldlineDifference> {
    for (let i = shared; i < Math.max(leftPath.length, rightPath.length); i++) {
      const l = leftPath[i]; const r = rightPath[i];
      yield {
        key: String(i), label: `分叉后第 ${i - shared + 1} 步`,
        ...(l ? { left: clip(l.input?.raw ?? '旧回合无行动记录') } : {}),
        ...(r ? { right: clip(r.input?.raw ?? '旧回合无行动记录') } : {}),
      };
    }
  }
  section('actions', actions());

  const state = (value: Snapshot): Map<string, unknown> => {
    const entries = new Map<string, unknown>();
    const reserved: string[] = [PLAY_KNOWLEDGE_STATE_KEY, PLAY_CANON_BEATS_STATE_KEY, PLAY_WORLD_MOMENTUM_STATE_KEY];
    for (const [key, item] of Object.entries(value.playLocalState)) {
      if (!reserved.includes(key) && visible(value.playLocalStateVisibility[key])) flatten(item, pointer(key), entries);
    }
    const momentum = readPlayWorldMomentum(value.playLocalState);
    for (const pressure of momentum.pressures.filter(item => visible(item.visibility))) {
      const { causeRefs: _causeRefs, ...safe } = pressure;
      flatten(director ? pressure : safe, `/worldMomentum/pressures/${pointer(pressure.id)}`, entries);
    }
    for (const agenda of momentum.agendas.filter(item => visible(item.visibility))) {
      const { updatedAtTurnId: _updatedAtTurnId, blockers: _blockers, ...safe } = agenda;
      flatten(director ? agenda : safe, `/worldMomentum/agendas/${pointer(agenda.id)}`, entries);
    }
    return entries;
  };
  section('state', differences(state(left), state(right)));

  const events = (items: PlayTurnArtifact[]): Map<string, unknown> => {
    const ids = new Set(items.flatMap(item => item.eventIds));
    return new Map(session.events.filter(event => ids.has(event.id) && visible(event.visibility)).map(event => [event.id,
      `${event.title}\n${event.summary}${director ? `\n起因：${event.cause.reason}` : ''}`,
    ]));
  };
  section('events', differences(events(leftPath), events(rightPath)));
  const schedules = (value: Snapshot): Map<string, unknown> => new Map(value.scheduledEvents
    .filter(event => visible(event.template.visibility))
    .map(event => [event.id, {
      label: event.label, status: event.status,
      ...(director ? { trigger: event.trigger, reason: event.resolutionReason ?? event.changeReason } : {}),
    }]));
  section('scheduled', differences(schedules(left), schedules(right)));
  const knowledge = (value: Snapshot): Map<string, unknown> => new Map(readPlayKnowledgeState(value.playLocalState).records
    .filter(record => director || record.kind === 'eventReveal')
    .map(record => [record.id, projectPlayKnowledgeRecord(record, director ? 'author' : 'player')]));
  section('knowledge', differences(knowledge(left), knowledge(right)));
  const canon = (value: Snapshot): Map<string, unknown> => new Map((projectPlayCanonBeats(readPlayCanonBeatTable(value.playLocalState), query.lens)?.beats ?? [])
    .map(beat => [beat.id, { label: beat.label, status: beat.status, ...(director ? { note: beat.note } : {}) }]));
  section('canon', differences(canon(left), canon(right)));
  return result;
}

function* differences(left: Map<string, unknown>, right: Map<string, unknown>): Generator<PlayWorldlineDifference> {
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (left.has(key) === right.has(key) && isDeepStrictEqual(left.get(key), right.get(key))) continue;
    yield {
      key: key.length > PLAY_WORLDLINE_TEXT_LIMIT ? createHash('sha256').update(key).digest('hex') : key, label: clip(key),
      ...(left.has(key) ? { left: display(left.get(key)) } : {}),
      ...(right.has(key) ? { right: display(right.get(key)) } : {}),
    };
  }
}

function pointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1'); }
function clip(value: string): string { return value.length > PLAY_WORLDLINE_TEXT_LIMIT ? `${value.slice(0, PLAY_WORLDLINE_TEXT_LIMIT - 1)}…` : value; }
function display(value: unknown): string { return clip(typeof value === 'string' ? value : JSON.stringify(value) ?? 'null'); }
function flatten(value: unknown, path: string, target: Map<string, unknown>, depth = 0): void {
  const entries = value && typeof value === 'object' ? Object.entries(value) : [];
  if (!entries.length || depth >= 32) { target.set(path, value); return; }
  for (const [key, item] of entries) flatten(item, `${path}/${pointer(key)}`, target, depth + 1);
}
