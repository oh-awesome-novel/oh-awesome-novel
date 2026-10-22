import { computed, shallowRef, type Ref } from 'vue';

import type { PlaySourceDriftView } from '../components/play/context/types';
import type { PlayTurnSubmitOutcome } from './usePlayTurnStream';
import type { PlayActionKind, PlayRelativeTimeAdvance } from './useWorkspaceApi';

export interface PlayQueuedAction {
  id: string;
  sessionId: string;
  userText: string;
  actionKind: PlayActionKind;
  timeAdvance?: PlayRelativeTimeAdvance;
}

export type PlayFollowUpPauseReason =
  | 'failed'
  | 'stopped'
  | 'conflict'
  | 'unknown'
  | 'source_drift'
  | 'blocked';

export const PLAY_FOLLOW_UP_PAUSE_LABELS: Record<PlayFollowUpPauseReason, string> = {
  failed: '本回合没有提交，排队的行动已暂停。',
  stopped: '本回合已停止，排队的行动已暂停。',
  conflict: 'Play 会话已被其他操作改动，排队的行动已暂停。',
  unknown: '本回合结果未确认，刷新后再继续发送排队的行动。',
  source_drift: '来源内容有变化，先在上下文面板中做出选择，再继续发送排队的行动。',
  blocked: '有其他操作正在进行，排队的行动已暂停。',
};

/** What the Play composer needs to show and drive the queue of the selected session. */
export interface PlayFollowUpControls {
  items: readonly PlayQueuedAction[];
  notice: string;
  paused: boolean;
  steer(id: string): void;
  edit(id: string, text: string): void;
  remove(id: string): void;
  move(id: string, offset: -1 | 1): void;
  resume(): void;
}

/**
 * The resent action keeps the original text first so the referee reads the
 * steer as an addition to the same action, not as a separate turn.
 */
export function combinePlaySteerText(original: string, steer: string): string {
  return `${original.trim()}\n\n补充：${steer.trim()}`;
}

/** Maps how a turn ended to the reason the queue stops, if it should. */
export function playFollowUpPauseForOutcome(
  outcome: PlayTurnSubmitOutcome,
  phase: string | undefined,
): PlayFollowUpPauseReason | undefined {
  if (outcome === 'committed' || outcome === 'ignored') return undefined;
  if (outcome === 'cancelled') return 'stopped';
  if (outcome === 'unknown') return 'unknown';
  return phase === 'conflict' ? 'conflict' : 'failed';
}

/** A drifted source with no recorded decision blocks queued actions until the author picks one. */
export function playSourceDriftNeedsDecision(
  drift: Readonly<PlaySourceDriftView> | undefined,
): boolean {
  return Boolean(
    drift &&
    drift.overall === 'drifted' &&
    !drift.activeResolution &&
    drift.availableDecisions.length > 0,
  );
}

/**
 * Follow-up actions queued while a Play turn runs. The queue lives in memory
 * and is not restored after restart; items are bound to the session they
 * were queued in.
 */
export function createPlayFollowUpQueue(selectedSessionId: Readonly<Ref<string>>) {
  const items = shallowRef<PlayQueuedAction[]>([]);
  const pausedReason = shallowRef<PlayFollowUpPauseReason>();
  const notice = shallowRef('');

  const sessionItems = computed(() =>
    items.value.filter((item) => item.sessionId === selectedSessionId.value));

  function enqueue(
    action: Omit<PlayQueuedAction, 'id'>,
    atFront = false,
  ): PlayQueuedAction {
    const item = { ...action, id: createQueuedId() };
    items.value = atFront ? [item, ...items.value] : [...items.value, item];
    return item;
  }

  function remove(id: string): PlayQueuedAction | undefined {
    const item = items.value.find((candidate) => candidate.id === id);
    items.value = items.value.filter((candidate) => candidate.id !== id);
    return item;
  }

  function edit(id: string, text: string): void {
    items.value = items.value.map((item) =>
      item.id === id ? { ...item, userText: text } : item);
  }

  /** Moves an item past its neighbour within the same session. */
  function move(id: string, offset: -1 | 1): void {
    const item = items.value.find((candidate) => candidate.id === id);
    if (!item) return;
    const sameSession = items.value.filter((candidate) => candidate.sessionId === item.sessionId);
    const index = sameSession.indexOf(item);
    const neighbour = sameSession[index + offset];
    if (!neighbour) return;
    const next = [...items.value];
    const from = next.indexOf(item);
    const to = next.indexOf(neighbour);
    [next[from], next[to]] = [neighbour, item];
    items.value = next;
  }

  function shift(sessionId: string): PlayQueuedAction | undefined {
    const item = items.value.find((candidate) => candidate.sessionId === sessionId);
    if (item) remove(item.id);
    return item;
  }

  function pause(reason: PlayFollowUpPauseReason): void {
    pausedReason.value = reason;
    notice.value = PLAY_FOLLOW_UP_PAUSE_LABELS[reason];
  }

  function clearPause(): void {
    pausedReason.value = undefined;
    notice.value = '';
  }

  return {
    items,
    sessionItems,
    pausedReason,
    notice,
    enqueue,
    remove,
    edit,
    move,
    shift,
    pause,
    clearPause,
  };
}

export type PlayFollowUpQueue = ReturnType<typeof createPlayFollowUpQueue>;

function createQueuedId(): string {
  return `play-queued-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
