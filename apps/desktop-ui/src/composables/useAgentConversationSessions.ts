import { Chat } from '@ai-sdk/vue';
import type { ChatStatus, UIMessage } from 'ai';
import { computed, shallowRef, type ShallowRef } from 'vue';

import { oanClient } from '../client';
import {
  collectPendingActions,
  type PendingActionView,
} from './useAgentCheckpointChat';

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
      activeSessionId.value = id;
    }
  }

  async function sendCurrentInput() {
    const session = activeSession.value;
    const text = session.input.value.trim();

    if (!text) {
      return;
    }

    session.input.value = '';
    updateTitleFromPrompt(session, text);
    touchConversation(session);
    await session.chat.sendMessage({ text });
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
    createConversation,
    selectConversation,
    sendCurrentInput,
    stop,
  };
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
