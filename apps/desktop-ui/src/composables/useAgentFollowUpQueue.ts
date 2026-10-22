import type { ChatStatus, UIMessage } from 'ai';
import { computed, shallowRef } from 'vue';

export interface QueuedFollowUp {
  id: string;
  text: string;
  writingReferenceAttachmentIds: string[];
}

export type FollowUpPauseReason = 'failed' | 'stopped' | 'pending_action' | 'incomplete';

export interface AgentTurnOutcome {
  pause?: FollowUpPauseReason;
  /** Steers the backend accepted but the turn finished before using. */
  rejectedSteers: string[];
}

export const FOLLOW_UP_PAUSE_LABELS: Record<FollowUpPauseReason, string> = {
  failed: '本轮失败，排队消息已暂停。',
  stopped: '本轮已停止，排队消息已暂停。',
  pending_action: '本轮有待审批的修改，审阅后再继续发送排队消息。',
  incomplete: '本轮没有正常完成，排队消息已暂停。',
};

/** Per-conversation follow-up queue. It lives in memory and is not restored after restart. */
export function createFollowUpQueue() {
  const items = shallowRef<QueuedFollowUp[]>([]);
  const pausedReason = shallowRef<FollowUpPauseReason | undefined>();
  const notice = shallowRef('');

  function enqueue(text: string, writingReferenceAttachmentIds: string[] = [], atFront = false): QueuedFollowUp {
    const item = { id: createQueuedId(), text, writingReferenceAttachmentIds };
    items.value = atFront ? [item, ...items.value] : [...items.value, item];
    return item;
  }

  function remove(id: string): QueuedFollowUp | undefined {
    const item = items.value.find((candidate) => candidate.id === id);
    items.value = items.value.filter((candidate) => candidate.id !== id);
    return item;
  }

  function edit(id: string, text: string): void {
    items.value = items.value.map((item) => item.id === id ? { ...item, text } : item);
  }

  function move(id: string, offset: -1 | 1): void {
    const index = items.value.findIndex((item) => item.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= items.value.length) return;
    const next = [...items.value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    items.value = next;
  }

  function shift(): QueuedFollowUp | undefined {
    const [first, ...rest] = items.value;
    items.value = rest;
    return first;
  }

  return {
    items,
    pausedReason,
    notice,
    hasItems: computed(() => items.value.length > 0),
    enqueue,
    remove,
    edit,
    move,
    shift,
  };
}

export type FollowUpQueue = ReturnType<typeof createFollowUpQueue>;

/** What the Copilot composer needs to show and drive the queue of the active conversation. */
export interface AgentFollowUpControls {
  items: readonly QueuedFollowUp[];
  notice: string;
  paused: boolean;
  steerInput(): void;
  steer(id: string): void;
  edit(id: string, text: string): void;
  remove(id: string): void;
  move(id: string, offset: -1 | 1): void;
  resume(): void;
}

/** Reads how the latest turn ended from its streamed parts. */
export function evaluateAgentTurnOutcome(
  messages: UIMessage[],
  status: ChatStatus,
  stopRequested: boolean,
): AgentTurnOutcome {
  const latest = [...messages].reverse().find((message) => message.role === 'assistant');
  const parts = latest?.parts ?? [];
  const rejectedSteers = parts.flatMap((part) => {
    if (part.type !== 'data-steering') return [];
    const data = part.data as { status?: unknown; content?: unknown };
    return data.status === 'rejected' && typeof data.content === 'string' ? [data.content] : [];
  });
  if (stopRequested) return { pause: 'stopped', rejectedSteers };
  if (status === 'error') return { pause: 'failed', rejectedSteers };
  const resultPart = [...parts].reverse().find((part) => part.type === 'data-runtime-result');
  const result = resultPart && 'data' in resultPart
    ? resultPart.data as { stoppedReason?: unknown; pendingActions?: unknown }
    : undefined;
  if (!result) return { pause: 'incomplete', rejectedSteers };
  if (Array.isArray(result.pendingActions) && result.pendingActions.length > 0) {
    return { pause: 'pending_action', rejectedSteers };
  }
  if (result.stoppedReason === 'aborted') return { pause: 'stopped', rejectedSteers };
  if (result.stoppedReason !== 'completed') return { pause: 'incomplete', rejectedSteers };
  return { rejectedSteers };
}

export function createAgentTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createQueuedId(): string {
  return `queued-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
