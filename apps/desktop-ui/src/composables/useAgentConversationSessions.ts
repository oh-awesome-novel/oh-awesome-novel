import { useChat, type UseChatHelpers } from '@ai-sdk/vue';
import type { ChatStatus, UIMessage } from 'ai';
import { computed, effectScope, getCurrentScope, onScopeDispose, shallowRef, type ShallowRef } from 'vue';

import { oanClient } from '../client';
import {
  collectPendingActions,
  type PendingActionView,
} from './useAgentCheckpointChat';
import {
  FOLLOW_UP_PAUSE_LABELS,
  createAgentTurnId,
  createFollowUpQueue,
  evaluateAgentTurnOutcome,
  type FollowUpQueue,
} from './useAgentFollowUpQueue';
import type { PlayWritingReferenceAttachment } from './useWorkspaceApi';

export const MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST = 8;

interface AgentConversationSession {
  id: string;
  title: ShallowRef<string>;
  createdAt: string;
  updatedAt: ShallowRef<string>;
  input: ShallowRef<string>;
  chat: UseChatHelpers<UIMessage>;
  followUps: FollowUpQueue;
  /** Set while a turn streams; the backend accepts steers for this id only. */
  turnId: ShallowRef<string | undefined>;
  stopRequested: boolean;
  dispose(): void;
}

export interface AgentConversationSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
}

export function useAgentConversationSessions(options: {
  getExactWritablePaths?: () => string[];
} = {}) {
  const initialSession = createConversationSession();
  const sessions = shallowRef<AgentConversationSession[]>([initialSession]);
  const activeSessionId = shallowRef(initialSession.id);
  const writingReferenceAttachments = shallowRef<PlayWritingReferenceAttachment[]>([]);
  const writingReferencesLoading = shallowRef(false);
  const writingReferencesError = shallowRef('');
  const selectedWritingReferenceAttachmentIds = shallowRef<string[]>([]);
  const canonicalWritingSourcePaths = shallowRef<string[]>([]);
  function selectCanonicalWritingSources(paths: string[]) { canonicalWritingSourcePaths.value = [...new Set(paths)].slice(0, 16); }
  function removeCanonicalWritingSource(path: string) { canonicalWritingSourcePaths.value = canonicalWritingSourcePaths.value.filter(item => item !== path); }

  function dispose() {
    for (const session of sessions.value) session.dispose();
  }
  if (getCurrentScope()) onScopeDispose(dispose);

  const activeSession = computed(() =>
    sessions.value.find((session) => session.id === activeSessionId.value) ?? sessions.value[0],
  );
  const activeChat = computed(() => activeSession.value.chat);
  const activeInput = computed({
    get: () => activeSession.value.input.value,
    set: (value: string) => {
      activeSession.value.input.value = value;
    },
  });
  const activeMessages = computed(() => activeChat.value.messages.value);
  const activeStatus = computed<ChatStatus>(() => activeChat.value.status.value);
  const activeFollowUps = computed(() => activeSession.value.followUps.items.value);
  const activeFollowUpNotice = computed(() => {
    const queue = activeSession.value.followUps;
    return queue.notice.value
      || (queue.pausedReason.value && queue.items.value.length ? FOLLOW_UP_PAUSE_LABELS[queue.pausedReason.value] : '');
  });
  const activeFollowUpsPaused = computed(() =>
    Boolean(activeSession.value.followUps.pausedReason.value) && activeSession.value.followUps.items.value.length > 0);
  const activePendingActions = computed<PendingActionView[]>(() =>
    collectPendingActions(activeMessages.value),
  );
  const conversationSummaries = computed<AgentConversationSummary[]>(() =>
    [...sessions.value]
      .sort((left, right) => right.updatedAt.value.localeCompare(left.updatedAt.value))
      .map((session) => ({
        id: session.id,
        title: session.title.value,
        preview: getConversationPreview(session.chat.messages.value),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt.value,
        messageCount: session.chat.messages.value.length,
        active: session.id === activeSessionId.value,
      })),
  );

  function createConversation() {
    clearSelectedWritingReferences();
    const current = activeSession.value;
    if (current.chat.messages.value.length === 0 && current.input.value.trim().length === 0) {
      activeSessionId.value = current.id;
      return current.id;
    }

    const next = createConversationSession();
    sessions.value = [next, ...sessions.value];
    activeSessionId.value = next.id;
    return next.id;
  }

  function selectConversation(id: string) {
    if (sessions.value.some((session) => session.id === id)) {
      clearSelectedWritingReferences();
      activeSessionId.value = id;
    }
  }

  async function refreshWritingReferences() {
    writingReferencesLoading.value = true;
    writingReferencesError.value = '';

    try {
      const result = await oanClient.listPlayWritingReferenceAttachments();
      writingReferenceAttachments.value = result.attachments;
      const activeIds = new Set(
        result.attachments
          .filter((attachment) => attachment.status === 'active')
          .map((attachment) => attachment.id),
      );
      selectedWritingReferenceAttachmentIds.value =
        selectedWritingReferenceAttachmentIds.value.filter((id) => activeIds.has(id));
    } catch (caught) {
      writingReferencesError.value = toErrorMessage(caught);
    } finally {
      writingReferencesLoading.value = false;
    }
  }

  function toggleWritingReferenceAttachment(id: string) {
    const attachment = writingReferenceAttachments.value.find(
      (candidate) => candidate.id === id,
    );
    if (!attachment || attachment.status !== 'active') {
      return;
    }

    if (
      !selectedWritingReferenceAttachmentIds.value.includes(id) &&
      selectedWritingReferenceAttachmentIds.value.length >=
        MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST
    ) {
      return;
    }

    selectedWritingReferenceAttachmentIds.value =
      selectedWritingReferenceAttachmentIds.value.includes(id)
        ? selectedWritingReferenceAttachmentIds.value.filter((candidate) => candidate !== id)
        : [...selectedWritingReferenceAttachmentIds.value, id];
  }

  /**
   * Sends the input, or queues it as a follow-up while a turn is running
   * (the composer's send shortcut queues by default during a run).
   */
  async function sendCurrentInput() {
    const session = activeSession.value;
    const text = session.input.value.trim();

    if (!text) {
      return;
    }

    const canonicalPaths = [...canonicalWritingSourcePaths.value];
    const writingReferenceAttachmentIds = [
      ...selectedWritingReferenceAttachmentIds.value,
    ];
    session.input.value = '';
    if (activeSessionId.value === session.id) clearSelectedWritingReferences();
    if (isBusy(session)) {
      session.followUps.notice.value = '';
      session.followUps.enqueue(text, writingReferenceAttachmentIds, false, canonicalPaths);
      return;
    }
    // A fresh author send means the author has seen why the queue paused.
    session.followUps.pausedReason.value = undefined;
    try {
      await runTurn(session, text, writingReferenceAttachmentIds, canonicalPaths);
    } catch (caught) {
      // Give the author their draft and selection back to retry.
      if (!session.input.value) session.input.value = text;
      if (activeSessionId.value === session.id && !selectedWritingReferenceAttachmentIds.value.length && !canonicalWritingSourcePaths.value.length) {
        selectedWritingReferenceAttachmentIds.value = writingReferenceAttachmentIds;
        canonicalWritingSourcePaths.value = canonicalPaths;
      }
      throw caught;
    }
  }

  /** Adds the input to the running turn; falls back to the front of the queue when too late. */
  async function steerCurrentInput() {
    const session = activeSession.value;
    const text = session.input.value.trim();
    if (!text) return;
    if (!isBusy(session) || canonicalWritingSourcePaths.value.length) {
      await sendCurrentInput();
      return;
    }
    session.input.value = '';
    const accepted = await trySteer(session, text);
    if (!accepted) {
      session.followUps.enqueue(text, [], true);
      session.followUps.notice.value = '本轮已在收尾，插话已改为排队，会在本轮结束后发送。';
    }
  }

  async function steerQueuedFollowUp(id: string) {
    const session = activeSession.value;
    const item = session.followUps.items.value.find((candidate) => candidate.id === id);
    if (!item) return;
    if (item.canonicalWritingSourcePaths?.length) { session.followUps.notice.value = '带设定来源的消息需作为完整下一轮发送，已保留在排队中。'; return; }
    if (!isBusy(session) || !(await trySteer(session, item.text))) {
      session.followUps.notice.value = '本轮已结束或正在收尾，这条消息保留在排队中。';
      return;
    }
    session.followUps.remove(id);
  }

  function editQueuedFollowUp(id: string, text: string) {
    activeSession.value.followUps.edit(id, text);
  }

  function removeQueuedFollowUp(id: string) {
    activeSession.value.followUps.remove(id);
  }

  function moveQueuedFollowUp(id: string, offset: -1 | 1) {
    activeSession.value.followUps.move(id, offset);
  }

  async function resumeFollowUps() {
    const session = activeSession.value;
    session.followUps.pausedReason.value = undefined;
    session.followUps.notice.value = '';
    if (!isBusy(session)) await drainFollowUps(session);
  }

  async function trySteer(session: AgentConversationSession, text: string): Promise<boolean> {
    const turnId = session.turnId.value;
    if (!turnId) return false;
    try {
      const result = await oanClient.steerAgentTurn(session.id, turnId, text);
      if (result.status === 'accepted') {
        session.followUps.notice.value = '';
        return true;
      }
      return false;
    } catch (caught) {
      session.followUps.notice.value = `插话发送失败：${toErrorMessage(caught)}`;
      return false;
    }
  }

  async function runTurn(
    session: AgentConversationSession,
    text: string,
    writingReferenceAttachmentIds: string[],
    canonicalPaths: string[] = [],
  ) {
    const turnId = createAgentTurnId();
    session.turnId.value = turnId;
    session.stopRequested = false;
    try {
      await session.chat.sendMessage(
        { text },
        {
          body: {
            sessionId: session.id,
            turnId,
            writingReferenceAttachmentIds,
            ...(canonicalPaths.length ? { canonicalWritingSourcePaths: canonicalPaths } : {}),
            editContext: {
              exactWritablePaths: options.getExactWritablePaths?.() ?? [],
            },
          },
        },
      );
    } finally {
      if (session.turnId.value === turnId) session.turnId.value = undefined;
    }
    const outcome = evaluateAgentTurnOutcome(
      session.chat.messages.value,
      session.chat.status.value,
      session.stopRequested,
    );
    for (const steer of [...outcome.rejectedSteers].reverse()) session.followUps.enqueue(steer, [], true);
    if (outcome.rejectedSteers.length) {
      session.followUps.notice.value = '有插话在本轮结束前没来得及送达，已放到排队最前面。';
    }
    if (outcome.pause) {
      session.followUps.pausedReason.value = outcome.pause;
    }
    if (session.chat.status.value === 'error') {
      throw session.chat.error.value ?? new Error('The conversation request failed.');
    }
    updateTitleFromPrompt(session, text);
    touchConversation(session);
    if (!outcome.pause) await drainFollowUps(session);
  }

  async function drainFollowUps(session: AgentConversationSession) {
    if (session.followUps.pausedReason.value) return;
    const next = session.followUps.shift();
    if (!next) return;
    try {
      await runTurn(session, next.text, next.writingReferenceAttachmentIds, next.canonicalWritingSourcePaths);
    } catch (caught) {
      // A failed follow-up stays first in line; the author decides when to retry.
      session.followUps.enqueue(next.text, next.writingReferenceAttachmentIds, true, next.canonicalWritingSourcePaths);
      session.followUps.pausedReason.value = 'failed';
      session.followUps.notice.value = `排队消息发送失败：${toErrorMessage(caught)}`;
    }
  }

  function stop() {
    activeSession.value.stopRequested = true;
    void activeChat.value.stop();
  }

  return {
    activeConversationId: activeSessionId,
    activeInput,
    activeMessages,
    activePendingActions,
    activeStatus,
    activeFollowUps,
    activeFollowUpNotice,
    activeFollowUpsPaused,
    conversationSummaries,
    canonicalWritingSourcePaths,
    selectCanonicalWritingSources,
    removeCanonicalWritingSource,
    writingReferenceAttachments,
    writingReferencesLoading,
    writingReferencesError,
    selectedWritingReferenceAttachmentIds,
    createConversation,
    dispose,
    refreshWritingReferences,
    selectConversation,
    sendCurrentInput,
    steerCurrentInput,
    steerQueuedFollowUp,
    editQueuedFollowUp,
    removeQueuedFollowUp,
    moveQueuedFollowUp,
    resumeFollowUps,
    stop,
    toggleWritingReferenceAttachment,
  };

  function clearSelectedWritingReferences() {
    selectedWritingReferenceAttachmentIds.value = [];
    canonicalWritingSourcePaths.value = [];
  }
}

function createConversationSession(): AgentConversationSession {
  const now = new Date().toISOString();
  const id = createConversationId();
  // Conversations can be created from click handlers outside setup's active
  // scope. Each owns its SDK watchers and keeps its state while another is shown.
  const scope = effectScope(true);
  const chat = scope.run(() => useChat<UIMessage>({
    id,
    transport: oanClient.createAgentChatTransport(),
  }))!;
  return {
    id,
    title: shallowRef('新对话'),
    createdAt: now,
    updatedAt: shallowRef(now),
    input: shallowRef(''),
    chat,
    followUps: createFollowUpQueue(),
    turnId: shallowRef<string | undefined>(),
    stopRequested: false,
    dispose() {
      void chat.stop();
      scope.stop();
    },
  };
}

function createConversationId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isBusy(session: AgentConversationSession): boolean {
  const status = session.chat.status.value;
  return status === 'submitted' || status === 'streaming';
}

function touchConversation(session: AgentConversationSession) {
  session.updatedAt.value = new Date().toISOString();
}

function updateTitleFromPrompt(session: AgentConversationSession, prompt: string) {
  if (session.title.value !== '新对话') {
    return;
  }

  const normalized = prompt.replace(/\s+/g, ' ').trim();
  session.title.value = normalized.length > 24
    ? `${normalized.slice(0, 24)}...`
    : normalized || '新对话';
}

function getConversationPreview(messages: UIMessage[]): string {
  const latestMessage = [...messages].reverse().find((message) =>
    message.parts.some((part) => part.type === 'text' && part.text.trim().length > 0),
  );

  if (!latestMessage) {
    return '空白对话';
  }

  const text = latestMessage.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
