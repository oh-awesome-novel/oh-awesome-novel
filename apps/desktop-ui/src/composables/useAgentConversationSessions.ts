import { Chat } from '@ai-sdk/vue';
import type { ChatStatus, UIMessage } from 'ai';
import { computed, shallowRef, type ShallowRef } from 'vue';

import { oanClient } from '../client';
import {
  collectPendingActions,
  type PendingActionView,
} from './useAgentCheckpointChat';
import type { PlayWritingReferenceAttachment } from './useWorkspaceApi';

export const MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST = 8;

interface AgentConversationSession {
  id: string;
  title: ShallowRef<string>;
  createdAt: string;
  updatedAt: ShallowRef<string>;
  input: ShallowRef<string>;
  chat: Chat<UIMessage>;
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

export function useAgentConversationSessions() {
  const initialSession = createConversationSession();
  const sessions = shallowRef<AgentConversationSession[]>([initialSession]);
  const activeSessionId = shallowRef(initialSession.id);
  const writingReferenceAttachments = shallowRef<PlayWritingReferenceAttachment[]>([]);
  const writingReferencesLoading = shallowRef(false);
  const writingReferencesError = shallowRef('');
  const selectedWritingReferenceAttachmentIds = shallowRef<string[]>([]);

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
  const activeMessages = computed(() => activeChat.value.messages);
  const activeStatus = computed<ChatStatus>(() => activeChat.value.status);
  const activePendingActions = computed<PendingActionView[]>(() =>
    collectPendingActions(activeMessages.value),
  );
  const conversationSummaries = computed<AgentConversationSummary[]>(() =>
    [...sessions.value]
      .sort((left, right) => right.updatedAt.value.localeCompare(left.updatedAt.value))
      .map((session) => ({
        id: session.id,
        title: session.title.value,
        preview: getConversationPreview(session.chat.messages),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt.value,
        messageCount: session.chat.messages.length,
        active: session.id === activeSessionId.value,
      })),
  );

  function createConversation() {
    clearSelectedWritingReferences();
    const current = activeSession.value;
    if (current.chat.messages.length === 0 && current.input.value.trim().length === 0) {
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

  async function sendCurrentInput() {
    const session = activeSession.value;
    const text = session.input.value.trim();

    if (!text) {
      return;
    }

    const writingReferenceAttachmentIds = [
      ...selectedWritingReferenceAttachmentIds.value,
    ];
    await session.chat.sendMessage(
      { text },
      { body: { writingReferenceAttachmentIds } },
    );
    session.input.value = '';
    clearSelectedWritingReferences();
    updateTitleFromPrompt(session, text);
    touchConversation(session);
  }

  function stop() {
    activeChat.value.stop();
  }

  return {
    activeConversationId: activeSessionId,
    activeInput,
    activeMessages,
    activePendingActions,
    activeStatus,
    conversationSummaries,
    writingReferenceAttachments,
    writingReferencesLoading,
    writingReferencesError,
    selectedWritingReferenceAttachmentIds,
    createConversation,
    refreshWritingReferences,
    selectConversation,
    sendCurrentInput,
    stop,
    toggleWritingReferenceAttachment,
  };

  function clearSelectedWritingReferences() {
    selectedWritingReferenceAttachmentIds.value = [];
  }
}

function createConversationSession(): AgentConversationSession {
  const now = new Date().toISOString();
  return {
    id: createConversationId(),
    title: shallowRef('新对话'),
    createdAt: now,
    updatedAt: shallowRef(now),
    input: shallowRef(''),
    chat: new Chat<UIMessage>({
      transport: oanClient.createAgentChatTransport(),
    }),
  };
}

function createConversationId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
